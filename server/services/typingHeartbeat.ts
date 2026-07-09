import { sendTypingIndicator } from "./channel-router";

// ─────────────────────────────────────────────────────────────────────────────
// "Digitando…" contínuo — contém a ansiedade do cliente.
//
// Bruno 2026-06-13: o indicador de typing tem que aparecer IMEDIATO quando o
// cliente fala e PERMANECER durante todo o processamento (LLM + ERP), nos dois
// canais. Antes o typing só saía na hora de ENVIAR (depois do agente pensar):
//   - Evolution (não-oficial): não havia disparo no inbound → buraco de vários
//     segundos no início enquanto o agente raciocinava.
//   - Meta (oficial): só aparecia no markAsRead inicial do webhook (~25s) e
//     sumia entre as partes da resposta (sendTypingIndicator era no-op).
//
// Este módulo centraliza um "heartbeat": dispara o typing já no intake e o
// re-emite a cada poucos segundos (a presença "composing" do WhatsApp expira)
// até a resposta começar a sair — a própria mensagem enviada limpa o "digitando".
// Tudo best-effort: falha NUNCA bloqueia nem atrasa o fluxo.
//
// Canal-agnóstico: delega a sendTypingIndicator (channel-router), que resolve
// Evolution (presence composing) ou Meta (markAsRead+typing via wamid cacheado).
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH_MS = 4000;        // re-emite o "digitando" a cada 4s (composing expira no app)
const MAX_LIFETIME_MS = 45000;  // trava de segurança: nunca deixa um loop preso (turno órfão)

interface Loop { timer: NodeJS.Timeout; killAt: NodeJS.Timeout; }
const loops = new Map<number, Loop>();

export interface TypingTarget {
  workspaceId: string;
  to: string;
  conversationId: number;
  conexaoId?: string | null;
}

function fire(t: TypingTarget): void {
  sendTypingIndicator({
    workspaceId: t.workspaceId,
    to: t.to,
    conversationId: t.conversationId,
    ...(t.conexaoId ? { conexaoId: t.conexaoId } : {}),
  }).catch(() => {});
}

/** Dispara UM "digitando" agora, sem loop. Usado no intake pra feedback imediato
 *  assim que o cliente fala (cobre a janela de debounce antes do agente rodar). */
export function pingTyping(t: TypingTarget): void {
  fire(t);
}

/** Liga o heartbeat de "digitando" pra essa conversa: dispara imediato e re-emite
 *  a cada 4s. Idempotente — se já houver loop, reinicia (refresca o relógio).
 *  Auto-stop em 45s como trava anti-vazamento. */
export function startTypingLoop(t: TypingTarget): void {
  stopTypingLoop(t.conversationId);
  fire(t); // imediato
  const timer = setInterval(() => fire(t), REFRESH_MS);
  const killAt = setTimeout(() => stopTypingLoop(t.conversationId), MAX_LIFETIME_MS);
  // Não segurar o event loop vivo por causa do heartbeat.
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  if (typeof (killAt as any).unref === "function") (killAt as any).unref();
  loops.set(t.conversationId, { timer, killAt });
}

/** Desliga o heartbeat. A mensagem enviada já limpa o "digitando" no celular;
 *  chamar isto evita que um tick re-emita "digitando" depois da resposta. */
export function stopTypingLoop(conversationId: number): void {
  const l = loops.get(conversationId);
  if (!l) return;
  clearInterval(l.timer);
  clearTimeout(l.killAt);
  loops.delete(conversationId);
}
