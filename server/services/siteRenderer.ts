// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Renderizador de site (navegador headless).
//
// Sites modernos de SaaS/landing são SPAs (React/Framer/Next): o <body> vem VAZIO
// no fetch simples (sem JS). Preços, planos e o conteúdo real só existem DEPOIS que
// o JavaScript renderiza. Aqui abrimos a página num Chromium headless, esperamos o
// JS rodar e lemos o DOM DE VERDADE — texto visível (preços reais) + paleta de cores.
//
// SEGURANÇA: valida a URL contra a guarda anti-SSRF ANTES de navegar e intercepta
// CADA request do navegador, abortando qualquer host interno/privado (defende
// redirect e sub-recurso apontando pra rede interna). Bruno 2026-07-09.
// ═══════════════════════════════════════════════════════════════════════════

import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";
import { lookup } from "dns/promises";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { assertSafeOutboundUrl, isPrivateHost } from "../utils/ssrfGuard";

const UA_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let browserPromise: Promise<Browser> | null = null;

// ── Teto de concorrência (Bruno 2026-07-09, achado da revisão) ──
// O browser é um singleton compartilhado por TODOS os tenants. Sem limite, um tenant
// disparando dezenas de "Analisar" em paralelo abriria dezenas de páginas pesadas no
// MESMO Chromium → OOM → derruba o container de todos. Limitamos a N renders simultâneos
// e enfileiramos um pouco; acima disso, recusamos (o chamador cai no fetch simples).
const MAX_RENDER = 2;
const MAX_FILA = 8;
let ativos = 0;
const fila: Array<() => void> = [];
function adquirirRender(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ativos >= MAX_RENDER && fila.length >= MAX_FILA) {
      return reject(new Error("Muitas análises de site em andamento. Tente de novo em instantes."));
    }
    const tenta = () => { if (ativos < MAX_RENDER) { ativos++; resolve(); } else fila.push(tenta); };
    tenta();
  });
}
function liberarRender(): void {
  ativos = Math.max(0, ativos - 1);
  const next = fila.shift();
  if (next) next();
}

// Resolve o hostname e diz se QUALQUER IP (v4/v6) cai em faixa privada/loopback/metadata.
// Fecha o vetor "hostname público com registro A apontando pra 127.0.0.1/169.254.169.254"
// (a guarda por string de host não pega isso). Falha de DNS → tratado como bloqueado.
async function resolveInterno(hostname: string): Promise<boolean> {
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.some((a) => isPrivateHost(a.address));
  } catch {
    return true;
  }
}

// Acha o Chromium: env explícito → binários conhecidos do sistema (o nome varia entre
// versões do Alpine: /usr/bin/chromium no atual, /usr/bin/chromium-browser no antigo) →
// undefined (deixa o puppeteer usar o bundled, como no dev local). Resiliente a drift de
// versão do Alpine — sem isso, um path errado quebraria o render SILENCIOSAMENTE em prod.
function acharChromium(): string | undefined {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(p)) return p;
  }
  // Nixpacks/Nix instala o chromium FORA de /usr/bin (nix profile) → resolve pelo PATH.
  for (const bin of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    try {
      const p = execSync(`command -v ${bin} 2>/dev/null`, { stdio: ["ignore", "pipe", "ignore"], shell: "/bin/sh" }).toString().trim();
      if (p && existsSync(p)) return p;
    } catch { /* não encontrado */ }
  }
  return undefined; // deixa o puppeteer usar o bundled (dev local)
}

// Singleton preguiçoso — lança o Chromium na 1ª vez e reusa. Local usa o Chromium
// que o puppeteer baixou; em produção (Alpine) usa o do sistema (ver Dockerfile).
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath: acharChromium(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
        ],
      })
      .then((b) => {
        // se o Chromium morrer, zera pra relançar na próxima chamada.
        b.on("disconnected", () => { browserPromise = null; });
        return b;
      })
      .catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

export async function fecharBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) { try { (await p).close(); } catch { /* ignore */ } }
}

export interface RenderResult {
  html: string;      // HTML renderizado (page.content) — tem <head> + DOM hidratado
  texto: string;     // texto VISÍVEL (body.innerText) — preços/planos reais
  paleta: string[];  // cores de marca (hex) extraídas do render, por saturação
  finalUrl: string;  // URL após redirects
}

// Função executada DENTRO da página: lê o texto visível e deduz a paleta de marca.
// Fica como string pra ser serializada pelo page.evaluate.
function extrairNoNavegador() {
  const rgbParaHex = (c: string): string | null => {
    const m = String(c).match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const a = m[3] !== undefined ? parseFloat(m[3]) : 1;
    if (a < 0.5) return null; // ignora quase-transparente
    return (
      "#" +
      m.slice(0, 3).map((x) => Math.round(parseFloat(x)).toString(16).padStart(2, "0")).join("")
    );
  };
  const hsl = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
    return { s, l };
  };
  const peso: Record<string, number> = {};
  const add = (c: string, w: number) => { const h = rgbParaHex(c); if (h) peso[h] = (peso[h] || 0) + w; };
  const grupo = (sel: string, w: number) => {
    document.querySelectorAll(sel).forEach((el) => {
      const st = getComputedStyle(el as Element);
      add(st.backgroundColor, w);
      add(st.color, w * 0.5);
      add(st.borderColor, w * 0.4);
    });
  };
  grupo("button,[class*=btn],[class*=Button],[class*=cta],[class*=Cta]", 3);
  grupo("h1,h2,[class*=price],[class*=Price],[class*=badge],[class*=Badge]", 2);
  grupo("header,nav,[class*=hero],[class*=Hero],a[class]", 1.5);

  // theme-color (hex direto no <meta>)
  const tcEl = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  const tcHex = tcEl && /^#[0-9a-fA-F]{6}$/.test((tcEl.content || "").trim())
    ? (tcEl.content || "").trim().toLowerCase()
    : null;

  // distância Manhattan em RGB (pra colapsar tons quase iguais, ex.: 2 cinzas de UI).
  const dist = (h1: string, h2: string) => {
    const p = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const a = p(h1), b = p(h2);
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  };
  const ranked = Object.entries(peso)
    .map(([hex, ct]) => ({ hex, ct, ...hsl(hex) }))
    .filter((x) => x.s >= 0.25 && x.l >= 0.12 && x.l <= 0.9)          // exclui cinza/branco/preto
    .sort((a, b) => (b.ct * (0.4 + b.s)) - (a.ct * (0.4 + a.s)));      // prioriza cores VIVAS (a de marca)

  const paleta: string[] = [];
  const tryAdd = (hex: string) => { if (paleta.length < 4 && !paleta.some((p) => dist(p, hex) < 40)) paleta.push(hex); };
  if (tcHex) tryAdd(tcHex);
  for (const x of ranked) { if (paleta.length >= 4) break; tryAdd(x.hex); }

  return { texto: (document.body && document.body.innerText) || "", paleta };
}

export async function renderSite(url: string, timeoutMs = 22000): Promise<RenderResult> {
  assertSafeOutboundUrl(url); // 1ª hop (protocolo + host interno por string)
  if (await resolveInterno(new URL(url).hostname)) throw new Error("Host bloqueado por segurança"); // IP resolvido

  await adquirirRender(); // teto de concorrência (senão: erro → chamador cai no fetch)
  let page: import("puppeteer").Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(UA_BROWSER);
    await page.setViewport({ width: 1366, height: 900 });
    await page.setRequestInterception(true);
    const dnsCache = new Map<string, boolean>(); // hostname → interno? (uma resolução por host/render)
    page.on("request", async (req) => {
      try {
        const u = new URL(req.url());
        if (u.protocol !== "http:" && u.protocol !== "https:") return req.abort();
        if (isPrivateHost(u.hostname)) return req.abort(); // host interno por string (atalho barato)
        const tipo = req.resourceType();
        if (tipo === "image" || tipo === "media" || tipo === "font") return req.abort(); // acelera + reduz RAM; não perde texto
        // valida o IP RESOLVIDO de TODO request que vai sair (document/script/xhr/fetch/...),
        // fechando "host público com A-record → 127.0.0.1/169.254.169.254". Cache por host.
        let interno = dnsCache.get(u.hostname);
        if (interno === undefined) { interno = await resolveInterno(u.hostname); dnsCache.set(u.hostname, interno); }
        if (interno) return req.abort();
        return req.continue();
      } catch { try { return req.abort(); } catch { return; } }
    });

    // domcontentloaded fire cedo; depois esperamos a rede assentar SEM travar (best-effort) —
    // networkidle puro pendura 22s em sites com websocket/analytics que nunca ficam ociosos.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 9000 }).catch(() => { /* segue com o que tem */ });
    const finalUrl = page.url();
    assertSafeOutboundUrl(finalUrl); // garante que não terminamos num host interno

    // respiro pra hidratação tardia (preços que entram após o 1º paint)
    await new Promise((r) => setTimeout(r, 700));

    const { texto, paleta } = await page.evaluate(extrairNoNavegador);
    const html = await page.content();
    return {
      html: String(html || "").slice(0, 400000),
      texto: String(texto || "").replace(/\n{3,}/g, "\n\n").slice(0, 40000),
      paleta: Array.isArray(paleta) ? paleta.slice(0, 4) : [],
      finalUrl,
    };
  } finally {
    if (page) await page.close().catch(() => { /* ignore */ });
    liberarRender();
  }
}
