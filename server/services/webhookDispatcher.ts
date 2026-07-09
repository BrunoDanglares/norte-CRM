import crypto from "crypto";
import { storage } from "../storage";
import { assertSafeOutboundUrl, safeOutboundFetch } from "../utils/ssrfGuard";

// Bruno 2026-05-30 iter 35 — adicionado workspaceId opcional pra escopar
// dispatch por tenant. Com wsId: só entrega evento pra webhooks do tenant
// correto (evita ws_A receber webhook de evento que aconteceu em ws_B).
// Sem wsId (legado/cron global): dispara pra todos os endpoints ativos —
// uso interno/cross-tenant, callers devem migrar gradualmente. Heurística:
// se payload tem `.workspaceId`/`.workspace_id`, prefira passar explicitamente.
export async function dispatchWebhook(evento: string, payload: object, workspaceId?: string) {
  try {
    // Auto-extrai workspaceId do payload se não veio explícito — defesa-em-profundidade
    // pra callers legados que esquecem de passar mas têm a info no payload.
    if (!workspaceId && payload && typeof payload === 'object') {
      const p: any = payload;
      const candidate = p.workspaceId || p.workspace_id
        || p.lead?.workspaceId || p.contact?.workspaceId
        || p.conversa?.workspaceId || p.mensagem?.workspaceId
        || p.workspace?.id;
      if (typeof candidate === 'string' && candidate.length > 0) {
        workspaceId = candidate;
      }
    }

    const endpoints = await storage.getActiveWebhooksByEvent(evento, workspaceId);

    for (const endpoint of endpoints) {
      const body = JSON.stringify({
        evento,
        timestamp: new Date().toISOString(),
        flowcrm_version: "1.0",
        data: payload,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
        "X-FlowCRM-Event": evento,
      };

      if (endpoint.secret) {
        const sig = crypto
          .createHmac("sha256", endpoint.secret)
          .update(body)
          .digest("hex");
        headers["X-FlowCRM-Signature"] = `sha256=${sig}`;
      }

      // Anti-SSRF (Bruno 2026-06-13): pula endpoints com host privado/interno —
      // cobre linhas salvas antes da validação na criação do webhook.
      try {
        assertSafeOutboundUrl(endpoint.url);
      } catch {
        console.warn('[webhookDispatcher] endpoint com host privado/inválido ignorado', { url: endpoint.url, endpointId: endpoint.id });
        continue;
      }

      try {
        // Auditoria 2026-06-19 (SSRF por redirect): safeOutboundFetch re-valida CADA
        // hop — um host público que responde 302 pra 169.254.169.254/127.0.0.1 não é seguido.
        const res = await safeOutboundFetch(endpoint.url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(10000),
        });

        await storage.createWebhookLog({
          endpointId: endpoint.id,
          evento,
          payload: payload as any,
          responseStatus: res.status,
          sucesso: res.ok,
        });

        await storage.updateWebhookEndpoint(endpoint.id, {
          ultimoDisparo: new Date(),
          totalDisparos: (endpoint.totalDisparos || 0) + 1,
          totalErros: (endpoint.totalErros || 0) + (res.ok ? 0 : 1),
        } as any);
      } catch (err: any) {
        console.error('[webhookDispatcher] falha no envio', {
          url: endpoint.url,
          event: evento,
          status: err?.response?.status ?? null,
          message: err?.message ?? 'unknown',
          workspaceId: (endpoint as any).workspaceId ?? null,
        });

        await storage.createWebhookLog({
          endpointId: endpoint.id,
          evento,
          payload: payload as any,
          sucesso: false,
          responseBody: String(err),
        }).catch(() => {});

        await storage.updateWebhookEndpoint(endpoint.id, {
          totalErros: (endpoint.totalErros || 0) + 1,
        } as any).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[webhookDispatcher] Erro:", err);
  }
}
