import { useCallback, useEffect, useRef, useState } from "react";

// Highlight pulsante de curta duração para campos do painel de ações
// (PIPELINE, PRIORIDADE, TAG/SITUAÇÃO etc.) quando o agente automatizado
// muda algo via WebSocket. Feedback visual sutil (Q2=c) — não é toast,
// é uma animação que volta ao normal sozinha após DURATION_MS.
//
// Uso:
//   const { isHighlighted, highlight } = useFieldHighlight();
//   highlight('pipeline');     // marca o campo
//   isHighlighted('pipeline')  // true por 2s, depois false

const DURATION_MS = 2000;

export function useFieldHighlight() {
  const [tick, setTick] = useState(0);
  const expirations = useRef<Map<string, number>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const highlight = useCallback((field: string) => {
    const existing = timers.current.get(field);
    if (existing) clearTimeout(existing);
    expirations.current.set(field, Date.now() + DURATION_MS);
    setTick((t) => t + 1);
    const t = setTimeout(() => {
      expirations.current.delete(field);
      timers.current.delete(field);
      setTick((tt) => tt + 1);
    }, DURATION_MS);
    timers.current.set(field, t);
  }, []);

  const isHighlighted = useCallback(
    (field: string) => {
      const exp = expirations.current.get(field);
      return !!exp && exp > Date.now();
    },
    [tick],
  );

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
      expirations.current.clear();
    };
  }, []);

  return { highlight, isHighlighted };
}
