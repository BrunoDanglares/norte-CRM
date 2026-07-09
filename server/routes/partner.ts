import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId, safeErr } from "../utils/helpers";

// Auditoria 2026-06-19: as rotas de ESCRITA do parceiro (criar/deletar cliente,
// convite, impersonar) exigem cargo de gestão — não basta o workspace ser do
// tipo gestor. Sem isto, um atendente do gestor impersonava e virava admin no
// tenant-cliente. Leituras (GET stats/clients) seguem só por accountType.
const GESTAO_ROLES = new Set(["admin", "gerente", "manager"]);

export function registerPartnerRoutes(app: Express) {
  app.get("/api/partner/stats", requireAuth, async (req, res) => {
    try {
      const ws = await storage.getWorkspace(req.user!.workspaceId);
      if (!ws || ws.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      const stats = await storage.getPartnerStats(req.user!.workspaceId);
      res.json({ ok: true, data: stats });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.get("/api/partner/clients", requireAuth, async (req, res) => {
    try {
      const ws = await storage.getWorkspace(req.user!.workspaceId);
      if (!ws || ws.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      const clients = await storage.getPartnerClients(req.user!.workspaceId);
      res.json({ ok: true, data: clients });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.post("/api/partner/clients", requireAuth, async (req, res) => {
    try {
      const ws = await storage.getWorkspace(req.user!.workspaceId);
      if (!ws || ws.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      if (!GESTAO_ROLES.has(String(req.user?.role))) return res.status(403).json({ error: "Apenas administradores do gestor podem gerenciar clientes" });

      const { businessName, adminName, adminEmail, adminPassword, phone } = req.body;
      if (!businessName || !adminName || !adminEmail || !adminPassword)
        return res.status(400).json({ error: "Campos obrigatorios: businessName, adminName, adminEmail, adminPassword" });

      const existing = await storage.getUserByEmail(adminEmail.toLowerCase().trim());
      if (existing) return res.status(409).json({ error: "Email ja cadastrado" });

      const result = await storage.createClientWorkspace({
        partnerWorkspaceId: req.user!.workspaceId,
        businessName, adminName, adminEmail, adminPassword, phone,
      });
      res.status(201).json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.get("/api/partner/clients/:workspaceId", requireAuth, async (req, res) => {
    try {
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      const clientWs = await storage.getWorkspace(((req.params.workspaceId as string) as string));
      if (!clientWs || clientWs.parentWorkspaceId !== req.user!.workspaceId)
        return res.status(403).json({ error: "Acesso negado" });
      res.json({ ok: true, data: clientWs });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.delete("/api/partner/clients/:workspaceId", requireAuth, async (req, res) => {
    try {
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      if (!GESTAO_ROLES.has(String(req.user?.role))) return res.status(403).json({ error: "Apenas administradores do gestor podem deletar clientes" });
      const clientWs = await storage.getWorkspace(((req.params.workspaceId as string) as string));
      if (!clientWs || clientWs.parentWorkspaceId !== req.user!.workspaceId)
        return res.status(403).json({ error: "Acesso negado" });
      await storage.updateWorkspace(((req.params.workspaceId as string) as string), { parentWorkspaceId: null } as any);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.get("/api/partner/connections", requireAuth, async (req, res) => {
    try {
      const ws = await storage.getWorkspace(req.user!.workspaceId);
      if (!ws || ws.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      const connections = await storage.getPartnerConnections(req.user!.workspaceId);
      res.json({ ok: true, data: connections });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.get("/api/partner/clients/:workspaceId/detail", requireAuth, async (req, res) => {
    try {
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      const detail = await storage.getPartnerClientDetail(req.user!.workspaceId, ((req.params.workspaceId as string) as string));
      if (!detail) return res.status(404).json({ error: "Cliente nao encontrado" });
      res.json({ ok: true, data: detail });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.get("/api/partner/invites", requireAuth, async (req, res) => {
    try {
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      const invites = await storage.getPartnerInvites(req.user!.workspaceId);
      res.json({ ok: true, data: invites });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.post("/api/partner/invites", requireAuth, async (req, res) => {
    try {
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      if (!GESTAO_ROLES.has(String(req.user?.role))) return res.status(403).json({ error: "Apenas administradores do gestor podem convidar clientes" });
      const { clientEmail, clientName, businessName } = req.body;
      if (!clientEmail || !clientName || !businessName)
        return res.status(400).json({ error: "Campos obrigatorios: clientEmail, clientName, businessName" });
      const invite = await storage.createPartnerInvite({
        partnerWorkspaceId: req.user!.workspaceId, clientEmail, clientName, businessName,
      });
      const appUrl = process.env.APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:5000"}`;
      const link = `${appUrl}/register?invite=${invite.inviteToken}`;
      res.status(201).json({ ok: true, data: { ...invite, inviteLink: link } });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });

  app.post("/api/partner/impersonate/:clientWorkspaceId", requireAuth, async (req, res) => {
    try {
      const callerWs = await storage.getWorkspace(req.user!.workspaceId);
      if (!callerWs || callerWs.accountType !== "gestor") return res.status(403).json({ error: "Acesso restrito a gestores" });
      if (!GESTAO_ROLES.has(String(req.user?.role))) return res.status(403).json({ error: "Apenas administradores do gestor podem impersonar" });
      const clientWs = await storage.getWorkspace(((req.params.clientWorkspaceId as string) as string));
      if (!clientWs || clientWs.parentWorkspaceId !== req.user!.workspaceId)
        return res.status(403).json({ error: "Acesso negado" });
      const token = await storage.createImpersonationToken({
        partnerWorkspaceId: req.user!.workspaceId,
        targetWorkspaceId: ((req.params.clientWorkspaceId as string) as string),
        partnerUserId: req.user!.id,
      });
      res.json({ ok: true, data: { token, redirectUrl: "/inbox" } });
    } catch (e: any) {
      res.status(500).json({ error: safeErr(e, "[partner]") });
    }
  });
}
