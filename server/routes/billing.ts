import type { Express } from "express";
import { storage } from "../storage";
import { insertTransactionSchema, contacts, users } from "@shared/schema";
import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { coerceValor, resolveWorkspaceId, safeErr } from "../utils/helpers";

export function registerBillingRoutes(app: Express) {
  app.get("/api/transactions", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const txns = await storage.getTransactions(wsId);
    res.json(txns);
  });

  app.post("/api/transactions", requireAuth, async (req, res) => {
    const parsed = insertTransactionSchema.omit({ workspaceId: true }).safeParse(coerceValor({...req.body}));
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const txn = await storage.createTransaction({ ...parsed.data, workspaceId: await resolveWorkspaceId(req) });
    res.status(201).json(txn);
  });

  app.get("/api/billing/usage", requireAuth, async (req, res) => {
    try {
      // Bruno 2026-06-09 — medidor REAL (antes era quase tudo mockado).
      // Grade por 2 eixos: CANAIS (conexões) × CLIENTES (assinantes identificados no ERP/SGP).
      const wsId = await resolveWorkspaceId(req);
      const workspace = await storage.getWorkspace(wsId);

      // Plano vem do WORKSPACE (não de user.planoId, que é legado individual).
      let plano = workspace?.planoId ? await storage.getPlano(workspace.planoId) : null;
      if (!plano) plano = await storage.getPlanoBySlug("essencial"); // fallback grade nova

      // Uso real, escopado por workspace
      const canaisUsed = await storage.countConexoes(wsId);
      const [{ c: clientesUsed }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, wsId), sql`coalesce(${contacts.cpf}, '') <> ''`));
      const [{ c: seatsUsed }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.workspaceId, wsId), eq(users.status, "ACTIVE")));

      // Status / trial / próxima cobrança a partir dos campos do Asaas (billing atual).
      const subStatus = workspace?.asaasSubscriptionStatus || "none";
      let trialDays = 0;
      if (workspace?.trialExpiresAt) {
        trialDays = Math.max(0, Math.ceil((new Date(workspace.trialExpiresAt).getTime() - Date.now()) / 86400000));
      }
      const statusLabel =
        subStatus === "active" ? "Ativo" :
        subStatus === "trialing" ? "Em teste" :
        subStatus === "pending" ? "Aguardando pagamento" :
        subStatus === "past_due" ? "Pagamento pendente" :
        subStatus === "canceled" ? "Cancelado" :
        trialDays > 0 ? "Em teste" : "Sem assinatura";

      res.json({
        ok: true,
        data: {
          plan: plano?.nome || "—",
          planSlug: plano?.slug || "",
          status: statusLabel,
          subStatus,
          isVip: Boolean((workspace as any)?.isVip),
          hasCpfCnpj: Boolean(workspace?.cpfCnpj || workspace?.cnpj),
          hasSubscription: ["active", "trialing", "past_due", "pending"].includes(subStatus),
          trialDays,
          nextBilling: workspace?.asaasNextDueDate
            ? new Date(workspace.asaasNextDueDate).toLocaleDateString("pt-BR")
            : "",
          mrr: plano?.preco ? Number(plano.preco) : 0,
          canaisUsed, canaisLimit: (plano as any)?.limiteCanais ?? -1,
          clientesUsed, clientesLimit: (plano as any)?.limiteClientes ?? -1,
          seatsUsed, seatsLimit: plano?.limiteUsuarios ?? -1,
        },
      });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.get("/api/planos", requireAuth, async (_req, res) => {
    try { const allPlanos = await storage.getPlanos(); res.json({ ok: true, data: allPlanos }); }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.get("/api/planos/:slug", requireAuth, async (req, res) => {
    try {
      const plano = await storage.getPlanoBySlug(((req.params.slug as string) as string));
      if (!plano) return res.status(404).json({ ok: false, error: "Plano nao encontrado" });
      res.json({ ok: true, data: plano });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.get("/api/workspaces", requireAuth, async (req, res) => {
    try {
      // Bruno 2026-05-30 iter 32 — multi-tenant fix.
      // Antes: requireAuth-only retornava TODOS workspaces (leak crítico).
      // Agora: superadmin vê todos; demais usuários veem só o próprio workspace.
      if (req.user!.role === "superadmin") {
        const wsList = await storage.getWorkspaces();
        return res.json({ ok: true, data: wsList });
      }
      // Bruno 2026-06-18 (auditoria): não expor cpfCnpj + IDs de billing pros usuários do tenant.
      const ws = await storage.getWorkspace(req.user!.workspaceId);
      const stripWs = (w: any) => { if (!w) return w; const { cpfCnpj, stripeCustomerId, stripeSubscriptionId, asaasCustomerId, asaasSubscriptionId, ...rest } = w; return rest; };
      res.json({ ok: true, data: ws ? [stripWs(ws)] : [] });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.post("/api/workspaces", requireAuth, async (req, res) => {
    try {
      // Bruno 2026-06-13 (auditoria): criar workspace é ação de plataforma — só admin.
      if (req.user!.role !== "admin" && req.user!.role !== "superadmin") {
        return res.status(403).json({ ok: false, error: "Apenas administradores podem criar workspaces" });
      }
      const { nome, plano_id, status } = req.body;
      if (!nome) return res.status(400).json({ ok: false, error: "Nome obrigatorio" });
      const ws = await storage.createWorkspace({ nome, planoId: plano_id || null, status: status || "ACTIVE" });
      res.status(201).json({ ok: true, data: ws });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.get("/api/workspaces/:id/limite-usuarios", requireAuth, async (req, res) => {
    // IDOR (auditoria 2026-06-19): o :id era usado cru → qualquer user logado lia o
    // limite-de-usuários de QUALQUER workspace por UUID. Scoped ao próprio tenant
    // (superadmin vê o que pedir). Sem caller no front → mudança sem impacto.
    try {
      const own = await resolveWorkspaceId(req);
      const wsId = req.user!.role === "superadmin" ? ((req.params.id as string) as string) : own;
      const limite = await storage.getLimiteUsuarios(wsId);
      res.json({ ok: true, data: { limite } });
    }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.get("/api/permissoes", requireAuth, async (_req, res) => {
    try {
      const perms = await storage.getPermissions();
      const result: Record<string, any> = {};
      for (const p of perms) result[p.role] = p;
      res.json({ ok: true, data: result });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

  app.put("/api/permissoes/:role", requireAuth, async (req, res) => {
    try {
      // Bruno 2026-06-13 (auditoria): permissões são linhas GLOBAIS por cargo
      // (compartilhadas entre todos os tenants). Sem este gate, qualquer atendente
      // de qualquer tenant reescrevia as permissões da plataforma inteira.
      if (req.user!.role !== "admin" && req.user!.role !== "superadmin") {
        return res.status(403).json({ ok: false, error: "Apenas administradores podem alterar permissões" });
      }
      let role = ((req.params.role as string) as string);
      if (role === "gerente") role = "manager";
      if (role === "atendente") role = "agent";
      const perm = await storage.getPermissionByRole(role);
      if (!perm) return res.status(404).json({ ok: false, error: "Role nao encontrado" });
      const b = req.body;
      const data: any = {};
      const fields: [string, string][] = [
        ["can_view_all_leads", "canViewAllLeads"],
        ["can_edit_others_leads", "canEditOthersLeads"],
        ["can_view_reports", "canViewReports"],
        ["can_manage_connections", "canManageConnections"],
        ["can_manage_automations", "canManageAutomations"],
        ["can_export_data", "canExportData"],
        ["can_invite_users", "canInviteUsers"],
        ["can_view_dashboard", "canViewDashboard"],
        ["can_use_chat", "canUseChat"],
        ["can_manage_pipeline", "canManagePipeline"],
        ["can_manage_campaigns", "canManageCampaigns"],
        ["can_manage_insta_prospect", "canManageInstaProspect"],
        ["can_manage_isp", "canManageISP"],
        ["can_manage_i_s_p", "canManageISP"],
        ["can_manage_workspace", "canManageWorkspace"],
      ];
      for (const [snake, camel] of fields) {
        if (b[snake] !== undefined) data[camel] = b[snake];
      }
      const updated = await storage.updatePermission(perm.id, data);
      res.json({ ok: true, data: updated });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[billing]") }); }
  });

}
