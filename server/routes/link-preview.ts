import type { Express } from "express";
import { requireAuth } from "../middleware/auth";

// Bruno 2026-05-20: endpoint pra Open Graph preview de URLs em mensagens.
// Cache em memória (LRU simples, TTL 12h) pra não bater no host externo a cada
// render. Estratégia: timeout curto + AbortController + tamanho máx 512KB pra
// evitar abuse. Bloqueia IPs privados (defesa SSRF básica).

interface PreviewPayload {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  fetchedAt: number;
}

const CACHE = new Map<string, PreviewPayload>();
const CACHE_MAX = 500;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024;

const PRIVATE_HOST_RE = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|\[?::1\]?|\[?fc[0-9a-f]{2}:|\[?fe80:)/i;

// SSRF: a checagem de host privado na URL inicial NÃO basta — com redirect:follow
// um host público pode 302 pra 169.254.169.254 (metadata) / 127.0.0.1 / rede interna
// e o fetch seguiria server-side. Seguimos manualmente, RE-VALIDANDO cada hop.
const MAX_REDIRECTS = 4;
function hostBlocked(u: URL): boolean {
  return !/^https?:$/.test(u.protocol) || PRIVATE_HOST_RE.test(u.hostname);
}
async function safeFetchFollow(start: URL, init: RequestInit): Promise<Response> {
  let current = start;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const resp = await fetch(current.toString(), { ...init, redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      const next = new URL(loc, current);
      if (hostBlocked(next)) throw new Error("redirect para host bloqueado");
      current = next;
      continue;
    }
    return resp;
  }
  throw new Error("redirects demais");
}

function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractMeta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["'][^>]*>`, "i");
  const match = html.match(re) || html.match(re2);
  return match?.[1] ? unescapeHtmlEntities(match[1]).slice(0, 600) : undefined;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1] ? unescapeHtmlEntities(m[1]).trim().slice(0, 200) : undefined;
}

function resolveUrl(maybeRelative: string | undefined, base: URL): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return undefined;
  }
}

function pruneCache() {
  if (CACHE.size <= CACHE_MAX) return;
  // Remove os mais antigos primeiro
  const entries = [...CACHE.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const toRemove = entries.slice(0, Math.floor(CACHE_MAX * 0.2));
  for (const [k] of toRemove) CACHE.delete(k);
}

export function registerLinkPreviewRoutes(app: Express) {
  app.get("/api/link-preview", requireAuth, async (req, res) => {
    const url = String(req.query.url || "").trim();
    if (!url) return res.status(400).json({ error: "url obrigatória" });

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "URL inválida" });
    }

    if (!/^https?:$/.test(parsed.protocol)) {
      return res.status(400).json({ error: "Protocolo não suportado" });
    }
    if (PRIVATE_HOST_RE.test(parsed.hostname)) {
      return res.status(400).json({ error: "Host privado bloqueado" });
    }

    const cacheKey = parsed.toString();
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      res.set("Cache-Control", "private, max-age=300");
      return res.json({ ok: true, data: cached, cached: true });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const upstream = await safeFetchFollow(parsed, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ChatBananaPreview/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      const contentType = upstream.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        return res.json({ ok: false, error: "Não é HTML" });
      }

      // Lê com limite de bytes
      const reader = upstream.body?.getReader();
      if (!reader) return res.json({ ok: false, error: "Sem corpo" });

      const decoder = new TextDecoder();
      let html = "";
      let received = 0;
      while (received < MAX_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        // Parou de receber <head>? Trunca cedo. OG fica nos primeiros 64KB.
        if (received > 64 * 1024 && /<\/head>/i.test(html)) break;
      }
      try { await reader.cancel(); } catch {}

      const finalUrl = upstream.url ? new URL(upstream.url) : parsed;

      const ogTitle = extractMeta(html, "og:title")
        || extractMeta(html, "twitter:title")
        || extractTitle(html);
      const ogDesc = extractMeta(html, "og:description")
        || extractMeta(html, "twitter:description")
        || extractMeta(html, "description");
      const ogImageRaw = extractMeta(html, "og:image")
        || extractMeta(html, "og:image:secure_url")
        || extractMeta(html, "twitter:image");
      const siteName = extractMeta(html, "og:site_name") || finalUrl.hostname.replace(/^www\./, "");

      const payload: PreviewPayload = {
        url: finalUrl.toString(),
        title: ogTitle,
        description: ogDesc,
        image: resolveUrl(ogImageRaw, finalUrl),
        siteName,
        fetchedAt: Date.now(),
      };

      // Só faz cache se conseguiu pelo menos title ou image
      if (payload.title || payload.image) {
        CACHE.set(cacheKey, payload);
        pruneCache();
      }

      res.set("Cache-Control", "private, max-age=300");
      return res.json({ ok: true, data: payload, cached: false });
    } catch (err: any) {
      clearTimeout(timeout);
      const isAbort = err?.name === "AbortError";
      return res.json({
        ok: false,
        error: isAbort ? "Timeout" : (err?.message || "Erro no fetch"),
      });
    }
  });
}
