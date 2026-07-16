import { db } from '../db';
import { leads, conversations, leadStageHistory } from '../../shared/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { storage } from '../storage';
import { broadcastToWorkspace } from './broadcast';

// ── Serialization queue para evitar race condition de leads duplicados ────────
// Quando duas chamadas concorrentes de upsertPipelineLead chegam para o mesmo
// (workspace, pipeline, telefone), a segunda aguarda a primeira terminar antes
// de checar/criar o lead. Isso elimina o problema de Lead #293 + Lead #294.
const _upsertLocks = new Map<string, Promise<void>>();

function withUpsertLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = _upsertLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn).catch(() => {}).finally(() => {
    if (_upsertLocks.get(key) === next) _upsertLocks.delete(key);
  });
  _upsertLocks.set(key, next);
  return next;
}
// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE_TO_INTENT: Record<string, string> = {
  suporte: 'SUPORTE_TECNICO',
  financeiro: 'FINANCEIRO',
  comercial: 'VENDAS',
  // Setores opcionais (Bruno 2026-06-11): herdam o intent do setor pai pra
  // re-atribuição de equipe funcionar igual ao trilho base.
  vendas: 'VENDAS',
  retencao: 'CANCELAMENTO',
  suporte_n2: 'SUPORTE_TECNICO',
};

const PIPELINE_TO_TEAM: Record<string, string> = {
  suporte: 'Suporte',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  vendas: 'Vendas',
  retencao: 'Retenção',
  suporte_n2: 'Suporte N2',
};

const HUMANO_STAGE_PREFIXES = ['atendimento_humano'];

async function reassignOnSectorChange(
  workspaceId: string,
  conversationId: number,
  newPipelineKey: PipelineType,
  isHumanoStage: boolean,
  triggerUserId?: number,
): Promise<void> {
  try {
    const [conv] = await db.select({
      agente: conversations.agente,
      assignedUserId: conversations.assignedUserId,
      assignedUserName: conversations.assignedUserName,
      pipeline: conversations.pipeline,
    }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);

    if (!conv) return;

    const intent = PIPELINE_TO_INTENT[newPipelineKey];
    if (!intent) return;

    // Bruno 2026-06-11: setor opcional (vendas/retencao/suporte_n2) → a equipe vem
    // do PIPELINE (PIPELINE_TO_TEAM), NÃO do intent — senão VENDAS/CANCELAMENTO
    // cairiam no Comercial e o desvio de entrega não teria efeito na fila.
    const { OPTIONAL_PIPELINE_KEYS } = await import('./sectors/optionalSectors');
    const optionalTeamOverride = OPTIONAL_PIPELINE_KEYS.includes(newPipelineKey)
      ? PIPELINE_TO_TEAM[newPipelineKey]
      : undefined;

    const { autoAssignByIntent, assignTeamOnly } = await import('./teamAssignment');

    if (isHumanoStage) {
      // Já tem atendente humano atribuído → manter, não trocar (evita conversa piscar no chat)
      if (conv.assignedUserId) {
        console.log(`[PipelineReassign] conv=${conversationId}: user=${conv.assignedUserId} já atribuído — skip humano reassign`);
        return;
      }
      // Se quem enviou é um usuário identificado → atribuir diretamente a ele
      if (triggerUserId) {
        const { db: dbU } = await import('../db');
        const { users: usersTable } = await import('@shared/schema');
        const { eq: eqU } = await import('drizzle-orm');
        const [sender] = await dbU.select({ id: usersTable.id, nome: usersTable.nome })
          .from(usersTable).where(eqU(usersTable.id, triggerUserId)).limit(1);
        if (sender) {
          const { teams: teamsTable } = await import('@shared/schema');
          const intent2 = PIPELINE_TO_INTENT[newPipelineKey];
          const teamNameCandidates: string[] = optionalTeamOverride
            ? [optionalTeamOverride]
            : (intent2 === 'VENDAS' || intent2 === 'CANCELAMENTO')
              ? ['Comercial'] : intent2 === 'FINANCEIRO' ? ['Financeiro'] : ['Suporte', 'Suporte Técnico', 'Suporte Tecnico'];
          let teamId: string | null = null;
          for (const tn of teamNameCandidates) {
            const [t] = await dbU.select({ id: teamsTable.id })
              .from(teamsTable)
              .where(and(eq(teamsTable.workspaceId, workspaceId), sql`LOWER(${teamsTable.nome}) = LOWER(${tn})`))
              .limit(1);
            if (t) { teamId = t.id; break; }
          }
          await dbU.update(conversations).set({
            assignedUserId: sender.id,
            assignedUserName: sender.nome,
            ...(teamId ? { assignedTeamId: teamId } : {}),
            updatedAt: new Date(),
          }).where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
          const { broadcastToWorkspace: bcast } = await import('./broadcast');
          bcast(workspaceId, 'conversation_updated', {
            conversationId,
            assigned_user_id: sender.id,
            assigned_user_name: sender.nome,
            ...(teamId ? { assigned_team_id: teamId } : {}),
          });
          console.log(`[PipelineReassign] conv=${conversationId}: trigger user=${sender.nome} → auto-assigned`);
          return;
        }
      }
      // Regra: IA atribui APENAS à equipe (setor) — nunca direto ao atendente.
      // A conversa fica em "Em Fila" até alguém do setor "Assumir".
      await assignTeamOnly(workspaceId, conversationId, intent, optionalTeamOverride);
      console.log(`[PipelineReassign] conv=${conversationId}: ${conv.pipeline}→${newPipelineKey} (HUMANO) → team-only assigned (queued)`);
      return;
    }

    const sectorChanged = (conv.pipeline || '').toLowerCase() !== newPipelineKey.toLowerCase();
    const expectedTeamAgente = `[Equipe] ${PIPELINE_TO_TEAM[newPipelineKey] || newPipelineKey}`;
    const teamAlreadyCorrect = conv.agente === expectedTeamAgente;

    if (sectorChanged) {
      await assignTeamOnly(workspaceId, conversationId, intent, optionalTeamOverride);
      console.log(`[PipelineReassign] conv=${conversationId}: sector ${conv.pipeline}→${newPipelineKey} changed → team-only assigned`);
    } else if (!teamAlreadyCorrect) {
      if (conv.assignedUserId) {
        console.log(`[PipelineReassign] conv=${conversationId}: same sector, user manually assigned — skip`);
        return;
      }
      await assignTeamOnly(workspaceId, conversationId, intent);
      console.log(`[PipelineReassign] conv=${conversationId}: team not set yet → team-only assigned`);
    }
  } catch (err: any) {
    console.error(`[PipelineReassign] Error (non-fatal):`, err.message);
  }
}

// Bruno 2026-06-11: + setores opcionais (desvio de entrega por tenant). vendas/
// retencao são "comercial-like"; suporte_n2 é "suporte-like" (herdam o etapaMap
// do pai abaixo em PIPELINE_CONFIGS).
type PipelineType = 'suporte' | 'financeiro' | 'comercial' | 'vendas' | 'retencao' | 'suporte_n2';

// ── Etapas universais: 5 estágios operacionais aplicados a TODOS os setores ──
// Princípio: Kanban = estado operacional (quem está com o card / o que aguarda)
//            Situação = contexto de negócio (o que aconteceu)  — sem sobreposição

const UNIVERSAL_STAGE_ORDER: Record<string, number> = {
  'novo': 0,
  'em_automacao': 1,
  'aguardando': 2,
  'atendimento_humano': 3,
  'finalizado': 4,
};

const UNIVERSAL_TERMINAL: string[] = ['finalizado'];

const SUPORTE_ETAPA_MAP: Record<string, string> = {
  // ── Etapas do agente suporte ─────────────────────────────────────────────
  'novo_chamado': 'novo',
  'aguardando_tipo_conexao': 'em_automacao',
  'aguardando_verificacao_roteador_offline': 'em_automacao',
  'troubleshooting_offline': 'em_automacao',
  'troubleshooting_sem_internet': 'em_automacao',
  'troubleshooting_lento': 'em_automacao',
  'troubleshooting_outro': 'em_automacao',
  'diagnostico_roteador': 'em_automacao',
  'aguardando_reinicio_wifi': 'em_automacao',
  'aguardando_teste_cabo': 'em_automacao',
  'aguardando_teste_velocidade': 'em_automacao',
  'aguardando_speedtest_lento': 'em_automacao',
  'aguardando_validacao_cliente': 'em_automacao',
  'aguardando_resultado_checklist': 'em_automacao',
  'aguardando_cliente': 'em_automacao',
  'resultado_teste_recebido': 'em_automacao',
  'escalar_os': 'aguardando',
  'resolvido': 'finalizado',
  'os_aberta': 'aguardando',
  'os_falhou_escalar': 'atendimento_humano',
  'escalar_humano': 'atendimento_humano',
  'redirect_humano': 'atendimento_humano',
  'escalado_humano': 'atendimento_humano',
  'erro': 'em_automacao',
  // ── Compatibilidade com prefixos antigos ────────────────────────────────
  'atendimento_remoto': 'em_automacao',
  'atendimento_humano_sup': 'atendimento_humano',
  'visita_tecnica': 'aguardando',
  'escalado_noc': 'atendimento_humano',
  'novo_chamado_legacy': 'novo',
  // ── Identity mappings universais ────────────────────────────────────────
  'novo': 'novo',
  'em_automacao': 'em_automacao',
  'aguardando': 'aguardando',
  'atendimento_humano': 'atendimento_humano',
  'finalizado': 'finalizado',
};

const FINANCEIRO_ETAPA_MAP: Record<string, string> = {
  // ── Etapas do agente financeiro ─────────────────────────────────────────
  'novo_financeiro': 'novo',
  'atendimento_financeiro': 'em_automacao',
  'listando_faturas': 'em_automacao',
  'forma_pagamento_escolhida': 'em_automacao',
  'aguardando_desbloqueio': 'aguardando',
  'aguardando_confirmacao_promessa': 'aguardando',
  'boleto_enviado': 'em_automacao',
  'promessa_registrada': 'aguardando',
  'desbloqueio_realizado': 'finalizado',
  'redirect_humano': 'atendimento_humano',
  'escalado_humano': 'atendimento_humano',
  'redirect_vendas': 'finalizado',
  'sem_faturas': 'em_automacao',
  'erro_promessa': 'em_automacao',
  'erro': 'em_automacao',
  // ── Compatibilidade com prefixos antigos ────────────────────────────────
  'nova_situacao': 'novo',
  'consulta_fatura': 'em_automacao',
  'promessa_pgto': 'aguardando',
  'atendimento_humano_fin': 'atendimento_humano',
  'pago_regularizado': 'finalizado',
  'inadimplente_suspenso': 'finalizado',
  // ── Identity mappings universais ────────────────────────────────────────
  'novo': 'novo',
  'em_automacao': 'em_automacao',
  'aguardando': 'aguardando',
  'atendimento_humano': 'atendimento_humano',
  'finalizado': 'finalizado',
};

const COMERCIAL_ETAPA_MAP: Record<string, string> = {
  // ── Etapas do agente comercial ──────────────────────────────────────────
  'novo_comercial': 'novo',
  'atendimento_comercial': 'em_automacao',
  'respondendo_duvidas': 'em_automacao',
  'coletando_endereco': 'em_automacao',
  'cobertura_verificada': 'em_automacao',
  'cobertura_erro': 'em_automacao',
  'planos_apresentados': 'em_automacao',
  'avaliando_upgrade': 'em_automacao',
  'coletando_cadastro': 'em_automacao',
  'checklist_enviado': 'aguardando',
  'checklist_pendente': 'aguardando',
  'processo_titularidade': 'aguardando',
  'sem_cobertura': 'finalizado',
  'redirect_humano': 'atendimento_humano',
  'escalado_humano': 'atendimento_humano',
  'redirect_cancelamento': 'finalizado',
  'erro': 'em_automacao',
  // ── Compatibilidade com prefixos antigos ────────────────────────────────
  'novo_contato': 'novo',
  'viabilidade_proposta': 'em_automacao',
  'atendimento_humano_com': 'atendimento_humano',
  'instalacao_agendada': 'aguardando',
  'cliente_ativado': 'finalizado',
  'cliente_perdido': 'finalizado',
  // ── Identity mappings universais ────────────────────────────────────────
  'novo': 'novo',
  'em_automacao': 'em_automacao',
  'aguardando': 'aguardando',
  'atendimento_humano': 'atendimento_humano',
  'finalizado': 'finalizado',
};

export const STAGE_LABELS: Record<string, string> = {
  'novo': 'Novo',
  'em_automacao': 'Em Automação',
  'aguardando': 'Aguardando',
  'atendimento_humano': 'Atendimento Humano',
  'finalizado': 'Finalizado',
};

const PIPELINE_CONFIGS: Record<PipelineType, {
  etapaMap: Record<string, string>;
  defaultStage: string;
  stageOrder: Record<string, number>;
  terminalStages: string[];
}> = {
  suporte: {
    etapaMap: SUPORTE_ETAPA_MAP,
    defaultStage: 'novo',
    stageOrder: UNIVERSAL_STAGE_ORDER,
    terminalStages: UNIVERSAL_TERMINAL,
  },
  financeiro: {
    etapaMap: FINANCEIRO_ETAPA_MAP,
    defaultStage: 'novo',
    stageOrder: UNIVERSAL_STAGE_ORDER,
    terminalStages: UNIVERSAL_TERMINAL,
  },
  comercial: {
    etapaMap: COMERCIAL_ETAPA_MAP,
    defaultStage: 'novo',
    stageOrder: UNIVERSAL_STAGE_ORDER,
    terminalStages: UNIVERSAL_TERMINAL,
  },
  // ── Setores opcionais (Bruno 2026-06-11) — herdam a máquina de etapas do pai ──
  // As 5 etapas são universais; o que muda é só o trilho (conversations.pipeline).
  vendas: {
    etapaMap: COMERCIAL_ETAPA_MAP,
    defaultStage: 'novo',
    stageOrder: UNIVERSAL_STAGE_ORDER,
    terminalStages: UNIVERSAL_TERMINAL,
  },
  retencao: {
    etapaMap: COMERCIAL_ETAPA_MAP,
    defaultStage: 'novo',
    stageOrder: UNIVERSAL_STAGE_ORDER,
    terminalStages: UNIVERSAL_TERMINAL,
  },
  suporte_n2: {
    etapaMap: SUPORTE_ETAPA_MAP,
    defaultStage: 'novo',
    stageOrder: UNIVERSAL_STAGE_ORDER,
    terminalStages: UNIVERSAL_TERMINAL,
  },
};

const stageKeyCache = new Map<string, Map<string, string>>();

async function getStageKey(workspaceId: string, pipelineKey: PipelineType, stagePrefix: string): Promise<string | null> {
  const cacheKey = `${workspaceId}:${pipelineKey}`;
  let wsCache = stageKeyCache.get(cacheKey);
  if (!wsCache) {
    wsCache = new Map();
    stageKeyCache.set(cacheKey, wsCache);
  }
  const cached = wsCache.get(stagePrefix);
  if (cached) return cached;

  const stages = await storage.getPipelineStages(workspaceId, pipelineKey);
  for (const s of stages) {
    const prefix = s.key.replace(/_[a-f0-9]{8}$/, '');
    wsCache.set(prefix, s.key);
  }
  return wsCache.get(stagePrefix) || null;
}

export function clearStageCache(workspaceId?: string) {
  if (workspaceId) {
    for (const key of stageKeyCache.keys()) {
      if (key.startsWith(workspaceId)) stageKeyCache.delete(key);
    }
  } else {
    stageKeyCache.clear();
  }
}

function shouldAdvance(config: typeof PIPELINE_CONFIGS['suporte'], currentPrefix: string, newPrefix: string): boolean {
  const currentOrder = config.stageOrder[currentPrefix];
  const newOrder = config.stageOrder[newPrefix];
  if (currentOrder === undefined || newOrder === undefined) return true;
  // Reabertura: cliente já estava em estágio terminal (ex.: finalizado) e voltou pedindo
  // atendimento humano. A intenção do cliente é soberana — reabre o card no Kanban
  // movendo de volta para "atendimento_humano".
  if (config.terminalStages.includes(currentPrefix) && HUMANO_STAGE_PREFIXES.includes(newPrefix)) return true;
  if (config.terminalStages.includes(currentPrefix)) return false;
  if (config.terminalStages.includes(newPrefix)) return true;
  return newOrder > currentOrder;
}

async function recordStageTransition(params: {
  leadId: number;
  conversationId: number;
  pipeline: string;
  fromStage: string | null;
  toStage: string;
  trigger: string;
  workspaceId: string;
}): Promise<void> {
  try {
    const toLabel = STAGE_LABELS[params.toStage] || params.toStage;
    await db.insert(leadStageHistory).values({
      leadId: params.leadId,
      conversationId: params.conversationId,
      pipeline: params.pipeline,
      fromStage: params.fromStage,
      toStage: params.toStage,
      toStageLabel: toLabel,
      trigger: params.trigger,
      workspaceId: params.workspaceId,
    });
  } catch (err: any) {
    console.error(`[StageHistory] Error recording transition:`, err.message);
  }
}

export async function upsertPipelineLead(
  pipelineKey: PipelineType,
  params: { workspaceId: string; conversationId: number; phone: string; contactName?: string; etapa: string; triggerUserId?: number },
): Promise<void> {
  const config = PIPELINE_CONFIGS[pipelineKey];
  const { workspaceId, conversationId, phone, contactName, etapa, triggerUserId } = params;
  const phoneClean = phone.replace(/\D/g, '');
  const lockKey = `${workspaceId}:${pipelineKey}:${phoneClean}`;

  return withUpsertLock(lockKey, async () => {
    const stagePrefix = config.etapaMap[etapa] || config.defaultStage;
    const stageKey = await getStageKey(workspaceId, pipelineKey, stagePrefix);
    const label = pipelineKey.charAt(0).toUpperCase() + pipelineKey.slice(1);

    if (!stageKey) {
      console.log(`[${label}Pipeline] Stage key not found for prefix=${stagePrefix}, ws=${workspaceId.substring(0, 8)}`);
      return;
    }

    try {
      // ──────────────────────────────────────────────────────────────────────
      // UMA CONVERSA = UM SETOR NO KANBAN.
      // Antes de criar/atualizar o lead neste pipeline, ARQUIVAR leads ATIVOS
      // do mesmo telefone em OUTROS pipelines. Isso impede o card de aparecer
      // em 2 ou 3 Kanbans ao mesmo tempo quando a conversa muda de setor.
      // Broadcast `lead_archived` pra UI remover o card antigo em tempo real.
      // ──────────────────────────────────────────────────────────────────────
      try {
        const staleLeads = await db.select({
          id: leads.id,
          pipeline: leads.pipeline,
          status: leads.status,
        }).from(leads).where(
          and(
            eq(leads.workspaceId, workspaceId),
            eq(leads.telefone, phoneClean),
            isNull(leads.archivedAt),
            sql`${leads.pipeline} <> ${pipelineKey}`,
          )
        );
        for (const stale of staleLeads) {
          await db.update(leads).set({
            archivedAt: new Date(),
            archivalReason: `setor_mudou_para_${pipelineKey}`,
          }).where(eq(leads.id, stale.id));
          broadcastToWorkspace(workspaceId, 'lead_archived', {
            leadId: stale.id,
            pipeline: stale.pipeline,
            reason: 'setor_mudou',
            newPipeline: pipelineKey,
          });
          console.log(`[${label}Pipeline] Lead #${stale.id} (${stale.pipeline}) arquivado — conversa migrou para ${pipelineKey}`);
        }
      } catch (err: any) {
        console.error(`[${label}Pipeline] Erro arquivando leads de outros pipelines:`, err.message);
      }

      const existingLeads = await db.select().from(leads).where(
        and(
          eq(leads.workspaceId, workspaceId),
          eq(leads.pipeline, pipelineKey),
          eq(leads.telefone, phoneClean),
        )
      );

      let activeLead = existingLeads.find(l => !l.archivedAt);

      // Novo ciclo de negócio (Bruno 2026-07-16): card arrastado pra coluna
      // TERMINAL (Ganho/Perdido) fica VISÍVEL no funil — não é mais arquivado
      // no arraste. O arquivo acontece AQUI, quando o mesmo cliente volta a
      // movimentar o pipeline: o deal antigo sai com o motivo da coluna e um
      // card NOVO nasce na esteira (mesmo comportamento de antes, só que o
      // card não some na hora do arraste).
      if (activeLead && (activeLead as any).displayColumn) {
        try {
          const cols = await storage.getPipelineColumns(workspaceId, pipelineKey);
          const parked = cols.find((c) => c.key === (activeLead as any).displayColumn);
          if (parked?.isTerminal) {
            await db.update(leads).set({
              archivedAt: new Date(),
              archivalReason: parked.terminalReason === 'perdido' ? 'perdido' : 'ativado',
            }).where(eq(leads.id, activeLead.id));
            broadcastToWorkspace(workspaceId, 'lead_archived', {
              leadId: activeLead.id,
              pipeline: pipelineKey,
              reason: 'novo_ciclo',
            });
            console.log(`[${label}Pipeline] Lead #${activeLead.id} (coluna terminal "${parked.label}") arquivado — cliente iniciou novo ciclo`);
            activeLead = undefined;
          }
        } catch { /* sem colunas configuradas → segue fluxo normal */ }
      }

      if (activeLead) {
        const currentPrefix = activeLead.status.replace(/_[a-f0-9]{8}$/, '');
        if (!shouldAdvance(config, currentPrefix, stagePrefix)) {
          // Lead não avança, mas garante que a conversa e equipe estejam sincronizadas
          // (podem estar nulas após reopen/CSAT reset)
          try {
            const [conv] = await db.select({
              pipeline: conversations.pipeline,
              assignedTeamId: conversations.assignedTeamId,
            }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);

            const needsPipelineSync = !conv?.pipeline;
            if (needsPipelineSync) {
              await db.update(conversations).set({
                pipeline: pipelineKey,
                pipelineEtapa: stageKey,
              }).where(eq(conversations.id, conversationId));
              broadcastToWorkspace(workspaceId, 'conversation_updated', {
                conversationId,
                pipeline: pipelineKey,
                pipeline_etapa: stageKey,
              });
              console.log(`[${label}Pipeline] conv=${conversationId}: pipeline synced → ${pipelineKey}/${stagePrefix} (lead stayed at ${currentPrefix})`);
            }

            if (!conv?.assignedTeamId) {
              const isHumano = HUMANO_STAGE_PREFIXES.includes(currentPrefix);
              reassignOnSectorChange(workspaceId, conversationId, pipelineKey, isHumano, triggerUserId).catch(() => {});
              console.log(`[${label}Pipeline] conv=${conversationId}: team not set — triggering reassign`);
            }
          } catch {}
          return;
        }
        await db.update(leads).set({ status: stageKey }).where(eq(leads.id, activeLead.id));
        console.log(`[${label}Pipeline] Lead #${activeLead.id} stage: ${currentPrefix} → ${stagePrefix} (${stageKey})`);

        // Notifica o Kanban em tempo real sobre a mudança de etapa
        broadcastToWorkspace(workspaceId, 'lead_stage_updated', {
          leadId: activeLead.id,
          pipeline: pipelineKey,
          fromStage: currentPrefix,
          toStage: stagePrefix,
          stageKey,
        });

        await recordStageTransition({
          leadId: activeLead.id,
          conversationId,
          pipeline: pipelineKey,
          fromStage: currentPrefix,
          toStage: stagePrefix,
          trigger: etapa,
          workspaceId,
        });
      } else {
        const [newLead] = await db.insert(leads).values({
          nome: contactName || `Cliente ${phoneClean}`,
          contato: contactName || phoneClean,
          telefone: phoneClean,
          email: '',
          valor: '0',
          status: stageKey,
          canal: 'WhatsApp',
          pipeline: pipelineKey,
          prioridade: 'media',
          workspaceId,
        }).returning();
        console.log(`[${label}Pipeline] Lead #${newLead.id} created at stage ${stagePrefix} (${stageKey}) for conv=${conversationId}`);

        // Notifica o Kanban sobre criação de novo card
        broadcastToWorkspace(workspaceId, 'lead_stage_updated', {
          leadId: newLead.id,
          pipeline: pipelineKey,
          fromStage: null,
          toStage: stagePrefix,
          stageKey,
          isNew: true,
        });

        await recordStageTransition({
          leadId: newLead.id,
          conversationId,
          pipeline: pipelineKey,
          fromStage: null,
          toStage: stagePrefix,
          trigger: etapa,
          workspaceId,
        });
      }

      try {
        await db.update(conversations).set({
          pipeline: pipelineKey,
          pipelineEtapa: stageKey,
        }).where(eq(conversations.id, conversationId));
        // Broadcast para atualizar o inbox em tempo real
        broadcastToWorkspace(workspaceId, 'conversation_updated', {
          conversationId,
          pipeline: pipelineKey,
          pipeline_etapa: stageKey,
        });
      } catch {}

      const isHumano = HUMANO_STAGE_PREFIXES.includes(stagePrefix);
      reassignOnSectorChange(workspaceId, conversationId, pipelineKey, isHumano, triggerUserId).catch(() => {});
    } catch (err: any) {
      console.error(`[${label}Pipeline] Error:`, err.message);
    }
  }); // end withUpsertLock
}

export async function upsertSuporteLead(params: {
  workspaceId: string; conversationId: number; phone: string; contactName?: string; etapa: string;
}): Promise<void> {
  await upsertPipelineLead('suporte', params);
}

export async function upsertFinanceiroLead(params: {
  workspaceId: string; conversationId: number; phone: string; contactName?: string; etapa: string;
}): Promise<void> {
  await upsertPipelineLead('financeiro', params);
}

export async function upsertComercialLead(params: {
  workspaceId: string; conversationId: number; phone: string; contactName?: string; etapa: string;
}): Promise<void> {
  await upsertPipelineLead('comercial', params);
}

// Cria (ou mantém) o lead na primeira etapa do pipeline ao atribuir equipe manualmente
export async function upsertLeadAtFirstStage(params: {
  workspaceId: string; conversationId: number; phone: string; contactName: string; pipelineKey: string;
}): Promise<void> {
  const { pipelineKey, ...rest } = params;
  const validKeys: PipelineType[] = ['suporte', 'financeiro', 'comercial'];
  if (!validKeys.includes(pipelineKey as PipelineType)) return;
  const config = PIPELINE_CONFIGS[pipelineKey as PipelineType];
  await upsertPipelineLead(pipelineKey as PipelineType, { ...rest, etapa: config.defaultStage });
}

// ─────────────────────────────────────────────────────────────────────────────
// SITUATION_STAGE_MAP — módulo ISP de tags (situationTagService) removido.
// Mantido como objeto vazio tipado para preservar a API de re-export.
// ─────────────────────────────────────────────────────────────────────────────
export const SITUATION_STAGE_MAP: Record<string, string> = {};

/**
 * Finaliza o lead no Kanban quando a conversa é encerrada pelo atendente.
 * Move o card para "Finalizado" e o arquiva, independente da etapa atual.
 */
export async function finalizeLeadOnConversationResolve(params: {
  workspaceId: string;
  phone: string;
  pipeline: string;
}): Promise<void> {
  const { workspaceId, phone, pipeline } = params;
  const validPipelines: PipelineType[] = ['suporte', 'financeiro', 'comercial'];
  const pipelineKey = pipeline.toLowerCase() as PipelineType;
  if (!validPipelines.includes(pipelineKey)) return;

  const phoneClean = phone.replace(/\D/g, '');
  try {
    const finalizadoKey = await getStageKey(workspaceId, pipelineKey, 'finalizado');
    if (!finalizadoKey) {
      console.log(`[PipelineResolve] Sem stageKey para finalizado (ws=${workspaceId.substring(0, 8)}, pipeline=${pipelineKey})`);
      return;
    }

    const [activeLead] = await db.select().from(leads).where(
      and(
        eq(leads.workspaceId, workspaceId),
        eq(leads.pipeline, pipelineKey),
        eq(leads.telefone, phoneClean),
        sql`${leads.archivedAt} IS NULL`,
      )
    ).limit(1);

    if (!activeLead) return;

    // Guard funil de vendas (Bruno 2026-06-28, ampliado 2026-07-16): card que o
    // vendedor estacionou MANUALMENTE em QUALQUER coluna (inclusive Ganho/Perdido)
    // SOBREVIVE ao encerramento da conversa — não arquiva. Só cards seguindo o
    // bot (display_column NULL) são finalizados/arquivados aqui. O card terminal
    // é arquivado depois, quando o cliente inicia novo ciclo (upsertPipelineLead).
    if ((activeLead as any).displayColumn) {
      try {
        const cols = await storage.getPipelineColumns(workspaceId, pipelineKey);
        const parked = cols.find((c) => c.key === (activeLead as any).displayColumn);
        if (parked) {
          console.log(`[PipelineResolve] Lead #${activeLead.id} estacionado na coluna "${parked.label}" — deal preservado (não arquiva)`);
          return;
        }
      } catch { /* sem colunas configuradas → segue o fluxo normal de arquivar */ }
    }

    const currentPrefix = activeLead.status.replace(/_[a-f0-9]{8}$/, '');
    if (currentPrefix === 'finalizado') return;

    await db.update(leads).set({
      status: finalizadoKey,
      archivedAt: new Date(),
      archivalReason: 'conversa_resolvida',
    }).where(eq(leads.id, activeLead.id));

    broadcastToWorkspace(workspaceId, 'lead_stage_updated', {
      leadId: activeLead.id,
      pipeline: pipelineKey,
      fromStage: currentPrefix,
      toStage: 'finalizado',
      stageKey: finalizadoKey,
    });

    console.log(`[PipelineResolve] Lead #${activeLead.id} → finalizado + arquivado (pipeline=${pipelineKey})`);
  } catch (err: any) {
    console.error(`[PipelineResolve] Erro (não-fatal):`, err.message);
  }
}

/**
 * Wrapper backward-compat: o módulo ISP de tags (situationTagService) foi
 * removido. Mantido como no-op para preservar a assinatura pública.
 */
export async function applyTagWithPipeline(params: {
  workspaceId: string;
  conversationId: number;
  phone: string;
  contactName: string;
  situationCode: string;
}): Promise<void> {
  // applySituation removido junto com o módulo ISP de tags — no-op.
}

const HUMANO_STAGE_BY_PIPELINE: Record<string, string> = {
  comercial: 'atendimento_humano',
  financeiro: 'atendimento_humano',
  suporte: 'atendimento_humano',
};

/**
 * Move o card do Kanban para "Atendimento Humano" do setor correspondente.
 * Chamado automaticamente quando um atendente humano digita no chat pela primeira vez.
 */
export async function moveConversationToAtendimentoHumano(params: {
  workspaceId: string;
  conversationId: number;
  phone: string;
  contactName: string;
  pipeline: string | null;
  triggerUserId?: number;
}): Promise<void> {
  const { workspaceId, conversationId, phone, contactName, pipeline, triggerUserId } = params;
  if (!pipeline) return;
  const stagePrefix = HUMANO_STAGE_BY_PIPELINE[pipeline.toLowerCase()];
  if (!stagePrefix) return;
  const pipelineKey = pipeline.toLowerCase() as PipelineType;
  console.log(`[TagPipeline] 👤 Atendente humano → conv=${conversationId}, pipeline=${pipelineKey}, stage=${stagePrefix}`);
  await upsertPipelineLead(pipelineKey, {
    workspaceId,
    conversationId,
    phone,
    contactName,
    etapa: stagePrefix,
    triggerUserId,
  });
}
