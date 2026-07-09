// Skill UX-UI: tons 600 (light) — alinhados com Fluxograma.tsx L44-47
// (Bruno 2026-05-17: padronização visual entre fluxograma, conversas,
// painel de ações e protocolos).
// Códigos auxiliares (FAQ/QR) usam tons neutros distintos dos setores
// pra não competir visualmente.
export const SECTOR_COLORS = {
  F: { color: '#d97706', bg: 'rgba(217,119,6,0.10)' },          // amber-600 (Financeiro)
  S: { color: '#2563eb', bg: 'rgba(37,99,235,0.10)' },          // blue-600 (Suporte)
  C: { color: '#059669', bg: 'rgba(5,150,105,0.10)' },          // emerald-600 (Comercial)
  K: { color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },          // red-600 (Cancelamento)
  N: { color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },         // violet-600 (Reputação)
  X: { color: '#475569', bg: 'rgba(71,85,105,0.10)' },          // slate-600 (Auxiliar — FAQ/QR)
} as const;

// Códigos auxiliares (cross-domain, sem prefixo de letra única). Mapeados
// explicitamente pra cor neutra de "auxiliar" (slate). Servidor: domain='auxiliar'.
const AUX_CODES = new Set(['FAQ', 'QR', 'AH', 'GERAL']);

export function getSituationTagColor(code: string): { bg: string; color: string } {
  if (AUX_CODES.has(code)) return SECTOR_COLORS.X;
  const prefix = code?.charAt(0)?.toUpperCase() as keyof typeof SECTOR_COLORS;
  return SECTOR_COLORS[prefix] ?? SECTOR_COLORS.F;
}

// Bruno 2026-05-30: sincronizado com server/services/agents/procedures/*.ts
// (source of truth). F18 antigo (titular_financeiro) foi removido por
// duplicidade com C7 em 2026-05-29; F18 atual é "Pagou mas bloqueado".
// Adicionados S19 (Quedas frequentes) e CANCEL_* (motivos retenção).
// Labels F5/F12/F17 mantidos como legado pra conversas históricas que
// ainda tenham tag desses códigos antigos.
export const SITUATION_LABELS: Record<string, string> = {
  // ── Financeiro ──
  F1:  "Promessa de pagamento",
  F2:  "Pausa / suspensão temporária",
  F3:  "2ª via boleto / faturas",
  F4:  "Desbloqueio / cortaram internet",
  F5:  "Consulta de débitos",                 // legado (pré-2026-05)
  F6:  "Cortaram / queda técnica",
  F7:  "Negociação / acordo / parcelamento",
  F8:  "Contestação / cobrança indevida",
  F9:  "Reembolso",
  F10: "Plano caro / preço alto",
  F11: "Pagamento não reconhecido",      // tag do fluxo de comprovante (slug back #pagto-nao-reconhecido)
  F12: "Crédito em conta",                    // legado
  F13: "Trocar forma de pagamento",
  F14: "Nota fiscal NF-e",
  F15: "Débito recusado",
  F16: "Mudança de vencimento",
  F17: "Pagamento via PIX",                   // legado
  F18: "Pagou mas bloqueado",
  F19: "Pagou mas bloqueado",                 // legado (renomeado pra F18 em 2026-05-29)
  F20: "Liberação de confiança",              // agente liberou 72h mediante comprovante (Bruno 2026-06-09)
  // ── Suporte Técnico ──
  S1:  "Sem internet — diagnóstico",
  S2:  "Queda total reportada",
  S3:  "Sem internet URGENTE",
  S4:  "Lentidão constante",
  S5:  "Lentidão intermitente",
  S6:  "Lentidão em horários específicos",
  S7:  "Lentidão em sites/apps específicos",
  S8:  "Acompanhar OS aberta",
  S9:  "Trocar aparelho com defeito",
  S10: "Senha do Wi-Fi",
  S11: "WiFi sumiu / rede invisível",
  S12: "Mover roteador de lugar",
  S13: "Dados técnicos",
  S14: "Sem energia elétrica",
  S15: "Sinal fraco em cômodos",
  S16: "Outro problema técnico (catch-all)",
  S17: "Status da linha",                     // legado
  S18: "Dano externo confirmado",
  S19: "Quedas frequentes",
  S20: "WiFi alterado (Anlix)",
  // ── Comercial (Vendas) ──
  C1:  "Upgrade / Downgrade de plano",
  C2:  "Agendar / remarcar instalação",
  C3:  "Verificar cobertura (CEP/cidade)",
  C4:  "Fidelidade / multa contratual",
  C5:  "Nova instalação (prospect)",
  C6:  "Detectou cancelamento (cross-sector)",
  C7:  "Titularidade (trocar titular)",
  C8:  "Consulta de planos (dúvidas gerais)",
  C9:  "Mudança de endereço",
  C10: "Programa de indicação",
  C11: "Checklist nova instalação",
  // ── Cancelamento (Retenção) ──
  CANCEL_MENU:          "Menu de retenção (10 motivos)",
  CANCEL_PRECO:         "Motivo: valor apertado",
  CANCEL_INSTABILIDADE: "Motivo: internet ruim",
  CANCEL_MUDANCA:       "Motivo: mudança de endereço",
  CANCEL_CONCORRENTE:   "Motivo: oferta concorrente",
  CANCEL_POUCO_USO:     "Motivo: uso pouca internet",
  CANCEL_ATENDIMENTO:   "Motivo: atendimento ruim",
  CANCEL_FINANCEIRO:    "Motivo: dificuldade financeira",
  CANCEL_DEMORA:        "Motivo: demora pra resolver problema",
  CANCEL_OUTRO:         "Motivo: outro / texto livre",
  // ── NPS / Reputação ──
  N1:  "NPS pós-atendimento",
  // ── Auxiliares cross-domain (Bruno, 2026-05-08) ────────────────────────
  AH:  "Atendimento humano",
  FAQ: "Resposta via FAQ",
  QR:  "Queixa retórica",
  SPAM: "Propaganda / oferta comercial recebida",
  GERAL: "Aplica-se a todas as situações",
};

export type SituationTag = { code: string; slug: string };
export type ConversationSituationTag = {
  id: number;
  code: string;
  slug: string;
  origin: string;
  createdAt: string;
};
export type SituationTagsByPhone = Record<string, SituationTag[]>;

// Bruno 2026-05-30 (print Bruno F18 sem tooltip): fallback explícito quando
// código não está mapeado. Antes caía em `slug.replace('#','')` que mostrava
// "f18" no tooltip — não informativo. Agora: tenta SLUG humanizado primeiro,
// senão devolve o próprio código como label (mas log warn pro dev saber).
export function getSituationLabel(code: string, slug?: string): string {
  const direct = SITUATION_LABELS[code];
  if (direct) return direct;
  // Slug humanizado: "#promessa-pagamento" → "Promessa pagamento"
  if (slug) {
    const cleaned = slug.replace(/^#/, '').replace(/[-_]/g, ' ').trim();
    if (cleaned) {
      // Capitaliza primeira letra
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
  if (typeof console !== 'undefined') {
    console.warn(`[situation-tags] código sem label mapeada: "${code}" — adicione em SITUATION_LABELS`);
  }
  return code;
}
