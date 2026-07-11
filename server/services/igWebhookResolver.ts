import { db } from "../db";
import { instagramConnections } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve a conexão Instagram de um webhook recebido, tolerando o descasamento
 * de ID entre "Login do Instagram" e a entrega da Meta.
 *
 * Problema (Bruno 2026-07-11): quando a conta é conectada via "Login do Instagram"
 * (/ig-callback), gravamos o igUserId no formato Instagram-scoped (ex.: 2756...).
 * Mas a Meta ENTREGA os webhooks (comentário/DM) usando o ID comercial da conta
 * (ex.: 1784...), porque a conta está vinculada a uma Página do Facebook. É a mesma
 * conta com dois "apelidos" numéricos — então o lookup por igUserId falhava e o
 * evento era descartado (nenhum comentário/DM respondido).
 *
 * Estratégia:
 *  1) Casa exato por igUserId (preferindo a conexão ativa).
 *  2) Fallback seguro: se NÃO casou, olha as conexões ATIVAS. Se TODAS forem da
 *     MESMA conta (@username) — caso do id trocado, incluindo conexões-fantasma de
 *     app antigo — roteia pra mais recente (o app só recebe eventos de contas
 *     conectadas a ele, então não há ambiguidade). Só recusa (retorna null) se
 *     houver contas DIFERENTES ativas — aí seria ambíguo entre tenants e o chamador
 *     loga o miss em vez de arriscar rotear pro tenant errado.
 */
export async function resolveIgConnectionForWebhook(webhookIgId: string) {
  const matches = await db
    .select()
    .from(instagramConnections)
    .where(eq(instagramConnections.igUserId, webhookIgId));
  if (matches.length) {
    return matches.find((c) => c.isActive) || matches[0];
  }

  const active = await db
    .select()
    .from(instagramConnections)
    .where(eq(instagramConnections.isActive, true));
  if (active.length === 0) return null;

  const distinctAccounts = new Set(active.map((c) => (c.igUsername || "").toLowerCase()));
  if (distinctAccounts.size > 1) return null; // contas diferentes ativas → não adivinha

  // Uma única conta ativa (com ou sem duplicatas-fantasma) → mais recente.
  const chosen = [...active].sort(
    (a, b) => new Date(b.updatedAt as any).getTime() - new Date(a.updatedAt as any).getTime(),
  )[0];
  console.warn(
    `[IG Webhook] igUserId ${webhookIgId} não cadastrado; roteando p/ conexão ativa @${chosen.igUsername} (id salvo=${chosen.igUserId}, ${active.length} ativa(s) da mesma conta) — mismatch de ID (IG Login vs webhook comercial)`,
  );
  return chosen;
}
