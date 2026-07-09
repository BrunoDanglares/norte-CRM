// server/routes/webhook-evolution.ts
// Webhook de RECEBIMENTO do canal **Evolution GO** (whatsmeow) — Bruno 2026-06-09.
//
// Espelha o padrão do webhook-meta: identifica a conexão pela instância, normaliza
// a mensagem, cria/atualiza lead+contato+conversa+mensagem e despacha pro motor via
// processIncomingMessageForAutomation (que é AGNÓSTICO de canal: buffer + guards +
// reopen + automação rodam lá dentro).
//
// ⚠️ SHAPE DO PAYLOAD: o Evolution GO entrega eventos whatsmeow. O formato exato do
// evento "Message" só é 100% confirmável com tráfego real (Fase 3). Por isso a
// normalização aqui é DEFENSIVA (cobre o formato whatsmeow nativo {Info,Message} e
// o formato "achatado" estilo Evolution clássica {key,message,pushName}) e logamos
// o payload bruto da 1ª mensagem por instância pra calibrar.
//
// Webhook configurado por instância no /instance/connect (evolutionAdapter), todas
// apontando pra este endpoint. A instância vem em payload.instance → conexoes.instanceId.

import type { Express } from "express";
import { timingSafeEqual } from "crypto";
import { db } from "../db";
import { conexoes, conversations, contacts, messages, mensagensLog, leads } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../storage";
import { processIncomingMessageForAutomation, type IncomingMessage } from "../services/message-processor";
import { upsertContactByPhone } from "../utils/contactSync";
import { isDuplicate } from "../utils/processedMessages";
import { findRecentDuplicateInbound } from "../utils/messageInsert";
import { broadcastToWorkspace } from "../services/broadcast";

// Canal exibido na UI — rótulo do canal WhatsApp não-oficial.
const EVO_CANAL = "WhatsApp";

// Loga o payload bruto só 1x por instância (pra descobrir o shape real sem floodar).
const rawLogged = new Set<string>();

// Defesa contra spoofing cross-tenant: o instanceId NÃO é secreto (vaza via
// WebSocket/URLs), então sem um segredo qualquer um poderia forjar inbound em
// qualquer workspace. Se EVOLUTION_WEBHOOK_SECRET está setado, exige ?secret=.
let secretWarned = false;
function webhookSecretOk(req: any): boolean {
  const expected = (process.env.EVOLUTION_WEBHOOK_SECRET || "").trim();
  if (!expected) {
    if (!secretWarned) {
      secretWarned = true;
      console.warn("[Evolution Webhook] ⚠️ EVOLUTION_WEBHOOK_SECRET não configurado.");
    }
    // Bruno 2026-06-14 (auditoria): em PRODUÇÃO sem segredo = fail-closed (recusa),
    // pra evitar spoofing cross-tenant se a env for removida. Em dev, aceita com aviso.
    return process.env.NODE_ENV !== "production";
  }
  const got = String(req.query?.secret || "");
  const a = Buffer.from(got), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export function registerEvolutionWebhookRoutes(app: Express) {
  app.post("/api/webhook/evolution", (req, res) => {
    if (!webhookSecretOk(req)) { res.sendStatus(401); return; }
    // ACK imediato — Evolution só quer 2xx; processamos assíncrono.
    res.sendStatus(200);
    const payload = req.body;
    setImmediate(() => {
      processEvolutionWebhook(payload).catch((e: any) =>
        console.error("[Evolution Webhook] erro:", e?.message || e),
      );
    });
  });
}

function pick(...vals: any[]): any {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}
function eventName(p: any): string {
  return String(pick(p?.event, p?.type, p?.Event, p?.eventType) || "").toLowerCase();
}
function onlyDigits(s: any): string {
  return String(s ?? "").replace(/\D/g, "");
}
/** Extrai o telefone de um JID whatsmeow (5599...@s.whatsapp.net / ...@lid / ...:0@...). */
function phoneFromJid(jid: any): string {
  const s = String(jid ?? "");
  const user = s.split("@")[0].split(":")[0];
  return onlyDigits(user);
}

async function processEvolutionWebhook(payload: any) {
  if (!payload || typeof payload !== "object") return;
  const instanceName = pick(payload.instance, payload.instanceName, payload.Instance, payload.instanceId);
  if (!instanceName) {
    console.warn("[Evolution Webhook] payload sem instance:", JSON.stringify(payload).slice(0, 300));
    return;
  }
  const [conexao] = await db
    .select()
    .from(conexoes)
    .where(eq(conexoes.instanceId, String(instanceName)))
    .limit(1);
  if (!conexao || !conexao.workspaceId) {
    console.warn(`[Evolution Webhook] sem conexão p/ instance=${instanceName}`);
    return;
  }
  const wsId = conexao.workspaceId;
  const ev = eventName(payload);

  // Log bruto 1x por instância — calibração do shape (Fase 3).
  if (!rawLogged.has(String(instanceName))) {
    rawLogged.add(String(instanceName));
    // Bruno 2026-06-18 (auditoria LGPD): loga só a ESTRUTURA (keys), não os valores —
    // antes despejava pushName + telefone + texto da mensagem crus no log.
    const shapeKeys = (o: any) => (o && typeof o === "object" ? Object.keys(o) : typeof o);
    console.log(`[Evolution Webhook] (1º payload instance=${instanceName} event=${ev}) shape:`, JSON.stringify({ top: shapeKeys(payload), data: shapeKeys(payload?.data), message: shapeKeys(payload?.message), Info: shapeKeys(payload?.Info), Message: shapeKeys(payload?.Message) }));
  }

  if (ev.includes("message")) return handleMessageEvent(payload, conexao, wsId);
  if (ev.includes("receipt")) return handleReceiptEvent(payload, conexao, wsId);
  if (ev.includes("connect") || ev.includes("disconnect") || ev.includes("logout") || ev.includes("loggedout")) {
    return handleConnectionEvent(payload, conexao, wsId, ev);
  }
  // demais eventos (presence, etc) — ignorados por ora.
}

// ─── Normalização defensiva de uma mensagem inbound ──────────────────────────
export interface NormalizedMsg {
  externalId: string;
  fromMe: boolean;
  phone: string;
  pushName: string | null;
  text: string;
  type: string;            // text | image | audio | video | document | location | contact
  mediaB64?: string | null;
  mediaMime?: string | null;
  filename?: string | null;
  timestampSec?: number | null;
  /** id do botão/linha clicado (paridade Meta interactive.button_reply.id). */
  buttonId?: string | null;
  /** Metadata estruturada (location: lat/lng/name/address; contact: contacts[]). */
  mediaMetadata?: any;
  /** externalId da msg CITADA quando o cliente responde marcando (paridade Meta context.id). */
  replyToExternalId?: string | null;
}

export function normalizeEvoMessage(payload: any): NormalizedMsg | null {
  // data pode estar em payload.data, payload.message, ou ser o próprio payload.
  const d = pick(payload.data, payload.message, payload) || {};
  const info = pick(d.Info, d.info, d.key) || {};
  const msg = pick(d.Message, d.message) || {};

  const externalId = String(pick(info.ID, info.Id, info.id, d.id, d.messageId, msg.id) || "");
  const fromMe = !!pick(info.IsFromMe, info.fromMe, d.fromMe, d.FromMe);
  const jid = pick(info.Chat, info.RemoteJID, info.remoteJid, d.remoteJid, d.sender, d.from, d.chat);
  // GUARD: whatsmeow entrega mensagem de GRUPO
  // (@g.us), status@broadcast e newsletter — o bot NÃO pode responder nesses.
  // Rejeita ANTES de tratar o JID como "telefone de cliente".
  const rawJid = String(jid ?? "");
  if (rawJid.endsWith("@g.us") || rawJid.endsWith("@broadcast") || rawJid.endsWith("@newsletter")) return null;

  // LID (@lid) — endereço ANÔNIMO do WhatsApp: o número antes do @lid NÃO é o
  // telefone do cliente. Se gravarmos ele como telefone, ficha/CPF/ERP nunca casam
  // (cliente vira fantasma novo a cada msg). O whatsmeow manda o JID REAL (phone
  // number) num campo alternativo (SenderAlt/RecipientAlt/senderPn). Resolve a
  // partir dele; só usa o LID como último recurso (e instrumenta pra calibrar).
  let phoneJid = rawJid;
  if (rawJid.endsWith("@lid")) {
    const altCandidates = [
      info.SenderAlt, info.senderAlt, info.RecipientAlt, info.recipientAlt,
      info.Sender, info.sender, info.Participant, info.participant,
      d.senderPn, d.participantPn, d.participant, d.senderJid, d.chatJid,
    ];
    const realJid = altCandidates.map((x) => String(x ?? "")).find((s) => s.endsWith("@s.whatsapp.net"));
    if (realJid) phoneJid = realJid;
    else logUnresolvedLid(payload, info, rawJid);
  }

  // Eventos de SISTEMA do whatsmeow (NÃO são mensagens do cliente): protocolMessage
  // (apagar/editar msg, config de mensagem temporária), reações, chaves de grupo,
  // votos de enquete. Ignora pra o bot NÃO responder a ruído interno do WhatsApp
  // (bug visto na Nekt — protocolMessage virava "[mensagem]" + resposta do bot).
  const sysHit = pick(
    msg.protocolMessage, d.protocolMessage,
    msg.reactionMessage, d.reactionMessage,
    msg.senderKeyDistributionMessage, d.senderKeyDistributionMessage,
    msg.pollUpdateMessage, d.pollUpdateMessage,
  );
  const mtypeLower = String(pick(d.messageType, d.type, d.MessageType, d.Type) || "").toLowerCase();
  const isSysType = ["protocol", "reaction", "senderkey", "pollupdate", "ephemeral", "appstate"].some((k) => mtypeLower.includes(k));
  if (sysHit || isSysType) return null;

  const phone = phoneFromJid(phoneJid);
  const pushName = pick(info.PushName, d.pushName, d.senderName, d.notifyName) || null;

  // texto: conversation / extendedText / caption
  let text = String(
    pick(
      msg.conversation,
      msg.extendedTextMessage?.text,
      d.text,
      d.body,
      d.conversation,
      d.caption,
    ) || "",
  );

  // tipo de mídia
  let type = "text";
  let mediaMime: string | null = null;
  let filename: string | null = null;
  let mediaMetadata: any = null;
  // CRÍTICO (Bruno 2026-06-12): o Evolution GO (fork) entrega o binário JÁ DECIFRADO
  // em base64 DENTRO do Message — `payload.data.Message.base64` — ao lado do
  // imageMessage/audioMessage/documentMessage. NÃO vem no nível `data`. Antes só
  // líamos `d.base64` → ficava null → mídia inbound (imagem/áudio/PDF/vídeo) nunca
  // era salva (arquivo NULL) → visão/transcrição sem bytes ("não consegui ler a
  // imagem", "[áudio]"). Lê do Message primeiro; mantém os fallbacks data-level.
  let mediaB64: string | null = pick(
    msg.base64, msg.Base64, msg.b64,
    d.base64, d.media, d.fileBase64, d.Base64, d.Media, d.FileBase64,
  ) || null;

  const im = pick(msg.imageMessage, d.imageMessage);
  const am = pick(msg.audioMessage, d.audioMessage);
  const vm = pick(msg.videoMessage, d.videoMessage);
  const dm = pick(msg.documentMessage, d.documentMessage);
  const sm = pick(msg.stickerMessage, d.stickerMessage);
  const locm = pick(msg.locationMessage, d.locationMessage, msg.liveLocationMessage, d.liveLocationMessage);
  const conm = pick(msg.contactMessage, d.contactMessage);
  const conarr = pick(msg.contactsArrayMessage, d.contactsArrayMessage);
  if (im) { type = "image"; mediaMime = pick(im.mimetype, "image/jpeg"); if (!text) text = pick(im.caption, "") || ""; }
  else if (am) { type = "audio"; mediaMime = pick(am.mimetype, "audio/ogg"); }
  else if (vm) { type = "video"; mediaMime = pick(vm.mimetype, "video/mp4"); if (!text) text = pick(vm.caption, "") || ""; }
  else if (dm) { type = "document"; mediaMime = pick(dm.mimetype, "application/octet-stream"); filename = pick(dm.fileName, dm.filename) || null; }
  else if (sm) { type = "image"; mediaMime = pick(sm.mimetype, "image/webp"); }
  else if (locm) {
    // Localização → ESTRUTURADA (paridade Meta): type='location' + metadata
    // lat/lng/name/address. Frontend renderiza bolha com mini-mapa + "abrir no
    // Maps". Texto humanizado segue como fallback (preview de lista, push).
    const lat = pick(locm.degreesLatitude, locm.latitude, locm.lat);
    const lon = pick(locm.degreesLongitude, locm.longitude, locm.lng, locm.lon);
    const nm = String(pick(locm.name, "") || "");
    const addr = String(pick(locm.address, "") || "");
    if (lat != null && lon != null) {
      type = "location";
      mediaMetadata = { latitude: lat, longitude: lon, name: nm || null, address: addr || null };
    }
    const label = [nm, addr].filter(Boolean).join(" — ");
    text = (lat != null && lon != null)
      ? `📍 ${label || `Localização (${lat}, ${lon})`}`
      : (text || "📍 [localização recebida]");
  }
  else if (conm || conarr) {
    // Contato/vCard → ESTRUTURADO (paridade Meta): type='contact' + metadata
    // .contacts[] {name, phones[], emails[], organization}. Frontend renderiza
    // card com "Salvar"/"Abrir chat". Parseia o vCard (whatsmeow não separa campos).
    const list: any[] = conarr && Array.isArray(conarr.contacts) ? conarr.contacts : [conm].filter(Boolean);
    const parsed = list.map((c) => {
      const dn = String(pick(c?.displayName, c?.name, "") || "");
      const vcard = String(pick(c?.vcard, c?.Vcard, "") || "");
      const phones = Array.from(vcard.matchAll(/TEL[^:]*:\s*([+\d][\d\s().-]{6,})/gi))
        .map((mt) => ({ number: mt[1].trim().replace(/[^\d+]/g, ""), type: null as any, waId: null as any }))
        .filter((p) => p.number);
      const emails = Array.from(vcard.matchAll(/EMAIL[^:]*:\s*([^\s;,]+@[^\s;,]+)/gi))
        .map((mt) => ({ email: mt[1].trim(), type: null as any }));
      const orgMatch = vcard.match(/ORG[^:]*:\s*([^\r\n]+)/i);
      const fnMatch = vcard.match(/FN[^:]*:\s*([^\r\n]+)/i);
      return { name: dn || (fnMatch ? fnMatch[1].trim() : ""), phones, emails, organization: orgMatch ? orgMatch[1].trim() : null };
    });
    type = "contact";
    mediaMetadata = { contacts: parsed };
    const firstName = parsed[0]?.name || "";
    const firstPhone = parsed[0]?.phones?.[0]?.number || "";
    const extra = parsed.length > 1 ? ` +${parsed.length - 1}` : "";
    text = firstName ? `📇 ${firstName}${firstPhone ? ` (${firstPhone})` : ""}${extra}` : `📇 Contato compartilhado`;
  }
  else if (d.mediaType || d.messageType) {
    const mt = String(pick(d.mediaType, d.messageType)).toLowerCase();
    if (mt.includes("image")) { type = "image"; mediaMime = "image/jpeg"; }
    else if (mt.includes("audio") || mt.includes("ptt")) { type = "audio"; mediaMime = "audio/ogg"; }
    else if (mt.includes("video")) { type = "video"; mediaMime = "video/mp4"; }
    else if (mt.includes("document")) { type = "document"; }
  }

  const tsRaw = pick(info.Timestamp, info.timestamp, d.messageTimestamp, d.timestamp);
  let timestampSec: number | null = null;
  if (tsRaw) {
    const n = Number(tsRaw);
    if (Number.isFinite(n)) timestampSec = n > 1e12 ? Math.floor(n / 1000) : n; // ms→s se vier em ms
    else { const p = Date.parse(String(tsRaw)); if (Number.isFinite(p)) timestampSec = Math.floor(p / 1000); } // RFC3339/ISO
  }

  // CLIQUE de botão/lista (whatsmeow): selectedButtonID / selectedRowID / template /
  // NATIVE_FLOW. Bruno 2026-06-11: a go-version-0.7 manda o clique do botão reply como
  // interactiveResponseMessage.nativeFlowResponseMessage.paramsJson = {"id":"<buttonId>"}
  // (e o Evolution às vezes já entrega o id em d.buttonId). O motor consome via buttonId
  // (igual webhook-meta) + resolveButtonId no fallback.
  const brm = pick(msg.buttonsResponseMessage, d.buttonsResponseMessage);
  const lrm = pick(msg.listResponseMessage, d.listResponseMessage);
  const trm = pick(msg.templateButtonReplyMessage, d.templateButtonReplyMessage);
  const irm = pick(msg.interactiveResponseMessage, d.interactiveResponseMessage, msg.InteractiveResponseMessage, d.InteractiveResponseMessage);
  const nfr = pick(irm?.nativeFlowResponseMessage, irm?.NativeFlowResponseMessage);
  let nativeFlowId: string | null = null;
  const nfParams = pick(nfr?.paramsJson, nfr?.ParamsJSON, nfr?.paramsJSON);
  if (nfParams) {
    try {
      const p = typeof nfParams === "string" ? JSON.parse(nfParams) : nfParams;
      if (p?.id) nativeFlowId = String(p.id);
    } catch { /* paramsJson malformado — ignora */ }
  }
  const btnRaw = pick(
    brm?.selectedButtonID, brm?.selectedButtonId,
    lrm?.singleSelectReply?.selectedRowID, lrm?.singleSelectReply?.selectedRowId,
    trm?.selectedID, trm?.selectedId,
    nativeFlowId,
    d.selectedButtonId, d.selectedRowId, d.buttonId,
  );
  const buttonId = btnRaw ? String(btnRaw) : null;
  if (buttonId && !text) {
    text = String(pick(brm?.selectedDisplayText, trm?.selectedDisplayText, lrm?.title, irm?.body?.text, irm?.Body?.text, d.selectedDisplayText, "") || "");
  }

  // "Respondendo a..." (quoted) — paridade Meta (msg.context.id). O whatsmeow põe
  // o id da msg CITADA em contextInfo.stanzaId, dentro do tipo de msg (texto ou
  // mídia). Capturamos pra vincular a resposta à msg original no painel.
  const ctxInfo = pick(
    msg.extendedTextMessage?.contextInfo,
    im?.contextInfo, am?.contextInfo, vm?.contextInfo, dm?.contextInfo,
    msg.contextInfo, d.contextInfo,
  ) || {};
  const replyToExternalId = String(
    pick(ctxInfo.stanzaId, ctxInfo.stanzaID, ctxInfo.StanzaID, ctxInfo.quotedMessageId, ctxInfo.quotedStanzaID) || "",
  ) || null;

  if (!phone || !externalId) return null;
  // Sem conteúdo real (texto vazio + não-mídia + sem clique de botão) → mensagem
  // vazia/desconhecida que NÃO deve disparar o bot. Mídia (type≠text) sempre passa.
  if (type === "text" && !text.trim() && !buttonId) return null;
  return { externalId, fromMe, phone, pushName, text, type, mediaB64, mediaMime, filename, timestampSec, buttonId, mediaMetadata, replyToExternalId };
}

// Reação (emoji) do cliente — paridade Meta. whatsmeow: reactionMessage.text = emoji,
// reactionMessage.key.ID = id da mensagem reagida. NÃO vira bolha; atualiza os chips
// embaixo da mensagem original no painel (broadcast reaction_updated).
export function extractEvoReaction(payload: any): { emoji: string; targetId: string } | null {
  const d = pick(payload.data, payload.message, payload) || {};
  const msg = pick(d.Message, d.message) || {};
  const rm = pick(msg.reactionMessage, d.reactionMessage);
  if (!rm) return null;
  const key = pick(rm.key, rm.Key) || {};
  const targetId = String(pick(key.ID, key.Id, key.id, rm.messageID, rm.messageId) || "");
  if (!targetId) return null;
  return { emoji: String(pick(rm.text, rm.Text, "") || "").trim(), targetId };
}

async function handleEvoReaction(reaction: { emoji: string; targetId: string }, wsId: string) {
  try {
    const { messageReactions } = await import("@shared/schema");
    const [originalMsg] = await db
      .select({ id: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .where(and(eq(messages.externalMessageId, reaction.targetId), eq(messages.workspaceId, wsId)))
      .limit(1);
    if (!originalMsg) {
      console.log(`[Evolution] reaction descartada — msg original não achada (id=${reaction.targetId.slice(-12)})`);
      return;
    }
    // 1 reação por cliente/msg: remove a anterior e aplica a nova (emoji vazio = remoção).
    await db.delete(messageReactions).where(and(
      eq(messageReactions.messageId, originalMsg.id),
      eq(messageReactions.userId, 0),
      eq(messageReactions.workspaceId, wsId),
    ));
    let action: "added" | "removed" = "removed";
    if (reaction.emoji) {
      await db.insert(messageReactions).values({
        messageId: originalMsg.id,
        conversationId: originalMsg.conversationId,
        workspaceId: wsId,
        userId: 0,
        userName: "Cliente",
        emoji: reaction.emoji,
      } as any);
      action = "added";
    }
    broadcastToWorkspace(wsId, "reaction_updated", {
      messageId: originalMsg.id,
      conversationId: originalMsg.conversationId,
      emoji: reaction.emoji,
      userId: 0,
      userName: "Cliente",
      action,
    });
    console.log(`[Evolution] reaction ${action} msgId=${originalMsg.id} emoji=${reaction.emoji || "(vazio)"}`);
  } catch (e: any) {
    console.error(`[Evolution] reaction handler error:`, e.message);
  }
}

// Calibração Fase 3: shape da mídia inbound (1x por instância+tipo) — descobre se
// a mídia vem em base64 no webhook ou se precisa de endpoint de download externo.
const mediaShapeLogged = new Set<string>();
function logEvoMediaShape(conexao: any, payload: any, m: NormalizedMsg) {
  try {
    const key = `${conexao.instanceId || conexao.id}:${m.type}`;
    if (mediaShapeLogged.has(key)) return;
    mediaShapeLogged.add(key);
    const d = pick(payload.data, payload.message, payload) || {};
    const msg = pick(d.Message, d.message) || {};
    const mm = pick(
      msg.imageMessage, msg.audioMessage, msg.videoMessage, msg.documentMessage,
      d.imageMessage, d.audioMessage, d.videoMessage, d.documentMessage,
    ) || {};
    const shape = {
      type: m.type,
      payloadKeys: Object.keys(payload || {}),
      dataKeys: Object.keys(d || {}),
      msgKeys: Object.keys(msg || {}),
      mediaMsgKeys: Object.keys(mm || {}),
      hasBase64: !!m.mediaB64, base64Len: m.mediaB64 ? m.mediaB64.length : 0,
      // Confirma se o fork populou o base64 DENTRO do Message (o caminho do fix).
      msgBase64Len: typeof (msg as any)?.base64 === "string" ? (msg as any).base64.length : 0,
      mime: m.mediaMime,
      urlField: mm.url || mm.URL || mm.directPath || null,
      mediaKeyPresent: !!(mm.mediaKey || mm.MediaKey),
    };
    console.log(`[Evolution Webhook] 📦 MEDIA SHAPE (${key}):`, JSON.stringify(shape).slice(0, 800));
    db.insert(mensagensLog).values({
      conexaoId: conexao.id, direction: "in", fromNumber: m.phone, toNumber: null,
      content: `[evo-media-shape:${m.type}]`, messageId: m.externalId, status: "debug",
      rawPayload: shape as any,
    }).catch(() => {});
  } catch {}
}

// Instrumentação: LID que NÃO conseguimos resolver pro telefone real (1x por
// instância) — loga as chaves do Info pra descobrir onde vem o phone-number JID.
const lidUnresolvedLogged = new Set<string>();
function logUnresolvedLid(payload: any, info: any, rawJid: string) {
  try {
    const inst = String(pick(payload?.instance, payload?.instanceName) || "?");
    if (lidUnresolvedLogged.has(inst)) return;
    lidUnresolvedLogged.add(inst);
    console.warn(`[Evolution Webhook] ⚠️ LID não resolvido (${rawJid}) — Info keys:`, Object.keys(info || {}).join(","), "| amostra:", JSON.stringify(info).slice(0, 400));
  } catch {}
}

// Resposta de CSAT pendente: número 1-10 numa conv resolvida que está aguardando
// avaliação (paridade webhook-meta). Mantém a conv resolvida pra registrar a nota.
async function isPendingCsatReply(_conversationId: number, _wsId: string, _text: string): Promise<boolean> {
  // CSAT/protocolos ISP removidos — não há mais estado de CSAT pendente.
  return false;
}

async function handleMessageEvent(payload: any, conexao: any, wsId: string) {
  // Reação (emoji) — paridade Meta: atualiza os chips no painel, NÃO vira mensagem
  // nem roda o bot. Intercepta antes do normalize (que descarta reactionMessage).
  const reaction = extractEvoReaction(payload);
  if (reaction) {
    const rd = pick(payload.data, payload.message, payload) || {};
    const rinfo = pick(rd.Info, rd.info, rd.key) || {};
    const reactFromMe = !!pick(rinfo.IsFromMe, rinfo.fromMe, rd.fromMe, rd.FromMe);
    if (!reactFromMe && !isDuplicate(`evo-react:${reaction.targetId}:${reaction.emoji}`)) {
      await handleEvoReaction(reaction, wsId);
    }
    return;
  }

  const m = normalizeEvoMessage(payload);
  if (!m) {
    // Status/stories e broadcast/newsletter do WhatsApp NÃO normalizam de propósito
    // (não são conversa). Eram a fonte do ruído `msg não normalizável` no log.
    // Loga só o que for GENUINAMENTE inesperado — ajuda a achar bug real sem poluir.
    const d = pick(payload.data, payload.message, payload) || {};
    const info = pick(d.Info, d.info, d.key) || {};
    const chat = String(pick(info.Chat, info.RemoteJid, info.remoteJid, d.Chat, d.remoteJid) || "");
    const benigno = /broadcast|status@|@newsletter/i.test(chat);
    if (!benigno) console.warn("[Evolution Webhook] msg não normalizável:", JSON.stringify(payload).slice(0, 400));
    return;
  }
  if (m.fromMe) return; // eco do que NÓS enviamos — ignora.

  // Dedup global por externalId (whatsmeow reentrega) — memória + banco (sobrevive
  // a restart do processo, ≠ isDuplicate que é só em memória).
  if (isDuplicate(`evo:${m.externalId}`)) return;
  {
    const [dupRow] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.workspaceId, wsId), eq(messages.externalMessageId, m.externalId), eq(messages.direction, "in")))
      .limit(1);
    if (dupRow) return;
  }

  // Replay tardio (>5min) — evita reprocessar histórico em reconexão.
  if (m.timestampSec) {
    const ageSec = Math.floor(Date.now() / 1000) - m.timestampSec;
    if (ageSec > 5 * 60) {
      console.log(`[Evolution Webhook] replay tardio (${ageSec}s) ignorado phone=${m.phone}`);
      return;
    }
  }

  // Paridade Meta: na Evolution o cliente NÃO clica botão (o WhatsApp descarta menus
  // interativos em canal não-oficial, então enviamos as opções como TEXTO NUMERADO).
  // Ele responde DIGITANDO o número → traduz "1/2/3" no id do botão lendo o último
  // menu interactive da conversa. (Também cobre cliente que digita em vez de clicar.)
  let effectiveButtonId = m.buttonId;
  if (!effectiveButtonId && m.text && /^\d{1,2}[.\)\-º°:]?$/.test(m.text.trim())) {
    try {
      const convForBtn = await storage.getConversationByPhoneAndCanal(m.phone, EVO_CANAL, wsId);
      if (convForBtn) {
        const { resolveNumberedButtonReply } = await import("../utils/numberedReply");
        const mapped = await resolveNumberedButtonReply(wsId, convForBtn.id, m.text);
        if (mapped) {
          effectiveButtonId = mapped;
          console.log(`[Evolution] número "${m.text.trim()}" → botão "${mapped}" (paridade Meta)`);
        }
      }
    } catch (e: any) { console.warn("[Evolution] resolveNumberedButtonReply erro:", e?.message); }
  }

  // Clique de botão/lista de AUTOMAÇÃO VISUAL pendente (builder reactflow) — resume o flow.
  if (effectiveButtonId) {
    try {
      const { handlePendingInteractiveResponse } = await import("../services/message-processor");
      const handled = await handlePendingInteractiveResponse(wsId, m.phone, effectiveButtonId, m.text || "");
      if (handled) return;
    } catch (e: any) { console.warn("[Evolution] pending interactive erro:", e?.message); }
  }

  const phone = m.phone;
  const contactName = m.pushName || phone;

  // ── Mídia inbound (Fase 3): baixa pro /uploads e transcreve áudio ─────────────
  let content = m.text;
  let mediaType: string | undefined;
  let mediaUrl: string | null = null;
  let mediaMime: string | null = m.mediaMime || null;
  // Só image/audio/video/document têm binário pra baixar. location/contact são
  // estruturados (metadata, sem arquivo) — pulam o download mas mantêm o tipo.
  const DOWNLOADABLE_MEDIA = new Set(["image", "audio", "video", "document"]);
  if (m.type !== "text") {
    mediaType = m.type;
    if (DOWNLOADABLE_MEDIA.has(m.type)) {
      try {
        const { saveInboundMedia } = await import("../utils/inboundMedia");
        const saved = await saveInboundMedia({
          workspaceId: wsId,
          externalId: m.externalId,
          type: m.type as "image" | "audio" | "video" | "document",
          mime: m.mediaMime,
          base64: m.mediaB64,
          filename: m.filename,
        });
        if (saved) { mediaUrl = saved.url; mediaMime = saved.mime; }
      } catch (e: any) {
        console.warn(`[Evolution Webhook] saveInboundMedia erro: ${e?.message}`);
      }

      // Calibração (Fase 3): se a mídia NÃO veio embutida (sem arquivo salvo), loga o
      // SHAPE do payload (chaves + flags, SEM o binário) pra descobrir como o
      // Evolution GO entrega a mídia (base64 inline vs endpoint de download).
      if (!mediaUrl) logEvoMediaShape(conexao, payload, m);

      // Áudio: transcreve usando o arquivo local (mesmo pipeline do Meta/áudio).
      if (m.type === "audio" && mediaUrl) {
        try {
          const { transcribeAudioDirect } = await import("../services/automationEngine");
          const tr = await (transcribeAudioDirect as any)(mediaUrl, null, mediaMime || "audio/ogg", wsId);
          if (tr && tr.trim()) { content = tr; console.log(`[Evolution] 🎤 Áudio transcrito: "${tr.slice(0, 80)}"`); }
        } catch (e: any) {
          console.warn(`[Evolution Webhook] transcrição erro: ${e?.message}`);
        }
      }

      // Paridade Meta: documento sem legenda vira "[documento: <nome>]" (não só
      // "[documento]") — o nome aparece no painel E ajuda o classificador (ex:
      // "comprovante.pdf" → fast-path financeiro).
      if (!content) content = m.type === "audio" ? "[áudio]" : m.type === "image" ? "[imagem]" : m.type === "video" ? "[vídeo]" : (m.filename ? `[documento: ${m.filename}]` : "[documento]");
    }
  }
  if (!content) content = "";

  // Lead
  let lead = await storage.getLeadByTelefone(phone, wsId);
  if (!lead) {
    lead = await storage.createLead({
      nome: contactName, contato: contactName, telefone: phone,
      canal: EVO_CANAL, status: await getDefaultLeadStatusSafe(wsId), workspaceId: wsId,
    } as any);
  } else if (contactName && contactName !== phone && (lead.nome === phone || lead.nome === lead.telefone)) {
    // pushName chegou depois — atualiza o lead que entrou só com o número (paridade Meta).
    try {
      await db.update(leads).set({ nome: contactName, contato: contactName }).where(eq(leads.id, lead.id));
      lead = { ...lead, nome: contactName, contato: contactName };
    } catch {}
  }
  // Contato (ficha editável)
  await upsertContactByPhone({ workspaceId: wsId, telefone: phone, nome: contactName, canal: EVO_CANAL }).catch(() => {});

  // Conversa (reopen/guards ficam a cargo do message-processor)
  let conversation = await storage.getConversationByPhoneAndCanal(phone, EVO_CANAL, wsId);
  // Paridade Meta (Bruno 2026-05-19 "resolved é terminal"): conversa RESOLVIDA não
  // reabre o mesmo atendimento — abre um protocolo NOVO. Exceção: resposta de CSAT
  // pendente fica na conv resolvida pra registrar a nota.
  if (conversation && conversation.status === "resolved" && !(await isPendingCsatReply(conversation.id, wsId, content))) {
    conversation = undefined as any;
  }
  if (!conversation) {
    conversation = await storage.createConversation({
      nome: contactName, telefone: phone, canal: EVO_CANAL,
      ultimaMensagem: content, tempo: "agora", unread: 1,
      status: "open", pendente: true, conexaoId: conexao.id, workspaceId: wsId,
    } as any);
  } else {
    await db.update(conversations).set({
      ultimaMensagem: content, tempo: "agora",
      unread: (conversation.unread || 0) + 1,
      updatedAt: new Date(), lastCustomerMessageAt: new Date(),
    } as any).where(eq(conversations.id, conversation.id));
  }

  // Retenção/LGPD da mídia inbound (paridade Meta) — registra o asset pra purga futura.
  if (mediaUrl) {
    try {
      const { registerMediaAsset, inferMediaCategory, getRetentionDaysForTenant } = await import("../services/mediaRetentionService");
      await registerMediaAsset({
        workspaceId: wsId, conversationId: conversation.id,
        mediaUrl, mimeType: mediaMime || undefined,
        category: inferMediaCategory({ mimeType: mediaMime || undefined }),
        source: "evolution", retentionDays: await getRetentionDaysForTenant(wsId),
      });
    } catch (e: any) { console.warn(`[Evolution Webhook] registerMediaAsset erro: ${e?.message}`); }
  }

  // Avatar do contato (best-effort, assíncrono — não bloqueia o fluxo). Usa o cache
  // canônico (avatarCache): a URL do WhatsApp (pps.whatsapp.net) falha no <img> do
  // browser (hotlink/referer + expira), então baixamos pro /uploads/avatars/<ws>/ e
  // servimos do nosso domínio. AUTO-CURA: localAvatarExists checa o DISCO REAL — se o
  // arquivo não existe (banco aponta pra um que sumiu), re-baixa aqui mesmo.
  if (conexao.token) {
    const convId = conversation.id;
    const curAvatar = (conversation as any).avatar as string | null;
    void (async () => {
      try {
        const { localAvatarExists, downloadAndCacheAvatar } = await import("../services/avatarCache");
        let local = localAvatarExists(wsId, phone);
        if (!local) {
          const evo = await import("../services/evolutionAdapter");
          const remote = await evo.getAvatar(conexao.token!, phone);
          if (remote) local = await downloadAndCacheAvatar(remote, wsId, phone);
        }
        if (local && curAvatar !== local) {
          await db.update(conversations).set({ avatar: local } as any).where(eq(conversations.id, convId));
          broadcastToWorkspace(wsId, "conversation_updated", { conversationId: convId, avatar: local });
          // Persiste no CONTATO também (fonte por telefone — alimenta o fallback do
          // inbox e futuras conversas do mesmo cliente). Não sobrescreve foto manual.
          await db.update(contacts)
            .set({ fotoUrl: local, fotoOrigem: "evolution", fotoTentativaEm: new Date() } as any)
            .where(and(
              eq(contacts.workspaceId, wsId),
              eq(contacts.telefone, phone),
              sql`(${contacts.fotoOrigem} IS DISTINCT FROM 'manual')`,
            ));
        }
      } catch {}
    })();
  }

  // Bruno 2026-06-11 (conv 2875): clique de botão NATIVO da Evolution chega com
  // texto VAZIO (só o buttonId) → a escolha do cliente NÃO aparecia no chat.
  // Resolve o título da opção escolhida pelo último menu interativo e usa como
  // texto da msg + preview (paridade Meta, que entrega selectedDisplayText).
  if (effectiveButtonId && !content.trim()) {
    try {
      const { resolveButtonTitleById } = await import("../utils/numberedReply");
      const title = await resolveButtonTitleById(conversation.id, effectiveButtonId);
      if (title) {
        content = title;
        await db.update(conversations).set({ ultimaMensagem: title } as any).where(eq(conversations.id, conversation.id));
      }
    } catch (e: any) { console.warn(`[Evolution] resolveButtonTitle err: ${e?.message}`); }
  }

  // Dedup de texto repetido em <30s (reentrega).
  if (content && !mediaUrl) {
    const dup = await findRecentDuplicateInbound({ workspaceId: wsId, conversationId: conversation.id, texto: content });
    if (dup) return;
  }

  // "Respondendo a..." (quoted): resolve o externalId da msg citada → id interno,
  // pra o painel vincular a resposta à original (paridade Meta).
  let replyToMessageId: number | null = null;
  if (m.replyToExternalId) {
    try {
      const [orig] = await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.externalMessageId, m.replyToExternalId), eq(messages.workspaceId, wsId)))
        .limit(1);
      if (orig) replyToMessageId = orig.id;
    } catch {}
  }

  // Persiste a mensagem
  const incomingMsg = await storage.createMessage({
    conversationId: conversation.id, direction: "in", texto: content,
    hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    status: "received", agente: contactName, workspaceId: wsId,
    externalMessageId: m.externalId,
    ...(mediaType ? { tipo: mediaType } : {}),
    ...(mediaUrl ? { arquivo: mediaUrl } : {}),
    ...(m.filename ? { nomeArquivo: m.filename } : {}),
    ...(m.mediaMetadata ? { mediaMetadata: m.mediaMetadata } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  } as any);

  // Despacha pro motor (buffer + guards + reopen + automação acontecem lá).
  const incoming: IncomingMessage = {
    workspaceId: wsId,
    conversationId: conversation.id,
    conversationNome: conversation.nome,
    conversationStatus: conversation.status || "open",
    conversationPendente: true,
    conversationPipeline: (conversation as any).pipeline || null,
    leadId: lead.id,
    leadNome: lead.nome,
    messageId: incomingMsg.id,
    externalId: m.externalId,
    content,
    type: mediaType || "text",
    mediaUrl,
    mediaType: m.mediaMime || undefined,
    filename: m.filename || undefined,
    channel: "evolution",
    customerPhone: phone,
    conexaoId: conexao.id,
    conexaoAutomacaoId: conexao.automacaoId || null,
    isFromBot: false,
    buttonId: effectiveButtonId || null,
  };
  await processIncomingMessageForAutomation(incoming);
}

async function getDefaultLeadStatusSafe(wsId: string): Promise<string> {
  try {
    const { getDefaultLeadStatus } = await import("../utils/helpers");
    return await getDefaultLeadStatus(wsId);
  } catch { return "novo"; }
}

// ─── Ticks (entregue/lido) ───────────────────────────────────────────────────
// Rank de status pra NÃO regredir (read→delivered) quando recibos chegam fora de
// ordem — mesmo critério de rank usado no canal Meta.
const RECEIPT_RANK: Record<string, number> = { received: 1, sent: 1, delivered: 2, read: 3 };

async function handleReceiptEvent(payload: any, conexao: any, wsId: string) {
  try {
    const d = pick(payload.data, payload) || {};
    const ids: string[] = ([] as any[])
      .concat(pick(d.ids, d.MessageIDs, d.messageIds, d.id, d.ID) || [])
      .flat()
      .map((x: any) => String(x))
      .filter(Boolean);
    const rcptType = String(pick(d.type, d.Type, d.receipt, d.status) || "").toLowerCase();
    // whatsmeow: o recibo de ENTREGA chega com type VAZIO (""); só read/played
    // vêm com type explícito. Por isso "" (ou "deliver*") → delivered.
    const newStatus = (rcptType.includes("read") || rcptType.includes("played")) ? "read"
      : (rcptType === "" || rcptType.includes("deliver")) ? "delivered" : null;
    if (!newStatus || ids.length === 0) return;
    const rankNew = RECEIPT_RANK[newStatus] ?? 0;
    const { messages } = await import("@shared/schema");
    const { and } = await import("drizzle-orm");
    for (const extId of ids) {
      const [row] = await db
        .select({ id: messages.id, status: messages.status, conversationId: messages.conversationId })
        .from(messages)
        .where(and(eq(messages.externalMessageId, `${extId}`), eq(messages.workspaceId, wsId), eq(messages.direction, "out")))
        .limit(1);
      if (!row) continue;
      if ((RECEIPT_RANK[row.status || ""] ?? 0) >= rankNew) continue; // não regride
      await db.update(messages).set({ status: newStatus } as any).where(eq(messages.id, row.id));
      broadcastToWorkspace(wsId, "message_updated", { conversationId: row.conversationId, messageId: row.id, updates: { status: newStatus } });
    }
  } catch (e: any) {
    console.warn("[Evolution Webhook] receipt erro (gracioso):", e?.message);
  }
}

// ─── Status da conexão ───────────────────────────────────────────────────────
async function handleConnectionEvent(payload: any, conexao: any, wsId: string, ev: string) {
  try {
    const connected = ev.includes("connect") && !ev.includes("disconnect");
    if (connected) {
      // confirma com /status (pega numero quando logado)
      let numero: string | null = conexao.numero || null;
      try {
        const evo = await import("../services/evolutionAdapter");
        if (conexao.token) {
          const st = await evo.getStatus(conexao.token);
          if (st.ok && st.numero) numero = st.numero;
        }
      } catch {}
      await storage.updateConexao(conexao.id, { status: "connected", numero, qrCode: null, ultimoPing: new Date() } as any, wsId);
      broadcastToWorkspace(wsId, "conexao_status", { id: conexao.id, status: "connected", numero });
    } else {
      await storage.updateConexao(conexao.id, { status: "disconnected", qrCode: null } as any, wsId);
      broadcastToWorkspace(wsId, "conexao_status", { id: conexao.id, status: "disconnected" });
    }
  } catch (e: any) {
    console.warn("[Evolution Webhook] connection erro (gracioso):", e?.message);
  }
}
