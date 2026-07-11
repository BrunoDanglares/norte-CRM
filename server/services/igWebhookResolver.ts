import { db } from "../db";
import { instagramConnections } from "@shared/schema";
import { eq, or } from "drizzle-orm";

/**
 * Resolve a conexão Instagram de um webhook recebido.
 *
 * A Meta entrega os webhooks (comentário/DM) usando o ID da conta que ELA conhece
 * (o "comercial", ex.: 1784...), que nem sempre é igual ao ig_user_id gravado quando
 * a conta é conectada via "Login do Instagram" (ex.: Instagram-scoped 2756...). Como
 * a mesma conta pode ter vários IDs (troca de app gera IDs novos), guardamos o ID de
 * entrega em `ig_webhook_id` e casamos por ig_user_id OU ig_webhook_id.
 *
 * Casamento EXATO, sem adivinhação — seguro para multi-tenant. Se não casar (ID de
 * entrega ainda não mapeado), retorna null e loga as conexões ativas p/ diagnóstico;
 * o mapeamento é feito setando ig_webhook_id na conexão certa.
 */
/**
 * Anti-loop: detecta comentário feito pela PRÓPRIA conta conectada. Sem isso, o reply
 * público do bot (que é postado como comentário) dispara um novo webhook de `comments`
 * → o bot responde de novo → loop infinito (gasta OpenAI + spam de comentários).
 * Análogo ao `is_echo` das DMs. Cobre o autor em qualquer formato de ID + username.
 */
export function isOwnAccountComment(
  conn: { igUserId: string; igWebhookId: string | null; igUsername: string },
  from: { id?: string; username?: string } | undefined,
  webhookAccountId: string,
): boolean {
  const fromId = from?.id || "";
  if (fromId && (fromId === webhookAccountId || fromId === conn.igUserId || fromId === conn.igWebhookId)) {
    return true;
  }
  const fromUser = (from?.username || "").trim().toLowerCase();
  if (fromUser && fromUser === (conn.igUsername || "").trim().toLowerCase()) {
    return true;
  }
  return false;
}

export async function resolveIgConnectionForWebhook(webhookIgId: string) {
  const matches = await db
    .select()
    .from(instagramConnections)
    .where(
      or(
        eq(instagramConnections.igUserId, webhookIgId),
        eq(instagramConnections.igWebhookId, webhookIgId),
      ),
    );
  if (matches.length) {
    return matches.find((c) => c.isActive) || matches[0];
  }

  const active = await db
    .select({
      id: instagramConnections.id,
      igUserId: instagramConnections.igUserId,
      igWebhookId: instagramConnections.igWebhookId,
      username: instagramConnections.igUsername,
      workspaceId: instagramConnections.workspaceId,
    })
    .from(instagramConnections)
    .where(eq(instagramConnections.isActive, true));
  console.warn(
    `[IG Webhook] igUserId ${webhookIgId} sem conexão (ig_user_id/ig_webhook_id não bateram). ` +
      `Mapeie via UPDATE instagram_connections SET ig_webhook_id='${webhookIgId}' na conexão certa. ` +
      `Ativas: ${JSON.stringify(active)}`,
  );
  return null;
}
