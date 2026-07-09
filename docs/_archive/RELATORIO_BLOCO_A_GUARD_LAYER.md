# Relatório — Bloco A: Guard Layer, IntentVector e Fluid Routing

**Data:** 09/04/2026
**Projeto:** ChatBanana CRM — Rede ConexaoNet (SGP ERP)
**Escopo:** Motor ISP autônomo — camada de proteção, roteamento multi-intent e transições fluidas

---

## 1. Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `server/services/agents/guardLayer.ts` | Camada de validação que intercepta action tags da IA antes de executar |
| `server/services/agents/priorityResolver.ts` | Resolvedor de prioridade entre múltiplos intents detectados |

## 2. Arquivos modificados

| Arquivo | O que mudou |
|---------|-------------|
| `server/services/agents/orchestrator.ts` | System prompt retorna vetor de intents (até 3); parsing multi-intent; `getIntentVector()` |
| `server/services/agents/types.ts` | `BusinessRules` ganhou `agent_priorities` e `fluid_routing_threshold`; `AgentInput` ganhou `contextoAdicional`; `AgentResponse` ganhou `redirectTo` e `guardFeedback` |
| `server/services/agents/index.ts` | Novos exports: `runGuardLayer`, `parseActionTags`, `resolveIntent`, `buildIntentContext`, `getIntentVector`, `IntentVector` |
| `server/services/ispAgentEngine.ts` | `avaliarSwap()`, `handleComGuard()`, `logGuardEvent()`; substituição do `validarIntentComContexto` por fluid routing; dispatch com Guard Layer |
| `shared/schema.ts` | `TenantSettingsJson.businessRules` ganhou `agent_priorities?` e `fluid_routing_threshold?` |

---

## 3. Guard Layer (`guardLayer.ts`)

### O que faz
Intercepta a resposta textual da IA, extrai action tags no formato `[TAG:param1:param2]` e valida cada uma contra regras de negócio do tenant.

### 3 tipos de resultado
- **allow** — ação aprovada, segue normal
- **block** — ação proibida, devolve feedback para a IA reformular
- **redirect** — ação proibida E requer outro agente (ex: inadimplente tentando abrir OS → financeiro)

### 6 validators implementados

| Tag | Validação |
|-----|-----------|
| `DESBLOQUEAR` | Verifica: allowTrustUnlock habilitado, contrato identificado, máx 2 promessas ativas |
| `SEGUNDA_VIA` | Exige ID da fatura no comando |
| `PAGAR_VIA` | Verifica se PIX ou boleto está habilitado no tenant |
| `ABRIR_OS` | Verifica: allowAutoOpenTicket habilitado; se inadimplente → redirect para FINANCEIRO |
| `PROMESSA_PAGAMENTO` | Exige contrato identificado |
| `VERIFICAR_COBERTURA` | Exige endereço (rua) no comando |

---

## 4. IntentVector e Priority Resolver (`priorityResolver.ts` + `orchestrator.ts`)

### Antes
O orquestrador retornava 1 intent com 1 confidence. Decisão binária.

### Agora
O orquestrador retorna um **vetor de até 3 intents**, cada um com confidence e action:
```json
{
  "intents": [
    { "intent": "CANCELAMENTO", "confidence": 0.85, "action": "INICIAR_RETENCAO" },
    { "intent": "SUPORTE_TECNICO", "confidence": 0.6, "action": null },
    { "intent": "FINANCEIRO", "confidence": 0.4, "action": null }
  ],
  "fluxo": "cancelamento"
}
```

### Tabela de prioridade padrão
| Prioridade | Intent |
|------------|--------|
| 1 (máxima) | HUMANO |
| 2 | CANCELAMENTO |
| 3 | FINANCEIRO |
| 4 | SUPORTE_TECNICO / INCIDENTE_REGIONAL |
| 5 | VENDAS |
| 6 | GERAL |

- `resolveIntent()` — resolve o intent vencedor cruzando prioridade de negócio × confidence
- `buildIntentContext()` — gera string com intents secundários para enriquecer o prompt do agente
- Tenant pode sobrescrever prioridades via `agent_priorities` nas configurações

### Backward compatibility
- `DecisaoIA` continua sendo o tipo de retorno principal
- O `IntentVector` fica anexado via `_intentVector` e acessível por `getIntentVector(decisao)`
- Fallback gracioso: se a IA retornar formato antigo (1 intent), o parser monta vetor com 1 elemento

---

## 5. Fluid Routing (`avaliarSwap` em `ispAgentEngine.ts`)

### Antes
`validarIntentComContexto()` — validador rígido com múltiplas condições hardcoded (filler, confidence < 0.7, keyword match, etc).

### Agora
`avaliarSwap()` — decisão simples e configurável:

| Condição | Resultado |
|----------|-----------|
| `allowDepartmentSwitch = false` | Nunca troca |
| Sem fluxo ativo / TRIAGEM / GERAL | Sempre troca |
| Mesmo intent | Não troca (já está lá) |
| Intent = HUMANO | Sempre troca |
| Confidence >= threshold (default 0.65) | Troca com mensagem de transição |
| Abaixo do threshold | Mantém fluxo atual |

### Mensagem de transição
Quando o cliente muda de assunto com confidence suficiente:
> "Entendido! Vou te ajudar com financeiro. Se precisar retomar o assunto de suporte técnico, é só avisar."

Enviada automaticamente ANTES da resposta do agente destino.

### Configurável por tenant
- `fluid_routing_threshold` — default 0.65 (editável nas configurações)
- `agent_priorities` — objeto de overrides (ex: `{ "VENDAS": 2 }` para priorizar vendas)

---

## 6. handleComGuard — Wrapper de proteção no dispatch

### Fluxo
```
agente.handle(input)
     ↓
runGuardLayer(resposta, actionCtx)
     ↓
  allow?  → retorna resposta
  block?  → reinjecta feedback no contexto, tenta de novo (máx 2 retries)
  redirect? → retorna para o motor re-despachar ao agente correto
  esgotou retries? → resposta segura genérica
```

### ActionContext montado antes do dispatch
```
tenant: { allowTrustUnlock, allowPix, allowBarcode, allowAutoOpenTicket, allowDepartmentSwitch }
client: { contractId, status, activePromises }
workspaceId
```

### Agentes protegidos
- financeiroAgent
- suporteAgent
- comercialAgent

**humanoAgent** — NÃO protegido (não gera action tags)

---

## 7. Log estruturado

Cada bloqueio ou redirect do Guard Layer é salvo em `isp_automation_logs`:

| Campo | Valor |
|-------|-------|
| `automationType` | `GUARD_BLOCK` ou `GUARD_REDIRECT` |
| `customerPhone` | telefone do cliente |
| `messagePreview` | `action=TAG redirect=AGENTE tentativa=N` |
| `channel` | `guard_layer` |
| `success` | `true` para redirect, `false` para block |

---

## 8. Pipeline completo (resumo visual)

```
Mensagem do cliente
     ↓
decidirProximoPasso() → IntentVector [até 3 intents]
     ↓
resolveIntent() → intent vencedor (prioridade × confidence)
     ↓
avaliarSwap() → swap sim/não (threshold configurável)
     ↓
  swap sim → atualiza fluxo, envia mensagem de transição
  swap não → mantém fluxo atual, intent secundário como contexto
     ↓
handleComGuard(agente, input, actionCtx)
     ↓
  agente.handle() → resposta
     ↓
  runGuardLayer() → valida action tags
     ↓
  allow → envia resposta
  block → retry com feedback (máx 2)
  redirect → re-despacha para agente correto
```

---

## 9. Cenários de teste esperados

| # | Cenário | Comportamento esperado |
|---|---------|----------------------|
| 1 | Cliente pede desbloqueio, `allowTrustUnlock=false` | Guard bloqueia, IA reformula oferecendo pagamento |
| 2 | Cliente em suporte pede "quero ver meu boleto" | Fluid routing troca para financeiro com mensagem de transição |
| 3 | "Quero cancelar porque tô sem internet e não tenho dinheiro" | Intent = CANCELAMENTO (P2), SUPORTE e FINANCEIRO como contexto secundário |
| 4 | Áudio com "saber do meu boleto" | input_type=audio, FINANCEIRO detectado, resposta sem lista numerada |

---

## 10. Sem breaking changes

- `validarIntentComContexto` preservada no código (não deletada, apenas não chamada)
- `DecisaoIA` continua como tipo de retorno — todo código existente funciona
- Campos novos em `BusinessRules` são opcionais com defaults
- Sem migration de banco necessária (campos JSONB auto-suportados)
