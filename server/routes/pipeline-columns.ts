import type { Express } from "express";
import { storage } from "../storage";
import { insertPipelineColumnSchema, pipelineColumns, leads } from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { parseId, resolveWorkspaceId, safeErr } from "../utils/helpers";
import { db } from "../db";
import { eq, and } from "drizzle-orm";

// ── Funil de vendas editável do CRM (Bruno 2026-06-28) ──────────────────────
// Colunas de EXIBIÇÃO por cima do backbone operacional (pipeline_stages).
// O bot não toca aqui: segue gravando lead.status com os 5 prefixos universais;
// estas colunas só decidem ONDE o card aparece no CRM e quais estados do bot
// cada coluna "absorve". Coluna nova nasce MANUAL (auto_states=[]) — o card só
// cai nela por arraste e fica preso via leads.display_column.

// Default do Comercial — espelha o seed do boot (server/index.ts). Usado como
// fallback lazy pra qualquer workspace que faça GET antes do backfill.
const DEFAULT_COMERCIAL_COLUMNS = [
  { key: "novo",       label: "Novo",          color: "#5b93d3", ordem: 0, autoStates: ["novo"], isTerminal: false, terminalReason: null },
  { key: "negociacao", label: "Em negociação", color: "#f59e0b", ordem: 1, autoStates: ["em_automacao", "aguardando", "atendimento_humano"], isTerminal: false, terminalReason: null },
  { key: "ganho",      label: "Ganho",         color: "#10b981", ordem: 2, autoStates: ["finalizado"], isTerminal: true, terminalReason: "ativado" },
  { key: "perdido",    label: "Perdido",       color: "#ef4444", ordem: 3, autoStates: [], isTerminal: true, terminalReason: "perdido" },
];

// Slug simples e estável pra key. Diacríticos viram "_" (ex: "Proposta enviada"
// → "proposta_enviada"; "Negociação" → "negocia_a_o"). Suficiente: a key é
// interna; o usuário vê só o label.
function slugify(label: string): string {
  const s = (label || "coluna")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return s || "coluna";
}

export function registerPipelineColumnRoutes(app: Express) {
  app.get("/api/pipeline-columns", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const pipeline = (req.query.pipeline as string | undefined) || "comercial";
      let cols = await storage.getPipelineColumns(wsId, pipeline);
      if (cols.length === 0 && pipeline === "comercial") {
        // Seed lazy idempotente das 4 colunas default.
        for (const c of DEFAULT_COMERCIAL_COLUMNS) {
          try { await storage.createPipelineColumn({ ...c, pipeline, workspaceId: wsId }); } catch {}
        }
        cols = await storage.getPipelineColumns(wsId, pipeline);
      }
      res.json(cols);
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[pipeline-columns]") });
    }
  });

  app.post("/api/pipeline-columns", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const pipeline = (req.body.pipeline as string | undefined) || "comercial";
      const existing = await storage.getPipelineColumns(wsId, pipeline);
      // Gera uma key estável e única dentro do (workspace, pipeline).
      const base = slugify(req.body.key || req.body.label || "coluna");
      const used = new Set(existing.map((c) => c.key));
      let key = base;
      let n = 2;
      while (used.has(key)) key = `${base}_${n++}`;
      // Coluna criada pelo usuário nasce MANUAL e não-terminal por padrão.
      const parsed = insertPipelineColumnSchema.omit({ workspaceId: true }).safeParse({
        ...req.body,
        pipeline,
        key,
        ordem: existing.length,
      });
      if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
      const created = await storage.createPipelineColumn({ ...parsed.data, workspaceId: wsId });
      res.status(201).json(created);
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[pipeline-columns]") });
    }
  });

  app.patch("/api/pipeline-columns/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id as string);
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    // Não deixa re-parentar pra outro tenant (espelha o fix de leads/pipeline).
    // key não é editável depois de criada (leads.display_column referencia ela).
    const parsed = insertPipelineColumnSchema.omit({ workspaceId: true, key: true }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updatePipelineColumn(id, parsed.data, wsId);
    if (!updated) return res.status(404).json({ message: "Coluna não encontrada" });
    res.json(updated);
  });

  app.post("/api/pipeline-columns/reorder", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const { columns } = req.body;
    if (!Array.isArray(columns)) return res.status(400).json({ message: "columns array required" });
    for (const c of columns) {
      if (c.id && typeof c.ordem === "number") {
        await db.update(pipelineColumns).set({ ordem: c.ordem })
          .where(and(eq(pipelineColumns.id, c.id), eq(pipelineColumns.workspaceId, wsId)));
      }
    }
    res.json({ ok: true });
  });

  app.delete("/api/pipeline-columns/:id", requireAuth, async (req, res) => {
    const id = parseId(req.params.id as string);
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const target = (await storage.getPipelineColumns(wsId)).find((c) => c.id === id);
    if (!target) return res.status(404).json({ message: "Coluna não encontrada" });
    // Não deixa o funil ficar sem coluna nenhuma.
    const siblings = await storage.getPipelineColumns(wsId, target.pipeline);
    if (siblings.length <= 1) return res.status(400).json({ message: "O funil precisa de ao menos uma coluna" });
    // Cards parados manualmente nesta coluna voltam a seguir o bot (display_column → NULL);
    // no Kanban caem como órfãos na primeira coluna.
    await db.update(leads).set({ displayColumn: null })
      .where(and(eq(leads.workspaceId, wsId), eq(leads.displayColumn, target.key)));
    await storage.deletePipelineColumn(id, wsId);
    res.status(204).send();
  });
}
