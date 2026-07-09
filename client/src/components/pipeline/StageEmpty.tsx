import { useMemo } from "react";
import { Inbox, Users, Clock, ArrowRightLeft, CheckCircle2, type LucideIcon } from "lucide-react";

type EmptyMood = "idle" | "triaging" | "waiting" | "handoff" | "done";

interface StageEmptyProps {
  stageKey: string;
  stageLabel?: string;
  isDropTarget?: boolean;
}

function detectMood(stageKey: string, stageLabel?: string): EmptyMood {
  const k = (stageKey + " " + (stageLabel || "")).toLowerCase();
  if (/(resolvido|finalizado|fechado|ativado|conclu[ií]do)/.test(k)) return "done";
  if (/(humano|escalado|atendente)/.test(k)) return "handoff";
  if (/(aguardando|pendente|espera|agendad)/.test(k)) return "waiting";
  if (/(triagem|qualifica|coleta|verifica)/.test(k)) return "triaging";
  return "idle";
}

// Bruno 2026-05-21: removidos os tints individuais por mood (amarelo/âmbar/
// indigo/verde) — todos os empties usam --primary com baixa opacidade pra
// não brigar com o tema escolhido. Mood ainda controla copy e pose do mascote.
const MOOD_COPY: Record<EmptyMood, { line: string; sub: string; icon: LucideIcon }> = {
  idle:     { line: "Esteira parada", sub: "Nenhum cliente entrando agora", icon: Inbox },
  triaging: { line: "Sem ninguém em triagem", sub: "Nada em qualificação agora", icon: Users },
  waiting:  { line: "Sem espera", sub: "Todo mundo recebeu retorno", icon: Clock },
  handoff:  { line: "Nenhum atendimento humano", sub: "O assistente está dando conta", icon: ArrowRightLeft },
  done:     { line: "Nada finalizado ainda", sub: "Primeiros da fila aparecem aqui", icon: CheckCircle2 },
};

export function StageEmpty({ stageKey, stageLabel, isDropTarget }: StageEmptyProps) {
  const mood = useMemo(() => detectMood(stageKey, stageLabel), [stageKey, stageLabel]);
  const copy = MOOD_COPY[mood];

  if (isDropTarget) {
    return (
      <div
        className="flex flex-col items-center justify-center h-28 gap-2 text-[11.5px] font-semibold"
        style={{ color: "hsl(var(--primary))" }}
      >
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-2 h-2 rounded-full"
              style={{
                background: "hsl(var(--primary))",
                animation: `kanban-drop-pulse 0.75s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
        <span>Solte aqui</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2 px-3 text-center select-none">
      <div
        className="flex items-center justify-center rounded-full w-12 h-12"
        style={{ background: "hsl(var(--primary) / 0.10)" }}
      >
        {(() => { const Icon = copy.icon; return <Icon className="w-5 h-5" style={{ color: "hsl(var(--primary))" }} />; })()}
      </div>
      <div className="text-[12px] font-semibold text-foreground/75 leading-tight">{copy.line}</div>
      <div className="text-[10.5px] text-muted-foreground/70 leading-tight">{copy.sub}</div>
    </div>
  );
}
