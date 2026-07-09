// Cloudflare Turnstile (captcha anti-bot) — verificação server-side. Auditoria 2026-06-20.
//
// GATED por env: se TURNSTILE_SECRET NÃO está setado, verifyTurnstile() é NO-OP (retorna
// true) → o cadastro segue normal enquanto o Bruno não configurar as chaves do Cloudflare.
//
// Para ATIVAR (no EasyPanel, os DOIS juntos):
//   - TURNSTILE_SECRET   = secret key do widget (runtime, backend valida)
//   - TURNSTILE_SITE_KEY = site key do widget (exposto em /api/auth/config → o front
//                          renderiza o widget e manda o token no cadastro)
// Criar o widget em https://dash.cloudflare.com → Turnstile (grátis).

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET;
}

export async function verifyTurnstile(token: string | undefined | null, ip?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET || "";
  if (!secret) return true;   // não configurado → não bloqueia (no-op)
  if (!token) return false;   // configurado e sem token → bloqueia

  try {
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", String(token));
    if (ip) form.append("remoteip", ip);

    const resp = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(8000),
    });
    const data: any = await resp.json().catch(() => ({}));
    return data?.success === true;
  } catch (e: any) {
    // Erro de rede com o Cloudflare → fail-OPEN (não trava cadastro legítimo numa queda
    // do Turnstile). Captcha é defesa-em-profundidade; o registerRateLimit dedicado já é a
    // barreira primária. Loga pra visibilidade.
    console.warn("[Turnstile] verify indisponível, liberando (fail-open):", e?.message);
    return true;
  }
}
