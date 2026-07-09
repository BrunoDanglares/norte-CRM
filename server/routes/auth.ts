import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { requireAuth, JWT_SECRET } from "../middleware/auth";
import { hashPassword, verifyPassword, autoAssignAdminToAllTeams, fetchWithTimeout } from "../utils/helpers";
import { db } from "../db";
import { teamMembers, authSessions, users } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { isSuperAdminEmail } from "../utils/superAdmin";
import { isWorkspaceBlocked } from "../services/tenantBlocklist";
import { isEmailConfigured } from "../services/emailService";
import { requestLoginCode, verifyLoginCode, CODE_TTL_MINUTES, type LoginChannel } from "../services/loginCodeService";
import { verifyTurnstile } from "../utils/turnstile";
import { bumpTokenVersion } from "../services/tokenVersionStore";

// Client ID do OAuth do Google (Google Cloud Console). Lido em RUNTIME — trocar o
// valor no EasyPanel não exige rebuild do front (o front busca em /api/auth/config).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

// IP real atrás do proxy (EasyPanel/nginx) — pega o 1º X-Forwarded-For, cai
// pro req.ip / socket. Best-effort: nunca derruba login se faltar.
function clientIp(req: any): string | null {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || null;
}

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Pedido de código de login (OTP) — limite mais apertado que o login normal.
const loginCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Muitas solicitações de código. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cadastro/trial (auditoria 2026-06-20): limite dedicado por IP. Sem ele, o /register
// só caía no apiLimiter global (2000/15min) → dava pra (1) enumerar quem tem conta pelo
// 409 "Email já cadastrado" e (2) criar workspaces em massa (cada cadastro provisiona
// workspace + pipelines + tags + seed = caro). Skip em dev pra não atrapalhar teste local.
const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,
  message: { error: "Muitas tentativas de cadastro. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
});

// Abre uma sessão de auth (relatório de Logs). Best-effort: nunca derruba o login.
// Fecha sessões abertas anteriores do mesmo usuário (no máx. 1 sessão aberta).
async function openAuthSession(user: any, req: Request): Promise<void> {
  try {
    const wsId = user.workspaceId && user.workspaceId.length ? user.workspaceId : null;
    await db.update(authSessions)
      .set({ logoutAt: new Date() })
      .where(and(eq(authSessions.userId, user.id), isNull(authSessions.logoutAt)));
    await db.insert(authSessions).values({
      workspaceId: wsId as any,
      userId: user.id,
      userNome: user.nome,
      ip: clientIp(req),
      userAgent: String(req.headers["user-agent"] || "") || null,
    });
  } catch (e: any) {
    console.warn("[Auth] falha ao registrar sessão de login:", e?.message);
  }
}

// Emite o JWT + abre sessão + devolve o payload padrão de login. Único caminho de
// "entrar com sucesso" — compartilhado por senha, Google e código (OTP).
async function finalizeLogin(req: Request, res: Response, user: any) {
  if (user.status === "INACTIVE") return res.status(403).json({ error: "Usuario desativado. Contate o administrador." });
  if (user.status === "INVITED") return res.status(403).json({ error: "Conta nao ativada. Verifique seu e-mail." });
  if (isWorkspaceBlocked(user.workspaceId)) return res.status(403).json({ error: "Conta bloqueada. Contate o suporte." });
  const ws = user.workspaceId ? await storage.getWorkspace(user.workspaceId) : null;
  const userAcctType = (user as any).accountType || ws?.accountType || "empreendedor";
  const payload = { id: user.id, email: user.email, role: user.role, nome: user.nome, workspaceId: user.workspaceId || "", accountType: userAcctType, tv: (user as any).tokenVersion ?? 0 };
  const token = jwt.sign(payload, JWT_SECRET as string, { expiresIn: "7d" });
  await storage.updateUser(user.id, { ultimoAcesso: new Date(), online: true } as any);
  await openAuthSession(user, req);
  return res.json({
    ok: true,
    data: {
      token,
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role, cargo: user.cargo, avatar: user.avatar, avatarUrl: user.avatarUrl, status: user.status, online: true, tema: user.tema, colorPreset: user.colorPreset, workspaceId: user.workspaceId, accountType: userAcctType },
    },
  });
}

// Cria workspace + admin com TODOS os efeitos colaterais do cadastro (pipelines,
// quick replies, tags, equipes, módulo ISP, seed do template). Compartilhado pelo
// /register (senha) e pelo /google/complete-signup. Bruno 2026-06-15.
async function provisionWorkspaceAndAdmin(params: {
  workspaceName: string;
  nome: string;
  email: string;
  password: string;
  accountType: "gestor" | "empreendedor";
  selectedPlan?: string;
  googleId?: string | null;
  avatarUrl?: string | null;
  authProvider?: string;
}): Promise<{ workspace: any; user: any }> {
  // Auditoria 2026-06-19: cadastro público SEMPRE nasce no plano de ENTRADA + TRIAL.
  // O tier pago só é atribuído pelo fluxo do Asaas (pendingPlanoId→planoId no
  // pagamento confirmado) ou pelo super-admin — NUNCA pelo selected_plan do corpo.
  // Antes dava pra se auto-atribuir "enterprise"/ilimitado de graça E ficar imune
  // ao paywall (cadastro sem trialExpiresAt caía no grandfather). "gestor" é legado
  // morto → todo cadastro é empreendedor (tenant admin do próprio provedor).
  const acctType = "empreendedor";
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 14);
  const wsData: any = {
    nome: params.workspaceName,
    status: "ACTIVE",
    accountType: acctType,
    trialExpiresAt: trialEnd,
    partnerPlan: "trial",
  };
  try {
    const plano = await storage.getPlanoBySlug("essencial");
    if (plano) wsData.planoId = plano.id;
  } catch (e: any) { console.error("[Provision] planoId default falhou:", e.message); }
  const workspace = await storage.createWorkspace(wsData);

  const hashedPassword = hashPassword(params.password);
  const username = params.email.toLowerCase().trim().split("@")[0] + "_" + Date.now();
  const user = await storage.createUser({
    username,
    password: hashedPassword,
    nome: params.nome,
    email: params.email.toLowerCase().trim(),
    role: "admin",
    status: "ACTIVE",
    workspaceId: workspace.id,
    online: false,
    accountType: acctType,
    googleId: params.googleId || null,
    authProvider: params.authProvider || "local",
    avatarUrl: params.avatarUrl || null,
  } as any);

  const wsPfx = workspace.id.substring(0, 8);
  const UNIVERSAL_STAGES = [
    { prefix: "novo",               label: "Novo",               color: "#5b93d3", ordem: 0 },
    { prefix: "em_automacao",       label: "Em Automação",       color: "#f59e0b", ordem: 1 },
    { prefix: "aguardando",         label: "Aguardando",         color: "#a855f7", ordem: 2 },
    { prefix: "atendimento_humano", label: "Atendimento Humano", color: "#3b82f6", ordem: 3 },
    { prefix: "finalizado",         label: "Finalizado",         color: "#10b981", ordem: 4 },
  ];
  for (const pipeline of ["comercial", "suporte", "financeiro"]) {
    for (const st of UNIVERSAL_STAGES) {
      await storage.createPipelineStage({
        key: `${st.prefix}_${wsPfx}`,
        label: st.label,
        color: st.color,
        ordem: st.ordem,
        pipeline,
        workspaceId: workspace.id,
      });
    }
  }

  await storage.ensureDefaultQuickReplies(workspace.id);

  const defaultTags = [
    { nome: "Novo", cor: "#22c55e", workspaceId: workspace.id },
    { nome: "Parceiro", cor: "#06b6d4", workspaceId: workspace.id },
    { nome: "Premium", cor: "#a855f7", workspaceId: workspace.id },
    { nome: "Quente", cor: "#ef4444", workspaceId: workspace.id },
    { nome: "Urgente", cor: "#dc2626", workspaceId: workspace.id },
    { nome: "VIP", cor: "#f59e0b", workspaceId: workspace.id },
  ];
  for (const tag of defaultTags) {
    try { await storage.createLeadTag(tag); } catch {}
  }

  await autoAssignAdminToAllTeams(workspace.id, user.id);

  try {
    await storage.upsertIntegrationConfig(workspace.id, "isp", true, {});
    console.log(`[Auth] ISP module auto-enabled for new workspace ${workspace.id}`);
  } catch (e: any) {
    console.error(`[Auth] Failed to auto-enable ISP for workspace ${workspace.id}:`, e.message);
  }

  try {
    const { tenantSettingsService } = await import("../services/tenantSettingsService");
    const seeded = await tenantSettingsService.seedNewTenantFromTemplate(workspace.id);
    console.log(`[Auth] Template seeded for ${workspace.id}: settings=${seeded.seededSettings}, situations=${seeded.seededSituations}`);
  } catch (e: any) {
    console.error(`[Auth] Failed to seed template for ${workspace.id}:`, e.message);
  }

  return { workspace, user };
}

// Valida a credencial (ID token) do "Sign in with Google" usando o endpoint
// tokeninfo do Google (zero dependências novas — o Google valida assinatura/expiração;
// nós conferimos a audiência e o e-mail verificado). Bruno 2026-06-15.
async function verifyGoogleCredential(credential: string): Promise<
  | { ok: true; sub: string; email: string; name: string; picture: string | null }
  | { ok: false; error: string }
> {
  if (!GOOGLE_CLIENT_ID) return { ok: false, error: "Login com Google não está configurado." };
  if (!credential) return { ok: false, error: "Credencial do Google ausente." };
  try {
    const resp = await fetchWithTimeout(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { method: "GET" },
      8000,
    );
    if (!resp.ok) return { ok: false, error: "Token do Google inválido." };
    const data: any = await resp.json();
    if (data.aud !== GOOGLE_CLIENT_ID) return { ok: false, error: "Token do Google não é deste aplicativo." };
    const emailVerified = data.email_verified === true || data.email_verified === "true";
    if (!data.email || !emailVerified) return { ok: false, error: "E-mail do Google não verificado." };
    const email = String(data.email).toLowerCase().trim();
    return {
      ok: true,
      sub: String(data.sub),
      email,
      name: data.name || data.given_name || email.split("@")[0],
      picture: data.picture || null,
    };
  } catch {
    return { ok: false, error: "Falha ao validar com o Google. Tente novamente." };
  }
}

export function registerAuthRoutes(app: Express) {
  // Config pública do front (qual login social está ligado). Sem segredos.
  app.get("/api/auth/config", (_req, res) => {
    res.json({ ok: true, data: { googleClientId: GOOGLE_CLIENT_ID || null, emailConfigured: isEmailConfigured(), turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null } });
  });
  app.post("/api/auth/login", loginRateLimit, async (req, res) => {
    try {
      const { email, senha } = req.body;
      if (!email || !senha) return res.status(400).json({ error: "Email e senha sao obrigatorios" });
      const normalizedEmail = email?.toLowerCase().trim();
      const user = await storage.getUserByEmail(normalizedEmail);
      if (!user) return res.status(401).json({ error: "Credenciais invalidas" });
      // Auditoria 2026-06-19: os checks de status (INACTIVE/INVITED/workspace bloqueado)
      // só rodam DEPOIS do verifyPassword (via finalizeLogin, que já os repete) — antes
      // eles vazavam existência+estado da conta a quem não tem a senha (enumeração de
      // usuário). Sem senha válida → sempre 401 genérico.
      if (!verifyPassword(senha, user.password)) return res.status(401).json({ error: "Credenciais invalidas" });
      return finalizeLogin(req, res, user);
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.post("/api/auth/register", registerRateLimit, async (req, res) => {
    try {
      const { workspace_name, nome, email, senha, account_type, selected_plan } = req.body;
      const acctType = account_type === "gestor" ? "gestor" : "empreendedor";

      if (!workspace_name || !nome || !email || !senha)
        return res.status(400).json({ error: "Todos os campos sao obrigatorios" });

      if (senha.length < 8)
        return res.status(400).json({ error: "Senha deve ter no minimo 8 caracteres" });

      // Captcha (auditoria 2026-06-20): no-op enquanto TURNSTILE_SECRET não estiver setado.
      const captchaOk = await verifyTurnstile(req.body?.turnstileToken, clientIp(req));
      if (!captchaOk)
        return res.status(400).json({ error: "Verificação de segurança falhou. Recarregue a página e tente novamente." });

      const existing = await storage.getUserByEmail(email.toLowerCase().trim());
      if (existing)
        return res.status(409).json({ error: "Email ja cadastrado" });

      const { workspace, user } = await provisionWorkspaceAndAdmin({
        workspaceName: workspace_name,
        nome,
        email,
        password: senha,
        accountType: acctType,
        selectedPlan: selected_plan,
      });

      const payload = { id: user.id, email: user.email, role: user.role, nome: user.nome, workspaceId: workspace.id, accountType: acctType };
      const token = jwt.sign(payload, JWT_SECRET as string, { expiresIn: "7d" });

      res.status(201).json({
        ok: true,
        data: {
          token,
          user: { id: user.id, nome: user.nome, email: user.email, role: user.role, status: user.status, workspaceId: workspace.id, accountType: acctType },
          workspace: { id: workspace.id, name: workspace_name, accountType: acctType },
        },
      });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  // ── Entrar com Google (Sign in with Google) ──────────────────────────────
  // Recebe o ID token (credential) do botão do Google no front. Se o e-mail já
  // tem conta → entra (vincula google_id). Se não → devolve needsSignup + um
  // token curto pro cadastro rápido pré-preenchido. Bruno 2026-06-15.
  app.post("/api/auth/google", loginRateLimit, async (req, res) => {
    try {
      const { credential } = req.body;
      const v = await verifyGoogleCredential(credential);
      if (!v.ok) return res.status(401).json({ error: v.error });

      // 1) Por google_id; 2) por e-mail (vincula contas senha existentes).
      let user: any = (await db.select().from(users).where(eq(users.googleId, v.sub)).limit(1))[0];
      if (!user) user = await storage.getUserByEmail(v.email);

      if (user) {
        const patch: any = {};
        if (!user.googleId) patch.googleId = v.sub;
        if (!user.avatarUrl && v.picture) patch.avatarUrl = v.picture;
        if (Object.keys(patch).length) {
          await storage.updateUser(user.id, patch);
          Object.assign(user, patch);
        }
        return finalizeLogin(req, res, user);
      }

      // Conta nova → cadastro rápido pré-preenchido (front coleta nome do provedor + plano).
      const googleSignupToken = jwt.sign(
        { purpose: "google_signup", sub: v.sub, email: v.email, name: v.name, picture: v.picture },
        JWT_SECRET as string,
        { expiresIn: "20m" },
      );
      return res.json({ ok: true, data: { needsSignup: true, googleSignupToken, email: v.email, nome: v.name } });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.post("/api/auth/google/complete-signup", registerRateLimit, async (req, res) => {
    try {
      const { googleSignupToken, workspace_name, selected_plan } = req.body;
      if (!googleSignupToken || !workspace_name) return res.status(400).json({ error: "Informe o nome do provedor." });

      let decoded: any;
      try { decoded = jwt.verify(googleSignupToken, JWT_SECRET as string); }
      catch { return res.status(401).json({ error: "Sessão de cadastro expirou. Entre com o Google de novo." }); }
      if (decoded?.purpose !== "google_signup" || !decoded?.email) return res.status(400).json({ error: "Token de cadastro inválido." });

      const email = String(decoded.email).toLowerCase().trim();
      // Corrida: se o e-mail virou conta nesse meio tempo, vincula e entra.
      const existing: any = await storage.getUserByEmail(email);
      if (existing) {
        if (!existing.googleId) { await storage.updateUser(existing.id, { googleId: decoded.sub } as any); existing.googleId = decoded.sub; }
        return finalizeLogin(req, res, existing);
      }

      const randomPw = randomBytes(24).toString("hex");
      const { user } = await provisionWorkspaceAndAdmin({
        workspaceName: workspace_name,
        nome: decoded.name || email.split("@")[0],
        email,
        password: randomPw,
        accountType: "gestor",
        selectedPlan: selected_plan || "trial",
        googleId: decoded.sub,
        avatarUrl: decoded.picture || null,
        authProvider: "google",
      });
      return finalizeLogin(req, res, user);
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  // ── Login sem senha por código (OTP) — e-mail ou WhatsApp ─────────────────
  // Resposta SEMPRE genérica no request (anti-enumeração de contas).
  app.post("/api/auth/code/request", loginCodeRateLimit, async (req, res) => {
    try {
      const { email, channel } = req.body;
      if (!email) return res.status(400).json({ error: "Informe o e-mail." });
      const ch: LoginChannel = channel === "whatsapp" ? "whatsapp" : "email";
      await requestLoginCode({ email, channel: ch, ip: clientIp(req) });
      return res.json({ ok: true, data: { channel: ch, ttlMinutes: CODE_TTL_MINUTES } });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.post("/api/auth/code/verify", loginRateLimit, async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ error: "Informe o e-mail e o código." });
      const result = await verifyLoginCode({ email, code });
      if (!result.ok) return res.status(401).json({ error: result.error });
      return finalizeLogin(req, res, result.user);
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.post("/api/auth/register-invite", registerRateLimit, async (req, res) => {
    try {
      const { token: inviteToken, password } = req.body;
      if (!inviteToken || !password) return res.status(400).json({ error: "Token e senha obrigatorios" });
      if (password.length < 8) return res.status(400).json({ error: "Senha deve ter no minimo 8 caracteres" });

      const invite = await storage.getPartnerInvite(inviteToken);
      if (!invite) return res.status(404).json({ error: "Convite nao encontrado" });
      if (invite.status !== "pending") return res.status(400).json({ error: "Convite ja utilizado" });
      if (new Date() > invite.expiresAt) return res.status(400).json({ error: "Convite expirado" });

      const existing = await storage.getUserByEmail(invite.clientEmail.toLowerCase().trim());
      if (existing) return res.status(409).json({ error: "Email ja cadastrado" });

      const result = await storage.createClientWorkspace({
        partnerWorkspaceId: invite.partnerWorkspaceId,
        businessName: invite.businessName,
        adminName: invite.clientName,
        adminEmail: invite.clientEmail,
        adminPassword: password,
      });

      await storage.updatePartnerInvite(invite.id, {
        status: "accepted",
        acceptedAt: new Date(),
        createdWorkspaceId: result.workspace.id,
      });

      await autoAssignAdminToAllTeams(result.workspace.id, result.user.id);

      const payload = { id: result.user.id, email: result.user.email, role: "admin", nome: result.user.nome, workspaceId: result.workspace.id };
      const jwtToken = jwt.sign(payload, JWT_SECRET as string, { expiresIn: "7d" });

      res.status(201).json({
        ok: true,
        data: {
          token: jwtToken,
          user: result.user,
          workspace: { id: result.workspace.id, name: invite.businessName },
        },
      });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.get("/api/partner/invites/info", async (req, res) => {
    try {
      const token = (req.query.token as string | undefined) as string;
      if (!token) return res.status(400).json({ error: "Token obrigatorio" });
      const invite = await storage.getPartnerInvite(token);
      if (!invite) return res.status(404).json({ error: "Convite nao encontrado" });
      const partnerWs = await storage.getWorkspace(invite.partnerWorkspaceId);
      res.json({
        ok: true,
        data: {
          clientName: invite.clientName,
          businessName: invite.businessName,
          partnerName: partnerWs?.nome || "Parceiro",
          status: invite.status,
          expired: new Date() > invite.expiresAt,
        },
      });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(401).json({ error: "Usuario nao encontrado" });
      const { password: _pwd, inviteToken: _token, ...safe } = user as any;
      const ws = user.workspaceId ? await storage.getWorkspace(user.workspaceId) : null;
      // Bruno 2026-05-21: expõe team membership do usuário pra gatear takeover
      // no front sem RPC extra. Admin sem nenhuma equipe vira espectador (não
      // assume conversa, mas pode mandar nota interna). Admin com equipes só
      // assume conversas atribuídas às SUAS equipes (ou ainda sem equipe).
      let teamIds: string[] = [];
      try {
        const rows = await db
          .select({ teamId: teamMembers.teamId })
          .from(teamMembers)
          .where(eq(teamMembers.userId, user.id));
        teamIds = rows.map(r => r.teamId);
      } catch (err: any) {
        console.warn(`[auth/me] team membership lookup err: ${err.message}`);
      }
      res.json({ ok: true, data: { ...safe, workspaceAccountType: ws?.accountType || "empreendedor", workspaceName: ws?.nome || null, teamIds, isSuperAdmin: isSuperAdminEmail(user.email) } });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    // Rota pública (cliente pode chamar já sem sessão válida). Lê o Bearer de
    // forma tolerante só pra fechar a sessão de auth aberta — nunca falha.
    try {
      const authz = String(req.headers.authorization || "");
      const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
      if (token) {
        try {
          const decoded: any = jwt.verify(token, JWT_SECRET as string);
          if (decoded?.id) {
            await db.update(authSessions)
              .set({ logoutAt: new Date(), lastSeenAt: new Date() })
              .where(and(eq(authSessions.userId, decoded.id), isNull(authSessions.logoutAt)));
            // Revogação real (auditoria 2026-06-20): incrementa a versão → o token cai
            // server-side (sai de todos os dispositivos). Antes o logout era cosmético.
            await bumpTokenVersion(Number(decoded.id)).catch(() => {});
          }
        } catch { /* token inválido/expirado — ignora */ }
      }
    } catch { /* best-effort */ }
    res.json({ ok: true, message: "Logout realizado" });
  });

  app.post("/api/auth/impersonate", requireAuth, async (req, res) => {
    try {
      const { token: impToken } = req.body;
      if (!impToken) return res.status(400).json({ error: "Token obrigatorio" });
      const result = await storage.validateImpersonationToken(impToken);
      if (!result.valid) return res.status(403).json({ error: "Token invalido ou expirado" });
      if (result.partnerWorkspaceId !== req.user!.workspaceId)
        return res.status(403).json({ error: "Token nao pertence a este workspace" });
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor")
        return res.status(403).json({ error: "Acesso restrito a gestores" });
      const targetUsers = await storage.getUsers(result.targetWorkspaceId as string);
      const adminUser = targetUsers.find(u => u.role === "admin");
      if (!adminUser) return res.status(404).json({ error: "Admin do workspace nao encontrado" });
      const payload = {
        id: adminUser.id, email: adminUser.email, role: adminUser.role, nome: adminUser.nome,
        workspaceId: result.targetWorkspaceId, impersonating: true, partnerWorkspaceId: result.partnerWorkspaceId,
        tv: (adminUser as any).tokenVersion ?? 0,
      };
      const jwtToken = jwt.sign(payload, JWT_SECRET as string, { expiresIn: "2h" });
      const { password: _p, inviteToken: _t, ...safe } = adminUser as any;
      res.json({ ok: true, data: { token: jwtToken, user: { ...safe, workspaceId: result.targetWorkspaceId } } });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });

  app.get("/api/admin/workspaces", requireAuth, async (req, res) => {
    try {
      if (req.user!.role !== "superadmin")
        return res.status(403).json({ error: "Acesso negado" });
      const allWorkspaces = await storage.getWorkspaces();
      const allUsers = await storage.getAllUsersAdmin();
      const result = [];
      for (const ws of allWorkspaces) {
        const wsUsers = allUsers.filter(u => u.workspaceId === ws.id);
        // internal - sem paginação intencional (superadmin - contagem de leads por workspace)
        const wsLeads = await storage.getLeads(ws.id, { limit: 10000 });
        result.push({
          id: ws.id,
          nome: ws.nome,
          status: ws.status,
          createdAt: ws.createdAt,
          users_count: wsUsers.length,
          leads_count: wsLeads.length,
        });
      }
      res.json({ ok: true, data: result });
    } catch (e: any) {
      console.error("[auth] erro 500:", e?.message); res.status(500).json({ error: "Erro interno. Tente novamente em instantes." });
    }
  });
}
