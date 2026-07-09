import { db } from "../db";
import { instagramMessages, automacoes, conversations, messages, leads, pipelineStages, teams, teamMembers, users } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { upsertInstagramLead, sendInstagramDM } from "./instagramService";
import { storage } from "../storage";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { uploadsDir } from "../utils/uploadsDir";
import { broadcastToWorkspace } from './broadcast';
import { findRecentDuplicateInbound } from "../utils/messageInsert";

async function downloadInstagramMedia(cdnUrl: string, messageType: string): Promise<string | null> {
  try {
    // Bruno 2026-06-18 (auditoria SSRF): bloqueia download de host interno/privado.
    const { assertSafeOutboundUrl } = await import("../utils/ssrfGuard");
    assertSafeOutboundUrl(cdnUrl);
    const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`[Instagram] Download media failed: HTTP ${res.status}`);
      return null;
    }
    const ct = res.headers.get("content-type") || "";
    let ext = "bin";
    if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
    else if (ct.includes("png")) ext = "png";
    else if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("gif")) ext = "gif";
    else if (ct.includes("mp4")) ext = "mp4";
    else if (ct.includes("ogg") || ct.includes("opus")) ext = "ogg";
    else if (ct.includes("mp3") || ct.includes("mpeg")) ext = "mp3";
    else if (messageType === "image") ext = "jpg";
    else if (messageType === "video") ext = "mp4";
    else if (messageType === "audio") ext = "ogg";

    const uploadDir = uploadsDir;
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filename = `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(uploadDir, filename);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    console.log(`[Instagram] Media downloaded: ${filename} (${buf.length} bytes)`);
    return `/uploads/${filename}`;
  } catch (err: any) {
    console.error(`[Instagram] downloadInstagramMedia error:`, err.message);
    return null;
  }
}

interface InstagramMessageEvent {
  workspaceId: string;
  connectionId: string;
  igAccountUserId: string;
  accessToken: string;
  senderIgUserId: string;
  recipientIgUserId: string;
  senderUsername?: string;
  message: {
    mid: string;
    text?: string;
    attachments?: Array<{ type: string; payload: { url: string } }>;
    is_echo?: boolean;
  };
  skipAutomations?: boolean;
}

export interface InstagramProfileResult {
  username: string | null;
  displayName: string | null;
  profilePic: string | null;
  biography: string | null;
}

export async function fetchInstagramProfile(accessToken: string, igUserId: string): Promise<InstagramProfileResult> {
  const endpoints = [
    `https://graph.instagram.com/v21.0/${igUserId}?fields=name,username,profile_pic,follower_count&access_token=${accessToken}`,
    `https://graph.facebook.com/v21.0/${igUserId}?fields=name,username,profile_pic,follower_count&access_token=${accessToken}`,
    `https://graph.facebook.com/v21.0/${igUserId}?fields=name,username,profile_picture_url&access_token=${accessToken}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.log(`[IG Profile] ${res.status} for ${igUserId}: ${errText.slice(0, 200)}`);
        continue;
      }
      const data = await res.json();
      console.log(`[IG Profile] Got data for ${igUserId}:`, JSON.stringify({ name: data.name, username: data.username, followers: data.follower_count, hasProfilePic: !!(data.profile_pic || data.profile_picture_url) }));
      const uname = data.username || data.name;
      if (uname) {
        return {
          username: data.username || null,
          displayName: data.name || null,
          profilePic: data.profile_pic || data.profile_picture_url || null,
          biography: null,
        };
      }
    } catch (err: any) {
      console.log(`[IG Profile] Error fetching ${igUserId}:`, err.message);
      continue;
    }
  }
  return { username: null, displayName: null, profilePic: null, biography: null };
}

export async function processInstagramMessage(event: InstagramMessageEvent) {
  const {
    workspaceId,
    connectionId,
    igAccountUserId,
    accessToken,
    senderIgUserId,
    recipientIgUserId,
    senderUsername: rawUsername,
    message,
    skipAutomations,
  } = event;

  const [existing] = await db
    .select()
    .from(instagramMessages)
    .where(and(
      eq(instagramMessages.igMessageId, message.mid),
      eq(instagramMessages.workspaceId, workspaceId)
    ))
    .limit(1);
  if (existing) return;

  const isEcho = !!message.is_echo;
  if (isEcho) {
    console.log(`[Instagram] Echo message from business → customer ${senderIgUserId}: "${(message.text || "").slice(0, 80)}"`);
  }

  const att = message.attachments?.[0];
  const attType = att?.type;
  const attPayload = (att?.payload || {}) as { url?: string; src?: string };
  const rawMediaUrl = attPayload.url || attPayload.src;
  const shareUrl = attType === "share" ? (attPayload.url || attPayload.src) : null;
  const messageType = attType === "image" ? "image"
    : attType === "video" || attType === "ig_reel" ? "video"
    : attType === "audio" ? "audio"
    : attType === "share" ? (shareUrl ? "video" : "text")
    : attType === "file" || attType === "fallback" ? "file"
    : attType === "story_mention" ? "image"
    : attType === "animated_image" || attType === "sticker" ? "image"
    : attType && rawMediaUrl ? "image"
    : message.text ? "text"
    : attType ? "text"
    : "unknown";

  let mediaUrl = rawMediaUrl || null;
  if (rawMediaUrl && (messageType === "image" || messageType === "video" || messageType === "audio")) {
    const localPath = await downloadInstagramMedia(rawMediaUrl, messageType);
    if (localPath) {
      mediaUrl = localPath;
    }
  }

  const attFriendlyName = attType === "story_mention" ? "[menção no story]"
    : attType === "animated_image" ? "[GIF]"
    : attType === "sticker" ? "[figurinha]"
    : attType === "share" && !shareUrl ? "[compartilhamento]"
    : null;
  const content = message.text || attFriendlyName || (mediaUrl ? `[${messageType}]` : (attType ? `[${attType}]` : ""));

  let igUsername = rawUsername || "";
  let profilePicUrl: string | null = null;
  let igDisplayName: string | null = null;
  let igBio: string | null = null;
  if (!isEcho) {
    if (!igUsername || igUsername === senderIgUserId) {
      const profile = await fetchInstagramProfile(accessToken, senderIgUserId);
      if (profile.username) igUsername = profile.username;
      igDisplayName = profile.displayName;
      if (profile.profilePic) profilePicUrl = profile.profilePic;
      igBio = profile.biography;
    } else {
      const profile = await fetchInstagramProfile(accessToken, senderIgUserId);
      igDisplayName = profile.displayName;
      if (profile.profilePic) profilePicUrl = profile.profilePic;
      igBio = profile.biography;
    }
  }
  const usernameForLead = igUsername ? `@${igUsername.replace(/^@/, "")}` : null;
  const contactName = igDisplayName || usernameForLead || `@ig_${senderIgUserId}`;

  let lead = null;
  if (!isEcho) {
    try {
      lead = await upsertInstagramLead(
        workspaceId,
        senderIgUserId,
        contactName,
        usernameForLead,
        igBio
      );
    } catch (err) {
      console.error("[Instagram] Erro ao upsert lead:", err);
    }

    // Bruno 2026-05-21: garante registro em `contacts` (lista de Clientes).
    // Instagram usa senderIgUserId como "telefone" — chave estável dentro do
    // workspace. UNIQUE (workspaceId, telefone) impede duplicata.
    try {
      const { upsertContactByPhone } = await import("../utils/contactSync");
      await upsertContactByPhone({
        workspaceId,
        telefone: senderIgUserId,
        nome: contactName,
        canal: "Instagram",
      });
    } catch {}
  }

  await db.insert(instagramMessages).values({
    workspaceId,
    instagramConnectionId: connectionId,
    igMessageId: message.mid,
    fromIgUserId: isEcho ? igAccountUserId : senderIgUserId,
    toIgUserId: isEcho ? senderIgUserId : igAccountUserId,
    direction: isEcho ? "outbound" : "inbound",
    messageType,
    content: message.text || null,
    mediaUrl: mediaUrl || null,
    leadId: lead?.id || null,
    metadata: { raw: message },
  });

  let conversationId: number | undefined;
  let savedMessage: any = null;
  let echoSkipped = false;
  try {
    const [existingConv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.telefone, senderIgUserId)
        )
      )
      .limit(1);

    if (existingConv) {
      conversationId = existingConv.id;
      if (isEcho) {
        await db
          .update(conversations)
          .set({
            ultimaMensagem: content,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, existingConv.id));
      } else {
        const convUpdate: Record<string, any> = {
          ultimaMensagem: content,
          unread: (existingConv.unread || 0) + 1,
          updatedAt: new Date(),
          lastCustomerMessageAt: new Date(),
          status: "open",
          pendente: true,
        };
        const hasPlaceholderConvName = existingConv.nome?.startsWith("@ig_") || existingConv.nome?.startsWith("ig_") || existingConv.nome?.startsWith("@");
        if (hasPlaceholderConvName && contactName && !contactName.startsWith("@ig_") && !contactName.startsWith("@")) {
          convUpdate.nome = lead?.nome || contactName;
        } else if (hasPlaceholderConvName && igDisplayName) {
          convUpdate.nome = igDisplayName;
        }
        if (profilePicUrl && !existingConv.avatar) {
          convUpdate.avatar = profilePicUrl;
        }
        await db
          .update(conversations)
          .set(convUpdate)
          .where(eq(conversations.id, existingConv.id));
      }
    } else if (!isEcho) {
      const leadName = lead?.nome || contactName;
      const newConv = await storage.createConversation({
        nome: leadName,
        telefone: senderIgUserId,
        canal: "Instagram",
        ultimaMensagem: content,
        tempo: "agora",
        unread: 1,
        status: "open",
        pendente: true,
        conexaoId: connectionId,
        workspaceId,
        avatar: profilePicUrl || null,
      } as any);
      conversationId = newConv.id;

    }

    if (conversationId) {
      const msgDirection = isEcho ? "out" : "in";
      let skipSave = false;

      // Defesa contra replay de webhook (multi-device sync). Só inbound de
      // texto puro — mídia tem hash diferente em re-upload.
      if (!isEcho && content && messageType === "text") {
        const dup = await findRecentDuplicateInbound({
          workspaceId,
          conversationId,
          texto: content,
        });
        if (dup) {
          console.log(`[Instagram] 🛡️ Replay defensivo: msg duplicada em <30s ignorada (conv=${conversationId} mid=${(message.mid || '').slice(-12)} texto="${content.slice(0, 40)}")`);
          try {
            const { traceAgent, TRACE_STAGES } = await import("../utils/agentTrace");
            traceAgent({
              workspaceId,
              conversationId,
              stage: TRACE_STAGES.DEDUP_BLOCKED,
              data: { source: 'instagram', mid: (message.mid || '').slice(-12), msgPreview: content.slice(0, 80) },
            });
          } catch {}
          return;
        }
      }

      if (isEcho && content) {
        const recentOutbound = await db.select({ id: messages.id })
          .from(messages)
          .where(and(
            eq(messages.conversationId, conversationId),
            eq(messages.direction, "out"),
            eq(messages.workspaceId, workspaceId),
          ))
          .orderBy(desc(messages.id))
          .limit(1);
        if (recentOutbound.length > 0) {
          const [recentMsg] = await db.select().from(messages)
            .where(eq(messages.id, recentOutbound[0].id)).limit(1);
          const cleanEcho = content.trim().replace(/^\*[^*]+:\*\n/, "").trim();
          const cleanRecent = (recentMsg?.texto || "").replace(/^\*[^*]+:\*\n/, "").trim();
          if (cleanEcho === cleanRecent) {
            skipSave = true;
            echoSkipped = true;
            savedMessage = recentMsg;
          }
        }
      }
      if (!skipSave) {
        savedMessage = await storage.createMessage({
          conversationId,
          texto: content,
          direction: msgDirection,
          tipo: messageType === "text" ? "texto" : messageType,
          hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
          agente: isEcho ? "Instagram" : (lead?.nome || contactName),
          arquivo: mediaUrl || undefined,
          nomeArquivo: mediaUrl ? (messageType === "image" ? "imagem.jpg" : messageType === "video" ? "video.mp4" : messageType === "audio" ? "audio.mp4" : undefined) : undefined,
          workspaceId,
          status: isEcho ? "sent" : "received",
          externalMessageId: message.mid || null,
        } as any);
      }
    }
  } catch (convErr: any) {
    console.error("[Instagram] Conversation upsert error:", convErr.message);
  }

  if (!isEcho && conversationId && content) {
    try {
      const [conv] = await db.select().from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
        .limit(1);
      if (conv && !conv.pipeline) {
        // Bruno 2026-06-28: CRM genérico — toda conversa nova de IG sem trilho
        // entra no Comercial, etapa "Novo" (stageKey UNIVERSAL, nunca label).
        const comStages = await db.select().from(pipelineStages)
          .where(and(eq(pipelineStages.workspaceId, workspaceId), eq(pipelineStages.pipeline, "comercial")));
        const novoStage = comStages.find((s: any) => s.key.replace(/_[a-f0-9]{8}$/, "") === "novo") || comStages[0];
        if (novoStage) {
          if (lead) {
            await db.update(leads).set({ status: novoStage.key, pipeline: "comercial", prioridade: "media" }).where(eq(leads.id, lead.id));
          }
          await db.update(conversations).set({ pipeline: "comercial", pipelineEtapa: novoStage.key, prioridade: "media" })
            .where(eq(conversations.id, conversationId));
        }
      }
    } catch (pErr: any) {
      console.error("[Instagram] Pipeline assignment error:", pErr.message);
    }
  }

  if (conversationId && !echoSkipped) {
    try {
      const msgDirection = isEcho ? "out" : "in";
      broadcastToWorkspace(workspaceId, "new_message", {
        conversationId,
        message: {
          id: savedMessage?.id ?? null,
          texto: content,
          tipo: messageType === "text" ? "texto" : messageType,
          arquivo: mediaUrl || null,
          nomeArquivo: mediaUrl ? (messageType === "image" ? "imagem.jpg" : messageType === "video" ? "video.mp4" : messageType === "audio" ? "audio.mp4" : null) : null,
          direction: msgDirection,
          hora: new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          }),
          status: isEcho ? "sent" : "received",
          createdAt: new Date().toISOString(),
        },
        conversation: {
          id: conversationId,
          nome: lead?.nome || contactName,
        },
      });
      broadcastToWorkspace(workspaceId, "conversation_updated", {
        conversationId,
        ultimaMensagem: content,
        tempo: "agora",
      });
    } catch (err) {
      console.error("[Instagram] Erro ao broadcast:", err);
    }

    if (!isEcho && !skipAutomations && lead) {
      try {
        const pending = await storage.getPendingInputByPhone(senderIgUserId, workspaceId);
        if (pending) {
          const autoCheck = await storage.getAutomacao(pending.flowId, workspaceId);
          if (!autoCheck || autoCheck.status !== "ACTIVE") {
            await storage.deletePendingInput(pending.id);
          } else {
            const pendingType = (pending as any).pendingType || "option_list";
            const pendingCtx = (pending.context as any) || {};
            const pauseData = pendingCtx.pauseData || {};
            const isWaitingForReply =
              pendingType === "wait" &&
              (pauseData.eventType === "client_reply" || pauseData.eventType === "new_message");

            if (pendingType === "wait" && !isWaitingForReply) {
              return;
            }

            if (content) {
              try {
                const { conversations: convTable } = await import("@shared/schema");
                await db
                  .update(convTable)
                  .set({ ultimaMensagem: content, tempo: "agora", updatedAt: new Date() })
                  .where(
                    and(
                      eq(convTable.id, pendingCtx.conversationId ?? conversationId!),
                      eq(convTable.workspaceId, workspaceId)
                    )
                  );
              } catch (e: any) { console.error("[InstagramProcessor] conversation update failed:", e.message); }
            }

            const { resumeAutomationFlow } = await import("./automationEngine");
            await storage.deletePendingInput(pending.id);
            await resumeAutomationFlow(pending, "__text_input__", {
              text: content,
              type: messageType as any,
              media_url: mediaUrl ?? undefined,
            });
            return;
          }
        }
      } catch (pendingErr: any) {
        console.error("[Instagram] Pending input error:", pendingErr.message);
      }
    }

    if (!skipAutomations) try {
      const activeAutomations = await db
        .select()
        .from(automacoes)
        .where(
          and(
            eq(automacoes.workspaceId, workspaceId),
            eq(automacoes.status, "ACTIVE")
          )
        );

      if (!conversationId) {
        console.warn("[Instagram] conversationId indefinido, automação não disparada para", senderIgUserId);
        return;
      }

      let automationFired = false;
      for (const auto of activeAutomations) {
        if (automationFired) break;
        const nodesArr = Array.isArray(auto.nodes) ? (auto.nodes as any[]) : [];
        const triggerNode = nodesArr.find((n: any) => n.type === "trigger");
        if (!triggerNode) continue;
        const triggerType = triggerNode.config?.triggerType;
        if (triggerType !== "instagram_dm") continue;

        automationFired = true;
        const { runFlowFromNode } = await import("./automationEngine");
        const ctx = {
          workspaceId,
          leadId: lead!.id,
          phone: senderIgUserId,
          conexaoId: connectionId,
          conversationId,
          message: {
            text: message.text || "",
            type: messageType as any,
            media_url: mediaUrl,
          },
          variables: {
            nome: lead!.nome || senderIgUserId,
            messageText: message.text || "",
            canal: "instagram",
          },
          executionId: randomUUID(),
        };
        await runFlowFromNode(auto.id!, nodesArr, triggerNode.id, ctx as any);
      }
    } catch (autoErr: any) {
      console.error("[Instagram] Automation trigger error:", autoErr.message);
    }
  }
}
