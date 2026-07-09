# ChatBanana CRM

## Sobre o dono do projeto

Bruno é **non-dev, orientado a produto**. Delega implementação técnica pra IA. Prefere explicações em linguagem funcional, não só técnica. Idioma padrão de resposta: **português brasileiro**. Respostas concisas e objetivas, sem enrolação.

Infra padrão dos projetos dele: **Hostinger VPS + EasyPanel**, n8n, Evolution API quando envolve WhatsApp (não é o caso deste projeto — ver seção Integrações). Workflow: **edita local no VS Code → commit/push pro GitHub → EasyPanel puxa do GitHub e faz deploy**. **Bruno NÃO usa Replit** (descontinuado há tempos) — nunca citar Replit como exemplo nem assumir sync via Replit.

## Visão geral

É um **SaaS CRM multi-tenant em português** com foco em **WhatsApp omnichannel** (atendimento, leads, automações, Kanban). Cada workspace é um cliente (tenant), com isolamento total por `workspace_id`. Há um sistema de parceria (`gestor` / `empreendedor`) onde gestores revendem o CRM e bancam custos de IA dos seus clientes.

> **Nota (branch `chore/remover-isp`, 2026-06):** o módulo vertical de **atendimento automático para provedores de internet (ISP)** — motor de agentes, adapters de ERP (SGP/IXC), FAQ/RAG, Protocolos, Retenção/NPS, Evals — foi **removido fisicamente**. O produto está sendo transformado em **CRM multi-segmento genérico**. Branding ainda a definir. Se encontrar resíduo de ISP, é candidato a limpeza.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, shadcn/ui, wouter (router), TanStack Query, Framer Motion, reactflow (canvas de automações) |
| Backend | Node.js 20, Express 5, TypeScript, tsx (dev), esbuild (build) |
| Banco | PostgreSQL (hospedado no VPS), Drizzle ORM |
| Autenticação | JWT próprio (sem OAuth provider) + passport-local |
| Tempo real | WebSocket (`ws`) + SSE como fallback |
| IA | OpenAI SDK (`gpt-4o-mini` por padrão) |
| Pagamentos | Stripe (assinatura do SaaS), Mercado Pago (PIX dos clientes finais) |
| WhatsApp | `whatsapp-web.js` (não-oficial) + Meta Cloud API (oficial). Baileys existe mas é legado |
| Outras integrações | Meta Graph (Instagram DM), n8n (automações externas) |

## Comandos principais

```bash
npm run dev       # tsx server/index.ts — roda frontend+backend no mesmo processo (Vite integrado)
npm run build     # esbuild do server + vite build do client → dist/index.cjs
npm start         # roda build de produção (node dist/index.cjs)
npm run check     # tsc — type-check sem emitir
npm run db:push   # drizzle-kit push — NÃO USAR EM PRODUÇÃO (ver seção Migrações)
```

Não há scripts de lint ou test configurados. A pasta `scripts/` foi esvaziada na limpeza do ISP — hoje só guarda `drop-isp-tables.sql` (DROP supervisionado das tabelas órfãs, **não roda no boot**). Scripts ad-hoc novos vão em `scripts/` e rodam com `tsx scripts/<arquivo>.ts`.

Porta padrão de dev: `5000`. Servidor e cliente compartilham a porta via integração Vite.

## Arquitetura

Monorepo simples (sem workspaces npm), três pastas de código:

```
client/       # React + Vite
  src/
    pages/          # 30+ páginas (inbox, leads, automacoes, relatorios, etc.)
    components/
      ui/           # shadcn/ui primitives
      inbox/        # componentes da página de chat
      automacoes/   # FlowCanvas, NodePicker, NodeConfigPanel (builder de fluxos)
    hooks/          # useWebSocket, use-toast, etc.
    lib/            # queryClient, constants, utils
    services/       # auth.ts

server/       # Express + Drizzle
  index.ts          # Boot: auto-migrations, seed, teams, WS server, rate limits, schedulers
  routes.ts         # Registra todas as rotas (centralizador)
  routes/           # Routers por domínio (auth, leads, conexoes, instagram, etc.)
  storage.ts        # Repository pattern — IStorage com ~100 métodos
  db.ts             # Pool pg + drizzle()
  middleware/
    auth.ts         # requireAuth (JWT) + requireAuthOrToken
  services/
    message-processor.ts    # Processa mensagem recebida (salva, dispara automação, broadcast)
    channel-router.ts       # Roteia envio pro canal certo (web.js / Meta / Instagram)
    automationEngine.ts     # Motor de automações visuais (26+ tipos de node)
    suportePipelineService.ts # Kanban/pipelines por setor (1 conversa = 1 setor)
    tenantSettingsService.ts# Config JSONB por tenant (regras, planos, horários)
    openaiKeyResolver.ts    # Resolve chave OpenAI do tenant
    broadcast.ts            # Hub de WebSocket/SSE por workspace
  utils/                    # logger, phoneLock, mask, etc.

shared/       # Compartilhado client ↔ server
  schema.ts         # Schema Drizzle (source of truth do banco)
```

### Multi-tenancy

**Toda** query de dados de negócio DEVE filtrar por `workspace_id`. Essa é a garantia de isolamento de dados entre clientes. Ao adicionar uma rota nova, olhe uma rota existente primeiro — o padrão é pegar o `workspaceId` de `req.user` (setado pelo middleware `requireAuth`) e usar no `where(eq(table.workspaceId, wsId))`.

### Fluxo de mensagem (entrada → resposta)

1. Mensagem do cliente chega no webhook do canal (Meta Cloud API / `whatsapp-web.js` / Instagram)
2. `message-processor.ts` salva a mensagem, identifica o canal e dispara a automação do tenant
3. O motor de automações (`automationEngine.ts`) executa os nodes configurados (respostas, condições, IA, espera, etc.)
4. O envio sai pelo canal certo via `channel-router.ts`; o broadcast em tempo real vai pelo `broadcast.ts`

> O antigo **motor de agentes ISP** (V1/V2 em `services/agents/`, com ERP/RAG/classifiers/handlers por setor) foi **removido**. Atendimento automático hoje é só o **builder visual de automações**. Docs históricos do produto ISP ficaram em [docs/_archive/](docs/_archive/).

## Integrações externas

### WhatsApp
- **`whatsapp-web.js`**: canal não-oficial ativo. Sessões restauradas no boot via `restoreAllSessions()`.
- **Meta Cloud API**: canal oficial, webhook em `/api/webhook/meta`, rotas em `/api/whatsapp-official`. Templates HSM sincronizados a cada 30min.
- **Baileys** (`@whiskeysockets/baileys`): código ainda existe mas está **legado**. Não adicione nada novo usando Baileys.
- **Z-API**: **removido**. Se encontrar referência, é lixo — pode limpar.

### Outras
- **Instagram DM**: OAuth Meta, webhook em `/api/instagram`, módulo "Insta Prospect" pra prospecção com IA
- **Stripe**: assinatura do SaaS. Webhook raw em `/api/stripe/webhook` (NÃO passa pelo `express.json` por exigência do Stripe)
- **Mercado Pago**: geração de links de pagamento PIX pro cliente final
- **n8n**: usado pelo Bruno pra automações externas (fora do app). O antigo proxy de ERP `/api/isp/...` foi removido junto com o módulo ISP.

## Chaves de IA (importante)

Cada tenant usa **sua própria chave OpenAI** e banca os próprios créditos. Ordem de resolução em `openaiKeyResolver.ts`:

1. `AI_INTEGRATIONS_OPENAI_API_KEY` (env, legado — geralmente não setada)
2. Chave salva na config do tenant (workspace)
3. `OPENAI_API_KEY` (env global — só como last resort)

**Não existe proxy nem fallback universal**. Se um tenant não configurar a chave, a IA dele simplesmente falha. Ao diagnosticar "IA não responde", checar primeiro se o tenant tem chave.

## Fluxo de deploy (proposto)

O VPS usa **EasyPanel**, que faz deploy puxando do GitHub. O fluxo funcional é:

1. Você edita local no VS Code
2. Comita e dá push na branch `main` do GitHub
3. EasyPanel detecta o push (via webhook do GitHub) ou é disparado manualmente → pull + `docker build` com o `Dockerfile` da raiz → restart do container
4. Container roda `npm run build` e depois `node dist/index.cjs`

**O que precisa ser configurado (pendente):**
- Confirmar se o EasyPanel está com auto-deploy ativo via webhook do GitHub (se sim, push na `main` = deploy automático)
- Se não estiver, habilitar nas configurações do app no EasyPanel (opção "Auto deploy on push")
- Ter certeza de que o `Dockerfile` da raiz é o que o EasyPanel usa (não há override configurado no painel)
- Confirmar que as variáveis de ambiente de produção (`DATABASE_URL`, `JWT_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, Stripe keys, etc.) estão setadas no painel do EasyPanel

**Não há ambiente de staging.** `main` = produção. Isso significa: cuidado extra com mudanças de schema e breaking changes — ver próxima seção.

## Migrações de schema (recomendação)

**Estado atual é misto e perigoso.** Há três mecanismos coexistindo:

1. `shared/schema.ts` — fonte da verdade do Drizzle (tipos TS derivam daqui)
2. `runAutoMigrations()` em `server/index.ts` — roda ~50 `ALTER TABLE IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` a cada boot, em ordem, com try-catch silencioso. É o que realmente aplica DDL em produção.
3. `drizzle-kit push` (`npm run db:push`) — **não usar em produção**. Ele tenta sincronizar o schema declarativo com o banco e pode DROPAR colunas sem aviso.

### Regra operacional (a partir de agora)

Quando precisar mudar schema:

1. **Atualize `shared/schema.ts`** com a nova coluna/tabela (pro TS ficar feliz)
2. **Adicione a DDL correspondente no final de `runAutoMigrations()`** em `server/index.ts`, sempre com `IF NOT EXISTS` (colunas) ou `CREATE TABLE IF NOT EXISTS`
3. **Nunca** adicione `DROP COLUMN` ou `ALTER TYPE` sem pedir confirmação — essas operações podem perder dados
4. Commit e push — no próximo boot do container, a migração roda sozinha

Esse padrão é **idempotente e seguro** (roda sem problema várias vezes) e evita o risco do `db:push`. A desvantagem é que a lista cresce indefinidamente, mas isso é aceitável no estágio atual do projeto.

Não rode `npm run db:push` nem manualmente em produção. Se precisar de operação destrutiva (dropar coluna obsoleta), faça um script em `scripts/` e execute com supervisão.

## Convenções de código

- **Sem lint/prettier configurados.** Siga o estilo dos arquivos vizinhos.
- **Rotas**: cada domínio tem seu arquivo em `server/routes/`, com um `Router` default export. `server/routes.ts` monta tudo.
- **Services**: lógica de negócio fica em `server/services/`. Rotas chamam services, não acessam `db` direto (com exceções pragmáticas onde já existe).
- **Storage pattern**: `server/storage.ts` implementa `IStorage` com métodos CRUD reutilizáveis. Prefira estender o storage ao invés de consultar o `db` diretamente na rota.
- **Nomes em português**: tabelas e muitos campos usam PT-BR (`conversas`, `telefone`, `agente`, `pendente`). Mantenha essa convenção.
- **Validação**: Zod + drizzle-zod. Schemas de insert vêm do Drizzle.
- **Logs**: `console.log` com prefixos tipo `[Boot]`, `[AutoClose]`, `[Protocols]`. Há um `utils/logger.ts` mais estruturado — use-o em código novo quando fizer sentido.
- **WebSocket broadcast**: use `broadcastToWorkspace(workspaceId, event, payload)` de `server/services/broadcast.ts`. Nunca emita direto pro cliente sem passar pelo hub.

## Gotchas (coisas que já deram problema)

- **Isolamento por `workspace_id`**: esquecer do filtro em uma query é um vazamento de dados entre tenants. É o bug mais grave possível aqui. Toda query nova passa por revisão desse ponto.
- **JWT_SECRET**: se não estiver setado ou tiver <32 chars, o servidor **não sobe** (exit 1 no boot). Isso é intencional por segurança.
- **Stripe webhook precisa de raw body**: a rota `/api/stripe/webhook` é registrada ANTES do `express.json()` e usa `express.raw()`. Não mova essa ordem.
- **Rate limits**: `/api/webhook/*`, `/api/instagram/*`, `/api/whatsapp-official/*` são **isentos** do rate limit geral. Auth tem limite separado (20 tentativas / 15min) e envio de mensagens tem outro (120 / min).
- **Menu WhatsApp tem só 3 botões** (limite da Meta Cloud API) — menus de departamento maiores precisam ser por texto ou lista interativa.
- **Boot do servidor faz MUITO trabalho**: auto-migrations, seed, ensureDefaultTeams, backfill de telefones/avatares/pipelines, restauração de sessões web.js. O primeiro boot após muitas mudanças pode demorar minutos. Isso é esperado.
- **CORS em produção** permite só `chatbanana.com.br`, `www.chatbanana.com.br`, `app.chatbanana.com.br`. Se for adicionar um domínio novo (white-label), editar `allowedOrigins` em `server/index.ts`.
- **`.env` está no repo** (via `M server/index.ts` e `.env` trackado). Confirmar que o `.gitignore` está protegendo segredos antes de commits futuros — o commit `c4e865ee` mexeu nisso mas vale revisar.
- **Schema do banco é grande (~50 tabelas)**: antes de criar tabela nova, verifique se já existe algo parecido em `shared/schema.ts`.
