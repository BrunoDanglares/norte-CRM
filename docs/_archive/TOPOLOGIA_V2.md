# Topologia V2 — Decision Engine ChatBanana

> Documento de arquitetura do Decision Engine V2 do agente ISP. Define **quem decide o quê**, **o que IA pode/não pode fazer**, **quando enxugar**, e **como julgar casos novos**.
>
> **Audiência:** Bruno (produto), qualquer dev/IA que mexer no agente. Tempo de leitura: 15min.
>
> **Última revisão:** 2026-05-27.

---

## 1. A REGRA DE OURO

**IA nunca DECIDE. IA sempre pode REDIGIR e EXPLICAR.**

Tudo nesse documento deriva dessa regra.

Quando aparecer dúvida sobre "isso deveria ser determinístico ou IA?", volta nessa frase. Se a resposta envolve decidir fluxo, mover dinheiro, abrir OS, comprometer SLA, mudar pipeline — é determinístico. Se envolve escolher como FALAR uma decisão já tomada, explicar uma regra, parafrasear cliente confuso — é IA.

---

## 2. Os 5 papéis do turno

Todo turno do agente passa por 5 papéis. **Cada papel tem dono claro:**

| Papel | Dono | O que faz | Por que |
|---|---|---|---|
| **1. Compreensão** | Híbrido (regex + embeddings + LLM se preciso) | Entender o que cliente está pedindo, mesmo com texto mal formulado, gírias, emoji | Cliente brasileiro não escreve formal. IA ajuda onde regex falha. |
| **2. Decisão** | **DETERMINÍSTICO SOBERANO** | Escolher: qual setor, qual sub-fluxo, qual ação, escalar ou não, qual handler | Multi-tenant, compliance, auditável, custo zero, previsível. |
| **3. Execução** | **DETERMINÍSTICO SOBERANO** | Abrir OS, gerar boleto, registrar promessa, mover pipeline, aplicar tag, persistir sessão | Cliente paga errado se IA decide. Sem exceções. |
| **4. Redação** | Híbrido — template por padrão, IA opcional | Transformar "decisão tomada" em texto natural pro cliente | Template em 95% dos casos. IA em casos longos/emocionais/customizados. |
| **5. Resposta consultiva** | **IA SOBERANA** | Responder pergunta sobre regra/política/serviço quando determinístico não cobre | Camada 9 (`runConsultativeFallback`). Cliente perguntando "por que" → IA explica. |

Toda confusão vem de misturar papéis. Se você sentir "isso não tá funcionando bem", primeiro identifique **em qual dos 5 papéis** o problema está.

---

## 3. Pipeline do turno (visualização)

```
┌─────────────────────────────────────────────────────────────┐
│ Cliente manda mensagem                                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 1: Context Builder                                    │
│  → DecisionContext readonly (50+ campos: ERP, sessão, etc)   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 2: State Validators                                   │
│  → Pode CURTO-CIRCUITAR (welcome, dedup, encerramento, etc)  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 3: RAG (buildEvidencePack)                            │
│  → 7 retrievals em paralelo (L0-L4 + LKB)                    │
│  → Embeddings, FAQ, KB documents, similar outcomes           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 4: Classifiers (papel 1 — compreensão)                │
│  → Absolute rules (regex) + LLM classifier (gpt-4o-mini)     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 5: Resolver (papel 2 — DECISÃO SOBERANA)              │
│  → ~17 steps em sequência → ProposedDecision                 │
│  → action + sector + subFlow + confidence                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 6: Policy Validators                                  │
│  → Pode BLOQUEAR ou TRANSFORMAR (canOpenOS, canTakePause)    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 7: Dispatcher                                         │
│  → Consome ProposedDecision, dispara handler                 │
│  → Persiste sessão (fluxo, cpf, dados)                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Camada 8: Handler (papel 3+4 — EXECUÇÃO + REDAÇÃO)           │
│  → Lê ERP, abre OS/boleto, monta resposta                    │
│  → ~40 handlers (F1-F16, S1-S18, C1-C11)                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
            ┌───────────────┴────────────────┐
            │                                │
            ▼ (action ≠ CONSULTATIVE)        ▼ (action = CONSULTATIVE)
   ┌──────────────────┐         ┌──────────────────────────┐
   │ sendMessage()    │         │ Camada 9: Consultive     │
   │ → cliente recebe │         │ (papel 5 — IA SOBERANA)  │
   └──────────────────┘         │ → FAQ/Quest atalhos      │
                                │ → LLM fallback           │
                                └──────────────────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ Promise Interceptor│
                                   │ (anti-promessa) │
                                   └──────────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ sendMessage()    │
                                   └──────────────────┘
```

**Tempo total típico:** 150-300ms (sem LLM) / 1-3s (com LLM consultive) / 3-5s (LLM consultive + KB rerank).

---

## 4. O que IA PODE fazer

| Papel | Onde | Como |
|---|---|---|
| **Compreender paráfrase** | Embedding classifiers (papel 1) | "internet uma porcaria" → SUPORTE_TECNICO via embedding `crossSector`. Cobre o que regex falha. |
| **Classificar quando regra falha** | LLM classifier (papel 1) | Confidence absolute < 0.7 → gpt-4o-mini decide setor. Reasoning estruturado retornado pro audit. |
| **Reclassificar texto suporte** | `reclassifySuporteText` | "tá lerdo" → S4 vs S5 vs S6 vs S7. Já existe pra SUPORTE. Pode crescer pra FIN/CAN/VEN. |
| **Reescrever template** (opcional) | Rewrite layer (novo) | Handler entrega texto, LLM reescreve em tom da persona. Custo $0.0001. Flag `useLlmRewrite=true` no handler. |
| **Responder consultivo** | Camada 9 (`generateConsultativeAnswer`) | "por que minha fatura mudou?" → LLM com dossier + KB + memory. Anti-alucinação HARD. |
| **Extrair memória de cliente** | `extractMemoryFromConversation` | Pós-close, LLM extrai summary + facts. Inject no system prompt da próxima conversa. |
| **Buscar em KB documents** | `retrieveKb` + rerank LLM | Hybrid search (BM25 + vector), rerank LLM scoring. Plugado no consultive. |
| **Analisar imagem** | `analyzeSpeedtestImage` (vision) | Vision LLM lê velocidade do print. Já existe — pode expandir pra outros prints (LED, comprovante). |
| **Judge eval cases** | `evalJudge` | gpt-4o avalia output do agente em 4 dimensões (correctness, no-hallucination, no-promise, escalation). |
| **Compor FAQ híbrida** | `composeFaqAnswer` | Match parcial → LLM monta texto com fontes do dossier. Validator bloqueia tokens inventados. |

---

## 5. O que IA TEM PROIBIDO de fazer

**LISTA NEGRA — não negociável. Mesmo em fallback total, mesmo com confidence alta, mesmo se LLM "tiver certeza".**

| Proibido | Por quê | Onde está bloqueado |
|---|---|---|
| ❌ Abrir OS / chamado / protocolo | Tenant configurou (q146) ou compliance | `canOpenOSValidator` |
| ❌ Confirmar pagamento sem ERP | Cliente paga errado → escalation reverter | `confirmPayment` é write-tool, não IA |
| ❌ Gerar boleto / registrar promessa | ERP-only operation | Write tools com policy gates |
| ❌ Cancelar contrato | Compliance + retenção | Handler `handleCancelamento`, IA não acessa |
| ❌ Mover pipeline (kanban) | Decisão de negócio | `pipelineStateMachine` |
| ❌ Prometer ação ("vou abrir", "vou consultar", "te retorno em X") | Cliente fica esperando algo que não vem | `Promise Interceptor HARD` |
| ❌ Inventar valor monetário | Hallucination crítica em ISP | `detectFaturaHallucination` |
| ❌ Inventar prazo / SLA | Cliente cobra depois | Validator no FAQ composer |
| ❌ Revelar dados sensíveis (CPF cheio, cartão, senha) | LGPD + tenant config (q157) | `sensitiveDataGuard` em `sendMessage` |
| ❌ Decidir cross-sector swap sem evidência | Cliente em FIN não pode acabar em SUP por chute LLM | Resolver step `crossSectorShift` exige embedding score + threshold |
| ❌ Aplicar oferta de retenção fora do catálogo | Desconto não autorizado | `applyRetentionOffer.canApplyRetention` |
| ❌ Falar "humano" ou "robô" sem checar q5 | Tenant pode preferir "atendente" / "agente virtual" | `personaHeader.identidadeIA` |
| ❌ Dar suporte a equipamento terceiro se q96="Não" | Técnico ia até a casa à toa | `thirdPartyRouterGuard` |

**Regra mnemônica:** se a ação **toca dinheiro, ERP, compliance ou pipeline**, é determinístico. Sem exceções.

---

## 6. Como decidir quando aparecer caso novo

Árvore de decisão pra quando uma nova feature/bug aparecer:

```
Pergunta 1: Isso é DECISÃO (que fluxo, que setor, escalar ou não)?
  └─ SIM → Determinístico (resolver step ou handler condicional)
  └─ NÃO → próxima pergunta

Pergunta 2: Isso é EXECUÇÃO (mexer ERP, abrir OS, gerar boleto, mover pipeline)?
  └─ SIM → Determinístico (tool write + policy gate)
  └─ NÃO → próxima pergunta

Pergunta 3: Isso é COMPREENSÃO de algo que o cliente disse de forma ambígua?
  └─ SIM → Embedding classifier OU LLM classifier (curto, gated)
  └─ NÃO → próxima pergunta

Pergunta 4: Isso é REDAÇÃO de uma decisão já tomada?
  └─ SIM → Template padrão. Se template fica robótico em casos longos, opt-in LLM rewrite.
  └─ NÃO → próxima pergunta

Pergunta 5: Isso é RESPOSTA INFORMATIVA (cliente perguntou algo sobre serviço/regra)?
  └─ SIM → Camada 9 consultive (já existe — só garantir que evidência está plugada)
  └─ NÃO → revisar: provavelmente é decisão disfarçada de outra coisa
```

---

## 7. Critério objetivo pra ENXUGAR

"Enxugar se necessário" só funciona com critério. Sem isso, vira gosto pessoal.

### Embedding catalog → consolidar/matar quando:
- **Match rate < 5%** dos turnos do setor nas últimas 4 semanas, OU
- **Sobreposição > 70%** com outro catalog (co-ocorrência de matches), OU
- **Análise de gaps** mostra falha ≥ 30% dos casos onde deveria detectar

### Resolver step → matar quando:
- Branch `outcome.kind === 'decided'` **nunca retornou true** em 4 semanas, OU
- Quando decide, **outro step posterior sempre teria match equivalente** (medido via shadow do resolver)

### Handler sub-flow → consolidar quando:
- < 3 chamadas/semana em 4 semanas → vira "outros do setor"
- Lógica > 80% duplicada com outro handler → extrair helper comum, fundir

### Absolute rule → manter sempre que:
- Cobre caso onde LLM falha de forma cara (ex: cliente irritado com palavrão → SUPORTE imediato)
- É testável e auditável
- Tem comentário com link pro bug/print que motivou

**Não cortar sem dados. 4 semanas de métricas antes de qualquer corte.**

---

## 8. Espaços onde IA cresce (sem virar centro)

Esses são os pontos onde IA pode crescer sem violar a regra de ouro:

1. **Rewrite layer opcional** (não existe) — handler entrega texto técnico, LLM reescreve em tom persona. Flag por handler.
2. **Reclassifier on confidence baixa** (existe pra suporte, expandir) — confidence < 0.6 não vai pra consultive, vai pra reclassifier LLM rápido.
3. **Memory-aware handler entry** (Onda 2 entrega memória — handler não consome ainda) — handler lê resumo do cliente ANTES de decidir tom.
4. **Planning multi-step** (Onda 5 pendente) — query complexa ("posso trocar plano sem perder desconto?") → LLM planeja sequência de tools.
5. **Vision além de speedtest** — comprovante de pagamento, foto do LED do roteador, foto da fatura. Já tem infra (`visionClient`).
6. **Audit anomaly detection** — LLM analisa traces de turnos e flagga conversas onde decisão pareceu errada.

---

## 9. Anti-padrões conhecidos (já tentamos e falhou)

Esses são caminhos que parecem boa ideia mas **já foram tentados e removidos** no projeto. Não voltar sem evidência forte:

| Anti-padrão | Quando tentamos | Por que falhou |
|---|---|---|
| **LLM como decisor central (V2 tooled)** | 2026-05-03 | LLM prometia ações que não conseguia executar, alucinava valores de fatura, ignorava restrições do tenant |
| **AI Agent piloto** | 2026-05-21 | Custo 5x maior, latência 3-5s adicional, audit impossível |
| **Tool calling como PRIMÁRIO** | 2026-05-26 (rascunho) | Refatorado pra FALLBACK READ-ONLY na Camada 9 |
| **V1 single-file ispAgentEngine.ts (16k LOC)** | Pré-2026-05-26 | Impossível auditar, qualquer mudança gerava regressão. Movido pra `_legacy/`. |
| **Mocks de banco em testes integração** | 2025 | Mock passou, prod quebrou. Hoje testes hitam DB DEV real. |
| **Reset destrutivo de sessão sem audit** | Vários | Cliente em coleta perdia contexto. Hoje session_reset_at é marcado, não apagado. |
| **Simulador sintético do motor V2** | 2026-05-27 | Cada rule/classifier tem 2-5 guards específicos do estado real do cliente (erpData, sessionDados, intent_real_cache). Mockar fielmente = trabalho similar a refatorar o engine. Viés sistemático tornou dados inúteis pra decisão de corte. **Produção real (4 semanas) é mais barata e correta.** |

### Achados de telemetria já confirmados

- **`swap_evaluated` (resolver step) — CORE crítico.** Match rate 97.8% (569/582 calls validados em simulação). É o pulmão do roteamento V2. **Não cortar nunca.**

---

## 10. Decisões arquiteturais já tomadas (registro)

Esse é o histórico de **decisões fundamentais** já cravadas. Mudança requer evidência forte + escrita de novo ADR.

1. **V2 substituiu V1** — `_legacy/ispAgentEngine.ts` arquivado, não consultar como referência de comportamento (só como fonte de paridade quando há dúvida).
2. **Determinístico soberano em decisão/execução** — IA pode propor, nunca executa write sem policy gate.
3. **Pipeline linear de 9 camadas** — não há loops, não há "agente decide quantas vezes rodar". Cada turno = 1 passada.
4. **Estado da sessão é fonte da verdade** — `isp_session_state.dados_coletados` JSONB. Handlers retornam `sessionDadosUpdates`, dispatcher persiste.
5. **Multi-tenant rígido** — toda query filtra por `workspace_id`. Sem exceção.
6. **Tenant config tem 4 níveis de precedência** — `tenant_settings.questionnaire.answers` (literal do gestor) > `businessRules` (traduzido) > `isp_configs` (UI default) > defaults V2.
7. **Audit log obrigatório** — toda tool write passa por `withAuditLog`. Trace `agent_trace_events` por turno.
8. **Promise Interceptor é HARD** — LLM proibido de prometer ação. Detecção + substituição + escalation forçada.
9. **Anti-alucinação em fatura é HARD** — valores monetários inventados são bloqueados antes do envio.
10. **Onda RAG (1-4) entregue** — KB, customer memory, eval suite, write tools controladas. Status em [MEMORY.md](C:/Users/Bruno%20Danglares/.claude/projects/d--ChatBanana/memory/MEMORY.md).

---

## 11. Onde está cada coisa (mapa rápido)

| Arquivo / pasta | Responsabilidade |
|---|---|
| `server/services/agents/runV2Agent.ts` | Entry point — recebe inbound, monta context, persiste session |
| `server/services/agents/runDecisionEngine.ts` | Orquestra 9 camadas |
| `server/services/agents/context/` | Camada 1 — Context Builder |
| `server/services/agents/validators/state/` | Camada 2 — Early + Core state validators |
| `server/services/agents/rag/` | Camada 3 — buildEvidencePack + 7 retrievals |
| `server/services/agents/classifiers/` | Camada 4 — Absolute + LLM + embeddings |
| `server/services/agents/resolver/` | Camada 5 — Decision Resolver + steps |
| `server/services/agents/validators/policy/` | Camada 6 — Policy gates |
| `server/services/agents/dispatcher/` | Camada 7 — Dispatcher |
| `server/services/agents/handlers/` | Camada 8 — Handlers por setor (~40) |
| `server/services/agents/consultative/` | Camada 9 — Consultive fallback + tool calling |
| `server/services/agents/tools/` | Tools reusadas (read/write/send/ai/template/validate) |
| `server/services/agents/helpers/` | Helpers cross-cutting (persona, memory, guards) |
| `server/services/agents/observability/` | Trace V2 logger |
| `server/services/agents/procedures/` | Catálogo S1-S18, F1-F16, C1-C11 |
| `server/services/tenantKnowledge.ts` | Consolida tenant settings em bundle |
| `server/services/writeTools/` | Onda 4 — write actions com SAFE mode |
| `shared/schema.ts` | Schema canônico (Drizzle) |
| `server/index.ts` | Boot + auto-migrations + scheduler |
| `_legacy/` | V1 arquivado — referência, não modificar |
| `MEMORY.md` (auto-memory) | Histórico de decisões e estado do projeto |

---

## 12. Como esse documento deve evoluir

- **Toda decisão arquitetural nova** → adicionar entrada na seção 10
- **Toda mudança de papel (IA ↔ determinístico)** → atualizar seção 2 + adicionar na 5 (proibido) ou 4 (permitido)
- **Todo anti-padrão tentado e descartado** → adicionar na seção 9
- **Toda métrica de "enxugar"** → registrar critério na seção 7

Quem mexer no agente sem ler esse documento vai introduzir regressão. Mantenha-o atualizado.

---

**Próximo passo concreto recomendado:**

1. Plugar métricas (contador) por embedding catalog e resolver step
2. Esperar 4 semanas de dados
3. Aplicar critério da seção 7 → consolidar 20 embeddings → ~12, matar 4-5 resolver steps mortos
4. Documentar 1 página por handler (referência rápida)
5. Avaliar Onda 5 (planning multi-step) — único caminho onde IA cresce sem virar centro
