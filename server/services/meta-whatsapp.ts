export interface MetaCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface WABADetails {
  id: string;
  name: string;
  currency: string;
  timezoneId: string;
}

export interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  platformType: string;
  messagingLimitTier?: string;
}

export interface SendTextResult {
  messageId: string;
}

export interface SendMediaResult {
  messageId: string;
}

export class MetaAPIError extends Error {
  statusCode: number;
  fbtrace_id?: string;
  constructor(message: string, statusCode: number, fbtrace_id?: string) {
    super(message);
    this.name = "MetaAPIError";
    this.statusCode = statusCode;
    this.fbtrace_id = fbtrace_id;
  }
}

const GRAPH_API = "https://graph.facebook.com/v21.0";

function formatPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = "55" + digits;
  return digits;
}

async function handleMetaError(response: Response, context: string): Promise<never> {
  let body: any = {};
  try {
    body = await response.json();
  } catch {}
  const err = body?.error || {};
  const msg = err.message || "Unknown error";
  const code = err.code || response.status;
  const fbtrace = err.fbtrace_id;
  throw new MetaAPIError(`[Meta ${context}] ${msg} (code: ${code})`, response.status, fbtrace);
}

async function metaFetch(url: string, options?: RequestInit, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) {
        if (attempt < retries && (res.status === 429 || res.status >= 500)) {
          clearTimeout(timeout);
          const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        await handleMetaError(res, options?.method || "GET");
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < retries && (err instanceof DOMException || (err as any)?.name === "AbortError")) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const url = `${GRAPH_API}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`;
  const data = await metaFetch(url);
  return data.access_token;
}

export async function getLongLivedToken(shortToken: string): Promise<{ token: string; expiresIn: number }> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const url = `${GRAPH_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
  const data = await metaFetch(url);
  return { token: data.access_token, expiresIn: data.expires_in };
}

export async function getWABADetails(wabaId: string, token: string): Promise<WABADetails> {
  const url = `${GRAPH_API}/${wabaId}?fields=id,name,currency,timezone_id&access_token=${token}`;
  const data = await metaFetch(url);
  return {
    id: data.id,
    name: data.name,
    currency: data.currency,
    timezoneId: data.timezone_id,
  };
}

export async function getPhoneNumbers(wabaId: string, token: string): Promise<PhoneNumberInfo[]> {
  const url = `${GRAPH_API}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type&access_token=${token}`;
  const data = await metaFetch(url);
  return (data.data || []).map((p: any) => ({
    id: p.id,
    displayPhoneNumber: p.display_phone_number,
    verifiedName: p.verified_name,
    qualityRating: p.quality_rating,
    platformType: p.platform_type,
  }));
}

export async function getPhoneNumberById(phoneNumberId: string, token: string): Promise<PhoneNumberInfo | null> {
  try {
    const url = `${GRAPH_API}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,messaging_limit_tier&access_token=${token}`;
    const data = await metaFetch(url);
    return {
      id: data.id,
      displayPhoneNumber: data.display_phone_number,
      verifiedName: data.verified_name,
      qualityRating: data.quality_rating,
      platformType: data.platform_type,
      messagingLimitTier: data.messaging_limit_tier,
    };
  } catch {
    return null;
  }
}

export async function subscribeWebhook(wabaId: string, token: string): Promise<boolean> {
  const url = `${GRAPH_API}/${wabaId}/subscribed_apps?access_token=${token}`;
  const data = await metaFetch(url, { method: "POST" });
  return data.success === true;
}

/**
 * Edita o texto de uma mensagem enviada. Bruno 2026-05-19:
 *
 * Meta Cloud API NÃO tem endpoint de "apagar pra todos" igual ao WhatsApp app
 * oficial. O caminho mais próximo é EDITAR o texto pra substituir o conteúdo
 * — usado no fluxo de "Apagar pra todos" do painel pra trocar a msg original
 * por "_Esta mensagem foi removida_" no celular do cliente.
 *
 * Endpoint: POST /<PHONE_NUMBER_ID>/messages com `message_id` no payload
 * referenciando a wamid da original. Janela: 15 minutos a partir do envio.
 * Só funciona pra texto (mídia não pode ser editada).
 */
export async function editTextMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
  originalMessageId: string;
}): Promise<{ messageId: string }> {
  const url = `${GRAPH_API}/${params.phoneNumberId}/messages`;
  const body: any = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(params.to),
    type: "text",
    text: { preview_url: false, body: params.text },
    message_id: params.originalMessageId,
  };
  const data = await metaFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { messageId: data.messages?.[0]?.id || params.originalMessageId };
}

export async function sendTextMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
  replyToMessageId?: string;
}): Promise<SendTextResult> {
  const url = `${GRAPH_API}/${params.phoneNumberId}/messages`;
  const body: any = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(params.to),
    type: "text",
    text: { preview_url: false, body: params.text },
  };
  if (params.replyToMessageId) {
    body.context = { message_id: params.replyToMessageId };
  }
  const data = await metaFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { messageId: data.messages[0].id };
}

/**
 * Faz upload de mídia DIRETO pra Meta /media endpoint e retorna o media_id.
 *
 * Bruno 2026-05-19: alternativa ao `mediaUrl` (que exige URL pública HTTPS
 * acessível pelos servidores da Meta — falha 131053 em dev local porque
 * Meta não consegue baixar de localhost). Com upload direto, o blob vai pela
 * conexão HTTPS já autenticada do app pra Meta — funciona em qualquer
 * ambiente (local, prod, atrás de proxy). Media ID retornado é válido por
 * 30 dias e pode ser referenciado em `sendMediaMessage` via `{ id: media_id }`.
 *
 * Endpoint: POST /v21.0/<phone_number_id>/media (multipart/form-data)
 */
export async function uploadMediaToMeta(params: {
  phoneNumberId: string;
  accessToken: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}): Promise<{ mediaId: string }> {
  const url = `${GRAPH_API}/${params.phoneNumberId}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  // Strip codec hints (ex: "audio/mp4;codecs=opus" → "audio/mp4")
  const cleanMime = params.mimeType.split(";")[0].trim().toLowerCase();
  form.append("type", cleanMime);
  // Web FormData aceita Blob — passamos um Blob do buffer.
  const blob = new Blob([params.buffer as any], { type: cleanMime });
  form.append("file", blob as any, params.filename || `upload.${cleanMime.split("/")[1] || "bin"}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}` },
    body: form as any,
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.id) {
    const errMsg = data?.error?.message || `HTTP ${resp.status}`;
    throw new MetaAPIError(`[Meta media upload] ${errMsg}`, resp.status, data?.error?.fbtrace_id);
  }
  return { mediaId: data.id };
}

export async function sendMediaMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  type: "image" | "audio" | "document" | "video";
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
  // Bruno 2026-05-19: pra audio, marca como voice note do WhatsApp (player
  // nativo com microfone) em vez de arquivo de áudio. Meta exige ogg/opus
  // pra que isso funcione.
  voice?: boolean;
  // Bruno 2026-05-19: reply nativo do WhatsApp — wamid da msg original citada.
  // Inclui context.message_id no payload Meta → cliente vê o quote.
  replyToMessageId?: string;
}): Promise<SendMediaResult> {
  const url = `${GRAPH_API}/${params.phoneNumberId}/messages`;
  // Bruno 2026-05-19: prefere `id` (upload direto) sobre `link` (URL pública).
  // `id` resolve o problema do Meta não conseguir baixar de localhost em dev e
  // de qualquer URL HTTP em prod. Caller passa um OU outro; mediaId tem
  // precedência se ambos forem fornecidos.
  const mediaPayload: any = params.mediaId
    ? { id: params.mediaId }
    : { link: params.mediaUrl };
  // Bruno 2026-05-19: Meta Cloud API só aceita `caption` em image/video/document
  // e `filename` SOMENTE em document. Em audio, qualquer um dos dois retorna
  // erro 100 ("Unexpected key 'filename' on param 'audio'") e o áudio não é
  // entregue. Caso real: log [AUDIO-DIAG-19/05] confirmou esse erro pra todo
  // áudio gravado no painel.
  if (params.caption && params.type !== "audio") {
    mediaPayload.caption = params.caption;
  }
  if (params.filename && params.type === "document") {
    mediaPayload.filename = params.filename;
  }
  if (params.voice && params.type === "audio") {
    mediaPayload.voice = true;
  }
  const body: any = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(params.to),
    type: params.type,
    [params.type]: mediaPayload,
  };
  if (params.replyToMessageId) {
    body.context = { message_id: params.replyToMessageId };
  }
  const data = await metaFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { messageId: data.messages[0].id };
}

export async function sendTemplateMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  language: string;
  components: any[];
}): Promise<SendTextResult> {
  const url = `${GRAPH_API}/${params.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: formatPhone(params.to),
    type: "template",
    template: {
      name: params.templateName,
      language: { code: params.language },
      components: params.components,
    },
  };
  const data = await metaFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { messageId: data.messages[0].id };
}

// ─── Contato (vCard) ─────────────────────────────────────────────────────────
// Bruno 2026-05-21: envio de contato pelo CRM. Cliente recebe um card no
// WhatsApp com nome + telefone(s) + email(s) + organização opcional. Formato
// definido na Meta Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/contacts-messages
export async function sendContactMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  contacts: Array<{
    name: string;
    phones: Array<{ number: string; type?: string | null; waId?: string | null }>;
    emails?: Array<{ email: string; type?: string | null }>;
    organization?: string | null;
  }>;
}): Promise<SendTextResult> {
  if (!params.contacts?.length) throw new Error("sendContactMessage: lista de contatos vazia");
  const url = `${GRAPH_API}/${params.phoneNumberId}/messages`;
  // Meta espera estrutura específica: name={formatted_name, first_name}, phones[],
  // emails[], org? Cada item precisa de tipo opcional (CELL/HOME/WORK).
  const apiContacts = params.contacts.map(c => {
    const fullName = (c.name || "").trim();
    const firstName = fullName.split(/\s+/)[0] || fullName || "Contato";
    return {
      name: { formatted_name: fullName || firstName, first_name: firstName },
      phones: (c.phones || []).map(p => ({
        phone: String(p.number || "").trim(),
        type: p.type || "CELL",
        ...(p.waId ? { wa_id: String(p.waId).replace(/\D/g, "") } : {}),
      })).filter(p => p.phone.length > 0),
      ...(c.emails && c.emails.length > 0 ? {
        emails: c.emails.map(e => ({
          email: e.email,
          type: e.type || "WORK",
        })),
      } : {}),
      ...(c.organization ? { org: { company: c.organization } } : {}),
    };
  });
  const body = {
    messaging_product: "whatsapp",
    to: formatPhone(params.to),
    type: "contacts",
    contacts: apiContacts,
  };
  const data = await metaFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { messageId: data.messages[0].id };
}

// ─── Localização ─────────────────────────────────────────────────────────────
// Bruno 2026-05-21: envio de localização (lat/long + nome/endereço opcional).
// Cliente recebe um pin clicável que abre no Google Maps ou app nativo.
export async function sendLocationMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}): Promise<SendTextResult> {
  if (!Number.isFinite(params.latitude) || !Number.isFinite(params.longitude)) {
    throw new Error("sendLocationMessage: latitude/longitude inválidos");
  }
  const url = `${GRAPH_API}/${params.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: formatPhone(params.to),
    type: "location",
    location: {
      latitude: params.latitude,
      longitude: params.longitude,
      ...(params.name ? { name: params.name } : {}),
      ...(params.address ? { address: params.address } : {}),
    },
  };
  const data = await metaFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { messageId: data.messages[0].id };
}

// A Meta Cloud API NÃO aceita typing indicator standalone — só funciona piggyback
// numa chamada de read receipt, conforme docs:
// https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
// O caminho real está em `markMessageAsRead(..., { typing: true })` abaixo.
// Mantemos esta função como no-op pra preservar o contrato do channel-router.
export async function sendTypingIndicator(_phoneNumberId: string, _accessToken: string, _to: string): Promise<void> {
  // intencionalmente vazio — Meta exige messageId; o typing real é disparado
  // junto do markMessageAsRead no webhook-meta logo que a mensagem do cliente chega.
  // Pra MANTER o "digitando" vivo durante o processamento / entre partes da
  // resposta, o channel-router re-chama markMessageAsRead({typing:true}) usando o
  // wamid cacheado por rememberInboundWamid/getInboundWamid (abaixo).
}

// Bruno 2026-06-13: a Meta só mostra "digitando" piggyback num markAsRead de uma
// mensagem RECEBIDA (precisa do wamid). Guardamos o wamid da última inbound por
// conversa pra re-disparar o typing durante o processamento e entre as partes da
// resposta (heartbeat). TTL curto pra não vazar memória.
const inboundWamidCache = new Map<number, { wamid: string; ts: number }>();
const WAMID_TTL_MS = 3 * 60 * 1000;

export function rememberInboundWamid(conversationId: number, wamid: string): void {
  if (!conversationId || !wamid) return;
  inboundWamidCache.set(conversationId, { wamid, ts: Date.now() });
  // limpeza preguiçosa: poda entradas vencidas quando o mapa cresce
  if (inboundWamidCache.size > 5000) {
    const cutoff = Date.now() - WAMID_TTL_MS;
    for (const [k, v] of inboundWamidCache) if (v.ts < cutoff) inboundWamidCache.delete(k);
  }
}

export function getInboundWamid(conversationId: number): string | null {
  const e = inboundWamidCache.get(conversationId);
  if (!e) return null;
  if (Date.now() - e.ts > WAMID_TTL_MS) { inboundWamidCache.delete(conversationId); return null; }
  return e.wamid;
}

export async function markMessageAsRead(
  phoneNumberId: string,
  accessToken: string,
  messageId: string,
  options: { typing?: boolean } = {},
): Promise<void> {
  const url = `${GRAPH_API}/${phoneNumberId}/messages`;
  const body: Record<string, any> = {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  };
  if (options.typing) {
    // Mostra "digitando..." pro cliente. A Meta encerra o indicator automaticamente
    // quando a resposta é enviada OU após ~25s (limite da API), o que vier primeiro.
    body.typing_indicator = { type: "text" };
  }
  try {
    await metaFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  } catch (e: any) { console.error("[Meta] markAsRead failed:", e.message); }
}

export async function syncTemplatesFromMeta(wabaId: string, token: string): Promise<any[]> {
  const url = `${GRAPH_API}/${wabaId}/message_templates?fields=id,name,category,language,status,components,quality_score,rejection_reason&limit=100&access_token=${token}`;
  const data = await metaFetch(url);
  return data.data || [];
}

export async function getMediaUrl(mediaId: string, accessToken: string): Promise<string> {
  const url = `${GRAPH_API}/${mediaId}?access_token=${accessToken}`;
  const data = await metaFetch(url);
  return data.url;
}

// Cap de tamanho de mídia: tunável via env. Default 25MB cobre todos os tipos
// reais (imagem ~5MB, áudio ~10MB, PDF ~20MB). Vídeo a Meta já limita a 16MB
// no upload e a gente não dá download de vídeo aqui — fica como margem.
// Acima disso, a chance é spam ou bug, e carregar em RAM compromete o VPS.
const META_MEDIA_MAX_BYTES = Number(process.env.META_MEDIA_MAX_BYTES || 25 * 1024 * 1024);
// Timeout do GET da CDN. 15s já é generoso — CDN da Meta entrega em <2s.
// Acima disso, é rede ruim ou Meta engasgada e prefiro abortar pra liberar
// a thread em vez de bloquear o webhook.
const META_MEDIA_TIMEOUT_MS = Number(process.env.META_MEDIA_TIMEOUT_MS || 15_000);

// Retry só pra erros transitórios. 401/403/404/410/413 = permanente, retry
// não resolve (token errado, media expirado no lado da Meta, oversized).
// Bruno 2026-05-21: imagens inbound aparecendo como "Imagem indisponível"
// porque downloadMetaMedia falhava 1x e o fallback gravava URL CDN (expira
// em ~5min). Retry pega falha transitória do CDN (5xx, ETIMEDOUT, ECONNRESET).
const META_MEDIA_RETRY_ATTEMPTS = Number(process.env.META_MEDIA_RETRY_ATTEMPTS || 3);
const META_MEDIA_RETRY_BASE_MS = Number(process.env.META_MEDIA_RETRY_BASE_MS || 1000);
function isTransientHttp(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}
function isTransientErr(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    err?.name === 'TimeoutError'
    || err?.name === 'AbortError'
    || msg.includes('etimedout') || msg.includes('econnreset')
    || msg.includes('enotfound') || msg.includes('econnrefused')
    || msg.includes('socket hang up') || msg.includes('network')
  );
}

export async function downloadMetaMedia(
  mediaId: string,
  accessToken: string,
  mimeType?: string,
  registerOpts?: { workspaceId: string; conversationId?: number | null },
): Promise<string | null> {
  let lastErrPreview = '';
  for (let attempt = 1; attempt <= META_MEDIA_RETRY_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === META_MEDIA_RETRY_ATTEMPTS;
    try {
      const result = await downloadMetaMediaOnce(mediaId, accessToken, mimeType, registerOpts);
      if (result) {
        if (attempt > 1) console.log(`[Meta] downloadMetaMedia success on attempt ${attempt}/${META_MEDIA_RETRY_ATTEMPTS} mediaId=${mediaId}`);
        return result;
      }
      // null sem exception = falha permanente classificada dentro (oversized, 4xx, body vazio).
      // Não retry.
      return null;
    } catch (err: any) {
      lastErrPreview = String(err?.message || err || '').slice(0, 120);
      const transient = isTransientErr(err) || (err?.httpStatus && isTransientHttp(err.httpStatus));
      if (!transient || isLastAttempt) {
        console.error(`[Meta] downloadMetaMedia ${isLastAttempt ? 'gave up' : 'permanent'} mediaId=${mediaId} attempt=${attempt}: ${lastErrPreview}`);
        return null;
      }
      const delay = META_MEDIA_RETRY_BASE_MS * Math.pow(3, attempt - 1);
      console.warn(`[Meta] downloadMetaMedia transient err attempt=${attempt}/${META_MEDIA_RETRY_ATTEMPTS} mediaId=${mediaId}: ${lastErrPreview} — retry em ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

async function downloadMetaMediaOnce(
  mediaId: string,
  accessToken: string,
  mimeType?: string,
  registerOpts?: { workspaceId: string; conversationId?: number | null },
): Promise<string | null> {
  try {
    const cdnUrl = await getMediaUrl(mediaId, accessToken);
    if (!cdnUrl) return null;

    const res = await fetch(cdnUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(META_MEDIA_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 5xx / 429 / 408 = transitório → throw pra retry no caller.
      if (isTransientHttp(res.status)) {
        const e: any = new Error(`HTTP ${res.status}`);
        e.httpStatus = res.status;
        throw e;
      }
      console.error(`[Meta] Media download failed (permanent): ${res.status} for mediaId=${mediaId}`);
      return null;
    }

    // Pre-check via Content-Length: rejeita antes de baixar 1 byte.
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > META_MEDIA_MAX_BYTES) {
      console.warn(`[Meta] Media rejected: size ${contentLength}b > cap ${META_MEDIA_MAX_BYTES}b for mediaId=${mediaId}`);
      return null;
    }

    const { resolve: pathResolve } = await import("path");
    const { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync } = await import("fs");
    const { Readable } = await import("stream");
    const { pipeline } = await import("stream/promises");

    // Bruno 2026-06-02: uploadsDir centralizado (honra UPLOAD_DIR; default
    // CWD/uploads) — serving e gravação não divergem. Import dinâmico segue o
    // estilo lazy desta função.
    const { uploadsDir: uploadDir } = await import("../utils/uploadsDir");
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

    let ext = "bin";
    if (mimeType) {
      if (mimeType.includes("ogg")) ext = "ogg";
      else if (mimeType.includes("opus")) ext = "ogg";
      else if (mimeType.includes("mp4")) ext = "mp4";
      else if (mimeType.includes("mpeg") || mimeType.includes("mp3")) ext = "mp3";
      else if (mimeType.includes("amr")) ext = "amr";
      else if (mimeType.includes("wav")) ext = "wav";
      else if (mimeType.includes("webm")) ext = "webm";
      else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) ext = "jpeg";
      else if (mimeType.includes("png")) ext = "png";
      else if (mimeType.includes("pdf")) ext = "pdf";
      else if (mimeType.includes("webp")) ext = "webp";
    }

    const filename = `meta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = pathResolve(uploadDir, filename);

    // Stream do response.body direto pro disco, sem carregar em RAM.
    // Aborta se ultrapassar o cap durante o streaming (caso o servidor
    // não tenha mandado Content-Length ou tenha mentido).
    let bytesWritten = 0;
    let oversized = false;
    const out = createWriteStream(filePath);
    if (!res.body) {
      console.error(`[Meta] Media response sem body para mediaId=${mediaId}`);
      out.close();
      try { unlinkSync(filePath); } catch {}
      return null;
    }
    const nodeStream = Readable.fromWeb(res.body as any);
    nodeStream.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      if (bytesWritten > META_MEDIA_MAX_BYTES) {
        oversized = true;
        nodeStream.destroy(new Error('media_oversize'));
      }
    });
    try {
      await pipeline(nodeStream, out);
    } catch (err: any) {
      try { unlinkSync(filePath); } catch {}
      if (oversized) {
        console.warn(`[Meta] Media truncated mid-stream: bytes=${bytesWritten} > cap ${META_MEDIA_MAX_BYTES} mediaId=${mediaId}`);
      } else {
        console.error(`[Meta] Media stream error mediaId=${mediaId}:`, err.message);
      }
      return null;
    }
    if (statSync(filePath).size < 100) {
      try { unlinkSync(filePath); } catch {}
      console.error(`[Meta] Media too small (${bytesWritten}b) for mediaId=${mediaId}`);
      return null;
    }
    const localUrl = `/uploads/${filename}`;

    // LGPD: registra mídia pra retenção controlada. Best-effort — falha aqui
    // NÃO afeta o fluxo de mensagem.
    if (registerOpts?.workspaceId) {
      try {
        const { registerMediaAsset, inferMediaCategory, getRetentionDaysForTenant } =
          await import('./mediaRetentionService');
        const category = inferMediaCategory({ mimeType });
        const retentionDays = await getRetentionDaysForTenant(registerOpts.workspaceId);
        await registerMediaAsset({
          workspaceId: registerOpts.workspaceId,
          conversationId: registerOpts.conversationId ?? null,
          mediaUrl: localUrl,
          mimeType,
          category,
          source: 'meta',
          retentionDays,
        });
      } catch (regErr: any) {
        console.warn(`[Meta] registerMediaAsset skipped: ${regErr?.message || regErr}`);
      }
    }

    return localUrl;
  } catch (err: any) {
    // Re-throw transitórios pro caller (downloadMetaMedia) decidir retry.
    // Permanentes (404, oversized fora do streaming, etc) já caem em return null
    // ANTES de chegar aqui. Esse catch pega exceptions de rede/timeout.
    if (isTransientErr(err) || (err?.httpStatus && isTransientHttp(err.httpStatus))) {
      throw err;
    }
    console.error(`[Meta] downloadMetaMediaOnce permanent error mediaId=${mediaId}:`, err?.message || err);
    return null;
  }
}
