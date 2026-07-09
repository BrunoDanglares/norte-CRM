# Relatório de Situações — ChatBanana CRM (Rede ConexaoNet)

**Data:** 09/04/2026
**Total de situações:** 33 (F1-F10 + S1-S13 + C1-C10)

---

## Resumo Geral

| Agente | Total | Com detecção | Escalação obrigatória | Cobertura |
|--------|-------|--------------|-----------------------|-----------|
| Financeiro | 10 | 10 | 4 (F7, F8, F9, F10) | 100% |
| Suporte | 13 | 10 | 3 (S3, S9, S10) | 77% |
| Comercial | 10 | 10 | 2 (C6, C7) | 100% |
| Cancelamento | — | 2 (F9, C6) | — | via redirect |

---

## FINANCEIRO (F1 – F10)

| Código | Nome | Detecção (regex/condição) | Ação | Escalação |
|--------|------|---------------------------|------|-----------|
| **F1** | Promessa de pagamento | `desbloq`, `libera`, `promessa` ou sub=desbloquear | IA com situationCode → ERP | Não |
| **F2** | Suspensão temporária | `viajar`, `pausar`, `suspender`, `não vou usar`, `pausa temporária` | IA explica regras | Não |
| **F3** | Reativação após pagamento | `já pag`, `paguei`, `fiz o pix`, `transferi`, `depositei` | IA verifica status ERP | Não |
| **F4** | Segunda via / PIX | `segunda via`, `código pix`, `chave pix`, `boleto`, `fatura` (se não suspenso) | IA gera via ERP | Não |
| **F5** | Consulta de débitos | `quanto devo`, `débito`, `dívida`, `pendência` ou (suspenso + sub=faturas) | IA lista faturas | Não |
| **F6** | Status da linha | `cortaram`, `bloquearam`, `suspenderam` (se suspenso) | IA explica motivo | Não |
| **F7** | Negociação de dívida | `negoci`, `parcela`, `desconto`, `não consigo pagar tudo` | **→ HUMANO** | **Sim** |
| **F8** | Contestação de cobrança | `contest`, `não reconheço`, `cobrança indevida` | IA (escalate via prompt) | **Sim** |
| **F9** | Cancelamento com débito | `cancelar`/`cancelamento` + valor_divida > 0 | **→ HUMANO** | **Sim** |
| **F10** | Downgrade por custo | `tá caro`, `muito caro`, `mais barato`, `plano mais em conta` | **→ VENDAS** | **Sim** |

### Comportamento de escalação:
- **F7** → redirect HUMANO com resumo: "Cliente com débito de R$ X solicita negociação/parcelamento"
- **F9** → redirect HUMANO com resumo: "Cliente com débito de R$ X deseja cancelar com pendência"
- **F10** → redirect VENDAS com resumo: "Cliente com débito de R$ X menciona que o plano está caro"
- **F8** → escalação via prompt (a IA coleta contexto antes de escalar)

---

## SUPORTE (S1 – S13)

| Código | Nome | Detecção (regex/condição) | Ação | Escalação |
|--------|------|---------------------------|------|-----------|
| **S1** | Triagem completa | Nenhum problema_suporte nem onu_status definido | IA faz triagem inicial | Não |
| **S2** | Sem acesso — ONU online | ONU online + problema = sem_internet | IA guia checklist | Não |
| **S3** | Sem acesso — ONU offline | ONU offline (isOffline = true) | **→ HUMANO** | **Sim** |
| **S4** | Internet lenta — geral | problema = lento | IA solicita teste fast.com | Não |
| **S5** | Sinal instável | `instável`, `oscila`, `cai e volta`, `intermit` | IA coleta horários | Não |
| **S6** | Lentidão em horário | (`noite`/`tarde`/`pico`) + (`lento`/`trava`/`lentidão`) | IA coleta horários | Não |
| **S7** | Lentidão em site | (`youtube`/`netflix`/`instagram`...) + (`lento`/`travando`) | IA orienta downdetector | Não |
| **S8** | OS — acompanhamento | os_aberta + (`protocolo`/`chamado`/`andamento`) | IA consulta status OS | Não |
| **S9** | Troca de equipamento | `queimou`, `com defeito`, `parou de funcionar`, `roteador quebrou` | **→ HUMANO** | **Sim** |
| **S10** | Troca de senha WiFi | `senha do wifi`, `mudar senha`, `trocar senha`, `nome da rede` | **→ HUMANO** | **Sim** |
| **S11** | WiFi não aparece | ❌ Sem detecção automática (somente via prompt) | IA orienta | Não |
| **S12** | Mover roteador | ❌ Sem detecção automática (somente via prompt) | IA orienta | Não |
| **S13** | Consulta de plano | ❌ Sem detecção automática (somente via prompt) | IA informa dados | Não |

### Comportamento de escalação:
- **S3** → redirect HUMANO: "ONU offline — falha de infraestrutura, exige técnico de campo"
- **S9** → redirect HUMANO: "Equipamento com defeito físico, exige troca presencial"
- **S10** → redirect HUMANO: "Alteração de senha WiFi requer acesso ao sistema do provedor"

### Situações sem detecção automática (S11, S12, S13):
Essas situações existem como prompts no banco de dados e podem ser ativadas manualmente via seed, mas NÃO possuem regex no `detectSituation()`. A IA pode identificá-las pelo conteúdo da conversa e aplicar o template quando o situationCode é passado manualmente.

---

## COMERCIAL (C1 – C10)

| Código | Nome | Detecção (regex/condição) | Ação | Escalação |
|--------|------|---------------------------|------|-----------|
| **C1** | Upgrade / downgrade | sub = upgrade | IA apresenta planos | Não |
| **C2** | Agendamento de instalação | `agendar`, `quando instalam`, `quando vem o técnico` | IA + contexto agenda | Não |
| **C3** | Verificação de cobertura | cobertura_verificada + sem cobertura | IA informa alternativas | Não |
| **C4** | Consulta de fidelidade | `fidelidade`, `multa`, `quando termina minha fidelidade` | IA informa dados | Não |
| **C5** | Venda nova contratação | sub = nova_instalacao | IA apresenta planos | Não |
| **C6** | Retenção | contexto_anterior = cancelamento | **→ CANCELAMENTO** | **Sim** |
| **C7** | Alteração de titularidade | `trocar titular`, `mudar titular`, `passar pra outra pessoa` | **→ HUMANO** | **Sim** |
| **C8** | Consulta de planos | sub = duvidas | IA lista planos | Não |
| **C9** | Mudança de endereço | `mudar de casa`, `mudei de endereço`, `novo endereço` | IA coleta endereço | Não |
| **C10** | Indicação / Referral | `indiquei`, `indicação`, `meu vizinho quer` | IA registra | Não |

### Comportamento de escalação:
- **C6** → redirect CANCELAMENTO: "Cliente com intenção de cancelamento. Motivo: X"
- **C7** → redirect HUMANO: "Solicitação de alteração de titularidade — requer validação de documentos"

### Enriquecimento de contexto:
- **C2** → adiciona `agenda_disponivel` e instrução para coletar data/turno
- **C9** → ativa `coletando_novo_endereco` e instrução para verificar cobertura

---

## CANCELAMENTO (via CancelamentoAgent)

| Detecção | Situação | Ação |
|----------|----------|------|
| valor_divida > 0 ou amount_due > 0 | F9 | IA com contexto de débito |
| Sem débito | C6 | IA coleta motivo |
| IA responde TRANSFERIR_HUMANO | — | → redirect HUMANO (cliente insistiu) |
| IA responde TRANSFERIR_COMERCIAL | — | → redirect VENDAS (aceitou proposta) |

---

## Fluxo de Escalação Centralizado (escalationHandler.ts)

Quando qualquer agente retorna `redirectTo: 'HUMANO'`, o sistema:

1. Salva `situationCode` e `fluxo_atual` no session state
2. `humanoAgent` recebe `contextoAdicional` com o motivo
3. `buildHandoffSummary()` gera resumo estruturado com:
   - Cliente (nome, CPF, contrato)
   - Contexto (fluxo anterior, problema, débito, OS, etc.)
   - Urgência (alta: S3, F7, F8, C7 | normal: demais)
4. `formatHandoffMessage()` formata para WhatsApp com campos condicionais
5. Resumo salvo em `dados_coletados.resumo_conversa` e `handoff_meta`

---

## Variáveis Disponíveis nos Templates

As seguintes variáveis são substituídas automaticamente via `injetarVariaveis()`:

| Variável | Origem | Exemplo |
|----------|--------|---------|
| `{{empresa_nome}}` | tenant_settings | Rede ConexaoNet |
| `{{valor_divida}}` | ERP / session | 150.00 |
| `{{plano_nome}}` | ERP cliente | Turbo 200Mbps |
| `{{velocidade_contratada}}` | ERP cliente | 200 Mbps |
| `{{status_linha}}` | ERP financial | Ativo / Suspenso |
| `{{onu_status}}` | ERP connection | ONLINE / OFFLINE |
| `{{endereco_cliente}}` | ERP cliente | Rua X, Bairro Y |
| `{{os_protocolo}}` | session state | #12345 |
| `{{motivo_cancelamento}}` | session state | Insatisfação |
| `{{faturas_abertas}}` | ERP financial | 3 |

Todas as propriedades string/number do `context` são automaticamente disponibilizadas como variáveis.
