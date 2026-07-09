import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { insertAutomacaoSchema, automationNodeLogs } from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId, safeErr } from "../utils/helpers";
import { db } from "../db";
import { sql, and, eq, gte } from "drizzle-orm";

export function registerAutomacaoRoutes(app: Express) {
  app.get("/api/automacoes", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const rows = await storage.getAutomacoes(wsId);
      const data = rows.map((a) => ({ ...a, passos: Array.isArray(a.nodes) ? (a.nodes as unknown[]).length : 0 }));
      res.json({ ok: true, data });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.get("/api/automacoes/stats", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const rows = await storage.getAutomacoes(wsId);
      let active = 0, paused = 0, draft = 0, totalExec = 0;
      for (const a of rows) {
        if (a.status === "ACTIVE") active++;
        else if (a.status === "PAUSED") paused++;
        else draft++;
        totalExec += a.execucoes ?? 0;
      }

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const logsStats = await db
        .select({
          total: sql<number>`count(*)::int`,
          success: sql<number>`count(*) filter (where status = 'success')::int`,
        })
        .from(automationNodeLogs)
        .where(
          and(
            eq(automationNodeLogs.workspaceId, wsId),
            gte(automationNodeLogs.executedAt, thirtyDaysAgo)
          )
        );

      const totalLogs = logsStats[0]?.total ?? 0;
      const successLogs = logsStats[0]?.success ?? 0;
      const successRate = totalLogs > 0 ? Math.round((successLogs / totalLogs) * 1000) / 10 : null;

      res.json({
        ok: true,
        data: {
          active,
          paused,
          draft,
          total_execucoes: totalExec,
          success_rate: successRate,
          execucoes_30d: totalLogs,
          periodo: '30d',
        },
      });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.get("/api/automacoes/:id", requireAuth, async (req, res) => {
    try {
      const auto = await storage.getAutomacao(((req.params.id as string) as string), await resolveWorkspaceId(req));
      if (!auto) return res.status(404).json({ error: "Automacao nao encontrada" });
      const logs = await storage.getAutomacaoLogs(auto.id, 10);
      const passos = Array.isArray(auto.nodes) ? (auto.nodes as unknown[]).length : 0;
      res.json({ ok: true, data: { ...auto, passos, logs } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.post("/api/automacoes", requireAuth, async (req, res) => {
    try {
      const body = { nome: req.body.nome, triggerType: req.body.trigger_type || req.body.triggerType, descricao: req.body.descricao || null, triggerChannel: req.body.trigger_channel || req.body.triggerChannel || null, nodes: req.body.nodes || [], status: req.body.status || "DRAFT" };
      const parsed = insertAutomacaoSchema.omit({ workspaceId: true }).safeParse(body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const created = await storage.createAutomacao({ ...parsed.data, workspaceId: await resolveWorkspaceId(req) });
      res.status(201).json({ ok: true, data: created });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.put("/api/automacoes/:id", requireAuth, async (req, res) => {
    try {
      const partial = insertAutomacaoSchema.partial().safeParse({ nome: req.body.nome, descricao: req.body.descricao, triggerType: req.body.trigger_type || req.body.triggerType, triggerChannel: req.body.trigger_channel || req.body.triggerChannel, status: req.body.status, nodes: req.body.nodes });
      if (!partial.success) return res.status(400).json({ error: partial.error.message });
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(partial.data)) { if (v !== undefined) clean[k] = v; }
      if (Object.keys(clean).length === 0) return res.status(400).json({ error: "Nenhum campo para atualizar" });
      const wsId = await resolveWorkspaceId(req);
      const updated = await storage.updateAutomacao(((req.params.id as string) as string), clean as any, wsId);
      if (!updated) return res.status(404).json({ error: "Automacao nao encontrada" });
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.patch("/api/automacoes/:id/toggle", requireAuth, async (req, res) => {
    try {
      const auto = await storage.getAutomacao(((req.params.id as string) as string), await resolveWorkspaceId(req));
      if (!auto) return res.status(404).json({ error: "Automacao nao encontrada" });
      const newStatus = auto.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
      const wsId = await resolveWorkspaceId(req);
      await storage.updateAutomacao(((req.params.id as string) as string), { status: newStatus } as any, wsId);
      if (newStatus === "PAUSED") {
        try {
          const { db: dbClean } = await import("../db");
          const { automationPendingInputs } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          await dbClean.delete(automationPendingInputs).where(eq(automationPendingInputs.flowId, ((req.params.id as string) as string)));
        } catch (e) { console.error("[Automacoes] Failed to clean pending inputs:", e); }
      }
      res.json({ ok: true, data: { id: auto.id, status: newStatus }, message: newStatus === "ACTIVE" ? "Automacao ativada" : "Automacao pausada" });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.post("/api/automacoes/:id/duplicate", requireAuth, async (req, res) => {
    try {
      const auto = await storage.getAutomacao(((req.params.id as string) as string), await resolveWorkspaceId(req));
      if (!auto) return res.status(404).json({ error: "Automacao nao encontrada" });
      const clone = await storage.createAutomacao({ nome: auto.nome + " (copia)", descricao: auto.descricao, triggerType: auto.triggerType, triggerChannel: auto.triggerChannel, nodes: auto.nodes as any, status: "DRAFT", workspaceId: await resolveWorkspaceId(req) });
      res.status(201).json({ ok: true, data: clone });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.post("/api/automacoes/:id/execute", requireAuth, async (req, res) => {
    try {
      const auto = await storage.getAutomacao(((req.params.id as string) as string), await resolveWorkspaceId(req));
      if (!auto) return res.status(404).json({ error: "Automacao nao encontrada" });
      const nodesArr = Array.isArray(auto.nodes) ? (auto.nodes as any[]) : [];
      const payload = req.body.payload || {};
      const executionId = randomUUID();
      const triggerNode = nodesArr.find((n: any) => n.type === "trigger");
      if (!triggerNode) return res.status(400).json({ error: "Automacao sem no de gatilho" });
      const { runFlowFromNode } = await import("../services/automationEngine");
      const wsId = await resolveWorkspaceId(req);
      const ctx = { workspaceId: wsId, leadId: payload.leadId || 0, phone: payload.phone || "", message: payload.message || { text: payload.messageText || "" }, variables: { ...payload }, executionId };
      const result = await runFlowFromNode(auto.id, nodesArr, triggerNode.id, ctx);
      res.json({ ok: true, data: { executedAt: new Date().toISOString(), success: true, status: result.status, node_id: result.node_id, message: result.message, log: result.log, total_nodes: result.total_nodes } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });

  app.delete("/api/automacoes/:id", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      await storage.deleteAutomacao(((req.params.id as string) as string), wsId);
      res.json({ ok: true, message: "Automacao removida" });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[automacoes]") }); }
  });
}
