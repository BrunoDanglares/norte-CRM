// Tema ApexCharts centralizado pra ChatBanana CRM. Bruno 2026-05-18.
//
// Centraliza paleta + estilo (grid sutil, tooltip dark moderno, sem toolbar,
// animações finas, tabular nums). Cada wrapper de chart importa daqui e
// estende com options específicas. Detecta dark mode via classe `.dark` no html.
//
// Princípio: Linear-style — denso, monocromático com accent banana, foco no
// dado. Cores semânticas (verde/amber/rose) só pra status, não decorativo.

import type { ApexOptions } from 'apexcharts';

// Bruno 2026-06-14: escala OFICIAL ancorada no ouro da logo (#FAC209 = 500).
export const BANANA = {
  50:  '#FFFBE9',
  100: '#FFF3C0',
  200: '#FDE48A',
  300: '#FCD64E',
  400: '#FBCA22',
  500: '#FAC209',
  600: '#E0A800',
  700: '#B07F02',
  800: '#7A5805',
  900: '#4A3600',
} as const;

// Paleta semântica + setores. Sincronizada com tokens do tailwind.config.
export const SETOR_COLORS = {
  SUPORTE_TECNICO: '#3B82F6',
  FINANCEIRO:      BANANA[500],
  COMERCIAL:       '#10B981',
  CANCELAMENTO:    '#8B5CF6',
} as const;

export const SEMANTIC = {
  success: '#10B981',
  warning: '#F59E0B',
  danger:  '#EF4444',
  info:    '#3B82F6',
  brand:   BANANA[500],
} as const;

// Detecta dark mode pelo class `.dark` no html (padrão shadcn). Cliente-side.
export function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

// Cores derivadas do tema atual (light/dark).
function themeColors(dark: boolean) {
  return {
    text:        dark ? '#e5e7eb' : '#0a0a0a',
    textMuted:   dark ? '#9ca3af' : '#6b7280',
    textSubtle:  dark ? '#6b7280' : '#9ca3af',
    border:      dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    gridLine:    dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    surface:     dark ? '#0f0f12' : '#ffffff',
    surfaceAlt:  dark ? '#1a1a1f' : '#fafafa',
    tooltipBg:   dark ? '#1f1f23' : '#0a0a0a',
    tooltipText: '#ffffff',
  };
}

// Options base — extender em cada chart. Bruno: sem toolbar, sem zoom, sem
// download. É dashboard, não data explorer. Animações 800ms easeinout cubic.
export function baseApexOptions(): ApexOptions {
  const dark = isDarkMode();
  const c = themeColors(dark);

  return {
    chart: {
      foreColor: c.textMuted,
      fontFamily: '"Inclusive Sans", Inter, "Inter Variable", system-ui, sans-serif',
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: {
        enabled: true,
        speed: 700,
        animateGradually: { enabled: true, delay: 80 },
        dynamicAnimation: { enabled: true, speed: 350 },
      },
      dropShadow: { enabled: false },
      background: 'transparent',
      sparkline: { enabled: false },
    },
    grid: {
      borderColor: c.gridLine,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { top: 0, right: 8, bottom: 0, left: 8 },
    },
    xaxis: {
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: { colors: c.textMuted, fontSize: '10px', fontFamily: 'inherit', fontWeight: 500 },
      },
      crosshairs: { show: true, stroke: { color: c.border, width: 1, dashArray: 3 } },
      tooltip: { enabled: false },
    },
    yaxis: {
      labels: {
        style: { colors: c.textMuted, fontSize: '10px', fontFamily: 'inherit', fontWeight: 500 },
        formatter: (v) => formatCompact(v),
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    dataLabels: { enabled: false },
    legend: {
      show: true,
      position: 'bottom',
      horizontalAlign: 'center',
      fontSize: '11px',
      fontWeight: 500,
      labels: { colors: c.text },
      markers: { size: 6, strokeWidth: 0, offsetX: -2 },
      itemMargin: { horizontal: 10, vertical: 4 },
    },
    tooltip: {
      theme: dark ? 'dark' : 'dark',  // Sempre dark — overlay rico contra qualquer bg
      style: { fontSize: '11px', fontFamily: 'inherit' },
      x: { show: true },
      marker: { show: true },
      fillSeriesColor: false,
    },
    states: {
      hover: { filter: { type: 'lighten' } },
      active: { filter: { type: 'darken' } },
    },
    stroke: { curve: 'smooth', width: 2, lineCap: 'round' },
  };
}

// Formatador compacto: 1234 → 1.2k, 1000000 → 1M.
export function formatCompact(v: number): string {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

// Gera definição de gradient pra fill de Area chart com paleta de cores
// passadas. Stops: topo 35% opacity, base 0%.
export function gradientFill(colors: readonly string[]): ApexOptions['fill'] {
  return {
    type: 'gradient',
    colors: [...colors],
    gradient: {
      shadeIntensity: 1,
      opacityFrom: 0.45,
      opacityTo: 0.02,
      stops: [0, 95],
      colorStops: [],
    },
  };
}

// Hook util: ouvir mudança de tema (classe .dark no html) pra re-render.
// Usar em componente: const themeKey = useApexThemeKey();
export function useApexThemeKey(): string {
  // Server side fallback
  if (typeof window === 'undefined') return 'light';
  return isDarkMode() ? 'dark' : 'light';
}
