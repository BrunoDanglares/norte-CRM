// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Logo: limpeza (fundo transparente) + extração INTELIGENTE de um PDF.
//
// Bruno 2026-07-07 (v2 — guiada por VISÃO): a logo estampada vinha "quadradinha
// feia" e a extração burra (rasterizar página + tirar o branco) destruía a logo,
// porque muitas marcas (ex.: Mais Delivery) têm CONTORNO BRANCO (efeito sticker)
// que é PARTE do logo — tirar o branco apaga o contorno.
//
// Método correto de designer:
//   1. Rasteriza as páginas do PDF (getScreenshot — getImage do pdf-parse dá 0 aqui).
//   2. gpt-4o (visão) acha o logo e ESCOLHE a instância sobre fundo SÓLIDO ESCURO
//      (preto) — a única em que remover o fundo preserva contorno branco + cores.
//   3. Recorta na região do logo, remove SÓ aquela cor de fundo (chroma-key) e
//      recorta justo (trim) → PNG transparente com o contorno intacto.
// Sem chave OpenAI → cai no modo simples (chroma-key dos cantos, página inteira).
// ═══════════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { uploadsDir } from "../utils/uploadsDir";
import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";

type RGB = { r: number; g: number; b: number };

// Torna transparente os pixels próximos de UMA cor de fundo e recorta no conteúdo.
// Se `bg` vier (cor detectada), usa ela; senão amostra a cor dos cantos opacos.
// Preserva tudo que for diferente do fundo (contorno branco, letras coloridas).
export async function removerFundoLogo(inputBuf: Buffer, opts?: { bg?: RGB; tolerancia?: number }): Promise<Buffer> {
  const tol = opts?.tolerancia ?? 32;
  try {
    const { data, info } = await sharp(inputBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info; // channels = 4 (RGBA)
    if (!width || !height) return inputBuf;

    let br: number, bg: number, bb: number;
    if (opts?.bg) {
      ({ r: br, g: bg, b: bb } = opts.bg);
    } else {
      const cantos = [0, width - 1, (height - 1) * width, height * width - 1];
      let sr = 0, sg = 0, sb = 0, opacos = 0;
      for (const c of cantos) {
        const o = c * channels;
        if (data[o + 3] > 200) { sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; opacos++; }
      }
      if (opacos === 0) return sharp(inputBuf).trim({ threshold: 1 }).png().toBuffer(); // já transparente
      br = sr / opacos; bg = sg / opacos; bb = sb / opacos;
    }

    const limite = tol * 3;
    for (let i = 0; i < width * height; i++) {
      const o = i * channels;
      if (data[o + 3] < 16) continue;
      const dist = Math.abs(data[o] - br) + Math.abs(data[o + 1] - bg) + Math.abs(data[o + 2] - bb);
      if (dist <= limite) data[o + 3] = 0;
    }
    return sharp(data, { raw: { width, height, channels } }).trim({ threshold: 1 }).png().toBuffer();
  } catch {
    return inputBuf;
  }
}

function salvarPng(buf: Buffer): string {
  const nome = `logo-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  fs.writeFileSync(path.join(uploadsDir, nome), buf);
  return `/uploads/${nome}`;
}

// Recorta a página na bbox (frações 0-1) com uma folga pequena.
async function recortarBBox(buf: Buffer, bbox: { x: number; y: number; w: number; h: number }, folga = 0.015): Promise<Buffer> {
  const meta = await sharp(buf).metadata();
  const W = meta.width || 1, H = meta.height || 1;
  const left = Math.max(0, Math.round((bbox.x - folga) * W));
  const top = Math.max(0, Math.round((bbox.y - folga) * H));
  const w = Math.min(W - left, Math.round((bbox.w + folga * 2) * W));
  const h = Math.min(H - top, Math.round((bbox.h + folga * 2) * H));
  if (w < 8 || h < 8) return buf;
  return sharp(buf).extract({ left, top, width: w, height: h }).png().toBuffer();
}

interface DeteccaoLogo {
  found: boolean;
  bbox?: { x: number; y: number; w: number; h: number };
  background?: "dark" | "red" | "colored" | "white" | "complex";
  bgHex?: string;
}

// gpt-4o (visão) localiza o logo numa página do guia de marca. Prioriza a versão
// sobre fundo SÓLIDO ESCURO — a que recorta limpo preservando o contorno branco.
async function detectarLogo(workspaceId: string, pngBuf: Buffer): Promise<DeteccaoLogo> {
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return { found: false };
  try {
    const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
    const b64 = pngBuf.toString("base64");
    const resp = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você localiza o LOGOTIPO principal da empresa numa página de manual de marca, para recorte. " +
            "REGRA: prefira a instância do logo que está sobre um FUNDO SÓLIDO ESCURO/PRETO — é a única em que dá " +
            "pra remover o fundo preservando o contorno branco e as cores do logo. Se só houver logo sobre branco " +
            "ou fundo complexo, ainda retorne, mas marque o background correto. " +
            "Responda JSON: { found: boolean, bbox: { x, y, w, h } (frações 0..1; x,y = canto superior-esquerdo do " +
            "retângulo JUSTO ao redor do logo; w,h = largura/altura), background: 'dark'|'red'|'colored'|'white'|'complex', " +
            "bgHex: '#rrggbb' (cor aproximada do fundo imediato do logo) }. Retorne o MELHOR único logo da página.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Localize o logo desta página para recorte (prefira sobre fundo escuro sólido)." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ] as any,
        },
      ],
    });
    const j = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    if (!j?.found || !j?.bbox) return { found: false };
    const b = j.bbox;
    if ([b.x, b.y, b.w, b.h].some((n: any) => typeof n !== "number")) return { found: false };
    return { found: true, bbox: b, background: j.background, bgHex: typeof j.bgHex === "string" ? j.bgHex : undefined };
  } catch {
    return { found: false };
  }
}

function hexToRgb(hex?: string): RGB | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export interface LogoCandidato {
  url: string;
  width: number;
  height: number;
  pagina: number;
  fundo?: string;      // tipo de fundo de onde veio (dark é o melhor)
  recomendado?: boolean;
}

// Extrai candidatos de logo do PDF, guiado por visão. Devolve os melhores primeiro
// (fundo escuro = contorno branco preservado). O usuário escolhe o que ficou bom.
export async function extrairLogosDoPdf(absPath: string, workspaceId: string, maxPaginas = 6): Promise<LogoCandidato[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: fs.readFileSync(absPath) });
  const candidatos: Array<LogoCandidato & { score: number }> = [];
  try {
    const ss = await parser.getScreenshot({ imageBuffer: true, scale: 2, first: maxPaginas } as any);
    const pages = (ss?.pages || []).slice(0, maxPaginas);
    for (const pg of pages) {
      const bytes = (pg as any)?.data;
      if (!bytes) continue;
      const paginaBuf = Buffer.from(bytes);

      // Visão recebe uma versão REDUZIDA (mais barata/rápida); o recorte final sai
      // da página em alta resolução (bbox é normalizado 0..1, serve pras duas).
      const visBuf = await sharp(paginaBuf).resize({ width: 1100, withoutEnlargement: true }).png().toBuffer().catch(() => paginaBuf);
      const det = await detectarLogo(workspaceId, visBuf);
      // Fundo escuro → remove pela cor detectada (preserva contorno branco).
      // Fundo branco/complexo → chroma-key dos cantos (pode comer o contorno, mas
      // ainda serve de opção). Sem detecção → página inteira (fallback).
      const regiao = det.found && det.bbox ? await recortarBBox(paginaBuf, det.bbox) : paginaBuf;
      const usarCorDetectada = det.background === "dark" || det.background === "colored" || det.background === "red";
      const bg = usarCorDetectada ? hexToRgb(det.bgHex) : undefined;

      try {
        const png = await removerFundoLogo(regiao, bg ? { bg, tolerancia: 40 } : undefined);
        const meta = await sharp(png).metadata();
        const w = meta.width || 0, h = meta.height || 0;
        if (w < 48 || h < 48) continue;
        const score = det.background === "dark" ? 3 : det.background === "red" || det.background === "colored" ? 2 : det.found ? 1 : 0;
        candidatos.push({
          url: salvarPng(png), width: w, height: h, pagina: (pg as any).pageNumber || 0,
          fundo: det.background, recomendado: det.background === "dark", score,
        });
      } catch { /* pula página problemática */ }
    }
  } finally {
    await parser.destroy().catch(() => {});
  }
  candidatos.sort((a, b) => b.score - a.score);
  return candidatos.map(({ score, ...c }) => c);
}
