import type Stripe from 'stripe';
import { getUncachableStripeClient, getStripeWebhookSecret } from './stripeClient';
import { db } from './db';
import { workspaces } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function syncSubscriptionToWorkspace(subscriptionId: string) {
  try {
    const stripe = await getUncachableStripeClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const workspaceId = (sub as any).metadata?.workspaceId;
    if (!workspaceId) return;

    await db.update(workspaces).set({
      stripeSubscriptionId: sub.id,
      stripeSubscriptionStatus: sub.status,
      stripePriceId: (sub as any).items?.data?.[0]?.price?.id || null,
      stripeCurrentPeriodEnd: new Date((sub as any).current_period_end * 1000),
    }).where(eq(workspaces.id, workspaceId));

  } catch (e: any) {
    console.error(`[Stripe] Failed to sync subscription ${subscriptionId}:`, e.message);
  }
}

async function handleCheckoutComplete(sessionId: string) {
  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const workspaceId = (session as any).metadata?.workspaceId;
    const subscriptionId = (session as any).subscription;
    const customerId = (session as any).customer;

    if (workspaceId && subscriptionId) {
      await db.update(workspaces).set({
        stripeCustomerId: typeof customerId === 'string' ? customerId : null,
        stripeSubscriptionId: typeof subscriptionId === 'string' ? subscriptionId : null,
      }).where(eq(workspaces.id, workspaceId));

      await syncSubscriptionToWorkspace(subscriptionId as string);
    }
  } catch (e: any) {
    console.error(`[Stripe] Failed to handle checkout session ${sessionId}:`, e.message);
  }
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    // Bruno 2026-06-09 — validação de assinatura NATIVA do Stripe (antes vinha do
    // pacote `stripe-replit-sync`, que só rodava dentro do Replit). constructEvent
    // garante que o payload veio mesmo do Stripe (anti-spoofing) antes de tocar o banco.
    const stripe = await getUncachableStripeClient();
    const webhookSecret = getStripeWebhookSecret();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
      throw new Error(`Assinatura de webhook inválida: ${err.message}`);
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete((event.data.object as any).id);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await syncSubscriptionToWorkspace((event.data.object as any).id);
          break;
        default:
          // outros eventos são ignorados de propósito (sem ruído)
          break;
      }
    } catch (e: any) {
      console.error(`[Stripe Webhook] Erro ao processar ${event.type}:`, e.message);
    }
  }
}
