# Arbitrator Integration Guide (F5.8)

Bruno 2026-05-23 — guia de como integrar o Arbitrator no `ispAgentEngine.ts`.

## Estado atual (commit F5.8 + F5-audit)

✅ **48/48 rules migradas** (44 originais + 4 audit gap-fixes) + `runFullArbitrator` pronto.
❌ **Engine NÃO modificado** — rules ficam dormentes até integração real.

### F5-audit gap fixes (rules 45-48 + reorder)
- **45_sessionStaleReset** — 4h reset preservando CPF (gap descoberto pós-F5.8)
- **46_maxTurns** — escala humano após 30 turnos (anti-loop infinito)
- **47_intentSovereignty** — descarta pending_priority quando cliente quer outro setor
- **48_priorityChoiceHook** — processa resposta de pending_priority pendente
- **Reorder FULL_RULES_ORDER** — `phase3InvalidCpf` movido ANTES de `phase1DefaultMenu`
  (sem isso, "11111111111" puro caía em menu genérico em vez de aviso CPF inválido).

Smoke E2E: 28/28 + audit-fix 37/37 (incluindo confirmação do reorder).

### Gaps médios PENDENTES (ficam pra F5.8.x dispatcher integration)
- 🟡 GAP 6: rules thin (phase2MainFlow, phase5CMultiContratos, phase4CpfDetected,
  phase5Enrichment) delegam ao engine via `callHandler` — dispatcher precisa
  mapear cada um pra função real.
- 🟡 GAP 7: FORCE_SECTOR_HINT genérico — Camada E.5 não criada (REGRAS ABSOLUTAS
  específicas 39-42 cobrem casos conhecidos; genérico seria refac maior).
- 🟡 GAP 8: side-effects duplicados (updateSession + stateUpdates) em 11 rules.
  Padronização exige decidir um canal único — dispatcher F5.8.2 decide.

Backup canônico antes de qualquer integração:
- Tag: `pre-f5-arbitrator-2026-05-22`
- Cópia: `server/services/_legacy/ispAgentEngine.pre-f5.ts`

## Por que adiar a integração no engine

Cada uma das 44 rules foi extraída fielmente, mas:

1. **Side-effects duplicados**: várias rules chamam `n8nMemoryService.updateSession`
   e `n8nSendService` diretamente (pra preservar comportamento). Integração final
   exige decidir: rule continua fazendo side-effect OU dispatch (engine) faz baseado
   no `Intent.stateUpdates`. Hoje: misto.

2. **Precedência fina**: smoke end-to-end revelou 1 caso onde `phase1DefaultMenu`
   pega antes de `phase3InvalidCpf` (PHASE 1 vem antes de PHASE 3 na ordem).
   Pode estar correto OU precisar refinement — só conv-replay real confirma.

3. **Signal inputs**: várias rules dependem de signals que o engine precisa popular
   ANTES de `runFullArbitrator` (sessionCpf, cpfFromMessage, tipoCliente, erpData,
   lgpdEvalResult, contactName, etc). Integração exige checklist completo.

4. **Helpers do engine ainda chamados por rules thin** (phase2MainFlow,
   phase5CMultiContratos, phase4CpfDetected): essas emitem `Intent route_to_handler`
   com `metadata.callHandler` — dispatch precisa mapear pra função real.

## Plano de integração (recomendado por ondas)

### F5.8.1 — Feature flag + shadow mode (segurança máxima)

```ts
// server/services/ispAgentEngine.ts (próximo de L3640, _runISPAgentInner)

const ARBITRATOR_MODE = process.env.ENGINE_USE_ARBITRATOR || 'off';
// Modos: 'off' (default — legacy intocado)
//        'shadow' (roda Arbitrator MAS ignora intent — só loga winner)
//        'on' (consome Intent, fallback legacy se kind=continue)

if (ARBITRATOR_MODE === 'shadow') {
  // Roda Arbitrator em paralelo, NÃO consome decisão
  runFullArbitrator(arbCtx).then(r => {
    console.log(`[ArbShadow] conv=${conversationId} winner=${r.winnerRule} kind=${r.intent.kind} reason=${r.intent.reason}`);
  }).catch(() => {});
  // Continua fluxo legacy normalmente
}
```

Rodar `'shadow'` por 1-2 semanas em prod pra coletar:
- Quais rules pegam mais turnos
- Discordâncias entre Arbitrator e fluxo legacy (mesmo turno, 2 decisões diferentes)
- Conv-replay de casos onde Arbitrator decidiria diferente

### F5.8.2 — Integração `'on'` com fallback (incremental)

```ts
const arbResult = await runFullArbitrator(arbCtx);

switch (arbResult.intent.kind) {
  case 'skip_turn':
    if (arbResult.intent.result) return arbResult.intent.result;
    break;

  case 'redispatch':
    const r = arbResult.intent.redispatchOverrides;
    return runISPAgent({
      ...ctx,
      messageText: r?.messageText ?? ctx.messageText,
      buttonId: r?.buttonId ?? ctx.buttonId,
      _depth: depth + (r?.incrementDepth ? 1 : 0),
    });

  case 'escalate_humano':
    await finalizeHumanHandoff({
      workspaceId, conversationId, contactName,
      phone: phoneClean,
      intent: arbResult.intent.sector || 'HUMANO',
      situationCodes: arbResult.intent.situationCode ? [arbResult.intent.situationCode] : [],
      cpf: sessionDados.cpf || session?.cpf,
    });
    return {
      success: true,
      intent: 'HUMANO',
      prompt_name: arbResult.intent.source,
      response: arbResult.intent.response || 'Escalado para humano (Arbitrator)',
    };

  case 'route_to_handler':
    // Dispatch baseado em metadata.callHandler
    const handler = arbResult.intent.metadata?.callHandler;
    switch (handler) {
      case 'novoCliente':
        return handleNovoCliente({ ...ctx, emojiLevel });
      case 'phase2NovoCliente':
        // Cai no caminho legacy de PHASE 2 main flow (~600 LOC)
        break; // continue fluxo
      case 'phase5CMultiContratos':
        // Cai no caminho legacy de PHASE 5C
        break; // continue fluxo
      case 'sendCpfRequest':
        // Helpers buildIntentPreCpfUpdates + buildCpfRequestMessage
        break; // continue fluxo
      case 'clienteNaoEncontrado':
        return handleClienteNaoEncontrado(ctx, session, cpf);
      case 'finalizeHumanHandoff':
        // Já tratado em 'escalate_humano'
        break;
      default:
        // Sem callHandler específico: roteia pro agente do setor
        if (arbResult.intent.sector === 'FINANCEIRO') return runFinanceiroAgent(...);
        if (arbResult.intent.sector === 'SUPORTE_TECNICO') return runSuporteAgent(...);
        // etc
    }
    break;

  case 'send_template':
    // Engine envia arbResult.intent.response
    break;

  case 'ask_clarification':
    // Engine envia pergunta + opções
    break;

  case 'continue':
    // Nenhuma rule decidiu — engine roda fluxo legacy intacto
    break;
}
```

### F5.8.3 — Validação por conv-replay

Antes de remover `ENGINE_USE_ARBITRATOR=on` como feature flag:

1. Selecionar 20+ conversas reais cobrindo cada categoria de regra
2. Rodar `runFullArbitrator` sobre cada turno
3. Comparar decisões com fluxo legacy
4. Identificar discrepâncias → ajustar precedência (FULL_RULES_ORDER) ou
   gates específicos das rules

### F5.8.4 — Cleanup do legacy

Após integração estável (sem regressões em 2-4 semanas prod):

1. Remover ifs inline do engine que foram migrados pra rules
2. Manter apenas o trecho que chama `runFullArbitrator` + dispatcher
3. Engine final fica ~5k LOC menor (de ~16k → ~11k)

## Inputs do ArbitratorContext

Lista completa de signals que engine precisa popular:

| Signal | Tipo | Origem |
|---|---|---|
| `sessionCpf` | string \| null | `session?.cpf` |
| `cpfFromMessage` | string \| null | `extractCPF(messageText)` |
| `tipoCliente` | 'novo' \| 'existente' \| null | `sessionDados.tipo_cliente` |
| `sessionContratoId` | string \| null | `session?.contrato_id` |
| `sessionIdentified` | boolean | `!!session?.identificado` |
| `isInC11Checklist` | boolean | derivado de `sessionDados._deterministic_c11_stage` |
| `isFirstIdentification` | boolean | `cpfFromMessage != null && !sessionDados.departamento_selecionado` |
| `aguardandoTriagem` | boolean | `sessionDados.aguardando_triagem === true` |
| `temConteudo` | boolean | `mensagemNormalizada.length > 0 \|\| !!buttonId` |
| `contactName` | string | `ctx.contactName` |
| `emojiLevel` | 'alto'\|'medio'\|'baixo' | `tenantSettings.businessRules.emojiLevel` |
| `departamentoSelecionado` | string \| null | `sessionDados.departamento_selecionado` |
| `recentTurns` | Array | `getConversationHistory(...).slice(-7, -1)` |
| `aiPreClass` | object | **POPULADO PELO ARBITRATOR** (rule 10) |
| `erpData` | ERPEnrichment | **POPULADO PELO DISPATCH** após enrichmentCompleto (rule 36 sinaliza) |
| `lgpdEvalResult` | object | **POPULADO PELO DISPATCH** após evaluatePhoneCpfMatch |

## Signals POPULADOS PELAS RULES (dispatch consome)

| Signal | Setter | Consumer |
|---|---|---|
| `aiPreClass` | rule 9 (statusRedeOverride) ou rule 10 (aiPreClass) | rules 11, 15, 16, 27, 28, 30 |
| `pendingSessionUpdates` | rules 9, 11 | Dispatch persiste em `n8nMemoryService.updateSession` |
| `welcomeSentThisTurn` | rule 14 | rule 31 (defaultMenu) — evita saudação dup |
| `phase1FaqAttempt` | rule 29 | Dispatch chama `tryFaqUniversalReply` |
| `phase4IntentDetectionPending` | rule 34 | Dispatch processa `detectFidelidadeIntentPreCpf` + AI hint + INTENT_KEYWORDS |
| `phase5EnrichmentPending` | rule 36 | Dispatch chama `n8nErpService.enrichmentCompleto` + LGPD eval |
| `erpRetryNeeded` | rule 20 | Dispatch faz retry silencioso 1x |

## Cuidados durante integração

1. **PHASE 5 enrichment é especial**: rule 36 sinaliza mas NÃO chama ERP.
   Dispatch precisa chamar `n8nErpService.enrichmentCompleto` ANTES de rodar
   rules 20, 21, 37, 38 (que consomem `erpData`).

2. **Order matters muito**: `FULL_RULES_ORDER` foi calibrada com base no engine
   atual. Reordenar uma rule pode quebrar precedência em casos edge — sempre
   smoke + shadow mode.

3. **Rules thin com `callHandler`**: phase2MainFlow, phase5CMultiContratos,
   phase4CpfDetected emitem Intent route_to_handler mas a lógica REAL ainda
   está no engine. Dispatch precisa mapear `metadata.callHandler` pra função
   correta.

4. **State mutation**: várias rules chamam `n8nMemoryService.updateSession`
   DIRETAMENTE durante `evaluate()` (encerradoReset, humanoStale, statusRede-
   Override, phase4CpfDetected, etc). Engine deve garantir que essas mutações
   sejam refletidas no `sessionDados` antes do próximo turno.

## Próximos passos sugeridos

- **F5.8.1** (1 sessão): adicionar `ENGINE_USE_ARBITRATOR=shadow` no engine,
  rodar 1-2 semanas em prod, coletar discordâncias
- **F5.8.2** (1-2 sessões): adicionar dispatcher real, ativar `=on` em 1 tenant
  piloto
- **F5.8.3** (1 sessão): expandir `=on` pra todos os tenants
- **F5.8.4** (1 sessão): remover ifs inline migrados do engine

## Resumo

Arbitrator está **PRONTO arquiteturalmente**: 44 rules + chain ordenada +
contrato declarativo + smoke 28/28 end-to-end. Engine não tocado por
segurança. Integração é trabalho de **mais 3-4 sessões dedicadas** com
shadow mode + conv-replay + cleanup.
