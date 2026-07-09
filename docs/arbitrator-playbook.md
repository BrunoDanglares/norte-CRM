# Arbitrator Playbook

Guia prático pra Bruno operar/manter o Arbitrator em produção.

## ENV vars

```bash
# Controle principal
ENGINE_USE_ARBITRATOR=off       # default — fluxo legacy 100%
ENGINE_USE_ARBITRATOR=shadow    # roda em paralelo, só loga
ENGINE_USE_ARBITRATOR=on        # consome decisão (com fallback automático)

# Sampling shadow (0.0-1.0 — fração de turnos pra rodar shadow)
ENGINE_ARBITRATOR_SHADOW_SAMPLE=1.0

# Limites
ISP_MAX_TURNS_PER_SESSION=30    # rule 46 — escala humano após N turnos
ISP_SESSION_STALE_MS=14400000   # rule 45 — 4h reset (preserva CPF)
ISP_MAX_RECURSION_DEPTH=5       # rule 01 — anti-loop recursão
DEDUP_WINDOW_MS=30000           # rule 02 — dedup webhook replay
```

## Logs estruturados

| Prefixo | Significado |
|---|---|
| `[ArbShadow]` | Modo shadow — só observa, não consome |
| `[ArbOn]` | Modo on — decisão real ou fallback explícito |
| `[ArbDispatch]` | Dispatcher executando Intent |
| `[Arbitrator:<rule>]` | Rule específica logando dentro do evaluate |

### Formato `[ArbOn]`
```
[ArbOn] conv=X winner=Y kind=Z reason=R arbMs=M sector=S sub=Sub
[ArbOn] ✅ DISPATCHED conv=X winner=Y       # decisão consumida
[ArbOn] ⏭️ FALLBACK LEGACY conv=X ...      # caiu pra legacy
```

## Como adicionar uma rule nova

1. Criar arquivo em `server/services/agents/arbitrator/rules/NN_nomeRule.ts`:
```ts
import type { ArbitratorRule, Intent } from '../types';

export const minhaRule: ArbitratorRule = {
  name: 'minhaRule',
  category: 'phase' | 'state' | 'state-machine' | 'pre-gate' | 'absolute' | 'ai-first-override' | 'ai-first-classify',

  async evaluate(ctx) {
    // Lógica que LÊ ctx (readonly) e DECIDE
    if (!seuGate) return null;  // não decide — próxima rule tenta

    return {
      kind: 'route_to_handler' | 'skip_turn' | 'redispatch' | 'escalate_humano' | ...,
      sector: 'FINANCEIRO',
      source: 'rule:minhaRule',
      reason: 'descricao_estruturada',
      // outros campos conforme tipo Intent
    };
  },
};
```

2. Exportar em `arbitrator/index.ts`
3. Adicionar em `runFullArbitrator.ts` na ORDEM correta (precedência importa!)
4. Smoke em `scripts/smoke-arbitrator-XXX.ts`
5. Type-check + commit

### ⚠️ Side-effects nas rules (GAP 8 padrão)

**REGRA:** rules NÃO devem chamar `n8nMemoryService.updateSession` diretamente.
Toda mutação de sessão deve passar por `Intent.stateUpdates` — dispatcher persiste
automaticamente antes de executar a ação.

```ts
// ❌ ERRADO (padrão antigo, ainda existe em ~25 rules legacy)
await n8nMemoryService.updateSession(String(ctx.conversationId), {
  fluxoAtual: 'FINANCEIRO',
  dadosColetados: { ...ctx.sessionDados, sub_financeiro: 'pausa' },
});
const intent: Intent = { kind: 'route_to_handler', sector: 'FINANCEIRO', ... };

// ✅ CERTO (padrão GAP 8 — declarativo)
const intent: Intent = {
  kind: 'route_to_handler',
  sector: 'FINANCEIRO',
  stateUpdates: {
    fluxoAtual: 'FINANCEIRO',           // top-level reservado (vira fluxoAtual)
    sub_financeiro: 'pausa',            // resto vai pra dadosColetados (merge)
    intent_auto_detected: true,
  },
};
```

**Top-level keys reservadas em stateUpdates** (dispatcher mapeia pra colunas
top-level da sessão; resto vai pra dadosColetados merged):
- `fluxoAtual`
- `ultimoIntent`
- `cpf`
- `contratoId`
- `identificado`

Rules já migradas (referência): 22, 23, 24, 39, 40, 43 (fase 1) + 17, 18, 27,
35, 38, 41, 42 (fase 2) + 06, 21, 28, 31, 32, 34, 46, 49 (fase 3).

### ⚠️ EXCEÇÕES (não migrar — padrão legítimo)

**Signal populators** (rules que retornam `null` propagando signal):
- 09 `statusRedeOverride` — popula `aiPreClass` signal + persiste reset stickies
- 10 `aiPreClass` — popula signal aiPreClass
- 11 `slownessPreClassify` — popula categoria_lentidao signal
- 14 `welcomeAfterReset` — envia welcome msg + persiste flag
- 16 `ack` — envia closing msg + persiste last_ack_at
- 29 `phase1FaqFirstTurn` — popula signal phase1FaqAttempt
- 47 `intentSovereignty` — limpa pending_priority_choice (retorna null)
- 50 `forceSectorHint` — popula intent_force_hint signal

**Razão:** dispatcher SÓ processa rules que emitem `Intent !== null`. Rules que
retornam `null` (signal populators) precisam fazer `updateSession` direto pra
efeito IMEDIATO no banco — caso contrário, próximas rules não veriam a
mudança (ctx.sessionDados é readonly intra-turno).

**Deep reset rules** (substituem `dadosColetados` por `{}` — operação destrutiva):
- 04 `encerradoReset` — wipe session + delete tags + clear pipeline
- 05 `humanoStale` — mesmo wipe
- 13 `encerramentoUniversal` — resolveConversationWithCsat + flush metrics
- 45 `sessionStaleReset` — wipe preservando CPF

**Razão:** `stateUpdates` faz MERGE com sessionDados atual. Deep reset precisa
de REPLACE (`dadosColetados: {}`) — não compatível com pattern stateUpdates.

## Como debugar Intent perdido

Cliente diz X → bot não responde / responde errado:

1. **Veja os logs `[ArbOn]`** da conversa
2. Identifique `winner=<rule>` que decidiu
3. Se foi `⏭️ FALLBACK LEGACY`:
   - Engine processou legacy — bug está no engine, não no Arbitrator
   - Investigar engine ifs com ferramenta de trace
4. Se foi `✅ DISPATCHED`:
   - Rule pegou turno que não devia OU decidiu errado
   - Olhar evaluate() da rule
   - Conferir ordem em `FULL_RULES_ORDER` — talvez rule anterior deveria ter pego
5. Se NÃO HÁ log `[ArbOn]`:
   - Mode está `off` OU plug não rodou (sessionDados não carregou ainda)
   - Verificar `ENGINE_USE_ARBITRATOR` em runtime

## Rollback rápido

```bash
# Desativar Arbitrator (mantém código, volta legacy)
ENGINE_USE_ARBITRATOR=off
# restart container

# Rollback código inteiro
git reset --hard pre-f5-arbitrator-2026-05-22
```

## Mapa de rules (51 total)

### Por categoria
- **state** (2): stateValidatorsEarly, stateValidatorsCore
- **state-machine** (11): encerradoReset, humanoStale/ResetCmd/Passthrough, retryCpf, sessionStaleReset, maxTurns, intentSovereignty, priorityChoiceHook, encerramentoUniversal, welcomeAfterReset, buttonStaleGuard, ack, menuAnterior, priorityChoiceAsk
- **pre-gate** (1): preGateSoberano
- **ai-first-override** (3): statusRedeOverride, slownessPreClassify, forceSectorHint
- **ai-first-classify** (1): aiPreClass
- **absolute** (9): palavrãoInternet, moverRoteador, mudancaVencimento, mudancaEndereco, fidelidade, pedeMaisInfo, financial, cancellation, commercial, phase5DPreFinancial
- **phase** (14): phase05Preserved, phase1Button(Novo/Ja)/AiBypass/AmbiguousSgpDep/FaqFirstTurn/NewCustomerByText/DefaultMenu, phase2NewCustomer(Override/Pause)/MainFlow, phase3InvalidCpf, phase4(FidelidadeOverride/CpfDetected), phase5(Enrichment/BCpfNotFound/C5LgpdBlock/CMultiContratos), phase5LOrchestratorSurface

### CallHandlers reais (dispatcher executa)
| callHandler | Função do engine |
|---|---|
| `novoCliente` | `handleNovoCliente(ctx)` |
| `clienteNaoEncontrado` | `handleClienteNaoEncontrado(ctx, session, cpf)` |
| `sendCpfRequest` | `buildCpfRequest + n8nSendService.enviarResposta` |

### CallHandlers que caem em FALLBACK LEGACY (lógica complexa não migrada)
| callHandler | LOC engine | Motivo |
|---|---|---|
| `phase2NovoCliente` | ~600 | PHASE 2 main flow (FAQ + cobertura + planos + C11) |
| `phase5CMultiContratos` | ~160 | Multi-contratos contract picker |
| `finalizeHumanHandoff` | — | Já tratado em `escalate_humano` |

## Validação em produção

### Como ativar shadow em EasyPanel
1. App → Settings → Environment Variables
2. Adicionar: `ENGINE_USE_ARBITRATOR=shadow`
3. Restart container

### Como analisar logs shadow
```bash
# No EasyPanel logs do container:
docker logs <container> 2>&1 | grep "ArbShadow" | tail -100

# Top rules que mais decidiram
docker logs <container> 2>&1 | grep "ArbShadow" | awk '{print $4}' | sort | uniq -c | sort -rn

# Tempo médio
docker logs <container> 2>&1 | grep "ArbShadow" | grep -oP 'arbMs=\d+' | awk -F= '{sum+=$2; n++} END {print "avg:", sum/n, "ms"}'
```

### Critério pra ativar `on`
- Shadow rodando ≥ 1 semana
- ≥ 90% concordância com decisão do legacy
- Sem rules emitindo Intent inesperado em casos edge
- arbMs P95 < 1500ms

## Quando NÃO usar Arbitrator

- **Mudanças de fluxo de negócio**: prefira mexer no agente (financeiroAgent/etc), não no Arbitrator
- **Regex/keyword tuning**: rules absolutas (22-24, 39-44) — sim
- **Logging/observability**: Arbitrator já loga estruturado
- **Bug em handler V1**: o handler tá no agente, não no Arbitrator

## Próximos passos sugeridos

1. ✅ ENV `shadow` em prod por 1-2 semanas
2. ✅ Análise dos logs `[ArbShadow]`
3. ✅ ENV `on` em 1 tenant piloto
4. → **F5.8.3 cleanup engine** (deferred):
   - Remove ifs inline migrados do engine (~5k LOC removidas)
   - PRECISA shadow validation prod por 1-2 semanas primeiro

## Conhecidos (não-bloqueantes)

### Imports de `ispAgentEngine` em rules/tools/validators (potencial ciclo)

Hoje 9 arquivos importam direto do engine:
- **Rules**: 10 (aiClassifyDepartment), 14 (getAssistantName), 35/41 (detectFidelidadeIntentPreCpf)
- **Tools**: read/getAssistantName, read/getConversationHistory
- **Validators**: state/dedupValidator (isDuplicateMessage)
- **Dispatcher engine**: handleNovoCliente, handleClienteNaoEncontrado

**Hoje OK** porque engine importa arbitrator APENAS via `await import(...)`
(dynamic — não cria ciclo de tipos TS). Engine → Arbitrator é
unidirecional via plug.

**Cuidado em F5.8.3 cleanup**: se engine virar consumer estático do
arbitrator (import top-level), vira ciclo. Solução proativa: mover
`aiClassifyDepartment` pra `tools/ai/classifyIntent.ts` antes do cleanup.

### `callHandler: 'priorityChoiceParser'` (rule 48) sem mapeamento

Rule 48 (priorityChoiceHook) emite `Intent route_to_handler{callHandler:
priorityChoiceParser}` mas dispatcher não mapeia → sempre cai em fallback
legacy. **Comportamento esperado** (parser é complexo, fica no engine).
Documentar pra evitar confusão em audits futuros.
