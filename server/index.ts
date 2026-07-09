import "./bootstrapEnv"; // PRIMEIRO: força .env a vencer vars vazias do ambiente (dev). Ver bootstrapEnv.ts
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { teams, workspaces, users, teamMembers, conversations } from "@shared/schema";
import { eq, and, sql, isNull, or } from "drizzle-orm";
import { fetchWithTimeout } from "./utils/helpers";
import { isBlocked } from "./services/tenantBlocklist";
import { isDelinquent } from "./services/subscriptionGate";
import { archiveEndOfShift } from "./services/kanbanArchivalService";
import rateLimit from "express-rate-limit";
import cors from "cors";
import helmet from "helmet";
import { initBroadcast, broadcastToWorkspace } from "./services/broadcast";
export { broadcastToWorkspace };

async function runAutoMigrations() {
  const migrations = [
    // Evolution GO (Bruno 2026-06-09): id interno da instância (≠ instanceId), pro DELETE robusto.
    `ALTER TABLE conexoes ADD COLUMN IF NOT EXISTS evolution_id TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cnpj TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS setor TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS tamanho TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo TEXT`,
    // DROP colunas de contato removidas da UI
    `ALTER TABLE workspaces DROP COLUMN IF EXISTS telefone`,
    `ALTER TABLE workspaces DROP COLUMN IF EXISTS email_corporativo`,
    `ALTER TABLE workspaces DROP COLUMN IF EXISTS endereco`,
    `ALTER TABLE workspaces DROP COLUMN IF EXISTS website`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS razao_social TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS assinantes TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS white_label_name TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS white_label_logo TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS partner_plan TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS partner_since TIMESTAMP`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_subscription_status TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_price_id TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_current_period_end TIMESTAMP`,
    // Asaas (billing atual) — stripe_* acima ficam dormentes.
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS asaas_subscription_status TEXT`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS asaas_next_due_date TIMESTAMP`,
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false`,
    // Bruno 2026-06-19 — pagamento primeiro: plano escolhido fica "pendente" até o
    // Asaas confirmar o pagamento; o webhook promove pending_plano_id → plano_id.
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS pending_plano_id UUID`,
    // ── Tabelas novas (CREATE TABLE IF NOT EXISTS) ────────────────────────
    `CREATE TABLE IF NOT EXISTS tenant_settings (
      id SERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL,
      settings_json JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tenant_settings_tenant_id_unique ON tenant_settings(tenant_id)`,
    `CREATE TABLE IF NOT EXISTS lead_stage_history (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL,
      conversation_id INTEGER,
      pipeline TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      to_stage_label TEXT,
      trigger TEXT,
      workspace_id UUID NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `DROP TABLE IF EXISTS zapier_config`,
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS cpf TEXT`,
    // Snapshot do contato preservado no protocolo pra sobreviver a delete de conversa/lead.
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS contato_nome TEXT`,
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS contato_telefone TEXT`,
    // Multi-departamento: uma conversa pode passar por financeiro + suporte.
    // Array acumula todos os setores tocados; `categoria` continua como
    // primário/dominante. UI pode listar todos os departamentos do protocolo.
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS departamentos TEXT[]`,
    // ── Tempo de atendimento (Bruno 2026-05-17) ──────────────────────────────
    // Separação: quanto tempo o bot conduziu vs quanto tempo o humano assumiu.
    // Atualizado por triggers na transição de bucket (bot → humano → bot).
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS tempo_bot_seconds INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS tempo_humano_seconds INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS last_bucket_start_at TIMESTAMP`,
    `ALTER TABLE protocols ADD COLUMN IF NOT EXISTS last_bucket TEXT`,
    // ── Ficha do cliente — Bruno 2026-05-11 ──────────────────────────────────
    // Campos cadastrais opcionais editáveis no dialog de perfil. Idempotente.
    // Espelhados em contacts e leads pra que o dialog de Editar funcione direto.
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS cpf TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS endereco_rua TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS endereco_numero TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS endereco_bairro TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS endereco_cidade TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS endereco_uf TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS endereco_cep TEXT`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS data_nascimento TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS cpf TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_rua TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_numero TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_bairro TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_cidade TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_uf TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS endereco_cep TEXT`,
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_nascimento TEXT`,
    `UPDATE pipeline_stages SET label = 'Resolvido/Regularizado' WHERE label = 'Pago / Regularizado'`,
    `UPDATE pipeline_stages SET label = 'Não Resolvido' WHERE label = 'Inadimplente/Suspenso/Cancelado'`,
    // ── team_members.role: coluna usada por insert/leitura pra distinguir
    // membros do time (ex: 'lead', 'agent'). Opcional pra retrocompat com
    // tenants antigos que não tinham essa coluna.
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS role TEXT`,
    // Coluna `created_at` em `users`: usada em getAllUsersAdmin (ordenação cronológica).
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
    // Coluna `conversation_id` em `whatsapp_webhook_events`: usada em
    // webhook-meta pra correlacionar status updates (sent/delivered/read)
    // com a conversa do CRM.
    `ALTER TABLE whatsapp_webhook_events ADD COLUMN IF NOT EXISTS conversation_id INTEGER`,
    // ── Corrige protocolos criados com created_at = closed_at (bug de auto-criação no resolve) ──
    `UPDATE protocols p SET created_at = c.created_at FROM conversations c WHERE p.conversation_id = c.id AND p.closed_at IS NOT NULL AND ABS(EXTRACT(EPOCH FROM (p.created_at - p.closed_at))) < 10 AND c.created_at < p.closed_at`,
    // ── Índices de performance para protocols ──
    `CREATE INDEX IF NOT EXISTS idx_protocols_workspace_created ON protocols(workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_protocols_workspace_status ON protocols(workspace_id, status)`,
    // UNIQUE (workspace_id, numero) — auditoria P1-3 (Bruno, 2026-05-11):
    // generateProtocolNumber faz SELECT MAX+1; em alta concorrência 2 webhooks
    // simultâneos podem gerar o mesmo número. O índice UNIQUE garante que
    // duplicatas falham com erro 23505, e a função criarProtocolo faz retry.
    // Idempotente: CREATE UNIQUE INDEX IF NOT EXISTS — não falha se já existe.
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_protocols_ws_numero ON protocols(workspace_id, numero)`,
    // ── Template defaults (Fase 4 da revisão ISP): config do workspace do
    //    dono vira default herdado por novos tenants. Apenas UM workspace
    //    deveria ter is_template_source=true por vez.
    `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_template_source BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS inherited_from_template BOOLEAN DEFAULT FALSE`,
    // ── Audit log LGPD de acesso ao relatório diário do ISP ──
    `CREATE TABLE IF NOT EXISTS daily_report_access_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      report_date DATE NOT NULL,
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address TEXT,
      user_agent TEXT,
      action VARCHAR(30) NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_darl_workspace_date ON daily_report_access_log(workspace_id, report_date)`,
    `CREATE INDEX IF NOT EXISTS idx_darl_user_date ON daily_report_access_log(user_id, accessed_at)`,
    // pipeline_stages: constraint global de key quebrava cadastro de novos tenants
    // (mesma key em pipelines diferentes do mesmo workspace é legítimo).
    // Troca pra unique composto (workspace_id, pipeline, key).
    `ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_key_unique`,
    `CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_ws_pipeline_key_unique ON pipeline_stages(workspace_id, pipeline, key)`,
    // whatsapp_official_connections: app_secret por tenant (HMAC dos webhooks Meta).
    // Criptografado com ENCRYPTION_KEY. Nullable — tenants antigos caem no fallback de env.
    `ALTER TABLE whatsapp_official_connections ADD COLUMN IF NOT EXISTS app_secret TEXT`,
    // ── LGPD: tabela de mídia recebida do cliente com retenção controlada ──
    `CREATE TABLE IF NOT EXISTS media_assets (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      conversation_id INTEGER,
      media_url       TEXT NOT NULL,
      mime_type       TEXT,
      category        VARCHAR(30) NOT NULL DEFAULT 'unclassified',
      created_at      TIMESTAMP DEFAULT now() NOT NULL,
      expires_at      TIMESTAMP NOT NULL,
      purged_at       TIMESTAMP,
      source          VARCHAR(20)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS media_assets_url_unique ON media_assets(media_url)`,
    `CREATE INDEX IF NOT EXISTS idx_media_assets_purge ON media_assets(expires_at) WHERE purged_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_media_assets_ws_created ON media_assets(workspace_id, created_at)`,
    // Coluna que liga cada mensagem ao protocolo aberto da conversa naquele
    // momento. Permite renderizar separador horizontal entre protocolos
    // diferentes do mesmo contato e ancorar rolagem ao abrir via protocolo.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS protocolo_id UUID`,
    `CREATE INDEX IF NOT EXISTS idx_messages_protocolo ON messages(protocolo_id)`,
    // Auditoria de atividade por usuário (modal Logs do super-admin): evita full-scan
    // na maior tabela ao listar mensagens apagadas por um atendente. Parcial = só as
    // linhas com autor de deleção (a imensa maioria é NULL).
    `CREATE INDEX IF NOT EXISTS idx_messages_deleted_by ON messages(deleted_by_user_id) WHERE deleted_by_user_id IS NOT NULL`,
    // Dedup de mensagens recebidas: armazena o ID externo (id do canal não-oficial,
    // wamid da Meta, mid do Instagram) e usa UNIQUE INDEX parcial para rejeitar
    // reinserção da mesma mensagem após restart/reconexão. NULL é permitido
    // múltiplas vezes (mensagens internas/saídas que não têm ID externo).
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id TEXT`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_external_id ON messages(external_message_id) WHERE external_message_id IS NOT NULL`,
    // Bruno 2026-05-19: ações no menu de contexto da mensagem (excluir, editar, responder).
    // deleted_at + deleted_by_user_id: soft-delete (mensagem some do painel mas histórico preservado pra auditoria).
    // edited_at + original_texto: edição preserva texto original; UI mostra "(editada)".
    // reply_to_message_id: FK pra messages.id quando atendente cita uma msg ao responder.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS original_texto TEXT`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id INTEGER`,
    // Bruno 2026-05-21: metadata estruturada pra tipos especiais (contato vCard,
    // localização lat/long). Tipos contact/location populam esse JSONB; texto
    // continua humanizado pra fallback de canais que não suportam o tipo.
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_metadata JSONB`,
    // Agent trace events — Bruno 2026-05-12. Timeline de decisões do agente
    // por conversa, ferramenta de diagnóstico interna (sem UI). Consulta via
    // scripts/trace.ts. Auto-purge >30d roda no boot scheduler.
    `CREATE TABLE IF NOT EXISTS agent_trace_events (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id    UUID NOT NULL,
      conversation_id INTEGER NOT NULL,
      protocol_id     UUID,
      stage           VARCHAR(40) NOT NULL,
      payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_trace_conv_created ON agent_trace_events(conversation_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_trace_created ON agent_trace_events(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_trace_ws_stage ON agent_trace_events(workspace_id, stage, created_at DESC)`,

    // Bruno 2026-05-27 (Frente 3 rastreabilidade): métricas agregadas 5min do Agent V2.
    // Detecta regressões silenciosas (escalação ↑, latência ↑, tools failing).
    `CREATE TABLE IF NOT EXISTS agent_metrics_5min (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id         UUID NOT NULL,
      bucket_start         TIMESTAMP NOT NULL,
      sector               VARCHAR(32),
      total_turnos         INTEGER NOT NULL DEFAULT 0,
      count_escalation     INTEGER NOT NULL DEFAULT 0,
      count_consultative   INTEGER NOT NULL DEFAULT 0,
      count_handler_error  INTEGER NOT NULL DEFAULT 0,
      count_tools_called   INTEGER NOT NULL DEFAULT 0,
      count_tools_failed   INTEGER NOT NULL DEFAULT 0,
      count_tools_slow     INTEGER NOT NULL DEFAULT 0,
      avg_total_ms         INTEGER,
      p95_total_ms         INTEGER,
      max_total_ms         INTEGER,
      created_at           TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_metrics_5min_ws_bucket ON agent_metrics_5min(workspace_id, bucket_start DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_metrics_5min_bucket ON agent_metrics_5min(bucket_start DESC)`,

    // Bruno (2026-05-13): renomear equipe canônica de "Suporte Técnico" pra
    // "Suporte" em todos workspaces. Aplica em batch idempotente — a 2ª vez
    // não bate em linha alguma. Conditional via subquery garante que se o ws
    // já tem equipe "Suporte" (caso raro de duplicata), não cria conflito.
    `UPDATE teams SET nome = 'Suporte'
       WHERE nome IN ('Suporte Técnico', 'Suporte Tecnico')
         AND NOT EXISTS (
           SELECT 1 FROM teams t2
           WHERE t2.workspace_id = teams.workspace_id
             AND t2.nome = 'Suporte'
             AND t2.id <> teams.id
         )`,
    // Atualizar conversations.agente que tenha "[Equipe] Suporte Técnico"
    // pra refletir o novo nome — sem isso o badge na UI fica desatualizado.
    `UPDATE conversations SET agente = '[Equipe] Suporte'
       WHERE agente IN ('[Equipe] Suporte Técnico', '[Equipe] Suporte Tecnico')`,
    // attending_started_at — início do atendimento atual (reseta no reopen)
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attending_started_at TIMESTAMP DEFAULT NOW()`,
    `UPDATE conversations SET attending_started_at = created_at WHERE attending_started_at IS NULL`,
    // Bruno 2026-05-21: o default informationalResolveTimeoutSec era 180 (modelo
    // antigo de 1 estágio = 3min direto pro CSAT). Quando refatorou pra 2 estágios
    // em 144d683b, esqueceu de migrar tenants existentes — eles ficaram com 180
    // no JSONB, o que faz stage 0 disparar em 3min em vez de 5min. Idempotente:
    // só atualiza onde o valor é exatamente 180 (não toca em tenants que
    // customizaram pra outro valor).
    `UPDATE tenant_settings
       SET settings_json = jsonb_set(
         settings_json,
         '{businessRules,informationalResolveTimeoutSec}',
         to_jsonb(300)
       ),
       updated_at = NOW()
     WHERE (settings_json->'businessRules'->>'informationalResolveTimeoutSec')::int = 180`,
    // Bruno 2026-05-19: rastreabilidade de transferência manual entre atendentes.
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS transferred_from_user_id INTEGER`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS transferred_from_user_name TEXT`,
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMP`,
    // Bruno 2026-05-20: direção da última mensagem da conversa. Frontend usa
    // pra destacar em negrito o preview no card quando a última msg foi do
    // cliente (estilo WhatsApp: msg não lida fica destacada). Atualizada via
    // trigger AFTER INSERT em messages — não dependemos de cada caller que
    // hoje seta ultima_mensagem manualmente.
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_direction TEXT`,
    // Bruno 2026-05-29: conversa de SIMULAÇÃO ao vivo (UI assistir + zero delay).
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN NOT NULL DEFAULT false`,
    // Bruno 2026-06-13: histórico PERMANENTE das situações da conversa (cards/relatórios).
    // As tags vivas (conversation_situation_tags) são apagadas no resolve; este array
    // acumula no applySituation e nunca é apagado.
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS situacoes_finais TEXT[]`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_is_simulation ON conversations(workspace_id, is_simulation) WHERE is_simulation = true`,
    `CREATE OR REPLACE FUNCTION update_conv_last_msg_direction() RETURNS TRIGGER AS $$
     BEGIN
       IF NEW.direction IN ('in', 'out') THEN
         UPDATE conversations
           SET last_message_direction = NEW.direction
           WHERE id = NEW.conversation_id
             AND workspace_id = NEW.workspace_id;
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS trg_update_conv_last_msg_direction ON messages`,
    `CREATE TRIGGER trg_update_conv_last_msg_direction
       AFTER INSERT ON messages
       FOR EACH ROW
       EXECUTE FUNCTION update_conv_last_msg_direction()`,
    // Backfill inicial: pra conversas existentes, popula com a direção da
    // mensagem mais recente. Subqueries lateral em PG14+ — Hostinger usa 15.
    `UPDATE conversations c SET last_message_direction = m.direction
       FROM (
         SELECT DISTINCT ON (conversation_id) conversation_id, direction
         FROM messages
         WHERE direction IN ('in','out')
         ORDER BY conversation_id, created_at DESC
       ) m
       WHERE m.conversation_id = c.id AND c.last_message_direction IS NULL`,
    // Bruno 2026-05-20: reactions de emoji em mensagens (estilo WhatsApp).
    `CREATE TABLE IF NOT EXISTS message_reactions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       message_id INTEGER NOT NULL,
       conversation_id INTEGER NOT NULL,
       workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       user_id INTEGER NOT NULL,
       user_name TEXT,
       emoji TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_reactions_message ON message_reactions(message_id)`,
    `CREATE INDEX IF NOT EXISTS idx_msg_reactions_conv ON message_reactions(conversation_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_msg_reaction_user_emoji
       ON message_reactions(user_id, message_id, emoji)`,
    // Bruno 2026-05-28 (Onda 3.3 tags/persistência): audit forense de tags.
    // Coluna `motivo` opcional pra rastrear PORQUE tag foi aplicada
    // (escalateFallback, cancelMotivo signal, complaint, etc) além de
    // QUEM/QUANDO (origin + appliedBy + createdAt já existiam).
    `ALTER TABLE conversation_situation_tags ADD COLUMN IF NOT EXISTS motivo TEXT`,
    // Bruno 2026-06-03: histórico de login/logout dos atendentes
    // (Relatórios → Atendentes → Logs de autenticação). Começa vazio e enche
    // a partir de agora — login abre sessão, logout/heartbeat fecham/renovam.
    `CREATE TABLE IF NOT EXISTS auth_sessions (
       id SERIAL PRIMARY KEY,
       workspace_id UUID,
       user_id INTEGER NOT NULL,
       user_nome TEXT,
       ip TEXT,
       user_agent TEXT,
       login_at TIMESTAMP DEFAULT now(),
       last_seen_at TIMESTAMP DEFAULT now(),
       logout_at TIMESTAMP,
       created_at TIMESTAMP DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_ws_login ON auth_sessions(workspace_id, login_at)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_open ON auth_sessions(user_id, logout_at)`,
    // Bruno 2026-06-05: disparo por template oficial (Meta) vs texto livre (Evolution).
    `ALTER TABLE disparos_programados ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'texto_livre'`,
    `ALTER TABLE disparos_programados ADD COLUMN IF NOT EXISTS channel_forced TEXT`,
    `ALTER TABLE disparos_programados ADD COLUMN IF NOT EXISTS template_name TEXT`,
    `ALTER TABLE disparos_programados ADD COLUMN IF NOT EXISTS template_language TEXT DEFAULT 'pt_BR'`,
    `ALTER TABLE disparos_programados ADD COLUMN IF NOT EXISTS template_variables JSONB`,
    `ALTER TABLE disparos_programados ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'manual'`,
    // Bruno 2026-06-09: grade de planos por canais + clientes (ERP/SGP) + link Stripe.
    `ALTER TABLE planos ADD COLUMN IF NOT EXISTS limite_canais INTEGER`,
    `ALTER TABLE planos ADD COLUMN IF NOT EXISTS limite_clientes INTEGER`,
    `ALTER TABLE planos ADD COLUMN IF NOT EXISTS stripe_price_id TEXT`,
    // ── Login social (Google) + login sem senha por código (Bruno 2026-06-15) ──
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'local'`,
    // Revogação de sessão por versão de token (auditoria 2026-06-20)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`,
    // Único parcial: dois usuários não podem ter o mesmo google_id, mas vários
    // podem ter google_id NULL (contas só-senha).
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS login_codes (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      identifier  TEXT NOT NULL,
      channel     TEXT NOT NULL,
      code_hash   TEXT NOT NULL,
      expires_at  TIMESTAMP NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      consumed_at TIMESTAMP,
      ip          TEXT,
      created_at  TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_login_codes_identifier ON login_codes(identifier)`,
    `CREATE INDEX IF NOT EXISTS idx_login_codes_created ON login_codes(created_at)`,

    // Historico de eventos de assinatura da PLATAFORMA — alimenta MRR ao longo do
    // tempo + Churn no painel super-admin. Bruno 2026-06-19.
    `CREATE TABLE IF NOT EXISTS subscription_events (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      event_type    TEXT NOT NULL,
      plano_id      UUID REFERENCES planos(id),
      mrr           NUMERIC(10,2),
      details       JSONB DEFAULT '{}'::jsonb,
      created_at    TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subevents_ws ON subscription_events(workspace_id)`,
    `CREATE INDEX IF NOT EXISTS idx_subevents_created ON subscription_events(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_respostas_rapidas_workspace ON respostas_rapidas(workspace_id)`,

    // ── Funil de vendas editável do CRM (Bruno 2026-06-28) ───────────────────
    // Camada de EXIBIÇÃO por cima do backbone operacional (pipeline_stages).
    // O bot NÃO toca aqui: segue gravando lead.status com os 5 prefixos
    // universais; estas colunas só decidem ONDE o card aparece no CRM.
    // auto_states=[] → coluna manual (card fica via leads.display_column).
    `CREATE TABLE IF NOT EXISTS pipeline_columns (
      id            SERIAL PRIMARY KEY,
      pipeline      TEXT NOT NULL DEFAULT 'comercial',
      key           TEXT NOT NULL,
      label         TEXT NOT NULL,
      color         TEXT NOT NULL DEFAULT '#7c5cbf',
      ordem         INTEGER NOT NULL DEFAULT 0,
      auto_states   TEXT[] NOT NULL DEFAULT '{}',
      is_terminal   BOOLEAN NOT NULL DEFAULT FALSE,
      terminal_reason TEXT,
      workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at    TIMESTAMP DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS pipeline_columns_ws_pipeline_key_unique ON pipeline_columns(workspace_id, pipeline, key)`,
    // Posição manual do card no funil (NULL = segue o bot).
    `ALTER TABLE leads ADD COLUMN IF NOT EXISTS display_column TEXT`,

    // ── INSTAFLIX — automação de postagem no Instagram (Bruno 2026-07-04) ─────
    // Módulo à parte do Insta Prospect (DM). IA gera arte+legenda, agenda e publica.
    `CREATE TABLE IF NOT EXISTS instaflix_brand_kits (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      instagram_connection_id  UUID REFERENCES instagram_connections(id) ON DELETE CASCADE,
      nome                     TEXT NOT NULL DEFAULT 'Marca principal',
      descricao_negocio        TEXT,
      publico_alvo             TEXT,
      tom_voz                  TEXT,
      paleta_cores             JSONB DEFAULT '[]'::jsonb,
      fontes                   JSONB DEFAULT '{}'::jsonb,
      logo_url                 TEXT,
      hashtags_padrao          JSONB DEFAULT '[]'::jsonb,
      diretrizes               TEXT,
      exemplos_legendas        JSONB DEFAULT '[]'::jsonb,
      temas_recorrentes        JSONB DEFAULT '[]'::jsonb,
      fontes_conhecimento      JSONB DEFAULT '{}'::jsonb,
      base_conhecimento        JSONB DEFAULT '[]'::jsonb,
      ativo                    BOOLEAN DEFAULT true,
      ultima_sincronizacao     TIMESTAMP,
      created_at               TIMESTAMP NOT NULL DEFAULT now(),
      updated_at               TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS instaflix_brand_kits_workspace_idx ON instaflix_brand_kits(workspace_id)`,
    // Fontes de munição extra do brand kit (Bruno 2026-07-04)
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS produtos_servicos TEXT`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS site_url TEXT`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS site_resumo TEXT`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS faq_clientes JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS prova_social JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS documentos JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS logos JSONB DEFAULT '[]'::jsonb`,
    `CREATE TABLE IF NOT EXISTS instagram_data_deletions (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      confirmation_code  TEXT NOT NULL UNIQUE,
      ig_user_id         TEXT,
      status             TEXT NOT NULL DEFAULT 'completed',
      created_at         TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS segmento TEXT`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS onboarding_concluido BOOLEAN DEFAULT false`,
    `ALTER TABLE instaflix_brand_kits ADD COLUMN IF NOT EXISTS planos_valores TEXT`,
    `CREATE TABLE IF NOT EXISTS instaflix_pillars (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      nome          TEXT NOT NULL,
      descricao     TEXT,
      objetivo      TEXT DEFAULT 'autoridade',
      peso          INTEGER DEFAULT 1,
      prompt_guia   TEXT,
      exemplos      JSONB DEFAULT '[]'::jsonb,
      ativo         BOOLEAN DEFAULT true,
      created_at    TIMESTAMP NOT NULL DEFAULT now(),
      updated_at    TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS instaflix_pillars_workspace_idx ON instaflix_pillars(workspace_id)`,
    `CREATE TABLE IF NOT EXISTS instaflix_schedule_rules (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      instagram_connection_id  UUID REFERENCES instagram_connections(id) ON DELETE CASCADE,
      pillar_id                UUID REFERENCES instaflix_pillars(id) ON DELETE SET NULL,
      nome                     TEXT NOT NULL,
      formato                  TEXT NOT NULL DEFAULT 'carrossel',
      dias_semana              JSONB DEFAULT '[]'::jsonb,
      horarios                 JSONB DEFAULT '[]'::jsonb,
      timezone                 TEXT DEFAULT 'America/Sao_Paulo',
      num_imagens              INTEGER DEFAULT 3,
      approval_mode            TEXT DEFAULT 'requer_aprovacao',
      antecedencia_horas       INTEGER DEFAULT 24,
      ativo                    BOOLEAN DEFAULT true,
      created_at               TIMESTAMP NOT NULL DEFAULT now(),
      updated_at               TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS instaflix_schedule_rules_workspace_idx ON instaflix_schedule_rules(workspace_id)`,
    `CREATE TABLE IF NOT EXISTS instaflix_posts (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      instagram_connection_id  UUID REFERENCES instagram_connections(id) ON DELETE CASCADE,
      rule_id                  UUID REFERENCES instaflix_schedule_rules(id) ON DELETE SET NULL,
      pillar_id                UUID REFERENCES instaflix_pillars(id) ON DELETE SET NULL,
      formato                  TEXT NOT NULL DEFAULT 'carrossel',
      tema                     TEXT,
      brief_ia                 JSONB DEFAULT '{}'::jsonb,
      legenda                  TEXT,
      hashtags                 JSONB DEFAULT '[]'::jsonb,
      midias                   JSONB DEFAULT '[]'::jsonb,
      status                   TEXT NOT NULL DEFAULT 'rascunho',
      approval_mode            TEXT DEFAULT 'requer_aprovacao',
      gerado_por               TEXT DEFAULT 'ia',
      scheduled_at             TIMESTAMP,
      published_at             TIMESTAMP,
      aprovado_por             TEXT,
      ig_container_id          TEXT,
      ig_media_id              TEXT,
      ig_permalink             TEXT,
      error_message            TEXT,
      tentativas               INTEGER DEFAULT 0,
      progresso                INTEGER DEFAULT 0,
      metadata                 JSONB DEFAULT '{}'::jsonb,
      created_at               TIMESTAMP NOT NULL DEFAULT now(),
      updated_at               TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS instaflix_posts_workspace_idx ON instaflix_posts(workspace_id)`,
    `CREATE INDEX IF NOT EXISTS instaflix_posts_status_sched_idx ON instaflix_posts(status, scheduled_at)`,
    `ALTER TABLE instaflix_posts ADD COLUMN IF NOT EXISTS progresso INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS instaflix_post_metrics (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      post_id           UUID NOT NULL REFERENCES instaflix_posts(id) ON DELETE CASCADE,
      ig_media_id       TEXT,
      alcance           INTEGER DEFAULT 0,
      impressoes        INTEGER DEFAULT 0,
      curtidas          INTEGER DEFAULT 0,
      comentarios       INTEGER DEFAULT 0,
      salvamentos       INTEGER DEFAULT 0,
      compartilhamentos INTEGER DEFAULT 0,
      raw               JSONB DEFAULT '{}'::jsonb,
      coletado_at       TIMESTAMP NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS instaflix_post_metrics_workspace_idx ON instaflix_post_metrics(workspace_id)`,
    `CREATE INDEX IF NOT EXISTS instaflix_post_metrics_post_idx ON instaflix_post_metrics(post_id)`,
  ];

  // ── Migration markers: skip de DDLs já aplicadas ─────────────────────────
  // Antes desta lógica, as ~80 DDLs idempotentes acima rodavam a CADA boot —
  // funcionava (IF NOT EXISTS protege), mas o boot acumulava 1-2s só nelas
  // e crescia linearmente com o array. Agora, cada DDL recebe um id estável
  // (sha1 da string SQL) e só roda se ainda não tem marker em
  // `_isp_migrations`. Mudar o texto da DDL — mesmo um whitespace — gera id
  // novo e ela roda de novo: aceitável porque DDLs já são idempotentes.
  const { createHash } = await import('node:crypto');
  const migrationId = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

  await db.execute(sql.raw(
    `CREATE TABLE IF NOT EXISTS _isp_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`
  )).catch(() => {});

  let appliedSet = new Set<string>();
  try {
    const rows: any = await db.execute(sql.raw(`SELECT id FROM _isp_migrations`));
    const list = rows?.rows ?? rows ?? [];
    for (const r of list) appliedSet.add(r.id);
  } catch {}

  let applied = 0;
  let skipped = 0;
  for (const stmt of migrations) {
    const id = migrationId(stmt);
    if (appliedSet.has(id)) {
      skipped++;
      continue;
    }
    try {
      await db.execute(sql.raw(stmt));
      await db.execute(sql.raw(
        `INSERT INTO _isp_migrations (id) VALUES ('${id}') ON CONFLICT DO NOTHING`
      )).catch(() => {});
      applied++;
    } catch (_) {}
  }
  console.log(`[AutoMigration] ✅ ${applied} aplicadas, ${skipped} já-aplicadas (${migrations.length} total)`);

  // ── Backfill idempotente: categoria de protocolos legados ────────────────
  // Auditoria P2-4 (Bruno, 2026-05-11): protocolos criados antes da migração
  // de categoria existir, OU em race condition, ficaram com `categoria='geral'`
  // mesmo tendo tags específicas (S*/F*/C*). Esse backfill normaliza:
  // protocolos com categoria genérica + ao menos uma tag de setor herdam
  // a categoria do prefixo da tag.
  try {
    const catBackfill: any = await db.execute(sql.raw(`
      UPDATE protocols p
      SET categoria = sub.nova_categoria,
          departamentos = COALESCE(
            (
              SELECT array_agg(DISTINCT d)
              FROM unnest(COALESCE(p.departamentos, ARRAY[]::text[]) || ARRAY[sub.nova_categoria]) AS d
            ),
            ARRAY[sub.nova_categoria]
          ),
          updated_at = NOW()
      FROM (
        SELECT
          p2.id,
          CASE
            WHEN EXISTS (SELECT 1 FROM unnest(p2.tags) t WHERE t LIKE 'S%') THEN 'suporte_tecnico'
            WHEN EXISTS (SELECT 1 FROM unnest(p2.tags) t WHERE t LIKE 'F%') THEN 'financeiro'
            WHEN EXISTS (SELECT 1 FROM unnest(p2.tags) t WHERE t LIKE 'C%') THEN 'comercial'
          END AS nova_categoria
        FROM protocols p2
        WHERE p2.categoria IN ('geral', 'atendimento')
          AND p2.tags IS NOT NULL
          AND array_length(p2.tags, 1) > 0
      ) sub
      WHERE p.id = sub.id
        AND sub.nova_categoria IS NOT NULL
    `));
    const catRows = (catBackfill as any)?.rowCount ?? 0;
    if (catRows > 0) {
      console.log(`[AutoMigration] 🏷️ Backfill categoria via tags: ${catRows} protocolo(s) normalizados`);
    }
  } catch (err: any) {
    console.error(`[AutoMigration] Backfill categoria falhou (não-fatal):`, err.message);
  }

  // ── Backfill idempotente: associa mensagens órfãs ao protocolo correto ────
  // Para cada mensagem sem `protocolo_id`, encontra o protocolo da mesma
  // conversa cuja janela [createdAt, closedAt OR resolvedAt OR Infinity) contém
  // o timestamp da mensagem. Roda em UPDATE FROM com lateral join — eficiente
  // e idempotente (só toca linhas com protocolo_id IS NULL).
  try {
    const result: any = await db.execute(sql.raw(`
      UPDATE messages m
      SET protocolo_id = sub.protocol_id
      FROM (
        SELECT DISTINCT ON (m2.id)
          m2.id AS msg_id,
          p.id AS protocol_id
        FROM messages m2
        JOIN protocols p
          ON p.conversation_id = m2.conversation_id
         AND p.workspace_id   = m2.workspace_id
         AND p.created_at    <= COALESCE(m2.created_at, NOW())
         AND COALESCE(p.closed_at, 'infinity'::timestamp) > COALESCE(m2.created_at, NOW())
        WHERE m2.protocolo_id IS NULL
        ORDER BY m2.id, p.created_at DESC
      ) sub
      WHERE m.id = sub.msg_id
    `));
    const rowCount = (result as any)?.rowCount ?? (Array.isArray(result) ? result.length : 0);
    if (rowCount > 0) {
      console.log(`[AutoMigration] 🔗 Backfill protocolo_id: ${rowCount} mensagens associadas`);
    }
  } catch (err: any) {
    console.error(`[AutoMigration] Backfill protocolo_id falhou (não-fatal):`, err.message);
  }

  // ── Backfill idempotente: desfaz "plano contratado antes de pagar" ────────
  // Bruno 2026-06-19: antes do fix "pagamento primeiro", o /api/asaas/subscribe
  // gravava plano_id NA HORA (status 'pending') → o plano aparecia como
  // contratado/atual sem pagamento. Agora o plano só é atribuído quando o Asaas
  // confirma; este backfill conserta os registros JÁ afetados: move
  // plano_id → pending_plano_id (o webhook promove de volta ao confirmar o
  // pagamento). Só toca status='pending' com plano_id setado e pending vazio →
  // idempotente e seguro (não mexe em 'active'/'trialing'/'past_due'/'canceled').
  try {
    const billingFix: any = await db.execute(sql.raw(`
      UPDATE workspaces
         SET pending_plano_id = plano_id,
             plano_id = NULL
       WHERE asaas_subscription_status = 'pending'
         AND plano_id IS NOT NULL
         AND pending_plano_id IS NULL
    `));
    const bfRows = (billingFix as any)?.rowCount ?? 0;
    if (bfRows > 0) {
      console.log(`[AutoMigration] 💳 Backfill pagamento-primeiro: ${bfRows} workspace(s) com plano pendente desfeito (aguardando pagamento)`);
    }
  } catch (err: any) {
    console.error(`[AutoMigration] Backfill pagamento-primeiro falhou (não-fatal):`, err.message);
  }
}

async function ensureDefaultTeams() {
  const allWorkspaces = await db.select().from(workspaces);
  // Bruno 2026-06-28: CRM genérico — a ÚNICA equipe nativa default é Comercial.
  // Suporte/Financeiro deixaram de ser nativas (eram herança do ISP): não são mais
  // recriadas e, se existirem, são DESTRAVADAS (fixed=false) pra poderem ser
  // excluídas pela tela. Nada é apagado automaticamente.
  const defaultTeams = [
    { nome: "Comercial", descricao: "Equipe de vendas e novos contratos", pipelineKey: "comercial" },
  ];
  const legacyFixedNames = ["Suporte", "Financeiro"];

  for (const ws of allWorkspaces) {
    const wsAdmins = await db.select().from(users)
      .where(and(eq(users.workspaceId, ws.id), eq(users.role, "admin")));

    for (const dt of defaultTeams) {
      const existing = await db.select().from(teams)
        .where(and(eq(teams.nome, dt.nome), eq(teams.workspaceId, ws.id)))
        .limit(1);

      let teamId: string;
      if (existing.length === 0) {
        const [created] = await db.insert(teams).values({
          nome: dt.nome,
          descricao: dt.descricao,
          pipelineKey: dt.pipelineKey,
          workspaceId: ws.id,
          fixed: true,
          active: true,
        }).returning();
        teamId = created.id;
      } else {
        teamId = existing[0].id;
        if (!existing[0].fixed) {
          await db.update(teams).set({ fixed: true, pipelineKey: dt.pipelineKey }).where(eq(teams.id, teamId));
        }
      }

      for (const admin of wsAdmins) {
        await db.insert(teamMembers).values({ teamId, userId: admin.id }).onConflictDoNothing();
      }
    }

    // Destrava as antigas equipes nativas do ISP pra que possam ser excluídas pela
    // tela (o DELETE /api/equipes bloqueia fixed=true). Não apaga — só remove a trava.
    for (const oldName of legacyFixedNames) {
      await db.update(teams).set({ fixed: false })
        .where(and(eq(teams.nome, oldName), eq(teams.workspaceId, ws.id), eq(teams.fixed, true)));
    }
  }
}

const app = express();
const httpServer = createServer(app);

const wsClients = new Map<string, Set<WebSocket>>();

interface SSEClient {
  res: import("express").Response;
  workspaceId: string;
}
const sseClients = new Map<string, Set<SSEClient>>();
initBroadcast(wsClients, sseClients);

// Bruno 2026-05-30 (Onda 1 escalabilidade — resiliência prod): JWT_SECRET
// validation com tolerância de 60s. EasyPanel ou docker pode demorar pra
// injetar env var em rolling deploy. process.exit(1) imediato cria
// CrashLoop infinito que não resolve sozinho (precisa de intervenção
// manual). Com tolerância de 60s, se a var aparecer no segundo retry, boot
// continua. Se passou 60s e ainda não tem, aí sim sai — problema real.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  const initialError = !JWT_SECRET
    ? "JWT_SECRET environment variable is not set"
    : "JWT_SECRET is too short (need 32+ chars)";
  console.warn(`[Boot] ⏳ ${initialError} — aguardando 60s antes de exit (tolerance pra rolling deploy)`);
  const startWait = Date.now();
  const WAIT_MS = 60_000;
  const INTERVAL_MS = 2_000;
  // Bruno 2026-06-01 (fix build prod): este bloco roda no TOP-LEVEL do módulo
  // (antes do server escutar), e o build de produção (esbuild → CJS) NÃO aceita
  // top-level await ("Top-level await is currently not supported with cjs").
  // Trocado o `await new Promise(setTimeout)` por sleep SÍNCRONO via Atomics.wait
  // — bloqueia a thread por INTERVAL_MS sem await (ok no boot: event loop ainda
  // não serve nada). Mantém a tolerância de 60s que evita CrashLoop em rolling
  // deploy.
  const _sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() - startWait < WAIT_MS) {
    Atomics.wait(_sleepBuf, 0, 0, INTERVAL_MS);
    const candidate = process.env.JWT_SECRET;
    if (candidate && candidate.length >= 32) {
      JWT_SECRET = candidate;
      console.log(`[Boot] ✅ JWT_SECRET disponível após ${Math.round((Date.now() - startWait) / 1000)}s`);
      break;
    }
  }
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error(`[FATAL] ${initialError} após 60s de espera. Server cannot start securely.`);
    process.exit(1);
  }
}

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) { ws.close(1008, "Token required"); return; }

  let workspaceId: string;
  let wsUserId: number | undefined;
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    workspaceId = decoded.workspaceId || decoded.tenantId;
    wsUserId = decoded.id;
    if (!workspaceId) { ws.close(1008, "No workspace"); return; }
  } catch {
    ws.close(1008, "Invalid token"); return;
  }

  // Auditoria 2026-06-19: o realtime ignorava a blocklist/paywall — tenant bloqueado
  // ou usuário desativado (demitido) com JWT ainda válido (7d) seguia recebendo o feed
  // ao vivo (PII). Mesma checagem (Sets em memória) que o requireAuth HTTP já faz.
  if (isBlocked(workspaceId, wsUserId)) { ws.close(1008, "Conta bloqueada"); return; }
  if (isDelinquent(workspaceId)) { ws.close(1008, "Assinatura pendente"); return; }

  const MAX_WS_PER_WORKSPACE = 50;
  const existing = wsClients.get(workspaceId) ?? new Set<WebSocket>();
  if (existing.size >= MAX_WS_PER_WORKSPACE) {
    console.warn('[ws] limite de conexões atingido para workspace:', workspaceId);
    ws.close(1008, 'Limite de conexões atingido');
    return;
  }
  existing.add(ws);
  wsClients.set(workspaceId, existing);

  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 30000);

  ws.on("close", () => {
    clearInterval(pingInterval);
    wsClients.get(workspaceId)?.delete(ws);
  });

  ws.on("error", () => {
    clearInterval(pingInterval);
    wsClients.get(workspaceId)?.delete(ws);
  });
});

app.get("/api/sse", (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.status(401).json({ error: "Token required" }); return; }

  let workspaceId: string;
  let sseUserId: number | undefined;
  try {
    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
    workspaceId = decoded.workspaceId || decoded.tenantId;
    sseUserId = decoded.id;
    if (!workspaceId) { res.status(401).json({ error: "No workspace" }); return; }
  } catch {
    res.status(401).json({ error: "Invalid token" }); return;
  }

  // Auditoria 2026-06-19: SSE respeita a blocklist/paywall (igual o requireAuth HTTP).
  if (isBlocked(workspaceId, sseUserId)) { res.status(403).json({ error: "Conta bloqueada" }); return; }
  if (isDelinquent(workspaceId)) { res.status(402).json({ error: "Assinatura pendente", paywall: true }); return; }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("data: {\"event\":\"connected\",\"data\":{}}\n\n");

  const client: SSEClient = { res, workspaceId };
  if (!sseClients.has(workspaceId)) sseClients.set(workspaceId, new Set());
  sseClients.get(workspaceId)!.add(client);

  const keepAlive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch {}
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.get(workspaceId)?.delete(client);
  });
});


declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const allowedOrigins: (string | RegExp)[] = [
  "https://chatbanana.com.br",
  "https://www.chatbanana.com.br",
  "https://app.chatbanana.com.br",
];

if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5000");
  allowedOrigins.push("http://localhost:3000");
  allowedOrigins.push(/\.replit\.dev$/);
  allowedOrigins.push(/\.repl\.co$/);
  allowedOrigins.push(/\.ngrok-free\.app$/);
  allowedOrigins.push(/\.ngrok-free\.dev$/);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some(o =>
      typeof o === "string" ? o === origin : o.test(origin)
    );
    if (allowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

app.use(helmet({
  // Bruno 2026-06-18 (auditoria A5): CSP em REPORT-ONLY — não bloqueia nada (zero
  // risco de quebrar o app), só reporta violações. Defesa-em-profundidade contra
  // XSS. Depois de observar o relatório sem falso-positivo, virar enforce (tirar
  // reportOnly). Directives permissivas o suficiente pro Vite + Google Identity.
  contentSecurityPolicy: {
    useDefaults: false,
    // Auditoria 2026-06-19: CSP em ENFORCE (bloqueia) sem 'unsafe-inline' no
    // script-src — mata execução de <script> injetado (XSS). O único inline
    // executável (bootstrap de tema) virou /theme-init.js de 'self'. 'unsafe-eval'
    // mantido (libs/Vite). style-src segue com 'unsafe-inline' (React injeta CSS inline).
    reportOnly: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'", "https://accounts.google.com", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https:", "wss:", "ws:"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Bruno 2026-06-16: o default do helmet (COOP same-origin) quebrava o popup do
  // "Entrar com Google" — o popup perdia o window.opener e não conseguia devolver
  // o token após o consentimento (tela branca, login travado). same-origin-allow-popups
  // mantém a proteção contra abuso cross-origin mas libera a comunicação popup↔página.
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  // Bruno 2026-06-14 (auditoria): anti-clickjacking. sameorigin bloqueia embed
  // cross-origin (o ataque) mas permite iframe do próprio domínio.
  frameguard: { action: "sameorigin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

app.set("trust proxy", 1);
// Não revelar o framework/versão (X-Powered-By: Express) — reduz fingerprinting.
app.disable("x-powered-by");

// Auditoria 2026-06-20: helmet 8.x não emite Permissions-Policy nem Cache-Control.
// (1) Permissions-Policy: trava câmera/geo/usb no nível do browser; microphone=(self)
//     mantém a gravação de áudio do inbox; payment=(self) preserva fluxos de pagamento.
// (2) Cache-Control: no-store nas respostas de API (auth/PII) — evita token/CPF/telefone
//     ficarem retidos em cache de disco do browser / botão Voltar em PC compartilhado.
//     Rotas que cacheiam de propósito (media-proxy, link-preview) sobrescrevem depois.
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(self), usb=(), interest-cohort=()");
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em 15 minutos." },
  skip: (req) =>
    process.env.NODE_ENV !== "production" // dev local: sem rate limit (atrapalha teste, prod segue protegido)
    || req.path.startsWith("/api/webhook")
    || req.path.startsWith("/api/instagram")
    || req.path.startsWith("/api/whatsapp-official")
    || req.path.startsWith("/api/asaas"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  skip: () => process.env.NODE_ENV !== "production", // dev local: sem limite de login
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite de envio atingido. Aguarde 1 minuto." },
});

app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body: any) => {
    if (!res.getHeader('content-type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    return origJson(body);
  };
  next();
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/messages", messageLimiter);

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const { WebhookHandlers } = await import("./webhookHandlers");
    const sig = req.headers["stripe-signature"] as string;
    if (!sig) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }
    await WebhookHandlers.processWebhook(req.body, sig);
    res.json({ received: true });
  } catch (err: any) {
    console.error("[Stripe Webhook] Error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

app.use(
  express.json({
    // Bruno 2026-05-19: default do express.json é 100kb — INSUFICIENTE pra
    // mídia outbound do painel (áudio/imagem/PDF) que chega como data URL
    // base64 inflada (~33% maior). Áudios curtos (5-10s ogg/opus) já passam
    // disso e o body-parser rejeitava silenciosamente — `req.body.arquivo`
    // chegava vazio e `persistDataUrlToUploads` falhava em loop. 15mb bate
    // com o cap explícito do endpoint /messages (15MB → 413).
    limit: '15mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    type: 'application/json',
  }),
);

app.use(express.urlencoded({ extended: false, limit: '15mb' }));

app.get('/api/health/auth', (req, res) => {
  // Bruno 2026-06-14 (auditoria): não expõe mais se o JWT_SECRET está setado
  // (fingerprint de config pra anônimo). Só confirma que o serviço responde.
  res.json({ ok: true });
});

import metaWebhookRouter from "./routes/webhook-meta";
app.use("/api/webhook/meta", metaWebhookRouter);
console.log("[Boot] Meta webhook registered at /api/webhook/meta (public, no auth)");

// Evolution GO webhook (canal não-oficial) — Bruno 2026-06-09.
// Público (Evolution não manda JWT) e já isento do rate limit (/api/webhook/*).
import { registerEvolutionWebhookRoutes } from "./routes/webhook-evolution";
import { evolutionConfigured as evoIsConfigured } from "./services/evolutionAdapter";
registerEvolutionWebhookRoutes(app);
console.log(
  `[Boot] Evolution webhook em /api/webhook/evolution (public) — canal ${
    evoIsConfigured()
      ? "CONFIGURADO ✅ base=" + (process.env.EVOLUTION_BASE_URL || "").slice(0, 45)
      : "NÃO configurado (faltam EVOLUTION_BASE_URL / EVOLUTION_GLOBAL_API_KEY / EVOLUTION_WEBHOOK_URL)"
  }`,
);

// Admin route registered below with auth middleware (see registerRoutes)
console.log("[Boot] AI config: OPENAI_API_KEY env=" + (process.env.OPENAI_API_KEY ? "set(" + process.env.OPENAI_API_KEY.length + ")" : "unset") + ", AI_INTEGRATIONS=" + (process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "set" : "unset") + " | Code v3: direct-openai-only");

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await runAutoMigrations().catch(console.error);
  await seed().catch(console.error);
  await ensureDefaultTeams().catch(console.error);

  // Bruno 2026-06-13: carrega a blocklist de tenants/usuários pra memória (bloqueio
  // instantâneo no requireAuth). Default vazio = nenhuma mudança de comportamento.
  try { const { loadBlocklist } = await import("./services/tenantBlocklist"); await loadBlocklist(); }
  catch (e: any) { console.error("[Boot] loadBlocklist skipped:", e?.message); }

  // Auditoria 2026-06-20: carrega as versões de token (revogação de sessão) pra memória.
  try { const { loadTokenVersions } = await import("./services/tokenVersionStore"); await loadTokenVersions(); }
  catch (e: any) { console.error("[Boot] loadTokenVersions skipped:", e?.message); }

  // Bruno 2026-06-15: carrega o gate de assinatura (inadimplência + VIP) pra memória
  // e recomputa de 6 em 6h (rede de segurança pra trial vencendo / grace estourando;
  // o webhook do Asaas já atualiza em tempo real). BILLING_ENFORCEMENT=off desliga o bloqueio.
  try {
    const { loadGate } = await import("./services/subscriptionGate");
    await loadGate();
    setInterval(() => { import("./services/subscriptionGate").then(m => m.loadGate()).catch(() => {}); }, 6 * 60 * 60 * 1000);
  } catch (e: any) { console.error("[Boot] loadGate skipped:", e?.message); }

  // Bruno 2026-06-15: warmups + backfills pesados (varrem TODOS os workspaces) agora
  // rodam em BACKGROUND. Antes, todos eram `await`ados ANTES do httpServer.listen(),
  // então a porta (e o /api/health) só abriam quando o último terminava — gerando uma
  // janela de ~6min de 502 a cada deploy, e um backfill com erro derrubava o boot
  // inteiro (crash-restart). Agora o servidor abre a porta na hora (migrations+seed+gate
  // já rodaram acima) e essas tarefas correm soltas, com erro isolado por try/catch.
  void (async () => {
  try {
    const { db: bootDb } = await import("./db");
    const { conversations: convTable, leads: leadsTable } = await import("@shared/schema");
    const { isNull, eq } = await import("drizzle-orm");
    const convsNoPhone = await bootDb.select({ id: convTable.id, nome: convTable.nome, workspaceId: convTable.workspaceId }).from(convTable).where(isNull(convTable.telefone));
    if (convsNoPhone.length > 0) {
      console.log(`[Boot] Backfilling telefone for ${convsNoPhone.length} conversations...`);
      for (const c of convsNoPhone) {
        const [matchedLead] = await bootDb.select({ telefone: leadsTable.telefone }).from(leadsTable).where(eq(leadsTable.nome, c.nome)).limit(1);
        if (matchedLead?.telefone) {
          await bootDb.update(convTable).set({ telefone: matchedLead.telefone }).where(eq(convTable.id, c.id));
        } else if (/^\d{8,15}$/.test(c.nome)) {
          await bootDb.update(convTable).set({ telefone: c.nome }).where(eq(convTable.id, c.id));
        }
      }
      console.log("[Boot] Telefone backfill complete");
    }

    const convsNoLcm = await bootDb.select({ id: convTable.id }).from(convTable).where(isNull(convTable.lastCustomerMessageAt));
    if (convsNoLcm.length > 0) {
      console.log(`[Boot] Backfilling lastCustomerMessageAt for ${convsNoLcm.length} conversations...`);
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      for (const c of convsNoLcm) {
        await bootDb.update(convTable).set({ lastCustomerMessageAt: fiveMinAgo }).where(eq(convTable.id, c.id));
      }
      console.log("[Boot] lastCustomerMessageAt backfill complete");
    }

    const { automationPendingInputs, conexoes: conexoesTable } = await import("@shared/schema");
    const allPending = await bootDb.select({ id: automationPendingInputs.id, flowId: automationPendingInputs.flowId, phone: automationPendingInputs.phone })
      .from(automationPendingInputs);
    if (allPending.length > 0) {
      const { automacoes } = await import("@shared/schema");
      let cleaned = 0;
      for (const p of allPending) {
        const [flow] = await bootDb.select({ id: automacoes.id, status: automacoes.status }).from(automacoes).where(eq(automacoes.id, p.flowId)).limit(1);
        if (!flow || flow.status !== "ACTIVE") {
          await bootDb.delete(automationPendingInputs).where(eq(automationPendingInputs.id, p.id));
          cleaned++;
        }
      }
      if (cleaned > 0) console.log(`[Boot] Cleaned ${cleaned} stale pending inputs (inactive flows)`);
    }
  } catch (e: any) {
    console.error("[Boot] Telefone/lastCustomerMessageAt backfill error:", e.message);
  }

  // SÓ em produção: o backfill grava URLs locais (/uploads/avatars/...) no banco.
  // Se rodar em DEV apontando pro banco de PROD, baixa os arquivos pro disco de dev
  // mas grava a URL no banco de prod → em prod o <img> dá 404 → cai pras iniciais.
  // Por isso gateamos pra NODE_ENV=production (prod baixa pro próprio disco).
  if (process.env.NODE_ENV === "production") {
    try {
      const { backfillExpiredAvatars } = await import("./services/avatarCache");
      backfillExpiredAvatars().catch((e: any) => console.error("[Boot] Avatar cache backfill error:", e.message));
    } catch (e: any) {
      console.error("[Boot] Avatar cache import error:", e.message);
    }

    // Sweep periódico de avatares (Bruno 2026-06-18): a foto do cliente só vem via
    // Evolution (Meta Cloud API não entrega). Conversa que entra pelo Meta nasce sem
    // avatar e nada puxava a foto sozinho (só o clique manual). Aqui rodamos o backfill
    // de tempos em tempos: pra cada workspace com Evolution conectado, pega convs sem
    // foto e puxa via a instância conectada (retry guard de 7d no service evita martelar).
    try {
      const { sweepAllWorkspaceAvatars } = await import("./services/avatar.service");
      setTimeout(() => { void sweepAllWorkspaceAvatars().catch(() => {}); }, 60_000);
      setInterval(() => { void sweepAllWorkspaceAvatars().catch(() => {}); }, 10 * 60_000);
      console.log("[Boot] Avatar sweep agendado (1min após boot, depois a cada 10min)");
    } catch (e: any) {
      console.error("[Boot] Avatar sweep import error:", e.message);
    }
  }

  // Garante que todos os workspaces têm as 5 etapas universais do Kanban
  // e migra etapas legadas (antigas) para o novo padrão universal
  try {
    const UNIVERSAL_BOOT = [
      { prefix: "novo",               label: "Novo",               color: "#5b93d3", ordem: 0 },
      { prefix: "em_automacao",       label: "Em Automação",       color: "#f59e0b", ordem: 1 },
      { prefix: "aguardando",         label: "Aguardando",         color: "#a855f7", ordem: 2 },
      { prefix: "atendimento_humano", label: "Atendimento Humano", color: "#3b82f6", ordem: 3 },
      { prefix: "finalizado",         label: "Finalizado",         color: "#10b981", ordem: 4 },
    ];
    const OLD_TO_NEW_PREFIXES: Record<string, string> = {
      novo_contato: "novo", viabilidade_proposta: "em_automacao",
      atendimento_humano_com: "atendimento_humano", instalacao_agendada: "aguardando",
      cliente_ativado: "finalizado", cliente_perdido: "finalizado",
      novo_chamado: "novo", atendimento_remoto: "em_automacao",
      atendimento_humano_sup: "atendimento_humano", visita_tecnica: "aguardando",
      resolvido: "finalizado", escalado_noc: "atendimento_humano",
      nova_situacao: "novo", consulta_fatura: "em_automacao",
      promessa_pgto: "aguardando", atendimento_humano_fin: "atendimento_humano",
      pago_regularizado: "finalizado", inadimplente_suspenso: "finalizado",
    };
    const wsResult = await db.execute(sql`SELECT id FROM workspaces WHERE status = 'ACTIVE'`);
    const wsRows = Array.isArray(wsResult) ? wsResult : (wsResult as any).rows || [];
    let pipelineFixed = 0;
    for (const wsRow of wsRows) {
      const wsId = wsRow.id as string;
      const wsPfx = wsId.substring(0, 8);
      const checkKey = `novo_${wsPfx}`;
      // Verificar se já tem etapas universais
      const checkResult = await db.execute(sql`
        SELECT 1 FROM pipeline_stages
        WHERE workspace_id = ${wsId}::uuid AND key = ${checkKey}
        LIMIT 1
      `);
      const checkRows = Array.isArray(checkResult) ? checkResult : (checkResult as any).rows || [];
      if (checkRows.length === 0) {
        // Criar as 5 etapas universais (pipeline='comercial' como âncora; fallback serve todas)
        for (const st of UNIVERSAL_BOOT) {
          await db.execute(sql`
            INSERT INTO pipeline_stages (workspace_id, key, label, color, ordem, pipeline)
            VALUES (${wsId}::uuid, ${`${st.prefix}_${wsPfx}`}, ${st.label}, ${st.color}, ${st.ordem}, 'comercial')
            ON CONFLICT (key) DO NOTHING
          `);
        }
        pipelineFixed++;
      }
      // Verificar se ainda existem etapas legadas antes de migrar (evita 36 UPDATEs no-op)
      const legacyPattern = `^(${Object.keys(OLD_TO_NEW_PREFIXES).join('|')})_[a-f0-9]{8}$`;
      const legacyCheck = await db.execute(sql`
        SELECT 1 FROM pipeline_stages
        WHERE workspace_id = ${wsId}::uuid AND key ~ ${legacyPattern}
        LIMIT 1
      `);
      const legacyRows = Array.isArray(legacyCheck) ? legacyCheck : (legacyCheck as any).rows || [];
      if (legacyRows.length > 0) {
        // Migrar dados de leads/conversas de chaves legadas → universais
        for (const [oldPrefix, newPrefix] of Object.entries(OLD_TO_NEW_PREFIXES)) {
          const oldKey = `${oldPrefix}_${wsPfx}`;
          const newKey = `${newPrefix}_${wsPfx}`;
          await db.execute(sql`UPDATE leads SET status = ${newKey} WHERE workspace_id = ${wsId}::uuid AND status = ${oldKey}`);
          await db.execute(sql`UPDATE conversations SET pipeline_etapa = ${newKey} WHERE workspace_id = ${wsId}::uuid AND pipeline_etapa = ${oldKey}`);
        }
        // Deletar etapas legadas
        await db.execute(sql`
          DELETE FROM pipeline_stages
          WHERE workspace_id = ${wsId}::uuid AND key ~ ${legacyPattern}
        `);
        console.log(`[Boot] Legacy pipeline stages migrated for ws=${wsPfx}`);
      }

      // ── Funil de vendas: semear as 4 colunas de exibição do Comercial ──────
      // Idempotente: só semeia se o ws ainda não tem nenhuma coluna em comercial.
      // (Edições do usuário — add/remove/rename — nunca são sobrescritas.)
      const colsCheck = await db.execute(sql`
        SELECT 1 FROM pipeline_columns
        WHERE workspace_id = ${wsId}::uuid AND pipeline = 'comercial' LIMIT 1
      `);
      const colsRows = Array.isArray(colsCheck) ? colsCheck : (colsCheck as any).rows || [];
      if (colsRows.length === 0) {
        await db.execute(sql`
          INSERT INTO pipeline_columns (workspace_id, pipeline, key, label, color, ordem, auto_states, is_terminal, terminal_reason)
          VALUES
            (${wsId}::uuid, 'comercial', 'novo',       'Novo',          '#5b93d3', 0, ARRAY['novo']::text[], false, NULL),
            (${wsId}::uuid, 'comercial', 'negociacao', 'Em negociação', '#f59e0b', 1, ARRAY['em_automacao','aguardando','atendimento_humano']::text[], false, NULL),
            (${wsId}::uuid, 'comercial', 'ganho',      'Ganho',         '#10b981', 2, ARRAY['finalizado']::text[], true, 'ativado'),
            (${wsId}::uuid, 'comercial', 'perdido',    'Perdido',       '#ef4444', 3, ARRAY[]::text[], true, 'perdido')
          ON CONFLICT (workspace_id, pipeline, key) DO NOTHING
        `);
        console.log(`[Boot] Funil Comercial semeado (4 colunas) para ws=${wsPfx}`);
      }

      // ── CRM genérico: aposentar os trilhos ISP Suporte/Financeiro ──────────
      // Desativa (não deleta — dados preservados). A aba some do CRM porque o
      // frontend filtra active !== false. Idempotente.
      await db.execute(sql`
        UPDATE pipelines SET active = false
        WHERE workspace_id = ${wsId}::uuid AND key IN ('suporte','financeiro') AND active = true
      `);
    }
    if (pipelineFixed > 0) console.log(`[Boot] Pipeline stages backfilled for ${pipelineFixed} workspace(s)`);
  } catch (e: any) {
    console.error("[Boot] Pipeline stages backfill error:", e.message);
  }

  try {
    const { db: bootDb } = await import("./db");
    const { conversations: convTable, instagramConnections } = await import("@shared/schema");
    const { eq, or, like, and, isNull } = await import("drizzle-orm");
    const { fetchInstagramProfile } = await import("./services/instagramMessageProcessor");

    const igConvs = await bootDb.select({
      id: convTable.id,
      nome: convTable.nome,
      telefone: convTable.telefone,
      avatar: convTable.avatar,
      canal: convTable.canal,
      workspaceId: convTable.workspaceId,
    }).from(convTable).where(
      and(
        eq(convTable.canal, "Instagram"),
        or(
          like(convTable.nome, "@ig_%"),
          like(convTable.nome, "ig_%"),
          like(convTable.nome, "@%"),
          like(convTable.nome, "%[unknown]%"),
          isNull(convTable.avatar)
        )
      )
    );

    if (igConvs.length > 0) {
      console.log(`[Boot] Backfilling ${igConvs.length} Instagram conversations (names/avatars)...`);
      const igConns = await bootDb.select().from(instagramConnections);
      const tokenByWs: Record<string, string> = {};
      for (const c of igConns) {
        if (c.accessToken && c.workspaceId) tokenByWs[c.workspaceId] = c.accessToken;
      }

      let updated = 0;
      for (const conv of igConvs) {
        const token = tokenByWs[conv.workspaceId || ""];
        if (!token || !conv.telefone) continue;
        try {
          const profile = await fetchInstagramProfile(token, conv.telefone);
          const upd: Record<string, any> = {};
          const hasPlaceholder = conv.nome?.startsWith("@ig_") || conv.nome?.startsWith("ig_") || conv.nome?.startsWith("@") || conv.nome?.includes("[unknown]");
          if (hasPlaceholder && (profile.displayName || profile.username)) {
            const newName = profile.displayName || `@${profile.username!.replace(/^@/, "")}`;
            upd.nome = newName;
            try {
              const leadsTable = (await import("@shared/schema")).leads;
              const leadUpd: Record<string, any> = { nome: newName };
              if (profile.username) leadUpd.instagramUsername = `@${profile.username.replace(/^@/, "")}`;
              if (profile.biography) leadUpd.instagramBio = profile.biography;
              await bootDb.update(leadsTable).set(leadUpd).where(
                and(eq(leadsTable.workspaceId, conv.workspaceId!), eq(leadsTable.instagramId, conv.telefone!))
              );
            } catch {}
          }
          if (!conv.avatar && profile.profilePic) {
            upd.avatar = profile.profilePic;
          }
          if (Object.keys(upd).length > 0) {
            await bootDb.update(convTable).set(upd).where(eq(convTable.id, conv.id));
            updated++;
          }
        } catch (err: any) {
          console.log(`[Boot] IG backfill error for conv ${conv.id}:`, err.message);
        }
      }
      console.log(`[Boot] Instagram backfill done: ${updated}/${igConvs.length} updated`);
    }
  } catch (e: any) {
    console.error("[Boot] Instagram backfill error:", e.message);
  }
  })().catch((e: any) => console.error("[Boot] warmups/backfills (background) erro:", e?.message));

  // Sentry — captura de erros opcional (ativa só se SENTRY_DSN setado)
  try {
    const { initSentryIfConfigured } = await import("./services/sentryOptional");
    await initSentryIfConfigured();
  } catch (e: any) {
    console.error(`[Boot] Sentry init falhou (não-bloqueante): ${e.message}`);
  }

  await registerRoutes(httpServer, app);

  const { requireAuth: authMiddleware, requireAuthOrToken } = await import("./middleware/auth");

  const whatsappOfficialRouter = (await import("./routes/whatsapp-official")).default;
  app.use("/api/whatsapp-official", authMiddleware, whatsappOfficialRouter);
  console.log("[Boot] WhatsApp Official (Meta Cloud API) routes registered at /api/whatsapp-official");

  const { webhookRouter: igWebhookRouter, protectedRouter: igProtectedRouter } = await import("./routes/instagram");
  app.use("/api/instagram", igWebhookRouter);
  app.use("/api/instagram", authMiddleware, igProtectedRouter);
  console.log("[Boot] Instagram routes registered at /api/instagram");

  const instaProspectRouter = (await import("./routes/instaProspect")).default;
  app.use("/api/insta-prospect", authMiddleware, instaProspectRouter);
  console.log("[Boot] Insta Prospect routes registered at /api/insta-prospect");

  const instaflixRouter = (await import("./routes/instaflix")).default;
  app.use("/api/instaflix", authMiddleware, instaflixRouter);
  console.log("[Boot] Instaflix routes registered at /api/instaflix");

  const relatoriosRouter = (await import("./routes/relatorios")).default;
  app.use("/api/relatorios", authMiddleware, relatoriosRouter);
  console.log("[Boot] Relatórios routes registered at /api/relatorios");

  const historyRouter = (await import("./routes/history")).default;
  app.use("/api/history", authMiddleware, historyRouter);
  console.log("[Boot] History routes registered at /api/history");

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Erros 5xx não-controlados (driver Postgres, stack, paths) vazariam estrutura interna ao cliente:
    // detalhe só no log do server; cliente recebe genérico. <500 = erro de app deliberado, msg pode ir.
    const message = status >= 500 ? "Erro interno. Tente novamente em instantes." : (err.message || "Erro");

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);

      setInterval(async () => {
        const now = new Date();
        const hora = now.getHours();
        const minuto = now.getMinutes();
        const dia = now.getDay();
        const fimUtil = dia >= 1 && dia <= 5 && hora === 18 && minuto === 0;
        const fimSab = dia === 6 && hora === 12 && minuto === 0;
        if (fimUtil || fimSab) {
          await archiveEndOfShift();
        }
      }, 60 * 1000);

      // Bruno 2026-06-05 (revisão pré-deploy): guard de re-entrância — se um tick
      // demora mais que 60s (lote grande + resolução ERP por destinatário), o
      // próximo NÃO entra em cima. Combinado com claimDisparosPendentes (claim
      // atômico pra 'sending'), elimina o risco de reenvio duplicado.
      let disparosRunning = false;
      setInterval(async () => {
        if (disparosRunning) return;
        disparosRunning = true;
        try {
          await storage.recoverStuckDisparos(10);
          const pendentes = await storage.claimDisparosPendentes();
          if (pendentes.length === 0) return;
          // Bruno 2026-06-05: o disparo escolhe o canal pelo MODO gravado —
          // template → API Oficial (Meta, passa fora da janela 24h); texto livre
          // → Evolution (não-oficial). NÃO depende de "qual conexão é a default".
          const { sendMessage } = await import("./services/channel-router");
          const { resolveTokens, extractTextTokens, extractMapTokens, renderText, buildTemplateComponents } = await import("./services/disparo-vars");
          const { whatsappOfficialConnections } = await import("@shared/schema");
          const { eq: deq, and: dand } = await import("drizzle-orm");

          for (const disparo of pendentes) {
            try {
              const phone = disparo.phoneNumber.replace(/\D/g, "");
              const mode = (disparo as any).dispatchMode || "texto_livre";

              if (mode === "template") {
                const [metaConn] = await db.select().from(whatsappOfficialConnections)
                  .where(dand(deq(whatsappOfficialConnections.workspaceId, disparo.workspaceId), deq(whatsappOfficialConnections.status, "active")))
                  .limit(1);
                if (!metaConn) {
                  await storage.markDisparoFailed(disparo.id, "Disparo de template exige conexão WhatsApp API Oficial (Meta) ativa.");
                  continue;
                }
                if (!(disparo as any).templateName) {
                  await storage.markDisparoFailed(disparo.id, "Template não informado no disparo.");
                  continue;
                }
                const map = ((disparo as any).templateVariables as any) || [];
                const resolved = await resolveTokens(disparo.workspaceId, { contactName: disparo.contactName, phoneNumber: phone }, extractMapTokens(map));
                const components = buildTemplateComponents(map, resolved);
                const result = await sendMessage({
                  workspaceId: disparo.workspaceId,
                  to: phone,
                  type: "template",
                  templateName: (disparo as any).templateName,
                  templateLanguage: (disparo as any).templateLanguage || "pt_BR",
                  templateComponents: components,
                });
                if (!result.success) throw new Error(result.error || "Falha ao enviar template");
              } else {
                const conexoesWs = await storage.getConexoes(disparo.workspaceId);
                const conexaoEvolution = conexoesWs.find((c: any) => c.status === "connected" && c.provider === "evolution");
                if (!conexaoEvolution) {
                  await storage.markDisparoFailed(disparo.id, "Disparo de texto livre exige conexão WhatsApp (Evolution/QR Code) conectada.");
                  continue;
                }
                const resolved = await resolveTokens(disparo.workspaceId, { contactName: disparo.contactName, phoneNumber: phone }, extractTextTokens(disparo.messageText || ""));
                const content = renderText(disparo.messageText || "", resolved);
                const hasMedia = disparo.mediaUrl && disparo.mediaType && disparo.mediaType !== "text";
                // respeita o tipo real da mídia (antes forçava "image" pra tudo).
                const mediaKind = (["image", "video", "audio", "document"].includes(String(disparo.mediaType)) ? disparo.mediaType : "image") as "image" | "video" | "audio" | "document";
                const result = await sendMessage({
                  workspaceId: disparo.workspaceId,
                  to: phone,
                  type: hasMedia ? mediaKind : "text",
                  content,
                  mediaUrl: hasMedia ? disparo.mediaUrl! : undefined,
                  mediaCaption: hasMedia ? content : undefined,
                  conexaoId: conexaoEvolution.id,
                });
                if (!result.success) throw new Error(result.error || "Falha ao enviar disparo");
              }

              await storage.markDisparoSent(disparo.id);
              if (disparo.isRecurring && disparo.recurrenceType === "monthly") {
                await storage.createNextOccurrence(disparo);
              }
            } catch (err: any) {
              const msg = err?.message || "Erro desconhecido no envio";
              await storage.markDisparoFailed(disparo.id, msg);
              console.error(`[DisparosScheduler] Falha no disparo ${disparo.id}:`, msg);
            }
          }
        } catch (e) {
          console.error("[DisparosScheduler] Erro geral:", e);
        } finally {
          disparosRunning = false;
        }
      }, 60 * 1000);

      // Agent trace auto-purge (Bruno, 2026-05-12): elimina eventos > 30 dias
      // (override via AGENT_TRACE_RETENTION_DAYS) pra evitar crescimento sem
      // limite da tabela. Roda 1x logo após boot e depois a cada 6h.
      setTimeout(async () => {
        try {
          const { purgeOldTraceEvents } = await import("./utils/agentTrace");
          await purgeOldTraceEvents();
        } catch (e: any) {
          console.error("[AgentTrace] purge inicial error:", e.message);
        }
        // SEC #28: purga OTPs consumidos/expirados (PII e-mail+IP) junto do trace.
        try {
          const { purgeStaleLoginCodes } = await import("./services/loginCodeService");
          const n = await purgeStaleLoginCodes();
          if (n > 0) console.log(`[LoginCodes] purge inicial: ${n} código(s) removido(s)`);
        } catch (e: any) {
          console.error("[LoginCodes] purge inicial error:", e.message);
        }
      }, 60 * 1000);
      setInterval(async () => {
        try {
          const { purgeOldTraceEvents } = await import("./utils/agentTrace");
          await purgeOldTraceEvents();
        } catch (e: any) {
          console.error("[AgentTrace] purge tick error:", e.message);
        }
        try {
          const { purgeStaleLoginCodes } = await import("./services/loginCodeService");
          const n = await purgeStaleLoginCodes();
          if (n > 0) console.log(`[LoginCodes] purge: ${n} código(s) removido(s)`);
        } catch (e: any) {
          console.error("[LoginCodes] purge tick error:", e.message);
        }
      }, 6 * 60 * 60 * 1000);
      console.log("[AgentTrace] auto-purge: every 6 hours (retention default 30d)");

      setInterval(async () => {
        try {
          const { db: schedDb } = await import("./db");
          const { whatsappOfficialConnections: woConns, whatsappMessageTemplates: wmtTable } = await import("@shared/schema");
          const { eq: eqOp, inArray: inArrayOp } = await import("drizzle-orm");
          const { syncTemplateStatus } = await import("./services/meta-whatsapp-templates");

          const pendingTemplates = await schedDb
            .select()
            .from(wmtTable)
            .where(inArrayOp(wmtTable.status, ["PENDING", "IN_APPEAL"]));

          for (const tmpl of pendingTemplates) {
            try {
              const [conn] = await schedDb
                .select()
                .from(woConns)
                .where(eqOp(woConns.workspaceId, tmpl.workspaceId))
                .limit(1);

              if (!conn) continue;

              const result = await syncTemplateStatus({
                wabaId: conn.wabaId,
                accessToken: conn.accessToken,
                templateName: tmpl.templateName,
                language: tmpl.language,
              });

              if (result && result.status !== tmpl.status) {
                await schedDb
                  .update(wmtTable)
                  .set({
                    status: result.status,
                    rejectionReason: result.rejectionReason || null,
                    approvedAt: result.status === "APPROVED" ? new Date() : null,
                    updatedAt: new Date(),
                  })
                  .where(eqOp(wmtTable.id, tmpl.id));

                console.log(`[HSM Sync] Template "${tmpl.templateName}" status: ${tmpl.status} → ${result.status}`);
              }
            } catch (e: any) {
              console.error(`[HSM Sync] Error syncing template ${tmpl.id}:`, e.message);
            }
          }
        } catch (e: any) {
          console.error("[HSM Sync] Scheduler error:", e.message);
        }
      }, 30 * 60 * 1000);
      console.log("[HSM Sync] Template status checker: every 30 minutes");

      setInterval(async () => {
        try {
          const expiredWaits = await storage.getExpiredWaitPendingInputs();
          if (expiredWaits.length > 0) {
            const { resumeAutomationFlow } = await import("./services/automationEngine");
            for (const pending of expiredWaits) {
              try {
                await resumeAutomationFlow(pending, "__timeout__");
                await storage.deletePendingInput(pending.id);
              } catch (e) {
                console.error("[Automation] Erro ao retomar fluxo apos delay:", e);
                await storage.deletePendingInput(pending.id);
              }
            }
          }
          await storage.deleteExpiredPendingInputs();
        } catch (e: any) {
          console.warn("[PendingInput] Cleanup cycle error:", e.message);
        }
      }, 60 * 1000);

      // Instaflix — schedulers de geração (rascunhos por agenda) e publicação
      // (claim atômico → publica no horário). Bruno 2026-07-04.
      import("./services/instaflixScheduler")
        .then(({ startInstaflixSchedulers }) => startInstaflixSchedulers())
        .catch((e) => console.error("[Instaflix] Falha ao iniciar schedulers:", e));
    },
  );
})();
