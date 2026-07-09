CREATE TABLE "anotacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"conversation_id" integer,
	"conteudo" text NOT NULL,
	"criado_por" integer,
	"criado_por_nome" text,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"token_hash" text,
	"token_preview" text,
	"permissoes" jsonb DEFAULT '[]'::jsonb,
	"ativo" boolean DEFAULT true,
	"ultimo_uso" timestamp,
	"workspace_id" uuid,
	"created_by" integer,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"data" text NOT NULL,
	"hora" text NOT NULL,
	"tipo" text DEFAULT 'reuniao' NOT NULL,
	"contato" text,
	"notas" text,
	"status" text DEFAULT 'agendado' NOT NULL,
	"assigned_user_id" integer,
	"google_calendar_event_id" text,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automacao_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automacao_id" uuid NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duracao_ms" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"trigger_type" text NOT NULL,
	"trigger_channel" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execucoes" integer DEFAULT 0 NOT NULL,
	"ultima_execucao" timestamp,
	"created_at" timestamp DEFAULT now(),
	"workspace_id" uuid NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_pending_inputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"workspace_id" uuid,
	"pending_type" text DEFAULT 'option_list' NOT NULL,
	"flow_id" uuid NOT NULL,
	"execution_id" text NOT NULL,
	"node_id" text NOT NULL,
	"lead_id" integer NOT NULL,
	"phone" text NOT NULL,
	"options" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"valor" text,
	"tipo" text DEFAULT 'text' NOT NULL,
	"escopo" text DEFAULT 'lead' NOT NULL,
	"lead_id" integer,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campanhas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"template" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"audience_type" text DEFAULT 'all',
	"rate_per_minute" integer DEFAULT 30,
	"batch_size" integer DEFAULT 10,
	"delay_ms" integer DEFAULT 2000,
	"connection_id" text,
	"scheduled_at" timestamp,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_interno" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"user_name" text NOT NULL,
	"user_avatar" text,
	"texto" text NOT NULL,
	"target_user_id" integer,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conexoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tipo" text DEFAULT 'whatsapp' NOT NULL,
	"provider" text DEFAULT 'wweb' NOT NULL,
	"instance_id" text,
	"token" text,
	"numero" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"qr_code" text,
	"qr_expires_at" timestamp,
	"webhook_url" text,
	"ultimo_ping" timestamp,
	"automacao_id" uuid,
	"workspace_id" uuid,
	"plano_limite" integer DEFAULT 1 NOT NULL,
	"baileys_auth" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"empresa" text,
	"telefone" text,
	"email" text,
	"canal" text DEFAULT 'WhatsApp' NOT NULL,
	"tags" text[],
	"notas" text,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"telefone" text,
	"canal" text DEFAULT 'WhatsApp' NOT NULL,
	"avatar" text,
	"ultima_mensagem" text,
	"tempo" text,
	"unread" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tags" text[],
	"agente" text,
	"pipeline" text,
	"pipeline_etapa" text,
	"prioridade" text,
	"conexao_id" uuid,
	"assigned_user_id" integer,
	"assigned_user_name" text,
	"resolved_at" timestamp,
	"pendente" boolean DEFAULT true NOT NULL,
	"last_operator_view_at" timestamp,
	"last_customer_message_at" timestamp,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"valor" numeric(10, 2) DEFAULT '0' NOT NULL,
	"stage" text DEFAULT 'novo' NOT NULL,
	"contato" text,
	"empresa" text,
	"owner" text,
	"lead_id" integer,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "disparos_programados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"message_text" text,
	"media_url" text,
	"media_type" text DEFAULT 'text',
	"scheduled_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending',
	"error_message" text,
	"created_by" text NOT NULL,
	"sent_at" timestamp,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurrence_type" text,
	"recurrence_period" integer,
	"parent_disparo_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "disponibilidade" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"dia_semana" integer NOT NULL,
	"hora_inicio" text NOT NULL,
	"hora_fim" text NOT NULL,
	"intervalo_minutos" integer DEFAULT 30 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"workspace_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"conteudo_html" text NOT NULL,
	"categoria" text DEFAULT 'contrato',
	"ativo" boolean DEFAULT true NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ia_prompt_historico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"prompt_anterior" text,
	"editado_por" integer,
	"versao" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ia_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"prompt" text NOT NULL,
	"modelo" text DEFAULT 'gpt-4o-mini',
	"temperatura" numeric(3, 2) DEFAULT '0.70',
	"max_tokens" integer DEFAULT 1000,
	"ativo" boolean DEFAULT true,
	"versao" integer DEFAULT 1,
	"updated_by" integer,
	"workspace_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ia_prompts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "insta_prospect_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"ativo" boolean DEFAULT false,
	"comment_enabled" boolean DEFAULT false,
	"dm_enabled" boolean DEFAULT false,
	"story_enabled" boolean DEFAULT false,
	"keyword" text,
	"keyword_match_type" text DEFAULT 'contains',
	"dm_keyword" text,
	"dm_keyword_match_type" text DEFAULT 'contains',
	"story_first_message" text,
	"post_id" text,
	"public_reply" text,
	"first_message" text,
	"first_message_media_url" text,
	"first_message_media_type" text,
	"ai_persona" text DEFAULT 'vendedor',
	"ai_system_prompt" text NOT NULL,
	"ai_objective" text,
	"ai_model" text DEFAULT 'gpt-4o-mini',
	"ai_temperature" real DEFAULT 0.7,
	"ai_max_tokens" integer DEFAULT 300,
	"final_action" text DEFAULT 'atribuir_agente',
	"assign_strategy" text DEFAULT 'disponivel',
	"auto_tags" jsonb DEFAULT '[]'::jsonb,
	"delay_seconds" integer DEFAULT 0,
	"total_triggers" integer DEFAULT 0,
	"total_leads" integer DEFAULT 0,
	"total_converted" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insta_prospect_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"lead_id" integer,
	"ig_user_id" text NOT NULL,
	"ig_username" text,
	"status" text DEFAULT 'em_andamento',
	"conversation_history" jsonb DEFAULT '[]'::jsonb,
	"trigger_type" text,
	"trigger_content" text,
	"collected_data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ig_user_id" text NOT NULL,
	"ig_username" text NOT NULL,
	"access_token" text NOT NULL,
	"page_id" text,
	"page_name" text,
	"token_expires_at" timestamp,
	"is_active" boolean DEFAULT true,
	"webhook_verified" boolean DEFAULT false,
	"dm_count" integer DEFAULT 0,
	"dm_count_month" integer DEFAULT 0,
	"dm_automacao_id" uuid,
	"comment_automacao_id" uuid,
	"automacao_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instagram_connection_id" uuid NOT NULL,
	"ig_message_id" text NOT NULL,
	"ig_conversation_id" text,
	"from_ig_user_id" text NOT NULL,
	"from_ig_username" text,
	"to_ig_user_id" text NOT NULL,
	"direction" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"content" text,
	"media_url" text,
	"metadata" jsonb,
	"lead_id" integer,
	"automation_triggered" boolean DEFAULT false,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"integration_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "isp_automation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"automation_type" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text NOT NULL,
	"message_preview" text,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "isp_billing_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sgp_customer_id" text NOT NULL,
	"sgp_invoice_id" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text NOT NULL,
	"invoice_due_date" date NOT NULL,
	"invoice_amount" numeric(10, 2) NOT NULL,
	"message_type" text NOT NULL,
	"days_offset" integer NOT NULL,
	"whatsapp_sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "isp_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"sgp_base_url" text NOT NULL,
	"sgp_api_token" text NOT NULL,
	"sgp_app_name" text DEFAULT 'ChatBanana' NOT NULL,
	"ixc_token_id" text,
	"erp_type" text DEFAULT 'sgp' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"billing_enabled" boolean DEFAULT true NOT NULL,
	"billing_days_before" integer DEFAULT 3 NOT NULL,
	"billing_days_after" integer[] DEFAULT ARRAY[1, 3, 7] NOT NULL,
	"billing_message_before" text,
	"billing_message_after" text,
	"onboarding_enabled" boolean DEFAULT true NOT NULL,
	"onboarding_message" text,
	"onboarding_delay_minutes" integer DEFAULT 5 NOT NULL,
	"birthday_enabled" boolean DEFAULT true NOT NULL,
	"birthday_message" text,
	"birthday_time" text DEFAULT '09:00' NOT NULL,
	"support_message_template" text,
	"support_phone" text,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"ai_cpf_lookup_enabled" boolean DEFAULT true NOT NULL,
	"ai_second_copy_enabled" boolean DEFAULT true NOT NULL,
	"ai_trust_unlock_enabled" boolean DEFAULT true NOT NULL,
	"ai_payment_confirm_enabled" boolean DEFAULT true NOT NULL,
	"ai_auto_unlock_on_payment" boolean DEFAULT true NOT NULL,
	"ai_payment_promise_enabled" boolean DEFAULT true NOT NULL,
	"ai_service_order_enabled" boolean DEFAULT true NOT NULL,
	"trust_unlock_enabled" boolean DEFAULT true NOT NULL,
	"trust_unlock_max_days_overdue" integer,
	"trust_unlock_max_per_month" integer,
	"trust_unlock_cooldown_hours" integer DEFAULT 24 NOT NULL,
	"trust_unlock_message" text,
	"trust_unlock_operator_notify" boolean DEFAULT true NOT NULL,
	"operator_phone" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "isp_configs_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "isp_import_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"erp_type" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"filter_status" text NOT NULL,
	"total_fetched" integer DEFAULT 0 NOT NULL,
	"total_imported" integer DEFAULT 0 NOT NULL,
	"total_updated" integer DEFAULT 0 NOT NULL,
	"total_skipped" integer DEFAULT 0 NOT NULL,
	"total_errors" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "isp_payment_promises" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"invoice_id" text,
	"invoice_amount" numeric(10, 2),
	"promise_date" date NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pendente' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"fulfilled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "isp_support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sgp_ticket_id" text,
	"sgp_customer_id" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_cpf" text NOT NULL,
	"ticket_type" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"opened_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"last_status_check" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "isp_unlock_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sgp_customer_id" text NOT NULL,
	"sgp_contract_id" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text NOT NULL,
	"unlock_type" text NOT NULL,
	"days_overdue_at_unlock" integer DEFAULT 0 NOT NULL,
	"erp_response" jsonb,
	"success" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"unlocked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"cor" text DEFAULT '#7c5cbf' NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "lead_tags_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"contato" text NOT NULL,
	"valor" numeric(10, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'novo' NOT NULL,
	"canal" text DEFAULT 'WhatsApp' NOT NULL,
	"owner" text,
	"email" text,
	"telefone" text,
	"empresa" text,
	"notas" text,
	"tags" text[],
	"pipeline" text DEFAULT 'vendas' NOT NULL,
	"prioridade" text DEFAULT 'media',
	"motivo_perda" text,
	"instagram_id" text,
	"instagram_username" text,
	"source" text,
	"cobertura_status" text,
	"cobertura_endereco" text,
	"referral_lead_id" integer,
	"reengajando" boolean DEFAULT false,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mensagens_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conexao_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"from_number" text,
	"to_number" text,
	"content" text,
	"message_id" text,
	"status" text DEFAULT 'sent',
	"raw_payload" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"direction" text NOT NULL,
	"texto" text NOT NULL,
	"tipo" text DEFAULT 'text',
	"arquivo" text,
	"nome_arquivo" text,
	"hora" text,
	"status" text DEFAULT 'sent',
	"agente" text,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notificacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"categoria" text DEFAULT 'sistema' NOT NULL,
	"titulo" text NOT NULL,
	"mensagem" text NOT NULL,
	"lida" boolean DEFAULT false NOT NULL,
	"link" text,
	"icon_key" text DEFAULT 'message' NOT NULL,
	"prioridade" text DEFAULT 'media' NOT NULL,
	"destinatario_id" integer,
	"destinatario_tipo" text DEFAULT 'user',
	"lead_id" integer,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "partner_impersonation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_workspace_id" uuid NOT NULL,
	"target_workspace_id" uuid NOT NULL,
	"partner_user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "partner_impersonation_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "partner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_workspace_id" uuid NOT NULL,
	"client_email" text NOT NULL,
	"client_name" text NOT NULL,
	"business_name" text NOT NULL,
	"invite_token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_workspace_id" uuid,
	"workspace_id" uuid,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "partner_invites_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text,
	"role" text NOT NULL,
	"can_view_all_leads" boolean DEFAULT false NOT NULL,
	"can_edit_others_leads" boolean DEFAULT false NOT NULL,
	"can_view_reports" boolean DEFAULT false NOT NULL,
	"can_manage_connections" boolean DEFAULT false NOT NULL,
	"can_manage_automations" boolean DEFAULT false NOT NULL,
	"can_export_data" boolean DEFAULT false NOT NULL,
	"can_invite_users" boolean DEFAULT false NOT NULL,
	"can_view_dashboard" boolean DEFAULT true NOT NULL,
	"can_use_chat" boolean DEFAULT true NOT NULL,
	"can_manage_pipeline" boolean DEFAULT false NOT NULL,
	"can_manage_campaigns" boolean DEFAULT false NOT NULL,
	"can_manage_insta_prospect" boolean DEFAULT false NOT NULL,
	"can_manage_isp" boolean DEFAULT false NOT NULL,
	"can_manage_workspace" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pesquisas_satisfacao" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"opcoes" jsonb DEFAULT '["Muito satisfeito","Satisfeito","Neutro","Insatisfeito","Muito insatisfeito"]'::jsonb NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"resposta_rapida_id" integer,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"color" text DEFAULT '#7c5cbf' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"pipeline" text DEFAULT 'vendas' NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "pipeline_stages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"icon" text DEFAULT 'LayoutGrid',
	"cor" text DEFAULT '#7c5cbf' NOT NULL,
	"fixed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "planos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"preco" numeric(10, 2),
	"preco_anual" numeric(10, 2),
	"limite_usuarios" integer,
	"descricao" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "planos_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "platform_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "respostas_pesquisa" (
	"id" serial PRIMARY KEY NOT NULL,
	"pesquisa_id" integer NOT NULL,
	"conversation_id" integer,
	"lead_id" integer,
	"resposta" text NOT NULL,
	"nota" integer,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "respostas_rapidas" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"texto" text NOT NULL,
	"categoria" text,
	"atalho" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"tipo_midia" text,
	"arquivo_url" text,
	"arquivo_nome" text,
	"workspace_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp DEFAULT now(),
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"pipeline_key" text,
	"workspace_id" text,
	"leader_id" integer,
	"fixed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(10, 2) NOT NULL,
	"tipo" text NOT NULL,
	"categoria" text,
	"data" text NOT NULL,
	"status" text DEFAULT 'pago' NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"cargo" text,
	"telefone" text,
	"avatar_url" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"meta_mensal" integer DEFAULT 0 NOT NULL,
	"ultimo_acesso" timestamp,
	"workspace_id" text,
	"invited_by" integer,
	"invite_token" text,
	"invite_expires_at" timestamp,
	"plano_id" uuid,
	"avatar" text,
	"bio" text,
	"empresa" text,
	"website" text,
	"linkedin" text,
	"twitter" text,
	"instagram" text,
	"github" text,
	"tema" text DEFAULT 'dark',
	"color_preset" text DEFAULT 'violet',
	"notif_novos_leads" boolean DEFAULT true,
	"notif_mensagens" boolean DEFAULT true,
	"notif_tarefas" boolean DEFAULT true,
	"notif_relatorios" boolean DEFAULT false,
	"notif_email" boolean DEFAULT true,
	"gcal_refresh_token" text,
	"account_type" text DEFAULT 'empreendedor' NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wa_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"ativo" boolean DEFAULT false,
	"keyword" text,
	"keyword_match_type" text DEFAULT 'contains',
	"template_name" text,
	"reply_message" text,
	"ai_enabled" boolean DEFAULT false,
	"ai_system_prompt" text,
	"ai_objective" text,
	"schedule_start" text,
	"schedule_end" text,
	"total_triggers" integer DEFAULT 0,
	"total_replies" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"provider" text DEFAULT 'n8n',
	"ativo" boolean DEFAULT true,
	"eventos" jsonb DEFAULT '[]'::jsonb,
	"ultimo_disparo" timestamp,
	"total_disparos" integer DEFAULT 0,
	"total_erros" integer DEFAULT 0,
	"workspace_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"evento" text,
	"payload" jsonb,
	"response_status" integer,
	"response_body" text,
	"sucesso" boolean DEFAULT false,
	"tentativas" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" integer NOT NULL,
	"template_name" text NOT NULL,
	"template_id" text,
	"category" text NOT NULL,
	"language" text DEFAULT 'pt_BR' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"header_type" text,
	"header_content" text,
	"body_text" text NOT NULL,
	"footer_text" text,
	"buttons" jsonb,
	"variables_count" integer DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "whatsapp_official_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text NOT NULL,
	"business_name" text NOT NULL,
	"access_token" text NOT NULL,
	"token_type" text DEFAULT 'user' NOT NULL,
	"token_expires_at" timestamp,
	"webhook_verified" boolean DEFAULT false NOT NULL,
	"messaging_limit_tier" text DEFAULT 'TIER_1K',
	"quality_rating" text DEFAULT 'GREEN',
	"status" text DEFAULT 'active' NOT NULL,
	"meta_business_id" text,
	"connected_at" timestamp DEFAULT now(),
	"last_used_at" timestamp,
	"automacao_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "whatsapp_official_connections_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"phone_number_id" text NOT NULL,
	"waba_id" text,
	"event_type" text NOT NULL,
	"message_id" text,
	"from_number" text,
	"raw_payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp,
	"error" text,
	"received_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"plano_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"trial_expires_at" timestamp,
	"account_type" text DEFAULT 'empreendedor' NOT NULL,
	"parent_workspace_id" uuid,
	"max_sub_workspaces" integer DEFAULT 0 NOT NULL,
	"partner_plan" text,
	"partner_since" timestamp,
	"white_label_name" text,
	"white_label_logo" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_subscription_status" text,
	"stripe_price_id" text,
	"stripe_current_period_end" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "zapier_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer DEFAULT 1 NOT NULL,
	"workspace_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"webhook_url" text,
	"selected_events" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret_token" text,
	"last_triggered_at" timestamp,
	"trigger_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_criado_por_users_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anotacoes" ADD CONSTRAINT "anotacoes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automacao_logs" ADD CONSTRAINT "automacao_logs_automacao_id_automacoes_id_fk" FOREIGN KEY ("automacao_id") REFERENCES "public"."automacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automacoes" ADD CONSTRAINT "automacoes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_pending_inputs" ADD CONSTRAINT "automation_pending_inputs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_variables" ADD CONSTRAINT "automation_variables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_interno" ADD CONSTRAINT "chat_interno_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_interno" ADD CONSTRAINT "chat_interno_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_interno" ADD CONSTRAINT "chat_interno_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disparos_programados" ADD CONSTRAINT "disparos_programados_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disponibilidade" ADD CONSTRAINT "disponibilidade_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disponibilidade" ADD CONSTRAINT "disponibilidade_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_prompt_historico" ADD CONSTRAINT "ia_prompt_historico_prompt_id_ia_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ia_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_prompt_historico" ADD CONSTRAINT "ia_prompt_historico_editado_por_users_id_fk" FOREIGN KEY ("editado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_prompts" ADD CONSTRAINT "ia_prompts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insta_prospect_flows" ADD CONSTRAINT "insta_prospect_flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insta_prospect_sessions" ADD CONSTRAINT "insta_prospect_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insta_prospect_sessions" ADD CONSTRAINT "insta_prospect_sessions_flow_id_insta_prospect_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."insta_prospect_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insta_prospect_sessions" ADD CONSTRAINT "insta_prospect_sessions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_connections" ADD CONSTRAINT "instagram_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_messages" ADD CONSTRAINT "instagram_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_messages" ADD CONSTRAINT "instagram_messages_instagram_connection_id_instagram_connections_id_fk" FOREIGN KEY ("instagram_connection_id") REFERENCES "public"."instagram_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_messages" ADD CONSTRAINT "instagram_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_automation_logs" ADD CONSTRAINT "isp_automation_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_billing_logs" ADD CONSTRAINT "isp_billing_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_configs" ADD CONSTRAINT "isp_configs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_import_logs" ADD CONSTRAINT "isp_import_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_payment_promises" ADD CONSTRAINT "isp_payment_promises_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_support_tickets" ADD CONSTRAINT "isp_support_tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isp_unlock_logs" ADD CONSTRAINT "isp_unlock_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_log" ADD CONSTRAINT "mensagens_log_conexao_id_conexoes_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."conexoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_impersonation_tokens" ADD CONSTRAINT "partner_impersonation_tokens_partner_workspace_id_workspaces_id_fk" FOREIGN KEY ("partner_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_impersonation_tokens" ADD CONSTRAINT "partner_impersonation_tokens_target_workspace_id_workspaces_id_fk" FOREIGN KEY ("target_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_partner_workspace_id_workspaces_id_fk" FOREIGN KEY ("partner_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pesquisas_satisfacao" ADD CONSTRAINT "pesquisas_satisfacao_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respostas_pesquisa" ADD CONSTRAINT "respostas_pesquisa_pesquisa_id_pesquisas_satisfacao_id_fk" FOREIGN KEY ("pesquisa_id") REFERENCES "public"."pesquisas_satisfacao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respostas_pesquisa" ADD CONSTRAINT "respostas_pesquisa_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_automations" ADD CONSTRAINT "wa_automations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message_templates" ADD CONSTRAINT "whatsapp_message_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message_templates" ADD CONSTRAINT "whatsapp_message_templates_connection_id_whatsapp_official_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_official_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_official_connections" ADD CONSTRAINT "whatsapp_official_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_official_connections" ADD CONSTRAINT "whatsapp_official_connections_automacao_id_automacoes_id_fk" FOREIGN KEY ("automacao_id") REFERENCES "public"."automacoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_plano_id_planos_id_fk" FOREIGN KEY ("plano_id") REFERENCES "public"."planos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zapier_config" ADD CONSTRAINT "zapier_config_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_api_tokens_hash" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_api_tokens_ativo" ON "api_tokens" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "idx_appointments_workspace" ON "appointments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_automacoes_workspace" ON "automacoes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_auto_vars_lead" ON "automation_variables" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_auto_vars_workspace" ON "automation_variables" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_auto_vars_nome" ON "automation_variables" USING btree ("nome");--> statement-breakpoint
CREATE INDEX "idx_campanhas_status" ON "campanhas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campanhas_workspace" ON "campanhas" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_chat_interno_conversation" ON "chat_interno" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_chat_interno_workspace" ON "chat_interno" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_conexoes_status" ON "conexoes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conexoes_workspace" ON "conexoes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_workspace" ON "contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contacts_workspace_phone_unique" ON "contacts" USING btree ("workspace_id","telefone");--> statement-breakpoint
CREATE INDEX "idx_conversations_workspace" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_workspace_status" ON "conversations" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_conversations_telefone" ON "conversations" USING btree ("telefone");--> statement-breakpoint
CREATE INDEX "idx_conversations_nome_workspace" ON "conversations" USING btree ("nome","workspace_id");--> statement-breakpoint
CREATE INDEX "idx_deals_workspace" ON "deals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_disparos_workspace" ON "disparos_programados" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_ia_prompt_historico_prompt" ON "ia_prompt_historico" USING btree ("prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ia_prompts_slug" ON "ia_prompts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_ia_prompts_ativo" ON "ia_prompts" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "insta_prospect_workspace_idx" ON "insta_prospect_flows" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "insta_prospect_tipo_idx" ON "insta_prospect_flows" USING btree ("tipo");--> statement-breakpoint
CREATE INDEX "insta_prospect_sessions_workspace_idx" ON "insta_prospect_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "insta_prospect_sessions_flow_idx" ON "insta_prospect_sessions" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "insta_prospect_sessions_ig_user_idx" ON "insta_prospect_sessions" USING btree ("ig_user_id");--> statement-breakpoint
CREATE INDEX "ig_messages_workspace_idx" ON "instagram_messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ig_message_id_uniq" ON "instagram_messages" USING btree ("ig_message_id");--> statement-breakpoint
CREATE INDEX "ig_messages_from_user_idx" ON "instagram_messages" USING btree ("from_ig_user_id");--> statement-breakpoint
CREATE INDEX "ig_messages_created_at_idx" ON "instagram_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integ_config_ws_integ_idx" ON "integration_configs" USING btree ("workspace_id","integration_id");--> statement-breakpoint
CREATE INDEX "idx_isp_auto_workspace" ON "isp_automation_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_isp_billing_unique" ON "isp_billing_logs" USING btree ("workspace_id","sgp_invoice_id","message_type");--> statement-breakpoint
CREATE INDEX "idx_isp_billing_workspace" ON "isp_billing_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_isp_promise_workspace" ON "isp_payment_promises" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_isp_promise_customer" ON "isp_payment_promises" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_isp_unlock_workspace" ON "isp_unlock_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_leads_workspace" ON "leads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_leads_nome_workspace" ON "leads" USING btree ("nome","workspace_id");--> statement-breakpoint
CREATE INDEX "idx_leads_telefone" ON "leads" USING btree ("telefone");--> statement-breakpoint
CREATE INDEX "idx_mensagens_log_conexao" ON "mensagens_log" USING btree ("conexao_id");--> statement-breakpoint
CREATE INDEX "idx_mensagens_log_from" ON "mensagens_log" USING btree ("from_number");--> statement-breakpoint
CREATE INDEX "idx_mensagens_log_created" ON "mensagens_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mensagens_log_message_id_unique" ON "mensagens_log" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_messages_workspace" ON "messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_notificacoes_dest" ON "notificacoes" USING btree ("destinatario_id");--> statement-breakpoint
CREATE INDEX "idx_notificacoes_lida" ON "notificacoes" USING btree ("lida");--> statement-breakpoint
CREATE INDEX "idx_permissions_role" ON "permissions" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_respostas_pesquisa_workspace" ON "respostas_pesquisa" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_respostas_pesquisa_pesquisa" ON "respostas_pesquisa" USING btree ("pesquisa_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_user" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_team" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_workspace" ON "transactions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_users_invite_token" ON "users" USING btree ("invite_token");--> statement-breakpoint
CREATE INDEX "idx_users_online" ON "users" USING btree ("online");--> statement-breakpoint
CREATE INDEX "wa_automations_workspace_idx" ON "wa_automations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_ativo" ON "webhook_endpoints" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_workspace" ON "webhook_endpoints" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_endpoint" ON "webhook_logs" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_created" ON "webhook_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wmt_workspace_name_lang" ON "whatsapp_message_templates" USING btree ("workspace_id","template_name","language");--> statement-breakpoint
CREATE INDEX "idx_wwe_phone_received" ON "whatsapp_webhook_events" USING btree ("phone_number_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_wwe_message_id" ON "whatsapp_webhook_events" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zapier_config_tenant_idx" ON "zapier_config" USING btree ("tenant_id");