import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId, safeErr } from "../utils/helpers";
import { broadcastToWorkspace } from '../services/broadcast';
import { db } from "../db";
import { whatsappMessageTemplates, whatsappOfficialConnections, insertPesquisaSatisfacaoSchema, insertRespostaPesquisaSchema } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function registerCampanhaRoutes(app: Express) {
  app.get("/api/campanhas", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); const all = await storage.getCampanhas(wsId); res.json({ ok: true, data: all }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/campanhas/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const c = await storage.getCampanha(id, wsId);
      if (!c) return res.status(404).json({ ok: false, error: "Campanha nao encontrada" });
      res.json({ ok: true, data: c });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/campanhas", requireAuth, async (req, res) => {
    try {
      const { nome, channel, template, status, total, audienceType, ratePerMinute, batchSize, delayMs, scheduledAt, connectionId } = req.body;
      if (!nome) return res.status(400).json({ ok: false, error: "Nome obrigatorio" });
      const data: any = { nome, channel: channel || "whatsapp", template, status: status || "draft", total: total || 0, audienceType, ratePerMinute, batchSize, delayMs, connectionId: connectionId || null, workspaceId: await resolveWorkspaceId(req) };
      if (scheduledAt) data.scheduledAt = new Date(scheduledAt);
      const created = await storage.createCampanha(data);
      res.status(201).json({ ok: true, data: created });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.patch("/api/campanhas/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const updates: any = {};
      const allowed = ["nome", "channel", "template", "status", "total", "sent", "read", "replies", "failed", "audienceType", "ratePerMinute", "batchSize", "delayMs", "scheduledAt", "connectionId"];
      for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = k === "scheduledAt" && req.body[k] ? new Date(req.body[k]) : req.body[k]; }
      const wsId = await resolveWorkspaceId(req);
      const updated = await storage.updateCampanha(id, updates, wsId);
      if (!updated) return res.status(404).json({ ok: false, error: "Campanha nao encontrada" });
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/campanhas/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      await storage.deleteCampanha(id, wsId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/respostas-rapidas", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      await storage.ensureDefaultQuickReplies(wsId);
      await storage.ensureDefaultSurvey(wsId);
      const items = await storage.getRespostasRapidas(wsId);
      res.json({ ok: true, data: items });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/respostas-rapidas", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const { titulo, texto, categoria, atalho, ordem, ativo, tipoMidia, arquivoUrl, arquivoNome } = req.body;
      if (!titulo || !texto) return res.status(400).json({ ok: false, error: "Titulo e texto sao obrigatorios" });
      const item = await storage.createRespostaRapida({ titulo, texto, categoria: categoria || null, atalho: atalho || null, ordem: ordem ?? 0, ativo: ativo !== false, tipoMidia: tipoMidia || null, arquivoUrl: arquivoUrl || null, arquivoNome: arquivoNome || null, workspaceId: wsId });
      res.json({ ok: true, data: item });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.patch("/api/respostas-rapidas/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const { titulo, texto, categoria, atalho, ordem, ativo, tipoMidia, arquivoUrl, arquivoNome } = req.body;
      const safeData: Record<string, any> = {};
      if (titulo !== undefined) safeData.titulo = titulo; if (texto !== undefined) safeData.texto = texto;
      if (categoria !== undefined) safeData.categoria = categoria; if (atalho !== undefined) safeData.atalho = atalho;
      if (ordem !== undefined) safeData.ordem = ordem; if (ativo !== undefined) safeData.ativo = ativo;
      if (tipoMidia !== undefined) safeData.tipoMidia = tipoMidia; if (arquivoUrl !== undefined) safeData.arquivoUrl = arquivoUrl;
      if (arquivoNome !== undefined) safeData.arquivoNome = arquivoNome;
      const updated = await storage.updateRespostaRapida(id, safeData, wsId);
      if (!updated) return res.status(404).json({ ok: false, error: "Nao encontrado" });
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/respostas-rapidas/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const existing = await storage.getRespostaRapida(id, wsId);
      if (existing && existing.categoria === "Pesquisa" && existing.ordem === -1) return res.status(403).json({ ok: false, error: "Resposta do sistema nao pode ser excluida" });
      await storage.deleteRespostaRapida(id, wsId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/pesquisas-satisfacao", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); await storage.ensureDefaultSurvey(wsId); const data = await storage.getPesquisasSatisfacao(wsId); res.json({ ok: true, data }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/pesquisas-satisfacao", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      // valida o body e BLOQUEIA mass-assignment de workspaceId/sistema
      // (sistema=true cria pesquisa do sistema = indelével; só ensureDefaultSurvey deve setar)
      const parsed = insertPesquisaSatisfacaoSchema.omit({ workspaceId: true, sistema: true }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
      const data = await storage.createPesquisaSatisfacao({ ...parsed.data, workspaceId: wsId });
      res.json({ ok: true, data });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.patch("/api/pesquisas-satisfacao/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const existing = await storage.getPesquisaSatisfacao(id, wsId);
      if (!existing) return res.status(404).json({ ok: false, error: "Pesquisa nao encontrada" });
      // valida e BLOQUEIA mass-assignment de workspaceId/sistema no update (sistema=true → indelével)
      const parsed = insertPesquisaSatisfacaoSchema.omit({ workspaceId: true, sistema: true }).partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
      // pesquisa do sistema: titulo também é fixo
      const { titulo, ...rest } = parsed.data;
      const allowedUpdates = existing.sistema ? rest : parsed.data;
      const data = await storage.updatePesquisaSatisfacao(id, allowedUpdates, wsId);
      res.json({ ok: true, data });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/pesquisas-satisfacao/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const existing = await storage.getPesquisaSatisfacao(id, wsId);
      if (!existing) return res.status(404).json({ ok: false, error: "Pesquisa nao encontrada" });
      if (existing.sistema) return res.status(403).json({ ok: false, error: "Pesquisa do sistema nao pode ser excluida" });
      await storage.deletePesquisaSatisfacao(id, wsId);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/pesquisas-satisfacao/:id/resposta", requireAuth, async (req, res) => {
    try {
      const pesquisaId = parseInt(((req.params.id as string) as string)); if (isNaN(pesquisaId)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const pesquisa = await storage.getPesquisaSatisfacao(pesquisaId, wsId);
      if (!pesquisa) return res.status(404).json({ ok: false, error: "Pesquisa nao encontrada" });
      // valida o body (resposta/nota/etc) — workspaceId e pesquisaId são server-set, não vêm do body
      const parsed = insertRespostaPesquisaSchema.omit({ workspaceId: true, pesquisaId: true }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
      const data = await storage.createRespostaPesquisa({ ...parsed.data, pesquisaId, workspaceId: wsId });
      res.json({ ok: true, data });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/pesquisas-satisfacao/:id/respostas", requireAuth, async (req, res) => {
    try {
      const pesquisaId = parseInt(((req.params.id as string) as string)); if (isNaN(pesquisaId)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const data = await storage.getRespostasPesquisa(wsId, pesquisaId);
      res.json({ ok: true, data });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); const stats = await storage.getDashboardStats(wsId); res.json({ ok: true, data: stats }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/anotacoes", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const leadId = ((req.query.leadId as string | undefined) as string | undefined) ? parseInt(((req.query.leadId as string | undefined) as string | undefined) as string) : undefined;
      const conversationId = ((req.query.conversationId as string | undefined) as string | undefined) ? parseInt(((req.query.conversationId as string | undefined) as string | undefined) as string) : undefined;
      const data = await storage.getAnotacoes(wsId, { leadId, conversationId });
      res.json({ ok: true, data });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/anotacoes", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const userId = (req as any).user?.id;
      const userName = (req as any).user?.nome || "Usuario";
      const { conteudo, leadId, conversationId } = req.body;
      if (!conteudo || conteudo.trim().length === 0) return res.status(400).json({ ok: false, error: "Conteudo obrigatorio" });
      if (leadId) { const lead = await storage.getLead(leadId, wsId); if (!lead) return res.status(404).json({ ok: false, error: "Lead nao encontrado neste workspace" }); }
      if (conversationId) { const conv = await storage.getConversation(conversationId, wsId); if (!conv) return res.status(404).json({ ok: false, error: "Conversa nao encontrada neste workspace" }); }
      const nota = await storage.createAnotacao({ conteudo: conteudo.trim(), leadId: leadId || null, conversationId: conversationId || null, criadoPor: userId || null, criadoPorNome: userName, workspaceId: wsId });
      res.json({ ok: true, data: nota });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.patch("/api/anotacoes/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const wsId = await resolveWorkspaceId(req);
      const { conteudo } = req.body;
      if (!conteudo || conteudo.trim().length === 0) return res.status(400).json({ ok: false, error: "Conteudo obrigatorio" });
      const nota = await storage.updateAnotacao(id, { conteudo: conteudo.trim() }, wsId);
      if (!nota) return res.status(404).json({ ok: false, error: "Anotacao nao encontrada" });
      res.json({ ok: true, data: nota });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/anotacoes/:id", requireAuth, async (req, res) => {
    try { const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" }); const wsId = await resolveWorkspaceId(req); await storage.deleteAnotacao(id, wsId); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  // Bruno 2026-05-21: mensagem interna agora é o canal admin↔atendente atribuído.
  // Visibilidade: só admin/manager do workspace OU o atendente atribuído à conv.
  // Outros atendentes (mesmo do mesmo time) NÃO veem nem enviam.
  const INTERNAL_MANAGER_ROLES = ["admin", "superadmin", "manager", "gerente", "Gerente"];
  function canAccessInternalChat(req: any, conv: any) {
    const userId = req.user?.id;
    const role = req.user?.role ?? "";
    if (INTERNAL_MANAGER_ROLES.includes(role)) return true;
    if (userId && conv?.assignedUserId === userId) return true;
    return false;
  }

  app.get("/api/chat-interno/:conversationId", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conversationId = parseInt(((req.params.conversationId as string) as string));
      if (isNaN(conversationId)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const conv = await storage.getConversation(conversationId, wsId);
      if (!conv) return res.status(404).json({ ok: false, error: "Conversa nao encontrada" });
      if (!canAccessInternalChat(req, conv)) {
        return res.status(403).json({ ok: false, error: "Sem permissao para mensagens internas desta conversa" });
      }
      const { db: dbConn } = await import("../db");
      const { chatInterno } = await import("@shared/schema");
      const { eq, and, asc } = await import("drizzle-orm");
      const msgs = await dbConn.select().from(chatInterno).where(and(eq(chatInterno.conversationId, conversationId), eq(chatInterno.workspaceId, wsId))).orderBy(asc(chatInterno.createdAt));
      res.json({ ok: true, data: msgs });
    } catch (e: any) { console.error("chat-interno GET error:", e); res.status(500).json({ ok: false, error: "Erro ao buscar mensagens internas" }); }
  });

  app.post("/api/chat-interno/:conversationId", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conversationId = parseInt(((req.params.conversationId as string) as string));
      if (isNaN(conversationId)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const conv = await storage.getConversation(conversationId, wsId);
      if (!conv) return res.status(404).json({ ok: false, error: "Conversa nao encontrada" });
      if (!canAccessInternalChat(req, conv)) {
        return res.status(403).json({ ok: false, error: "Sem permissao para enviar mensagem interna nesta conversa" });
      }
      const userId = (req as any).user?.id;
      const userName = ((req as any).user?.nome || "Usuario").toString().trim().replace(/\s+/g, " ");
      const userAvatar = (req as any).user?.avatarUrl || (req as any).user?.avatar || null;
      const { texto, targetUserId: rawTargetUserId } = req.body;
      if (!texto || texto.trim().length === 0) return res.status(400).json({ ok: false, error: "Texto obrigatorio" });
      const targetUserId = rawTargetUserId ? parseInt(rawTargetUserId) : null;
      const { db: dbConn } = await import("../db");
      const { chatInterno } = await import("@shared/schema");
      const [msg] = await dbConn.insert(chatInterno).values({ conversationId, userId, userName, userAvatar, texto: texto.trim(), targetUserId, workspaceId: wsId }).returning();
      try { broadcastToWorkspace(wsId, "chat_interno_new", { conversationId, message: msg }); } catch (e) { console.error("[Campanhas] Failed to broadcast chat message:", e); }
      res.json({ ok: true, data: msg });
    } catch (e: any) { console.error("chat-interno POST error:", e); res.status(500).json({ ok: false, error: "Erro ao enviar mensagem interna" }); }
  });

  app.delete("/api/chat-interno/:id", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const id = parseInt(((req.params.id as string) as string)); if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" });
      const { db: dbConn } = await import("../db");
      const { chatInterno } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      // Permissão: admin OR autor da mensagem
      const [existing] = await dbConn.select().from(chatInterno).where(and(eq(chatInterno.id, id), eq(chatInterno.workspaceId, wsId))).limit(1);
      if (!existing) return res.status(404).json({ ok: false, error: "Mensagem nao encontrada" });
      const role = (req as any).user?.role ?? "";
      const userId = (req as any).user?.id;
      const isAuthor = existing.userId === userId;
      const isManager = INTERNAL_MANAGER_ROLES.includes(role);
      if (!isAuthor && !isManager) {
        return res.status(403).json({ ok: false, error: "Sem permissao para apagar esta mensagem" });
      }
      await dbConn.delete(chatInterno).where(and(eq(chatInterno.id, id), eq(chatInterno.workspaceId, wsId)));
      res.json({ ok: true });
    } catch (e: any) { console.error("chat-interno DELETE error:", e); res.status(500).json({ ok: false, error: "Erro ao apagar mensagem interna" }); }
  });

  app.get("/api/ia/prompts", requireAuth, async (_req, res) => { const prompts = await storage.getIaPrompts(); res.json({ ok: true, data: prompts }); });

  app.get("/api/ia/prompts/by-slug/:slug", requireAuth, async (req, res) => {
    const prompt = await storage.getIaPromptBySlug(((req.params.slug as string) as string));
    if (!prompt) return res.status(404).json({ ok: false, error: "Prompt nao encontrado" });
    res.json({ ok: true, data: { slug: prompt.slug, nome: prompt.nome, prompt: prompt.prompt, modelo: prompt.modelo, temperatura: prompt.temperatura, max_tokens: prompt.maxTokens, versao: prompt.versao, updated_at: prompt.updatedAt } });
  });

  app.get("/api/ia/prompts/:id", requireAuth, async (req, res) => {
    const prompt = await storage.getIaPrompt(((req.params.id as string) as string));
    if (!prompt) return res.status(404).json({ ok: false, error: "Prompt nao encontrado" });
    res.json({ ok: true, data: prompt });
  });

  app.post("/api/ia/prompts", requireAuth, async (req, res) => {
    try {
      // Bruno 2026-06-18 (auditoria): prompts de IA são GLOBAIS (afetam o automationEngine
      // de todos os tenants) — só admin pode criar/editar/remover, não qualquer atendente.
      if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "Apenas admin pode gerenciar prompts de IA" });
      const { slug, nome, descricao, prompt, modelo, temperatura, max_tokens } = req.body;
      if (!slug || !nome || !prompt) return res.status(400).json({ ok: false, error: "slug, nome e prompt sao obrigatorios" });
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ ok: false, error: "slug deve conter apenas letras minusculas, numeros e hifens" });
      const existing = await storage.getIaPromptBySlug(slug);
      if (existing) return res.status(409).json({ ok: false, error: "Slug ja existe" });
      const created = await storage.createIaPrompt({ slug, nome, descricao: descricao || null, prompt, modelo: modelo || "gpt-4o-mini", temperatura: temperatura !== undefined ? String(temperatura) : "0.70", maxTokens: max_tokens || 1000, updatedBy: req.user?.id } as any);
      res.status(201).json({ ok: true, data: created });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.put("/api/ia/prompts/:id", requireAuth, async (req, res) => {
    try {
      if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "Apenas admin pode gerenciar prompts de IA" });
      const current = await storage.getIaPrompt(((req.params.id as string) as string));
      if (!current) return res.status(404).json({ ok: false, error: "Prompt nao encontrado" });
      await storage.createIaPromptHistorico({ promptId: current.id, promptAnterior: current.prompt, editadoPor: req.user?.id || null, versao: current.versao || 1 } as any);
      const { nome, descricao, prompt, modelo, temperatura, max_tokens, ativo } = req.body;
      const data: any = { versao: (current.versao || 1) + 1, updatedBy: req.user?.id };
      if (nome !== undefined) data.nome = nome; if (descricao !== undefined) data.descricao = descricao;
      if (prompt !== undefined) data.prompt = prompt; if (modelo !== undefined) data.modelo = modelo;
      if (temperatura !== undefined) data.temperatura = String(temperatura); if (max_tokens !== undefined) data.maxTokens = max_tokens;
      if (ativo !== undefined) data.ativo = ativo;
      const updated = await storage.updateIaPrompt(((req.params.id as string) as string), data);
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/ia/prompts/:id/historico", requireAuth, async (req, res) => {
    const historico = await storage.getIaPromptHistorico(((req.params.id as string) as string));
    res.json({ ok: true, data: historico });
  });

  app.post("/api/ia/prompts/:id/restaurar/:versao", requireAuth, async (req, res) => {
    try {
      if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "Apenas admin pode gerenciar prompts de IA" });
      const current = await storage.getIaPrompt(((req.params.id as string) as string));
      if (!current) return res.status(404).json({ ok: false, error: "Prompt nao encontrado" });
      const historico = await storage.getIaPromptHistorico(((req.params.id as string) as string));
      const targetVersion = historico.find(h => h.versao === parseInt(((req.params.versao as string) as string)));
      if (!targetVersion) return res.status(404).json({ ok: false, error: "Versao nao encontrada" });
      await storage.createIaPromptHistorico({ promptId: current.id, promptAnterior: current.prompt, editadoPor: req.user?.id || null, versao: current.versao || 1 } as any);
      const updated = await storage.updateIaPrompt(((req.params.id as string) as string), { prompt: targetVersion.promptAnterior || "", versao: (current.versao || 1) + 1, updatedBy: req.user?.id } as any);
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/ia/prompts/:id", requireAuth, async (req, res) => {
    try {
      if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "Apenas admin pode gerenciar prompts de IA" });
      const prompt = await storage.getIaPrompt(((req.params.id as string) as string));
      if (!prompt) return res.status(404).json({ ok: false, error: "Prompt nao encontrado" });
      const protectedSlugs = ["atendimento", "qualificacao", "followup"];
      if (protectedSlugs.includes(prompt.slug)) return res.status(403).json({ ok: false, error: "Prompts padrao nao podem ser removidos" });
      await storage.deleteIaPrompt(((req.params.id as string) as string));
      res.json({ ok: true, message: "Prompt removido" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });


  app.get("/api/integrations/config", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const configs = await storage.getIntegrationConfigs(wsId);
      const map: Record<string, { enabled: boolean; config: any }> = {};
      for (const c of configs) {
        const safeConfig = { ...c.config };
        if (safeConfig.accessToken) { const tk = safeConfig.accessToken; safeConfig.accessToken = tk.length > 12 ? tk.slice(0, 8) + "..." + tk.slice(-4) : "****"; safeConfig._hasToken = true; }
        if (safeConfig.secretKey) { const sk = safeConfig.secretKey; safeConfig.secretKey = sk.length > 12 ? sk.slice(0, 8) + "..." + sk.slice(-4) : "****"; safeConfig._hasKey = true; }
        if (safeConfig.apiKey) { const ak = safeConfig.apiKey; safeConfig.apiKey = ak.length > 12 ? ak.slice(0, 8) + "..." + ak.slice(-4) : "****"; safeConfig._hasKey = true; }
        if (safeConfig.clientSecret) { const cs = safeConfig.clientSecret; safeConfig.clientSecret = cs.length > 12 ? cs.slice(0, 8) + "..." + cs.slice(-4) : "****"; safeConfig._hasClientSecret = true; }
        if (safeConfig.password) { safeConfig.password = "****"; safeConfig._hasPassword = true; } // ex: Anlix (nunca devolve a senha crua)
        map[c.integrationId] = { enabled: c.enabled, config: safeConfig };
      }
      res.json({ ok: true, data: map });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/integrations/config", requireAuth, async (req, res) => {
    try {
      const { integrationId, enabled, config } = req.body;
      if (!integrationId || typeof integrationId !== "string") return res.status(400).json({ ok: false, error: "integrationId obrigatorio" });
      // Auditoria 2026-06-19: gerenciar credenciais de integração (OpenAI/Stripe/ERP)
      // é ação de gestão — antes qualquer atendente reescrevia a config do tenant.
      if (!["admin", "gerente", "manager"].includes(String((req as any).user?.role))) return res.status(403).json({ ok: false, error: "Apenas administradores gerenciam integrações" });
      // Auditoria 2026-06-19 (SSRF): valida a URL de ERP (Anlix) antes de SALVAR —
      // bloqueia armazenar host interno/metadata que o motor depois discaria.
      if (integrationId === "anlix" && config && typeof config === "object" && config.baseUrl) {
        const { assertSafeErpUrl } = await import("../utils/ssrfGuard");
        try { assertSafeErpUrl(String(config.baseUrl)); } catch { return res.status(400).json({ ok: false, error: "URL de integração inválida (host não permitido)" }); }
      }
      const wsId = await resolveWorkspaceId(req);
      // Encripta a senha antes de salvar (ex: Anlix). O merge no upsert preserva a
      // senha já salva quando o campo não vem (usuário deixou em branco).
      let cfgToSave = config;
      if (config && typeof config === "object" && config.password) {
        const { encrypt } = await import("../utils/crypto");
        cfgToSave = { ...config, password: encrypt(String(config.password)) };
      }
      const result = await storage.upsertIntegrationConfig(wsId, integrationId, !!enabled, cfgToSave);

      // Bruno 2026-06-18 (auditoria): mascara segredos na resposta do POST (igual ao GET) —
      // não ecoar apiKey/accessToken/secretKey/clientSecret/password em claro (inclui
      // segredos pré-existentes que o merge do upsert traz e o caller não enviou).
      const m: any = { ...((result as any)?.config || {}) };
      const mk = (v: string) => (v.length > 12 ? v.slice(0, 8) + "..." + v.slice(-4) : "****");
      if (m.accessToken) m.accessToken = mk(m.accessToken);
      if (m.secretKey) m.secretKey = mk(m.secretKey);
      if (m.apiKey) m.apiKey = mk(m.apiKey);
      if (m.clientSecret) m.clientSecret = mk(m.clientSecret);
      if (m.password) m.password = "****";
      res.json({ ok: true, data: { integrationId, enabled: !!enabled, config: m } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  // Testa as credenciais de uma integração sem alterar nada (botão "Testar").
  app.post("/api/integrations/test", requireAuth, async (req, res) => {
    try {
      const { integrationId, config } = req.body;
      if (!integrationId) return res.status(400).json({ ok: false, error: "integrationId obrigatorio" });
      // Auditoria 2026-06-19: testar credenciais também é ação de gestão (recebe segredo).
      if (!["admin", "gerente", "manager"].includes(String((req as any).user?.role))) return res.status(403).json({ ok: false, error: "Apenas administradores gerenciam integrações" });
      // Integração ERP (Anlix) removida — teste de conexão ISP não está mais disponível.
      return res.status(400).json({ ok: false, error: "Teste indisponível para essa integração" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/notificacoes", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); const rows = await storage.getNotificacoes(wsId); res.json({ ok: true, data: rows }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/notificacoes/:id/read", requireAuth, async (req, res) => {
    try { const id = Number(((req.params.id as string) as string)); if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" }); const wsId = await resolveWorkspaceId(req); await storage.markNotificacaoRead(id, wsId); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/notificacoes/read-all", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); await storage.markAllNotificacoesRead(wsId); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/notificacoes/:id", requireAuth, async (req, res) => {
    try { const id = Number(((req.params.id as string) as string)); if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: "ID invalido" }); const wsId = await resolveWorkspaceId(req); await storage.deleteNotificacao(id, wsId); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[campanhas]") }); }
  });

  app.get("/api/disparos-programados", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); const disparos = await storage.getDisparosProgramados(wsId); res.json(disparos); }
    catch (e: any) { res.status(500).json({ error: safeErr(e, "[campanhas]") }); }
  });

  app.post("/api/disparos-programados", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const userId = (req as any).user?.id;
      const {
        messageText, mediaUrl, mediaType, scheduledAt,
        isRecurring, recurrenceType, recurrencePeriod, recurrenceFrequencyDays,
        dispatchMode, templateName, templateLanguage, templateVariables, category,
        recipients, leadId, contactName, phoneNumber,
      } = req.body;

      // Audiência: recipients[] (multi-contato) OU os campos únicos (back-compat).
      const lista: Array<{ leadId?: string; contactName: string; phoneNumber: string }> =
        Array.isArray(recipients) && recipients.length
          ? recipients
          : (contactName && phoneNumber ? [{ leadId, contactName, phoneNumber }] : []);
      if (!lista.length) return res.status(400).json({ error: "Selecione ao menos um contato" });
      if (lista.length > 500) return res.status(400).json({ error: "Máximo de 500 contatos por disparo." });
      if (!scheduledAt) return res.status(400).json({ error: "Informe a data e hora do envio" });
      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) return res.status(400).json({ error: "A data de agendamento deve ser no futuro" });
      if (isRecurring && !recurrenceType) return res.status(400).json({ error: "Informe o tipo de recorrencia (ex: monthly)" });

      const mode = dispatchMode === "template" ? "template" : "texto_livre";
      const channelForced = mode === "template" ? "meta" : "evolution";
      let normVars: any = null;

      if (mode === "template") {
        if (!templateName) return res.status(400).json({ error: "Selecione um template aprovado" });
        const [metaConn] = await db.select().from(whatsappOfficialConnections)
          .where(and(eq(whatsappOfficialConnections.workspaceId, wsId), eq(whatsappOfficialConnections.status, "active"))).limit(1);
        if (!metaConn) return res.status(400).json({ error: "Disparo por template exige conexão WhatsApp API Oficial (Meta) ativa." });
        const lang = templateLanguage || "pt_BR";
        const [tpl] = await db.select().from(whatsappMessageTemplates)
          .where(and(
            eq(whatsappMessageTemplates.workspaceId, wsId),
            eq(whatsappMessageTemplates.templateName, templateName),
            eq(whatsappMessageTemplates.language, lang),
          )).limit(1);
        if (!tpl) return res.status(400).json({ error: "Template não encontrado nesse idioma." });
        if (String(tpl.status).toUpperCase() !== "APPROVED") return res.status(400).json({ error: "O template selecionado não está aprovado pela Meta." });
        const need = tpl.variablesCount || 0;
        normVars = Array.isArray(templateVariables) ? templateVariables : [];
        if (normVars.length !== need) return res.status(400).json({ error: `Este template tem ${need} variável(eis) — preencha todas.` });
        for (const v of normVars) {
          if (!v || (v.kind !== "token" && v.kind !== "fixed") || !String(v.value ?? "").trim()) {
            return res.status(400).json({ error: "Preencha todas as variáveis do template." });
          }
        }
      } else {
        if (!messageText && !mediaUrl) return res.status(400).json({ error: "Informe a mensagem (texto) ou uma mídia" });
      }

      const cat = ["cobranca", "boas_vindas", "aniversario", "manual"].includes(category) ? category : "manual";
      const created: any[] = [];
      for (const r of lista) {
        if (!r?.contactName || !r?.phoneNumber) continue;
        const disparo = await storage.createDisparoProgramado({
          workspaceId: wsId,
          leadId: String(r.leadId || r.phoneNumber),
          contactName: r.contactName,
          phoneNumber: r.phoneNumber,
          messageText: mode === "template" ? null : (messageText || null),
          mediaUrl: mode === "template" ? null : (mediaUrl || null),
          mediaType: mode === "template" ? "text" : (mediaType || "text"),
          scheduledAt: scheduledDate,
          isRecurring: !!isRecurring,
          recurrenceType: isRecurring ? recurrenceType : null,
          recurrencePeriod: isRecurring ? (recurrencePeriod || 3) : null,
          recurrenceFrequencyDays: isRecurring ? (recurrenceFrequencyDays || 30) : null,
          parentDisparoId: null,
          createdBy: userId,
          status: "pending",
          dispatchMode: mode,
          channelForced,
          templateName: mode === "template" ? templateName : null,
          templateLanguage: mode === "template" ? (templateLanguage || "pt_BR") : null,
          templateVariables: mode === "template" ? normVars : null,
          category: cat,
        } as any);
        created.push(disparo);
      }
      res.status(201).json({ ok: true, created: created.length, disparos: created });
    } catch (e: any) { console.error("[Disparos] criar:", e?.message); res.status(500).json({ error: "Erro ao criar disparo programado" }); }
  });

  app.patch("/api/disparos-programados/:id/cancel", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); await storage.cancelDisparoProgramado(((req.params.id as string) as string), wsId); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: safeErr(e, "[campanhas]") }); }
  });

  app.delete("/api/disparos-programados/:id", requireAuth, async (req, res) => {
    try { const wsId = await resolveWorkspaceId(req); await storage.deleteDisparoProgramado(((req.params.id as string) as string), wsId); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: safeErr(e, "[campanhas]") }); }
  });
}
