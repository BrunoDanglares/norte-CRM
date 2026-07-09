import { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, Mic } from "lucide-react";

// Bruno 2026-05-19: redesign no estilo WhatsApp.
// Layout: [ ▶/⏸ ]  waveform-com-bola  ( avatar )
//                  0:19 / 10:38         🎤
// Avatar + microfone só aparecem em mensagens recebidas (incoming).
// Mensagens enviadas (outgoing) ficam sem avatar — mesma vibe do app oficial.

// Bruno 2026-05-22: single-instance playback. Listener global na fase de
// captura pausa qualquer outro <audio> quando um novo dá play — mesmo padrão
// do WhatsApp/SoundCloud. Listener vive no module-scope, montado UMA VEZ no
// primeiro mount de qualquer MiniAudioPlayer. Não duplica entre instâncias.
let __singletonAudioListenerInstalled = false;
function ensureSingletonAudioListener() {
  if (__singletonAudioListenerInstalled || typeof document === "undefined") return;
  __singletonAudioListenerInstalled = true;
  document.addEventListener(
    "play",
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLAudioElement)) return;
      // Pausa TODOS os outros áudios ativos (de qualquer player) menos o que
      // acabou de iniciar. Filtra HTMLAudioElement pra não tocar em <video>.
      document.querySelectorAll("audio").forEach((a) => {
        if (a !== target && !a.paused) a.pause();
      });
    },
    true, // capture: garante que rodamos ANTES de outros listeners
  );
}

interface MiniAudioPlayerProps {
  src: string;
  msgId: number | string;
  isOut: boolean;
  contactAvatarUrl?: string | null;
  contactName?: string;
}

export default function MiniAudioPlayer({
  src,
  msgId,
  isOut,
  contactAvatarUrl,
  contactName,
}: MiniAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Bruno 2026-06-01: a bola/preenchimento são dirigidos IMPERATIVAMENTE via
  // CSS var `--p` no rAF (não por React state) — o caminho de render do React
  // (setState 60×/s + reconciliação das 38 barras) atrasava a bola atrás do
  // áudio. Setando `--p` direto no DOM a cada frame, a bola acompanha o
  // audio.currentTime fielmente a 60fps, sem latência de render nem easing.
  const lastSecRef = useRef<number>(-1);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveW, setWaveW] = useState(0); // largura px da waveform (p/ alinhar overlay ativo)
  const [hovered, setHovered] = useState(false);
  // Bruno 2026-05-20: velocidade 1x → 1.5x → 2x (cicla no clique), mesmo
  // padrão do WhatsApp. Persiste no localStorage pra manter preferência entre
  // mensagens — atendente que escuta tudo em 1.5x não precisa setar toda vez.
  const SPEEDS = [1, 1.5, 2] as const;
  const [speedIdx, setSpeedIdx] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const saved = parseFloat(localStorage.getItem("flowcrm_audio_speed") || "1");
    const idx = SPEEDS.findIndex((s) => s === saved);
    return idx >= 0 ? idx : 0;
  });
  const speed = SPEEDS[speedIdx];

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = speed;
  }, [speed]);

  // Bruno 2026-05-22: garante que o listener global de single-instance está
  // montado. Chamada idempotente — só age na 1ª instância de qualquer player.
  useEffect(() => {
    ensureSingletonAudioListener();
  }, []);

  // Aplica progresso (0..1) DIRETO no DOM via CSS var `--p`. A bola (left) e o
  // preenchimento ativo (width) leem `var(--p)` — não passam pelo React, então
  // não há latência de render. Não setamos `--p` no JSX (senão o React
  // sobrescreveria a cada render); só aqui, imperativo.
  const applyProgress = (p: number) => {
    const clamped = Math.max(0, Math.min(1, isFinite(p) ? p : 0));
    waveRef.current?.style.setProperty("--p", `${clamped * 100}%`);
  };

  // Mede a largura da waveform (p/ a camada ativa ter as barras alinhadas com
  // a base mesmo dentro do clip). ResizeObserver cobre resize/zoom da janela.
  useEffect(() => {
    const el = waveRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWaveW(el.clientWidth));
    ro.observe(el);
    setWaveW(el.clientWidth);
    applyProgress(0); // estado inicial
    return () => ro.disconnect();
  }, []);

  const cycleSpeed = () => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      try { localStorage.setItem("flowcrm_audio_speed", String(SPEEDS[next])); } catch {}
      return next;
    });
  };

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    // Estado `playing` agora vem dos eventos play/pause (gerencia o rAF loop),
    // então só chama os métodos do <audio> aqui — listeners atualizam o state.
    if (a.paused) {
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  };

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // Loop de rAF lê audio.currentTime a 60fps enquanto tocando e aplica o
    // progresso DIRETO no DOM (applyProgress) — a bola acompanha sem lag. O
    // tempo exibido (texto) é atualizado por React só quando muda o SEGUNDO
    // inteiro (lastSecRef), evitando 60 re-renders/s desnecessários.
    const tick = () => {
      const el = audioRef.current;
      if (!el) return;
      const dur = el.duration && isFinite(el.duration) ? el.duration : 0;
      applyProgress(dur > 0 ? el.currentTime / dur : 0);
      const sec = Math.floor(el.currentTime);
      if (sec !== lastSecRef.current) {
        lastSecRef.current = sec;
        setCurrentTime(el.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    const startRaf = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(tick);
    };
    const stopRaf = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onPlay = () => {
      setPlaying(true);
      startRaf();
    };
    const onPause = () => {
      setPlaying(false);
      stopRaf();
      // Sincroniza a posição exata ao pausar (último frame pode ter ficado pra trás).
      const dur = a.duration && isFinite(a.duration) ? a.duration : 0;
      applyProgress(dur > 0 ? a.currentTime / dur : 0);
      setCurrentTime(a.currentTime);
    };
    const onMeta = () => {
      if (a.duration && isFinite(a.duration)) setDuration(a.duration);
    };
    const onDuration = () => {
      if (a.duration && isFinite(a.duration)) setDuration(a.duration);
    };
    const onEnd = () => {
      stopRaf();
      setPlaying(false);
      applyProgress(0);
      lastSecRef.current = -1;
      setCurrentTime(0);
    };
    const onSeeked = () => {
      const dur = a.duration && isFinite(a.duration) ? a.duration : 0;
      applyProgress(dur > 0 ? a.currentTime / dur : 0);
      setCurrentTime(a.currentTime);
    };
    const onError = () => {
      stopRaf();
      setPlaying(false);
    };
    // Fallback: timeupdate atualiza posição caso o rAF esteja pausado pelo
    // browser (aba em background, onde rAF não roda).
    const onTime = () => {
      if (rafRef.current == null) {
        const dur = a.duration && isFinite(a.duration) ? a.duration : 0;
        applyProgress(dur > 0 ? a.currentTime / dur : 0);
        setCurrentTime(a.currentTime);
      }
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("playing", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("seeked", onSeeked);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onDuration);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onError);
    return () => {
      stopRaf();
      a.removeEventListener("play", onPlay);
      a.removeEventListener("playing", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("seeked", onSeeked);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onDuration);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onError);
    };
  }, [src]);

  // Waveform "estável" por msgId — usa seed determinístico baseado em msgId
  // pra cada mensagem ter um padrão único mas consistente entre re-renders.
  const bars = useMemo(() => {
    const count = 38;
    const seed = String(msgId).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const arr: number[] = [];
    for (let i = 0; i < count; i++) {
      // pseudo-random determinístico
      const x = Math.sin(seed * 9301 + i * 49297) * 233280;
      const r = x - Math.floor(x);
      arr.push(0.28 + r * 0.72);
    }
    return arr;
  }, [msgId]);

  const onWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
    applyProgress(pct); // bola pula instantâneo no clique (não espera o evento)
    setCurrentTime(a.currentTime);
  };

  // Cores estilo WhatsApp.
  // Outgoing bubble (amarela do nosso CRM): tons escuros pra contraste.
  // Incoming bubble (branca/clara): azul caracter�stico do WhatsApp.
  const activeColor = isOut ? "rgba(0,0,0,0.62)" : "#4CB8F0";
  const inactiveColor = isOut ? "rgba(0,0,0,0.22)" : "rgba(76,184,240,0.30)";
  const playBg = isOut ? "rgba(0,0,0,0.06)" : "rgba(76,184,240,0.10)";
  const playIconColor = isOut ? "rgba(0,0,0,0.78)" : "#1DA1F2";
  const timeColor = isOut ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.45)";
  const initials = (contactName || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  const showAvatar = !isOut;
  const timeText = playing || currentTime > 0 ? fmt(currentTime) : fmt(duration);

  // Renderiza as barras da waveform (reusado nas camadas base e ativa).
  const renderBars = (color: string) =>
    bars.map((h, i) => (
      <div
        key={i}
        className="flex-1 rounded-full"
        style={{
          height: `${Math.max(18, h * 100)}%`,
          minWidth: 2,
          background: color,
        }}
      />
    ));

  return (
    <div
      className="msg-audio-player flex items-center gap-2.5 select-none"
      data-testid={`msg-audio-${msgId}`}
      style={{ minWidth: 230 }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play / Pause */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        className="flex-shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center transition-transform active:scale-95 hover:scale-[1.03]"
        style={{ background: playBg }}
      >
        {playing ? (
          <Pause className="w-4 h-4" style={{ color: playIconColor }} fill={playIconColor} />
        ) : (
          <Play className="w-4 h-4 ml-[1px]" style={{ color: playIconColor }} fill={playIconColor} />
        )}
      </button>

      {/* Waveform + tempo */}
      <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
        <div
          ref={waveRef}
          className="relative h-[22px] cursor-pointer flex items-center"
          onClick={onWaveClick}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Camada BASE (inativa) — todas as barras */}
          <div className="flex items-center gap-[2px] w-full h-full">
            {renderBars(inactiveColor)}
          </div>
          {/* Camada ATIVA (preenchida) — clipada por width:var(--p), imperativo */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none"
            style={{ width: "var(--p, 0%)" }}
          >
            <div
              className="flex items-center gap-[2px] h-full"
              style={{ width: waveW ? `${waveW}px` : "100%" }}
            >
              {renderBars(activeColor)}
            </div>
          </div>
          {/* Bola de progresso (estilo WA) — left lê var(--p), acompanha 60fps */}
          <div
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: "calc(var(--p, 0%) - 6px)",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: activeColor,
              boxShadow: hovered ? `0 0 0 4px ${isOut ? "rgba(0,0,0,0.08)" : "rgba(76,184,240,0.18)"}` : "none",
              transition: "box-shadow 120ms",
            }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] leading-none" style={{ color: timeColor }}>
          <span>{timeText}</span>
          {duration > 0 && currentTime > 0 && playing && (
            <span>/ {fmt(duration)}</span>
          )}
          {/* Bruno 2026-05-21: botão sempre visível (antes só aparecia após
              play, atendente não percebia que existia). Mesmo em 1x mantém
              fundo/borda sutil pra deixar claro que é interativo. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cycleSpeed(); }}
            className="ml-auto inline-flex items-center justify-center px-1.5 h-[18px] rounded-md font-bold transition-colors tabular-nums hover:brightness-95 active:scale-95"
            style={{
              fontSize: "10.5px",
              background: isOut ? "rgba(0,0,0,0.08)" : "rgba(76,184,240,0.12)",
              color: isOut ? "rgba(0,0,0,0.78)" : "#1DA1F2",
              border: `1px solid ${isOut ? "rgba(0,0,0,0.18)" : "rgba(76,184,240,0.30)"}`,
            }}
            aria-label={`Velocidade ${speed}x — clique pra alterar`}
            title="Alterar velocidade (1x → 1.5x → 2x)"
            data-testid={`audio-speed-${msgId}`}
          >
            {speed}x
          </button>
        </div>
      </div>

      {/* Avatar do contato (só pra incoming) */}
      {showAvatar && (
        <div className="relative flex-shrink-0">
          <div
            className="w-[34px] h-[34px] rounded-full overflow-hidden bg-muted flex items-center justify-center text-[11px] font-semibold text-muted-foreground"
            aria-label={contactName || "Contato"}
          >
            {contactAvatarUrl ? (
              <img
                src={contactAvatarUrl}
                alt={contactName || "Contato"}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div
            className="absolute -bottom-[2px] -right-[2px] w-[16px] h-[16px] rounded-full inline-flex items-center justify-center border-[2px] border-card"
            style={{ background: "#25D366" }}
          >
            <Mic className="w-2.5 h-2.5 text-white" />
          </div>
        </div>
      )}
    </div>
  );
}
