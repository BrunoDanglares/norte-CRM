import type { Express } from "express";
import { storage } from "../storage";
import { insertLeadSchema, insertLeadTagSchema, leadStageHistory, conversationSituationTags, conversations, leads, contacts } from "@shared/schema";
import { requireAuth, requireAuthOrToken, requireScope } from "../middleware/auth";
import { coerceValor, parseId, resolveWorkspaceId, safeErr } from "../utils/helpers";
import { dispatchWebhook } from "../services/webhookDispatcher";
import { db } from "../db";
import { eq, sql, and, desc, inArray, isNotNull } from "drizzle-orm";
import { STAGE_LABELS } from "../services/suportePipelineService";
import { broadcastToWorkspace } from '../services/broadcast';

export function registerLeadRoutes(app: Express) {
  app.get("/api/leads", requireAuthOrToken, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const filters: any = {};
    if (((req.query.owner as string | undefined) as string | undefined)) filters.owner = String(((req.query.owner as string | undefined) as string | undefined));
    if (((req.query.search as string | undefined) as string | undefined)) filters.search = String(((req.query.search as string | undefined) as string | undefined));
    if (((req.query.stage as string | undefined) as string | undefined)) filters.stage = String(((req.query.stage as string | undefined) as string | undefined));
    if (((req.query.period as string | undefined) as string | undefined)) filters.period = String(((req.query.period as string | undefined) as string | undefined));
    if (((req.query.min_value as string | undefined) as string | undefined)) { const v = parseFloat(String(((req.query.min_value as string | undefined) as string | undefined))); if (Number.isFinite(v)) filters.minValue = v; }
    if (((req.query.max_value as string | undefined) as string | undefined)) { const v = parseFloat(String(((req.query.max_value as string | undefined) as string | undefined))); if (Number.isFinite(v)) filters.maxValue = v; }
    if (((req.query.tag as string | undefined) as string | undefined)) filters.tag = String(((req.query.tag as string | undefined) as string | undefined));
    // clamp da query string: limit gigante = OOM, offset negativo = erro SQL
    const limit = Math.min(Math.max(parseInt(((req.query.limit as string | undefined) as string | undefined) as string) || 500, 1), 1000);
    const offset = Math.max(parseInt(((req.query.offset as string | undefined) as string | undefined) as string) || 0, 0);
    filters.limit = limit;
    filters.offset = offset;
    const allLeads = await storage.getLeads(wsId, filters);

    // Enriquece com fotoUrl do contact correspondente (mesmo workspace +
    // telefone). Foto vem da Meta API (canal oficial) ou Evolution (não-oficial)
    // via avatar.service.ts. Frontend usa esse campo + fallback de iniciais.
    const phones = Array.from(new Set(
      allLeads.map(l => l.telefone).filter((t): t is string => !!t)
    ));
    let photoByPhone: Record<string, string> = {};
    if (phones.length > 0) {
      const rows = await db
        .select({ telefone: contacts.telefone, fotoUrl: contacts.fotoUrl })
        .from(contacts)
        .where(and(
          eq(contacts.workspaceId, wsId),
          isNotNull(contacts.fotoUrl),
          inArray(contacts.telefone, phones),
        ));
      for (const r of rows) {
        if (r.telefone && r.fotoUrl) photoByPhone[r.telefone] = r.fotoUrl;
      }
    }
    const enriched = allLeads.map(l => ({
      ...l,
      fotoUrl: (l.telefone && photoByPhone[l.telefone]) || null,
    }));
    res.json(enriched);
  });

  // Bruno 2026-05-20: endpoint dedicado pra page Atendimentos — retorna tags
  // agregadas por CONVERSATION_ID, garantindo isolamento por protocolo.
  // O endpoint anterior /api/leads/situation-tags agrupa por telefone, e quando
  // o mesmo cliente tem múltiplas conversas (resolvidas + ativas), as tags de
  // todas se fundem no card da conv atual (vazamento entre protocolos).
  // Cada conv inclui:
  //  - CST live tags (conversation_situation_tags da conversa atual)
  //  - Tags do protocolo MAIS RECENTE da conv (snapshot pós-resolve)
  app.get("/api/conversations/situation-tags-map", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const rows = await db.execute(sql`
        WITH cst_tags AS (
          SELECT cst.conversation_id, cst.situation_code AS code, cst.tag_slug AS slug
          FROM conversation_situation_tags cst
          WHERE cst.workspace_id = ${wsId}
        ),
        latest_proto AS (
          SELECT DISTINCT ON (conversation_id) conversation_id, tags
          FROM protocols
          WHERE workspace_id = ${wsId}
            AND tags IS NOT NULL
            AND array_length(tags, 1) > 0
          ORDER BY conversation_id, created_at DESC
        ),
        proto_tags AS (
          SELECT lp.conversation_id, t.code, t.code AS slug
          FROM latest_proto lp
          CROSS JOIN LATERAL unnest(lp.tags) AS t(code)
        )
        SELECT DISTINCT ON (conversation_id, situation_code) conversation_id, situation_code, tag_slug
        FROM (
          SELECT conversation_id, code AS situation_code, slug AS tag_slug FROM cst_tags
          UNION ALL
          SELECT conversation_id, code AS situation_code, slug AS tag_slug FROM proto_tags
        ) u
        ORDER BY conversation_id, situation_code, tag_slug
      `);
      const byConv: Record<string, { code: string; slug: string }[]> = {};
      for (const r of rows.rows as any[]) {
        const k = String(r.conversation_id);
        if (!byConv[k]) byConv[k] = [];
        byConv[k].push({ code: r.situation_code, slug: r.tag_slug });
      }
      res.json(byConv);
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[leads]") });
    }
  });

  app.get("/api/leads/situation-tags", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      // Bruno 2026-05-19: une CST (tags ao vivo) com protocols.tags (snapshot
      // por atendimento). Quando uma conv é resolvida, CST é zerada e as tags
      // ficam só no protocolo fechado — sem essa união, "Encerrados hoje"
      // perdia todos os badges S/F/C/AH/N1 nos cards. Snapshot lido do
      // PROTOCOLO MAIS RECENTE por conversa pra refletir o atendimento atual
      // (preserva isolamento por atendimento: não mistura tags de protocolos
      // antigos do mesmo cliente).
      const rows = await db.execute(sql`
        WITH cst_tags AS (
          SELECT c.telefone, cst.situation_code AS code, cst.tag_slug AS slug
          FROM conversation_situation_tags cst
          JOIN conversations c ON c.id = cst.conversation_id
          WHERE cst.workspace_id = ${wsId} AND c.telefone IS NOT NULL
        ),
        latest_proto AS (
          SELECT DISTINCT ON (conversation_id) conversation_id, tags
          FROM protocols
          WHERE workspace_id = ${wsId}
            AND tags IS NOT NULL
            AND array_length(tags, 1) > 0
          ORDER BY conversation_id, created_at DESC
        ),
        proto_tags AS (
          SELECT c.telefone, t.code, t.code AS slug
          FROM latest_proto lp
          JOIN conversations c ON c.id = lp.conversation_id
          CROSS JOIN LATERAL unnest(lp.tags) AS t(code)
          WHERE c.telefone IS NOT NULL
        )
        SELECT DISTINCT ON (telefone, situation_code) telefone, situation_code, tag_slug
        FROM (
          SELECT telefone, code AS situation_code, slug AS tag_slug FROM cst_tags
          UNION ALL
          SELECT telefone, code AS situation_code, slug AS tag_slug FROM proto_tags
        ) u
        -- Bruno 2026-05-19: DISTINCT ON (telefone, code) — antes era DISTINCT
        -- considerando slug, e a MESMA tag (ex: AH) vinha 2x quando aparecia em
        -- cst_tags (slug='atendimento-humano') E proto_tags (slug=código).
        -- Resultado no card: "AH AH S12 S12 +2" duplicado.
        -- Ordena por slug pra preferir cst_tags (slugs longos descritivos)
        -- quando há colisão de code entre as fontes.
        ORDER BY telefone, situation_code, tag_slug
      `);
      const byPhone: Record<string, { code: string; slug: string }[]> = {};
      for (const r of rows.rows as any[]) {
        if (!byPhone[r.telefone]) byPhone[r.telefone] = [];
        byPhone[r.telefone].push({ code: r.situation_code, slug: r.tag_slug });
      }
      res.json(byPhone);
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[leads]") });
    }
  });

  app.get("/api/leads/:id", requireAuthOrToken, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const lead = await storage.getLead(id, wsId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });

  app.post("/api/leads", requireAuthOrToken, requireScope("leads:write"), async (req, res) => {
    const parsed = insertLeadSchema.omit({ workspaceId: true }).safeParse(coerceValor({...req.body}));
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const wsId = await resolveWorkspaceId(req);
    const lead = await storage.createLead({ ...parsed.data, workspaceId: wsId });
    storage.createNotificacao({ tipo: "lead_criado", categoria: "Leads", titulo: "Novo lead criado", mensagem: `${lead.nome} foi adicionado ao pipeline`, link: "/pipeline", iconKey: "target", workspaceId: wsId }).catch(() => {});
    dispatchWebhook("lead.created", lead, wsId).catch(() => {});
    res.status(201).json(lead);
  });

  app.patch("/api/leads/:id", requireAuthOrToken, requireScope("leads:write"), async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const oldLead = await storage.getLead(id, wsId);
    // Auditoria 2026-06-19: .omit({workspaceId}) espelha o POST — sem isto o
    // corpo podia setar workspaceId e re-parentar o próprio lead pra outro tenant.
    const partial = insertLeadSchema.omit({ workspaceId: true }).partial().safeParse(coerceValor({...req.body}));
    if (!partial.success) return res.status(400).json({ message: partial.error.message });
    const lead = await storage.updateLead(id, partial.data, wsId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    // Bruno 2026-05-21: nome editado no lead precisa refletir no header do
    // chat da inbox. Propaga pra conversas com o mesmo telefone + broadcast.
    if (partial.data.nome && lead.telefone) {
      (async () => {
        try {
          const matchingConvs = await db.select({ id: conversations.id })
            .from(conversations)
            .where(and(
              eq(conversations.workspaceId, wsId),
              eq(conversations.telefone, lead!.telefone!)
            ));
          if (matchingConvs.length === 0) return;
          await db.update(conversations)
            .set({ nome: lead!.nome, updatedAt: new Date() })
            .where(and(
              eq(conversations.workspaceId, wsId),
              eq(conversations.telefone, lead!.telefone!)
            ));
          for (const c of matchingConvs) {
            broadcastToWorkspace(wsId, 'conversation_updated', {
              conversationId: c.id,
              nome: lead!.nome,
            });
          }
        } catch (err: any) {
          console.error('[LeadSync] Erro ao propagar nome pra conversations:', err.message);
        }
      })();
    }

    // Sincroniza pipelineEtapa das conversas vinculadas pelo telefone+pipeline (Kanban → Inbox)
    if (partial.data.status && lead.telefone && lead.pipeline) {
      (async () => {
        try {
          const leadPipelineLower = (lead!.pipeline || '').toLowerCase();
          const linkedConvs = await db.select({ id: conversations.id })
            .from(conversations)
            .where(and(
              eq(conversations.workspaceId, wsId),
              eq(conversations.telefone, lead!.telefone!),
              sql`LOWER(${conversations.pipeline}) = ${leadPipelineLower}`
            ));
          if (linkedConvs.length === 0) return;
          await db.update(conversations)
            .set({ pipelineEtapa: partial.data.status, pipeline: leadPipelineLower })
            .where(and(
              eq(conversations.workspaceId, wsId),
              eq(conversations.telefone, lead!.telefone!),
              sql`LOWER(${conversations.pipeline}) = ${leadPipelineLower}`
            ));
          for (const c of linkedConvs) {
            broadcastToWorkspace(wsId, 'conversation_updated', {
              conversationId: c.id,
              pipeline_etapa: partial.data.status,
            });
          }
        } catch (err: any) {
          console.error('[LeadSync] Erro ao sincronizar pipelineEtapa:', err.message);
        }
      })();
    }

    if (partial.data.status && oldLead && partial.data.status !== oldLead.status) {
      const fromPrefix = oldLead.status.replace(/_[a-f0-9]{8}$/, '');
      const toPrefix = partial.data.status.replace(/_[a-f0-9]{8}$/, '');
      const toLabel = STAGE_LABELS[toPrefix] || toPrefix;
      db.insert(leadStageHistory).values({
        leadId: id,
        conversationId: null,
        pipeline: lead!.pipeline || 'unknown',
        fromStage: fromPrefix,
        toStage: toPrefix,
        toStageLabel: toLabel,
        trigger: 'manual_move',
        workspaceId: wsId,
      }).catch((err: any) => console.error('[StageHistory] Manual move error:', err.message));

      // Quando card vai pra etapa FINALIZADO: arquiva o lead E fecha protocolos
      // vinculados. Também vale pras etapas terminais legadas
      // (resolvido/fechado/ativado/perdido/etc).
      // EXCEÇÃO (Bruno 2026-07-16): card ESTACIONADO numa coluna do funil
      // (display_column setado — ex.: arrastado pra Ganho/Perdido) NÃO é
      // arquivado — fica visível na coluna até o cliente iniciar novo ciclo.
      const finalPrefixes = /^(finalizado|resolvido|fechado|ativado|cliente_ativado|perdido|cliente_perdido|cancelado|inadimplente|escalado_noc|pago_regularizado|nao_resolvido)$/i;
      const isParkedOnFunnel = Boolean((lead as any).displayColumn);
      if (finalPrefixes.test(toPrefix) && !isParkedOnFunnel) {
        (async () => {
          try {
            // 1) Arquiva o lead — não aparece mais em listagens ativas.
            await db.update(leads).set({
              archivedAt: new Date(),
              archivalReason: `stage_final_${toPrefix}`,
            }).where(eq(leads.id, id));
            broadcastToWorkspace(wsId, 'lead_archived', {
              leadId: id,
              pipeline: lead!.pipeline || null,
              reason: `stage_final_${toPrefix}`,
            });
            console.log(`[LeadPatch] Lead #${id} arquivado (stage final: ${toPrefix})`);
          } catch (err: any) {
            console.error(`[LeadPatch] finalização erro:`, err.message);
          }
        })();
      }

      if (partial.data.status === "ganho") {
        storage.createNotificacao({ tipo: "lead_ganho", categoria: "Leads", titulo: "Lead ganho!", mensagem: `${lead!.nome} foi convertido com sucesso`, link: "/pipeline", iconKey: "check", workspaceId: wsId }).catch(() => {});
        dispatchWebhook("lead.won", lead, wsId).catch(() => {});
      } else if (partial.data.status === "perdido") {
        dispatchWebhook("lead.lost", lead, wsId).catch(() => {});
      } else {
        dispatchWebhook("deal.moved", { lead, de: oldLead.status, para: partial.data.status }, wsId).catch(() => {});
      }
    } else {
      dispatchWebhook("lead.updated", lead, wsId).catch(() => {});
    }
    res.json(lead);
  });

  app.delete("/api/leads/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    await storage.deleteLead(id, wsId);
    res.status(204).send();
  });

  app.get("/api/conversations/:id/situation-tags", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const convId = parseInt(((req.params.id as string) as string), 10);
      if (isNaN(convId)) return res.status(400).json({ message: "ID inválido" });
      const rows = await db.execute(sql`
        SELECT cst.id, cst.situation_code, cst.tag_slug, cst.origin, cst.created_at
        FROM conversation_situation_tags cst
        WHERE cst.workspace_id = ${wsId} AND cst.conversation_id = ${convId}
        ORDER BY cst.created_at DESC
      `);
      const tags = (rows.rows as any[]).map(r => ({
        id: r.id,
        code: r.situation_code,
        slug: r.tag_slug,
        origin: r.origin,
        createdAt: r.created_at,
      }));
      res.json(tags);
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[leads]") });
    }
  });

  app.get("/api/lead-tags", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const tags = await storage.getLeadTags(wsId);
    res.json(tags);
  });

  app.post("/api/lead-tags", requireAuth, async (req, res) => {
    const parsed = insertLeadTagSchema.omit({ workspaceId: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    try {
      const tag = await storage.createLeadTag({ ...parsed.data, workspaceId: await resolveWorkspaceId(req) });
      res.status(201).json(tag);
    } catch (e: any) {
      if (e.message?.includes("duplicate")) {
        return res.status(409).json({ message: "Tag ja existe" });
      }
      res.status(500).json({ message: safeErr(e, "[leads]") });
    }
  });

  app.patch("/api/lead-tags/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    // Auditoria 2026-06-19: validar com Zod + omitir workspaceId — antes o PATCH
    // gravava req.body CRU (mass-assignment de workspaceId/colunas) no banco.
    const parsed = insertLeadTagSchema.omit({ workspaceId: true }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    try {
      const wsId = await resolveWorkspaceId(req);
      const tag = await storage.updateLeadTag(id, parsed.data, wsId);
      res.json(tag);
    } catch (e: any) {
      if (e.message?.includes("duplicate")) {
        return res.status(409).json({ message: "Tag ja existe" });
      }
      res.status(500).json({ message: safeErr(e, "[leads]") });
    }
  });

  app.delete("/api/lead-tags/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    await storage.deleteLeadTag(id, wsId);
    res.status(204).send();
  });

  app.get("/api/leads/:id/stage-history", requireAuthOrToken, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const rows = await db
      .select()
      .from(leadStageHistory)
      .where(and(eq(leadStageHistory.leadId, id), eq(leadStageHistory.workspaceId, wsId)))
      .orderBy(desc(leadStageHistory.createdAt))
      .limit(50);
    res.json({ ok: true, data: rows });
  });
}
