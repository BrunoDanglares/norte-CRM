import { Router } from "express";
import { db } from "../db";
import {
  conversations,
  protocols,
  conversationSituationTags,
  leads,
  leadStageHistory,
} from "../../shared/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId } from "../utils/helpers";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { limit = "50", offset = "0" } = req.query;

    const convRows = await db
      .select({
        conversationId:     conversations.id,
        contactName:        conversations.nome,
        contactPhone:       conversations.telefone,
        pipeline:           conversations.pipeline,
        resolvedAt:         conversations.resolvedAt,
        agentName:          conversations.agente,
        assignedUserName:   conversations.assignedUserName,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.status, "resolved")
        )
      )
      .orderBy(desc(conversations.resolvedAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    const rows = await Promise.all(convRows.map(async (conv) => {
      let protocolNumber: string | null = null;
      if (conv.contactPhone) {
        const [proto] = await db
          .select({ numero: protocols.numero })
          .from(protocols)
          .where(and(eq(protocols.conversationId, conv.conversationId), eq(protocols.workspaceId, workspaceId)))
          .limit(1);
        if (proto) protocolNumber = proto.numero;
      }

      let leadStage: string | null = null;
      let leadArchivedAt: Date | null = null;
      let leadArchivalReason: string | null = null;
      if (conv.contactPhone) {
        const [lead] = await db
          .select({
            stage: leads.status,
            archivedAt: leads.archivedAt,
            archivalReason: leads.archivalReason,
          })
          .from(leads)
          .where(and(eq(leads.telefone, conv.contactPhone), eq(leads.workspaceId, workspaceId)))
          .limit(1);
        if (lead) {
          leadStage = lead.stage;
          leadArchivedAt = lead.archivedAt;
          leadArchivalReason = lead.archivalReason;
        }
      }

      return {
        ...conv,
        protocolNumber,
        leadStage,
        leadArchivedAt,
        leadArchivalReason,
      };
    }));

    const conversationIds = rows.map((r) => r.conversationId);
    const tagsMap: Record<number, any[]> = {};

    if (conversationIds.length > 0) {
      const allTags = await db
        .select()
        .from(conversationSituationTags)
        .where(
          and(
            eq(conversationSituationTags.workspaceId, workspaceId),
            sql`${conversationSituationTags.conversationId} = ANY(${sql.raw(
              `ARRAY[${conversationIds.join(",")}]`
            )})`
          )
        );

      for (const tag of allTags) {
        if (!tagsMap[tag.conversationId]) tagsMap[tag.conversationId] = [];
        tagsMap[tag.conversationId].push(tag);
      }
    }

    const result = rows.map((row) => ({
      ...row,
      tags: tagsMap[row.conversationId] || [],
    }));

    res.json({ data: result, total: result.length });
  } catch (error) {
    console.error("[History] Erro:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/metrics", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);

    const fromParam = ((req.query.from as string | undefined) as string | undefined) as string | undefined;
    const toParam = ((req.query.to as string | undefined) as string | undefined) as string | undefined;
    const daysParam = parseInt(((req.query.days as string | undefined) as string | undefined) as string) || 30;

    let since: Date;
    let until: Date = new Date();

    if (fromParam && toParam) {
      since = new Date(fromParam);
      since.setHours(0, 0, 0, 0);
      until = new Date(toParam);
      until.setHours(23, 59, 59, 999);
    } else {
      const d = Math.min(daysParam, 180);
      since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
      since.setHours(0, 0, 0, 0);
    }

    const [totalResolved] = await db
      .select({ count: sql<number>`count(*)` })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.status, "resolved"),
          gte(conversations.createdAt, since),
          lte(conversations.createdAt, until)
        )
      );

    const topTags = await db
      .select({
        tagSlug: conversationSituationTags.tagSlug,
        count:   sql<number>`count(*)`,
      })
      .from(conversationSituationTags)
      .where(
        and(
          eq(conversationSituationTags.workspaceId, workspaceId),
          gte(conversationSituationTags.createdAt, since),
          lte(conversationSituationTags.createdAt, until)
        )
      )
      .groupBy(conversationSituationTags.tagSlug)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    const [ativados] = await db
      .select({ count: sql<number>`count(*)` })
      .from(leads)
      .where(
        and(
          eq(leads.workspaceId, workspaceId),
          eq(leads.archivalReason, "ativado"),
          gte(leads.archivedAt, since),
          lte(leads.archivedAt, until)
        )
      );

    const [perdidos] = await db
      .select({ count: sql<number>`count(*)` })
      .from(leads)
      .where(
        and(
          eq(leads.workspaceId, workspaceId),
          eq(leads.archivalReason, "perdido"),
          gte(leads.archivedAt, since),
          lte(leads.archivedAt, until)
        )
      );

    const byPipeline = await db
      .select({
        pipeline: leads.pipeline,
        reason:   leads.archivalReason,
        count:    sql<number>`count(*)`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.workspaceId, workspaceId),
          sql`${leads.archivedAt} IS NOT NULL`,
          gte(leads.archivedAt, since),
          lte(leads.archivedAt, until)
        )
      )
      .groupBy(leads.pipeline, leads.archivalReason);

    res.json({
      totalResolved: Number(totalResolved?.count || 0),
      ativados:      Number(ativados?.count || 0),
      perdidos:      Number(perdidos?.count || 0),
      topTags,
      byPipeline,
    });
  } catch (error) {
    console.error("[History] Métricas erro:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/conversations/:id/tags", requireAuth, async (req, res) => {
  try {
    const workspaceId    = await resolveWorkspaceId(req);
    const conversationId = parseInt(((req.params.id as string) as string));
    const { situationCode } = req.body;
    const userId = (req as any).user?.id;

    void workspaceId; void conversationId; void situationCode; void userId;
    // ISP removido: aplicação de tags de situação (S/F/C) desativada.

    res.json({ success: true });
  } catch (error: any) {
    // Auditoria 2026-06-20: detalhe interno só no log; resposta genérica.
    console.error("[history] applyManualTag erro:", error?.message);
    res.status(400).json({ error: "Não foi possível aplicar a tag" });
  }
});

router.delete("/conversations/:id/tags/:tagId", requireAuth, async (req, res) => {
  try {
    const conversationId = parseInt(((req.params.id as string) as string));
    const tagId          = parseInt(((req.params.tagId as string) as string));
    const wsId = await resolveWorkspaceId(req);

    void conversationId; void tagId; void wsId;
    // ISP removido: remoção de tags de situação (S/F/C) desativada.

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/leads/:id/archive", requireAuth, async (req, res) => {
  try {
    const leadId = parseInt(((req.params.id as string) as string));
    const { reason } = req.body as { reason: "ativado" | "perdido" };
    const wsId = await resolveWorkspaceId(req);

    const { archiveLead } = await import("../services/kanbanArchivalService");
    await archiveLead(leadId, reason, wsId);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/lead/:leadId/stages", requireAuth, async (req, res) => {
  try {
    const leadId = parseInt(((req.params.leadId as string) as string));
    if (isNaN(leadId)) return res.status(400).json({ error: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);

    const history = await db
      .select()
      .from(leadStageHistory)
      .where(and(eq(leadStageHistory.leadId, leadId), eq(leadStageHistory.workspaceId, wsId)))
      .orderBy(desc(leadStageHistory.createdAt));

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/conversation/:convId/stages", requireAuth, async (req, res) => {
  try {
    const convId = parseInt(((req.params.convId as string) as string));
    if (isNaN(convId)) return res.status(400).json({ error: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);

    const history = await db
      .select()
      .from(leadStageHistory)
      .where(and(eq(leadStageHistory.conversationId, convId), eq(leadStageHistory.workspaceId, wsId)))
      .orderBy(desc(leadStageHistory.createdAt));

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
