import { db } from "../db";
import { workspaces } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Subscription gate — bloqueio por NÃO-PAGAMENTO / trial vencido, O(1) por request.
//
// Bruno 2026-06-15: a assinatura do SaaS (Asaas) precisa BARRAR acesso de quem
// não paga, sem custo de DB por request. Mesma arquitetura do tenantBlocklist:
// um Set em memória é a fonte rápida; o banco (workspaces.*) é a fonte durável,
// carregada no boot, atualizada pelo webhook do Asaas, pelos toggles do super-admin
// e por um cron diário (rede de segurança pra trial vencendo / grace estourando).
//
// Quando o workspace está inadimplente, requireAuth devolve 402 { paywall:true } →
// o front manda pro /assinatura (SEM logout) pra ele regularizar. As rotas de
// billing/asaas/auth ficam fora do gate pra ele conseguir pagar.
//
// Regras (conservadoras, com GRANDFATHER pra não cortar legado no deploy):
//  - VIP (cortesia, ligado pelo super-admin) → nunca bloqueia.
//  - Assinatura 'active' → ok.
//  - Trial vigente (trialExpiresAt no futuro) → ok.
//  - Janela de tolerância de GRACE_DAYS em torno do vencimento (cobre pending/
//    trialing/past_due recém-vencidos enquanto o Asaas retenta) → ok.
//  - Fora disso: trial vencido sem assinar, ou assinatura canceled/past_due/pending
//    além da tolerância → INADIMPLENTE.
//  - Workspace que NUNCA teve trial nem assinatura Asaas (legado) → nunca bloqueia.
// ─────────────────────────────────────────────────────────────────────────────

const GRACE_DAYS = 7; // tolerância após o vencimento (decisão Bruno)

const delinquentWorkspaces = new Set<string>();
const vipWorkspaces = new Set<string>();

type GateRow = {
  id: string;
  isVip: boolean | null;
  trialExpiresAt: Date | null;
  asaasSubscriptionStatus: string | null;
  asaasNextDueDate: Date | null;
};

const GATE_COLS = {
  id: workspaces.id,
  isVip: workspaces.isVip,
  trialExpiresAt: workspaces.trialExpiresAt,
  asaasSubscriptionStatus: workspaces.asaasSubscriptionStatus,
  asaasNextDueDate: workspaces.asaasNextDueDate,
};

/** Função PURA: o workspace está inadimplente? (não toca em rede/memória) */
export function computeDelinquent(ws: GateRow): boolean {
  if (ws.isVip) return false;
  const now = Date.now();
  const trial = ws.trialExpiresAt ? new Date(ws.trialExpiresAt).getTime() : null;
  const status = ws.asaasSubscriptionStatus || null;
  const due = ws.asaasNextDueDate ? new Date(ws.asaasNextDueDate).getTime() : null;
  const grace = GRACE_DAYS * 86400000;

  const tentandoPagar = status === "past_due" || status === "pending" || status === "trialing";

  if (status === "active") return false;                 // pagando em dia
  if (trial != null && trial > now) return false;        // trial vigente
  if (due != null && due > now) return false;            // pagou até o fim do período (vencimento no futuro)
  // tolerância de GRACE_DAYS após o vencimento — só pra quem está TENTANDO pagar
  // (NÃO vale pra cancelado/estornado, que perde acesso ao vencer).
  if (due != null && tentandoPagar && now <= due + grace) return false;

  // daqui: vencido e fora da tolerância, ou cancelado/estornado já vencido.
  if (status === "canceled" || tentandoPagar) return true;
  if (trial != null && trial <= now) return true;        // trial venceu e nunca assinou

  // grandfather: nunca teve trial nem assinatura → não bloqueia (legado)
  return false;
}

function applyRow(ws: GateRow) {
  if (ws.isVip) vipWorkspaces.add(ws.id); else vipWorkspaces.delete(ws.id);
  if (computeDelinquent(ws)) delinquentWorkspaces.add(ws.id); else delinquentWorkspaces.delete(ws.id);
}

/** Carrega o estado durável do banco pra memória. Chamado no boot e pelo cron diário. */
export async function loadGate(): Promise<void> {
  try {
    const rows = await db.select(GATE_COLS).from(workspaces) as GateRow[];
    delinquentWorkspaces.clear();
    vipWorkspaces.clear();
    for (const ws of rows) applyRow(ws);
    console.log(`[Gate] carregado: ${delinquentWorkspaces.size} inadimplente(s), ${vipWorkspaces.size} VIP(s)`);
  } catch (e: any) {
    console.error("[Gate] erro ao carregar:", e.message);
  }
}

/** Recomputa 1 workspace (chamado pelo webhook do Asaas e pelos toggles). */
export async function refreshWorkspace(workspaceId: string): Promise<void> {
  try {
    const [ws] = await db.select(GATE_COLS).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1) as GateRow[];
    if (ws) applyRow(ws);
  } catch (e: any) {
    console.error(`[Gate] erro ao refrescar ${workspaceId}:`, e.message);
  }
}

/** Liga/desliga o status VIP (cortesia) e libera/recomputa na hora. */
export async function setWorkspaceVip(workspaceId: string, vip: boolean): Promise<void> {
  await db.update(workspaces).set({ isVip: vip, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  if (vip) vipWorkspaces.add(workspaceId); else vipWorkspaces.delete(workspaceId);
  await refreshWorkspace(workspaceId);
}

export function isDelinquent(workspaceId?: string | null): boolean {
  return !!workspaceId && delinquentWorkspaces.has(workspaceId);
}

export function isVip(workspaceId?: string | null): boolean {
  return !!workspaceId && vipWorkspaces.has(workspaceId);
}

/** Enforcement LIGADO por padrão; `BILLING_ENFORCEMENT=off` é o freio de emergência. */
export function billingEnforcementOn(): boolean {
  return (process.env.BILLING_ENFORCEMENT || "").toLowerCase() !== "off";
}
