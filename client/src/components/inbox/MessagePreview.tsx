import { Mic, Image as ImageIcon, Play, MapPin, FileText, User, Sticker } from "lucide-react";
import { formatWppText } from "@/lib/wpp-format";
import type { ReactNode } from "react";

// Detecta placeholders de mídia em qualquer convenção que aparece no projeto:
//   • inbound (server/webhook-meta + Evolution): [audio] [imagem] [video]
//     [figurinha] [localizacao] [documento: nome] [contato: nome]
//   • outbound (frontend useMediaHandlers): [Audio 0:18] [Imagem: file]
//     [Audio: file] [Arquivo: file]
//   • automation engine: "[imagem] caption" / "[documento] file - caption"
//   • Bruno 2026-05-21 — novos formatos humanizados:
//     "📇 Fulano (+55...)"  e  "📍 Nome — Endereço"
export type MediaKind = "audio" | "image" | "video" | "sticker" | "location" | "document" | "contact" | "gif";

const RE_AUDIO    = /^\[(audio|áudio)(?:[:\s][^\]]*)?\]/i;
const RE_IMAGE    = /^\[(imagem|image)(?:[:\s][^\]]*)?\]/i;
const RE_VIDEO    = /^\[(video|vídeo)(?:[:\s][^\]]*)?\]/i;
const RE_STICKER  = /^\[(figurinha|sticker)\]/i;
const RE_GIF      = /^\[gif\]/i;
const RE_LOCATION = /^\[localiza[cç][aã]o/i;
const RE_DOCUMENT = /^\[(documento|arquivo)(?:[:\s][^\]]*)?\]/i;
const RE_CONTACT  = /^\[contato:\s*([^\]]*)\]/i;
const RE_LOCATION_EMOJI = /^📍\s+(.+)/;
const RE_CONTACT_EMOJI  = /^📇\s+(.+)/;

export function parseMediaPlaceholder(raw: string): { kind: MediaKind; label: string } | null {
  const t = raw.trim();

  // Bruno 2026-05-21: novos formatos com emoji (sem colchetes) — gerados pelo
  // webhook-meta pra inbound estruturado de location/contacts.
  const locEmoji = t.match(RE_LOCATION_EMOJI);
  if (locEmoji) return { kind: "location", label: `Localização · ${locEmoji[1].slice(0, 32)}` };
  const conEmoji = t.match(RE_CONTACT_EMOJI);
  if (conEmoji) return { kind: "contact", label: `Contato · ${conEmoji[1].slice(0, 32)}` };

  if (!t.startsWith("[")) return null;

  if (RE_AUDIO.test(t)) {
    const dur = t.match(/(\d+:\d{2})/)?.[1];
    return { kind: "audio", label: dur ? `Áudio · ${dur}` : "Áudio" };
  }
  if (RE_IMAGE.test(t)) return { kind: "image", label: "Imagem" };
  if (RE_VIDEO.test(t)) return { kind: "video", label: "Vídeo" };
  if (RE_STICKER.test(t)) return { kind: "sticker", label: "Figurinha" };
  if (RE_GIF.test(t)) return { kind: "gif", label: "GIF" };
  if (RE_LOCATION.test(t)) return { kind: "location", label: "Localização" };
  if (RE_DOCUMENT.test(t)) {
    const name = t.match(/^\[(?:documento|arquivo)(?::\s*([^\]]+))?\]/i)?.[1]?.trim();
    return { kind: "document", label: name ? `Documento · ${name}` : "Documento" };
  }
  const cm = t.match(RE_CONTACT);
  if (cm) {
    const name = cm[1]?.trim();
    return { kind: "contact", label: name ? `Contato · ${name}` : "Contato" };
  }
  return null;
}

const ICON_BY_KIND: Record<MediaKind, typeof Mic> = {
  audio: Mic,
  image: ImageIcon,
  video: Play,
  sticker: Sticker,
  gif: Play,
  location: MapPin,
  document: FileText,
  contact: User,
};

const ACCENT_BY_KIND: Record<MediaKind, string> = {
  audio: "text-emerald-600 dark:text-emerald-400",
  image: "text-violet-600 dark:text-violet-400",
  video: "text-sky-600 dark:text-sky-400",
  sticker: "text-amber-600 dark:text-amber-400",
  gif: "text-sky-600 dark:text-sky-400",
  location: "text-rose-600 dark:text-rose-400",
  document: "text-orange-600 dark:text-orange-400",
  contact: "text-primary",
};

// Renderiza preview da última mensagem como ícone + label quando é mídia,
// senão devolve o texto formatado pelo wpp-format (markdown inline do WA).
export function renderMessagePreview(raw: string | null | undefined): ReactNode {
  if (!raw) return null;
  const media = parseMediaPlaceholder(raw);
  if (!media) return formatWppText(raw);
  const Icon = ICON_BY_KIND[media.kind];
  const accent = ACCENT_BY_KIND[media.kind];
  return (
    <span className="inline-flex items-center gap-1 min-w-0 align-middle">
      <Icon className={`w-3 h-3 flex-shrink-0 ${accent}`} />
      <span className="truncate">{media.label}</span>
    </span>
  );
}

// Indica se o texto é placeholder de mídia — usado pra suprimir prefixos
// como "Você: " que não fazem sentido em mídia.
export function isMediaPlaceholder(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return parseMediaPlaceholder(raw) !== null;
}
