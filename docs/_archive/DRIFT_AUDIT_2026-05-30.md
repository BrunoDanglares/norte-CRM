# Auditoria de Drift — Agente ISP V2

> **Drift** = a mesma regra de negócio existe em 2+ lugares e pode divergir silenciosamente.
> Quando alguém atualiza uma cópia e esquece a outra, surge bug que nenhum teste pega (porque cada cópia, isolada, "funciona").
>
> **Data:** 2026-05-30 · **Método:** varredura paralela em 5 domínios + verificação manual dos achados críticos contra o código real.
> **Status de verificação:** ✅ = confirmei lendo o código · 🔍 = reportado pela varredura, confirmar na hora de corrigir.

---

## 0. Status de execução

| Onda | Itens | Status |
|---|---|---|
| **A** | D1, D3, D7, D8 | ✅ **Concluída 2026-05-30** — baseline 81/81, tsc 31 (sem novos), 4 testes de paridade adicionados |
| **B** | L2 ✅, D2 (reclassificado) | ✅ **L2 concluído** (baseline 81/81). **D2 reclassificado → não é drift** (ver abaixo) |
| **C** | D4, D5, D6, L4 verificados | ✅ **Concluída** (baseline 83/83) — todos falsos-alarmes/convergentes. L1/L3/L5-L8 (latentes menores) ⏳ |

**Onda C — resultado (verificação empírica via simulação de classificação):**
- **D4** (cancelar boleto) ⚠️ **falso-alarme** — a `absoluteFinancialRule` (rule 22) roda ANTES da `absoluteCancellationRule` (rule 23) e captura "boleto duplicado/errado/a mais" → cancelar_boleto/faturas. As 7 frases de cobrança → FINANCEIRO, as 5 de contrato → CANCELAMENTO. Sem mudança de código. Teste: [cancelar-boleto-vs-contrato.test.ts](scripts/per-turn/cancelar-boleto-vs-contrato.test.ts) (12/12).
- **D6** (S4/S7 streaming) ⚠️ **falso-alarme** — a `absoluteSuporteSubFlowFinoRule` (rule 38, precede o fastPathL0) classifica TODO streaming como `lentidao_site`/S7. "netflix travando" → S7. Sem mudança. Teste: [suporte-fino-classification.test.ts](scripts/per-turn/suporte-fino-classification.test.ts) (8/8).
- **D5** (S5 instabilidade) ⚠️ **convergente** — rule 38 (estrita) pega instabilidade com temporal → S5; o resto cai no fastPathL0 (broad: `fica caindo|oscil|instável|cai e volta`) → também S5. Mesmo destino. A duplicação é complementar (absoluta-estrita vs fallback-broad), não nociva.
- **L4** (extrair `inferSuporteCode` único) ⚠️ **não-justificado** — como D5/D6 convergem, unificar mudaria sensibilidades que hoje funcionam, com risco sem ganho. A duplicação fastPathL0/rule38 tem papéis distintos por design.

> **Veredito final da auditoria (10 achados verificados a fundo):** drift real corrigido = **D1, D7, L2** (3). Latente melhorado = **D3** (1). Falsos-alarmes / intencionais / convergentes = **D2, D4, D5, D6, D8, L4** (6). **O scan superestimou ~60% dos "drift real".** O valor da auditoria não foi só corrigir — foi **separar o real do teórico com verificação empírica** e deixar **7 testes de regressão** que travam tanto os fixes quanto os comportamentos-corretos-que-pareciam-bugs. Latentes menores (L1/L3/L5-L8) seguem documentados nas fichas §5 pra quando agregarem valor.

**Onda B — resultado:**
- **L2** ✅ corrigido — `smalltalkGuards.isInCriticalState` tinha cópia inline das ~24 flags de coleta (sync só por teste). Agora deriva de `COLETA_DURA_FLAG_NAMES` via import estático. (`consultivePreCpf` já consumia a fonte única `isInColetaDuraActive` — sem ação.) Trava: [smalltalk-coleta-sync.test.ts](scripts/per-turn/smalltalk-coleta-sync.test.ts) (25/25).
- **D2** ⚠️ **reclassificado: NÃO é drift acidental.** A investigação mostrou que existe uma **fonte canônica V2** (o próprio [financeiroHandler.ts:147-198](server/services/agents/handlers/financeiroHandler.ts#L147)) e que `PRECPF_SUB_TO_CODE` **já está alinhado** com ela (`segunda_via→F3`, `desbloquear→F4`). A divergência apontada pelo scan é entre o V2 e o `FINANCEIRO_MAP` do [situationCatalog.ts](server/services/agents/situationCatalog.ts) — que é **legado V1** servindo ao `financeiroAgent`, e cuja divergência está **documentada como intencional** ([_helpers.ts:140-149](server/services/agents/resolver/steps/_helpers.ts#L140): "V2 diverge intencionalmente de V1... handlers absorvem a decisão condicional"). Mexer teria alto risco (60 cenários de paridade V1) e benefício incerto (caminho secundário/fallback). **Sem ação** — é dívida de "V1 legado coexistindo", não drift. Cabe na limpeza futura do V1, não na de drift.

> **Padrão confirmado:** dos achados verificados até aqui (D1,D3,D7,D8,L2,D2), **3 eram drift real** (D1,D7,L2), **1 latente** (D3), **2 falsos-alarmes/intencionais** (D8,D2). O scan acerta em ~50%. Verificar antes de agir continua sendo o passo que evita estragar comportamento que funciona.

**Resultado da Onda A (verificado contra o código, não só o scan):**
- **D1** ✅ corrigido — 3 regexes de titularidade → 1 fonte em [intentRegexes.ts](server/services/agents/intentRegexes.ts) (`TROCA_TITULARIDADE_RE`). Era drift REAL: teste empírico mostrou 10/14 frases divergindo; a rule absoluta perdia casos que ela existia pra pegar. Cobertura subiu de 11→16 frases. Teste: [titularidade-regex-parity.test.ts](scripts/per-turn/titularidade-regex-parity.test.ts) (30/30).
- **D3** ✅ corrigido (mas **rebaixado pra latente** — não era bug ativo). O welcome só dispara em saudação pura E tinha um 2º guard (`realData`) que já bloqueava. A lista duplicada era drift estrutural + telemetria errada. Agora `ACTIVE_QUESTION_FLAGS` deriva de `COLETA_DURA_FLAG_NAMES`. Teste: [welcome-coleta-sync.test.ts](scripts/per-turn/welcome-coleta-sync.test.ts) (24/24).
- **D7** ✅ corrigido — drift REAL e bidirecional (cada regex pegava frases que a outra perdia). `PEDE_HUMANO_RE` estendida + `REQUEST_HUMANO_RE` agora re-exporta ela (mesma referência). Teste: [pede-humano-parity.test.ts](scripts/per-turn/pede-humano-parity.test.ts) (29/29).
- **D8** ✅ **falso-alarme do scan** — nenhuma mudança de código. A `EXTERNAL_DAMAGE_RE` já exclui equipamento interno por construção (objetos = só rede pública; "queimou" não é ação de dano externo). Verificado: 0 falsos-positivos. Adicionado teste de regressão de escopo: [external-damage-scope.test.ts](scripts/per-turn/external-damage-scope.test.ts) (18/18).

> **Lição:** dos 4 itens da Onda A, **2 eram drift real** (D1, D7), **1 era latente** (D3) e **1 era falso-alarme** (D8). A varredura por sub-agentes superestima severidade — verificar empíricamente contra o código antes de agir foi o que separou os reais dos teóricos.

---

## 1. Como ler este documento

Cada achado tem um **ID estável** (`D##` = drift real / `L##` = débito latente). Os IDs dos sub-scans (SUP/FIN/COM/CAN/MAP/FLAG/CONST/DET) estão linkados em "origem" pra rastreio.

**3 categorias:**
- **DRIFT REAL** (`D##`) — as cópias **divergem hoje** e podem produzir comportamento errado. São os que valem correção.
- **DÉBITO LATENTE** (`L##`) — as cópias hoje **convergem**, mas estão duplicadas sem fonte única. Bomba-relógio: o próximo fix numa só quebra a paridade.
- **DESIGN INTENCIONAL** (§6) — parece drift mas é arquitetura de propósito. **Não mexer**, só documentar.

---

## 2. Princípio de fonte-única (a meta)

Quase todo achado se resolve movendo a regra pra um de **3 lares canônicos que já existem**:

| Tipo de regra | Lar canônico | Hoje |
|---|---|---|
| Regex de detecção de intent | [intentRegexes.ts](server/services/agents/intentRegexes.ts) | parcial — muita regex ainda inline em rules/handlers |
| Thresholds / TTLs / janelas | [constants.ts](server/services/agents/constants.ts) | parcial — `swapAndStay` e outros têm cópias locais |
| Listas de flags de estado | `COLETA_DURA_FLAGS` em [coletaDuraValidator.ts](server/services/agents/validators/state/coletaDuraValidator.ts) | parcial — 4 listas paralelas |
| Mapa sub-intent → código S/F/C | [situationCatalog.ts](server/services/agents/situationCatalog.ts) **ou** `PRECPF_SUB_TO_CODE` | **2 fontes divergentes** |

**Regra de ouro pra daqui pra frente:** regex/threshold/flag/mapa **nunca** nasce inline num handler ou rule. Nasce no lar canônico e é importado. Toda duplicação ganha um teste de paridade (como o [smalltalk-coleta-sync.test.ts](scripts/per-turn/smalltalk-coleta-sync.test.ts) já faz pra 2 das 4 listas de flags).

---

## 3. Tabela mestre (priorizada)

| ID | Achado | Risco | Verif. | Esforço | Origem |
|---|---|---|---|---|---|
| **D1** | Titularidade C7 tem **3 regexes inline divergentes** | 🔴 Alto | ✅ | P | COM-02/03 |
| **D2** | `FINANCEIRO_MAP` (catalog) diverge de `PRECPF_SUB_TO_CODE` (resolver) — sub→código | 🔴 Alto | ✅ | M | MAP-01/02/03/04 |
| **D3** | 5 flags `*_aguardando_confirmacao_handoff` faltam em `ACTIVE_QUESTION_FLAGS` (welcome) | 🔴 Alto | ✅ | P | FLAG-01/05 |
| **D4** | "Cancelar boleto" — rule 23 (cancelamento) vs rule 22 caminho B (F17/F18) competem | 🔴 Alto | 🔍 | M | CAN-02 |
| **D5** | S5 instabilidade — rule 38 exige temporal; fastPathL0/handler não | 🟡 Médio | 🔍 | P | SUP-02 |
| **D6** | S4/S7 lentidão+streaming — regex em 3 locais com cobertura diferente | 🟡 Médio | 🔍 | M | SUP-01 |
| **D7** | "Pede humano" — `PEDE_HUMANO_RE` vs `REQUEST_HUMANO_RE` (subset divergente) | 🟡 Médio | 🔍 | P | DET-02 |
| **D8** | `EXTERNAL_DAMAGE_RE` (S18) captura equipamento interno (roteador queimou) | 🟡 Médio | 🔍 | P | SUP-03 |
| **L1** | `swapAndStay` thresholds locais (0.85/0.78/0.72) fora de `constants.ts` | 🟡 Médio | ✅ | M | CONST-03 |
| **L2** | 4 listas de flags parcialmente sincronizadas (sem fonte única) | 🟡 Médio | ✅ | M | FLAG-02/05/06 |
| **L3** | `GENERIC_[SETOR]_RE` inline em handlers; COMERCIAL talvez sem paridade | 🟡 Médio | 🔍 | P | DET-03/CROSS-03 |
| **L4** | `inferSuporteSubFlow` (fastPathL0) duplica regexes de `handleSuporteSubFlows` | 🟡 Médio | 🔍 | M | SUP/CROSS-02 |
| **L5** | Pre-lock dedup sem TTL decay vs `DEDUP_WINDOW_MS` (risco memory leak) | 🟡 Médio | 🔍 | P | CONST-02 |
| **L6** | Mudança de vencimento: regex em rule 43 vs `mudancaVencimentoDetect.ts` | 🟢 Baixo | 🔍 | P | FIN-03 |
| **L7** | `INTENT_PRE_CPF_TTL_MS` (1h) comentado como "paridade V1 SESSION_STALE_MS" (4h) — comentário falso | 🟢 Baixo | 🔍 | P | CONST-01 |
| **L8** | `OFF_SCOPE_ISP_RE` enterrado em `smalltalkLayer` (não reutilizável) | 🟢 Baixo | 🔍 | P | DET-04 |

> Esforço: **P** = pontual (1 arquivo, <30min) · **M** = médio (2-4 arquivos + teste).

---

## 4. Fichas — Drift real (corrigir)

### D1 — Titularidade C7: 3 regexes inline divergentes ✅
**Origem:** COM-02, COM-03
- **A:** [45_absoluteTitularidadeRule.ts:17](server/services/agents/classifiers/absolute/rules/45_absoluteTitularidadeRule.ts#L17) — `const TITULARIDADE_RE = /…(passar|trocar|alterar|mudar|transferir|colocar)…titular…/` (define **inline**, exige verbo + destino "pra meu/nome de")
- **B:** `intentGateway.TROCA_TITULARIDADE_RE` — padrão diferente, cobre "titularidade" como substantivo solto
- **C:** [handleComercialSubFlows.ts:433](server/services/agents/handlers/comercial/handleComercialSubFlows.ts#L433) — terceira regex inline, mais enxuta (`titular|titularidade|trocar titular|passar nome|nome da esposa/marido…`)

**Divergência concreta:** "transferência de titular pra esposa" e "mudança de titularidade" batem em padrões diferentes em cada lugar. A regra absoluta (A) pode classificar C7 enquanto o handler (C) não reconhece, ou vice-versa — resultando em rota/tag inconsistente conforme qual camada decide.

**Fix:** mover o padrão canônico pra `intentGateway.TROCA_TITULARIDADE_RE` (ou `intentRegexes.ts`); rule 45 e handleComercialSubFlows **importam** dela e removem as inline. + teste de paridade.

---

### D2 — `FINANCEIRO_MAP` diverge de `PRECPF_SUB_TO_CODE` ✅
**Origem:** MAP-01/02/03/04
Dois mapas convertem `sub-intent → código F`, com valores **opostos**:

| sub-intent | `FINANCEIRO_MAP` ([situationCatalog.ts:39-49](server/services/agents/situationCatalog.ts#L39)) | `PRECPF_SUB_TO_CODE` ([resolver/steps/_helpers.ts](server/services/agents/resolver/steps/_helpers.ts)) |
|---|---|---|
| `segunda_via` | **F4** | **F3** |
| `pagamento_realizado` | **F3** | **F18** |
| `desbloquear` | **F1** | **F4** |
| `suspensao` | F5/F6 (condicional) | F4 |

**Quem consome cada um:** `FINANCEIRO_MAP` → `resolveFinanceiroSituation()` chamado em [financeiroAgent.ts:3696](server/services/agents/financeiroAgent.ts#L3696) (camada V1 ainda no caminho do `financeiroHandler`). `PRECPF_SUB_TO_CODE` → recovery pós-CPF no resolver V2.

**Divergência concreta:** o mesmo cliente classificado como `desbloquear` recebe **F1 (promessa de pagamento)** por um caminho e **F4 (checar suspensão + 2ª via)** por outro — semânticas totalmente diferentes. Tag de handoff/painel mostra código diferente conforme quem decidiu.

**⚠️ Investigar primeiro:** confirmar se `resolveFinanceiroSituation` ainda está num caminho **ativo** do V2 (via financeiroAgent) ou se virou código morto. Isso define se é Alto (ativo) ou Baixo (morto). Independente disso, alinhar os dois mapas + eleger `situationCatalog.ts` como fonte e importar no resolver (ou vice-versa, Bruno decide a semântica correta de cada par).

---

### D3 — Flags de pré-handoff faltam no welcome ✅
**Origem:** FLAG-01, FLAG-05
- `COLETA_DURA_FLAGS` e `smalltalkGuards.isInCriticalState` incluem as 5 flags `c1_/c9_/f16_/c7_/cancel_aguardando_confirmacao_handoff` (fix recente — ver memória [[smalltalk_hijack_prehandoff_confirm_2026_05_30]]).
- `ACTIVE_QUESTION_FLAGS` em [welcomeMenuValidator.ts:43-66](server/services/agents/validators/state/welcomeMenuValidator.ts#L43) é uma **lista local hardcoded** e **não inclui nenhuma das 5**.

**Divergência concreta:** cliente novo (depth 0) que está no "Posso te conectar agora?" (`f16_aguardando_confirmacao_handoff=true`) e responde "Sim" pode receber o **menu de boas-vindas (JÁ SOU CLIENTE / NOVO) duplicado**, porque o welcome não vê que há uma pergunta de handoff em aberto. É o mesmo bug que o smalltalk já teve, num validator vizinho.

**Fix:** `welcomeMenuValidator` importa a lista de `coletaDuraValidator` (ou derivar `ACTIVE_QUESTION_FLAGS` de `COLETA_DURA_FLAGS.map(f => f.flag)`) + estender o teste de paridade pra cobrir essa 4ª lista. **(Casa com L2.)**

---

### D4 — "Cancelar boleto": cancelamento vs financeiro competem 🔍
**Origem:** CAN-02
- **A:** [23_absoluteCancellationRule.ts:30](server/services/agents/classifiers/absolute/rules/23_absoluteCancellationRule.ts#L30) — `cancel\w+ (esse/este/um) (cobrança|boleto|fatura|nota|débito|conta)` (curto)
- **B:** [22_absoluteFinancialRule.ts:359](server/services/agents/classifiers/absolute/rules/22_absoluteFinancialRule.ts#L359) — inclui "boleto duplicado/errado" **sem** exigir verbo "cancelar" → roteia F17/F18

**Divergência concreta:** "veio boleto duplicado, cancela isso" pode bater a regra de **cancelamento** (A — cliente quer cancelar contrato!) em vez da **financeira** (B — só quer anular uma cobrança). Risco de levar um cliente que só queria resolver um boleto pro fluxo de churn.

**Fix:** rule 23 **não testa** boleto/cobrança/fatura (deixa pra rule 22). rule 23 fica só com contrato/plano/serviço/internet. Rule 22 caminho B é a fonte para "cancelar cobrança específica".

---

### D5 — S5 instabilidade: temporal obrigatório vs opcional 🔍
**Origem:** SUP-02
- **A (broad):** [fastPathL0.ts](server/services/agents/resolver/fastPathL0.ts) — `cai e volta|oscil|instável|fica caindo|desconecta sozinh` (sem exigir frequência)
- **B (strict):** [38_absoluteSuporteSubFlowFinoRule.ts:36](server/services/agents/classifiers/absolute/rules/38_absoluteSuporteSubFlowFinoRule.ts#L36) — `S5_INSTAB_RE` **exige** temporal ("tempo todo/toda hora/direto/sem parar")
- **C (mínimo):** [handleSuporteSubFlows.ts:408](server/services/agents/handlers/suporte/handleSuporteSubFlows.ts#L408) — `cai|instável|oscil`

**Divergência concreta:** "minha internet fica caindo" → S5 por A e C, mas **NULL** pela rule 38 (B, falta temporal) → pode acabar como S4 (lento) em vez de S5 (oscilação).

**Fix:** decidir a semântica de S5 (broad é o esperado para WhatsApp) e extrair `inferSuporteCode(text)` único compartilhado (casa com L4). Se quiser refino "strict", usar flag de confirmação, não regex divergente.

---

### D6 — Lentidão/streaming (S4/S7) em 3 locais 🔍
**Origem:** SUP-01
- fastPathL0 detecta S4 por `lento|lentidão|ping|lag|travando` (sem coloquial, sem streaming)
- handleSuporteSubFlows detecta S4 por `lento|porcaria|merda|lixo|horrível` (coloquial, sem streaming)
- handleSuporteLentidao tem `S7_STREAMING_RE` (netflix|youtube|iptv|…) que força S4→S7

**Divergência concreta:** "meu Netflix tá travando" sai S4 (genérico) ou S7 (app específico) conforme a camada que processa primeiro.

**Fix:** 3 constantes canônicas em `intentRegexes.ts`: `S4_SLOWNESS_RE`, `S7_STREAMING_RE`, `QUALITY_COMPLAINT_RE` (porcaria/lixo/horrível). Todos os locais importam. (casa com L4)

---

### D7 — "Pede humano": dois padrões divergentes 🔍
**Origem:** DET-02
- **A (completo):** `PEDE_HUMANO_RE` em [intentRegexes.ts](server/services/agents/intentRegexes.ts) — 9 padrões, inclui "não aguento mais bot". Usado por [61_absolutePedeHumanoRule.ts](server/services/agents/classifiers/absolute/rules/61_absolutePedeHumanoRule.ts).
- **B (subset):** `REQUEST_HUMANO_RE` em [sovereignExitRegex.ts:13](server/services/agents/handlers/common/sovereignExitRegex.ts#L13) — ~6 padrões, **sem** "não aguento".

**Divergência concreta:** "não aguento esse bot" no meio de um fluxo é pego pela regra absoluta (A, escala cedo) mas **não** pelo sovereign-exit do handler (B) — se a regra absoluta for pulada num re-dispatch, o cliente fica preso com IA consultiva.

**Fix:** `sovereignExitRegex` importa/estende `PEDE_HUMANO_RE`. Uma fonte.

---

### D8 — `EXTERNAL_DAMAGE_RE` (S18) captura equipamento interno 🔍
**Origem:** SUP-03
- [intentRegexes.ts](server/services/agents/intentRegexes.ts) `EXTERNAL_DAMAGE_RE` é amplo no sujeito: `(quebrou/rompeu/cortou) … (fio|cabo|poste|caixa)` mas também casa cenários com agente externo (raio/temporal) + objeto.

**Divergência concreta:** "meu roteador queimou na tempestade" pode disparar **S18 (dano externo na rede pública)** quando é **S9/S11 (equipamento do cliente)**. S18 aciona fluxo de dano de planta externa indevidamente.

**Fix:** negative lookahead em `EXTERNAL_DAMAGE_RE` excluindo `roteador|modem|aparelho|ont|onu` como objeto; exigir objeto de rede pública (fio/cabo/poste/drop/caixa).

---

## 5. Fichas — Débito latente (consolidar)

- **L1 — Thresholds em `swapAndStay`** ✅: [swapAndStay.ts:41-64](server/services/agents/resolver/steps/swapAndStay.ts#L41) define localmente `STICKY_TAG_OVERRIDE_CONF=0.85`, `CROSSECTOR_BYPASS_STICKY_TAG_SCORE=0.78`, `FAQ_CATEGORY_BOOST_MIN_SCORE=0.85`, `FAQ_CONFIRMS_CROSSECTOR_MIN_SCORE=0.72`. Bem nomeados e comentados, mas **não vêm de `constants.ts`**. Se a calibração global de `CROSS_SECTOR_THRESHOLD` mudar, estes não acompanham. → mover pra `constants.ts`.
- **L2 — 4 listas de flags** ✅: `COLETA_DURA_FLAGS`, `isInCriticalState` (smalltalk), `ACTIVE_QUESTION_FLAGS` (welcome), `COLETA_FLAGS` (consultivePreCpf) cobrem aproximadamente o mesmo conjunto mas divergem (ver D3). O teste [smalltalk-coleta-sync.test.ts](scripts/per-turn/smalltalk-coleta-sync.test.ts) trava drift entre 2 delas — falta cobrir welcome e consultive. → exportar `COLETA_DURA_FLAGS` como fonte; demais derivam; teste cobre as 4.
- **L3 — `GENERIC_[SETOR]_RE`** 🔍: FIN e SUP têm regex de "quero falar com X" inline; COMERCIAL talvez sem paridade (menu existe via outro caminho). → 3 constantes em `intentRegexes.ts`, paridade entre setores.
- **L4 — `inferSuporteSubFlow` duplica handler** 🔍: regexes S1-S19 em [fastPathL0.ts](server/services/agents/resolver/fastPathL0.ts) e [handleSuporteSubFlows.ts](server/services/agents/handlers/suporte/handleSuporteSubFlows.ts). → extrair `inferSuporteCode(text)` puro. **Resolve D5 e D6 de uma vez.**
- **L5 — Pre-lock dedup sem TTL** 🔍: o mapa `_inFlightHashes` em [runV2Agent.ts](server/services/agents/runV2Agent.ts) limpa no `finally` mas não tem decay por tempo; `DEDUP_WINDOW_MS=1500` vive em `messageDedup`. Risco de crescimento sob rajada. → janela TTL única em `constants.ts`.
- **L6 — Mudança vencimento** 🔍: regex em [43_absoluteMudancaVencimentoRule.ts](server/services/agents/classifiers/absolute/rules/43_absoluteMudancaVencimentoRule.ts) vs `mudancaVencimentoDetect.ts`. Hoje convergem. → exportar uma constante.
- **L7 — TTL pré-CPF** 🔍: comentário "paridade V1 SESSION_STALE_MS" é falso (1h vs 4h). → corrigir comentário ou alinhar valor.
- **L8 — `OFF_SCOPE_ISP_RE`** 🔍: bem escrito mas preso em `smalltalkLayer`. → mover pra `intentRegexes.ts` pra reúso futuro.

---

## 6. Design intencional — NÃO é drift (não mexer)

Para não desperdiçar esforço corrigindo o que é de propósito:

- **fastPathL0 é subconjunto das regras absolutas** (FIN-01, CAN-01). `fastPathL0` é atalho otimista para casos óbvios; a regra absoluta é a verdade completa. Se o atalho não pega, cai no classificador — sem erro, só um pouco mais de custo. **OK.** (A única ação útil é documentar isso no topo do `fastPathL0`.)
- **`situationCodeToSector`: C6 = VENDAS** (MAP-06). A heurística de prefixo tem fallback pra `SITUATION_CONFIG`, que é autoritativa e marca C6 (retenção) como VENDAS de propósito (bot tenta reter; só escala CANCELAMENTO se falhar). **OK.**
- **Maps uppercase vs lowercase** (MAP-05). `SECTOR_TO_FLUXO` (keys uppercase) e `FLUXO_TO_SECTOR` (keys lowercase) são intencionais; `previousFlowToSector` normaliza ambos. **OK.** (Foi exatamente o bug case-mismatch da auditoria de 28/mai, já corrigido.)
- **`encerramentoUniversal` vs `ackFechamento`** (DET-07). Semânticas distintas (fim+CSAT vs ack+continua), ordem garantida nos early validators. **OK.**

---

## 7. Fila de correção sugerida (ondas)

**Onda A — alto impacto, baixo esforço (atacar primeiro):**
1. D1 (titularidade → 1 fonte) · D3 (flags handoff no welcome) · D7 (pede humano) · D8 (dano externo lookahead)

**Onda B — consolidação estrutural (resolve vários de uma vez):**
2. L4 `inferSuporteCode()` único → fecha **D5 + D6 + L4**
3. L2 fonte única de flags + teste das 4 listas → reforça **D3**
4. D2 (decidir semântica dos pares sub→código e unificar os 2 mapas) — **investigar caminho ativo antes**

**Onda C — higiene / latentes:**
5. D4 (cancelar boleto) · L1 (thresholds → constants) · L3 (generic setor) · L5 (dedup TTL) · L6/L7/L8

**Cada correção fecha com:** mover pro lar canônico + importar nos consumidores + **teste de paridade** + rodar baseline (`scripts/auto-test-runner.ts`) + `npm run check`.

---

## 8. Resumo

- **16 achados** após curadoria (8 drift real, 8 latente) + 4 falsos-positivos descartados como design intencional.
- **Raiz comum:** regras nascem inline em rules/handlers em vez de num lar canônico. `intentRegexes.ts`, `constants.ts` e `COLETA_DURA_FLAGS` já existem como lares — falta **disciplina de importar em vez de copiar** + testes de paridade que travem o drift (o `smalltalk-coleta-sync` é o modelo a replicar).
- **Maior alavanca:** a Onda B (extrair `inferSuporteCode` + fonte única de flags) elimina a maior família de drift com um único refactor cada.
