import { db } from "../db";
import { tenantSettings, workspaces, type TenantSettingsJson, type AgentCapabilities } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  FINANCEIRO: {
    enabled: true,
    situations: ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12','F13','F14','F15','F16'],
    escalate_to_human_if_disabled: true,
  },
  SUPORTE_TECNICO: {
    enabled: true,
    situations: ['S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12','S13','S14','S15','S16','S17'],
    escalate_to_human_if_disabled: true,
  },
  VENDAS: {
    enabled: true,
    situations: ['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','C11'],
    escalate_to_human_if_disabled: true,
  },
  CANCELAMENTO: {
    enabled: true,
    situations: [],
    escalate_to_human_if_disabled: true,
  },
};

const DEFAULT_SETTINGS: TenantSettingsJson = {
  businessRules: {
    suspendedToFinance: true,
    allowDepartmentSwitch: true,
    confidenceThreshold: 0.7,
    showOnlyOverdueIfSuspended: true,
    allowPix: true,
    allowBarcode: true,
    allowTrustUnlock: false,
    // Bruno 2026-05-21: regra de produto — agente NUNCA abre OS automaticamente.
    // Mesmo se o tenant não configurou q80, o default já trava em false.
    allowAutoOpenTicket: false,
    requireRebootStep: true,
    responseDelay: 10,
    // Bruno 2026-05-21: 180 era resíduo da versão antiga de 1 estágio (180s direto
    // pro CSAT). Refatorou pra 2 estágios em 144d683b — STAGE_0=300s (pergunta de
    // continuidade), STAGE_1=900s (CSAT). Default precisa bater com STAGE_0.
    informationalResolveTimeoutSec: 300,
    agent_capabilities: DEFAULT_AGENT_CAPABILITIES,
    humanize: {
      coalescenceWindowMs: 6000,
      coalescenceMaxMs: 15000,
      burstGapMs: 1500,
      burstExtensionMs: 4000,
      mediaFlushMs: 2000,
      turnCloseFlushMs: 1000,
      abortOnClientTyping: true,
    },
    limits: {
      pausaMaxDias: 90,
      checklistMaxTentativas: 3,
      sessionStaleMs: 4 * 60 * 60 * 1000,
      maxRecursionDepth: 5,
      maxTurnsPerSession: 30,
      ambiguityRetriesMax: 2,
      maxSupportDeniedBeforeEscalate: 2,
    },
    smalltalk: {
      enabled: true,
      harassmentLimit: 2,
      consecutiveLimit: 3,
    },
    // Piso de velocidade pra Wi-Fi 2.4 GHz (limite físico ~40-100 Mbps).
    // Usado pelo suporteAgent quando o cliente cai na rede 2.4 GHz no speedtest.
    velocidadeMinima2_4g: 50,
  },
  plans: {
    enabled: false,
    items: [],
    // Bruno 2026-06-11: planos por cidade (nome oficial + apelidos + CEPs + planos
    // próprios). O agente confirma cobertura por aqui. Vazio = comportamento atual.
    cities: [],
  },
  serviceHours: {
    enabled: false,
    timezone: "America/Sao_Paulo",
    weekdays: { start: "08:00", end: "18:00" },
    saturday: { start: "08:00", end: "12:00" },
  },
  compliance: {
    // 'soft' por default desde 2026-05-02 — caso real (Bruno, conv 350):
    // cliente do telefone X digitou CPF de outro titular e o bot entregou
    // dados financeiros completos (faturas, valores, PIX). Vazamento de PII
    // protegida. Em 'soft', telefone≠CPF do ERP escala pra humano com tag
    // de auditoria — não bloqueia primeira interação (phone_unknown allow).
    lgpdMode: 'soft',
    mediaRetentionDays: 30,
    // Janela CDC conservadora. Tenants existentes em dia útil normal (08:00 BRT)
    // continuam recebendo cobrança igual — só domingo e feriado passam a ser
    // bloqueados. É a mudança correta legalmente.
    billingWindow: {
      enabled: true,
      weekdays: { start: '08:00', end: '20:00' },
      saturday: { start: '08:00', end: '13:00' },
      sunday: false,
      respectHolidays: true,
      extraHolidays: [],
    },
  },
};

class TenantSettingsService {
  // Cache in-memory com TTL curto. Uma mensagem entrante aciona ~5 call-sites
  // (ispAgentEngine, comercialAgent, message-processor, etc.) — sem cache
  // vira 5 SELECTs idênticos no Postgres. TTL de 60s é seguro: mudanças de
  // settings são administrativas e o invalidateCache é chamado em update/reset.
  private cache = new Map<string, { settings: TenantSettingsJson; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000;

  private invalidateCache(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private invalidateAllCache(): void {
    this.cache.clear();
  }

  // Busca settings do workspace-template (o Bruno marca o dele com
  // workspaces.is_template_source = true). Se não houver template ou
  // se o template não tem row em tenantSettings, retorna null — o caller
  // cai no DEFAULT_SETTINGS hardcoded.
  private async loadTemplateSettings(): Promise<TenantSettingsJson | null> {
    try {
      const [tpl] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.isTemplateSource, true))
        .limit(1);
      if (!tpl) return null;
      const [row] = await db
        .select()
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tpl.id));
      if (!row) return null;
      return this.mergeWithDefaults(row.settingsJson as Partial<TenantSettingsJson>);
    } catch (err: any) {
      console.error(`[Tenant Settings] loadTemplateSettings error:`, err.message);
      return null;
    }
  }

  async getTenantSettings(tenantId: string): Promise<TenantSettingsJson> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.settings;
    }

    const [row] = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));

    let settings: TenantSettingsJson;
    if (row) {
      // Se é uma row marcada como herdada do template, re-sincroniza:
      // copia o settings atuais do template toda vez. Assim, quando o Bruno
      // atualiza o template dele, tenants não-preenchidos recebem as mudanças.
      if ((row as any).inheritedFromTemplate === true) {
        const tpl = await this.loadTemplateSettings();
        if (tpl) {
          console.log(`[Tenant Settings] Re-sync from template for tenant ${tenantId} (cached ${this.CACHE_TTL_MS / 1000}s)`);
          this.cache.set(tenantId, { settings: tpl, expiresAt: Date.now() + this.CACHE_TTL_MS });
          return tpl;
        }
        // Template sumiu — degrada pros settings salvos
      }
      console.log(`[Tenant Settings] Loaded for tenant ${tenantId} (cached ${this.CACHE_TTL_MS / 1000}s)`);
      settings = this.mergeWithDefaults(row.settingsJson as Partial<TenantSettingsJson>);
    } else {
      settings = await this.createFromTemplateOrDefault(tenantId);
    }

    this.cache.set(tenantId, { settings, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return settings;
  }

  async updateTenantSettings(tenantId: string, data: Partial<TenantSettingsJson>): Promise<TenantSettingsJson> {
    const current = await this.getTenantSettings(tenantId);
    const merged = this.deepMerge(current, data);

    const [existing] = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));

    if (existing) {
      // Primeira edição real do tenant — sai do modo herdado. A partir daqui
      // ele tem sua própria config, independente do template.
      await db
        .update(tenantSettings)
        .set({ settingsJson: merged, inheritedFromTemplate: false, updatedAt: sql`now()` })
        .where(eq(tenantSettings.tenantId, tenantId));
    } else {
      await db
        .insert(tenantSettings)
        .values({ tenantId, settingsJson: merged, inheritedFromTemplate: false });
    }

    this.invalidateCache(tenantId);
    console.log(`[Tenant Settings] Updated for tenant ${tenantId}`);
    return merged;
  }

  async resetTenantSettings(tenantId: string): Promise<TenantSettingsJson> {
    // Reset: volta pro estado herdado. Próximo getTenantSettings vai re-sincronizar
    // com o template atual (ou cair no DEFAULT_SETTINGS se não houver template).
    const tpl = await this.loadTemplateSettings();
    const seed = tpl ?? DEFAULT_SETTINGS;

    const [existing] = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));

    if (existing) {
      await db
        .update(tenantSettings)
        .set({ settingsJson: seed, inheritedFromTemplate: !!tpl, updatedAt: sql`now()` })
        .where(eq(tenantSettings.tenantId, tenantId));
    } else {
      await db
        .insert(tenantSettings)
        .values({ tenantId, settingsJson: seed, inheritedFromTemplate: !!tpl });
    }

    this.invalidateCache(tenantId);
    console.log(`[Tenant Settings] Reset for tenant ${tenantId} (inherited=${!!tpl})`);
    return { ...seed };
  }

  // Marca um workspace como template source. Apenas UM workspace deve ter essa
  // flag por vez — chamadas subsequentes limpam o antigo antes.
  // Também desativa `inheritedFromTemplate` do próprio workspace que vira template
  // (pra que o template seja "dono" dos próprios settings, não herdeiro de si mesmo).
  async setTemplateSource(workspaceId: string): Promise<{ ok: boolean; reason?: string }> {
    // Verifica que o workspace existe antes de mexer em qualquer coisa —
    // se não existir, um UPDATE silencioso deixaria o sistema sem template.
    const [exists] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!exists) {
      console.error(`[Tenant Settings] setTemplateSource: workspace ${workspaceId} não encontrado`);
      return { ok: false, reason: 'workspace_not_found' };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(workspaces)
        .set({ isTemplateSource: false })
        .where(eq(workspaces.isTemplateSource, true));
      await tx
        .update(workspaces)
        .set({ isTemplateSource: true })
        .where(eq(workspaces.id, workspaceId));
      // Desativa herança no próprio template — ele É a fonte da verdade,
      // não deve herdar de si mesmo.
      await tx
        .update(tenantSettings)
        .set({ inheritedFromTemplate: false })
        .where(eq(tenantSettings.tenantId, workspaceId));
    });
    // Mudou o template source → tenants que herdam dele têm cache stale. Como
    // não sabemos quais herdam, limpa tudo (evento raro, custo baixo).
    this.invalidateAllCache();
    console.log(`[Tenant Settings] Template source set to workspace ${workspaceId}`);
    return { ok: true };
  }

  private async createFromTemplateOrDefault(tenantId: string): Promise<TenantSettingsJson> {
    // Comportamento: SNAPSHOT — copia a config do template (ou defaults) e já
    // marca inheritedFromTemplate=false. O tenant vira dono imediato da própria
    // config, sem resync contínuo. Se quiser re-aplicar o template atual depois,
    // use applyTemplateToExistingTenant() via endpoint admin.
    const tpl = await this.loadTemplateSettings();
    const seed = tpl ?? DEFAULT_SETTINGS;
    try {
      await db
        .insert(tenantSettings)
        .values({ tenantId, settingsJson: seed, inheritedFromTemplate: false })
        .onConflictDoNothing();
      // ISP removido: a cópia de situation_prompts do template saiu com o módulo
      // ISP (isp_situation_prompts dropada). Não há nada a copiar aqui.
      console.log(`[Tenant Settings] Created for tenant ${tenantId} (snapshot from ${tpl ? 'template' : 'defaults'})`);
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) {
        console.error(`[Tenant Settings] Error creating:`, e.message);
      }
    }
    return { ...seed };
  }

  // ─── Seed de novo tenant (chamado pela criação de workspace) ──────────
  // Idempotente: pode rodar várias vezes. Copia settingsJson + situation_prompts
  // do workspace-template. Usa onConflictDoNothing pra não sobrescrever tenant
  // já configurado.
  async seedNewTenantFromTemplate(tenantId: string): Promise<{ seededSettings: boolean; seededSituations: number }> {
    const tpl = await this.loadTemplateSettings();

    // Settings: só insere se não houver row ainda
    const [existing] = await db
      .select({ tenantId: tenantSettings.tenantId })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));

    let seededSettings = false;
    if (!existing) {
      const seed = tpl ?? DEFAULT_SETTINGS;
      await db
        .insert(tenantSettings)
        .values({ tenantId, settingsJson: seed, inheritedFromTemplate: false });
      seededSettings = true;
    }

    // Situações: só copia se o tenant não tem nenhuma ainda (evita duplicar)
    let seededSituations = 0;
    if (tpl) {
      seededSituations = await this.copySituationPromptsFromTemplate(tenantId);
    }

    this.invalidateCache(tenantId);
    console.log(`[Tenant Settings] Seeded tenant ${tenantId}: settings=${seededSettings}, situations=${seededSituations}`);
    return { seededSettings, seededSituations };
  }

  // ─── Re-aplica o template atual a um tenant existente ─────────────────
  // Sobrescreve settingsJson e faz merge das situation_prompts (insere as que
  // não existem, mantém as que já existem). Uso: endpoint admin pra ressincronizar
  // clientes que ainda não customizaram.
  async applyTemplateToExistingTenant(
    tenantId: string,
    opts: { overwriteSituations?: boolean } = {}
  ): Promise<{ settingsReplaced: boolean; situationsAdded: number; situationsUpdated: number; reason?: string }> {
    const tpl = await this.loadTemplateSettings();
    if (!tpl) {
      return { settingsReplaced: false, situationsAdded: 0, situationsUpdated: 0, reason: 'no_template_configured' };
    }

    // Não aplica no próprio template — evita loop e dados inconsistentes
    const [wsRow] = await db
      .select({ isTemplate: workspaces.isTemplateSource })
      .from(workspaces)
      .where(eq(workspaces.id, tenantId));
    if (wsRow?.isTemplate === true) {
      return { settingsReplaced: false, situationsAdded: 0, situationsUpdated: 0, reason: 'target_is_the_template' };
    }

    // Settings: upsert (substitui settingsJson pelo do template)
    const [existing] = await db
      .select({ tenantId: tenantSettings.tenantId })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));

    if (existing) {
      await db
        .update(tenantSettings)
        .set({ settingsJson: tpl, inheritedFromTemplate: false, updatedAt: sql`now()` })
        .where(eq(tenantSettings.tenantId, tenantId));
    } else {
      await db
        .insert(tenantSettings)
        .values({ tenantId, settingsJson: tpl, inheritedFromTemplate: false });
    }

    // Situações: insere as do template (SKIP as que já existem no destino,
    // a menos que overwriteSituations=true)
    const { added, updated } = await this.mergeSituationPromptsFromTemplate(tenantId, opts.overwriteSituations ?? false);

    this.invalidateCache(tenantId);
    console.log(`[Tenant Settings] Applied template to ${tenantId}: settings=replaced, +${added} situations, ~${updated} updated`);
    return { settingsReplaced: true, situationsAdded: added, situationsUpdated: updated };
  }

  // ─── Cópia de situation_prompts (ISP) — REMOVIDO ──────────────────────
  // O módulo ISP foi arrancado do CRM; a tabela isp_situation_prompts não
  // existe mais. Mantemos a assinatura como no-op pra não quebrar os callers
  // (seed/apply de template), que só usam o número retornado.
  private async copySituationPromptsFromTemplate(_targetTenantId: string): Promise<number> {
    return 0;
  }

  // ─── Merge de situation_prompts (ISP) — REMOVIDO ──────────────────────
  // No-op preservando a assinatura. Sem ISP não há situações pra copiar.
  private async mergeSituationPromptsFromTemplate(
    _targetTenantId: string,
    _overwrite: boolean
  ): Promise<{ added: number; updated: number }> {
    return { added: 0, updated: 0 };
  }

  private mergeWithDefaults(saved: Partial<TenantSettingsJson>): TenantSettingsJson {
    return this.deepMerge(DEFAULT_SETTINGS, saved);
  }

  private deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
    const result = { ...base };
    for (const key of Object.keys(override) as (keyof T)[]) {
      const val = override[key];
      if (val !== undefined && val !== null && typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object" && !Array.isArray(result[key])) {
        result[key] = this.deepMerge(result[key] as any, val as any);
      } else if (val !== undefined) {
        result[key] = val as T[keyof T];
      }
    }
    return result;
  }
}

export const tenantSettingsService = new TenantSettingsService();
export { DEFAULT_SETTINGS, DEFAULT_AGENT_CAPABILITIES };

export function isAgentEnabled(
  capabilities: AgentCapabilities | undefined,
  agent: string
): boolean {
  if (!capabilities) return true;
  const cap = capabilities[agent as keyof AgentCapabilities];
  return cap?.enabled ?? true;
}

export function isSituationEnabled(
  capabilities: AgentCapabilities | undefined,
  agent: string,
  situationCode: string
): boolean {
  if (!capabilities) return true;
  const cap = capabilities[agent as keyof AgentCapabilities];
  if (!cap?.enabled) return false;
  if (!cap.situations || cap.situations.length === 0) return true;
  return cap.situations.includes(situationCode);
}
