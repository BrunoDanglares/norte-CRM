# WhatsApp Flows — Setup e Publicação

Implementação do **WhatsApp Flow nativo** para coleta de cadastro do cliente C11 (substitui o checklist textual de 12 campos).

## Como funciona

Cliente recebe um card no WhatsApp com botão "Preencher cadastro". Toca → abre formulário nativo em 2 telas → preenche → submete → backend recebe payload estruturado → handoff humano automático com resumo dos dados.

## Arquivos

- `c11NewCustomerFlow.json` — definição do Flow (2 telas, 12 campos)
- `flowService.ts` — `sendC11Flow()` envia, `parseC11FlowReply()` processa resposta
- Plug em `c11ChecklistHelper.sendC11ChecklistAndPersist` — tenta Flow primeiro, fallback C11 textual
- Plug em `webhook-meta.ts` — intercepta `nfm_reply` e processa

## Como publicar o Flow no Meta Business Manager

### Passo 1 — Acessar Flow Builder

1. Abra <https://business.facebook.com/>
2. Selecione o **WhatsApp Business Account** do tenant (Conexao Net)
3. Menu lateral → **WhatsApp Manager** → **Account tools** → **Flows**

### Passo 2 — Criar Flow

1. Clique em **"Create flow"**
2. Categoria: **"Sign up"** ou **"Lead generation"**
3. Nome: `C11 — Cadastro Novo Cliente`
4. Build mode: **"JSON"** (modo avançado)

### Passo 3 — Colar o JSON

1. Cole o conteúdo de `c11NewCustomerFlow.json` no editor
2. Clique em **"Save draft"**
3. Use **"Preview"** pra testar no celular conectado

### Passo 4 — Publicar

1. Quando estiver satisfeito, clique em **"Publish"**
2. Aprovação Meta: 1-2 dias úteis pra flows simples
3. Você pode rodar como **DRAFT** durante o dev (token de teste só funciona pro número do dev)

### Passo 5 — Configurar a variável de ambiente

Depois de publicar, o Meta dá um **Flow ID**. Pegue ele e adicione no `.env`:

```bash
META_C11_FLOW_ID=<id_retornado_pela_meta>
```

Reinicie o servidor. Daí pra frente, todo C11 disparado via Meta Cloud API vai como Flow nativo. Conversas em wweb continuam recebendo o C11 textual (Flows não funcionam em canais não-oficiais).

## Variáveis de ambiente

| Var | Default | O que faz |
|---|---|---|
| `META_C11_FLOW_ID` | unset | ID do Flow publicado no Meta Business. Sem isso, fallback pro C11 textual |
| `META_C11_FLOW_DISABLED` | unset | Setar `true` desabilita o Flow mesmo com ID configurado (kill switch) |

## Fallback automático

O `c11ChecklistHelper` tenta o Flow primeiro. Se qualquer um destes for verdade, cai pro C11 textual:
- `META_C11_FLOW_ID` não configurada
- `META_C11_FLOW_DISABLED=true`
- Tenant tem `c11b='Um por vez'` no questionário (modo de coleta sequencial — Flow não casa)
- Conversa não está em canal Meta Cloud API (ex: wweb)
- Chamada Meta API retornou erro

Logs:
```
[Flow] ✅ enviado conv=350 flowToken=c11_350_lxyz
[Flow] META_C11_FLOW_ID não configurada — fallback pro C11 textual
[C11Helper] Flow indisponível (flow_not_meta_channel) — fallback pro C11 textual conv=350
```

## Processamento da resposta

Cliente preenche o Flow e toca em "Enviar cadastro ✅". Webhook Meta entrega:

```json
{
  "type": "interactive",
  "interactive": {
    "type": "nfm_reply",
    "nfm_reply": {
      "name": "flow",
      "response_json": "{ \"flow_token\": \"c11_350_lxyz\", \"data\": { \"nome_completo\": \"Bruno\", ... } }",
      "body": "📋 [Formulário enviado]"
    }
  }
}
```

Backend (`webhook-meta.ts:~810`):
1. Detecta `nfm_reply` no parser de tipos
2. `parseC11FlowReply` extrai `conversationId` do `flow_token` e os campos
3. Persiste dados em `dados_coletados._checklist_dados`
4. Envia confirmação ao cliente + pede foto do documento
5. Aplica tags `C11 + AH`, marca pipeline `comercial`, pendente=true
6. Posta nota interna no chat (`direction='internal'`) com resumo formatado pra equipe comercial

## Próximos passos (não implementado)

- **Data Exchange Flow**: validar CEP via ViaCEP em tempo real e auto-preencher endereço
- **Upload de foto**: Flows não suportam upload nativo — cliente envia foto em mensagem separada após o submit (já é o que pedimos)
- **Flow customizado por tenant**: cada workspace publica seu próprio Flow com campos do `c11a` (hoje todos usam o mesmo)

## Limites Meta

- Até **10 telas** por Flow
- Até **20 campos** por tela
- `flow_cta` (label do botão): máx **20 chars**
- Versões do Flow JSON evoluem (atual: 6.0) — quando Meta atualizar, validar compatibilidade
