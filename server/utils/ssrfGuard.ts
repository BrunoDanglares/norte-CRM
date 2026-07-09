// Guarda anti-SSRF compartilhada. Bruno 2026-06-13 (auditoria de segurança).
//
// Dois níveis de bloqueio:
//  - PRIVATE_HOST_RE  → bloqueia TODA rede interna (loopback, LAN, link-local,
//    ULA IPv6). Use em URLs que o USUÁRIO define livremente (webhooks de saída),
//    onde nenhum host interno é legítimo.
//  - DANGEROUS_HOST_RE → bloqueia só loopback + metadata cloud + link-local +
//    0.0.0.0. Use onde um host de LAN PODE ser legítimo (ex.: ERP do provedor
//    numa VPN), mas o endpoint de metadata da cloud / localhost nunca é.
//
// Mesmo padrão já usado em routes/link-preview.ts (PRIVATE_HOST_RE), agora
// centralizado pra reuso.

export const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|\[?::1\]?|\[?fc[0-9a-f]{2}:|\[?fd[0-9a-f]{2}:|\[?fe80:)/i;

export const DANGEROUS_HOST_RE =
  /^(localhost|0\.0\.0\.0|127\.|169\.254\.|\[?::1\]?|\[?fe80:)/i;

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname);
}

export function isDangerousHost(hostname: string): boolean {
  return DANGEROUS_HOST_RE.test(hostname);
}

/**
 * Valida uma URL definida pelo usuário (webhook de saída). Lança se o protocolo
 * não for http/https ou se o host bater em qualquer rede interna.
 */
export function assertSafeOutboundUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Protocolo não suportado (use http ou https)");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Host privado/interno bloqueado por segurança");
  }
  return parsed;
}

/**
 * fetch que re-valida o host a CADA redirect (redirect:"manual"). Sem isso, a
 * allowlist/blocklist só vale pra 1ª hop e um host público que faz 302 pra
 * 169.254.169.254 / 127.0.0.1 / rede interna é seguido server-side (SSRF).
 * Mesmo padrão de routes/link-preview.ts, centralizado pra reuso.
 */
export async function safeOutboundFetch(rawUrl: string, init: RequestInit = {}, maxRedirects = 4): Promise<Response> {
  let current = assertSafeOutboundUrl(rawUrl);
  for (let i = 0; i <= maxRedirects; i++) {
    const resp = await fetch(current.toString(), { ...init, redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      current = assertSafeOutboundUrl(new URL(loc, current).toString());
      continue;
    }
    return resp;
  }
  throw new Error("redirects demais");
}

/**
 * Valida a URL base de um ERP (configurada pelo admin do tenant). Mais permissiva
 * que a de webhook: aceita LAN privada (VPN do provedor), mas bloqueia loopback e
 * o endpoint de metadata da cloud (anti-SSRF de roubo de credencial de instância).
 */
export function assertSafeErpUrl(rawUrl: string): void {
  if (!rawUrl) return; // vazio = sem ERP configurado, validado em outro lugar
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL do ERP inválida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL do ERP deve usar http ou https");
  }
  if (isDangerousHost(parsed.hostname)) {
    throw new Error("Host do ERP bloqueado por segurança (loopback/metadata)");
  }
}
