import type { Express } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { workspaces, users, planos, subscriptionEvents } from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { maskCpf } from "../utils/mask";
import {
  isAsaasConfigured,
  createAsaasCustomer,
  createAsaasSubscription,
  getAsaasSubscription,
  getAsaasSubscriptionPayments,
  cancelAsaasSubscription,
  type AsaasBillingType,
} from "../asaasClient";
import { refreshWorkspace } from "../services/subscriptionGate";

const VALID_BILLING: AsaasBillingType[] = ["CREDIT_CARD", "PIX", "BOLETO"];

// Mascara CPF/CNPJ (11-14 dígitos) que possam vir numa mensagem de erro do Asaas
// antes de ir pro log (LGPD — logs do container são legíveis no painel).
function scrubPII(msg?: string): string {
  return String(msg || "").replace(/\d{11,14}/g, (d) => maskCpf(d));
}

// YYYY-MM-DD que o Asaas exige no nextDueDate.
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Normaliza o status de uma cobrança Asaas → vocabulário interno (mesmo do billing).
function statusFromPayment(paymentStatus?: string): string | null {
  switch (paymentStatus) {
    case "CONFIRMED":
    case "RECEIVED":
    case "RECEIVED_IN_CASH":
      return "active";
    case "OVERDUE":
      return "past_due";
    case "REFUNDED":
    case "REFUND_REQUESTED":
      return "canceled";
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return "pending";
    default:
      return null;
  }
}

export function registerAsaasRoutes(app: Express) {
  // Cria (ou reaproveita) cliente + assinatura no Asaas e devolve a URL hospedada
  // (invoiceUrl da 1ª cobrança) pra onde o front redireciona — espelha o Checkout do Stripe.
  app.post("/api/asaas/subscribe", requireAuth, async (req, res) => {
    try {
      if (!isAsaasConfigured()) return res.status(503).json({ error: "Asaas não configurado" });

      const { planoId, billingType, cpfCnpj: cpfCnpjBody } = req.body || {};
      const workspaceId = req.user!.workspaceId;
      const userId = req.user!.id;
      const email = req.user!.email;

      const bt = String(billingType || "").toUpperCase() as AsaasBillingType;
      if (!VALID_BILLING.includes(bt)) {
        return res.status(400).json({ error: "billingType inválido (use CREDIT_CARD, PIX ou BOLETO)" });
      }

      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws) return res.status(404).json({ error: "Workspace não encontrado" });

      // Plano + valor
      let plano: any = null;
      if (planoId) [plano] = await db.select().from(planos).where(eq(planos.id, planoId)).limit(1);
      if (!plano) return res.status(404).json({ error: "Plano não encontrado" });
      const value = plano.preco != null ? Number(plano.preco) : null;
      if (!value || value <= 0) return res.status(400).json({ error: "Plano sob consulta — fale com o comercial" });

      // CPF/CNPJ é obrigatório no Asaas. Aceita do body, senão do que já está salvo.
      const rawDoc = String(cpfCnpjBody || ws.cpfCnpj || ws.cnpj || "").replace(/\D/g, "");
      if (rawDoc.length !== 11 && rawDoc.length !== 14) {
        return res.status(422).json({ error: "CPF_CNPJ_REQUIRED", message: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido para assinar." });
      }
      if (rawDoc !== (ws.cpfCnpj || "")) {
        await db.update(workspaces).set({ cpfCnpj: rawDoc }).where(eq(workspaces.id, workspaceId));
      }

      // Dados do admin pra criar o cliente
      const [u] = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);

      // Garante o cliente Asaas
      let customerId = ws.asaasCustomerId;
      if (!customerId) {
        const customer = await createAsaasCustomer({
          name: u?.nome || ws.nome,
          email: email || u?.email || undefined,
          cpfCnpj: rawDoc,
          mobilePhone: (u?.telefone || "").replace(/\D/g, "") || undefined,
          externalReference: workspaceId,
        });
        customerId = customer.id;
        await db.update(workspaces).set({ asaasCustomerId: customerId }).where(eq(workspaces.id, workspaceId));
      }

      // Trial: 1ª cobrança só no fim do trial; senão hoje.
      const now = new Date();
      const trialFuture = ws.trialExpiresAt && new Date(ws.trialExpiresAt) > now ? new Date(ws.trialExpiresAt) : null;
      const nextDueDate = ymd(trialFuture || now);

      const subscription = await createAsaasSubscription({
        customer: customerId!,
        billingType: bt,
        value,
        nextDueDate,
        cycle: "MONTHLY",
        description: `ChatBanana ${plano.nome}`,
        externalReference: workspaceId,
      });

      // Auditoria 2026-06-19 (cobrança em dobro): se já existe assinatura Asaas
      // (troca de plano / re-assinatura), CANCELA a anterior — senão ela some do
      // painel (que só lê o id salvo abaixo) mas continua cobrando todo mês.
      if (ws.asaasSubscriptionId && ws.asaasSubscriptionId !== subscription.id) {
        try {
          await cancelAsaasSubscription(ws.asaasSubscriptionId);
        } catch (cancelErr: any) {
          console.warn(`[Asaas Subscribe] cancelar assinatura anterior falhou: ${scrubPII(cancelErr?.message)}`);
        }
      }

      const initialStatus = trialFuture ? "trialing" : "pending";
      // Pagamento primeiro (Bruno 2026-06-19): SEM trial, o plano NÃO é atribuído
      // agora — fica em pending_plano_id até o pagamento confirmar (o webhook do
      // Asaas promove pending_plano_id → plano_id). Assim o plano não vira
      // "contratado/atual" antes de pagar. EM trial, o acesso ao plano durante o
      // teste é legítimo, então atribui já e zera o pendente.
      const planUpdate = trialFuture
        ? { planoId: plano.id, pendingPlanoId: null }
        : { pendingPlanoId: plano.id };
      await db.update(workspaces).set({
        asaasSubscriptionId: subscription.id,
        asaasSubscriptionStatus: initialStatus,
        asaasNextDueDate: new Date(nextDueDate),
        ...planUpdate,
      }).where(eq(workspaces.id, workspaceId));
      await refreshWorkspace(workspaceId).catch(() => {});

      // Pega a URL hospedada da 1ª cobrança pra redirecionar o cliente.
      const payments = await getAsaasSubscriptionPayments(subscription.id);
      const firstCharge = payments?.data?.[0];
      const url = firstCharge?.invoiceUrl || null;

      res.json({ ok: true, url, subscriptionId: subscription.id, status: initialStatus });
    } catch (e: any) {
      console.error("[Asaas Subscribe] Error:", scrubPII(e.message));
      res.status(500).json({ error: scrubPII(e.message) });
    }
  });

  // Sincroniza status + lista de cobranças (faturas) — usado no painel "Gerenciar".
  app.get("/api/asaas/subscription", requireAuth, async (req, res) => {
    try {
      const workspaceId = req.user!.workspaceId;
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws) return res.status(404).json({ error: "Workspace não encontrado" });
      if (!ws.asaasSubscriptionId) return res.json({ ok: true, status: "none", invoices: [] });
      if (!isAsaasConfigured()) return res.status(503).json({ error: "Asaas não configurado" });

      const [sub, payments] = await Promise.all([
        getAsaasSubscription(ws.asaasSubscriptionId).catch(() => null),
        getAsaasSubscriptionPayments(ws.asaasSubscriptionId).catch(() => ({ data: [] })),
      ]);

      const invoices = (payments?.data || []).map((p: any) => ({
        id: p.id,
        value: p.value,
        status: p.status,
        billingType: p.billingType,
        dueDate: p.dueDate,
        invoiceUrl: p.invoiceUrl,
      }));

      // Deriva status atual da cobrança mais recente (se a assinatura ainda existe).
      const latest = invoices[0];
      let status = ws.asaasSubscriptionStatus || "none";
      const derived = statusFromPayment(latest?.status);
      if (sub?.status === "INACTIVE" || sub?.status === "EXPIRED") status = "canceled";
      else if (derived && status !== "trialing") status = derived;
      // Pagamento primeiro (Bruno 2026-06-19): se o pagamento já está confirmado
      // (status active) e havia um plano pendente, promove pending → ativo AQUI
      // também — rede de segurança caso o webhook do Asaas tenha falhado/atrasado.
      const promotePending = status === "active" && (ws as any).pendingPlanoId;
      if (status !== ws.asaasSubscriptionStatus || promotePending) {
        const patch: Record<string, any> = { asaasSubscriptionStatus: status };
        if (promotePending) { patch.planoId = (ws as any).pendingPlanoId; patch.pendingPlanoId = null; }
        await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
        await refreshWorkspace(workspaceId).catch(() => {});
      }

      res.json({ ok: true, status, subscription: sub, invoices });
    } catch (e: any) {
      // Auditoria 2026-06-20: detalhe da API Asaas só no log (já com scrubPII); resposta genérica.
      console.error("[Asaas Subscription] Error:", scrubPII(e.message));
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Webhook do Asaas (eventos de cobrança). Sem requireAuth — validado pelo token
  // no header `asaas-access-token`. Está sob express.json (não precisa de raw body).
  app.post("/api/asaas/webhook", async (req, res) => {
    try {
      const { AsaasWebhookHandlers } = await import("../asaasWebhookHandlers");
      await AsaasWebhookHandlers.processWebhook(req.body, req.header("asaas-access-token") || undefined);
      res.json({ received: true });
    } catch (err: any) {
      console.error("[Asaas Webhook] Error:", err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // Cancela a assinatura no Asaas (não há portal hospedado como no Stripe).
  // DELETE /subscriptions/{id} interrompe a cobrança recorrente e remove as cobranças
  // ainda pendentes; o cliente mantém acesso até o fim do período já pago (o gate
  // libera enquanto asaasNextDueDate estiver no futuro — ver subscriptionGate).
  app.post("/api/asaas/cancel", requireAuth, async (req, res) => {
    try {
      const workspaceId = req.user!.workspaceId;
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      if (!ws?.asaasSubscriptionId) return res.status(400).json({ error: "Workspace sem assinatura Asaas" });
      if (!isAsaasConfigured()) return res.status(503).json({ error: "Asaas não configurado" });

      // Já estava cancelado? Evita rechamar o Asaas e duplicar o evento de churn.
      const alreadyCanceled = ws.asaasSubscriptionStatus === "canceled";

      // DELETE da assinatura no Asaas. Se ela JÁ não existe lá (404 / id obsoleto /
      // clique repetido), tratamos como sucesso idempotente: o objetivo do cliente
      // (parar de ser cobrado) já está atingido, então não deixamos o status local
      // preso por causa de um id morto. Erro real (rede, auth, 5xx) ainda propaga.
      try {
        await cancelAsaasSubscription(ws.asaasSubscriptionId);
      } catch (e: any) {
        const msg = String(e?.message || "");
        const gone = /\b404\b|not found|não encontrad|invalid_action|already/i.test(msg);
        if (!gone) throw e;
        console.warn(`[Asaas Cancel] assinatura ${ws.asaasSubscriptionId} já inexistente no Asaas — cancelando local. (${scrubPII(msg)})`);
      }

      // Zera o plano pendente: cancelou antes de pagar → não promove depois.
      await db.update(workspaces).set({ asaasSubscriptionStatus: "canceled", pendingPlanoId: null }).where(eq(workspaces.id, workspaceId));
      await refreshWorkspace(workspaceId).catch(() => {});

      // Histórico de churn (super-admin: MRR/churn). Registramos AQUI no cancelamento
      // manual porque o webhook PAYMENT_DELETED nem sempre dispara (e já ficou fora do
      // ar — incidente do token). O webhook tem dedup: não loga "canceled" de novo se
      // o status já é canceled. Só grava quando ainda não estava cancelado → sem
      // duplicar churn em retry/duplo-clique.
      if (!alreadyCanceled) {
        try {
          await db.insert(subscriptionEvents).values({
            workspaceId,
            eventType: "canceled",
            planoId: ws.planoId ?? null,
            mrr: "0",
            details: { source: "manual_cancel", subscriptionId: ws.asaasSubscriptionId },
          });
        } catch (e: any) {
          console.warn(`[Asaas Cancel] subscription_event insert falhou: ${e.message}`);
        }
      }

      res.json({ ok: true, status: "canceled" });
    } catch (e: any) {
      console.error("[Asaas Cancel] Error:", scrubPII(e.message));
      res.status(500).json({ error: scrubPII(e.message) });
    }
  });
}
