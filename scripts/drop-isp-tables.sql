-- ============================================================================
-- DROP das tabelas do módulo ISP (Norte Gestão CRM — desacoplamento do ChatBanana)
-- ============================================================================
-- ⚠️  DESTRUTIVO E IRREVERSÍVEL. Apaga dados de produção.
-- ⚠️  NÃO roda no boot. NÃO faz parte do runAutoMigrations.
-- ⚠️  Executar MANUALMENTE, com supervisão do Bruno, e PREFERENCIALMENTE após
--     um dump/backup do banco (pg_dump). Produção não tem staging.
--
-- Contexto: o motor ISP, adapters (SGP/IXC), rotas, serviços e telas foram
-- removidos do código na branch chore/remover-isp. Estas tabelas ficaram
-- órfãs (nenhum código as lê/escreve mais). Este script as elimina do banco.
--
-- MANTIDAS de propósito (dormentes, mas estruturalmente genéricas — NÃO dropar):
--   protocols, protocol_events, protocol_sla_configs   (tickets/SLA genéricos)
--   conversation_situation_tags                         (tags por conversa)
--   agent_trace_events, agent_metrics_5min              (telemetria genérica)
--
-- Como rodar (exemplo):
--   psql "$DATABASE_URL" -f scripts/drop-isp-tables.sql
-- ============================================================================

BEGIN;

-- ERP / provedor ----------------------------------------------------------
DROP TABLE IF EXISTS isp_configs            CASCADE;
DROP TABLE IF EXISTS isp_erp_connections    CASCADE;
DROP TABLE IF EXISTS isp_import_logs         CASCADE;
DROP TABLE IF EXISTS isp_unlock_logs         CASCADE;
DROP TABLE IF EXISTS isp_billing_logs        CASCADE;
DROP TABLE IF EXISTS isp_contract_cache      CASCADE;
DROP TABLE IF EXISTS isp_support_tickets     CASCADE;
DROP TABLE IF EXISTS isp_automation_logs     CASCADE;
DROP TABLE IF EXISTS isp_payment_promises    CASCADE;

-- Motor de agentes / situações / sessão -----------------------------------
DROP TABLE IF EXISTS isp_session_state       CASCADE;
DROP TABLE IF EXISTS isp_session_metrics     CASCADE;
DROP TABLE IF EXISTS isp_situation_prompts   CASCADE;
DROP TABLE IF EXISTS isp_situation_counts    CASCADE;
DROP TABLE IF EXISTS isp_situation_stats     CASCADE;
DROP TABLE IF EXISTS isp_system_events       CASCADE;
DROP TABLE IF EXISTS conversation_turns      CASCADE;

-- Auto-close informacional ------------------------------------------------
DROP TABLE IF EXISTS informational_resolve_pending CASCADE;

-- Retenção / NPS / churn --------------------------------------------------
DROP TABLE IF EXISTS retention_snapshots     CASCADE;
DROP TABLE IF EXISTS churn_events            CASCADE;
DROP TABLE IF EXISTS nps_dispatches          CASCADE;
DROP TABLE IF EXISTS venc_change_log         CASCADE;

-- Avaliação de conversas (LLM-juiz) / evals -------------------------------
DROP TABLE IF EXISTS conversation_evaluations CASCADE;
DROP TABLE IF EXISTS eval_results            CASCADE;
DROP TABLE IF EXISTS eval_runs               CASCADE;
DROP TABLE IF EXISTS eval_cases              CASCADE;
DROP TABLE IF EXISTS write_tool_actions      CASCADE;

-- FAQ / RAG / Knowledge Base ---------------------------------------------
DROP TABLE IF EXISTS faq_ai_gaps             CASCADE;
DROP TABLE IF EXISTS faq_suggestions         CASCADE;
DROP TABLE IF EXISTS faq_embeddings          CASCADE;
DROP TABLE IF EXISTS rag_memory              CASCADE;
DROP TABLE IF EXISTS kb_chunks               CASCADE;
DROP TABLE IF EXISTS kb_documents            CASCADE;
DROP TABLE IF EXISTS customer_memory         CASCADE;

-- Telemetria / IA-piloto órfã (sem prefixo isp_, DDL removida do boot 2026-06-28) -
DROP TABLE IF EXISTS ai_prompt_templates     CASCADE;
DROP TABLE IF EXISTS ai_agent_outcomes       CASCADE;
DROP TABLE IF EXISTS ai_agent_shadow_log     CASCADE;
DROP TABLE IF EXISTS intent_router_audit     CASCADE;
DROP TABLE IF EXISTS v2_decision_stats       CASCADE;
DROP TABLE IF EXISTS smalltalk_log           CASCADE;
DROP TABLE IF EXISTS smalltalk_metrics       CASCADE;

COMMIT;

-- Conferência pós-drop (rodar separado se quiser):
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name LIKE 'isp_%';
