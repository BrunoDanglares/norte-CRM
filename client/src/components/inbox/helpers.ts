import type { Conversation } from "@shared/schema";

export type ConvExtended = Conversation & {
  empresa?: string;
  telefone?: string;
  email?: string;
  agente?: string;
  notas?: string;
  tags?: string[];
  prioridade?: string;
  origem?: string;
  protocolNumero?: string | null;
  protocolStatus?: string | null;
  protocolSlaViolado?: boolean;
};

export function channelColor(canal: string) {
  const map: Record<string, string> = {
    whatsapp: "#25d366", WhatsApp: "#25d366",
    instagram: "#e1306c", Instagram: "#e1306c",
    email: "#FAC209", Email: "#FAC209",
  };
  return map[canal] || "hsl(205, 88%, 58%)";
}

export function prioColor(prio: string) {
  const map: Record<string, string> = {
    alta: "#ef4444",
    media: "#f59e0b",
    baixa: "#10b981",
  };
  return map[prio] || "#6b7280";
}

export function agentColor(nome: string) {
  const colors = ["#FAC209", "#25d366", "#FAC209", "#e1306c", "#f59e0b", "#FAC209"];
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = nome.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

// Tempo decorrido em h/min/s. `nowMs` opcional permite tick externo
// (ex.: <LiveTempo /> passa o "agora" atualizado a cada 1s sem que o helper
// precise pegar Date.now() sozinho). Pra >=2d cai pro "Xd" / data, porque
// contar segundos depois de 2 dias é ruído visual.
export function formatTempo(dateStr?: string | null, nowMs?: number) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = nowMs ?? Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "agora";
  const totalSec = Math.floor(diffMs / 1000);
  const diffDays = Math.floor(totalSec / 86400);
  if (diffDays >= 7) return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (diffDays >= 2) return `${diffDays}d`;
  if (diffDays === 1) return "ontem";
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${mins}min ${secs}s`;
  if (mins > 0) return `${mins}min ${secs}s`;
  return `${secs}s`;
}

// Formato compacto pra TIMESTAMP DA ÚLTIMA MENSAGEM nos cards de conversa,
// estilo WhatsApp. Diferente do `formatTempo` (cronômetro com segundos), esse
// é estável: a unidade só muda quando cruza um marco real ("3 min" → "1h" →
// "ontem"). Não estimula re-render por segundo. (Bruno 2026-05-17.)
export function formatLastMessageTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "agora";
  const totalMin = Math.floor(diffMs / 60000);
  if (totalMin < 1) return "agora";
  if (totalMin < 60) return `${totalMin} min`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "ontem";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("pt-BR", sameYear
    ? { day: "2-digit", month: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function formatVistoDetalhado(dateStr?: string | null) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `ha ${diffMin}min`;
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffH < 24) return `hoje as ${hora}`;
  if (diffD === 1) return `ontem as ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} as ${hora}`;
}

export function formatRecordingTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Bruno 2026-05-22: detecta texto que é PURAMENTE um placeholder de mídia
// (gerado pelo webhook quando a mídia chega sem caption real). Backend usa
// "[figurinha]", "[imagem]", "[video]", "[audio]", "[documento]", "[pdf]",
// "[localizacao]", "[contato]", "[arquivo]" como sentinelas pra classifier
// detectar tipo de mensagem — esses tokens NUNCA devem aparecer visíveis ao
// atendente como caption embaixo da mídia. Retorna true só quando o texto
// inteiro é o placeholder (sem caption livre embutida no formato
// "[imagem] caption real").
//
// Casos cobertos:
//   "[figurinha]"          → true
//   "[imagem]"             → true
//   "[Audio 0:18]"         → true (variação outbound do useAudioRecorder)
//   "[documento: nome]"    → true
//   "[imagem] minha foto"  → false (tem caption livre após o placeholder)
//   ""                     → false
//   "olá tudo bem?"        → false
const PURE_MEDIA_PLACEHOLDER_RE = /^\[(audio|áudio|imagem|image|video|vídeo|figurinha|sticker|gif|localiza[cç][aã]o|documento|arquivo|contato|pdf|file)(?:[:\s][^\]]*)?\]\s*$/i;

export function isPureMediaPlaceholder(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PURE_MEDIA_PLACEHOLDER_RE.test(texto.trim());
}

// Helper utilitário pros components renderizarem caption só quando tem texto
// REAL (não placeholder). Retorna undefined quando texto é placeholder puro,
// ausente, ou só whitespace.
export function captionFromMessageText(texto: string | null | undefined): string | undefined {
  if (!texto) return undefined;
  if (isPureMediaPlaceholder(texto)) return undefined;
  return texto;
}
