import { storage } from "../storage";
import { maskCpf } from "../utils/mask";
import { resolveUploadPath } from "../utils/uploadsDir";
import { db } from "../db";
import { leads, users, iaPrompts, conexoes, conversations, messages, pipelineStages, integrationConfigs, notificacoes, automationVariables, documentTemplates, automationPendingInputs, leadTags, teams, teamMembers, automationNodeLogs } from "@shared/schema";
import { eq, sql, and, ne, isNotNull, desc } from "drizzle-orm";
import OpenAI from "openai";
import { fetchWithTimeout } from "../utils/helpers";
import { safeOutboundFetch, assertSafeOutboundUrl } from "../utils/ssrfGuard";
import { sendMessage as channelRouterSend } from "./channel-router";
import { formatDateBR } from "../utils/dateFormat";

const MAX_NODE_EXECUTIONS = 50;

// Bolhas do nó de IA (Bruno 2026-07-16): teto de partes por resposta (evita a IA
// picotar demais / spammar o cliente) e o respiro entre uma bolha e outra.
const AI_MAX_BOLHAS = 5;
const AI_BOLHA_DELAY_MS = 1800;

// Rejeita regex de exit-trigger (config livre do tenant) com risco de backtracking
// exponencial — roda no event loop compartilhado a cada mensagem (ReDoS = DoS global).
// Conservador: bloqueia padrão longo, quantificador sobre grupo que já contém
// quantificador/alternância (catastrófico: "(.*a)+", "(a+)+", "(a|aa)+"), e
// quantificadores adjacentes. Padrão recusado cai em match literal.
function isSafeRegexSource(src: string): boolean {
  if (!src || src.length > 200) return false;
  if (/\)\s*[+*]/.test(src) || /\)\s*\{\d+,?\d*\}/.test(src)) {
    // grupo seguido de quantificador: só permite se o grupo for "simples" (sem . + * { | dentro)
    if (/\([^)]*[.+*{|][^)]*\)\s*(?:[+*]|\{\d+,?\d*\})/.test(src)) return false;
  }
  if (/[+*]\s*[+*]/.test(src)) return false; // quantificadores adjacentes (a++ etc.)
  return true;
}

function markdownToWhatsApp(text: string): string {
  let r = text;
  r = r.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  r = r.replace(/^---+$/gm, "");
  r = r.replace(/\*\*\*(.+?)\*\*\*/g, "*_$1_*");
  r = r.replace(/\*\*(.+?)\*\*/g, "*$1*");
  r = r.replace(/__(.+?)__/g, "_$1_");
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");
  r = r.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "```"));
  r = r.replace(/\n{3,}/g, "\n\n");
  return r.trim();
}

async function saveOutgoingMessage(ctx: ExecutionContext, text: string, tipo?: string, arquivo?: string) {
  console.log(`[AutomationEngine] saveOutgoingMessage called: convId=${ctx.conversationId}, wsId=${ctx.workspaceId?.substring(0,8)}, text_len=${text?.length}`);
  if (!ctx.conversationId) {
    console.warn(`[AutomationEngine] saveOutgoingMessage SKIP: no conversationId`);
    return;
  }
  try {
    const conv = await storage.getConversation(ctx.conversationId, ctx.workspaceId || "");
    if (!conv) {
      console.warn(`[AutomationEngine] saveOutgoingMessage SKIP: conversation ${ctx.conversationId} no longer exists (deleted)`);
      return;
    }
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const msgData: any = {
      conversationId: ctx.conversationId,
      direction: "out",
      texto: text,
      hora,
      status: "sent",
      agente: "Bot",
      workspaceId: ctx.workspaceId,
    };
    if (tipo) msgData.tipo = tipo;
    if (arquivo) msgData.arquivo = arquivo;
    const savedMsg = await storage.createMessage(msgData);
    console.log(`[AutomationEngine] Message saved OK: id=${savedMsg.id}, convId=${ctx.conversationId}`);
    await db.update(conversations).set({ ultimaMensagem: text, tempo: "agora" }).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
    try {
      broadcastToWorkspace(ctx.workspaceId, "new_message", {
        conversationId: ctx.conversationId,
        message: { id: savedMsg.id, texto: text, tipo, arquivo, direction: "out", hora, status: "sent", agente: "Bot", createdAt: savedMsg.createdAt },
      });
      broadcastToWorkspace(ctx.workspaceId, "conversation_updated", { conversationId: ctx.conversationId, ultimaMensagem: text, tempo: "agora" });
      console.log(`[AutomationEngine] Broadcast sent OK for conv=${ctx.conversationId}`);
    } catch (e: any) { console.error("[AutomationEngine] broadcast error:", e.message); }
  } catch (e: any) {
    console.error("[AutomationEngine] saveOutgoingMessage error:", e.message);
  }
}

async function sendAutomationImage(ctx: ExecutionContext, imageUrl: string, caption?: string): Promise<{ sent: boolean; error?: string }> {
  if (!ctx.phone) {
    return { sent: false, error: "phone ausente no contexto" };
  }
  try {
    if (ctx.conversationId) {
      const conv = await storage.getConversation(ctx.conversationId, ctx.workspaceId || "");
      if (!conv) {
        console.warn(`[AutomationEngine] sendAutomationImage ABORT: conversation ${ctx.conversationId} deleted`);
        return { sent: false, error: "Conversa excluída" };
      }
      const displayText = caption ? `[imagem] ${caption}` : "[imagem]";
      await saveOutgoingMessage(ctx, displayText, "image", imageUrl);
    }

    const result = await channelRouterSend({
      workspaceId: ctx.workspaceId,
      to: ctx.phone,
      type: "image",
      mediaUrl: imageUrl,
      mediaCaption: caption,
      conversationId: ctx.conversationId,
      conexaoId: ctx.conexaoId,
      skipWindowCheck: true,
    });
    if (!result.success) {
      console.error(`[AutomationEngine] sendAutomationImage delivery failed: ${result.error}`);
      return { sent: false, error: result.error || "Falha ao enviar imagem" };
    }
    return { sent: true };
  } catch (err: any) {
    console.error("[AutomationEngine] sendAutomationImage error:", err.message);
    return { sent: false, error: err.message };
  }
}

async function sendAutomationDocument(ctx: ExecutionContext, documentUrl: string, fileName: string, caption?: string): Promise<{ sent: boolean; error?: string }> {
  if (!ctx.phone) {
    return { sent: false, error: "phone ausente no contexto" };
  }
  try {
    if (ctx.conversationId) {
      const conv = await storage.getConversation(ctx.conversationId, ctx.workspaceId || "");
      if (!conv) {
        console.warn(`[AutomationEngine] sendAutomationDocument ABORT: conversation ${ctx.conversationId} deleted`);
        return { sent: false, error: "Conversa excluída" };
      }
      const displayText = caption ? `[documento] ${fileName} - ${caption}` : `[documento] ${fileName}`;
      await saveOutgoingMessage(ctx, displayText, "document", documentUrl);
    }

    const result = await channelRouterSend({
      workspaceId: ctx.workspaceId,
      to: ctx.phone,
      type: "document",
      mediaUrl: documentUrl,
      filename: fileName,
      mediaCaption: caption,
      conversationId: ctx.conversationId,
      conexaoId: ctx.conexaoId,
      skipWindowCheck: true,
    });
    if (!result.success) {
      console.error(`[AutomationEngine] sendAutomationDocument delivery failed: ${result.error}`);
      return { sent: false, error: result.error || "Falha ao enviar documento" };
    }
    return { sent: true };
  } catch (err: any) {
    console.error("[AutomationEngine] sendAutomationDocument error:", err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendAutomationMessage(ctx: ExecutionContext, messageText: string): Promise<{ sent: boolean; error?: string }> {
  if (!ctx.phone) {
    return { sent: false, error: "phone ausente no contexto" };
  }
  try {
    if (ctx.conversationId) {
      const conv = await storage.getConversation(ctx.conversationId, ctx.workspaceId || "");
      if (!conv) {
        console.warn(`[AutomationEngine] sendAutomationMessage ABORT: conversation ${ctx.conversationId} deleted`);
        return { sent: false, error: "Conversa excluída" };
      }
      await saveOutgoingMessage(ctx, messageText);
    }

    const result = await channelRouterSend({
      workspaceId: ctx.workspaceId,
      to: ctx.phone,
      type: "text",
      content: markdownToWhatsApp(messageText),
      conversationId: ctx.conversationId,
      conexaoId: ctx.conexaoId,
      replyToMessageId: ctx.replyJid,
      skipWindowCheck: true,
    });
    if (!result.success) {
      console.error(`[AutomationEngine] sendAutomationMessage delivery failed: ${result.error}`);
      return { sent: false, error: result.error || "Falha ao enviar mensagem" };
    }
    return { sent: true };
  } catch (err: any) {
    console.error("[AutomationEngine] sendAutomationMessage error:", err.message);
    return { sent: false, error: err.message };
  }
}

interface FlowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, any>;
  next: string[];
  nextTrue?: string;
  nextFalse?: string;
  nextOptions?: Record<string, string>;
  nextTextInput?: string;
}

interface MessageContext {
  type?: "text" | "image" | "audio" | "document";
  text?: string;
  media_url?: string;
  media_type?: string;
  filename?: string;
  audio_transcript?: string;
}

interface ExecutionContext {
  workspaceId: string;
  leadId?: number;
  phone?: string;
  conexaoId?: string;
  conversationId?: number;
  replyJid?: string;
  message?: MessageContext;
  variables: Record<string, any>;
  executionId: string;
  metaAccessToken?: string;
}

function detectAudioFormat(buf: Buffer): string {
  if (buf.length < 12) return "unknown";
  if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46) return "wav";
  if (buf[0]===0x1a && buf[1]===0x45 && buf[2]===0xdf && buf[3]===0xa3) return "webm";
  if ((buf[0]===0xff && (buf[1]===0xfb||buf[1]===0xfa||buf[1]===0xf3)) || (buf[0]===0x49 && buf[1]===0x44 && buf[2]===0x33)) return "mp3";
  if (buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return "mp4";
  if (buf[0]===0x4f && buf[1]===0x67 && buf[2]===0x67 && buf[3]===0x53) return "ogg";
  return "unknown";
}

import { resolveOpenAIKeys, resolveTranscriptionCandidates } from './openaiKeyResolver';
import { broadcastToWorkspace } from './broadcast';
import { getOpenAIClient } from './openaiClient';
import { detectWhisperHallucination } from '../utils/audioHallucination';

async function transcribeAudio(mediaUrl: string, metaAccessToken?: string, mediaType?: string, workspaceId?: string): Promise<string> {
  try {
    let rawBuffer: Buffer;
    if (mediaUrl.startsWith("/uploads/")) {
      const { readFileSync } = await import("fs");
      rawBuffer = readFileSync(resolveUploadPath(mediaUrl));
    } else {
      const headers: Record<string, string> = {};
      if (metaAccessToken) headers["Authorization"] = `Bearer ${metaAccessToken}`;
      const resp = await fetchWithTimeout(mediaUrl, { headers }, 30000);
      if (!resp.ok) throw new Error(`Audio download failed: ${resp.status}`);
      rawBuffer = Buffer.from(await resp.arrayBuffer());
    }

    const detected = detectAudioFormat(rawBuffer);
    console.log(`[Transcribe] Audio format: ${detected}, size: ${rawBuffer.length} bytes`);

    const candidates = await resolveTranscriptionCandidates(workspaceId);
    if (candidates.length === 0) {
      console.error("[Transcribe] No OpenAI API key available for audio transcription");
      return "";
    }

    const { toFile } = await import("openai");
    const extMap: Record<string, string> = { ogg: "ogg", mp3: "mp3", wav: "wav", webm: "webm", mp4: "mp4", unknown: "ogg" };
    const mimeMap: Record<string, string> = { ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm", mp4: "audio/mp4", unknown: "audio/ogg" };
    const ext = extMap[detected] || "ogg";
    const mime = mediaType || mimeMap[detected] || "audio/ogg";

    let transcript = "";
    for (const candidate of candidates) {
      try {
        const client = getOpenAIClient({ apiKey: candidate.apiKey, baseURL: candidate.baseURL, timeout: 60000 });
        const audioFile = await toFile(rawBuffer, `audio.${ext}`, { type: mime });
        console.log(`[Transcribe] Trying model=${candidate.model} via source=${candidate.source}...`);
        // whisper-1 suporta verbose_json → traz no_speech_prob/avg_logprob/
        // compression_ratio por segmento (sinais pra detectar alucinação).
        // gpt-4o-*-transcribe (legado) só aceita json/text → cai nas heurísticas
        // de texto. temperature:0 reduz a "viagem" do modelo em áudio ruim.
        const isWhisper = candidate.model === "whisper-1";
        const reqParams: any = {
          file: audioFile,
          model: candidate.model,
          language: "pt",
          temperature: 0,
        };
        if (isWhisper) reqParams.response_format = "verbose_json";
        const whisperData: any = await client.audio.transcriptions.create(reqParams);
        const rawText = (whisperData.text || "").trim();
        if (!rawText) {
          // Vazio → tenta próximo candidato (pode ser erro de chave/modelo).
          continue;
        }
        // Guard de alucinação: ruído/balbucio/silêncio vira frase fantasma
        // ("se inscreve no canal...", "Deixe eu ver" em loop). Descarta e trata
        // como áudio não compreendido (o chamador cai no fallback gracioso).
        const verdict = detectWhisperHallucination(rawText, isWhisper ? {
          segments: whisperData.segments,
          duration: whisperData.duration,
        } : undefined);
        if (verdict.hallucinated) {
          console.warn(`[Transcribe] 🚫 Descartado (provável alucinação Whisper, reason=${verdict.reason}): "${rawText.substring(0, 120)}"`);
          transcript = "";
          break; // mesma audio → mesma alucinação em outra chave; não relança.
        }
        transcript = rawText;
        console.log(`[Transcribe] ✅ OK via source=${candidate.source}, model=${candidate.model}: "${transcript.substring(0, 120)}"`);
        break;
      } catch (err: any) {
        console.error(`[Transcribe] ❌ FAILED via source=${candidate.source}, model=${candidate.model}: ${err.message}`);
      }
    }

    if (!transcript) {
      console.error("[Transcribe] All candidates failed for audio transcription");
      return "";
    }
    return transcript;
  } catch (err: any) {
    console.error(`[Transcribe] FAILED:`, err.message);
    return "";
  }
}

interface NodeResult {
  output: Record<string, unknown>;
  status: string;
  nextNodeId?: string;
  pauseExecution?: boolean;
  pauseType?: "option_list" | "wait";
  pauseData?: any;
}

async function resolveFieldValue(field: string, ctx: ExecutionContext): Promise<any> {
  try {
    if (field.startsWith("lead.")) {
      const leadField = field.substring(5);
      if (!ctx.leadId) return undefined;
      const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
      if (!lead) return undefined;
      const fieldMap: Record<string, any> = {
        name: lead.nome, nome: lead.nome,
        email: lead.email, phone: lead.telefone, telefone: lead.telefone,
        status: lead.status, value: lead.valor, valor: lead.valor,
        canal: lead.canal, owner: lead.owner, empresa: lead.empresa,
        notas: lead.notas, tags: lead.tags,
      };
      return fieldMap[leadField];
    }
    if (field.startsWith("variables.")) {
      const varName = field.substring(10);
      return ctx.variables?.[varName];
    }
    if (field.startsWith("message.")) {
      const msgField = field.substring(8);
      return (ctx.message as any)?.[msgField];
    }
    const fieldMap: Record<string, string> = {
      content: "message.text", canal: "lead.canal",
      status: "lead.status", valor: "lead.valor",
      tag: "lead.tags", replied: "variables.replied",
      aiScore: "variables.aiScore", aiReply: "variables.aiReply",
    };
    if (fieldMap[field]) {
      return resolveFieldValue(fieldMap[field], ctx);
    }
    return ctx.variables?.[field];
  } catch {
    return undefined;
  }
}

function evaluateCondition(resolvedValue: any, operator: string, compareValue: any): boolean {
  try {
    const strResolved = resolvedValue != null ? String(resolvedValue) : "";
    const strCompare = compareValue != null ? String(compareValue) : "";

    switch (operator) {
      case "eq": case "equals":
        return strResolved.toLowerCase() === strCompare.toLowerCase();
      case "neq": case "not_equals":
        return strResolved.toLowerCase() !== strCompare.toLowerCase();
      case "contains":
        return strResolved.toLowerCase().includes(strCompare.toLowerCase());
      case "not_contains":
        return !strResolved.toLowerCase().includes(strCompare.toLowerCase());
      case "gt": case "greater_than":
        return Number(resolvedValue) > Number(compareValue);
      case "lt": case "less_than":
        return Number(resolvedValue) < Number(compareValue);
      case "gte": case "greater_or_equal":
        return Number(resolvedValue) >= Number(compareValue);
      case "lte": case "less_or_equal":
        return Number(resolvedValue) <= Number(compareValue);
      case "is_empty":
        return resolvedValue === null || resolvedValue === undefined || resolvedValue === "";
      case "not_empty": case "is_not_empty":
        return resolvedValue !== null && resolvedValue !== undefined && resolvedValue !== "";
      case "starts_with":
        return strResolved.toLowerCase().startsWith(strCompare.toLowerCase());
      case "ends_with":
        return strResolved.toLowerCase().endsWith(strCompare.toLowerCase());
      default:
        return strResolved === strCompare;
    }
  } catch {
    return false;
  }
}

// Monta o system prompt ESTRUTURADO do nó "Agente" (Fase 1) a partir dos campos de
// config (papel/objetivo/escopo/limites/tom). O resto do motor de IA (memória da
// conversa, CRM, bolhas [MSG], gatilhos de saída) é reaproveitado do "ai_response".
// Bruno 2026-07-19.
function montarPersonaAgente(c: Record<string, any>): string {
  const s = (v: any) => (typeof v === "string" ? v.trim() : "");
  const nome = s(c.nome), papel = s(c.papel), objetivo = s(c.objetivo);
  const escopo = s(c.escopo), limites = s(c.limites), tom = s(c.tomVoz);
  const linhas: string[] = [];
  linhas.push(nome
    ? `Você é ${nome}${papel ? `, ${papel}` : ""}.`
    : (papel ? `Você é ${papel}.` : "Você é um agente de atendimento."));
  if (objetivo) linhas.push(`SEU OBJETIVO: ${objetivo}.`);
  if (escopo) linhas.push(`VOCÊ CUIDA DE: ${escopo}. Se o cliente pedir algo claramente fora disso, ajude no que der e encaminhe/transfira em vez de inventar.`);
  if (limites) linhas.push(`O QUE VOCÊ NUNCA FAZ: ${limites}.`);
  if (tom) linhas.push(`TOM DE VOZ: ${tom}.`);
  linhas.push("Escreva como no WhatsApp: mensagens curtas e naturais, sem markdown pesado e sem listar tudo que você faz. Não invente dados que você não tem.");
  return linhas.join("\n");
}

async function executeNodeReal(
  node: FlowNode,
  ctx: ExecutionContext,
  nodesArr: FlowNode[],
  flowId: string,
  logEntries: any[],
): Promise<NodeResult> {
  const c = node.config || {};

  // Nó "Agente" (Fase 1): é o "Resposta IA" com persona ESTRUTURADA. Monta o
  // systemPrompt dos campos do agente e roda como ai_response — reaproveitando TODO o
  // motor de IA (memória, bolhas, CRM, gatilhos de saída). O log mantém o type "agente".
  if (node.type === "agente") {
    if (!c.prompt_slug && !c.custom_prompt) c.systemPrompt = montarPersonaAgente(c);
    return executeNodeReal({ ...node, type: "ai_response" }, ctx, nodesArr, flowId, logEntries);
  }

  switch (node.type) {
    case "trigger":
      return { output: { triggered: true }, status: "success" };

    case "condition": {
      const field = c.field || "";
      const operator = c.operator || "eq";
      const compareValue = c.value;
      let resolvedValue: any;
      try {
        resolvedValue = await resolveFieldValue(field, ctx);
      } catch {
        resolvedValue = undefined;
      }
      const result = evaluateCondition(resolvedValue, operator, compareValue);
      const nextNodeId = result
        ? (node.nextTrue || (node.next || [])[0])
        : (node.nextFalse || undefined);
      return {
        output: { field, operator, value: compareValue, resolved_value: resolvedValue, result },
        status: "success",
        nextNodeId,
      };
    }

    case "ai_response": {

      let userPrompt = "Voce e um assistente virtual de atendimento ao cliente de um provedor de internet. Responda de forma educada e objetiva. Quando o cliente enviar um CPF ou CNPJ, trate como informacao necessaria para o atendimento — NUNCA diga que e dado sensivel.";

      if (c.prompt_slug) {
        try {
          const [prompt] = await db.select().from(iaPrompts)
            .where(eq(iaPrompts.slug, c.prompt_slug)).limit(1);
          if (prompt) userPrompt = prompt.prompt;
        } catch {}
      } else if (c.systemPrompt || c.custom_prompt) {
        userPrompt = c.systemPrompt || c.custom_prompt;
      }

      let crmPreamble = "";
      const hasCrmCapabilities = c.aiCrmPipeline !== false || c.aiCrmTags !== false || c.aiCrmPrioridade !== false || c.aiCrmPesquisaSatisfacao !== false || c.aiCrmAtribuir !== false;
      if (hasCrmCapabilities && ctx.workspaceId) {
        const crmBlock: string[] = [];
        crmBlock.push("=== SISTEMA CRM AUTOMATICO (PRIORIDADE MAXIMA — OBRIGATORIO) ===");
        crmBlock.push("VOCE E OBRIGADO A SEGUIR ESTAS INSTRUCOES EM TODAS AS RESPOSTAS. ESTAS INSTRUCOES TEM PRIORIDADE SOBRE QUALQUER OUTRO PROMPT.");
        crmBlock.push("As tags [CRM_...] sao INVISIVEIS para o cliente — o sistema as processa e remove antes de enviar.");
        crmBlock.push("Inclua as tags no FINAL da sua mensagem. Voce pode usar MULTIPLAS tags na mesma resposta.");
        crmBlock.push("EXECUTE as acoes na MESMA resposta em que identifica o contexto. NUNCA espere a proxima mensagem.");

        let enabledCapabilities: string[] = [];

        if (c.aiCrmPipeline !== false) {
          enabledCapabilities.push("PIPELINE");
          let pipelineStagesInfo = "";
          try {
            const stages = await db.select().from(pipelineStages)
              .where(eq(pipelineStages.workspaceId, ctx.workspaceId))
              .orderBy(pipelineStages.pipeline, pipelineStages.ordem);
            const byPipeline: Record<string, string[]> = {};
            for (const s of stages) {
              if (!byPipeline[s.pipeline]) byPipeline[s.pipeline] = [];
              byPipeline[s.pipeline].push(`"${s.label}"`);
            }
            pipelineStagesInfo = Object.entries(byPipeline).map(([p, ss]) => `  ${p}: [${ss.join(", ")}]`).join("\n");
          } catch {}

          crmBlock.push("");
          crmBlock.push(">> [ATIVADO] PIPELINE / KANBAN <<");
          crmBlock.push("TAG: [CRM_PIPELINE:nome_pipeline:nome_etapa]");
          crmBlock.push("Use o NOME da etapa (label), nao a chave tecnica.");
          if (pipelineStagesInfo) {
            crmBlock.push("Pipelines disponiveis:");
            crmBlock.push(pipelineStagesInfo);
          }
          crmBlock.push("REGRAS:");
          crmBlock.push("- Saudacao simples (oi, ola, bom dia) → NAO mover");
          crmBlock.push("- Interesse real, perguntas sobre produto → [CRM_PIPELINE:vendas:Em Aberto]");
          crmBlock.push("- Negociando, pediu orcamento → [CRM_PIPELINE:vendas:Negociacao]");
          crmBlock.push("- Confirmou compra → [CRM_PIPELINE:vendas:Fechado]");
          crmBlock.push("- Desistiu → [CRM_PIPELINE:vendas:Cancelado]");
          crmBlock.push("- SUPORTE (ajuda, problema, duvida, erro, bug, reclamacao, nao funciona) → [CRM_PIPELINE:suporte:Em Aberto] IMEDIATAMENTE");
          crmBlock.push("- Suporte em progresso → [CRM_PIPELINE:suporte:Em Andamento]");
          crmBlock.push("- Suporte resolvido → [CRM_PIPELINE:suporte:Resolvido]");
        }

        if (c.aiCrmAtribuir !== false) {
          enabledCapabilities.push("ATRIBUIR");
          let usersListInfo = "";
          let teamsInfo = "";
          try {
            const wsUsers = await db.select({ id: users.id, nome: users.nome }).from(users)
              .where(eq(users.workspaceId, ctx.workspaceId));
            if (wsUsers.length > 0) usersListInfo = wsUsers.map(u => `"${u.nome}"`).join(", ");
            const wsTeams = await db.select({
              teamNome: teams.nome,
              pipelineKey: teams.pipelineKey,
              memberNome: users.nome,
            }).from(teams)
              .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
              .leftJoin(users, eq(users.id, teamMembers.userId))
              .where(eq(teams.workspaceId, ctx.workspaceId));
            const teamMap: Record<string, { pipeline: string | null; members: string[] }> = {};
            for (const row of wsTeams) {
              if (!teamMap[row.teamNome]) teamMap[row.teamNome] = { pipeline: row.pipelineKey, members: [] };
              if (row.memberNome) teamMap[row.teamNome].members.push(row.memberNome);
            }
            teamsInfo = Object.entries(teamMap).map(([name, info]) =>
              `Equipe "${name}" (pipeline: ${info.pipeline || 'geral'}): [${info.members.map(m => `"${m}"`).join(", ")}]`
            ).join("\n");
          } catch {}

          crmBlock.push("");
          crmBlock.push(">> [ATIVADO] ATRIBUIR CONVERSA <<");
          crmBlock.push("TAG: [CRM_ASSIGN:nome_exato_do_usuario]");
          if (usersListInfo) crmBlock.push(`Membros disponiveis: ${usersListInfo}`);
          if (teamsInfo) {
            crmBlock.push("Equipes:");
            crmBlock.push(teamsInfo);
          }
          crmBlock.push("REGRAS:");
          crmBlock.push("- Conversa de SUPORTE → atribuir ao primeiro membro da equipe de Suporte");
          crmBlock.push("- Cliente pede atendente humano → atribuir ao membro mais relevante");
          crmBlock.push("- Ao mover para pipeline suporte → SEMPRE atribuir junto");
          crmBlock.push("- Use o NOME EXATO como aparece na lista acima");
        }

        if (c.aiCrmTags !== false) {
          enabledCapabilities.push("TAGS");
          let existingTagsInfo = "";
          try {
            const existingTags = await db.select().from(leadTags).where(eq(leadTags.workspaceId, ctx.workspaceId));
            if (existingTags.length > 0) existingTagsInfo = existingTags.map(t => `"${t.nome}"`).join(", ");
          } catch {}

          crmBlock.push("");
          crmBlock.push(">> [ATIVADO] TAGS <<");
          crmBlock.push("TAG: [CRM_TAGS:tag1,tag2]");
          if (existingTagsInfo) crmBlock.push(`Tags existentes: ${existingTagsInfo} (prefira estas)`);
          crmBlock.push("REGRAS: Urgencia → 'Urgente'; Alto valor → 'VIP'; Muito interesse → 'Quente'; Indicacao → 'Indicacao'");
        }

        if (c.aiCrmPrioridade !== false) {
          enabledCapabilities.push("PRIORIDADE");
          crmBlock.push("");
          crmBlock.push(">> [ATIVADO] PRIORIDADE <<");
          crmBlock.push("TAG: [CRM_PRIORIDADE:nivel] (niveis: alta, media, baixa)");
          crmBlock.push("REGRAS: Urgente/emergencia/reclamacao → alta; Normal → media; Curiosidade → baixa");
        }

        if (c.aiCrmPesquisaSatisfacao !== false) {
          enabledCapabilities.push("SATISFACAO");
          crmBlock.push("");
          crmBlock.push(">> [ATIVADO] PESQUISA DE SATISFACAO <<");
          crmBlock.push("TAG: [CRM_SATISFACAO:nota:comentario] (nota 1-5)");
          crmBlock.push("REGRAS: Ao FINALIZAR atendimento, pergunte avaliacao 1-5. Quando responder, registre. Nao insista se recusar.");
        }

        crmBlock.push("");
        crmBlock.push(`FUNCOES ATIVAS: [${enabledCapabilities.join(", ")}]`);
        crmBlock.push("REGRA FINAL OBRIGATORIA: Em CADA resposta, analise o contexto e execute TODAS as acoes CRM aplicaveis.");
        crmBlock.push("VOCE DEVE SEMPRE incluir pelo menos UMA tag CRM em cada resposta. Se nenhuma acao especifica se aplica, use [CRM_PIPELINE:vendas:Em Aberto] para leads novos.");
        crmBlock.push("Exemplo combinado: 'Sua resposta aqui [CRM_PIPELINE:suporte:Em Aberto] [CRM_ASSIGN:Nome] [CRM_PRIORIDADE:media] [CRM_TAGS:Suporte]'");
        crmBlock.push("");
        crmBlock.push("DETECCAO OBRIGATORIA:");
        crmBlock.push("- Palavras como 'suporte', 'ajuda', 'problema', 'erro', 'bug', 'nao funciona', 'reclamacao', 'defeito', 'travou' → IMEDIATAMENTE use [CRM_PIPELINE:suporte:Em Aberto] + [CRM_ASSIGN:membro_equipe_suporte] + [CRM_PRIORIDADE:media]");
        crmBlock.push("- Palavras como 'preco', 'valor', 'quanto custa', 'plano', 'comprar', 'contratar', 'orcamento' → use [CRM_PIPELINE:vendas:Negociacao]");
        crmBlock.push("- Palavras como 'quero', 'fechar', 'vamos', 'contrato', 'sim quero' → use [CRM_PIPELINE:vendas:Fechado]");
        crmBlock.push("- Palavras como 'cancelar', 'desistir', 'nao quero mais' → use [CRM_PIPELINE:vendas:Cancelado]");
        crmBlock.push("NAO IGNORE ESTAS INSTRUCOES. As tags CRM sao CRITICAS para o funcionamento do sistema.");
        crmBlock.push("=== FIM SISTEMA CRM ===");

        crmPreamble = crmBlock.join("\n") + "\n\n";
      }

      let systemPrompt = crmPreamble + userPrompt;

      let leadInfo = "";
      let clientName = "";
      let clientPhone = ctx.phone || "";
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) {
            clientName = lead.nome || "";
            const parts = [`Nome do cliente: ${lead.nome}`];
            if (lead.telefone) { parts.push(`Telefone/WhatsApp: ${lead.telefone}`); clientPhone = lead.telefone; }
            else if (ctx.phone) { parts.push(`Telefone/WhatsApp: ${ctx.phone}`); }
            if (lead.email) parts.push(`Email: ${lead.email}`);
            if ((lead as any).empresa) parts.push(`Empresa: ${(lead as any).empresa}`);
            if (lead.pipeline) parts.push(`Pipeline atual: ${lead.pipeline}`);
            if (lead.status) parts.push(`Etapa atual: ${lead.status}`);
            if ((lead as any).prioridade) parts.push(`Prioridade: ${(lead as any).prioridade}`);
            if (lead.tags && (lead.tags as string[]).length > 0) parts.push(`Tags: ${(lead.tags as string[]).join(", ")}`);
            if ((lead as any).canal) parts.push(`Canal: ${(lead as any).canal}`);
            leadInfo = parts.join(", ");
          }
        } catch {}
      }
      if (!clientName && ctx.variables?.nome) clientName = String(ctx.variables.nome);
      if (!clientPhone && ctx.phone) clientPhone = ctx.phone;

      if (leadInfo) {
        systemPrompt += `\n\n[DADOS DO CLIENTE]\n${leadInfo}`;
      } else if (clientPhone) {
        systemPrompt += `\n\n[DADOS DO CLIENTE]\nTelefone/WhatsApp: ${clientPhone}`;
        if (clientName) systemPrompt += `, Nome: ${clientName}`;
      }

      systemPrompt += `\n\n[REGRA SOBRE NOME E NUMERO DO CLIENTE]\nVoce JA SABE o nome e numero do cliente (veja DADOS DO CLIENTE acima). NUNCA peca o nome, telefone ou numero do cliente — voce ja tem essas informacoes. O numero de WhatsApp do cliente E o telefone dele. Chame o cliente SEMPRE pelo nome de forma natural e amigavel em todas as mensagens. Se o nome do cliente parecer incompleto ou generico, use o nome que tem mesmo assim. Exemplo: se o nome e "Bruno", chame de "Bruno". NUNCA pergunte "qual seu nome?" ou "pode me informar seu telefone?" — isso irrita o cliente porque ele sabe que voce ja tem esses dados.`;

      const aiFiles: { id: string; name: string; description: string; url: string; fileType: string; originalName: string; extractedText?: string }[] = c.aiFiles || [];
      if (aiFiles.length > 0) {
        const filesBlock: string[] = [];
        filesBlock.push("\n\n[ARQUIVOS DISPONIVEIS PARA ENVIO — LEIA COM ATENCAO]");
        filesBlock.push("Voce tem os seguintes arquivos que FAZEM PARTE do seu conhecimento e que voce pode enviar ao cliente.");
        filesBlock.push("REGRAS OBRIGATORIAS:");
        filesBlock.push("1. Voce CONHECE o conteudo de cada arquivo. Se um arquivo e um cardapio, voce sabe os itens, precos e categorias. Se e uma tabela de precos, voce sabe os valores. Use esse conhecimento para responder perguntas do cliente SEM precisar que ele veja o arquivo.");
        filesBlock.push("2. SEJA PRO-ATIVO: Quando o contexto da conversa indicar que um arquivo e relevante, ENVIE IMEDIATAMENTE sem esperar que o cliente peca explicitamente. Exemplos:");
        filesBlock.push("   - Cliente diz 'sim' para ver o cardapio → ENVIE o cardapio AGORA na mesma resposta");
        filesBlock.push("   - Cliente pergunta sobre precos e existe tabela de precos → ENVIE a tabela");
        filesBlock.push("   - Cliente quer fazer pedido e existe cardapio → ENVIE o cardapio para ele escolher");
        filesBlock.push("   - Cliente pede 'manda o cardapio' ou qualquer variacao → ENVIE IMEDIATAMENTE");
        filesBlock.push("3. NUNCA diga 'vou enviar', 'um momento', 'aguarde' sem realmente incluir a tag de envio. Se voce vai enviar, ENVIE na mesma mensagem.");
        filesBlock.push("4. Para enviar um arquivo, inclua a tag [ENVIAR_ARQUIVO:nome_exato] na sua resposta. A tag sera removida antes de enviar ao cliente.");
        filesBlock.push("5. Voce pode incluir multiplas tags [ENVIAR_ARQUIVO:...] se precisar enviar mais de um arquivo.\n");
        filesBlock.push("ARQUIVOS:");
        for (const af of aiFiles) {
          const label = af.name || af.originalName || af.id;
          const desc = af.description ? ` — Conteudo/Descricao: ${af.description}` : "";
          const tipo = af.fileType === "pdf" ? "PDF" : "Imagem";
          filesBlock.push(`- Nome: "${label}" | Tipo: ${tipo}${desc}`);
          // Fase 4 (RAG): se o texto do documento foi extraido no upload, injeta o
          // conteudo REAL como base de conhecimento (nao so a descricao digitada).
          // Cap por arquivo pra nao estourar o contexto; a extracao ja trunca na origem.
          const conteudo = (af.extractedText || "").trim();
          if (conteudo) {
            filesBlock.push(`  >> CONTEUDO DE "${label}" (use para responder com precisao):`);
            filesBlock.push(conteudo.slice(0, 4000));
            if (conteudo.length > 4000) filesBlock.push("  [conteudo truncado...]");
          }
        }
        filesBlock.push(`\nEXEMPLO CORRETO: Cliente pergunta "tem cardapio?" e existe arquivo "Cardapio" → Responda: "Claro! Aqui esta nosso cardapio completo! 😊 [ENVIAR_ARQUIVO:Cardapio]"`);
        filesBlock.push(`EXEMPLO ERRADO: Cliente pergunta "tem cardapio?" → Responder "Sim, temos! Vou enviar em um momento." (SEM a tag — isso NAO envia nada!)`);
        filesBlock.push(`\nIMPORTANTE: A descricao do arquivo contem informacoes sobre seu conteudo. USE essas informacoes para responder perguntas do cliente de forma inteligente. Por exemplo, se o cardapio tem "Pizza Margherita R$35", voce pode dizer o preco quando perguntado, alem de enviar a imagem.`);
        filesBlock.push("[FIM DOS ARQUIVOS DISPONIVEIS]");
        systemPrompt += filesBlock.join("\n");
      }

      const aiWebhooks: { id: string; name: string; description: string; url: string; method: string; headers: string; bodyTemplate: string; responseKey: string }[] = c.aiWebhooks || [];
      if (aiWebhooks.length > 0) {
        const whBlock: string[] = [];
        whBlock.push("\n\n[WEBHOOKS DISPONIVEIS - APIS EXTERNAS]");
        whBlock.push("Voce tem acesso a APIs externas que pode chamar durante a conversa para buscar informacoes em tempo real.");
        whBlock.push("Quando precisar chamar uma API, inclua a tag [CHAMAR_WEBHOOK:nome_exato] na sua resposta.");
        whBlock.push("O sistema executara a chamada e voce recebera o resultado para formular uma resposta final ao cliente.");
        whBlock.push("IMPORTANTE: Quando usar [CHAMAR_WEBHOOK:...], NAO envie uma resposta final ao cliente ainda. Apenas inclua a tag e uma mensagem curta como 'Consultando...' para que o sistema processe.\n");
        for (const wh of aiWebhooks) {
          const label = wh.name || wh.id;
          const desc = wh.description ? ` — ${wh.description}` : "";
          whBlock.push(`- "${label}" (${wh.method} ${wh.url})${desc}`);
        }
        whBlock.push(`\nExemplo: Se o cliente pedir um boleto e existe um webhook chamado "Buscar Boleto", responda: "Um momento, estou consultando... [CHAMAR_WEBHOOK:Buscar Boleto]"`);
        whBlock.push("[FIM DOS WEBHOOKS DISPONIVEIS]");
        systemPrompt += whBlock.join("\n");
      }

      // Módulo ISP/ERP removido — config ISP não é mais carregada. Sempre desabilitado.
      let ispEnabled = false;
      let ispCfgForAI: any = null;

      if (ispEnabled && ispCfgForAI) {
        const aiCpf = ispCfgForAI.aiCpfLookupEnabled !== false;
        const ai2via = ispCfgForAI.aiSecondCopyEnabled !== false;
        const aiUnlock = ispCfgForAI.aiTrustUnlockEnabled !== false;
        const aiPayConfirm = ispCfgForAI.aiPaymentConfirmEnabled !== false;
        const aiAutoUnlock = ispCfgForAI.aiAutoUnlockOnPayment !== false;
        const aiPromise = ispCfgForAI.aiPaymentPromiseEnabled !== false;
        const aiServiceOrder = ispCfgForAI.aiServiceOrderEnabled !== false;

        const ispBlock: string[] = [];
        ispBlock.push("\n\n[CONSULTA ISP / PROVEDOR DE INTERNET]");
        ispBlock.push("Voce tem acesso ao sistema do provedor de internet (ERP) para consultar dados de clientes, boletos e abrir chamados tecnicos.");
        ispBlock.push("FUNCOES DISPONIVEIS:");
        ispBlock.push("");

        if (aiCpf) {
          ispBlock.push("1. CONSULTAR CLIENTE POR CPF:");
          ispBlock.push("   Quando o cliente informar o CPF (ou voce ja tiver o CPF nos dados do cliente), use a tag:");
          ispBlock.push("   [CONSULTAR_CPF:numero_do_cpf]");
          ispBlock.push("   Exemplo: [CONSULTAR_CPF:12345678900]");
          ispBlock.push("   O sistema buscara o cliente no ERP e retornara: nome, plano, status, boletos em aberto, valores e links de pagamento.");
          ispBlock.push("   IMPORTANTE: Limpe o CPF removendo pontos e tracos antes de usar a tag. Ex: 123.456.789-00 -> [CONSULTAR_CPF:12345678900]");
          ispBlock.push("");
        }
        if (ai2via) {
          ispBlock.push("2. GERAR 2a VIA DE BOLETO:");
          ispBlock.push("   Apos consultar o cliente, se ele pedir 2a via ou boleto atualizado, use:");
          ispBlock.push("   [SEGUNDA_VIA:id_do_boleto]");
          ispBlock.push("   O sistema gerara a 2a via. O PDF do boleto e o PIX serao enviados automaticamente como mensagens separadas.");
          ispBlock.push("");
        }
        if (aiUnlock) {
          ispBlock.push("3. DESBLOQUEIO DE CONFIANCA:");
          ispBlock.push("   Se o cliente estiver com internet bloqueada por inadimplencia e pedir para desbloquear temporariamente:");
          ispBlock.push("   [DESBLOQUEAR_CONFIANCA:id_do_cliente:id_do_contrato]");
          ispBlock.push("   O sistema fara o desbloqueio temporario (confianca) no ERP.");
          ispBlock.push("");
        }
        if (aiPayConfirm) {
          ispBlock.push("4. CONFIRMAR PAGAMENTO (INFORME DE PAGAMENTO):");
          ispBlock.push("   Quando o cliente informar que ja pagou uma fatura, enviar comprovante, ou pedir para informar pagamento:");
          ispBlock.push("   [CONFIRMAR_PAGAMENTO:id_do_boleto:id_do_cliente:id_do_contrato]");
          ispBlock.push("   O sistema registrara a confirmacao de pagamento no ERP" + (aiAutoUnlock ? " e, se o cliente estiver bloqueado, fara o desbloqueio automaticamente." : "."));
          ispBlock.push("   Use esta tag quando o cliente disser: 'ja paguei', 'fiz o pagamento', 'paguei o boleto', 'informar pagamento', 'mandar comprovante', etc.");
          ispBlock.push("");
        }
        if (aiPromise) {
          ispBlock.push("5. REGISTRAR PROMESSA DE PAGAMENTO:");
          ispBlock.push("   Quando o cliente pedir para registrar uma promessa de pagamento ou prometer que vai pagar:");
          ispBlock.push("   [PROMESSA_PAGAMENTO:id_do_cliente:id_do_contrato:data_promessa:id_do_boleto]");
          ispBlock.push("   A data_promessa deve estar no formato AAAA-MM-DD (pode usar a data de hoje se o cliente nao especificar). O id_do_boleto e opcional.");
          ispBlock.push("   Exemplo: [PROMESSA_PAGAMENTO:6011:8951:2026-04-15:112071]");
          ispBlock.push("   O sistema registrara a promessa diretamente no SGP e a internet sera LIBERADA automaticamente (o SGP libera por ~2 dias).");
          ispBlock.push("   NAO e necessario chamar [DESBLOQUEAR_CONFIANCA] separadamente — a promessa ja faz a liberacao.");
          ispBlock.push("");
        }
        if (aiServiceOrder) {
          ispBlock.push("6. ABRIR ORDEM DE SERVICO (CHAMADO TECNICO):");
          ispBlock.push("   Quando voce identificar, apos conversar com o cliente sobre o problema tecnico, que ele precisa de atendimento presencial de um tecnico:");
          ispBlock.push("   [ORDEM_SERVICO:id_do_contrato:assunto:descricao_do_problema]");
          ispBlock.push("   O 'assunto' deve ser curto (ex: 'Sem sinal', 'Lentidao', 'Fibra rompida', 'Roteador com defeito').");
          ispBlock.push("   A 'descricao_do_problema' deve conter um resumo detalhado do que o cliente relatou durante a conversa.");
          ispBlock.push("   Exemplo: [ORDEM_SERVICO:8951:Sem sinal:Cliente relata que esta sem internet desde ontem. Ja reiniciou o roteador e a luz da fibra esta vermelha.]");
          ispBlock.push("   O sistema abrira a OS no ERP e retornara o numero do protocolo.");
          ispBlock.push("   IMPORTANTE: Antes de abrir a OS, sempre tente ajudar o cliente com troubleshooting basico (reiniciar roteador, verificar cabos, etc). So abra a OS quando confirmar que o problema requer visita tecnica.");
          ispBlock.push("");
        }
        ispBlock.push("FLUXO RECOMENDADO:");
        ispBlock.push("1. SEMPRE comece pedindo o CPF do cliente (se ainda nao tiver). Isso e OBRIGATORIO antes de qualquer acao.");
        if (aiCpf) ispBlock.push("2. Ao receber o CPF -> Use [CONSULTAR_CPF:cpf_limpo]");
        ispBlock.push("3. O sistema retornara TODOS os contratos do cliente (pode haver mais de um!).");
        ispBlock.push("4. CONTRATOS MULTIPLOS (MUITO IMPORTANTE):");
        ispBlock.push("   - O cliente pode ter 2 ou mais contratos, cada um em um endereco diferente.");
        ispBlock.push("   - Cada contrato pode ter status diferente (um ativo, outro suspenso/inadimplente).");
        ispBlock.push("   - Cada contrato tem seus proprios boletos independentes.");
        ispBlock.push("   - SEMPRE que houver mais de um contrato, LISTE TODOS com seus enderecos e status, e PERGUNTE ao cliente de qual contrato ele quer tratar.");
        ispBlock.push("   - Exemplo: 'Encontrei 2 contratos no seu CPF:'");
        ispBlock.push("     '1) Contrato #8951 - Rua das Flores, 123 - Centro (Status: Ativo)'");
        ispBlock.push("     '2) Contrato #8952 - Av. Brasil, 456 - Jardim (Status: Inadimplente)'");
        ispBlock.push("     'Qual contrato voce gostaria de verificar?'");
        ispBlock.push("   - So prossiga com acoes (2a via, desbloqueio, etc) apos o cliente indicar qual contrato.");
        ispBlock.push("   - Se houver apenas 1 contrato, prossiga normalmente sem perguntar.");
        ispBlock.push("5. Quando o cliente disser que esta sem internet, o PRIMEIRO PASSO e consultar o CPF para verificar:");
        ispBlock.push("   - Se o contrato esta ativo ou suspenso/inadimplente");
        ispBlock.push("   - Se ha boletos vencidos que causaram o bloqueio");
        ispBlock.push("   - Se ha mais de um contrato (pode ser que um funcione e outro nao)");
        if (ai2via) ispBlock.push("6. Se pedir 2a via -> Use [SEGUNDA_VIA:id_do_boleto] com o ID retornado na consulta");
        if (aiUnlock) ispBlock.push("7. Se pedir desbloqueio -> Use [DESBLOQUEAR_CONFIANCA:id_cliente:id_contrato]");
        if (aiPayConfirm) {
          ispBlock.push("8. Se informar pagamento / enviar comprovante -> Use [CONFIRMAR_PAGAMENTO:id_boleto:id_cliente:id_contrato]");
          if (aiAutoUnlock) ispBlock.push("   Apos confirmar, se o status do cliente era 'suspenso' ou 'inadimplente', o sistema desbloqueia automaticamente");
        }
        if (aiPromise) ispBlock.push("9. Se o cliente pedir promessa de pagamento, prometer pagar, quiser liberar internet -> Use [PROMESSA_PAGAMENTO:id_cliente:id_contrato:data_hoje:id_boleto] (a internet sera liberada automaticamente pelo SGP)");
        if (aiServiceOrder) ispBlock.push("10. Se o cliente relatar problema tecnico que necessite visita presencial -> Faca troubleshooting basico primeiro, depois use [ORDEM_SERVICO:id_contrato:assunto:descricao]");
        ispBlock.push("");
        ispBlock.push("REGRAS:");
        ispBlock.push("- Quando usar qualquer tag ISP, NAO envie resposta final ao cliente. Apenas inclua a tag com uma mensagem curta como 'Um momento, estou consultando...'");
        ispBlock.push("- Ao receber os resultados, apresente as informacoes de forma clara e amigavel");
        ispBlock.push("- SOMENTE mostre boletos VENCIDOS (com dias em atraso > 0). NAO mostre boletos que ainda nao venceram, a menos que o cliente peca explicitamente.");
        ispBlock.push("- Se o cliente pedir PIX, chave PIX, codigo PIX, ou link de pagamento referente a boletos do provedor, use SOMENTE os dados do sistema ISP (linha digitavel, link boleto, PIX do boleto). NUNCA use Mercado Pago para pagamentos de boletos do provedor de internet.");
        ispBlock.push("- NUNCA invente dados de boleto, valores, codigos PIX, chaves PIX ou NOMES DE PLANOS. Use SOMENTE os dados retornados pelo sistema.");
        ispBlock.push("- O nome do plano do cliente deve ser EXATAMENTE como retornado pelo sistema (ex: '600 MEGA FIBRA - PLANO BASICO'). NUNCA modifique, resuma ou invente nomes de planos.");
        ispBlock.push("- Sobre planos: use SOMENTE informacoes de planos que estiverem no seu prompt de sistema ou em imagens anexadas. NUNCA invente nomes ou valores de planos. Se o cliente perguntar sobre planos e voce nao tiver essa informacao no prompt/imagem, diga que nao tem essa informacao disponivel no momento.");
        ispBlock.push("- Se o CPF nao for encontrado, informe ao cliente que nao foi possivel localizar o cadastro");
        ispBlock.push("- IMPORTANTE: Se o cliente ja foi consultado anteriormente nesta conversa e voce ja tem os IDs (abaixo), NAO consulte o CPF de novo. Use diretamente as tags [PROMESSA_PAGAMENTO], [DESBLOQUEAR_CONFIANCA], [SEGUNDA_VIA], [CONFIRMAR_PAGAMENTO] ou [ORDEM_SERVICO] com os IDs ja conhecidos.");

        const cachedCustId = ctx.variables.isp_customer_id;
        const cachedContId = ctx.variables.isp_contrato_id;
        const cachedCustNome = ctx.variables.isp_customer_nome;
        const cachedCustStatus = ctx.variables.isp_customer_status;
        const cachedCustPlano = ctx.variables.isp_customer_plano;
        const cachedInvoiceId = ctx.variables.isp_invoice_id;
        const cachedInvoiceValor = ctx.variables.isp_invoice_valor;
        const cachedAllContracts = ctx.variables.isp_all_contracts;
        const cachedContractsCount = ctx.variables.isp_contracts_count;

        if (cachedAllContracts && Number(cachedContractsCount) > 1) {
          ispBlock.push("");
          ispBlock.push("DADOS ISP JA CONSULTADOS NESTA CONVERSA - CLIENTE COM MULTIPLOS CONTRATOS:");
          if (cachedCustNome) ispBlock.push(`  Nome: ${cachedCustNome}`);
          if (cachedCustId) ispBlock.push(`  Cliente ID: ${cachedCustId}`);
          try {
            const contracts = JSON.parse(cachedAllContracts as string);
            for (let ci = 0; ci < contracts.length; ci++) {
              const c = contracts[ci];
              ispBlock.push(`  Contrato ${ci + 1}: ID=${c.contratoId} | Plano=${c.plano} | Status=${c.status} | Endereco=${c.endereco}`);
            }
          } catch {}
          ispBlock.push("");
          ispBlock.push("IMPORTANTE: O cliente ainda NAO escolheu qual contrato deseja tratar.");
          ispBlock.push("PERGUNTE qual contrato (pelo endereco) antes de executar qualquer acao.");
          ispBlock.push("Apos o cliente escolher, use os IDs do contrato correto nas tags.");
        } else if (cachedCustId && cachedContId) {
          ispBlock.push("");
          ispBlock.push("DADOS ISP JA CONSULTADOS NESTA CONVERSA (use estes IDs diretamente, NAO consulte o CPF novamente):");
          ispBlock.push(`  Cliente ID: ${cachedCustId}`);
          ispBlock.push(`  Contrato ID: ${cachedContId}`);
          if (cachedCustNome) ispBlock.push(`  Nome: ${cachedCustNome}`);
          if (cachedCustPlano) ispBlock.push(`  Plano: ${cachedCustPlano}`);
          if (cachedCustStatus) ispBlock.push(`  Status: ${cachedCustStatus}`);
          if (cachedInvoiceId) ispBlock.push(`  Boleto ID: ${cachedInvoiceId}`);
          if (cachedInvoiceValor) ispBlock.push(`  Valor do boleto: ${cachedInvoiceValor}`);
          ispBlock.push("");
          ispBlock.push("Exemplos de uso direto (sem precisar consultar CPF de novo):");
          if (aiUnlock) ispBlock.push(`  Desbloqueio: [DESBLOQUEAR_CONFIANCA:${cachedCustId}:${cachedContId}]`);
          if (ai2via && cachedInvoiceId) ispBlock.push(`  2a via: [SEGUNDA_VIA:${cachedInvoiceId}]`);
          ispBlock.push(`  Promessa: [PROMESSA_PAGAMENTO:${cachedCustId}:${cachedContId}:AAAA-MM-DD:${cachedInvoiceId || ""}]`);
          if (aiPayConfirm && cachedInvoiceId) ispBlock.push(`  Confirmar pagamento: [CONFIRMAR_PAGAMENTO:${cachedInvoiceId}:${cachedCustId}:${cachedContId}]`);
          if (aiServiceOrder) ispBlock.push(`  Ordem de servico: [ORDEM_SERVICO:${cachedContId}:assunto:descricao_do_problema]`);
        }

        ispBlock.push("[FIM CONSULTA ISP]");
        systemPrompt += ispBlock.join("\n");

        try {
          const { getWorkspaceLearningContext } = await import("./ai-learning");
          const learningContext = await getWorkspaceLearningContext(ctx.workspaceId);
          if (learningContext) {
            systemPrompt += learningContext;
          }
        } catch (learnErr: any) {
          console.error("[AutomationEngine] Learning context error:", learnErr.message);
        }
      }

      const exitTriggers: { id: string; matchType: string; keywords: string; targetNodeLabel?: string }[] = c.exitTriggers || [];
      if (exitTriggers.length > 0) {
        const etBlock: string[] = [];
        etBlock.push("\n\n[GATILHOS DE SAIDA]");
        etBlock.push("O fluxo possui gatilhos de saida configurados. Quando a mensagem do cliente corresponder a um desses gatilhos, voce DEVE incluir a tag [SAIDA_GATILHO:indice] na sua resposta para que o sistema encaminhe o fluxo corretamente.");
        etBlock.push("IMPORTANTE: Ao detectar um gatilho de saida, responda de forma breve e natural confirmando a transferencia, e inclua a tag no final.");
        for (let i = 0; i < exitTriggers.length; i++) {
          const et = exitTriggers[i];
          const matchLabel = et.matchType === "contains" ? "contem" : et.matchType === "exact" ? "igual a" : et.matchType === "starts_with" ? "comeca com" : "regex";
          const dest = et.targetNodeLabel ? ` -> destino: "${et.targetNodeLabel}"` : "";
          etBlock.push(`  Gatilho ${i + 1} (${matchLabel}): palavras="${et.keywords}"${dest} -> use [SAIDA_GATILHO:${i}]`);
        }
        etBlock.push("[FIM GATILHOS DE SAIDA]");
        systemPrompt += etBlock.join("\n");
      }

      if (c.aiCrmAgenda !== false) {
        systemPrompt += `\n\n[AGENDAMENTO DE REUNIAO]\nVoce pode agendar reunioes/compromissos usando a tag [AGENDAR_REUNIAO:data:hora:titulo].\nOnde:\n- data = data no formato DD/MM/AAAA (ex: 25/03/2026)\n- hora = horario no formato HH:MM (ex: 14:00)\n- titulo = breve descricao da reuniao\nExemplo: [AGENDAR_REUNIAO:25/03/2026:14:00:Demonstracao ChatBanana CRM]\nIMPORTANTE: Confirme data e horario com o cliente ANTES de usar a tag. Quando usar a tag, inclua uma mensagem confirmando o agendamento ao cliente.\nO sistema criara automaticamente o compromisso na agenda.\n[FIM AGENDAMENTO]`;
      }

      systemPrompt += `\n\n[INSTRUCOES DE CONTEXTO E COMPORTAMENTO]\nVoce DEVE manter dominio completo de toda a conversa. Antes de responder, releia todo o historico disponivel. Nunca pergunte algo que o cliente ja respondeu. Se o cliente ja informou endereco, pedido, ou qualquer dado, use essa informacao diretamente. Seja coerente com tudo que ja foi dito.\n\n[PROATIVIDADE — REGRA CRITICA]\nVoce e um assistente PRO-ATIVO, nao reativo. Isso significa:\n- Quando o cliente demonstra interesse em algo, ACAO IMEDIATA. Nao fique pedindo confirmacao atras de confirmacao.\n- Se o cliente diz "sim", "quero", "manda", "pode ser", "ok" — EXECUTE a acao. Nao pergunte novamente.\n- Se voce tem um arquivo relevante para o momento (cardapio, tabela de precos, catalogo), ENVIE junto com a resposta. Nao diga "vou enviar" sem enviar de fato.\n- Se o cliente ja disse o que quer, ANOTE O PEDIDO. Nao pergunte "o que voce gostaria?" de novo.\n- Entenda o CONTEXTO da conversa inteira. Se ha 2 mensagens atras o cliente pediu o cardapio e voce ainda nao enviou, ENVIE AGORA.\n- NUNCA responda "um momento" ou "aguarde" e depois nao faca nada. Se precisa fazer algo, FACA NA MESMA RESPOSTA.\n- NUNCA peca nome, telefone ou numero do cliente. Voce JA TEM essas informacoes nos DADOS DO CLIENTE. Use o nome dele em todas as mensagens.\n\n[FINALIZACAO DO ATENDIMENTO]\nQuando o atendimento estiver completamente finalizado (pedido confirmado, dados coletados, pagamento definido), voce DEVE incluir a tag [FINALIZADO] no final da sua ultima mensagem. Isso sinaliza ao sistema que a conversa foi concluida. Exemplo: "Pedido confirmado! Obrigado! [FINALIZADO]". So use [FINALIZADO] quando TUDO estiver realmente concluido. Se o cliente ainda tiver duvidas ou pendencias, NAO use a tag.\n\n[LEMBRETE CRM — OBRIGATORIO]\nNAO ESQUECA: Voce DEVE incluir tags [CRM_...] em CADA resposta. Releia as instrucoes CRM no INICIO deste prompt. As tags sao removidas antes de enviar ao cliente.`;

      let flowContextSummary = "";
      try {
        const executedBefore = logEntries.filter((e: any) => e.nodeId !== node.id);
        if (executedBefore.length > 0 || nodesArr.length > 1) {
          const lines: string[] = [];
          lines.push("=== CONTEXTO DO FLUXO DE AUTOMACAO ===");
          lines.push("Voce faz parte de um fluxo de automacao. Abaixo esta tudo que ja aconteceu ANTES de voce neste atendimento. Use essas informacoes como referencia, mas SEMPRE siga fielmente o prompt do sistema acima — incluindo sua apresentacao, nome, personalidade e tom de voz. Nao repita perguntas que o cliente ja respondeu.");
          lines.push("");

          for (const entry of executedBefore) {
            const entryNode = nodesArr.find((n: FlowNode) => n.id === entry.nodeId);
            const cfg = entryNode?.config || {};
            if (entry.type === "trigger") {
              const triggerLabel = cfg.triggerType === "new_message" ? "Nova mensagem recebida" : cfg.triggerType || "gatilho";
              lines.push(`[Gatilho] ${triggerLabel}`);
            } else if (entry.type === "send_message") {
              lines.push(`[Bot enviou mensagem] "${(cfg.content || entry.output?.preview || "").substring(0, 300)}"`);
            } else if (entry.type === "send_image") {
              lines.push(`[Bot enviou imagem] URL: ${cfg.imageUrl || ""}, Legenda: "${cfg.caption || "sem legenda"}"`);
            } else if (entry.type === "delay") {
              lines.push(`[Aguardou] ${cfg.value || ""} ${cfg.unit || ""}`);
            } else if (entry.type === "lista_opcoes") {
              const opts = (cfg.options || []).map((o: any) => o.label || o.title || o.id).join(", ");
              lines.push(`[Bot apresentou lista de opcoes] Titulo: "${cfg.title || ""}", Opcoes: [${opts}]`);
              if (entry.output?.selectedOption) {
                lines.push(`[Cliente escolheu] "${entry.output.selectedOption}"`);
              }
            } else if (entry.type === "condition") {
              lines.push(`[Condicao avaliada] ${cfg.field || ""} ${cfg.operator || ""} "${cfg.value || ""}" -> resultado: ${entry.output?.result}`);
            } else if (entry.type === "tag_lead") {
              lines.push(`[Lead marcado com tags] ${JSON.stringify(cfg.tags || [])}`);
            } else if (entry.type === "assign_agent") {
              lines.push(`[Lead atribuido a atendente] Estrategia: ${cfg.strategy || ""}`);
            } else if (entry.type === "update_lead") {
              lines.push(`[Pipeline atualizada] ${cfg.pipelineLabel || cfg.pipeline || ""} -> ${cfg.stageLabel || cfg.stage || ""}`);
            } else if (entry.type === "ai_response" || entry.type === "agente") {
              if (entry.output?.response_preview) {
                lines.push(`[IA respondeu anteriormente] "${(entry.output.response_preview || "").substring(0, 300)}"`);
              }
            }
          }

          if (Object.keys(ctx.variables || {}).length > 0) {
            const safeVars = { ...ctx.variables };
            delete safeVars.last_ai_response;
            if (Object.keys(safeVars).length > 0) {
              lines.push("");
              lines.push(`[Variaveis coletadas no fluxo] ${JSON.stringify(safeVars)}`);
            }
          }

          lines.push("");
          lines.push("=== FIM DO CONTEXTO DO FLUXO ===");
          lines.push("IMPORTANTE: Siga FIELMENTE o prompt do sistema configurado acima. Se o prompt define que voce deve se apresentar com um nome especifico (ex: 'Eu sou a Dani'), faca exatamente isso na sua PRIMEIRA resposta, mesmo que um no anterior ja tenha enviado uma mensagem de boas-vindas generica. O prompt do sistema e a sua identidade principal.");
          flowContextSummary = lines.join("\n");
        }
      } catch (fcErr: any) {
        console.error("[AutomationEngine] Error building flow context:", fcErr.message);
      }

      const saveTo = c.save_to || c.saveAs || "aiReply";
      const selectedModel = c.model || "gpt-4o-mini";

      const nodeOpenaiKey = c.openaiApiKey || "";
      let aiCandidates: Array<{ apiKey: string; baseURL: string; source: string }> = [];
      if (nodeOpenaiKey) {
        aiCandidates.push({ apiKey: nodeOpenaiKey, baseURL: "https://api.openai.com/v1", source: "node" });
      }
      const centralCandidates = await resolveOpenAIKeys(ctx.workspaceId);
      aiCandidates = aiCandidates.concat(centralCandidates);

      if (aiCandidates.length === 0) {
        const fallback = "[IA nao configurada — cadastre a OpenAI API Key nas Integracoes ou na aba Avancado do agente]";
        ctx.variables[saveTo] = fallback;
        ctx.variables.last_ai_response = fallback;
        return {
          output: { success: false, error: "OpenAI API Key nao configurada. Configure em Integracoes ou diretamente no agente.", response_preview: fallback },
          status: "success",
        };
      }

      const aiApiKey = aiCandidates[0].apiKey;
      const aiBaseURL = aiCandidates[0].baseURL;
      const aiKeySource = aiCandidates[0].source;
      console.log(`[AutomationEngine] AI key resolved (source: ${aiKeySource}, len: ${aiApiKey.length})`);
      const aiClient = getOpenAIClient({ apiKey: aiApiKey, baseURL: aiBaseURL });

      if (flowContextSummary) {
        systemPrompt = systemPrompt + "\n\n" + flowContextSummary;
      }

      const msg = ctx.message || {};
      const leadContext = [leadInfo].filter(Boolean).join("\n");
      let userMessages: any[] = [];
      let overrideModel: string | undefined;
      let transcript = "";
      let documentText = "";

      let conversationHistory: any[] = [];
      if (ctx.conversationId) {
        try {
          const conv = await storage.getConversation(ctx.conversationId, ctx.workspaceId || "");
          const resolvedAt = conv?.resolvedAt ? new Date(conv.resolvedAt).getTime() : 0;
          const hoursSinceResolved = resolvedAt ? (Date.now() - resolvedAt) / 3600000 : Infinity;
          const shouldResetAiContext = resolvedAt > 0 && hoursSinceResolved >= 24;

          // internal - sem paginação intencional (histórico completo para contexto IA)
          const historyMessages = await storage.getMessages(ctx.conversationId, { limit: 200 });
          const totalMsgs = historyMessages.length;

          if (shouldResetAiContext) {
            const cutoffTime = new Date(resolvedAt);
            systemPrompt = systemPrompt + "\n\n[CONTEXTO IMPORTANTE] Este cliente ja foi atendido antes. O atendimento anterior foi encerrado em " + cutoffTime.toLocaleDateString("pt-BR") + ". Inicie um NOVO atendimento, seguindo as instrucoes normais. Voce pode lembrar do cliente e suas informacoes, mas NAO de continuidade ao atendimento anterior. Trate como um contato novo dentro do fluxo de atendimento.";
          }

          if (totalMsgs > 50) {
            const older = historyMessages.slice(0, totalMsgs - 40);
            const olderSummaryLines: string[] = [];
            olderSummaryLines.push("=== RESUMO DAS MENSAGENS ANTERIORES ===");
            for (const hm of older) {
              if (!hm.texto) continue;
              const who = hm.direction === "in" ? "Cliente" : "Bot";
              const preview = hm.texto.length > 150 ? hm.texto.substring(0, 150) + "..." : hm.texto;
              const media = hm.tipo && hm.tipo !== "text" ? ` [${hm.tipo}]` : "";
              olderSummaryLines.push(`${who}${media}: ${preview}`);
            }
            olderSummaryLines.push("=== FIM DO RESUMO ===\n");
            systemPrompt = systemPrompt + "\n\n" + olderSummaryLines.join("\n");

            const recent = historyMessages.slice(-40);
            for (const hm of recent) {
              const role = hm.direction === "in" ? "user" : (hm.agente === "Bot" ? "assistant" : null);
              if (!role || !hm.texto) continue;
              const lastEntry = conversationHistory[conversationHistory.length - 1];
              if (lastEntry && lastEntry.role === role) {
                lastEntry.content += "\n" + hm.texto;
              } else {
                conversationHistory.push({ role, content: hm.texto });
              }
            }
          } else {
            for (const hm of historyMessages) {
              const role = hm.direction === "in" ? "user" : (hm.agente === "Bot" ? "assistant" : null);
              if (!role || !hm.texto) continue;
              const lastEntry = conversationHistory[conversationHistory.length - 1];
              if (lastEntry && lastEntry.role === role) {
                lastEntry.content += "\n" + hm.texto;
              } else {
                conversationHistory.push({ role, content: hm.texto });
              }
            }
          }

          if (conversationHistory.length > 0 && conversationHistory[0].role === "assistant") {
            conversationHistory.shift();
          }
        } catch (histErr: any) {
          console.error(`[AutomationEngine] Failed to load history:`, histErr.message);
        }
      }

      const mediaType = msg.type || "text";

      let currentUserContent = "";
      let imageBase64: string | null = null;
      let imageMimeType = "image/jpeg";

      if (!msg.media_url || mediaType === "text") {
        currentUserContent = msg.text || "nao disponivel";
      } else if (mediaType === "image") {
        overrideModel = "gpt-4o";
        const caption = msg.text || "sem caption";
        currentUserContent = `${leadContext}\nO cliente enviou uma imagem. Caption: "${caption}"\nDescreva e analise a imagem conforme o contexto do atendimento.`;
        console.log(`[AutomationEngine] Processing IMAGE: url=${msg.media_url?.substring(0, 60)}, caption="${caption}"`);

        try {
          if (msg.media_url!.startsWith("/uploads/")) {
            const { readFileSync } = await import("fs");
            const imgBuf = readFileSync(resolveUploadPath(msg.media_url!));
            imageBase64 = imgBuf.toString("base64");
            imageMimeType = msg.media_type || "image/jpeg";
          } else {
            const imgHeaders: Record<string, string> = {};
            if (ctx.metaAccessToken) imgHeaders["Authorization"] = `Bearer ${ctx.metaAccessToken}`;
            const imgResponse = await fetchWithTimeout(msg.media_url!, { headers: imgHeaders }, 30000);
            if (imgResponse.ok) {
              const imgBuffer = await imgResponse.arrayBuffer();
              imageBase64 = Buffer.from(imgBuffer).toString("base64");
              imageMimeType = msg.media_type || imgResponse.headers.get("content-type") || "image/jpeg";
            } else {
              console.error(`[AutomationEngine] Image download failed: ${imgResponse.status} ${imgResponse.statusText}`);
              currentUserContent += "\n[Nao foi possivel baixar a imagem]";
            }
          }
        } catch (imgErr: any) {
          console.error(`[AutomationEngine] Image download error:`, imgErr.message);
          currentUserContent += "\n[Erro ao baixar a imagem]";
        }
      } else if (mediaType === "audio") {
        try {
          let rawBuffer: Buffer;
          if (msg.media_url!.startsWith("/uploads/")) {
            const { readFileSync } = await import("fs");
            rawBuffer = readFileSync(resolveUploadPath(msg.media_url!));
          } else {
            const audioHeaders: Record<string, string> = {};
            if (ctx.metaAccessToken) audioHeaders["Authorization"] = `Bearer ${ctx.metaAccessToken}`;
            const audioResponse = await fetchWithTimeout(msg.media_url!, { headers: audioHeaders }, 30000);
            if (!audioResponse.ok) {
              throw new Error(`Audio download failed: ${audioResponse.status} ${audioResponse.statusText}`);
            }
            rawBuffer = Buffer.from(await audioResponse.arrayBuffer());
          }

          function detectFormat(buf: Buffer): string {
            if (buf.length < 12) return "unknown";
            if (buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46) return "wav";
            if (buf[0]===0x1a && buf[1]===0x45 && buf[2]===0xdf && buf[3]===0xa3) return "webm";
            if ((buf[0]===0xff && (buf[1]===0xfb||buf[1]===0xfa||buf[1]===0xf3)) || (buf[0]===0x49 && buf[1]===0x44 && buf[2]===0x33)) return "mp3";
            if (buf[4]===0x66 && buf[5]===0x74 && buf[6]===0x79 && buf[7]===0x70) return "mp4";
            if (buf[0]===0x4f && buf[1]===0x67 && buf[2]===0x67 && buf[3]===0x53) return "ogg";
            return "unknown";
          }
          const detected = detectFormat(rawBuffer);
          console.log(`[AutomationEngine] Audio detected format: ${detected}, size: ${rawBuffer.length} bytes`);

          const { toFile } = await import("openai");
          const extMap: Record<string, string> = { ogg: "ogg", mp3: "mp3", wav: "wav", webm: "webm", mp4: "mp4", unknown: "ogg" };
          const mimeMap: Record<string, string> = { ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", webm: "audio/webm", mp4: "audio/mp4", unknown: "audio/ogg" };
          const ext = extMap[detected] || "ogg";
          const mime = msg.media_type || mimeMap[detected] || "audio/ogg";
          const audioFile = await toFile(rawBuffer, `audio.${ext}`, { type: mime });
          console.log(`[AutomationEngine] Transcribing via OpenAI whisper-1 (key source: ${aiKeySource}, key_len: ${aiApiKey.length})...`);
          const whisperData: any = await aiClient.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1",
            language: "pt",
            temperature: 0,
            response_format: "verbose_json",
          });
          transcript = (whisperData.text || "").trim();
          console.log(`[AutomationEngine] Whisper result: "${(transcript || "").substring(0, 100)}"`);

          // Guard de alucinação (ruído/balbucio → frase fantasma): descarta.
          if (transcript) {
            const { detectWhisperHallucination } = await import("../utils/audioHallucination");
            const verdict = detectWhisperHallucination(transcript, {
              segments: whisperData.segments,
              duration: whisperData.duration,
            });
            if (verdict.hallucinated) {
              console.warn(`[AutomationEngine] 🚫 Transcrição descartada (alucinação, reason=${verdict.reason}): "${transcript.substring(0, 100)}"`);
              transcript = "";
            }
          }

          if (!transcript) transcript = "[audio nao compreendido]";
        } catch (err: any) {
          console.error(`[AutomationEngine] Audio transcription FAILED:`, err.message);
          console.error(`[AutomationEngine] Error details:`, err.status, err.code, JSON.stringify(err.error || {}).substring(0, 200));
          transcript = "[audio nao compreendido]";
        }

        if (ctx.message) ctx.message.audio_transcript = transcript;
        ctx.variables.last_audio_transcript = transcript;

        if (transcript && transcript !== "[audio nao compreendido]" && ctx.conversationId) {
          try {
            const lastAudioMsg = await db.select({ id: messages.id })
              .from(messages)
              .where(and(
                eq(messages.conversationId, Number(ctx.conversationId)),
                eq(messages.tipo, "audio"),
                eq(messages.direction, "in"),
              ))
              .orderBy(desc(messages.id))
              .limit(1);
            if (lastAudioMsg.length > 0) {
              await db.update(messages)
                .set({ texto: transcript })
                .where(eq(messages.id, lastAudioMsg[0].id));
              console.log(`[AutomationEngine] Saved transcription to message #${lastAudioMsg[0].id}`);
              try {
                broadcastToWorkspace(ctx.workspaceId, "message_updated", {
                  conversationId: Number(ctx.conversationId),
                  messageId: lastAudioMsg[0].id,
                  updates: { texto: transcript },
                });
              } catch {}
            }
          } catch (err: any) {
            console.error(`[AutomationEngine] Failed to save transcription:`, err.message);
          }
        }

        currentUserContent = `O cliente enviou um audio de voz. Transcricao: "${transcript}"\nResponda com base na transcricao.`;
      } else if (mediaType === "document") {
        console.log(`[AutomationEngine] Processing DOCUMENT: url=${msg.media_url?.substring(0, 60)}, mime=${msg.media_type}, filename=${msg.filename}`);
        try {
          let docBuffer: ArrayBuffer;
          if (msg.media_url?.startsWith("/uploads/")) {
            const { readFileSync } = await import("fs");
            const buf = readFileSync(resolveUploadPath(msg.media_url));
            docBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          } else {
            const docHeaders: Record<string, string> = {};
            if (ctx.metaAccessToken) docHeaders["Authorization"] = `Bearer ${ctx.metaAccessToken}`;
            const docResponse = await fetchWithTimeout(msg.media_url!, { headers: docHeaders }, 30000);
            docBuffer = await docResponse.arrayBuffer();
          }

          if (msg.media_type?.includes("pdf") || msg.filename?.endsWith(".pdf")) {
            const pdfParseModule = await import("pdf-parse");
            const pdfParse: any = (pdfParseModule as any).default || pdfParseModule;
            const data = await pdfParse(Buffer.from(docBuffer));
            documentText = (data.text || "").slice(0, 3000);
          } else {
            documentText = Buffer.from(docBuffer).toString("utf-8").slice(0, 3000);
          }
        } catch (err: any) {
          documentText = `[erro ao processar documento: ${err.message}]`;
        }

        currentUserContent = `O cliente enviou o documento "${msg.filename || "arquivo"}". Conteudo extraido:\n\n${documentText}\n\nResponda com base no documento.`;
      } else {
        currentUserContent = msg.text || "nao disponivel";
      }

      if (conversationHistory.length > 0) {
        userMessages = [...conversationHistory];
        if (mediaType !== "text" && currentUserContent) {
          const lastUserIdx = userMessages.map((m, i) => m.role === "user" ? i : -1).filter(i => i >= 0).pop();
          if (lastUserIdx !== undefined && lastUserIdx >= 0) {
            userMessages[lastUserIdx] = { role: "user", content: currentUserContent };
          } else {
            userMessages.push({ role: "user", content: currentUserContent });
          }
        }
      } else {
        userMessages = [{ role: "user", content: `${leadContext}\n${currentUserContent}` }];
      }

      const modelToUse = overrideModel || c.model || "gpt-4o-mini";


      try {
        let content = "";
        let tokensUsed = 0;

        const openaiMessages: any[] = [
          { role: "system", content: systemPrompt },
          ...userMessages,
        ];

        if (imageBase64 && openaiMessages.length > 1) {
          const lastOaiMsg = openaiMessages[openaiMessages.length - 1];
          if (lastOaiMsg.role === "user") {
            const existingText = typeof lastOaiMsg.content === "string" ? lastOaiMsg.content : currentUserContent;
            lastOaiMsg.content = [
              { type: "text", text: existingText },
              { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "auto" } },
            ];
          }
        }

        console.log(`[AutomationEngine] Calling chat completions (model: ${modelToUse}, msgs: ${openaiMessages.length})...`);
        const data = await aiClient.chat.completions.create({
          model: modelToUse,
          messages: openaiMessages,
          max_tokens: c.maxTokens || 2048,
          temperature: c.temperature ?? 0.7,
        });
        content = data.choices?.[0]?.message?.content || "";
        tokensUsed = data.usage?.total_tokens || 0;
        console.log(`[AutomationEngine] Chat completion OK (tokens: ${tokensUsed}, response_len: ${content.length})`);

        let flowFinalized = /\[FINALIZADO\]/i.test(content);
        if (flowFinalized) {
          content = content.replace(/\s*\[FINALIZADO\]\s*/gi, "").trim();
        }

        const exitTriggerMatch = content.match(/\[SAIDA_GATILHO:(\d+)\]/i);
        let matchedExitTriggerIndex = -1;
        if (exitTriggerMatch) {
          matchedExitTriggerIndex = parseInt(exitTriggerMatch[1], 10);
          content = content.replace(/\s*\[SAIDA_GATILHO:\d+\]\s*/gi, "").trim();
          if (exitTriggers[matchedExitTriggerIndex]) {
            flowFinalized = true;
            ctx.variables.__exit_trigger_index = matchedExitTriggerIndex;
            ctx.variables.__exit_trigger_label = exitTriggers[matchedExitTriggerIndex].targetNodeLabel || "";
          }
        }

        if (!exitTriggerMatch && exitTriggers.length > 0) {
          const incomingText = (ctx.message?.text || (ctx.message as any)?.body || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          for (let eti = 0; eti < exitTriggers.length; eti++) {
            const et = exitTriggers[eti];
            const kws = et.keywords.split(",").map((k: string) => k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).filter(Boolean);
            let matched = false;
            for (const kw of kws) {
              if (et.matchType === "exact" && incomingText === kw) matched = true;
              else if (et.matchType === "starts_with" && incomingText.startsWith(kw)) matched = true;
              // ReDoS guard: kw é regex livre da config do tenant (qualquer membro edita
              // automação) e roda a cada mensagem no event loop COMPARTILHADO — um padrão
              // catastrófico (ex: "(.*a){25}b") travaria o processo inteiro de todos os
              // tenants. isSafeRegexSource rejeita backtracking exponencial; padrão inseguro
              // degrada pra match literal em vez de executar.
              else if (et.matchType === "regex") { try { if (isSafeRegexSource(kw)) matched = new RegExp(kw, "i").test(incomingText.slice(0, 2000)); else matched = incomingText.includes(kw); } catch {} }
              else if (incomingText.includes(kw)) matched = true;
              if (matched) break;
            }
            if (matched) {
              matchedExitTriggerIndex = eti;
              flowFinalized = true;
              ctx.variables.__exit_trigger_index = eti;
              ctx.variables.__exit_trigger_label = et.targetNodeLabel || "";
              break;
            }
          }
        }

        const fileTagRegex = /\[ENVIAR_ARQUIVO:([^\]]+)\]/gi;
        const fileTagMatches = [...content.matchAll(fileTagRegex)];
        const filesToSend: typeof aiFiles = [];
        if (fileTagMatches.length > 0 && aiFiles.length > 0) {
          const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          for (const match of fileTagMatches) {
            const requestedName = normalize(match[1]);
            const found = aiFiles.find(af => {
              const aName = normalize(af.name || af.originalName || "");
              return aName === requestedName;
            }) || aiFiles.find(af => {
              const aName = normalize(af.name || af.originalName || "");
              return aName.includes(requestedName) || requestedName.includes(aName);
            });
            if (found && !filesToSend.find(fs => fs.id === found.id)) {
              filesToSend.push(found);
            }
          }
        }
        content = content.replace(fileTagRegex, "").replace(/\n{3,}/g, "\n\n").trim();

        const ispCpfTagRegex = /\[CONSULTAR_CPF:([^\]]+)\]/gi;
        const ispSegundaViaRegex = /\[SEGUNDA_VIA:([^\]]+)\]/gi;
        const ispDesbloqRegex = /\[DESBLOQUEAR_CONFIANCA:([^\]:]+):([^\]]+)\]/gi;
        const ispConfirmPagRegex = /\[CONFIRMAR_PAGAMENTO:([^\]:]+):([^\]:]+):([^\]]+)\]/gi;
        const ispPromessaRegex = /\[PROMESSA_PAGAMENTO:([^\]:]+):([^\]:]+):([^\]:]+)(?::([^\]]*))?\]/gi;
        const ispOrdemServicoRegex = /\[ORDEM_SERVICO:([^\]:]+):([^\]:]+):([^\]]+)\]/gi;
        const ispCpfMatches = [...content.matchAll(ispCpfTagRegex)];
        const ispSegundaViaMatches = [...content.matchAll(ispSegundaViaRegex)];
        const ispDesbloqMatches = [...content.matchAll(ispDesbloqRegex)];
        const ispConfirmPagMatches = [...content.matchAll(ispConfirmPagRegex)];
        const ispPromessaMatches = [...content.matchAll(ispPromessaRegex)];
        const ispOrdemServicoMatches = [...content.matchAll(ispOrdemServicoRegex)];
        const hasIspTags = ispCpfMatches.length > 0 || ispSegundaViaMatches.length > 0 || ispDesbloqMatches.length > 0 || ispConfirmPagMatches.length > 0 || ispPromessaMatches.length > 0 || ispOrdemServicoMatches.length > 0;

        // Módulo ISP/ERP removido — apenas removemos as tags ISP do conteúdo (no-op).
        if (false) {
          const ispResults: { action: string; success: boolean; data: string }[] = [];
          const aiCpfOn = ispCfgForAI.aiCpfLookupEnabled !== false;
          const ai2viaOn = ispCfgForAI.aiSecondCopyEnabled !== false;
          const aiUnlockOn = ispCfgForAI.aiTrustUnlockEnabled !== false;
          const aiPayConfirmOn = ispCfgForAI.aiPaymentConfirmEnabled !== false;
          const aiAutoUnlockOn = ispCfgForAI.aiAutoUnlockOnPayment !== false;

          try {
            const ispProvider: any = null;
            const ispCreds: any = null;

            for (const match of aiCpfOn ? ispCpfMatches : []) {
              const cpfRaw = match[1].replace(/[.\-\/\s]/g, "").trim();
              try {
                const allContracts: any[] = ispProvider.searchAllContractsByCPF
                  ? await ispProvider.searchAllContractsByCPF(ispCreds, cpfRaw)
                  : await ispProvider.searchCustomerByCPF(ispCreds, cpfRaw).then((c: any) => c ? [c] : []);

                if (allContracts.length > 0) {
                  const customer = allContracts[0];
                  ctx.variables.cpf = cpfRaw;
                  ctx.variables.isp_success = "true";
                  ctx.variables.isp_customer_nome = customer.nome;
                  ctx.variables.isp_contracts_count = String(allContracts.length);

                  if (allContracts.length === 1) {
                    ctx.variables.isp_customer_id = customer.id;
                    ctx.variables.isp_contrato_id = customer.contratoId || customer.id;
                    ctx.variables.isp_customer_status = customer.status;
                    ctx.variables.isp_customer_plano = customer.plano;
                  }

                  const invLines: string[] = [];
                  invLines.push(`CLIENTE ENCONTRADO:`);
                  invLines.push(`  Nome: ${customer.nome}`);
                  invLines.push(`  CPF: ${customer.cpf}`);
                  invLines.push(`  ID Cliente: ${customer.id}`);
                  invLines.push(`  Total de contratos: ${allContracts.length}`);
                  invLines.push("");

                  const ispBoletoPdfs: { url: string; fileName: string; caption: string }[] = (ctx.variables.__isp_boleto_pdfs as any[]) || [];
                  const ispPixSeparate: string[] = (ctx.variables.__isp_pix_separate as string[]) || [];
                  let totalOverdue = 0;

                  for (let ci = 0; ci < allContracts.length; ci++) {
                    const cont = allContracts[ci];
                    const contId = cont.contratoId || cont.id;
                    invLines.push(`${"=".repeat(50)}`);
                    invLines.push(`CONTRATO ${ci + 1} de ${allContracts.length}:`);
                    invLines.push(`  ID Contrato: ${contId}`);
                    invLines.push(`  Plano: ${cont.plano}`);
                    invLines.push(`  Status: ${cont.status.toUpperCase()}`);
                    if (cont.endereco) invLines.push(`  Endereco: ${cont.endereco}`);
                    invLines.push("");

                    const invoices = await ispProvider.getOpenInvoices(ispCreds, contId);
                    const overdue = invoices.filter((inv: any) => inv.diasAtraso > 0);
                    const upcoming = invoices.filter((inv: any) => inv.diasAtraso <= 0);
                    totalOverdue += overdue.length;

                    if (overdue.length === 0 && upcoming.length === 0) {
                      invLines.push(`  BOLETOS: Nenhum boleto em aberto. Contrato em dia!`);
                    } else {
                      if (overdue.length > 0) {
                        invLines.push(`  BOLETOS VENCIDOS (${overdue.length}):`);
                        for (let i = 0; i < overdue.length; i++) {
                          const inv = overdue[i];
                          invLines.push(`    Boleto ${i + 1}:`);
                          invLines.push(`      ID: ${inv.id}`);
                          invLines.push(`      Valor: R$ ${Number(inv.valor).toFixed(2)}`);
                          invLines.push(`      Vencimento: ${formatDateBR(inv.vencimento)}`);
                          invLines.push(`      Status: VENCIDO`);
                          invLines.push(`      Dias em atraso: ${inv.diasAtraso}`);
                          if (inv.linhaDigitavel) invLines.push(`      Linha digitavel: ${inv.linhaDigitavel}`);
                          if (inv.linkBoleto) {
                            invLines.push(`      PDF do boleto: SERA ENVIADO AUTOMATICAMENTE COMO ARQUIVO SEPARADO`);
                            ispBoletoPdfs.push({
                              url: inv.linkBoleto,
                              fileName: `boleto_${inv.id}_R$${Number(inv.valor).toFixed(2)}.pdf`,
                              caption: `📄 Boleto R$ ${Number(inv.valor).toFixed(2)} - Venc: ${formatDateBR(inv.vencimento)} (Contrato ${contId})`,
                            });
                          }
                          if (inv.pix) {
                            invLines.push(`      PIX: SERA ENVIADO AUTOMATICAMENTE COMO MENSAGEM SEPARADA`);
                            ispPixSeparate.push(inv.pix);
                          }
                          invLines.push("");

                          if (ci === 0 && i === 0) {
                            ctx.variables.isp_invoice_id = inv.id;
                            ctx.variables.isp_invoice_valor = `R$ ${Number(inv.valor).toFixed(2)}`;
                            ctx.variables.isp_invoice_vencimento = formatDateBR(inv.vencimento);
                            ctx.variables.isp_invoice_status = inv.status;
                            ctx.variables.isp_invoice_dias_atraso = String(inv.diasAtraso);
                            ctx.variables.isp_linha_digitavel = inv.linhaDigitavel || "";
                            ctx.variables.isp_link_boleto = inv.linkBoleto || "";
                            ctx.variables.isp_pix = inv.pix || "";
                          }
                        }
                      } else {
                        invLines.push(`  BOLETOS VENCIDOS: Nenhum. Contrato sem atraso.`);
                      }
                      if (upcoming.length > 0) {
                        invLines.push(`  (INFO INTERNA: Existem ${upcoming.length} boleto(s) a vencer futuramente para este contrato, mas NAO mostre ao cliente a menos que peca explicitamente.)`);
                      }
                    }
                    invLines.push("");
                  }

                  if (allContracts.length > 1) {
                    invLines.push(`${"=".repeat(50)}`);
                    invLines.push(`INSTRUCAO IMPORTANTE: O cliente tem ${allContracts.length} contratos.`);
                    invLines.push("Apresente TODOS os contratos com seus enderecos e status.");
                    invLines.push("PERGUNTE ao cliente de qual contrato deseja tratar ANTES de realizar qualquer acao.");
                    invLines.push("Apos o cliente escolher, use os IDs do contrato escolhido para as proximas acoes.");
                  }

                  ctx.variables.isp_invoices_count = String(totalOverdue);
                  ctx.variables.isp_has_debt = totalOverdue > 0 ? "true" : "false";

                  if (allContracts.length === 1) {
                    ctx.variables.isp_customer_id = customer.id;
                    ctx.variables.isp_contrato_id = customer.contratoId || customer.id;
                    ctx.variables.isp_customer_status = customer.status;
                    ctx.variables.isp_customer_plano = customer.plano;
                  } else {
                    const allContractsData = allContracts.map(c => ({
                      id: c.id, contratoId: c.contratoId || c.id, plano: c.plano, status: c.status, endereco: c.endereco
                    }));
                    ctx.variables.isp_all_contracts = JSON.stringify(allContractsData);
                  }

                  ctx.variables.__isp_boleto_pdfs = ispBoletoPdfs;
                  ctx.variables.__isp_pix_separate = ispPixSeparate;
                  ispResults.push({ action: "consultar_cpf", success: true, data: invLines.join("\n") });
                } else {
                  ctx.variables.isp_success = "false";
                  ctx.variables.isp_has_debt = "false";
                  ctx.variables.isp_invoices_count = "0";
                  ispResults.push({ action: "consultar_cpf", success: false, data: `CPF ${cpfRaw} nao encontrado no sistema do provedor.` });
                }
              } catch (cpfErr: any) {
                console.error("[AutomationEngine] ISP CPF lookup error:", cpfErr.message);
                ctx.variables.isp_success = "false";
                ispResults.push({ action: "consultar_cpf", success: false, data: `Erro ao consultar CPF: ${cpfErr.message}` });
              }
            }

            for (const match of ai2viaOn ? ispSegundaViaMatches : []) {
              const invoiceId = match[1].trim();
              try {
                const copy = await ispProvider.generateSecondCopy(ispCreds, invoiceId);
                const copyLines: string[] = [];
                copyLines.push("2a VIA GERADA COM SUCESSO:");
                copyLines.push(`  Valor: R$ ${Number(copy.valor).toFixed(2)}`);
                copyLines.push(`  Vencimento: ${formatDateBR(copy.vencimento)}`);
                if (copy.linhaDigitavel) copyLines.push(`  Linha digitavel: informada no boleto`);
                if (copy.linkBoleto) {
                  copyLines.push(`  PDF do boleto: SERA ENVIADO AUTOMATICAMENTE COMO ARQUIVO SEPARADO`);
                  const svPdfs: { url: string; fileName: string; caption: string }[] = (ctx.variables.__isp_boleto_pdfs as any[]) || [];
                  svPdfs.push({
                    url: copy.linkBoleto,
                    fileName: `boleto_2via_${invoiceId}_R$${Number(copy.valor).toFixed(2)}.pdf`,
                    caption: `📄 2ª Via Boleto R$ ${Number(copy.valor).toFixed(2)} - Venc: ${formatDateBR(copy.vencimento)}`,
                  });
                  ctx.variables.__isp_boleto_pdfs = svPdfs;
                }
                if (copy.pix) {
                  copyLines.push(`  PIX: SERA ENVIADO AUTOMATICAMENTE COMO MENSAGEM SEPARADA`);
                  const svPix: string[] = (ctx.variables.__isp_pix_separate as string[]) || [];
                  svPix.push(copy.pix);
                  ctx.variables.__isp_pix_separate = svPix;
                }
                ctx.variables.isp_linha_digitavel = copy.linhaDigitavel;
                ctx.variables.isp_link_boleto = copy.linkBoleto;
                ctx.variables.isp_pix = copy.pix || "";
                ctx.variables.isp_invoice_valor = `R$ ${Number(copy.valor).toFixed(2)}`;
                ispResults.push({ action: "segunda_via", success: true, data: copyLines.join("\n") });
              } catch (svErr: any) {
                console.error("[AutomationEngine] ISP 2nd copy error:", svErr.message);
                ispResults.push({ action: "segunda_via", success: false, data: `Erro ao gerar 2a via: ${svErr.message}` });
              }
            }

            for (const match of aiUnlockOn ? ispDesbloqMatches : []) {
              const custId = match[1].trim();
              const contId = match[2].trim();
              try {
                const unlockResult = await ispProvider.trustUnlock(ispCreds, { customerId: custId, contractId: contId });
                if (unlockResult.success) {
                  ispResults.push({ action: "desbloqueio_confianca", success: true, data: `Desbloqueio de confianca realizado com sucesso! ${unlockResult.message || ""}` });
                } else {
                  ispResults.push({ action: "desbloqueio_confianca", success: false, data: `Falha no desbloqueio: ${unlockResult.message || "Erro desconhecido"}` });
                }
              } catch (unlErr: any) {
                console.error("[AutomationEngine] ISP trust unlock error:", unlErr.message);
                ispResults.push({ action: "desbloqueio_confianca", success: false, data: `Erro ao desbloquear: ${unlErr.message}` });
              }
            }

            for (const match of aiPayConfirmOn ? ispConfirmPagMatches : []) {
              const invoiceId = match[1].trim();
              const custId = match[2].trim();
              const contId = match[3].trim();
              try {
                const payResult = await ispProvider.confirmPayment(ispCreds, { invoiceId, customerId: custId, contractId: contId });
                const payLines: string[] = [];
                if (payResult.success) {
                  payLines.push("PAGAMENTO CONFIRMADO COM SUCESSO!");
                  payLines.push(`  ${payResult.message || "Pagamento registrado no sistema."}`);
                  let customerStatus = ctx.variables.isp_customer_status;
                  if (!customerStatus) {
                    try {
                      const cpfForLookup = ctx.variables.cpf;
                      if (cpfForLookup) {
                        const custLookup = await ispProvider.searchCustomerByCPF(ispCreds, cpfForLookup);
                        if (custLookup) customerStatus = custLookup.status;
                      }
                    } catch {}
                  }
                  if (aiAutoUnlockOn && (customerStatus === "suspenso" || customerStatus === "inadimplente")) {
                    try {
                      const autoUnlock = await ispProvider.trustUnlock(ispCreds, { customerId: custId, contractId: contId });
                      if (autoUnlock.success) {
                        payLines.push("  DESBLOQUEIO AUTOMATICO: Internet desbloqueada com sucesso apos confirmacao de pagamento!");
                        ctx.variables.isp_customer_status = "ativo";
                      } else {
                        payLines.push(`  Aviso: Pagamento confirmado, mas desbloqueio automatico falhou: ${autoUnlock.message || "Erro"}`);
                      }
                    } catch (autoUnlockErr: any) {
                      payLines.push(`  Aviso: Pagamento confirmado, mas erro no desbloqueio automatico: ${autoUnlockErr.message}`);
                    }
                  }
                  ispResults.push({ action: "confirmar_pagamento", success: true, data: payLines.join("\n") });
                } else {
                  ispResults.push({ action: "confirmar_pagamento", success: false, data: `Falha ao confirmar pagamento: ${payResult.message || "Erro desconhecido"}` });
                }
              } catch (payErr: any) {
                console.error("[AutomationEngine] ISP confirm payment error:", payErr.message);
                ispResults.push({ action: "confirmar_pagamento", success: false, data: `Erro ao confirmar pagamento: ${payErr.message}` });
              }
            }

            for (const match of ispPromessaMatches) {
              const custId = match[1].trim();
              const contId = match[2].trim();
              const promiseDate = match[3].trim();
              const invoiceId = match[4]?.trim() || null;
              try {
                const customerName = ctx.variables.isp_customer_nome || "Cliente";
                const customerPhone = ctx.variables.telefone || ctx.variables.phone || "";
                const customerCpf = ctx.variables.cpf || "";
                const invoiceAmount = ctx.variables.isp_invoice_valor ? ctx.variables.isp_invoice_valor.replace(/[R$s]/g, "").replace(",", ".") : null;

                const promiseLines: string[] = [];

                if (ispProvider.paymentPromise && customerCpf) {
                  const sgpResult = await ispProvider.paymentPromise(ispCreds, { cpf: customerCpf, contractId: contId });
                  if (sgpResult.success) {
                    promiseLines.push("PROMESSA DE PAGAMENTO REGISTRADA NO SGP COM SUCESSO!");
                    promiseLines.push(`  Cliente: ${customerName}`);
                    promiseLines.push(`  Contrato: ${contId}`);
                    if (sgpResult.protocolo) promiseLines.push(`  Protocolo: ${sgpResult.protocolo}`);
                    if (sgpResult.liberado) {
                      promiseLines.push("  INTERNET LIBERADA: O sistema liberou o acesso do cliente automaticamente!");
                      ctx.variables.isp_customer_status = "ativo";
                    }
                    promiseLines.push(`  ${sgpResult.message}`);
                  } else {
                    promiseLines.push("PROMESSA DE PAGAMENTO - ERRO NO SGP:");
                    promiseLines.push(`  ${sgpResult.message}`);
                    promiseLines.push("  A promessa foi registrada internamente no CRM.");
                    console.warn(`[AI-ISP] Promessa SGP falhou: ${sgpResult.message}`);
                  }
                } else {
                  promiseLines.push("PROMESSA DE PAGAMENTO REGISTRADA COM SUCESSO!");
                  promiseLines.push(`  Cliente: ${customerName}`);
                  promiseLines.push(`  Contrato: ${contId}`);
                }

                // Persistência em ispPaymentPromises removida (tabela ISP descontinuada).
                void customerPhone; void invoiceId; void invoiceAmount; void promiseDate;

                ispResults.push({ action: "promessa_pagamento", success: true, data: promiseLines.join("\n") });
              } catch (promErr: any) {
                console.error("[AutomationEngine] ISP payment promise error:", promErr.message);
                ispResults.push({ action: "promessa_pagamento", success: false, data: `Erro ao registrar promessa de pagamento: ${promErr.message}` });
              }
            }
            const aiServiceOrderOn = ispCfgForAI.aiServiceOrderEnabled !== false;
            for (const match of aiServiceOrderOn ? ispOrdemServicoMatches : []) {
              const contratoId = match[1].trim();
              const assunto = match[2].trim();
              const descricao = match[3].trim();
              try {
                if (ispProvider.openServiceOrder) {
                  const osResult = await ispProvider.openServiceOrder(ispCreds, { contractId: contratoId, assunto, descricao });
                  if (osResult.success) {
                    const osLines: string[] = [];
                    osLines.push("ORDEM DE SERVICO ABERTA COM SUCESSO!");
                    osLines.push(`  Numero da OS: ${osResult.osId}`);
                    osLines.push(`  Protocolo: ${osResult.protocolo}`);
                    if (osResult.ocorrenciaId) osLines.push(`  Ocorrencia: ${osResult.ocorrenciaId}`);
                    osLines.push(`  Assunto: ${assunto}`);
                    osLines.push(`  Descricao: ${descricao}`);
                    osLines.push("  Informe ao cliente o numero do protocolo e que a equipe tecnica entrara em contato para agendar a visita.");
                    ispResults.push({ action: "ordem_servico", success: true, data: osLines.join("\n") });
                  } else {
                    ispResults.push({ action: "ordem_servico", success: false, data: `Erro ao abrir OS: ${osResult.message}` });
                    console.warn(`[AI-ISP] Erro ao abrir OS: ${osResult.message}`);
                  }
                } else {
                  ispResults.push({ action: "ordem_servico", success: false, data: "Funcao de abertura de OS nao disponivel para este provedor." });
                }
              } catch (osErr: any) {
                console.error("[AutomationEngine] ISP service order error:", osErr.message);
                ispResults.push({ action: "ordem_servico", success: false, data: `Erro ao abrir ordem de servico: ${osErr.message}` });
              }
            }
          } catch (ispFactoryErr: any) {
            console.error("[AutomationEngine] ISP factory error:", ispFactoryErr.message);
            ispResults.push({ action: "isp_init", success: false, data: `Erro ao inicializar modulo ISP: ${ispFactoryErr.message}` });
          }

          content = content.replace(ispCpfTagRegex, "").replace(ispSegundaViaRegex, "").replace(ispDesbloqRegex, "").replace(ispConfirmPagRegex, "").replace(ispPromessaRegex, "").replace(ispOrdemServicoRegex, "").replace(/\n{3,}/g, "\n\n").trim();

          if (ispResults.length > 0) {
            const ispResultsBlock = ispResults.map(r =>
              `[RESULTADO ISP "${r.action}" (${r.success ? "sucesso" : "erro"})]\n${r.data}\n[FIM RESULTADO ISP]`
            ).join("\n\n");

            const hasBoletos = !!(ctx.variables.__isp_boleto_pdfs as any[] | undefined)?.length;
            const hasPix = !!(ctx.variables.__isp_pix_separate as string[] | undefined)?.length;
            let deliveryInstruction = "";
            if (hasBoletos && hasPix) {
              deliveryInstruction = "- O boleto e o codigo PIX serao enviados AUTOMATICAMENTE como mensagens separadas logo em seguida. NAO inclua links de boleto, linha digitavel, chave PIX ou codigo PIX na sua mensagem. Diga ao cliente que voce vai enviar o boleto e o PIX em seguida.";
            } else if (hasBoletos) {
              deliveryInstruction = "- O boleto sera enviado AUTOMATICAMENTE como mensagem separada logo em seguida. NAO inclua links de boleto ou linha digitavel na sua mensagem. Diga ao cliente que voce vai enviar o boleto em seguida.";
            } else if (hasPix) {
              deliveryInstruction = "- O codigo PIX sera enviado AUTOMATICAMENTE como mensagem separada logo em seguida. NAO inclua chave PIX ou codigo PIX na sua mensagem. Diga ao cliente que voce vai enviar o PIX em seguida.";
            } else {
              deliveryInstruction = "- Se houver link de boleto ou PIX nos dados, inclua-os na sua mensagem para que o cliente possa acessar.";
            }

            const ispFollowUpContent = `O sistema do provedor de internet (ISP/ERP) retornou os seguintes resultados:\n\n${ispResultsBlock}\n\nAgora formule uma resposta final ao cliente com base nesses dados. REGRAS IMPORTANTES:\n- Apresente as informacoes de forma clara, amigavel e organizada.\n- SOMENTE mostre boletos VENCIDOS (com dias em atraso). NAO mostre boletos que vencem no futuro.\n- Se houver boletos vencidos, informe o valor, vencimento e dias em atraso.\n${deliveryInstruction}\n- NUNCA invente um PIX, chave PIX, link de boleto ou linha digitavel.\n- NAO mencione tags internas, IDs de sistema, ou termos tecnicos como "ERP".\n- Se o resultado indicar que nao ha boletos vencidos, diga que o cliente esta em dia.\n- Se o cliente pediu promessa de pagamento e foi registrada com sucesso, confirme a data e informe que foi registrado no sistema.\n- Responda naturalmente como se voce tivesse consultado o sistema.`;

            try {
              let ispFollowUpResponse = "";
              const followUpOaiMessages = [
                { role: "system" as const, content: systemPrompt },
                ...userMessages,
                { role: "assistant" as const, content },
                { role: "user" as const, content: ispFollowUpContent },
              ];
              const ispData = await aiClient.chat.completions.create({
                model: modelToUse,
                messages: followUpOaiMessages,
                max_tokens: c.maxTokens || 2048,
                temperature: c.temperature ?? 0.7,
              });
              ispFollowUpResponse = ispData.choices?.[0]?.message?.content || "";

              if (ispFollowUpResponse) {
                ispFollowUpResponse = ispFollowUpResponse
                  .replace(/\[CONSULTAR_CPF:[^\]]+\]/gi, "")
                  .replace(/\[SEGUNDA_VIA:[^\]]+\]/gi, "")
                  .replace(/\[DESBLOQUEAR_CONFIANCA:[^\]]+\]/gi, "")
                  .replace(/\[CONFIRMAR_PAGAMENTO:[^\]]+\]/gi, "")
                  .replace(/\[PROMESSA_PAGAMENTO:[^\]]+\]/gi, "")
                  .replace(/\[ORDEM_SERVICO:[^\]]+\]/gi, "")
                  .replace(/\[CHAMAR_WEBHOOK:[^\]]+\]/gi, "")
                  .replace(/\[ENVIAR_ARQUIVO:[^\]]+\]/gi, "")
                  .replace(/\[COBRAR:[^\]]+\]/gi, "")
                  .trim();
                const followUpFinalized = /\[FINALIZADO\]/i.test(ispFollowUpResponse);
                if (followUpFinalized) {
                  ispFollowUpResponse = ispFollowUpResponse.replace(/\s*\[FINALIZADO\]\s*/gi, "").trim();
                  if (!flowFinalized) flowFinalized = true;
                }
                content = ispFollowUpResponse;
              }
            } catch (ispFollowUpErr: any) {
              console.error("[AutomationEngine] ISP AI follow-up error:", ispFollowUpErr.message);
            }
          }
        } else {
          content = content.replace(ispCpfTagRegex, "").replace(ispSegundaViaRegex, "").replace(ispDesbloqRegex, "").replace(ispConfirmPagRegex, "").replace(ispPromessaRegex, "").replace(ispOrdemServicoRegex, "").replace(/\n{3,}/g, "\n\n").trim();
        }

        const webhookTagRegex = /\[CHAMAR_WEBHOOK:([^\]]+)\]/gi;
        const webhookTagMatches = [...content.matchAll(webhookTagRegex)];
        if (webhookTagMatches.length > 0 && aiWebhooks.length > 0) {
          const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          const webhookResults: { name: string; success: boolean; data: string }[] = [];

          for (const match of webhookTagMatches) {
            const requestedName = normalize(match[1]);
            const found = aiWebhooks.find(wh => normalize(wh.name || wh.id) === requestedName)
              || aiWebhooks.find(wh => {
                const n = normalize(wh.name || wh.id);
                return n.includes(requestedName) || requestedName.includes(n);
              });

            if (found) {
              try {
                const leadData: Record<string, string> = {
                  nome: "", telefone: ctx.phone || "", email: "", empresa: "", canal: "",
                };
                if (ctx.leadId) {
                  try {
                    const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
                    if (lead) {
                      leadData.nome = lead.nome || "";
                      leadData.telefone = lead.telefone || ctx.phone || "";
                      leadData.email = lead.email || "";
                      leadData.empresa = (lead as any).empresa || "";
                      leadData.canal = (lead as any).canal || "";
                    }
                  } catch {}
                }
                const replaceVars = (tpl: string) => {
                  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
                    return leadData[key] || ctx.variables?.[key] || "";
                  });
                };

                let whUrl = replaceVars(found.url);
                let whHeaders: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
                if (found.headers) {
                  try {
                    const parsed = JSON.parse(replaceVars(found.headers));
                    whHeaders = { ...whHeaders, ...parsed };
                  } catch {}
                }

                const fetchOpts: any = { method: found.method || "GET", headers: whHeaders };
                if ((found.method === "POST" || found.method === "PUT" || found.method === "PATCH") && found.bodyTemplate) {
                  fetchOpts.body = replaceVars(found.bodyTemplate);
                }

                assertSafeOutboundUrl(whUrl); // protocolo + bloqueia rede interna/metadata (throw é capturado abaixo)

                fetchOpts.signal = AbortSignal.timeout(15000);

                const whResponse = await safeOutboundFetch(whUrl, fetchOpts);
                const whText = await whResponse.text();
                let whData: any;
                try { whData = JSON.parse(whText); } catch { whData = whText; }

                let resultStr = "";
                if (found.responseKey && typeof whData === "object" && whData !== null) {
                  const keys = found.responseKey.split(".");
                  let val: any = whData;
                  for (const k of keys) {
                    if (val && typeof val === "object") val = val[k];
                    else { val = undefined; break; }
                  }
                  resultStr = val !== undefined ? (typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)) : JSON.stringify(whData, null, 2);
                } else {
                  resultStr = typeof whData === "object" ? JSON.stringify(whData, null, 2) : String(whData);
                }

                if (resultStr.length > 4000) resultStr = resultStr.substring(0, 4000) + "...[truncado]";

                webhookResults.push({ name: found.name, success: whResponse.ok, data: resultStr });
              } catch (whErr: any) {
                console.error(`[AutomationEngine] Webhook "${found.name}" error:`, whErr.message);
                webhookResults.push({ name: found.name, success: false, data: `Erro: ${whErr.message}` });
              }
            }
          }

          content = content.replace(webhookTagRegex, "").replace(/\n{3,}/g, "\n\n").trim();

          if (webhookResults.length > 0) {
            const resultsBlock = webhookResults.map(r =>
              `[RESULTADO WEBHOOK "${r.name}" (${r.success ? "sucesso" : "erro"})]\n${r.data}\n[FIM RESULTADO]`
            ).join("\n\n");

            const followUpContent = `Os seguintes webhooks foram executados e retornaram resultados. Use esses dados para responder ao cliente de forma clara e util:\n\n${resultsBlock}\n\nAgora formule uma resposta final ao cliente com base nos dados recebidos. NAO mencione webhooks, APIs ou tags internas. Responda naturalmente como se voce tivesse a informacao.`;


            try {
              let followUpResponse = "";
              const followUpOaiMessages = [
                { role: "system" as const, content: systemPrompt },
                ...userMessages,
                { role: "assistant" as const, content },
                { role: "user" as const, content: followUpContent },
              ];
              const whData = await aiClient.chat.completions.create({
                model: modelToUse,
                messages: followUpOaiMessages,
                max_tokens: c.maxTokens || 2048,
                temperature: c.temperature ?? 0.7,
              });
              followUpResponse = whData.choices?.[0]?.message?.content || "";

              if (followUpResponse) {
                followUpResponse = followUpResponse.replace(/\[CHAMAR_WEBHOOK:[^\]]+\]/gi, "").replace(/\[ENVIAR_ARQUIVO:[^\]]+\]/gi, "").replace(/\[COBRAR:[^\]]+\]/gi, "").replace(/\[CONSULTAR_CPF:[^\]]+\]/gi, "").replace(/\[SEGUNDA_VIA:[^\]]+\]/gi, "").replace(/\[DESBLOQUEAR_CONFIANCA:[^\]]+\]/gi, "").replace(/\[CONFIRMAR_PAGAMENTO:[^\]]+\]/gi, "").replace(/\[PROMESSA_PAGAMENTO:[^\]]+\]/gi, "").replace(/\[ORDEM_SERVICO:[^\]]+\]/gi, "").trim();
                const followUpFinalized = /\[FINALIZADO\]/i.test(followUpResponse);
                if (followUpFinalized) {
                  followUpResponse = followUpResponse.replace(/\s*\[FINALIZADO\]\s*/gi, "").trim();
                  if (!flowFinalized) {
                    flowFinalized = true;
                  }
                }
                content = followUpResponse;
              }
            } catch (followUpErr: any) {
              console.error(`[AutomationEngine] AI follow-up call error:`, followUpErr.message);
            }
          }
        } else {
          content = content.replace(webhookTagRegex, "").replace(/\n{3,}/g, "\n\n").trim();
        }

        const agendarTagRegex = /\[AGENDAR_REUNIAO:([^\]:]+):([^\]:]+):([^\]]+)\]/gi;
        const agendarMatches = [...content.matchAll(agendarTagRegex)];
        if (agendarMatches.length > 0) {
          for (const agMatch of agendarMatches) {
            const dataStr = agMatch[1].trim();
            const horaStr = agMatch[2].trim();
            const tituloStr = agMatch[3].trim();
            try {
              // DÍVIDA: tabela `appointments` NÃO existe no schema (shared/schema.ts).
              // Esse bloco falha silencioso em runtime — a IA gera a tag
              // [AGENDAR_REUNIAO:...] mas NADA é persistido. Cliente pode receber
              // mensagem de "agendamento confirmado" sem registro real.
              // Fix completo exige: criar tabela appointments + migration + UI.
              // Por ora mantemos o código mas com log explícito pra detectar uso.
              console.warn(`[AutomationEngine] ⚠️ AGENDAR_REUNIAO recebido mas tabela 'appointments' não existe — agendamento NÃO foi salvo (titulo="${tituloStr}", data=${dataStr}, hora=${horaStr}, phone=${ctx.phone})`);
              // @ts-expect-error — appointments table missing in schema; see note above
              await db.insert(appointments).values({
                titulo: tituloStr,
                data: dataStr,
                hora: horaStr,
                tipo: "reuniao",
                status: "agendado",
                contato: ctx.phone || null,
                notas: `Agendado via IA - Lead: ${ctx.variables?.nome || ctx.phone || "Desconhecido"}`,
                workspaceId: ctx.workspaceId,
              });

              if (ctx.leadId) {
                try {
                  const qualStage = await db.select().from(pipelineStages)
                    .where(and(eq(pipelineStages.pipeline, "comercial"), eq(pipelineStages.key, "qualificado")))
                    .limit(1);
                  if (qualStage.length > 0) {
                    await db.update(leads).set({ status: "qualificado", pipeline: "comercial" }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
                  }
                } catch {}
              }
            } catch (agErr: any) {
              console.error(`[AutomationEngine] Failed to create appointment:`, agErr.message);
            }
          }
          content = content.replace(agendarTagRegex, "").replace(/\n{3,}/g, "\n\n").trim();
        }


        if (hasCrmCapabilities && ctx.workspaceId) {
          const hasCrmTags = /\[CRM_(PIPELINE|TAGS|PRIORIDADE|ASSIGN|SATISFACAO):/i.test(content);
          if (hasCrmTags) {
          }
          try {
            const crmPipelineMatch = content.match(/\[CRM_PIPELINE:([^\]:]+):([^\]]+)\]/i);
            if (crmPipelineMatch && c.aiCrmPipeline !== false) {
              const pipelineName = crmPipelineMatch[1].trim().toLowerCase();
              const stageKey = crmPipelineMatch[2].trim();

              if (ctx.leadId) {
                const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").trim();
                const allStages = await db.select().from(pipelineStages)
                  .where(and(eq(pipelineStages.workspaceId, ctx.workspaceId), eq(pipelineStages.pipeline, pipelineName)));
                const matchedStage = allStages.find(s => normalize(s.label) === normalize(stageKey))
                  || allStages.find(s => normalize(s.key) === normalize(stageKey))
                  || allStages.find(s => normalize(s.label).includes(normalize(stageKey)) || normalize(stageKey).includes(normalize(s.label)));

                if (matchedStage) {
                  await db.update(leads).set({ status: matchedStage.key, pipeline: pipelineName }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
                } else {
                  await db.update(leads).set({ status: stageKey, pipeline: pipelineName }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
                }

                if (ctx.conversationId) {
                  const stageLabel = matchedStage?.label || stageKey;
                  await db.update(conversations).set({ pipeline: pipelineName, pipelineEtapa: stageLabel })
                    .where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
                  try {
                    broadcastToWorkspace(ctx.workspaceId, "conversation_updated", {
                      conversationId: ctx.conversationId,
                      pipeline: pipelineName,
                      pipelineEtapa: stageLabel,
                    });
                  } catch {}
                }
              }
            }

            const crmTagsMatch = content.match(/\[CRM_TAGS:([^\]]+)\]/i);
            if (crmTagsMatch && c.aiCrmTags !== false) {
              const newTags = crmTagsMatch[1].split(",").map((t: string) => t.trim()).filter(Boolean);

              if (ctx.leadId && newTags.length > 0) {
                const currentLead = await storage.getLead(ctx.leadId, ctx.workspaceId);
                if (currentLead) {
                  const existingTags = (currentLead.tags || []) as string[];
                  const mergedTags = [...new Set([...existingTags, ...newTags])];
                  await db.update(leads).set({ tags: mergedTags }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));

                  for (const tagName of newTags) {
                    try {
                      await db.insert(leadTags).values({ nome: tagName, cor: "#7c5cbf", workspaceId: ctx.workspaceId }).onConflictDoNothing();
                    } catch {}
                  }
                }
              }

              if (ctx.conversationId && newTags.length > 0) {
                try {
                  const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
                  if (conv) {
                    const convTags = (conv.tags || []) as string[];
                    const mergedConvTags = [...new Set([...convTags, ...newTags])];
                    await db.update(conversations).set({ tags: mergedConvTags }).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
                  }
                } catch {}
              }
            }

            const crmPrioridadeMatch = content.match(/\[CRM_PRIORIDADE:(alta|media|baixa)\]/i);
            if (crmPrioridadeMatch && c.aiCrmPrioridade !== false) {
              const prioridade = crmPrioridadeMatch[1].toLowerCase();

              if (ctx.leadId) {
                await db.update(leads).set({ prioridade }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
              }
              if (ctx.conversationId) {
                await db.update(conversations).set({ prioridade }).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
              }
            }

            const crmAssignMatch = content.match(/\[CRM_ASSIGN:([^\]]+)\]/i);
            if (crmAssignMatch && c.aiCrmAtribuir !== false) {
              const assignName = crmAssignMatch[1].trim();

              if (ctx.conversationId) {
                try {
                  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
                  const wsUsers = await db.select().from(users).where(eq(users.workspaceId, ctx.workspaceId));
                  const matchedUser = wsUsers.find(u => normalize(u.nome) === normalize(assignName))
                    || wsUsers.find(u => normalize(u.nome).includes(normalize(assignName)) || normalize(assignName).includes(normalize(u.nome)));

                  if (matchedUser) {
                    await db.update(conversations).set({
                      assignedUserId: matchedUser.id,
                      assignedUserName: matchedUser.nome,
                    }).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));

                    try {
                      broadcastToWorkspace(ctx.workspaceId, "conversation_updated", {
                        conversationId: ctx.conversationId,
                        assignedUserId: matchedUser.id,
                        assignedUserName: matchedUser.nome,
                      });
                    } catch {}
                  } else {
                  }
                } catch (assignErr: any) {
                  console.error(`[AutomationEngine] CRM Assign error:`, assignErr.message);
                }
              }
            }

            const crmSatisfacaoMatch = content.match(/\[CRM_SATISFACAO:(\d):([^\]]*)\]/i);
            if (crmSatisfacaoMatch && c.aiCrmPesquisaSatisfacao !== false) {
              const nota = parseInt(crmSatisfacaoMatch[1]);
              const comentario = crmSatisfacaoMatch[2]?.trim() || "";

              try {
                const satisfacaoData: any = {
                  nota,
                  comentario,
                  telefone: ctx.phone || "",
                  leadNome: ctx.variables?.nome || ctx.phone || "Desconhecido",
                  workspaceId: ctx.workspaceId,
                  conversationId: ctx.conversationId || null,
                  createdAt: new Date(),
                };
              } catch (satErr: any) {
                console.error(`[AutomationEngine] CRM Satisfacao error:`, satErr.message);
              }
            }
          } catch (crmErr: any) {
            console.error(`[AutomationEngine] CRM actions processing error:`, crmErr.message);
          }

          if (!hasCrmTags && ctx.workspaceId && ctx.leadId) {
            const lastUserMsg = (ctx.message?.text || (ctx.message as any)?.body || ctx.variables?.last_user_message || ctx.variables?.mensagem || "").toString().toLowerCase();
            const supportKw = /\b(suporte|ajuda|problema|duvida|dúvida|erro|bug|nao funciona|não funciona|nao consigo|não consigo|reclamacao|reclamação|defeito|travou|caiu|quebrou|socorro|nao abre|não abre|parou|lento|lenta)\b/i;
            const salesKw = /\b(preco|preço|valor|quanto custa|plano|comprar|contratar|orcamento|orçamento|quero contratar|quero comprar|quanto e|quanto é)\b/i;
            const closeKw = /\b(quero fechar|vamos fechar|pode fechar|sim quero|fechado|contrato|assinar)\b/i;

            let detectedPipeline = "";
            let detectedStageLabel = "";
            let detectedTeamKey = "";
            let detectedPriority = "";

            // Bruno 2026-06-28: CRM genérico — tudo cai no trilho Comercial (os
            // trilhos suporte/vendas foram aposentados). O stageLabel é casado
            // contra as etapas universais do Comercial (Novo/Em Automação/...).
            if (supportKw.test(lastUserMsg)) {
              detectedPipeline = "comercial";
              detectedStageLabel = "Novo";
              detectedTeamKey = "comercial";
              detectedPriority = "media";
            } else if (closeKw.test(lastUserMsg)) {
              detectedPipeline = "comercial";
              detectedStageLabel = "Em Automação";
              detectedTeamKey = "comercial";
              detectedPriority = "alta";
            } else if (salesKw.test(lastUserMsg)) {
              detectedPipeline = "comercial";
              detectedStageLabel = "Novo";
              detectedTeamKey = "comercial";
              detectedPriority = "media";
            }

            if (detectedPipeline) {
              try {
                const fallbackUpdates: Record<string, any> = {};
                if (c.aiCrmPipeline !== false) {
                  const pStages = await db.select().from(pipelineStages)
                    .where(and(eq(pipelineStages.workspaceId, ctx.workspaceId), eq(pipelineStages.pipeline, detectedPipeline)));
                  const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
                  const matchStage = pStages.find(s => normalize(s.label).includes(normalize(detectedStageLabel))) || pStages[0];
                  if (matchStage) {
                    await db.update(leads).set({ status: matchStage.key, pipeline: detectedPipeline }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
                    if (ctx.conversationId) {
                      // pipelineEtapa = stageKey UNIVERSAL (não o label) — senão
                      // getPrefix() retorna null e o bloqueio do bot fura.
                      await db.update(conversations).set({ pipeline: detectedPipeline, pipelineEtapa: matchStage.key })
                        .where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
                      fallbackUpdates.pipeline = detectedPipeline;
                      fallbackUpdates.pipelineEtapa = matchStage.key;
                    }
                  }
                }
                if (c.aiCrmAtribuir !== false && detectedTeamKey) {
                  try {
                    const tTeams = await db.select({ memberUserId: teamMembers.userId })
                      .from(teams)
                      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
                      .where(and(eq(teams.workspaceId, ctx.workspaceId), eq(teams.pipelineKey, detectedTeamKey)));
                    if (tTeams.length > 0) {
                      const firstMember = await db.select({ id: users.id, nome: users.nome }).from(users)
                        .where(eq(users.id, tTeams[0].memberUserId));
                      if (firstMember.length > 0) {
                        await db.update(conversations).set({ assignedUserId: firstMember[0].id, assignedUserName: firstMember[0].nome })
                          .where(and(eq(conversations.id, ctx.conversationId!), eq(conversations.workspaceId, ctx.workspaceId)));
                        fallbackUpdates.assignedUserId = firstMember[0].id;
                        fallbackUpdates.assignedUserName = firstMember[0].nome;
                      }
                    }
                  } catch {}
                }
                if (c.aiCrmPrioridade !== false && detectedPriority) {
                  await db.update(leads).set({ prioridade: detectedPriority }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
                  if (ctx.conversationId) {
                    await db.update(conversations).set({ prioridade: detectedPriority }).where(and(eq(conversations.id, ctx.conversationId), eq(conversations.workspaceId, ctx.workspaceId)));
                    fallbackUpdates.prioridade = detectedPriority;
                  }
                }
                if (ctx.conversationId && Object.keys(fallbackUpdates).length > 0) {
                  try {
                    broadcastToWorkspace(ctx.workspaceId, "conversation_updated", {
                      conversationId: ctx.conversationId,
                      ...fallbackUpdates,
                    });
                  } catch {}
                }
              } catch (fallbackErr: any) {
                console.error(`[AutomationEngine] CRM FALLBACK error:`, fallbackErr.message);
              }
            }
          }

          content = content
            .replace(/\s*\[CRM_PIPELINE:[^\]]+\]/gi, "")
            .replace(/\s*\[CRM_TAGS:[^\]]+\]/gi, "")
            .replace(/\s*\[CRM_PRIORIDADE:[^\]]+\]/gi, "")
            .replace(/\s*\[CRM_ASSIGN:[^\]]+\]/gi, "")
            .replace(/\s*\[CRM_SATISFACAO:[^\]]+\]/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        }

        ctx.variables[saveTo] = content;
        ctx.variables.last_ai_response = content;
        ctx.variables.__flow_finalized = flowFinalized;

        const replyDelay = c.replyDelay !== undefined && c.replyDelay !== null ? Number(c.replyDelay) : 10;
        const replyDelayUnit = c.replyDelayUnit || "seconds";
        const delayMs = replyDelay > 0 ? (replyDelayUnit === "minutes" ? replyDelay * 60 * 1000 : replyDelay * 1000) : 0;
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, 120000)));
        }

        const pixSeparateMessages = ctx.variables.__pix_separate_messages as string[] | undefined;
        if (pixSeparateMessages && pixSeparateMessages.length > 0 && content) {
          content = content
            .replace(/00020126[\w\d.@]+/g, "")
            .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "")
            .replace(/chave\s*(?:pix|do\s*pix)[^\n.!?]*/gi, "")
            .replace(/c[oó]digo\s*(?:pix|do\s*pix|copia\s*e?\s*cola)[^\n.!?]*/gi, "")
            .replace(/copia\s*e?\s*cola[^\n.!?]*/gi, "")
            .replace(/cole?\s+(?:no|pelo)\s+(?:app|aplicativo)\s+do\s+(?:seu\s+)?banco[^\n.!?]*/gi, "")
            .replace(/copie\s+(?:o\s+)?c[oó]digo[^\n.!?]*/gi, "")
            .replace(/pix\s*(?:copia\s*e?\s*cola|gerado|pronto|abaixo|acima|a\s*seguir)[^\n.!?]*/gi, "")
            .replace(/(?:segue|aqui\s*est[aá]|envio|enviando)\s+(?:o\s+)?(?:c[oó]digo|chave)\s*(?:pix|do\s*pix)[^\n.!?]*/gi, "")
            .replace(/\*PIX[^*]*\*/g, "")
            .replace(/\n{2,}/g, "\n")
            .trim();

          if (!content || content.length < 5) {
            const clientName = ctx.variables?.nome || "";
            content = clientName
              ? `${clientName}, vou enviar o pagamento agora! 😊`
              : `Vou enviar o pagamento agora! 😊`;
          }
        }

        const ispBoletoWillBeSent = !!(ctx.variables.__isp_boleto_pdfs as any[] | undefined)?.length;
        const ispPixWillBeSent = !!(ctx.variables.__isp_pix_separate as string[] | undefined)?.length;
        if ((ispBoletoWillBeSent || ispPixWillBeSent) && content) {
          content = content
            .replace(/https?:\/\/[^\s)]+\.pdf[^\s)']*/gi, "")
            .replace(/https?:\/\/[^\s)]*boleto[^\s)']*/gi, "")
            .replace(/https?:\/\/[^\s)]*titulo[^\s)']*/gi, "")
            .replace(/linha\s*digit[aá]vel[:\s]*[\d.\s]+/gi, "")
            .replace(/00020126[\w\d.@]+/g, "")
            .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "")
            .replace(/chave\s*(?:pix|do\s*pix)[^\n.!?]*/gi, "")
            .replace(/c[oó]digo\s*(?:pix|do\s*pix|copia\s*e?\s*cola)[^\n.!?]*/gi, "")
            .replace(/copia\s*e?\s*cola[^\n.!?]*/gi, "")
            .replace(/cole?\s+(?:no|pelo)\s+(?:app|aplicativo)\s+do\s+(?:seu\s+)?banco[^\n.!?]*/gi, "")
            .replace(/copie\s+(?:o\s+)?c[oó]digo[^\n.!?]*/gi, "")
            .replace(/pix\s*(?:copia\s*e?\s*cola|gerado|pronto|abaixo|acima|a\s*seguir)[^\n.!?]*/gi, "")
            .replace(/(?:segue|aqui\s*est[aá]|envio|enviando)\s+(?:o\s+)?(?:c[oó]digo|chave)\s*(?:pix|do\s*pix)[^\n.!?]*/gi, "")
            .replace(/\*PIX[^*]*\*/g, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        }

        let messageSent = false;
        console.log(`[AutomationEngine] Sending reply: content_len=${content.length}, phone=${ctx.phone || "NONE"}, channel=${(ctx as any).channel || "NONE"}`);
        if (content && ctx.phone) {
          // Bruno 2026-07-16: a IA pode quebrar a resposta em BOLHAS separadas usando
          // o marcador [MSG] entre elas — cada parte vira uma mensagem, com um respiro
          // no meio (lê como gente conversando, não como textão). Antes só o PIX do ISP
          // tinha isso (hardcoded); agora é genérico pra qualquer agente. SEM o marcador
          // nada muda: continua UMA mensagem só, como sempre.
          const bolhas = content
            .split(/\s*\[MSG\]\s*/gi)
            .map((p) => p.trim())
            .filter(Boolean)
            .slice(0, AI_MAX_BOLHAS);
          if (bolhas.length > 1) {
            for (let i = 0; i < bolhas.length; i++) {
              const r = await sendAutomationMessage(ctx, bolhas[i]);
              if (i === 0) messageSent = r.sent;
              if (i < bolhas.length - 1) await new Promise((res) => setTimeout(res, AI_BOLHA_DELAY_MS));
            }
            console.log(`[AutomationEngine] Reply enviada em ${bolhas.length} bolhas`);
          } else {
            const sendResult = await sendAutomationMessage(ctx, bolhas[0] || content);
            messageSent = sendResult.sent;
            console.log(`[AutomationEngine] Send result: sent=${sendResult.sent}, error=${sendResult.error || "none"}`);
          }
        } else {
          console.warn(`[AutomationEngine] SKIP send: content=${!!content}, phone=${!!ctx.phone}`);
        }
        if (pixSeparateMessages && pixSeparateMessages.length > 0 && ctx.phone) {
          await new Promise(resolve => setTimeout(resolve, 3500));
          for (let i = 0; i < pixSeparateMessages.length; i++) {
            try {
              const pixMsg = pixSeparateMessages[i];
              const pixSendResult = await sendAutomationMessage(ctx, pixMsg);
              if (i < pixSeparateMessages.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (pixSendErr: any) {
              console.error(`[AutomationEngine] PIX separate message send error:`, pixSendErr.message);
            }
          }
          delete ctx.variables.__pix_separate_messages;
        }

        const ispBoletoPdfs = ctx.variables.__isp_boleto_pdfs as { url: string; fileName: string; caption: string }[] | undefined;
        if (ispBoletoPdfs && ispBoletoPdfs.length > 0 && ctx.phone) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          for (let i = 0; i < ispBoletoPdfs.length; i++) {
            try {
              const boleto = ispBoletoPdfs[i];
              const docResult = await sendAutomationDocument(ctx, boleto.url, boleto.fileName, boleto.caption);
              if (!docResult.sent) {
                console.warn(`[AI-ISP] PDF download falhou, enviando como link: ${boleto.url}`);
                await sendAutomationMessage(ctx, `${boleto.caption}\n\n📎 Acesse seu boleto aqui:\n${boleto.url}`);
              }
              if (i < ispBoletoPdfs.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (boletoPdfErr: any) {
              console.error(`[AI-ISP] Erro ao enviar boleto:`, boletoPdfErr.message);
              try {
                await sendAutomationMessage(ctx, `${ispBoletoPdfs[i].caption}\n\n📎 Acesse seu boleto aqui:\n${ispBoletoPdfs[i].url}`);
              } catch (_) { /* last-resort text fallback — nothing more to try */ }
            }
          }
          delete ctx.variables.__isp_boleto_pdfs;
        }

        const ispPixSeparate = ctx.variables.__isp_pix_separate as string[] | undefined;
        if (ispPixSeparate && ispPixSeparate.length > 0 && ctx.phone) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          for (let i = 0; i < ispPixSeparate.length; i++) {
            try {
              const pixCode = ispPixSeparate[i];
              await sendAutomationMessage(ctx, `💰 *PIX Copia e Cola*\n\nCopie o codigo abaixo e cole no app do seu banco:`);
              await new Promise(resolve => setTimeout(resolve, 1500));
              await sendAutomationMessage(ctx, pixCode);
              if (i < ispPixSeparate.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (ispPixErr: any) {
              console.error(`[AI-ISP] Erro ao enviar PIX separado:`, ispPixErr.message);
            }
          }
          delete ctx.variables.__isp_pix_separate;
        }

        if (filesToSend.length > 0 && ctx.phone) {
          for (const fileToSend of filesToSend) {
            try {
              if (fileToSend.fileType === "pdf") {
                const caption = fileToSend.name || fileToSend.originalName || "Documento";
                const sendRes = await sendAutomationDocument(ctx, fileToSend.url, fileToSend.originalName || "documento.pdf", caption);
              } else {
                const caption = fileToSend.name || "";
                const sendRes = await sendAutomationImage(ctx, fileToSend.url, caption);
              }
            } catch (fileSendErr: any) {
              console.error(`[AutomationEngine] AI file send error for "${fileToSend.name}":`, fileSendErr.message);
            }
          }
        }

        let exitNextNodeId: string | undefined;
        if (flowFinalized && matchedExitTriggerIndex >= 0 && exitTriggers[matchedExitTriggerIndex]) {
          const targetLabel = exitTriggers[matchedExitTriggerIndex].targetNodeLabel;
          if (targetLabel) {
            const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            const normalizedTarget = normalize(targetLabel);
            const targetNode = nodesArr.find(n => normalize(n.label) === normalizedTarget);
            if (targetNode) {
              exitNextNodeId = targetNode.id;
            } else {
            }
          }
          if (!exitNextNodeId) {
            exitNextNodeId = (node.next || [])[0];
          }
        }

        const hasNextNode = node.next && node.next.length > 0;
        if (!hasNextNode && !flowFinalized && !exitNextNodeId) {
          return {
            pauseExecution: true,
            pauseType: "ai_conversation" as any,
            pauseData: { timeoutMinutes: 60 },
            output: {
              success: true,
              prompt_slug: c.prompt_slug,
              media_type: mediaType,
              audio_transcribed: !!transcript,
              pdf_chars_extracted: documentText?.length || 0,
              model_used: modelToUse,
              tokens_used: tokensUsed,
              response_preview: content.substring(0, 100),
              message_sent: messageSent,
              ai_loop: true,
            },
            status: "paused",
          };
        }

        return {
          output: {
            success: true,
            prompt_slug: c.prompt_slug,
            media_type: mediaType,
            audio_transcribed: !!transcript,
            pdf_chars_extracted: documentText?.length || 0,
            model_used: modelToUse,
            tokens_used: tokensUsed,
            response_preview: content.substring(0, 100),
            message_sent: messageSent,
          },
          status: "success",
          ...(exitNextNodeId ? { nextNodeId: exitNextNodeId } : {}),
        };
      } catch (err: any) {
        console.error(`[AutomationEngine] AI node error:`, err.message, err.stack?.substring(0, 200));
        ctx.variables[saveTo] = "";
        ctx.variables.last_ai_response = "";
        return {
          output: { success: false, error: err.message },
          status: "success",
        };
      }
    }

    case "assign_agent": {
      const strategy = c.strategy || "round_robin";
      const agentId = c.agent_id || c.agentName;

      if (!ctx.leadId) {
        return { output: { success: false, error: "leadId ausente" }, status: "success" };
      }

      try {
        const allUsers = await db.select().from(users)
          .where(and(eq(users.status, "ACTIVE"), eq(users.workspaceId, ctx.workspaceId)));
        if (allUsers.length === 0) {
          return { output: { success: false, warning: "Nenhum atendente ativo encontrado", strategy }, status: "success" };
        }

        let chosen: typeof allUsers[0] | undefined;

        if ((strategy === "specific" || strategy === "direct") && agentId) {
          const agentIdNum = typeof agentId === "number" ? agentId : parseInt(agentId);
          if (!isNaN(agentIdNum)) {
            chosen = allUsers.find(u => u.id === agentIdNum);
          } else {
            chosen = allUsers.find(u => u.nome.toLowerCase().includes(String(agentId).toLowerCase()));
          }
        } else if (strategy === "round_robin") {
          const [lastAssigned] = await db.select({ owner: leads.owner })
            .from(leads)
            .where(and(isNotNull(leads.owner), eq(leads.workspaceId, ctx.workspaceId)))
            .orderBy(sql`${leads.createdAt} DESC`)
            .limit(1);
          const lastOwnerName = lastAssigned?.owner;
          const lastIdx = lastOwnerName ? allUsers.findIndex(u => u.nome === lastOwnerName) : -1;
          const nextIdx = (lastIdx + 1) % allUsers.length;
          chosen = allUsers[nextIdx];
        } else if (strategy === "least_busy") {
          const busyCounts = await db.select({
            owner: leads.owner,
            total: sql<number>`count(*)::int`,
          }).from(leads)
            .where(and(isNotNull(leads.owner), eq(leads.workspaceId, ctx.workspaceId), ne(leads.status, "GANHO"), ne(leads.status, "PERDIDO")))
            .groupBy(leads.owner);
          const countMap = new Map(busyCounts.map(b => [b.owner, b.total]));
          let minCount = Infinity;
          for (const u of allUsers) {
            const count = countMap.get(u.nome) || 0;
            if (count < minCount) { minCount = count; chosen = u; }
          }
        } else {
          chosen = allUsers[Math.floor(Math.random() * allUsers.length)];
        }

        if (chosen) {
          await db.update(leads).set({ owner: chosen.nome }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
          return {
            output: { success: true, strategy, agent_id: chosen.id, agent_name: chosen.nome },
            status: "success",
          };
        }
        return { output: { success: false, warning: "Nenhum atendente selecionado", strategy }, status: "success" };
      } catch (err: any) {
        return { output: { success: false, error: err.message, strategy }, status: "success" };
      }
    }

    case "delay": {
      const duration = c.value || c.duration || 5;
      const unit = c.unit || "minutes";
      const msMap: Record<string, number> = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };
      const totalMs = duration * (msMap[unit] || 60000);
      const resumeAt = new Date(Date.now() + totalMs);

      if (ctx.phone && ctx.leadId && totalMs > 10000) {
        return {
          output: { success: true, resume_at: resumeAt.toISOString(), duration, unit },
          status: "paused",
          pauseExecution: true,
          pauseType: "wait",
          pauseData: { expiresAt: resumeAt },
        };
      }

      return { output: { waited: `${duration} ${unit}` }, status: "success" };
    }

    case "send_message": {
      let msgContent = c.content || "";
      let leadData: Record<string, any> | null = null;
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) leadData = { nome: lead.nome, name: lead.nome, empresa: lead.empresa, telefone: lead.telefone, phone: lead.telefone, canal: lead.canal, valor: lead.valor, value: lead.valor, email: lead.email, status: lead.status };
        } catch {}
      }
      msgContent = msgContent.replace(/\{\{([\w.]+)\}\}/g, (_: string, path: string) => {
        if (path.startsWith("variables.")) {
          const varKey = path.substring(10);
          return ctx.variables[varKey] != null ? String(ctx.variables[varKey]) : "";
        }
        if (path.startsWith("lead.")) {
          const leadKey = path.substring(5);
          return leadData?.[leadKey] != null ? String(leadData[leadKey]) : "";
        }
        if (leadData?.[path] != null) return String(leadData[path]);
        if (ctx.variables[path] != null) return String(ctx.variables[path]);
        return "";
      });

      if (ctx.phone && msgContent.trim()) {
        const sendResult = await sendAutomationMessage(ctx, msgContent);
        return { output: { sent: sendResult.sent, preview: msgContent.substring(0, 80), error: sendResult.error }, status: "success" };
      }
      return { output: { sent: false, preview: msgContent.substring(0, 80), error: "Sem telefone para envio real" }, status: "success" };
    }

    case "send_image": {
      let imageUrl = c.imageUrl || "";
      let caption = c.caption || "";
      let leadData: Record<string, any> | null = null;
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) leadData = { nome: lead.nome, name: lead.nome, empresa: lead.empresa, telefone: lead.telefone, phone: lead.telefone, canal: lead.canal, valor: lead.valor, value: lead.valor, email: lead.email, status: lead.status };
        } catch {}
      }
      const replaceVars = (text: string) => text.replace(/\{\{([\w.]+)\}\}/g, (_: string, path: string) => {
        if (path.startsWith("variables.")) return ctx.variables[path.substring(10)] != null ? String(ctx.variables[path.substring(10)]) : "";
        if (path.startsWith("lead.")) return leadData?.[path.substring(5)] != null ? String(leadData[path.substring(5)]) : "";
        if (leadData?.[path] != null) return String(leadData[path]);
        if (ctx.variables[path] != null) return String(ctx.variables[path]);
        return "";
      });
      imageUrl = replaceVars(imageUrl);
      caption = replaceVars(caption);

      if (!imageUrl) {
        return { output: { sent: false, error: "URL da imagem nao configurada" }, status: "success" };
      }
      if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
        console.error("[AutomationEngine] send_image: URL invalida (nao e HTTP/HTTPS):", imageUrl.substring(0, 80));
        return { output: { sent: false, imageUrl: imageUrl.substring(0, 80), error: "URL invalida. A imagem precisa ser uma URL publica (https://...). URLs locais ou sandbox nao sao suportadas pelo WhatsApp." }, status: "success" };
      }
      if (ctx.phone) {
        const isPdf = c.fileType === "pdf" || imageUrl.toLowerCase().endsWith(".pdf");
        let sendResult: { sent: boolean; error?: string };
        if (isPdf) {
          sendResult = await sendAutomationDocument(ctx, imageUrl, c.fileName || "documento.pdf", caption || undefined);
        } else {
          sendResult = await sendAutomationImage(ctx, imageUrl, caption || undefined);
        }
        if (!sendResult.sent) {
          console.error(`[AutomationEngine] send_${isPdf ? "document" : "image"} falhou:`, sendResult.error, "url:", imageUrl.substring(0, 80));
        }
        return { output: { sent: sendResult.sent, imageUrl, fileType: isPdf ? "pdf" : "image", caption: caption.substring(0, 80), error: sendResult.error }, status: "success" };
      }
      return { output: { sent: false, imageUrl, caption: caption.substring(0, 80), error: "Sem telefone para envio" }, status: "success" };
    }

    case "tag_lead": {
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) {
            const currentTags = lead.tags || [];
            const newTags = c.tags || [];
            let updatedTags: string[];
            if (c.action === "remove") {
              updatedTags = currentTags.filter((t: string) => !newTags.includes(t));
            } else if (c.action === "replace") {
              updatedTags = newTags;
            } else {
              updatedTags = [...new Set([...currentTags, ...newTags])];
            }
            await db.update(leads).set({ tags: updatedTags }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
            return { output: { success: true, tags: updatedTags, action: c.action || "add" }, status: "success" };
          }
        } catch (err: any) {
          return { output: { success: false, error: err.message }, status: "success" };
        }
      }
      return { output: { tags: c.tags, action: c.action || "add" }, status: "success" };
    }

    case "update_lead": {
      if (ctx.leadId && c.pipeline && c.stage) {
        try {
          const stageId = Number(c.stage);
          const [stageRow] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.workspaceId, ctx.workspaceId))).limit(1);
          if (stageRow) {
            await db.update(leads).set({
              pipeline: stageRow.pipeline,
              status: stageRow.key,
            }).where(and(eq(leads.id, ctx.leadId), eq(leads.workspaceId, ctx.workspaceId)));
            return { output: { success: true, pipeline: c.pipelineLabel || stageRow.pipeline, stage: c.stageLabel || stageRow.label }, status: "success" };
          }
          return { output: { success: false, error: "Etapa nao encontrada" }, status: "success" };
        } catch (err: any) {
          return { output: { success: false, error: err.message }, status: "success" };
        }
      }
      return { output: { pipeline: c.pipeline, stage: c.stage, configured: false }, status: "success" };
    }

    case "webhook": {
      const whUrl = c.url || "";
      const whMethod = (c.method || "POST").toUpperCase();

      if (!whUrl) {
        return { output: { success: false, error: "URL do webhook nao configurada" }, status: "success" };
      }

      try {
        assertSafeOutboundUrl(whUrl); // valida protocolo + bloqueia rede interna/metadata
      } catch (e: any) {
        return { output: { success: false, error: e?.message || `URL invalida: ${whUrl}` }, status: "success" };
      }

      let leadData: Record<string, any> = {};
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) leadData = { nome: lead.nome, empresa: lead.empresa, telefone: lead.telefone, email: lead.email, valor: lead.valor, status: lead.status, canal: lead.canal };
        } catch {}
      }

      const replaceVarsWh = (tpl: string) => tpl.replace(/\{\{([\w.]+)\}\}/g, (_: string, path: string) => {
        if (path.startsWith("lead.")) return (leadData[path.substring(5)] ?? "") as string;
        if (path.startsWith("variables.")) return String(ctx.variables[path.substring(10)] ?? "");
        return String(leadData[path] ?? ctx.variables[path] ?? "");
      });

      let whHeaders: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (c.headers) {
        try {
          const rawHeaders = typeof c.headers === "string" ? c.headers : JSON.stringify(c.headers);
          const parsed = JSON.parse(replaceVarsWh(rawHeaders));
          whHeaders = { ...whHeaders, ...parsed };
        } catch {}
      }

      let whPayload: string | undefined;
      if (c.payload && (whMethod === "POST" || whMethod === "PUT" || whMethod === "PATCH")) {
        const rawPayload = typeof c.payload === "string" ? c.payload : JSON.stringify(c.payload);
        whPayload = replaceVarsWh(rawPayload);
      } else if (whMethod === "POST" || whMethod === "PUT" || whMethod === "PATCH") {
        whPayload = JSON.stringify({
          event: "automation_webhook",
          lead_id: ctx.leadId,
          workspace_id: ctx.workspaceId,
          lead: leadData,
          variables: ctx.variables,
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const fetchOpts: any = { method: whMethod, headers: whHeaders, signal: AbortSignal.timeout(15000) };
        if (whPayload) fetchOpts.body = whPayload;

        const resp = await safeOutboundFetch(whUrl, fetchOpts);
        const respText = await resp.text();
        let respData: any;
        try { respData = JSON.parse(respText); } catch { respData = respText; }

        if (respData && typeof respData === "object" && respData.variables) {
          Object.assign(ctx.variables, respData.variables);
        }

        return {
          output: {
            success: resp.ok,
            url: whUrl,
            method: whMethod,
            statusCode: resp.status,
            response_preview: (typeof respData === "string" ? respData : JSON.stringify(respData)).substring(0, 200),
          },
          status: "success",
        };
      } catch (err: any) {
        console.error(`[AutomationEngine] webhook error:`, err.message);
        return { output: { success: false, url: whUrl, method: whMethod, error: err.message }, status: "success" };
      }
    }

    case "end":
      return { output: { finished: true }, status: "success" };

    case "lista_opcoes": {
      const opts = c.options || [];
      const listTitle = c.title || "Escolha uma opcao";
      const listFooter = c.footer || "";
      const listButtonLabel = c.buttonText || c.button_label || c.buttonLabel || c.button_text || "Ver opcoes";
      const listStyle = c.list_style || "list";

      let listSent = false;
      let listSentViaButtons = false;
      const displayText = `${listTitle}\n\n${opts.map((o: any, i: number) => `${i + 1}. *${o.label || o.title}*${o.description ? " - " + o.description : ""}`).join("\n")}`;

      if (ctx.phone && opts.length > 0) {
        try {
          const sendResult = await sendAutomationMessage(ctx, displayText);
          if (sendResult.sent) {
            listSent = true;
          } else {
            console.error("[AutomationEngine] Envio lista_opcoes FALHOU:", sendResult.error);
          }
        } catch (err: any) {
          console.error("[AutomationEngine] lista_opcoes send error:", err.message);
        }
      }

      if (!listSent && ctx.phone) {
        return {
          output: {
            title: listTitle,
            options_count: opts.length,
            list_style: listStyle,
            status: "error",
            message: "Falha ao enviar lista de opcoes via WhatsApp",
          },
          status: "error",
        };
      }

      const isBlocking = c.blocking !== false;

      if (isBlocking) {
        return {
          output: {
            title: listTitle,
            options_count: opts.length,
            list_style: listStyle,
            status: "waiting_input",
            message: "Lista enviada — aguardando resposta do cliente",
          },
          status: "paused",
          pauseExecution: true,
          pauseType: "option_list",
          pauseData: { options: opts, timeoutMinutes: c.timeout_minutes || 120 },
        };
      } else {
        return {
          output: {
            title: listTitle,
            options_count: opts.length,
            list_style: listStyle,
            status: "sent_optional",
            message: "Botoes enviados como atalho (modo opcional)",
            blocking: false,
          },
          status: "success",
        };
      }
    }


    case "stripe_payment": {
      const description = c.description || "Pagamento";
      const amount = c.amount || 0;
      const currency = c.currency || "brl";
      const rawSaveTo = c.save_link_to || "";
      const saveLinkTo = rawSaveTo.replace(/^variables\./, "");
      const stripeKey = process.env.STRIPE_SECRET_KEY;

      if (!stripeKey) {
        return { output: { success: false, error: "STRIPE_SECRET_KEY nao configurada" }, status: "success" };
      }
      if (!amount || amount <= 0) {
        return { output: { success: false, error: "Valor invalido" }, status: "success" };
      }

      try {
        const params = new URLSearchParams();
        params.append("line_items[0][price_data][currency]", currency);
        params.append("line_items[0][price_data][product_data][name]", description);
        params.append("line_items[0][price_data][unit_amount]", String(Math.round(amount)));
        params.append("line_items[0][quantity]", "1");
        if (ctx.leadId) params.append("metadata[lead_id]", String(ctx.leadId));
        params.append("metadata[workspace_id]", ctx.workspaceId);

        const resp = await fetch("https://api.stripe.com/v1/payment_links", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
          signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          return { output: { success: false, error: `Stripe HTTP ${resp.status}`, detail: errBody.substring(0, 200) }, status: "success" };
        }

        const data = await resp.json();
        const paymentUrl = data.url || "";
        ctx.variables.last_payment_link = paymentUrl;
        if (saveLinkTo) ctx.variables[saveLinkTo] = paymentUrl;

        return {
          output: { success: true, payment_link: paymentUrl, amount, currency },
          status: "success",
          nextNodeId: node.next?.[0] || (node as any).nextSuccess,
        };
      } catch (err: any) {
        return {
          output: { success: false, error: err.message },
          status: "success",
          nextNodeId: (node as any).nextError,
        };
      }
    }

    case "set_variable": {
      const varName = c.variable_name || "";
      const varValue = c.variable_value || "";
      const varType = c.variable_type || "text";
      const varScope = c.variable_scope || "session";

      if (!varName) {
        return { output: { success: false, error: "Nome da variavel nao informado" }, status: "success" };
      }

      let resolvedValue = varValue;
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) {
            const leadData: Record<string, any> = { nome: lead.nome, empresa: lead.empresa, telefone: lead.telefone, email: lead.email, valor: lead.valor, status: lead.status, canal: lead.canal };
            resolvedValue = resolvedValue.replace(/\{\{([\w.]+)\}\}/g, (_: string, path: string) => {
              if (path.startsWith("lead.")) return leadData[path.substring(5)] ?? "";
              if (path.startsWith("variables.")) return ctx.variables[path.substring(10)] ?? "";
              return leadData[path] ?? ctx.variables[path] ?? "";
            });
          }
        } catch {}
      }

      let finalValue: any = resolvedValue;
      if (varType === "number") finalValue = Number(resolvedValue) || 0;
      else if (varType === "boolean") finalValue = resolvedValue === "true" || resolvedValue === "1";

      ctx.variables[varName] = finalValue;

      if (varScope === "lead" && ctx.leadId) {
        try {
          await db.insert(automationVariables).values({
            nome: varName,
            valor: String(finalValue),
            tipo: varType,
            escopo: "lead",
            leadId: ctx.leadId,
            workspaceId: ctx.workspaceId,
          }).onConflictDoNothing();
          await db.update(automationVariables).set({ valor: String(finalValue), updatedAt: new Date() })
            .where(and(eq(automationVariables.nome, varName), eq(automationVariables.leadId, ctx.leadId)));
        } catch (e: any) {
          console.error("[AutomationEngine] set_variable persist error:", e.message);
        }
      } else if (varScope === "global") {
        try {
          await db.insert(automationVariables).values({
            nome: varName,
            valor: String(finalValue),
            tipo: varType,
            escopo: "global",
            workspaceId: ctx.workspaceId,
          }).onConflictDoNothing();
          await db.update(automationVariables).set({ valor: String(finalValue), updatedAt: new Date() })
            .where(and(eq(automationVariables.nome, varName), eq(automationVariables.escopo, "global"), eq(automationVariables.workspaceId, ctx.workspaceId)));
        } catch (e: any) {
          console.error("[AutomationEngine] set_variable global persist error:", e.message);
        }
      }

      return { output: { success: true, variable: varName, value: finalValue, scope: varScope }, status: "success" };
    }

    case "advanced_condition": {
      const conditionGroups: { logic: string; conditions: { field: string; operator: string; value: string }[] }[] = c.condition_groups || [];
      const groupLogic = c.group_logic || "AND";

      if (conditionGroups.length === 0) {
        return { output: { result: true, reason: "Nenhuma condicao configurada" }, status: "success", nextNodeId: node.nextTrue || (node.next || [])[0] };
      }

      const groupResults: boolean[] = [];
      for (const group of conditionGroups) {
        const innerLogic = group.logic || "AND";
        const condResults: boolean[] = [];
        for (const cond of (group.conditions || [])) {
          const resolved = await resolveFieldValue(cond.field, ctx);
          const result = evaluateCondition(resolved, cond.operator, cond.value);
          condResults.push(result);
        }
        const groupResult = innerLogic === "OR" ? condResults.some(Boolean) : condResults.every(Boolean);
        groupResults.push(groupResult);
      }

      const finalResult = groupLogic === "OR" ? groupResults.some(Boolean) : groupResults.every(Boolean);
      const nextNodeId = finalResult ? (node.nextTrue || (node.next || [])[0]) : (node.nextFalse || undefined);

      return { output: { result: finalResult, group_logic: groupLogic, group_results: groupResults }, status: "success", nextNodeId };
    }

    case "split_ia": {
      const categories: string[] = c.categories || ["vendas", "suporte", "financeiro"];
      const classifyPrompt = c.classify_prompt || `Voce e um classificador de intencao. Classifique a mensagem do cliente em uma UNICA das seguintes categorias: [${categories.join(", ")}]. Responda APENAS com o nome da categoria, sem explicacao.`;
      const messageText = ctx.message?.text || ctx.variables?.last_message || "";

      if (!messageText) {
        return { output: { success: false, error: "Nenhuma mensagem para classificar" }, status: "success" };
      }

      const nodeOpenaiKey = c.openaiApiKey || "";
      const selectedModel = c.model || "gpt-4o-mini";

      let classifyCandidates: Array<{ apiKey: string; baseURL: string; source: string }> = [];
      if (nodeOpenaiKey) {
        classifyCandidates.push({ apiKey: nodeOpenaiKey, baseURL: "https://api.openai.com/v1", source: "node" });
      }
      const centralClassifyCandidates = await resolveOpenAIKeys(ctx.workspaceId);
      classifyCandidates = classifyCandidates.concat(centralClassifyCandidates);

      if (classifyCandidates.length === 0) {
        return { output: { success: false, error: "API Key nao configurada para classificacao IA" }, status: "success" };
      }

      try {
        let category = "";
        const client = getOpenAIClient({ apiKey: classifyCandidates[0].apiKey, baseURL: classifyCandidates[0].baseURL });
        const data = await client.chat.completions.create({
          model: selectedModel,
          messages: [
            { role: "system", content: classifyPrompt },
            { role: "user", content: `Mensagem: "${messageText}"` },
          ],
          max_tokens: 50,
          temperature: 0.1,
        });
        category = (data.choices?.[0]?.message?.content || "").trim().toLowerCase();

        const matchedCategory = categories.find(cat => category.includes(cat.toLowerCase())) || categories[0];
        ctx.variables.ia_classification = matchedCategory;
        const nextNodeId = node.nextOptions?.[matchedCategory] || (node.next || [])[0] || undefined;

        return { output: { success: true, category: matchedCategory, raw_response: category }, status: "success", nextNodeId };
      } catch (err: any) {
        console.error("[AutomationEngine] split_ia error:", err.message);
        return { output: { success: false, error: err.message }, status: "success" };
      }
    }

    case "wait_event": {
      const eventType = c.event_type || c.eventType || "client_reply";
      const timeoutMinutes = c.timeout_minutes || c.timeout || c.timeoutMinutes || 60;


      return {
        output: {
          event_type: eventType,
          timeout_minutes: timeoutMinutes,
          status: "waiting",
          message: `Aguardando evento: ${eventType}`,
        },
        status: "paused",
        pauseExecution: true,
        pauseType: "wait",
        pauseData: {
          eventType,
          expiresAt: new Date(Date.now() + timeoutMinutes * 60000),
        },
      };
    }

    case "loop": {
      const maxAttempts = c.max_attempts || 5;
      const intervalValue = c.interval_value || 1;
      const intervalUnit = c.interval_unit || "hours";
      const stopField = c.stop_field || "";
      const stopOperator = c.stop_operator || "eq";
      const stopValue = c.stop_value || "true";

      const loopCount = (ctx.variables.__loop_count || 0) + 1;
      ctx.variables.__loop_count = loopCount;

      if (loopCount > maxAttempts) {
        ctx.variables.__loop_count = 0;
        return {
          output: { success: true, loop_ended: true, reason: "max_attempts", attempts: loopCount - 1 },
          status: "success",
          nextNodeId: node.nextFalse || (node.next || [])[0],
        };
      }

      if (stopField) {
        const resolved = await resolveFieldValue(stopField, ctx);
        const shouldStop = evaluateCondition(resolved, stopOperator, stopValue);
        if (shouldStop) {
          ctx.variables.__loop_count = 0;
          return {
            output: { success: true, loop_ended: true, reason: "condition_met", attempts: loopCount },
            status: "success",
            nextNodeId: node.nextTrue || (node.next || [])[0],
          };
        }
      }

      const msMap: Record<string, number> = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };
      const totalMs = intervalValue * (msMap[intervalUnit] || 3600000);


      return {
        output: {
          success: true,
          loop_active: true,
          attempt: loopCount,
          max_attempts: maxAttempts,
          next_check_at: new Date(Date.now() + totalMs).toISOString(),
        },
        status: "paused",
        pauseExecution: true,
        pauseType: "wait",
        pauseData: {
          expiresAt: new Date(Date.now() + totalMs),
          isLoop: true,
          loopNodeId: node.id,
        },
      };
    }

    case "alerta_interno": {
      const alertTitle = c.alert_title || "Alerta do Fluxo";
      const alertMessage = c.alert_message || "";
      const alertPriority = c.alert_priority || "media";
      const destType = c.dest_type || "user";
      const destId = c.dest_id || null;

      let alertLeadData: Record<string, any> = {};
      if (ctx.leadId) {
        try {
          const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
          if (lead) alertLeadData = { nome: lead.nome, empresa: lead.empresa, telefone: lead.telefone, email: lead.email, valor: lead.valor, status: lead.status };
        } catch {}
      }

      const resolveAlertVar = (tpl: string) => tpl.replace(/\{\{([\w.]+)\}\}/g, (_: string, path: string) => {
        if (path.startsWith("lead.")) return (alertLeadData[path.substring(5)] ?? "") as string;
        if (path.startsWith("variables.")) return String(ctx.variables[path.substring(10)] ?? "");
        return String(alertLeadData[path] ?? ctx.variables[path] ?? "");
      });

      const resolvedTitle = resolveAlertVar(alertTitle);
      const resolvedMessage = resolveAlertVar(alertMessage);

      try {
        if (destType === "team" && destId) {
          // ws-scope o lookup da equipe via join em teams (team_members não tem workspace_id) — evita alertar/enumerar usuário de outro tenant por UUID de equipe
          const members = await db.select({ userId: teamMembers.userId })
            .from(teamMembers)
            .innerJoin(teams, eq(teams.id, teamMembers.teamId))
            .where(and(eq(teamMembers.teamId, String(destId)), eq(teams.workspaceId, ctx.workspaceId)));
          for (const member of members) {
            await db.insert(notificacoes).values({
              tipo: "alerta_fluxo",
              categoria: "automacao",
              titulo: resolvedTitle,
              mensagem: resolvedMessage,
              prioridade: alertPriority,
              destinatarioId: member.userId,
              destinatarioTipo: "user",
              leadId: ctx.leadId || null,
              iconKey: (alertPriority === "alta" || alertPriority === "urgente") ? "alert-triangle" : "bell",
              workspaceId: ctx.workspaceId,
            });
          }
        } else if (destType === "all") {
          const { users: usersTable } = await import("@shared/schema");
          const allUsers = await db.select().from(usersTable).where(eq(usersTable.workspaceId, ctx.workspaceId));
          for (const u of allUsers) {
            await db.insert(notificacoes).values({
              tipo: "alerta_fluxo",
              categoria: "automacao",
              titulo: resolvedTitle,
              mensagem: resolvedMessage,
              prioridade: alertPriority,
              destinatarioId: u.id,
              destinatarioTipo: "user",
              leadId: ctx.leadId || null,
              iconKey: (alertPriority === "alta" || alertPriority === "urgente") ? "alert-triangle" : "bell",
              workspaceId: ctx.workspaceId,
            });
          }
        } else {
          const userDestId = destId ? parseInt(String(destId), 10) || null : null;
          await db.insert(notificacoes).values({
            tipo: "alerta_fluxo",
            categoria: "automacao",
            titulo: resolvedTitle,
            mensagem: resolvedMessage,
            prioridade: alertPriority,
            destinatarioId: userDestId,
            destinatarioTipo: "user",
            leadId: ctx.leadId || null,
            iconKey: (alertPriority === "alta" || alertPriority === "urgente") ? "alert-triangle" : "bell",
            workspaceId: ctx.workspaceId,
          });
        }

        try {
          broadcastToWorkspace(ctx.workspaceId, "new_notification", {
            titulo: resolvedTitle,
            mensagem: resolvedMessage,
            prioridade: alertPriority,
          });
        } catch {}

        return { output: { success: true, title: resolvedTitle, priority: alertPriority, dest_type: destType }, status: "success" };
      } catch (err: any) {
        console.error("[AutomationEngine] alerta_interno error:", err.message);
        return { output: { success: false, error: err.message }, status: "success" };
      }
    }

    case "gerar_documento": {
      const templateId = c.template_id || "";
      const docName = c.document_name || "Documento";

      if (!templateId) {
        return { output: { success: false, error: "Template nao selecionado" }, status: "success" };
      }

      try {
        const [template] = await db.select().from(documentTemplates).where(and(eq(documentTemplates.id, templateId), eq(documentTemplates.workspaceId, ctx.workspaceId))).limit(1);
        if (!template) {
          return { output: { success: false, error: "Template nao encontrado" }, status: "success" };
        }

        let html = template.conteudoHtml;
        let leadData: Record<string, any> = {};
        if (ctx.leadId) {
          try {
            const lead = await storage.getLead(ctx.leadId, ctx.workspaceId);
            if (lead) {
              leadData = {
                nome: lead.nome, empresa: lead.empresa || "", telefone: lead.telefone || "",
                email: lead.email || "", valor: lead.valor ? `R$ ${Number(lead.valor).toFixed(2)}` : "",
                status: lead.status, canal: lead.canal,
                cpf: ctx.variables?.cpf || "", cnpj: ctx.variables?.cnpj || "",
                data: new Date().toLocaleDateString("pt-BR"),
                data_hora: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
              };
            }
          } catch {}
        }

        html = html.replace(/\{\{([\w.]+)\}\}/g, (_: string, path: string) => {
          if (path.startsWith("lead.")) return leadData[path.substring(5)] ?? "";
          if (path.startsWith("variables.")) return ctx.variables[path.substring(10)] ?? "";
          return leadData[path] ?? ctx.variables[path] ?? "";
        });

        ctx.variables.last_document_html = html;
        ctx.variables.last_document_name = docName;
        ctx.variables.last_document_template = template.nome;

        return {
          output: {
            success: true,
            document_name: docName,
            template_name: template.nome,
            html_length: html.length,
          },
          status: "success",
        };
      } catch (err: any) {
        console.error("[AutomationEngine] gerar_documento error:", err.message);
        return { output: { success: false, error: err.message }, status: "success" };
      }
    }

    case "engine_isp": {
      // Módulo ISP/motor de agentes removido deste produto. Nó tornou-se no-op.
      ctx.variables.engine_isp_success = "false";
      return { output: { success: false, mode: "engine_isp_removed" }, status: "success" };
    }

    case "isp_action": {
      // Módulo ISP/ERP removido deste produto. Nó tornou-se no-op.
      ctx.variables.isp_success = "false";
      ctx.variables.isp_error = "Módulo ISP removido";
      return { output: { success: false, error: "ISP module removed" }, status: "success" };
    }

    case "isp_unlock": {
      // Módulo ISP/desbloqueio removido deste produto. Nó tornou-se no-op.
      ctx.variables.isp_unlock_success = "false";
      ctx.variables.isp_unlock_error = "Módulo ISP removido";
      return { output: { success: false, error: "ISP module removed" }, status: "success" };
    }

    default:
      return { output: { processed: true }, status: "success" };
  }
}

export interface ExecutionResult {
  status: string;
  log: any[];
  total_nodes: number;
  node_id?: string;
  message?: string;
}

export async function runFlowFromNode(
  flowId: string,
  nodesArr: FlowNode[],
  startNodeId: string,
  ctx: ExecutionContext,
  existingLogs: any[] = [],
  existingDuration: number = 0,
): Promise<ExecutionResult> {
  const logEntries = [...existingLogs];
  let totalDuration = existingDuration;
  let currentId: string | undefined = startNodeId;
  const visited = new Set<string>();
  let executionCount = 0;

  while (currentId) {
    if (visited.has(currentId)) {
      console.error('[automationEngine] Ciclo detectado — execução interrompida', {
        automacaoId: flowId,
        nodeId: currentId,
        conversationId: ctx.conversationId,
      });
      try {
        await db.insert(automationNodeLogs).values({
          workspaceId: ctx.workspaceId,
          automacaoId: flowId,
          nodeId: currentId,
          nodeType: 'cycle_guard',
          status: 'error',
          errorMessage: `Ciclo detectado: node "${currentId}" já foi executado neste fluxo`,
        });
      } catch {}
      break;
    }

    visited.add(currentId);
    executionCount++;

    if (executionCount > MAX_NODE_EXECUTIONS) {
      console.error('[automationEngine] Limite de nodes atingido — execução interrompida', {
        automacaoId: flowId,
        conversationId: ctx.conversationId,
        executionCount,
        lastNodeId: currentId,
      });
      try {
        await db.insert(automationNodeLogs).values({
          workspaceId: ctx.workspaceId,
          automacaoId: flowId,
          nodeId: currentId,
          nodeType: 'limit_guard',
          status: 'error',
          errorMessage: `Execução interrompida: limite de ${MAX_NODE_EXECUTIONS} nodes atingido (possível loop infinito)`,
        });
      } catch {}
      break;
    }

    const node = nodesArr.find(n => n.id === currentId);
    if (!node) break;

    const startTime = Date.now();
    const result = await executeNodeReal(node, ctx, nodesArr, flowId, logEntries);
    const duration = Date.now() - startTime || Math.floor(Math.random() * 50) + 5;
    totalDuration += duration;

    if (result.pauseExecution) {
      logEntries.push({ nodeId: node.id, type: node.type, label: node.label, status: "paused", duration, output: result.output });

      if (ctx.phone && ctx.leadId) {
        const expiresAt = result.pauseType === "wait"
          ? result.pauseData.expiresAt
          : new Date(Date.now() + (result.pauseData.timeoutMinutes || 120) * 60 * 1000);

        try {
          const { db: dbClean } = await import("../db");
          const { automationPendingInputs: apiTable } = await import("@shared/schema");
          const { eq, and } = await import("drizzle-orm");
          await dbClean.delete(apiTable).where(
            and(
              eq(apiTable.phone, ctx.phone),
              eq(apiTable.workspaceId, ctx.workspaceId),
            )
          );
        } catch {}

        await storage.createPendingInput({
          workspaceId: ctx.workspaceId,
          tenantId: 1,
          pendingType: result.pauseType || "option_list",
          flowId,
          executionId: ctx.executionId,
          nodeId: node.id,
          leadId: ctx.leadId,
          phone: ctx.phone,
          options: result.pauseType === "option_list" ? (result.pauseData.options || []) : {},
          context: { variables: ctx.variables, logs: logEntries, message: ctx.message, conexaoId: ctx.conexaoId, conversationId: ctx.conversationId, metaAccessToken: ctx.metaAccessToken, pauseData: result.pauseData || {} },
          expiresAt,
        });
      }

      await storage.createAutomacaoLog({
        automacaoId: flowId,
        status: "paused",
        payload: ctx.variables,
        log: logEntries,
        duracaoMs: totalDuration,
      });

      return {
        status: "waiting_input",
        log: logEntries,
        total_nodes: logEntries.length,
        node_id: node.id,
        message: result.pauseType === "wait"
          ? `Fluxo pausado — aguardando ${node.config?.value || 5} ${node.config?.unit || "minutos"}`
          : "Fluxo pausado — aguardando resposta do cliente",
      };
    }

    logEntries.push({ nodeId: node.id, type: node.type, label: node.label, status: result.status, duration, output: result.output });

    try {
      await db.insert(automationNodeLogs).values({
        workspaceId: ctx.workspaceId,
        automacaoId: flowId,
        nodeId: node.id,
        nodeType: node.type,
        contactId: ctx.leadId ? undefined : undefined,
        status: result.status === "success" ? "success" : result.status === "error" ? "error" : "success",
        errorMessage: result.status === "error" ? ((result.output as any)?.error || "Erro desconhecido") : null,
      });
    } catch {}

    if (node.type === "end") break;

    if (result.nextNodeId !== undefined) {
      currentId = result.nextNodeId;
    } else if (node.type === "condition") {
      const condResult = (result.output as any).result;
      currentId = condResult ? (node.nextTrue || (node.next || [])[0]) : (node.nextFalse || undefined);
    } else {
      currentId = (node.next || [])[0];
    }
  }

  const lastAiEntry = [...logEntries].reverse().find(e => (e.type === "ai_response" || e.type === "agente") && e.status === "success");
  if (lastAiEntry && ctx.phone && ctx.leadId && !ctx.variables?.__flow_finalized) {
    try {
      const { db: dbClean } = await import("../db");
      const { automationPendingInputs: apiTable } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await dbClean.delete(apiTable).where(
        and(
          eq(apiTable.phone, ctx.phone),
          eq(apiTable.workspaceId, ctx.workspaceId),
        )
      );

      await storage.createPendingInput({
        workspaceId: ctx.workspaceId,
        tenantId: 1,
        pendingType: "ai_conversation",
        flowId,
        executionId: ctx.executionId,
        nodeId: lastAiEntry.nodeId,
        leadId: ctx.leadId,
        phone: ctx.phone,
        options: {},
        context: { variables: ctx.variables, logs: logEntries, message: ctx.message, conexaoId: ctx.conexaoId, conversationId: ctx.conversationId, metaAccessToken: ctx.metaAccessToken },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    } catch (err: any) {
      console.error("[AutomationEngine] Failed to create ai_conversation pending:", err.message);
    }
  }

  if (ctx.variables?.__flow_finalized && ctx.phone) {
    try {
      const { db: dbClean } = await import("../db");
      const { automationPendingInputs: apiTable } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await dbClean.delete(apiTable).where(
        and(
          eq(apiTable.phone, ctx.phone),
          eq(apiTable.workspaceId, ctx.workspaceId),
        )
      );
    } catch {}
  }

  await storage.incrementExecucoes(flowId);
  await storage.createAutomacaoLog({
    automacaoId: flowId,
    status: ctx.variables?.__flow_finalized ? "finalized" : "success",
    payload: ctx.variables,
    log: logEntries,
    duracaoMs: totalDuration,
  });

  return { status: "completed", log: logEntries, total_nodes: logEntries.length };
}

export async function resumeAutomationFlow(
  pending: {
    id: number;
    flowId: string;
    nodeId: string;
    leadId: number;
    phone: string;
    options: any;
    context: any;
    pendingType?: string;
  },
  selectedOptionId: string,
  extraContext?: { text?: string; type?: string; media_url?: string; media_type?: string; filename?: string }
) {
  const pendingWsId = (pending as any).workspaceId || "";
  const auto = await storage.getAutomacao(pending.flowId, pendingWsId);
  if (!auto) return { status: "error", error: "Automacao nao encontrada" };
  if (auto.status !== "ACTIVE") {
    return { status: "skipped", error: "Automacao nao esta ativa", log: [], total_nodes: 0 };
  }

  const nodesArr: FlowNode[] = Array.isArray(auto.nodes) ? (auto.nodes as any[]) : [];
  const currentNode = nodesArr.find(n => n.id === pending.nodeId);
  if (!currentNode) return { status: "error", error: "No nao encontrado no fluxo" };

  let nextNodeId: string | undefined;
  let matchedOptionId: string | undefined;

  if (pending.pendingType === "ai_conversation") {
    nextNodeId = currentNode.id;
  } else if (pending.pendingType === "wait" || selectedOptionId === "__timeout__") {
    if (currentNode.type === "wait_event") {
      if (selectedOptionId === "__timeout__") {
        nextNodeId = currentNode.nextFalse || (currentNode.next || [])[0];
      } else {
        nextNodeId = currentNode.nextTrue || (currentNode.next || [])[0];
      }
    } else if (currentNode.type === "loop") {
      const loopData = pending.context?.pauseData;
      if (loopData?.isLoop) {
        nextNodeId = currentNode.id;
      } else {
        nextNodeId = (currentNode.next || [])[0];
      }
    } else {
      nextNodeId = (currentNode.next || [])[0];
    }
  } else if (selectedOptionId === "__text_input__") {
    const hasOptions = currentNode.type === "lista_opcoes" && (currentNode.nextOptions || currentNode.config?.options?.length || (Array.isArray(pending.options) && pending.options.length));
    if (hasOptions && extraContext?.text) {
      const userText = (extraContext.text || "").trim().toLowerCase();
      const opts = currentNode.config?.options || pending.options || [];
      let bestMatch: { id: string; score: number } | null = null;
      for (const opt of opts) {
        const optLabel = (opt.label || opt.title || "").trim().toLowerCase();
        const optId = opt.id || "";
        if (!optLabel || !optId) continue;
        if (userText === optLabel || userText === optId) {
          bestMatch = { id: optId, score: 100 };
          break;
        }
        if (optLabel.includes(userText) || userText.includes(optLabel)) {
          const score = Math.min(userText.length, optLabel.length) / Math.max(userText.length, optLabel.length) * 80;
          if (!bestMatch || score > bestMatch.score) bestMatch = { id: optId, score };
        }
        const optWords = optLabel.split(/\s+/);
        const userWords = userText.split(/\s+/);
        const matchingWords = userWords.filter((uw: string) => optWords.some((ow: string) => ow.includes(uw) || uw.includes(ow)));
        if (matchingWords.length > 0) {
          const wordScore = (matchingWords.length / Math.max(optWords.length, userWords.length)) * 70;
          if (!bestMatch || wordScore > bestMatch.score) bestMatch = { id: optId, score: wordScore };
        }
        const numMatch = userText.match(/^\d+$/);
        if (numMatch) {
          const idx = parseInt(numMatch[0], 10);
          const optIdx = opts.indexOf(opt);
          if (idx === optIdx + 1) {
            bestMatch = { id: optId, score: 90 };
            break;
          }
        }
      }
      if (bestMatch && bestMatch.score >= 30) {
        matchedOptionId = bestMatch.id;
        nextNodeId = currentNode.nextOptions?.[matchedOptionId]
          || currentNode.nextOptions?.[`opt_${matchedOptionId}`]
          || currentNode.nextOptions?.[matchedOptionId!.replace(/^opt_/, "")];
        if (!nextNodeId && currentNode.config?.options) {
          const mOpt = currentNode.config.options.find((o: any) => o.id === matchedOptionId || o.id === matchedOptionId!.replace(/^opt_/, ""));
          if (mOpt?.next) nextNodeId = mOpt.next;
        }
      } else {
        const { storage } = await import("../storage");
        const expiresAt = new Date(Date.now() + ((currentNode.config?.timeout_minutes || 120) * 60 * 1000));
        try {
          await storage.createPendingInput({
            workspaceId: (pending as any).workspaceId || auto.workspaceId,
            tenantId: 1,
            pendingType: "option_list",
            flowId: pending.flowId,
            executionId: (pending as any).executionId || Date.now().toString(),
            nodeId: currentNode.id,
            leadId: pending.leadId,
            phone: pending.phone,
            options: opts,
            context: pending.context,
            expiresAt,
          });
        } catch (recreateErr: any) {
          console.error("[AutomationEngine] Failed to re-create pending input:", recreateErr.message);
        }
        const listTitle = currentNode.config?.title || "Escolha uma opcao";
        const displayOpts = opts.map((o: any, i: number) => `${i + 1}. *${o.label || o.title}*`).join("\n");
        const reprompt = `Desculpe, nao entendi. Por favor, escolha uma das opcoes:\n\n${displayOpts}`;
        try {
          const ctx2 = {
            workspaceId: (pending as any).workspaceId || auto.workspaceId,
            phone: pending.phone,
            conexaoId: pending.context?.conexaoId,
            conversationId: pending.context?.conversationId,
          } as any;
          const { sendAutomationMessage } = await import("./automationEngine");
          await sendAutomationMessage(ctx2, reprompt);
        } catch {}
        return { status: "waiting_input", message: "Opcao nao reconhecida — solicitada nova resposta", log: [], total_nodes: 0 };
      }
    }
    if (!nextNodeId) {
      if (currentNode.type === "wait_event") {
        nextNodeId = currentNode.nextTrue || currentNode.nextTextInput || (currentNode.next || [])[0];
      } else {
        nextNodeId = currentNode.nextTextInput || (currentNode.next || [])[0];
      }
    }
  } else {
    nextNodeId = currentNode.nextOptions?.[selectedOptionId]
      || currentNode.nextOptions?.[`opt_${selectedOptionId}`]
      || currentNode.nextOptions?.[selectedOptionId.replace(/^opt_/, "")];
    if (!nextNodeId && currentNode.type === "lista_opcoes" && currentNode.config?.options) {
      const matchOpt = currentNode.config.options.find((o: any) => o.id === selectedOptionId || o.id === selectedOptionId.replace(/^opt_/, ""));
      if (matchOpt?.next) {
        nextNodeId = matchOpt.next;
      }
    }
    if (!nextNodeId) {
      nextNodeId = (currentNode.next || [])[0];
    }
  }

  if (!nextNodeId) {
    return { status: "completed", message: "Sem no seguinte configurado", log: [], total_nodes: 0 };
  }

  const restoredContext = pending.context || {};
  const existingLogs: any[] = restoredContext.logs || [];
  const existingDuration = existingLogs.reduce((s: number, l: any) => s + (l.duration || 0), 0);

  const restoredVars = restoredContext.variables || {};
  if (extraContext?.text) {
    restoredVars.last_input_text = extraContext.text;
  }
  if (matchedOptionId) {
    restoredVars.last_selected_option = matchedOptionId;
  } else if (selectedOptionId && selectedOptionId !== "__text_input__" && selectedOptionId !== "__timeout__") {
    restoredVars.last_selected_option = selectedOptionId;
  }

  const resolvedOptionId = matchedOptionId || (selectedOptionId && selectedOptionId !== "__text_input__" && selectedOptionId !== "__timeout__" ? selectedOptionId : null);
  if (resolvedOptionId && currentNode.type === "lista_opcoes" && pending.leadId) {
    const opts = currentNode.config?.options || [];
    const selectedOpt = opts.find((o: any) => o.id === resolvedOptionId);
    if (selectedOpt?.pipeline) {
      try {
        const { storage } = await import("../storage");
        const wsId = (pending as any).workspaceId || auto.workspaceId;
        const stages = await storage.getPipelineStages(wsId, selectedOpt.pipeline);
        const firstStage = stages.length > 0 ? stages[0] : null;
        if (firstStage) {
          await storage.updateLead(pending.leadId, {
            pipeline: selectedOpt.pipeline,
            status: firstStage.key,
          }, wsId);
        }
      } catch (pipeErr: any) {
        console.error("[AutomationEngine] lista_opcoes pipeline redirect error:", pipeErr.message);
      }
    }
  }

  const restoredMessage = restoredContext.message || {};
  if (extraContext?.text) {
    restoredMessage.text = extraContext.text;
  }
  if (extraContext?.type) restoredMessage.type = extraContext.type;
  if (extraContext?.media_url) restoredMessage.media_url = extraContext.media_url;
  if (extraContext?.media_type) restoredMessage.media_type = extraContext.media_type;
  if (extraContext?.filename) restoredMessage.filename = extraContext.filename;

  existingLogs.push({
    nodeId: currentNode.id,
    type: currentNode.type,
    label: currentNode.label,
    status: "resumed",
    duration: 0,
    output: {
      selectedOption: selectedOptionId,
      text: extraContext?.text || null,
      resumedAt: new Date().toISOString(),
    },
  });

  const ctx: ExecutionContext = {
    workspaceId: (pending as any).workspaceId || auto.workspaceId,
    leadId: pending.leadId,
    phone: pending.phone,
    conexaoId: restoredContext.conexaoId,
    conversationId: restoredContext.conversationId,
    message: restoredMessage,
    variables: restoredVars,
    executionId: (pending as any).executionId || Date.now().toString(),
    metaAccessToken: restoredContext.metaAccessToken,
  };

  return runFlowFromNode(auto.id, nodesArr, nextNodeId, ctx, existingLogs, existingDuration);
}

// Exported so ISP agent engine can attempt re-transcription of audio messages
export { transcribeAudio as transcribeAudioDirect };
