// Bruno 2026-06-13 — webhook do Asaas. Diferente do Stripe:
//  - O Asaas NÃO tem evento de assinatura; manda eventos de COBRANÇA (PAYMENT_*),
//    e cada payload traz `payment.subscription` pra amarrar de volta na assinatura.
//  - Validação é por TOKEN ESTÁTICO no header `asaas-access-token` (que nós definimos
//    ao criar o webhook), não por assinatura HMAC do corpo. Logo o body pode ser JSON
//    normal (sem raw body como o Stripe exige).
import { db } from "./db";
import { workspaces, planos, subscriptionEvents } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { getAsaasWebhookToken } from "./asaasClient";
import { refreshWorkspace } from "./services/subscriptionGate";

// Comparação de token em tempo constante (Bruno 2026-06-13, auditoria): evita
// timing attack que reconstrói o token medindo latência. Mesmo padrão dos
// webhooks Meta/Evolution.
function tokensMatch(got: string | undefined, expected: string | undefined): boolean {
  if (!got || !expected) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Acha o workspace dono dessa cobrança.
// Bruno 2026-06-14 (auditoria): o `subscription` é id gerado pelo Asaas (não dá pra
// forjar mirando uma vítima específica) → caminho autoritativo. O `externalReference`
// (=workspaceId que NÓS setamos no subscribe) só é aceito pra VINCULAR um workspace
// que ainda não tem assinatura (ou cuja assinatura bate com a do payload). Assim, um
// webhook forjado com externalReference de uma vítima não consegue flipar o status dela.
async function findWorkspace(payment: any): Promise<{ id: string; asaasSubscriptionId: string | null; asaasSubscriptionStatus: string | null; pendingPlanoId: string | null } | null> {
  const subId = payment?.subscription;
  if (subId) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.asaasSubscriptionId, subId)).limit(1);
    if (ws) return ws as any;
  }
  const ext = payment?.externalReference;
  if (ext) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, ext)).limit(1);
    if (ws && (!(ws as any).asaasSubscriptionId || (ws as any).asaasSubscriptionId === subId)) {
      return ws as any;
    }
  }
  return null;
}

export class AsaasWebhookHandlers {
  // `token` = header `asaas-access-token`. `body` = JSON já parseado { event, payment }.
  static async processWebhook(body: any, token: string | undefined): Promise<void> {
    const expected = getAsaasWebhookToken();
    if (!tokensMatch(token, expected)) {
      throw new Error("Token de webhook Asaas inválido");
    }

    const event: string = body?.event || "";
    const payment = body?.payment;
    if (!event || !payment) return; // outros tipos (ex: transferências) ignorados

    const ws = await findWorkspace(payment);
    if (!ws) {
      console.warn(`[Asaas Webhook] ${event}: sem workspace pra payment ${payment?.id} / sub ${payment?.subscription}`);
      return;
    }

    const patch: Record<string, any> = {};
    let logEvent: string | null = null; // tipo do evento p/ o historico de receita (subscription_events)
    switch (event) {
      case "PAYMENT_CONFIRMED":
      case "PAYMENT_RECEIVED":
      case "PAYMENT_RECEIVED_IN_CASH":
        patch.asaasSubscriptionStatus = "active";
        if (payment.dueDate) patch.asaasNextDueDate = new Date(payment.dueDate);
        // Pagamento primeiro (Bruno 2026-06-19): SÓ AGORA o plano vira oficialmente o
        // do cliente. Promove o plano pendente (escolhido no subscribe) → plano ativo
        // e zera o pendente. Antes do pagamento o plano novo nunca era atribuído.
        if (ws.pendingPlanoId) { patch.planoId = ws.pendingPlanoId; patch.pendingPlanoId = null; }
        logEvent = "payment_confirmed";
        break;
      case "PAYMENT_OVERDUE":
      case "PAYMENT_REPROVED_BY_RISK_ANALYSIS": // cartão recusado na análise → inadimplente
        patch.asaasSubscriptionStatus = "past_due";
        logEvent = "payment_overdue";
        break;
      case "PAYMENT_REFUNDED":
      case "PAYMENT_DELETED":
        patch.asaasSubscriptionStatus = "canceled";
        // Estorno/exclusão da cobrança → não promove plano pendente depois.
        if (ws.pendingPlanoId) patch.pendingPlanoId = null;
        // Dedup do churn: se já estava cancelado (ex.: o cliente cancelou pela rota
        // /api/asaas/cancel, que já registrou o evento + setou canceled), NÃO loga
        // "canceled" de novo — senão o super-admin contaria a mesma baixa 2x.
        if (ws.asaasSubscriptionStatus !== "canceled") logEvent = "canceled";
        break;
      case "PAYMENT_CREATED":
      case "PAYMENT_UPDATED":
        // garante o vínculo do id da assinatura (caso tenha faltado no subscribe) e
        // mantém o nextDueDate fresco a cada cobrança gerada (evita data defasada).
        if (payment.subscription && !(ws as any).asaasSubscriptionId) {
          patch.asaasSubscriptionId = payment.subscription;
        }
        if (payment.dueDate) patch.asaasNextDueDate = new Date(payment.dueDate);
        break;
      default:
        return; // evento não relevante
    }

    if (Object.keys(patch).length) {
      await db.update(workspaces).set(patch).where(eq(workspaces.id, ws.id));
      console.log(`[Asaas Webhook] ${event} → workspace ${ws.id}: ${JSON.stringify(patch)}`);
      // Recalcula bloqueio/liberação na hora (não espera o cron diário).
      await refreshWorkspace(ws.id).catch(() => {});
    }

    // Histórico de RECEITA da plataforma (alimenta MRR ao longo do tempo + Churn no
    // super-admin). mrr = preço do plano vigente APÓS o update (já promoveu o pendente);
    // 0 quando cancela. Bruno 2026-06-19.
    if (logEvent) {
      try {
        // Idempotência (auditoria 2026-06-20): o Asaas REENVIA o mesmo evento em retry e a
        // rota é isenta de rate-limit → sem dedup, cada reentrega do mesmo PAYMENT_CONFIRMED
        // criava uma NOVA linha de receita (inflava o gráfico mensal de receita do super-admin;
        // o MRR headline vem do snapshot de workspaces, esse não infla). Mesmo
        // (workspace, evento, paymentId) entra uma única vez.
        const paymentId: string | null = payment?.id ?? null;
        if (paymentId) {
          const [dup] = await db
            .select({ id: subscriptionEvents.id })
            .from(subscriptionEvents)
            .where(and(
              eq(subscriptionEvents.workspaceId, ws.id),
              eq(subscriptionEvents.eventType, logEvent),
              sql`${subscriptionEvents.details}->>'paymentId' = ${paymentId}`,
            ))
            .limit(1);
          if (dup) {
            console.log(`[Asaas Webhook] evento duplicado ignorado (idempotência): ${logEvent} paymentId=${paymentId}`);
            return;
          }
        }
        const [wp] = await db
          .select({ planoId: workspaces.planoId, preco: planos.preco })
          .from(workspaces)
          .leftJoin(planos, eq(planos.id, workspaces.planoId))
          .where(eq(workspaces.id, ws.id))
          .limit(1);
        await db.insert(subscriptionEvents).values({
          workspaceId: ws.id,
          eventType: logEvent,
          planoId: wp?.planoId ?? null,
          mrr: logEvent === "canceled" ? "0" : (wp?.preco ?? null),
          details: { event, paymentId },
        });
      } catch (e: any) {
        console.warn(`[Asaas Webhook] subscription_event insert falhou: ${e.message}`);
      }
    }
  }
}
