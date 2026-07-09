import Stripe from 'stripe';

// Bruno 2026-06-09 — desacoplado do Replit Connectors.
// Antes: credenciais vinham de um conector Replit em runtime (REPLIT_CONNECTORS_HOSTNAME
// + X-Replit-Token) e o webhook usava o pacote `stripe-replit-sync`. Isso SÓ funciona
// dentro do Replit — em produção (EasyPanel/VPS) essas envs não existem e TODA chamada
// Stripe lançava erro, deixando cobrança 100% morta.
// Agora: chaves vêm de env vars padrão, setadas no painel do EasyPanel.
//   STRIPE_SECRET_KEY      — chave secreta (sk_live_... / sk_test_...)
//   STRIPE_PUBLISHABLE_KEY — chave pública (pk_live_... / pk_test_...)
//   STRIPE_WEBHOOK_SECRET  — segredo de assinatura do webhook (whsec_...)

const STRIPE_API_VERSION = '2025-08-27.basil' as any;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} não configurada — Stripe indisponível. Defina no EasyPanel.`);
  }
  return value;
}

let _client: Stripe | null = null;

// Nome mantido por compatibilidade com os imports existentes (webhookHandlers, admin routes).
export async function getUncachableStripeClient(): Promise<Stripe> {
  if (!_client) {
    _client = new Stripe(requireEnv('STRIPE_SECRET_KEY'), { apiVersion: STRIPE_API_VERSION });
  }
  return _client;
}

export async function getStripePublishableKey(): Promise<string> {
  return requireEnv('STRIPE_PUBLISHABLE_KEY');
}

export async function getStripeSecretKey(): Promise<string> {
  return requireEnv('STRIPE_SECRET_KEY');
}

export function getStripeWebhookSecret(): string {
  return requireEnv('STRIPE_WEBHOOK_SECRET');
}

// true quando o ambiente tem o mínimo pra operar o Stripe (secret + webhook).
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}
