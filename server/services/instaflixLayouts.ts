// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Biblioteca de LAYOUTS de marca (HTML/CSS → imagem via Chromium).
//
// Cada layout é um post 1080x1350 (feed 4:5) montado por TEMPLATE, consumindo o
// brand kit do tenant (paleta, logo, mascote) + tipografia Inter embutida. A IA
// escreve a COPY estruturada e escolhe o layout; aqui a arte sai nítida e no
// padrão da marca — a técnica das artes de campanha (não letreiro chapado).
//
// Tokens derivam da paleta: primary = paletaCores[0]. Contraste é calculado por
// luminância (texto escuro sobre marca clara e vice-versa) → funciona pra QUALQUER
// tenant (marca dourada, roxa, azul…), não só o ChatBanana. Bruno 2026-07-15.
// ═══════════════════════════════════════════════════════════════════════════

export type LayoutVariant = "grade" | "heroi" | "prova" | "numero";

export interface BrandRender {
  logoLight?: string;   // data: URI ou URL — logo p/ fundo ESCURO (versão clara)
  logoDark?: string;    // data: URI ou URL — logo p/ fundo CLARO (versão escura)
  mascot?: string;      // data: URI ou URL — mascote/material principal
  paleta?: string[];    // ["#hex", ...] — [0]=primary, [1]=accent
  fontCss: string;      // @font-face de Inter/Inter Tight (embutido)
}

export interface Tile { icone?: string; titulo: string; desc?: string }
export interface Chip { icone?: string; texto: string }
export interface ChatMsg { who: "them" | "us"; text: string }

export interface LayoutCopy {
  kicker?: string;
  titulo?: string;       // aceita *ênfase* → destaque na cor da marca
  subtitulo?: string;
  rodape?: string;
  tiles?: Tile[];        // grade
  chips?: Chip[];        // heroi
  chat?: ChatMsg[];      // prova
  pix?: string;          // prova
  numero?: string;       // numero
}

// ── cor / contraste ──────────────────────────────────────────────────────────
function parseHex(hex?: string) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
function toHex(r: number, g: number, b: number) {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
function mix(hex: string, t: { r: number; g: number; b: number }, k: number) {
  const c = parseHex(hex) || { r: 128, g: 128, b: 128 };
  return toHex(c.r + (t.r - c.r) * k, c.g + (t.g - c.g) * k, c.b + (t.b - c.b) * k);
}
const lighten = (hex: string, k = 0.3) => mix(hex, { r: 255, g: 255, b: 255 }, k);
const darken = (hex: string, k = 0.3) => mix(hex, { r: 0, g: 0, b: 0 }, k);
function lum(hex: string) { const c = parseHex(hex); return c ? 0.299 * c.r + 0.587 * c.g + 0.114 * c.b : 0; }
const isLight = (hex: string) => lum(hex) > 165;

function esc(s?: string) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// *texto* → <b>texto</b> (ênfase na cor da marca via classe .g)
function emph(s?: string) {
  return esc(s).replace(/\*([^*]+)\*/g, '<span class="g">$1</span>');
}

// ── ícones (stroke, 24 viewBox) ───────────────────────────────────────────────
const ICON: Record<string, string> = {
  dollar: '<path d="M12 2v20"/><path d="M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"/>',
  wifi: '<path d="M4 11a12 12 0 0 1 16 0"/><path d="M7.5 14.2a7 7 0 0 1 9 0"/><circle cx="12" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 13l4-3"/>',
  pin: '<path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  bars: '<path d="M5 20V10"/><path d="M12 20V4"/><path d="M19 20v-7"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>',
  trend: '<path d="M4 18l6-6 4 4 6-7"/><path d="M20 9v4h-4"/>',
  heart: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3z"/><path d="m9 12 2 2 4-4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 10-12h-7l0-8z"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
  tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 3l4 3 4-3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  wa: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z"/>',
};
function svg(name?: string, sw = 1.7) {
  const p = ICON[name || ""] || ICON.sparkles;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

// ── tokens de tema a partir da paleta ─────────────────────────────────────────
function tema(paleta?: string[]) {
  const p = (paleta || []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  const primary = p[0] || "#FAC209";
  return {
    primary,
    primaryLift: lighten(primary, 0.14),
    primaryDeep: darken(primary, 0.10),
    accent: p[1] || (isLight(primary) ? darken(primary, 0.25) : lighten(primary, 0.3)),
    onPrimary: isLight(primary) ? "#1A1A1A" : "#FFFFFF",
    onPrimaryMuted: isLight(primary) ? "rgba(26,26,26,.66)" : "rgba(255,255,255,.72)",
    ink: "#1A1A1A",
    dark: "#0E1117",
  };
}

// CSS base compartilhado (fonte + reset + frame 1080x1350 no tamanho real).
function baseCss(fontCss: string, t: ReturnType<typeof tema>) {
  return `${fontCss}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1350px;overflow:hidden;background:#000}
body{font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
.frame{position:relative;width:1080px;height:1350px;overflow:hidden}
.pad{position:absolute;inset:0;padding:82px 78px;display:flex;flex-direction:column}
.g{color:${t.primary}}
.ico svg,svg.i{display:block}
h2{font-family:'Inter Tight',sans-serif;font-weight:800;letter-spacing:-.028em;line-height:1;text-wrap:balance}
.kick{display:inline-flex;align-items:center;gap:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.kick svg{width:24px;height:24px}
`;
}

function wrapDoc(css: string, bodyInner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${bodyInner}</body></html>`;
}

// ── LAYOUT: grade (grade de recursos, fundo da cor da marca) ───────────────────
function layoutGrade(copy: LayoutCopy, b: BrandRender, t: ReturnType<typeof tema>) {
  const logo = b.logoLight || b.logoDark;
  const tiles = (copy.tiles || []).slice(0, 6);
  const css = baseCss(b.fontCss, t) + `
.frame{background:radial-gradient(130% 90% at 84% 6%, ${lighten(t.primary,0.28)} 0%, ${t.primary}00 46%),linear-gradient(158deg, ${t.primaryLift} 0%, ${t.primary} 44%, ${t.primaryDeep} 100%);color:${t.onPrimary}}
.pad{padding:76px 74px 70px}
.top{display:flex;align-items:center;justify-content:space-between}
.seal{display:inline-flex;background:${t.ink};border-radius:20px;padding:20px 30px}
.seal img{height:46px;width:auto;display:block}
.emblem{color:${t.onPrimary};opacity:.9}.emblem svg{width:66px;height:66px}
.head{margin-top:50px}
.kick{color:${t.onPrimaryMuted};font-size:21px}
h2.t{color:${t.onPrimary};font-size:82px;margin-top:16px}
.say{font-family:'Inter Tight';font-weight:600;font-size:31px;color:${t.onPrimaryMuted};margin-top:20px}
.grid{margin-top:44px;display:grid;grid-template-columns:1fr 1fr;gap:22px 24px}
.tile{display:flex;gap:20px;align-items:flex-start}
.b2{flex:0 0 auto;width:76px;height:76px;border-radius:20px;background:${t.ink};display:flex;align-items:center;justify-content:center;color:${t.primary}}
.b2 svg{width:38px;height:38px}
.tt{font-family:'Inter Tight';font-weight:800;font-size:29px;color:${t.ink};line-height:1.05}
.td{font-size:20px;color:${t.onPrimaryMuted};line-height:1.28;margin-top:3px;font-weight:500}
.strip{margin-top:auto;background:${t.ink};color:#fff;border-radius:22px;padding:30px 34px;display:flex;align-items:center;gap:20px;font-family:'Inter Tight';font-weight:700;font-size:30px}
.strip .cir{flex:0 0 auto;width:60px;height:60px;border-radius:50%;background:${t.primary};color:${t.ink};display:flex;align-items:center;justify-content:center}
.strip .cir svg{width:32px;height:32px}
`;
  const seal = logo ? `<div class="seal"><img src="${logo}" alt=""></div>` : `<div></div>`;
  const grid = tiles.map((x) => `<div class="tile"><div class="b2">${svg(x.icone)}</div><div><div class="tt">${esc(x.titulo)}</div>${x.desc ? `<div class="td">${esc(x.desc)}</div>` : ""}</div></div>`).join("");
  const strip = copy.rodape ? `<div class="strip"><span class="cir">${svg("chat", 1.9)}</span>${esc(copy.rodape)}</div>` : "";
  const inner = `<div class="frame"><div class="pad">
    <div class="top">${seal}<div class="emblem">${svg("wifi", 1.7)}</div></div>
    <div class="head">${copy.kicker ? `<div class="kick">${esc(copy.kicker)}</div>` : ""}
      <h2 class="t">${emph(copy.titulo)}</h2>
      ${copy.subtitulo ? `<div class="say">${esc(copy.subtitulo)}</div>` : ""}</div>
    <div class="grid">${grid}</div>
    ${strip}
  </div></div>`;
  return wrapDoc(css, inner);
}

// ── LAYOUT: heroi (herói escuro com mascote) ───────────────────────────────────
function layoutHeroi(copy: LayoutCopy, b: BrandRender, t: ReturnType<typeof tema>) {
  const logo = b.logoLight;
  const chips = (copy.chips || []).slice(0, 4);
  const css = baseCss(b.fontCss, t) + `
.frame{background:radial-gradient(90% 60% at 78% 20%, ${t.primary}28, transparent 60%),radial-gradient(70% 50% at 18% 92%, rgba(0,130,251,.10), transparent 60%),linear-gradient(180deg,#0C1016,${t.dark} 60%,#080A0D);color:#F3F5F7}
.logoL{position:absolute;top:74px;left:74px;z-index:3;height:46px;width:auto}
.mascot{position:absolute;right:-24px;bottom:296px;height:600px;width:auto;z-index:1;filter:drop-shadow(0 30px 50px rgba(0,0,0,.55))}
.pad{justify-content:flex-start;padding-top:172px;z-index:2}
.hw{max-width:600px}
.kick{color:${t.primary};font-size:20px}
h2.t{font-size:88px;color:#fff;margin-top:24px}
.say{font-family:'Inter Tight';font-weight:500;font-size:33px;color:#C9D1DA;margin-top:24px;max-width:14ch;line-height:1.24}
.chips{position:absolute;left:0;right:0;bottom:150px;z-index:2;display:flex;gap:18px;padding:0 74px}
.chip{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;gap:11px}
.chip svg{width:40px;height:40px;color:${t.primary}}
.chip span{font-family:'Inter Tight';font-weight:700;font-size:21px;line-height:1.12}
.footbar{position:absolute;left:0;right:0;bottom:0;height:118px;background:${t.primary};color:${t.onPrimary};display:flex;align-items:center;gap:22px;padding:0 74px;z-index:3}
.footbar svg{width:44px;height:44px}
.footbar b{font-family:'Inter Tight';font-weight:800;font-size:30px;letter-spacing:.02em;text-transform:uppercase}
`;
  const mascot = b.mascot ? `<img class="mascot" src="${b.mascot}" alt="">` : "";
  const logoEl = logo ? `<img class="logoL" src="${logo}" alt="">` : "";
  const chipsEl = chips.length ? `<div class="chips">${chips.map((c) => `<div class="chip">${svg(c.icone)}<span>${esc(c.texto)}</span></div>`).join("")}</div>` : "";
  const foot = copy.rodape ? `<div class="footbar">${svg("wifi", 1.9)}<b>${esc(copy.rodape)}</b></div>` : "";
  const inner = `<div class="frame">${logoEl}${mascot}
    <div class="pad"><div class="hw">
      ${copy.kicker ? `<div class="kick">${svg("clock")} ${esc(copy.kicker)}</div>` : ""}
      <h2 class="t">${emph(copy.titulo)}</h2>
      ${copy.subtitulo ? `<div class="say">${esc(copy.subtitulo)}</div>` : ""}
    </div></div>
    ${chipsEl}${foot}
  </div>`;
  return wrapDoc(css, inner);
}

// ── LAYOUT: prova (prova de conversa estilo WhatsApp) ──────────────────────────
function layoutProva(copy: LayoutCopy, b: BrandRender, t: ReturnType<typeof tema>) {
  const logo = b.logoLight;
  const chat = (copy.chat || []).slice(0, 4);
  const css = baseCss(b.fontCss, t) + `
.frame{background:linear-gradient(180deg,${t.dark},#0A0C10);color:#F3F5F7}
.kick{color:${t.primary};font-size:20px;letter-spacing:.18em}
h2.t{font-size:84px;color:#fff;margin-top:20px}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center}
.card{background:#0b141a;border-radius:26px;padding:34px;display:flex;flex-direction:column;gap:20px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.bub{max-width:80%;padding:22px 26px;border-radius:22px;font-size:26px;line-height:1.32}
.bub .g{color:inherit;font-weight:800}
.them{align-self:flex-start;background:#1f2c33;border-top-left-radius:6px;color:#EAF0F2}
.us{align-self:flex-end;background:#DCF8C6;color:#0b2e1e;border-top-right-radius:6px;font-weight:500}
.pix{align-self:flex-end;display:flex;align-items:center;gap:16px;background:#0e2a20;border:1px dashed rgba(37,211,102,.5);border-radius:16px;padding:18px 22px;color:#9ff0c0;font-size:22px;font-family:'Inter Tight';font-weight:600}
.pix .cp{margin-left:8px;background:#25D366;color:#06251a;font-weight:800;border-radius:10px;padding:8px 16px;font-size:19px}
.foot{display:flex;align-items:center;gap:22px;padding-top:36px;border-top:1px solid rgba(255,255,255,.08)}
.foot img{height:40px;width:auto}
.foot span{color:#AEB7C0;font-family:'Inter Tight';font-weight:600;font-size:26px}
`;
  const bubbles = chat.map((m) => `<div class="bub ${m.who === "us" ? "us" : "them"}">${emph(m.text)}</div>`).join("");
  const pix = copy.pix ? `<div class="pix"><span>${esc(copy.pix)}</span><span class="cp">copiar</span></div>` : "";
  const foot = (logo || copy.rodape) ? `<div class="foot">${logo ? `<img src="${logo}" alt="">` : ""}${copy.rodape ? `<span>${esc(copy.rodape)}</span>` : ""}</div>` : "";
  const inner = `<div class="frame"><div class="pad">
    ${copy.kicker ? `<div class="kick">${svg("shield")} ${esc(copy.kicker)}</div>` : ""}
    <h2 class="t">${emph(copy.titulo)}</h2>
    <div class="mid"><div class="card">${bubbles}${pix}</div></div>
    ${foot}
  </div></div>`;
  return wrapDoc(css, inner);
}

// ── LAYOUT: numero (número/impacto centralizado) ───────────────────────────────
function layoutNumero(copy: LayoutCopy, b: BrandRender, t: ReturnType<typeof tema>) {
  const logo = b.logoLight;
  const css = baseCss(b.fontCss, t) + `
.frame{background:radial-gradient(80% 55% at 50% 30%, ${t.primary}22, transparent 60%),linear-gradient(180deg,${t.dark},#090B0E);color:#F3F5F7}
.pad{align-items:center;justify-content:center;text-align:center}
.kick{color:${t.primary};font-size:22px;letter-spacing:.22em}
.big{font-family:'Inter Tight';font-weight:800;font-size:380px;line-height:.86;letter-spacing:-.04em;color:${t.primary};margin-top:28px;text-shadow:0 20px 60px ${t.primary}33}
.say{font-family:'Inter Tight';font-weight:600;font-size:40px;line-height:1.2;margin-top:26px;max-width:20ch;color:#fff}
.foot{margin-top:54px;display:flex;flex-direction:column;align-items:center;gap:18px}
.foot img{height:44px;width:auto}
.foot .cta{color:#AEB7C0;font-size:24px;font-family:'Inter Tight';font-weight:600}
`;
  const foot = (logo || copy.rodape) ? `<div class="foot">${logo ? `<img src="${logo}" alt="">` : ""}${copy.rodape ? `<span class="cta">${esc(copy.rodape)}</span>` : ""}</div>` : "";
  const inner = `<div class="frame"><div class="pad">
    ${copy.kicker ? `<div class="kick">${esc(copy.kicker)}</div>` : ""}
    <div class="big">${esc(copy.numero || "")}</div>
    ${copy.subtitulo ? `<div class="say">${emph(copy.subtitulo)}</div>` : ""}
    ${foot}
  </div></div>`;
  return wrapDoc(css, inner);
}

const VARIANTS: Record<LayoutVariant, (c: LayoutCopy, b: BrandRender, t: ReturnType<typeof tema>) => string> = {
  grade: layoutGrade, heroi: layoutHeroi, prova: layoutProva, numero: layoutNumero,
};

export const LAYOUT_VARIANTS: LayoutVariant[] = ["grade", "heroi", "prova", "numero"];
export const ICON_NAMES = Object.keys(ICON);

// Monta o HTML final de UM post a partir do layout + copy + brand kit.
export function renderLayoutHtml(variant: LayoutVariant, copy: LayoutCopy, brand: BrandRender): string {
  const t = tema(brand.paleta);
  const fn = VARIANTS[variant] || layoutHeroi;
  return fn(copy, brand, t);
}
