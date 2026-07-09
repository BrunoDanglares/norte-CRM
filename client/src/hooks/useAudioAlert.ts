import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "chatbanana_audio_alert_enabled";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(v: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {}
}

// Toca um beep curto (dois tons) via Web Audio API. Sem asset MP3 — evita
// bundlear binário e funciona offline. AudioContext é lazy (criado no 1º play)
// porque navegadores exigem gesto do usuário antes de instanciar áudio.
export function useAudioAlert() {
  const [enabled, setEnabled] = useState<boolean>(() => readEnabled());
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    writeEnabled(enabled);
  }, [enabled]);

  const ensureContext = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
      return ctxRef.current;
    } catch {
      return null;
    }
  }, []);

  const play = useCallback(() => {
    if (!enabled) return;
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // Dois tons curtos (E5 + G5) com fade — chime simpático sem ser invasivo.
    const beep = (freq: number, t: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    };
    beep(660, now);
    beep(880, now + 0.12);
  }, [enabled, ensureContext]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      // Quando ativa, toca um beep curto pra "testar" e destravar o AudioContext
      // (o gesto do click satisfaz a policy do navegador).
      if (next) {
        const ctx = ensureContext();
        if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
        setTimeout(() => {
          const now = ctx?.currentTime ?? 0;
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.2);
        }, 0);
      }
      return next;
    });
  }, [ensureContext]);

  return { enabled, toggle, play };
}
