import { normalizePersonName } from "@shared/normalizeName";

export const STAGES: Record<string, { label: string; color: string }> = {
  novo: { label: "Novo", color: "#FBCA22" },
  contatado: { label: "Contatado", color: "#818cf8" },
  qualificado: { label: "Qualificado", color: "#a78bfa" },
  proposta: { label: "Proposta", color: "#c084fc" },
  negociacao: { label: "Negociacao", color: "#e879f9" },
  ganho: { label: "Ganho", color: "#34d399" },
  perdido: { label: "Perdido", color: "#f87171" },
};

export const CANAIS = ["WhatsApp", "Instagram", "Email", "Telefone"];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

// Limpa nome pra exibicao: dobra fontes "fancy" do WhatsApp (math/fullwidth)
// via NFKC e remove zero-width / BOM / controls que viram "nome invisivel".
// Mantem emoji, acentos e qualquer char imprimivel. Logica canonica em
// @shared/normalizeName (mesma usada quando o bot ecoa o nome na mensagem).
export function sanitizeDisplayName(raw: string | null | undefined): string {
  return normalizePersonName(raw);
}

// Detecta se o nome comeca com emoji ou simbolo pictografico - usado pra
// escolher render alternativo do avatar (Dicebear nao desenha emoji).
const EMOJI_LEADING_RE = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u;
export function startsWithEmoji(name: string): boolean {
  try {
    return EMOJI_LEADING_RE.test(name);
  } catch {
    return false;
  }
}

// Primeiro grapheme visivel (emoji multi-codepoint, letra acentuada, etc).
export function firstGrapheme(name: string): string {
  if (!name) return "";
  try {
    // @ts-ignore Intl.Segmenter pode nao existir em runtimes antigos
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    // @ts-ignore
    const first = seg.segment(name)[Symbol.iterator]().next().value;
    return first?.segment || "";
  } catch {
    return Array.from(name)[0] || "";
  }
}

export function getInitials(name: string): string {
  const clean = sanitizeDisplayName(name);
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (firstGrapheme(parts[0]) + firstGrapheme(parts[1])).toUpperCase();
  }
  const arr = Array.from(clean);
  return arr.slice(0, 2).join("").toUpperCase();
}
