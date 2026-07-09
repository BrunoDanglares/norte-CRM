import { randomUUID } from "crypto";
import { storage } from "../storage";
import { maskPhone } from "../utils/mask";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { conversations } from "@shared/schema";
import { dispatchWebhook } from "./webhookDispatcher";
import { broadcastToWorkspace } from './broadcast';
import { pingTyping, startTypingLoop, stopTypingLoop } from "./typingHeartbeat";

// Bruno 2026-06-07: guard único de controle humano, lido FRESCO do banco.
// Usado no intake E no flush do buffer (re-check pós-debounce) pra o bot
// nunca falar depois que um humano assume DURANTE a janela de coalescência.
export async function isConvUnderHumanControl(conversationId: number, workspaceId: string): Promise<boolean> {
  const [c] = await db
    .select({
      aiPaused: conversations.aiPaused,
      assignedUserId: conversations.assignedUserId,
      assignedUserName: conversations.assignedUserName,
      pipelineEtapa: conversations.pipelineEtapa,
      tags: conversations.tags,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  if (!c) return false; // conversa não encontrada → não bloqueia fluxo normal
  const isBotAsAttendant = c.assignedUserName === "Agente Banana ISP";
  if (c.aiPaused) return true;
  if (!!c.assignedUserId && !isBotAsAttendant) return true; // dono humano real
  if ((c.pipelineEtapa || "").includes("atendimento_humano")) return true;
  if ((c.tags || []).includes("AH")) return true;
  return false;
}

export interface IncomingMessage {
  workspaceId: string;
  conversationId: number;
  conversationNome: string;
  conversationStatus: string;
  conversationPendente?: boolean;
  conversationPipeline?: string | null;
  leadId: number;
  leadNome: string;
  messageId: number;
  externalId: string;
  content: string;
  type: string;
  mediaUrl?: string | null;
  mediaType?: string;
  filename?: string;
  channel: "meta" | "instagram" | "evolution";
  customerPhone: string;
  conexaoId?: string | number | null;
  conexaoAutomacaoId?: string | number | null;
  metaAccessToken?: string;
  fromMe?: boolean;
  direction?: "in" | "out";
  sender?: string;
  isFromBot?: boolean;
  buttonId?: string | null;
}

/**
 * Seleciona qual mensagem da rajada carrega a mídia a propagar pro agente.
 *
 * Bruno 2026-06-01: quando o buffer coalesce uma rajada tipo [imagem, "Bom
 * dia"], a mídia pode estar em QUALQUER mensagem — não só na última. Antes o
 * mediaContext era montado só do lastMsg → se o cliente mandasse o comprovante
 * e depois um texto, a imagem sumia e o comprovanteVisionValidator nunca
 * disparava. Escolhe a ÚLTIMA mensagem da rajada que tenha mídia real
 * (type != 'text' + mediaUrl); se nenhuma tiver, devolve a última msg.
 */
export function selectBurstMedia(msgs: IncomingMessage[]): IncomingMessage {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type && m.type !== "text" && m.mediaUrl) return m;
  }
  return msgs[msgs.length - 1];
}

/**
 * Monta o contexto de mensagem para uso em automações e respostas de IA.
 * Utilizado internamente pelo automationEngine e message-processor.
 * @internal
 */
export function buildMessageContext(
  content: string,
  type: string,
  mediaUrl?: string | null
): { text: string; hasMedia: boolean; mediaType?: string } {
  const hasMedia = type !== "text" && !!mediaUrl;
  return {
    text: content,
    hasMedia,
    mediaType: hasMedia ? type : undefined,
  };
}

// CSAT/protocolo removidos junto com o módulo ISP. A captura de nota de
// avaliação dependia de protocol.service (registrarRespostaCsat), da sessão
// ISP (ispMemoryService) e do envio ISP (ispSendService) — todos arrancados.
// Mantido como no-op para preservar o contrato (retorna false = "não era CSAT").
async function checkCsatResponse(
  _telefone: string,
  _workspaceId: string,
  _conversationId: number,
  _mensagem: string
): Promise<boolean> {
  return false;
}

const isPlaceholderText = (t: string) =>
  /^\[(mensagem|figurinha|localizacao|reacao.*|audio|video|imagem|documento.*|contato.*)\]$/i.test(
    t.trim()
  );

// Config de humanização — resolvida do tenant, com fallback pros defaults abaixo.
// Controla o buffer de coalescência (quanto tempo espera pra agrupar mensagens
// fragmentadas antes de processar) e o comportamento ao redor da resposta do bot.
interface HumanizeConfig {
  coalescenceWindowMs: number;
  coalescenceMaxMs: number;
  burstGapMs: number;
  burstExtensionMs: number;
  mediaFlushMs: number;
  turnCloseFlushMs: number;
  abortOnClientTyping: boolean;
}

const DEFAULT_HUMANIZE_CONFIG: HumanizeConfig = {
  coalescenceWindowMs: 6000,
  coalescenceMaxMs: 15000,
  burstGapMs: 1500,
  burstExtensionMs: 4000,
  mediaFlushMs: 2000,
  turnCloseFlushMs: 1000,
  abortOnClientTyping: true,
};

const MICRO_REFLUSH_MS = 800;

const humanizeCfgCache = new Map<string, { cfg: HumanizeConfig; cachedAt: number }>();
const HUMANIZE_CFG_TTL_MS = 60_000;

async function getHumanizeConfig(workspaceId: string): Promise<HumanizeConfig> {
  const cached = humanizeCfgCache.get(workspaceId);
  if (cached && (Date.now() - cached.cachedAt) < HUMANIZE_CFG_TTL_MS) return cached.cfg;
  try {
    const { tenantSettingsService } = await import('./tenantSettingsService');
    const s = await tenantSettingsService.getTenantSettings(workspaceId);
    const h = s.businessRules?.humanize || {};
    const cfg: HumanizeConfig = {
      coalescenceWindowMs: h.coalescenceWindowMs ?? DEFAULT_HUMANIZE_CONFIG.coalescenceWindowMs,
      coalescenceMaxMs: h.coalescenceMaxMs ?? DEFAULT_HUMANIZE_CONFIG.coalescenceMaxMs,
      burstGapMs: h.burstGapMs ?? DEFAULT_HUMANIZE_CONFIG.burstGapMs,
      burstExtensionMs: h.burstExtensionMs ?? DEFAULT_HUMANIZE_CONFIG.burstExtensionMs,
      mediaFlushMs: h.mediaFlushMs ?? DEFAULT_HUMANIZE_CONFIG.mediaFlushMs,
      turnCloseFlushMs: h.turnCloseFlushMs ?? DEFAULT_HUMANIZE_CONFIG.turnCloseFlushMs,
      abortOnClientTyping: h.abortOnClientTyping ?? DEFAULT_HUMANIZE_CONFIG.abortOnClientTyping,
    };
    humanizeCfgCache.set(workspaceId, { cfg, cachedAt: Date.now() });
    return cfg;
  } catch {
    return DEFAULT_HUMANIZE_CONFIG;
  }
}

interface BufferedEntry {
  msg: IncomingMessage;
  receivedAt: number;
}

type BufferHandler = (msgs: IncomingMessage[]) => Promise<void>;

interface BufferState {
  entries: BufferedEntry[];
  timer: ReturnType<typeof setTimeout> | null;
  processing: boolean;
  processingStartedAt: number | null;
  cfg: HumanizeConfig;
  handler: BufferHandler | null;
  abortController: AbortController | null;
  workspaceId: string;
  phone: string;
}

const phoneMessageBuffers = new Map<string, BufferState>();

function bufferKey(phone: string, wsId: string) { return `${wsId}:${phone}`; }

// Métricas ISP removidas (ispMetricsService arrancado). No-op preservado para
// manter os call sites de telemetria do buffer intactos.
function emitTelemetry(_eventType: string, _workspaceId: string, _phone: string, _metadata: Record<string, unknown>): void {
  // no-op
}

// Usada pelo ispSendService pra decidir se deve ABORTAR envio de resposta.
// Retorna true se chegaram mensagens novas APÓS o bot começar a processar a
// leva atual — sinal forte de que a resposta que ele montou está desatualizada.
export function hasPendingIncomingMessages(workspaceId: string, phone: string, conversationId?: number | string | null): boolean {
  const key = bufferKey(phone.replace(/\D/g, '') || phone, workspaceId);
  // Resolve o buffer pela key normalizada; cai pro phone "cru" (alguns canais já
  // chegam normalizados).
  const buf = phoneMessageBuffers.get(key) ?? phoneMessageBuffers.get(bufferKey(phone, workspaceId));
  if (!buf || !buf.processing) return false;
  // Bruno 2026-06-11 (caso conv 2880 — suporte travado): o buffer é por
  // workspace+phone, mas o MESMO número pode ter 2 conversas simultâneas (ex: Meta
  // + Evolution no mesmo tenant — comum em TESTE, raro mas possível em prod
  // multi-canal). O anti-race é por CONVERSA: a resposta só fica "stale" se chegou
  // msg nova NA MESMA conversa. Uma msg pendente de OUTRA conversa (outro canal,
  // mesmo nº) NÃO pode abortar este envio — senão o bot para no meio do fluxo. Foi
  // exatamente isso: suporte ONU offline mandava só "Deixa eu verificar sua conexão"
  // e NUNCA enviava o checklist de reinício, porque o CPF da conversa-irmã (outro
  // canal) caía no buffer e disparava o abort do envio de texto.
  if (conversationId != null) {
    const cid = Number(conversationId);
    return buf.entries.some(e => Number(e.msg.conversationId) === cid);
  }
  return buf.entries.length > 0;
}

// Estende a janela do buffer para esse cliente — acionada quando recebemos
// sinal de "usuário está digitando" (presence do canal não-oficial). Só faz efeito se
// houver buffer ocioso aberto; durante o processamento é ignorada porque o
// abort já cobre esse caso.
export function extendBufferWindow(workspaceId: string, phone: string, extendMs: number, reason: string): boolean {
  const phoneDigits = phone.replace(/\D/g, '') || phone;
  const key = bufferKey(phoneDigits, workspaceId);
  const buf = phoneMessageBuffers.get(key);
  if (!buf || buf.processing || buf.entries.length === 0 || !buf.handler) return false;

  const totalElapsed = Date.now() - buf.entries[0].receivedAt;
  const remainingCap = Math.max(500, buf.cfg.coalescenceMaxMs - totalElapsed);
  const actualExtend = Math.min(extendMs, remainingCap);
  if (actualExtend <= 0) return false;

  if (buf.timer) clearTimeout(buf.timer);
  const handler = buf.handler;
  buf.timer = setTimeout(() => flushBuffer(key, handler), actualExtend);

  console.log(`[MessageBuffer] Window extended ${actualExtend}ms for ${key} (reason=${reason})`);
  emitTelemetry('BUFFER_WINDOW_EXTENDED', workspaceId, phoneDigits, {
    extendMs: actualExtend,
    requested: extendMs,
    remainingCap,
    reason,
  });
  return true;
}

// Calcula quanto tempo o buffer ainda deve esperar antes de flushar,
// com base no último estado recebido (rajada, pontuação final, mídia etc).
function computeFlushDelay(cfg: HumanizeConfig, entries: BufferedEntry[]): number {
  if (entries.length === 0) return cfg.coalescenceWindowMs;
  const last = entries[entries.length - 1];
  const prev = entries.length >= 2 ? entries[entries.length - 2] : null;

  // Mídia (áudio/imagem/doc) costuma ser turno auto-contido — flush rápido.
  if (last.msg.type && last.msg.type !== 'text') return cfg.mediaFlushMs;

  const text = (last.msg.content || '').trim();

  // Pontuação final ou mensagem longa = cliente fechou o pensamento.
  const endsWithTerminator = /[.!?…]$/.test(text);
  const longMessage = text.length > 80;
  if (endsWithTerminator || longMessage) return cfg.turnCloseFlushMs;

  // Rajada: última msg chegou muito próxima da anterior → provavelmente vem mais.
  if (prev) {
    const gap = last.receivedAt - prev.receivedAt;
    if (gap < cfg.burstGapMs) {
      const totalElapsed = Date.now() - entries[0].receivedAt;
      const remainingCap = Math.max(1000, cfg.coalescenceMaxMs - totalElapsed);
      return Math.min(cfg.burstExtensionMs, remainingCap);
    }
  }

  // Caso padrão: janela base, limitada pelo teto contando desde a 1ª msg.
  const totalElapsed = Date.now() - entries[0].receivedAt;
  const remainingCap = Math.max(500, cfg.coalescenceMaxMs - totalElapsed);
  return Math.min(cfg.coalescenceWindowMs, remainingCap);
}

async function flushBuffer(key: string, handler: BufferHandler) {
  const buf = phoneMessageBuffers.get(key);
  if (!buf || buf.processing || buf.entries.length === 0) return;

  buf.timer = null;
  buf.processing = true;
  buf.processingStartedAt = Date.now();
  buf.handler = handler;
  const abortController = new AbortController();
  buf.abortController = abortController;

  const msgs = buf.entries.map(e => e.msg);
  buf.entries = [];

  if (msgs.length > 1) {
    const firstAt = buf.processingStartedAt ?? Date.now();
    emitTelemetry('BUFFER_COALESCED', buf.workspaceId, buf.phone, {
      count: msgs.length,
      preview: msgs.map(m => (m.content || '').slice(0, 40)).slice(0, 5),
      sinceFirstMs: firstAt,
    });
  }

  console.log(`[MessageBuffer] Flushing ${msgs.length} msg(s) for ${key} (starting processing, window=adaptive)`);
  try {
    // Motor de agentes ISP removido (agents/llm/agentLlmService.aiAbortContext).
    // Chamamos o handler diretamente; o AbortController ainda sinaliza o
    // ispSendService via hasPendingIncomingMessages para anti-race.
    await handler(msgs);
  } catch (err: any) {
    console.error(`[MessageBuffer] flush error for ${key}:`, err.message);
  } finally {
    const current = phoneMessageBuffers.get(key);
    if (!current) return;
    current.processing = false;
    current.processingStartedAt = null;
    current.abortController = null;

    // Se novas mensagens chegaram durante o processamento, agenda UM micro-flush
    // curto pra capturar eventuais últimas mensagens da rajada. O envio da
    // resposta anterior terá sido abortado pelo ispSendService (via
    // hasPendingIncomingMessages) e a chamada OpenAI em voo terá sido abortada
    // pelo AbortController, então não há risco de duplicidade.
    if (current.entries.length > 0) {
      console.log(`[MessageBuffer] ${current.entries.length} msg(s) accumulated during processing for ${key} — micro-reflush in ${MICRO_REFLUSH_MS}ms`);
      current.timer = setTimeout(() => flushBuffer(key, handler), MICRO_REFLUSH_MS);
    } else {
      phoneMessageBuffers.delete(key);
    }
  }
}

function addToBuffer(key: string, msg: IncomingMessage, handler: BufferHandler, cfg: HumanizeConfig, workspaceId: string, phone: string) {
  const existing = phoneMessageBuffers.get(key);
  const entry: BufferedEntry = { msg, receivedAt: Date.now() };

  if (existing) {
    existing.entries.push(entry);
    existing.handler = handler;
    if (existing.processing) {
      // Bot está processando — aborta a chamada OpenAI em voo (se ainda não
      // enviou) e sinaliza pro ispSendService não enviar via hasPending...().
      // O finally do flush agenda um micro-reflush que reprocessa com o contexto completo.
      if (existing.abortController && cfg.abortOnClientTyping) {
        try { existing.abortController.abort(); } catch {}
        emitTelemetry('AI_CALL_ABORTED_NEW_MSG', workspaceId, phone, {
          queuedCount: existing.entries.length,
        });
      }
      console.log(`[MessageBuffer] Bot processing, queued msg #${existing.entries.length} for ${key} (aborting in-flight reply)`);
    } else {
      // Bot ocioso — recalcula a janela com base nos sinais da rajada.
      if (existing.timer) clearTimeout(existing.timer);
      const delay = computeFlushDelay(cfg, existing.entries);
      existing.timer = setTimeout(() => flushBuffer(key, handler), delay);
      if (delay >= cfg.burstExtensionMs) {
        emitTelemetry('BUFFER_WINDOW_EXTENDED', workspaceId, phone, {
          extendMs: delay,
          reason: 'burst_detected',
          count: existing.entries.length,
        });
      }
      console.log(`[MessageBuffer] Added msg #${existing.entries.length} to buffer for ${key}, reset timer ${delay}ms`);
    }
  } else {
    const delay = computeFlushDelay(cfg, [entry]);
    const timer = setTimeout(() => flushBuffer(key, handler), delay);
    phoneMessageBuffers.set(key, {
      entries: [entry],
      timer,
      processing: false,
      processingStartedAt: null,
      cfg,
      handler,
      abortController: null,
      workspaceId,
      phone,
    });
    console.log(`[MessageBuffer] New buffer for ${key}, waiting ${delay}ms (adaptive)`);
  }
}

export async function processIncomingMessageForAutomation(
  msg: IncomingMessage
): Promise<void> {
  if (msg.fromMe === true || msg.direction === 'out' || msg.sender === 'bot' || msg.isFromBot === true) {
    console.log(`[MessageProcessor] SKIP automation: outgoing/bot message for conv=${msg.conversationId}, phone=${msg.customerPhone}`);
    return;
  }

  // Auto-close por inatividade (informationalResolveService) removido junto
  // com o módulo ISP — nada a cancelar.

  const {
    workspaceId,
    conversationId,
    conversationNome,
    conversationStatus,
    conversationPipeline,
    leadId,
    leadNome,
    content,
    type,
    mediaUrl,
    mediaType,
    filename,
    customerPhone,
    conexaoId,
    conexaoAutomacaoId,
    metaAccessToken,
  } = msg;

  // Ficha do cliente: cria o contato (ficha editável) assim que o cliente fala.
  // Sem isso, o atendente clicava no nome e dava "Ficha não disponível" porque
  // só existia lead/conversa, não `contacts`. Idempotente — roda em toda msg,
  // então conserta também conversas antigas no próximo "oi". Bruno 2026-05-30.
  if (customerPhone) {
    storage
      .ensureContactForInbound({ workspaceId, telefone: customerPhone, nome: conversationNome, canal: "WhatsApp" })
      .catch((e: any) => console.warn(`[MessageProcessor] ensureContact falhou: ${e?.message}`));
  }

  // NPS (npsService) e CSAT (protocol.service) removidos junto com o módulo ISP.
  // checkCsatResponse é no-op e sempre retorna false; mantido o call site por
  // clareza, sem efeito de interceptação.
  if (type === "text" && content) {
    const csatHandled = await checkCsatResponse(customerPhone, workspaceId, conversationId, content);
    if (csatHandled) return;
  }

  const mediaContext = {
    type: type as "text" | "image" | "audio" | "video" | "document",
    text: content,
    media_url: mediaUrl || undefined,
    media_type: mediaType || undefined,
    filename: filename || undefined,
  };

  storage
    .createNotificacao({
      tipo: "mensagem_recebida",
      categoria: "Mensagens",
      titulo: "Nova mensagem",
      mensagem: `${conversationNome}: ${(content || "[midia]").substring(0, 80)}`,
      link: "/inbox",
      iconKey: "message",
      workspaceId,
    })
    .catch(() => {});

  dispatchWebhook("message.received", {
    conversa: { id: conversationId, nome: conversationNome },
    mensagem: { conteudo: content, de: customerPhone, tipo: type, media_url: mediaUrl },
    lead: { id: leadId, nome: leadNome, telefone: customerPhone },
  }, workspaceId).catch(() => {});


  // Reopen: se a conversa estava resolvida (auto-close encerrou, ou atendente
  // marcou como resolvida), uma nova mensagem do cliente reabre automaticamente.
  // Sem isso, status ficava "resolved" com resolved_at preenchido mesmo depois
  // do cliente voltar a mandar mensagem — gerava estado contraditório e atendentes
  // não viam a conversa na fila de ativas. Zerar resolvedAt também preserva a
  // semântica do /reopen endpoint (conversations.ts).
  const reopenFields: Record<string, any> = { lastCustomerMessageAt: new Date() };
  if (conversationStatus === "resolved") {
    // Bruno 2026-06-10 (auditoria Nekt conv-25): se o ÚLTIMO protocolo foi resolvido
    // por um ATENDENTE HUMANO, NÃO religa o bot na reabertura — senão ele dispara
    // saudação/continuidade por cima de um caso que estava sendo conduzido por gente
    // (caso real: bot mandou "Oi" 4x + áudio num reopen de mudança de endereço).
    // Reabre na FILA DO HUMANO (bot mudo). Se o protocolo anterior era do bot, segue
    // a regra antiga (novo protocolo começa com o bot).
    let fechadoPorHumano = false;
    try {
      const { protocols } = await import('@shared/schema');
      const { desc } = await import('drizzle-orm');
      const [ultProto] = await db.select({ agenteNome: protocols.agenteNome })
        .from(protocols)
        .where(and(eq(protocols.conversationId, conversationId), eq(protocols.workspaceId, workspaceId)))
        .orderBy(desc(protocols.createdAt)).limit(1);
      const nome = (ultProto?.agenteNome || '').trim();
      fechadoPorHumano = !!nome && !/^(sistema|banana ai|agente banana isp|bot)/i.test(nome);
    } catch {}

    reopenFields.status = "open";
    reopenFields.resolvedAt = null;
    reopenFields.pendente = true;
    reopenFields.unread = 1;
    reopenFields.tags = null;
    reopenFields.pipeline = null;
    reopenFields.prioridade = null;
    reopenFields.attendingStartedAt = new Date();
    if (fechadoPorHumano) {
      // Fila do humano: aiPaused + pipelineEtapa 'atendimento_humano' fazem o guard
      // isConvUnderHumanControl segurar o bot. Atendente pega da fila (são proativos).
      reopenFields.aiPaused = true;
      reopenFields.pipelineEtapa = 'atendimento_humano';
      console.log(`[MessageProcessor] 🔄 Reopen: conv=${conversationId} resolved por HUMANO → reabre na FILA do humano (bot NÃO religa)`);
    } else {
      // Novo protocolo começa com o bot (Agente Banana ISP); flags/timer zerados.
      reopenFields.aiPaused = false;
      reopenFields.pipelineEtapa = null;
      reopenFields.agente = null;
      reopenFields.assignedUserId = null;
      reopenFields.assignedUserName = null;
      reopenFields.assignedTeamId = null;
      console.log(`[MessageProcessor] 🔄 Reopen: conv=${conversationId} estava resolved (bot) → reabrindo limpa (bot ativo, unread=1, flags+timer zerados)`);
    }
    try {
      const { traceAgent, TRACE_STAGES } = await import('../utils/agentTrace');
      traceAgent({
        workspaceId, conversationId,
        stage: TRACE_STAGES.REOPEN_DETECTED,
        data: { from: 'resolved', to: 'open', trigger: 'customer_message' },
      });
    } catch {}
  }
  try {
    const { traceAgent, TRACE_STAGES } = await import('../utils/agentTrace');
    traceAgent({
      workspaceId, conversationId,
      stage: TRACE_STAGES.INBOUND_RECEIVED,
      data: {
        msgPreview: (content || '').slice(0, 100),
        type,
        hadMedia: !!mediaUrl,
        statusBefore: conversationStatus ?? null,
      },
    });
  } catch {}
  db.update(conversations)
    .set(reopenFields)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.workspaceId, workspaceId)
      )
    )
    .execute()
    .catch((e) => console.error("[MessageProcessor] Failed to update conversation on incoming:", e.message));

  try {
    broadcastToWorkspace(workspaceId, "new_message", {
      conversationId,
      message: {
        id: msg.messageId,
        texto: content,
        tipo: type === "image" ? "image" : type === "audio" ? "audio" : type === "video" ? "video" : type === "document" ? "file" : "text",
        arquivo: mediaUrl || null,
        nomeArquivo: filename || null,
        direction: "in",
        hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        status: "received",
        createdAt: new Date().toISOString(),
      },
      conversation: { id: conversationId, nome: conversationNome },
    });
    broadcastToWorkspace(workspaceId, "conversation_updated", {
      conversationId,
      ultimaMensagem: content,
      tempo: "agora",
      status: conversationStatus || "open",
      ...(msg.conversationPendente !== undefined ? { pendente: msg.conversationPendente } : {}),
    });
  } catch (e) {
    console.error("[MessageProcessor] Broadcast error:", e);
  }

  if (isPlaceholderText(content) && mediaContext.type === "text") {
    console.log(`[MessageProcessor] SKIP: placeholder text for phone=${customerPhone}`);
    return;
  }

  try {
    const pending = await storage.getPendingInputByPhone(customerPhone, workspaceId);
    if (pending) {
      console.log(`[MessageProcessor] Found pending input for phone=${customerPhone}: flowId=${pending.flowId}, type=${(pending as any).pendingType || "option_list"}, createdAt=${(pending as any).createdAt}`);
      const autoCheck = await storage.getAutomacao(pending.flowId, workspaceId);
      const pendingFlowMismatch = conexaoAutomacaoId ? String(pending.flowId) !== String(conexaoAutomacaoId) : false;
      if (!autoCheck || autoCheck.status !== "ACTIVE" || pendingFlowMismatch) {
        console.log(`[MessageProcessor] Cleaning stale pending (${!autoCheck || autoCheck.status !== "ACTIVE" ? "flow inactive" : "flow mismatch: pending=" + pending.flowId + " current=" + conexaoAutomacaoId}): phone=${customerPhone}`);
        try {
          const { automationPendingInputs: apiTable } = await import("@shared/schema");
          await db.delete(apiTable).where(
            and(
              eq(apiTable.phone, customerPhone),
              eq(apiTable.workspaceId, workspaceId)
            )
          );
        } catch {
          await storage.deletePendingInput(pending.id);
        }
      } else {
        const pendingType = (pending as any).pendingType || "option_list";
        const pendingCtx = (pending.context as any) || {};
        const pauseData = pendingCtx.pauseData || {};
        const isWaitingForReply =
          pendingType === "wait" &&
          (pauseData.eventType === "client_reply" || pauseData.eventType === "new_message");

        if (pendingType === "wait" && !isWaitingForReply) {
          console.log(`[MessageProcessor] SKIP: pending wait (not client_reply) for phone=${customerPhone}`);
          return;
        }

        if (pendingCtx.conversationId && content) {
          try {
            const { conversations } = await import("@shared/schema");
            await db
              .update(conversations)
              .set({ ultimaMensagem: content, tempo: "agora", updatedAt: new Date() })
              .where(
                and(
                  eq(conversations.id, pendingCtx.conversationId),
                  eq(conversations.workspaceId, workspaceId)
                )
              );
          } catch (e: any) { console.error("[MessageProcessor] conversation update failed:", e.message); }
        }

        const { resumeAutomationFlow } = await import("./automationEngine");

        if ((content && !isPlaceholderText(content)) || mediaContext.type !== "text") {
          await storage.deletePendingInput(pending.id);
          await resumeAutomationFlow(pending, "__text_input__", {
            ...mediaContext,
            text: content,
          });
          return;
        }

        if (isPlaceholderText(content)) return;
      }
    }
  } catch (pendingErr: any) {
    console.error("[MessageProcessor] Pending input error:", pendingErr.message);
  }

  // Bruno 2026-05-29 (Finalizar override): comando "finalizar" do cliente
  // SEMPRE encerra a conversa, mesmo em fila ou atribuída a humano. Cliente
  // tem direito de sair do atendimento a qualquer momento — soberania total.
  // Roda ANTES do bot-skip-check (que pula em fila/atribuída) porque o
  // encerramento é side-effect puro: CSAT + protocol close + reset session.
  // Não requer rodar V2 engine.
  try {
    const FINALIZAR_RE = /^(finalizar|finaliza|encerrar|encerra|encerrar\s+atendimento|finalizar\s+atendimento|encerrar\s+conversa|finalizar\s+conversa|sair\s+do\s+atendimento)$/i;
    const msgButtonId = (msg as any)?.buttonId as string | null | undefined;
    const buttonIsFinalizar = msgButtonId === 'ENCERRAR' || msgButtonId === 'FINALIZAR';
    // Bruno 2026-05-30: remove pontuação/emoji do final ("Finalizar.", "Finalizar 👋")
    // pra que a palavra solta sempre dispare, independente de como o cliente digitou.
    const finalizarText = (content || '').trim().replace(/[\s\p{P}\p{S}]+$/u, '');
    const textIsFinalizar = !!finalizarText && FINALIZAR_RE.test(finalizarText);
    if (buttonIsFinalizar || textIsFinalizar) {
      console.log(`[MessageProcessor] 👋 FINALIZAR override conv=${conversationId} (button=${msgButtonId || '-'}, text="${content?.slice(0, 30)}") — encerra mesmo em fila/atribuída`);
      // CSAT/protocolo, sessão e métricas ISP foram removidos. O encerramento
      // vira uma resolução genérica da conversa (sem CSAT/NPS): marca como
      // resolvida e sai. force = comando explícito do cliente, vence o guard
      // de controle humano.
      try {
        await db
          .update(conversations)
          .set({ status: 'resolved', resolvedAt: new Date(), pendente: false })
          .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
        try {
          broadcastToWorkspace(workspaceId, 'conversation_updated', {
            conversationId,
            status: 'resolved',
          });
        } catch {}
      } catch (e: any) {
        console.error('[MessageProcessor:FINALIZAR] resolve conversa erro:', e?.message);
      }
      return; // não roda bot nem automação
    }
  } catch (e: any) {
    console.error('[MessageProcessor:FINALIZAR override] erro silencioso:', e?.message);
  }

  // Bruno 2026-05-21: GUARD ÚNICO — o Agente Banana SÓ responde quando a
  // conversa está em "Automação" (bot ativo, sem dono humano, sem fila).
  // Qualquer outro estado (EM FILA ou ATRIBUÍDA) → bot fica MUDO de forma
  // permanente até a conversa voltar pra automação manualmente ou novo
  // protocolo abrir (reopen zera tudo na seção acima).
  //
  // Cenários cobertos:
  //   - aiPaused=true                 → fila (escalou pra humano)
  //   - assignedUserId != null e != bot → atribuída a humano real
  //   - pipelineEtapa contém 'atendimento_humano' → fila por pipeline
  //
  // Exceção: assignedUserName === 'Agente Banana ISP' continua sendo bot
  // (alguns fluxos setam ID nominal pro próprio bot).
  //
  // Bruno 2026-05-29: FINALIZAR override acima já tratou cliente quer sair.
  try {
    if (await isConvUnderHumanControl(conversationId, workspaceId)) {
      console.log(`[MessageProcessor] SKIP bot: conv=${conversationId} sob controle humano (intake)`);
      return;
    }
  } catch (e: any) { console.error("[MessageProcessor] bot-skip check failed:", e.message); }

  console.log(`[MessageProcessor] Automation check: phone=${customerPhone}, conexaoAutomacaoId=${conexaoAutomacaoId || "NONE"}, content_len=${content?.length}, mediaType=${mediaContext.type}`);
  if (conexaoAutomacaoId && (!isPlaceholderText(content) || mediaContext.type !== "text")) {
    const bKey = bufferKey(customerPhone, workspaceId);

    const processBufferedMessages = async (bufferedMsgs: IncomingMessage[]) => {
      // Bruno 2026-06-07: re-check FRESCO de controle humano no flush — se um
      // humano assumiu DURANTE a janela de debounce, o bot NÃO fala por cima.
      try {
        if (await isConvUnderHumanControl(conversationId, workspaceId)) {
          console.log(`[MessageBuffer] ABORT bot: conv=${conversationId} sob controle humano (flush)`);
          return;
        }
      } catch (e: any) { console.error("[MessageBuffer] human-control re-check failed:", e?.message); }

      const lastMsg = bufferedMsgs[bufferedMsgs.length - 1];
      const combinedTexts = bufferedMsgs
        .map(m => m.content)
        .filter(c => c && !isPlaceholderText(c))
        .filter(Boolean);

      const uniqueTexts: string[] = [];
      const seen = new Set<string>();
      for (const t of combinedTexts) {
        const norm = t.trim().toLowerCase();
        if (!seen.has(norm)) {
          seen.add(norm);
          uniqueTexts.push(t);
        }
      }

      const combinedContent = uniqueTexts.join("\n");
      const lastButtonId = bufferedMsgs.map(m => m.buttonId).filter(Boolean).pop() || null;

      // Bruno 2026-06-01 (audit print Elisangela): cliente mandou comprovante
      // (imagem) e logo depois "Bom dia". O buffer coalesce as duas mensagens,
      // mas o mediaContext era montado SÓ a partir do lastMsg — que é o texto
      // → media_url=undefined, type='text'. A imagem sumia, o mediaForV2 ficava
      // null no automationEngine e o comprovanteVisionValidator nunca disparava
      // → bot respondia só ao "Bom dia". Fix: preserva a mídia de QUALQUER
      // mensagem da rajada (a última que tiver mídia), mantendo o texto
      // combinado como caption. Comprovante é o foco, não a saudação.
      const mediaMsg = selectBurstMedia(bufferedMsgs);

      // PII (Bruno 2026-06-13, auditoria): não loga conteúdo da mensagem nem URL
      // de mídia (path de /uploads) — só telefone mascarado + tamanho + tipo.
      console.log(`[MessageBuffer] Processing ${bufferedMsgs.length} msgs for phone=${maskPhone(customerPhone)} (len=${combinedContent.length})${lastButtonId ? `, buttonId=${lastButtonId}` : ""}${mediaMsg !== lastMsg ? `, media=${mediaMsg.type}` : ""}`);

      const capturedData = {
        workspaceId: lastMsg.workspaceId,
        conversationId: lastMsg.conversationId,
        leadId: lastMsg.leadId,
        leadNome: lastMsg.leadNome,
        customerPhone: lastMsg.customerPhone,
        conexaoId: lastMsg.conexaoId,
        conexaoAutomacaoId: lastMsg.conexaoAutomacaoId,
        content: combinedContent || lastMsg.content,
        mediaContext: {
          type: mediaMsg.type as "text" | "image" | "audio" | "document",
          text: combinedContent || lastMsg.content,
          media_url: mediaMsg.mediaUrl || undefined,
          media_type: mediaMsg.mediaType || undefined,
          filename: mediaMsg.filename || undefined,
        },
        metaAccessToken: lastMsg.metaAccessToken,
        buttonId: lastButtonId,
      };

      try {
        const existingPending = await storage.getPendingInputByPhone(
          capturedData.customerPhone,
          capturedData.workspaceId
        );
        if (existingPending) {
          const pendingAge = existingPending.createdAt ? Date.now() - new Date(existingPending.createdAt).getTime() : 0;
          const MAX_PENDING_AGE = 5 * 60 * 1000;
          if (pendingAge > MAX_PENDING_AGE) {
            console.log(`[MessageProcessor] Cleaning stale pending input (age=${Math.round(pendingAge/1000)}s) for phone=${capturedData.customerPhone}`);
            await storage.deletePendingInput(existingPending.id);
          } else {
            console.log(`[MessageProcessor] SKIP automation: existingPending for phone=${capturedData.customerPhone}, age=${Math.round(pendingAge/1000)}s`);
            return;
          }
        }

        const auto = await storage.getAutomacao(
          String(capturedData.conexaoAutomacaoId),
          capturedData.workspaceId
        );
        if (auto && auto.status === "ACTIVE") {
          const nodesArr = Array.isArray(auto.nodes) ? (auto.nodes as any[]) : [];
          const triggerNode = nodesArr.find((n: any) => n.type === "trigger");
          if (triggerNode) {
            const latestMessages = await storage.getMessages(capturedData.conversationId, { limit: 20 });
            const lastUserMsgs: any[] = [];
            for (let i = latestMessages.length - 1; i >= 0; i--) {
              if (latestMessages[i].direction === "in") {
                lastUserMsgs.unshift(latestMessages[i]);
              } else break;
            }
            const dbCombinedText = lastUserMsgs
              .map((m) => m.texto)
              .filter(Boolean)
              .join("\n");

            const { runFlowFromNode } = await import("./automationEngine");
            // Bruno 2026-06-13: heartbeat de "digitando" durante o RACIOCÍNIO do
            // agente (LLM + ERP) — é aqui que mora o tempo de espera. Mantém o
            // typing vivo (re-emite a cada 4s) nos dois canais até a resposta sair;
            // stop garantido no finally (cobre erro/escala/silêncio). O ispSendService
            // ainda faz o typing por-parte no envio (pacing humanizado).
            startTypingLoop({
              workspaceId: capturedData.workspaceId,
              to: capturedData.customerPhone,
              conversationId: capturedData.conversationId,
              conexaoId: capturedData.conexaoId != null ? String(capturedData.conexaoId) : undefined,
            });
            const ctx = {
              workspaceId: capturedData.workspaceId,
              leadId: capturedData.leadId,
              phone: capturedData.customerPhone,
              conexaoId: capturedData.conexaoId != null ? String(capturedData.conexaoId) : undefined,
              conversationId: capturedData.conversationId,
              message: {
                ...capturedData.mediaContext,
                text: dbCombinedText || capturedData.content,
              },
              variables: {
                nome: capturedData.leadNome || capturedData.customerPhone,
                telefone: capturedData.customerPhone,
                messageText: dbCombinedText || capturedData.content,
                buttonId: capturedData.buttonId || null,
              },
              executionId: randomUUID(),
              metaAccessToken: capturedData.metaAccessToken,
            };
            try {
              await runFlowFromNode(auto.id, nodesArr, triggerNode.id, ctx as any);
            } finally {
              stopTypingLoop(capturedData.conversationId);
            }
          }
        }
      } catch (autoErr: any) {
        console.error("[MessageProcessor] Automation error:", autoErr.message);
      } finally {
        // Garante o stop mesmo se o erro ocorrer antes do runFlowFromNode (ex:
        // getAutomacao/getMessages). Idempotente. A trava de 45s é só backstop.
        stopTypingLoop(capturedData.conversationId);
      }
    };

    // Bruno 2026-06-13: "digitando" IMEDIATO assim que o cliente fala — já passamos
    // o guard de controle humano (intake) e o bot vai processar. Cobre a janela de
    // debounce ANTES do agente rodar; o heartbeat contínuo entra junto do agente
    // (startTypingLoop em processBufferedMessages). No Evolution isso elimina o
    // delay do "digitando" no início; no Meta o webhook já disparou no markAsRead.
    pingTyping({ workspaceId, to: customerPhone, conversationId, conexaoId: conexaoId != null ? String(conexaoId) : undefined });

    const humanizeCfg = await getHumanizeConfig(workspaceId);
    console.log(`[MessageProcessor] Buffering message for conv=${conversationId}, phone=${customerPhone} (base=${humanizeCfg.coalescenceWindowMs}ms, cap=${humanizeCfg.coalescenceMaxMs}ms)`);
    addToBuffer(bKey, msg, processBufferedMessages, humanizeCfg, workspaceId, customerPhone);
  }

  if (!conversationPipeline && content) {
    await applySupportKeywordRouting(workspaceId, conversationId, leadId, content);
  }
}

// Bruno 2026-06-28: CRM virou genérico, o trilho "suporte" foi aposentado.
// Esta rota (ex-classificador de suporte) deixa de jogar a conversa num pipeline
// inexistente e passa a só garantir que um contato sem trilho caia no Comercial,
// na etapa "Novo" (stageKey UNIVERSAL — nunca um label, pra não furar o
// getPrefix/bloqueio do bot). Não atribui mais a "equipe de suporte".
async function applySupportKeywordRouting(
  wsId: string,
  conversationId: number,
  leadId: number,
  messageText: string
): Promise<void> {
  // Só age quando a mensagem parece um pedido de atendimento (mantém o gate
  // original — não força TODA conversa sem trilho pro Comercial aqui; o fluxo
  // normal do bot/automação já cuida disso).
  const atendimentoKw =
    /\b(suporte|ajuda|problema|duvida|dúvida|erro|bug|nao funciona|não funciona|nao consigo|não consigo|reclamacao|reclamação|defeito|travou|caiu|quebrou|socorro)\b/i;
  if (!atendimentoKw.test(messageText)) return;

  try {
    const { pipelineStages, leads, conversations } = await import("@shared/schema");

    const comStages = await db
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.workspaceId, wsId), eq(pipelineStages.pipeline, "comercial")));
    // Etapa universal "Novo" (key novo_<wsPfx>). Fallback p/ qualquer stage.
    const novoStage = comStages.find((s) => s.key.replace(/_[a-f0-9]{8}$/, "") === "novo") || comStages[0];
    if (!novoStage) return;

    await db
      .update(leads)
      .set({ status: novoStage.key, pipeline: "comercial", prioridade: "media" })
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, wsId)));

    await db
      .update(conversations)
      .set({ pipeline: "comercial", pipelineEtapa: novoStage.key, prioridade: "media" })
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, wsId)));

    try {
      broadcastToWorkspace(wsId, "conversation_updated", {
        conversationId,
        pipeline: "comercial",
        pipelineEtapa: novoStage.key,
        prioridade: "media",
      });
    } catch (e: any) { console.error("[MessageProcessor] broadcast fallback update failed:", e.message); }
  } catch (sfErr: any) {
    console.error("[MessageProcessor] Comercial fallback error:", sfErr.message);
  }
}

export async function handlePendingInteractiveResponse(
  workspaceId: string,
  customerPhone: string,
  selectedId: string,
  content: string,
  conversationId?: number
): Promise<boolean> {
  try {
    const pending = await storage.getPendingInputByPhone(customerPhone, workspaceId);
    if (!pending) return false;

    const autoCheck = await storage.getAutomacao(pending.flowId, workspaceId);
    if (!autoCheck || autoCheck.status !== "ACTIVE") {
      await storage.deletePendingInput(pending.id);
      return false;
    }

    if (selectedId) {
      const { resumeAutomationFlow } = await import("./automationEngine");
      await storage.deletePendingInput(pending.id);
      await resumeAutomationFlow(pending, selectedId);
      return true;
    }
  } catch (err: any) {
    console.error("[MessageProcessor] Interactive response error:", err.message);
  }
  return false;
}
