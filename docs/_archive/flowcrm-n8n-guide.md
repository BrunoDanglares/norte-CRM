# Guia de Integracao -- FlowCRM + N8n

## Visao Geral
O FlowCRM integra com o N8n de duas formas:
1. **FlowCRM -> N8n**: O CRM dispara eventos via webhook quando
   algo acontece (lead criado, mensagem recebida, etc.)
2. **N8n -> FlowCRM**: O N8n aciona acoes no CRM via API REST
   autenticada com token

## Passo 1 -- Gerar API Token no FlowCRM
1. Acesse **Integracoes -> N8n -> Aba API Tokens**
2. Clique em **"Gerar Novo Token"**
3. Selecione as permissoes necessarias
4. **Copie o token gerado** -- ele so e exibido uma vez

## Passo 2 -- Configurar Credencial no N8n
1. No N8n: **Credentials -> New -> Generic Credential Type -> Header Auth**
2. Name: `FlowCRM`
3. Header Name: `X-FlowCRM-Token`
4. Header Value: `[seu token aqui]`
5. Salvar

## Passo 3 -- Usar Prompts Dinamicos do CRM no N8n

Este e o diferencial: o N8n busca o prompt atualizado do CRM
antes de cada chamada ao GPT. Assim voce muda o comportamento
da IA pelo CRM sem tocar no fluxo do N8n.

### Estrutura do fluxo no N8n:
```
[Webhook Trigger]
       |
       v
[HTTP Request] GET https://seu-crm.repl.co/api/ia/prompts/by-slug/atendimento
Header: X-FlowCRM-Token: seu-token
       | retorna: { data: { prompt, modelo, temperatura } }
       v
[OpenAI / GPT]
System Prompt: {{ $('HTTP Request').item.json.data.prompt }}
Model: {{ $('HTTP Request').item.json.data.modelo }}
Temperature: {{ $('HTTP Request').item.json.data.temperatura }}
       |
       v
[Resposta ao usuario]
```

### Slugs de prompts disponiveis:
- `atendimento` -> Atendimento WhatsApp
- `qualificacao` -> Qualificacao de Leads
- `followup` -> Follow-up Automatico

Para criar novos: **CRM -> Base de IA -> aba "Prompts de IA"**

## Passo 4 -- Receber Eventos do CRM no N8n

1. No N8n: adicione no **Webhook** e copie a URL gerada
2. No CRM: **Integracoes -> N8n -> Aba Conexao**
3. Cole a URL do N8n e salve
4. Na aba **Eventos**, selecione quais eventos quer receber

### Payloads dos eventos:

**lead.created / lead.updated / lead.won / lead.lost:**
```json
{
  "evento": "lead.created",
  "timestamp": "2025-01-01T00:00:00Z",
  "data": {
    "id": 123,
    "nome": "Joao Silva",
    "telefone": "11999990000",
    "email": "joao@empresa.com",
    "empresa": "Acme Inc",
    "status": "novo",
    "canal": "whatsapp",
    "valor": 5000,
    "owner": "Ana Costa"
  }
}
```

**message.received:**
```json
{
  "evento": "message.received",
  "timestamp": "2025-01-01T00:00:00Z",
  "data": {
    "conversa_id": 5,
    "lead": { "id": 123, "nome": "Joao", "telefone": "11999990000" },
    "mensagem": {
      "conteudo": "Ola, preciso de ajuda",
      "de": "5511999990000",
      "tipo": "text"
    }
  }
}
```

**deal.moved:**
```json
{
  "evento": "deal.moved",
  "timestamp": "2025-01-01T00:00:00Z",
  "data": {
    "lead": { "id": 123, "nome": "Joao" },
    "de": "CONTATADO",
    "para": "QUALIFICADO"
  }
}
```

## Passo 5 -- N8n acionando o CRM

Base URL: `https://[seu-crm].repl.co/api/n8n`
Header obrigatorio: `X-FlowCRM-Token: [seu-token]`

### Criar lead:
```
POST /api/n8n/lead
Body: { "nome": "Joao", "telefone": "11999990000", "canal": "whatsapp" }
```

### Enviar mensagem WhatsApp:
```
POST /api/n8n/mensagem
Body: { "telefone": "5511999990000", "mensagem": "Ola Joao!" }
```

### Mover lead no pipeline:
```
POST /api/n8n/lead/:id/mover
Body: { "status": "QUALIFICADO" }
```

### Atualizar lead:
```
PATCH /api/n8n/lead/:id
Body: { "valor": 10000, "empresa": "Nova Empresa" }
```

### Listar leads:
```
GET /api/n8n/leads?status=NOVO&limit=10
```

## Verificar Assinatura dos Webhooks (opcional)

Se configurou um Secret no CRM, valide no N8n com no Code:
```javascript
const crypto = require('crypto');
const secret = 'seu-secret';
const signature = $input.item.json.headers['x-flowcrm-signature'];
const body = JSON.stringify($input.item.json.body);
const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(body)
  .digest('hex');
if (signature !== expected) throw new Error('Assinatura invalida');
return $input.item;
```
