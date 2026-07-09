import { useState } from "react";
import {
  sanitizeDisplayName,
  firstGrapheme,
} from "@/lib/constants";

interface ContactAvatarProps {
  contactId?: string | number;
  nome: string;
  fotoUrl?: string | null;
  size?: number;
  rounded?: string;
  /** Bruno 2026-06-18: se passado E houver foto, a foto vira clicável (abre o lightbox). */
  onClick?: () => void;
}

// Bruno 2026-05-21: substituí o amarelo (#FFB300) por um slot dinâmico
// que segue a --primary da paleta (banana/lilac/blue/orange). Mantém os
// outros 4 fixos pra que cada contato continue tendo cor estável de
// identificação — mas evita amarelo cravado quando o tenant escolheu
// outra paleta. O índice 2 é resolvido em runtime via CSS var.
const AVATAR_COLOR_SLOTS = ["#8b5cf6", "#4CB8F0", "primary", "#5DCAA5", "#E24B4A"] as const;

// Cor estavel a partir do seed - mesmo input sempre cai no mesmo slot.
// "primary" resolve em runtime pra hsl(var(--primary)) (acompanha paleta).
function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const slot = AVATAR_COLOR_SLOTS[Math.abs(hash) % AVATAR_COLOR_SLOTS.length];
  return slot === "primary" ? "hsl(var(--primary))" : slot;
}

// Bruno 2026-05-21: extrai iniciais SÓ de letras Unicode. Strip emoji,
// símbolos pictográficos (♡, □, ❤), categoria "Symbol, Other" e dígitos
// soltos antes de tirar as iniciais — antes a Dicebear renderizava "R♡"
// pra "Rhay ♡ Ferreira" porque o seed ia com tudo.
function extractLetterInitials(rawName: string): string {
  // \p{L} = qualquer letra Unicode (acentos, ç, etc). Mantém só letras+espaço.
  const stripped = rawName
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export default function ContactAvatar({
  nome,
  fotoUrl,
  size = 36,
  rounded = "50%",
  onClick,
}: ContactAvatarProps) {
  const [errored, setErrored] = useState(false);
  const clean = sanitizeDisplayName(nome);
  const showPhoto = !!fotoUrl && !errored;

  if (showPhoto) {
    return (
      <img
        src={fotoUrl!}
        alt={nome || "Contato"}
        width={size}
        height={size}
        style={{
          borderRadius: rounded,
          objectFit: "cover",
          flexShrink: 0,
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          cursor: onClick ? "pointer" : undefined,
        }}
        onClick={onClick}
        onError={() => {
          if (!errored) setErrored(true);
        }}
        data-testid="img-contact-avatar"
      />
    );
  }

  // Sem foto: tenta iniciais de letras de verdade. Se nome só tem
  // emoji/símbolo (ex: "♡" ou "□"), usa o primeiro grapheme como fallback.
  const letterInitials = extractLetterInitials(clean);
  const glyph = letterInitials || firstGrapheme(clean) || "?";
  const bg = pickColor(clean || "?");
  // Iniciais latinas = fonte normal; fallback simbólico precisa de stack
  // emoji-friendly pra renderizar bonito.
  const fontStack = letterInitials
    ? "Inter, system-ui, sans-serif"
    : '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji Mozilla",system-ui,sans-serif';

  return (
    <div
      aria-label={nome || "Contato"}
      role="img"
      data-testid="img-contact-avatar"
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: rounded,
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * (letterInitials ? 0.42 : 0.55)),
        lineHeight: 1,
        flexShrink: 0,
        fontFamily: fontStack,
        fontWeight: 700,
        letterSpacing: letterInitials ? "0.02em" : 0,
        userSelect: "none",
      }}
    >
      {glyph}
    </div>
  );
}
