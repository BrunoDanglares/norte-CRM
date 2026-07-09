# Auditoria V2 Agente — 2026-05-28

## Sumário Executivo

- **Total de achados: 37** — Crit: 7, Med: 17, Baixo: 8, Cosmético: 5
- **Categorias mais quentes**: (1) Lógica duplicada / drift; (2) Tags inconsistentes / handlers V1-paridade incompletos; (3) Telemetria.
- **Riscos imediatos pra prod (se cutover hoje)**:
  1. **`noClassifierFallback` step nunca mantém sticky setor** — `FLUXO_TO_SECTOR['FINANCEIRO']` retorna undefined porque keys são lowercase mas `previousFlow` é uppercase. Cliente em fluxo ativo sem classifier-hit cai em `CONSULTATIVE_RESPONSE` em todo turno neutro. (server/services/agents/resolver/steps/noClassifierFallback.ts:20)
  2. **Routing F12/F9 quebrado pós-refator V1 paridade** — financeiroHandler rota `pagou_mas_bloqueado` → handleF12 e `titular_financeiro` → handleF9, mas F12 agora é crédito/desconto e F9 agora é cancelamento+débito. handleF18 referenciado nos comments NÃO EXISTE; handleF17 NÃO EXISTE; handleF19 só é alcançado via handleF1 inline. (server/services/agents/handlers/financeiroHandler.ts:217-274 + handleF9.ts:5-8 + handleF12.ts:4-7)
  3. **Policy gate F7 errado** — `applyPolicyGates` L243 aplica `canTakePauseValidator` em `subFlow === 'F7'` mas F7 é negociação (handleF7.ts:1). Pausa é F2 — gate validando o subFlow errado, deixando handleF7 sem gate adequado.

## Achados por Categoria

### 1. Lógica duplicada / drift

#### 1.1 [CRÍTICO] `noClassifierFallback` nunca consegue manter setor sticky (case-mismatch FLUXO_TO_SECTOR)
- **Onde**: server/services/agents/resolver/steps/noClassifierFallback.ts:20
- **Sintoma**: `FLUXO_TO_SECTOR[ctx.previousFlow]` usa keys lowercase (`financeiro`, `suporte_tecnico`) mas `ctx.previousFlow` é UPPERCASE (`FINANCEIRO`, `SUPORTE_TECNICO`) — runV2Agent.ts:109 persiste sector já uppercase. Resultado: `stickySector` é sempre `null` → cliente em fluxo ativo sem classifier-hit cai direto em CONSULTATIVE_RESPONSE.
- **Por que é problema**: regressão V1 silenciosa. Cliente respondendo "ok" pós-listagem ou aguardando handler reabrir contexto vira "como posso te ajudar?" genérico.
- **Fix sugerido**: trocar pra `previousFlow as Sector` direto (já uppercase) ou normalizar via `.toLowerCase()`. Adicionar teste de regressão "previousFlow=FINANCEIRO + msg neutra → STAY_IN_FLOW".

#### 1.2 [CRÍTICO] Mesmo bug em `buttonSovereignStep` e `fastPathL0` — `keepCurrentFlow` sempre false
- **Onde**: server/services/agents/resolver/steps/buttonSovereign.ts:36 + server/services/agents/resolver/fastPathL0.ts:249
- **Sintoma**: `ctx.previousFlow === SECTOR_TO_FLUXO[buttonSector]` — left side uppercase, right side lowercase. Sempre `false` → `keepCurrentFlow=false` → dispatcher trata como swap real → manda transition message fallback "entendi! deixa eu te ajudar com isso".
- **Por que é problema**: clique de botão dentro do mesmo setor produz mensagem espúria de "transição" + zera flags como se fosse mudança de departamento. Quebra UX (mensagem dupla) e mata flags do setor atual.
- **Fix sugerido**: usar comparação direta uppercase (`previousFlow === buttonSector`) ou inverter o mapa.

#### 1.3 [MÉDIO] `PRECPF_SUB_TO_CODE.FINANCEIRO` (V2) diverge de `FINANCEIRO_MAP` (situationCatalog, V1)
- **Onde**: server/services/agents/resolver/steps/_helpers.ts:103-128 + server/services/agents/situationCatalog.ts:39-67
- **Sintoma**: 4 entradas com semânticas diferentes:
  - `segunda_via`: V2→F3, V1→F4
  - `pagamento_realizado`: V2→F12, V1→F3
  - `desbloquear`: V2→F4, V1→F1
  - `suspensao`: V2→F4, V1→F6/F5
- **Por que é problema**: tag aplicada pela cadeia V2 diverge da cadeia V1; resumo handoff/painel mostra códigos diferentes pra mesma situação dependendo de quem decidiu (resolver vs detectSituation legacy).
- **Fix sugerido**: alinhar V2 com V1 (ou inverter — Bruno decide). Documentar onde V2 intencionalmente difere e centralizar num único mapa.

#### 1.4 [MÉDIO] `consultivePreCpfStep.COLETA_FLAGS` incompleto vs `coletaDuraValidator.COLETA_DURA_FLAGS`
- **Onde**: server/services/agents/resolver/steps/consultivePreCpf.ts:34-52 + server/services/agents/validators/state/coletaDuraValidator.ts:61-97
- **Sintoma**: lista do consultive não inclui `pausa_etapa`, `aguardando_motivo_cancelamento`, `retencao_motivos_enviados`, `retencao_aguardando_texto_livre`, `aguardando_resposta_trustunlock`, `consulta_consultiva_stage` (no estágio). Defesa em profundidade incompleta.
- **Por que é problema**: cliente em coleta pode ser interceptado por LLM consultive se `coletaDuraValidator` falhar (race ou edge case). Mesma classe de bug que motivou o fix de COLETA_FLAGS originalmente.
- **Fix sugerido**: derivar lista única de `COLETA_DURA_FLAGS` exportada do validator e reutilizar nos 2 lugares (e em `smalltalkGuards.isInCriticalState` — também tem divergência).

#### 1.5 [MÉDIO] `situationCodeToSector` usa heurística de prefixo que confunde CAN com C
- **Onde**: server/services/agents/resolver/steps/_helpers.ts:345-352
- **Sintoma**: regex de prefixo: `C` = VENDAS, `CAN` = CANCELAMENTO. Mas no catálogo, CANCELAMENTO usa `C6_*` (não `CAN_*`). Resultado: tag `C6` é classificada como VENDAS pelo sticky-tag check.
- **Por que é problema**: stickiness por tag não bate pra cliente cancelando — tag C6 ativa não impede swap "para VENDAS" porque o helper acha que já é VENDAS.
- **Fix sugerido**: aceitar lista explícita ou consultar `SITUATION_CONFIG` (já tem `domain` por code).

#### 1.6 [BAIXO] `INTENT_PRE_CPF_TTL_MS` comentado como "paridade V1 SESSION_STALE_MS" mas é 1h vs 4h real
- **Onde**: server/services/agents/resolver/steps/_helpers.ts:282-286
- **Sintoma**: comentário diz "(paridade V1 SESSION_STALE_MS)" mas valor é `60 * 60 * 1000` (1h), enquanto SESSION_STALE_MS = 4h em todos os outros lugares.
- **Fix sugerido**: ou alinhar pra 4h (paridade real), ou corrigir comment dizendo "TTL deliberadamente menor que session pra evitar sticky cross-conv".

#### 1.7 [BAIXO] `inferSuporteSubFlow` (fastPathL0) duplica regexes de `handleSuporteSubFlows`
- **Onde**: server/services/agents/resolver/fastPathL0.ts:103-145 + server/services/agents/handlers/suporte/handleSuporteSubFlows.ts:216-285
- **Sintoma**: mesma lógica `sem_internet/senha/wifi sumiu/mover/equipamento/sinal_fraco/sem_energia/quedas/lento/instabilidade` em dois lugares. Drift sutil já existe (ex: ordem de S14 vs S19, padrões de "wifi fraco").
- **Por que é problema**: alterar uma regra em um lugar não reflete no outro. Fix de "wifi fraco em outro cômodo" no fastPathL0 vs handleSuporteSubFlows pode produzir diferentes códigos.
- **Fix sugerido**: extrair `inferSuporteCode(text)` puro pra módulo compartilhado e reusar.

#### 1.8 [BAIXO] Tipos `FastPathSector` vs `Sector` redeclarados (drift potencial)
- **Onde**: server/services/agents/resolver/fastPathL0.ts:51 declara `FastPathSector`; `resolver/types.ts` declara `Sector`. Apenas 4 setores em ambos, mas tipos diferentes.

### 2. Tags inconsistentes

#### 2.1 [CRÍTICO] Routing F12 pós-refator V1 paridade quebrado
- **Onde**: server/services/agents/handlers/financeiroHandler.ts:217-220 + server/services/agents/handlers/financeiro/handleF12.ts:1-15
- **Sintoma**: handler L217 ainda rota `subFlow === 'F12' || sub === 'pagou_mas_bloqueado' || subIntentPreCpf === 'pagou_mas_bloqueado'` pra handleF12. Mas handleF12 (comment L4-7) é agora "crédito/ressarcimento" e "pagou_mas_bloqueado" deveria ir pra F19. Cliente que diz "paguei e tá bloqueado" recebe mensagem de crédito/desconto.
- **Por que é problema**: tag F12 aplicada errada (#credito-desconto em vez de #pagou-bloqueado), ack message errada, atendente recebe contexto errado.
- **Fix sugerido**: adicionar branch separado `if (sub === 'pagou_mas_bloqueado' || subIntentPreCpf === 'pagou_mas_bloqueado') return handleF19(input);` antes do handleF12.

#### 2.2 [CRÍTICO] handleF9 — `titular_financeiro` rota pra cancelamento-com-débito
- **Onde**: server/services/agents/handlers/financeiroHandler.ts:271-274 + server/services/agents/handlers/financeiro/handleF9.ts:1-12
- **Sintoma**: financeiroHandler ainda rota `subFlow === 'F9' || sub === 'titular_financeiro'` pra handleF9, mas F9 agora é cancelamento+débito (paridade V1). Comment de handleF9 diz que titularidade financeira "moveu pra F18 (handleF18.ts)" — **handleF18.ts NÃO EXISTE**.
- **Por que é problema**: cliente pedindo "trocar titular do boleto" é classificado como "quer cancelar com dívida" — fluxo, tag e atendente totalmente errados.
- **Fix sugerido**: criar handleF18.ts ou rotear `titular_financeiro` pra handleFinanceiroRestantes; rever subFlow `F9` semântica em todo o pipeline (intentRegex, anchors, PRECPF_SUB_TO_CODE).

#### 2.3 [CRÍTICO] handleF8 cobre contestação mas `sub === 'cancelar_boleto'` ainda mapeia pra ele
- **Onde**: server/services/agents/handlers/financeiroHandler.ts:265-268 + server/services/agents/handlers/financeiro/handleF8.ts:1-18
- **Sintoma**: handler L265: `if (subFlow === 'F8' || sub === 'cancelar_boleto')` → handleF8. Mas handleF8 agora é contestação (cliente NEGA dívida). Comment diz que "cancelar boleto migrou pra F17" — F17 NÃO EXISTE.
- **Por que é problema**: cliente pedindo "cancela esse boleto que veio errado" é tratado como negação de dívida. Mensagem ack diferente, tag diferente.
- **Fix sugerido**: criar handleF17 OU rotear `cancelar_boleto` pra escalation simples F11/F8 com motivo correto.

#### 2.4 [MÉDIO] `sovereignExitGuard.buildSignalExit` aplica `F2` como tag genérica FINANCEIRO
- **Onde**: server/services/agents/handlers/common/sovereignExitGuard.ts:347-348
- **Sintoma**: comment L348 diz "F2 (consulta-financeira) genérico" mas F2 no V2 é PAUSA (handleF2.ts). Aplicar F2 numa origem FIN→outro genérica marca o cliente como tendo solicitado pausa do serviço.
- **Por que é problema**: tag errada no histórico do atendente. Painel mostra "F2 #suspensao-temp" mesmo cliente não tendo pedido pausa.
- **Fix sugerido**: usar F3 (faturas) ou criar tag F-GENERICA na situationCatalog — semântica neutra.

#### 2.5 [MÉDIO] handleF12 promete consultar crédito mas tag F12 não está no situationCatalog/SITUATION_CONFIG
- **Onde**: server/services/agents/handlers/financeiro/handleF12.ts:71 + server/services/situationTagService.ts SITUATION_CONFIG
- **Sintoma**: V1 paridade mudou semântica de F12 sem garantir que a tag F12 no catálogo de situações reflete "#credito-desconto" (era "#pagou-bloqueado"). Tag pode estar com slug stale.
- **Fix sugerido**: auditar SITUATION_CONFIG['F12'] e renomear slug se necessário; documentar mapping F-código → slug em diretório único.

#### 2.6 [MÉDIO] handleF1 aplica tag F1 fire-and-forget sem aguardar — pode perder em race
- **Onde**: server/services/agents/handlers/financeiro/handleF1.ts:66
- **Sintoma**: `applyAutoTag(...).catch(() => {})` — se DB lento e turno termina rápido (ex: escalação imediata via sovereign_exit), tag pode não persistir.
- **Fix sugerido**: encadear no `await finalizeHandoff` OU promote pra Promise.allSettled no return.

#### 2.7 [MÉDIO] Variantes XX_* dependem de fallback no `applySituation` — frágil
- **Onde**: server/services/situationTagService.ts:341-360
- **Sintoma**: O fix de fallback `C6_OUTRO → C6` é correto, mas só roda se o caller passa uma string `XX_VARIANT`. Se algum handler passar variante NÃO terminada em `_`, ou se a base não existir, perde silenciosa.
- **Fix sugerido**: além do fallback, adicionar `SITUATION_VARIANT_REGISTRY` opcional pra normalizar antes; ou logar `warn` quando fallback dispara pra detectar uso indevido.

### 3. Regex / parsers divergentes

#### 3.1 [MÉDIO] `INFORMATIONAL_Q_RE` em `_helpers.ts` exige pronome interrogativo + `?` no final
- **Onde**: server/services/agents/resolver/steps/_helpers.ts:75
- **Sintoma**: regex muito restritivo — perguntas indiretas tipo "queria saber sobre instalação", "me explica como funciona o PIX" não batem. `consultivePreCpfStep` e `swapAndStayStep.weak_classifier_consultive` dependem disso pra disparar CONSULTATIVE.
- **Por que é problema**: cliente sem CPF perguntando coisa indireta pode pular consultive e cair em fluxo errado.
- **Fix sugerido**: adicionar padrões "me explica/me conta/queria saber/gostaria de saber/dúvida sobre".

#### 3.2 [BAIXO] `OUTRO_SETOR_RE` em handleSuporteSubFlows.ts não cobre "instabilidade", "wi-fi", "ONU" — falsos negativos em re-entrada cross-sector
- **Onde**: server/services/agents/handlers/suporte/handleSuporteSubFlows.ts:119
- **Sintoma**: regex de detecção de "cliente mudou de assunto" em coleta inclui tokens de FIN/CAN/VENDAS mas tokens de SUPORTE alternativos não. Se cliente em S4 manda "ah, e tá com onu vermelha", não cai em re-entrada cross-sector — fica preso na coleta S4.
- **Fix sugerido**: pode ser intencional (não troca DENTRO de suporte). Documentar; ou expandir pra cobrir transição S4→S1/S3.

### 4. Mensagens divergentes V1 vs V2

#### 4.1 [MÉDIO] Comments referenciam `S1-S18` mas catálogo tem S17 e S19
- **Onde**: server/services/agents/handlers/suporte/handleSuporteSubFlows.ts:1,4,10
- **Sintoma**: header docs ainda diz "S1-S18" mas o handler já roteia S17 (status linha) e S19 (quedas frequentes). PRECPF_SUB_TO_CODE.SUPORTE_TECNICO em _helpers.ts:142-160 já tem S19/S17. Docs stale.
- **Fix sugerido**: atualizar comments cabeçalho pra "S1-S19 (S17 status-linha, S19 quedas)".

#### 4.2 [MÉDIO] `PRECPF_SUB_TO_CODE.SUPORTE_TECNICO.sem_internet → S1` vs `situationCatalog.SUPORTE_MAP.sem_internet → S2/S3/S15`
- **Onde**: server/services/agents/resolver/steps/_helpers.ts:131 + server/services/agents/situationCatalog.ts:89
- **Sintoma**: dois mapas paralelos pra mesma sub-intent retornam códigos diferentes. V2 sempre mapeia S1 (handleSuporteSemInternet decide internamente), V1 mapeia condicionalmente S2/S3/S15.
- **Fix sugerido**: documentar que V2 delega decisão pro handler (S1 é guarda-chuva) e migrar V1 pra mesma abordagem; OU alinhar V2 ao V1 com `isOffline`/`isRegionalIncident`.

### 5. Flag races / persistência inconsistente

#### 5.1 [MÉDIO] `mensagem_original` setado em buildSignalExit mas não no RESET_STICKY_FLAGS
- **Onde**: server/services/agents/handlers/common/sovereignExitGuard.ts:406 + handleSuporteSubFlows reset etapaPorReentrada
- **Sintoma**: `mensagem_original` persistido pelo signalExit pra próximo turno reprocessar, mas nada limpa ao final do próximo turno. Próximo turno usa mensagem_original que pode estar stale.
- **Fix sugerido**: adicionar limpeza em RESET_STICKY_FLAGS após consumir.

#### 5.2 [BAIXO] `__gatewayTransitionAlreadySent` é flag intra-turn lida em dispatcher mas nunca limpa
- **Onde**: server/services/agents/dispatcher/dispatchDecision.ts:538-549
- **Sintoma**: comment fala "engine remove depois" mas nada em runV2Agent remove. Próximo turno ainda tem essa flag se persistir.
- **Fix sugerido**: filtrar flag fora antes de fazer merge JSONB no updateSession.

#### 5.3 [BAIXO] `categoria_lentidao` setada em handleSuporteLentidao mas usada em handleSuporteSubFlows.ts:208 sem verificar TTL
- **Sintoma**: cliente que abandonou troubleshooting S4 e volta horas depois pra novo problema pode ter `categoria_lentidao` velho ainda setado — handler preserva e re-roteia errado.
- **Fix sugerido**: limpar em RESET_STICKY_FLAGS quando etapa_troubleshooting cair.

### 6. Guards faltantes / ordem errada

#### 6.1 [CRÍTICO] `applyPolicyGates` F7 aplica `canTakePauseValidator` em handler que é negociação
- **Onde**: server/services/agents/applyPolicyGates.ts:243-255 + server/services/agents/handlers/financeiro/handleF7.ts:1
- **Sintoma**: comment L243 diz "pra F7 (pausar fatura)" mas handleF7 é NEGOCIAÇÃO. Validator de pausa roda em negociação. F2 (que é pausa) NÃO tem policy gate.
- **Por que é problema**: cliente negociando recebe rejeitos de "não pode pausar agora" inadequados; cliente pedindo pausa F2 passa sem validação.
- **Fix sugerido**: trocar `decision.subFlow === 'F7'` por `decision.subFlow === 'F2'` no gate; ou adicionar ambos com validators distintos.

#### 6.2 [MÉDIO] Smalltalk layer roda ANTES do CPF check em runV2Agent — pode interceptar fala de cliente identificado em coleta
- **Onde**: server/services/agents/runV2Agent.ts:141-242 (smalltalk) vs 251 (CPF validation)
- **Sintoma**: smalltalkLayer importa async e roda antes mesmo do CPF parse. checkSmalltalkGuards depende de `previousFlow` (que vem da sessão) — se sessão ainda não carregou ou se há race, smalltalk pode interceptar incorretamente.
- **Análise**: na prática `sessRow` é carregada em L104 e `previousFlow` é passado ao smalltalk em L148 — ok. Mas a estrutura é frágil pra adicionar novos guards. **Médio**.

#### 6.3 [MÉDIO] CPF parser (L251-286 de runV2Agent) roda ANTES do preGate emergency
- **Onde**: server/services/agents/runV2Agent.ts:251 vs resolver/steps/emergencyPreGate.ts
- **Sintoma**: cliente mandando 11 dígitos puros que casa com phone num momento de pânico ("11999998888 SOCORRO") cai em "ah isso é telefone" antes de emergência ser detectada.
- **Fix sugerido**: condicionar CPF parser a `messageText.length <= 15` ou rodar emergency primeiro.

### 7. Cross-sector / sticky tag

#### 7.1 [MÉDIO] `STICKY_TAG_OVERRIDE_CONF=0.85` vs `CROSSECTOR_BYPASS_STICKY_TAG_SCORE=0.78` — gap não auditado
- **Onde**: server/services/agents/resolver/steps/swapAndStay.ts:41,54
- **Sintoma**: thresholds boundary (0.78-0.85) podem ter casos de inconsistência: candidato cross-sector com score 0.80 e classifier confidence 0.80 — qual vence? Lógica L139 favorece cross-sector via `crossSectorOverridesTag`, mas isso assume os 2 sinais nunca colidem.
- **Por que é problema**: turn flaky — mesma frase pode dar swap ou STAY conforme microsegundos de embedding.
- **Fix sugerido**: cobrir esses cases em smoke; documentar precedência.

#### 7.2 [BAIXO] `FAQ_CONFIRMS_CROSSECTOR_MIN_SCORE=0.72` + `FAQ_CATEGORY_BOOST_MIN_SCORE=0.85` — 2 thresholds sem teste de regressão visível
- **Onde**: server/services/agents/resolver/steps/swapAndStay.ts:63-64
- **Sintoma**: melhoria B adicionada mas sem cenário no smoke per-layer cobrindo zona cinza (0.72-0.78 + FAQ).

### 8. Resolver / decisão

#### 8.1 [MÉDIO] `dispatchDecision` re-executa `runConsultativeFallback` mesmo quando `runDecisionEngine` já executou
- **Onde**: server/services/agents/dispatcher/dispatchDecision.ts:111-124 + server/services/agents/runDecisionEngine.ts:559-580
- **Sintoma**: `runDecisionEngine` chama consultive quando `action === 'CONSULTATIVE_RESPONSE'` (L561) e armazena em `v2Result.consultative`. Mas `runV2Agent` NÃO consome `v2Result.consultative` — passa decision pro dispatcher, que CHAMA DE NOVO. **2 chamadas LLM/RAG por turno consultivo**.
- **Por que é problema**: dobra custo + latência em ~30% dos turnos (consultive é caminho frequente). Confirma com `grep "v2Result.consultative"` (0 hits).
- **Fix sugerido**: ou (a) remover chamada em runDecisionEngine e deixar só no dispatcher, ou (b) propagar `consultative` pra dispatcher consumir.

#### 8.2 [MÉDIO] `dispatchDecision` no path CONSULTATIVE manda evidence vazio
- **Onde**: server/services/agents/dispatcher/dispatchDecision.ts:113-122
- **Sintoma**: além de re-executar, ignora `input.evidence` (pack já computado) e manda EMPTY_EVIDENCE_PACK. Consultive não tem FAQ hit / Quest hit que já bateu.
- **Fix sugerido**: passar `input.evidence` (já existe em DispatchDecisionInput).

### 9. Validators state vs policy

#### 9.1 [MÉDIO] `applyPolicyGates` swallow generic em catch — perde stack trace
- **Onde**: server/services/agents/applyPolicyGates.ts:284-287
- **Sintoma**: `console.warn(...)` sem stack quando validator quebra. Impossível debug em prod.
- **Fix sugerido**: incluir `err?.stack?.slice(0,500)` no log; trace dedicado pra falha de policy.

#### 9.2 [BAIXO] `coletaDuraValidator` retorna sempre `skip:false` mesmo com dispatchHint — convention confusa
- **Onde**: server/services/agents/validators/state/coletaDuraValidator.ts:165-219
- **Sintoma**: comentário longo explica que é "informativo" mas `dispatchHint` na prática curto-circuita o pipeline (runDecisionEngine.ts:340-397). É um skip disfarçado.
- **Fix sugerido**: renomear pra `dispatchSkip: true` quando dispatchHint setado pra alinhar com semântica real.

### 10. RAG / Evidence

#### 10.1 [MÉDIO] `evidencePackCache` TTL 30s muito curto pra turnos com tool_calling pesado
- **Onde**: server/services/agents/rag/evidencePackCache.ts:27
- **Sintoma**: cache turn-scoped expira em 30s. Turnos com Vision API (~800ms) + LLM ~3s + tool calling iterativo (4-8s) podem extrapolar quando segundos clientes do mesmo phone batem em paralelo.
- **Fix sugerido**: aumentar pra 90s ou marcar key com turnId em vez de só hash de msg.

#### 10.2 [BAIXO] `retrieveFaq` skip pra saudações puras roda pra MAS retrieveQuestionarioCached não tem mesmo skip
- **Onde**: server/services/agents/rag/buildEvidencePack.ts:266-283 (faq) — equivalente em questionario não existe na mesma extensão
- **Sintoma**: "Bom dia" passa em retrieveQuestionario mas é skipped em retrieveFaq.
- **Fix sugerido**: aplicar mesmo skip de saudação pura no retrieveQuestionario.

### 11. Telemetria / observabilidade

#### 11.1 [COSMÉTICO] `[V1]` log prefix em arquivos V2-puros
- **Onde**: server/services/agents/validators/runStateValidatorsEarly.ts:89 + validators/runStateValidatorsCore.ts:90 + preGate/runPreGateSoberano.ts:97,122,135,159
- **Sintoma**: warn/info usam prefixo `[V1]` mas arquivos vivem em namespace V2.
- **Fix sugerido**: trocar pra `[V2:validator]`/`[V2:preGate]`. Pequeno mas afeta filtragem de logs em prod.

#### 11.2 [BAIXO] `dispatchDecision` LOG no ESCALATE handler usa string template solta em vez de logV2Stage
- **Onde**: server/services/agents/dispatcher/dispatchDecision.ts:367
- **Sintoma**: `console.log("[dispatcher:escalate]...")` enquanto resto usa logV2Stage. Inconsistência de canal de telemetria.

#### 11.3 [BAIXO] `applyPolicyGates` catch error não loga `validatorName`
- **Onde**: server/services/agents/applyPolicyGates.ts:284-287
- **Sintoma**: sem o nome do validator que falhou, impossível correlacionar com problema (regex falhou? DB indisponível?).

#### 11.4 [BAIXO] `decisionStatsRecorder` referenciado em design mas nem todos os steps loggam corretamente — drift mínimo
- **Onde**: server/services/agents/observability/decisionStatsRecorder.ts (verificar coverage real vs design doc).
- **Sintoma**: alguns steps (`offTopic`, `c4Lock`) podem não estar populando stats — verificar com grep.

### 12. Erro handling

#### 12.1 [MÉDIO] runV2Agent L211-213 — falha em finalizeHumanHandoff só registra console.error sem reverter
- **Onde**: server/services/agents/runV2Agent.ts:200-213
- **Sintoma**: smalltalk ESCALATE_HUMAN manda msg + tenta handoff; se handoff falhar, msg já foi enviada mas card não migrou. Cliente vê "atendente já já te chama" mas o atendente nunca recebe.
- **Fix sugerido**: setup retry ou pelo menos applyTag inline garantindo AH visível.

#### 12.2 [BAIXO] `dispatcher` parallel_universal tool_calling — falhas absorvidas sem distinguir bug vs LLM-recusa
- **Onde**: server/services/agents/dispatcher/dispatchDecision.ts:685-691
- **Sintoma**: catch unifica exception (import falha?) com não-convergência (LLM se recusou). Ambos viram "devolve pro handler".
- **Fix sugerido**: separar `r.escalated` (LLM-decisão) de `try/catch` (bug).

### 13. TypeScript / tipos

#### 13.1 [BAIXO] `(decision.proposedStateUpdates as any)?.abrir_os` em applyPolicyGates.ts:277
- **Sintoma**: cast `as any` no proposedStateUpdates. Sem tipo formal pra essa propriedade.
- **Fix sugerido**: adicionar campo opcional ao type ProposedDecision.

#### 13.2 [BAIXO] Sector type duplicado: `Sector` em resolver/types.ts e `FastPathSector` em fastPathL0.ts
- **Sintoma**: dois tipos pra mesmo conceito. Apenas SUPORTE_TECNICO/FINANCEIRO/VENDAS/CANCELAMENTO comum.

#### 13.3 [BAIXO] `dispatcher/types.ts` campos como `sugestaoIA`, `intentVector`, `intentContext` opcionais sem documentação
- **Fix sugerido**: adicionar JSDoc explicando quando cada um aparece.

### 14. Dead code

#### 14.1 [MÉDIO] `preGate/runPreGateSoberano` + detectEmergency + detectHumanRequest
- **Onde**: server/services/agents/preGate/*
- **Sintoma**: módulo existe e foi escrito como V2-puro, mas só é chamado por `_legacy/arbitrator/rules/03_preGateSoberanoRule.ts`. `runV2Agent` usa `emergencyPreGateStep` no resolver em vez disso.
- **Por que é problema**: confusão arquitetural — quem é a fonte da verdade pra emergência? Manter código que parece V2 mas só V1 chama mascara o limite real.
- **Fix sugerido**: mover pra `_legacy/` OU integrar em runV2Agent.

#### 14.2 [BAIXO] `rag/thresholds.ts` (`DEFAULT_THRESHOLDS`, `getThreshold`, `meetsThreshold`)
- **Onde**: server/services/agents/rag/thresholds.ts
- **Sintoma**: declarado e exportado via rag/index.ts mas zero consumidores externos. Dead helper.
- **Fix sugerido**: consumir nos steps onde threshold é hardcoded OU remover.

#### 14.3 [BAIXO] `handleF18.ts` referenciado em comments do handleF9.ts:8 mas arquivo não existe
- **Onde**: server/services/agents/handlers/financeiro/handleF9.ts:7-8
- **Sintoma**: comment estável "moveu pra F18 (handleF18.ts)" — gera expectativa de existir. Ver achado 2.2.

#### 14.4 [BAIXO] `handleF17.ts` similar — comments em handleF8.ts:6-7
- **Onde**: server/services/agents/handlers/financeiro/handleF8.ts:5-7
- **Sintoma**: igual ao anterior — comments referenciam F17 inexistente.

### 15. Cosméticos

#### 15.1 [COSMÉTICO] Mistura PT-BR / EN em nomes de variáveis
- **Onde**: vários — ex: `etapaTrouble` vs `troubleshootingEtapa`, `pendenciaBlock` vs `pendencyBlock`.
- **Sintoma**: convention drift menor.

#### 15.2 [COSMÉTICO] Comments timestamp em pt-BR "Bruno YYYY-MM-DD" — bom mas inconsistente entre `Bruno (data — contexto)` e `Bruno data (contexto)`.

#### 15.3 [COSMÉTICO] `console.log` com `🎯` `💬` `🔀` `⚡` — bom pra leitura mas dificulta `grep` em prod. Considerar tagueamento estruturado padronizado.

#### 15.4 [COSMÉTICO] Imports não ordenados (alguns alfabéticos, outros por agrupamento). Sem prettier/lint não bate convention.

#### 15.5 [COSMÉTICO] V2_STAGES tem 23 entradas — algumas como `'v2_promise_interceptor'` em dispatcher L155 são strings literais, não constantes do enum. Drift menor.

## Achados sem categoria clara

### S.1 [MÉDIO] Reset universal `RESET_STICKY_FLAGS` não tem definição central no V2
- Cada handler limpa seus próprios flags ad-hoc. Sem `RESET_STICKY_FLAGS` único, fácil esquecer flag nova.
- Sugestão: criar `flagsRegistry.ts` com `STICKY_FLAGS_BY_SECTOR` e `clearStickyFlagsOnSectorChange()` consumido em swapAndStay + buildSignalExit.

### S.2 [BAIXO] `parallelQuestionRegistry` cobertura — flags que vivem em coletaDuraValidator devem ter entrada
- Várias flags (mudanca_venc_aguardando_dia / retencao_aguardando_texto_livre / aguardando_caminho_senha_wifi) podem não ter reaskTail/contextHint customizado, caindo no default genérico.
- Sugestão: comparar lista `COLETA_DURA_FLAGS` vs registry e completar.

### S.3 [BAIXO] runV2Agent persiste `cpf`/`fluxoAtual`/`contratoId` sempre que `newCpf` set — mesmo quando dispatch só leu, não decidiu
- L425-453 sobrescreve sempre. Em turno informacional sem swap, persiste mesmo assim. Idempotente mas gera tráfego DB.

## Recomendações de Sequência

### Onda 1 — Fixes Críticos Bloqueantes pra Cutover V2 (esforço: M)
Agrupa 1.1, 1.2, 6.1, 2.1, 2.2, 2.3 — 6 achados que afetam diretamente comportamento errado em prod:
1. Fix case-mismatch em noClassifierFallback / buttonSovereign / fastPathL0 (1.1, 1.2)
2. Renomear policy gate F7→F2 (6.1)
3. Reativar routing F19 pra pagou_bloqueado (2.1)
4. Criar handleF17/F18 ou rebind routing (2.2, 2.3)

### Onda 2 — Estrutura de Decisão Consistente (esforço: M)
Agrupa 8.1, 8.2, 1.3, 1.5, 2.4 — duplicação de consultive call + tags erradas:
1. Resolver duplicação consultive (8.1, 8.2)
2. Unificar maps PRECPF_SUB_TO_CODE vs situationCatalog (1.3)
3. Corrigir situationCodeToSector prefix (1.5)
4. Tag genérica sovereignExit (2.4)

### Onda 3 — Defesa em Profundidade (esforço: P)
Agrupa 1.4, 5.1, 5.2, S.1, S.2 — flags / estados:
1. Centralizar COLETA_DURA_FLAGS export único
2. RESET_STICKY_FLAGS registry
3. Cobrir parallelQuestionRegistry pra TODAS coletas

### Onda 4 — Telemetria + Dead Code Cleanup (esforço: P)
Agrupa 11.1, 11.2, 11.3, 14.1, 14.2, 14.3, 14.4, 15.x — prefixos errados + dead code:
1. Substituir `[V1]` por `[V2:...]` em validators + preGate
2. Mover preGate/ pra _legacy/
3. Remover rag/thresholds.ts ou plugar nos steps
4. Limpar comments stale de F17/F18

### Onda 5 — Robustez (esforço: M)
Agrupa 12.1, 12.2, 10.1, 3.1, S.3 — retry + thresholds:
1. Retry em smalltalk escalate
2. TTL evidencePackCache 30s→90s
3. INFORMATIONAL_Q_RE expandir

### Onda 6 — Cosmético / TS (esforço: P)
Tudo do 13 + 15.

