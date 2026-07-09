// Motor do painel de Personalização (Rightbar do Nexus). Persiste em localStorage
// e aplica no DOM: tema (data-theme + .dark), tema da sidebar, família de fonte
// (data-font-family) e direção (dir). Fonte única de verdade da personalização.

export type NexusTheme = "light" | "dark" | "contrast" | "material" | "dim" | "material-dark" | "system";
export type SidebarTheme = "" | "light" | "dark";
export type FontFamily = "inclusive" | "dm-sans" | "wix" | "ar-one";
export type Direction = "ltr" | "rtl";

// theme → nome do @plugin daisyui/theme registrado no index.css
const DAISY: Record<Exclude<NexusTheme, "system">, string> = {
  light: "branco",
  dark: "preto",
  contrast: "contrast",
  material: "material",
  dim: "dim",
  "material-dark": "material-dark",
};
// temas cujo color-scheme é escuro → precisam da classe .dark (tokens shadcn)
const DARKISH = new Set<string>(["dark", "dim", "material-dark"]);

// ── Ponte daisyUI → shadcn ──────────────────────────────────────────────────
// Os temas EXTRAS (contrast/material/dim/material-dark) só mexem nos tokens
// daisyUI (base-*). Componentes shadcn (inbox, cards, popovers) usam --card/
// --background/--foreground etc. em formato HSL. Sem dirigir esses tokens, o
// tema estendido "quebra" (parte no tom do tema, parte no preto/branco antigo).
// Aqui espelhamos os neutros de cada tema estendido nos tokens shadcn.
// Luz/Escuro NÃO entram (o color-presets/theme-provider já cuida via Azul Norte).
const THEME_NEUTRALS: Record<string, { bg: string; fg: string; card: string; b2: string; b3: string; mutedFg: string }> = {
  contrast:        { bg: "#f2f4f6", fg: "#1e2328", card: "#ffffff", b2: "#eef0f2", b3: "#dcdee0", mutedFg: "#6b7280" },
  material:        { bg: "#fdfeff", fg: "#191e28", card: "#f6f8ff", b2: "#eaecfa", b3: "#e0e2f8", mutedFg: "#6b7280" },
  dim:             { bg: "#222630", fg: "#f0f4f8", card: "#2a2e38", b2: "#343842", b3: "#3c404a", mutedFg: "#9aa4b0" },
  "material-dark": { bg: "#141618", fg: "#f0f4f8", card: "#181e24", b2: "#202830", b3: "#2c323a", mutedFg: "#9aa4b0" },
};

// hex "#rrggbb" → "H S% L%" (formato que o shadcn espera em hsl(var(--token))).
function hexToHslChannels(hex: string): string {
  const h2 = hex.replace("#", "");
  const r = parseInt(h2.slice(0, 2), 16) / 255;
  const g = parseInt(h2.slice(2, 4), 16) / 255;
  const b = parseInt(h2.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// Aplica os neutros do tema nos tokens shadcn (via inline style — vence :root/.dark
// e o color-presets, que também são inline; o último a escrever ganha).
function applyShadcnNeutrals(themeId: string): void {
  const html = document.documentElement;
  const n = THEME_NEUTRALS[themeId];
  if (!n) return; // Luz/Escuro/Sistema → color-presets cuida; nada a fazer aqui.
  const hx = (c: string) => hexToHslChannels(c);
  const map: Record<string, string> = {
    "--background": hx(n.bg),
    "--foreground": hx(n.fg),
    "--card": hx(n.card),
    "--card-foreground": hx(n.fg),
    "--card-border": hx(n.b3),
    "--border": hx(n.b3),
    "--input": hx(n.b3),
    "--muted": hx(n.b2),
    "--muted-foreground": hx(n.mutedFg),
    "--secondary": hx(n.b2),
    "--secondary-foreground": hx(n.fg),
    "--accent": hx(n.b2),
    "--accent-foreground": hx(n.fg),
    "--popover": hx(n.card),
    "--popover-foreground": hx(n.fg),
    "--sidebar": hx(n.card),
    "--sidebar-foreground": hx(n.fg),
    "--sidebar-border": hx(n.b3),
  };
  for (const [k, v] of Object.entries(map)) html.style.setProperty(k, v);
}

const K = {
  theme: "nexus:theme",
  sidebar: "nexus:sidebar",
  font: "nexus:font",
  dir: "nexus:dir",
} as const;

function ls(k: string, fallback: string): string {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}

export interface NexusCfg {
  theme: NexusTheme;
  sidebar: SidebarTheme;
  font: FontFamily;
  dir: Direction;
}

// nexus:theme só existe quando o usuário escolhe um tema no painel de
// Personalização. Ausente = tema base (Luz/Escuro) é do theme-provider; então
// derivamos de localStorage.theme pra o painel refletir o estado real.
function rawNexusTheme(): string {
  return ls(K.theme, "");
}

export function getNexusCfg(): NexusCfg {
  const raw = rawNexusTheme();
  const base = ls("theme", "light") === "dark" ? "dark" : "light";
  return {
    theme: (raw || base) as NexusTheme,
    sidebar: ls(K.sidebar, "") as SidebarTheme,
    font: ls(K.font, "inclusive") as FontFamily,
    dir: ls(K.dir, "ltr") as Direction,
  };
}

function systemPref(): "light" | "dark" {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}

// Aplica TODA a personalização no DOM. Chamado no boot e a cada mudança.
export function applyNexusConfig(): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const cfg = getNexusCfg();
  const raw = rawNexusTheme();

  // ── Tema ──
  // O tema BASE (Luz/Escuro/Sistema) pertence AO theme-provider — ele aplica o
  // data-theme, a classe .dark E o color-preset (Azul Norte) de forma atômica,
  // sincronizado com o perfil. O nexus-config só assume o controle dos temas
  // ESTENDIDOS (contraste/material/dim/material-dark).
  //
  // Antes, ao remontar o NexusLayout (ex.: voltar do modo Atendimento), isto
  // forçava data-theme a partir do nexus:theme (null → "light") SEM reaplicar o
  // color-preset → daisyUI (claro) x shadcn (escuro) dessincronizados: sidebar
  // com texto invisível e barra preta. Agora, sem escolha explícita de tema
  // estendido, NÃO tocamos no tema base — deixamos o theme-provider mandar.
  const effective = cfg.theme === "system" ? systemPref() : cfg.theme;
  if (raw && THEME_NEUTRALS[effective]) {
    html.setAttribute("data-theme", DAISY[effective as Exclude<NexusTheme, "system">] ?? "branco");
    html.classList.toggle("dark", DARKISH.has(effective));
    try { localStorage.setItem("theme", DARKISH.has(effective) ? "dark" : "light"); } catch {}
    applyShadcnNeutrals(effective);
  }

  // ── Tema da sidebar (override opcional) ──
  const sb = document.getElementById("layout-sidebar");
  if (sb) {
    if (cfg.sidebar === "dark") sb.setAttribute("data-theme", "preto");
    else if (cfg.sidebar === "light") sb.setAttribute("data-theme", "branco");
    else sb.removeAttribute("data-theme");
  }

  // ── Família de fonte ──
  html.setAttribute("data-font-family", cfg.font);

  // ── Direção ──
  html.setAttribute("dir", cfg.dir);
}

export function setNexusCfg<K2 extends keyof typeof K>(key: K2, value: string): void {
  try { localStorage.setItem(K[key], value); } catch {}
  applyNexusConfig();
}

export function resetNexusConfig(): void {
  try { Object.values(K).forEach((k) => localStorage.removeItem(k)); } catch {}
  applyNexusConfig();
}
