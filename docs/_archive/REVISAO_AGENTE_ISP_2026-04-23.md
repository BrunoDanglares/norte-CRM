# Revisão do Agente ISP — 2026-04-23

Documento de análise. **Não contém implementação.** Serve pra decidir juntos o que vai ser implementado e em que ordem.

Metodologia: skill `Arquiteto-Agent-wpp` aplicada ao motor ISP do ChatBanana. Premissas confirmadas com o Bruno em `2026-04-23`:

1. Fix de lentidão (fluxo 4 padrões) **já está resolvido** — screenshot que ele mostrou era antigo.
2. Prioridade da intenção: quando cliente muda de intent **dentro de um fluxo ativo**, agente deve **perguntar** "quer seguir com X ou prefere resolver Y agora?". Regra se aplica a **qualquer** troca, não só financeiro↔suporte.
3. Cliente com 2 intents na mesma mensagem: agente pergunta qual tratar primeiro.
4. Áudio: aparentemente ok, revisar.
5. Botões/texto/áudio: **todas** as etapas de múltipla escolha devem aceitar os três formatos.
6. Questionário do tenant: obrigatório. Config do Bruno será o default quando tenant ainda não respondeu.
7. Entregável: este documento; implementação depois.

---

## 1. Mapa do motor (referência rápida)

```
[WhatsApp] → webhook (Meta/wweb) → transcribeAudio (se áudio) → messageText
          → message-processor (buffer 4.5s, dedup, pending inputs, CSAT)
          → ispAgentEngine.run()
              ├─ dedup + state load
              ├─ aiClassifyDepartment() / orchestrator.decidirProximoPasso()
              │   ├─ regex primária (INTENT_KEYWORDS, 5 intents)
              │   └─ GPT-4o-mini (DECISAO_SYSTEM_PROMPT)
              ├─ validarIntentComContexto()  ← guarda troca de intent
              ├─ [handleIntentSwitch] ← plumbing: team/pipeline/kanban
              └─ despacho pro agente:
                  ├─ FinanceiroAgent  (1328 linhas; F1–F10)
                  ├─ SuporteAgent     (2094 linhas; S1–S13)
                  ├─ ComercialAgent   (1813 linhas; C1–C11)
                  ├─ CancelamentoAgent (239 linhas)
                  └─ HumanoAgent       (154 linhas)
              → applyAutoTag (situação) → broadcast → resposta
```

Arquivos chave:
- [server/services/ispAgentEngine.ts](server/services/ispAgentEngine.ts) — 4000+ linhas, roteamento principal
- [server/services/agents/orchestrator.ts](server/services/agents/orchestrator.ts) — detecção + guard de intent
- [server/services/agents/suporteAgent.ts](server/services/agents/suporteAgent.ts) — fluxo S1–S13
- [server/services/agents/financeiroAgent.ts](server/services/agents/financeiroAgent.ts) — fluxo F1–F10
- [server/services/agents/comercialAgent.ts](server/services/agents/comercialAgent.ts) — fluxo C1–C11
- [server/services/agents/priorityResolver.ts](server/services/agents/priorityResolver.ts) — desempate multi-intent
- [server/services/agents/humanoAgent.ts](server/services/agents/humanoAgent.ts) — handoff
- [server/services/situationTagService.ts](server/services/situationTagService.ts) — fonte única das 35 situações
- [server/services/tenantSettingsService.ts](server/services/tenantSettingsService.ts) — config por tenant
- [server/services/teamAssignment.ts](server/services/teamAssignment.ts:391) — `handleIntentSwitch()`
- [server/services/automationEngine.ts:221](server/services/automationEngine.ts#L221) — `transcribeAudio()` (Whisper)

---

## 2. Vínculo situação ↔ regra ↔ questionário

**Fonte única das situações**: `SITUATION_CONFIG` em [situationTagService.ts:26-67](server/services/situationTagService.ts#L26-L67). 35 códigos: F1–F10, S1–S13, C1–C11, AH.

**Regras por tenant** (BusinessRules em [types.ts:29-92](server/services/agents/types.ts#L29-L92)) e qual situação cada regra alimenta:

| Situação | Pergunta do questionário (chave) | Campo em BusinessRules | Status |
|---|---|---|---|
| F1 — promessa pagto | q7 | `promessaDias` | ✅ vinculado |
| F1 | — | `promessasPerMonth` | ✅ vinculado |
| F2 — suspensão temporária | — | **sem regra** | ⚠️ **gap** |
| F3 — reativação | — | **sem regra** | ⚠️ **gap** |
| F4/F5/F6 — 2ª via / consulta débitos / status | — | `allowPix` / `allowBarcode` | ✅ parcial |
| F7 — negociação/parcelamento | q10 | `parcelamentoMax`, `descontoAVistaMax` | ✅ vinculado |
| F8 — contestação | — | **sem regra** | ⚠️ **gap** (sempre escala) |
| F9 — cancelamento c/ débito | — | **sem regra** | ⚠️ **gap** (sempre escala) |
| F10 — downgrade | — | `f10Acao` | ✅ vinculado |
| Financeiro (cross) | — | `tomCobranca` | ✅ |
| Financeiro (cross) | — | `suspendedToFinance` | ✅ |
| S1/S2/S3 — triagem ONU | — | `askRouterBeforeEscalateOffline`, `allowAutoOpenTicket`, `requireRebootStep` | ✅ parcial |
| S3 — SLA emergência | — | `slaEmergencia` | ✅ vinculado (não usado no fluxo) |
| S4 — lentidão geral | q120/q121 | `roteadorOferece5g`, `velocidadeMinimaSpeedtest` | ✅ vinculado |
| S5 — instabilidade | — | **sem regra** | ⚠️ **gap** (default: checklist) |
| S6 — horário específico | — | `s6Acao` | ✅ vinculado |
| S7 — site/app específico | — | **sem regra** | ⚠️ **gap** (sempre orienta fornecedor) |
| S8 — status OS | — | **sem regra** | ⚠️ **gap** |
| S9 — troca equipamento | — | `slaComum` | ⚠️ parcial |
| S10 — senha wifi | — | **sem regra** | ⚠️ **gap** (escala humano) |
| S11 — wifi sumiu | — | `s11Acao` | ✅ vinculado |
| S12 — mover roteador | — | **sem regra** | ⚠️ **gap** (escala humano) |
| S13 — consulta plano | — | `s13Permitido` | ✅ vinculado |
| C1 — upgrade/downgrade | — | **sem regra específica** | ⚠️ gap |
| C2 — agendamento | — | **sem regra** | ⚠️ gap |
| C3 — cobertura | — | **sem regra** | ⚠️ gap |
| C4 — fidelidade | — | **sem regra** | ⚠️ gap |
| C5 — nova contratação | — | **sem regra** | ⚠️ gap |
| C6 — retenção/cancelamento | — | `retencaoOfertas`, `retencaoDescontoMax`, `retencaoTentativas`, `retencaoDowngrade`, `retencaoEstrategia` | ✅ vinculado |
| C7 — titularidade | — | `c7Processo` | ✅ vinculado |
| C8 — consulta planos | — | `plans.items` (em TenantSettingsJson) | ✅ vinculado |
| C9 — mudança endereço | — | `c9Processo` | ✅ vinculado |
| C10 — indicação | — | **sem regra** | ⚠️ gap |
| C11 — coleta dados cadastrais | — | **sem regra** | ⚠️ gap |
| Geral (cross) | q3 | `allowDepartmentSwitch` | ✅ |
| Geral (cross) | — | `confidenceThreshold` | ✅ |
| AH — escalação | q14 | `ambiguityRetriesMax` | ✅ |
| AH | q15 | `canalEscalonacao` | ✅ |
| AH | q18 | `equipeDividaPorSetor` | ✅ |
| AH | — | `maxSupportDeniedBeforeEscalate` | ✅ |

### 2.1 Principais gaps

**G1** — **Muitas situações sem controle por questionário**. 18 de 35 situações não têm chave configurável pelo tenant. Isso significa:
- Tenants não conseguem customizar comportamento em: F2, F3, F8, F9, S5, S7, S8, S10, S12, C1–C5, C10, C11.
- Comportamento atual é **hardcoded** no código dos agentes (ex: S12 sempre escala humano, S7 sempre orienta fornecedor).

**G2** — **`DEFAULT_SETTINGS` em [tenantSettingsService.ts:28-52](server/services/tenantSettingsService.ts#L28-L52) é minimalista**. Só tem 8 flags básicas. Quando tenant não preenche o questionário, cai em **defaults hardcoded dentro de cada agente** (ex: `ambiguityRetriesMax ?? 2` no suporteAgent), **não no DEFAULT_SETTINGS**. Resultado: a config "padrão" é dispersa pelo código, não centralizada.

**G3** — **Falta o conceito "config do Bruno como template".** Bruno quer que suas próprias respostas ao questionário virem o default herdado por novos tenants. Hoje não existe nenhum mecanismo pra isso: ou o tenant responde, ou cai no `DEFAULT_SETTINGS` minimalista.

**G4** — **Granularidade inconsistente entre F-S-C.**
- Financeiro: quase toda situação tem regra (8 de 10).
- Suporte: misturado (5 de 13 têm regra).
- Comercial: pior (3 de 11 têm regra específica).

---

## 3. Prioridade da intenção do cliente (regra #2 do Bruno)

### 3.1 O que existe hoje

[orchestrator.ts:115-248](server/services/agents/orchestrator.ts#L115-L248) — `validarIntentComContexto()` decide se TROCA de intent é permitida quando cliente está em fluxo ativo. Matriz atual:

| Situação | Ação |
|---|---|
| Troca explícita ("quero falar com financeiro") | ✅ permite |
| Pedido de humano com keyword forte | ✅ permite |
| Mesmo intent | ✅ mantém |
| IA sugeriu GERAL durante fluxo | 🛡️ bloqueia, mantém fluxo |
| Filler ("ok", "sim", "certo") | 🛡️ bloqueia, mantém fluxo |
| Keyword forte do novo intent | ✅ permite (soberania da intenção) |
| Confiança < 0.7 sem keyword | 🛡️ bloqueia |
| Confiança ≥ 0.7 com keyword | ✅ permite |
| Confiança ≥ 0.8 sem keyword | ✅ permite |
| Default | 🛡️ bloqueia |

Uma vez validada a troca, [teamAssignment.ts:391](server/services/teamAssignment.ts#L391) (`handleIntentSwitch`) faz a parte operacional: muda pipeline, reatribui equipe, move card do kanban. **Tudo silencioso — cliente não é consultado.**

### 3.2 O gap (regra #2 do Bruno)

Bruno quer: quando cliente está em fluxo ativo e menciona outro assunto com força suficiente pra disparar troca, agente deve **perguntar**:

> "Entendi que você quer tratar da lentidão. Mas você estava com o boleto aberto — prefere **resolver o boleto primeiro** ou **tratar da lentidão agora**? 🙂"

Hoje isso **não existe**. O comportamento atual é troca silenciosa.

**Nuance importante**: a regra vale **apenas quando o cliente ESTÁ em fluxo ativo e fez algo dentro dele**. Se ele só mandou oi → financeiro → lentidão (sem ação concreta no financeiro), a troca silenciosa ainda faz sentido. A pergunta só agrega valor quando há **investimento do cliente no fluxo anterior** (ex: já pediu 2ª via, já recebeu boleto, já escolheu forma de pagamento).

**Detecção de "investimento no fluxo"** — sinais já presentes no state:
- `dados_coletados.boleto_enviado` (financeiro)
- `dados_coletados.pix_enviado`
- `dados_coletados.etapa_troubleshooting` ≠ `inicio` (suporte)
- `dados_coletados.os_aberta`
- `dados_coletados.promessa_registrada`
- `dados_coletados.coletando_cadastro` (comercial C11)
- `dados_coletados.fatura_selecionada`

Cliente que **não investiu** no fluxo → troca silenciosa (comportamento atual).
Cliente que **investiu** → pergunta qual prioridade.

### 3.3 Ponto de cuidado

Se cliente responder à pergunta dizendo "resolve a lentidão primeiro", o fluxo anterior **não pode ser apagado** — deve ficar "pausado" pra retomar depois. Hoje não existe o conceito de **fluxo pausado**. Implementar requer:
- Novo campo `state.fluxo_pausado` ou `dados_coletados.fluxo_pendente = { intent, etapa, contexto }`
- Ao terminar o fluxo atual (OS aberta / handoff / resolução), agente oferece: "Resolvemos a lentidão. Quer que eu volte ao boleto agora?"
- TTL de expiração (ex: 30min).

Sem esse "retornar ao fluxo", a pergunta vira vazia — cliente escolhe X, agente foca em X, mas nunca mais oferece Y.

---

## 4. Cliente confuso / multi-intent na mesma mensagem (regra #3 do Bruno)

### 4.1 O que existe hoje

[orchestrator.ts:425-451](server/services/agents/orchestrator.ts#L425-L451) já detecta **múltiplos intents** na mesma mensagem — IA retorna array `intents[]` com até 3 elementos, ordenados por confiança. O dominante vai pro despacho. O secundário (se conf ≥ 0.35) vai pra `IntentVector.secondary`.

[priorityResolver.ts:70-78](server/services/agents/priorityResolver.ts#L70-L78) tem `buildIntentContext()` que gera string tipo:

> "Contexto adicional detectado na mensagem: SUPORTE_TECNICO(40%). Use para enriquecer a resposta se relevante."

Essa string é passada pro prompt do agente escolhido como "dica" — mas o agente decide o que fazer com ela. Na prática, é ignorada na maior parte dos fluxos determinísticos.

### 4.2 O gap (regra #3 do Bruno)

Bruno quer: cliente diz "a net tá uma porcaria hoje, quando vence minha conta mesmo?" — agente deve **perguntar qual tratar primeiro** em vez de escolher silenciosamente.

Hoje isso **não existe**. O orchestrator escolhe o dominante e despacha, ignorando o secundário (ou só passando como dica).

**Quando perguntar**:
- IA retornou `intents[]` com 2+ entradas, e **ambas** com confiança ≥ 0.6.
- Os dois intents são "acionáveis" (FINANCEIRO, SUPORTE_TECNICO, VENDAS, CANCELAMENTO — **não** GERAL, **não** HUMANO).
- Os dois pertencem a **departamentos diferentes**.

Quando **NÃO** perguntar:
- Um dos intents é HUMANO → cliente pediu humano, respeita imediatamente.
- Um dos intents é GERAL → é só contexto, segue o dominante.
- Os dois pertencem ao mesmo departamento (ex: lento + caiu = ambos suporte) → segue.
- Diferença de confiança grande (ex: 0.9 vs 0.4) → segue o dominante.

### 4.3 Formato sugerido da pergunta

> "Entendi! Vi que você mencionou duas coisas:
> 1️⃣ 🌐 Problema com a internet (lenta)
> 2️⃣ 💰 Ver vencimento da fatura
>
> Qual você prefere que eu resolva primeiro?"

Resposta do cliente pode ser número, texto, ou áudio — mesma lógica do parseamento universal (ver §6).

---

## 5. Áudio

### 5.1 O que existe hoje

Pipeline em [automationEngine.ts:221-281](server/services/automationEngine.ts#L221-L281) — `transcribeAudio()`:

1. Baixa áudio (localUploads ou URL da Meta)
2. Detecta formato (OGG, MP3, WAV, WebM, MP4)
3. Resolve chaves OpenAI por ordem de candidato (workspace → env → AI Integrations)
4. Chama `openai.audio.transcriptions.create({ model, language: "pt" })` com Whisper
5. Retorna transcrição ou string vazia se todas as chaves falharem

Chamado em [webhook-meta.ts:713-725](server/routes/webhook-meta.ts#L713-L725) — **antes** do `message-processor` receber o conteúdo. O restante do motor trata áudio transcrito como texto comum.

Rastreamento: [ispAgentEngine.ts:1967-1976](server/services/ispAgentEngine.ts#L1967-L1976) preserva `input_original`, `input_transcribed`, `input_type` nos metrics — útil pra auditoria.

### 5.2 O que está bom

- ✅ Language fixo em "pt" (evita transcrição em inglês por engano).
- ✅ Fallback multi-key (quota esgotada → próxima chave).
- ✅ Formato auto-detectado — não quebra se Meta mandar OGG ou wweb mandar WebM.
- ✅ Timeout de 60s por tentativa.
- ✅ Métricas separadas por input_type.

### 5.3 Observações

**O1 — Silent fail**. Se transcrição falha, `content = ""` chega no motor. [ispAgentEngine.ts:1963](server/services/ispAgentEngine.ts#L1963) classifica como `'vazio'` e o motor precisa tratar. O código trata, mas **não avisa o cliente** que o áudio falhou. Cliente fica esperando resposta que nunca vem sobre o conteúdo do áudio.

**Sugestão**: quando `inputType === 'audio'` e `mensagemNormalizada.length === 0`, agente responde algo tipo "Desculpa, não consegui entender seu áudio. Pode me mandar em texto ou tentar de novo?".

**O2 — Áudios longos**. Não há limite de duração do áudio explícito. Whisper aceita até 25MB. Cliente pode mandar áudio de 10min → 60s de timeout pode não bastar. Vale considerar corte/truncamento de áudios >3min.

**O3 — Custo**. Whisper é pago por segundo. Não vi rate limit específico pra transcrição. Cliente mal-intencionado ou em loop pode gerar custo alto no tenant.

**O4 — Sem log de transcrição pro atendente**. Quando conversa escala pra humano, atendente vê só o texto transcrito, não a gravação original. Dependendo do tom, perde informação (cliente irritado, ironia, etc.). Considerar: manter `input_original` acessível na UI do inbox.

Nenhum desses é bloqueante, mas O1 é o de maior impacto em UX.

---

## 6. Opções: botão / texto / número / áudio (regra #5 do Bruno)

### 6.1 O que existe hoje

**Etapas com botão real** (enviadas via `n8nSendService.sendButtons`):
- Triagem inicial: "Já sou cliente" / "Quero contratar"
- Menu financeiro: 2ª via / Negociar / Outros
- Menu suporte nível 1: Sem internet / Lenta / Outros
- Menu comercial: Nova instalação / Upgrade / Outros
- Menu cancelamento: Preço / Qualidade / Outro
- Botões de pagamento: Boleto PDF / Pix copia e cola

Nas etapas com botão, o parseamento é unificado:
- `buttonId` → mapeado via dict (ex: `SUPORTE_LENTO` → `problema_suporte = 'lento'`)
- Texto livre → regex equivalente (ex: `/sem\s+internet|ca[ií]u/i`)
- Número → aceito via regex `/^[1-6]$/`
- Áudio → transcrição vira texto → regex/LLM

**Etapas sem botão — menu textual com números**:
- **Lentidão: 4 padrões S4/S5/S6/S7** ([suporteAgent.ts:503](server/services/agents/suporteAgent.ts#L503))
- Dispositivo do speedtest (3 opções)
- Resultado do checklist
- Confirmações diversas ("é cabo ou wifi?")

Nessas, só existe parseamento **de texto**:
- Regex pra número ("1", "1️⃣")
- Regex pra keyword ("sempre", "noite", "oscila", "netflix")
- LLM fallback via `classificarRespostaLivre()`

### 6.2 Gap principal (regra #5 do Bruno)

**Menu de 4 padrões de lentidão não usa botão**. Limitação do WhatsApp Cloud API: mensagem interativa "button" aceita **no máximo 3 botões**. Com 4 opções, teria que usar **List Message** (até 10 itens), que o código atual não envia.

Resultado: o cliente que espera clicar um botão **não tem essa opção** nessa etapa. Só pode digitar/mandar áudio.

Mesmo para os menus que **têm botão hoje (3 opções)**, a etapa seguinte (quando o cliente diz "Outros") volta a ser texto livre sem botões.

### 6.3 Outras etapas sem parseamento universal

Fiz grep — várias etapas de decisão usam **só regex de texto**, sem botão/list:
- [suporteAgent.ts:892-898](server/services/agents/suporteAgent.ts#L892-L898) — `aguardando_dispositivo_lento` (computador cabo / celular wifi / notebook wifi)
- Etapas de `aguardando_resultado_checklist`, `aguardando_speedtest_lento`
- Confirmações no cancelamento/retenção
- Etapa C11 de coleta de dados cadastrais
- Várias etapas do financeiro: confirmação de promessa, valor do parcelamento, forma de pagamento

Em TODAS essas, áudio funciona (vira texto) e texto funciona, mas **botão/list não existe**.

### 6.4 Recomendação de arquitetura

Criar um helper `sendUniversalChoice()` que:
1. Se ≤ 3 opções → envia como **button message** (nativo).
2. Se 4–10 opções → envia como **list message**.
3. Se > 10 ou opções muito longas → envia como **texto numerado** (fallback atual).
4. Grava no state: `pending_choice: { etapa, options: [{id, text, aliases: []}] }`.
5. No próximo turno, parsing unificado:
   - `buttonId` / `listId` → match por id
   - `messageText` numérico (1–10) → match por posição
   - `messageText` livre → regex de aliases → LLM `classificarRespostaLivre` fallback
   - áudio → transcreve → mesmo caminho do texto

Isso padroniza o comportamento de **todas** as etapas de múltipla escolha e cobre regra #5 do Bruno de uma vez.

---

## 7. Default do questionário (regra #6 do Bruno)

Bruno quer: quando um tenant novo chega, ele herda os valores do questionário **que o Bruno mesmo preencheu**. Só vira custom quando o tenant responde o questionário dele.

### 7.1 O que existe hoje

[tenantSettingsService.ts:28-52](server/services/tenantSettingsService.ts#L28-L52) — `DEFAULT_SETTINGS` é um objeto **hardcoded no código** com 8 flags básicas. Não cobre nem metade das chaves do questionário (ver tabela §2).

Quando tenant não tem linha na `tenantSettings`, `getTenantSettings()` cria uma linha nova com esse DEFAULT_SETTINGS minimalista.

### 7.2 Arquitetura sugerida

Três caminhos possíveis:

**Opção A — Template tenant "seed"**
- Criar um tenant especial (ex: `workspace_id = 'default_template'` ou flag `is_template: true` na tabela).
- Bruno preenche o questionário dele naquele workspace.
- `getTenantSettings(tenantId)` quando não encontra linha → copia do template.
- Vantagem: simples, reutiliza infra existente.
- Desvantagem: acoplamento estranho (config "default" é um tenant).

**Opção B — Tabela `tenant_settings_defaults` separada**
- Cria tabela com uma única linha (singleton) que guarda o JSON das defaults.
- Admin (Bruno) edita via UI nova.
- `getTenantSettings` fallback: se tenant não tem linha → lê singleton.
- Vantagem: clean, separação clara.
- Desvantagem: infra nova, mais código.

**Opção C — Copy-on-create**
- Quando tenant novo é criado, **copia** as settings do Bruno no mesmo momento (INSERT direto).
- Tenant já começa com linha própria, iguinho Bruno.
- Vantagem: não muda leitura, muda só o onboarding.
- Desvantagem: se Bruno atualizar depois, tenants antigos não herdam.

**Recomendação**: **Opção A** com um workspace marcado (ex: `is_template_source: true` no `workspaces`), + flag `inherited_from_template: true` na `tenantSettings` enquanto tenant não preenche. Quando ele preenche pela primeira vez, flag vira `false` e não herda mais updates do Bruno. Equilibra simplicidade com previsibilidade pro tenant.

---

## 8. Inconsistências restantes

### 8.1 `validarIntentComContexto` é complexo demais

[orchestrator.ts:115-248](server/services/agents/orchestrator.ts#L115-L248) — 140 linhas de if/else encadeados, múltiplas variáveis booleanas (`isInActiveFlow`, `isSameIntent`, `hasExplicitSwitch`, `hasStrongKeyword`, `isFiller`, `intentParaDepois`). Cada branch tem early return com payload similar mas não idêntico.

**Problema prático**: bugs recentes no intent switch guard (commits recentes) sugerem que é fácil introduzir inconsistência aqui. Todas as branches constroem o mesmo shape de resposta à mão.

**Recomendação**: transformar em **matriz de decisão declarativa**. Definir regras como dados:
```ts
const DECISION_TABLE = [
  { when: 'hasExplicitSwitch && activeIntent', action: 'allow', motivo: 'troca_explicita' },
  { when: 'sugeriuHumano && keywordForte', action: 'allow', motivo: 'humano_keyword' },
  { when: 'isInActiveFlow && isSameIntent', action: 'keep', motivo: 'mesmo_fluxo' },
  { when: 'isInActiveFlow && sugeriuGERAL', action: 'block', motivo: 'geral_em_fluxo' },
  // ...
];
```
+ helper único que monta a resposta padrão. Fica testável e auditável.

### 8.2 `classificarRespostaLivre` pode ser custo desperdiçado

[suporteAgent.ts:43-123](server/services/agents/suporteAgent.ts#L43-L123). Uso atual: é chamado **depois** do regex tentar mapear. Se regex já mapeou, LLM não é chamado — ok.

**Mas**: em algumas etapas o regex é escrito de forma que "quase nunca" casa (ex: quando o cliente manda áudio transcrito em parágrafo longo). LLM é chamado **toda vez**. Custo: ~$0.0001 por chamada, mas em escala é real.

**Recomendação**: adicionar métrica de hit-rate do regex vs LLM nas etapas de multipla escolha. Se uma etapa está >80% indo pro LLM, o regex dela precisa ser expandido (ver §9 — expansão de dizeres).

### 8.3 Histórico duplicado

[types.ts](server/services/agents/types.ts) — `state.ultima_intencao` (string simples) e `state.orquestrador.historico_intencoes` (array). Ambos atualizados em pontos diferentes do motor. Risco de dessincronização (um aponta pra X, outro pra Y).

**Recomendação**: `ultima_intencao` é derivável de `historico_intencoes[historico_intencoes.length - 1]`. Remover o campo simples e usar o array como fonte única. Baixa prioridade, mas é dívida.

### 8.4 Fallback `safeDefault` não usa regex como fallback intermediário

[orchestrator.ts:336-357](server/services/agents/orchestrator.ts#L336-L357) — quando todas as keys OpenAI falham, cai direto em GERAL (ou FINANCEIRO se suspenso / SUPORTE se offline). **Ignora a regex primária** que já existe em [orchestrator.ts:14-20](server/services/agents/orchestrator.ts#L14-L20).

**Recomendação**: antes do `safeDefault` final, testar `INTENT_KEYWORDS` contra a mensagem. Se ≥1 regex casa, usar esse intent com confidence 0.55 (suficiente pra passar do confidence_threshold padrão, mas menor que o da IA). Inteligência barata e confiável como último recurso.

### 8.5 Tags acumulam sem limite no protocolo

Comentário intencional em [situationTagService.ts:219-223](server/services/situationTagService.ts#L219-L223) — tags acumulam propositalmente, pro atendente humano ver todo o histórico.

**Mas**: protocolo com 15 tags diferentes fica poluído na UI. Exemplo do isolamento atual: tags ficam presas ao protocolo atual (não migram), mas no protocolo atual não há limite.

**Recomendação (leve)**: na UI do protocolo, agrupar tags por domínio e mostrar contagem (`Financeiro: 3 · Suporte: 4 · Comercial: 1`) com expand on click. Não muda a data layer, só visualização.

### 8.6 Ambiguidade escalada sem contexto específico pro humano

[suporteAgent.ts:149-151](server/services/agents/suporteAgent.ts#L149-L151) — quando `bumpAmbiguityRetry` escala, resposta pro cliente é genérica ("Desculpa por não ter conseguido entender direitinho"). **Pior**: o humano que recebe não vê claramente **qual era a pergunta específica** que o cliente não soube responder.

O `resumo_conversa` em [humanoAgent.ts:123-151](server/services/agents/humanoAgent.ts#L123-L151) lista campos genéricos (cpf, departamento, problema), mas não inclui "cliente estava na etapa X sendo perguntado sobre Y".

**Recomendação**: quando escalação é por ambiguidade, incluir `etapa_origem` e `pergunta_nao_respondida` no `handoff_meta`. Humano abre a conversa e já vê: "Estava na etapa aguardando_padrao_lentidao sendo perguntado sobre qual é o padrão (sempre/horário/instável/site específico), não conseguiu classificar em 2 tentativas."

---

## 9. Expansão de dizeres (melhora semântica)

Regexes atuais estão sólidos, mas algumas expressões comuns do falante brasileiro não estão cobertas. Aqui lista o que notei faltando, por situação:

### 9.1 FINANCEIRO
- "to devendo" / "tô devendo" — já coberto em `/d[ií]vida|devendo/`.
- ❌ "meu plano tá cortado" / "minha net tá cortada" / "cortaram minha internet" — hoje classifica como SUPORTE. Cortado = suspenso por inadimplência. Adicionar ao regex FINANCEIRO: `/cortad[oa]|cortaram|cortar[aã]m/`.
- ❌ "quando cai meu dinheiro pra pagar" / "meu salário ainda não caiu" — é negociação/promessa; hoje cai em GERAL. Expandir F1: `/sal[aá]rio|cair\s*(o\s*)?dinheiro|esperar\s*(o\s*)?pagamento/`.
- ❌ "boleto vencido há X dias" — cai em F4/F5 hoje, mas vale tratar especificamente se dias_late > 30 (escala F7 negociação proativa).

### 9.2 SUPORTE
- ❌ "tá engasgando" / "tá travadinho" / "tá rodando mal" — gírias de lentidão. Adicionar: `/engasg|travadinh|rodando\s+mal/`.
- ❌ "internet meia-boca" / "net meia-lenta" — descrição subjetiva; expandir.
- ❌ "só carrega quando chove" / "depende do clima" — cliente correlaciona com clima; vale criar sub-categoria ou pelo menos tagar.
- ❌ "celular não pega wi-fi" / "notebook não conecta no wifi" — é S10/S11 mas hoje cai em geral; expandir `SSID|pega\s*(?:no\s*)?wifi|conect[a-z]+\s*(?:no\s*)?wifi`.
- "oscilando" / "fica caindo" — já cobertos em S5.
- ❌ "tá com ping alto" / "tá lagando" — gamers; cai em S4 hoje mas vale tratar (pode ser S5 instabilidade). Adicionar: `/\bping\b|lag(ando|ueando)|laguei/`.

### 9.3 VENDAS
- ❌ "quero aumentar minha velocidade" — upgrade, hoje cobre `/upgrade|mudar\s*(de\s*)?plano/`, mas "aumentar velocidade" não casa direto. Adicionar.
- ❌ "quanto é uma internet aí com vocês" — nova contratação, mas ambíguo; cai em VENDAS/preço ok.
- ❌ "vocês atendem meu bairro" — cobertura, já coberto em `/cobertura|atende.*regi[aã]o|bairro/`. Ok.

### 9.4 CANCELAMENTO
- ❌ "vou sair de vocês" / "quero sair" / "não quero mais de vocês" — hoje cobre "não quero mais" mas não "sair". Adicionar: `/\bsair\s+(?:de\s+)?voc[eê]s|sair\s+daqui\b/`.
- ❌ "vou para a concorrência" — cobertura parcial via "trocar de provedor". Adicionar concorrentes comuns: `/vivo|claro|tim|oi|algar|brisanet|desktop/` (quando combinado com verbo).

### 9.5 HUMANO
- Já é bem coberto. Adicionar: `/atende(nte)?\s+humano|gente\s+de\s+verdade|uma\s+pessoa\s+ai|n[aã]o\s+(quero|é)\s+(bot|rob[oô])/` — algumas já estão em `PEDE_HUMANO_RE`, outras não.

### 9.6 Transição entre intents (frases de "agora eu quero X")
- ❌ "na real" / "pra falar a verdade" / "esquece" / "deixa isso pra lá" — sinais de mudança de intenção. Adicionar em `DEPT_SWITCH_REGEX` ou cross-check.
- "na verdade" / "mas" / "mudei de ideia" — já mencionados no system prompt do orchestrator, mas não em regex. Vale explicitar no regex.

Essa expansão reduz a dependência do LLM e baixa custo.

---

## 10. Plano de implementação sugerido (em fases)

Ordenado por **impacto × esforço**. Cada fase é autônoma — pode ser implementada, validada e parada.

### Fase 1 — Universal parsing de opções (regra #5)
- **Por quê**: a correção mais visível pro cliente. Hoje tem menu de 4 opções sem botão — experiência inconsistente.
- **O que**:
  1. Helper `sendUniversalChoice({ body, options, etapa })` com fallback button → list → texto.
  2. State `pending_choice: { etapa, options, aliases }` salvo a cada opção.
  3. Parser único que trata buttonId / listId / número / texto / áudio (já transcrito).
  4. Migrar `aguardando_padrao_lentidao` como primeira aplicação.
- **Esforço**: 2-3 dias. Tem impacto só em 1 arquivo novo + refator de 1 etapa. Depois progressivo migra as outras.

### Fase 2 — Pergunta de prioridade em intent switch (regra #2)
- **Por quê**: impede troca silenciosa quando cliente investiu no fluxo anterior. Reduz frustração.
- **O que**:
  1. Detectar "investimento no fluxo" via flags já existentes em `dados_coletados` (boleto_enviado, os_aberta, etc.).
  2. Quando `validarIntentComContexto` permite troca **E** há investimento → interceptar, mandar pergunta "X ou Y primeiro?" e salvar `state.dados_coletados.pending_priority_choice = { old, new, investment }`.
  3. Próximo turno: parse da resposta → define fluxo efetivo; o outro vai pra `state.dados_coletados.fluxo_pendente` com TTL.
  4. Quando fluxo atual termina → oferecer retomar o pendente.
- **Esforço**: 3-4 dias. Toca orchestrator + cada agente (pra disparar `oferecer retomar` no término). Requer state novo.

### Fase 3 — Pergunta em multi-intent simultâneo (regra #3)
- **Por quê**: mensagens com 2 intents são raras mas existem. Mesmo mecanismo da Fase 2.
- **O que**:
  1. No orchestrator, detectar `intents[]` com 2 entradas acionáveis com conf ≥ 0.6 em depts diferentes.
  2. Se sim → interceptar, perguntar.
  3. Mesmo mecanismo de `pending_priority_choice` da Fase 2.
- **Esforço**: 1-2 dias (depois que Fase 2 pronta — compartilha infra).

### Fase 4 — Default do questionário via template (regra #6)
- **Por quê**: hoje DEFAULT_SETTINGS minimalista deixa novos tenants com comportamento inconsistente.
- **O que**:
  1. Flag `is_template_source: true` no `workspaces` + `inherited_from_template: true` na `tenantSettings`.
  2. Bruno preenche settings normalmente no workspace dele. Flag marca como source.
  3. `getTenantSettings` fallback: sem linha → copia do template, marca `inherited=true`.
  4. Quando tenant salva pela 1ª vez → `inherited=false`.
  5. UI do questionário mostra badge "valores herdados" quando inherited=true.
- **Esforço**: 2-3 dias. Muda schema + service + UI.

### Fase 5 — Expansão de dizeres (§9)
- **Por quê**: reduz custo (menos chamadas LLM de fallback) e aumenta robustez.
- **O que**: expansões de regex listadas em §9, uma por situação.
- **Esforço**: 1 dia. Isolado, testável rapidamente.

### Fase 6 — Decision table no `validarIntentComContexto` (§8.1)
- **Por quê**: facilita adicionar regras novas sem regressão.
- **O que**: transformar if/else em tabela declarativa + testes.
- **Esforço**: 2 dias. Refactor, requer testes unitários pra não regredir.

### Fase 7 — Fechar gaps de vínculo situação↔questionário (§2, G1)
- **Por quê**: completar o controle do tenant sobre o comportamento.
- **O que**: adicionar chaves novas ao BusinessRules pra F2, F3, F8, F9, S5, S7, S10, S12, C1–C5, C10, C11. Cada uma é um campo simples ou enum. Agentes passam a ler `rules.xxx ?? hardcoded_default`.
- **Esforço**: 4-5 dias (granular — 18 situações × leitura+migração). Pode ser feito incrementalmente conforme tenants demandam customização.

### Fase 8 — Refinos (§8.2 a §8.6)
- Ambiguidade com contexto pro humano, tag grouping na UI, fallback regex no orchestrator, unificação de histórico.
- **Esforço**: 3-4 dias acumulados. Cada um é independente.

---

## 11. Métricas sugeridas pra medir depois

- **Taxa de contenção** (conversas resolvidas sem humano) por departamento e por situação.
- **Taxa de escalação por ambiguidade** por etapa — se uma etapa escala >15% por ambiguidade, regex/LLM precisam evoluir.
- **Tempo até primeira resposta útil** (exclui fillers).
- **Hit-rate regex vs LLM** em etapas de múltipla escolha (ver §8.2).
- **Taxa de troca de intent** por conversa — e quando troca silenciosa vs troca com pergunta de prioridade (depois da Fase 2).
- **Taxa de áudio falhado** (`inputType=audio && content=""`) — pra avaliar qualidade do Whisper.
- **CSAT** por departamento (já existe mecanismo).
- **Custo de IA** por conversa — por tenant, pra Bruno cobrar direito.

Algumas já estão instrumentadas em `sessionMetrics` / `ispMetricsService`. Outras precisam ser adicionadas.

---

## 12. Resumo executivo (pro Bruno)

| Regra do Bruno | Status atual | Gap | Fase sugerida |
|---|---|---|---|
| #1 Lentidão vai pro menu 4 padrões | ✅ funciona | — | — |
| #2 Prioridade do cliente em intent switch | 🟡 troca silenciosa | Não pergunta "X ou Y primeiro" | **Fase 2** |
| #3 Multi-intent na mesma msg | 🟡 escolhe dominante | Não pergunta prioridade | **Fase 3** |
| #4 Áudio funciona | ✅ funciona bem | O1: silent fail sem aviso | Fase 8 |
| #5 Botão + texto + áudio em todas opções | 🟡 botão só em 5 menus | Menu 4-padrões sem botão | **Fase 1** |
| #6 Config do Bruno vira default | ❌ não existe | DEFAULT_SETTINGS minimalista | **Fase 4** |
| Vínculo situação↔questionário | 🟡 17/35 sem regra | Muitas situações hardcoded | Fase 7 (incremental) |
| Robustez de dizeres | 🟡 bom mas incompleto | Gírias e variações PT-BR | Fase 5 (barato) |

Minha recomendação: **Fase 1 + Fase 5** primeiro — são as de melhor razão impacto/esforço e não exigem mudança de schema. **Fase 2 + Fase 3** depois (compartilham infra). **Fase 4** em paralelo se o questionário ainda estiver em construção. **Fase 7** conforme tenants demandam.

Qualquer fase pode virar um card do GitHub ou tarefa isolada. Me diga qual atacar primeiro e eu escrevo a implementação.
