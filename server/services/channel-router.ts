import { db } from "../db";
import { whatsappOfficialConnections, conexoes, instagramConnections } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as metaWhatsApp from "./meta-whatsapp";
import { storage } from "../storage";
import { fetchWithTimeout } from "../utils/helpers";
import { awaitMetaRateLimit, withMetaRetry } from "../utils/metaRateLimit";

/**
 * ARQUITETURA DE CANAIS — ChatBanana
 *
 * Este roteador gerencia os canais de mensageria simultâneos:
 *
 * 1. META CLOUD API OFICIAL (meta-whatsapp.ts)
 *    - Números de WhatsApp Business verificados pela Meta
 *    - Conexão via whatsapp_connections table (Meta Embedded Signup)
 *    - Obrigatório para envio de templates HSM
 *
 * 2. EVOLUTION GO (evolutionAdapter.ts)
 *    - Números não-verificados via QR Code (serviço externo REST + webhook)
 *    - Conexão via tabela conexoes (provider="evolution")
 *
 * 3. INSTAGRAM DM (instagramService.ts)
 *
 * O roteamento é feito por workspace: se há conexão Meta ativa, usa Meta;
 * caso contrário, usa a conexão Evolution conectada.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function isWithin24hWindow(lastCustomerMessageAt: Date | null | undefined): boolean {
  if (!lastCustomerMessageAt) return false;
  return (Date.now() - new Date(lastCustomerMessageAt).getTime()) <= TWENTY_FOUR_HOURS_MS;
}


export interface SendMessageParams {
  workspaceId: string;
  to: string;
  type: "text" | "image" | "audio" | "document" | "video" | "template" | "contact" | "location";
  content?: string;
  mediaUrl?: string;
  // Bruno 2026-05-19: `mediaId` é a alternativa preferida ao `mediaUrl` quando
  // a mídia já foi feita upload direto pra Meta via /media. Resolve casos onde
  // a URL pública não é alcançável (localhost em dev, HTTP em prod sem TLS).
  // Quando os dois são fornecidos, mediaId tem precedência.
  mediaId?: string;
  mediaCaption?: string;
  filename?: string;
  // Audio gravado no painel → renderiza como voice note (player com microfone)
  // em vez de arquivo de áudio. Requer ogg/opus.
  voice?: boolean;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: any[];
  replyToMessageId?: string;
  conversationId?: number;
  conexaoId?: string;
  skipWindowCheck?: boolean;
  // Bruno 2026-05-21: payloads pra tipos novos.
  // type='contact' → array de contatos com nome + phones[] + emails[] + org
  // type='location' → lat/long + nome/endereço opcional
  contacts?: Array<{
    name: string;
    phones: Array<{ number: string; type?: string | null; waId?: string | null }>;
    emails?: Array<{ email: string; type?: string | null }>;
    organization?: string | null;
  }>;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  channel: "meta" | "instagram" | "evolution";
  error?: string;
}

export async function sendTypingIndicator(params: { workspaceId: string; to: string; conversationId?: number; conexaoId?: string; durationMs?: number }): Promise<void> {
  try {
    if (params.conexaoId) {
      const [explicitConexao] = await db
        .select()
        .from(conexoes)
        .where(and(eq(conexoes.id, params.conexaoId), eq(conexoes.workspaceId, params.workspaceId)))
        .limit(1);
      if (explicitConexao && explicitConexao.provider === "evolution") {
        if (explicitConexao.token) {
          try {
            const evo = await import("./evolutionAdapter");
            await evo.sendPresence(explicitConexao.token, params.to, "composing");
          } catch {}
        }
        return;
      }
    }
    const [metaConnection] = await db
      .select()
      .from(whatsappOfficialConnections)
      .where(and(eq(whatsappOfficialConnections.workspaceId, params.workspaceId), eq(whatsappOfficialConnections.status, "active")))
      .limit(1);
    if (metaConnection) {
      const resolvedToken = metaConnection.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "";
      // Meta só mostra "digitando" piggyback num markAsRead de uma msg recebida.
      // Re-dispara usando o wamid cacheado da última inbound desta conversa — assim
      // o typing reaparece durante o processamento e entre as partes (antes o
      // sendTypingIndicator da Meta era no-op e o "digitando" sumia). Bruno 2026-06-13.
      const wamid = params.conversationId != null
        ? metaWhatsApp.getInboundWamid(Number(params.conversationId))
        : null;
      if (wamid) {
        await metaWhatsApp
          .markMessageAsRead(metaConnection.phoneNumberId, resolvedToken, wamid, { typing: true })
          .catch(() => {});
      } else {
        await metaWhatsApp.sendTypingIndicator(metaConnection.phoneNumberId, resolvedToken, params.to);
      }
      return;
    }
    const all = await storage.getConexoes(params.workspaceId);
    const fallbackConexao = all.find((c) => c.status === "connected" && c.provider === "evolution");
    if (fallbackConexao?.token) {
      try {
        const evo = await import("./evolutionAdapter");
        await evo.sendPresence(fallbackConexao.token, params.to, "composing");
      } catch {}
    }
  } catch {}
}

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
  // Truncagem de segurança antes de rotear para qualquer canal
  if (params.content && params.content.length > 4096) {
    console.warn('[sendMessage] texto truncado de', params.content.length, 'para 4096 chars');
    params = { ...params, content: params.content.slice(0, 4093) + '...' };
  }

  if (params.conexaoId) {
    const [igConn] = await db
      .select()
      .from(instagramConnections)
      .where(and(eq(instagramConnections.id, params.conexaoId), eq(instagramConnections.workspaceId, params.workspaceId)))
      .limit(1);
    if (igConn) {
      return sendViaInstagram(params, igConn);
    }

    const [explicitConexao] = await db
      .select()
      .from(conexoes)
      .where(and(eq(conexoes.id, params.conexaoId), eq(conexoes.workspaceId, params.workspaceId)))
      .limit(1);
    if (explicitConexao && explicitConexao.provider === "evolution") {
      return sendViaEvolution(params, explicitConexao);
    }
  }

  const [metaConnection] = await db
    .select()
    .from(whatsappOfficialConnections)
    .where(
      and(
        eq(whatsappOfficialConnections.workspaceId, params.workspaceId),
        eq(whatsappOfficialConnections.status, "active")
      )
    )
    .limit(1);

  if (metaConnection) {
    return sendViaMeta(params, metaConnection);
  }

  const all = await storage.getConexoes(params.workspaceId);
  const fallbackConexao = all.find(
    (c) => c.status === "connected" && c.provider === "evolution"
  );

  if (fallbackConexao) {
    return sendViaEvolution(params, fallbackConexao);
  }

  console.error("[ChannelRouter] No active WhatsApp channel for workspace:", params.workspaceId);
  return {
    success: false,
    error: "Nenhum canal WhatsApp configurado. Conecte via Evolution ou API Oficial.",
    channel: "evolution",
  };
}

async function sendViaMeta(
  params: SendMessageParams,
  connection: typeof whatsappOfficialConnections.$inferSelect
): Promise<SendMessageResult> {
  try {
    const resolvedToken = connection.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "";
    const base = {
      phoneNumberId: connection.phoneNumberId,
      accessToken: resolvedToken,
      to: params.to,
    };

    if (params.type !== "template" && !params.skipWindowCheck) {
      let conv: any = null;
      if (params.conversationId && params.workspaceId) {
        conv = await storage.getConversation(params.conversationId, params.workspaceId);
      }
      if (!isWithin24hWindow(conv?.lastCustomerMessageAt)) {
        console.warn(`[ChannelRouter] 24h window CLOSED for conv=${params.conversationId}, lastCustomerMsg=${conv?.lastCustomerMessageAt || "NULL"}`);
        return {
          success: false,
          channel: "meta",
          error: "WINDOW_CLOSED: Janela de 24h encerrada. Use um template HSM aprovado para contatar este cliente.",
        };
      }
    }

    // Throttle por phone_number_id — espera abrir slot na janela de 1s antes
    // de chamar a Meta. Combinado com withMetaRetry, ainda absorve 429
    // residual (caso outro nó/cliente compartilhe o mesmo limite global).
    await awaitMetaRateLimit(connection.phoneNumberId);

    let messageId: string;

    switch (params.type) {
      case "text": {
        const textResult = await withMetaRetry(
          () => metaWhatsApp.sendTextMessage({
            ...base,
            text: params.content || "",
            replyToMessageId: params.replyToMessageId,
          }),
          'sendTextMessage',
        );
        messageId = textResult.messageId;
        break;
      }
      case "image":
      case "audio":
      case "document":
      case "video": {
        const mediaType = params.type;
        const mediaResult = await withMetaRetry(
          () => metaWhatsApp.sendMediaMessage({
            ...base,
            type: mediaType,
            mediaId: params.mediaId,
            mediaUrl: params.mediaUrl,
            caption: params.mediaCaption,
            filename: params.filename,
            voice: params.voice,
            replyToMessageId: params.replyToMessageId,
          }),
          `sendMediaMessage:${mediaType}`,
        );
        messageId = mediaResult.messageId;
        break;
      }
      case "template": {
        const tplResult = await withMetaRetry(
          () => metaWhatsApp.sendTemplateMessage({
            ...base,
            templateName: params.templateName!,
            language: params.templateLanguage || "pt_BR",
            components: params.templateComponents || [],
          }),
          'sendTemplateMessage',
        );
        messageId = tplResult.messageId;
        break;
      }
      case "contact": {
        const conResult = await withMetaRetry(
          () => metaWhatsApp.sendContactMessage({
            ...base,
            contacts: params.contacts || [],
          }),
          'sendContactMessage',
        );
        messageId = conResult.messageId;
        break;
      }
      case "location": {
        if (!params.location) throw new Error("location payload missing");
        const locResult = await withMetaRetry(
          () => metaWhatsApp.sendLocationMessage({
            ...base,
            latitude: params.location!.latitude,
            longitude: params.location!.longitude,
            name: params.location!.name,
            address: params.location!.address,
          }),
          'sendLocationMessage',
        );
        messageId = locResult.messageId;
        break;
      }
      default:
        throw new Error(`Unsupported message type: ${params.type}`);
    }

    db.update(whatsappOfficialConnections)
      .set({ lastUsedAt: new Date() })
      .where(eq(whatsappOfficialConnections.id, connection.id))
      .catch(() => {});

    return { success: true, messageId, channel: "meta" };
  } catch (err: any) {
    console.error("[ChannelRouter] Meta send failed:", err.message);
    return { success: false, error: err.message, channel: "meta" };
  }
}

async function sendViaInstagram(
  params: SendMessageParams,
  connection: typeof instagramConnections.$inferSelect
): Promise<SendMessageResult> {
  try {
    console.log(`[ChannelRouter] sendViaInstagram: to=${params.to}, type=${params.type}, igUserId=${connection.igUserId}`);
    if (params.type === "text") {
      const { sendInstagramDM } = await import("./instagramService");
      const result = await sendInstagramDM(connection.accessToken, connection.igUserId, params.to, params.content || "");
      if (result.error) {
        return { success: false, error: result.error, channel: "instagram" };
      }
      return { success: true, messageId: result.messageId, channel: "instagram" };
    }

    if (params.type === "image" && params.mediaUrl) {
      const apiBase = connection.accessToken?.startsWith("IGAA")
        ? "https://graph.instagram.com/v21.0"
        : "https://graph.facebook.com/v21.0";
      const res = await fetch(`${apiBase}/${connection.igUserId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${connection.accessToken}` },
        body: JSON.stringify({
          recipient: { id: params.to },
          message: { attachment: { type: "image", payload: { url: params.mediaUrl } } },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: JSON.stringify(data), channel: "instagram" };
      }
      return { success: true, messageId: data.message_id, channel: "instagram" };
    }

    return { success: false, error: `Tipo ${params.type} nao suportado via Instagram DM. Apenas texto e imagem sao permitidos.`, channel: "instagram" };
  } catch (err: any) {
    console.error("[ChannelRouter] Instagram send failed:", err.message);
    return { success: false, error: err.message, channel: "instagram" };
  }
}

// ─── Evolution GO (serviço externo via REST — evolutionAdapter.ts) ────────────
// Bruno 2026-06-09: canal não-oficial via QR Code. Usa o `token` da conexão
// (apikey da instância). Mídia vai pelo campo `url` (URL pública OU data URL).
async function sendViaEvolution(params: SendMessageParams, conexao: any): Promise<SendMessageResult> {
  try {
    const token = conexao?.token;
    if (!token) {
      return { success: false, error: "Conexão Evolution sem token de instância", channel: "evolution" };
    }
    const evo = await import("./evolutionAdapter");

    switch (params.type) {
      case "text": {
        const r = await evo.sendText(token, params.to, params.content || "", params.replyToMessageId);
        if (!r.sent) return { success: false, error: r.error || "Falha ao enviar via Evolution", channel: "evolution" };
        return { success: true, channel: "evolution", messageId: r.messageId };
      }
      case "image":
      case "video":
      case "audio":
      case "document": {
        // Evolution usa URL pública OU data URL base64 no campo `url`. O `mediaId`
        // é um handle interno da Meta — não vale aqui.
        const media = params.mediaUrl;
        if (!media) {
          const hint = params.mediaId ? " (mediaId da Meta não vale no Evolution — envie mediaUrl/base64)" : "";
          return { success: false, error: `mídia ausente para ${params.type}${hint}`, channel: "evolution" };
        }
        const r = await evo.sendMedia(token, params.to, params.type, media, params.mediaCaption, params.filename, {
          voice: params.voice, replyTo: params.replyToMessageId,
        });
        if (!r.sent) return { success: false, error: r.error || `Falha ao enviar ${params.type} via Evolution`, channel: "evolution" };
        return { success: true, channel: "evolution", messageId: r.messageId };
      }
      case "contact": {
        // Evolution GO não tem envio nativo de vCard garantido → degrada pra texto.
        const lines = (params.contacts || []).map((c) => {
          const tel = (c.phones || []).map((p) => p.number).filter(Boolean).join(", ");
          return `👤 ${c.name}${tel ? ` — ${tel}` : ""}${c.organization ? ` (${c.organization})` : ""}`;
        });
        const r = await evo.sendText(token, params.to, lines.length ? lines.join("\n") : "👤 Contato");
        if (!r.sent) return { success: false, error: r.error || "Falha ao enviar contato via Evolution", channel: "evolution" };
        return { success: true, channel: "evolution", messageId: r.messageId };
      }
      case "location": {
        // Evolution GO não tem envio nativo de localização garantido → texto + link Maps.
        const loc = params.location;
        const txt = loc
          ? `📍 ${loc.name || "Localização"}${loc.address ? `\n${loc.address}` : ""}\nhttps://maps.google.com/?q=${loc.latitude},${loc.longitude}`
          : "📍 Localização";
        const r = await evo.sendText(token, params.to, txt);
        if (!r.sent) return { success: false, error: r.error || "Falha ao enviar localização via Evolution", channel: "evolution" };
        return { success: true, channel: "evolution", messageId: r.messageId };
      }
      case "template":
        return { success: false, error: "Templates HSM só via WhatsApp API Oficial (Meta). A conexão Evolution não suporta template.", channel: "evolution" };
      default:
        return { success: false, error: `Tipo não suportado via Evolution: ${params.type}`, channel: "evolution" };
    }
  } catch (err: any) {
    console.error("[ChannelRouter] Evolution send failed:", err.message);
    return { success: false, error: err.message, channel: "evolution" };
  }
}
