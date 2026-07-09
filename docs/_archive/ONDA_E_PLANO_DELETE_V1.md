# Onda E — Plano de Deleção V1

Status: **PLANEJADO — não executar sem canary deploy**
Última atualização: 2026-05-25

## Por que ainda não deletei

V2 cobre ~75% dos caminhos hoje (Ondas A→D), com Arbitrator V1 como rede de segurança. Deletar V1 prematuramente sem 7-14 dias de telemetria real expõe risco de regressão em casos não cobertos pelos 91 cenários sintéticos.

## Pré-requisitos pra Onda E

Antes de deletar V1, validar em PROD por 14 dias com `ENGINE_DECISION_V2_MODE=on`:

1. **Telemetria mínima**:
   - % de turns com `[DE:V2:primary-pre] ✅ HANDLER_COMPLETE` >= 70%
   - % de turns com `[DE:V2:primary-pre] ⚠️ FALLBACK ARBITRATOR` <= 5%
   - Zero regressões reportadas pelos atendentes em escalações
   - CSAT médio estável ou superior ao período pré-V2
2. **Cobertura dos handlers V2**: 95%+ dos turns identificados resolvidos por handler V2 (não Arbitrator V1)
3. **Onboarding** (caso A: cliente novo sem CPF): V1 ainda decide isso hoje via `phase4CpfDetected` — Onda E precisa decidir entre:
   - (a) deixar V1 cuidar SÓ do onboarding e deletar o resto (híbrido permanente)
   - (b) portar phase4CpfDetected pra handler V2 antes de deletar (mais limpo, mais risco)

## Inventário do que deletar (~16k LOC)

| Arquivo | LOC | Status pós-delete |
|---|---|---|
| `server/services/agents/financeiroAgent.ts` | 3.755 | Migrar `buildDeterministicListing` + `parseTitularidadeResponse` + `TITULARIDADE_CHECKLIST_FIELDS` + `buildTitularidadeChecklistMessage` pra módulos novos (já estão `export`); depois deletar |
| `server/services/agents/suporteAgent.ts` | 5.024 | Inteiro deletável SE Onda E.1 implementar troubleshooting avançado (teste cabo vs Wi-Fi). Senão, manter este SÓ e remover o resto |
| `server/services/agents/comercialAgent.ts` | 3.451 | Após migrar exports usados (handleC7 já consome `parseTitularidadeResponse` / `buildTitularidadeChecklistMessage` / `TITULARIDADE_CHECKLIST_FIELDS`); deletar |
| `server/services/agents/cancelamentoAgent.ts` | 1.008 | Deletar — V2 handleCancelamento cobre 100% |
| `server/services/agents/humanoAgent.ts` | 170 | Deletar — V2 handleHumano cobre |
| `server/services/agents/arbitrator/rules/*` | ~3.000 | Manter SÓ rules que viraram parte do contrato: `01_stateValidatorsEarly` (dedup/recursion), `34_phase4CpfDetected` (CPF detection — se mantiver V1 onboarding) |
| Resto: ~50 rules thin que delegavam pro V1 | — | Deletar (sem caller) |

**Total deletável: ~14.000 LOC** se manter onboarding V1 / **~16.000 LOC** se migrar tudo.

## Sequência de execução (Onda E)

### E.1 — Pré-flight (1 sprint)
- [ ] Implementar troubleshooting suporte avançado V2 (teste cabo, teste Wi-Fi, speedtest analysis) — substitui suporteAgent
- [ ] Portar `buildDeterministicListing` pra `server/services/agents/handlers/financeiro/templates.ts`
- [ ] Portar `parseTitularidadeResponse` + `TITULARIDADE_CHECKLIST_FIELDS` + `buildTitularidadeChecklistMessage` pra `server/services/agents/handlers/comercial/templates.ts`
- [ ] Atualizar imports nos handlers V2 pra usar novos módulos
- [ ] Smoke 91/91 + smoke 46/46 verde

### E.2 — Decisão onboarding
- Opção A (híbrido): manter `phase4CpfDetected` + `handleNovoCliente` + `handleClienteNaoEncontrado` em arquivos próprios; deletar todo o resto do V1
- Opção B (puro): portar essas 3 funções pra `handlers/onboarding/`; deletar tudo

Recomendação: **Opção A** no primeiro momento (menor risco). Migrar pra B em sprint subsequente após validação.

### E.3 — Deleção (1 sprint)
- [ ] Remover arquivos: financeiroAgent.ts, comercialAgent.ts, cancelamentoAgent.ts, humanoAgent.ts, suporteAgent.ts (se E.1 OK)
- [ ] Remover rules thin do Arbitrator (manter 2-3 críticos)
- [ ] Remover ~89 referências a agents V1 no engine
- [ ] Smoke + type-check + boot do servidor sem erros
- [ ] Deploy canary 24h, monitorar logs

### E.4 — Pós-delete
- [ ] Remover env flag `ENGINE_DECISION_V2_MODE` (sempre on agora)
- [ ] Remover bloco V2-FIRST/PRE (V2 vira caminho único)
- [ ] Renomear `runDecisionEngine` → `runEngine` (já não tem V1 pra comparar)
- [ ] Atualizar CLAUDE.md, replit.md, RELATORIO_AGENTES_ISP.md

## Gates de bloqueio

NÃO executar E.3 se:
- Algum smoke falhou após E.1
- Logs de prod tem `FALLBACK ARBITRATOR` > 5% em janela 7d
- Algum atendente reportou regressão funcional
- CSAT caiu > 5% após ativar V2-FIRST

## Rollback

Se algo der errado pós-deleção:
- `git revert` do PR de Onda E
- `ENGINE_DECISION_V2_MODE=off` no .env (volta tudo pra Arbitrator V1)

Pra isso funcionar, **NÃO deletar Arbitrator V1 no mesmo PR** que os agents V1. Fazer em 2 PRs:
- PR 1: delete agents V1 (financeiro/suporte/comercial/cancelamento/humano) — V2 cobre, Arbitrator V1 ainda existe como rede
- PR 2 (após 7d estável): delete Arbitrator V1 rules thin
