import type { Express } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, JWT_SECRET } from "../middleware/auth";
import { parseId, resolveWorkspaceId, hashPassword, autoAssignAllAdminsToTeam, safeErr } from "../utils/helpers";
import { sendInviteEmail, isEmailConfigured } from "../services/emailService";
import { db } from "../db";
import { leads, authSessions } from "@shared/schema";
import { sql, and, eq, isNotNull, isNull, gte } from "drizzle-orm";

// Bruno 2026-06-13 (auditoria de segurança): cargos com poder de gerenciar OUTROS
// usuários. `users.id` é serial GLOBAL e storage.updateUser/deleteUser não filtram
// por workspace — por isso toda rota de gestão valida (a) o alvo é do mesmo
// workspace e (b) o chamador tem cargo de gestão. Mudar `role` exige admin.
const ROLES_GESTAO = new Set(["admin", "gerente", "manager"]);
const podeGerenciar = (u: any): boolean => !!u && ROLES_GESTAO.has(u.role);
const isAdminRole = (u: any): boolean => !!u && u.role === "admin";

// Limite de assentos (usuários) do PLANO DO WORKSPACE + uso atual, escopado por
// workspace. Bruno 2026-06-15: antes era GLOBAL (contava todos os tenants e usava
// um plano fixo "business") — bug multi-tenant. Agora lê o plano do próprio
// workspace; limite null = ilimitado (Enterprise / sem plano = legado não barra).
async function getSeatInfo(wsId: string): Promise<{ used: number; limite: number | null; planoNome: string }> {
  const ws = await storage.getWorkspace(wsId);
  const plano = ws?.planoId ? await storage.getPlano(ws.planoId) : null;
  const limite = (plano as any)?.limiteUsuarios ?? null;
  const all = await storage.getUsers(wsId);
  const used = all.filter((u: any) => u.status === "ACTIVE" || u.status === "INVITED").length;
  return { used, limite, planoNome: plano?.nome || "—" };
}

export function registerUsuarioRoutes(app: Express) {
  app.get("/api/usuarios", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const allUsers = await storage.getUsers(wsId);
      const wsTeams = await storage.getTeams(wsId);
      const teamIds = wsTeams.map(t => t.id);
      let allMembers: any[] = [];
      if (teamIds.length > 0) {
        const { teamMembers: tmTable } = await import("@shared/schema");
        const { inArray } = await import("drizzle-orm");
        allMembers = await db.select().from(tmTable).where(inArray(tmTable.teamId, teamIds));
      }
      const membersByTeam: Record<string, any[]> = {};
      for (const m of allMembers) { if (!membersByTeam[m.teamId]) membersByTeam[m.teamId] = []; membersByTeam[m.teamId].push(m); }
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Agregação direta no banco — evita buscar todos os leads em memória
      const leadCounts = await db
        .select({ owner: leads.owner, count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.workspaceId, wsId), isNotNull(leads.owner), gte(leads.createdAt, monthStart)))
        .groupBy(leads.owner);
      const leadCountMap = new Map(leadCounts.map(r => [r.owner, r.count]));

      const enriched = allUsers.map((u) => {
        const userTeamRows: string[] = [];
        for (const t of wsTeams) { const members = membersByTeam[t.id] || []; if (members.some((m: any) => m.userId === u.id)) userTeamRows.push(t.nome); }
        const leadsMes = leadCountMap.get(u.nome) ?? 0;
        // inviteToken fora: a lista é visível a qualquer membro do tenant e o token aceita o convite (set senha/role).
        const { password: _pw, inviteToken: _it, ...safeUser } = u;
        return { ...safeUser, equipes: userTeamRows, performance: { leads_mes: leadsMes, conversas_mes: 0 } };
      });
      res.json({ ok: true, data: enriched });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.get("/api/usuarios/limit", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const seat = await getSeatInfo(wsId);
      res.json({ ok: true, data: { used: seat.used, limit: seat.limite, plano: seat.planoNome, nextPlano: null } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.get("/api/usuarios/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ ok: false, error: "Invalid ID" });
    try {
      const user = await storage.getUser(id);
      if (!user) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      const wsId = await resolveWorkspaceId(req);
      if (user.workspaceId && user.workspaceId !== wsId) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      const wsTeams = await storage.getTeams(wsId);
      const teamIds = wsTeams.map(t => t.id);
      let allMembersForUser: any[] = [];
      if (teamIds.length > 0) {
        const { db } = await import("../db");
        const { teamMembers: tmTable } = await import("@shared/schema");
        const { inArray } = await import("drizzle-orm");
        allMembersForUser = await db.select().from(tmTable).where(inArray(tmTable.teamId, teamIds));
      }
      const equipes: string[] = [];
      for (const t of wsTeams) { if (allMembersForUser.some((m: any) => m.teamId === t.id && m.userId === user.id)) equipes.push(t.nome); }
      // Agregação direta — conta leads do usuário no mês sem buscar todos em memória
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [leadCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(eq(leads.workspaceId, wsId), eq(leads.owner, user.nome), gte(leads.createdAt, monthStart)));
      const leadsMes = leadCountRow?.count ?? 0;
      const { password: _pw2, inviteToken: _it2, ...safeUserData } = user as any;
      res.json({ ok: true, data: { ...safeUserData, equipes, performance: { leads_mes: leadsMes, conversas_mes: 0 } } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.post("/api/usuarios/invite", requireAuth, async (req, res) => {
    try {
      // Auditoria 2026-06-19 (RBAC): provisionar conta é ação de gestão. Sem este
      // gate, um atendente comum convidava novos usuários pro tenant (sibling routes
      // de edit/status/delete já exigem cargo de gestão — agora a criação também).
      if (!podeGerenciar((req as any).user)) return res.status(403).json({ ok: false, error: "Apenas administradores podem convidar usuários" });
      const { email, role, equipe_id, equipe_ids } = req.body;
      if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "Email invalido" });
      const validRoles = ["manager", "agent", "gerente", "atendente"];
      if (!validRoles.includes(role)) return res.status(400).json({ ok: false, error: "Funcao deve ser gerente ou atendente" });
      const normalizedRole = role === "manager" ? "gerente" : role === "agent" ? "atendente" : role;
      const wsId = await resolveWorkspaceId(req);
      const seat = await getSeatInfo(wsId);
      if (seat.limite != null && seat.used >= seat.limite) return res.status(403).json({ ok: false, error: "Limite de usuarios do seu plano atingido", plano_atual: seat.planoNome, limite: seat.limite });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ ok: false, error: "Email ja cadastrado" });
      const inviteToken = randomUUID();
      const inviteExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const user = await storage.createUser({ username: email, password: "", nome: email.split("@")[0], email, role: normalizedRole, status: "INVITED", inviteToken, inviteExpiresAt, online: false, workspaceId: wsId });
      const teamIds: string[] = equipe_ids && Array.isArray(equipe_ids) ? equipe_ids : equipe_id ? [equipe_id] : [];
      const validTeamIds = teamIds.filter((id: string) => id && id !== "none");
      if (validTeamIds.length > 0) {
        const wsTeamsAll = await storage.getTeams(wsId);
        const wsTeamIdSet = new Set(wsTeamsAll.map(t => t.id));
        for (const tid of validTeamIds) {
          if (!wsTeamIdSet.has(tid)) continue;
          try { await storage.addTeamMember(tid, user.id); } catch (e) { console.error(`[Usuarios] Failed to add team member ${user.id} to team ${tid}:`, e); }
        }
      }
      const appUrl = process.env.FRONTEND_URL || `https://${process.env.REPLIT_DOMAINS?.split(",")[0] || "chatbanana.com.br"}`;
      const inviteLink = `${appUrl}/aceitar-convite?token=${inviteToken}`;
      let emailSent = false;
      try {
        const currentUser = (req as any).user;
        const inviterName = currentUser?.nome || "Um administrador";
        const workspace = await storage.getWorkspace(wsId);
        const wsName = workspace?.nome || "ChatBanana CRM";
        const wsTeams = await storage.getTeams(wsId);
        const assignedTeamNames = validTeamIds.map(tid => wsTeams.find(t => t.id === tid)?.nome).filter(Boolean) as string[];
        emailSent = await sendInviteEmail({ to: email, inviteLink, workspaceName: wsName, role: normalizedRole, teams: assignedTeamNames, invitedBy: inviterName });
      } catch (emailErr: any) { console.error("[Invite] Erro ao enviar email:", emailErr.message); }
      res.status(201).json({ ok: true, data: { id: user.id, email: user.email, invite_token: inviteToken, invite_link: inviteLink, expires_at: inviteExpiresAt, email_sent: emailSent, email_configured: isEmailConfigured() } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.post("/api/usuarios/criar-direto", requireAuth, async (req, res) => {
    try {
      // Auditoria 2026-06-19 (RBAC): criar conta direta é ação de gestão (mesma
      // razão do /invite). Sem o gate, um atendente provisionava usuários no tenant.
      if (!podeGerenciar((req as any).user)) return res.status(403).json({ ok: false, error: "Apenas administradores podem criar usuários" });
      const { nome, email, senha, role, cargo, telefone, equipe_ids } = req.body;
      if (!nome || !nome.trim()) return res.status(400).json({ ok: false, error: "Nome obrigatorio" });
      if (!email || !email.includes("@")) return res.status(400).json({ ok: false, error: "Email invalido" });
      if (!senha || senha.length < 6) return res.status(400).json({ ok: false, error: "Senha deve ter pelo menos 6 caracteres" });
      const validRoles = ["gerente", "atendente", "manager", "agent"];
      const normalizedRole = (role === "manager" ? "gerente" : role === "agent" ? "atendente" : role) || "atendente";
      if (!validRoles.includes(role || "atendente")) return res.status(400).json({ ok: false, error: "Funcao invalida" });
      const wsId = await resolveWorkspaceId(req);
      const seat = await getSeatInfo(wsId);
      if (seat.limite != null && seat.used >= seat.limite) return res.status(403).json({ ok: false, error: "Limite de usuarios do seu plano atingido", plano_atual: seat.planoNome, limite: seat.limite });
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ ok: false, error: "Email ja cadastrado" });
      const user = await storage.createUser({
        username: email,
        password: hashPassword(senha),
        nome: nome.trim(),
        email,
        role: normalizedRole,
        status: "ACTIVE",
        inviteToken: null,
        inviteExpiresAt: null,
        online: false,
        workspaceId: wsId,
        cargo: cargo?.trim() || null,
        telefone: telefone?.trim() || null,
      });
      const teamIds: string[] = equipe_ids && Array.isArray(equipe_ids) ? equipe_ids : [];
      const validTeamIds = teamIds.filter((id: string) => id && id !== "none");
      if (validTeamIds.length > 0) {
        const wsTeamsAll = await storage.getTeams(wsId);
        const wsTeamIdSet = new Set(wsTeamsAll.map(t => t.id));
        for (const tid of validTeamIds) {
          if (!wsTeamIdSet.has(tid)) continue;
          try { await storage.addTeamMember(tid, user.id); } catch {}
        }
      }
      const { password: _pw, inviteToken: _it, ...safeUser } = user as any;
      res.status(201).json({ ok: true, data: safeUser });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.get("/api/usuarios/convite/:token", async (req, res) => {
    try {
      const user = await storage.getUserByInviteToken(((req.params.token as string) as string));
      if (!user) return res.status(404).json({ ok: false, error: "Token de convite invalido" });
      if (user.status !== "INVITED") return res.status(400).json({ ok: false, error: "Convite ja foi utilizado" });
      if (user.inviteExpiresAt && new Date(user.inviteExpiresAt) < new Date()) return res.status(400).json({ ok: false, error: "Token de convite expirado" });
      let workspaceName = "ChatBanana CRM";
      let teamNames: string[] = [];
      if (user.workspaceId) {
        const ws = await storage.getWorkspace(user.workspaceId);
        if (ws) workspaceName = ws.nome || workspaceName;
        const wsTeams = await storage.getTeams(user.workspaceId);
        const { db } = await import("../db");
        const { teamMembers: tmTable } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const userTeamRows = await db.select().from(tmTable).where(eq(tmTable.userId, user.id));
        teamNames = userTeamRows.map(r => wsTeams.find(t => t.id === r.teamId)?.nome).filter(Boolean) as string[];
      }
      const roleLabel = user.role === "gerente" ? "Gerente" : user.role === "atendente" ? "Atendente" : user.role === "manager" ? "Gerente" : user.role === "admin" ? "Admin" : "Atendente";
      res.json({ ok: true, data: { email: user.email, role: user.role, roleLabel, workspaceName, teams: teamNames, expiresAt: user.inviteExpiresAt } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.post("/api/usuarios/aceitar-convite", async (req, res) => {
    try {
      const { invite_token, nome, senha, cargo, telefone } = req.body;
      if (!invite_token || !nome || !senha) return res.status(400).json({ ok: false, error: "Campos obrigatorios: invite_token, nome, senha" });
      const user = await storage.getUserByInviteToken(invite_token);
      if (!user) return res.status(404).json({ ok: false, error: "Token de convite invalido" });
      if (user.status !== "INVITED") return res.status(400).json({ ok: false, error: "Convite ja foi utilizado" });
      if (user.inviteExpiresAt && new Date(user.inviteExpiresAt) < new Date()) return res.status(400).json({ ok: false, error: "Token de convite expirado" });
      const updated = await storage.updateUser(user.id, { nome, password: hashPassword(senha), cargo: cargo || null, telefone: telefone || null, status: "ACTIVE", inviteToken: null, inviteExpiresAt: null });
      const payload = { id: user.id, email: user.email, role: updated!.role, nome: updated!.nome, workspaceId: updated!.workspaceId || "" };
      const realToken = jwt.sign(payload, JWT_SECRET as string, { expiresIn: "7d" });
      const { password: _pw3, inviteToken: _it3, ...safeUpdated } = updated as any;
      res.json({ ok: true, data: { token: realToken, user: safeUpdated } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.put("/api/usuarios/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ ok: false, error: "Invalid ID" });
    try {
      const me = (req as any).user;
      const wsId = await resolveWorkspaceId(req);
      // Anti cross-tenant: alvo precisa existir E ser do mesmo workspace.
      const target = await storage.getUser(id);
      if (!target || (target.workspaceId && target.workspaceId !== wsId)) {
        return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      }
      const isSelf = me?.id === id;
      // Editar OUTRO usuário exige cargo de gestão; o próprio perfil é livre.
      if (!isSelf && !podeGerenciar(me)) {
        return res.status(403).json({ ok: false, error: "Sem permissão para editar este usuário" });
      }
      // Gestor não-admin não mexe numa conta de admin (anti-escalonamento).
      if (target.role === "admin" && !isSelf && !isAdminRole(me)) {
        return res.status(403).json({ ok: false, error: "Sem permissão para editar um administrador" });
      }
      const { nome, cargo, telefone, avatarUrl, role, avatar_url, email, senha } = req.body;
      const data: any = {};
      if (nome !== undefined) data.nome = nome;
      if (cargo !== undefined) data.cargo = cargo;
      if (telefone !== undefined) data.telefone = telefone;
      if (avatarUrl !== undefined || avatar_url !== undefined) data.avatarUrl = avatarUrl || avatar_url;
      // Mudança de cargo: SOMENTE admin (impede atendente se autopromover).
      if (role !== undefined) {
        if (!isAdminRole(me)) {
          return res.status(403).json({ ok: false, error: "Apenas administradores alteram a função de um usuário" });
        }
        // Auditoria 2026-06-19 (RBAC): whitelist de cargos do TENANT. Sem isso, um
        // admin do tenant podia se autopromover a "superadmin" (cargo de plataforma)
        // → no próximo login o JWT vinha com role:"superadmin" e destrancava
        // /api/workspaces e /api/admin/workspaces (dump cross-tenant). superadmin/service
        // NÃO são atribuíveis pela API do tenant.
        const TENANT_ROLES = new Set(["admin", "gerente", "atendente", "manager", "agent"]);
        if (!TENANT_ROLES.has(role)) {
          return res.status(400).json({ ok: false, error: "Função inválida" });
        }
        data.role = role;
      }
      if (email !== undefined && email.includes("@")) {
        const existing = await storage.getUserByEmail(email);
        if (existing && existing.id !== id) return res.status(409).json({ ok: false, error: "Email ja cadastrado por outro usuario" });
        data.email = email;
        data.username = email;
      }
      if (senha !== undefined && senha.trim().length >= 6) {
        data.password = hashPassword(senha.trim());
        data.status = "ACTIVE";
        data.inviteToken = null;
        data.inviteExpiresAt = null;
      }
      const updated = await storage.updateUser(id, data);
      if (!updated) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      const { password: _pw4, inviteToken: _it4, ...safeUp } = updated as any;
      res.json({ ok: true, data: safeUp });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.patch("/api/usuarios/:id/status", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ ok: false, error: "Invalid ID" });
    try {
      const me = (req as any).user;
      const wsId = await resolveWorkspaceId(req);
      const target = await storage.getUser(id);
      if (!target || (target.workspaceId && target.workspaceId !== wsId)) {
        return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      }
      if (!podeGerenciar(me)) return res.status(403).json({ ok: false, error: "Sem permissão para alterar o status deste usuário" });
      if (target.role === "admin" && !isAdminRole(me)) return res.status(403).json({ ok: false, error: "Sem permissão para alterar um administrador" });
      const { status } = req.body;
      if (!["ACTIVE", "INACTIVE"].includes(status)) return res.status(400).json({ ok: false, error: "Status deve ser ACTIVE ou INACTIVE" });
      // Auditoria 2026-06-19 (revogação de sessão): via blocklist, não updateUser
      // cru. requireAuth é stateless (só checa o Set em memória) → desativar pela UI
      // do tenant com updateUser direto NÃO derrubava o JWT já emitido (válido 7d).
      // setUserBlocked persiste o status, entra/sai do Set NA HORA e fecha as sessões.
      const { setUserBlocked } = await import("../services/tenantBlocklist");
      await setUserBlocked(id, status === "INACTIVE");
      const updated = await storage.getUser(id);
      if (!updated) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      res.json({ ok: true, data: { id: updated.id, status: updated.status }, leads_afetados: 0 });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.patch("/api/usuarios/:id/online", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ ok: false, error: "Invalid ID" });
    // Heartbeat só faz sentido pro próprio usuário. Sem este guard, users.id é
    // serial global e storage.updateUser não filtra por workspace → escrita
    // cross-tenant (marcar online/offline + bumpar auth_sessions de outro tenant).
    const me = (req as any).user;
    if (!me?.id || id !== me.id) return res.status(403).json({ ok: false, error: "Forbidden" });
    try {
      const { online } = req.body;
      const data: any = { online: !!online };
      if (online) data.ultimoAcesso = new Date();
      const updated = await storage.updateUser(id, data);
      if (!updated) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      // Renova a sessão de auth aberta no heartbeat (online=true) — usado pra
      // inferir o fim da sessão quando o atendente fecha a aba sem dar logout.
      if (online) {
        try {
          const bumpWhere = me.workspaceId
            ? and(eq(authSessions.userId, id), eq(authSessions.workspaceId, me.workspaceId), isNull(authSessions.logoutAt))
            : and(eq(authSessions.userId, id), isNull(authSessions.logoutAt));
          await db.update(authSessions)
            .set({ lastSeenAt: new Date() })
            .where(bumpWhere);
        } catch { /* best-effort */ }
      }
      res.json({ ok: true, data: { id: updated.id, online: updated.online } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.post("/api/usuarios/:id/offline-beacon", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(204).end();
    // Idem /online: só o próprio usuário pode se marcar offline (anti cross-tenant).
    const me = (req as any).user;
    if (!me?.id || id !== me.id) return res.status(204).end();
    try { await storage.updateUser(id, { online: false }); } catch {}
    res.status(204).end();
  });

  app.delete("/api/usuarios/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ ok: false, error: "Invalid ID" });
    try {
      const me = (req as any).user;
      if (me && me.id === id) return res.status(400).json({ ok: false, error: "Voce nao pode excluir a si mesmo" });
      const wsId = await resolveWorkspaceId(req);
      const user = await storage.getUser(id);
      // Anti cross-tenant + gate de cargo (users.id é serial global).
      if (!user || (user.workspaceId && user.workspaceId !== wsId)) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      if (!podeGerenciar(me)) return res.status(403).json({ ok: false, error: "Sem permissão para excluir usuários" });
      if (user.role === "admin" && !isAdminRole(me)) return res.status(403).json({ ok: false, error: "Sem permissão para excluir um administrador" });
      // Auditoria 2026-06-19: bloqueia NA HORA (Set em memória + fecha sessões) antes
      // do hard-delete. requireAuth é stateless e não consulta o banco → sem isto, o
      // JWT do usuário excluído seguia válido até expirar (7d), pois a linha some mas
      // o token continua verificando contra o segredo.
      const { setUserBlocked } = await import("../services/tenantBlocklist");
      await setUserBlocked(id, true);
      await storage.deleteUser(id);
      res.json({ ok: true, message: "Usuario removido" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.get("/api/equipes", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const allTeams = await storage.getTeams(wsId);
      const allUsers = await storage.getUsers(wsId);
      const enriched = await Promise.all(allTeams.map(async (t) => {
        const memberRows = await storage.getTeamMembers(t.id);
        const members = memberRows.map(m => { const u = allUsers.find(u => u.id === m.userId); return u ? { id: u.id, nome: u.nome, email: u.email, avatarUrl: u.avatarUrl, role: u.role } : null; }).filter(Boolean);
        const leader = t.leaderId ? allUsers.find(u => u.id === t.leaderId) : null;
        return { ...t, leader: leader ? { id: leader.id, nome: leader.nome, avatarUrl: leader.avatarUrl } : null, members };
      }));
      res.json({ ok: true, data: enriched });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.get("/api/equipes/stats", requireAuth, async (req, res) => {
    // Bruno 2026-05-18: refac N+1 → 1 JOIN único.
    // Antes: 1 SELECT teams + 1 SELECT users + 1 GROUP BY conversations + N×getTeamMembers (loop).
    // Agora: 3 queries paralelas, sem loop por team. Ganho 5-10x em workspaces
    // com várias equipes (tipicamente 3-10 → 30-100 queries colapsadas em 3).
    try {
      const wsId = await resolveWorkspaceId(req);
      const { db: statsDb } = await import("../db");
      const { conversations: convTable, teams: teamsTable, teamMembers: tmTable } = await import("@shared/schema");
      const { eq, and, sql, count } = await import("drizzle-orm");

      const [allTeams, allUsers, openCounts, allMemberships] = await Promise.all([
        statsDb.select().from(teamsTable).where(and(eq(teamsTable.workspaceId, wsId), eq(teamsTable.active, true))),
        storage.getUsers(wsId),
        statsDb
          .select({ assignedUserId: convTable.assignedUserId, openCount: count() })
          .from(convTable)
          .where(and(eq(convTable.workspaceId, wsId), eq(convTable.status, "open"), sql`${convTable.assignedUserId} IS NOT NULL`))
          .groupBy(convTable.assignedUserId),
        // Single query pega TODAS as memberships do workspace de uma vez.
        statsDb
          .select({ teamId: tmTable.teamId, userId: tmTable.userId })
          .from(tmTable)
          .innerJoin(teamsTable, eq(tmTable.teamId, teamsTable.id))
          .where(and(eq(teamsTable.workspaceId, wsId), eq(teamsTable.active, true))),
      ]);

      const countMap: Record<number, number> = {};
      for (const oc of openCounts) {
        if (oc.assignedUserId != null) countMap[oc.assignedUserId] = Number(oc.openCount);
      }
      const usersById = new Map(allUsers.map(u => [u.id, u]));
      const membersByTeam = new Map<string, number[]>();
      for (const m of allMemberships) {
        const arr = membersByTeam.get(m.teamId) || [];
        arr.push(m.userId);
        membersByTeam.set(m.teamId, arr);
      }

      const result = allTeams.map((t) => {
        const memberIds = membersByTeam.get(t.id) || [];
        const members = memberIds.map(uid => {
          const u = usersById.get(uid);
          if (!u) return null;
          return { id: u.id, nome: u.nome, avatarUrl: u.avatarUrl, role: u.role, openConversations: countMap[u.id] || 0 };
        }).filter(Boolean);
        const totalOpen = members.reduce((sum, m: any) => sum + (m?.openConversations || 0), 0);
        return { id: t.id, nome: t.nome, pipelineKey: t.pipelineKey, totalOpen, members };
      });

      res.json({ ok: true, data: result });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.post("/api/equipes", requireAuth, async (req, res) => {
    try {
      const { nome, descricao, leader_id, pipeline_key } = req.body;
      if (!nome) return res.status(400).json({ ok: false, error: "Nome obrigatorio" });
      const wsId = await resolveWorkspaceId(req);

      // CRM genérico (Bruno 2026-06-28): "criar funil junto". Se a equipe não veio
      // com um pipeline existente, cria um funil/quadro próprio com o nome dela.
      // O Kanban serve 5 etapas universais automaticamente pra qualquer pipeline.
      let pipelineKey: string = (pipeline_key || "").trim();
      if (!pipelineKey) {
        const existingPipes = await storage.getPipelines(wsId);
        const usedKeys = new Set(existingPipes.map(p => p.key));
        const base = String(nome).normalize("NFD").replace(/[̀-ͯ]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "equipe";
        let key = base, i = 2;
        while (usedKeys.has(key)) key = `${base}_${i++}`;
        const maxOrdem = existingPipes.reduce((m, p) => Math.max(m, p.ordem ?? 0), 0);
        await storage.createPipeline({
          key, label: nome, icon: "LayoutGrid", cor: "#6366f1",
          fixed: false, active: true, ordem: maxOrdem + 1, workspaceId: wsId,
        } as any);
        pipelineKey = key;
      }

      const team = await storage.createTeam({ nome, descricao: descricao || null, leaderId: leader_id || null, pipelineKey, workspaceId: wsId });
      await autoAssignAllAdminsToTeam(wsId, team.id);
      res.status(201).json({ ok: true, data: team });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.put("/api/equipes/:id", requireAuth, async (req, res) => {
    try {
      // Auditoria 2026-06-19 (RBAC/IDOR): teams.id é UUID global e storage.updateTeam
      // não filtra por workspace → sem este guard, conhecer o id de uma equipe de
      // outro tenant permitia renomear/repontar a pipeline dela (escrita cross-tenant).
      const wsId = await resolveWorkspaceId(req);
      const wsTeams = await storage.getTeams(wsId);
      if (!wsTeams.some(t => t.id === ((req.params.id as string) as string))) {
        return res.status(404).json({ ok: false, error: "Equipe nao encontrada" });
      }
      const { nome, descricao, leader_id, pipeline_key } = req.body;
      const data: any = {};
      if (nome !== undefined) data.nome = nome;
      if (descricao !== undefined) data.descricao = descricao;
      if (leader_id !== undefined) data.leaderId = leader_id;
      if (pipeline_key !== undefined) data.pipelineKey = pipeline_key;
      const updated = await storage.updateTeam(((req.params.id as string) as string), data);
      if (!updated) return res.status(404).json({ ok: false, error: "Equipe nao encontrada" });
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.post("/api/equipes/:id/membros", requireAuth, async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) return res.status(400).json({ ok: false, error: "user_id obrigatorio" });
      // Auditoria 2026-06-19 (RBAC/IDOR): a equipe E o usuário precisam ser do mesmo
      // workspace do chamador. teamMembers não tem workspace_id e os ids são globais.
      const wsId = await resolveWorkspaceId(req);
      const wsTeams = await storage.getTeams(wsId);
      if (!wsTeams.some(t => t.id === ((req.params.id as string) as string))) {
        return res.status(404).json({ ok: false, error: "Equipe nao encontrada" });
      }
      const targetUser = await storage.getUser(user_id);
      if (!targetUser || (targetUser.workspaceId && targetUser.workspaceId !== wsId)) {
        return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      }
      await storage.addTeamMember(((req.params.id as string) as string), user_id);
      res.json({ ok: true, message: "Membro adicionado" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.delete("/api/equipes/:id/membros/:userId", requireAuth, async (req, res) => {
    try {
      const userId = parseId(((req.params.userId as string) as string));
      if (!userId) return res.status(400).json({ ok: false, error: "Invalid user ID" });
      // Auditoria 2026-06-19 (RBAC/IDOR): só remove membro de equipe do próprio workspace.
      const wsId = await resolveWorkspaceId(req);
      const wsTeams = await storage.getTeams(wsId);
      if (!wsTeams.some(t => t.id === ((req.params.id as string) as string))) {
        return res.status(404).json({ ok: false, error: "Equipe nao encontrada" });
      }
      await storage.removeTeamMember(((req.params.id as string) as string), userId);
      res.json({ ok: true, message: "Membro removido" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.patch("/api/equipes/:id/toggle-active", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const allTeams = await storage.getTeams(wsId);
      const team = allTeams.find(t => t.id === ((req.params.id as string) as string));
      if (!team) return res.status(404).json({ ok: false, error: "Equipe nao encontrada" });
      const updated = await storage.updateTeam(((req.params.id as string) as string), { active: !team.active } as any);
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });

  app.delete("/api/equipes/:id", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const allTeams = await storage.getTeams(wsId);
      const team = allTeams.find(t => t.id === ((req.params.id as string) as string));
      if (!team) return res.status(404).json({ ok: false, error: "Equipe nao encontrada" });
      if (team.fixed) return res.status(403).json({ ok: false, error: "Equipes nativas nao podem ser excluidas. Voce pode inativa-las." });
      await storage.deleteTeam(((req.params.id as string) as string));
      res.json({ ok: true, message: "Equipe removida" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[usuarios]") }); }
  });
}
