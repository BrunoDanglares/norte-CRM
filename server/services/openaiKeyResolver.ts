import { db } from '../db';
import { integrationConfigs, notificacoes } from '../../shared/schema';
import { eq, and, gt } from 'drizzle-orm';
import { storage } from '../storage';

export interface OpenAIKeyCandidate {
  apiKey: string;
  baseURL: string;
  source: string;
}

// ── Circuit breaker para chaves OpenAI com quota esgotada (429) ─────────────
// Quando uma chave retorna 429, é bloqueada por QUOTA_COOLDOWN_MS.
// Isso elimina o delay de tentar uma chave inválida em toda requisição.
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos
const _quotaFailed = new Map<string, number>(); // apiKey prefix → timestamp

// Bruno 2026-05-30 (Onda 1 escalabilidade — resiliência prod): falhas
// transitórias (timeout, 5xx, network blip) também devem colocar a key em
// cooldown CURTO. Sem isso, em outage OpenAI TODAS as requests gastam
// timeout-cap (15-25s) ANTES de falhar — pool DB fica preso durante esse
// tempo → cascading failure → produção morre. Cooldown curto (30s) faz a
// próxima request DESVIAR pra fallback imediato, libera pool DB.
const TRANSIENT_COOLDOWN_MS = 30 * 1000; // 30s — curto pra recuperar rápido
const TRANSIENT_THRESHOLD = 3;            // 3 falhas seguidas abrem o circuit
const _transientFailures = new Map<string, { count: number; openedAt?: number }>();

export function markKeyQuotaExceeded(apiKey: string, workspaceId?: string): void {
  const prefix = apiKey.substring(0, 20);
  _quotaFailed.set(prefix, Date.now());
  if (workspaceId) {
    // fire-and-forget — alerta o workspace uma vez por janela de 15min
    alertOpenAiQuotaExceeded(workspaceId).catch(() => {});
  }
}

// Bruno 2026-05-30: marca falha transitória (timeout/5xx/network). Quando
// atinge TRANSIENT_THRESHOLD, abre o circuit por TRANSIENT_COOLDOWN_MS.
// Sucesso reseta o contador.
export function markKeyTransientFailure(apiKey: string): void {
  const prefix = apiKey.substring(0, 20);
  const state = _transientFailures.get(prefix) ?? { count: 0 };
  state.count++;
  if (state.count >= TRANSIENT_THRESHOLD && !state.openedAt) {
    state.openedAt = Date.now();
    console.warn(`[OpenAIKeyResolver] 🔌 Circuit aberto pra key=${prefix} após ${state.count} falhas transitórias`);
  }
  _transientFailures.set(prefix, state);
}

export function markKeyTransientSuccess(apiKey: string): void {
  const prefix = apiKey.substring(0, 20);
  if (_transientFailures.has(prefix)) {
    _transientFailures.delete(prefix);
  }
}

export function isKeyQuotaExceeded(apiKey: string): boolean {
  const prefix = apiKey.substring(0, 20);
  // 1) Quota cooldown (429 — 5min)
  const failedAt = _quotaFailed.get(prefix);
  if (failedAt) {
    if (Date.now() - failedAt > QUOTA_COOLDOWN_MS) {
      _quotaFailed.delete(prefix);
    } else {
      return true;
    }
  }
  // 2) Transient cooldown (timeout/5xx — 30s). Bruno 2026-05-30 (Onda 1).
  const transient = _transientFailures.get(prefix);
  if (transient?.openedAt) {
    if (Date.now() - transient.openedAt > TRANSIENT_COOLDOWN_MS) {
      // Tenta fechar — uma request teste vai passar; se OK, success limpa.
      _transientFailures.delete(prefix);
      return false;
    }
    return true;
  }
  return false;
}

// Dedup: uma notificação de quota esgotada por workspace a cada 15 minutos.
const ALERT_DEDUP_WINDOW_MS = 15 * 60 * 1000;

async function alertOpenAiQuotaExceeded(workspaceId: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - ALERT_DEDUP_WINDOW_MS);
    const existing = await db
      .select({ id: notificacoes.id })
      .from(notificacoes)
      .where(and(
        eq(notificacoes.workspaceId, workspaceId),
        eq(notificacoes.tipo, 'openai_quota_exceeded'),
        gt(notificacoes.createdAt, cutoff),
      ))
      .limit(1);
    if (existing.length > 0) return;

    await storage.createNotificacao({
      tipo: 'openai_quota_exceeded',
      categoria: 'Sistema',
      titulo: 'Créditos da OpenAI esgotados',
      mensagem: 'A IA não está conseguindo responder porque a chave da OpenAI atingiu o limite de uso. Adicione créditos na conta ou atualize a chave em Integrações.',
      link: '/integracoes',
      iconKey: 'alert-triangle',
      workspaceId,
    });
    console.warn(`[OpenAIKeyResolver] 🚨 Alerta criado: créditos OpenAI esgotados (workspace=${workspaceId})`);
  } catch (err: any) {
    console.error(`[OpenAIKeyResolver] Falha ao criar alerta de quota: ${err.message}`);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveOpenAIKeys(workspaceId?: string): Promise<OpenAIKeyCandidate[]> {
  const candidates: OpenAIKeyCandidate[] = [];

  if (workspaceId) {
    try {
      const configs = await storage.getIntegrationConfigs(workspaceId);
      for (const cfg of configs) {
        if (cfg.integrationId === 'openai' && cfg.enabled && (cfg.config as any)?.apiKey) {
          candidates.push({
            apiKey: (cfg.config as any).apiKey,
            baseURL: 'https://api.openai.com/v1',
            source: 'db_workspace',
          });
          break;
        }
      }
    } catch (err: any) {
      console.error(`[OpenAIKeyResolver] Erro ao buscar config do workspace: ${err.message}`);
    }
  }

  const envKey = process.env.OPENAI_API_KEY || '';
  if (envKey) {
    candidates.push({ apiKey: envKey, baseURL: 'https://api.openai.com/v1', source: 'env_OPENAI_API_KEY' });
  }

  const aiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || '';
  const aiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || '';
  if (aiKey) {
    candidates.push({ apiKey: aiKey, baseURL: aiBase || 'https://api.openai.com/v1', source: 'ai_integrations' });
  }

  return candidates;
}

export interface TranscriptionCandidate extends OpenAIKeyCandidate {
  model: string;
}

export async function resolveTranscriptionCandidates(workspaceId?: string): Promise<TranscriptionCandidate[]> {
  const base = await resolveOpenAIKeys(workspaceId);
  return base.map(c => ({
    ...c,
    model: c.source === 'ai_integrations' ? 'gpt-4o-mini-transcribe' : 'whisper-1',
  }));
}
