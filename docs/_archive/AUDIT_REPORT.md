# ChatBanana CRM - Auditoria Completa do Codigo
**Data:** 28/03/2026 | **Versao:** Producao

---

## 🔴 CRITICO (corrigir imediatamente — risco de seguranca ou perda de dados)

### C1. Credenciais Super Admin hardcoded no codigo
- **Arquivo:** `server/routes.ts` linhas 5046-5047
- **Problema:** Usuario e senha do super-admin estao em texto puro no codigo:
  ```
  const SUPER_ADMIN_USER = "Administrador";
  const SUPER_ADMIN_PASS = "Odlareg159951@";
  ```
- **Risco:** Qualquer pessoa com acesso ao repositorio tem acesso total ao painel administrativo
- **Correcao:** Mover para variaveis de ambiente e usar hash para a senha

### C2. JWT Secret com fallback hardcoded
- **Arquivos:** `server/index.ts:66`, `server/middleware/auth.ts:6`
- **Problema:** `JWT_SECRET = process.env.JWT_SECRET || "flowcrm-secret-2025"` — se a env var nao estiver configurada, todos os tokens sao assinados com um segredo previsivel
- **Risco:** Tokens JWT podem ser forjados se o deploy nao tiver JWT_SECRET configurado
- **Correcao:** Remover o fallback; lancar erro se JWT_SECRET nao existir

### C3. Valores monetarios armazenados como `real` (float)
- **Arquivo:** `shared/schema.ts`
- **Problema:** `leads.valor`, `deals.valor`, `transactions.valor` usam `real()` (ponto flutuante)
- **Risco:** Erros de precisao em calculos financeiros (ex: R$ 387,90 pode virar R$ 387,8999...)
- **Correcao:** Migrar para `numeric("valor", { precision: 10, scale: 2 })`

### C4. Queries de UPDATE sem workspace_id no WHERE
- **Arquivo:** `server/routes.ts` linhas 1137, 1150, 1165, 1179, 1200, 1220, 1225
- **Problema:** Apos verificar a conversa com `getConversation(id, wsId)`, o UPDATE subsequente usa apenas `eq(conversations.id, id)` sem incluir workspace_id
- **Risco:** Condicao de corrida (TOCTOU) — entre o check e o update, o ID poderia ser manipulado
- **Correcao:** Incluir `eq(conversations.workspaceId, wsId)` em todos os `WHERE` de UPDATE

### C5. Automation Engine sem isolamento de workspace em queries
- **Arquivo:** `server/services/automationEngine.ts` — multiplas linhas
- **Problema:** `db.update(leads)`, `db.update(conversations)` usando apenas `ctx.leadId` ou `ctx.conversationId` sem `ctx.workspaceId`
- **Risco:** Se o contexto for manipulado, dados de outros workspaces podem ser alterados
- **Correcao:** Adicionar `and(eq(table.id, id), eq(table.workspaceId, ctx.workspaceId))` em todas as queries

---

## 🟡 ALTO (corrigir antes do proximo release — bugs ou performance)

### A1. Rotas ISP sem autenticacao
- **Arquivo:** `server/routes/isp.ts` — todas as ~20 rotas
- **Problema:** O router do ISP nao aplica `requireAuth` nem globalmente nem individualmente
- **Nota:** Verificar se o middleware e aplicado quando o router e montado em `server/index.ts`. Se nao, todas as rotas ISP estao publicas
- **Correcao:** Aplicar `requireAuth` no router ou em cada rota

### A2. Rotas WhatsApp Official sem auth explicita
- **Arquivo:** `server/routes/whatsapp-official.ts`
- **Problema:** Rotas como `/connect`, `/connection`, `/test`, `/templates` nao tem middleware de auth no arquivo do router
- **Nota:** Mesma questao — verificar se o middleware e aplicado na montagem
- **Correcao:** Garantir que `requireAuth` esta aplicado

### A3. Indexes faltando em colunas workspace_id
- **Arquivo:** `shared/schema.ts`
- **Tabelas afetadas:** `leads`, `contacts`, `deals`, `conversations`, `messages`, `appointments`, `transactions`, `automacoes`, `campanhas`, `notificacoes`, `disparos_programados`, `document_templates`
- **Problema:** Essas tabelas de alto trafego nao tem index em `workspace_id`
- **Impacto:** Performance degrada significativamente conforme o banco cresce — todas as queries multi-tenant fazem full table scan na coluna workspace_id
- **Correcao:** Adicionar `index("idx_<table>_workspace").on(table.workspaceId)` em cada tabela

### A4. N+1 Query na listagem de usuarios
- **Arquivo:** `server/routes.ts` linhas 2214-2219
- **Problema:** `GET /api/usuarios` faz `for (const t of wsTeams)` com `storage.getTeamMembers(t.id)` dentro do loop — N+1 query
- **Correcao:** Buscar todos os membros de uma vez com uma unica query

### A5. Mensagens do inbox sem channel-router
- **Arquivo:** `server/routes.ts` linhas 1490-1499
- **Problema:** O POST de mensagens no inbox chama `sendTextMessage` ou `zapiFetch` diretamente em vez de usar o channel-router unificado
- **Correcao:** Refatorar para usar `sendMessage` do channel-router

### A6. Fetch calls sem timeout em APIs externas
- **Arquivos:** `server/routes.ts`, `server/services/automationEngine.ts`
- **Problema:** Chamadas a Z-API, Meta, OpenAI nao tem timeout configurado — podem bloquear indefinidamente
- **Correcao:** Adicionar `AbortController` com timeout de 30s em todas as chamadas externas

### A7. Refetch intervals agressivos no frontend
- **Arquivo:** `client/src/pages/inbox.tsx`
- **Problema:** `refetchInterval: 1000` para mensagens (1s), `refetchInterval: 1500` para conversas — gera ~90 requests/minuto por usuario conectado
- **Correcao:** Usar WebSocket events para invalidar cache sob demanda; aumentar intervals para 5-10s como fallback

### A8. Vulnerabilidades npm (HIGH)
- **Rollup 4.0-4.58:** Arbitrary File Write via Path Traversal (HIGH) — `npm audit fix`
- **Picomatch:** ReDoS + Method Injection (4 alerts) — `npm audit fix`
- **qs 6.7-6.14:** arrayLimit bypass DoS — `npm audit fix`
- **yaml 2.0-2.8:** Stack Overflow via nested YAML — `npm audit fix`
- **Correcao:** Executar `npm audit fix`

---

## 🟠 MEDIO (corrigir no proximo sprint — qualidade de codigo)

### M1. Raw fetch() no frontend em vez de apiRequest
- **Arquivos:** `inbox.tsx` (9 ocorrencias), `leads.tsx` (3), `pipeline.tsx` (2), `App.tsx` (1)
- **Problema:** Chamadas `fetch()` manuais com header Authorization montado manualmente, sem tratamento consistente de erros/401
- **Correcao:** Substituir por `apiRequest` de `@/lib/queryClient`

### M2. Arquivo inbox.tsx com 3.112 linhas
- **Arquivo:** `client/src/pages/inbox.tsx`
- **Problema:** Arquivo excessivamente grande, dificulta manutencao e debugging
- **Correcao:** Extrair componentes (ChatHeader, MessageList, InternalChat, ContactPanel) para arquivos separados

### M3. Arquivo automacoes.tsx com 6.588 linhas
- **Arquivo:** `client/src/pages/automacoes.tsx`
- **Problema:** Maior arquivo do projeto — praticamente impossivel de manter
- **Correcao:** Extrair FlowEditor, AiFullPageConfig, NodeCanvas, ConfigPanel para componentes separados

### M4. Arquivo routes.ts com 5.512 linhas
- **Arquivo:** `server/routes.ts`
- **Problema:** Todas as rotas em um unico arquivo monolitico
- **Correcao:** Separar em modulos: `routes/auth.ts`, `routes/conversations.ts`, `routes/leads.ts`, `routes/automacoes.ts`, etc.

### M5. ON DELETE CASCADE inconsistente
- **Arquivo:** `shared/schema.ts`
- **Problema:** Tabelas ISP tem cascade, mas tabelas core (leads, contacts, conversations, messages) nao tem — deletar workspace falha se houver dados relacionados
- **Correcao:** Adicionar `onDelete: "cascade"` nas foreign keys de tabelas que referenciam workspaces

### M6. Tipos `any` excessivos
- **Arquivos:** Todos os arquivos do frontend e muitas rotas do backend
- **Problema:** Uso extensivo de `any` em vez de tipos corretos (especialmente em handlers de webhook e respostas de API)
- **Correcao:** Criar interfaces tipadas para payloads de webhook, respostas de API, e props de componentes

### M7. Storage layer com getById sem workspace
- **Arquivo:** `server/storage.ts` — metodos `getUser`, `getLead`, `getContact`, `getConversation`, `getAutomacao`, `getConexao`
- **Problema:** Esses metodos aceitam apenas `id` sem `workspaceId` obrigatorio
- **Correcao:** Tornar `workspaceId` obrigatorio em todos os metodos de busca

### M8. Webhooks Meta vs Z-API com logica inconsistente
- **Arquivos:** `server/routes.ts` (Z-API webhook), `server/routes/webhook-meta.ts`
- **Problema:** Meta webhook tem logica de "Combined Text" para contexto da IA que Z-API nao tem; deduplicacao funciona diferente entre os dois
- **Correcao:** Unificar a logica de processamento em um handler compartilhado

---

## 🟢 BAIXO (melhorias — nice to have)

### B1. Campos enum-like sem CHECK constraints
- **Arquivo:** `shared/schema.ts`
- **Campos:** `users.role`, `users.status`, `leads.status`, `leads.prioridade`, `conversations.status`, `automacoes.status`, `automacoes.triggerType`, `isp_configs.erpType`
- **Problema:** O banco aceita qualquer string nesses campos
- **Correcao:** Adicionar CHECK constraints ou usar pgEnum

### B2. Workspace_id como text() em algumas tabelas
- **Arquivo:** `shared/schema.ts`
- **Tabelas:** `users`, `teams`, `permissions`, `respostasRapidas` usam `text("workspace_id")` em vez de `uuid("workspace_id").references(...)`
- **Problema:** Sem foreign key, sem tipo correto, sem integridade referencial
- **Correcao:** Migrar para `uuid` com referencia a `workspaces.id`

### B3. Pagina 404 existe mas e basica
- **Arquivo:** `client/src/pages/not-found.tsx`
- **Problema:** Funcional mas poderia ser mais informativa
- **Sugestao:** Adicionar link para a pagina principal e pesquisa

### B4. Unique constraints faltando
- **Arquivo:** `shared/schema.ts`
- **Problema:** Nao ha unique constraint em `contacts(workspace_id, phone)` nem em `messages(workspace_id, wamid)` — pode gerar duplicatas
- **Correcao:** Adicionar unique constraints compostas

### B5. Timer de gravacao de audio sem cleanup
- **Arquivo:** `client/src/pages/inbox.tsx` linha 1179
- **Problema:** `setInterval` para timer de gravacao — verificar se e limpo em todos os caminhos de desmontagem
- **Correcao:** Garantir clearInterval em todos os cenarios

### B6. ISP adapters com implementacao parcial
- **Arquivos:** `server/services/sgp-adapter.ts`, `server/services/ixc-adapter.ts`
- **Problema:** Alguns metodos da interface ISPProvider podem estar com implementacao stub
- **Correcao:** Verificar e completar todos os metodos necessarios

---

## 📊 RESUMO

| Metrica | Valor |
|---------|-------|
| **Total de Issues** | **27** |
| Critico (🔴) | 5 |
| Alto (🟡) | 8 |
| Medio (🟠) | 8 |
| Baixo (🟢) | 6 |

| Score | Nota | Comentario |
|-------|------|------------|
| **Seguranca** | **5/10** | Credenciais hardcoded, queries sem workspace isolation, JWT fallback |
| **Qualidade do Codigo** | **5/10** | Arquivos monoliticos, tipos `any`, inconsistencia entre webhooks |
| **Performance** | **6/10** | Indexes faltando, polling agressivo, N+1 queries |
| **Arquitetura** | **6/10** | Channel-router subutilizado, storage layer inconsistente, multi-tenancy incompleto |

---

## ✅ O QUE ESTA BEM IMPLEMENTADO

1. **Sistema de autenticacao** — JWT com hash de senha (scrypt), middleware requireAuth bem estruturado
2. **WebSocket cleanup** — Hook useWebSocket com cleanup correto de conexoes e timeouts
3. **Frontend routing** — ProtectedRoute corretamente aplicado em todas as rotas protegidas, pagina 404 existe
4. **Loading states** — useQuery com Skeleton components e estados de carregamento consistentes
5. **Webhook Meta** — Verificacao de token correta, resposta rapida antes do processamento
6. **Schema ISP** — Tabelas ISP bem estruturadas com cascade, indexes, e tipos corretos
7. **Drizzle ORM** — Uso correto de schemas Zod para validacao, insert schemas com .omit
8. **Automacao Engine** — Sistema de fluxo robusto com debounce, pending inputs, e retry
9. **Multi-provider WhatsApp** — Suporte a Baileys, Z-API, e Meta Cloud API no mesmo sistema
10. **Real-time** — SSE + WebSocket para atualizacoes em tempo real funcionando corretamente

---

## 🔧 VARIAVEIS DE AMBIENTE UTILIZADAS

| Variavel | Obrigatoria | Status |
|----------|-------------|--------|
| `DATABASE_URL` | Sim | Configurada |
| `JWT_SECRET` | Sim | TEM FALLBACK INSEGURO |
| `SESSION_SECRET` | Sim | Configurada |
| `WHATSAPP_ACCESS_TOKEN` | Sim | Configurada |
| `WHATSAPP_APP_SECRET` | Sim | Configurada |
| `WHATSAPP_APP_ID` | Nao | Opcional |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Nao | Opcional |
| `STRIPE_SECRET_KEY` | Nao | Via integracao |
| `ZAPI_BASE_URL` | Nao | Default: api.z-api.io |
| `ZAPI_INSTANCE_ID` | Nao | Via DB config |
| `ZAPI_TOKEN` | Nao | Via DB config |
| `ZAPI_CLIENT_TOKEN` | Nao | Via DB config |
| `ZAPI_ACCOUNT_TOKEN` | Nao | Via DB config |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Nao | Via integracao Replit |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Nao | Via integracao Replit |
| `PORT` | Nao | Default: 5000 |
| `NODE_ENV` | Nao | Default: development |
