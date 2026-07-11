import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { isDuplicate } from "../utils/processedMessages";
import { db } from "../db";
import {
  whatsappOfficialConnections,
  whatsappWebhookEvents,
  conversations,
  leads,
  protocols,
  messages,
} from "@shared/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import * as metaWhatsApp from "../services/meta-whatsapp";
import { storage } from "../storage";
import { isPhoneLockedForBotSend } from "../utils/phoneLock";
import {
  processIncomingMessageForAutomation,
  handlePendingInteractiveResponse,
} from "../services/message-processor";
import { findRecentDuplicateInbound } from "../utils/messageInsert";

const router = Router();

let secretsCache: { values: string[]; expiresAt: number } = { values: [], expiresAt: 0 };
const SECRETS_TTL_MS = 30_000;

async function loadAppSecrets(): Promise<string[]> {
  const now = Date.now();
  if (secretsCache.expiresAt > now) return secretsCache.values;

  const envSecrets = [process.env.META_APP_SECRET, process.env.WHATSAPP_APP_SECRET].filter(Boolean) as string[];
  let dbSecrets: string[] = [];
  try {
    const { decrypt } = await import("../utils/crypto");
    const rows = await db
      .select({ appSecret: whatsappOfficialConnections.appSecret })
      .from(whatsappOfficialConnections)
      .where(and(eq(whatsappOfficialConnections.status, "active")));
    for (const r of rows) {
      if (!r.appSecret) continue;
      try {
        const plain = decrypt(r.appSecret);
        if (plain) dbSecrets.push(plain);
      } catch {}
    }
  } catch (e: any) {
    console.warn("[Meta Webhook] Failed to load tenant app_secrets from db:", e.message);
  }

  const all = Array.from(new Set([...dbSecrets, ...envSecrets]));
  secretsCache = { values: all, expiresAt: now + SECRETS_TTL_MS };
  return all;
}

async function verifyMetaSignature(req: Request, res: Response, next: NextFunction) {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = req.headers["x-hub-signature-256"] as string;

  const secrets = await loadAppSecrets();

  if (secrets.length === 0) {
    console.error("[Meta Webhook] nenhum app_secret configurado (env ou banco) — rejeitando webhook");
    return res.status(500).json({ error: "Webhook não configurado corretamente" });
  }

  if (!signature) {
    console.warn("[Meta Webhook] Rejected: missing x-hub-signature-256 header");
    return res.sendStatus(401);
  }

  if (!rawBody) {
    console.warn("[Meta Webhook] Rejected: rawBody not available");
    return res.sendStatus(400);
  }

  for (const secret of secrets) {
    const expected = "sha256=" + crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    try {
      if (
        signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      ) {
        return next();
      }
    } catch {}
  }

  console.warn(`[Meta Webhook] Invalid signature — rejecting payload (tried ${secrets.length} secret(s))`);
  return res.sendStatus(403);
}

router.get("/", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Auditoria 2026-06-19 (paridade com o fix do Instagram): exige o verify token
  // CONFIGURADO antes de comparar — sem isto, env ausente fazia `undefined ===
  // undefined` ecoar o challenge e deixar qualquer um completar a subscrição.
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

router.post("/", verifyMetaSignature, (req: Request, res: Response) => {
  res.sendStatus(200);

  setImmediate(() => {
    if (req.body?.object === "instagram") {
      processInstagramWebhookPayload(req.body).catch((err) => {
        console.error("[Meta Webhook→Instagram] Processing error:", err);
      });
    } else {
      processMetaWebhookPayload(req.body).catch((err) => {
        console.error("[Meta Webhook] Processing error:", err);
      });
    }
  });
});

async function processInstagramWebhookPayload(body: any) {
  const { instagramConnections } = await import("@shared/schema");
  const { handleInstaProspectDM, handleInstaProspectComment, handleInstaProspectStory } = await import("../services/instaProspectService");
  const { processInstagramMessage } = await import("../services/instagramMessageProcessor");
  const { resolveIgConnectionForWebhook, isOwnAccountComment } = await import("../services/igWebhookResolver");

  for (const entry of body.entry || []) {
    const igUserId = entry.id;

    const conn = await resolveIgConnectionForWebhook(igUserId);
    if (!conn) {
      console.warn("[Meta Webhook→Instagram] Sem conexao ATIVA para igUserId:", igUserId);
      continue;
    }
    const conns = [conn];

    for (const conn of conns) {
      for (const messaging of entry.messaging || []) {
        const { sender, recipient, message } = messaging;
        if (!message) continue;
        if (message.is_deleted) continue;

        const isEcho = !!(message.is_echo || sender?.id === igUserId);
        const customerIgUserId = isEcho ? recipient?.id : sender?.id;
        if (!customerIgUserId) continue;

        let handledByInstaProspect = false;
        if (!isEcho) {
          const dmFlowId = conn.automacaoId || conn.dmAutomacaoId;
          if (dmFlowId) {
            try {
              handledByInstaProspect = await handleInstaProspectDM({
                workspaceId: conn.workspaceId,
                connectionId: conn.id,
                accessToken: conn.accessToken,
                igAccountUserId: igUserId,
                senderIgUserId: sender.id,
                senderIgUsername: sender.username || "",
                messageText: message.text || "",
                linkedFlowId: dmFlowId,
                attachments: message.attachments,
              });
            } catch (err: any) {
              console.error("[Meta Webhook→Instagram] InstaProspect error:", err.message);
            }
          }
        }

        await processInstagramMessage({
          workspaceId: conn.workspaceId,
          connectionId: conn.id,
          igAccountUserId: igUserId,
          accessToken: conn.accessToken,
          senderIgUserId: customerIgUserId,
          recipientIgUserId: isEcho ? sender?.id : igUserId,
          senderUsername: (isEcho ? recipient?.username : sender?.username) || "",
          message: {
            mid: message.mid || `ig_${Date.now()}`,
            text: message.text,
            attachments: message.attachments,
            is_echo: isEcho,
          },
          skipAutomations: handledByInstaProspect || isEcho,
        });
      }

      const commentFlowId = conn.automacaoId || conn.commentAutomacaoId;
      const storyFlowId = conn.automacaoId;

      for (const change of entry.changes || []) {
        if (change.field === "comments" && change.value) {
          const { value } = change;
          if (isOwnAccountComment(conn, value.from, igUserId)) {
            // anti-loop: reply do bot é postado como comentário e voltaria como webhook
            console.log(`[Meta→IG] comentário da PRÓPRIA conta ignorado (anti-loop) comment=${value.id}`);
          } else if (commentFlowId) {
            console.log(`[Meta→IG] comentário recebido igUser=${igUserId} flow=${commentFlowId} comment=${value.id} texto="${(value.text || "").slice(0, 40)}"`);
            await handleInstaProspectComment({
              workspaceId: conn.workspaceId,
              connectionId: conn.id,
              accessToken: conn.accessToken,
              igAccountUserId: igUserId,
              commentId: value.id,
              postId: value.media?.id || "",
              fromIgUserId: value.from?.id || "",
              fromIgUsername: value.from?.username || "",
              commentText: value.text || "",
              linkedFlowId: commentFlowId,
            });
          }
        }

        if (change.field === "mention" && change.value && storyFlowId) {
          await handleInstaProspectStory({
            workspaceId: conn.workspaceId,
            accessToken: conn.accessToken,
            igAccountUserId: igUserId,
            fromIgUserId: change.value?.sender_id || "",
            fromIgUsername: change.value?.from?.username || "",
            linkedFlowId: storyFlowId,
          });
        }
      }
    }
  }
}

async function processMetaWebhookPayload(body: any) {
  if (body?.object !== "whatsapp_business_account") return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      let [connection] = await db
        .select()
        .from(whatsappOfficialConnections)
        .where(
          and(
            eq(whatsappOfficialConnections.phoneNumberId, phoneNumberId),
            eq(whatsappOfficialConnections.status, "active")
          )
        )
        .limit(1);

      if (!connection) {
        [connection] = await db
          .select()
          .from(whatsappOfficialConnections)
          .where(eq(whatsappOfficialConnections.phoneNumberId, phoneNumberId))
          .limit(1);

        if (!connection) {
          console.warn("[Meta Webhook] No connection at all for phoneNumberId:", phoneNumberId);
          continue;
        }
        console.warn("[Meta Webhook] Connection found but status='" + connection.status + "' (not active) for phoneNumberId:", phoneNumberId, "— processing anyway");
      }

      const wsId = connection.workspaceId;

      const eventType = value.messages?.length ? "message" : value.statuses?.length ? "status" : "unknown";
      const eventInsert = db.insert(whatsappWebhookEvents)
        .values({
          workspaceId: wsId,
          phoneNumberId,
          wabaId: entry.id,
          eventType,
          messageId: value.messages?.[0]?.id || null,
          fromNumber: value.messages?.[0]?.from || null,
          rawPayload: body,
          receivedAt: new Date(),
        });
      if (eventType === "message") {
        await eventInsert.catch((e) => console.error("[Meta Webhook] Failed to log event:", e.message));
      } else {
        eventInsert.catch((e) => console.error("[Meta Webhook] Failed to log event:", e.message));
      }

      const OUR_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
      for (const msg of value.messages || []) {
        if (OUR_PHONE_ID && msg.from === OUR_PHONE_ID) {
          console.log(`[Webhook] Echo do bot ignorado: ${msg.id}`);
          continue;
        }
        if (isDuplicate(msg.id)) {
          console.log(`[Webhook] wamid duplicado ignorado: ${msg.id}`);
          continue;
        }
        await processIncomingMessage({
          wsId,
          connection,
          msg,
          metaContacts: value.contacts,
          phoneNumberId,
        }).catch((err) => console.error("[Meta Webhook] processIncomingMessage error:", err));
      }

      for (const status of value.statuses || []) {
        await processStatusUpdate({ wsId, status }).catch((err) =>
          console.error("[Meta Webhook] processStatusUpdate error:", err)
        );
      }
    }
  }
}

async function processIncomingMessage({
  wsId,
  connection,
  msg,
  metaContacts,
  phoneNumberId,
}: {
  wsId: string;
  connection: typeof whatsappOfficialConnections.$inferSelect;
  msg: any;
  metaContacts: any[];
  phoneNumberId: string;
}) {
  const wamid = msg.id;
  const fromPhone = (msg.from || "").replace(/\D/g, "");
  if (!fromPhone) return;

  // ── Defesa contra replay tardio da Meta (Bruno, 2026-05-08, conv 350) ──
  // Meta retry/multi-device sync entrega mensagens MUITO antigas (até 7 dias)
  // com wamids DIFERENTES — passa pela dedup de external_message_id e pela
  // janela de 30s do findRecentDuplicateInbound. Cliente vê mensagem fantasma
  // que ele "não mandou" reaparecer no chat.
  //
  // Patch: comparar `msg.timestamp` (Meta envia em segundos epoch) com agora.
  // Se diff > 5 minutos, ignora — é replay tardio, não mensagem nova.
  const msgTimestampSec = Number(msg.timestamp);
  if (Number.isFinite(msgTimestampSec) && msgTimestampSec > 0) {
    const ageSec = Math.floor(Date.now() / 1000) - msgTimestampSec;
    if (ageSec > 5 * 60) {
      console.log(
        `[MetaWebhook] 🛡️ REPLAY TARDIO: msg=${wamid?.slice(-12)} de ${ageSec}s atrás (>5min) — descartando. ` +
        `from=${fromPhone}, text="${(msg.text?.body || msg.interactive?.button_reply?.title || '').slice(0, 60)}"`,
      );
      return;
    }
    if (ageSec > 60) {
      // Atrasou mas não é replay claro — logga pra observabilidade
      console.log(
        `[MetaWebhook] ⏰ Mensagem entregue com atraso de ${ageSec}s (msg=${wamid?.slice(-12)} from=${fromPhone}) — processando normalmente`,
      );
    }
  }

  const contactName =
    metaContacts?.find((c: any) => c.wa_id === msg.from)?.profile?.name || fromPhone;

  const [existingEvent] = await db
    .select({ id: whatsappWebhookEvents.id })
    .from(whatsappWebhookEvents)
    .where(eq(whatsappWebhookEvents.messageId, wamid))
    .limit(1);

  if (existingEvent) {
    const eventCount = await db
      .select({ id: whatsappWebhookEvents.id })
      .from(whatsappWebhookEvents)
      .where(eq(whatsappWebhookEvents.messageId, wamid));
    if (eventCount.length > 1) return;
  }

  let interactiveButtonId: string | null = null;
  if (msg.interactive) {
    const selectedId =
      msg.interactive?.button_reply?.id ||
      msg.interactive?.list_reply?.id ||
      "";
    if (selectedId) {
      interactiveButtonId = selectedId;

      // CSAT (csat:1/csat:3/csat:5) — resposta à avaliação pós-resolução informacional.
      // Registro de CSAT removido junto com o módulo de protocolos/SLA (ISP).
      if (selectedId.startsWith("csat:")) {
        return;
      }

      const handled = await handlePendingInteractiveResponse(
        wsId,
        fromPhone,
        selectedId,
        msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || ""
      );
      if (handled) return;
    }
  }

  // Bruno 2026-05-20: Meta às vezes envia uma "msg de preview" com type=unsupported
  // ANTES da mídia real (especialmente em vídeos). Sem essa guarda, a preview entra
  // como bolha "[unsupported]" no painel, acima do player do vídeo. Descartar
  // 100% — não cria registro nem dispara handler.
  if (msg.type === "unsupported") {
    console.log(`[MetaWebhook] 🛑 Mensagem type=unsupported descartada (provável preview de mídia). wamid=${msg.id?.slice(-12)}`);
    return;
  }

  // Bruno 2026-05-21: reaction inbound (long-press de emoji em msg anterior)
  // chega como msg.type === 'reaction'. Antes caía no `default` do switch em
  // parseMetaMedia e gerava uma bolha "[reaction]" no painel — ruído sem
  // contexto pro atendente. Agora: acha a msg original via externalMessageId
  // (wamid em msg.reaction.message_id), grava em `message_reactions` com
  // userId=0 (sentinel "cliente") e dispara broadcast `reaction_updated`. O
  // front (MessageArea + useConversationReactions) já consome esse evento e
  // re-renderiza chips embaixo da bolha. Cliente tem 1 reação por msg:
  // qualquer nova substitui a anterior; emoji vazio remove (espelha WhatsApp).
  if (msg.type === "reaction") {
    const originalWamid = msg.reaction?.message_id as string | undefined;
    const emoji = String(msg.reaction?.emoji || "").trim();
    if (!originalWamid) return;

    try {
      const { messages: msgsTbl, messageReactions } = await import("@shared/schema");
      const [originalMsg] = await db.select({ id: msgsTbl.id, conversationId: msgsTbl.conversationId })
        .from(msgsTbl)
        .where(and(eq(msgsTbl.externalMessageId, originalWamid), eq(msgsTbl.workspaceId, wsId)))
        .limit(1);

      if (!originalMsg) {
        console.log(`[MetaWebhook] reaction descartada — msg original não achada (wamid=${originalWamid.slice(-12)})`);
        return;
      }

      await db.delete(messageReactions).where(and(
        eq(messageReactions.messageId, originalMsg.id),
        eq(messageReactions.userId, 0),
        eq(messageReactions.workspaceId, wsId),
      ));

      let action: "added" | "removed" = "removed";
      if (emoji) {
        const leadNome = (await storage.getLeadByTelefone(fromPhone, wsId))?.nome || contactName || fromPhone;
        await db.insert(messageReactions).values({
          messageId: originalMsg.id,
          conversationId: originalMsg.conversationId,
          workspaceId: wsId,
          userId: 0,
          userName: `Cliente: ${leadNome}`,
          emoji,
        });
        action = "added";
      }

      const { broadcastToWorkspace } = await import("../services/broadcast");
      broadcastToWorkspace(wsId, "reaction_updated", {
        messageId: originalMsg.id,
        conversationId: originalMsg.conversationId,
        emoji,
        userId: 0,
        userName: "Cliente",
        action,
      });

      console.log(`[MetaWebhook] reaction ${action} cliente=${fromPhone} msgId=${originalMsg.id} emoji=${emoji || '(vazio)'}`);
    } catch (e: any) {
      console.error(`[MetaWebhook] reaction handler error:`, e.message);
    }
    return;
  }

  const { messageText, mediaContext } = await parseMetaMedia(msg, connection);

  if (!messageText) return;

  let lead = await storage.getLeadByTelefone(fromPhone, wsId);
  if (!lead) {
    lead = await storage.createLead({
      nome: contactName,
      contato: contactName,
      telefone: fromPhone,
      canal: "whatsapp_oficial",
      status: "novo",
      workspaceId: wsId,
    } as any);
  } else if (contactName && contactName !== fromPhone && (lead.nome === fromPhone || lead.nome === lead.telefone)) {
    await db
      .update(leads)
      .set({ nome: contactName, contato: contactName })
      .where(eq(leads.id, lead.id));
    lead = { ...lead, nome: contactName, contato: contactName };
  }

  // Bruno 2026-05-21: garante registro em `contacts` (lista de Clientes).
  // Antes só `leads` era criado nesse caminho — cliente que chegava via
  // WhatsApp não aparecia em /contatos.
  try {
    const { upsertContactByPhone } = await import("../utils/contactSync");
    await upsertContactByPhone({
      workspaceId: wsId,
      telefone: fromPhone,
      nome: contactName || fromPhone,
      canal: "WhatsApp",
    });
  } catch {}

  let conversation = await storage.getConversationByPhoneAndCanal(fromPhone, "whatsapp_official", wsId);
  let convPendente: boolean | undefined;
  // Flag legacy: marcava conv reaberta no mesmo handler pra pular dedup.
  // Com a regra "resolved é terminal" (Bruno 2026-05-19), reabertura
  // automática não acontece mais — msg em conv resolved cria NOVA conv,
  // que sai limpa do dedup. Flag mantida pra compat com CSAT reply path.
  let wasJustReopened = false;
  if (!conversation) {
    const candidate = await storage.getConversationByPhone(fromPhone, wsId);
    if (candidate && (candidate.canal || "").toLowerCase() === "whatsapp_official") {
      conversation = candidate;
    }
  }

  // Bruno 2026-05-19: RESOLVED É TERMINAL. Se a conv encontrada está
  // resolved E a msg não é resposta CSAT, NÃO reabre — descarta a conv
  // antiga e cria nova. Gap real reportado: bot respondeu msg antiga em
  // conv resolvida porque reabertura automática trazia tudo de volta.
  // CSAT reply (1-10 com sessão aguardando) continua usando a conv antiga
  // pra registrar a nota — atendimento segue resolvido.
  if (conversation && conversation.status === "resolved") {
    let isCsatReplyResolvedBranch = false;
    try {
      const trimmed = (messageText || "").trim();
      const CSAT_HUMAN_EXIT_RE = /\b(humano|atendente|pessoa|consultor|sair\s+do\s+bot|falar\s+com\s+(?:algu[eé]m|gente)|cancela(?:r)?\s+(?:essa\s+)?conversa|n[aã]o\s+quero\s+responder|esquece)\b/i;
      const looksLikeCsatExit = CSAT_HUMAN_EXIT_RE.test(trimmed);
      const nota = parseInt(trimmed);
      if (!looksLikeCsatExit && !isNaN(nota) && trimmed.length <= 2 && nota >= 1 && nota <= 10) {
        // ISP removido: o flag "aguardando CSAT" vivia em isp_session_state
        // (dropada). Sem o módulo ISP nada arma CSAT, então nunca há nota pendente.
        const csatAguardando = false;
        if (csatAguardando) {
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [pendingCsat] = await db
            .select({ id: protocols.id })
            .from(protocols)
            .where(
              and(
                eq(protocols.workspaceId, wsId),
                eq(protocols.conversationId, conversation.id),
                eq(protocols.csatEnviado, true),
                isNull(protocols.csatNota),
                sql`${protocols.createdAt} > ${cutoff}`,
              ),
            )
            .limit(1);
          if (pendingCsat) {
            isCsatReplyResolvedBranch = true;
            console.log(`[MetaWebhook] CSAT reply detected (nota=${nota}) — keeping resolved conv #${conversation.id}`);
          }
        }
      }
    } catch (csatErr: any) {
      console.error(`[MetaWebhook] CSAT pre-check error:`, csatErr.message);
    }

    if (!isCsatReplyResolvedBranch) {
      console.log(`[MetaWebhook] conv #${conversation.id} resolved → criando NOVA conv (regra terminal)`);
      conversation = undefined;
    }
    // Se for CSAT reply: a conv segue resolved e o branch existente abaixo
    // registra a nota normalmente (sem reabrir).
  }

  // Bruno (2026-05-11): captura o id do protocolo criado/reaberto no reopen
  // pra atribuir EXPLICITAMENTE à inbound mais abaixo — sem isso, o auto-resolve
  // dentro do createMessage perde pra race condition e a 1ª msg do cliente
  // fica sem protocoloId → divisor renderiza ABAIXO dela no chat.
  let reopenProtocolId: string | null = null;

  if (!conversation) {
    let waAvatar: string | null = null;
    try {
      const { tryFetchMetaProfilePicture } = await import("../services/avatar.service");
      waAvatar = await tryFetchMetaProfilePicture(phoneNumberId, `+${fromPhone}`, connection.accessToken);
    } catch {}
    conversation = await storage.createConversation({
      nome: lead.nome || fromPhone,
      telefone: fromPhone,
      canal: "whatsapp_official",
      avatar: waAvatar,
      ultimaMensagem: messageText,
      tempo: "agora",
      unread: 1,
      status: "open",
      pendente: true,
      lastCustomerMessageAt: new Date(),
      workspaceId: wsId,
    } as any);

    convPendente = true;
    if (!connection.automacaoId) {
      console.log(`[MetaWebhook] Nova conversa #${conversation.id} sem automação — auto-protocolo desabilitado (aguardando configuração)`);
    } else {
      console.log(`[MetaWebhook] Nova conversa #${conversation.id} com automação ativa`);
    }
  } else {
    const updateData: any = {
      ultimaMensagem: messageText,
      tempo: "agora",
      unread: (conversation.unread || 0) + 1,
      updatedAt: new Date(),
      lastCustomerMessageAt: new Date(),
    };
    const lastView = (conversation as any).lastOperatorViewAt;
    const twoHoursMs = 2 * 60 * 60 * 1000;
    if (!lastView || Date.now() - new Date(lastView).getTime() > twoHoursMs) {
      updateData.pendente = true;
      // Bruno 2026-05-21: REGRA ABSOLUTA — atendente atribuído permanece até
      // resolver/transferir. Cliente respondendo NUNCA tira a conv de "Em
      // Andamento" e devolve pra fila, mesmo após idle do atendente. Apenas
      // `pendente=true` sinaliza que tem msg nova esperando resposta.
    }
    if (conversation.status === "resolved") {
      // Bruno 2026-05-19: a esta altura, se a conv ainda é resolved, é
      // PORQUE foi detectada como CSAT reply no pré-check (mais acima). O
      // path de reabertura automática foi removido — conv não-CSAT em
      // resolved cria nova conv antes de chegar aqui.
      // CSAT reply: mantém resolved, só desfaz o `pendente=true` setado
      // mais acima.
      updateData.pendente = false;
      // CSAT reply em conv resolved: bloco de reset/limpeza removido em
      // 2026-05-19 (regra "resolved é terminal"). A conv permanece resolvida
      // e o branch de CSAT que registra a nota vive em outro lugar (sessão
      // ISP / protocolo). Nada mais pra fazer aqui.
    }

    // ── Stale HUMANO / ENCERRADO session cleanup on open conversations ──────
    // When the bot finishes (ENCERRADO) or hand-offs to a human (HUMANO) but the
    // conversation is never formally resolved, the CRM tags/pipeline/prioridade
    // from the previous session linger. When the customer sends a new message,
    // clear that stale context so the bot restarts with a clean slate.
    //   • ENCERRADO: always reset (session explicitly closed, customer returned)
    //   • HUMANO:    reset after ≥1h of inactivity (human agent may still be active)
    // Bloco de limpeza de sessão stale (ENCERRADO/HUMANO) removido junto com o
    // módulo de sessão ISP (ispMemoryService) e tags de situação.
    // ───────────────────────────────────────────────────────────────────────

    if (fromPhone && !(conversation as any).telefone) {
      updateData.telefone = fromPhone;
    }
    if (contactName && conversation.nome === fromPhone && contactName !== fromPhone) {
      updateData.nome = contactName;
    }
    if (!conversation.avatar && fromPhone) {
      try {
        const { tryFetchMetaProfilePicture } = await import("../services/avatar.service");
        const metaPic = await tryFetchMetaProfilePicture(phoneNumberId, `+${fromPhone}`, connection.accessToken);
        if (metaPic) updateData.avatar = metaPic;
      } catch {}
    }
    await db
      .update(conversations)
      .set(updateData)
      .where(and(eq(conversations.id, conversation.id), eq(conversations.workspaceId, wsId)));
    convPendente = updateData.pendente !== undefined ? Boolean(updateData.pendente) : Boolean((conversation as any).pendente);
  }

  const msgTipo =
    mediaContext.type === "image"
      ? "image"
      : mediaContext.type === "audio"
        ? "audio"
        : mediaContext.type === "video"
          ? "video"
          : mediaContext.type === "document"
            ? "file"
            : mediaContext.type === "contact"
              ? "contact"
              : mediaContext.type === "location"
                ? "location"
                : "text";

  // Defesa contra replay de webhook / multi-device sync do cliente. Se o
  // mesmo texto já chegou nessa conv nos últimos 30s (texto curto) ou 10min
  // (texto longo), ignora silenciosamente. Mais detalhes na doc de
  // findRecentDuplicateInbound.
  // SKIP quando a conv acabou de ser reaberta (estava resolved e voltou pra
  // open neste mesmo handler): cliente legitimamente reenviou a frase pra
  // reabrir atendimento — bloquear seria deixar o agente em silêncio.
  if (messageText && mediaContext.type === "text" && !wasJustReopened) {
    const dup = await findRecentDuplicateInbound({
      workspaceId: wsId,
      conversationId: conversation.id,
      texto: messageText,
    });
    if (dup) {
      console.log(`[MetaWebhook] 🛡️ Replay defensivo: msg duplicada em <30s ignorada (conv=${conversation.id} wamid=${wamid?.slice(-12)} texto="${messageText.slice(0, 40)}")`);
      try {
        const { traceAgent, TRACE_STAGES } = await import("../utils/agentTrace");
        traceAgent({
          workspaceId: wsId,
          conversationId: conversation.id,
          stage: TRACE_STAGES.DEDUP_BLOCKED,
          data: {
            source: 'meta_webhook',
            wamid: wamid?.slice(-12),
            msgPreview: messageText.slice(0, 80),
          },
        });
      } catch {}
      return;
    }
  }

  // notifyClientNewMessage (ispSendService) removido junto com o módulo de envio ISP.

  // "Respondendo a..." (quoted): Meta entrega o wamid da msg citada em
  // msg.context.id. Resolve pro id interno pra o painel vincular a resposta à
  // original (paridade com o canal Evolution / contextInfo.stanzaId).
  let replyToMessageId: number | null = null;
  const quotedWamid = msg.context?.id;
  if (quotedWamid) {
    try {
      const [orig] = await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.externalMessageId, String(quotedWamid)), eq(messages.workspaceId, wsId)))
        .limit(1);
      if (orig) replyToMessageId = orig.id;
    } catch {}
  }

  const incomingMsg = await storage.createMessage({
    conversationId: conversation.id,
    direction: "in",
    texto: messageText,
    tipo: msgTipo,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    arquivo: mediaContext.media_url || null,
    nomeArquivo: mediaContext.filename || null,
    // Bruno 2026-05-21: metadata estruturada de contato/localização. JSONB no
    // banco; frontend renderiza bolha rica a partir disso.
    mediaMetadata: mediaContext.metadata || null,
    hora: new Date().toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }),
    status: "received",
    workspaceId: wsId,
    externalMessageId: wamid || null,
    // Quando o webhook detectou reopen e criou/reabriu protocolo SINCRONAMENTE
    // acima, passa o id pra que esta 1ª inbound já saia com protocoloId — assim
    // o front-end posiciona o divisor ANTES dela (engloba a mensagem que abriu
    // o atendimento). Se for null, createMessage cai no auto-resolve normal.
    protocoloId: reopenProtocolId || undefined,
  });

  const resolvedToken = connection.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "";
  // Marca como lida + dispara "digitando..." no cliente. A Meta encerra o
  // typing automaticamente quando a resposta sai (ou em ~25s). Combo num único
  // POST porque é o único formato que a Cloud API aceita pra typing indicator.
  metaWhatsApp
    .markMessageAsRead(phoneNumberId, resolvedToken, wamid, { typing: true })
    .catch(() => {});
  // Guarda o wamid pra re-disparar o "digitando" durante o processamento e entre
  // as partes da resposta (heartbeat de typing — channel-router usa este cache).
  try { metaWhatsApp.rememberInboundWamid(conversation.id, wamid); } catch {}

  // Bruno (2026-05-13): Flow nativo C11 — cliente preencheu formulário de
  // cadastro. Processa diretamente (parse + persiste em comercial_leads +
  // dispara handoff humano com resumo) SEM passar pelo engine, evitando que
  // a mensagem "[formulário-cadastro-recebido]" caia em IA livre.
  const flowReplyRaw = (mediaContext as any).flowReply;
  if (flowReplyRaw) {
    try {
      const { parseC11FlowReply, formatC11FlowDataForHandoff } =
        await import("../services/whatsappFlows/flowService");
      const parsed = parseC11FlowReply(flowReplyRaw);
      if (parsed && parsed.conversationId === conversation.id) {
        console.log(`[MetaWebhook] 📋 Flow C11 recebido conv=${conversation.id} fields=${Object.keys(parsed.data).filter(k => (parsed.data as any)[k]).length}`);
        const resumo = formatC11FlowDataForHandoff(parsed.data);

        // Persistência da sessão (ispMemoryService) e mensagem de confirmação ao
        // cliente (ispSendService) removidas junto com o módulo ISP.

        // Handoff humano: nota interna com resumo dos dados + update da conv pra
        // atendimento humano. Aplicação de tags de situação (C11/AH) removida
        // junto com o módulo de tags ISP.
        try {
          await db.update(conversations).set({
            pipeline: 'comercial',
            pipelineEtapa: 'atendimento_humano',
            pendente: true,
            updatedAt: new Date(),
          } as any).where(eq(conversations.id, conversation.id)).catch(() => {});

          // Posta resumo como nota interna (direction='internal' não vai pro cliente)
          const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          await storage.createMessage({
            conversationId: conversation.id,
            workspaceId: wsId,
            direction: 'internal',
            texto: resumo,
            tipo: 'note',
            hora,
            status: 'sent',
            agente: 'Sistema (Flow)',
          } as any).catch(() => {});
        } catch (e: any) {
          console.error(`[MetaWebhook] Flow C11 handoff falhou: ${e.message}`);
        }

        // Curto-circuito: não despacha pro engine, já processamos
        return;
      }
      // Flow token não bateu — segue fluxo normal (mensagem caiu como texto comum)
    } catch (e: any) {
      console.error(`[MetaWebhook] Flow handler erro: ${e.message}`);
    }
  }

  // Paridade Evolution: cliente que DIGITA o número do menu (em vez de clicar o botão
  // nativo da Meta) também é entendido — traduz "1/2/3" no id da opção via último interactive.
  if (!interactiveButtonId && messageText && /^\d{1,2}[.\)\-º°:]?$/.test(messageText.trim())) {
    try {
      const { resolveNumberedButtonReply } = await import("../utils/numberedReply");
      const mapped = await resolveNumberedButtonReply(wsId, conversation.id, messageText);
      if (mapped) { interactiveButtonId = mapped; console.log(`[MetaWebhook] número "${messageText.trim()}" → botão "${mapped}" (paridade Evolution)`); }
    } catch (e: any) { console.warn("[MetaWebhook] resolveNumberedButtonReply erro:", e?.message); }
  }

  const phoneLocked = isPhoneLockedForBotSend(fromPhone);
  console.log(`[MetaWebhook] processIncoming: phone=${fromPhone}, conv=${conversation.id}, automacaoId=${connection.automacaoId || "NONE"}, msgType=${mediaContext.type}, phoneLocked=${phoneLocked}`);
  await processIncomingMessageForAutomation({
    workspaceId: wsId,
    conversationId: conversation.id,
    conversationNome: conversation.nome,
    conversationStatus: "open",
    conversationPendente: convPendente,
    conversationPipeline: (conversation as any).pipeline || null,
    leadId: lead.id,
    leadNome: lead.nome,
    messageId: incomingMsg.id,
    externalId: wamid,
    content: messageText,
    type: mediaContext.type,
    mediaUrl: mediaContext.media_url,
    mediaType: mediaContext.media_type,
    filename: mediaContext.filename,
    channel: "meta",
    customerPhone: fromPhone,
    conexaoId: null,
    conexaoAutomacaoId: connection.automacaoId || null,
    metaAccessToken: connection.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "",
    isFromBot: false,
    buttonId: interactiveButtonId,
  });
}

async function parseMetaMedia(
  msg: any,
  connection: typeof whatsappOfficialConnections.$inferSelect
): Promise<{
  messageText: string;
  mediaContext: { type: "text" | "image" | "audio" | "video" | "document" | "contact" | "location"; text: string; media_url?: string; media_type?: string; filename?: string; metadata?: any };
}> {
  const token = connection.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "";
  let messageText = "";
  let mediaContext: { type: "text" | "image" | "audio" | "video" | "document" | "contact" | "location"; text: string; media_url?: string; media_type?: string; filename?: string; metadata?: any } = { type: "text", text: "" };

  switch (msg.type) {
    case "text":
      messageText = msg.text?.body || "";
      break;

    case "image": {
      // Bruno 2026-05-21: NUNCA gravar URL CDN da Meta como fallback — expira
      // em ~5min e fica "Imagem indisponível" no painel. Se download local
      // falhar mesmo após retries (em downloadMetaMedia), grava só o mediaId
      // em metadata pro botão de re-baixar atualizar a msg depois.
      const imgMime = msg.image?.mime_type || "image/jpeg";
      const localImg = await metaWhatsApp.downloadMetaMedia(msg.image.id, token, imgMime, { workspaceId: connection.workspaceId }).catch(() => null);
      messageText = msg.image?.caption || "[imagem]";
      mediaContext = {
        type: "image",
        text: msg.image?.caption || "",
        media_url: localImg || undefined,
        media_type: imgMime,
        metadata: localImg ? undefined : {
          mediaId: msg.image.id,
          mimeType: imgMime,
          downloadFailed: true,
        },
      };
      break;
    }

    case "audio":
    case "voice": {
      const audioId = msg.audio?.id || msg.voice?.id;
      const audioMime = msg.audio?.mime_type || msg.voice?.mime_type || "audio/ogg";
      let localAudio: string | null = null;
      if (audioId) {
        localAudio = await metaWhatsApp.downloadMetaMedia(audioId, token, audioMime, { workspaceId: connection.workspaceId }).catch(() => null);
      }
      messageText = "[audio]";
      // Transcrição só roda no caminho com path local — sem CDN ephemeral.
      if (localAudio) {
        try {
          const { transcribeAudioDirect } = await import("../services/automationEngine");
          const transcript = await (transcribeAudioDirect as any)(localAudio, token, audioMime, connection.workspaceId);
          if (transcript && transcript.trim()) {
            messageText = transcript;
            console.log(`[Meta] 🎤 Audio transcrito: "${transcript.slice(0, 100)}"`);
          }
        } catch (transcribeErr: any) {
          console.error(`[Meta] Audio transcription error:`, transcribeErr.message);
        }
      }
      mediaContext = {
        type: "audio",
        text: messageText !== "[audio]" ? messageText : "",
        media_url: localAudio || undefined,
        media_type: audioMime,
        metadata: (!localAudio && audioId) ? {
          mediaId: audioId,
          mimeType: audioMime,
          downloadFailed: true,
        } : undefined,
      };
      break;
    }

    case "document": {
      const docMime = msg.document?.mime_type || "application/pdf";
      const localDoc = await metaWhatsApp.downloadMetaMedia(msg.document.id, token, docMime, { workspaceId: connection.workspaceId }).catch(() => null);
      messageText = msg.document?.caption || `[documento: ${msg.document?.filename || "arquivo"}]`;
      mediaContext = {
        type: "document",
        text: "",
        media_url: localDoc || undefined,
        media_type: msg.document?.mime_type || "application/pdf",
        filename: msg.document?.filename,
        metadata: localDoc ? undefined : {
          mediaId: msg.document.id,
          mimeType: docMime,
          filename: msg.document?.filename,
          downloadFailed: true,
        },
      };
      break;
    }

    case "video": {
      // Bruno 2026-05-20: antes só setava messageText="[video]" — sem download
      // o painel ficava sem player. Agora baixa pra /uploads e popula
      // mediaContext igual image/audio/document.
      const videoMime = msg.video?.mime_type || "video/mp4";
      const localVideo = await metaWhatsApp.downloadMetaMedia(msg.video.id, token, videoMime, { workspaceId: connection.workspaceId }).catch(() => null);
      messageText = msg.video?.caption || "[video]";
      mediaContext = {
        type: "video",
        text: msg.video?.caption || "",
        media_url: localVideo || undefined,
        media_type: videoMime,
        metadata: localVideo ? undefined : {
          mediaId: msg.video.id,
          mimeType: videoMime,
          downloadFailed: true,
        },
      };
      break;
    }

    case "interactive":
      if (msg.interactive?.type === "button_reply") {
        messageText = msg.interactive.button_reply.title;
      } else if (msg.interactive?.type === "list_reply") {
        messageText = msg.interactive.list_reply.title;
      } else if (msg.interactive?.type === "nfm_reply") {
        // Bruno (2026-05-13): resposta de WhatsApp Flow nativo (C11 cadastro).
        // Marca como pre-processado pelo engine — o handler abaixo na pipeline
        // intercepta antes do dispatch normal.
        // Gera resumo CURTO (1 linha) pro painel CRM em vez de texto técnico
        // "[formulário-cadastro-recebido]" — atendente vê nome/CPF/CEP no
        // histórico. (Bruno, 2026-05-14)
        let shortSummary = "📋 Cadastro preenchido via formulário";
        try {
          const { parseC11FlowReply, formatC11FlowReplyShort } =
            await import("../services/whatsappFlows/flowService");
          const parsed = parseC11FlowReply(msg.interactive.nfm_reply);
          if (parsed) shortSummary = formatC11FlowReplyShort(parsed.data);
        } catch {}
        messageText = shortSummary;
        (mediaContext as any).flowReply = msg.interactive.nfm_reply;
      }
      break;

    case "button":
      messageText = msg.button?.text || "";
      break;

    case "location": {
      // Bruno 2026-05-21: inbound estruturado de localização. Antes virava só
      // texto cru "[localizacao: nome (lat,lng)]" sem render no chat. Agora
      // popula mediaContext.metadata com lat/long/name/address — frontend
      // renderiza bolha com mini-mapa estático + link "abrir no Google Maps".
      // Texto continua humanizado pra fallback (preview do inbox, push, etc).
      const lat = msg.location?.latitude;
      const lng = msg.location?.longitude;
      const locName = msg.location?.name || "";
      const locAddr = msg.location?.address || "";
      const labelParts = [locName, locAddr].filter(Boolean);
      messageText = labelParts.length > 0
        ? `📍 ${labelParts.join(" — ")}`
        : `📍 Localização (${lat}, ${lng})`;
      mediaContext = {
        type: "location",
        text: messageText,
        metadata: {
          latitude: lat,
          longitude: lng,
          name: locName || null,
          address: locAddr || null,
        },
      };
      break;
    }

    case "sticker": {
      // Bruno 2026-05-21: antes só virava texto "[figurinha]" — atendente
      // não conseguia ver a figurinha real que o cliente mandou. Agora
      // baixa o webp via Meta Media API e devolve mediaContext.type='image',
      // que faz o front renderizar a figurinha na bolha. Texto "[figurinha]"
      // segue como fallback pra previews de lista, notificações, etc.
      const stickerId = msg.sticker?.id;
      const stickerMime = msg.sticker?.mime_type || "image/webp";
      if (stickerId) {
        const localSticker = await metaWhatsApp.downloadMetaMedia(stickerId, token, stickerMime, { workspaceId: connection.workspaceId }).catch(() => null);
        messageText = "[figurinha]";
        mediaContext = {
          type: "image",
          text: "",
          media_url: localSticker || undefined,
          media_type: stickerMime,
          metadata: localSticker ? undefined : {
            mediaId: stickerId,
            mimeType: stickerMime,
            isSticker: true,
            downloadFailed: true,
          },
        };
        break;
      }
      messageText = "[figurinha]";
      break;
    }

    case "contacts": {
      // Bruno 2026-05-21: inbound estruturado de contato (vCard). Antes virava
      // só "[contato: Fulano]". Agora popula mediaContext.metadata.contacts[]
      // com name/phones/emails/organization — frontend renderiza card com
      // ações "Salvar como contato" + "Abrir chat (wa.me)". Texto humanizado
      // como "📇 Fulano (+55...)" pra fallback de preview/notificação.
      const contactsArr = (msg.contacts || []) as any[];
      const parsed = contactsArr.map((c: any) => ({
        name: c?.name?.formatted_name || [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(" ") || "",
        phones: (c?.phones || []).map((p: any) => ({
          number: p?.phone || p?.wa_id || "",
          type: p?.type || null,
          waId: p?.wa_id || null,
        })).filter((p: any) => p.number),
        emails: (c?.emails || []).map((e: any) => ({
          email: e?.email || "",
          type: e?.type || null,
        })).filter((e: any) => e.email),
        organization: c?.org?.company || null,
      }));
      const firstName = parsed[0]?.name || "";
      const firstPhone = parsed[0]?.phones?.[0]?.number || "";
      const extra = parsed.length > 1 ? ` +${parsed.length - 1}` : "";
      messageText = firstName
        ? `📇 ${firstName}${firstPhone ? ` (${firstPhone})` : ""}${extra}`
        : `📇 Contato compartilhado`;
      mediaContext = {
        type: "contact",
        text: messageText,
        metadata: { contacts: parsed },
      };
      break;
    }

    default:
      messageText = `[${msg.type}]`;
  }

  if (!messageText) messageText = "[mensagem]";
  mediaContext.text = mediaContext.text || messageText;

  return { messageText, mediaContext };
}

// Recebe o callback de status da Meta (sent/delivered/read/failed) e atualiza
// a tabela `messages` pelo wamid persistido em `external_message_id` no envio
// outbound. Antes, este handler tentava achar a msg via `whatsapp_webhook_events`,
// mas essa tabela só guarda wamids de mensagens INBOUND — nenhum outbound era
// encontrado e o status do painel travava em "sent" pra sempre (sem o 2º
// tracinho de entregue nem o azul de lido). Agora a busca é direta na
// `messages` pelo wamid + direction='out'.
//
// Ordem semântica respeitada: sent < delivered < read. Um `delivered` que
// chegue depois do `read` (atraso de webhook) NÃO regride o status. `failed`
// sobrescreve qualquer estado anterior pra refletir a falha real.
//
// Broadcast `message_updated` pro WS hub: o frontend já consome esse evento
// (handleWsMessageUpdated em inbox.tsx) e re-renderiza o StatusIcon na hora.
async function processStatusUpdate({
  wsId,
  status,
}: {
  wsId: string;
  status: any;
}) {
  if (!status?.id) return;

  const statusMap: Record<string, string> = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };
  const newStatus = statusMap[status.status] || status.status;
  const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

  try {
    const { messages } = await import("@shared/schema");
    const wamid = status.id;

    // Bruno 2026-05-19: log explícito de TODO status recebido — antes só
    // logava em failed. Sem isso, "tracinhos não ficam azuis" virava caixa
    // preta: não dava pra saber se Meta envia `read`, se o webhook recebe,
    // se a query encontra a msg, se o broadcast sai. Agora cada evento
    // deixa rastro pra debug.
    console.log(`[Meta Webhook] STATUS recebido: status=${status.status} wamid=${wamid?.slice(-16)} recipient=${status.recipient_id || '-'}`);

    const [msg] = await db
      .select({
        id: messages.id,
        status: messages.status,
        conversationId: messages.conversationId,
      })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, wsId),
          eq(messages.externalMessageId, wamid),
          eq(messages.direction, "out"),
        ),
      )
      .limit(1);

    if (!msg) {
      // Race possível: status `sent` pode chegar antes da linha outbound ser
      // persistida (sendMessage → insertMessageWithProtocol). Os updates
      // posteriores (delivered/read) sempre encontram a linha — se NÃO acharem,
      // é sinal forte que externalMessageId não foi persistido (bug). Loga.
      console.warn(`[Meta Webhook] STATUS sem msg local: status=${status.status} wamid=${wamid?.slice(-16)} — externalMessageId não persistido ou msg não outbound?`);
      return;
    }

    if (newStatus !== "failed") {
      const currentRank = STATUS_RANK[msg.status || "sent"] ?? 0;
      const nextRank = STATUS_RANK[newStatus] ?? 0;
      if (nextRank <= currentRank) {
        console.log(`[Meta Webhook] STATUS ignorado por rank: msg=${msg.id} atual=${msg.status} novo=${newStatus} (não regride)`);
        return;
      }
    }

    await db.update(messages).set({ status: newStatus }).where(eq(messages.id, msg.id));
    console.log(`[Meta Webhook] STATUS aplicado: msg=${msg.id} conv=${msg.conversationId} ${msg.status} → ${newStatus}`);

    try {
      const { broadcastToWorkspace } = await import("../services/broadcast");
      broadcastToWorkspace(wsId, "message_updated", {
        conversationId: msg.conversationId,
        messageId: msg.id,
        updates: { status: newStatus },
      });
    } catch (broadcastErr: any) {
      console.warn(`[Meta Webhook] STATUS broadcast falhou msg=${msg.id}: ${broadcastErr.message}`);
    }

    if (status.status === "failed") {
      console.error(`[Meta Webhook] Mensagem ${wamid} falhou:`, status.errors);
    }
  } catch (e: any) {
    console.error(`[Meta Webhook] processStatusUpdate erro ${status?.id}:`, e.message);
  }
}

export default router;
