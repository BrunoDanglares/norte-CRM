# ChatBanana CRM - SaaS CRM Platform

## Overview
ChatBanana CRM is a comprehensive Portuguese-language CRM SaaS platform designed to manage customer relationships, sales pipelines, marketing campaigns, and internal operations. It aims to streamline customer interactions, automate workflows, and provide data-driven insights to enhance efficiency and foster business growth for professional businesses in the Portuguese market.

## User Preferences
I prefer that the agent focuses on the overarching goals and architectural patterns rather than getting bogged down in minor implementation details. When proposing changes or adding new features, prioritize solutions that align with the existing design system and technological stack. I want the agent to use clear, concise language and to explain complex ideas in an understandable manner. I prefer an iterative development approach, where changes are proposed, discussed, and then implemented. Please ask for confirmation before making significant changes to core architectural components or database schemas.

## System Architecture
ChatBanana CRM is a full-stack application leveraging a micro-frontend-like approach within a monorepo structure, incorporating multi-tenant data isolation.

**Frontend:**
- **Technology Stack:** React with TypeScript, Vite, Tailwind CSS, and shadcn/ui.
- **Design System:** Custom sky blue (#58B4F2) + golden yellow (#F5C842) ChatBanana brand theme with "Plus Jakarta Sans" font, including gradient effects.
- **State Management:** TanStack React Query.
- **Routing:** `wouter` for client-side routing.
- **Performance:** Route chunk prefetching, memoization, and critical page preloading.

**Backend:**
- **Technology Stack:** Express.js with TypeScript.
- **Database:** PostgreSQL with Drizzle ORM.
- **Authentication:** JWT-based system.
- **API Design:** RESTful API.

**System Design Choices:**
- **Modularity:** Clear separation of concerns with structured directories and focused modules for backend routes.
- **Automation Engine:** Visual drag-and-drop canvas supporting 26+ node types, expression evaluation, OpenAI integration, dynamic flow control. Includes AI Response Nodes, AI File Attachments, AI Webhooks, and CRM Capabilities via structured tags.
- **Engine ISP Node (`engine_isp`):** Dedicated automation node for autonomous ISP customer service, handling greetings, CPF identification, department classification, ERP integration, billing, and ticket management without external N8N dependency.
- **Tenant Settings:** Per-tenant configuration stored as JSONB for business rules, plans, service hours, and questionnaire data.
- **Questionário de Regras:** 105+ question onboarding questionnaire in 7 sections (Identidade Agente, Atendimento Humano, Financeiro, Comercial, Retenção, Suporte Técnico, Mensagens Automáticas). Auto-saves per page, "Aplicar Regras" maps answers to businessRules + serviceHours + injects context into AI prompts via `questionnaireContext`. Backup/restore of previous rules before applying. Component: `client/src/components/questionario-regras.tsx`. Backend: `POST /api/tenant-settings/apply-questionnaire` and `POST /api/tenant-settings/restore-questionnaire-backup`.
- **Multi-channel Inbox:** 3-column omnichannel design with chat functionalities, agent assignment, pipeline stage selection, tags, quick replies, scheduling, and internal "Chat Secreto".
- **Partner/Gestor System:** Multi-tenant reseller system for `gestor` and `empreendedor` accounts, where Gestores manage client workspaces and bear AI token costs.
- **Satisfaction Survey System:** Configurable surveys with tracking and reporting.
- **Super Admin Panel:** Separate admin interface for user/workspace management, activity logs, and financial management.
- **Structured Logging:** Centralized logging utility with debug, info, warn, and error levels, configurable by environment.
- **OpenAI Key Hierarchy:** Centralized resolution of OpenAI API keys from workspace configurations, environment variables, or proxies.
- **Banana Creator 100% IA Mode:** Generates single-node AI flows for autonomous AI agent operation.
- **ISP Module (Multi-ERP):** Integrates with SGP and IXC Provedor ERP systems for customer management, billing, tickets, and payment options, including AI-ISP integration for automated queries and actions. Features retry mechanisms and error logging.
- **Contact Avatar System:** Resolves contact avatars from multiple sources (uploads, Meta Graph API via `tryFetchMetaProfilePicture`, Baileys `fetchWhatsAppAvatar`, DiceBear fallback). Auto-fetches on new conversations and backfills missing avatars via `POST /api/conversations/refresh-avatars`. Pipeline cards use `GET /api/conversations/avatar-map` to show WhatsApp profile pictures.
- **Protocol System:** Complete ticket/protocol management with auto-generated sequential numbers, SLA tracking, CSAT surveys, and real-time WebSocket updates.
- **Multi-Tenant Data Isolation:** All core tables enforce `workspace_id` in queries for data security.
- **Performance Indexes:** Database indexes on `workspace_id` and composite/unique indexes for common queries.
- **Real-Time Notifications:** Backend `notificacoes` table with WebSocket updates.
- **ISP Pipelines & Teams:** 3 fixed ISP pipelines (Comercial, Suporte, Financeiro) with 7 realistic stages each. 3 fixed teams linked to pipelines. Frontend dynamically reads from API with ISP-aware labels and icons. Existing "vendas" leads map to "comercial" tab. Seed endpoint at `/api/pipelines/seed-isp` re-initializes existing workspaces.
- **Unified Message Processing:** Shared service handles automation triggering, WebSocket broadcasting, notifications, and webhooks for all channels.
- **Unified Channel Router:** Single entry point for outbound messages, routing through Instagram, Meta Cloud API, or Baileys.
- **Instagram DM Integration:** Full Instagram DM channel support via Meta Graph API with OAuth flow.
- **Insta Prospect Module:** Instagram prospection module with AI-powered conversations, supporting various triggers and configurable AI models for qualification.
- **N8N ERP Proxy API:** Endpoint for N8N workflow integration, providing normalized ERP enrichment data and actions via the ISP adapter pattern.
- **ISP Agent Engine (Internal — 100% IA):** Primary AI agent with a multi-phase pipeline for autonomous customer interaction, including audio transcription, image analysis, AI-first intent classification, ERP enrichment, and department selection.
- **Central AI Decision:** Uses GPT-4o-mini for intent classification (`decidirProximoPasso`) with a validation layer (`validarIntentComContexto`) enforced in the pipeline to block fillers, GERAL in active flows, and low-confidence switches (thresholds: 0.7 keyword, 0.8 no keyword).
- **Multi-Agent Architecture:** Modular agent system for Financeiro (F1-F10), Suporte (S1-S13), Comercial (C1-C10), Cancelamento, and Humano intents with situation detection, guard layer validation, and escalation handling.
- **Invoice Selection Logic:** `resolveInvoiceSelection()` in financeiroAgent disambiguates invoice requests — returns `all` (1 invoice or explicit "todas"), `specific` (named), or `ambiguous` (asks client which). All 3 payment paths + n8nAiService AUTO-INJECT respect this. `splitFaturas()` consistently filters overdue + next-30-day invoices across all handlers.
- **Dynamic Payment Menu:** Desbloquear and reclassificação contexts now use tenant rules (allowBarcode/allowPix) to build payment menus instead of hardcoding both options.
- **Suporte Intent Respect:** WiFi/cabo selection requires explicit answer — no WiFi default. "não tenho cabo" in cable test step → offers OS directly instead of treating as test failure. "não consigo reiniciar" in WiFi reboot step → provides guidance instead of treating as unresolved.
- **Comercial Sub-Intent Switching:** ComercialAgent detects when client changes sub-intent within VENDAS (upgrade↔nova_instalacao↔duvidas) and updates session state. F10 ("plano caro") redirect from financeiro properly sets context and overrides stale sub_comercial.
- **HUMANO Escalation Priority:** HUMANO added to STRONG_SWITCH_KEYWORDS with priority bypass in validarIntentComContexto — "falar com atendente" always works regardless of current flow, even during identification stages.
- **Guard Layer:** ABRIR_OS blocks for INADIMPLENTE/SUSPENSO/BLOQUEADO/CORTADO/CANCELADO statuses. Payment choice detection requires prior payment-asking context (etapa=listando_faturas/forma_pagamento_escolhida).
- **Auto Pipeline Lead Management:** `suportePipelineService.ts` auto-creates/updates leads in all 3 ISP pipelines. Stage transitions recorded in `lead_stage_history` table. Suporte: Novo Chamado → Atendimento Remoto → Atendimento Humano → Visita Técnica / Resolvido / Escalado NOC. Financeiro: Consulta de Fatura → Promessa de Pagamento → Atendimento Humano → Pago/Regularizado / Inadimplente/Suspenso. Comercial: Novo Contato → Viabilidade/Proposta → Atendimento Humano → Instalação Agendada / Cliente Ativado / Cliente Perdido. Terminal stages (last 2 per pipeline) archived at end of shift. Hooks in ispAgentEngine at 6 points: dept sub-menu entry, intent dispatch, post-agent etapa, HUMANO escalation, [ESCALAR_HUMANO] tag, guard redirects.
- **Session Atomicity:** `updateSession` uses single atomic SQL UPDATE (sql.join) to prevent race conditions on concurrent messages. Stale reset (4h) preserves CPF/contrato identity.
- **suspendedToFinance:** All SUPORTE→FINANCEIRO reclassification paths now respect `bizRules.suspendedToFinance` tenant config.
- **AI Agent Prompts UI:** User interface for managing AI agent system prompts and ISP situation prompts, allowing live editing and variable substitution. "Situações / Prompts" tab at `/isp/prompts` provides full CRUD for all 33 situation prompts (F1-F10, S1-S13, C1-C10) with agent grouping, search/filter, inline template editing, variable highlighting, active/inactive toggle, seed/restore functionality.
- **ISP Metrics Dashboard:** Analytics page at `/isp/metrics` with overview cards (sessions, resolution rate, escalations, fluid swaps), situation activation table, and timeline chart (recharts). API routes: `GET /api/isp/metrics/overview`, `/metrics/situations`, `/metrics/timeline` with configurable day range (1-90).
- **ISP Agent Simulator:** Test panel at `/isp/prompts` (tab "Testar Agente"). `POST /api/isp/agent/simulate` runs the full engine with message capture (no real WhatsApp send, no conversation_turns, no session metrics). Supports text/button/audio input, shows chat history with inline debug (intent, confidence, prompt, session state). Uses negative conversation IDs to isolate from real data.
- **Seed Protection:** Mechanisms to protect user-customized prompts and situation templates during updates.
- **Input Type Detection:** System tracks input type (button, audio, text) for analytics and prompt context.
- **Multi-Connection Management:** Supports multiple WhatsApp connections per workspace via Baileys or Meta Cloud API.
- **User Management & Permissions:** Portuguese role system with granular permissions, email-based invite flow, and self-registration.

## External Dependencies

**Third-Party Services & APIs:**
- **Baileys:** WhatsApp Web connection.
- **Meta Cloud API:** Official WhatsApp Business API.
- **N8n:** Workflow automation platform.
- **OpenAI:** AI functionalities.
- **Mercado Pago:** Payment link generation.
- **Stripe:** Payment processing and subscription management.
- **Google Calendar (GCal):** Bidirectional calendar synchronization.
- **RD Station:** CRM and marketing automation integration.
- **Zapier:** Workflow automation.
- **Google Gemini:** AI functionalities.

**Database:**
- **PostgreSQL:** Primary relational database.