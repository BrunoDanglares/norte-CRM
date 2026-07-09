# F3 — Validators: design proposto

> **Status**: DRAFT pra alinhamento. Antes de codar.
> **Quem deve revisar**: Bruno. Decisões abertas no final.

---

## 1. Por que esta fase é a mais ambígua

F1 (tools) e F2 (pre-gates soberanos) tinham contratos claros — função pura
de execução, ou decisão terminal. **Validators** ficam no meio: eles
**filtram fluxo** sem necessariamente decidir.

Antes de escrever 1 linha, precisamos cravar:
1. **O que É um validator** (vs tool, vs classifier, vs pre-gate)
2. **Quantas categorias** existem
3. **Onde cada categoria roda** no pipeline
4. **Quem invoca** cada um

Sem isso, F3 vira pasta-coringa onde código não-classificado vai parar.

---

## 2. Definição cristalina

Validator = **função que responde a UMA pergunta booleana sobre estado ou
permissão**, com motivo estruturado da resposta.

Não confundir:

| Tipo | Pergunta que responde | Retorno |
|---|---|---|
| **Tool** | "execute X" | resultado da execução |
| **Pre-gate soberano** | "isto exige interceptação total?" | `{ handled, result }` (terminal) |
| **Validator** | "este turno PODE continuar com este intent?" | `{ ok, reason }` |
| **Classifier** | "qual a categoria semântica disto?" | `{ category, score }` |

**Diferença chave Pre-gate vs Validator**:
- Pre-gate **escala humano direto** (terminal) — emergency, humano explícito
- Validator **bloqueia/filtra** sem necessariamente escalar — coleta dura, dedup, regra de promessa

---

## 3. Duas categorias de validators (não três)

Eu mencionei 3 categorias na conversa anterior. Olhando o código, a 3ª
("Detectors" — cpf/greeting/button) **NÃO são validators** — são
classificadores que produzem sinais. Vão pra **F4 — Classifier Layer**.

F3 fica com **2 categorias verdadeiras**:

### 3A. State Validators
**Pergunta**: "este turno deve seguir o fluxo normal OU devolvido/ignorado?"

**Quando rodam**: ESTÁGIO 2 — depois do pre-gate soberano, antes dos classifiers.

**Side effect**: nenhum. Só leem estado.

**Skip = true** significa: caller deve retornar imediatamente com `result`
pré-construído (handler dono retoma, ou bot fica mudo, ou dedup).

```ts
interface StateValidator {
  name: string;
  /** Sempre roda em ordem fixa (definida em runStateValidators). */
  check(ctx: ValidatorContext): Promise<StateValidationResult>;
}

interface StateValidationResult {
  /** True = caller deve retornar agora; False = continua fluxo. */
  skip: boolean;
  reason: string; // 'human_assumed' | 'ai_paused' | 'coleta_dura_X' | 'dedup' | etc
  /** Quando skip=true, resultado pronto pro runISPAgent retornar.
   *  Tipicamente: { success: true, intent: 'BLOCKED_BY_HUMAN', ... }
   *  ou: { success: true, intent: 'DEDUP', response: '' } */
  result?: AgentReturnResult;
}
```

### 3B. Policy Validators
**Pergunta**: "este cliente/contexto tem permissão pra esta ação específica?"

**Quando rodam**: ESTÁGIO 5 (dispatch) — handler invoca ANTES de executar tool de
write.

**Side effect**: nenhum. Só leem ERP/sessão/config.

**Allowed = false** significa: handler NÃO chama a tool de write,
mostra mensagem explicativa OU escala humano.

```ts
interface PolicyValidator<TArgs = void> {
  name: string;
  check(ctx: ValidatorContext, args: TArgs): Promise<PolicyValidationResult>;
}

interface PolicyValidationResult {
  allowed: boolean;
  /** Sempre presente. Quando !allowed, explica POR QUE não.
   *  Quando allowed=true, motivo da liberação (pra trace/log). */
  reason: string;
  /** Contexto adicional pra handler usar na resposta ao cliente.
   *  Ex: { proximoCicloEm: 23, ultimaMudancaEm: '2026-03-15' } */
  metadata?: Record<string, any>;
}
```

---

## 4. ValidatorContext

Compartilhado pelos 2 tipos — minimalismo similar ao `ToolContext`:

```ts
interface ValidatorContext {
  workspaceId: string;
  conversationId: number;
  phoneClean: string;
  /** Sessão atual — validators podem ler mas NÃO mutar.
   *  Type readonly pra forçar disciplina. */
  readonly sessionDados: Record<string, any>;
  /** Enrichment do ERP se cliente identificado (opcional).
   *  Passado quando handler já tem em mãos pra evitar 2ª chamada. */
  readonly erpEnrichment?: ERPEnrichment;
}
```

---

## 5. Catálogo proposto

### State Validators (5 — Onda F3.1)

| Validator | Origem hoje | Skip = true quando | Esforço |
|---|---|---|---|
| `pipelineBlockedValidator` | `pipelineStateMachine.isAgentBlockedByStage` (linha 247) | Humano assumiu / pipelineEtapa='atendimento_humano' / aiPaused=true | wrapper |
| `aiPausedValidator` | inline em vários pontos | `conversations.aiPaused === true` (independente de pipeline) | extração |
| `coletaDuraValidator` | inline no delegationGate + handlers | Alguma das 13 flags ativa (do tools/write/persistColetaDuraState) | extração |
| `dedupValidator` | `isDuplicateMessage` (engine 1098) | Msg duplicada nos últimos 30s | wrapper |
| `recursionDepthValidator` | inline em `runISPAgentImpl` (linha 3567) | `depth >= MAX_RECURSION_DEPTH` (default 5) | extração |

### Policy Validators (5 — Onda F3.2)

| Validator | Origem hoje | Allowed = false quando | Esforço |
|---|---|---|---|
| `promessaEligibilityValidator` | inline `financeiroAgent.ts:2887` (`motivo_humano:'promessa_nao_elegivel'`) | NOT (suspenso AND exatamente 1 boleto vencido) | extração |
| `canOpenOSValidator` | **A CRIAR** (mencionado nos JSDocs) | `tenantSettings.aiAgent.canOpenOS !== true` | criação |
| `canChangeDueDateValidator` | inline em financeiroAgent F16 | Cliente já mudou data nesse ano | extração |
| `canTakePauseValidator` | inline em cancelamentoAgent | Cliente em fidelidade OU já em pausa | extração |
| `canRequestUnlockValidator` | inline em financeiroAgent | Sem promessa ativa OU já desbloqueou nas últimas 24h | extração |

**Total F3**: 10 validators distribuídos em 2 ondas.

---

## 6. Onde rodam no pipeline (integração com engine)

```
runISPAgent
  │
  ├─ infraestrutura (não é validator — é setup)
  │  ├─ tracing
  │  ├─ phoneLock
  │  └─ dedup (← na verdade isto é VALIDATOR — vide F3.1)
  │
  ├─ pre-gate soberano (F2 ✓)
  │  └─ runPreGateSoberano (emergency + human_request)
  │
  ├─ ⚡ ESTÁGIO 2 — STATE VALIDATORS (F3.1)
  │  └─ runStateValidators(ctx)
  │     ├─ pipelineBlockedValidator → skip se humano assumiu
  │     ├─ aiPausedValidator        → skip se manualmente pausado
  │     ├─ coletaDuraValidator      → skip se handler dono ativo
  │     ├─ dedupValidator           → skip se duplicate
  │     └─ recursionDepthValidator  → skip se depth >= max
  │
  ├─ ESTÁGIO 3 — CLASSIFIER LAYER (F4)
  │  └─ classifierContext + 20+ classifiers (já existe parcialmente em
  │     aiAgent/classifierContext.ts; F4 generaliza pra V1)
  │
  ├─ ESTÁGIO 4 — ARBITRATOR (F5)
  │  └─ runArbitrator → Intent
  │
  └─ ESTÁGIO 5 — DISPATCH (F6)
     └─ handler (financeiroFlow, suporteFlow, etc)
        ├─ chama POLICY VALIDATORS (F3.2) antes de tool de write
        │  ex: financeiroFlow.startPromessa →
        │       promessaEligibilityValidator.check(ctx, {invoices})
        │       if (!allowed) → enviar mensagem + escalar humano
        │       else → tools/write/registerPaymentPromise()
        └─ executa tools
```

**Pontos importantes**:
- State validators rodam **uma única vez por turno** (Estágio 2), antes de qualquer trabalho caro
- Policy validators rodam **sob demanda** pelo handler (Estágio 5), apenas quando há ação write iminente
- Validator **nunca tem side effect** — só lê

---

## 7. Estrutura de pasta proposta

```
server/services/agents/validators/
├─ types.ts                    ← ValidatorContext + interfaces + categorias
├─ index.ts                    ← re-export central
├─ runStateValidators.ts       ← orquestrador estado (uma chamada do engine)
│
├─ state/
│  ├─ pipelineBlockedValidator.ts
│  ├─ aiPausedValidator.ts
│  ├─ coletaDuraValidator.ts
│  ├─ dedupValidator.ts
│  └─ recursionDepthValidator.ts
│
└─ policy/
   ├─ promessaEligibilityValidator.ts
   ├─ canOpenOSValidator.ts
   ├─ canChangeDueDateValidator.ts
   ├─ canTakePauseValidator.ts
   └─ canRequestUnlockValidator.ts
```

Espelho de `tools/`: 1 arquivo por validator + index + types + orquestrador
de Estado.

---

## 8. Smoke pattern (já validado em F1/F2)

Cada validator vira testável isoladamente:

```ts
// scripts/smoke-validators-state.ts
const r = await pipelineBlockedValidator.check({
  workspaceId, conversationId: -1, phoneClean: '...',
  sessionDados: { aiPaused: true },
});
check('aiPaused=true → skip=true', r.skip === true);
check('aiPaused=true → reason=ai_paused', r.reason === 'ai_paused');
```

Policy validators também — mocamos enrichment + tenantSettings.

---

## 9. Mudança no engine (estimativa)

Substituirá ~150 LOC inline (dedup + isAgentBlockedByStage + coleta dura
checks dispersos) por **~10 LOC**:

```ts
const stateCheck = await runStateValidators({
  workspaceId, conversationId, phoneClean,
  sessionDados, erpEnrichment: undefined,
});
if (stateCheck.skip) return stateCheck.result!;
```

Lógica preservada 100%. Só consolidada num lugar.

Handlers vão chamar policy validators **gradualmente** conforme F7 refatora cada
um — não é mudança em massa.

---

## 10. ❓ Decisões abertas (pra você responder)

### Decisão 1 — Onde dedup deve rodar?

Hoje `isDuplicateMessage` roda como infraestrutura (linha 3617, ANTES de
phoneLock). Tecnicamente é validator de estado (msg duplicada).

- **(a)** Mantém como infra (antes do pre-gate). Validator é só wrapper documental.
- **(b)** Move pra dentro do `runStateValidators`. Pre-gate roda primeiro,
  dedup é o 1º state validator. Sequência: pre-gate → dedup → outros state.

**Eu recomendo (b)** — fica tudo categorizado, ordem ainda preservada (dedup
roda antes dos outros state porque é mais barato).

### Decisão 2 — recursionDepthValidator é validator real?

Recursão depth é "infra mecânica" mais que estado da conversa. Pode ficar
inline em `runISPAgentImpl` sem virar validator. Inclui ou não?

- **(a)** Inclui — toda guarda vira validator pra unificar
- **(b)** Pula — `if (depth >= MAX_RECURSION_DEPTH) return` fica inline,
  é proteção mecânica não-semântica

**Eu recomendo (b)** — recursão é controle de execução, não regra de produto.

### Decisão 3 — sessionDados readonly nos validators?

Validators **não devem mutar** sessionDados. TypeScript pode forçar:

```ts
readonly sessionDados: Readonly<Record<string, any>>
```

Mas isso quebra se algum validator legacy mutar acidentalmente. Aplicar?

- **(a)** Sim, `readonly` desde o início — disciplina forte
- **(b)** Não, deixar `Record<string, any>` — caller confia que validator é puro

**Eu recomendo (a)** — typecheck força princípio "validator é puro".

### Decisão 4 — Policy validators podem chamar ERP?

Algumas precisam de dados ERP (promessa eligibility precisa contar boletos).
Opções:

- **(a)** Validator faz lookup ERP por si só (autônomo, mais cômodo)
- **(b)** Validator EXIGE enrichment pré-carregado em `ctx.erpEnrichment`
  (mais eficiente — handler já tem em mãos quando chama)
- **(c)** Híbrido — aceita pre-carregado, mas faz fallback se faltar

**Eu recomendo (c)** — flexibilidade sem perda de performance.

### Decisão 5 — Onda 1 começa por State ou Policy?

- **(a)** Onda F3.1 = State (mais usado, integra direto no engine)
- **(b)** Onda F3.2 = Policy (mais "novo", desacoplado do engine)

**Eu recomendo (a)** — State integra no engine e dá impacto imediato (engine
LOC cai). Policy fica de pé sem integração até F7.

---

## 11. Roadmap proposto

| Onda | Escopo | LOC est. | Risco |
|---|---|---|---|
| **F3.1** | 5 State validators + orquestrador + integração engine | ~600 | baixo (extração fiel) |
| **F3.2** | 5 Policy validators + smoke isolado (sem integração) | ~600 | baixo (desacoplado) |
| **F3.3** (opcional) | Cleanup — remover checks inline duplicados que o validator agora cobre | ~150 LOC removidas | baixo |

**Total F3**: ~1.200 LOC novas, ~150 removidas = +1.050 LOC líquidas em 2-3 ondas.

---

## 12. O que NÃO entra em F3

- Detectors (cpf/greeting/button) → vão pra F4 (classifier layer)
- Decisão de qual handler invocar → F5 (arbitrator)
- Refactor dos handlers pra usar policy validators → F7
- Remoção do código inline duplicado → F3.3 opcional ou F8

---

## 📋 Resposta pedida

Bruno: responda **5 decisões** com `(a)` ou `(b)` / `(c)` pra eu poder
codar a F3.1 com clareza. Esperando:

1. Dedup como state validator vs infra?
2. recursionDepth como validator vs inline?
3. sessionDados readonly forçado?
4. Policy validators autônomos vs precisam enrichment?
5. Onda 1: State primeiro vs Policy primeiro?

Quando responder, eu começo F3.1 (State validators).
