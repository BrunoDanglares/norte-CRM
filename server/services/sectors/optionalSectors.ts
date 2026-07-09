// ─────────────────────────────────────────────────────────────────────────────
// SETORES OPCIONAIS — flexibilização por política do provedor (Bruno 2026-06-11)
// ─────────────────────────────────────────────────────────────────────────────
// Cada tenant pode ATIVAR/DESATIVAR estes 3 setores. Por padrão ficam DESLIGADOS
// → comportamento IDÊNTICO ao de hoje (vendas e cancelamento caem no Comercial;
// suporte não tem N2). Quem não ligar nada não enxerga diferença alguma.
//
// NATUREZA de cada setor (são 3 mecanismos técnicos diferentes — não é "criar
// setor novo no cérebro do bot", o que seria invasivo/arriscado):
//
//  - vendas     → DESVIO DE ENTREGA. O bot continua classificando intent VENDAS
//                 como hoje; quando o setor está ON, o fluxo de AQUISIÇÃO
//                 (cobertura/planos/contratação/cadastro = tags C3/C8/C5/C11)
//                 ENTREGA no time Vendas em vez do Comercial. O Comercial segue
//                 com upgrade (C1), fidelidade (C4), titularidade (C7), mudança
//                 de endereço (C9) e indicação (C10) — gestão de cliente existente.
//
//  - retencao   → DESVIO DE ENTREGA. Quando ON, cancelamento (intent CANCELAMENTO
//                 / tag C6) entrega no time Retenção JÁ NO PRIMEIRO SINAL. O fluxo
//                 de retenção do bot (menu de motivos, ofertas, até 3 tentativas)
//                 continua exatamente igual — só muda a coluna/equipe de destino.
//
//  - suporte_n2 → ESCALAÇÃO MANUAL. Quando ON, existe a equipe + coluna Suporte N2.
//                 O BOT NUNCA roteia automaticamente pra lá (não entra em nenhum
//                 mapa intent→team). Só o atendente N1 transfere manualmente via
//                 transfer-team quando não consegue resolver.
//
// IMPORTANTE (arestas conhecidas a tratar quando este registro for cabeado no
// "cadeado de pipelines"):
//   1. ensureIspPipelines desativa qualquer pipeline fora de comercial/suporte/
//      financeiro — a whitelist precisa passar a incluir os pipelineKey ativos.
//   2. LEGACY_MERGE_MAP (routes/pipeline.ts) renomeia equipe "Vendas" → "Comercial"
//      (resíduo de quando o comercial se chamava Vendas). Esse merge precisa
//      DEIXAR de rodar pra equipe Vendas nova quando o setor está ON.
//   3. A regra "1 conversa = 1 setor" (suportePipelineService.upsertPipelineLead)
//      arquiva leads do mesmo telefone em outros pipelines — os novos pipelineKey
//      precisam ser tratados como setores legítimos.

export type OptionalSectorKey = 'vendas' | 'retencao' | 'suporte_n2';

/** Nomes das flags booleanas lidas de ctx.bizRules / tenantSettings.businessRules. */
export type OptionalSectorFlag =
  | 'vendasSectorEnabled'
  | 'retencaoSectorEnabled'
  | 'suporteN2SectorEnabled';

export interface OptionalSectorDef {
  key: OptionalSectorKey;
  /** flag booleana por tenant (undefined/false = setor desligado). */
  flag: OptionalSectorFlag;
  /** key do trilho de Kanban (conversations.pipeline / pipelines.key / teams.pipelineKey). */
  pipelineKey: string;
  /** label exibido na coluna e na equipe. */
  label: string;
  /** nome canônico da equipe (teams.nome). */
  teamName: string;
  cor: string;
  icon: string;
  /** setor "pai" do qual herda a máquina de etapas e de quem desvia o fluxo. */
  parentPipeline: 'comercial' | 'suporte';
  /** intent do motor desviado pra cá quando ON (null = só transferência manual). */
  routedFromIntent: 'VENDAS' | 'CANCELAMENTO' | null;
  /** o BOT pode rotear automaticamente pra cá? (false = exclusivamente manual). */
  autoRoutable: boolean;
  /**
   * Tags de situação que, quando este setor está ON, fazem o card entregar aqui
   * em vez do pipeline pai. Vazio = todo o intent `routedFromIntent` desvia.
   * Vendas usa só as tags de AQUISIÇÃO (resto do comercial fica no Comercial).
   */
  routedTags: string[];
}

export const OPTIONAL_SECTORS: Record<OptionalSectorKey, OptionalSectorDef> = {
  vendas: {
    key: 'vendas',
    flag: 'vendasSectorEnabled',
    pipelineKey: 'vendas',
    label: 'Vendas',
    teamName: 'Vendas',
    cor: '#e0a106',
    icon: 'TrendingUp',
    parentPipeline: 'comercial',
    routedFromIntent: 'VENDAS',
    autoRoutable: true,
    // Só aquisição desvia: cobertura (C3), consulta de planos (C8), nova
    // contratação (C5), coleta de cadastro (C11). C1 (upgrade), C4 (fidelidade),
    // C7 (titularidade), C9 (endereço), C10 (indicação) — gestão de cliente
    // existente — seguem no Comercial. C0 (entrada genérica) NÃO desvia: a conversa
    // nasce no Comercial e MIGRA pra Vendas só quando a tag de aquisição aparece.
    routedTags: ['C3', 'C8', 'C5', 'C11'],
  },
  retencao: {
    key: 'retencao',
    flag: 'retencaoSectorEnabled',
    pipelineKey: 'retencao',
    label: 'Retenção',
    teamName: 'Retenção',
    cor: '#dc2626',
    icon: 'HeartHandshake',
    parentPipeline: 'comercial',
    routedFromIntent: 'CANCELAMENTO',
    autoRoutable: true,
    // Todo o fluxo de cancelamento/retenção desvia já no primeiro sinal.
    routedTags: ['C6'],
  },
  suporte_n2: {
    key: 'suporte_n2',
    flag: 'suporteN2SectorEnabled',
    pipelineKey: 'suporte_n2',
    label: 'Suporte N2',
    teamName: 'Suporte N2',
    cor: '#2563eb',
    icon: 'ShieldAlert',
    parentPipeline: 'suporte',
    routedFromIntent: null,
    autoRoutable: false,
    routedTags: [],
  },
};

export const OPTIONAL_SECTOR_LIST: readonly OptionalSectorDef[] = Object.values(OPTIONAL_SECTORS);

/** Todos os pipelineKey opcionais (pra estender whitelists/enums do motor). */
export const OPTIONAL_PIPELINE_KEYS: readonly string[] = OPTIONAL_SECTOR_LIST.map(s => s.pipelineKey);

/** Mapa pipelineKey → equipe canônica (pra estender PIPELINE_TO_TEAM). */
export const OPTIONAL_PIPELINE_TO_TEAM: Record<string, string> = Object.fromEntries(
  OPTIONAL_SECTOR_LIST.map(s => [s.pipelineKey, s.teamName]),
);

/**
 * Dado o intent base, a tag aplicada e as flags do tenant, resolve se o card deve
 * DESVIAR pra um setor opcional — retorna a def do setor ou null (segue no pai).
 * Pura: não toca DB. Lê as 3 flags de um objeto tipo bizRules.
 */
export function resolveOptionalSectorOverride(params: {
  intent?: string | null;
  situationCode?: string | null;
  flags: Partial<Record<OptionalSectorFlag, boolean | undefined>>;
}): OptionalSectorDef | null {
  const { intent, situationCode, flags } = params;
  for (const sec of OPTIONAL_SECTOR_LIST) {
    if (!sec.autoRoutable) continue;                 // suporte_n2 nunca desvia automático
    if (!flags?.[sec.flag]) continue;                // setor desligado
    if (sec.routedFromIntent && intent !== sec.routedFromIntent) continue;
    // Se o setor restringe por tags (ex: Vendas = só aquisição), exige match.
    if (sec.routedTags.length > 0) {
      const base = situationCode ? situationCode.split('_')[0] : null; // C6_PRECO → C6
      if (!base || !sec.routedTags.includes(base)) continue;
    }
    return sec;
  }
  return null;
}
