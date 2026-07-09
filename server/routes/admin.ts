import type { Express } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { requireAuth, JWT_SECRET } from "../middleware/auth";
import { parseId, resolveWorkspaceId, verifyPassword, safeErr } from "../utils/helpers";
import { db } from "../db";
import { eq, and, gte, desc } from "drizzle-orm";
import { workspaces } from "@shared/schema";
import { getOpenAIClient } from '../services/openaiClient';
import { bumpTokenVersion } from "../services/tokenVersionStore";
import { verifyTotp } from "../utils/totp";

// Auditoria 2026-06-19: o login do super-admin (painel-deus da plataforma) só caía
// no apiLimiter global (2000/15min) — frouxo demais pra brute-force da credencial
// mais poderosa. Limite dedicado e apertado, generoso o bastante pra não trancar o
// dono por erro de digitação.
const superAdminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em 15 minutos." },
});

const SUPER_ADMIN_USER = process.env.SUPER_ADMIN_USER;
const SUPER_ADMIN_PASS_HASH = process.env.SUPER_ADMIN_PASS_HASH;
if (!SUPER_ADMIN_USER || !SUPER_ADMIN_PASS_HASH) {
  console.error("[SuperAdmin] SUPER_ADMIN_USER and SUPER_ADMIN_PASS_HASH env vars are required");
}

function requireSuperAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "Token obrigatorio" });
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET as string) as any;
    // Bruno 2026-06-14 (auditoria #5): super-admin SÓ via login dedicado do console
    // (token com superAdmin:true emitido por /api/super-admin/login). Removido o
    // atalho por email — a senha NORMAL do dono não é mais credencial do painel-deus.
    // (O link "Super Gerencial" da sidebar continua aparecendo via /api/auth/me;
    //  ao clicar, cai na tela de login própria do console.)
    if (decoded.superAdmin === true) return next();
    return res.status(403).json({ error: "Acesso negado" });
  } catch { return res.status(401).json({ error: "Token invalido" }); }
}

export function registerAdminRoutes(app: Express) {
  // Bruno 2026-05-28 (Onda 3.5 tags/persistência): catálogo de tags exposto
  // pra UI admin auditar quais situations existem + pipeline + prioridade.
  // O módulo ISP (situationTagService) foi removido — catálogo agora vazio.
  app.get("/api/admin/situation-catalog", requireAuth, async (_req, res) => {
    try {
      type CatalogEntry = {
        code: string; slug: string; domain: string; intent: string;
        pipeline: string; pipelineStage: string; priority: number; informational: boolean;
      };
      const entries: CatalogEntry[] = [];
      const byDomain: Record<string, CatalogEntry[]> = {};
      res.json({
        total: entries.length,
        byDomain,
        all: entries,
      });
    } catch (e: any) {
      console.error(`[admin/situation-catalog] erro: ${e?.message}`);
      res.status(500).json({ error: "Falha ao carregar catálogo" });
    }
  });

  app.post("/api/banana-creator/generate", requireAuth, async (req, res) => {
    try {
      const { prompt, context, files, customApiKey, singleAI } = req.body;
      if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Prompt obrigatorio" });
      const attachedFiles: { name: string; url: string; type: string }[] = Array.isArray(files) ? files : [];
      const isSingleAI = singleAI === true;

      const { resolveOpenAIKeys } = await import("../services/openaiKeyResolver");
      let adminCandidates: Array<{ apiKey: string; baseURL: string; source: string }> = [];
      if (customApiKey) {
        adminCandidates.push({ apiKey: customApiKey, baseURL: "https://api.openai.com/v1", source: "custom" });
      }
      const wsId = await resolveWorkspaceId(req);
      const centralAdminCandidates = await resolveOpenAIKeys(wsId);
      adminCandidates = adminCandidates.concat(centralAdminCandidates);
      if (adminCandidates.length === 0) return res.status(400).json({ error: "Nenhuma API Key OpenAI configurada. Configure nas Integracoes ou informe uma chave personalizada." });

      const OpenAI = (await import("openai")).default;
      const openai = getOpenAIClient({ apiKey: adminCandidates[0].apiKey, baseURL: adminCandidates[0].baseURL });

      const singleAIPrompt = isSingleAI ? `Voce e o Banana Creator no modo "Fluxo 100% IA". Neste modo, voce cria um fluxo MINIMALISTA com apenas um trigger + um unico no ai_response que funciona como um agente de IA totalmente autonomo.

O no ai_response recebera um systemPrompt extremamente detalhado e completo que instrui a IA a:
- Entender todos os momentos da conversa (boas-vindas, apresentacao, qualificacao, venda, pos-venda)
- Responder de forma natural e humana em portugues brasileiro
- Enviar imagens, PDFs, catalogos quando necessario (usando marcadores como [ENVIAR_IMAGEM:url] no texto)
- Oferecer opcoes de pagamento e enviar links de pagamento
- Coletar dados do cliente (nome, endereco, telefone, email)
- Gerenciar pedidos, agendamentos, orcamentos
- Lidar com objecoes e duvidas
- Encerrar a conversa de forma educada
- Saber quando transferir para um humano

Com base na descricao do usuario, crie um systemPrompt MUITO DETALHADO e COMPLETO para o no ai_response. O systemPrompt deve ser um manual completo para a IA atender o cliente do inicio ao fim.

${context ? `\nCONTEXTO ADICIONAL DO USUARIO:\n${context}` : ""}
${attachedFiles.length > 0 ? `\nARQUIVOS DISPONIVEIS (a IA pode referenciar com send_image):
${attachedFiles.map((f, i) => `${i + 1}. ${f.type === "image" ? "IMAGEM" : "PDF"}: "${f.name}" -> URL: ${f.url}`).join("\n")}
Inclua instrucoes no systemPrompt para a IA enviar estes arquivos nos momentos adequados.` : ""}

FORMATO DE RESPOSTA (JSON):
{
  "nome": "Nome descritivo do fluxo 100% IA",
  "descricao": "Descricao breve",
  "trigger": "Nova mensagem recebida",
  "nodes": [
    {"id": "n1","type": "trigger","label": "Nova Mensagem","config": { "triggerType": "new_message" },"x": 250,"y": 30,"next": ["n2"]},
    {"id": "n2","type": "ai_response","label": "Agente IA Autonomo","config": {"systemPrompt": "O SYSTEM PROMPT COMPLETO E DETALHADO AQUI - MINIMO 500 PALAVRAS","model": "gpt-4o-mini","saveAs": "aiReply"},"x": 250,"y": 230,"next": []}
  ],
  "feedback": "Explicacao do que o agente IA vai fazer",
  "campos_personalizar": ["campo1", "campo2"]
}

REGRAS OBRIGATORIAS:
1. SEMPRE retornar EXATAMENTE 2 nos: trigger (n1) + ai_response (n2). NUNCA adicione outros nos.
2. O systemPrompt do ai_response DEVE ter no MINIMO 500 palavras. Seja EXTREMAMENTE detalhado.
3. Inclua no systemPrompt: personalidade do atendente, regras de negocio, catalogo/menu se aplicavel, formas de pagamento, horarios, FAQs comuns, como lidar com reclamacoes, quando transferir para humano.
4. Use variaveis como {{nome}}, {{telefone}}, {{email}} no systemPrompt para personalizacao.
5. O systemPrompt deve cobrir TODOS os cenarios possiveis de conversa com o cliente.
6. Escreva em portugues brasileiro natural e profissional.

IMPORTANTE: Responda APENAS com JSON valido, sem markdown, sem backticks, sem texto antes ou depois do JSON.` : "";

      const systemPrompt = isSingleAI ? singleAIPrompt : `Voce e o Banana Creator, a IA especialista do ChatBanana CRM para criacao de fluxos de automacao completos e profissionais.

VOCE CONHECE TODOS OS BLOCOS DISPONIVEIS NO CANVAS:

BASICOS:
- trigger: Gatilho (inicio do fluxo). triggerTypes: new_message, conversation_opened, lead_created, lead_status_changed, lead_won, inactivity, scheduled, keyword, tag_added
- send_message: Enviar Mensagem de texto. config: { content: "texto com {{variaveis}}" }
- send_image: Enviar Imagem/PDF/Audio/Video. config: { mediaUrl, caption }
- delay: Aguardar (tempo). config: { duration: number, unit: "seconds"|"minutes"|"hours"|"days" }
- condition: Condicao (if/else com 2 saidas). config: { field, operator, value }
- tag_lead: Marcar Lead com tag. config: { tag }
- assign_agent: Atribuir Atendente. config: { agentId }
- update_lead: Atualizar Pipeline/status do lead. config: { status, valor }
- lista_opcoes: Lista de Opcoes (menu interativo com botoes). config: { title, buttonText: "Ver opcoes", list_style: "buttons", options: [{id,label,next}] }
- end: Fim do Fluxo

AVANCADOS:
- ai_response: Resposta IA (usa GPT para responder). config: { systemPrompt, saveAs }
- advanced_condition: Condicao Avancada. config: { rules: [{field,op,value}], logic }
- split_ia: Split IA. config: { prompt, branches }
- set_variable: Definir Variavel. config: { varName, value, scope }
- wait_event: Esperar Evento. config: { eventType, timeout }
- loop: Loop. config: { maxIterations, condition }
- alerta_interno: Alerta Interno. config: { message, channel }
- gerar_documento: Gerar Documento. config: { template, format }

INTEGRACOES:
- webhook: Chamar webhook externo. config: { url, method, headers, body }
- zapier_trigger: Disparar Zapier/Make. config: { webhookUrl }
- n8n_trigger: Disparar N8n. config: { webhookUrl }
- stripe_payment: Cobrar via Stripe. config: { amount, currency, description }
- pagamento: Pagamento generico. config: { amount, method }

VARIAVEIS DISPONIVEIS: {{nome}}, {{telefone}}, {{email}}, {{empresa}}, {{canal}}, {{valor}}, {{status}}, {{tags}}, {{atendente}}, {{variables.NOME_VAR}}

REGRAS DE CRIACAO:
1. O primeiro no SEMPRE e "trigger" com id "n1"
2. Cada no tem: id, type, label, config, x, y, next (array de ids)
3. Posicionar nos verticalmente: x=250, y incrementando ~200px
4. Para condicoes/splits, ramificar horizontalmente
5. Sempre terminar cada ramo com "end"
6. Usar mensagens naturais em portugues brasileiro
7. Incluir delays realistas entre mensagens
8. PREFERENCIA OBRIGATORIA: Sempre que o fluxo precisar que o cliente escolha entre opcoes, use SEMPRE o bloco "lista_opcoes"
9. Usar lista_opcoes para TODOS os menus, escolhas, confirmacoes
10. OBRIGATORIO: Em TODOS os blocos lista_opcoes, SEMPRE incluir config.buttonText = "Ver opcoes"
11. OBRIGATORIO: Em TODOS os blocos send_message, SEMPRE incluir config.content com texto completo
12. Para confirmacoes do tipo "Sim ou Nao", use lista_opcoes com 2 opcoes
13. Para coleta de dados livres, use send_message seguido de wait_event com eventType "new_message"

FORMATO DE RESPOSTA (JSON):
{ "nome": "...", "descricao": "...", "trigger": "...", "nodes": [...], "feedback": "...", "campos_personalizar": [...] }

${context ? `\nCONTEXTO ADICIONAL DO USUARIO:\n${context}` : ""}
${attachedFiles.length > 0 ? `\nARQUIVOS ANEXADOS PELO USUARIO (use no fluxo com blocos send_image):
${attachedFiles.map((f, i) => `${i + 1}. ${f.type === "image" ? "IMAGEM" : "PDF"}: "${f.name}" → URL: ${f.url}`).join("\n")}

REGRA OBRIGATORIA PARA ARQUIVOS: Voce DEVE incluir blocos "send_image" no fluxo para enviar esses arquivos ao cliente nos momentos adequados.` : ""}

IMPORTANTE: Responda APENAS com JSON valido, sem markdown, sem backticks, sem texto antes ou depois do JSON.`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
        stream: true, max_completion_tokens: 16384, temperature: 0.7,
      });

      let fullResponse = "";
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) { fullResponse += content; res.write(`data: ${JSON.stringify({ content })}\n\n`); }
      }
      res.write(`data: ${JSON.stringify({ done: true, full: fullResponse })}\n\n`);
      res.end();
    } catch (e: any) {
      console.error("[BananaCreator] error:", e);
      if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: "Erro ao gerar fluxo" })}\n\n`); res.end(); }
      else { res.status(500).json({ error: "Erro ao gerar fluxo" }); }
    }
  });

  app.post("/api/super-admin/login", superAdminLoginLimiter, (req, res) => {
    const { usuario, senha, totp } = req.body;
    if (!SUPER_ADMIN_USER || !SUPER_ADMIN_PASS_HASH || usuario !== SUPER_ADMIN_USER || !verifyPassword(senha, SUPER_ADMIN_PASS_HASH)) return res.status(401).json({ error: "Credenciais invalidas" });
    // 2FA (auditoria 2026-06-20): se SUPER_ADMIN_TOTP_SECRET estiver setado, exige o código
    // TOTP do app autenticador (segundo fator). Sem o env → sem 2FA (comportamento atual).
    // Enrollment: tsx scripts/gen-superadmin-totp.ts → setar o secret no EasyPanel.
    const totpSecret = process.env.SUPER_ADMIN_TOTP_SECRET || "";
    if (totpSecret) {
      if (!totp) return res.status(401).json({ error: "Código de autenticação (2FA) obrigatório", totpRequired: true });
      if (!verifyTotp(String(totp), totpSecret)) return res.status(401).json({ error: "Código de autenticação inválido", totpRequired: true });
    }
    const token = jwt.sign({ superAdmin: true, usuario: SUPER_ADMIN_USER }, JWT_SECRET as string, { expiresIn: "12h" });
    res.json({ ok: true, token });
  });

  app.get("/api/super-admin/dashboard", requireSuperAdmin, async (_req, res) => {
    try {
      const { users, workspaces } = await import("@shared/schema");
      const allUsers = await db.select().from(users);
      const allWorkspaces = await db.select().from(workspaces);
      const usersWithoutPassword = allUsers.map(({ password, ...u }) => u);
      const registrationsByDay: Record<string, number> = {};
      for (const ws of allWorkspaces) { if (ws.createdAt) { const day = new Date(ws.createdAt).toISOString().split("T")[0]; registrationsByDay[day] = (registrationsByDay[day] || 0) + 1; } }
      const loginsByDay: Record<string, number> = {};
      for (const u of allUsers) { if (u.ultimoAcesso) { const day = new Date(u.ultimoAcesso).toISOString().split("T")[0]; loginsByDay[day] = (loginsByDay[day] || 0) + 1; } }
      res.json({ ok: true, data: { stats: { totalUsers: allUsers.length, onlineUsers: allUsers.filter(u => u.online).length, gestorCount: allUsers.filter(u => u.accountType === "gestor").length, empreendedorCount: allUsers.filter(u => u.accountType === "empreendedor").length, activeCount: allUsers.filter(u => u.status === "ACTIVE").length, inactiveCount: allUsers.filter(u => u.status === "INACTIVE").length, invitedCount: allUsers.filter(u => u.status === "INVITED").length, totalWorkspaces: allWorkspaces.length, activeWorkspaces: allWorkspaces.filter(w => w.status === "ACTIVE").length, trialWorkspaces: allWorkspaces.filter(w => w.trialExpiresAt).length }, users: usersWithoutPassword, workspaces: allWorkspaces, registrationsByDay, loginsByDay } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.get("/api/super-admin/logs", requireSuperAdmin, async (_req, res) => {
    try {
      const { users, workspaces } = await import("@shared/schema");
      const allUsers = await db.select({ id: users.id, nome: users.nome, email: users.email, role: users.role, status: users.status, online: users.online, accountType: users.accountType, ultimoAcesso: users.ultimoAcesso, workspaceId: users.workspaceId }).from(users).orderBy(users.id);
      const allWorkspaces = await db.select().from(workspaces);
      const wsMap = new Map(allWorkspaces.map(w => [w.id, w]));
      const logs = allUsers.map(u => ({ ...u, workspaceName: u.workspaceId ? wsMap.get(u.workspaceId)?.nome || "—" : "—", workspacePlan: u.workspaceId ? wsMap.get(u.workspaceId)?.partnerPlan || "—" : "—", workspaceCreatedAt: u.workspaceId ? wsMap.get(u.workspaceId)?.createdAt : null, trialExpiresAt: u.workspaceId ? wsMap.get(u.workspaceId)?.trialExpiresAt : null }));
      res.json({ ok: true, data: logs });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Timeline de atividade de UM usuário (atendente/gerente/admin) — junta TODAS as
  // alterações atribuídas a ele em várias fontes (login/logout, protocolos, tags
  // manuais, anotações, chat interno, mensagens apagadas, reações, ações de IA
  // aprovadas/rejeitadas, edição de prompt, acesso a relatório) num único stream
  // ordenado por data. Cada fonte é limitada (perSource) e a junção é cortada em
  // `limit`. Usado pelo modal "Atividade" da aba Logs do super-admin.
  app.get("/api/super-admin/users/:id/activity", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseId(req.params.id as string);
      if (!userId) return res.status(400).json({ error: "ID inválido" });
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "300"), 10) || 300, 1), 1000);
      const perSource = 250;

      const s = await import("@shared/schema");
      const [u] = await db
        .select({ id: s.users.id, nome: s.users.nome, email: s.users.email, role: s.users.role, accountType: s.users.accountType, workspaceId: s.users.workspaceId })
        .from(s.users).where(eq(s.users.id, userId)).limit(1);
      if (!u) return res.status(404).json({ error: "Usuário não encontrado" });
      const wsName = u.workspaceId ? (await db.select({ nome: workspaces.nome }).from(workspaces).where(eq(workspaces.id, u.workspaceId)).limit(1))[0]?.nome ?? null : null;

      const trunc = (txt: string | null | undefined, n = 140) => {
        if (!txt) return null;
        const t = String(txt).replace(/\s+/g, " ").trim();
        return t.length > n ? t.slice(0, n) + "…" : t;
      };
      type Ev = { ts: Date | string | null; type: string; title: string; detail?: string | null; convId?: number | null };
      const ev: Ev[] = [];

      // Roda todas as fontes em paralelo (cada uma filtrada pelo id do usuário).
      // Fonte "acao_ia" (writeToolActions) removida junto com o módulo ISP.
      const [sessions, pevents, tags, notas, ci, dels, reacts, prompts, reports] = await Promise.all([
        db.select().from(s.authSessions).where(eq(s.authSessions.userId, userId)).orderBy(desc(s.authSessions.loginAt)).limit(perSource),
        db.select().from(s.protocolEvents).where(eq(s.protocolEvents.usuarioId, userId)).orderBy(desc(s.protocolEvents.createdAt)).limit(perSource),
        db.select().from(s.conversationSituationTags).where(eq(s.conversationSituationTags.appliedBy, userId)).orderBy(desc(s.conversationSituationTags.createdAt)).limit(perSource),
        db.select().from(s.anotacoes).where(eq(s.anotacoes.criadoPor, userId)).orderBy(desc(s.anotacoes.createdAt)).limit(perSource),
        db.select().from(s.chatInterno).where(eq(s.chatInterno.userId, userId)).orderBy(desc(s.chatInterno.createdAt)).limit(perSource),
        db.select().from(s.messages).where(eq(s.messages.deletedByUserId, userId)).orderBy(desc(s.messages.deletedAt)).limit(perSource),
        db.select().from(s.messageReactions).where(eq(s.messageReactions.userId, userId)).orderBy(desc(s.messageReactions.createdAt)).limit(perSource),
        db.select().from(s.iaPromptHistorico).where(eq(s.iaPromptHistorico.editadoPor, userId)).orderBy(desc(s.iaPromptHistorico.createdAt)).limit(perSource),
        db.select().from(s.dailyReportAccessLog).where(eq(s.dailyReportAccessLog.userId, userId)).orderBy(desc(s.dailyReportAccessLog.accessedAt)).limit(perSource),
      ]);

      for (const x of sessions) {
        if (x.loginAt) ev.push({ ts: x.loginAt, type: "login", title: "Entrou no sistema", detail: x.ip ? `IP ${x.ip}` : null });
        if (x.logoutAt) ev.push({ ts: x.logoutAt, type: "logout", title: "Saiu do sistema", detail: null });
      }
      const protoTitle: Record<string, string> = { criacao: "Abriu protocolo", resolucao: "Resolveu protocolo", observacao: "Observação no protocolo", reabertura: "Reabriu protocolo", transferencia: "Transferiu protocolo" };
      for (const x of pevents) ev.push({ ts: x.createdAt, type: `protocolo:${x.tipo}`, title: protoTitle[x.tipo] || `Protocolo: ${x.tipo}`, detail: trunc(x.descricao) });
      for (const x of tags) ev.push({ ts: x.createdAt, type: "tag", title: `Aplicou tag ${x.situationCode}`, detail: trunc(x.motivo), convId: x.conversationId });
      for (const x of notas) ev.push({ ts: x.createdAt, type: "nota", title: "Escreveu anotação", detail: trunc(x.conteudo), convId: x.conversationId ?? null });
      for (const x of ci) ev.push({ ts: x.createdAt, type: "chat_interno", title: "Mensagem interna (equipe)", detail: trunc(x.texto), convId: x.conversationId });
      for (const x of dels) ev.push({ ts: x.deletedAt, type: "msg_apagada", title: "Apagou mensagem", detail: trunc(x.originalTexto || x.texto), convId: x.conversationId });
      for (const x of reacts) ev.push({ ts: x.createdAt, type: "reacao", title: `Reagiu ${x.emoji}`, detail: null, convId: x.conversationId });
      for (const x of prompts) ev.push({ ts: x.createdAt, type: "prompt", title: `Editou prompt da IA (v${x.versao ?? "?"})`, detail: null });
      for (const x of reports) ev.push({ ts: x.accessedAt, type: "relatorio", title: `Acessou relatório (${x.action})`, detail: x.reportDate ? String(x.reportDate) : null });

      const sorted = ev
        .filter(e => e.ts)
        .sort((a, b) => new Date(b.ts as any).getTime() - new Date(a.ts as any).getTime());
      const summary: Record<string, number> = {};
      for (const e of sorted) { const k = e.type.split(":")[0]; summary[k] = (summary[k] || 0) + 1; }

      res.json({ ok: true, data: { user: { ...u, workspaceName: wsName }, total: sorted.length, capped: sorted.length > limit, summary, events: sorted.slice(0, limit) } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.patch("/api/super-admin/users/:id/status", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseId(((req.params.id as string) as string)); if (!userId) return res.status(400).json({ error: "ID invalido" });
      const { status } = req.body; if (!["ACTIVE", "INACTIVE"].includes(status)) return res.status(400).json({ error: "Status invalido" });
      // Bruno 2026-06-13: via blocklist — INACTIVE bloqueia NA HORA (requireAuth) e
      // faz force-logout das sessões abertas, não só barra login novo.
      const { setUserBlocked } = await import("../services/tenantBlocklist");
      await setUserBlocked(userId, status === "INACTIVE");
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.delete("/api/super-admin/users/:id", requireSuperAdmin, async (req, res) => {
    try {
      const userId = parseId(((req.params.id as string) as string)); if (!userId) return res.status(400).json({ error: "ID invalido" });
      const { users } = await import("@shared/schema");
      await db.delete(users).where(eq(users.id, userId));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.get("/api/super-admin/config/:key", requireSuperAdmin, async (req, res) => {
    try {
      const { platformConfig } = await import("@shared/schema");
      const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, ((req.params.key as string) as string)));
      res.json({ ok: true, value: row?.value || null });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.put("/api/super-admin/config/:key", requireSuperAdmin, async (req, res) => {
    try {
      const { platformConfig } = await import("@shared/schema");
      const { value } = req.body; if (value === undefined || value === null) return res.status(400).json({ error: "Valor obrigatorio" });
      const [existing] = await db.select().from(platformConfig).where(eq(platformConfig.key, ((req.params.key as string) as string)));
      if (existing) await db.update(platformConfig).set({ value: String(value), updatedAt: new Date() }).where(eq(platformConfig.key, ((req.params.key as string) as string)));
      else await db.insert(platformConfig).values({ key: ((req.params.key as string) as string), value: String(value) });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.get("/api/super-admin/financeiro", requireSuperAdmin, async (req, res) => {
    try {
      const { users, workspaces: wsTable, conexoes, platformConfig, conversations } = await import("@shared/schema");
      const { sql: sqlFn } = await import("drizzle-orm");
      const [commRow] = await db.select().from(platformConfig).where(eq(platformConfig.key, "admin_commission_percent"));
      const commissionPercent = commRow ? parseFloat(commRow.value) : 0;
      const gestorWorkspaces = await db.select().from(wsTable).where(eq(wsTable.accountType, "gestor"));
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const gestorFinancials = [];
      let platformTotalConnections = 0, platformActiveConnections = 0, platformTotalRevenue = 0;

      for (const gw of gestorWorkspaces) {
        const gestorUsers = await db.select({ id: users.id, nome: users.nome, email: users.email }).from(users).where(eq(users.workspaceId, gw.id));
        const gestorOwner = gestorUsers[0];
        const clientWs = await db.select().from(wsTable).where(eq(wsTable.parentWorkspaceId, gw.id));
        const clientIds = clientWs.map(c => c.id);
        let totalConnections = 0, activeConnections = 0, activeClients = 0;
        for (const cId of clientIds) {
          const wsConns = await db.select().from(conexoes).where(eq(conexoes.workspaceId, cId));
          totalConnections += wsConns.length;
          activeConnections += wsConns.filter(c => c.status === "connected").length;
          const [recent] = await db.select({ count: sqlFn<number>`count(*)::int` }).from(conversations).where(and(eq(conversations.workspaceId, cId), gte(conversations.createdAt, thirtyDaysAgo)));
          if ((recent?.count || 0) > 0) activeClients++;
        }
        const gestorRevenue = Math.round(totalConnections * 87.90 * 100) / 100;
        const adminComm = Math.round(gestorRevenue * commissionPercent / 100);
        platformTotalConnections += totalConnections; platformActiveConnections += activeConnections; platformTotalRevenue += gestorRevenue;
        gestorFinancials.push({ workspaceId: gw.id, workspaceName: gw.nome, gestorName: gestorOwner?.nome || "—", gestorEmail: gestorOwner?.email || "—", totalClients: clientIds.length, activeClients, totalConnections, activeConnections, monthlyRevenue: gestorRevenue, adminCommission: adminComm, partnerSince: gw.partnerSince || gw.createdAt });
      }
      res.json({ ok: true, data: { commissionPercent, gestores: gestorFinancials, totals: { totalGestores: gestorWorkspaces.length, totalConnections: platformTotalConnections, activeConnections: platformActiveConnections, totalGestorRevenue: platformTotalRevenue, adminRevenue: Math.round(platformTotalRevenue * commissionPercent / 100) } } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // ── VISÃO GERAL (KPIs de negócio do SaaS) ──────────────────────────────────
  // Bruno 2026-06-19: substitui o "Dashboard" de contagem pura por métricas reais —
  // MRR, ARR, ARPU, pagantes/trial/inadimplentes/VIP + churn/crescimento do período
  // (estes últimos vêm de subscription_events, que enche a partir de agora).
  app.get("/api/super-admin/overview", requireSuperAdmin, async (req, res) => {
    try {
      const { sql: sqlFn } = await import("drizzle-orm");
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const since = new Date(Date.now() - days * 86400000);
      const rowsOf = (r: any) => (Array.isArray(r) ? r : (r?.rows || []));

      // Snapshot atual: workspace + preço do plano (exclui arquivados).
      const wsRes = await db.execute(sqlFn`
        SELECT w.is_vip, w.asaas_subscription_status AS asaas, w.trial_expires_at, p.preco::float AS preco
        FROM workspaces w LEFT JOIN planos p ON p.id = w.plano_id
        WHERE w.status <> 'deleted'`);
      const rows = rowsOf(wsRes);
      const now = Date.now();
      let mrr = 0, pagantes = 0, trial = 0, inadimplentes = 0, vip = 0, cancelados = 0;
      for (const w of rows) {
        if (w.is_vip) { vip++; continue; } // cortesia: conta como cliente, não no MRR
        if (w.asaas === "active" && w.preco) { pagantes++; mrr += Number(w.preco); }
        else if (w.asaas === "past_due") inadimplentes++;
        else if (w.asaas === "canceled") cancelados++;
        else if (w.trial_expires_at && new Date(w.trial_expires_at).getTime() > now) trial++;
      }
      const arpu = pagantes > 0 ? Math.round((mrr / pagantes) * 100) / 100 : 0;

      // Churn + crescimento do período (subscription_events + created_at).
      const chRes = await db.execute(sqlFn`
        SELECT COUNT(*) FILTER (WHERE event_type='canceled' AND created_at >= ${since})::int AS cancelados,
               COALESCE(SUM(mrr::float) FILTER (WHERE event_type='canceled' AND created_at >= ${since}), 0)::float AS mrr_perdido
        FROM subscription_events`);
      const ch = rowsOf(chRes)[0] || {};
      const novos = rowsOf(await db.execute(sqlFn`SELECT COUNT(*)::int AS n FROM workspaces WHERE created_at >= ${since} AND status <> 'deleted'`))[0]?.n || 0;
      const online = rowsOf(await db.execute(sqlFn`SELECT COUNT(*)::int AS n FROM users WHERE online=true`))[0]?.n || 0;
      const baseChurn = pagantes + Number(ch.cancelados || 0);
      const churnPct = baseChurn > 0 ? Math.round((Number(ch.cancelados || 0) / baseChurn) * 1000) / 10 : 0;

      res.json({ ok: true, data: {
        mrr: Math.round(mrr * 100) / 100, arr: Math.round(mrr * 12 * 100) / 100, arpu,
        clientes: { pagantes, trial, inadimplentes, vip, cancelados, total: rows.length },
        crescimento: { novos, churnPct, cancelados: Number(ch.cancelados || 0), mrrPerdido: Math.round(Number(ch.mrr_perdido || 0) * 100) / 100 },
        online, days,
      }});
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // ── RECEITA (MRR por plano + evolução temporal dos eventos) ────────────────
  app.get("/api/super-admin/receita", requireSuperAdmin, async (req, res) => {
    try {
      const { sql: sqlFn } = await import("drizzle-orm");
      const rowsOf = (r: any) => (Array.isArray(r) ? r : (r?.rows || []));
      const porPlano = rowsOf(await db.execute(sqlFn`
        SELECT p.nome AS plano, p.preco::float AS preco, COUNT(*)::int AS clientes,
               COALESCE(SUM(p.preco::float), 0)::float AS mrr
        FROM workspaces w JOIN planos p ON p.id = w.plano_id
        WHERE w.status <> 'deleted' AND w.asaas_subscription_status='active' AND w.is_vip=false
        GROUP BY p.nome, p.preco ORDER BY mrr DESC`));
      const evolucao = rowsOf(await db.execute(sqlFn`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes,
               COALESCE(SUM(mrr::float) FILTER (WHERE event_type='payment_confirmed'), 0)::float AS confirmado,
               COALESCE(SUM(mrr::float) FILTER (WHERE event_type='canceled'), 0)::float AS perdido,
               COUNT(*) FILTER (WHERE event_type='canceled')::int AS cancelamentos
        FROM subscription_events GROUP BY mes ORDER BY mes ASC`));
      res.json({ ok: true, data: { porPlano, evolucao } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // ── TENANTS: monitoramento + governança (bloqueio/desbloqueio/trial) ──────
  // Bruno 2026-06-13. Lista enriquecida de workspaces com sinais de saúde
  // (assinatura/trial, uso, IA/conexão, qualidade) e ações de governança.
  const tenantRows = (r: any) => (Array.isArray(r) ? r : (r as any).rows || []);

  app.get("/api/super-admin/tenants", requireSuperAdmin, async (req, res) => {
    try {
      const { workspaces: wsTable } = await import("@shared/schema");
      const { sql: sqlFn } = await import("drizzle-orm");
      const includeArchived = req.query.archived === "1" || req.query.archived === "true";
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const allWsRaw = await db.select().from(wsTable);
      const allWs = includeArchived ? allWsRaw : allWsRaw.filter((w: any) => w.status !== "deleted");
      // Catálogo de planos (id → {nome, preço}) p/ mostrar plano + valor mensal por tenant.
      const { planos: planosTable } = await import("@shared/schema");
      const planoById = new Map<string, any>((await db.select().from(planosTable)).map((p: any) => [p.id, p]));

      // ispAgg (isp_session_metrics) e evalAgg (conversation_evaluations) removidos
      // junto com o módulo ISP — viram agregados vazios pra preservar o shape.
      const [usersAgg, connAgg, offAgg, convAgg, aiAgg] = await Promise.all([
        db.execute(sqlFn`SELECT workspace_id, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status='ACTIVE')::int AS ativos, MAX(ultimo_acesso) AS last_login FROM users WHERE workspace_id IS NOT NULL GROUP BY workspace_id`),
        db.execute(sqlFn`SELECT workspace_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='connected')::int AS connected FROM conexoes GROUP BY workspace_id`),
        // Canal OFICIAL (Meta Cloud) — vive em tabela separada (whatsapp_official_connections,
        // 1 por workspace). Conta JUNTO na coluna Canais; sem isso o oficial sumia da contagem.
        db.execute(sqlFn`SELECT workspace_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS connected FROM whatsapp_official_connections GROUP BY workspace_id`),
        db.execute(sqlFn`SELECT workspace_id, COUNT(*) FILTER (WHERE created_at >= ${since30})::int AS conv30, COUNT(*)::int AS conv_total, MAX(updated_at) AS last_activity FROM conversations WHERE COALESCE(is_simulation,false)=false GROUP BY workspace_id`),
        db.execute(sqlFn`SELECT workspace_id FROM integration_configs WHERE integration_id='openai' AND enabled=true AND COALESCE(config->>'apiKey','') <> ''`),
      ]);
      const ispAgg: any[] = [];
      const evalAgg: any[] = [];

      const byWs = (r: any) => { const m = new Map<string, any>(); for (const x of tenantRows(r)) m.set(x.workspace_id, x); return m; };
      const uM = byWs(usersAgg), cM = byWs(connAgg), oM = byWs(offAgg), vM = byWs(convAgg), iM = byWs(ispAgg), eM = byWs(evalAgg);
      const aiSet = new Set(tenantRows(aiAgg).map((x: any) => x.workspace_id));
      const now = Date.now();

      const tenants = allWs.map((w: any) => {
        const u = uM.get(w.id), c = cM.get(w.id), o = oM.get(w.id), v = vM.get(w.id), i = iM.get(w.id), e = eM.get(w.id);
        const trialDaysLeft = w.trialExpiresAt ? Math.ceil((new Date(w.trialExpiresAt).getTime() - now) / 86400000) : null;
        const sess = i?.sessions30 || 0;
        return {
          id: w.id, nome: w.nome, status: w.status, blocked: w.status === "blocked", archived: w.status === "deleted",
          isVip: w.isVip === true, asaasStatus: w.asaasSubscriptionStatus || null,
          planoNome: planoById.get(w.planoId)?.nome || null,
          valorMensal: (!w.isVip && w.asaasSubscriptionStatus === "active") ? Number(planoById.get(w.planoId)?.preco || 0) : 0,
          vencimento: w.asaasNextDueDate || null,
          accountType: w.accountType, partnerPlan: w.partnerPlan || null, createdAt: w.createdAt,
          trialExpiresAt: w.trialExpiresAt || null, trialDaysLeft,
          stripeStatus: w.stripeSubscriptionStatus || null, stripePeriodEnd: w.stripeCurrentPeriodEnd || null,
          users: u?.n || 0, usersAtivos: u?.ativos || 0, lastLogin: u?.last_login || null,
          connections: (c?.total || 0) + (o?.total || 0), connected: (c?.connected || 0) + (o?.connected || 0),
          conversas30d: v?.conv30 || 0, conversasTotal: v?.conv_total || 0, lastActivity: v?.last_activity || null,
          ispSessions30d: sess, escalacaoPct: sess > 0 ? Math.round(((i?.escaladas || 0) / sess) * 100) : null,
          aiKey: aiSet.has(w.id),
          csat: e?.csat != null ? Number(e.csat) : null, evalP0: e?.p0 || 0, evalN: e?.n || 0,
        };
      });
      // bloqueados primeiro; depois mais recentes por última atividade.
      tenants.sort((a, b) => {
        if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
        const la = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const lb = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return lb - la;
      });
      res.json({ ok: true, data: tenants });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.get("/api/super-admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const wsId = (req.params.id as string);
      const { workspaces: wsTable, users, conexoes, integrationConfigs } = await import("@shared/schema");
      const { sql: sqlFn } = await import("drizzle-orm");
      const [ws] = await db.select().from(wsTable).where(eq(wsTable.id, wsId)).limit(1);
      if (!ws) return res.status(404).json({ error: "Tenant não encontrado" });

      const usersList = await db.select({ id: users.id, nome: users.nome, email: users.email, role: users.role, status: users.status, online: users.online, accountType: users.accountType, ultimoAcesso: users.ultimoAcesso }).from(users).where(eq(users.workspaceId, wsId)).orderBy(users.id);
      const connsRaw = await db.select({ id: conexoes.id, nome: conexoes.nome, provider: conexoes.provider, numero: conexoes.numero, status: conexoes.status }).from(conexoes).where(eq(conexoes.workspaceId, wsId));
      const conns: { id: string; nome: string; provider: string; numero: string | null; status: string }[] =
        connsRaw.map((c: any) => ({ id: String(c.id), nome: c.nome, provider: c.provider, numero: c.numero, status: c.status }));
      // Inclui o canal OFICIAL (Meta Cloud) — tabela separada (whatsapp_official_connections), 1 por workspace.
      const { whatsappOfficialConnections } = await import("@shared/schema");
      const [official] = await db.select().from(whatsappOfficialConnections).where(eq(whatsappOfficialConnections.workspaceId, wsId)).limit(1);
      if (official) {
        conns.push({
          id: `official-${official.id}`,
          nome: official.businessName || "WhatsApp Oficial (Meta)",
          provider: "meta_oficial",
          numero: official.displayPhoneNumber || null,
          status: official.status === "active" ? "connected" : (official.status || "inactive"),
        });
      }
      const aiRows = await db.select({ id: integrationConfigs.id, config: integrationConfigs.config, enabled: integrationConfigs.enabled }).from(integrationConfigs).where(and(eq(integrationConfigs.workspaceId, wsId), eq(integrationConfigs.integrationId, "openai")));
      const aiCfg = aiRows[0];
      const aiKey = !!(aiCfg?.enabled && (aiCfg?.config as any)?.apiKey);

      // Catálogo de planos — pra permitir atribuir/trocar o plano do tenant no modal.
      // Só a GRADE VIGENTE (catálogo canônico) — sem os planos antigos (Starter/
      // Professional/Business) que ainda existem no banco mas saíram da grade.
      const { planos: planosTable } = await import("@shared/schema");
      const { CANONICAL_PLAN_SLUGS, PLANS_CATALOG } = await import("@shared/plansCatalog");
      const planoOrder = new Map(PLANS_CATALOG.map((p, i) => [p.slug, i]));
      const planosRaw = await db.select({ id: planosTable.id, nome: planosTable.nome, slug: planosTable.slug, preco: planosTable.preco }).from(planosTable);
      const planosList = planosRaw
        .filter((p: any) => CANONICAL_PLAN_SLUGS.includes(p.slug))
        .sort((a: any, b: any) => (planoOrder.get(a.slug) ?? 99) - (planoOrder.get(b.slug) ?? 99));

      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // Métricas ISP (isp_session_metrics) e de avaliação (conversation_evaluations)
      // removidas junto com o módulo ISP — restam só conversas (sessions/csat/p0 → 0/null).
      const [metricsRes] = tenantRows(await db.execute(sqlFn`
        SELECT
          (SELECT COUNT(*)::int FROM conversations WHERE workspace_id=${wsId}::uuid AND COALESCE(is_simulation,false)=false AND created_at >= ${since30}) AS conv30,
          (SELECT MAX(updated_at) FROM conversations WHERE workspace_id=${wsId}::uuid AND COALESCE(is_simulation,false)=false) AS last_activity
      `));
      const m: any = metricsRes || {};
      const sess = Number(m.sessions30) || 0;

      res.json({ ok: true, data: {
        workspace: { ...ws, blocked: ws.status === "blocked" },
        users: usersList,
        connections: conns,
        planos: planosList,
        aiKey,
        metrics: {
          conversas30d: Number(m.conv30) || 0,
          lastActivity: m.last_activity || null,
          ispSessions30d: sess,
          escalacaoPct: sess > 0 ? Math.round(((Number(m.escaladas) || 0) / sess) * 100) : null,
          csat: m.csat != null ? Number(m.csat) : null,
          evalP0: Number(m.p0) || 0,
        },
      } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.post("/api/super-admin/tenants/:id/block", requireSuperAdmin, async (req, res) => {
    try {
      const { setWorkspaceBlocked } = await import("../services/tenantBlocklist");
      await setWorkspaceBlocked((req.params.id as string), true);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.post("/api/super-admin/tenants/:id/unblock", requireSuperAdmin, async (req, res) => {
    try {
      const { setWorkspaceBlocked } = await import("../services/tenantBlocklist");
      await setWorkspaceBlocked((req.params.id as string), false);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Cliente VIP (cortesia): isento de cobrança/bloqueio por não-pagamento. { vip: boolean }
  app.post("/api/super-admin/tenants/:id/vip", requireSuperAdmin, async (req, res) => {
    try {
      const { setWorkspaceVip } = await import("../services/subscriptionGate");
      await setWorkspaceVip((req.params.id as string), req.body?.vip === true);
      res.json({ ok: true, vip: req.body?.vip === true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Define/estende/limpa o trial: { days: number } (0 ou null limpa o trial).
  app.post("/api/super-admin/tenants/:id/trial", requireSuperAdmin, async (req, res) => {
    try {
      const { workspaces: wsTable } = await import("@shared/schema");
      const days = Number(req.body?.days);
      const expires = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
      await db.update(wsTable).set({ trialExpiresAt: expires, updatedAt: new Date() }).where(eq(wsTable.id, (req.params.id as string)));
      // Auditoria 2026-06-20: recomputa o gate de inadimplência na hora (igual /vip e o
      // webhook Asaas) — sem isto, zerar o trial só refletia no paywall no próximo loadGate (~6h).
      await import("../services/subscriptionGate").then(m => m.refreshWorkspace((req.params.id as string))).catch(() => {});
      res.json({ ok: true, trialExpiresAt: expires });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Atribui/troca/limpa o plano do tenant (manual): { planoId: string | null }.
  // Override administrativo do plano exibido/limites — NÃO altera a assinatura
  // Asaas (o tenant assina pelo billing). Útil p/ VIP, cortesia e deals manuais.
  app.post("/api/super-admin/tenants/:id/plano", requireSuperAdmin, async (req, res) => {
    try {
      const { workspaces: wsTable, planos: planosTable } = await import("@shared/schema");
      const planoId = req.body?.planoId || null;
      if (planoId) {
        const [p] = await db.select().from(planosTable).where(eq(planosTable.id, planoId)).limit(1);
        if (!p) return res.status(400).json({ error: "Plano não encontrado" });
      }
      await db.update(wsTable).set({ planoId, updatedAt: new Date() }).where(eq(wsTable.id, (req.params.id as string)));
      await import("../services/subscriptionGate").then(m => m.refreshWorkspace((req.params.id as string))).catch(() => {});
      res.json({ ok: true, planoId });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Entrar como o tenant (impersonação) — mints um JWT de tenant pro admin do
  // workspace (2h). O super-admin abre o painel do cliente com esse token.
  app.post("/api/super-admin/tenants/:id/impersonate", requireSuperAdmin, async (req, res) => {
    try {
      const wsId = req.params.id as string;
      const { users: usersTable, workspaces: wsTable } = await import("@shared/schema");
      const [ws] = await db.select().from(wsTable).where(eq(wsTable.id, wsId)).limit(1);
      if (!ws) return res.status(404).json({ error: "Tenant não encontrado" });
      const wsUsers = await db.select().from(usersTable).where(eq(usersTable.workspaceId, wsId)).orderBy(usersTable.id);
      const adminUser = wsUsers.find((u: any) => u.role === "admin") || wsUsers[0];
      if (!adminUser) return res.status(404).json({ error: "Tenant sem usuários — não há quem impersonar" });
      // tv = token_version vigente do usuário impersonado (auditoria 2026-06-20). SEM
      // isso o JWT entra com tv=0; se o admin do tenant já teve logout/reset (versão > 0),
      // o requireAuth recusa com 401 "sessão revogada" → o front desloga e cai no /login
      // (era o "pede login e senha" ao Entrar como tenant). Copiar a versão real entra direto.
      const payload = { id: adminUser.id, email: adminUser.email, role: adminUser.role, nome: adminUser.nome, workspaceId: wsId, accountType: (adminUser as any).accountType || (ws as any).accountType || "empreendedor", impersonating: true, tv: Number((adminUser as any).tokenVersion ?? 0) };
      const tk = jwt.sign(payload, JWT_SECRET as string, { expiresIn: "2h" });
      const { password: _p, inviteToken: _t, ...safe } = adminUser as any;
      res.json({ ok: true, token: tk, user: { ...safe, workspaceId: wsId } });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Resetar a senha de um usuário do tenant — gera senha temporária e devolve pro
  // super-admin repassar. O usuário troca depois no painel dele.
  app.post("/api/super-admin/tenants/:id/users/:userId/reset-password", requireSuperAdmin, async (req, res) => {
    try {
      const wsId = req.params.id as string;
      const userId = parseInt(req.params.userId as string, 10);
      const { users: usersTable } = await import("@shared/schema");
      const [u] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.workspaceId, wsId))).limit(1);
      if (!u) return res.status(404).json({ error: "Usuário não encontrado neste tenant" });
      const { hashPassword } = await import("../utils/helpers");
      const { randomBytes } = await import("crypto");
      const temp = "CB-" + randomBytes(4).toString("hex");
      await db.update(usersTable).set({ password: hashPassword(temp) }).where(eq(usersTable.id, userId));
      // Revogação de sessão (auditoria 2026-06-20): reset de senha derruba os tokens
      // atuais do usuário (sessão potencialmente comprometida).
      await bumpTokenVersion(userId).catch(() => {});
      res.json({ ok: true, tempPassword: temp, email: u.email });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Renomear o tenant. { nome }
  app.post("/api/super-admin/tenants/:id/rename", requireSuperAdmin, async (req, res) => {
    try {
      const nome = String(req.body?.nome || "").trim();
      if (nome.length < 2) return res.status(400).json({ error: "Nome muito curto" });
      const { workspaces: wsTable } = await import("@shared/schema");
      await db.update(wsTable).set({ nome, updatedAt: new Date() }).where(eq(wsTable.id, (req.params.id as string)));
      res.json({ ok: true, nome });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Excluir = ARQUIVAR (soft-delete): some da lista, barra login e derruba sessões.
  // NÃO apaga dados (88 tabelas com workspace_id, FKs mistas) — purga real só via
  // script supervisionado. Reversível pelo botão Restaurar. Bruno 2026-06-15.
  app.delete("/api/super-admin/tenants/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { archiveWorkspace } = await import("../services/tenantBlocklist");
      await archiveWorkspace(req.params.id as string);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  app.post("/api/super-admin/tenants/:id/restore", requireSuperAdmin, async (req, res) => {
    try {
      const { restoreWorkspace } = await import("../services/tenantBlocklist");
      await restoreWorkspace(req.params.id as string);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // ── Protocolo de Avaliação de Conversas (F2: fila de revisão humana) ──────
  // REMOVIDO junto com o módulo ISP (tabela conversation_evaluations / LLM-juiz).
  // Rotas mantidas com assinatura no-op (data vazia) pra não quebrar o frontend.
  // O seletor de tenants continua funcional pois não depende da tabela removida.
  app.get("/api/super-admin/avaliacoes", requireSuperAdmin, async (req, res) => {
    try {
      const { sql: s } = await import("drizzle-orm");
      // Lista TODOS os tenants (não-arquivados) pro seletor do painel.
      const wsRes: any = await db.execute(s`
        SELECT id AS workspace_id, nome FROM workspaces
        WHERE status IS DISTINCT FROM 'deleted' ORDER BY nome`);
      res.json({ ok: true, data: [], summary: {}, workspaces: wsRes?.rows ?? [] });
    } catch (e: any) { console.error("[avaliacoes] list erro:", e); res.status(500).json({ error: "Erro interno" }); }
  });

  // F3 — Painel de saúde do agente (conversation_evaluations) REMOVIDO junto com
  // o módulo ISP. No-op com o mesmo shape vazio pra não quebrar o frontend.
  app.get("/api/super-admin/avaliacoes-health", requireSuperAdmin, async (_req, res) => {
    res.json({ ok: true, data: {
      total: 0,
      byVerdict: { aprovada: 0, revisar: 0, reprovada: 0 },
      avgOverall: null,
      avgByBlock: {},
      paramFails: [],
      p0: [],
      trend: [],
      csat: { avg: null, n: 0 },
      review: { reviewed: 0, pending: 0, divergencias: 0 },
    }});
  });

  // Detalhe de avaliação (conversation_evaluations) REMOVIDO — sempre 404.
  app.get("/api/super-admin/avaliacoes/:id", requireSuperAdmin, async (_req, res) => {
    res.status(404).json({ error: "Avaliacao nao encontrada" });
  });

  // Revisão humana de avaliação (conversation_evaluations) REMOVIDO — sempre 404.
  app.patch("/api/super-admin/avaliacoes/:id", requireSuperAdmin, async (req, res) => {
    const { humanVerdict } = req.body || {};
    if (humanVerdict && !["aprovada", "reprovada", "revisar"].includes(humanVerdict))
      return res.status(400).json({ error: "humanVerdict invalido" });
    res.status(404).json({ error: "Avaliacao nao encontrada" });
  });

  // F4 "Avaliar agora" (avaliacoes-run / avaliacoes-run/:jobId) removido junto com
  // o módulo ISP de avaliação LLM-juiz (conversationEvaluatorDb).

  app.post("/api/ai/implement-prompt", requireAuth, async (req, res) => {
    try {
      const { currentPrompt, implementation } = req.body;
      if (!currentPrompt || !implementation) return res.status(400).json({ error: "Prompt atual e instrucao de implementacao sao obrigatorios" });
      const wsId = req.user!.workspaceId;
      const { resolveOpenAIKeys: resolveKeysImpl } = await import("../services/openaiKeyResolver");
      const implCandidates = await resolveKeysImpl(wsId);
      if (implCandidates.length === 0) return res.status(400).json({ error: "OpenAI API Key nao configurada. Configure em Integracoes > OpenAI." });
      const OpenAI = (await import("openai")).default;
      const openai = getOpenAIClient({ apiKey: implCandidates[0].apiKey, baseURL: implCandidates[0].baseURL });
      const response = await openai.chat.completions.create({
        model: "gpt-4o", temperature: 0.3,
        messages: [
          { role: "system", content: `Voce e um especialista em criar e otimizar prompts de sistema para assistentes de IA de atendimento via WhatsApp.\n\nSua tarefa: receber um PROMPT ATUAL de um assistente de IA e uma INSTRUCAO DE IMPLEMENTACAO do usuario, e retornar o prompt MODIFICADO incorporando a implementacao solicitada.\n\nREGRAS OBRIGATORIAS:\n1. MANTENHA toda a estrutura, formatacao, tom de voz e conteudo original do prompt que NAO precisa ser alterado.\n2. MODIFIQUE apenas as partes necessarias para implementar a instrucao do usuario.\n3. Se a instrucao adiciona um novo comportamento, INSIRA no local mais logico do prompt.\n4. Se a instrucao muda um comportamento existente, SUBSTITUA apenas a parte relevante.\n5. Mantenha a mesma linguagem (portugues) e estilo de escrita do prompt original.\n6. NAO adicione comentarios, explicacoes ou notas sobre o que foi alterado.\n7. NAO remova informacoes importantes do prompt original que nao conflitam com a implementacao.\n8. Retorne APENAS o prompt modificado completo, sem nenhum texto adicional antes ou depois.\n9. Se o prompt original usa formatacao com ** ou -, mantenha o mesmo estilo.\n10. Integre a mudanca de forma NATURAL e COERENTE com o restante do prompt.` },
          { role: "user", content: `PROMPT ATUAL:\n---\n${currentPrompt}\n---\n\nINSTRUCAO DE IMPLEMENTACAO:\n${implementation}\n\nRetorne o prompt completo modificado:` }
        ]
      });
      const newPrompt = response.choices?.[0]?.message?.content?.trim();
      if (!newPrompt) return res.status(500).json({ error: "IA nao retornou resposta" });
      res.json({ newPrompt });
    } catch (e: any) { console.error("[AI Implement Prompt] Error:", e.message); res.status(500).json({ error: "Erro interno" }); }
  });

  app.get("/api/stripe/publishable-key", requireAuth, async (_req, res) => {
    try { const { getStripePublishableKey } = await import("../stripeClient"); const key = await getStripePublishableKey(); res.json({ publishableKey: key }); }
    catch (e: any) { console.error("[Stripe] Error getting publishable key:", e.message); res.status(500).json({ error: "Stripe nao configurado" }); }
  });

  app.get("/api/stripe/products", requireAuth, async (_req, res) => {
    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      const products = await stripe.products.list({ active: true, expand: ["data.default_price"] });
      const prices = await stripe.prices.list({ active: true, type: "recurring" });
      const result = products.data.filter((p: any) => p.metadata?.slug).map((product: any) => {
        const productPrices = prices.data.filter((pr: any) => pr.product === product.id);
        return { id: product.id, name: product.name, description: product.description, metadata: product.metadata, prices: productPrices.map((pr: any) => ({ id: pr.id, unitAmount: pr.unit_amount, currency: pr.currency, interval: pr.recurring?.interval, type: pr.metadata?.type })) };
      });
      res.json(result);
    } catch (e: any) { console.error("[Stripe] Error listing products:", e.message); res.status(500).json({ error: "Erro interno" }); }
  });

  function getBaseUrl(req: any): string {
    // Bruno 2026-06-09 — desacoplado do Replit. FRONTEND_URL (setada no EasyPanel,
    // ex: https://app.chatbanana.com.br) é a fonte canônica; fallback no host da request.
    const frontendUrl = process.env.FRONTEND_URL?.trim();
    if (frontendUrl) return frontendUrl.replace(/\/+$/, "");
    const host = req.headers.host || "";
    return `https://${host}`;
  }

  app.post("/api/stripe/create-checkout", requireAuth, async (req, res) => {
    try {
      const { priceId } = req.body;
      const workspaceId = req.user!.workspaceId;
      const userId = req.user!.id;
      const email = req.user!.email;
      if (!priceId) return res.status(400).json({ error: "priceId obrigatorio" });
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws) return res.status(404).json({ error: "Workspace nao encontrado" });
      let customerId = ws.stripeCustomerId;
      if (!customerId) { const customer = await stripe.customers.create({ email, metadata: { workspaceId, userId: String(userId) } }); customerId = customer.id; await db.update(workspaces).set({ stripeCustomerId: customerId }).where(eq(workspaces.id, workspaceId)); }
      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({ customer: customerId, mode: "subscription", payment_method_types: ["card"], line_items: [{ price: priceId, quantity: 1 }], success_url: `${baseUrl}/perfil?stripe=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl}/perfil?stripe=cancel`, metadata: { workspaceId, userId: String(userId) }, subscription_data: { metadata: { workspaceId, userId: String(userId) } } });
      res.json({ url: session.url, sessionId: session.id });
    } catch (e: any) { console.error("[Stripe Checkout] Error:", e.message); res.status(500).json({ error: "Erro interno" }); }
  });

  app.post("/api/stripe/create-portal", requireAuth, async (req, res) => {
    try {
      const workspaceId = req.user!.workspaceId;
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws?.stripeCustomerId) return res.status(400).json({ error: "Workspace sem customer Stripe" });
      const baseUrl = getBaseUrl(req);
      const session = await stripe.billingPortal.sessions.create({ customer: ws.stripeCustomerId, return_url: `${baseUrl}/perfil` });
      res.json({ url: session.url });
    } catch (e: any) { console.error("[Stripe Portal] Error:", e.message); res.status(500).json({ error: "Erro interno" }); }
  });

  app.get("/api/stripe/subscription", requireAuth, async (req, res) => {
    try {
      const workspaceId = req.user!.workspaceId;
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws) return res.status(404).json({ error: "Workspace nao encontrado" });
      if (!ws.stripeSubscriptionId) return res.json({ status: "none", plan: null, currentPeriodEnd: null });
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      const sub = await stripe.subscriptions.retrieve(ws.stripeSubscriptionId);
      await db.update(workspaces).set({ stripeSubscriptionStatus: sub.status, stripePriceId: (sub as any).items?.data?.[0]?.price?.id || null, stripeCurrentPeriodEnd: new Date((sub as any).current_period_end * 1000) }).where(eq(workspaces.id, workspaceId));
      res.json({ status: sub.status, priceId: (sub as any).items?.data?.[0]?.price?.id, currentPeriodEnd: (sub as any).current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end });
    } catch (e: any) { console.error("[Stripe Subscription] Error:", e.message); res.status(500).json({ error: "Erro interno" }); }
  });

  // ─── Template source admin (super_admin only) ──────────────────────────
  // Marca um workspace como template_source — novos tenants vão herdar dele.
  app.post("/api/admin/template/mark/:workspaceId", requireSuperAdmin, async (req, res) => {
    try {
      const workspaceId = String(((req.params.workspaceId as string) as string));
      const { tenantSettingsService } = await import("../services/tenantSettingsService");
      const result = await tenantSettingsService.setTemplateSource(workspaceId);
      if (!result.ok) return res.status(400).json({ error: result.reason });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Re-aplica o template atual em um workspace específico.
  // ?overwrite=true → sobrescreve situações que já existem no destino
  // (default: false → só adiciona as que faltam)
  app.post("/api/admin/template/apply/:workspaceId", requireSuperAdmin, async (req, res) => {
    try {
      const workspaceId = String(((req.params.workspaceId as string) as string));
      const overwrite = String(((req.query.overwrite as string | undefined) as string | undefined) || '').toLowerCase() === 'true';
      const { tenantSettingsService } = await import("../services/tenantSettingsService");
      const result = await tenantSettingsService.applyTemplateToExistingTenant(workspaceId, { overwriteSituations: overwrite });
      res.json({ ok: true, ...result });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });

  // Lista workspaces com contagem de situações e flag de template
  app.get("/api/admin/template/status", requireSuperAdmin, async (_req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      // situations_count vinha de isp_situation_prompts (removido com o módulo ISP) → 0.
      const rows = await db.execute<any>(sql`
        SELECT
          w.id, w.nome, w.is_template_source,
          0::int AS situations_count,
          EXISTS(SELECT 1 FROM tenant_settings WHERE tenant_id = w.id) AS has_settings,
          (SELECT settings_json->'questionnaire'->>'appliedAt' FROM tenant_settings WHERE tenant_id = w.id) AS questionnaire_applied_at
        FROM workspaces w
        ORDER BY w.is_template_source DESC NULLS LAST, w.created_at ASC
      `);
      const data = (rows as any)?.rows ?? rows;
      res.json({ ok: true, workspaces: data });
    } catch (e: any) { res.status(500).json({ error: safeErr(e, "[admin]") }); }
  });
}
