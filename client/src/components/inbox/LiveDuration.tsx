import { useEffect, useState } from "react";

// Bruno 2026-05-17: cronômetro de verdade no header do chat (HH:MM:SS
// contando segundo a segundo). Antes mostrava tempo relativo ("agora",
// "5min") via formatTempo — pouco útil pra atendente ver duração precisa.
// < 1h:   MM:SS
// < 24h:  HH:MM:SS
// >= 24h: Xd HH:MM:SS
function formatStopwatch(diffMs: number): string {
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hour = Math.floor(totalSec / 3600) % 24;
  const day = Math.floor(totalSec / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (day > 0) return `${day}d ${pad(hour)}:${pad(min)}:${pad(sec)}`;
  if (hour > 0) return `${pad(hour)}:${pad(min)}:${pad(sec)}`;
  return `${pad(min)}:${pad(sec)}`;
}

// LiveDuration — cronômetro vivo com tick de 1s. Quando `end` é passado,
// congela em (end - start) e para o interval. Mostra HH:MM:SS no header.
//
// Bruno 2026-05-17 fix: versão anterior dependia de [start, end] no useEffect
// — toda mudança de referência (refetch React Query a cada 15s retorna novo
// objeto props com mesmo valor) reiniciava o interval, e mesmo o reinicio
// rápido às vezes "sumia" o tick. Esta versão:
//   - Dep só [end] (não [start]) → interval persiste através de refetches
//   - Usa tick counter em vez de salvar `now` (re-render mais previsível)
//   - Date.now() chamado INLINE no render → sempre fresco
export function LiveDuration({
  start,
  end,
  className,
}: {
  start?: string | Date | null;
  end?: string | Date | null;
  className?: string;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    // Não há cronômetro pra rodar se já congelou
    if (end) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000);
    return () => clearInterval(id);
  }, [end]);

  if (!start) return null;
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) return null;
  const ref = end ? new Date(end).getTime() : Date.now();
  return <span className={className}>{formatStopwatch(ref - startMs)}</span>;
}
