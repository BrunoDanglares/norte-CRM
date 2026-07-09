import type { Express } from "express";
import { storage } from "../storage";
import { insertPipelineSchema, insertPipelineStageSchema, pipelineStages, leads, conversations } from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { parseId, resolveWorkspaceId, safeErr } from "../utils/helpers";
import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";

// Bruno 2026-06-28: CRM virou genérico. Só o trilho Comercial é nativo.
// Os trilhos ISP Suporte/Financeiro foram aposentados — não são mais semeados e
// ensureIspPipelines os desativa (sem deletar: dados preservados).
const ISP_PIPELINES = [
  { key: "comercial", label: "Comercial", icon: "ShoppingCart", cor: "#7c5cbf", fixed: true, ordem: 0 },
];

// Trilhos legados a desativar no boot/load (ficam active=false, somem da aba).
const RETIRED_PIPELINE_KEYS = ["suporte", "financeiro"];

// ── 5 etapas universais — compartilhadas pelos 3 setores ─────────────────────
// Princípio: Kanban = estado operacional; Situação = contexto de negócio
// Uma única linha por etapa (unique key), reutilizada em todos os setores via fallback
function ispStages(wsId: string) {
  const s = wsId.substring(0, 8);
  return [
    { key: `novo_${s}`,               label: "Novo",               color: "#5b93d3", ordem: 0, pipeline: "comercial" },
    { key: `em_automacao_${s}`,       label: "Em Automação",       color: "#f59e0b", ordem: 1, pipeline: "comercial" },
    { key: `aguardando_${s}`,         label: "Aguardando",         color: "#a855f7", ordem: 2, pipeline: "comercial" },
    { key: `atendimento_humano_${s}`, label: "Atendimento Humano", color: "#3b82f6", ordem: 3, pipeline: "comercial" },
    { key: `finalizado_${s}`,         label: "Finalizado",         color: "#10b981", ordem: 4, pipeline: "comercial" },
  ];
}

// Mapeamento dos prefixos antigos → novos (para migração de dados existentes)
function buildOldToNewMap(wsId: string): Record<string, string> {
  const s = wsId.substring(0, 8);
  return {
    // Comercial antigo → novo
    [`novo_contato_${s}`]:            `novo_${s}`,
    [`viabilidade_proposta_${s}`]:    `em_automacao_${s}`,
    [`atendimento_humano_com_${s}`]:  `atendimento_humano_${s}`,
    [`instalacao_agendada_${s}`]:     `aguardando_${s}`,
    [`cliente_ativado_${s}`]:         `finalizado_${s}`,
    [`cliente_perdido_${s}`]:         `finalizado_${s}`,
    // Suporte antigo → novo
    [`novo_chamado_${s}`]:            `novo_${s}`,
    [`atendimento_remoto_${s}`]:      `em_automacao_${s}`,
    [`atendimento_humano_sup_${s}`]:  `atendimento_humano_${s}`,
    [`visita_tecnica_${s}`]:          `aguardando_${s}`,
    [`resolvido_${s}`]:               `finalizado_${s}`,
    [`escalado_noc_${s}`]:            `atendimento_humano_${s}`,
    // Financeiro antigo → novo
    [`nova_situacao_${s}`]:           `novo_${s}`,
    [`consulta_fatura_${s}`]:         `em_automacao_${s}`,
    [`promessa_pgto_${s}`]:           `aguardando_${s}`,
    [`atendimento_humano_fin_${s}`]:  `atendimento_humano_${s}`,
    [`pago_regularizado_${s}`]:       `finalizado_${s}`,
    [`inadimplente_suspenso_${s}`]:   `finalizado_${s}`,
  };
}

/**
 * Migra um workspace existente das etapas antigas para as 5 etapas universais.
 * Idempotente: verifica se a migração já foi feita antes de executar.
 */
async function migrateToUniversalStages(wsId: string): Promise<void> {
  const s = wsId.substring(0, 8);
  const checkKey = `novo_${s}`;

  const [already] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.workspaceId, wsId), eq(pipelineStages.key, checkKey)))
    .limit(1);

  if (already) return; // já migrado

  console.log(`[PipelineMigration] Iniciando migração para etapas universais — ws=${wsId.substring(0, 8)}`);

  // 1. Criar as novas etapas universais (ignora conflitos)
  for (const stage of ispStages(wsId)) {
    try { await storage.createPipelineStage({ ...stage, workspaceId: wsId }); } catch {}
  }

  // 2. Mapear leads e conversas das chaves antigas para novas
  const oldToNew = buildOldToNewMap(wsId);
  const oldKeys = Object.keys(oldToNew);

  for (const [oldKey, newKey] of Object.entries(oldToNew)) {
    await db.update(leads)
      .set({ status: newKey })
      .where(and(eq(leads.workspaceId, wsId), eq(leads.status, oldKey)))
      .catch(() => {});
    await db.update(conversations)
      .set({ pipelineEtapa: newKey })
      .where(and(eq(conversations.workspaceId, wsId), eq(conversations.pipelineEtapa, oldKey)))
      .catch(() => {});
  }

  // 3. Remover etapas antigas (limpeza)
  if (oldKeys.length > 0) {
    await db.delete(pipelineStages)
      .where(and(eq(pipelineStages.workspaceId, wsId), inArray(pipelineStages.key, oldKeys)))
      .catch(() => {});
  }

  // 4. Limpar cache de etapas
  const { clearStageCache } = await import('../services/suportePipelineService');
  clearStageCache(wsId);

  console.log(`[PipelineMigration] Workspace ${wsId.substring(0, 8)} migrado para etapas universais`);
}

// Bruno 2026-06-28: só a equipe Comercial é nativa. Equipes Suporte/Financeiro
// não são mais semeadas (as existentes não são deletadas — ver Usuários & Equipe).
const ISP_TEAMS = [
  { nome: "Comercial", descricao: "Equipe de vendas e novos contratos", pipelineKey: "comercial", fixed: true },
];

async function seedDefaultPipelines(wsId: string) {
  const { pipelines } = await import("@shared/schema");
  const existing = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, wsId))
    .limit(1);

  if (existing.length > 0) {
    await ensureIspPipelines(wsId);
    // Migrar silenciosamente workspaces com etapas antigas para as 5 universais
    migrateToUniversalStages(wsId).catch((err: any) =>
      console.error(`[PipelineMigration] Erro (não-fatal):`, err?.message)
    );
    return;
  }

  for (const p of ISP_PIPELINES) {
    await storage.createPipeline({ ...p, workspaceId: wsId });
  }
  const stagesExist = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(eq(pipelineStages.workspaceId, wsId))
    .limit(1);
  if (stagesExist.length === 0) {
    for (const stage of ispStages(wsId)) {
      await storage.createPipelineStage({ ...stage, workspaceId: wsId });
    }
  }
}

export async function ensureIspPipelines(wsId: string) {
  const { pipelines } = await import("@shared/schema");
  const existing = await db
    .select({ key: pipelines.key })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, wsId));
  const existingKeys = existing.map(p => p.key);
  for (const p of ISP_PIPELINES) {
    if (!existingKeys.includes(p.key)) {
      await storage.createPipeline({ ...p, workspaceId: wsId });
    }
  }
  // Bruno 2026-06-11: a whitelist preserva os 3 trilhos base + os setores
  // OPCIONAIS (vendas/retencao/suporte_n2). Sem isso, este UPDATE desativaria o
  // pipeline opcional logo após o tenant ativá-lo. Pipelines DESCONHECIDOS (lixo)
  // continuam sendo desativados. Keys são constantes do registro (não user input).
  const { OPTIONAL_PIPELINE_KEYS } = await import("../services/sectors/optionalSectors");
  const protectedKeys = ['comercial', ...OPTIONAL_PIPELINE_KEYS]
    .map(k => `'${k}'`).join(',');
  await db.execute(
    `UPDATE pipelines SET active = false WHERE workspace_id = '${wsId}' AND key NOT IN (${protectedKeys}) AND active = true`
  );
  // Bruno 2026-06-28: aposenta os trilhos ISP Suporte/Financeiro (não deleta —
  // fixed=true, dados preservados). A aba some porque o frontend filtra active.
  const retiredList = RETIRED_PIPELINE_KEYS.map(k => `'${k}'`).join(',');
  await db.execute(
    `UPDATE pipelines SET active = false WHERE workspace_id = '${wsId}' AND key IN (${retiredList}) AND active = true`
  );
}

// Bruno 2026-05-13: canônico passou a ser "Suporte" (era "Suporte Técnico").
// O merge agora consolida os nomes antigos no canônico atual.
// Bruno 2026-06-11: "Vendas"→"Comercial" APOSENTADO. "Vendas" voltou a ser um
// setor LEGÍTIMO (opcional, aquisição) — não pode mais ser renomeado pra Comercial,
// senão a equipe Vendas recém-criada seria consolidada no boot seguinte. Os
// tenants antigos já migraram Vendas→Comercial há tempo (merge rodava desde
// 2026-05-13), então remover é seguro.
const LEGACY_MERGE_MAP: Record<string, string> = {
  "Suporte Técnico": "Suporte",
  "Suporte Tecnico": "Suporte",
};

async function seedDefaultTeams(wsId: string) {
  const { autoAssignAllAdminsToTeam } = await import("../utils/helpers");
  const { db } = await import("../db");
  const { teams, teamMembers } = await import("@shared/schema");
  const { eq, and, inArray } = await import("drizzle-orm");

  const existingTeams = await storage.getTeams(wsId);

  const ispTeamIds: Record<string, string> = {};
  for (const t of ISP_TEAMS) {
    const exists = existingTeams.find(et => et.pipelineKey === t.pipelineKey && et.nome === t.nome && et.fixed);
    if (!exists) {
      const team = await storage.createTeam({ ...t, workspaceId: wsId });
      await autoAssignAllAdminsToTeam(wsId, team.id);
      ispTeamIds[t.nome] = team.id;
    } else {
      ispTeamIds[t.nome] = exists.id;
    }
  }

  for (const [oldName, newName] of Object.entries(LEGACY_MERGE_MAP)) {
    const oldTeam = existingTeams.find(et => et.nome === oldName && et.nome !== newName);
    if (!oldTeam) continue;
    const targetId = ispTeamIds[newName];
    if (!targetId) continue;

    const oldMembers = await db.select().from(teamMembers).where(eq(teamMembers.teamId, oldTeam.id));
    const targetMembers = await db.select().from(teamMembers).where(eq(teamMembers.teamId, targetId));
    const targetUserIds = new Set(targetMembers.map(m => m.userId));

    for (const m of oldMembers) {
      if (!targetUserIds.has(m.userId)) {
        await db.insert(teamMembers).values({ teamId: targetId, userId: m.userId, role: m.role }).onConflictDoNothing();
      }
    }

    await db.delete(teamMembers).where(eq(teamMembers.teamId, oldTeam.id));
    await db.delete(teams).where(eq(teams.id, oldTeam.id));
    console.log(`[ISP Teams] Merged "${oldName}" into "${newName}" and deleted old team`);
  }
}

export function registerPipelineRoutes(app: Express) {
  app.get("/api/pipelines", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    let pipelineList = await storage.getPipelines(wsId);
    if (pipelineList.length === 0) {
      await seedDefaultPipelines(wsId);
      pipelineList = await storage.getPipelines(wsId);
    }
    res.json(pipelineList);
  });

  app.post("/api/pipelines", requireAuth, async (req, res) => {
    const parsed = insertPipelineSchema.omit({ workspaceId: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const wsId = await resolveWorkspaceId(req);
    const existing = await storage.getPipelines(wsId);
    const pipeline = await storage.createPipeline({ ...parsed.data, ordem: existing.length, workspaceId: wsId });
    res.status(201).json(pipeline);
  });

  app.patch("/api/pipelines/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const existing = await storage.getPipelines(wsId);
    const target = existing.find(p => p.id === id);
    if (!target) return res.status(404).json({ message: "Pipeline not found" });
    if (target.fixed && (req.body.key || req.body.label)) {
      return res.status(403).json({ message: "Pipelines fixas não podem ser renomeadas" });
    }
    // Auditoria 2026-06-19: .omit({workspaceId}) — sem isto o corpo re-parentava a
    // própria pipeline pro workspace de outro tenant (igual o fix de leads/contacts).
    const parsed = insertPipelineSchema.omit({ workspaceId: true }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updatePipeline(id, parsed.data, wsId);
    res.json(updated);
  });

  app.delete("/api/pipelines/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const existing = await storage.getPipelines(wsId);
    const target = existing.find(p => p.id === id);
    if (!target) return res.status(404).json({ message: "Pipeline not found" });
    if (target.fixed) return res.status(403).json({ message: "Pipelines fixas não podem ser removidas" });
    const { db } = await import("../db");
    const { pipelineStages: stagesTable, pipelines: pipelinesTable } = await import("@shared/schema");
    const { eq: eqOp, and: andOp } = await import("drizzle-orm");
    await db.transaction(async (tx) => {
      await tx.delete(stagesTable).where(andOp(eqOp(stagesTable.pipeline, target.key), eqOp(stagesTable.workspaceId, wsId)));
      await tx.delete(pipelinesTable).where(andOp(eqOp(pipelinesTable.id, id), eqOp(pipelinesTable.workspaceId, wsId)));
    });
    res.status(204).send();
  });

  app.get("/api/pipeline-stages", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const pipeline = ((req.query.pipeline as string | undefined) as string | undefined) as string | undefined;
    const stages = await storage.getPipelineStages(wsId, pipeline);
    res.json(stages);
  });

  app.post("/api/pipeline-stages", requireAuth, async (req, res) => {
    const parsed = insertPipelineStageSchema.omit({ workspaceId: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    try {
      const stage = await storage.createPipelineStage({ ...parsed.data, workspaceId: await resolveWorkspaceId(req) });
      res.status(201).json(stage);
    } catch (e: any) {
      if (e.message?.includes("duplicate")) {
        return res.status(409).json({ message: "Etapa ja existe" });
      }
      res.status(500).json({ message: safeErr(e, "[pipeline]") });
    }
  });

  app.patch("/api/pipeline-stages/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    // Auditoria 2026-06-19: .omit({workspaceId}) — espelha o POST e os irmãos.
    const parsed = insertPipelineStageSchema.omit({ workspaceId: true }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updatePipelineStage(id, parsed.data, wsId);
    if (!updated) return res.status(404).json({ message: "Stage not found" });
    res.json(updated);
  });

  app.post("/api/pipeline-stages/reorder", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const { stages } = req.body;
    if (!Array.isArray(stages)) return res.status(400).json({ message: "stages array required" });
    const { db } = await import("../db");
    const { pipelineStages } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    for (const s of stages) {
      if (s.id && typeof s.ordem === "number") {
        await db.update(pipelineStages).set({ ordem: s.ordem }).where(and(eq(pipelineStages.id, s.id), eq(pipelineStages.workspaceId, wsId)));
      }
    }
    res.json({ ok: true });
  });

  app.delete("/api/pipeline-stages/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    await storage.deletePipelineStage(id, wsId);
    res.status(204).send();
  });

  app.post("/api/pipelines/seed-isp", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const { db } = await import("../db");
      const { pipelineStages: stagesTable, pipelines: pipelinesTable } = await import("@shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      await db.delete(stagesTable).where(eqOp(stagesTable.workspaceId, wsId));
      await db.delete(pipelinesTable).where(eqOp(pipelinesTable.workspaceId, wsId));
      await seedDefaultPipelines(wsId);
      await seedDefaultTeams(wsId);
      const pipelineList = await storage.getPipelines(wsId);
      const stages = await storage.getPipelineStages(wsId);
      const teams = await storage.getTeams(wsId);
      res.json({ ok: true, pipelines: pipelineList.length, stages: stages.length, teams: teams.length });
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[pipeline]") });
    }
  });
}
