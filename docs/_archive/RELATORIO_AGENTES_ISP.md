# Relatório Completo — Agentes de Atendimento ISP (ChatBanana)

**Data:** 08/04/2026  
**Versão:** Engine v3 (direct-openai-only)  
**ERP:** SGP (Rede ConexaoNet)

---

## 1. Arquitetura Geral

```
                  ┌───────────────────────────────────────┐
                  │        ispAgentEngine.ts (4213 linhas) │
                  │         Motor principal do bot ISP     │
                  └───────┬───────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────────┐
        │                 │                     │
  ┌─────▼─────┐   ┌──────▼──────┐     ┌────────▼────────┐
  │ Triagem   │   │Orchestrator │     │ State Manager   │
  │(inline)   │   │(AI + regex) │     │ (sessão/memória)│
  └─────┬─────┘   └──────┬──────┘     └─────────────────┘
        │                │
        ▼                ▼
  ┌──────────────────────────────────────────────┐
  │           Agentes Especializados             │
  ├──────────────┬────────────┬─────────┬────────┤
  │ Financeiro   │ Suporte    │Comercial│ Humano │
  │ (378 linhas) │(295 linhas)│(275 l.) │(98 l.) │
  └──────────────┴────────────┴─────────┴────────┘
        │                │           │
        ▼                ▼           ▼
  ┌──────────────────────────────────────────┐
  │         Serviços Internos                │
  │ n8nAiService   n8nErpService             │
  │ n8nSendService n8nMemoryService          │
  │ tenantSettingsService serviceHours       │
  └──────────────────────────────────────────┘
```

---

## 2. Setores/Agentes Existentes

### 2.1 Triagem (inline no ispAgentEngine.ts)
- **Tipo:** Lógica embutida no motor principal (não é um agente separado)
- **Função:** Identificar se é cliente novo ou existente → coletar CPF → encaminhar para departamento
- **Fluxos:**
  - `TRIAGEM` — pergunta "Já é cliente?" (botões: Já sou cliente / Quero contratar)
  - `AGUARDANDO_CPF` — aguarda CPF/CNPJ do cliente existente
  - `AGUARDANDO_DEPARTAMENTO` — exibe menu de departamentos
  - `MULTIPLOS_CONTRATOS` — cliente com mais de um contrato, pede seleção

### 2.2 Financeiro (`financeiroAgent.ts` — 378 linhas)
- **Classe:** `FinanceiroAgent`
- **Prompt AI:** `agente_financeiro` (890 chars no DB)
- **Sub-fluxos:** `faturas` e `desbloquear`
- **Ações programáticas:**
  - `[SEGUNDA_VIA:id_fatura]` — gera segunda via de boleto/PDF
  - `[PAGAR_VIA:BOLETO|PIX]` — define forma de pagamento
  - `[PROMESSA_PAGAMENTO:cpf:contrato]` — registra promessa de pagamento
  - `[DESBLOQUEAR:id_cliente:contrato]` — desbloqueia conexão
- **Etapas:** `listando_faturas`, `forma_pagamento_escolhida`, `boleto_enviado`, `promessa_registrada`, `desbloqueio_realizado`, `aguardando_desbloqueio`, `atendimento_financeiro`

### 2.3 Suporte Técnico (`suporteAgent.ts` — 295 linhas)
- **Classe:** `SuporteAgent`
- **Prompts AI:** `agente_suporte_offline` e `agente_suporte_online` (selecionado por status ONU)
  - Template DB: `agente_suporte_tecnico_v2` (795 chars)
- **Sub-fluxos:** `sem_internet` e `lento`
- **Ações programáticas:**
  - `[ABRIR_OS:contrato:assunto:descricao]` — abre ordem de serviço no ERP
- **Lógica programática (pré-IA):**
  - **ONU OFFLINE + allowAutoOpenTicket:** Abre OS automaticamente, sem passar pela IA
  - **ONU ONLINE + requireRebootStep:** Instrui reinício de roteador programaticamente
- **Etapas:** `troubleshooting_reinicio`, `troubleshooting_offline`, `troubleshooting_sem_internet`, `troubleshooting_lento`, `os_aberta`, `os_falhou_escalar`

### 2.4 Comercial/Vendas (`comercialAgent.ts` — 275 linhas)
- **Classe:** `ComercialAgent`
- **Prompt AI:** `agente_vendas` (2325 chars no DB)
- **Sub-fluxos:** `nova_instalacao`, `upgrade`, `duvidas`
- **Ações programáticas:**
  - `[VERIFICAR_COBERTURA:rua:bairro:cidade]` — consulta cobertura no ERP
- **Integração tenant:** Carrega planos comerciais de `tenantSettings.plans` e injeta como `planos_catalogo` no contexto da IA
- **Etapas:** `coletando_endereco`, `cobertura_verificada`, `planos_apresentados`, `sem_cobertura`, `avaliando_upgrade`, `respondendo_duvidas`, `atendimento_comercial`

### 2.5 Cancelamento (inline no ispAgentEngine.ts)
- **Tipo:** Tratado inline no motor + prompt AI `agente_cancelamento` (726 chars)
- **Não tem agente dedicado** — a IA gera resposta diretamente via `n8nAiService.gerarResposta`
- **Mecanismos especiais:**
  - `TRANSFERIR_HUMANO` na resposta IA → escala para atendente
  - `TRANSFERIR_COMERCIAL` na resposta IA → transfere para agente comercial (retenção)
  - **Regra absoluta:** Se `intent_pre_cpf === 'CANCELAMENTO'`, pula menu de departamentos e vai direto

### 2.6 Humano (`humanoAgent.ts` — 98 linhas)
- **Classe:** `HumanoAgent`
- **Função:** Transferir para atendente humano
- **Sem IA** — resposta fixa programática
- **Métodos:**
  - `handle()` — gera resumo (handoff summary) e seta `fluxo_atual: 'HUMANO'`
  - `handleReturn()` — detecta comandos de saída (`menu`, `voltar`, `bot`, etc.) para retornar ao bot
- **Resumo inclui:** CPF, último assunto, departamento, problema suporte, boleto enviado, OS aberta

### 2.7 Incidente Regional (inline)
- **Prompt AI:** `agente_incidente_regional` (305 chars)
- **Tipo:** Intent classificada pelo orchestrator quando múltiplos clientes afetados
- **Tratamento:** Inline no motor via IA

### 2.8 Cliente Não Encontrado (inline)
- **Prompt AI:** `cliente_nao_encontrado` (230 chars)
- **Tipo:** Resposta quando busca no ERP não encontra o CPF

---

## 3. Prompts do Sistema

### 3.1 Tabela `ai_prompt_templates` (prompts editáveis por workspace)

| name | description | ativo | tamanho |
|------|------------|-------|---------|
| `agente_cancelamento` | Agente de retenção para clientes que querem cancelar | ✅ | 726 chars |
| `agente_financeiro` | Template atualizado | ✅ | 890 chars |
| `agente_incidente_regional` | Agente para incidentes de rede | ✅ | 305 chars |
| `agente_orquestrador` | Orquestrador conversacional — mensagens de transição | ✅ | 1076 chars |
| `agente_suporte_tecnico_v2` | Suporte técnico com troubleshooting guiado | ✅ | 795 chars |
| `agente_vendas` | Agente comercial para vendas, upgrades e novos planos | ✅ | 2325 chars |
| `cliente_nao_encontrado` | Resposta quando cliente não é encontrado no ERP | ✅ | 230 chars |

### 3.2 Tabela `ia_prompts` (prompts legados, não usados pelo ISP)

| slug | nome | modelo | temp | max_tokens | ativo |
|------|------|--------|------|------------|-------|
| `atendimento` | Atendimento WhatsApp | gpt-4o-mini | 0.70 | 1000 | ✅ |
| `followup` | Follow-up Automático | gpt-4o-mini | 0.80 | 500 | ✅ |
| `qualificacao` | Qualificação de Leads | gpt-4o-mini | 0.20 | 100 | ✅ |

### 3.3 Prompt do Orquestrador (hardcoded em `orchestrator.ts`)

Prompt completo (System Prompt da IA de classificação):

```
Você é o cérebro de roteamento de um provedor de internet (ISP).
Analise a mensagem do cliente junto com o contexto e decida o próximo passo.

Responda APENAS em JSON válido:
{
  "intent": "FINANCEIRO" | "SUPORTE_TECNICO" | "VENDAS" | "CANCELAMENTO" | "INCIDENTE_REGIONAL" | "HUMANO" | "GERAL",
  "fluxo": "financeiro" | "suporte" | "comercial" | "cancelamento" | "humano" | "triagem",
  "acao": string | null,
  "confidence": 0.0-1.0
}

Regras de INTENT:
- FINANCEIRO: boleto, fatura, pagamento, pix, segunda via, desbloqueio, conta, débito, devendo, suspenso...
- SUPORTE_TECNICO: sem internet, lento, caiu, offline, wifi, roteador, conexão, velocidade, sinal...
- VENDAS: contratar, planos, preços, upgrade, instalação, cobertura, comercial...
- CANCELAMENTO: cancelar, desistir, trocar de provedor, não quero mais...
- INCIDENTE_REGIONAL: queda em massa, problema geral na região...
- HUMANO: quer falar com pessoa, atendente, transferir
- GERAL: cumprimento genérico, mensagem ambígua

Ações por intent:
- FINANCEIRO: LISTAR_FATURAS, GERAR_BOLETO, GERAR_PIX, DESBLOQUEAR, PROMESSA_PAGAMENTO
- SUPORTE_TECNICO: DIAGNOSTICAR, ABRIR_OS, REINICIAR_ONU
- VENDAS: VERIFICAR_COBERTURA, LISTAR_PLANOS, UPGRADE
- CANCELAMENTO: INICIAR_RETENCAO

Regras de reclassificação:
- SUSPENSO + pediu suporte → reclassifica para FINANCEIRO
- Mensagens curtas SEM fluxo anterior → GERAL, confidence=0.3
- Mensagens curtas COM fluxo anterior → manter intent, confidence=0.7
```

---

## 4. Regras de Roteamento

### 4.1 Fluxo Principal (ispAgentEngine.ts)

```
[Mensagem recebida]
    │
    ├── Sessão stale (>4h)? → Reset
    │
    ├── Fluxo HUMANO ativo? → humanoAgent.handleReturn()
    │
    ├── Triagem (cliente novo vs existente)
    │     ├── Novo → VENDAS direto (sub=nova_instalacao)
    │     └── Existente → Aguardar CPF
    │
    ├── CPF recebido → Busca ERP
    │     ├── Não encontrado → cliente_nao_encontrado
    │     └── Encontrado → Múltiplos contratos? → Seleção
    │                         └── Contrato único → Menu departamento
    │
    ├── Seleção de departamento (botões interativos)
    │     ├── Financeiro → Sub-menu (Faturas / Desbloqueio)
    │     ├── Suporte → Direto para agente
    │     ├── Comercial → Sub-menu (Upgrade / Dúvidas)
    │     └── Cancelamento → Direto para agente
    │
    ├── Regras de bypass (pré-departamento):
    │     ├── Suspenso + suspendedToFinance=true → Financeiro direto
    │     ├── Keywords FINANCIAL_ABSOLUTE → Financeiro direto
    │     ├── Keywords COMMERCIAL_ABSOLUTE → Comercial direto
    │     └── Cancelamento intent_pre_cpf → Cancelamento direto
    │
    ├── Troca de departamento (DEPT_SWITCH_REGEX):
    │     └── "quero ir pro financeiro" → muda fluxo
    │
    ├── Classificação IA (orchestrator.decidirProximoPasso)
    │     └── Validação (validarIntentComContexto)
    │           ├── Troca explícita → Permitir
    │           ├── Mesmo fluxo → Manter
    │           ├── Filler em fluxo ativo → Bloquear
    │           ├── Confiança < 0.7 → Bloquear
    │           ├── Confiança ≥ 0.7 + keyword forte → Permitir
    │           ├── Confiança ≥ 0.8 → Permitir
    │           └── Sem sinal forte → Bloquear
    │
    └── Despacho para agente
          ├── FINANCEIRO → financeiroAgent.handle()
          ├── SUPORTE_TECNICO → suporteAgent.handle()
          ├── VENDAS → comercialAgent.handle()
          ├── CANCELAMENTO → inline (IA + lógica de retenção)
          ├── HUMANO → humanoAgent.handle()
          └── GERAL/TRIAGEM → IA genérica
```

### 4.2 Regras de Negócio Dinâmicas (BusinessRules via tenant_settings)

| Regra | Default | Efeito |
|-------|---------|--------|
| `confidenceThreshold` | 0.7 | Limiar de confiança para roteamento (mapeado para `confThreshold = max(valor-0.15, 0.3)`) |
| `suspendedToFinance` | true | Cliente suspenso redireciona automaticamente para Financeiro |
| `allowPix` | true | Habilita PIX como opção de pagamento |
| `allowBarcode` | true | Habilita código de barras / boleto |
| `showOnlyOverdueIfSuspended` | true | Mostra apenas faturas vencidas quando suspenso |
| `allowTrustUnlock` | false | Permite desbloqueio temporário por promessa de pagamento |
| `allowAutoOpenTicket` | true | Abre OS automaticamente quando ONU está offline |
| `requireRebootStep` | true | Exige etapa de reinício antes do suporte técnico |
| `allowDepartmentSwitch` | true | Permite troca de departamento durante atendimento |

### 4.3 Keywords de Roteamento (Regex)

**FINANCEIRO:**
```
/\b(pagar|boleto|fatura|pix|2ª via|segunda via|cobrança|débito|parcela|pagamento|
vencimento|dívida|valor|conta|atraso|pendência|devendo|bloqueado|suspenso|cortaram|
desbloq|liberar|financeiro)\b/i
```

**SUPORTE_TECNICO:**
```
/\b(sem internet|caiu|offline|sem conexão|não conecta|lento|lentidão|devagar|
oscilando|instável|queda|travando|velocidade baixa|wifi fraco|sinal fraco|
suporte|técnico|luz vermelha|roteador apagado)\b/i
```

**VENDAS:**
```
/\b(plano|upgrade|mudar plano|instalação|nova instala|contratar|assinar|
preço|quanto custa|tabela|comercial)\b/i
```

**CANCELAMENTO:**
```
/\b(cancelar|cancela|cancelamento|desist|fechar contrato|não quero mais|
vou trocar|trocar de provedor)\b/i
```

**HUMANO:**
```
/\b(humano|atendente|pessoa|falar com alguém|me transfer|passme pra)\b/i
```

**TROCA DE DEPARTAMENTO:**
```
/\b(quero ir pro|me transfere para|falar com o setor)
  (financeiro|comercial|suporte|técnico|vendas|cancelamento)\b/i
```

---

## 5. Estruturas de Menu (Botões Interativos)

### 5.1 Menu de Departamentos (WhatsApp Buttons)
```
Texto: "Como posso te ajudar hoje? 😊
Pra *cancelamento*, digite "cancelar".
Pra *encerrar*, digite "encerrar"."

Botões:
  [🎯 Comercial]     → COMERCIAL_DEPT
  [💰 Financeiro]    → FINANCEIRO_DEPT
  [🔧 Suporte]       → SUPORTE_DEPT
```
> Nota: Cancelamento não aparece como botão (máx 3 botões WhatsApp) — instruído por texto

### 5.2 Sub-menu Financeiro
```
Botões:
  [📄 Minhas faturas]  → FINANCEIRO_FATURAS
  [🤝 Desbloqueio]     → FINANCEIRO_DESBLOQUEAR
```

### 5.3 Sub-menu Comercial
```
Botões:
  [⚡ Melhorar Plano]  → COMERCIAL_UPGRADE
  [❓ Dúvidas]          → COMERCIAL_DUVIDAS
```

### 5.4 Todos os Button IDs reconhecidos
```
FINANCEIRO_DEPT, SUPORTE_DEPT, COMERCIAL_DEPT, CANCELAMENTO_DEPT
FINANCEIRO_DESBLOQUEAR, FINANCEIRO_FATURAS, FINANCEIRO_HUMANO
SUPORTE_SEMINTERNET, SUPORTE_LENTIDAO, SUPORTE_HUMANO
COMERCIAL_UPGRADE, COMERCIAL_COBERTURA, COMERCIAL_DUVIDAS
MENU_ANTERIOR, MENU_ANTERIOR_DEPT
1, 2, 3, 4 (números como atalho)
```

### 5.5 Mapeamento de Números para Departamentos
```
1 → VENDAS (Comercial)
2 → FINANCEIRO
3 → SUPORTE_TECNICO
4 → CANCELAMENTO
```

---

## 6. Lógica de Estado / Sessão

### 6.1 SessionState (types.ts)
```typescript
interface SessionState {
  fluxo_atual: string | null;       // FINANCEIRO, SUPORTE_TECNICO, VENDAS, etc.
  etapa: string | null;             // forma_pagamento_escolhida, os_aberta, etc.
  ultima_intencao: string | null;   // último intent classificado
  cliente_identificado: boolean;
  cpf: string | null;
  contrato_id: string | null;
  cliente_nome: string | null;
  cliente_id_erp: string | null;
  dados_coletados: Record<string, any>;  // bag de dados dinâmico
  orquestrador: OrchestratorMeta;
}
```

### 6.2 OrchestratorMeta
```typescript
interface OrchestratorMeta {
  ultimo_fluxo: string | null;
  prioridade: string;          // 'normal' | 'alta'
  ultima_confianca: number;    // 0-1
  ultimo_agente: string | null;
  mudou_intencao: boolean;
  historico_intencoes: string[];  // últimos 10 intents
  total_trocas: number;
}
```

### 6.3 Dados Coletados (campos dinâmicos em `dados_coletados`)
```
tipo_cliente: 'novo' | 'existente'
aguardando_triagem: boolean
departamento_selecionado: string
intent_pre_cpf: string
intent_auto_detected: boolean
sub_financeiro: 'faturas' | 'desbloquear'
sub_comercial: 'nova_instalacao' | 'upgrade' | 'duvidas'
problema_suporte: 'sem_internet' | 'lento' | 'outro'
suporte_interacoes: number
regra_global_aplicada: boolean
onu_status: 'online' | 'offline'
etapa_troubleshooting: string
boleto_enviado: boolean
pix_enviado: boolean
promessa_registrada: boolean
os_aberta: boolean
os_id: string
os_protocolo: string
cobertura_verificada: boolean
cobertura_disponivel: boolean
cobertura_bairro: string
cobertura_cidade: string
cancelamento_absolute_redirect: boolean
financial_absolute_redirect: boolean
mudou_intencao: boolean
fluxo_anterior_real: string
motivo_humano: string
resumo_conversa: string
```

### 6.4 Timeouts e Reset
- **Sessão stale:** 4 horas (`SESSION_STALE_MS = 4 * 60 * 60 * 1000`)
- **Triagem timeout:** 10 minutos (se triagem pendente por >10min, re-exibe opções)

---

## 7. Tabelas do Banco de Dados

| Tabela | Função | Campos-chave |
|--------|--------|-------------|
| `isp_session_state` | Estado da sessão do bot por conversa | conversation_id, fluxo_atual, dados_coletados (JSONB), identificado, cpf, ultimo_intent |
| `conversation_turns` | Histórico de mensagens (user/assistant) | conversation_id, role, content, intent |
| `ai_prompt_templates` | Templates de prompt editáveis por workspace | workspace_id, name, system_prompt, is_active |
| `ia_prompts` | Prompts legados (não ISP) | slug, prompt, modelo, temperatura |
| `ia_prompt_historico` | Histórico de edições de prompts | prompt_id (FK) |
| `tenant_settings` | Configurações por tenant (regras, planos, horários) | tenant_id, settings_json (JSONB) |
| `isp_configs` | Configuração do provedor ISP | company_name, erp_type, sgp_url, etc. |
| `isp_payment_promises` | Promessas de pagamento registradas | — |
| `isp_unlock_logs` | Logs de desbloqueio | — |
| `isp_support_tickets` | Tickets de suporte | — |
| `isp_billing_logs` | Logs de cobrança automática | — |
| `isp_automation_logs` | Logs de automação | — |
| `disponibilidade` | Disponibilidade de horário de atendentes | — |

---

## 8. Endpoints de API

### 8.1 ISP Agent (`/api/isp/...`)

| Método | Rota | Função |
|--------|------|--------|
| POST | `/api/isp/ai` | Gera resposta IA usando prompt_name + contexto |
| POST | `/api/isp/ai/seed` | Popula templates padrão para o workspace |
| POST | `/api/isp/ai/classify-intent` | Classifica intenção de uma mensagem |
| GET | `/api/isp/ai/templates` | Lista todos os templates de prompt |
| PUT | `/api/isp/ai/templates/:name` | Atualiza template específico |
| GET | `/api/isp/agent/prompts` | Lista prompts do agente (igual ai/templates) |
| POST | `/api/isp/agent/prompts` | Cria/atualiza prompt do agente |
| POST | `/api/isp/agent/prompts/seed` | Seed de templates padrão |
| POST | `/api/isp/agent/test` | Testa o agente com uma mensagem manual |

### 8.2 Tenant Settings (`/api/tenant-settings/...` e `/api/admin/tenant-settings/...`)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/tenant-settings` | Retorna configurações do tenant logado |
| PUT | `/api/tenant-settings` | Atualiza configurações do tenant logado |
| GET | `/api/admin/tenant-settings/:tenantId` | Admin: retorna config de qualquer tenant |
| PUT | `/api/admin/tenant-settings/:tenantId` | Admin: atualiza config |
| POST | `/api/admin/tenant-settings/:tenantId/reset` | Admin: reseta para padrões |

### 8.3 Memória/Sessão (`/api/isp/memory/...`)

| Método | Rota | Função |
|--------|------|--------|
| POST | `/api/isp/memory/save` | Salva turn no histórico |
| GET/POST | `/api/isp/memory/session` | Recupera/cria sessão |
| POST | `/api/isp/send` | Envia mensagem (texto, lista, botões) |

---

## 9. Arquivos Relevantes — Inventário Completo

| Arquivo | Linhas | Descrição |
|---------|--------|-----------|
| `server/services/ispAgentEngine.ts` | 4213 | Motor principal do ISP bot |
| `server/services/agents/types.ts` | 226 | Interfaces: SessionState, BusinessRules, AgentInput, AgentResponse, etc. |
| `server/services/agents/orchestrator.ts` | 419 | Classificação de intent via IA + validação com contexto |
| `server/services/agents/financeiroAgent.ts` | 378 | Agente financeiro (faturas, PIX, boleto, desbloqueio) |
| `server/services/agents/suporteAgent.ts` | 295 | Agente suporte técnico (ONU online/offline, OS) |
| `server/services/agents/comercialAgent.ts` | 275 | Agente comercial (planos, cobertura, upgrade) |
| `server/services/agents/humanoAgent.ts` | 98 | Transferência para atendente humano |
| `server/services/agents/stateManager.ts` | 179 | Gerenciamento de sessão e estado |
| `server/services/agents/index.ts` | 7 | Barrel exports |
| `server/services/tenantSettingsService.ts` | — | CRUD de configurações por tenant |
| `server/utils/serviceHours.ts` | 116 | Verificação de horário de atendimento (timezone-aware) |
| `server/routes/isp.ts` | 1167 | Todas as rotas API do módulo ISP |
| `server/routes/admin-tenant-settings.ts` | — | Rotas admin para configuração de tenant |
| `server/services/n8nAiService.ts` | — | Serviço de IA (gerarResposta, salvarTemplate, listarTemplates) |
| `server/services/n8nErpService.ts` | — | Serviço ERP (buscar cliente, faturas, segunda via, OS, cobertura) |
| `server/services/n8nSendService.ts` | — | Serviço de envio (texto, botões, lista, documento) |
| `server/services/n8nMemoryService.ts` | — | Serviço de memória (sessão, histórico, turns) |
| `server/data/isp-agent-v4-workflow.json` | — | Workflow JSON legado (não utilizado na engine v3) |
| `client/src/pages/isp-prompts.tsx` | 275 | Frontend: editor de prompts dos agentes |
| `client/src/pages/admin-tenant-settings.tsx` | 711 | Frontend: Central de Configuração do Tenant |

---

## 10. Modelo de IA Utilizado

- **Modelo:** `gpt-4o-mini`
- **Temperatura:** 0 (classificação/roteamento) | variável (templates do workspace)
- **Max Tokens:** 200 (classificação) | 1000+ (respostas)
- **Resolução de chaves:** `openaiKeyResolver.ts` — tenta AI_INTEGRATIONS primeiro, depois OPENAI_API_KEY do workspace

---

## 11. Observações e Pontos de Atenção

1. **Cancelamento não tem agente dedicado** — é tratado inline no motor. Seria candidato a extração futura.
2. **Agente orquestrador (template `agente_orquestrador`)** existe no DB mas é usado apenas para mensagens de transição entre setores, não para classificação.
3. **Classificação dupla:** O motor ISP tem seus próprios regex (`INTENT_KEYWORDS`, `FINANCIAL_ABSOLUTE_REGEX`, `COMMERCIAL_ABSOLUTE_REGEX`) que atuam ANTES da classificação IA do orchestrator. Em muitos casos, a keyword é suficiente e a IA não é chamada.
4. **Horário de atendimento** é injetado no contexto (`outsideBusinessHours`) mas NÃO bloqueia o bot — apenas informa a IA.
5. **Meta vs Baileys:** O motor usa `sendButtons` para WhatsApp Meta (máx 3 botões, 20 chars) e pode usar `sendList` para Baileys. O canal é determinado pela conversa.
6. **Reclassificação automática:** Se cliente SUSPENSO pede suporte, o orchestrator reclassifica para FINANCEIRO automaticamente (quando `suspendedToFinance=true`).
