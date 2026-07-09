// Throttle + backoff pra envios outbound via Meta Cloud API.
//
// Por que: Meta limita o tráfego de saída por phone_number_id (limite default
// ~80 msg/s no tier comum). Sem throttle local, workspace com agente ISP
// respondendo N leads em paralelo bate o limite, recebe 429 e a mensagem
// é descartada — sem retry. Risco de banimento temporário do número se a
// Meta detectar abuso.
//
// Estratégia:
//   1. Token-bucket leve em memória, por phoneNumberId. Default 70/s
//      (margem de 10 sob o limite oficial). Tunável via env.
//   2. Quando bucket cheio, await até sair da janela de 1s.
//   3. Em 429 retornado pela Meta, retry exponencial (500ms, 1500ms, 4000ms).
//
// Não cobre cluster horizontal — se o app rodar em N nós, cada um tem seu
// bucket local e o limite efetivo é N × META_OUTBOUND_RATE_PER_SEC. Quando
// chegar nesse ponto, mover pra Redis. Hoje (single VPS) é suficiente.

const META_RATE_PER_SEC = Number(process.env.META_OUTBOUND_RATE_PER_SEC || 70);
const WINDOW_MS = 1000;

// phoneNumberId → timestamps (ms) dos últimos envios dentro da janela
const sentInWindow = new Map<string, number[]>();

export async function awaitMetaRateLimit(phoneNumberId: string): Promise<void> {
  if (!phoneNumberId) return;
  // Cap defensivo — se algo travar, no máximo 4s de espera (20 × 200ms).
  // Depois disso, deixa passar; a Meta também faz throttle do próprio lado.
  for (let attempt = 0; attempt < 20; attempt++) {
    const now = Date.now();
    const stored = sentInWindow.get(phoneNumberId) ?? [];
    // Drop timestamps fora da janela.
    const live: number[] = [];
    for (const t of stored) {
      if (now - t < WINDOW_MS) live.push(t);
    }
    if (live.length < META_RATE_PER_SEC) {
      live.push(now);
      sentInWindow.set(phoneNumberId, live);
      return;
    }
    sentInWindow.set(phoneNumberId, live);
    // Espera até o token mais antigo sair da janela. Cap em 200ms por iteração
    // pra liberar event loop e revalidar (outras chamadas podem ter saído).
    const oldest = live[0]!;
    const wait = Math.min(WINDOW_MS - (now - oldest) + 5, 200);
    await new Promise((r) => setTimeout(r, wait));
  }
  console.warn(`[MetaRateLimit] giving up wait for ${phoneNumberId} after 4s — letting through`);
}

const RETRY_DELAYS_MS = [500, 1500, 4000];

export async function withMetaRetry<T>(
  fn: () => Promise<T>,
  label = 'meta',
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status ?? err?.code;
      const msg = String(err?.message || '');
      const isRateLimit =
        status === 429 ||
        status === '429' ||
        /rate.?limit|too many requests|throttled/i.test(msg);
      // Bruno 2026-05-13 (conv 350): "fetch failed" + ECONNRESET/ENOTFOUND
      // bloqueavam o agente sem retry. São falhas de REDE TRANSIENTES (TCP
      // não estabelecido, DNS instável, server 5xx) — Meta NÃO chegou a
      // processar, retry é seguro (sem risco de duplicar mensagem).
      // NÃO retry em timeouts (ETIMEDOUT) porque request pode ter sido
      // processado mas resposta perdeu — duplicar seria pior.
      const isTransientNetwork =
        status === 'ECONNRESET' ||
        status === 'ENOTFOUND' ||
        status === 'EAI_AGAIN' ||
        status === 502 || status === 503 || status === 504 ||
        /fetch failed|socket hang up|network/i.test(msg);
      const shouldRetry = isRateLimit || isTransientNetwork;
      if (!shouldRetry || i === RETRY_DELAYS_MS.length) throw err;
      const delay = RETRY_DELAYS_MS[i]!;
      const reason = isRateLimit ? '429' : 'NET';
      console.warn(
        `[MetaRateLimit] ${reason} (${label}, attempt=${i + 1}) — backoff ${delay}ms: ${msg.slice(0, 120)}`,
      );
      await new Promise((r) => setTimeout(r, delay));
      lastErr = err;
    }
  }
  throw lastErr;
}

export function metaRateLimitStats() {
  const out: Record<string, number> = {};
  for (const [k, v] of sentInWindow.entries()) out[k] = v.length;
  return { perSecLimit: META_RATE_PER_SEC, inFlight: out };
}
