import { db } from '../db';
import { conversations, leads } from '../../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { broadcastToWorkspace } from './broadcast';
import { OPTIONAL_PIPELINE_KEYS } from './sectors/optionalSectors';

const STAGE_PREFIXES = ['novo', 'em_automacao', 'aguardando', 'atendimento_humano', 'finalizado'] as const;
export type StagePrefix = typeof STAGE_PREFIXES[number];

export const STAGE_LABELS: Record<StagePrefix, string> = {
  novo: 'Novo',
  em_automacao: 'Em Automação',
  aguardando: 'Aguardando',
  atendimento_humano: 'Atendimento Humano',
  finalizado: 'Finalizado',
};

// Bruno 2026-06-11: + setores opcionais (vendas/retencao/suporte_n2). Ficam
// sempre na lista de trilhos válidos; só existem de fato se o tenant os ativou
// (cria pipeline+equipe). Sem ativação = nenhuma conversa cai neles → inerte.
const VALID_PIPELINES = new Set(['suporte', 'financeiro', 'comercial', ...OPTIONAL_PIPELINE_KEYS]);

export function getPrefix(stageKey: string | null | undefined): StagePrefix | null {
  if (!stageKey) return null;
  // Bruno 2026-05-19 (conv 202605190006): etapas reais em produção são tipo
  // `atendimento_humano_fin`, `atendimento_humano_sup`, `atendimento_humano_com`
  // (sufixo de 3 chars indicando o setor — fin/sup/com). A regex só removia
  // sufixo hex de 8 chars (`_a1b2c3d4`) e ignorava esses 3-char — o resultado
  // era `getPrefix` retornar null pra `atendimento_humano_fin` e o guard
  // `isAgentBlockedByStage` NÃO bloqueava o bot quando humano já tinha
  // assumido. Bug sintoma: cliente respondia "Amém", engine processava e
  // zerava `assignedUserId` via `stampBotIdentity` → conv voltava pra fila.
  let prefix = stageKey.replace(/_[a-f0-9]{8}$/, '');
  prefix = prefix.replace(/_(com|fin|sup|can)$/, '');
  return (STAGE_PREFIXES as readonly string[]).includes(prefix) ? (prefix as StagePrefix) : null;
}

async function loadConv(workspaceId: string, conversationId: number) {
  const [conv] = await db.select({
    id: conversations.id,
    pipeline: conversations.pipeline,
    pipelineEtapa: conversations.pipelineEtapa,
    assignedUserId: conversations.assignedUserId,
    telefone: conversations.telefone,
    nome: conversations.nome,
    status: conversations.status,
  }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  return conv || null;
}

// Mapeia o ai_intent persistido na sessão para o pipeline correspondente.
// Usado como fallback quando conversations.pipeline ainda não foi gravado
// (ex: tag F/S/C aplicada em fire-and-forget, conversa reaberta após ENCERRADO).
const INTENT_TO_PIPELINE: Record<string, string> = {
  FINANCEIRO: 'financeiro',
  SUPORTE_TECNICO: 'suporte',
  SUPORTE: 'suporte',
  VENDAS: 'comercial',
  COMERCIAL: 'comercial',
  CANCELAMENTO: 'comercial',
};

async function resolvePipelineFromSession(_workspaceId: string, _conversationId: number, _telefone: string | null): Promise<string | null> {
  // ISP removido: sessão (ispMemoryService) não existe mais. Sem fonte de
  // intent persistido, retorna null — callers já tratam null com fallback.
  return null;
}

export async function transitionStage(workspaceId: string, conversationId: number, targetPrefix: StagePrefix, trigger: string): Promise<void> {
  const conv = await loadConv(workspaceId, conversationId);
  if (!conv) return;

  let pipelineKey = conv.pipeline?.toLowerCase() || null;
  if (!pipelineKey || !VALID_PIPELINES.has(pipelineKey)) {
    // Fallback: descobre pelo ai_intent da sessão
    pipelineKey = await resolvePipelineFromSession(workspaceId, conversationId, conv.telefone);
    if (!pipelineKey || !VALID_PIPELINES.has(pipelineKey)) {
      // Último recurso: usa pipeline 'geral' (default operacional)
      pipelineKey = 'geral';
    }
    if (!VALID_PIPELINES.has(pipelineKey)) return;
    console.log(`[PipelineSM] conv=${conversationId} trigger=${trigger}: pipeline ausente — fallback=${pipelineKey}`);
  }

  const currentPrefix = getPrefix(conv.pipelineEtapa);
  if (currentPrefix === targetPrefix) return;

  const { upsertPipelineLead } = await import('./suportePipelineService');
  const phone = (conv.telefone || '').replace(/\D/g, '');
  if (!phone) return;

  console.log(`[PipelineSM] conv=${conversationId} trigger=${trigger}: ${currentPrefix || 'none'} → ${targetPrefix} (pipeline=${pipelineKey})`);

  await upsertPipelineLead(pipelineKey as any, {
    workspaceId,
    conversationId,
    phone,
    contactName: conv.nome || '',
    etapa: targetPrefix,
  });
}

/**
 * Chamado APÓS o agente (bot) enviar uma resposta com sucesso.
 * Regra:
 *   - novo → em_automacao (primeira resposta do agente sai do "Novo")
 *   - aguardando → em_automacao (agente respondeu de novo, sai de aguardando)
 *
 * NÃO move atendimento_humano → em_automacao (Bruno, 2026-05-11): toda
 * escalação humana entra em FILA e fica em fila até atendente assumir.
 * A mensagem de handoff/despedida do agente NÃO pode tirar a conv de
 * atendimento_humano — antes essa regra mandava de volta pra em_automacao,
 * apagando a tag visual de fila no Kanban e somindo da view de atendentes.
 */
export async function onAgentReply(workspaceId: string, conversationId: number): Promise<void> {
  try {
    const conv = await loadConv(workspaceId, conversationId);
    if (!conv) return;
    if (conv.assignedUserId) return; // humano assumiu, agente não muda mais nada
    const prefix = getPrefix(conv.pipelineEtapa);
    if (prefix === 'novo' || prefix === 'aguardando' || prefix === null) {
      await transitionStage(workspaceId, conversationId, 'em_automacao', 'agent_reply');
    }
    // atendimento_humano: NÃO transiciona (permanece em fila aguardando humano)
  } catch (err: any) {
    console.error('[PipelineSM] onAgentReply error:', err.message);
  }
}

/**
 * Chamado quando o agente escala para humano (HUMANO redirect ou fluxo_atual='HUMANO').
 * Move SEMPRE para 'atendimento_humano', independente do prefix atual.
 * Se a conversa ainda nao tem pipeline, usa o hint/intent pra resolver o pipeline.
 */
export async function onEscalateToHumano(
  workspaceId: string,
  conversationId: number,
  pipelineHint?: string,
): Promise<void> {
  try {
    const conv = await loadConv(workspaceId, conversationId);
    if (!conv) return;

    let pipelineKey = conv.pipeline?.toLowerCase() || null;
    // Bruno (2026-05-13, print S9 troca-aparelho): quando cliente reabre conv
    // e muda de setor (ex: VENDAS → SUPORTE_TECNICO), o agente correto roda
    // e passa pipelineHint='suporte', mas conv.pipeline ainda está 'comercial'
    // (resíduo da interação anterior). Sem honrar o hint, o handoff vai pra
    // fila errada: card aparece em Comercial, equipe Comercial é atribuída e
    // a fila do Suporte fica vazia. Migrar quando hint difere do atual.
    if (pipelineHint && VALID_PIPELINES.has(pipelineHint.toLowerCase())
      && pipelineKey !== pipelineHint.toLowerCase()) {
      console.log(`[PipelineSM] conv=${conversationId} migração de setor: pipeline=${pipelineKey || 'none'} → ${pipelineHint.toLowerCase()} (hint da escalação humana)`);
      pipelineKey = pipelineHint.toLowerCase();
    }
    if (!pipelineKey || !VALID_PIPELINES.has(pipelineKey)) {
      pipelineKey = await resolvePipelineFromSession(workspaceId, conversationId, conv.telefone);
      if (!pipelineKey || !VALID_PIPELINES.has(pipelineKey)) {
        pipelineKey = 'comercial';
      }
    }

    const phone = (conv.telefone || '').replace(/\D/g, '');
    if (!phone) return;

    const currentPrefix = getPrefix(conv.pipelineEtapa);

    // Bruno 2026-05-21 (revisão raiz, print "em fila" pós cliente responder):
    // ATENDENTE HUMANO JÁ ASSUMIU → bloqueia qualquer re-escalação.
    // Conversa com assignedUserId setado está "Em andamento" no UI. Se um
    // applySituation('AH') ou outro caller chama onEscalateToHumano por algum
    // motivo (tag nova após inbound, side-effect), NÃO devolve a conv pra
    // fila — atendente cuidando > qualquer tag nova.
    if (conv.assignedUserId) {
      console.log(`[PipelineSM] conv=${conversationId} SKIP escalation — assignedUserId=${conv.assignedUserId} (atendente em andamento)`);
      return;
    }

    if (currentPrefix === 'atendimento_humano' && conv.pipeline?.toLowerCase() === pipelineKey) return;

    const { upsertPipelineLead } = await import('./suportePipelineService');
    console.log(`[PipelineSM] conv=${conversationId} trigger=escalation: ${currentPrefix || 'none'} → atendimento_humano (pipeline=${pipelineKey})`);
    await upsertPipelineLead(pipelineKey as any, {
      workspaceId,
      conversationId,
      phone,
      contactName: conv.nome || '',
      etapa: 'atendimento_humano',
    });
  } catch (err: any) {
    console.error('[PipelineSM] onEscalateToHumano error:', err.message);
  }
}

/**
 * Chamado quando o cliente envia uma mensagem (inbound).
 * Regra:
 *   - aguardando → em_automacao (cliente voltou a responder)
 */
export async function onCustomerReply(workspaceId: string, conversationId: number): Promise<void> {
  try {
    const conv = await loadConv(workspaceId, conversationId);
    if (!conv) return;
    if (conv.assignedUserId) return; // humano em atendimento — cliente respondendo ao humano
    const prefix = getPrefix(conv.pipelineEtapa);
    if (prefix === 'aguardando') {
      await transitionStage(workspaceId, conversationId, 'em_automacao', 'customer_reply');
    }
  } catch (err: any) {
    console.error('[PipelineSM] onCustomerReply error:', err.message);
  }
}

/**
 * Verifica se o agente (bot) deve PARAR de processar essa conversa.
 *
 * REGRA ABSOLUTA — Bruno 2026-05-19 (conv #202605190008):
 *
 *   Uma vez que o atendimento entrou em "atendimento humano" (atribuído OU em
 *   FILA pós-escalação), o bot NUNCA volta a responder automaticamente.
 *   A única forma do bot retornar é o atendente LIBERAR manualmente
 *   (POST /api/conversations/:id/transfer com targetUserId=null) — que zera
 *   assignedUserId E volta pipelineEtapa pra em_automacao_<setor>.
 *
 *   Por que: caso real conv 202605190008 — atendente assumiu, mandou áudio,
 *   cliente respondeu, mas o bot voltou a responder e tomou a conv de volta
 *   (a regra anterior LIBERAVA bot quando assignedUserId era null mesmo em
 *   atendimento_humano, na expectativa que assignedUserId estaria sempre
 *   setado quando humano assumia — mas existem caminhos onde o assignment
 *   some sem trazer o bot de volta intencionalmente).
 *
 * Bloqueia se QUALQUER um for verdade:
 *   - aiPaused = true (pausa manual)
 *   - assignedUserId != null (humano assumiu)
 *   - pipelineEtapa = finalizado
 *   - pipelineEtapa = atendimento_humano (em fila aguardando humano — também
 *     bloqueado; o bot NUNCA "recupera" a conv automaticamente após handoff)
 *
 * Libera se TODOS estão falsos. Quando atendente clica "Liberar atendimento":
 * o handler do release move a etapa pra em_automacao e bot volta a responder.
 */
export async function isAgentBlockedByStage(workspaceId: string, conversationId: number): Promise<boolean> {
  try {
    const [conv] = await db.select({
      pipelineEtapa: conversations.pipelineEtapa,
      aiPaused: conversations.aiPaused,
      assignedUserId: conversations.assignedUserId,
    }).from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
      .limit(1);
    if (!conv) return false;
    if (conv.aiPaused) return true;
    if (conv.assignedUserId) return true;
    const prefix = getPrefix(conv.pipelineEtapa);
    if (prefix === 'finalizado') return true;
    // REGRA ABSOLUTA: atendimento_humano (mesmo em FILA sem atribuição) trava
    // o bot. Só libera via release manual do atendente.
    if (prefix === 'atendimento_humano') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Cron periódico: identifica conversas que estão em "em_automacao" mas onde o
 * cliente está sem responder há mais de N minutos desde a última msg do agente,
 * e move pra "aguardando".
 *
 * Regra: conta a partir da última mensagem outbound do agente/atendente.
 */
export async function tickAguardandoTimer(thresholdMs: number = 3 * 60 * 1000): Promise<void> {
  try {
    const cutoffIso = new Date(Date.now() - thresholdMs).toISOString();

    // Busca conversas: status open, não atribuídas a humano, etapa em_automacao, sem msg do cliente
    // após a última msg do agente, e a última msg do agente é mais antiga que o cutoff.
    const rows = await db.execute<any>(sql`
      WITH last_msgs AS (
        SELECT
          m.conversation_id,
          MAX(CASE WHEN m.direction = 'out' THEN m.created_at END) AS last_out,
          MAX(CASE WHEN m.direction = 'in'  THEN m.created_at END) AS last_in
        FROM messages m
        WHERE m.created_at > NOW() - INTERVAL '1 day'
        GROUP BY m.conversation_id
      )
      SELECT
        c.id            AS id,
        c.workspace_id  AS workspace_id,
        c.pipeline      AS pipeline,
        c.telefone      AS telefone,
        c.nome          AS nome,
        c.pipeline_etapa AS pipeline_etapa,
        lm.last_out     AS last_out,
        lm.last_in      AS last_in
      FROM conversations c
      JOIN last_msgs lm ON lm.conversation_id = c.id
      WHERE c.status = 'open'
        AND c.assigned_user_id IS NULL
        AND c.ai_paused = false
        AND c.pipeline IS NOT NULL
        AND c.pipeline_etapa LIKE 'em_automacao_%'
        AND lm.last_out IS NOT NULL
        AND lm.last_out < ${cutoffIso}::timestamp
        AND (lm.last_in IS NULL OR lm.last_in < lm.last_out)
      LIMIT 100
    `);

    const list: any[] = (rows as any).rows || (rows as any) || [];
    if (!list.length) return;

    const { upsertPipelineLead } = await import('./suportePipelineService');
    for (const row of list) {
      try {
        const wsId = row.workspace_id;
        const convId = Number(row.id);
        const pipeline = String(row.pipeline || '').toLowerCase();
        if (!VALID_PIPELINES.has(pipeline)) continue;
        const phone = String(row.telefone || '').replace(/\D/g, '');
        if (!phone) continue;
        const ageMin = Math.round((Date.now() - new Date(row.last_out).getTime()) / 60000);
        console.log(`[PipelineSM] ⏰ AGUARDANDO conv=${convId}: ${ageMin}min sem resposta → em_automacao→aguardando`);
        await upsertPipelineLead(pipeline as any, {
          workspaceId: wsId,
          conversationId: convId,
          phone,
          contactName: row.nome || '',
          etapa: 'aguardando',
        });
      } catch (err: any) {
        console.error('[PipelineSM] tick row error:', err.message);
      }
    }
  } catch (err: any) {
    console.error('[PipelineSM] tickAguardandoTimer error:', err.message);
  }
}

let _aguardandoCronStarted = false;
export function startAguardandoCron(intervalMs: number = 60 * 1000): void {
  if (_aguardandoCronStarted) return;
  _aguardandoCronStarted = true;
  console.log(`[PipelineSM] ⏰ Aguardando timer started (3min threshold, ${intervalMs / 1000}s tick)`);
  setInterval(() => {
    tickAguardandoTimer().catch(() => {});
  }, intervalMs);
  // first tick after 10s to avoid boot stampede
  setTimeout(() => { tickAguardandoTimer().catch(() => {}); }, 10000);
}
