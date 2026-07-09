// Alertas sonoros — Web Audio API, sem arquivos externos.
// (Bruno 2026-05-19, página /atendimentos)
//
// Dois sons:
//   - newConversation: ding-dong alegre (880 → 660 Hz) — chegou cliente novo
//   - queueHandoff:    sino mais grave (523 + 659 Hz, longer decay) — bot
//                      passou conv pra fila humana (precisa de atenção)
//
// Toggle persistido em localStorage. AudioContext criado LAZY no primeiro
// `play()` — autoplay policy do browser exige gesto do usuário antes de
// emitir áudio; ligar o toggle conta como gesto.

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "chatbanana_sound_alerts";

type AlertKind = "newConversation" | "queueHandoff";

let sharedCtx: AudioContext | null = null;
function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
  try {
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

// Gera um beep com envelope ataque/decay curtos pra evitar clicks.
function beep(ctx: AudioContext, freq: number, durationMs: number, gainPeak = 0.18, delayMs = 0) {
  const now = ctx.currentTime + delayMs / 1000;
  const dur = durationMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);
  // Ataque rápido (10ms) → sustain → decay exponencial
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function playNewConversation(ctx: AudioContext) {
  // Ding-dong subindo→descendo: 880Hz → 660Hz com pequena sobreposição
  beep(ctx, 880, 120, 0.16, 0);
  beep(ctx, 660, 200, 0.18, 120);
}

function playQueueHandoff(ctx: AudioContext) {
  // Sino-aviso: tom médio + harmônica curta (mais "sério", duração maior)
  beep(ctx, 523, 220, 0.14, 0);    // C5
  beep(ctx, 659, 320, 0.16, 80);   // E5 sobreposto
  beep(ctx, 523, 260, 0.10, 280);  // C5 eco
}

export function useSoundAlerts() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "1";
  });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Persiste no localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    // Quando o usuário LIGA, dispara um beep curto de confirmação —
    // serve também pra "destravar" o AudioContext sob autoplay policy.
    if (value) {
      const ctx = getOrCreateAudioContext();
      if (ctx) {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        try { beep(ctx, 880, 80, 0.12, 0); } catch {}
      }
    }
  }, []);

  const play = useCallback((kind: AlertKind) => {
    if (!enabledRef.current) return;
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (kind === "newConversation") playNewConversation(ctx);
      else if (kind === "queueHandoff") playQueueHandoff(ctx);
    } catch {
      // Falha silenciosa — alerta sonoro é nice-to-have, nunca quebra UI
    }
  }, []);

  return { enabled, setEnabled, play };
}
