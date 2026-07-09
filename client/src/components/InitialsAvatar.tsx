import { useState } from "react";

interface InitialsAvatarProps {
  name?: string | null;
  fotoUrl?: string | null;
  size?: number;
  className?: string;
  // Indicador opcional (ex: status online, canal). Renderiza um dot pequeno
  // no canto inferior direito, contornado pela cor da superfície.
  indicator?: {
    color: string;
    label?: string;
  };
}

// Paleta determinística — 6 hues calmos, lightness 58%, chroma 0.14.
// OKLCH garante saturação perceptualmente uniforme entre as cores.
// Texto sempre em branco — contraste AA garantido em todos os 6 tons.
const AVATAR_BG = [
  "oklch(58% 0.14 245)", // azul
  "oklch(58% 0.14 195)", // ciano-azul
  "oklch(58% 0.14 155)", // verde-azulado
  "oklch(60% 0.14 70)",  // âmbar-mostarda
  "oklch(58% 0.14 25)",  // coral
  "oklch(58% 0.14 320)", // magenta-suave
];

function hashName(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickInitials(name: string): string {
  const cleaned = name.trim().replace(/^[+\d\s\-()]+$/, "").trim();
  // Se o nome é só dígitos (telefone), usa as duas primeiras casas pra dar
  // identidade visual mesmo sem nome cadastrado.
  if (!cleaned) {
    const digits = name.replace(/\D/g, "");
    return digits.slice(-2) || "??";
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function InitialsAvatar({
  name,
  fotoUrl,
  size = 36,
  className = "",
  indicator,
}: InitialsAvatarProps) {
  const [errored, setErrored] = useState(false);

  const safeName = (name && name.trim()) || "?";
  const initials = pickInitials(safeName);
  const bg = AVATAR_BG[hashName(safeName) % AVATAR_BG.length];

  const fontSize = Math.max(10, Math.round(size * 0.4));
  const indicatorSize = Math.max(8, Math.round(size * 0.28));

  const showPhoto = fotoUrl && !errored;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 rounded-full select-none ring-1 ring-black/5 dark:ring-white/5 ${className}`}
      style={{
        width: size,
        height: size,
        background: showPhoto ? "transparent" : bg,
        color: "#ffffff",
        fontSize,
        fontWeight: 700,
        letterSpacing: "0.02em",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
      aria-label={safeName}
      data-testid="initials-avatar"
    >
      {showPhoto ? (
        <img
          src={fotoUrl!}
          alt={safeName}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="w-full h-full rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
      {indicator && (
        <span
          className="absolute bottom-0 right-0 rounded-full ring-2 ring-background"
          style={{
            width: indicatorSize,
            height: indicatorSize,
            background: indicator.color,
          }}
          aria-label={indicator.label}
        />
      )}
    </div>
  );
}
