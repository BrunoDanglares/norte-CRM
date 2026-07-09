import { useMemo } from "react";

interface StageColumnHeaderProps {
  stageKey: string;
  label: string;
  /** Mantido na interface por compat com callers existentes — IGNORADO
   *  internamente desde 2026-05-21: todas as colunas usam --primary do tema. */
  color: string;
  count: number;
  gradientIndex: number;
  totalStages: number;
  isFinal?: boolean;
}

// Detecta ícone semântico pela natureza da stage. Tenant pode ter labels
// arbitrários, mas a maioria cai num desses temas.
function stageIcon(stageKey: string, label: string, isFinal: boolean): string {
  const k = (stageKey + " " + (label || "")).toLowerCase();
  if (isFinal && /(resolvido|finalizado|conclu)/.test(k)) return "✅";
  if (/(perdid|cancelad|desistiu)/.test(k)) return "✖️";
  if (/(humano|atendente|escalad)/.test(k)) return "👤";
  if (/(aguardando|espera|pendente)/.test(k)) return "⏳";
  if (/(triagem|qualifica|verifica)/.test(k)) return "🛠️";
  if (/(coleta|cadastro)/.test(k)) return "📋";
  if (/(agendad|visita|instala)/.test(k)) return "📅";
  if (/(bot|automaca|novo)/.test(k)) return "🤖";
  return "🍌";
}

export function StageColumnHeader({
  stageKey,
  label,
  count,
  gradientIndex,
  totalStages,
  isFinal,
}: StageColumnHeaderProps) {
  const icon = useMemo(() => stageIcon(stageKey, label, !!isFinal), [stageKey, label, isFinal]);

  // Bruno 2026-05-21: TODAS as colunas usam --primary do tema (banana/lilac/
  // blue/orange). Antes cada stage tinha sua cor própria (verde finalizado,
  // amarelo gradient flow, azul humano, etc.) — virou arco-íris e brigava
  // com o tema escolhido. Variação visual por coluna fica só na opacidade do
  // strip superior (mais sólido nas primeiras → mais translúcido nas últimas),
  // pra preservar a sensação de "fluxo".
  const stripEndOpacity = useMemo(() => {
    if (isFinal) return 1; // final sempre fechado/sólido
    if (totalStages <= 1) return 1;
    const ratio = gradientIndex / (totalStages - 1);
    return Math.max(0.35, 1 - ratio * 0.55);
  }, [gradientIndex, totalStages, isFinal]);

  return (
    <div className="relative px-3.5 pt-3 pb-2.5 border-b border-border/50 flex-shrink-0 overflow-hidden">
      {/* Strip superior 3px — primary sólido → primary translúcido. */}
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background: `linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary) / ${stripEndOpacity.toFixed(2)}) 100%)`,
          boxShadow: "0 0 6px hsl(var(--primary) / 0.20)",
        }}
      />
      {/* Glow radial sutil — primary muito faint. */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at top, hsl(var(--primary)), transparent 70%)" }}
      />

      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[15px] leading-none" aria-hidden>{icon}</span>
          <span
            // Bruno 2026-06-11: letreiro NEUTRO (não segue mais o dourado do tema).
            // --foreground = preto #1A1A1A em todas as paletas no modo claro e
            // branco no dark — "preto por padrão" sem sumir no fundo escuro.
            className="font-bold text-[12px] uppercase tracking-wide truncate"
            style={{ color: "hsl(var(--foreground))" }}
            data-testid={`stage-label-${stageKey}`}
          >
            {label}
          </span>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums leading-none"
          style={{
            backgroundColor: "hsl(var(--primary) / 0.12)",
            color: "hsl(var(--primary))",
            border: "1px solid hsl(var(--primary) / 0.30)",
          }}
          data-testid={`count-stage-${stageKey}`}
        >
          {count}
        </span>
      </div>
    </div>
  );
}
