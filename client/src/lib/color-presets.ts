// ═══════════════════════════════════════════════════════════════════════
// Color presets — 4 paletas (banana/lilac/blue/orange) com light + dark.
//
// Aplicadas via JS (root.style.setProperty) por cima do CSS base do
// index.css. O CSS define "banana" como default; estas funções permitem
// trocar pras outras 3 paletas em runtime.
//
// Bruno (2026-05-21): expansão de 1 pra 4 paletas — tenant escolhe a cor.
// Bruno (2026-05-14): refatorado pra banana mesclada. Histórico:
//   - applyVioletTheme(): preservada por compat (chama applyColorPreset
//     com a paleta salva no localStorage)
// ═══════════════════════════════════════════════════════════════════════

export type ColorPreset = "norte" | "banana" | "lilac" | "blue" | "orange" | "mono";
export type ThemeMode = "light" | "dark";

// Redesign Norte (2026-07): identidade migrada pro Norte Gestão ERP. Bruno
// trocou a primária de azul (#1474ff) pra VIOLETA (#7C3AED) — o azul virou a
// secundária. Preset default = norte; todo shadcn usa o violeta.
export const DEFAULT_PRESET: ColorPreset = "norte";

interface AccentVars {
  "--primary": string;
  "--primary-foreground": string;
  "--accent": string;
  "--accent-foreground": string;
  "--ring": string;
  "--sidebar-primary": string;
  "--sidebar-primary-foreground": string;
  "--sidebar-accent": string;
  "--sidebar-accent-foreground": string;
  "--brand": string;
  "--brand-foreground": string;
  /** Bruno 2026-05-21: cor das labels de grupo do sidebar (PRINCIPAL, COMUNICAÇÃO, etc).
   *  Banana mantém muted-foreground (neutro pro tema original); demais usam primary. */
  "--sidebar-group-label"?: string;
  /** Bruno 2026-05-21: tonalidade super clara da cor do tema (~50 da escala Tailwind).
   *  Usado em fundos sutis de cabeçalho de tabela, banners, PageShell, etc.
   *  Substitui --banana-50 hardcoded — antes todos os temas mostravam amarelo. */
  "--theme-tint-50"?: string;
}

interface WallpaperVars {
  "--chat-wall-bg": string;
  "--chat-wall-icon": string;
}

export interface PresetConfig {
  id: ColorPreset;
  label: string;
  swatch: string;
  light: AccentVars;
  dark: AccentVars;
  // Bruno 2026-05-21: wallpaper do chat (ChatWallpaper.tsx) ganha pigmento
  // sutil da cor do tema. Banana mantém o branco original (#FFFFFF) e o
  // cinza neutro (#141414) pra preservar o look base; lilac/blue/orange
  // recebem tonalidade puxando pra cor do tema em ambos os modos.
  wallpaperLight: WallpaperVars;
  wallpaperDark: WallpaperVars;
}

// Redesign Norte: base "branco" do ERP (página #f6f7f9 levemente cinza, cards
// brancos, texto quase-preto #0a0e14, bordas #e4e6e9). Leve profundidade.
const NEUTRAL_BASE_LIGHT: Record<string, string> = {
  "--background":      "220 14% 97%",  // #f6f7f9 — página
  "--foreground":      "215 33% 6%",   // #0a0e14 — texto
  "--border":          "216 11% 90%",  // #e4e6e9
  "--card":            "0 0% 100%",     // branco puro
  "--card-foreground": "215 33% 6%",
  "--card-border":     "216 11% 90%",

  "--sidebar":           "0 0% 100%",
  "--sidebar-foreground": "215 25% 15%",
  "--sidebar-border":    "216 11% 90%",

  "--secondary":            "220 13% 95%",  // #f2f3f5
  "--secondary-foreground": "215 33% 6%",
  "--muted":                "220 13% 95%",
  "--muted-foreground":     "220 9% 46%",
  "--input":                "216 12% 88%",

  "--popover":            "0 0% 100%",
  "--popover-foreground": "215 33% 6%",
  "--popover-border":     "216 11% 90%",
};

// Redesign Norte: base "preto" do ERP (OLED puro #000 na página/sidebar, cards
// que sobem pra #0c0c0c, bordas #242424, texto branco). Leve profundidade sem
// perder o preto puro. Decisão Victor 2026-06-04 (identidade Azul Norte).
const NEUTRAL_BASE_DARK: Record<string, string> = {
  "--background":      "0 0% 0%",     // #000 — OLED puro
  "--foreground":      "0 0% 98%",
  "--border":          "0 0% 14%",    // #242424
  "--card":            "0 0% 5%",     // #0c0c0c — surface lift
  "--card-foreground": "0 0% 98%",
  "--card-border":     "0 0% 14%",

  "--sidebar":           "0 0% 0%",    // #000 — igual à página (flat)
  "--sidebar-foreground": "0 0% 83%",
  "--sidebar-border":    "0 0% 12%",

  "--secondary":            "0 0% 9%",   // #161616
  "--secondary-foreground": "0 0% 98%",
  "--muted":                "0 0% 9%",
  "--muted-foreground":     "0 0% 60%",
  "--input":                "0 0% 14%",

  "--popover":            "0 0% 7%",
  "--popover-foreground": "0 0% 98%",
  "--popover-border":     "0 0% 16%",
};

export const PRESETS: Record<ColorPreset, PresetConfig> = {
  // Redesign Norte — paleta "Violeta Norte" (primary #7C3AED violeta, secondary
  // #1474ff azul, accent #06b6d4). Bruno 2026-07: primária trocada de azul pra
  // violeta; o azul virou a secundária. Preset default do CRM.
  norte: {
    id: "norte",
    label: "Violeta Norte",
    swatch: "#7C3AED",
    light: {
      "--primary":             "262 83% 58%",   // #7C3AED — Violeta
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "262 80% 96%",    // tint violeta bem claro
      "--accent-foreground":   "262 55% 30%",
      "--ring":                "262 83% 58%",
      "--sidebar-primary":     "262 83% 58%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "262 80% 96%",
      "--sidebar-accent-foreground": "262 55% 30%",
      "--brand":               "262 83% 63%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(var(--muted-foreground))",  // labels neutras (estilo Nexus)
      "--theme-tint-50":       "#f2ecff",
    },
    dark: {
      "--primary":             "258 90% 66%",   // #8B5CF6 — violeta um pouco mais claro no preto
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "258 90% 66%",
      "--accent-foreground":   "0 0% 100%",
      "--ring":                "258 90% 66%",
      "--sidebar-primary":     "258 90% 66%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "0 0% 9%",        // hover escuro (#161616)
      "--sidebar-accent-foreground": "0 0% 96%",
      "--brand":               "258 90% 70%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(var(--muted-foreground))",
      "--theme-tint-50":       "hsl(258 90% 66% / 0.10)",
    },
    // Wallpaper do chat: claro branco levemente violeta; escuro preto puro.
    wallpaperLight: { "--chat-wall-bg": "#f6f7f9", "--chat-wall-icon": "#e2dcf0" },
    wallpaperDark:  { "--chat-wall-bg": "#000000", "--chat-wall-icon": "#2a2a2a" },
  },
  banana: {
    id: "banana",
    label: "Banana",
    // Bruno 2026-06-14: ouro OFICIAL da logo ChätBanana (#FAC209), amostrado
    // dos pixels reais da wordmark/balão/fundo. Substitui o #FFC700 lemão
    // antigo por um ouro mais quente e premium, fiel à marca.
    swatch: "#FAC209",
    light: {
      "--primary":             "46 96% 51%",   // #FAC209 — ouro oficial
      "--primary-foreground":  "0 0% 10%",      // ink preto (contraste 10.6:1, AAA)
      "--accent":              "49 100% 96%",   // banana-50 #FFFBE9
      "--accent-foreground":   "0 0% 10%",
      "--ring":                "46 96% 51%",
      "--sidebar-primary":     "46 96% 51%",
      "--sidebar-primary-foreground": "0 0% 10%",
      "--sidebar-accent":      "49 100% 96%",   // banana-50 — hover sutil
      "--sidebar-accent-foreground": "0 0% 10%",
      "--brand":               "46 96% 56%",    // banana-400 #FBCA22
      "--brand-foreground":    "0 0% 10%",
      // Banana mantém label neutra (amarelo já é forte, label colorida virava ruído).
      "--sidebar-group-label": "hsl(var(--muted-foreground))",
      "--theme-tint-50":       "#FFFBE9", // banana-50 oficial
    },
    dark: {
      "--primary":             "46 96% 51%",   // #FAC209 — ouro oficial (mesmo do light)
      "--primary-foreground":  "0 0% 10%",
      "--accent":              "46 96% 51%",
      "--accent-foreground":   "0 0% 10%",
      "--ring":                "46 96% 51%",
      "--sidebar-primary":     "46 96% 51%",
      "--sidebar-primary-foreground": "0 0% 10%",
      "--sidebar-accent":      "217 15% 15%",  // hover frio (acompanha a base slate)
      "--sidebar-accent-foreground": "0 0% 96%",
      "--brand":               "46 96% 56%",    // banana-400 #FBCA22
      "--brand-foreground":    "0 0% 10%",
      "--sidebar-group-label": "hsl(var(--muted-foreground))",
      // Bruno 2026-06-14: dark = wash NEUTRO (grafite), NÃO ouro. O tint dourado
      // de 6% pintava todas as superfícies (washes, headers de tabela, tabs) de
      // "marrom" sobre o fundo preto. Branco translúcido = só um lift de grafite.
      "--theme-tint-50":       "hsl(0 0% 100% / 0.045)",
    },
    // Light: branco neutro original do mockup. Dark: cinza neutro original.
    wallpaperLight: { "--chat-wall-bg": "#FFFFFF", "--chat-wall-icon": "#E8E8E8" },
    wallpaperDark:  { "--chat-wall-bg": "#141414", "--chat-wall-icon": "#3D3D3D" },
  },
  lilac: {
    id: "lilac",
    label: "Lilás",
    swatch: "#8B5CF6",
    light: {
      "--primary":             "262 83% 58%",
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "262 80% 96%",
      "--accent-foreground":   "262 50% 25%",
      "--ring":                "262 83% 58%",
      "--sidebar-primary":     "262 83% 58%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "262 80% 96%",
      "--sidebar-accent-foreground": "262 50% 25%",
      "--brand":               "262 83% 65%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(262 83% 58%)",
      "--theme-tint-50":       "#F5F0FF",
    },
    dark: {
      "--primary":             "262 83% 62%",
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "262 83% 62%",
      "--accent-foreground":   "0 0% 100%",
      "--ring":                "262 83% 62%",
      "--sidebar-primary":     "262 83% 62%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "0 0% 15%",
      "--sidebar-accent-foreground": "0 0% 96%",
      "--brand":               "262 83% 70%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(262 83% 70%)",
      "--theme-tint-50":       "rgba(139, 92, 246, 0.08)",
    },
    // Light puxado pra violeta (hue 262, sat ~25%, light ~97%); dark idem ~9%.
    wallpaperLight: { "--chat-wall-bg": "#F8F6FC", "--chat-wall-icon": "#E0D9EE" },
    wallpaperDark:  { "--chat-wall-bg": "#15121C", "--chat-wall-icon": "#3F3650" },
  },
  blue: {
    id: "blue",
    label: "Azul",
    swatch: "#3B82F6",
    light: {
      "--primary":             "217 91% 55%",
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "217 85% 96%",
      "--accent-foreground":   "217 60% 25%",
      "--ring":                "217 91% 55%",
      "--sidebar-primary":     "217 91% 55%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "217 85% 96%",
      "--sidebar-accent-foreground": "217 60% 25%",
      "--brand":               "217 91% 62%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(217 91% 55%)",
      "--theme-tint-50":       "#EFF5FF",
    },
    dark: {
      "--primary":             "217 91% 60%",
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "217 91% 60%",
      "--accent-foreground":   "0 0% 100%",
      "--ring":                "217 91% 60%",
      "--sidebar-primary":     "217 91% 60%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "0 0% 15%",
      "--sidebar-accent-foreground": "0 0% 96%",
      "--brand":               "217 91% 68%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(217 91% 68%)",
      "--theme-tint-50":       "rgba(59, 130, 246, 0.08)",
    },
    // Light puxado pra azul (hue 217, sat ~25%, light ~97%); dark idem ~9%.
    wallpaperLight: { "--chat-wall-bg": "#F5F8FD", "--chat-wall-icon": "#D9E2F0" },
    wallpaperDark:  { "--chat-wall-bg": "#11141B", "--chat-wall-icon": "#36404E" },
  },
  orange: {
    id: "orange",
    label: "Laranja",
    swatch: "#F97316",
    light: {
      "--primary":             "24 95% 53%",
      "--primary-foreground":  "0 0% 100%",
      "--accent":              "24 95% 95%",
      "--accent-foreground":   "24 70% 25%",
      "--ring":                "24 95% 53%",
      "--sidebar-primary":     "24 95% 53%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "24 95% 95%",
      "--sidebar-accent-foreground": "24 70% 25%",
      "--brand":               "24 95% 60%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(24 95% 53%)",
      "--theme-tint-50":       "#FFF3EB",
    },
    dark: {
      "--primary":             "24 95% 58%",
      "--primary-foreground":  "0 0% 10%",
      "--accent":              "24 95% 58%",
      "--accent-foreground":   "0 0% 10%",
      "--ring":                "24 95% 58%",
      "--sidebar-primary":     "24 95% 58%",
      "--sidebar-primary-foreground": "0 0% 10%",
      "--sidebar-accent":      "0 0% 15%",
      "--sidebar-accent-foreground": "0 0% 96%",
      "--brand":               "24 95% 65%",
      "--brand-foreground":    "0 0% 10%",
      "--sidebar-group-label": "hsl(24 95% 65%)",
      "--theme-tint-50":       "rgba(249, 115, 22, 0.08)",
    },
    // Light puxado pra terra/âmbar (hue 24, sat ~30%, light ~97%); dark idem ~9%.
    wallpaperLight: { "--chat-wall-bg": "#FDF7F2", "--chat-wall-icon": "#F0DDCB" },
    wallpaperDark:  { "--chat-wall-bg": "#1B1410", "--chat-wall-icon": "#4D3D33" },
  },
  // Bruno 2026-05-21: 5º tema — escala monocromática branco→preto. Hue 0,
  // saturação 0 — sem matiz, só luminância. Útil pra tenants que querem look
  // sóbrio/corporativo ou pra branding neutro. Light usa charcoal escuro como
  // primary (CTA contrasta bem em fundo claro); dark usa cinza claro.
  mono: {
    id: "mono",
    label: "Mono",
    swatch: "#525252",
    light: {
      "--primary":             "0 0% 22%",   // charcoal escuro
      "--primary-foreground":  "0 0% 100%",  // branco sobre charcoal
      "--accent":              "0 0% 94%",
      "--accent-foreground":   "0 0% 15%",
      "--ring":                "0 0% 22%",
      "--sidebar-primary":     "0 0% 22%",
      "--sidebar-primary-foreground": "0 0% 100%",
      "--sidebar-accent":      "0 0% 94%",
      "--sidebar-accent-foreground": "0 0% 15%",
      "--brand":               "0 0% 30%",
      "--brand-foreground":    "0 0% 100%",
      "--sidebar-group-label": "hsl(var(--muted-foreground))",
      "--theme-tint-50":       "#F2F2F2",
    },
    dark: {
      "--primary":             "0 0% 78%",   // cinza claro
      "--primary-foreground":  "0 0% 10%",   // preto sobre cinza claro
      "--accent":              "0 0% 22%",
      "--accent-foreground":   "0 0% 96%",
      "--ring":                "0 0% 78%",
      "--sidebar-primary":     "0 0% 78%",
      "--sidebar-primary-foreground": "0 0% 10%",
      "--sidebar-accent":      "0 0% 18%",
      "--sidebar-accent-foreground": "0 0% 96%",
      "--brand":               "0 0% 85%",
      "--brand-foreground":    "0 0% 10%",
      "--sidebar-group-label": "hsl(var(--muted-foreground))",
      "--theme-tint-50":       "rgba(255, 255, 255, 0.06)",
    },
    // Light: branco neutro com ícones cinza médio. Dark: cinza neutro padrão.
    wallpaperLight: { "--chat-wall-bg": "#FFFFFF", "--chat-wall-icon": "#E8E8E8" },
    wallpaperDark:  { "--chat-wall-bg": "#141414", "--chat-wall-icon": "#3D3D3D" },
  },
};

export const PRESET_LIST: PresetConfig[] = [
  PRESETS.norte,
  PRESETS.banana,
  PRESETS.lilac,
  PRESETS.blue,
  PRESETS.orange,
  PRESETS.mono,
];

// Bruno 2026-06-18: tema único = banana. Sempre retorna o preset oficial,
// ignorando preset antigo no localStorage (seletor de cor foi removido).
function getStoredPreset(): ColorPreset {
  return DEFAULT_PRESET;
}

export function applyColorPreset(preset: ColorPreset, mode: ThemeMode): void {
  const config = PRESETS[preset] ?? PRESETS[DEFAULT_PRESET];
  const base = mode === "dark" ? NEUTRAL_BASE_DARK : NEUTRAL_BASE_LIGHT;
  const accent = mode === "dark" ? config.dark : config.light;
  const wallpaper = mode === "dark" ? config.wallpaperDark : config.wallpaperLight;
  const merged: Record<string, string> = { ...base, ...accent, ...wallpaper };

  const root = document.documentElement;
  for (const [key, value] of Object.entries(merged)) {
    root.style.setProperty(key, value);
  }

  // Cache pro script inline em index.html aplicar antes do React montar
  // (evita flash da paleta default no primeiro paint).
  // Bruno 2026-05-21: bump CACHE_VER quando adicionar nova var no preset —
  // index.html script invalida caches antigos automaticamente.
  try {
    localStorage.setItem("colorPreset", preset);
    localStorage.setItem("colorPresetVars", JSON.stringify(merged));
    localStorage.setItem("colorPresetVersion", "11");
  } catch {}
}

// Compat: callers antigos usavam applyVioletTheme(mode) — agora lê o
// preset salvo no localStorage e aplica.
export function applyVioletTheme(mode: ThemeMode): void {
  applyColorPreset(getStoredPreset(), mode);
}
