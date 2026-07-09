// Wrappers de gráfico ApexCharts com tema centralizado pra ChatBanana CRM.
// Bruno 2026-05-18. Princípio Linear-style: denso, accent banana, sem ruído.
//
// Cada wrapper recebe `data` (formato simples) + `colors` (opcional) e cuida
// de aplicar opts base, fill gradient, tooltip dark, axis sutil, etc.
//
// Code-split: react-apexcharts é ~250KB. Carrega via React.lazy + Suspense
// dentro de cada wrapper, com skeleton fallback. Mantém bundle inicial leve;
// charts só são baixados quando entram em viewport / renderizam.
//
// Importar via:
//   import { AreaChart, BarChart, PieChart, ComposedChart, LineChart } from '@/components/charts';

import { useMemo, lazy, Suspense, type ComponentType } from 'react';
import type { ApexOptions } from 'apexcharts';
import {
  baseApexOptions,
  gradientFill,
  formatCompact,
  isDarkMode,
} from '@/lib/apex-theme';

// react-apexcharts é shipped sem ESM default em alguns ambientes.
// Helper resolve qualquer forma de export e cacheia a Promise (lazy garante).
const ApexChartReact = lazy(() =>
  import('react-apexcharts').then((m) => ({ default: (m as any).default ?? (m as any) }))
) as unknown as ComponentType<any>;

// Skeleton minimalista — mesma altura, animação shimmer sutil.
function ChartFallback({ height = 240 }: { height?: number }) {
  return (
    <div
      className="w-full rounded-md bg-secondary/30 animate-pulse"
      style={{ height }}
      aria-hidden="true"
    />
  );
}

// React.lazy + Suspense seria ideal pro chunk-split, mas pra dashboard que
// renderiza tudo de uma vez, top-level já basta. Vite faz tree-shake.

interface SeriesPoint {
  x: string | number;
  y: number;
}

interface MultiSeries {
  name: string;
  data: number[];
  color?: string;
  type?: 'area' | 'bar' | 'line';
}

// ──────────────────────────────────────────────────────────────────────────
// AreaChart — tendência temporal com fill gradient sutil.
// ──────────────────────────────────────────────────────────────────────────
export function AreaChart({
  categories,
  series,
  colors,
  height = 240,
  stacked = false,
  smooth = true,
  showLegend = true,
}: {
  categories: (string | number)[];
  series: MultiSeries[];
  colors?: string[];
  height?: number;
  stacked?: boolean;
  smooth?: boolean;
  showLegend?: boolean;
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const finalColors = colors ?? series.map((s) => s.color).filter(Boolean) as string[];

  const options = useMemo<ApexOptions>(() => {
    const base = baseApexOptions();
    return {
      ...base,
      chart: { ...base.chart, type: 'area', stacked },
      colors: finalColors.length ? finalColors : undefined,
      stroke: { ...base.stroke, curve: smooth ? 'smooth' : 'straight', width: 2 },
      fill: gradientFill(finalColors.length ? finalColors : ['#FAC209']),
      xaxis: { ...base.xaxis, categories },
      legend: { ...base.legend, show: showLegend },
      tooltip: {
        ...base.tooltip,
        y: { formatter: (v) => `${formatCompact(v)}` },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(categories), JSON.stringify(finalColors), stacked, smooth, showLegend, themeKey]);

  const seriesData = series.map((s) => ({ name: s.name, data: s.data }));

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={seriesData}
        type="area"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// BarChart — comparação. Suporta vertical (default) e horizontal.
// ──────────────────────────────────────────────────────────────────────────
export function BarChart({
  categories,
  series,
  colors,
  height = 240,
  stacked = false,
  horizontal = false,
  showLegend = true,
  borderRadius = 4,
}: {
  categories: (string | number)[];
  series: MultiSeries[];
  colors?: string[];
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  showLegend?: boolean;
  borderRadius?: number;
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const finalColors = colors ?? series.map((s) => s.color).filter(Boolean) as string[];

  // Bruno 2026-05-18: bar horizontal com 1 série + colors[] = distributed.
  // Cada categoria pinta na sua própria cor (sem isso, todas as bars saem
  // na MESMA cor — primeira do array). Vertical mantém comportamento padrão.
  const distributed = horizontal && series.length === 1 && finalColors.length === categories.length;

  const options = useMemo<ApexOptions>(() => {
    const base = baseApexOptions();
    const yaxisForHorizontal = horizontal
      ? {
          ...base.yaxis,
          labels: {
            ...(base.yaxis as any)?.labels,
            align: 'left' as const,
            minWidth: 130,
            maxWidth: 170,
            offsetX: 0,
            formatter: (v: any) => String(v ?? ''),
            style: { ...(base.yaxis as any)?.labels?.style, fontSize: '11.5px', fontWeight: 600 },
          },
        }
      : base.yaxis;
    return {
      ...base,
      chart: { ...base.chart, type: 'bar', stacked },
      colors: finalColors.length ? finalColors : undefined,
      plotOptions: {
        bar: {
          horizontal,
          borderRadius,
          borderRadiusApplication: 'end',
          columnWidth: '60%',
          barHeight: horizontal ? '62%' : undefined,
          distributed,
        },
      },
      stroke: { show: false, width: 0 },
      xaxis: { ...base.xaxis, categories },
      yaxis: yaxisForHorizontal,
      legend: { ...base.legend, show: showLegend && series.length > 1 && !distributed },
      dataLabels: horizontal
        ? {
            enabled: true,
            textAnchor: 'start',
            offsetX: 6,
            style: { fontSize: '11px', fontWeight: 700, colors: ['#0a0a0a'] },
            background: { enabled: false },
            // Esconde rótulo de segmento vazio (ex: stacked com 0 transferidos)
            // — senão um "0" flutua na origem de cada barra.
            formatter: (val: any) => { const n = Number(val); return n ? formatCompact(n) : ''; },
          }
        : { enabled: false },
      tooltip: {
        ...base.tooltip,
        y: { formatter: (v) => `${formatCompact(v)}` },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(categories), JSON.stringify(finalColors), stacked, horizontal, showLegend, borderRadius, themeKey, distributed]);

  const seriesData = series.map((s) => ({ name: s.name, data: s.data }));

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={seriesData}
        type="bar"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LineChart — múltiplas séries lineares (sem fill).
// ──────────────────────────────────────────────────────────────────────────
export function LineChart({
  categories,
  series,
  colors,
  height = 240,
  smooth = true,
  showLegend = true,
  showMarkers = false,
  formatLegend,
}: {
  categories: (string | number)[];
  series: MultiSeries[];
  colors?: string[];
  height?: number;
  smooth?: boolean;
  showLegend?: boolean;
  showMarkers?: boolean;
  formatLegend?: (name: string) => string;
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const finalColors = colors ?? series.map((s) => s.color).filter(Boolean) as string[];

  const options = useMemo<ApexOptions>(() => {
    const base = baseApexOptions();
    return {
      ...base,
      chart: { ...base.chart, type: 'line' },
      colors: finalColors.length ? finalColors : undefined,
      stroke: { ...base.stroke, curve: smooth ? 'smooth' : 'straight', width: 2 },
      markers: {
        size: showMarkers ? 4 : 0,
        strokeWidth: 0,
        hover: { size: 6 },
      },
      xaxis: { ...base.xaxis, categories },
      legend: {
        ...base.legend,
        show: showLegend,
        formatter: formatLegend,
      },
      tooltip: {
        ...base.tooltip,
        y: { formatter: (v) => `${formatCompact(v)}` },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(categories), JSON.stringify(finalColors), smooth, showLegend, showMarkers, themeKey, formatLegend]);

  const seriesData = series.map((s) => ({ name: s.name, data: s.data }));

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={seriesData}
        type="line"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ComposedChart — mix de bars + line (eixo único). Para 12m view com volume
// (bars empilhadas) + total (linha). Atende ao caso "atendentes/automação"
// + linha total.
// ──────────────────────────────────────────────────────────────────────────
export function ComposedChart({
  categories,
  series,
  colors,
  height = 280,
  showLegend = true,
}: {
  categories: (string | number)[];
  series: MultiSeries[];
  colors?: string[];
  height?: number;
  showLegend?: boolean;
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const finalColors = colors ?? series.map((s) => s.color).filter(Boolean) as string[];

  const options = useMemo<ApexOptions>(() => {
    const base = baseApexOptions();
    return {
      ...base,
      chart: { ...base.chart, type: 'line', stacked: false },
      colors: finalColors.length ? finalColors : undefined,
      plotOptions: {
        bar: {
          borderRadius: 4,
          borderRadiusApplication: 'end',
          columnWidth: '55%',
        },
      },
      stroke: {
        ...base.stroke,
        curve: 'smooth',
        width: series.map((s) => (s.type === 'line' ? 2.5 : 0)),
      },
      fill: {
        type: series.map((s) => (s.type === 'line' ? 'solid' : 'solid')),
        opacity: series.map((s) => (s.type === 'line' ? 1 : 1)),
      },
      markers: {
        size: 0,
        hover: { size: 5 },
      },
      xaxis: { ...base.xaxis, categories },
      legend: { ...base.legend, show: showLegend },
      tooltip: {
        ...base.tooltip,
        shared: true,
        intersect: false,
        y: { formatter: (v) => `${formatCompact(v)}` },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(categories), JSON.stringify(finalColors), JSON.stringify(series.map(s => s.type)), showLegend, themeKey]);

  const seriesData = series.map((s) => ({
    name: s.name,
    type: s.type ?? 'bar',
    data: s.data,
  }));

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={seriesData}
        type="line"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DonutChart — distribuição categórica. Hole no centro pra valor total.
// ──────────────────────────────────────────────────────────────────────────
export function DonutChart({
  labels,
  series,
  colors,
  height = 220,
  centerLabel,
  centerValue,
  showLegend = false,
}: {
  labels: string[];
  series: number[];
  colors?: string[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
  showLegend?: boolean;
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const dark = isDarkMode();

  const options = useMemo<ApexOptions>(() => {
    const base = baseApexOptions();
    return {
      ...base,
      chart: { ...base.chart, type: 'donut' },
      labels,
      colors: colors,
      stroke: { width: 2, colors: [dark ? '#0f0f12' : '#ffffff'] },
      legend: { ...base.legend, show: showLegend },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: '10px',
                fontFamily: 'inherit',
                fontWeight: 600,
                color: dark ? '#9ca3af' : '#6b7280',
                offsetY: 18,
              },
              value: {
                show: true,
                fontSize: '28px',
                fontFamily: 'Inter Tight, Inter, sans-serif',
                fontWeight: 700,
                color: dark ? '#e5e7eb' : '#0a0a0a',
                offsetY: -10,
                formatter: (v) => formatCompact(Number(v)),
              },
              total: {
                show: true,
                showAlways: !!centerValue,
                label: centerLabel ?? 'Total',
                fontSize: '10px',
                fontFamily: 'inherit',
                fontWeight: 600,
                color: dark ? '#9ca3af' : '#6b7280',
                formatter: () => centerValue ?? formatCompact(series.reduce((a, b) => a + b, 0)),
              },
            },
          },
        },
      },
      dataLabels: { enabled: false },
      tooltip: {
        ...base.tooltip,
        y: { formatter: (v) => `${formatCompact(v)}` },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(series), JSON.stringify(colors), centerLabel, centerValue, showLegend, themeKey]);

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={series}
        type="donut"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// RadialGauge — score 0-100 em arco preenchido com gradient. Pra CSAT,
// NPS, % de meta atingida. Centro mostra valor formatado + label.
// ──────────────────────────────────────────────────────────────────────────
export function RadialGauge({
  value,
  maxValue = 100,
  height = 240,
  centerValue,
  centerLabel,
  color = '#FAC209',
  gradientTo,
  trackOpacity = 0.12,
}: {
  value: number;
  maxValue?: number;
  height?: number;
  centerValue?: string;
  centerLabel?: string;
  color?: string;
  gradientTo?: string;
  trackOpacity?: number;
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const dark = isDarkMode();
  const pct = Math.max(0, Math.min(100, (value / maxValue) * 100));

  const options = useMemo<ApexOptions>(() => ({
    chart: {
      type: 'radialBar',
      sparkline: { enabled: false },
      fontFamily: 'Inter, system-ui, sans-serif',
      animations: {
        enabled: true,
        speed: 1100,
        animateGradually: { enabled: true, delay: 100 },
      },
      background: 'transparent',
    },
    colors: [color],
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        hollow: { size: '64%' },
        track: {
          background: dark ? `rgba(255,255,255,${trackOpacity})` : `rgba(0,0,0,${trackOpacity * 0.5})`,
          strokeWidth: '100%',
          margin: 0,
        },
        dataLabels: {
          show: true,
          name: {
            show: !!centerLabel,
            fontSize: '10px',
            fontFamily: 'inherit',
            fontWeight: 700,
            color: dark ? '#9ca3af' : '#6b7280',
            offsetY: 28,
            formatter: () => (centerLabel || '').toUpperCase(),
          },
          value: {
            show: true,
            fontSize: '40px',
            fontFamily: 'Inter Tight, Inter, sans-serif',
            fontWeight: 700,
            color: dark ? '#e5e7eb' : '#0a0a0a',
            offsetY: -8,
            formatter: () => centerValue ?? `${Math.round(pct)}%`,
          },
        },
      },
    },
    fill: gradientTo ? {
      type: 'gradient',
      gradient: {
        shade: 'dark',
        type: 'horizontal',
        shadeIntensity: 0.4,
        gradientToColors: [gradientTo],
        opacityFrom: 1,
        opacityTo: 1,
        stops: [0, 100],
      },
    } : { type: 'solid' },
    stroke: { lineCap: 'round', width: 2 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [color, gradientTo, centerLabel, centerValue, dark, trackOpacity, pct, themeKey]);

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={[pct]}
        type="radialBar"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LollipopChart — ranking horizontal estilo "pirulito": haste fina + bolinha
// no topo do valor. Cada categoria pinta na sua própria cor (distributed).
// Renderiza valor à direita do ponto. Top-down: passe `categories` em ordem
// crescente — Apex inverte o eixo Y (primeira fica em baixo). #1 no topo.
// ──────────────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

export function LollipopChart({
  categories,
  values,
  colors,
  tooltipTitles,
  height = 360,
  yLabelFont = 'mono',
}: {
  categories: string[];
  values: number[];
  colors: string[];
  tooltipTitles?: string[];
  height?: number;
  yLabelFont?: 'mono' | 'sans';
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';
  const dark = isDarkMode();

  const options = useMemo<ApexOptions>(() => {
    const base = baseApexOptions();
    const textColor   = dark ? '#e5e7eb' : '#0a0a0a';
    const mutedColor  = dark ? '#9ca3af' : '#6b7280';
    const surfaceRing = dark ? '#0f0f12' : '#ffffff';

    return {
      ...base,
      chart: { ...base.chart, type: 'bar' },
      colors,
      plotOptions: {
        bar: {
          horizontal: true,
          distributed: true,
          barHeight: '12%',
          borderRadius: 99,
          borderRadiusApplication: 'around',
        },
      },
      stroke: { show: false, width: 0 },
      grid: {
        ...base.grid,
        strokeDashArray: 4,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } },
        padding: { top: 4, right: 36, bottom: 4, left: 0 },
      },
      xaxis: {
        ...base.xaxis,
        categories,
        labels: {
          ...base.xaxis?.labels,
          style: { ...(base.xaxis as any)?.labels?.style, fontSize: '10px' },
          formatter: (v: any) => formatCompact(Number(v)),
        },
      },
      yaxis: {
        ...base.yaxis,
        labels: {
          align: 'right',
          minWidth: 44,
          maxWidth: 64,
          offsetX: -2,
          style: {
            colors: mutedColor,
            fontSize: '12px',
            fontFamily: yLabelFont === 'mono'
              ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
              : 'inherit',
            fontWeight: 700,
          },
        },
      },
      legend: { show: false },
      dataLabels: {
        enabled: true,
        textAnchor: 'start',
        offsetX: 16,
        offsetY: 1,
        style: {
          fontSize: '12px',
          fontFamily: 'Inter Tight, Inter, sans-serif',
          fontWeight: 700,
          colors: [textColor],
        },
        background: { enabled: false },
        formatter: (val: any) => formatCompact(Number(val)),
      },
      annotations: {
        // Em horizontal bar com Y categorical, `y` aceita o nome da categoria
        // (string). A tipagem upstream tipa só `number` → cast pontual.
        points: categories.map((cat, i) => ({
          x: values[i],
          y: cat,
          marker: {
            size: 7,
            fillColor: colors[i],
            strokeColor: surfaceRing,
            strokeWidth: 2,
            shape: 'circle',
            radius: 99,
          },
        })) as any,
      },
      tooltip: {
        ...base.tooltip,
        custom: ({ dataPointIndex }: any) => {
          const cat = categories[dataPointIndex];
          const val = values[dataPointIndex];
          const title = tooltipTitles?.[dataPointIndex] ?? cat;
          const color = colors[dataPointIndex];
          return [
            `<div style="padding:10px 12px;min-width:160px">`,
            `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`,
            `<span style="width:8px;height:8px;border-radius:99px;background:${color};display:inline-block"></span>`,
            `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;font-size:11px;color:#fff">${escapeHtml(cat)}</span>`,
            `</div>`,
            `<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px">${escapeHtml(title)}</div>`,
            `<div style="font-size:15px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums">${val} acionamentos</div>`,
            `</div>`,
          ].join('');
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(categories), JSON.stringify(values), JSON.stringify(colors), JSON.stringify(tooltipTitles), themeKey, yLabelFont]);

  const seriesData = [{ name: 'Acionamentos', data: values }];

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={seriesData}
        type="bar"
        height={height}
        width="100%"
      />
    </Suspense>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// SparkLine — micro-chart pra KPI cards. Sem axes, sem grid, só a curva.
// ──────────────────────────────────────────────────────────────────────────
export function SparkLine({
  data,
  color = '#FAC209',
  height = 40,
  type = 'area',
}: {
  data: number[];
  color?: string;
  height?: number;
  type?: 'area' | 'line';
}) {
  const themeKey = isDarkMode() ? 'dark' : 'light';

  const options = useMemo<ApexOptions>(() => ({
    chart: {
      type,
      sparkline: { enabled: true },
      animations: { enabled: true, speed: 600 },
      fontFamily: 'Inter, system-ui, sans-serif',
    },
    colors: [color],
    stroke: { curve: 'smooth', width: 2 },
    fill: type === 'area' ? gradientFill([color]) : { type: 'solid', opacity: 1 },
    markers: { size: 0 },
    tooltip: { enabled: false },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [color, type, themeKey]);

  return (
    <Suspense fallback={<ChartFallback height={height} />}>
      <ApexChartReact
        key={themeKey}
        options={options}
        series={[{ name: '', data }]}
        type={type}
        height={height}
        width="100%"
      />
    </Suspense>
  );
}
