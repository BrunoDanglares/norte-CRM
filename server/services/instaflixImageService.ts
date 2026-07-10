// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Geração de imagem por IA (gpt-image-1) + gravação em /uploads.
//
// A Graph API baixa a imagem por uma URL PÚBLICA. Geramos → salvamos em uploadsDir
// → devolvemos a URL RELATIVA (/uploads/... servido por express.static). A URL
// pública absoluta pra Meta é montada só na PUBLICAÇÃO (ver instaflixService).
//
// MVP: gpt-image-1 puro. O "híbrido" (overlay de logo/texto da marca via `sharp`)
// entra por `aplicarOverlayMarca` — hoje é passthrough; quando adicionarmos sharp
// só essa função muda, sem mexer no resto do pipeline. Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp, { type OverlayOptions } from "sharp";
import { uploadsDir, resolveUploadPath } from "../utils/uploadsDir";
import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";
import { toFile } from "openai";

// gpt-image-1 aceita: '1024x1024' (1:1), '1024x1536' (retrato 2:3), '1536x1024' (paisagem).
// Default RETRATO (1024x1536) — depois recortamos pra 4:5 (formato do feed do IG),
// que é vertical e ocupa mais tela no feed. Carrossel: todos os itens saem no mesmo
// tamanho (recorte idêntico), então a proporção fica consistente.
export type TamanhoImagem = "1024x1024" | "1024x1536" | "1536x1024";

// Formato-alvo do feed do Instagram: RETRATO 4:5 (largura/altura = 0.8). O feed só
// aceita de 4:5 até 1.91:1 — o 2:3 (0.667) gerado pelo gpt-image-1 é MAIS alto que
// isso e o IG cortaria sozinho. Recortamos nós (crop central) pra controlar o corte
// e já entregar publicável. 1024x1536 → 1024x1280. Bruno 2026-07-07.
const FEED_RATIO = 4 / 5;
async function recortarParaFeed(buffer: Buffer): Promise<Buffer> {
  try {
    const meta = await sharp(buffer).metadata();
    const W = meta.width || 1024;
    const H = meta.height || 1536;
    const idealH = Math.round(W / FEED_RATIO);   // altura pra ficar 4:5 com a largura atual
    if (idealH < H) {                            // imagem mais alta que 4:5 → corta topo/base
      const top = Math.round((H - idealH) / 2);
      return await sharp(buffer).extract({ left: 0, top, width: W, height: idealH }).png().toBuffer();
    }
    if (idealH > H) {                            // imagem menos alta que 4:5 → corta laterais
      const idealW = Math.round(H * FEED_RATIO);
      const left = Math.round((W - idealW) / 2);
      return await sharp(buffer).extract({ left, top: 0, width: idealW, height: H }).png().toBuffer();
    }
    return buffer;
  } catch {
    return buffer;                               // qualquer falha → devolve como veio
  }
}

// Corrige BALANÇO DE BRANCO (gray-world) pra remover o CAST de cor — o gpt-image-1
// tende a jogar um tom amarelado/dourado em TODA comida, deixando tudo igual. Aqui
// puxamos os canais pro neutro. Gentil e só quando o cast é FORTE (não achata cenas
// já neutras, nem comida genuinamente pouco quente). Roda ANTES do overlay (só na
// foto — não afeta o letreiro da marca). Bruno 2026-07-08.
async function corrigirBalancoBranco(buffer: Buffer): Promise<Buffer> {
  try {
    const stats = await sharp(buffer).stats();
    const ch = stats.channels;
    if (ch.length < 3) return buffer;
    const mr = ch[0].mean, mg = ch[1].mean, mb = ch[2].mean;
    const target = (mr + mg + mb) / 3;
    if (target < 8) return buffer;                             // quase preta → não mexe
    const ratio = Math.max(mr, mg, mb) / Math.max(1, Math.min(mr, mg, mb));
    if (ratio < 1.1) return buffer;                            // já neutra → não mexe
    const FORCA = 0.75;                                        // 0..1 intensidade
    const clamp = (v: number) => Math.max(0.55, Math.min(1.7, v));
    const mul = (m: number) => clamp(1 + FORCA * (target / Math.max(1, m) - 1));
    const muls = [mul(mr), mul(mg), mul(mb)];
    if (ch.length >= 4) muls.push(1);                          // alpha inalterado
    return await sharp(buffer).linear(muls, 0).toBuffer();
  } catch {
    return buffer;
  }
}

// Base pública do app pra montar a URL absoluta da imagem (a Meta busca por ela).
// Em request HTTP vem do host; no scheduler cai no env.
export function basePublicaEnv(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
}

// Escapa texto pra XML/SVG.
function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Word-wrap simples por nº de caracteres (SVG não quebra linha sozinho).
function wrap(texto: string, maxChars: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const p of texto.trim().split(/\s+/)) {
    if ((atual + " " + p).trim().length > maxChars) {
      if (atual) linhas.push(atual);
      atual = p;
    } else {
      atual = (atual + " " + p).trim();
    }
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, 4); // no máximo 4 linhas
}

async function carregarLogo(logoUrl?: string): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    if (/^https?:\/\//i.test(logoUrl)) {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    return fs.readFileSync(resolveUploadPath(logoUrl)); // caminho /uploads/... local
  } catch {
    return null;
  }
}

// ── Cores da marca ───────────────────────────────────────────────────────────
export type EstiloLetreiro = "faixa" | "cartao" | "editorial";

function parseHex(hex?: string): { r: number; g: number; b: number } | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function mix(hex: string, alvo: { r: number; g: number; b: number }, t: number): string {
  const c = parseHex(hex) || { r: 128, g: 128, b: 128 };
  return toHex(c.r + (alvo.r - c.r) * t, c.g + (alvo.g - c.g) * t, c.b + (alvo.b - c.b) * t);
}
const lighten = (hex: string, t = 0.3) => mix(hex, { r: 255, g: 255, b: 255 }, t);
// Limiar 165: cores vibrantes tipo laranja (#f28c03, lum ~155) recebem texto BRANCO
// (mais forte/legível); só amarelo/claro de verdade (lum >165) recebe texto escuro.
function isLight(hex: string): boolean {
  const c = parseHex(hex);
  if (!c) return false;
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 165;
}

// Extrai as cores SATURADAS da marca (logo/foto de perfil) — ignora cinza/branco/preto.
// Usado pela sincronização pra popular paletaCores. Bruno 2026-07-07.
export async function extrairPaletaMarca(buf: Buffer): Promise<string[]> {
  try {
    const { data, info } = await sharp(buf).resize(64, 64, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i + 2 < data.length; i += ch) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.32) continue;                        // neutro → ignora
      if (max < 45 || r + g + b > 735) continue;       // muito escuro/claro → ignora
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      e.r += r; e.g += g; e.b += b; e.n++;
      buckets.set(key, e);
    }
    return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 4).map((e) => toHex(e.r / e.n, e.g / e.n, e.b / e.n));
  } catch {
    return [];
  }
}

// ── Escolha inteligente da variação de logo + canto ──────────────────────────
// A marca pode ter VÁRIAS variações (ex.: uma clara e uma escura). Pra cada arte
// escolhemos a que combina com o fundo (contraste) e o canto mais limpo (não tapa
// o assunto). Primária: VISÃO (gpt-4o-mini) quando há 2+ variações; fallback:
// heurística por luminância/desvio — 100% offline. Bruno 2026-07-07.
type CantoLogo = "tl" | "tr" | "bl" | "br";

// Posição (top,left) do canto escolhido, com folga `pad`.
function posLogo(corner: CantoLogo, W: number, H: number, lw: number, lh: number, pad: number) {
  const left = corner === "tr" || corner === "br" ? Math.max(0, W - pad - lw) : pad;
  const top = corner === "bl" || corner === "br" ? Math.max(0, H - pad - lh) : pad;
  return { top, left };
}

// Luminância média (0..255) dos pixels OPACOS de uma logo → diz se ela é clara/escura.
async function lumOpacaLogo(buf: Buffer): Promise<number> {
  try {
    const { data, info } = await sharp(buf).resize({ width: 64, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels; let s = 0, n = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * ch;
      if (data[o + 3] > 128) { s += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; n++; }
    }
    return n ? s / n : 128;
  } catch { return 128; }
}

// Luminância média + "agito" (desvio) da caixa de um canto da arte.
async function statsCanto(artBuf: Buffer, corner: CantoLogo, W: number, H: number, box: number, pad: number): Promise<{ mean: number; std: number }> {
  const size = Math.max(8, Math.min(box, W - 2 * pad, H - 2 * pad));
  const { top, left } = posLogo(corner, W, H, size, size, pad);
  try {
    const st = await sharp(artBuf).extract({ left, top, width: size, height: size }).stats();
    const c = st.channels;
    const mean = 0.299 * c[0].mean + 0.587 * c[1].mean + 0.114 * c[2].mean;
    const std = (c[0].stdev + c[1].stdev + c[2].stdev) / 3;
    return { mean, std };
  } catch { return { mean: 128, std: 9999 }; }
}

// Fallback SEM IA: canto mais "limpo" (menor desvio) + variação de maior contraste.
async function escolherPorHeuristica(artBuf: Buffer, logoBufs: Buffer[], cantos: CantoLogo[], W: number, H: number): Promise<{ index: number; corner: CantoLogo }> {
  const box = Math.round(W * 0.19);
  const pad = Math.round(W * 0.045);
  const stats = await Promise.all(cantos.map((c) => statsCanto(artBuf, c, W, H, box, pad)));
  let ci = 0;
  for (let i = 1; i < stats.length; i++) if (stats[i].std < stats[ci].std) ci = i;
  const corner = cantos[ci] ?? "tl";
  const bgLum = stats[ci]?.mean ?? 128;
  let index = 0, best = -1;
  for (let i = 0; i < logoBufs.length; i++) {
    const d = Math.abs((await lumOpacaLogo(logoBufs[i])) - bgLum);
    if (d > best) { best = d; index = i; }
  }
  return { index, corner };
}

// Escolha por VISÃO (gpt-4o-mini): a IA olha a arte + as variações e devolve qual
// logo usar e em qual canto — clara em fundo escuro, escura em fundo claro, sem
// tapar o assunto. Falha (sem chave / erro) → null (chamador cai na heurística).
async function escolherLogoPorVisao(
  workspaceId: string, artBuf: Buffer, logoBufs: Buffer[], cantos: CantoLogo[],
): Promise<{ index: number; corner: CantoLogo } | null> {
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return null;
  const nomes: Record<CantoLogo, string> = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right" };
  const permitidos = cantos.map((c) => nomes[c]);
  try {
    const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 45_000 });
    const arte = (await sharp(artBuf).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()).toString("base64");
    const logos = await Promise.all(
      logoBufs.map(async (b) => (await sharp(b).resize({ width: 160, height: 160, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer()).toString("base64")),
    );
    const content: any[] = [
      { type: "text", text:
        `IMAGE 1 is the artwork/background. A small brand logo will be stamped in ONE corner of it. ` +
        `The next ${logoBufs.length} image(s) are logo variations, numbered 1..${logoBufs.length} in order. ` +
        `Pick the variation whose colors will be MOST LEGIBLE over the corner it sits in (a light/white logo over a dark area, a dark logo over a light area — prefer strong contrast), ` +
        `and pick the corner where the logo will LEAST cover the main subject. Allowed corners: ${permitidos.join(", ")}. ` +
        `Return ONLY JSON: { "variation": <1-based integer from 1 to ${logoBufs.length}>, "corner": one of [${permitidos.map((p) => `"${p}"`).join(", ")}] }.` },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${arte}`, detail: "low" } },
      ...logos.map((b: string) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b}`, detail: "low" } })),
    ];
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "user", content: content as any }],
    });
    const j = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    const idx = Math.round(Number(j.variation)) - 1;
    const rev: Record<string, CantoLogo> = { "top-left": "tl", "top-right": "tr", "bottom-left": "bl", "bottom-right": "br" };
    let corner = rev[String(j.corner)];
    if (!corner || !cantos.includes(corner)) corner = cantos[0];
    const index = idx >= 0 && idx < logoBufs.length ? idx : 0;
    return { index, corner };
  } catch {
    return null;
  }
}

// "Híbrido": compõe letreiro (texto PT) + logo da marca sobre a arte gerada.
// Estilos (a IA escolhe por post): 'faixa' (degradê da cor da marca), 'cartao'
// (cartão arredondado), 'editorial' (scrim + selo). Usa a paleta da marca; sem
// paleta cai no 'editorial' neutro. A LOGO pode ter várias variações — a IA escolhe
// a que combina com o fundo desta arte e o canto mais limpo. Falha → devolve a arte
// original. Bruno 2026-07-07.
export async function aplicarOverlayMarca(
  buffer: Buffer,
  opts: { logos?: string[]; logoUrl?: string; textoOverlay?: string; paleta?: string[]; estilo?: EstiloLetreiro; faixaCor?: string; ctaSelo?: string; workspaceId?: string },
): Promise<Buffer> {
  const texto = (opts.textoOverlay || "").trim();
  const logoUrls = opts.logos && opts.logos.length ? opts.logos : opts.logoUrl ? [opts.logoUrl] : [];
  if (!texto && !logoUrls.length) return buffer;

  try {
    const base = sharp(buffer);
    const meta = await base.metadata();
    const W = meta.width || 1024;
    const H = meta.height || 1024;

    const paleta = (opts.paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
    const temMarca = paleta.length > 0;
    // Cor da faixa: manual (opts.faixaCor) sobrepõe a 1ª cor da marca. Sem nenhuma → neutro.
    const faixaCor = opts.faixaCor && /^#[0-9a-fA-F]{6}$/.test(opts.faixaCor) ? opts.faixaCor : null;
    const primary = faixaCor || (temMarca ? paleta[0] : "#1f2430");
    const accent = paleta[1] || lighten(primary, 0.42);
    const estilo: EstiloLetreiro = (!temMarca && !faixaCor) ? "editorial" : (opts.estilo || "faixa");
    const composites: OverlayOptions[] = [];

    if (texto) {
      const pad = Math.round(W * 0.06);
      const fontSize = Math.round(W * 0.064);
      const lineH = Math.round(fontSize * 1.16);
      const maxChars = Math.max(12, Math.floor((W - pad * 2) / (fontSize * 0.54)));
      const linhas = wrap(texto, maxChars);
      const txt = (x: number, y: number, fill: string, l: string, anchor = "start", size = fontSize) =>
        `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, 'Segoe UI', sans-serif" font-size="${size}" font-weight="800" fill="${fill}">${escXml(l)}</text>`;

      let inner = "";
      if (estilo === "cartao") {
        const tc = isLight(primary) ? "#141414" : "#ffffff";
        const cardH = linhas.length * lineH + Math.round(fontSize * 1.3);
        const cardY = H - Math.round(H * 0.05) - cardH;
        const cardX = pad, cardW = W - pad * 2;
        const tx = cardX + Math.round(fontSize * 0.7);
        const baseY = cardY + Math.round(fontSize * 1.35);
        inner =
          `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${Math.round(W * 0.03)}" fill="${primary}" fill-opacity="0.96"/>` +
          `<rect x="${cardX}" y="${cardY}" width="${Math.round(W * 0.16)}" height="9" rx="4" fill="${accent}"/>` +
          linhas.map((l, i) => txt(tx, baseY + i * lineH, tc, l)).join("");
      } else if (estilo === "editorial") {
        const baseY = H - pad - (linhas.length - 1) * lineH;
        const pillH = Math.round(fontSize * 0.92), pillW = Math.round(W * 0.30);
        const pillY = baseY - linhas.length * lineH - Math.round(fontSize * 0.85);
        const underY = baseY + Math.round(fontSize * 0.3);
        inner =
          `<rect x="0" y="${Math.round(H * 0.4)}" width="${W}" height="${Math.round(H * 0.6)}" fill="url(#scrim)"/>` +
          // Selo de CTA só quando há objetivo de VENDA (opts.ctaSelo). Sem objetivo
          // (ex.: post informativo), NÃO estampa "peça agora". Bruno 2026-07-08.
          (temMarca && opts.ctaSelo
            ? `<rect x="${pad}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="${primary}"/>` +
              txt(pad + pillW / 2, pillY + pillH * 0.7, "#ffffff", opts.ctaSelo, "middle", Math.round(fontSize * 0.46))
            : "") +
          linhas.map((l, i) => txt(pad, baseY + i * lineH, "#ffffff", l)).join("") +
          `<rect x="${pad}" y="${underY}" width="${Math.round(W * 0.22)}" height="8" rx="4" fill="${accent}"/>`;
      } else {
        // faixa (default): degradê da cor da marca no rodapé + barra de acento
        const tc = isLight(primary) ? "#141414" : "#ffffff";
        const baseY = H - pad - (linhas.length - 1) * lineH;
        const barY = baseY - fontSize - Math.round(fontSize * 0.6);
        inner =
          `<rect x="0" y="${Math.round(H * 0.56)}" width="${W}" height="${Math.round(H * 0.44)}" fill="url(#faixa)"/>` +
          `<rect x="${pad}" y="${barY}" width="${Math.round(W * 0.14)}" height="12" rx="6" fill="${accent}"/>` +
          linhas.map((l, i) => txt(pad, baseY + i * lineH, tc, l)).join("");
      }

      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.8"/></linearGradient>
        <linearGradient id="faixa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${primary}" stop-opacity="0"/><stop offset="0.5" stop-color="${primary}" stop-opacity="0.55"/><stop offset="1" stop-color="${primary}" stop-opacity="0.97"/></linearGradient>
      </defs>${inner}</svg>`;
      composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
    }

    // Logo — carrega as variações válidas; a IA (visão) escolhe a que combina com o
    // fundo desta arte (clara em fundo escuro, escura em fundo claro) e o canto mais
    // limpo. Sem 2+ variações / sem chave → heurística por luminância. Como o letreiro
    // fica embaixo, a logo só usa os cantos de CIMA quando há texto. Chip translúcido
    // ADAPTATIVO (escuro atrás de logo clara, claro atrás de escura) garante leitura.
    const logoBufs: Buffer[] = [];
    for (const u of logoUrls) { const b = await carregarLogo(u); if (b) logoBufs.push(b); }
    if (logoBufs.length) {
      try {
        const cantos: CantoLogo[] = texto ? ["tl", "tr"] : ["tl", "tr", "bl", "br"];
        let escolha: { index: number; corner: CantoLogo } | null = null;
        if (logoBufs.length >= 2 && opts.workspaceId) {
          escolha = await escolherLogoPorVisao(opts.workspaceId, buffer, logoBufs, cantos);
        }
        if (!escolha) escolha = await escolherPorHeuristica(buffer, logoBufs, cantos, W, H);
        const chosen = logoBufs[escolha.index] ?? logoBufs[0];
        const lw = Math.round(W * 0.19);
        const resized = await sharp(chosen).resize({ width: lw, withoutEnlargement: true }).png().toBuffer();
        const lm = await sharp(resized).metadata();
        const rw = lm.width || lw, rh = lm.height || lw;
        const pad = Math.round(W * 0.045);
        const { top, left } = posLogo(escolha.corner, W, H, rw, rh, pad);
        const claraLogo = (await lumOpacaLogo(chosen)) > 140;
        const cw = rw + pad, chh = rh + Math.round(pad * 0.7);
        const chip = `<svg width="${cw}" height="${chh}"><rect width="${cw}" height="${chh}" rx="${Math.round(chh * 0.28)}" fill="${claraLogo ? "#000" : "#fff"}" fill-opacity="${claraLogo ? "0.28" : "0.42"}"/></svg>`;
        composites.push({ input: Buffer.from(chip), top: Math.max(0, top - Math.round(pad * 0.35)), left: Math.max(0, left - Math.round(pad * 0.5)) });
        composites.push({ input: resized, top, left });
      } catch { /* logo inválido — ignora */ }
    }

    if (!composites.length) return buffer;
    return await base.composite(composites).png().toBuffer();
  } catch {
    return buffer;
  }
}

export interface GerarImagemOpts {
  workspaceId: string;
  prompt: string;
  size?: TamanhoImagem;
  quality?: "low" | "medium" | "high" | "auto";
  baseUrl?: string;                 // sobrescreve basePublicaEnv() (ex.: host do request)
  logos?: string[];                 // overlay: variações da logo (a IA escolhe a que combina)
  logoUrl?: string;                 // overlay: logo única (legado; compat retroativa)
  textoOverlay?: string;            // overlay: texto (PT) sobre a arte
  corPrimaria?: string;             // legado (mapeado pra paleta[0])
  paleta?: string[];                // cores da marca (primary, accent, …)
  estilo?: EstiloLetreiro;          // estilo do letreiro escolhido pela IA
  faixaCor?: string;                // cor manual da faixa (hex); sobrepõe paleta[0] só na faixa
  ctaSelo?: string;                 // selo de CTA no letreiro 'editorial' (só se objetivo de venda)
  referencias?: string[];           // modo "inspirar nos materiais": imagens de referência (/uploads/…). Vazio = geração normal.
}

export interface GerarImagemResult {
  ok: boolean;
  url?: string;                     // absoluta se houver base; senão relativa /uploads/...
  filename?: string;
  error?: string;
}

// Carrega as imagens de referência (materiais/telas do produto) do disco como File,
// pro modo "inspirar nos materiais" (image-to-image do gpt-image-1). Só aceita raster
// local de /uploads; ignora o que não existe / não é imagem. Cap de segurança em 3.
const REF_MAX = 3;
const REF_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};
async function carregarReferencias(refs: string[]): Promise<any[]> {
  const out: any[] = [];
  const vistos = new Set<string>();
  for (const r of refs) {
    if (out.length >= REF_MAX) break;
    if (!r || /^https?:\/\//i.test(r)) continue;           // só materiais locais (/uploads)
    try {
      const local = path.join(uploadsDir, path.basename(r));
      if (vistos.has(local) || !fs.existsSync(local)) continue;
      const type = REF_MIME[path.extname(local).toLowerCase()];
      if (!type) continue;                                  // só imagem raster
      vistos.add(local);
      out.push(await toFile(fs.readFileSync(local), path.basename(local), { type }));
    } catch { /* ref inválida — pula */ }
  }
  return out;
}

export async function gerarImagemIA(opts: GerarImagemOpts): Promise<GerarImagemResult> {
  const [cand] = await resolveOpenAIKeys(opts.workspaceId);
  if (!cand) return { ok: false, error: "Nenhuma chave OpenAI configurada pro workspace" };

  const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 120_000 });

  // Blindagem anti-alucinação de marca (Bruno 2026-07-07): o gpt-image-1 insistia
  // em desenhar logos/nome da marca/telas de app com branding falso. A logo REAL é
  // estampada por cima depois (aplicarOverlayMarca), então a CENA tem que vir limpa.
  const promptSeguro =
    `${opts.prompt}\n\n` +
    "STYLE: high-end COMMERCIAL ADVERTISING photography (premium food/brand campaign look), mouth-watering, " +
    "ultra sharp focus, rich appetizing true-to-life colors, BRIGHT even professional lighting, clean bright " +
    "light-colored or naturally-colored background, shallow depth of field with creamy bokeh, crisp macro " +
    "detail, professional food/product styling, editorial magazine quality, 8k, hyper detailed — absolutely " +
    "NOT homemade, amateur, dull or empty.\n\n" +
    "COLOR (mandatory): NEUTRAL daylight white balance (about 5500K), clean fresh true-to-life colors. The " +
    "overall frame MUST NOT have a warm/orange/amber/golden/yellow color cast, and MUST NOT be dark, dim, " +
    "moody or candlelit. Bright and airy.\n\n" +
    "STRICT RULES: Do NOT render any text, letters, words, numbers, captions, logos, " +
    "brand names, wordmarks, watermarks, signage, price tags, packaging with readable " +
    "labels, or app/phone/computer screens showing any UI or branding. No invented brands. " +
    "Produce a clean, photographic scene only, with calm empty negative space near the bottom " +
    "so a caption and the brand logo can be overlaid later.";

  // Paleta da marca (primary + accent…) — o overlay usa; sem paleta, cai no legado corPrimaria.
  const paleta = (opts.paleta && opts.paleta.length) ? opts.paleta : (opts.corPrimaria ? [opts.corPrimaria] : []);

  // Modo REFERÊNCIA (opt-in por post): usa materiais/telas do produto como inspiração
  // visual via image-to-image. Sem referências válidas → geração normal (texto→imagem).
  const refFiles = opts.referencias?.length ? await carregarReferencias(opts.referencias) : [];
  const usarRef = refFiles.length > 0;

  // O promptSeguro PROÍBE telas de app/UI (anti-alucinação de marca na foto). No modo
  // referência é o oposto: queremos a estética do produto. Prompt próprio, ainda sem
  // texto/logo fabricado e com espaço embaixo pro overlay da logo REAL.
  const promptRef =
    `${opts.prompt}\n\n` +
    "Use the attached image(s) as VISUAL REFERENCE for the brand and product look — its colors, " +
    "interface style, shapes and key visual elements. Create a POLISHED, modern Instagram post " +
    "clearly INSPIRED by them and in the same visual world. Do NOT copy any reference pixel-for-pixel " +
    "and do NOT reproduce a real screenshot verbatim — compose a clean, original promotional graphic.\n\n" +
    "STRICT RULES: do NOT render fabricated logos, brand names, wordmarks, watermarks or unreadable/garbled " +
    "text. Keep an uncluttered composition with calm empty negative space near the bottom so a caption and " +
    "the real brand logo can be overlaid later.";

  try {
    const b64 = usarRef
      ? (await client.images.edit({
          model: "gpt-image-1",
          image: refFiles as any,           // gpt-image-1 aceita múltiplas imagens de referência
          prompt: promptRef,
          size: opts.size || "1024x1536",
          quality: opts.quality || "high",
        })).data?.[0]?.b64_json
      : (await client.images.generate({
          model: "gpt-image-1",
          prompt: promptSeguro,
          size: opts.size || "1024x1536",
          quality: opts.quality || "high",
        })).data?.[0]?.b64_json;

    if (!b64) return { ok: false, error: "IA não retornou imagem" };

    let buffer = Buffer.from(b64, "base64");
    buffer = await recortarParaFeed(buffer);       // 4:5 (retrato do feed)
    // Balanço de branco (gray-world) é calibrado pro cast amarelado das FOTOS do
    // gpt-image-1; numa arte referenciada na marca ele lavaria a cor da marca → pula.
    if (!usarRef) buffer = await corrigirBalancoBranco(buffer);
    buffer = await aplicarOverlayMarca(buffer, { logos: opts.logos, logoUrl: opts.logoUrl, textoOverlay: opts.textoOverlay, paleta, estilo: opts.estilo, faixaCor: opts.faixaCor, ctaSelo: opts.ctaSelo, workspaceId: opts.workspaceId });

    const filename = `instaflix-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);

    // A URL gravada é SEMPRE RELATIVA (/uploads/...). O preview no browser carrega
    // do MESMO host do app; a URL pública absoluta (pra Meta buscar a imagem) é
    // montada só na PUBLICAÇÃO (publicarPostAgora). Bakear PUBLIC_BASE_URL aqui
    // quebrava o preview local — o app abre em localhost mas o <img src> apontava
    // pro túnel ngrok (fora do ar / página de aviso). `baseUrl` só é honrado se
    // passado explicitamente pelo chamador. Bruno 2026-07-07.
    const base = (opts.baseUrl || "").replace(/\/$/, "");
    const url = base ? `${base}/uploads/${filename}` : `/uploads/${filename}`;
    return { ok: true, url, filename };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ── Campanha de Oferta — Nível A (Fase 2, Bruno 2026-07-09) ───────────────────
// Compõe a FOTO REAL do produto num canvas 4:5 (produto INTEIRO, sem cortar) sobre
// um fundo limpo com leve tom da marca, + SELO DE OFERTA (letreiro 'cartao' com o
// rótulo EXATO configurado) + logo. A IA NUNCA recria o produto nem digita a oferta —
// fidelidade 100% aos pixels originais e valor cravado pelo usuário.
const CAMP_W = 1024, CAMP_H = 1280; // 4:5 do feed
export async function comporArteProduto(
  foto: Buffer,
  opts: { ofertaRotulo?: string; logos?: string[]; logoUrl?: string; paleta?: string[]; ctaSelo?: string; workspaceId?: string; baseUrl?: string },
): Promise<GerarImagemResult> {
  try {
    const paleta = (opts.paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
    const primary = paleta[0] || "#7C3AED";
    const bgBottom = lighten(primary, 0.86); // quase branco, com um respiro da cor da marca

    // Fundo 4:5 com degradê suave — parece "arte", não uma foto solta.
    const bgSvg = `<svg width="${CAMP_W}" height="${CAMP_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${bgBottom}"/>
      </linearGradient></defs>
      <rect width="${CAMP_W}" height="${CAMP_H}" fill="url(#g)"/>
    </svg>`;
    let canvas = await sharp(Buffer.from(bgSvg)).png().toBuffer();

    // Produto INTEIRO (contain), centralizado numa ÁREA que começa abaixo da faixa de
    // topo (reservada pra logo, senão a logo é carimbada por cima do produto) e acaba
    // acima do selo de oferta. .rotate() auto-orienta pelo EXIF (foto de celular retrato
    // não entra deitada). withoutEnlargement pra não borrar foto de baixa resolução.
    const areaTop = Math.round(CAMP_H * 0.20);   // reserva ~faixa de topo pra logo
    const areaW = Math.round(CAMP_W * 0.82);
    const areaH = Math.round(CAMP_H * 0.50);
    const prod = await sharp(foto).rotate().resize({ width: areaW, height: areaH, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const pm = await sharp(prod).metadata();
    const pw = pm.width || areaW, ph = pm.height || areaH;
    const left = Math.round((CAMP_W - pw) / 2);
    const top = areaTop + Math.max(0, Math.round((areaH - ph) / 2)); // centraliza na área
    canvas = await sharp(canvas).composite([{ input: prod, top, left }]).png().toBuffer();

    // Selo de oferta (letreiro 'cartao' com o rótulo EXATO) + logo.
    const out = await aplicarOverlayMarca(canvas, {
      textoOverlay: opts.ofertaRotulo || "",
      estilo: "cartao",
      paleta: opts.paleta,
      logos: opts.logos,
      logoUrl: opts.logoUrl,
      ctaSelo: opts.ctaSelo,
      workspaceId: opts.workspaceId,
    });

    const filename = `instaflix-camp-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    fs.writeFileSync(path.join(uploadsDir, filename), out);
    const base = (opts.baseUrl || "").replace(/\/$/, "");
    const url = base ? `${base}/uploads/${filename}` : `/uploads/${filename}`;
    return { ok: true, url, filename };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
