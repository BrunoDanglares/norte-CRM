# Protocolo de Avaliação de Conversas — Agente ISP

> Como medir, de forma repetível, se o agente ISP está atendendo bem — e transformar isso em backlog de melhoria priorizado.
> **Dono:** Bruno · **Tenant avaliador:** ConexãoNet (super-admin) · **Criado:** 2026-06-13 · **Rubrica:** `v1`

---

## 0. Princípio

Hoje o agente é corrigido por **print de bug** (reativo, anedótico). Este protocolo troca isso por método: **cada conversa vira uma ficha de nota multi-dimensional**, gerada por um **LLM-juiz** offline. As fichas agregam → você vê onde mais dói → corrige cirúrgico → re-mede a mesma coorte.

Modelo operacional escolhido (2026-06-13):
- **Juiz automático em 100%** das conversas analisadas.
- **Revisão humana sobre uma fatia estratificada** (todos os reprovados/borderline + amostra dos aprovados pra auditar o próprio juiz).
- **Amostragem cobre todos os tipos** de conversa (retrato fiel antes de focar).

O tenant **ConexãoNet** é o ambiente **super-admin avaliador**: a ferramenta avalia conversas de **qualquer** workspace, mas vive só nesse tenant. Nas tabelas, `workspace_id` = **tenant avaliado**.

---

## 1. A régua — 4 perguntas que toda conversa responde

| # | Pergunta | Bloco | O que captura |
|---|---|---|---|
| 1 | **Entendeu?** | `entendeu` | classificação, intenção, identificação, mudança de assunto, soberania |
| 2 | **Resolveu?** | `resolveu` | resolução real, aderência ao fluxo, ERP, alucinação, coleta, handoff |
| 3 | **Foi fácil pro cliente?** | `experiencia` | esforço, linguagem, canal, tom, FAQ/evasividade |
| 4 | **Foi seguro?** | `seguro` | isolamento, guards de negócio, persistência/auditoria |

---

## 2. Camada A — P0 (erros críticos, reprovam a conversa)

Qualquer ocorrência **reprova a conversa inteira** e a manda **obrigatoriamente** pra fila humana, independente das outras notas.

| Flag | Significado | Como reconhecer |
|---|---|---|
| `bot_mudo` | Estado avançou mas a resposta não saiu | trace de handler produziu texto, mas nenhuma msg `out` correspondente / `parts_sent:0` |
| `alucinacao` | Inventou plano/preço/vencimento/status/ação não confirmados pelo ERP | bot afirma dado que nenhum trace/ERP sustenta |
| `vazou_dado` | Expôs dado de outro cliente/contrato | nome/CPF/contrato que não bate com o titular |
| `cpf_duplicado` | Pediu CPF de novo com cliente já identificado | sessão `identificado=true` e bot repergunta CPF |
| `outbound_sumiu` | Mensagem foi pro cliente mas não está no painel | trace `outbound_sent success=true` sem msg `out` persistida |
| `acao_proibida` | Executou ação que o guard deveria barrar | abriu OS/desbloqueio pra quem o guard veta |
| `resolucao_aparente` | Fechou o protocolo mas o cliente reabriu com o **mesmo** problema | nova conversa/turno com a mesma queixa em < `X`h |
| `ignorou_soberania` | Cliente pediu humano/cancelar e o bot seguiu o roteiro | intenção soberana explícita ignorada |

---

## 3. Camada B — notas 0/1/2 por parâmetro

Cada parâmetro recebe **2 (ok) / 1 (parcial) / 0 (falhou)**, ou **null** quando não se aplica à conversa (ex: `coleta_sem_loop` numa conversa sem coleta). O LLM-juiz dá só esses julgamentos atômicos; **o código faz a matemática** (média do bloco, nota composta, veredito) — assim a rubrica é versionável sem depender da consistência do LLM.

### Bloco `entendeu` (peso 25%)
| Parâmetro | 2 = | 0 = |
|---|---|---|
| `dept` | departamento certo (suporte/financeiro/comercial/cancelamento) | classificou no setor errado |
| `subintent` | sub-intenção/tag certa (S6, F4, C8…) | tag genérica ou errada |
| `identificacao` | identificou via CPF/contrato, usou cache | falhou em identificar quando dava |
| `mudanca_assunto` | captou troca de assunto no meio (cross-sector) | ignorou a virada do cliente |
| `soberania` | respeitou intenção soberana na hora | demorou/ignorou (se grave vira P0 `ignorou_soberania`) |

### Bloco `resolveu` (peso 40%)
| Parâmetro | 2 = | 0 = |
|---|---|---|
| `resolucao_real` | cliente confirmou que resolveu / escalou certo | fechou sem resolver de fato |
| `aderencia_fluxo` | seguiu o trilho determinístico | caiu em IA livre indevida |
| `erp_verdade` | usou ERP como fonte (sem deduzir) | inventou/deduziu dado do cliente |
| `sem_alucinacao` | não prometeu o que não pode | prometeu/afirmou sem base (se grave → P0 `alucinacao`) |
| `coleta_sem_loop` | coletou e validou sem travar | loop/trava na coleta |
| `handoff_hora_certa` | escalou na hora certa + passou resumo | escalou cedo demais / tarde demais / sem contexto |

### Bloco `experiencia` (peso 25%)
| Parâmetro | 2 = | 0 = |
|---|---|---|
| `esforco_cliente` | poucos turnos, sem repetir info | cliente teve que repetir muito |
| `linguagem` | curto, claro, sem markdown quebrado, sem repetir pergunta | longo/confuso/repetitivo |
| `canal_render` | botão/lista/mídia renderizou; leu imagem/áudio | botão virou texto quebrado / mídia ignorada |
| `tom_empatia` | tom adequado ao estado do cliente | robótico com cliente irritado |
| `faq_evasividade` | respondeu o que sabia | evasivo tendo a resposta |

### Bloco `seguro` (peso 10%, + gate via P0)
| Parâmetro | 2 = | 0 = |
|---|---|---|
| `isolamento` | sem mistura de dados entre clientes | (falha → P0 `vazou_dado`) |
| `guards_negocio` | respeitou regras (OS p/ inadimplente, promessa 1×/mês, fidelidade) | (falha → P0 `acao_proibida`) |
| `persistencia` | toda outbound apareceu no painel | (falha → P0 `outbound_sumiu`) |

---

## 4. Nota composta e veredito (código, versionável)

1. **Nota do bloco** = média dos parâmetros não-nulos do bloco, em 0–2 → ×5 → escala **0–10**. Bloco sem nenhum parâmetro aplicável = `null` (sai do cálculo, pesos renormalizam).
2. **Nota geral (0–10)** = média ponderada dos blocos disponíveis: `entendeu 0.25 · resolveu 0.40 · experiencia 0.25 · seguro 0.10`.
3. **Veredito:**
   - `p0_flags` não vazio → **`reprovada`** (nota capada em ≤ 3).
   - senão `confidence < 0.5` → **`revisar`**.
   - senão nota `< 6` → **`revisar`**.
   - senão → **`aprovada`**.
4. **`needs_human`** (vai pra fila de revisão) = `verdict != aprovada` **OU** CSAT do cliente ≤ 3 (mesmo se aprovada — sinal de que o juiz pode ter errado) **OU** sorteado na amostra de auditoria dos aprovados.

> **Versionamento:** mudou peso/critério → bump `protocol_version` (`v1` → `v2`) e re-roda. O histórico antigo fica preservado (chave única por `workspace_id + conversation_id + protocol_version`). CSAT/NPS entram como **sinal cruzado**, nunca como nota.

---

## 5. Fluxo híbrido (quem avalia o quê)

```
TODAS as conversas analisadas (amostra estratificada de TUDO)
        │
        ▼
  LLM-juiz (gpt-4o, offline)  ──→ ficha + nota por conversa → conversation_evaluations
        │
        ├──────────────► REVISÃO HUMANA quando:
        │                  • qualquer P0 / reprovada
        │                  • nota < 6  (revisar)
        │                  • confiança do juiz < 0.5
        │                  • CSAT/NPS baixo ⨯ nota alta do juiz
        │                  • + amostra dos APROVADOS (audita o juiz: pega falso-negativo)
        │
        └──────────────► aprovadas sem flag → só entram nas médias do painel

  Humano confirma/corrige a ficha → marca "vira backlog"
        ▼
  Backlog priorizado por (frequência do parâmetro × gravidade)
        ▼
  Fix cirúrgico → smoke → re-roda o juiz na MESMA coorte (compara antes/depois)
```

A revisão humana não serve só pra pegar bug — serve pra **auditar o juiz**. Por isso uma fração dos *aprovados* também vai pro humano.

---

## 6. Amostragem estratificada

"Amostra de tudo" sem enviesar = cotas por estrato pra que o raro não suma:

| Eixo | Estratos |
|---|---|
| Setor | suporte · financeiro · comercial · **cancelamento** (raro, cota mínima) |
| Outcome | resolvido_bot · assistida · escalada · **abandonada** |
| Canal | Meta · Evolution |
| Satisfação | sem CSAT · CSAT alto · CSAT baixo |

Regra: **cota mínima por estrato** + resto proporcional. (Na F1 o script pega as N mais recentes; estratificação entra na F3/F4.)

---

## 7. Arquitetura

### Tabela `conversation_evaluations`
Uma linha por (conversa avaliada × versão da rubrica). Criada via `runAutoMigrations` (idempotente). Campos principais: `verdict`, `overall_score`, `outcome`, `needs_human`, `p0_flags[]`, `block_scores` (jsonb), `param_scores` (jsonb), `issues` (jsonb), `summary`, `csat_nota`, `model`, `protocol_version`, e campos de revisão humana (`human_reviewed`, `human_verdict`, `human_notes`, `reviewed_by`, `reviewed_at`).

Distinta de `eval_cases / eval_runs / eval_results` (esses são **regressão de casos sintéticos** estilo CI; este é **avaliação de conversa real de produção**).

### Fases
| Fase | O que é | Status |
|---|---|---|
| **F1 — Núcleo do juiz** | Lógica em `server/services/conversationEvaluator.ts` (rubrica/dossiê/juiz/score, **pura, sem banco**) usada pelo CLI `scripts/eval-conversas.ts` e pelo painel — não podem divergir. Gera fichas + `.md` legível | ✅ |
| **F2 — Fila de revisão** | Tab "Avaliações" no painel super-admin (fora do UI dos tenants): lista filtrável → detalhe (transcript × ficha) → confirmar/corrigir veredito. Rotas em `admin.ts` atrás de `requireSuperAdmin` (leitura cross-tenant) | ✅ |
| **F3 — Painel de saúde** | Tab "Saúde do Agente": nota por eixo, top parâmetros que falham, P0, tendência, CSAT, concordância juiz×humano | ✅ |
| **F4 — Avaliar agora** | Botão no painel dispara `startEvaluationJob` (`conversationEvaluatorDb.ts`): avalia **100% das finalizadas** do tenant na janela, em **background** com barra de progresso (rotas `POST /avaliacoes-run` + `GET /avaliacoes-run/:jobId`) | ✅ |
| **F5 — Loop automático** (futuro) | Scheduler/cron + amostragem estratificada + alerta de degradação. NÃO construído (escolha: gatilho manual por botão) | pendente |

---

## 8. Operação (F1)

```bash
# avalia as 15 conversas mais recentes (7 dias) de um tenant, grava fichas + md
tsx --env-file=.env.test scripts/eval-conversas.ts --tenant=conexao --days=7 --limit=15

# por UUID de workspace
tsx --env-file=.env.test scripts/eval-conversas.ts --ws=<uuid> --days=30 --limit=50

# uma conversa específica (debug)
tsx --env-file=.env.test scripts/eval-conversas.ts --conv=3023

# sem gravar no banco (só inspeção)
tsx --env-file=.env.test scripts/eval-conversas.ts --tenant=conexao --dry
```

Flags: `--ws` | `--tenant` (ILIKE no nome) | `--conv` | `--days` | `--limit` | `--min-msgs` | `--model` (default `gpt-4o`) | `--version` (default `v1`) | `--dry` | `--out`.

Chave do juiz (offline, do **avaliador** — não gasta crédito do tenant avaliado): `EVAL_OPENAI_API_KEY` → `OPENAI_API_KEY` → (fallback: chave do tenant avaliado, com aviso). Modelo padrão `gpt-4o` (mais forte que o `gpt-4o-mini` do runtime — qualidade de juiz importa; segue o padrão do `evalJudge.ts`).

---

## 9. Princípios de leitura das fichas

- **Prioridade = frequência × gravidade.** Um P0 raro pode valer menos que um P1 que aparece em 30% das conversas.
- **Veredito ≠ nota.** Uma conversa pode ter nota 8 e ainda ser reprovada por 1 P0.
- **O juiz erra.** Por isso a amostra de aprovados revisada por humano — se o humano discorda muito, ajuste o prompt/rubrica (bump de versão), não só o agente.
- **Compare coortes, não conversas isoladas.** O ganho de um fix se mede re-rodando a mesma janela antes/depois.
