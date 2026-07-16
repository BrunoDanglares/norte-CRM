// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Geração de imagem por TEMPLATE (modo híbrido).
//
// Em vez de "pintar" a imagem com IA (gpt-image-1, ruim em logo/texto/paleta),
// monta a arte por TEMPLATE HTML/CSS com os assets REAIS do brand kit (logo,
// mascote, paleta, fontes Inter) e renderiza via Chromium → PNG nítido no padrão
// da marca. Mesmo contrato de saída de gerarImagemIA ({ ok, url, filename } com
// /uploads/*.png), então preview e publicação seguem sem mudança. Bruno 2026-07-15.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { uploadsDir, resolveUploadPath } from "../utils/uploadsDir";
import { renderLayoutHtml, type LayoutVariant, type LayoutCopy, type BrandRender } from "./instaflixLayouts";
import { renderHtmlToPng } from "./htmlToImage";
import { INTER_FONT_CSS } from "./instaflixFonts";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
};

// Carrega um asset (logo/mascote) do disco (/uploads) ou http → buffer + mime.
async function carregarAsset(url?: string): Promise<{ buf: Buffer; mime: string } | null> {
  if (!url) return null;
  try {
    if (/^data:/i.test(url)) {
      const m = url.match(/^data:([^;]+);base64,(.*)$/i);
      if (!m) return null;
      return { buf: Buffer.from(m[2], "base64"), mime: m[1] };
    }
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") || "image/png";
      return { buf: Buffer.from(await res.arrayBuffer()), mime: ct.split(";")[0] };
    }
    const local = resolveUploadPath(url);
    const mime = MIME[path.extname(local).toLowerCase()] || "image/png";
    return { buf: fs.readFileSync(local), mime };
  } catch {
    return null;
  }
}

function dataUri(a: { buf: Buffer; mime: string }): string {
  return `data:${a.mime};base64,${a.buf.toString("base64")}`;
}

// Luminância média dos pixels OPACOS (0..255) → separa logo clara de escura.
async function lumOpaca(buf: Buffer): Promise<number> {
  try {
    const { data, info } = await sharp(buf).resize({ width: 48, withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels; let s = 0, n = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * ch;
      if (data[o + 3] > 128) { s += 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]; n++; }
    }
    return n ? s / n : 128;
  } catch { return 128; }
}

export interface GerarTemplateOpts {
  workspaceId: string;
  variant: LayoutVariant;
  copy: LayoutCopy;
  logos?: string[];                          // variações de logo (URLs /uploads ou http)
  materiais?: { variacoes: string[] }[];     // mascote/materiais visuais
  paleta?: string[];                         // cores da marca (primary, accent…)
  baseUrl?: string;                          // sobrescreve p/ URL absoluta (default: relativa)
}

export interface GerarTemplateResult {
  ok: boolean;
  url?: string;
  filename?: string;
  error?: string;
}

// Resolve os assets do brand kit em data: URIs (o HTML tem que ser self-contained
// pro Chromium — URLs relativas /uploads não têm origem dentro de setContent).
async function resolverBrand(opts: GerarTemplateOpts): Promise<BrandRender> {
  const logoUrls = (opts.logos || []).filter(Boolean);
  const carregadas: { uri: string; lum: number }[] = [];
  for (const u of logoUrls) {
    const a = await carregarAsset(u);
    if (a) carregadas.push({ uri: dataUri(a), lum: await lumOpaca(a.buf) });
  }
  // Logo clara (maior luminância) p/ fundo escuro; escura (menor) p/ fundo claro.
  let logoLight: string | undefined, logoDark: string | undefined;
  if (carregadas.length) {
    const ord = [...carregadas].sort((a, b) => b.lum - a.lum);
    logoLight = ord[0].uri;
    logoDark = ord[ord.length - 1].uri;
  }

  // Mascote/material: 1º material com variação válida, 1ª variação.
  let mascot: string | undefined;
  for (const m of opts.materiais || []) {
    const v = (m?.variacoes || []).find(Boolean);
    if (v) { const a = await carregarAsset(v); if (a) { mascot = dataUri(a); break; } }
  }

  return { logoLight, logoDark, mascot, paleta: opts.paleta, fontCss: INTER_FONT_CSS };
}

export async function gerarImagemTemplate(opts: GerarTemplateOpts): Promise<GerarTemplateResult> {
  try {
    const brand = await resolverBrand(opts);
    const html = renderLayoutHtml(opts.variant, opts.copy, brand);
    const png = await renderHtmlToPng(html, { width: 1080, height: 1350 });

    const filename = `instaflix-tpl-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    fs.writeFileSync(path.join(uploadsDir, filename), png);

    const base = (opts.baseUrl || "").replace(/\/$/, "");
    const url = base ? `${base}/uploads/${filename}` : `/uploads/${filename}`;
    return { ok: true, url, filename };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
