// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Renderizador HTML → PNG (Chromium headless).
//
// Abre um HTML LOCAL 100% self-contained (fontes/logo/mascote embutidos como
// data: URI) num Chromium e tira um screenshot no tamanho exato do post. É o
// motor do modo HÍBRIDO: o template de marca (layout + tipografia + logo real)
// vira imagem nítida, ao contrário do letreiro chapado por sharp.
//
// Browser DEDICADO (não o do siteRenderer, que intercepta/aborta img/font pra
// ler sites externos com segurança anti-SSRF — aqui é o oposto: precisamos que
// as fontes/imagens EMBUTIDAS carreguem). Como o HTML nunca faz request externo
// (tudo é data: URI), não há superfície de SSRF. Bruno 2026-07-15.
// ═══════════════════════════════════════════════════════════════════════════

import type { Browser } from "puppeteer";
import { existsSync } from "fs";
import { execSync } from "child_process";

let browserPromise: Promise<Browser> | null = null;

// Teto de concorrência — o Chromium é singleton compartilhado por todos os tenants.
// Render de template é rápido (~300-800ms), mas em rajada (carrossel de N slides +
// vários tenants) sem limite abriria N páginas pesadas → OOM. Limita e enfileira.
const MAX_RENDER = 3;
const MAX_FILA = 24;
let ativos = 0;
const fila: Array<() => void> = [];
function adquirir(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ativos >= MAX_RENDER && fila.length >= MAX_FILA) {
      return reject(new Error("Fila de renderização cheia. Tente de novo em instantes."));
    }
    const tenta = () => { if (ativos < MAX_RENDER) { ativos++; resolve(); } else fila.push(tenta); };
    tenta();
  });
}
function liberar(): void {
  ativos = Math.max(0, ativos - 1);
  const next = fila.shift();
  if (next) next();
}

// Acha o Chromium: env explícito → binários conhecidos → PATH → undefined (bundled no dev).
function acharChromium(): string | undefined {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(p)) return p;
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
    try {
      const p = execSync(`command -v ${bin} 2>/dev/null`, { stdio: ["ignore", "pipe", "ignore"], shell: "/bin/sh" }).toString().trim();
      if (p && existsSync(p)) return p;
    } catch { /* não encontrado */ }
  }
  return undefined;
}

// Singleton preguiçoso — só lança o Chromium no 1º render (nunca no boot).
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const puppeteer = (await import("puppeteer")).default;
    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath: acharChromium(),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run"],
      })
      .then((b) => {
        b.on("disconnected", () => { browserPromise = null; });
        return b;
      })
      .catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

export async function fecharRenderBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) { try { (await p).close(); } catch { /* ignore */ } }
}

export interface RenderOpts {
  width?: number;               // default 1080 (feed 4:5)
  height?: number;              // default 1350
  deviceScaleFactor?: number;   // default 1 (viewport já é o tamanho final)
  timeoutMs?: number;           // default 30000
}

// Renderiza um HTML self-contained em PNG do tamanho exato (default 1080x1350).
export async function renderHtmlToPng(html: string, opts: RenderOpts = {}): Promise<Buffer> {
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const deviceScaleFactor = opts.deviceScaleFactor || 1;
  const timeout = opts.timeoutMs || 30000;

  await adquirir();
  let page: import("puppeteer").Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor });
    // 'load' basta: o HTML é self-contained (data: URIs), não há request de rede;
    // as webfonts embutidas são aguardadas logo abaixo via document.fonts.ready.
    await page.setContent(html, { waitUntil: "load", timeout });
    // Garante que as webfonts embutidas terminaram de carregar antes do print
    // (senão o Chromium pode "flashar" a fonte de fallback e sair torto).
    try { await page.evaluate(async () => { await (document as any).fonts?.ready; }); } catch { /* ok */ }
    const buf = (await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width, height },
    })) as Buffer;
    return buf;
  } finally {
    if (page) { try { await page.close(); } catch { /* ignore */ } }
    liberar();
  }
}
