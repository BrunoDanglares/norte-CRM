import { db } from "../db";
import { instaProspectFlows, instaProspectSessions, conversations, messages, leads } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendInstagramDM, sendInstagramPrivateReply, replyInstagramComment, upsertInstagramLead } from "./instagramService";
import { storage } from "../storage";

async function resolveLeadName(workspaceId: string, igUserId: string): Promise<string> {
  try {
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), eq(leads.telefone, igUserId)))
      .limit(1);
    return lead?.nome || "";
  } catch { return ""; }
}

function replaceVariables(text: string, username: string, nome: string): string {
  return text
    .replace(/\{\{username\}\}/gi, username || "voce")
    .replace(/\{\{nome\}\}/gi, nome || username || "voce");
}

async function saveOutboundToChat(workspaceId: string, igUserId: string, text: string) {
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.telefone, igUserId)
        )
      )
      .limit(1);

    if (!conv) return;

    await storage.createMessage({
      conversationId: conv.id,
      texto: text,
      direction: "out",
      tipo: "texto",
      hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
      agente: "Banana AI",
      workspaceId,
    } as any);

    await db.update(conversations)
      .set({ ultimaMensagem: text, updatedAt: new Date() })
      .where(eq(conversations.id, conv.id));

    try {
      broadcastToWorkspace(workspaceId, "conversation_updated", { conversationId: conv.id });
    } catch (e: any) { console.error("[InstaProspect] broadcast error:", e.message); }
  } catch (err: any) {
    console.error("[InstaProspect] Erro ao salvar msg outbound:", err.message);
  }
}

import { resolveOpenAIKeys } from './openaiKeyResolver';
import { broadcastToWorkspace } from './broadcast';
import { getOpenAIClient } from './openaiClient';

async function resolveOpenAIKeyCandidates(workspaceId?: string) {
  return resolveOpenAIKeys(workspaceId);
}

async function callAI(systemPrompt: string, history: any[], newMessage: string, opts?: { model?: string; temperature?: number; maxTokens?: number; workspaceId?: string }): Promise<string | null> {
  const candidates = await resolveOpenAIKeyCandidates(opts?.workspaceId);
  if (candidates.length === 0) return null;

  const msgs = [
    { role: "system", content: systemPrompt },
    ...history.map((h: any) => ({ role: h.role, content: h.content })),
    { role: "user", content: newMessage },
  ];

  for (const candidate of candidates) {
    try {
      const res = await fetch(`${candidate.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${candidate.apiKey}`,
        },
        body: JSON.stringify({
          model: opts?.model || "gpt-4o-mini",
          messages: msgs,
          max_tokens: opts?.maxTokens || 300,
          temperature: opts?.temperature ?? 0.7,
        }),
      });

      const data = await res.json();
      if (data.error) {
        console.error(`[InstaProspect AI] ❌ FAILED via source=${candidate.source}: ${data.error?.message || JSON.stringify(data.error)}`);
        continue;
      }
      console.log(`[InstaProspect AI] ✅ OK via source=${candidate.source}`);
      return data.choices?.[0]?.message?.content?.trim() || "Desculpe, tente novamente em instantes.";
    } catch (err: any) {
      console.error(`[InstaProspect AI] ❌ FAILED via source=${candidate.source}: ${err.message}`);
    }
  }

  return "Desculpe, tente novamente em instantes.";
}

export async function handleInstaProspectDM(params: {
  workspaceId: string;
  connectionId: string;
  accessToken: string;
  igAccountUserId: string;
  senderIgUserId: string;
  senderIgUsername: string;
  messageText: string;
  linkedFlowId?: string | null;
  attachments?: Array<{ type: string; payload: { url: string } }>;
}): Promise<boolean> {
  const { workspaceId, connectionId, accessToken, igAccountUserId,
    senderIgUserId, senderIgUsername, messageText, linkedFlowId, attachments } = params;

  let effectiveText = messageText;
  if (!effectiveText && attachments?.length) {
    const att = attachments[0];
    if (att.type === "audio") {
      try {
        const aiCandidates = await resolveOpenAIKeyCandidates(workspaceId);
        if (aiCandidates.length > 0) {
          const aiConfig = aiCandidates[0];
          const OpenAI = (await import("openai")).default;
          const { toFile } = await import("openai");
          const aiClient = getOpenAIClient({ apiKey: aiConfig.apiKey, baseURL: aiConfig.baseURL });
          // Bruno 2026-06-18 (auditoria SSRF): bloqueia download de host interno/privado.
          const { assertSafeOutboundUrl } = await import("../utils/ssrfGuard");
          assertSafeOutboundUrl(att.payload.url);
          const audioResp = await fetch(att.payload.url);
          if (audioResp.ok) {
            const audioBuf = Buffer.from(await audioResp.arrayBuffer());
            const audioFile = await toFile(audioBuf, "audio.mp4", { type: "audio/mp4" });
            const transcription = await aiClient.audio.transcriptions.create({
              file: audioFile,
              model: "whisper-1",
              language: "pt",
            });
            effectiveText = transcription.text || "[audio nao compreendido]";
          }
        }
      } catch (e: any) {
        console.error("[InstaProspect DM] Audio transcription error:", e.message);
        effectiveText = "[audio recebido]";
      }
    } else if (att.type === "image") {
      effectiveText = "[imagem recebida]";
    } else if (att.type === "video") {
      effectiveText = "[video recebido]";
    } else {
      effectiveText = `[${att.type} recebido]`;
    }
  }

  try {
    const [existingSession] = await db
      .select()
      .from(instaProspectSessions)
      .where(and(
        eq(instaProspectSessions.workspaceId, workspaceId),
        eq(instaProspectSessions.igUserId, senderIgUserId),
        eq(instaProspectSessions.status, "em_andamento")
      ))
      .limit(1);

    if (existingSession) {
      const [activeFlow] = await db.select().from(instaProspectFlows)
        .where(and(eq(instaProspectFlows.id, existingSession.flowId), eq(instaProspectFlows.ativo, true)))
        .limit(1);
      if (!activeFlow) {
        console.warn(`[InstaProspect DM] Sessao ativa para ${senderIgUserId} mas fluxo desativado, encerrando sessao`);
        await db.update(instaProspectSessions)
          .set({ status: "encerrado", updatedAt: new Date() })
          .where(eq(instaProspectSessions.id, existingSession.id));
        return false;
      }
      await continueAIConversation({
        session: existingSession,
        accessToken,
        igAccountUserId,
        newMessage: effectiveText,
      });
      return true;
    }

    if (!linkedFlowId) {
      return false;
    }

    const [linked] = await db
      .select()
      .from(instaProspectFlows)
      .where(and(
        eq(instaProspectFlows.id, linkedFlowId),
        eq(instaProspectFlows.workspaceId, workspaceId),
        eq(instaProspectFlows.ativo, true)
      ))
      .limit(1);

    if (!linked || !linked.dmEnabled) {
      return false;
    }

    let matchedFlow: typeof instaProspectFlows.$inferSelect | undefined;
    const kw = (linked.dmKeyword || linked.keyword)?.trim();
    const matchType = linked.dmKeywordMatchType || linked.keywordMatchType;
    if (!kw || matchType === "any") {
      matchedFlow = linked;
    } else {
      const text = effectiveText.toLowerCase().trim();
      const kwLower = kw.toLowerCase();
      if (matchType === "exact" ? text === kwLower : text.includes(kwLower)) {
        matchedFlow = linked;
      }
    }

    if (!matchedFlow) {
      return false;
    }


    const lead = await upsertInstagramLead(workspaceId, senderIgUserId, senderIgUsername);
    const leadName = lead.nome || "";

    const [session] = await db.insert(instaProspectSessions).values({
      workspaceId,
      flowId: matchedFlow.id,
      leadId: lead.id,
      igUserId: senderIgUserId,
      igUsername: senderIgUsername,
      status: "em_andamento",
      triggerType: "dm",
      triggerContent: effectiveText,
      conversationHistory: [],
    }).returning();

    const dmDelay = matchedFlow.delaySeconds || 0;
    if (matchedFlow.firstMessage) {
      const firstMsg = replaceVariables(matchedFlow.firstMessage, senderIgUsername, leadName);
      if (dmDelay > 0) await new Promise(r => setTimeout(r, dmDelay * 1000));
      const firstResult = await sendInstagramDM(accessToken, igAccountUserId, senderIgUserId, firstMsg);
      if (!firstResult.error) {
        await saveOutboundToChat(workspaceId, senderIgUserId, firstMsg);
      }
      await db.update(instaProspectSessions)
        .set({
          conversationHistory: [
            { role: "assistant", content: firstMsg, timestamp: new Date().toISOString() },
            { role: "user", content: messageText, timestamp: new Date().toISOString() },
          ],
          updatedAt: new Date(),
        })
        .where(eq(instaProspectSessions.id, session.id));
    } else {
      await continueAIConversation({
        session,
        accessToken,
        igAccountUserId,
        newMessage: messageText,
        flow: matchedFlow,
      });
    }

    await db.update(instaProspectFlows)
      .set({ totalTriggers: sql`coalesce(${instaProspectFlows.totalTriggers}, 0) + 1` })
      .where(eq(instaProspectFlows.id, matchedFlow.id));

    return true;
  } catch (err: any) {
    console.error("[InstaProspect DM] Erro:", err.message);
    return false;
  }
}

async function continueAIConversation(params: {
  session: typeof instaProspectSessions.$inferSelect;
  accessToken: string;
  igAccountUserId: string;
  newMessage: string;
  flow?: typeof instaProspectFlows.$inferSelect;
}) {
  const { session, accessToken, igAccountUserId, newMessage } = params;

  let flow = params.flow;
  if (!flow) {
    const [f] = await db
      .select()
      .from(instaProspectFlows)
      .where(eq(instaProspectFlows.id, session.flowId))
      .limit(1);
    flow = f;
  }

  if (!flow) return;

  const history = (session.conversationHistory as any[]) || [];

  const username = session.igUsername || "";
  const leadName = await resolveLeadName(session.workspaceId, session.igUserId);
  const displayName = leadName || username;
  const contextPrefix = `REGRAS OBRIGATÓRIAS (NUNCA VIOLAR):\n1. O nome do cliente é "${displayName}". SEMPRE chame o cliente por "${displayName}" desde a primeira mensagem.\n2. NUNCA pergunte o nome do cliente. Você JÁ SABE o nome dele: "${displayName}".\n3. NUNCA diga "como posso te chamar", "qual seu nome", "com quem falo" ou qualquer variação.\n4. Use "${displayName}" naturalmente nas mensagens como se já conhecesse a pessoa.\n5. Seja cordial, natural e direto.\n6. Username do Instagram: @${username}\n\nINSTRUÇÕES DO FLUXO:\n`;
  const fullSystemPrompt = contextPrefix + flow.aiSystemPrompt;

  const aiResponse = await callAI(fullSystemPrompt, history, newMessage, {
    model: flow.aiModel || "gpt-4o-mini",
    temperature: flow.aiTemperature ?? 0.7,
    maxTokens: flow.aiMaxTokens ?? 300,
    workspaceId: session.workspaceId,
  });

  if (!aiResponse) {
    console.warn("[InstaProspect AI] API key indisponivel para workspace", session.workspaceId);
    return;
  }

  const delay = flow.delaySeconds || 0;
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
  }

  const dmResult = await sendInstagramDM(accessToken, igAccountUserId, session.igUserId, aiResponse);
  if (dmResult.error) {
    console.error("[InstaProspect AI] DM erro:", dmResult.error);
  } else {
    await saveOutboundToChat(session.workspaceId, session.igUserId, aiResponse);
  }

  const updatedHistory = [
    ...history,
    { role: "user", content: newMessage, timestamp: new Date().toISOString() },
    { role: "assistant", content: aiResponse, timestamp: new Date().toISOString() },
  ];

  const isQualified = aiResponse.includes("LEAD_QUALIFICADO:") || updatedHistory.length >= 10;

  await db.update(instaProspectSessions)
    .set({
      conversationHistory: updatedHistory,
      status: isQualified ? "qualificado" : "em_andamento",
      updatedAt: new Date(),
    })
    .where(eq(instaProspectSessions.id, session.id));

  if (isQualified && flow.finalAction === "atribuir_agente") {
    await handleQualifiedLead({ session, flow, accessToken, igAccountUserId });
  }
}

async function handleQualifiedLead(params: {
  session: typeof instaProspectSessions.$inferSelect;
  flow: typeof instaProspectFlows.$inferSelect;
  accessToken: string;
  igAccountUserId: string;
}) {
  const { session, flow, accessToken, igAccountUserId } = params;

  const qualMsg = "Perfeito! Registrei tudo aqui. Um dos nossos consultores vai continuar o atendimento em breve. Obrigado!";
  const qualResult = await sendInstagramDM(accessToken, igAccountUserId, session.igUserId, qualMsg);
  if (!qualResult.error) {
    await saveOutboundToChat(session.workspaceId, session.igUserId, qualMsg);
  }

  await db.update(instaProspectFlows)
    .set({ totalLeads: sql`coalesce(${instaProspectFlows.totalLeads}, 0) + 1` })
    .where(eq(instaProspectFlows.id, flow.id));
}

export async function handleInstaProspectComment(params: {
  workspaceId: string;
  connectionId: string;
  accessToken: string;
  igAccountUserId: string;
  commentId: string;
  postId: string;
  fromIgUserId: string;
  fromIgUsername: string;
  commentText: string;
  linkedFlowId?: string | null;
}) {
  const { workspaceId, accessToken, igAccountUserId,
    commentId, postId, fromIgUserId, fromIgUsername, commentText, linkedFlowId } = params;

  try {
    if (!linkedFlowId) {
      return;
    }

    const [linked] = await db
      .select()
      .from(instaProspectFlows)
      .where(and(
        eq(instaProspectFlows.id, linkedFlowId),
        eq(instaProspectFlows.workspaceId, workspaceId),
        eq(instaProspectFlows.ativo, true)
      ))
      .limit(1);

    if (!linked || !linked.commentEnabled) {
      return;
    }

    let matchedFlow: typeof instaProspectFlows.$inferSelect | undefined;
    if (!linked.postId || linked.postId === postId) {
      const kw = linked.keyword?.trim();
      if (!kw || linked.keywordMatchType === "any") {
        matchedFlow = linked;
      } else {
        const text = commentText.toLowerCase().trim();
        const kwLower = kw.toLowerCase();
        if (linked.keywordMatchType === "exact" ? text === kwLower : text.includes(kwLower)) {
          matchedFlow = linked;
        }
      }
    }

    if (!matchedFlow) {
      return;
    }

    const lead = await upsertInstagramLead(workspaceId, fromIgUserId, fromIgUsername);
    const leadName = lead.nome || "";

    if (matchedFlow.commentReplyMode === "ai") {
      const postCtx = matchedFlow.postContext ? `\nCONTEXTO DO POST: ${matchedFlow.postContext}\n` : "";
      const commentPrompt = matchedFlow.commentAiPrompt || matchedFlow.aiSystemPrompt;
      const systemPrompt = `REGRAS OBRIGATÓRIAS:\n1. Você está respondendo um COMENTÁRIO PÚBLICO no Instagram.\n2. Responda de forma curta e natural (máximo 2-3 frases).\n3. O usuario que comentou é "@${fromIgUsername}" (nome: "${leadName || fromIgUsername}").\n4. NUNCA inclua hashtags, emojis excessivos ou linguagem robótica.\n5. Seja cordial, relevante ao contexto do post e do comentário.\n6. Responda APENAS o texto da resposta, sem prefixos.\n${postCtx}\nINSTRUÇÕES:\n${commentPrompt}`;
      const aiReply = await callAI(systemPrompt, [], commentText, {
        model: matchedFlow.aiModel || "gpt-4o-mini",
        temperature: matchedFlow.aiTemperature ?? 0.7,
        maxTokens: 150,
        workspaceId,
      });
      if (aiReply) {
        await replyInstagramComment(accessToken, commentId, aiReply);
      } else {
        console.warn("[InstaProspect Comment] AI indisponivel, pulando resposta ao comentario");
      }
    } else if (matchedFlow.publicReply) {
      const reply = replaceVariables(matchedFlow.publicReply, `@${fromIgUsername}`, leadName);
      await replyInstagramComment(accessToken, commentId, reply);
    }

    const [session] = await db.insert(instaProspectSessions).values({
      workspaceId,
      flowId: matchedFlow.id,
      leadId: lead.id,
      igUserId: fromIgUserId,
      igUsername: fromIgUsername,
      status: "em_andamento",
      triggerType: "comment",
      triggerContent: commentText,
      conversationHistory: [],
    }).returning();

    const firstMsg = replaceVariables(
      matchedFlow.firstMessage || "Oi {{username}}! Vi seu comentario. Pode me contar mais sobre o que voce precisa?",
      fromIgUsername, leadName
    );

    const commentDelay = matchedFlow.delaySeconds || 0;
    if (commentDelay > 0) await new Promise(r => setTimeout(r, commentDelay * 1000));
    // DM pra quem comentou = resposta PRIVADA (comment_id), não mensagem padrão:
    // comentário não abre janela de 24h, então a mensagem padrão sempre falharia
    // (erro 2534022/2534014). Private reply tem janela de 7 dias. Bruno 2026-07-11.
    const commentFirstResult = await sendInstagramPrivateReply(accessToken, igAccountUserId, commentId, firstMsg);
    if (!commentFirstResult.error) {
      await saveOutboundToChat(workspaceId, fromIgUserId, firstMsg);
    } else {
      console.warn(`[InstaProspect Comment] private reply falhou: ${commentFirstResult.error}`);
    }

    await db.update(instaProspectSessions)
      .set({
        conversationHistory: [
          { role: "assistant", content: firstMsg, timestamp: new Date().toISOString() },
          { role: "user", content: `[Comentou: "${commentText}"]`, timestamp: new Date().toISOString() },
        ],
        updatedAt: new Date(),
      })
      .where(eq(instaProspectSessions.id, session.id));

    await db.update(instaProspectFlows)
      .set({ totalTriggers: sql`coalesce(${instaProspectFlows.totalTriggers}, 0) + 1` })
      .where(eq(instaProspectFlows.id, matchedFlow.id));
  } catch (err: any) {
    console.error("[InstaProspect Comment] Erro:", err.message);
  }
}

export async function handleInstaProspectStory(params: {
  workspaceId: string;
  accessToken: string;
  igAccountUserId: string;
  fromIgUserId: string;
  fromIgUsername: string;
  linkedFlowId?: string | null;
}) {
  const { workspaceId, accessToken, igAccountUserId, fromIgUserId, fromIgUsername, linkedFlowId } = params;

  try {
    if (!linkedFlowId) {
      return;
    }

    const [linked] = await db
      .select()
      .from(instaProspectFlows)
      .where(and(
        eq(instaProspectFlows.id, linkedFlowId),
        eq(instaProspectFlows.workspaceId, workspaceId),
        eq(instaProspectFlows.ativo, true)
      ))
      .limit(1);

    if (!linked || !linked.storyEnabled) {
      return;
    }

    const flow = linked;

    const lead = await upsertInstagramLead(workspaceId, fromIgUserId, fromIgUsername);
    const leadName = lead.nome || "";

    const [session] = await db.insert(instaProspectSessions).values({
      workspaceId,
      flowId: flow.id,
      leadId: lead.id,
      igUserId: fromIgUserId,
      igUsername: fromIgUsername,
      status: "em_andamento",
      triggerType: "story",
      triggerContent: "story_mention",
      conversationHistory: [],
    }).returning();

    const storyMsg = flow.storyFirstMessage || flow.firstMessage || "Oi {{username}}! Obrigado por marcar a gente nos Stories! Posso te ajudar com alguma coisa?";
    const firstMsg = replaceVariables(storyMsg, fromIgUsername, leadName);

    const storyDelay = flow.delaySeconds || 0;
    if (storyDelay > 0) await new Promise(r => setTimeout(r, storyDelay * 1000));

    const storyResult = await sendInstagramDM(accessToken, igAccountUserId, fromIgUserId, firstMsg);
    if (!storyResult.error) {
      await saveOutboundToChat(workspaceId, fromIgUserId, firstMsg);
    }

    await db.update(instaProspectSessions)
      .set({
        conversationHistory: [
          { role: "assistant", content: firstMsg, timestamp: new Date().toISOString() },
          { role: "user", content: "[Mencionou nos Stories]", timestamp: new Date().toISOString() },
        ],
        updatedAt: new Date(),
      })
      .where(eq(instaProspectSessions.id, session.id));

    await db.update(instaProspectFlows)
      .set({ totalTriggers: sql`coalesce(${instaProspectFlows.totalTriggers}, 0) + 1` })
      .where(eq(instaProspectFlows.id, flow.id));
  } catch (err: any) {
    console.error("[InstaProspect Story] Erro:", err.message);
  }
}
