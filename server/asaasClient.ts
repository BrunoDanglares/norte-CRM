// Bruno 2026-06-13 — cliente do gateway Asaas (substitui o Stripe na assinatura do SaaS).
// O Asaas não tem SDK oficial Node decente, então falamos com a REST API v3 via fetch.
//
// Env vars (setadas no EasyPanel):
//   ASAAS_API_KEY        — access token da conta Asaas (sandbox: $aact_..._sandbox / prod: $aact_...)
//   ASAAS_ENV            — "sandbox" (default) ou "production"
//   ASAAS_BASE_URL       — (opcional) sobrescreve a base; senão deriva de ASAAS_ENV
//   ASAAS_WEBHOOK_TOKEN  — segredo que NÓS escolhemos; o Asaas devolve no header
//                          `asaas-access-token` em cada webhook pra a gente validar.
//
// Diferenças de mentalidade vs Stripe (pra quem mexer aqui depois):
//  - NÃO existe "price" pré-criado: a assinatura recebe `value` + `cycle` direto.
//  - A assinatura é um AGENDADOR de cobranças. Cada mês gera uma cobrança (payment).
//  - O cliente paga a 1ª cobrança na página hospedada do Asaas (invoiceUrl) — é pra lá
//    que a gente redireciona (equivalente ao Checkout do Stripe). No cartão, o Asaas
//    tokeniza e cobra automático nos meses seguintes.
//  - Criar cliente EXIGE cpfCnpj.

const SANDBOX_BASE = "https://api-sandbox.asaas.com/v3";
const PRODUCTION_BASE = "https://api.asaas.com/v3";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} não configurada — Asaas indisponível. Defina no EasyPanel.`);
  }
  return value;
}

export function getAsaasBaseUrl(): string {
  const override = process.env.ASAAS_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return (process.env.ASAAS_ENV?.trim().toLowerCase() === "production") ? PRODUCTION_BASE : SANDBOX_BASE;
}

// true quando o ambiente tem o mínimo pra operar o Asaas (API key).
export function isAsaasConfigured(): boolean {
  return Boolean(process.env.ASAAS_API_KEY);
}

// Token compartilhado usado pra validar a autenticidade dos webhooks.
export function getAsaasWebhookToken(): string {
  return requireEnv("ASAAS_WEBHOOK_TOKEN");
}

// Chamada genérica à API. Lança erro com a descrição do Asaas quando !ok.
export async function asaasFetch(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
  const base = getAsaasBaseUrl();
  const apiKey = requireEnv("ASAAS_API_KEY");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ChatBanana-CRM",
      access_token: apiKey,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    // Erro do Asaas vem como { errors: [{ code, description }] }
    const desc = data?.errors?.[0]?.description || data?.message || (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new Error(`Asaas ${res.status}: ${desc}`);
  }
  return data;
}

// ── Customers ──────────────────────────────────────────────────────────────
export interface AsaasCustomerInput {
  name: string;
  email?: string;
  cpfCnpj: string;          // OBRIGATÓRIO no Asaas
  mobilePhone?: string;
  externalReference?: string;
}
export async function createAsaasCustomer(input: AsaasCustomerInput): Promise<any> {
  return asaasFetch("/customers", { method: "POST", body: input });
}

// ── Subscriptions ──────────────────────────────────────────────────────────
export type AsaasBillingType = "CREDIT_CARD" | "PIX" | "BOLETO" | "UNDEFINED";
export interface AsaasSubscriptionInput {
  customer: string;
  billingType: AsaasBillingType;
  value: number;
  nextDueDate: string;      // YYYY-MM-DD
  cycle?: string;           // default MONTHLY
  description?: string;
  externalReference?: string;
}
export async function createAsaasSubscription(input: AsaasSubscriptionInput): Promise<any> {
  return asaasFetch("/subscriptions", {
    method: "POST",
    body: { cycle: "MONTHLY", ...input },
  });
}

export async function getAsaasSubscription(subscriptionId: string): Promise<any> {
  return asaasFetch(`/subscriptions/${subscriptionId}`);
}

// Cobranças geradas pela assinatura (a 1ª tem o invoiceUrl pro cliente pagar).
export async function getAsaasSubscriptionPayments(subscriptionId: string): Promise<any> {
  return asaasFetch(`/subscriptions/${subscriptionId}/payments`);
}

export async function cancelAsaasSubscription(subscriptionId: string): Promise<any> {
  return asaasFetch(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
}
