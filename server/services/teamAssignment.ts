import { db } from "../db";
import { teams, teamMembers, conversations, users, pipelineStages } from "@shared/schema";
import { eq, and, sql, count } from "drizzle-orm";
import { broadcastToWorkspace } from "./broadcast";

export const INTENT_TO_TEAM: Record<string, string[]> = {
  FINANCEIRO: ["Financeiro"],
  // "Suporte" é o nome canônico (Bruno 2026-05-13). "Suporte Técnico"/"Suporte
  // Tecnico" ficam como fallback retro-compat pra tenants que ainda não rodaram
  // a auto-migration de rename.
  SUPORTE_TECNICO: ["Suporte", "Suporte Técnico", "Suporte Tecnico"],
  VENDAS: ["Comercial"],
  CANCELAMENTO: ["Comercial"],
};

const INTENT_TO_SECTOR: Record<string, string> = {
  FINANCEIRO: "Financeiro",
  SUPORTE_TECNICO: "Suporte",
  VENDAS: "Comercial",
  CANCELAMENTO: "Comercial",
};

export function getSectorFromIntent(intent: string): string | null {
  return INTENT_TO_SECTOR[intent] || null;
}

// Resolve a lista de candidatas de equipe considerando q18 (estrutura da equipe):
//   - 'sim_separado' (default) → usa a equipe setorial do intent (Financeiro/Suporte/Comercial)
//   - 'nao_unica'              → preferir equipe unica (Atendimento); cai pra setorial se nao existir
//   - 'sim_parcial'            → setorial primeiro, equipe unica como fallback
async function resolveTeamCandidates(workspaceId: string, intent: string): Promise<string[]> {
  const sectorTeams = INTENT_TO_TEAM[intent] || [];
  try {
    const { tenantSettingsService } = await import('./tenantSettingsService');
    const settings = await tenantSettingsService.getTenantSettings(workspaceId);
    const estrutura = (settings.businessRules as any)?.equipeDividaPorSetor;
    const UNIFIED = ['Atendimento', 'Equipe Unica', 'Equipe Única'];
    if (estrutura === 'nao_unica') return [...UNIFIED, ...sectorTeams];
    if (estrutura === 'sim_parcial') return [...sectorTeams, ...UNIFIED];
    return sectorTeams;
  } catch {
    return sectorTeams;
  }
}

async function getFirstPipelineStage(workspaceId: string, pipelineKey: string): Promise<string | null> {
  try {
    const stages = await db
      .select({ key: pipelineStages.key })
      .from(pipelineStages)
      .where(and(
        eq(pipelineStages.workspaceId, workspaceId),
        eq(pipelineStages.pipeline, pipelineKey),
      ))
      .orderBy(pipelineStages.ordem)
      .limit(1);
    return stages[0]?.key || null;
  } catch {
    return null;
  }
}

export async function autoAssignByIntent(
  workspaceId: string,
  conversationId: number,
  intent: string,
  forceReassign = false
): Promise<{ teamName: string | null; userName: string | null; userId: number | null; sector: string | null }> {
  const sector = INTENT_TO_SECTOR[intent];
  if (!sector) return { teamName: null, userName: null, userId: null, sector: null };

  // REGRA ABSOLUTA (Bruno 2026-05-19): preserva assignment humano manual.
  // Operações automáticas NUNCA roubam a conv de um atendente real.
  // forceReassign=true bypassa (uso interno em transfer manual).
  if (!forceReassign) {
    try {
      const [curr] = await db.select({ assignedUserId: conversations.assignedUserId, assignedUserName: conversations.assignedUserName })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
        .limit(1);
      if (curr?.assignedUserId) {
        console.log(`[TeamAssignment] 🛡️ autoAssignByIntent SKIP: humano '${curr.assignedUserName}' já atribuído (conv=${conversationId}) — preservando atribuição manual`);
        return { teamName: null, userName: curr.assignedUserName || null, userId: curr.assignedUserId, sector };
      }
    } catch {}
  }

  const teamNameCandidates = await resolveTeamCandidates(workspaceId, intent);
  if (!teamNameCandidates?.length) return { teamName: null, userName: null, userId: null, sector };

  try {
    const conv = await db
      .select({ agente: conversations.agente, assignedUserId: conversations.assignedUserId, pipeline: conversations.pipeline })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
      .limit(1);

    if (!conv.length) return { teamName: null, userName: null, userId: null, sector };

    const currentAgente = conv[0].agente;
    const currentAssigned = conv[0].assignedUserId;
    const currentPipeline = conv[0].pipeline;

    if (!forceReassign && currentAssigned) {
      const matchedTeamName = teamNameCandidates.find(
        (tn) => currentAgente === `[Equipe] ${tn}`
      );
      if (matchedTeamName) {
        const assignedUser = await db
          .select({ nome: users.nome })
          .from(users)
          .where(eq(users.id, currentAssigned))
          .limit(1);
        return {
          teamName: matchedTeamName,
          userName: assignedUser[0]?.nome || null,
          userId: currentAssigned,
          sector,
        };
      }
    }

    let matchedTeam: { id: string; nome: string; pipelineKey: string | null } | null = null;
    for (const candidateName of teamNameCandidates) {
      const found = await db
        .select({ id: teams.id, nome: teams.nome, pipelineKey: teams.pipelineKey })
        .from(teams)
        .where(
          and(
            eq(teams.workspaceId, workspaceId),
            eq(teams.active, true),
            sql`LOWER(${teams.nome}) = LOWER(${candidateName})`
          )
        )
        .limit(1);
      if (found.length) {
        matchedTeam = found[0];
        break;
      }
    }

    if (!matchedTeam) {
      await db
        .update(conversations)
        .set({
          agente: `[Equipe] ${teamNameCandidates[0]}`,
          assignedUserId: null,
          assignedUserName: null,
          assignedTeamId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
      broadcastToWorkspace(workspaceId, 'conversation_updated', {
        conversationId,
        agente: `[Equipe] ${teamNameCandidates[0]}`,
        assigned_team_id: null,
        assigned_user_id: null,
        assigned_user_name: null,
      });
      return { teamName: teamNameCandidates[0], userName: null, userId: null, sector };
    }

    const pipelineSet: Record<string, any> = {};
    if (matchedTeam.pipelineKey && !currentPipeline) {
      pipelineSet.pipeline = matchedTeam.pipelineKey;
      const firstStage = await getFirstPipelineStage(workspaceId, matchedTeam.pipelineKey);
      if (firstStage) pipelineSet.pipelineEtapa = firstStage;
    }

    const members = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, matchedTeam.id));

    if (!members.length) {
      await db
        .update(conversations)
        .set({
          agente: `[Equipe] ${matchedTeam.nome}`,
          assignedUserId: null,
          assignedUserName: null,
          assignedTeamId: matchedTeam.id,
          updatedAt: new Date(),
          ...pipelineSet,
        })
        .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
      broadcastToWorkspace(workspaceId, 'conversation_updated', {
        conversationId,
        agente: `[Equipe] ${matchedTeam.nome}`,
        assigned_team_id: matchedTeam.id,
        assigned_user_id: null,
        assigned_user_name: null,
        ...(pipelineSet.pipeline !== undefined && { pipeline: pipelineSet.pipeline }),
        ...(pipelineSet.pipelineEtapa !== undefined && { pipeline_etapa: pipelineSet.pipelineEtapa }),
      });
      return { teamName: matchedTeam.nome, userName: null, userId: null, sector };
    }

    const memberIds = members.map((m) => m.userId);

    const busyCounts = await db
      .select({
        assignedUserId: conversations.assignedUserId,
        openCount: count(),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.status, "open"),
          sql`${conversations.assignedUserId} IN (${sql.join(
            memberIds.map((id) => sql`${id}`),
            sql`, `
          )})`
        )
      )
      .groupBy(conversations.assignedUserId);

    const countMap: Record<number, number> = {};
    for (const bc of busyCounts) {
      if (bc.assignedUserId != null) {
        countMap[bc.assignedUserId] = Number(bc.openCount);
      }
    }

    let leastBusyId = memberIds[0];
    let leastCount = countMap[memberIds[0]] ?? 0;
    for (const mid of memberIds) {
      const c = countMap[mid] ?? 0;
      if (c < leastCount) {
        leastCount = c;
        leastBusyId = mid;
      }
    }

    const userRow = await db
      .select({ id: users.id, nome: users.nome })
      .from(users)
      .where(eq(users.id, leastBusyId))
      .limit(1);

    if (!userRow.length) {
      await db
        .update(conversations)
        .set({
          agente: `[Equipe] ${matchedTeam.nome}`,
          assignedUserId: null,
          assignedUserName: null,
          assignedTeamId: matchedTeam.id,
          updatedAt: new Date(),
          ...pipelineSet,
        })
        .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
      broadcastToWorkspace(workspaceId, 'conversation_updated', {
        conversationId,
        agente: `[Equipe] ${matchedTeam.nome}`,
        assigned_team_id: matchedTeam.id,
        assigned_user_id: null,
        assigned_user_name: null,
        ...(pipelineSet.pipeline !== undefined && { pipeline: pipelineSet.pipeline }),
        ...(pipelineSet.pipelineEtapa !== undefined && { pipeline_etapa: pipelineSet.pipelineEtapa }),
      });
      return { teamName: matchedTeam.nome, userName: null, userId: null, sector };
    }

    const chosenUser = userRow[0];

    await db
      .update(conversations)
      .set({
        agente: `[Equipe] ${matchedTeam.nome}`,
        assignedUserId: chosenUser.id,
        assignedUserName: chosenUser.nome,
        assignedTeamId: matchedTeam.id,
        updatedAt: new Date(),
        ...pipelineSet,
      })
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));

    broadcastToWorkspace(workspaceId, 'conversation_updated', {
      conversationId,
      agente: `[Equipe] ${matchedTeam.nome}`,
      assigned_team_id: matchedTeam.id,
      assigned_user_id: chosenUser.id,
      assigned_user_name: chosenUser.nome,
      ...(pipelineSet.pipeline !== undefined && { pipeline: pipelineSet.pipeline }),
      ...(pipelineSet.pipelineEtapa !== undefined && { pipeline_etapa: pipelineSet.pipelineEtapa }),
    });

    console.log(
      `[TeamAssignment] Conversa ${conversationId} → ${matchedTeam.nome}/${chosenUser.nome} (team=${matchedTeam.id}, pipeline=${matchedTeam.pipelineKey || 'none'}, ${leastCount} abertas)`
    );

    return {
      teamName: matchedTeam.nome,
      userName: chosenUser.nome,
      userId: chosenUser.id,
      sector,
    };
  } catch (err: any) {
    console.error(`[TeamAssignment] Erro: ${err.message}`);
    return { teamName: null, userName: null, userId: null, sector };
  }
}

export async function assignTeamOnly(
  workspaceId: string,
  conversationId: number,
  intent: string,
  // Bruno 2026-06-11: equipe-alvo explícita (setores opcionais). Quando informada,
  // ignora o mapa intent→equipe e atribui direto a esta equipe — é como Vendas/
  // Retenção/Suporte N2 recebem a conversa em vez de cair no Comercial/Suporte base.
  teamNameOverride?: string,
): Promise<string | null> {
  // REGRA ABSOLUTA (Bruno 2026-05-19): se humano JÁ atribuído manualmente,
  // operações automáticas NUNCA zeram assignedUserId. Só release manual
  // (PATCH /transfer com targetUserId=null) ou transfer-team explícito
  // podem mexer. assignTeamOnly é chamado por finalizeHumanHandoff,
  // handleIntentSwitch, reassignOnSectorChange — todos automáticos.
  try {
    const [curr] = await db.select({ assignedUserId: conversations.assignedUserId, assignedUserName: conversations.assignedUserName })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
      .limit(1);
    if (curr?.assignedUserId) {
      console.log(`[TeamAssignment] 🛡️ assignTeamOnly SKIP: humano '${curr.assignedUserName}' já atribuído (conv=${conversationId}) — preservando atribuição manual`);
      return null;
    }
  } catch {}

  const teamNameCandidates = teamNameOverride
    ? [teamNameOverride]
    : await resolveTeamCandidates(workspaceId, intent);
  if (!teamNameCandidates?.length) return null;

  let teamName = teamNameCandidates[0];
  let teamId: string | null = null;
  let teamPipelineKey: string | null = null;

  try {
    for (const candidateName of teamNameCandidates) {
      const found = await db
        .select({ id: teams.id, nome: teams.nome, pipelineKey: teams.pipelineKey })
        .from(teams)
        .where(and(
          eq(teams.workspaceId, workspaceId),
          eq(teams.active, true),
          sql`LOWER(${teams.nome}) = LOWER(${candidateName})`,
        ))
        .limit(1);
      if (found.length) {
        teamName = found[0].nome;
        teamId = found[0].id;
        teamPipelineKey = found[0].pipelineKey;
        break;
      }
    }
  } catch {}

  const pipelineSet: Record<string, any> = {};
  if (teamId && teamPipelineKey) {
    const conv = await db.select({ pipeline: conversations.pipeline }).from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)))
      .limit(1).catch(() => []);
    if (!conv[0]?.pipeline) {
      pipelineSet.pipeline = teamPipelineKey;
      const firstStage = await getFirstPipelineStage(workspaceId, teamPipelineKey);
      if (firstStage) pipelineSet.pipelineEtapa = firstStage;
    }
  }

  await db.update(conversations).set({
    agente: `[Equipe] ${teamName}`,
    assignedUserId: null,
    assignedUserName: null,
    assignedTeamId: teamId,
    updatedAt: new Date(),
    ...pipelineSet,
  }).where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));

  broadcastToWorkspace(workspaceId, 'conversation_updated', {
    conversationId,
    agente: `[Equipe] ${teamName}`,
    assigned_team_id: teamId,
    assigned_user_id: null,
    assigned_user_name: null,
    ...(pipelineSet.pipeline !== undefined && { pipeline: pipelineSet.pipeline }),
    ...(pipelineSet.pipelineEtapa !== undefined && { pipeline_etapa: pipelineSet.pipelineEtapa }),
  });

  console.log(`[TeamAssignment] Conv ${conversationId} → equipe-only: ${teamName} (teamId=${teamId}, pipeline=${teamPipelineKey || 'none'})`);
  return teamName;
}

// ─────────────────────────────────────────────────────────────────────────────
// handleIntentSwitch — orquestra a troca completa de setor durante uma conversa
// fluindo no bot. Chamado pelo ispAgentEngine quando `mudouIntencao = true` e
// o setor antigo difere do novo (ex: cliente recebeu boleto e mudou pra suporte).
//
// IMPORTANTE: Tags acumulam SEMPRE — nunca removemos as tags antigas. O atendente
// humano precisa ver TODAS as situações que o cliente passou na conversa.
// O agente do novo setor aplicará a tag específica do novo contexto (ex: S4)
// pelo seu próprio fluxo, somando-se às tags anteriores (F4, F5, ...).
//
// REGRA OPERACIONAL (Bruno, 2026-05-03): IA atribui APENAS à EQUIPE durante swap,
// nunca direto a um atendente. O bot continua respondendo até alguém do setor
// clicar "Assumir atendimento" (que aí sim seta assignedUserId e bloqueia o bot
// via isAgentBlockedByStage). Round-robin aqui setava assignedUserId
// automaticamente e — combinado com pipelineEtapa=atendimento_humano herdado
// de uma escalação anterior (ex: S12) — travava o bot mesmo sem humano de fato
// assumir. Caso real: cliente em AH (S12) volta perguntando lentidão; bot
// respondia, autoAssignByIntent setava user, próxima mensagem caía em BLOCKED.
//
// Ordem de operações:
//   1. Guard: cliente suspenso/inadimplente NÃO pode pular pra SUPORTE_TECNICO
//      (regra de negócio: sem suporte enquanto não regulariza débito)
//   2. Força pipeline + etapa = em_automacao da conversa (sobrescreve atendimento_humano herdado)
//   3. assignTeamOnly — troca equipe SEM atribuir user (round-robin proibido aqui)
//   4. upsertPipelineLead(em_automacao) — cria/move card no Kanban novo
//   5. Broadcast `conversation_updated` pro frontend
// ─────────────────────────────────────────────────────────────────────────────
// Normaliza valores de fluxo_atual (que podem ser estados internos como
// AGUARDANDO_FINANCEIRO_TIPO, LISTANDO_FATURAS, TROUBLESHOOTING_LENTO, etc.)
// para o intent canônico (FINANCEIRO, SUPORTE_TECNICO, VENDAS, CANCELAMENTO).
// Essencial pra o handleIntentSwitch detectar troca de setor mesmo quando o
// cliente estava num sub-fluxo específico.
export function normalizeFlowToIntent(flow: string | null | undefined): string | null {
  if (!flow) return null;
  if (INTENT_TO_SECTOR[flow]) return flow;
  if (flow === 'AGUARDANDO_FINANCEIRO_TIPO') return 'FINANCEIRO';
  if (flow === 'AGUARDANDO_SUPORTE_TIPO') return 'SUPORTE_TECNICO';
  if (flow === 'AGUARDANDO_COMERCIAL_TIPO') return 'VENDAS';
  if (flow === 'AGUARDANDO_CANCELAMENTO_TIPO') return 'CANCELAMENTO';
  if (flow.startsWith('FINANCEIRO_') || flow === 'LISTANDO_FATURAS' || flow === 'BOLETO_ENVIADO' || flow === 'PIX_ENVIADO' || flow === 'FORMA_PAGAMENTO_ESCOLHIDA' || flow === 'PROMESSA_REGISTRADA' || flow === 'DESBLOQUEIO_REALIZADO' || flow === 'AGUARDANDO_DESBLOQUEIO' || flow === 'ATENDIMENTO_FINANCEIRO') return 'FINANCEIRO';
  if (flow.startsWith('SUPORTE_') || flow.startsWith('TROUBLESHOOTING_') || flow === 'OS_ABERTA' || flow === 'OS_FALHOU_ESCALAR' || flow === 'ATENDIMENTO_SUPORTE') return 'SUPORTE_TECNICO';
  if (flow.startsWith('VENDAS_') || flow.startsWith('COMERCIAL_') || flow === 'COLETANDO_ENDERECO' || flow === 'COBERTURA_VERIFICADA' || flow === 'PLANOS_APRESENTADOS' || flow === 'SEM_COBERTURA' || flow === 'AVALIANDO_UPGRADE' || flow === 'RESPONDENDO_DUVIDAS' || flow === 'ATENDIMENTO_COMERCIAL') return 'VENDAS';
  if (flow === 'HUMANO' || flow.startsWith('HUMANO_')) return 'HUMANO';
  return null;
}

export async function handleIntentSwitch(params: {
  workspaceId: string;
  conversationId: number;
  oldIntent: string;
  newIntent: string;
  isSuspended?: boolean;
  isInadimplente?: boolean;
  contactName?: string | null;
  phone?: string | null;
}): Promise<{
  blocked: boolean;
  reason?: string;
  teamName: string | null;
  pipelineSet: string | null;
}> {
  const { workspaceId, conversationId, oldIntent, newIntent } = params;

  // Normaliza pra intent canônico: AGUARDANDO_FINANCEIRO_TIPO → FINANCEIRO, etc.
  const oldIntentNorm = normalizeFlowToIntent(oldIntent);
  const newIntentNorm = normalizeFlowToIntent(newIntent);
  const oldSector = oldIntentNorm ? INTENT_TO_SECTOR[oldIntentNorm] : null;
  const newSector = newIntentNorm ? INTENT_TO_SECTOR[newIntentNorm] : null;
  if (!oldSector || !newSector || oldSector === newSector) {
    console.log(`[IntentSwitch] noop conv=${conversationId} ${oldIntent}(${oldIntentNorm ?? '?'})→${newIntent}(${newIntentNorm ?? '?'}) oldSector=${oldSector ?? '-'} newSector=${newSector ?? '-'}`);
    return { blocked: false, teamName: null, pipelineSet: null };
  }

  // Guard: APENAS cliente efetivamente SUSPENSO (internet cortada) bloqueia suporte.
  // Cliente com boleto em aberto a vencer ainda tem internet funcionando — pode pedir
  // suporte normalmente. A regra só se aplica quando o serviço está interrompido por falta
  // de pagamento. O parâmetro isInadimplente é ignorado aqui (muito agressivo).
  if (newIntentNorm === 'SUPORTE_TECNICO' && (params.isSuspended ?? false)) {
    console.log(`[IntentSwitch] 🚫 BLOCKED conv=${conversationId} ${oldIntent}→${newIntent} (cliente SUSPENSO — sem internet até regularizar)`);
    return {
      blocked: true,
      reason: 'cliente_suspenso_sem_suporte',
      teamName: null,
      pipelineSet: null,
    };
  }

  const newPipelineKey = newSector.toLowerCase(); // Suporte → suporte, Financeiro → financeiro, Comercial → comercial

  // 1. Resolve a stage key "em_automacao" do novo pipeline UMA vez. É o estado
  //    operacional correto quando o bot acabou de assumir uma mudança de setor
  //    (troca de contexto dentro da conversa = card segue no bot, não volta
  //    pra "novo" nem avança pra "aguardando").
  let emAutomacaoStageKey: string | null = null;
  try {
    const stages = await db
      .select({ key: pipelineStages.key })
      .from(pipelineStages)
      .where(and(
        eq(pipelineStages.workspaceId, workspaceId),
        eq(pipelineStages.pipeline, newPipelineKey),
        sql`${pipelineStages.key} LIKE 'em_automacao%'`,
      ))
      .limit(1);
    emAutomacaoStageKey = stages[0]?.key ?? null;
  } catch (err: any) {
    console.error('[IntentSwitch] Stage lookup error:', err.message);
  }

  // 2. Força pipeline + etapa na conversa (sobrescreve o que quer que esteja lá).
  //    Fazemos ANTES do autoAssignByIntent porque o autoAssign preserva pipeline
  //    quando não-null e evita sobrescrever — mas aqui queremos exatamente isso.
  try {
    const updates: Record<string, any> = { pipeline: newPipelineKey, updatedAt: new Date() };
    if (emAutomacaoStageKey) updates.pipelineEtapa = emAutomacaoStageKey;
    await db
      .update(conversations)
      .set(updates)
      .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
  } catch (err: any) {
    console.error('[IntentSwitch] Pipeline set error:', err.message);
  }

  // 3. Reatribui APENAS à equipe (assignTeamOnly). Round-robin de atendentes
  //    é proibido durante swap automático: o bot ainda está atendendo, e setar
  //    assignedUserId aqui faz isAgentBlockedByStage travar o bot na próxima
  //    mensagem se a etapa estiver em atendimento_humano (herdado de S12 anterior).
  //    Atribuição direta a usuário só acontece quando humano clica "Assumir".
  let teamName: string | null = null;
  try {
    teamName = await assignTeamOnly(workspaceId, conversationId, newIntentNorm!);
  } catch (err: any) {
    console.error('[IntentSwitch] assignTeamOnly error:', err.message);
  }

  // 4. Cria/move o card do Kanban pra em_automacao do novo pipeline.
  if (params.phone && params.contactName) {
    try {
      const { upsertPipelineLead } = await import('./suportePipelineService');
      await upsertPipelineLead(newPipelineKey as any, {
        workspaceId,
        conversationId,
        phone: params.phone,
        contactName: params.contactName,
        etapa: 'em_automacao',
      });
    } catch (err: any) {
      console.error('[IntentSwitch] upsertPipelineLead error:', err.message);
    }
  }

  // 5. Broadcast final reforçando pipeline + etapa pro frontend.
  try {
    broadcastToWorkspace(workspaceId, 'conversation_updated', {
      conversationId,
      pipeline: newPipelineKey,
      ...(emAutomacaoStageKey ? { pipeline_etapa: emAutomacaoStageKey } : {}),
    });
  } catch {}

  console.log(
    `[IntentSwitch] 🔁 conv=${conversationId} ${oldIntent}(${oldIntentNorm})→${newIntent}(${newIntentNorm}) | team=${teamName ?? '(none)'} | pipeline=${newPipelineKey}/${emAutomacaoStageKey ?? '?'} | tags preservadas (acumulam sempre)`
  );

  return { blocked: false, teamName, pipelineSet: newPipelineKey };
}
