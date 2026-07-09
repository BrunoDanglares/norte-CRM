# ChatBanana CRM — Arquitetura do Sistema

---

## 1. Visao Geral

**ChatBanana CRM** e uma plataforma SaaS multi-tenant de CRM com automacao de WhatsApp, construida em TypeScript full-stack. O sistema oferece gestao de leads, pipeline kanban, chat em tempo real, automacoes, campanhas em massa, financeiro e integracoes com servicos externos.

---

## 2. Stack Tecnologico

| Camada | Tecnologia |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, Shadcn/UI, Radix UI, Framer Motion |
| **Roteamento Frontend** | Wouter (com lazy loading) |
| **Estado/Cache** | TanStack Query v5 (React Query) |
| **Backend** | Node.js, Express, TypeScript |
| **Banco de Dados** | PostgreSQL |
| **ORM** | Drizzle ORM |
| **Validacao** | Zod + drizzle-zod |
| **Autenticacao** | JWT (jsonwebtoken) |
| **Tempo Real** | WebSocket (ws) + SSE (Server-Sent Events) |
| **WhatsApp** | Z-API (principal) / Baileys (alternativo) |
| **IA** | OpenAI SDK, Anthropic SDK |
| **Calendario** | Google Calendar API |
| **Upload** | Multer |

---

## 3. Estrutura de Diretorios

```
chatbanana-crm/
├── client/                        # Frontend React
│   ├── src/
│   │   ├── components/            # Componentes reutilizaveis
│   │   │   ├── ui/                # Shadcn/UI (50+ componentes)
│   │   │   ├── app-sidebar.tsx    # Sidebar de navegacao
│   │   │   ├── chatbanana-logo.tsx
│   │   │   ├── lead-profile-dialog.tsx
│   │   │   ├── ProtectedRoute.tsx # Guard de autenticacao
│   │   │   ├── stat-card.tsx
│   │   │   └── theme-provider.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts    # WS + fallback SSE
│   │   │   ├── use-toast.ts
│   │   │   └── use-mobile.tsx
│   │   ├── lib/
│   │   │   ├── queryClient.ts     # TanStack Query config
│   │   │   ├── prefetch.ts
│   │   │   └── constants.ts
│   │   ├── pages/                 # 22+ paginas
│   │   │   ├── dashboard.tsx
│   │   │   ├── leads.tsx          # CRM principal (Pipeline/Kanban/Contatos/Agenda)
│   │   │   ├── inbox.tsx          # Chat em tempo real (~2800 linhas)
│   │   │   ├── automacoes.tsx     # Builder de automacoes
│   │   │   ├── financeiro.tsx
│   │   │   ├── conexoes.tsx
│   │   │   ├── gestao-conversas.tsx
│   │   │   ├── campanhas.tsx
│   │   │   ├── integracoes.tsx
│   │   │   ├── usuarios.tsx
│   │   │   ├── perfil.tsx
│   │   │   ├── configuracoes.tsx
│   │   │   ├── login.tsx
│   │   │   ├── register.tsx
│   │   │   ├── landing.tsx
│   │   │   └── ... (mais paginas)
│   │   ├── services/
│   │   │   └── auth.ts
│   │   └── App.tsx                # Roteamento principal
│   └── public/
│       ├── chatbanana-logo.png
│       └── chatbanana-icon.png
│
├── server/                        # Backend Express
│   ├── index.ts                   # Boot do servidor, WS, SSE
│   ├── routes.ts                  # Todas as rotas API (~4300 linhas)
│   ├── storage.ts                 # Camada de acesso a dados (IStorage)
│   ├── db.ts                      # Conexao PostgreSQL + Drizzle
│   ├── vite.ts                    # Dev server Vite integrado
│   ├── middleware/
│   │   └── auth.ts                # JWT middleware
│   └── services/
│       ├── whatsapp.ts            # Integracao Z-API
│       ├── google-calendar.ts
│       └── automation-engine.ts   # Motor de automacoes
│
├── shared/                        # Codigo compartilhado
│   ├── schema.ts                  # Schema Drizzle (37 tabelas)
│   └── models/                    # Interfaces TypeScript
│
├── uploads/                       # Arquivos enviados
└── drizzle.config.ts              # Config do Drizzle
```

---

## 4. Arquitetura de Alto Nivel

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (Browser)                     │
│                                                         │
│  React + Vite + TanStack Query + Wouter + Tailwind      │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │Dashboard │ │  Inbox   │ │   CRM    │ │Automacoes │  │
│  │          │ │ (Chat)   │ │(Pipeline)│ │ (Builder) │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘  │
│       │            │            │              │        │
│       └────────────┼────────────┼──────────────┘        │
│                    │                                    │
│           ┌────────┴────────┐                           │
│           │  apiRequest()   │  (fetch wrapper)          │
│           │  WebSocket/SSE  │  (tempo real)             │
│           └────────┬────────┘                           │
└────────────────────┼────────────────────────────────────┘
                     │ HTTPS / WSS
                     │
┌────────────────────┼────────────────────────────────────┐
│               SERVIDOR (Express + Node.js)              │
│                    │                                    │
│  ┌─────────────────┴──────────────────┐                 │
│  │          server/routes.ts          │                 │
│  │   REST API (70+ endpoints /api/*) │                 │
│  └──────┬────────────┬────────────┬───┘                 │
│         │            │            │                     │
│  ┌──────┴──┐  ┌──────┴──┐  ┌─────┴─────┐               │
│  │ Auth    │  │ Storage │  │ Services  │               │
│  │ (JWT)   │  │(IStorage│  │           │               │
│  │         │  │ Drizzle)│  │ WhatsApp  │               │
│  └─────────┘  └────┬────┘  │ GCal      │               │
│                    │       │ Automacao │               │
│                    │       │ IA (GPT)  │               │
│                    │       └─────┬─────┘               │
│                    │             │                      │
│  ┌─────────────────┴─────────────┴─────────────────┐    │
│  │            WebSocket + SSE Hub                  │    │
│  │   (broadcast: new_message, conv_updated, etc.)  │    │
│  └─────────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼──────────────┐
        │            │              │
   ┌────┴────┐ ┌─────┴─────┐ ┌─────┴──────┐
   │PostgreSQL│ │   Z-API   │ │  Google    │
   │  (37     │ │ (WhatsApp)│ │  Calendar  │
   │ tabelas) │ │           │ │  + OpenAI  │
   └──────────┘ └───────────┘ └────────────┘
```

---

## 5. Banco de Dados — 37 Tabelas

### Nucleo do CRM
| Tabela | Descricao |
|---|---|
| `users` | Usuarios com perfil, preferencias, role, equipes |
| `workspaces` | Tenants (multi-tenant) |
| `leads` | Leads/contatos do CRM |
| `lead_tags` | Tags customizaveis para leads |
| `contacts` | Contatos separados |
| `deals` | Oportunidades de negocio |
| `pipelines` | Pipelines (Vendas, Suporte, custom) |
| `pipeline_stages` | Etapas de cada pipeline |
| `teams` | Equipes de trabalho |
| `team_members` | Membros de cada equipe |
| `permissions` | Permissoes RBAC por role |

### Comunicacao
| Tabela | Descricao |
|---|---|
| `conversations` | Conversas (WhatsApp, etc.) |
| `messages` | Mensagens individuais |
| `mensagens_log` | Log detalhado de msgs externas (dedup) |
| `chat_interno` | Chat interno entre atendentes |
| `respostas_rapidas` | Respostas prontas/templates |
| `anotacoes` | Notas internas sobre leads/conversas |

### Automacao & Campanhas
| Tabela | Descricao |
|---|---|
| `automacoes` | Workflows de automacao (nodes/flows) |
| `automacao_logs` | Logs de execucao de automacoes |
| `automation_pending_inputs` | Inputs pendentes de automacoes |
| `automation_variables` | Variaveis dinamicas |
| `campanhas` | Campanhas de envio em massa |
| `disparos_programados` | Agendamento de msgs individuais |

### Integracoes & Conexoes
| Tabela | Descricao |
|---|---|
| `conexoes` | Conexoes WhatsApp (Z-API/Baileys) |
| `webhook_endpoints` | Webhooks de saida (n8n, Zapier) |
| `webhook_logs` | Historico de disparos de webhook |
| `api_tokens` | Tokens de API publica |
| `zapier_config` | Config Zapier por workspace |
| `integration_configs` | Config geral de integracoes |

### Gestao & Financeiro
| Tabela | Descricao |
|---|---|
| `transactions` | Registros financeiros |
| `appointments` | Agenda (integrada com Google Calendar) |
| `disponibilidade` | Horarios de disponibilidade |
| `planos` | Planos de assinatura |
| `notificacoes` | Notificacoes do sistema |

### IA
| Tabela | Descricao |
|---|---|
| `ia_prompts` | Templates de prompts IA |
| `ia_prompt_historico` | Historico de versoes dos prompts |
| `document_templates` | Templates de documentos HTML |

---

## 6. API — Endpoints Principais

### Autenticacao
| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/auth/login` | Login com JWT |
| POST | `/api/auth/register` | Registro + criacao de workspace |
| GET | `/api/auth/me` | Usuario autenticado |

### CRM / Leads
| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/leads` | Listar leads (com filtros) |
| POST | `/api/leads` | Criar lead |
| PATCH | `/api/leads/:id` | Atualizar lead |
| DELETE | `/api/leads/:id` | Remover lead |
| GET/POST | `/api/lead-tags` | Tags de leads |
| GET/POST | `/api/pipelines` | Pipelines |
| GET | `/api/pipeline-stages` | Etapas do pipeline |

### Chat / Mensagens
| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/conversations` | Listar conversas |
| PATCH | `/api/conversations/:id/status` | Atualizar status/pipeline |
| GET | `/api/conversations/:id/messages` | Mensagens da conversa |
| POST | `/api/conversations/:id/messages` | Enviar mensagem |
| GET/POST | `/api/chat-interno/:id` | Chat interno |

### Automacoes
| Metodo | Rota | Descricao |
|---|---|---|
| GET/POST | `/api/automacoes` | CRUD automacoes |
| PUT | `/api/automacoes/:id` | Atualizar automacao |
| PATCH | `/api/automacoes/:id/toggle` | Ativar/desativar |

### Conexoes & Webhooks
| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/conexoes` | Listar conexoes WhatsApp |
| POST | `/api/conexoes/:id/send` | Enviar mensagem via Z-API |
| POST | `/api/webhook/zapi` | Webhook de entrada Z-API |

### Tempo Real
| Protocolo | Rota | Descricao |
|---|---|---|
| WebSocket | `/ws` | Mensagens em tempo real |
| SSE | `/api/sse` | Notificacoes server-push |

---

## 7. Paginas do Frontend (22+)

| Rota | Pagina | Descricao |
|---|---|---|
| `/` | Dashboard | Estatisticas, graficos, metricas |
| `/crm` | CRM | Pipeline Kanban + Contatos + Agenda |
| `/inbox` | Chat | Inbox omnichannel em tempo real |
| `/automacoes` | Automacoes | Builder visual de fluxos |
| `/gestao-conversas` | Gestao | Respostas rapidas + campanhas |
| `/financeiro` | Financeiro | Transacoes e relatorios |
| `/conexoes` | Conexoes | WhatsApp Z-API / Baileys |
| `/integracoes` | Integracoes | Zapier, Google Calendar, Webhooks |
| `/usuarios` | Usuarios | Gestao de equipes e usuarios |
| `/configuracoes` | Config | Configuracoes do workspace |
| `/perfil` | Perfil | Dados pessoais, tema, senha |
| `/billing` | Planos | Assinatura e cobranca |
| `/workspace` | Workspace | Config do workspace |
| `/login` | Login | Autenticacao |
| `/register` | Registro | Criacao de conta |
| `/landing` | Landing | Pagina publica |

---

## 8. Multi-Tenancy

O sistema usa **isolamento por `workspaceId`**:
- Cada usuario pertence a um workspace
- O JWT contem o `workspaceId`
- Todas as queries do banco filtram por `workspaceId`
- Dados de um workspace nunca sao acessiveis por outro

---

## 9. Fluxo de Comunicacao em Tempo Real

```
Telefone → Z-API Webhook → /api/webhook/zapi
                                │
                    ┌───────────┴───────────┐
                    │  Processa mensagem     │
                    │  - Cria/atualiza conv  │
                    │  - Salva mensagem      │
                    │  - Dispara automacao   │
                    │  - Cria notificacao    │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │  Broadcast via WS/SSE │
                    │  new_message          │
                    │  conversation_updated │
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │  Frontend atualiza    │
                    │  Inbox em tempo real  │
                    └───────────────────────┘
```

---

## 10. Motor de Automacoes

O sistema possui um motor de automacoes baseado em **nodes/fluxos**:

- **Triggers**: Nova mensagem, novo lead, palavra-chave, agendamento
- **Acoes**: Enviar mensagem, mover pipeline, atribuir agente, delay, condicional
- **Execucao**: Assíncrona com logs detalhados
- **Variveis**: Dinamicas por lead/workspace

---

## 11. Camada de Storage (Repository Pattern)

`server/storage.ts` implementa o padrao Repository com interface `IStorage`:

```typescript
interface IStorage {
  // Usuarios
  getUser(id), getUsers(wsId), createUser(), updateUser(), deleteUser()

  // Leads
  getLeads(wsId, filtros), createLead(), updateLead(), deleteLead()

  // Conversas
  getConversations(wsId), getMessages(convId), createMessage()

  // Automacoes
  getAutomacoes(wsId), createAutomacao(), incrementExecucoes()

  // Conexoes
  getConexoes(wsId), getWebhookEndpoints(wsId)

  // + 40 metodos adicionais...
}
```

Implementado com **Drizzle ORM** sobre **PostgreSQL**, com suporte a transacoes e filtragem avancada.

---

*Documento gerado em 19/03/2026*
