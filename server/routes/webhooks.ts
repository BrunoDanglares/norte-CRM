import type { Express } from "express";
import { randomBytes, createHash } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireApiToken } from "../middleware/auth";
import { parseId, resolveWorkspaceId, coerceValor, formatPhone, safeErr } from "../utils/helpers";
import { dispatchWebhook } from "../services/webhookDispatcher";
import { sendMessage } from "../services/channel-router";
import { assertSafeOutboundUrl, safeOutboundFetch } from "../utils/ssrfGuard";

const ALLOWED_EVENTS = ["lead.created", "lead.updated", "lead.won", "lead.lost", "message.received", "message.sent", "deal.moved", "contact.created"];

export function registerWebhookRoutes(app: Express) {
  app.get("/api/webhooks", requireAuth, async (req, res) => {
    // Bruno 2026-05-30 iter 32 — multi-tenant fix (lista só do tenant).
    const wsId = await resolveWorkspaceId(req);
    const endpoints = await storage.getWebhookEndpoints(wsId);
    // Bruno 2026-06-18 (auditoria): NÃO vazar o secret HMAC de assinatura — troca por hasSecret.
    const safe = (endpoints || []).map(({ secret, ...rest }: any) => ({ ...rest, hasSecret: !!secret }));
    res.json({ ok: true, data: safe });
  });

  app.post("/api/webhooks", requireAuth, async (req, res) => {
    try {
      const { nome, url, provider, eventos, secret } = req.body;
      if (!nome || !url) return res.status(400).json({ ok: false, error: "nome e url sao obrigatorios" });
      // Anti-SSRF (Bruno 2026-06-13): bloqueia http(s) inválido E host interno.
      try { assertSafeOutboundUrl(url); } catch (e: any) { return res.status(400).json({ ok: false, error: e.message }); }
      const wsId = await resolveWorkspaceId(req);
      const evts = Array.isArray(eventos) ? eventos.filter((e: string) => ALLOWED_EVENTS.includes(e)) : [];
      // Bruno 2026-05-30 iter 32 — endpoint criado vinculado ao wsId do autor.
      const ep = await storage.createWebhookEndpoint({ nome, url, provider: provider || "n8n", eventos: evts, secret: secret || null, workspaceId: wsId } as any);
      res.status(201).json({ ok: true, data: ep });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[webhooks]") }); }
  });

  app.put("/api/webhooks/:id", requireAuth, async (req, res) => {
    try {
      const { nome, url, eventos, secret, ativo } = req.body;
      const data: any = {};
      if (nome !== undefined) data.nome = nome;
      if (url !== undefined) {
        try { assertSafeOutboundUrl(url); } catch (e: any) { return res.status(400).json({ ok: false, error: e.message }); }
        data.url = url;
      }
      if (eventos !== undefined) data.eventos = Array.isArray(eventos) ? eventos.filter((e: string) => ALLOWED_EVENTS.includes(e)) : [];
      if (secret !== undefined) data.secret = secret;
      if (ativo !== undefined) data.ativo = ativo;
      const wsId = await resolveWorkspaceId(req);
      const ep = await storage.updateWebhookEndpoint(((req.params.id as string) as string), data, wsId);
      if (!ep) return res.status(404).json({ ok: false, error: "Webhook nao encontrado" });
      res.json({ ok: true, data: ep });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[webhooks]") }); }
  });

  app.delete("/api/webhooks/:id", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      await storage.deleteWebhookEndpoint(((req.params.id as string) as string), wsId);
      res.json({ ok: true, message: "Webhook removido" });
    }
    catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[webhooks]") }); }
  });

  app.post("/api/webhooks/:id/testar", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      // Bruno 2026-05-30 iter 32 — defense in depth contra id forjado cross-tenant.
      const ep = await storage.getWebhookEndpoint(((req.params.id as string) as string), wsId);
      if (!ep) return res.status(404).json({ ok: false, error: "Webhook nao encontrado" });
      const testBody = JSON.stringify({ evento: "test", timestamp: new Date().toISOString(), data: { mensagem: "Teste FlowCRM" } });
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", "X-FlowCRM-Event": "test" };
      if (ep.secret) { const { createHmac } = await import("crypto"); headers["X-FlowCRM-Signature"] = `sha256=${createHmac("sha256", ep.secret).update(testBody).digest("hex")}`; }
      // Anti-SSRF: revalida a URL salva antes de disparar o teste.
      try { assertSafeOutboundUrl(ep.url); } catch (e: any) { return res.status(400).json({ ok: false, error: e.message }); }
      const start = Date.now();
      // Auditoria 2026-06-19 (SSRF por redirect): safeOutboundFetch re-valida cada hop.
      const response = await safeOutboundFetch(ep.url, { method: "POST", headers, body: testBody, signal: AbortSignal.timeout(5000) });
      res.json({ ok: true, data: { status: response.status, respondeu: true, tempo_ms: Date.now() - start } });
    } catch (e: any) { res.json({ ok: true, data: { status: 0, respondeu: false, tempo_ms: 0, erro: e.message } }); }
  });

  app.get("/api/webhooks/:id/logs", requireAuth, async (req, res) => {
    // Bruno 2026-05-30 iter 32 — valida endpoint do tenant ANTES de retornar logs.
    const wsId = await resolveWorkspaceId(req);
    const epId = (req.params.id as string);
    const ep = await storage.getWebhookEndpoint(epId, wsId);
    if (!ep) return res.status(404).json({ ok: false, error: "Webhook nao encontrado" });
    const logs = await storage.getWebhookLogs(epId, 50);
    res.json({ ok: true, data: logs });
  });

  app.delete("/api/webhooks/:id/logs", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const epId = (req.params.id as string);
    const ep = await storage.getWebhookEndpoint(epId, wsId);
    if (!ep) return res.status(404).json({ ok: false, error: "Webhook nao encontrado" });
    await storage.deleteWebhookLogs(epId);
    res.json({ ok: true, message: "Logs apagados" });
  });

  app.get("/api/tokens", requireAuth, async (req, res) => {
    // Bruno 2026-05-30 iter 32 — multi-tenant fix.
    // Antes: lista TODOS tokens (leak cross-tenant). Agora scoped por wsId.
    const wsId = await resolveWorkspaceId(req);
    const tokens = await storage.getApiTokens(wsId);
    const safe = tokens.map(({ tokenHash, ...rest }) => rest);
    res.json({ ok: true, data: safe });
  });

  app.post("/api/tokens", requireAuth, async (req, res) => {
    try {
      const { nome, permissoes, expires_at } = req.body;
      if (!nome) return res.status(400).json({ ok: false, error: "nome e obrigatorio" });
      const wsId = await resolveWorkspaceId(req);
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const tokenPreview = token.substring(0, 8);
      const perms = Array.isArray(permissoes) ? permissoes : [];
      // Bruno 2026-05-30 iter 32 — token criado vinculado ao wsId do autor.
      const created = await storage.createApiToken({ nome, tokenHash, tokenPreview, permissoes: perms, createdBy: req.user?.id, expiresAt: expires_at ? new Date(expires_at) : null, workspaceId: wsId } as any);
      res.status(201).json({ ok: true, data: { id: created.id, nome: created.nome, token_completo: token, permissoes: perms }, aviso: "Guarde este token — ele nao sera exibido novamente" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[webhooks]") }); }
  });

  app.delete("/api/tokens/:id", requireAuth, async (req, res) => {
    // Bruno 2026-05-30 iter 32 — passa wsId pra evitar revogação cross-tenant.
    const wsId = await resolveWorkspaceId(req);
    await storage.updateApiToken(((req.params.id as string) as string), { ativo: false } as any, wsId);
    res.json({ ok: true, message: "Token revogado" });
  });

  // Bruno 2026-06-18 (auditoria): rotas /api/ext/* (proxy do n8n) REMOVIDAS — n8n é
  // PEÇA MORTA no ChatBanana. O service token também foi desativado (middleware/auth.ts).
  // api_tokens (hash por tenant, escopados) seguem disponíveis se uma integração nova
  // precisar — mas sem o segredo-mestre compartilhado e sem proxy genérico de leads.
}
