import { Router } from "express";
import { db } from "../db";
import { instaProspectFlows, instaProspectSessions } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId } from "../utils/helpers";

const router = Router();

router.get("/flows", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const flows = await db
      .select()
      .from(instaProspectFlows)
      .where(eq(instaProspectFlows.workspaceId, workspaceId))
      .orderBy(desc(instaProspectFlows.createdAt));
    res.json(flows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar fluxos" });
  }
});

router.post("/flows", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const {
      nome, tipo, keyword, keywordMatchType, postId,
      publicReply, firstMessage,
      aiPersona, aiSystemPrompt, aiObjective,
      finalAction, assignStrategy, autoTags, delaySeconds,
      commentEnabled, dmEnabled, storyEnabled,
      dmKeyword, dmKeywordMatchType, storyFirstMessage,
    } = req.body;

    if (!nome || !aiSystemPrompt) {
      return res.status(400).json({ error: "nome e aiSystemPrompt sao obrigatorios" });
    }

    if (!commentEnabled && !dmEnabled && !storyEnabled) {
      return res.status(400).json({ error: "Ative pelo menos uma funcionalidade (comentario, DM ou Stories)" });
    }
    const inferredTipo = commentEnabled ? "comment_to_dm" : dmEnabled ? "dm_received" : "story_mention";

    const values: Record<string, any> = {
      workspaceId, nome, tipo: inferredTipo, aiSystemPrompt,
      autoTags: autoTags || [],
      commentEnabled: !!commentEnabled,
      dmEnabled: !!dmEnabled,
      storyEnabled: !!storyEnabled,
    };
    if (keyword !== undefined) values.keyword = typeof keyword === "string" ? keyword.trim() : keyword;
    if (keywordMatchType !== undefined) values.keywordMatchType = keywordMatchType;
    if (dmKeyword !== undefined) values.dmKeyword = typeof dmKeyword === "string" ? dmKeyword.trim() : dmKeyword;
    if (dmKeywordMatchType !== undefined) values.dmKeywordMatchType = dmKeywordMatchType;
    if (storyFirstMessage !== undefined) values.storyFirstMessage = storyFirstMessage;
    if (postId !== undefined) values.postId = postId;
    if (publicReply !== undefined) values.publicReply = publicReply;
    if (req.body.commentReplyMode !== undefined) values.commentReplyMode = ["static", "ai"].includes(req.body.commentReplyMode) ? req.body.commentReplyMode : "static";
    if (req.body.commentAiPrompt !== undefined) values.commentAiPrompt = req.body.commentAiPrompt;
    if (req.body.postContext !== undefined) values.postContext = req.body.postContext;
    if (firstMessage !== undefined) values.firstMessage = firstMessage;
    if (req.body.firstMessageMediaUrl !== undefined) values.firstMessageMediaUrl = req.body.firstMessageMediaUrl;
    if (req.body.firstMessageMediaType !== undefined) values.firstMessageMediaType = req.body.firstMessageMediaType;
    if (aiPersona !== undefined) values.aiPersona = aiPersona;
    if (aiObjective !== undefined) values.aiObjective = aiObjective;
    const VALID_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
    if (req.body.aiModel !== undefined) values.aiModel = VALID_MODELS.includes(req.body.aiModel) ? req.body.aiModel : "gpt-4o-mini";
    if (req.body.aiTemperature !== undefined) values.aiTemperature = Math.max(0, Math.min(2, Number(req.body.aiTemperature) || 0.7));
    if (req.body.aiMaxTokens !== undefined) values.aiMaxTokens = Math.max(50, Math.min(2000, Number(req.body.aiMaxTokens) || 300));
    if (finalAction !== undefined) values.finalAction = finalAction;
    if (assignStrategy !== undefined) values.assignStrategy = assignStrategy;
    if (delaySeconds !== undefined) values.delaySeconds = Math.max(0, Math.min(120, Number(delaySeconds) || 0));

    const [flow] = await db.insert(instaProspectFlows).values(values as any).returning();

    res.json(flow);
  } catch (err: any) {
    console.error("[InstaProspect] Erro ao criar fluxo:", err.message, err.stack);
    res.status(500).json({ error: "Erro ao criar fluxo" });
  }
});

router.patch("/flows/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const allowed = [
      "nome", "tipo", "keyword", "keywordMatchType", "postId",
      "publicReply", "commentReplyMode", "commentAiPrompt", "postContext",
      "firstMessage",
      "firstMessageMediaUrl", "firstMessageMediaType",
      "aiPersona", "aiSystemPrompt", "aiObjective",
      "aiModel", "aiTemperature", "aiMaxTokens",
      "finalAction", "assignStrategy", "autoTags", "delaySeconds",
      "commentEnabled", "dmEnabled", "storyEnabled",
      "dmKeyword", "dmKeywordMatchType", "storyFirstMessage",
    ] as const;
    const VALID_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (key === "tipo") continue;
      if (req.body[key] === undefined) continue;
      if (key === "aiTemperature") {
        updates[key] = Math.max(0, Math.min(2, Number(req.body[key]) || 0.7));
      } else if (key === "aiMaxTokens") {
        updates[key] = Math.max(50, Math.min(2000, Number(req.body[key]) || 300));
      } else if (key === "aiModel") {
        updates[key] = VALID_MODELS.includes(req.body[key]) ? req.body[key] : "gpt-4o-mini";
      } else if (key === "delaySeconds") {
        updates[key] = Math.max(0, Math.min(120, Number(req.body[key]) || 0));
      } else {
        updates[key] = req.body[key];
      }
    }
    if (req.body.commentEnabled !== undefined || req.body.dmEnabled !== undefined || req.body.storyEnabled !== undefined) {
      const ce = !!req.body.commentEnabled;
      const de = !!req.body.dmEnabled;
      const se = !!req.body.storyEnabled;
      updates.tipo = ce ? "comment_to_dm" : de ? "dm_received" : se ? "story_mention" : "comment_to_dm";
    }
    const [flow] = await db
      .update(instaProspectFlows)
      .set(updates)
      .where(and(
        eq(instaProspectFlows.id, (req.params.id as string)),
        eq(instaProspectFlows.workspaceId, workspaceId)
      ))
      .returning();
    res.json(flow);
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar fluxo" });
  }
});

router.patch("/flows/:id/toggle", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [current] = await db
      .select()
      .from(instaProspectFlows)
      .where(and(
        eq(instaProspectFlows.id, (req.params.id as string)),
        eq(instaProspectFlows.workspaceId, workspaceId)
      ))
      .limit(1);

    if (!current) return res.status(404).json({ error: "Fluxo nao encontrado" });

    const [updated] = await db
      .update(instaProspectFlows)
      .set({ ativo: !current.ativo, updatedAt: new Date() })
      .where(eq(instaProspectFlows.id, (req.params.id as string)))
      .returning();

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Erro ao alternar fluxo" });
  }
});

router.delete("/flows/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    await db.delete(instaProspectFlows).where(and(
      eq(instaProspectFlows.id, (req.params.id as string)),
      eq(instaProspectFlows.workspaceId, workspaceId)
    ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao deletar fluxo" });
  }
});

router.post("/flows/:id/duplicate", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [original] = await db
      .select()
      .from(instaProspectFlows)
      .where(and(
        eq(instaProspectFlows.id, (req.params.id as string)),
        eq(instaProspectFlows.workspaceId, workspaceId)
      ))
      .limit(1);
    if (!original) return res.status(404).json({ error: "Fluxo nao encontrado" });

    const [dup] = await db.insert(instaProspectFlows).values({
      workspaceId,
      nome: `${original.nome} (copia)`,
      keyword: original.keyword,
      keywordMatchType: original.keywordMatchType,
      dmKeyword: original.dmKeyword,
      dmKeywordMatchType: original.dmKeywordMatchType,
      commentEnabled: original.commentEnabled,
      dmEnabled: original.dmEnabled,
      storyEnabled: original.storyEnabled,
      tipo: original.tipo,
      postId: original.postId,
      publicReply: original.publicReply,
      commentReplyMode: original.commentReplyMode,
      commentAiPrompt: original.commentAiPrompt,
      postContext: original.postContext,
      firstMessage: original.firstMessage,
      storyFirstMessage: original.storyFirstMessage,
      firstMessageMediaUrl: original.firstMessageMediaUrl,
      firstMessageMediaType: original.firstMessageMediaType,
      aiSystemPrompt: original.aiSystemPrompt,
      aiPersona: original.aiPersona,
      aiObjective: original.aiObjective,
      aiModel: original.aiModel,
      aiTemperature: original.aiTemperature,
      aiMaxTokens: original.aiMaxTokens,
      finalAction: original.finalAction,
      assignStrategy: original.assignStrategy,
      autoTags: original.autoTags,
      delaySeconds: original.delaySeconds,
      ativo: false,
    }).returning();
    res.json(dup);
  } catch (err) {
    res.status(500).json({ error: "Erro ao duplicar fluxo" });
  }
});

router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const sessions = await db
      .select()
      .from(instaProspectSessions)
      .where(eq(instaProspectSessions.workspaceId, workspaceId))
      .orderBy(desc(instaProspectSessions.updatedAt))
      .limit(50);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: "Erro ao listar sessoes" });
  }
});

router.get("/stats", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);

    const [totals] = await db
      .select({
        totalFlows: sql<number>`count(distinct ${instaProspectFlows.id})`,
        activeFlows: sql<number>`count(distinct case when ${instaProspectFlows.ativo} = true then ${instaProspectFlows.id} end)`,
        totalTriggers: sql<number>`coalesce(sum(${instaProspectFlows.totalTriggers}), 0)`,
        totalLeads: sql<number>`coalesce(sum(${instaProspectFlows.totalLeads}), 0)`,
        totalConverted: sql<number>`coalesce(sum(${instaProspectFlows.totalConverted}), 0)`,
      })
      .from(instaProspectFlows)
      .where(eq(instaProspectFlows.workspaceId, workspaceId));

    const [sessionStats] = await db
      .select({
        emAndamento: sql<number>`count(*) filter (where ${instaProspectSessions.status} = 'em_andamento')`,
        qualificados: sql<number>`count(*) filter (where ${instaProspectSessions.status} = 'qualificado')`,
        transferidos: sql<number>`count(*) filter (where ${instaProspectSessions.status} = 'transferido')`,
      })
      .from(instaProspectSessions)
      .where(eq(instaProspectSessions.workspaceId, workspaceId));

    res.json({ ...totals, ...sessionStats });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar stats" });
  }
});

export default router;
