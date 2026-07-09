// Agent trace — timeline de decisões do agente por conversa.
//
// Ferramenta INTERNA de diagnóstico (sem UI). Cada decisão crítica do
// engine/agentes grava uma linha em `agent_trace_events`. Permite, dada
// uma conversa que deu errado, reconstruir a sequência completa de
// decisões: o que o classifier devolveu, qual regra disparou, qual
// agente foi despachado, qual tag aplicada, qual mensagem saiu.
//
// Consulta via `tsx scripts/trace.ts <conversationId>` ou query direta.
// Auto-purge >30d no boot scheduler.
//
// Princípio: NUNCA pode bloquear o turno do agente. Fire-and-forget
// puro — erros engolidos silenciosamente. Observabilidade não pode
// quebrar produto.

import { db } from "../db";
import { agentTraceEvents } from "../../shared/schema";

// Lista canônica de stages — facilita grep/filtro e mantém consistência.
// Pra adicionar um stage novo, adicione aqui E plugue o `traceAgent()` no
// ponto do código que o produz.
export const TRACE_STAGES = {
  // Entrada
  INBOUND_RECEIVED:        'inbound_received',         // mensagem nova chegou
  REOPEN_DETECTED:         'reopen_detected',          // conv estava resolved, reabriu
  DEDUP_BLOCKED:           'dedup_blocked',            // replay defensivo bloqueou
  ISP_AGENT_ENTRY:         'isp_agent_entry',          // runISPAgent foi chamado (diagnóstico de trava silent)
  ISP_AGENT_EXIT:          'isp_agent_exit',           // runISPAgent retornou (diagnóstico)
  ORPHAN_REPLAY_TRIGGERED: 'orphan_replay_triggered',  // boot replay disparou pra msg órfã (audit conv #1009)

  // Classificação
  AI_CLASSIFIER:           'ai_classifier',            // aiClassifyDepartment retornou
  SLOWNESS_PRECLASSIFY:    'slowness_preclassify',     // pre-classify S4-S7 rodou
  CROSS_SECTOR:            'cross_sector',             // embedding cross-sector hit
  INTENT_GATEWAY:          'intent_gateway',           // detectIntentShiftAsync decidiu

  // Roteamento
  INFORMATIONAL_RESOLVER:  'informational_resolver',   // resolver interceptou OU bypass
  BYPASS_RESOLVER:         'bypass_resolver',          // ex: askingForPlanos
  AGENT_DISPATCHED:        'agent_dispatched',         // qual agente V1 foi chamado
  HANDLE_NOVO_CLIENTE:     'handle_novo_cliente',      // engine despachou pra handleNovoCliente

  // Ações
  COVERAGE_CHECK:          'coverage_check',           // verifyAndPresentCoverage rodou
  C11_CHECKLIST_SENT:      'c11_checklist_sent',       // checklist enviado
  C11_PARSE:               'c11_parse',                // parseChecklistResponse
  ERP_CALL:                'erp_call',                 // chamada ERP (sgp-adapter)
  ERP_CUSTOMER_SNAPSHOT:   'erp_customer_snapshot',    // snapshot do ERP pós-id (fonte da verdade p/ o LLM-juiz de QA)
  FAQ_HIT:                 'faq_hit',                  // FAQ matcher acertou
  TRY_PARALLEL_QUESTION:   'try_parallel_question',    // FAQ inline em coleta

  // Estado / Tags
  TAGS_APPLIED:            'tags_applied',             // applyAutoTag aplicou
  SESSION_UPDATE:          'session_update',           // mudança crítica em dados_coletados
  PROTOCOL_CREATED:        'protocol_created',         // ensureProtocolAndPriority criou
  PROTOCOL_CLOSED:         'protocol_closed',          // closeConvProtocol fechou

  // Consultive (Camada 9 V2) — observabilidade Bruno 2026-05-25
  CONSULTATIVE_SHORTCUT:   'consultative_shortcut',    // FAQ/Quest/DataTool respondeu sem LLM
  CONSULTATIVE_LLM:        'consultative_llm',         // generateConsultativeAnswer rodou (texto saiu)
  CONSULTATIVE_ESCALATE:   'consultative_escalate',    // LLM falhou ou promessa detectada → handoff

  // Saída
  OUTBOUND_SENT:           'outbound_sent',            // mensagem do agente saiu
  HANDOFF:                 'handoff',                  // escalou pra humano
  CSAT_SENT:               'csat_sent',                // enviou CSAT
  NPS_QUEUED:              'nps_queued',               // enfileirou NPS

  // Fase 2 (sovereignIntent) — observabilidade
  SOVEREIGN_SHADOW:        'sovereign_shadow',         // Fase 2a: veredito do detector único (ZERO comportamento — só observa)

  // Erros
  ERROR:                   'error',                    // exceção em ponto crítico
} as const;

export type TraceStage = typeof TRACE_STAGES[keyof typeof TRACE_STAGES];

interface TraceOpts {
  workspaceId: string;
  conversationId: number | string;
  stage: TraceStage | string;
  data?: Record<string, any>;
  protocolId?: string | null;
}

// Sample rate via env. Default 1 (100% — grava tudo). Setar pra 0.1 (10%) em
// produção de alto volume se a tabela crescer demais. Stages críticos
// (`HANDOFF`, `ERROR`) ignoram sample rate — sempre gravam.
const CRITICAL_STAGES = new Set<string>([
  TRACE_STAGES.HANDOFF,
  TRACE_STAGES.ERROR,
  TRACE_STAGES.PROTOCOL_CREATED,
  TRACE_STAGES.PROTOCOL_CLOSED,
  TRACE_STAGES.ERP_CUSTOMER_SNAPSHOT, // QA: juiz precisa do dado real do ERP — nunca samplear fora
  TRACE_STAGES.SOVEREIGN_SHADOW,      // Fase 2a: medir o cego do botão sem perder eventos por sampling
]);

function getSampleRate(): number {
  const raw = process.env.AGENT_TRACE_SAMPLE_RATE;
  if (!raw) return 1;
  const n = parseFloat(raw);
  if (isNaN(n) || n < 0) return 1;
  return Math.min(n, 1);
}

// Kill switch — setar AGENT_TRACE=off pra desligar completamente.
function isEnabled(): boolean {
  return process.env.AGENT_TRACE !== 'off';
}

// Redact list — chaves do payload que devem ser truncadas/mascaradas. Evita
// vazar dados sensíveis no DB (cartão, senhas). CPF é OK porque o agente
// inteiro lida com CPF — ele já está em vários campos do banco.
const REDACT_KEYS = new Set([
  'senha', 'password', 'senha_wifi', 'wifi_senha',
  'cartao', 'cartao_credito', 'cvv', 'cvc',
]);

function sanitizePayload(data: Record<string, any> | undefined): Record<string, any> {
  if (!data) return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = typeof v === 'string' ? `[REDACTED:${v.length}c]` : '[REDACTED]';
      continue;
    }
    // Trunca strings longas a 500 chars pra não estourar payload
    if (typeof v === 'string' && v.length > 500) {
      out[k] = v.slice(0, 497) + '...';
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Grava um evento de trace. Fire-and-forget — NÃO retorna Promise propositalmente
 * pra que callers não precisem await. Erros são engolidos silenciosamente.
 *
 * Uso:
 *   traceAgent({
 *     workspaceId,
 *     conversationId,
 *     stage: TRACE_STAGES.AI_CLASSIFIER,
 *     data: { dept: 'VENDAS', sub: 'duvidas', conf: 0.83 },
 *   });
 */
export function traceAgent(opts: TraceOpts): void {
  if (!isEnabled()) return;

  // Sampling: critical stages sempre passam; demais respeitam rate
  if (!CRITICAL_STAGES.has(opts.stage)) {
    const rate = getSampleRate();
    if (rate < 1 && Math.random() > rate) return;
  }

  const convId = typeof opts.conversationId === 'string'
    ? parseInt(opts.conversationId, 10)
    : opts.conversationId;
  if (isNaN(convId)) return;

  // setImmediate desacopla do tick atual — INSERT roda no próximo tick,
  // sem atrasar a resposta ao cliente.
  setImmediate(() => {
    db.insert(agentTraceEvents).values({
      workspaceId: opts.workspaceId,
      conversationId: convId,
      protocolId: opts.protocolId ?? null,
      stage: opts.stage,
      payload: sanitizePayload(opts.data),
    }).catch((e: any) => {
      // Falha de DB não pode quebrar o produto. Loga uma vez por minuto no
      // máximo pra não floodar (suficiente pra alertar se algo grave).
      const now = Date.now();
      if (now - LAST_ERROR_LOG_AT > 60_000) {
        console.warn(`[AgentTrace] insert falhou (silenciado): ${e.message}`);
        LAST_ERROR_LOG_AT = now;
      }
    });
  });
}

let LAST_ERROR_LOG_AT = 0;

/**
 * Variante com Promise — pra casos onde o caller QUER esperar a gravação
 * (ex: testes, scripts). Em produção use `traceAgent` fire-and-forget.
 */
export async function traceAgentSync(opts: TraceOpts): Promise<void> {
  if (!isEnabled()) return;

  const convId = typeof opts.conversationId === 'string'
    ? parseInt(opts.conversationId, 10)
    : opts.conversationId;
  if (isNaN(convId)) return;

  try {
    await db.insert(agentTraceEvents).values({
      workspaceId: opts.workspaceId,
      conversationId: convId,
      protocolId: opts.protocolId ?? null,
      stage: opts.stage,
      payload: sanitizePayload(opts.data),
    });
  } catch (e: any) {
    console.warn(`[AgentTrace] traceAgentSync falhou: ${e.message}`);
  }
}

/**
 * Purge de eventos antigos. Chamado pelo scheduler no boot a cada N horas.
 * Default: deleta eventos > 30 dias. Override via env AGENT_TRACE_RETENTION_DAYS.
 */
export async function purgeOldTraceEvents(): Promise<{ deleted: number }> {
  const days = parseInt(process.env.AGENT_TRACE_RETENTION_DAYS || '30', 10);
  if (isNaN(days) || days < 1) return { deleted: 0 };

  try {
    const { sql: sqlOp } = await import('drizzle-orm');
    const result: any = await db.execute(
      sqlOp`DELETE FROM agent_trace_events WHERE created_at < NOW() - (${days} * INTERVAL '1 day')`,
    );
    const deleted = result?.rowCount || result?.rows?.length || 0;
    if (deleted > 0) {
      console.log(`[AgentTrace] 🧹 Purge: ${deleted} eventos antigos (>${days}d) removidos`);
    }
    return { deleted };
  } catch (e: any) {
    console.warn(`[AgentTrace] purge falhou: ${e.message}`);
    return { deleted: 0 };
  }
}
