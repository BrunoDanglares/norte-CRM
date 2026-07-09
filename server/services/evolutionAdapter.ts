// server/services/evolutionAdapter.ts
// Cliente HTTP do canal **Evolution GO** (whatsmeow) — Bruno 2026-06-09.
//
// Canal WhatsApp NÃO-OFICIAL. O Evolution GO roda como SERVIÇO EXTERNO
// (container próprio no EasyPanel): aqui só fazemos chamadas REST. Sem sessão em
// memória, sem /tmp, sem reconexão local.
//
// CONTRATO (confirmado por sondagem real contra a instância 2026-06-09):
//   Auth: header `apikey`.
//     - GLOBAL_API_KEY  → operações ADMIN: POST /instance/create, GET /instance/all,
//                         DELETE /instance/delete/{id}.
//     - TOKEN da instância → OPERAR a instância: /instance/connect, /instance/qr,
//                         /instance/status, /instance/disconnect, /send/*.
//       (usar a global numa operação de instância → {"error":"not authorized"})
//   Criar:   POST /instance/create  { name, token }   (token = UUID que NÓS geramos; é obrigatório)
//   Conectar:POST /instance/connect { immediate:true, webhookUrl, subscribe:[...] }  (apikey=token)
//   QR:      GET  /instance/qr   (apikey=token) → { data:{ Qrcode:"data:image/png;base64,..." } }  (limite 5 leituras)
//   Status:  GET  /instance/status (apikey=token) → { data:{ Connected, LoggedIn, Name } }
//   Enviar:  POST /send/text  { number, text }            (apikey=token)
//            POST /send/media { number, type, url, caption, filename }  (type: image|video|audio|document)
//   Remover: DELETE /instance/delete/{id}  (apikey=GLOBAL)
//
// Config por env (setadas no EasyPanel do ChatBanana — uma instância Evolution
// pra todos os tenants):
//   EVOLUTION_BASE_URL          ex http://evolution-go_evolution-go:8080 (interno) — sem barra final
//   EVOLUTION_BASE_URL_FALLBACK ex https://evolution-go-...easypanel.host (público) — usado SÓ se o interno falhar
//   EVOLUTION_GLOBAL_API_KEY    a GLOBAL_API_KEY do Evolution GO
//   EVOLUTION_WEBHOOK_URL       URL que o Evolution chama de volta (ex http://chatbanana_chatbanana:5000/api/webhook/evolution)

import { randomUUID } from "crypto";

const TIMEOUT_MS = 20_000;

// Calibração (Fase 3): loga 1x o shape REAL da resposta de cada /send/* por path,
// pra confirmar onde o messageId vem (e ajustar extractMessageId se preciso).
const sendRawLogged = new Set<string>();

function base(): string {
  return (process.env.EVOLUTION_BASE_URL || "").replace(/\/+$/, "");
}
/**
 * URL de FALLBACK (Bruno 2026-06-17). O app fala com o Evolution pela rede INTERNA
 * (`EVOLUTION_BASE_URL = http://evolution-go_evolution-go:8080`) pra NÃO depender do
 * Traefik — que recicla e perde a rota, devolvendo 502 (causa-raiz do "QR não carrega"
 * recorrente). Se o host interno ficar inalcançável (DNS/conexão recusada), o evoFetch
 * cai automaticamente pra esta URL pública. Setar `EVOLUTION_BASE_URL_FALLBACK` = o
 * domínio público do evolution-go. Sem ela, comporta como antes (só a base primária).
 */
function fallbackBase(): string {
  return (process.env.EVOLUTION_BASE_URL_FALLBACK || "").replace(/\/+$/, "");
}
/** Bases a tentar, em ordem: interna (primária) → pública (fallback). Dedup, sem vazias. */
function bases(): string[] {
  return Array.from(new Set([base(), fallbackBase()].filter(Boolean)));
}
function globalKey(): string {
  return process.env.EVOLUTION_GLOBAL_API_KEY || "";
}
function webhookBaseUrl(): string {
  return (process.env.EVOLUTION_WEBHOOK_URL || "").trim();
}
/**
 * URL do webhook com o `secret` embutido como query param. O handler do webhook
 * valida ?secret contra EVOLUTION_WEBHOOK_SECRET (timing-safe) — defesa contra
 * spoofing cross-tenant (o instanceId não é secreto: vaza via WS/URLs).
 */
export function resolveWebhookUrl(): string {
  const baseUrl = webhookBaseUrl();
  if (!baseUrl) return "";
  const secret = (process.env.EVOLUTION_WEBHOOK_SECRET || "").trim();
  if (!secret) return baseUrl;
  return baseUrl + (baseUrl.includes("?") ? "&" : "?") + "secret=" + encodeURIComponent(secret);
}
export function evolutionConfigured(): boolean {
  // Exige o webhook: sem ele a instância conecta mas nunca RECEBE (canal mudo).
  return !!base() && !!globalKey() && !!webhookBaseUrl();
}

/** Extrai telefone (10-15 díg) de um JID whatsmeow; null se não parecer telefone. */
function jidToPhone(jid: any): string | null {
  const user = String(jid ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return user.length >= 10 && user.length <= 15 ? user : null;
}

/** Número → JID whatsmeow. /user/avatar e /message/presence EXIGEM o JID
 *  completo (só dígitos TRAVA o endpoint). Confirmado por teste 2026-06-09. */
function toJid(n: string): string {
  const s = String(n || "");
  if (s.includes("@")) return s;
  return onlyDigits(s) + "@s.whatsapp.net";
}

// CATEGORIAS de eventos do Evolution GO (MAIÚSCULAS) — confirmado por teste real
// (2026-06-09): o connect SÓ popula `events` com estes nomes; os whatsmeow-style
// ("Message"/"Receipt") são ignorados → webhook nunca dispara. Os eventos
// individuais chegam em minúsculas no payload (message, readreceipt, etc).
// MESSAGE=inbound, READ_RECEIPT=ticks, CONNECTION=status, QRCODE=pareamento.
export const EVO_SUBSCRIBE_EVENTS = ["MESSAGE", "READ_RECEIPT", "CONNECTION", "QRCODE"];

export interface EvoResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  raw?: any;
}

// Retry com backoff pra erros TRANSITÓRIOS (timeout/network=status0, 429, 5xx) —
// paridade com o withMetaRetry do canal Meta. Evolution GO às vezes engasga sob
// carga; sem retry um pico vira falha de envio direta.
async function evoFetch(
  path: string,
  opts: { method?: string; apikey: string; body?: any; timeoutMs?: number },
): Promise<EvoResult> {
  const baseList = bases();
  if (baseList.length === 0) return { ok: false, status: 0, error: "EVOLUTION_BASE_URL não configurado" };
  const maxAttempts = 3;
  let last: EvoResult | undefined;
  for (let bi = 0; bi < baseList.length; bi++) {
    const baseUrl = baseList[bi];
    const isLastBase = bi === baseList.length - 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      last = await evoFetchOnce(baseUrl, path, opts);
      const transient = last.status === 0 || last.status === 429 || last.status >= 500;
      if (last.ok || !transient || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt - 1))); // 300ms, 600ms
    }
    if (last!.ok) return last!;
    // Failover SÓ quando ESTA base está inalcançável: conexão recusada/timeout (status 0)
    // ou 502/503/504 (= o proxy não chegou no backend). Um 4xx ou erro de negócio do
    // Evolution é resposta LEGÍTIMA → retorna (trocar de base daria o mesmo erro).
    const unreachable = last!.status === 0 || last!.status === 502 || last!.status === 503 || last!.status === 504;
    if (unreachable && !isLastBase) {
      console.warn(`[Evolution] base ${baseUrl} inalcançável (status ${last!.status}) — caindo pro fallback`);
      continue;
    }
    return last!;
  }
  return last!;
}

async function evoFetchOnce(
  baseUrl: string,
  path: string,
  opts: { method?: string; apikey: string; body?: any; timeoutMs?: number },
): Promise<EvoResult> {
  const url = baseUrl + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: {
        apikey: opts.apikey,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok || (json && json.error)) {
      return { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}`, raw: json };
    }
    if ((opts.method || "GET") === "POST" && path.startsWith("/send/") && !sendRawLogged.has(path)) {
      sendRawLogged.add(path);
      console.log(`[Evolution] 1ª resposta ${path}:`, JSON.stringify(json).slice(0, 400));
    }
    // Evolution GO devolve { data, message } na maioria das rotas.
    return { ok: true, status: res.status, data: json?.data !== undefined ? json.data : json, raw: json };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "timeout" : (e?.message || String(e));
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Geração de token ────────────────────────────────────────────────────────
/** Token (UUID) da instância — é a "senha" que opera a instância no Evolution. */
export function newInstanceToken(): string {
  return randomUUID();
}

// ─── Instância (admin = global key) ──────────────────────────────────────────
/** Cria a instância no Evolution GO. name único (usamos o id da conexão). */
export async function createInstance(name: string, token: string): Promise<EvoResult> {
  return evoFetch("/instance/create", { method: "POST", apikey: globalKey(), body: { name, token } });
}

/** Remove a instância (admin). id = o `id` (uuid) que o Evolution gerou no create. */
export async function deleteInstance(evolutionId: string): Promise<EvoResult> {
  return evoFetch(`/instance/delete/${encodeURIComponent(evolutionId)}`, { method: "DELETE", apikey: globalKey() });
}

/** Lista todas as instâncias (admin) — diagnóstico/boot. */
export async function listInstances(): Promise<EvoResult> {
  return evoFetch("/instance/all", { method: "GET", apikey: globalKey() });
}

/**
 * Remove a instância pelo NAME (o DELETE exige o `id` interno do Evolution, que
 * não guardamos — resolvemos via /instance/all). Idempotente: se não existe, ok.
 */
export async function removeInstanceByName(name: string): Promise<EvoResult> {
  const all = await listInstances();
  // Distingue "lista falhou" (não sabemos → reporta) de "não existe" (idempotente).
  if (!all.ok) return { ok: false, status: all.status, error: `listInstances falhou: ${all.error}` };
  if (Array.isArray(all.data)) {
    const found = all.data.find((i: any) => i?.name === name || i?.Name === name);
    const evoId = found?.id || found?.Id || found?.ID;
    if (evoId) return deleteInstance(String(evoId));
  }
  return { ok: true, status: 200 }; // lista OK e name não existe → nada a fazer
}

// ─── Operar a instância (token da instância) ─────────────────────────────────
/** Inicia a conexão + registra webhook/eventos. Gera o QR pra parear. */
export async function connectInstance(token: string, webhookUrl: string): Promise<EvoResult> {
  if (!webhookUrl || !webhookUrl.trim()) {
    // Sem webhook a instância conectaria mas nunca receberia mensagem (canal mudo).
    return { ok: false, status: 0, error: "EVOLUTION_WEBHOOK_URL não configurado" };
  }
  return evoFetch("/instance/connect", {
    method: "POST",
    apikey: token,
    body: { immediate: true, webhookUrl, subscribe: EVO_SUBSCRIBE_EVENTS },
  });
}

/** QR code (já em data:image/png;base64). null se ainda não disponível. */
export async function getQrCode(token: string): Promise<{ ok: boolean; qrcode?: string; error?: string }> {
  const r = await evoFetch("/instance/qr", { method: "GET", apikey: token });
  if (!r.ok) return { ok: false, error: r.error };
  const qr = r.data?.Qrcode || r.data?.qrcode || r.data?.qrCode;
  return { ok: true, qrcode: typeof qr === "string" && qr ? qr : undefined };
}

/** Status da instância → normaliza pro vocabulário do ChatBanana. */
export async function getStatus(token: string): Promise<{
  ok: boolean;
  connected: boolean;   // pareado/logado no WhatsApp (LoggedIn)
  socket: boolean;      // socket vivo no Evolution (Connected)
  numero?: string | null;
  error?: string;
}> {
  const r = await evoFetch("/instance/status", { method: "GET", apikey: token });
  if (!r.ok) return { ok: false, connected: false, socket: false, error: r.error };
  const d = r.data || {};
  const loggedIn = d.LoggedIn === true || d.loggedIn === true;
  const conn = d.Connected === true || d.connected === true;
  // ⚠️ d.Name é o NOME da instância (= o UUID que passamos no create), NÃO o
  // telefone. Só extraímos numero de um campo de JID/telefone real (validado).
  const jidLike = d.Jid || d.jid || d.Phone || d.phone || d.LoggedInJID || null;
  const numero = jidLike ? jidToPhone(jidLike) : null;
  return { ok: true, connected: loggedIn, socket: conn, numero };
}

/** Desconecta (logout) a instância. */
export async function disconnectInstance(token: string): Promise<EvoResult> {
  return evoFetch("/instance/disconnect", { method: "POST", apikey: token });
}

/** Presença "digitando" (paridade typing). state: composing|paused|available. */
export async function sendPresence(
  token: string,
  to: string,
  state: "composing" | "paused" | "available" = "composing",
): Promise<void> {
  await evoFetch("/message/presence", {
    method: "POST", apikey: token, timeoutMs: 8000,
    body: { number: toJid(to), state },
  }).catch(() => {});
}

/** Foto de perfil do contato (best-effort). Retorna URL/dataURL ou null. */
export async function getAvatar(token: string, number: string): Promise<string | null> {
  const r = await evoFetch("/user/avatar", {
    method: "POST", apikey: token, timeoutMs: 8000,
    body: { number: toJid(number), preview: true },
  });
  if (!r.ok) return null;
  const d = r.data || {};
  const url = d.url || d.URL || d.profilePicUrl || d.ProfilePicURL || d.avatar || d.picture || (typeof d === "string" ? d : null);
  return typeof url === "string" && url ? url : null;
}

// ─── Envio (token da instância) ──────────────────────────────────────────────
function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}
function extractMessageId(data: any): string | undefined {
  // Defensivo ao shape REAL da resposta do /send (whatsmeow usa PascalCase;
  // calibrar pelo log [Evolution] 1ª resposta /send/* na Fase 3).
  return (
    data?.id || data?.ID || data?.Id ||
    data?.key?.id || data?.key?.ID ||
    data?.messageId || data?.MessageID ||
    data?.Info?.ID || data?.Info?.Id || data?.info?.id ||
    data?.response?.id || data?.response?.ID ||
    undefined
  );
}

/** Envia texto. Retorna shape compatível com o channel-router (sent/messageId/error). */
export async function sendText(
  token: string,
  to: string,
  text: string,
  replyTo?: string,
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const r = await evoFetch("/send/text", {
    method: "POST",
    apikey: token,
    // `quoted`/`replyTo` defensivos: o decode de JSON do whatsmeow (Go) ignora
    // campos não suportados, então isto degrada (sem quote) em vez de quebrar.
    body: { number: onlyDigits(to), text, ...(replyTo ? { quoted: replyTo, replyTo } : {}) },
  });
  if (!r.ok) return { sent: false, error: r.error };
  return { sent: true, messageId: extractMessageId(r.data) };
}

/**
 * Envia mídia. type: image|video|audio|document. `media` pode ser URL pública
 * OU data URL base64 (Evolution aceita ambos no campo `url`).
 */
export async function sendMedia(
  token: string,
  to: string,
  type: "image" | "video" | "audio" | "document",
  media: string,
  caption?: string,
  filename?: string,
  opts?: { voice?: boolean; replyTo?: string },
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const r = await evoFetch("/send/media", {
    method: "POST",
    apikey: token,
    body: {
      number: onlyDigits(to),
      type,
      url: media,
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
      // voice note (PTT) e reply: campos defensivos (Go ignora os não suportados →
      // áudio vira arquivo / msg sem quote, em vez de quebrar o envio).
      ...(opts?.voice && type === "audio" ? { ptt: true } : {}),
      ...(opts?.replyTo ? { quoted: opts.replyTo, replyTo: opts.replyTo } : {}),
    },
  });
  if (!r.ok) return { sent: false, error: r.error };
  return { sent: true, messageId: extractMessageId(r.data) };
}

/**
 * Tipos de botão do native_flow (go-version-0.7). Bruno 2026-06-11: a imagem
 * evolution-buttons (go-version-0.7) renderiza botões interativos no CELULAR via
 * native_flow. Cada botão pode ser de um tipo diferente.
 *   reply → quick_reply (volta como buttonId no clique)
 *   url   → cta_url (abre link)        copy → cta_copy (copia código, ex: PIX copia-cola)
 *   call  → cta_call (liga)            pix  → payment_info (PIX nativo do WhatsApp)
 */
export type EvoButton =
  | { type?: "reply"; id: string; title: string }
  | { type: "url"; title: string; url: string }
  | { type: "copy"; title: string; copyCode: string }
  | { type: "call"; title: string; phoneNumber: string }
  | { type: "pix"; title?: string; key: string; keyType: "phone" | "email" | "cpf" | "cnpj" | "random"; name: string; currency?: string };

const PIX_KEYTYPES = new Set(["phone", "email", "cpf", "cnpj", "random"]);

/**
 * Remove emoji do LABEL do botão. Bruno 2026-06-11: o native_flow (go-version-0.7)
 * NÃO renderiza botão cujo título contém emoji — o botão some no celular e o
 * fluxo cai pro fallback texto. Caso real: menu de setor "💰 Financeiro"/"🔧 Suporte"/
 * "🛒 Comercial" vinha como TEXTO, enquanto "Já sou cliente"/"Quero contratar"
 * (sem emoji) chegava NATIVO. Sanitiza o label pra garantir o render nativo;
 * o emoji segue visível no corpo/painel (não no botão).
 */
function stripBtnEmoji(s: string): string {
  return (s || "")
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}-\u{231B}\u{24C2}\u{25AA}-\u{25FE}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Monta 1 botão no formato que o /send/button espera, por tipo. */
function buildEvoButton(b: EvoButton): any {
  switch (b.type) {
    case "url":  return { type: "url",  displayText: stripBtnEmoji(b.title), url: b.url };
    case "copy": return { type: "copy", displayText: stripBtnEmoji(b.title), copyCode: b.copyCode };
    case "call": return { type: "call", displayText: stripBtnEmoji(b.title), phoneNumber: b.phoneNumber };
    case "pix":  return { type: "pix", displayText: stripBtnEmoji(b.title || "Pagar com Pix"), key: b.key, keyType: b.keyType, name: b.name, currency: b.currency || "BRL" };
    default:     return { type: "reply", displayText: stripBtnEmoji((b as any).title), id: (b as any).id };
  }
}

/**
 * Botões interativos (native_flow). POST /send/button — até 3 botões (limite de
 * RENDER do WhatsApp; a API aceita mais mas o cliente não vê). `title` (header) e
 * `footer` são OBRIGATÓRIOS pra essa imagem — caem em fallback discreto se vazios.
 */
export async function sendButtons(
  token: string,
  to: string,
  opts: { title?: string; body: string; footer?: string; buttons: EvoButton[] },
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  // PIX exige keyType válido — a API NÃO valida e um keyType errado quebra o render.
  const pixBad = opts.buttons.find((b) => b.type === "pix" && !PIX_KEYTYPES.has((b as any).keyType));
  if (pixBad) return { sent: false, error: `pix keyType inválido: ${(pixBad as any).keyType}` };
  const r = await evoFetch("/send/button", {
    method: "POST",
    apikey: token,
    body: {
      number: onlyDigits(to),
      title: (opts.title || "").trim() || "Atendimento",
      description: opts.body,
      footer: (opts.footer || "").trim() || "Toque numa opção",
      buttons: opts.buttons.slice(0, 3).map(buildEvoButton),
    },
  });
  if (!r.ok) return { sent: false, error: r.error };
  return { sent: true, messageId: extractMessageId(r.data) };
}

/**
 * Lista/menu interativo (paridade Meta, >3 opções). POST /send/list.
 * rowId = callback (volta como singleSelectReply.selectedRowID).
 */
export async function sendList(
  token: string,
  to: string,
  opts: {
    title?: string; body: string; footer?: string; buttonText?: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  },
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const r = await evoFetch("/send/list", {
    method: "POST",
    apikey: token,
    body: {
      number: onlyDigits(to),
      // Bruno 2026-06-12: title é OBRIGATÓRIO no fork (igual /send/button). Vazio →
      // o /send/list REJEITA → o caller cai no fallback texto numerado (conv #3023:
      // submenu de lentidão chegou como texto, não como lista nativa). Defaulta como
      // o sendButtons já faz (linha 384) pra a lista renderizar nativa no celular.
      title: (opts.title || "").trim() || "Atendimento",
      description: opts.body,
      // footerText também é obrigatório no fork — garante não-vazio.
      footerText: (opts.footer || "").trim() || "Toque numa opção",
      buttonText: opts.buttonText || "Ver opções",
      sections: opts.sections.map((s) => ({
        title: stripBtnEmoji(s.title || ""),
        rows: s.rows.map((row) => ({ rowId: row.id, title: stripBtnEmoji(row.title), description: row.description || "" })),
      })),
    },
  });
  if (!r.ok) return { sent: false, error: r.error };
  return { sent: true, messageId: extractMessageId(r.data) };
}

/** Botão de CARD do carrossel — formato DIFERENTE do botão normal (sem pix; id
 *  polimórfico: REPLY→payload, URL→url, CALL→telefone). */
export type EvoCarouselButton =
  | { type?: "reply"; title: string; id: string }
  | { type: "url"; title: string; url: string }
  | { type: "call"; title: string; phoneNumber: string }
  | { type: "copy"; title: string; copyCode: string };

export interface EvoCarouselCard {
  text: string;            // corpo do card (vira body.text)
  title?: string;          // header do card
  subtitle?: string;
  imageUrl?: string;       // mídia do card (URL pública)
  footer?: string;
  buttons: EvoCarouselButton[];
}

function buildCarouselButton(b: EvoCarouselButton): any {
  switch (b.type) {
    case "url":  return { type: "URL",  displayText: stripBtnEmoji(b.title), id: b.url };
    case "call": return { type: "CALL", displayText: stripBtnEmoji(b.title), id: b.phoneNumber };
    case "copy": return { type: "COPY", displayText: stripBtnEmoji(b.title), copyCode: b.copyCode };
    default:     return { type: "REPLY", displayText: stripBtnEmoji((b as any).title), id: (b as any).id };
  }
}

/**
 * Carrossel de cards (native_flow). POST /send/carousel. Bruno 2026-06-11.
 * GOTCHA: rodapé é `footerText` (não `footer`); body do card é objeto `{ text }`;
 * número de cards >= 1. Botão de card NÃO suporta pix (cai pra /send/button).
 */
export async function sendCarousel(
  token: string,
  to: string,
  opts: { title?: string; body: string; footer?: string; cards: EvoCarouselCard[] },
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const r = await evoFetch("/send/carousel", {
    method: "POST",
    apikey: token,
    body: {
      number: onlyDigits(to),
      title: (opts.title || "").trim() || "Atendimento",
      description: opts.body,
      footerText: (opts.footer || "").trim() || "Toque numa opção",
      cards: opts.cards.map((c) => ({
        header: { title: c.title || "", subtitle: c.subtitle || "", imageUrl: c.imageUrl || "" },
        body: { text: c.text },
        ...(c.footer ? { footer: c.footer } : {}),
        buttons: c.buttons.slice(0, 3).map(buildCarouselButton),
      })),
    },
  });
  if (!r.ok) return { sent: false, error: r.error };
  return { sent: true, messageId: extractMessageId(r.data) };
}

/**
 * Link com card de preview rico. POST /send/link. Só `text` (corpo) é obrigatório;
 * url/title/description/imgUrl são metadados do card de preview (opcionais).
 */
export async function sendLink(
  token: string,
  to: string,
  opts: { text: string; url?: string; title?: string; description?: string; imgUrl?: string },
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const r = await evoFetch("/send/link", {
    method: "POST",
    apikey: token,
    body: {
      number: onlyDigits(to),
      text: opts.text,
      ...(opts.url ? { url: opts.url } : {}),
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.imgUrl ? { imgUrl: opts.imgUrl } : {}),
    },
  });
  if (!r.ok) return { sent: false, error: r.error };
  return { sent: true, messageId: extractMessageId(r.data) };
}
