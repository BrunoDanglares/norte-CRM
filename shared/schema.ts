import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, serial, jsonb, uuid, primaryKey, index, uniqueIndex, numeric, decimal, date, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  cargo: text("cargo"),
  telefone: text("telefone"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("ACTIVE"),
  online: boolean("online").notNull().default(false),
  // Revogação de sessão (auditoria 2026-06-20): o JWT carrega esta versão; logout/troca
  // de senha/reset incrementam → tokens antigos caem. Ver server/services/tokenVersionStore.ts.
  tokenVersion: integer("token_version").notNull().default(0),
  metaMensal: integer("meta_mensal").notNull().default(0),
  ultimoAcesso: timestamp("ultimo_acesso"),
  workspaceId: text("workspace_id"),
  invitedBy: integer("invited_by"),
  inviteToken: text("invite_token"),
  inviteExpiresAt: timestamp("invite_expires_at"),
  planoId: uuid("plano_id"),
  avatar: text("avatar"),
  bio: text("bio"),
  empresa: text("empresa"),
  website: text("website"),
  linkedin: text("linkedin"),
  twitter: text("twitter"),
  instagram: text("instagram"),
  github: text("github"),
  tema: text("tema").default("dark"),
  colorPreset: text("color_preset").default("violet"),
  notifNovosLeads: boolean("notif_novos_leads").default(true),
  notifMensagens: boolean("notif_mensagens").default(true),
  notifTarefas: boolean("notif_tarefas").default(true),
  notifRelatorios: boolean("notif_relatorios").default(false),
  notifEmail: boolean("notif_email").default(true),
  accountType: text("account_type").notNull().default("empreendedor"),
  // Login social / sem senha (Bruno 2026-06-15). google_id = `sub` da conta Google
  // (estável; vincula login Google à conta mesmo se o e-mail mudar). auth_provider
  // é informativo: "local" (senha), "google", "code" (só código). Usuários criados
  // por Google/código têm uma senha aleatória inutilizável no campo `password`.
  googleId: text("google_id"),
  authProvider: text("auth_provider").default("local"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_users_status").on(table.status),
  index("idx_users_invite_token").on(table.inviteToken),
  index("idx_users_online").on(table.online),
  index("idx_users_google_id").on(table.googleId),
]);

// Códigos de login sem senha (OTP) — enviados por e-mail ou WhatsApp. Guardamos só
// o HASH do código (nunca o código em claro). Bruno 2026-06-15.
export const loginCodes = pgTable("login_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  identifier: text("identifier").notNull(), // e-mail normalizado da conta
  channel: text("channel").notNull(),       // "email" | "whatsapp"
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at"),
  ip: text("ip"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_login_codes_identifier").on(table.identifier),
  index("idx_login_codes_created").on(table.createdAt),
]);

// Histórico de sessões de login/logout dos atendentes — alimenta o relatório
// "Atendentes → Logs de autenticação". Bruno 2026-06-03: passa a gravar a
// partir de agora (login cria sessão aberta; logout/heartbeat fecham/renovam).
// last_seen_at: renovado pelo heartbeat de online; usado pra inferir o fim da
// sessão quando o atendente fecha a aba sem clicar em Sair.
export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id"),
  userId: integer("user_id").notNull(),
  userNome: text("user_nome"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  loginAt: timestamp("login_at").defaultNow(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  logoutAt: timestamp("logout_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_auth_sessions_ws_login").on(t.workspaceId, t.loginAt),
  index("idx_auth_sessions_user_open").on(t.userId, t.logoutAt),
]);
export type SelectAuthSession = typeof authSessions.$inferSelect;

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  pipelineKey: text("pipeline_key"),
  workspaceId: text("workspace_id"),
  leaderId: integer("leader_id"),
  fixed: boolean("fixed").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  role: text("role"),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.teamId, table.userId] }),
  index("idx_team_members_user").on(table.userId),
  index("idx_team_members_team").on(table.teamId),
]);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: text("workspace_id"),
  role: text("role").notNull(),
  canViewAllLeads: boolean("can_view_all_leads").notNull().default(false),
  canEditOthersLeads: boolean("can_edit_others_leads").notNull().default(false),
  canViewReports: boolean("can_view_reports").notNull().default(false),
  canManageConnections: boolean("can_manage_connections").notNull().default(false),
  canManageAutomations: boolean("can_manage_automations").notNull().default(false),
  canExportData: boolean("can_export_data").notNull().default(false),
  canInviteUsers: boolean("can_invite_users").notNull().default(false),
  canViewDashboard: boolean("can_view_dashboard").notNull().default(true),
  canUseChat: boolean("can_use_chat").notNull().default(true),
  canManagePipeline: boolean("can_manage_pipeline").notNull().default(false),
  canManageCampaigns: boolean("can_manage_campaigns").notNull().default(false),
  canManageInstaProspect: boolean("can_manage_insta_prospect").notNull().default(false),
  canManageISP: boolean("can_manage_isp").notNull().default(false),
  canManageWorkspace: boolean("can_manage_workspace").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_permissions_role").on(table.role),
]);

export const planos = pgTable("planos", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  slug: text("slug").notNull().unique(),
  preco: numeric("preco", { precision: 10, scale: 2 }),
  precoAnual: numeric("preco_anual", { precision: 10, scale: 2 }),
  limiteUsuarios: integer("limite_usuarios"),
  // Bruno 2026-06-09 — grade por 2 eixos: canais (números WhatsApp) e clientes
  // (assinantes identificados no ERP/SGP). NULL = ilimitado (Enterprise).
  limiteCanais: integer("limite_canais"),
  limiteClientes: integer("limite_clientes"),
  // ID do preço recorrente no Stripe (price_...), linka o plano ao checkout.
  stripePriceId: text("stripe_price_id"),
  descricao: text("descricao"),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  planoId: uuid("plano_id").references(() => planos.id),
  status: text("status").notNull().default("ACTIVE"),
  trialExpiresAt: timestamp("trial_expires_at"),
  accountType: text("account_type").notNull().default("empreendedor"),
  parentWorkspaceId: uuid("parent_workspace_id"),
  maxSubWorkspaces: integer("max_sub_workspaces").notNull().default(0),
  partnerPlan: text("partner_plan"),
  partnerSince: timestamp("partner_since"),
  whiteLabelName: text("white_label_name"),
  whiteLabelLogo: text("white_label_logo"),
  cnpj: text("cnpj"),
  setor: text("setor"),
  tamanho: text("tamanho"),
  logo: text("logo"),
  razaoSocial: text("razao_social"),
  assinantes: text("assinantes"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeSubscriptionStatus: text("stripe_subscription_status"),
  stripePriceId: text("stripe_price_id"),
  stripeCurrentPeriodEnd: timestamp("stripe_current_period_end"),
  // Bruno 2026-06-13 — billing migrado pro Asaas. Colunas stripe_* ficam dormentes
  // (não dropar). cpfCnpj é exigido pelo Asaas pra criar o cliente.
  cpfCnpj: text("cpf_cnpj"),
  asaasCustomerId: text("asaas_customer_id"),
  asaasSubscriptionId: text("asaas_subscription_id"),
  asaasSubscriptionStatus: text("asaas_subscription_status"),
  asaasNextDueDate: timestamp("asaas_next_due_date"),
  // Bruno 2026-06-19 — pagamento primeiro: o plano só é ATRIBUÍDO (planoId) quando
  // o pagamento confirma. Ao assinar SEM trial, guardamos aqui o plano escolhido;
  // o webhook do Asaas (PAYMENT_CONFIRMED/RECEIVED) promove pending_plano_id →
  // plano_id e zera este campo. Evita o plano virar "contratado" antes de pagar.
  pendingPlanoId: uuid("pending_plano_id").references(() => planos.id),
  // Cliente VIP (cortesia): isento de cobrança/bloqueio. Só o super-admin liga/desliga.
  isVip: boolean("is_vip").notNull().default(false),
  // Quando true, este workspace serve como template de defaults pro tenantSettings
  // de novos tenants. Apenas UM workspace deveria ter essa flag ativa por vez.
  isTemplateSource: boolean("is_template_source").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Historico de eventos de assinatura/receita da PLATAFORMA (SaaS ChatBanana).
// Alimenta MRR ao longo do tempo + Churn no painel super-admin — antes so existia
// o status ATUAL em workspaces (impossivel calcular churn). Gravado pelo webhook do
// Asaas e pelas mudancas de plano/trial. NAO confundir com `transactions` (que e o
// financeiro do tenant). Bruno 2026-06-19.
export const subscriptionEvents = pgTable("subscription_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  // trial_started | subscription_active | payment_confirmed | payment_overdue |
  // plan_changed | canceled | reactivated
  eventType: text("event_type").notNull(),
  planoId: uuid("plano_id").references(() => planos.id),
  // MRR (valor mensal) vigente no momento do evento — snapshot do preco do plano.
  // Em 'canceled' = 0. Permite somar o MRR vivo em qualquer data passada.
  mrr: numeric("mrr", { precision: 10, scale: 2 }),
  details: jsonb("details").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_subevents_ws").on(table.workspaceId),
  index("idx_subevents_created").on(table.createdAt),
]);
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type InsertSubscriptionEvent = typeof subscriptionEvents.$inferInsert;

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  contato: text("contato").notNull(),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("novo"),
  canal: text("canal").notNull().default("WhatsApp"),
  owner: text("owner"),
  email: text("email"),
  telefone: text("telefone"),
  empresa: text("empresa"),
  notas: text("notas"),
  tags: text("tags").array(),
  pipeline: text("pipeline").notNull().default("vendas"),
  prioridade: text("prioridade").default("media"),
  motivoPerda: text("motivo_perda"),
  instagramId: text("instagram_id"),
  instagramUsername: text("instagram_username"),
  instagramBio: text("instagram_bio"),
  source: text("source"),
  coberturaStatus: text("cobertura_status"),
  coberturaEndereco: text("cobertura_endereco"),
  referralLeadId: integer("referral_lead_id"),
  reengajando: boolean("reengajando").default(false),
  // Ficha do cliente — espelha contacts (Bruno, 2026-05-11). Permite editar
  // dados cadastrais direto pelo dialog de leads sem precisar saltar pra
  // contacts. Sincronização contact↔lead por telefone ocorre no upsert.
  cpf: text("cpf"),
  enderecoRua: text("endereco_rua"),
  enderecoNumero: text("endereco_numero"),
  enderecoBairro: text("endereco_bairro"),
  enderecoCidade: text("endereco_cidade"),
  enderecoUf: text("endereco_uf"),
  enderecoCep: text("endereco_cep"),
  dataNascimento: text("data_nascimento"),
  // Funil de vendas (Bruno 2026-06-28): quando o vendedor arrasta o card pra uma
  // coluna MANUAL do funil, guarda aqui a `key` da pipeline_columns. NULL = card
  // segue o bot (bucketing pelo prefixo de status). Posição manual é soberana
  // sobre o estado operacional do bot — ver client/src/pages/leads.tsx (bucketing).
  displayColumn: text("display_column"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
  archivalReason: text("archival_reason"),
}, (table) => [
  index("idx_leads_workspace").on(table.workspaceId),
  index("idx_leads_nome_workspace").on(table.nome, table.workspaceId),
  index("idx_leads_telefone").on(table.telefone),
]);

export const leadTags = pgTable("lead_tags", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull().unique(),
  cor: text("cor").notNull().default("#7c5cbf"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pipelines = pgTable("pipelines", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  icon: text("icon").default("LayoutGrid"),
  cor: text("cor").notNull().default("#7c5cbf"),
  fixed: boolean("fixed").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ordem: integer("ordem").notNull().default(0),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pipelineStages = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  color: text("color").notNull().default("#7c5cbf"),
  ordem: integer("ordem").notNull().default(0),
  pipeline: text("pipeline").notNull().default("vendas"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("pipeline_stages_ws_pipeline_key_unique").on(table.workspaceId, table.pipeline, table.key),
]);

// Funil de vendas editável (Bruno 2026-06-28) — camada de EXIBIÇÃO por cima do
// backbone operacional (pipeline_stages). NÃO é tocada pelo bot: o motor segue
// gravando lead.status com os 5 prefixos universais; estas colunas só decidem
// ONDE o card aparece no CRM e quais estados do bot cada coluna "absorve".
//   autoStates = []        → coluna MANUAL (o vendedor arrasta; card fica parado
//                            via leads.display_column; bot não mexe)
//   autoStates = ['novo']  → coluna AUTOMÁTICA (card cai aqui quando o status do
//                            lead tem esse prefixo)
//   isTerminal = true      → ao cair aqui o lead é arquivado (Ganho/Perdido)
export const pipelineColumns = pgTable("pipeline_columns", {
  id: serial("id").primaryKey(),
  pipeline: text("pipeline").notNull().default("comercial"),
  key: text("key").notNull(),
  label: text("label").notNull(),
  color: text("color").notNull().default("#7c5cbf"),
  ordem: integer("ordem").notNull().default(0),
  autoStates: text("auto_states").array().notNull().default(sql`'{}'::text[]`),
  isTerminal: boolean("is_terminal").notNull().default(false),
  terminalReason: text("terminal_reason"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("pipeline_columns_ws_pipeline_key_unique").on(table.workspaceId, table.pipeline, table.key),
]);

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  empresa: text("empresa"),
  telefone: text("telefone"),
  email: text("email"),
  canal: text("canal").notNull().default("WhatsApp"),
  tags: text("tags").array(),
  notas: text("notas"),
  fotoUrl: text("foto_url"),
  fotoOrigem: text("foto_origem"),
  fotoTentativaEm: timestamp("foto_tentativa_em"),
  // Ficha do cliente — Bruno 2026-05-11. Campos opcionais editáveis pelo
  // atendente via dialog do perfil. CPF/CNPJ é cadastral do contato
  // (contacts.cpf), controlado pelo atendente.
  cpf: text("cpf"),
  enderecoRua: text("endereco_rua"),
  enderecoNumero: text("endereco_numero"),
  enderecoBairro: text("endereco_bairro"),
  enderecoCidade: text("endereco_cidade"),
  enderecoUf: text("endereco_uf"),
  enderecoCep: text("endereco_cep"),
  dataNascimento: text("data_nascimento"), // YYYY-MM-DD (text por flexibilidade)
  // Bruno 2026-06-11 (multi-ERP): última cidade (plans.cities[].id) que o cliente
  // informou no gate de cidade. Permite REUSAR a cidade entre sessões (cliente
  // recorrente não re-informa). Null = nunca informou. Só relevante p/ tenants
  // com 2+ conexões de ERP.
  coberturaCidadeId: text("cobertura_cidade_id"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_contacts_workspace").on(table.workspaceId),
  uniqueIndex("idx_contacts_workspace_phone_unique").on(table.workspaceId, table.telefone),
]);

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull().default("0"),
  stage: text("stage").notNull().default("novo"),
  contato: text("contato"),
  empresa: text("empresa"),
  owner: text("owner"),
  leadId: integer("lead_id"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_deals_workspace").on(table.workspaceId),
]);

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  telefone: text("telefone"),
  canal: text("canal").notNull().default("WhatsApp"),
  avatar: text("avatar"),
  ultimaMensagem: text("ultima_mensagem"),
  tempo: text("tempo"),
  unread: integer("unread").notNull().default(0),
  status: text("status").notNull().default("open"),
  tags: text("tags").array(),
  agente: text("agente"),
  pipeline: text("pipeline"),
  pipelineEtapa: text("pipeline_etapa"),
  prioridade: text("prioridade"),
  conexaoId: uuid("conexao_id"),
  assignedUserId: integer("assigned_user_id"),
  assignedUserName: text("assigned_user_name"),
  assignedTeamId: uuid("assigned_team_id").references(() => teams.id, { onDelete: "set null" }),
  // Bruno 2026-05-19: rastreabilidade de transferência manual entre atendentes.
  // Quando A transfere pra B (POST /api/conversations/:id/transfer com
  // targetUserId), grava quem foi o A. UI mostra ícone "recebida de A" no
  // card de B em "Em Andamento". Limpa em resolved, release, ou nova transfer.
  transferredFromUserId: integer("transferred_from_user_id"),
  transferredFromUserName: text("transferred_from_user_name"),
  transferredAt: timestamp("transferred_at"),
  // Bruno 2026-05-20: direção da última mensagem ("in" = cliente, "out" =
  // atendente/bot). Atualizada por trigger AFTER INSERT em messages. Usada no
  // frontend pra destacar preview em negrito quando última msg é do cliente.
  lastMessageDirection: text("last_message_direction"),
  // O resto da schema continua abaixo (workspaceId etc) — comentário só de marker.
  resolvedAt: timestamp("resolved_at"),
  pendente: boolean("pendente").notNull().default(true),
  lastOperatorViewAt: timestamp("last_operator_view_at"),
  lastCustomerMessageAt: timestamp("last_customer_message_at"),
  aiPaused: boolean("ai_paused").notNull().default(false),
  // Bruno 2026-05-29: conversa de SIMULAÇÃO — quando true, ispSendService pula
  // canal real (WhatsApp/Meta/etc) mas mantém persist DB + broadcast WebSocket.
  // Frontend mostra badge "🧪 SIMULAÇÃO" no card. Usado pra testes ao vivo
  // do agente sem mexer com cliente real.
  isSimulation: boolean("is_simulation").notNull().default(false),
  // attendingStartedAt = inicio do atendimento atual.
  // Setado no createConversation e RE-setado no reopen, mas NUNCA mexido por
  // outros updates. Permite o card mostrar a duração da sessão atual e
  // congelar em resolvedAt - attendingStartedAt quando resolve; um novo
  // reopen reinicia o timer do zero.
  attendingStartedAt: timestamp("attending_started_at").defaultNow(),
  // Bruno 2026-06-13: histórico PERMANENTE das situações (S/F/C/AH…) que a conversa
  // teve. As tags em conversation_situation_tags são apagadas no resolve (reset por
  // atendimento); este campo acumula (dedup) no applySituation e NUNCA é apagado —
  // é a fonte dos cards/relatórios pra mostrar a situação de TODAS as conversas
  // (inclusive as que o bot resolve sozinho, sem protocolo). Não é lido pelo agente.
  situacoesFinais: text("situacoes_finais").array(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_conversations_workspace").on(table.workspaceId),
  index("idx_conversations_workspace_status").on(table.workspaceId, table.status),
  index("idx_conversations_telefone").on(table.telefone),
  index("idx_conversations_nome_workspace").on(table.nome, table.workspaceId),
]);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  direction: text("direction").notNull(),
  texto: text("texto").notNull(),
  tipo: text("tipo").default("text"),
  arquivo: text("arquivo"),
  nomeArquivo: text("nome_arquivo"),
  hora: text("hora"),
  status: text("status").default("sent"),
  agente: text("agente"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  // Protocolo ativo da conversa no momento em que a mensagem foi salva.
  // Usado pelo frontend para inserir um separador horizontal entre protocolos
  // diferentes do mesmo contato (organização visual do histórico) e para
  // ancorar a rolagem ao abrir uma conversa via Central de Atendimentos.
  protocoloId: uuid("protocolo_id"),
  // ID externo da mensagem no canal de origem (id do canal não-oficial, wamid da
  // Meta Cloud API, mid do Instagram). Usado pra deduplicar mensagens recebidas
  // de novo após restart/reconexão, via UNIQUE INDEX parcial em runAutoMigrations.
  externalMessageId: text("external_message_id"),
  // Bruno 2026-05-21: metadata estruturada pra tipos especiais — contato (vCard
  // parsed: name/phones/emails) e localização (lat/long/label/address). Texto
  // continua humanizado em `texto` pra fallback; render do chat usa esse JSONB.
  // Shape:
  //   tipo='contact':   { contacts: [{ name, phones: [{number, type?}], emails?: [...], organization? }] }
  //   tipo='location':  { latitude, longitude, name?, address? }
  mediaMetadata: jsonb("media_metadata"),
  // Bruno 2026-05-19: ações no menu de contexto da mensagem.
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: integer("deleted_by_user_id"),
  editedAt: timestamp("edited_at"),
  originalTexto: text("original_texto"),
  replyToMessageId: integer("reply_to_message_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_messages_workspace").on(table.workspaceId),
  index("idx_messages_conversation").on(table.conversationId),
  index("idx_messages_protocolo").on(table.protocoloId),
]);

// Bruno 2026-05-20: reactions de emoji em mensagens (estilo WhatsApp).
// Local-only por enquanto — não propaga pra Meta. Uma linha por (user, msg,
// emoji); toggle remove a linha. UNIQUE INDEX (user_id, message_id, emoji)
// criado via auto-migration.
export const messageReactions = pgTable("message_reactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: integer("message_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  userName: text("user_name"),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_msg_reactions_message").on(table.messageId),
  index("idx_msg_reactions_conv").on(table.conversationId),
]);

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  descricao: text("descricao").notNull(),
  valor: numeric("valor", { precision: 10, scale: 2 }).notNull(),
  tipo: text("tipo").notNull(),
  categoria: text("categoria"),
  data: text("data").notNull(),
  status: text("status").notNull().default("pago"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_transactions_workspace").on(table.workspaceId),
]);

export const automacoes = pgTable("automacoes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  triggerType: text("trigger_type").notNull(),
  triggerChannel: text("trigger_channel"),
  status: text("status").notNull().default("DRAFT"),
  nodes: jsonb("nodes").notNull().default(sql`'[]'::jsonb`),
  execucoes: integer("execucoes").notNull().default(0),
  ultimaExecucao: timestamp("ultima_execucao"),
  createdAt: timestamp("created_at").defaultNow(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_automacoes_workspace").on(table.workspaceId),
]);

export const automacaoLogs = pgTable("automacao_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  automacaoId: uuid("automacao_id").notNull().references(() => automacoes.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  payload: jsonb("payload"),
  log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
  duracaoMs: integer("duracao_ms"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const automationNodeLogs = pgTable("automation_node_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull(),
  automacaoId: uuid("automacao_id").notNull(),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  contactId: uuid("contact_id"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
}, (table) => [
  index("idx_automation_node_logs_automacao").on(table.automacaoId),
  index("idx_automation_node_logs_workspace").on(table.workspaceId),
]);

export const disponibilidade = pgTable("disponibilidade", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  diaSemana: integer("dia_semana").notNull(),
  horaInicio: text("hora_inicio").notNull(),
  horaFim: text("hora_fim").notNull(),
  intervaloMinutos: integer("intervalo_minutos").notNull().default(30),
  ativo: boolean("ativo").notNull().default(true),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
});

export const insertDisponibilidadeSchema = createInsertSchema(disponibilidade).omit({ id: true });
export type InsertDisponibilidade = z.infer<typeof insertDisponibilidadeSchema>;
export type Disponibilidade = typeof disponibilidade.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export const insertLeadTagSchema = createInsertSchema(leadTags).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true });
export const insertDealSchema = createInsertSchema(deals).omit({ id: true, createdAt: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertTeamSchema = createInsertSchema(teams).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true, updatedAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertLeadTag = z.infer<typeof insertLeadTagSchema>;
export type LeadTag = typeof leadTags.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof deals.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

export const insertPipelineSchema = createInsertSchema(pipelines).omit({ id: true, createdAt: true });
export type InsertPipeline = z.infer<typeof insertPipelineSchema>;
export type Pipeline = typeof pipelines.$inferSelect;

export const insertPipelineStageSchema = createInsertSchema(pipelineStages).omit({ id: true, createdAt: true });
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;
export type PipelineStage = typeof pipelineStages.$inferSelect;

export const insertPipelineColumnSchema = createInsertSchema(pipelineColumns).omit({ id: true, createdAt: true });
export type InsertPipelineColumn = z.infer<typeof insertPipelineColumnSchema>;
export type PipelineColumn = typeof pipelineColumns.$inferSelect;

export const automationPendingInputs = pgTable("automation_pending_inputs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().default(1),
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  pendingType: text("pending_type").notNull().default("option_list"),
  flowId: uuid("flow_id").notNull(),
  executionId: text("execution_id").notNull(),
  nodeId: text("node_id").notNull(),
  leadId: integer("lead_id").notNull(),
  phone: text("phone").notNull(),
  options: jsonb("options").notNull(),
  context: jsonb("context").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutomacaoSchema = createInsertSchema(automacoes).omit({ id: true, createdAt: true, updatedAt: true, execucoes: true, ultimaExecucao: true });
export const insertAutomacaoLogSchema = createInsertSchema(automacaoLogs).omit({ id: true, createdAt: true });
export const insertAutomationPendingInputSchema = createInsertSchema(automationPendingInputs).omit({ id: true, createdAt: true });

export type InsertAutomacao = z.infer<typeof insertAutomacaoSchema>;
export type Automacao = typeof automacoes.$inferSelect;
export type InsertAutomacaoLog = z.infer<typeof insertAutomacaoLogSchema>;
export type AutomacaoLog = typeof automacaoLogs.$inferSelect;
export type InsertAutomationPendingInput = z.infer<typeof insertAutomationPendingInputSchema>;
export type AutomationPendingInput = typeof automationPendingInputs.$inferSelect;

export const conexoes = pgTable("conexoes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull().default("whatsapp"),
  provider: text("provider").notNull().default("evolution"),
  instanceId: text("instance_id"),
  token: text("token"),
  // Evolution GO (Bruno 2026-06-09): id interno gerado pelo Evolution no create
  // (≠ instanceId, que é o nome=conexao.id). Necessário pro DELETE da instância.
  evolutionId: text("evolution_id"),
  numero: text("numero"),
  status: text("status").notNull().default("disconnected"),
  qrCode: text("qr_code"),
  qrExpiresAt: timestamp("qr_expires_at"),
  webhookUrl: text("webhook_url"),
  ultimoPing: timestamp("ultimo_ping"),
  automacaoId: uuid("automacao_id"),
  workspaceId: uuid("workspace_id"),
  planoLimite: integer("plano_limite").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_conexoes_status").on(table.status),
  index("idx_conexoes_workspace").on(table.workspaceId),
]);

export const mensagensLog = pgTable("mensagens_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  conexaoId: uuid("conexao_id").notNull().references(() => conexoes.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  content: text("content"),
  messageId: text("message_id"),
  status: text("status").default("sent"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_mensagens_log_conexao").on(table.conexaoId),
  index("idx_mensagens_log_from").on(table.fromNumber),
  index("idx_mensagens_log_created").on(table.createdAt),
  uniqueIndex("idx_mensagens_log_message_id_unique").on(table.messageId),
]);

export const insertConexaoSchema = createInsertSchema(conexoes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConexao = z.infer<typeof insertConexaoSchema>;
export type Conexao = typeof conexoes.$inferSelect;

export const insertMensagemLogSchema = createInsertSchema(mensagensLog).omit({ id: true, createdAt: true });
export type InsertMensagemLog = z.infer<typeof insertMensagemLogSchema>;
export type MensagemLog = typeof mensagensLog.$inferSelect;

export const insertPlanoSchema = createInsertSchema(planos).omit({ id: true, createdAt: true });
export type InsertPlano = z.infer<typeof insertPlanoSchema>;
export type Plano = typeof planos.$inferSelect;

export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspaces.$inferSelect;

export const partnerInvites = pgTable("partner_invites", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  partnerWorkspaceId: uuid("partner_workspace_id").notNull().references(() => workspaces.id),
  clientEmail: text("client_email").notNull(),
  clientName: text("client_name").notNull(),
  businessName: text("business_name").notNull(),
  inviteToken: text("invite_token").notNull().unique(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdWorkspaceId: uuid("created_workspace_id"),
  workspaceId: uuid("workspace_id").references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPartnerInviteSchema = createInsertSchema(partnerInvites).omit({ id: true, createdAt: true });
export type InsertPartnerInvite = z.infer<typeof insertPartnerInviteSchema>;
export type PartnerInvite = typeof partnerInvites.$inferSelect;

export const partnerImpersonationTokens = pgTable("partner_impersonation_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  partnerWorkspaceId: uuid("partner_workspace_id").notNull().references(() => workspaces.id),
  targetWorkspaceId: uuid("target_workspace_id").notNull().references(() => workspaces.id),
  partnerUserId: integer("partner_user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPartnerImpersonationTokenSchema = createInsertSchema(partnerImpersonationTokens).omit({ id: true, createdAt: true });
export type InsertPartnerImpersonationToken = z.infer<typeof insertPartnerImpersonationTokenSchema>;
export type PartnerImpersonationToken = typeof partnerImpersonationTokens.$inferSelect;

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  url: text("url").notNull(),
  secret: text("secret"),
  provider: text("provider").default("n8n"),
  ativo: boolean("ativo").default(true),
  eventos: jsonb("eventos").default(sql`'[]'::jsonb`),
  ultimoDisparo: timestamp("ultimo_disparo"),
  totalDisparos: integer("total_disparos").default(0),
  totalErros: integer("total_erros").default(0),
  workspaceId: uuid("workspace_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_webhook_endpoints_ativo").on(table.ativo),
  index("idx_webhook_endpoints_workspace").on(table.workspaceId),
]);

export const webhookLogs = pgTable("webhook_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  evento: text("evento"),
  payload: jsonb("payload"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  sucesso: boolean("sucesso").default(false),
  tentativas: integer("tentativas").default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_webhook_logs_endpoint").on(table.endpointId),
  index("idx_webhook_logs_created").on(table.createdAt),
]);

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  tokenHash: text("token_hash").unique(),
  tokenPreview: text("token_preview"),
  permissoes: jsonb("permissoes").default(sql`'[]'::jsonb`),
  ativo: boolean("ativo").default(true),
  ultimoUso: timestamp("ultimo_uso"),
  workspaceId: uuid("workspace_id"),
  createdBy: integer("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_api_tokens_hash").on(table.tokenHash),
  index("idx_api_tokens_ativo").on(table.ativo),
]);

export const iaPrompts = pgTable("ia_prompts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").unique().notNull(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  prompt: text("prompt").notNull(),
  modelo: text("modelo").default("gpt-4o-mini"),
  temperatura: decimal("temperatura", { precision: 3, scale: 2 }).default("0.70"),
  maxTokens: integer("max_tokens").default(1000),
  ativo: boolean("ativo").default(true),
  versao: integer("versao").default(1),
  updatedBy: integer("updated_by").references(() => users.id),
  workspaceId: uuid("workspace_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_ia_prompts_slug").on(table.slug),
  index("idx_ia_prompts_ativo").on(table.ativo),
]);

export const iaPromptHistorico = pgTable("ia_prompt_historico", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  promptId: uuid("prompt_id").notNull().references(() => iaPrompts.id, { onDelete: "cascade" }),
  promptAnterior: text("prompt_anterior"),
  editadoPor: integer("editado_por").references(() => users.id),
  versao: integer("versao"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ia_prompt_historico_prompt").on(table.promptId),
]);

export const campanhas = pgTable("campanhas", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  channel: text("channel").notNull().default("whatsapp"),
  template: text("template"),
  status: text("status").notNull().default("draft"),
  total: integer("total").notNull().default(0),
  sent: integer("sent").notNull().default(0),
  read: integer("read").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  audienceType: text("audience_type").default("all"),
  ratePerMinute: integer("rate_per_minute").default(30),
  batchSize: integer("batch_size").default(10),
  delayMs: integer("delay_ms").default(2000),
  connectionId: text("connection_id"),
  scheduledAt: timestamp("scheduled_at"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_campanhas_status").on(table.status),
  index("idx_campanhas_workspace").on(table.workspaceId),
]);

export const insertCampanhaSchema = createInsertSchema(campanhas).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCampanha = z.infer<typeof insertCampanhaSchema>;
export type Campanha = typeof campanhas.$inferSelect;

export const insertWebhookEndpointSchema = createInsertSchema(webhookEndpoints).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebhookEndpoint = z.infer<typeof insertWebhookEndpointSchema>;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const insertWebhookLogSchema = createInsertSchema(webhookLogs).omit({ id: true, createdAt: true });
export type InsertWebhookLog = z.infer<typeof insertWebhookLogSchema>;
export type WebhookLog = typeof webhookLogs.$inferSelect;

export const insertApiTokenSchema = createInsertSchema(apiTokens).omit({ id: true, createdAt: true });
export type InsertApiToken = z.infer<typeof insertApiTokenSchema>;
export type ApiToken = typeof apiTokens.$inferSelect;

export const insertIaPromptSchema = createInsertSchema(iaPrompts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIaPrompt = z.infer<typeof insertIaPromptSchema>;
export type IaPrompt = typeof iaPrompts.$inferSelect;

export const insertIaPromptHistoricoSchema = createInsertSchema(iaPromptHistorico).omit({ id: true, createdAt: true });
export type InsertIaPromptHistorico = z.infer<typeof insertIaPromptHistoricoSchema>;
export type IaPromptHistorico = typeof iaPromptHistorico.$inferSelect;


export const respostasRapidas = pgTable("respostas_rapidas", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  texto: text("texto").notNull(),
  categoria: text("categoria"),
  atalho: text("atalho"),
  ordem: integer("ordem").notNull().default(0),
  ativo: boolean("ativo").notNull().default(true),
  tipoMidia: text("tipo_midia"),
  arquivoUrl: text("arquivo_url"),
  arquivoNome: text("arquivo_nome"),
  workspaceId: text("workspace_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_respostas_rapidas_workspace").on(table.workspaceId),
]);

export const insertRespostaRapidaSchema = createInsertSchema(respostasRapidas).omit({ id: true, createdAt: true });
export type InsertRespostaRapida = z.infer<typeof insertRespostaRapidaSchema>;
export type RespostaRapida = typeof respostasRapidas.$inferSelect;

export const anotacoes = pgTable("anotacoes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  conteudo: text("conteudo").notNull(),
  criadoPor: integer("criado_por").references(() => users.id),
  criadoPorNome: text("criado_por_nome"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAnotacaoSchema = createInsertSchema(anotacoes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnotacao = z.infer<typeof insertAnotacaoSchema>;
export type Anotacao = typeof anotacoes.$inferSelect;

export const integrationConfigs = pgTable("integration_configs", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id).notNull(),
  integrationId: text("integration_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("integ_config_ws_integ_idx").on(table.workspaceId, table.integrationId),
]);

export const notificacoes = pgTable("notificacoes", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),
  categoria: text("categoria").notNull().default("sistema"),
  titulo: text("titulo").notNull(),
  mensagem: text("mensagem").notNull(),
  lida: boolean("lida").notNull().default(false),
  link: text("link"),
  iconKey: text("icon_key").notNull().default("message"),
  prioridade: text("prioridade").notNull().default("media"),
  destinatarioId: integer("destinatario_id"),
  destinatarioTipo: text("destinatario_tipo").default("user"),
  leadId: integer("lead_id"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_notificacoes_dest").on(table.destinatarioId),
  index("idx_notificacoes_lida").on(table.lida),
]);

export const disparosProgramados = pgTable('disparos_programados', {
  id: uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  leadId: text('lead_id').notNull(),
  contactName: text('contact_name').notNull(),
  phoneNumber: text('phone_number').notNull(),
  messageText: text('message_text'),
  mediaUrl: text('media_url'),
  mediaType: text('media_type').default('text'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  status: text('status').default('pending'),
  errorMessage: text('error_message'),
  createdBy: text('created_by').notNull(),
  sentAt: timestamp('sent_at'),
  isRecurring: boolean('is_recurring').default(false).notNull(),
  recurrenceType: text('recurrence_type'),
  recurrencePeriod: integer('recurrence_period'),
  recurrenceFrequencyDays: integer('recurrence_frequency_days'),
  parentDisparoId: uuid('parent_disparo_id'),
  // Bruno 2026-06-05: disparo por TEMPLATE oficial (Meta) vs TEXTO LIVRE (Evolution).
  // Regra: template → canal Meta (passa fora da janela 24h); texto livre → Evolution.
  dispatchMode: text('dispatch_mode').default('texto_livre').notNull(), // 'texto_livre' | 'template'
  channelForced: text('channel_forced'), // 'evolution' | 'meta' (derivado do modo)
  templateName: text('template_name'),
  templateLanguage: text('template_language').default('pt_BR'),
  // Mapeamento das variáveis do template, ordenado por índice:
  // [{ index:1, kind:'token'|'fixed', value:'nome' | 'texto fixo' }]
  templateVariables: jsonb('template_variables'),
  // Categoria pra organizar a lista: 'cobranca'|'boas_vindas'|'aniversario'|'manual'
  category: text('category').default('manual'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index("idx_disparos_workspace").on(table.workspaceId),
]);

export const insertDisparoProgramadoSchema = createInsertSchema(disparosProgramados).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDisparoProgramado = z.infer<typeof insertDisparoProgramadoSchema>;
export type DisparoProgramado = typeof disparosProgramados.$inferSelect;

export const automationVariables = pgTable("automation_variables", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  valor: text("valor"),
  tipo: text("tipo").notNull().default("text"),
  escopo: text("escopo").notNull().default("lead"),
  leadId: integer("lead_id"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_auto_vars_lead").on(table.leadId),
  index("idx_auto_vars_workspace").on(table.workspaceId),
  index("idx_auto_vars_nome").on(table.nome),
]);

export const insertAutomationVariableSchema = createInsertSchema(automationVariables).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutomationVariable = z.infer<typeof insertAutomationVariableSchema>;
export type AutomationVariable = typeof automationVariables.$inferSelect;

export const documentTemplates = pgTable("document_templates", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  conteudoHtml: text("conteudo_html").notNull(),
  categoria: text("categoria").default("contrato"),
  ativo: boolean("ativo").notNull().default(true),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;

export const insertNotificacaoSchema = createInsertSchema(notificacoes).omit({ id: true, createdAt: true });
export type InsertNotificacao = z.infer<typeof insertNotificacaoSchema>;
export type Notificacao = typeof notificacoes.$inferSelect;

export const chatInterno = pgTable("chat_interno", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  userName: text("user_name").notNull(),
  userAvatar: text("user_avatar"),
  texto: text("texto").notNull(),
  targetUserId: integer("target_user_id"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_chat_interno_conversation").on(table.conversationId),
  index("idx_chat_interno_workspace").on(table.workspaceId),
]);

export const insertChatInternoSchema = createInsertSchema(chatInterno).omit({ id: true, createdAt: true });
export type InsertChatInterno = z.infer<typeof insertChatInternoSchema>;
export type ChatInterno = typeof chatInterno.$inferSelect;

export const pesquisasSatisfacao = pgTable("pesquisas_satisfacao", {
  id: serial("id").primaryKey(),
  titulo: text("titulo").notNull(),
  opcoes: jsonb("opcoes").$type<string[]>().notNull().default(["Muito satisfeito", "Satisfeito", "Neutro", "Insatisfeito", "Muito insatisfeito"]),
  ativo: boolean("ativo").notNull().default(true),
  sistema: boolean("sistema").notNull().default(false),
  respostaRapidaId: integer("resposta_rapida_id"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPesquisaSatisfacaoSchema = createInsertSchema(pesquisasSatisfacao).omit({ id: true, createdAt: true });
export type InsertPesquisaSatisfacao = z.infer<typeof insertPesquisaSatisfacaoSchema>;
export type PesquisaSatisfacao = typeof pesquisasSatisfacao.$inferSelect;

export const respostasPesquisa = pgTable("respostas_pesquisa", {
  id: serial("id").primaryKey(),
  pesquisaId: integer("pesquisa_id").notNull().references(() => pesquisasSatisfacao.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id"),
  leadId: integer("lead_id"),
  resposta: text("resposta").notNull(),
  nota: integer("nota"),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_respostas_pesquisa_workspace").on(table.workspaceId),
  index("idx_respostas_pesquisa_pesquisa").on(table.pesquisaId),
]);

export const insertRespostaPesquisaSchema = createInsertSchema(respostasPesquisa).omit({ id: true, createdAt: true });
export type InsertRespostaPesquisa = z.infer<typeof insertRespostaPesquisaSchema>;
export type RespostaPesquisa = typeof respostasPesquisa.$inferSelect;

export const platformConfig = pgTable("platform_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const whatsappOfficialConnections = pgTable("whatsapp_official_connections", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }).unique(),
  wabaId: text("waba_id").notNull(),
  phoneNumberId: text("phone_number_id").notNull(),
  displayPhoneNumber: text("display_phone_number").notNull(),
  businessName: text("business_name").notNull(),
  accessToken: text("access_token").notNull(),
  appSecret: text("app_secret"),
  tokenType: text("token_type").notNull().default("user"),
  tokenExpiresAt: timestamp("token_expires_at"),
  webhookVerified: boolean("webhook_verified").notNull().default(false),
  messagingLimitTier: text("messaging_limit_tier").default("TIER_1K"),
  qualityRating: text("quality_rating").default("GREEN"),
  status: text("status").notNull().default("active"),
  metaBusinessId: text("meta_business_id"),
  connectedAt: timestamp("connected_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  automacaoId: uuid("automacao_id").references(() => automacoes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWhatsappOfficialConnectionSchema = createInsertSchema(whatsappOfficialConnections).omit({ id: true, createdAt: true, updatedAt: true, connectedAt: true });
export type InsertWhatsappOfficialConnection = z.infer<typeof insertWhatsappOfficialConnectionSchema>;
export type SelectWhatsappOfficialConnection = typeof whatsappOfficialConnections.$inferSelect;

export const whatsappMessageTemplates = pgTable("whatsapp_message_templates", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  connectionId: integer("connection_id").notNull().references(() => whatsappOfficialConnections.id, { onDelete: "cascade" }),
  templateName: text("template_name").notNull(),
  templateId: text("template_id"),
  category: text("category").notNull(),
  language: text("language").notNull().default("pt_BR"),
  status: text("status").notNull().default("PENDING"),
  headerType: text("header_type"),
  headerContent: text("header_content"),
  bodyText: text("body_text").notNull(),
  footerText: text("footer_text"),
  buttons: jsonb("buttons"),
  variablesCount: integer("variables_count").notNull().default(0),
  rejectionReason: text("rejection_reason"),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_wmt_workspace_name_lang").on(table.workspaceId, table.templateName, table.language),
]);

export const insertWhatsappMessageTemplateSchema = createInsertSchema(whatsappMessageTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWhatsappMessageTemplate = z.infer<typeof insertWhatsappMessageTemplateSchema>;
export type SelectWhatsappMessageTemplate = typeof whatsappMessageTemplates.$inferSelect;

export const whatsappWebhookEvents = pgTable("whatsapp_webhook_events", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id"),
  phoneNumberId: text("phone_number_id").notNull(),
  wabaId: text("waba_id"),
  eventType: text("event_type").notNull(),
  messageId: text("message_id"),
  fromNumber: text("from_number"),
  conversationId: integer("conversation_id"),
  rawPayload: jsonb("raw_payload").notNull(),
  processed: boolean("processed").notNull().default(false),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  receivedAt: timestamp("received_at").defaultNow(),
}, (table) => [
  index("idx_wwe_phone_received").on(table.phoneNumberId, table.receivedAt),
  index("idx_wwe_message_id").on(table.messageId),
]);

export const instagramConnections = pgTable("instagram_connections", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  igUserId: text("ig_user_id").notNull(),
  // ID que a Meta usa na ENTREGA dos webhooks (ex.: id comercial 1784...), que pode
  // diferir do ig_user_id gravado no connect (ex.: Instagram-scoped 2756... do IG Login).
  // Casamos o webhook por ig_user_id OU ig_webhook_id. Bruno 2026-07-11.
  igWebhookId: text("ig_webhook_id"),
  igUsername: text("ig_username").notNull(),
  accessToken: text("access_token").notNull(),
  pageId: text("page_id"),
  pageName: text("page_name"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isActive: boolean("is_active").default(true),
  webhookVerified: boolean("webhook_verified").default(false),
  dmCount: integer("dm_count").default(0),
  dmCountMonth: integer("dm_count_month").default(0),
  dmAutomacaoId: uuid("dm_automacao_id"),
  commentAutomacaoId: uuid("comment_automacao_id"),
  automacaoId: uuid("automacao_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInstagramConnectionSchema = createInsertSchema(instagramConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInstagramConnection = z.infer<typeof insertInstagramConnectionSchema>;
export type SelectInstagramConnection = typeof instagramConnections.$inferSelect;

// Registro dos pedidos de EXCLUSÃO DE DADOS da Meta (Data Deletion Callback).
// A Meta chama o callback com um signed_request; guardamos o código de confirmação
// pra a página de status que a Meta valida (GET .../data-deletion/status?code=).
export const instagramDataDeletions = pgTable("instagram_data_deletions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  confirmationCode: text("confirmation_code").notNull().unique(),
  igUserId: text("ig_user_id"),
  status: text("status").notNull().default("completed"), // completed | pending
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type SelectInstagramDataDeletion = typeof instagramDataDeletions.$inferSelect;

export const instagramMessages = pgTable("instagram_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  instagramConnectionId: uuid("instagram_connection_id").notNull().references(() => instagramConnections.id, { onDelete: "cascade" }),
  igMessageId: text("ig_message_id").notNull(),
  igConversationId: text("ig_conversation_id"),
  fromIgUserId: text("from_ig_user_id").notNull(),
  fromIgUsername: text("from_ig_username"),
  toIgUserId: text("to_ig_user_id").notNull(),
  direction: text("direction").notNull(),
  messageType: text("message_type").notNull().default("text"),
  content: text("content"),
  mediaUrl: text("media_url"),
  metadata: jsonb("metadata"),
  leadId: integer("lead_id").references(() => leads.id),
  automationTriggered: boolean("automation_triggered").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ig_messages_workspace_idx").on(table.workspaceId),
  uniqueIndex("ig_message_id_uniq").on(table.igMessageId),
  index("ig_messages_from_user_idx").on(table.fromIgUserId),
  index("ig_messages_created_at_idx").on(table.createdAt),
]);

export const insertInstagramMessageSchema = createInsertSchema(instagramMessages).omit({ id: true, createdAt: true });
export type InsertInstagramMessage = z.infer<typeof insertInstagramMessageSchema>;
export type SelectInstagramMessage = typeof instagramMessages.$inferSelect;

export const instaProspectFlows = pgTable("insta_prospect_flows", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull(),
  ativo: boolean("ativo").default(false),
  commentEnabled: boolean("comment_enabled").default(false),
  dmEnabled: boolean("dm_enabled").default(false),
  storyEnabled: boolean("story_enabled").default(false),
  keyword: text("keyword"),
  keywordMatchType: text("keyword_match_type").default("contains"),
  dmKeyword: text("dm_keyword"),
  dmKeywordMatchType: text("dm_keyword_match_type").default("contains"),
  storyFirstMessage: text("story_first_message"),
  postId: text("post_id"),
  publicReply: text("public_reply"),
  commentReplyMode: text("comment_reply_mode").default("static"),
  commentAiPrompt: text("comment_ai_prompt"),
  postContext: text("post_context"),
  firstMessage: text("first_message"),
  firstMessageMediaUrl: text("first_message_media_url"),
  firstMessageMediaType: text("first_message_media_type"),
  aiPersona: text("ai_persona").default("vendedor"),
  aiSystemPrompt: text("ai_system_prompt").notNull(),
  aiObjective: text("ai_objective"),
  aiModel: text("ai_model").default("gpt-4o-mini"),
  aiTemperature: real("ai_temperature").default(0.7),
  aiMaxTokens: integer("ai_max_tokens").default(300),
  finalAction: text("final_action").default("atribuir_agente"),
  assignStrategy: text("assign_strategy").default("disponivel"),
  autoTags: jsonb("auto_tags").default([]),
  delaySeconds: integer("delay_seconds").default(0),
  totalTriggers: integer("total_triggers").default(0),
  totalLeads: integer("total_leads").default(0),
  totalConverted: integer("total_converted").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("insta_prospect_workspace_idx").on(t.workspaceId),
  index("insta_prospect_tipo_idx").on(t.tipo),
]);

export const instaProspectSessions = pgTable("insta_prospect_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  flowId: uuid("flow_id").notNull().references(() => instaProspectFlows.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leads.id),
  igUserId: text("ig_user_id").notNull(),
  igUsername: text("ig_username"),
  status: text("status").default("em_andamento"),
  conversationHistory: jsonb("conversation_history").default([]),
  triggerType: text("trigger_type"),
  triggerContent: text("trigger_content"),
  collectedData: jsonb("collected_data").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("insta_prospect_sessions_workspace_idx").on(t.workspaceId),
  index("insta_prospect_sessions_flow_idx").on(t.flowId),
  index("insta_prospect_sessions_ig_user_idx").on(t.igUserId),
]);

// ═══════════════════════════════════════════════════════════════════════════
// INSTAFLIX — automação de POSTAGEM no Instagram (feed: imagem/carrossel;
// reels na fase 2). É um módulo à parte do Insta Prospect (que trata DM):
// aqui a IA gera a arte + legenda, agenda e publica no feed. Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

// 1) Cérebro da marca: o que alimenta os agentes de IA (voz, cores, produtos, temas).
export const instaflixBrandKits = pgTable("instaflix_brand_kits", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  instagramConnectionId: uuid("instagram_connection_id").references(() => instagramConnections.id, { onDelete: "cascade" }),
  nome: text("nome").notNull().default("Marca principal"),
  descricaoNegocio: text("descricao_negocio"),        // o que o negócio faz
  segmento: text("segmento"),                          // slug do perfil de segmento (instaflixSegmentos); null = genérico
  onboardingConcluido: boolean("onboarding_concluido").default(false), // wizard inicial do módulo já feito?
  publicoAlvo: text("publico_alvo"),
  tomVoz: text("tom_voz"),                             // voz/tom da marca
  paletaCores: jsonb("paleta_cores").default([]),      // ["#1474ff", ...]
  fontes: jsonb("fontes").default({}),                 // tipografia preferida
  logoUrl: text("logo_url"),                           // logo "primária" (= logos[0]; compat retroativa)
  logos: jsonb("logos").default([]),                   // variações da logo: [{ url }] — a IA escolhe a que combina com o fundo de cada arte
  hashtagsPadrao: jsonb("hashtags_padrao").default([]),
  diretrizes: text("diretrizes"),                      // do/don't da marca
  exemplosLegendas: jsonb("exemplos_legendas").default([]), // aprendidos do feed
  temasRecorrentes: jsonb("temas_recorrentes").default([]),
  // Fontes de conhecimento habilitadas + config: feed IG, site, CRM, RSS, uploads.
  fontesConhecimento: jsonb("fontes_conhecimento").default({}),
  // Base de conhecimento ingerida (chunks). Embeddings/pgvector ficam pra depois.
  baseConhecimento: jsonb("base_conhecimento").default([]),
  // Materiais enviados pelo usuário (PDF/imagem) — a IA extrai o conteúdo e usa
  // como fonte de verdade sobre o negócio. Isolado do baseConhecimento (que o
  // sync do IG sobrescreve). Item: { id, nome, url, tipo, tamanho, resumo, addedAt }.
  documentos: jsonb("documentos").default([]),
  // ── Fontes de munição extra (expansão do brand kit) ──
  produtosServicos: text("produtos_servicos"),          // manual: catálogo/serviços
  planosValores: text("planos_valores"),                // planos, pacotes e PREÇOS reais (SaaS/academia/serviço) — autorizado p/ conteúdo
  siteUrl: text("site_url"),                            // site do negócio (scrape)
  siteResumo: text("site_resumo"),                      // resumo do site pela IA
  faqClientes: jsonb("faq_clientes").default([]),        // perguntas frequentes (das conversas)
  provaSocial: jsonb("prova_social").default([]),        // negócios ganhos/depoimentos (deals)
  ativo: boolean("ativo").default(true),
  ultimaSincronizacao: timestamp("ultima_sincronizacao"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("instaflix_brand_kits_workspace_idx").on(t.workspaceId),
]);
export const insertInstaflixBrandKitSchema = createInsertSchema(instaflixBrandKits).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInstaflixBrandKit = z.infer<typeof insertInstaflixBrandKitSchema>;
export type InstaflixBrandKit = typeof instaflixBrandKits.$inferSelect;

// 2) Pilares de conteúdo: os "temas-guia" que o Estrategista rotaciona.
export const instaflixPillars = pgTable("instaflix_pillars", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),                        // "Educativo", "Promoção", ...
  descricao: text("descricao"),
  objetivo: text("objetivo").default("autoridade"),    // autoridade|vendas|engajamento|bastidores
  peso: integer("peso").default(1),                    // frequência relativa na rotação
  promptGuia: text("prompt_guia"),                     // direção pro agente estrategista
  exemplos: jsonb("exemplos").default([]),
  ativo: boolean("ativo").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("instaflix_pillars_workspace_idx").on(t.workspaceId),
]);
export const insertInstaflixPillarSchema = createInsertSchema(instaflixPillars).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInstaflixPillar = z.infer<typeof insertInstaflixPillarSchema>;
export type InstaflixPillar = typeof instaflixPillars.$inferSelect;

// 3) Regras de agenda: quando/como postar. approvalMode = híbrido (auto vs revisão).
export const instaflixScheduleRules = pgTable("instaflix_schedule_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  instagramConnectionId: uuid("instagram_connection_id").references(() => instagramConnections.id, { onDelete: "cascade" }),
  pillarId: uuid("pillar_id").references(() => instaflixPillars.id, { onDelete: "set null" }),
  nome: text("nome").notNull(),
  formato: text("formato").notNull().default("carrossel"), // 'imagem' | 'carrossel'
  diasSemana: jsonb("dias_semana").default([]),        // [1,3,5]  0=dom..6=sáb
  horarios: jsonb("horarios").default([]),             // ["09:00","18:00"] no timezone
  timezone: text("timezone").default("America/Sao_Paulo"),
  numImagens: integer("num_imagens").default(3),       // itens do carrossel (2-10)
  // Híbrido configurável: 'requer_aprovacao' (default) cai na fila; 'auto_post' publica sozinho.
  approvalMode: text("approval_mode").default("requer_aprovacao"),
  // Antecedência (horas) com que o rascunho é gerado antes do horário do post.
  antecedenciaHoras: integer("antecedencia_horas").default(24),
  ativo: boolean("ativo").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("instaflix_schedule_rules_workspace_idx").on(t.workspaceId),
]);
export const insertInstaflixScheduleRuleSchema = createInsertSchema(instaflixScheduleRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInstaflixScheduleRule = z.infer<typeof insertInstaflixScheduleRuleSchema>;
export type InstaflixScheduleRule = typeof instaflixScheduleRules.$inferSelect;

// 4) Post: uma peça de conteúdo, do rascunho ao publicado. É o que o publicador claima.
export const instaflixPosts = pgTable("instaflix_posts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  instagramConnectionId: uuid("instagram_connection_id").references(() => instagramConnections.id, { onDelete: "cascade" }),
  ruleId: uuid("rule_id").references(() => instaflixScheduleRules.id, { onDelete: "set null" }),
  pillarId: uuid("pillar_id").references(() => instaflixPillars.id, { onDelete: "set null" }),
  formato: text("formato").notNull().default("carrossel"), // 'imagem' | 'carrossel'
  tema: text("tema"),                                  // título/assunto escolhido
  briefIa: jsonb("brief_ia").default({}),              // brief do estrategista
  legenda: text("legenda"),
  hashtags: jsonb("hashtags").default([]),
  // Mídias: [{ ordem, url, tipo:'image', promptIa, altText }]. Carrossel = várias.
  midias: jsonb("midias").default([]),
  // Ciclo: rascunho→gerando→aguardando_aprovacao→agendado→publicando→publicado/falhou/reprovado
  status: text("status").notNull().default("rascunho"),
  progresso: integer("progresso").default(0),          // 0-100 durante a geração por IA (status 'gerando')
  approvalMode: text("approval_mode").default("requer_aprovacao"), // snapshot da regra
  geradoPor: text("gerado_por").default("ia"),         // 'ia' | 'manual'
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  aprovadoPor: text("aprovado_por"),
  igContainerId: text("ig_container_id"),              // creation_id do container Graph
  igMediaId: text("ig_media_id"),                      // id da mídia publicada
  igPermalink: text("ig_permalink"),
  errorMessage: text("error_message"),
  tentativas: integer("tentativas").default(0),
  metadata: jsonb("metadata").default({}),             // custo IA, modelos usados, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("instaflix_posts_workspace_idx").on(t.workspaceId),
  index("instaflix_posts_status_sched_idx").on(t.status, t.scheduledAt),
]);
export const insertInstaflixPostSchema = createInsertSchema(instaflixPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInstaflixPost = z.infer<typeof insertInstaflixPostSchema>;
export type InstaflixPost = typeof instaflixPosts.$inferSelect;

// 5) Métricas pós-publicação: fecha o loop (o estrategista aprende o que performa).
export const instaflixPostMetrics = pgTable("instaflix_post_metrics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  postId: uuid("post_id").notNull().references(() => instaflixPosts.id, { onDelete: "cascade" }),
  igMediaId: text("ig_media_id"),
  alcance: integer("alcance").default(0),
  impressoes: integer("impressoes").default(0),
  curtidas: integer("curtidas").default(0),
  comentarios: integer("comentarios").default(0),
  salvamentos: integer("salvamentos").default(0),
  compartilhamentos: integer("compartilhamentos").default(0),
  raw: jsonb("raw").default({}),
  coletadoAt: timestamp("coletado_at").defaultNow().notNull(),
}, (t) => [
  index("instaflix_post_metrics_workspace_idx").on(t.workspaceId),
  index("instaflix_post_metrics_post_idx").on(t.postId),
]);
export const insertInstaflixPostMetricSchema = createInsertSchema(instaflixPostMetrics).omit({ id: true });
export type InsertInstaflixPostMetric = z.infer<typeof insertInstaflixPostMetricSchema>;
export type InstaflixPostMetric = typeof instaflixPostMetrics.$inferSelect;

export const waAutomations = pgTable("wa_automations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull(),
  ativo: boolean("ativo").default(false),
  keyword: text("keyword"),
  keywordMatchType: text("keyword_match_type").default("contains"),
  templateName: text("template_name"),
  replyMessage: text("reply_message"),
  aiEnabled: boolean("ai_enabled").default(false),
  aiSystemPrompt: text("ai_system_prompt"),
  aiObjective: text("ai_objective"),
  scheduleStart: text("schedule_start"),
  scheduleEnd: text("schedule_end"),
  totalTriggers: integer("total_triggers").default(0),
  totalReplies: integer("total_replies").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("wa_automations_workspace_idx").on(t.workspaceId),
]);

export const insertWaAutomationSchema = createInsertSchema(waAutomations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  totalTriggers: true,
  totalReplies: true,
});
export type InsertWaAutomation = z.infer<typeof insertWaAutomationSchema>;
export type SelectWaAutomation = typeof waAutomations.$inferSelect;

export const protocols = pgTable("protocols", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  numero: text("numero").notNull(),
  titulo: text("titulo").notNull(),
  titularNome: text("titular_nome"),
  cpf: text("cpf"),
  // Snapshot do contato no momento da criação do protocolo. Independe de a
  // conversa/lead ainda existir — garante que o histórico de protocolos continua
  // identificável mesmo após delete de conversa. Adicionado em 2026-04-23.
  contatoNome: text("contato_nome"),
  contatoTelefone: text("contato_telefone"),
  descricao: text("descricao"),
  categoria: text("categoria").notNull().default("geral"),
  // Lista de departamentos/categorias tocados durante o atendimento.
  // Uma conversa pode passar por financeiro + suporte — esse array acumula
  // todos os setores relevantes. `categoria` fica como o primário/dominante
  // (usado em filtros e relatórios), `departamentos` tem o histórico completo.
  departamentos: text("departamentos").array(),
  prioridade: text("prioridade").notNull().default("media"),
  status: text("status").notNull().default("aberto"),
  conversationId: integer("conversation_id"),
  contactId: integer("contact_id"),
  agenteId: integer("agente_id"),
  agenteNome: text("agente_nome"),
  tags: text("tags").array(),
  slaPrazo: timestamp("sla_prazo"),
  slaViolado: boolean("sla_violado").notNull().default(false),
  observacaoAtendente: text("observacao_atendente"),
  csatEnviado: boolean("csat_enviado").notNull().default(false),
  csatNota: integer("csat_nota"),
  csatRespondidoEm: timestamp("csat_respondido_em"),
  criadoPorId: integer("criado_por_id"),
  criadoPorNome: text("criado_por_nome"),
  resolvedAt: timestamp("resolved_at"),
  closedAt: timestamp("closed_at"),
  // Bruno 2026-05-17: separação de tempos de atendimento.
  // tempo_bot_seconds: tempo total que o bot ficou conduzindo (sem humano
  // assumido) — soma das janelas em que aiPaused=false E assignedUserId=null.
  // tempo_humano_seconds: tempo total com humano assumido (assignedUserId
  // populado OU aiPaused=true sem assignedUserId — equipe vê na fila).
  // last_bucket_start_at: timestamp do início da janela atual (bot ou humano).
  // last_bucket: 'bot' | 'humano' | null — qual janela está aberta.
  tempoBotSeconds: integer("tempo_bot_seconds").notNull().default(0),
  tempoHumanoSeconds: integer("tempo_humano_seconds").notNull().default(0),
  lastBucketStartAt: timestamp("last_bucket_start_at"),
  lastBucket: text("last_bucket"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_protocols_workspace").on(t.workspaceId),
  index("idx_protocols_status").on(t.workspaceId, t.status),
  index("idx_protocols_numero").on(t.workspaceId, t.numero),
]);

export const insertProtocolSchema = createInsertSchema(protocols).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProtocol = z.infer<typeof insertProtocolSchema>;
export type SelectProtocol = typeof protocols.$inferSelect;

export const protocolEvents = pgTable("protocol_events", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  protocolId: uuid("protocol_id").notNull().references(() => protocols.id, { onDelete: "cascade" }),
  tipo: text("tipo").notNull(),
  descricao: text("descricao"),
  usuarioId: integer("usuario_id"),
  usuarioNome: text("usuario_nome"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_protocol_events_protocol").on(t.protocolId),
]);

export const insertProtocolEventSchema = createInsertSchema(protocolEvents).omit({ id: true, createdAt: true });
export type InsertProtocolEvent = z.infer<typeof insertProtocolEventSchema>;
export type SelectProtocolEvent = typeof protocolEvents.$inferSelect;

export const conversationSituationTags = pgTable("conversation_situation_tags", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  situationCode: text("situation_code").notNull(),
  tagSlug: text("tag_slug").notNull(),
  origin: text("origin").notNull().default("auto"),
  appliedBy: integer("applied_by"),
  // Bruno 2026-05-28 (Onda 3.3 tags/persistência): motivo opcional pra audit
  // forense. Caller (handler/validator/escalation) pode passar contexto curto
  // ("escalateFallback:llm_no_text", "cancelMotivo:9", "complaint:score=0.92")
  // pra atendente humano entender PORQUE a tag foi aplicada além de QUANDO.
  motivo: text("motivo"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqConvCode: uniqueIndex("conv_situation_tags_conv_code_unique").on(table.conversationId, table.situationCode),
}));

export const insertConversationSituationTagSchema = createInsertSchema(conversationSituationTags);
export type ConversationSituationTag = typeof conversationSituationTags.$inferSelect;
export type InsertConversationSituationTag = typeof conversationSituationTags.$inferInsert;

export const protocolSlaConfigs = pgTable("protocol_sla_configs", {
  id: serial("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  categoria: text("categoria").notNull(),
  prazoHoras: integer("prazo_horas").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_protocol_sla_ws_cat").on(t.workspaceId, t.categoria),
]);

export const insertProtocolSlaConfigSchema = createInsertSchema(protocolSlaConfigs).omit({ id: true, createdAt: true });
export type InsertProtocolSlaConfig = z.infer<typeof insertProtocolSlaConfigSchema>;
export type SelectProtocolSlaConfig = typeof protocolSlaConfigs.$inferSelect;

export const tenantSettings = pgTable('tenant_settings', {
  id:           serial('id').primaryKey(),
  tenantId:     uuid('tenant_id').notNull(),
  settingsJson: jsonb('settings_json').notNull(),
  // Quando true, settingsJson foi copiado do template source e tenant ainda
  // não salvou alterações próprias. Ao primeiro updateTenantSettings vira false.
  // Enquanto true, getTenantSettings re-sincroniza com o template — novos valores
  // configurados pelo Bruno propagam automaticamente pros tenants não-preenchidos.
  inheritedFromTemplate: boolean("inherited_from_template").default(false),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
}, (t) => [
  uniqueIndex("tenant_settings_tenant_id_unique").on(t.tenantId),
]);

export const insertTenantSettingsSchema = createInsertSchema(tenantSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantSettings = z.infer<typeof insertTenantSettingsSchema>;
export type TenantSettings = typeof tenantSettings.$inferSelect;

export const leadStageHistory = pgTable("lead_stage_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  conversationId: integer("conversation_id"),
  pipeline: text("pipeline").notNull(),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  toStageLabel: text("to_stage_label"),
  trigger: text("trigger"),
  workspaceId: uuid("workspace_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type LeadStageHistory = typeof leadStageHistory.$inferSelect;

export interface AgentCapability {
  enabled: boolean;
  situations: string[];
  escalate_to_human_if_disabled: boolean;
}

export interface AgentCapabilities {
  FINANCEIRO: AgentCapability;
  SUPORTE_TECNICO: AgentCapability;
  VENDAS: AgentCapability;
  CANCELAMENTO: AgentCapability;
}

export interface TenantSettingsJson {
  // IMPORTANTE: manter em sync com `BusinessRules` em server/services/agents/types.ts.
  // Os fields abaixo representam a config por-tenant — alimentada pelo questionário
  // do Bruno e consumida pelos agentes especializados em runtime.
  businessRules: {
    suspendedToFinance: boolean;
    allowDepartmentSwitch: boolean;
    confidenceThreshold: number;
    showOnlyOverdueIfSuspended: boolean;
    allowPix: boolean;
    allowBarcode: boolean;
    allowTrustUnlock: boolean;
    allowAutoOpenTicket: boolean;
    askRouterBeforeEscalateOffline?: boolean;
    requireRebootStep: boolean;
    agent_priorities?: Record<string, number>;
    fluid_routing_threshold?: number;
    agent_capabilities?: AgentCapabilities;
    // Setores opcionais (Bruno 2026-06-11) — sync com BusinessRules. Default OFF.
    vendasSectorEnabled?: boolean;
    retencaoSectorEnabled?: boolean;
    suporteN2SectorEnabled?: boolean;
    responseDelay?: number;
    informationalResolveTimeoutSec?: number;
    humanize?: {
      coalescenceWindowMs?: number;
      coalescenceMaxMs?: number;
      burstGapMs?: number;
      burstExtensionMs?: number;
      mediaFlushMs?: number;
      turnCloseFlushMs?: number;
      abortOnClientTyping?: boolean;
    };

    // Limites operacionais do motor. Movidos pra config porque cada ISP pode
    // ter política diferente (ex.: pausa de 60 ou 120 dias em vez de 90).
    limits?: {
      pausaMaxDias?: number;                     // F2 — período máximo de suspensão temporária
      checklistMaxTentativas?: number;           // C11/C7 — tentativas antes de escalar parcial
      sessionStaleMs?: number;                   // tempo sem interação pra resetar sessão
      maxRecursionDepth?: number;                // proteção contra loop interno do motor
      maxTurnsPerSession?: number;               // máx respostas do bot na sessão antes de escalar
      ambiguityRetriesMax?: number;              // tentativas de repetir pergunta antes de escalar
      maxSupportDeniedBeforeEscalate?: number;   // tentativas de suporte negado (inadimplente) antes de escalar
    };

    // ── Tom e estilo (questionário) ──────────────────────────────────────
    estiloResposta?: 'direto' | 'consultivo' | 'adaptativo';
    tomCobranca?: 'amigavel' | 'progressivo' | 'firme';

    // ── FAQ AI compose (Bruno, Fase 1 — IA livre na FAQ) ─────────────────
    // Modo de composição da resposta de FAQ:
    //   'off'             — texto cru cadastrado (comportamento atual, default seguro)
    //   'sintese'         — IA compõe quando match parcial (0.35 ≤ score < 0.85),
    //                       usando FAQ + businessRules + horário como fontes fechadas
    //   'sintese+fallback'— acima + responde mesmo SEM FAQ se questionário cobrir
    // IA recebe dossiê fechado, regra dura "se não está nas fontes, handoff".
    // Match alto (score ≥ 0.85) sempre devolve texto cru — protege números/prazos.
    faqAiCompose?: 'off' | 'sintese' | 'sintese+fallback';

    // ── Agent tooling (Bruno, Fase 2 — IA livre nos agentes) ──────────────
    // Quando 'on' pra um agente, troca a máquina de estados por loop
    // ── Financeiro (q7, q10, F10) ────────────────────────────────────────
    promessaDias?: number;
    promessasPerMonth?: number;
    parcelamentoMax?: number;
    descontoAVistaMax?: string;
    f10Acao?: 'apresentar_planos' | 'oferecer_desconto' | 'escalar_comercial' | 'escalar_humano';

    // ── Suporte (SLA, S6, S11, S13, q120/q121) ───────────────────────────
    slaEmergencia?: string;
    slaComum?: string;
    s6Acao?: 'abrir_os' | 'orientar_teste' | 'escalar_noc' | 'informar_congestionamento';
    s11Acao?: 'verificar_ssid' | 'reset_fabrica' | 'abrir_os' | 'escalar_humano';
    s13Permitido?: 'tudo' | 'velocidade' | 'nao';
    roteadorOferece5g?: 'sim' | 'nao' | 'parcial';
    velocidadeMinimaSpeedtest?: number;
    // q76 consolidado (2026-04-23) — modo de tolerância de velocidade:
    //  'pct_20' | 'pct_30' | 'pct_50' → calcula em runtime (plano × %)
    //  'qualquer' → qualquer valor abaixo do plano escala
    //  'mbps' → usa `velocidadeMinimaSpeedtest` (absoluto)
    toleranciaVelocidadeModo?: 'pct_20' | 'pct_30' | 'pct_50' | 'qualquer' | 'mbps';
    // Piso operacional pra teste em Wi-Fi 2.4 GHz (banda fisicamente limitada
    // a 40-100 Mbps). Default 50. Não vem do questionário — é override por tenant
    // pra casos específicos (ex: provedor de fibra rural com plano de 100 Mb).
    velocidadeMinima2_4g?: number;

    // ── Retenção / cancelamento (C6) ─────────────────────────────────────
    retencaoOfertas?: string[];
    retencaoDescontoMax?: string;
    retencaoTentativas?: number;
    retencaoSemRetencao?: string[];
    retencaoDowngrade?: string;
    retencaoEstrategia?: string;

    // ── Comercial (C7, C9) ───────────────────────────────────────────────
    c7Processo?: 'agente_processa' | 'agente_encaminha' | 'escalar_humano';
    /** @deprecated Bruno 2026-05-13: C9 do agente é sempre "coleta + handoff humano" (ver comercialAgent.ts L876). Campo mantido pra compat com tenants antigos, mas ignorado em runtime. */
    c9Processo?: 'agente_agenda' | 'agente_encaminha' | 'escalar_humano';

    // ── Escalação / equipe (q14, q15, q18) ───────────────────────────────
    ambiguityRetriesMax?: number;
    canalEscalonacao?: 'supervisor_whatsapp' | 'grupo_interno' | 'fila_erp' | 'outro';
    equipeDividaPorSetor?: 'sim_separado' | 'nao_unica' | 'sim_parcial';
    maxSupportDeniedBeforeEscalate?: number;

    // ── CSAT (avaliação pós-atendimento) ─────────────────────────────────
    csat?: {
      enabled?: boolean;
      scale?: number;       // 1-5, 1-10, etc.
      askAfterClose?: boolean;
      thresholdAlert?: number;  // notas ≤ threshold disparam alerta
    };

    // ══════════════════════════════════════════════════════════════════════
    // ── Questionário v2 (novos campos) ────────────────────────────────────
    // Campos derivados das perguntas A1–E2 adicionadas em 2026-04-23.
    // Cada campo alimenta uma situação nova (F11-F15, S14-S16, N1) ou refina
    // comportamento de prompt existente.
    // ══════════════════════════════════════════════════════════════════════

    // ── Financeiro expandido ─────────────────────────────────────────────
    // A1: aceita cartão de crédito recorrente + gateway
    allowCardRecurring?: boolean;
    cardGateway?: 'pagarme' | 'mercadopago' | 'cielo' | 'asaas' | 'efi' | 'outro' | '';
    // A2: emissão de NF-e
    emiteNFE?: 'automatica' | 'manual' | 'nao';
    prazoNFEDias?: number;
    // A3: prazo de análise de pagamento não reconhecido (F11)
    prazoAnaliseComprovante?: string;
    // A4: regra textual da multa proporcional (C4 — substitui aproximação genérica)
    multaProporcionalRegra?: string;
    // A5/A6: negociação de dívida acumulada (F7 refinado)
    parcelamentoDividaMax?: number;
    parcelamentoValorMinimo?: number;
    descontoAvistaDividaMax?: string;
    // A7: política de crédito em conta (F12)
    creditoContaPolicy?: 'agente' | 'humano' | 'nao';
    // A8: fluxo quando débito automático é recusado (F15)
    debitoRecusadoFluxo?: string;

    // ── Suporte expandido ────────────────────────────────────────────────
    // B1: política quando cliente reporta queda de energia (S14)
    semEnergiaPolicy?: 'orientar' | 'abrir_os' | 'registrar';
    // B2: canal de aviso de manutenção/incidente regional (S15)
    canalAvisoManutencao?: {
      tipo: 'status_page' | 'grupo_whatsapp' | 'sms' | 'nenhum' | 'outro';
      link?: string;
    };
    // B3: equipamentos padrão estruturados (refina S4/S11/S12)
    onuModelos?: string[];
    roteadorModelos?: string[];
    // B4: horário em que OS pode ser aberta automaticamente
    osAutomaticaHorario?: '24x7' | 'comercial' | 'nunca';
    // B5: política para porta bloqueada / VoIP / RDP / gamer (S16)
    portaBloqueadaPolicy?: 'escalar' | 'abrir_os' | 'explicar_limitacao';

    // ── Comercial expandido ──────────────────────────────────────────────
    // C1: tabela estruturada de taxas de instalação por plano
    taxasInstalacao?: Array<{
      planoNome: string;
      taxaInstalacao: number;
      condicaoIsencao?: string;
    }>;
    // C2: política de mudança de endereço dentro da cobertura
    mudancaEnderecoFidelidade?: 'mantem' | 'reinicia' | 'taxa' | 'humano';
    mudancaEnderecoTaxa?: number;
    // C3: aceita split de conta (pagador ≠ titular)
    splitConta?: boolean;
    // C4: benefício do programa de indicação (C10 refinado)
    indicacaoBeneficio?: string;

    // ── Reputação / pós-atendimento (novo domínio) ───────────────────────
    // D1/D2/D3: NPS automático após resolução de protocolo (N1)
    npsColeta?: {
      enabled?: boolean;
      escala?: 5 | 10;
      automatico?: boolean;
      delayHoras?: number;        // horas após "resolvido" pra disparar NPS
    };
    npsBaixoAcao?: 'escalar' | 'alertar' | 'registrar';
    npsAltoAcao?: 'google' | 'indicacao' | 'nada';
    googleReviewLink?: string;

    // ── Persona / governança ─────────────────────────────────────────────
    // E1: assinatura final das mensagens do bot
    assinaturaFinal?: string;
    // E2: dados que o bot NUNCA pode enviar no WhatsApp (LGPD)
    dadosNuncaEnviar?: string[];

    // ── F4/F5/F6 — Reativação, Compensação, Histórico, Contestação, Reembolso ──
    reativacaoAposPagamento?: 'automatica' | 'manual';                     // q34
    prazoCompensacaoBancaria?: string;                                     // q35
    consultaPagamentosERPDisponivel?: boolean;                             // q36
    agenteAbreContestacao?: 'sim' | 'nao';                                 // q40
    prazoAnaliseContestacao?: string;                                      // q41
    agenteInformaHistorico?: boolean;                                      // q42
    mesesHistoricoExibir?: number;                                         // q43
    agenteAutorizaReembolso?: 'sim' | 'nao';                               // q44
    valorMaxAutorizacaoReembolso?: string;                                 // q45

    // ── C1/C2 — Contrato, Instalação, Migração de plano ──────────────────
    contratoViaWhatsApp?: 'digital' | 'presencial';                        // q52
    janelasInstalacao?: string[];                                          // q55
    instalacaoFimDeSemana?: 'sim_sab' | 'sim_sab_dom' | 'nao';             // q56
    antecedenciaMinimaInstalacao?: string;                                 // q57
    carenciaMudancaPlano?: { permite: boolean; prazo?: string };           // q61
    custoMigracaoPlano?: { temCusto: boolean; valor?: string };            // q63
    migracaoComDebito?: 'sim' | 'apenas_upgrade' | 'nao';                  // q64

    // ── Camada conversacional (smalltalk) ────────────────────────────────
    // Configurações da camada que humaniza respostas a mensagens off-topic
    // (cumprimento, identidade, piada, etc.) ANTES do despacho pro agente.
    // A persona base (nome, tom, emojis, estilo) vem de q1-q4 da seção
    // "Identidade do Agente Virtual". Os limites abaixo (q9/q10) controlam
    // os gatilhos de "assumir firme" e de escalação por inadequação.
    smalltalk?: {
      enabled?: boolean;             // master switch (default: true)
      harassmentLimit?: number;      // ocorrências de assédio antes de escalar pra humano (default: 2)
      consecutiveLimit?: number;     // smalltalks consecutivos sem progresso antes do agente "assumir firme" (default: 3)
    };
  };
  plans: {
    enabled: boolean;
    items: Array<{
      id: string;
      name: string;
      speed: string;
      price: number;
      description?: string;
      featured?: boolean;
    }>;
    // Bruno 2026-06-11: planos por cidade. Cada cidade = nome oficial + apelidos
    // + CEPs atendidos + planos próprios. O agente confirma cobertura por aqui
    // (nome/apelido/CEP) e oferece os planos da região. Vazio = comportamento atual.
    cities?: Array<{
      id: string;
      name: string;
      aliases: string[];
      ceps: string[];
      // Bruno 2026-06-11: qual conexão de ERP (isp_erp_connections.id) atende esta
      // cidade. null/ausente = usa a conexão default do workspace (tenant 1-ERP).
      erpId?: number;
      items: Array<{
        id: string;
        name: string;
        speed: string;
        price: number;
        description?: string;
        featured?: boolean;
      }>;
    }>;
  };
  serviceHours: {
    enabled: boolean;
    timezone: string;
    weekdays: { start: string; end: string };
    saturday?: { start: string; end: string };
    sunday?: { start: string; end: string };
    holidays?: string[];
    holidayBehavior?: 'closed' | 'open' | 'emergency';
    emergencyChannel?: string;
  };
  // Compliance LGPD/Anatel. Mantido fora de businessRules pra deixar claro que
  // são políticas de conformidade, não regras de negócio do agente.
  compliance?: {
    // Modo do gate telefone↔CPF:
    //  'off'    — só loga (telemetria), sem efeito no fluxo. Default seguro
    //             pra todos os tenants existentes — não muda comportamento.
    //  'soft'   — em mismatch, pede confirmação extra (nome do titular).
    //  'strict' — em mismatch, bloqueia + escala humano com tag de auditoria.
    lgpdMode?: 'off' | 'soft' | 'strict';
    // Retenção de mídia (foto/áudio/PDF) recebida do cliente. Após este número
    // de dias, o arquivo físico é apagado por cron diário; o registro permanece
    // com purged_at preenchido pra rastreabilidade. Default 30.
    mediaRetentionDays?: number;
    // Janela de cobrança (CDC). Cron de billing checa antes de disparar
    // mensagem proativa. Default conservador: 08-20 seg-sex, 08-13 sáb,
    // sem domingo, sem feriado. Tenant só pode CORTAR a janela (cortar sábado,
    // estreitar horário); afrouxar além do default é clampado pelo helper.
    // Aniversário NÃO respeita esta janela — felicitação em domingo é social.
    billingWindow?: {
      enabled?: boolean;          // default true — desligar pula a checagem
      weekdays?: { start: string; end: string };       // default {start:'08:00', end:'20:00'}
      saturday?: { start: string; end: string } | false; // default {start:'08:00', end:'13:00'}
      sunday?: { start: string; end: string } | false;   // default false (CDC)
      respectHolidays?: boolean;  // default true — usa serviceHours.holidays
      extraHolidays?: string[];   // 'YYYY-MM-DD' adicionais ao serviceHours.holidays
    };
  };
  questionnaire?: {
    answers: Record<string, any>;
    completedAt?: string;
    appliedAt?: string;
  };
  questionnaireRulesBackup?: {
    businessRules: TenantSettingsJson['businessRules'];
    serviceHours: TenantSettingsJson['serviceHours'];
    savedAt: string;
  };
  questionnaireContext?: string;
  // FAQ livre por tenant — perguntas frequentes que não cabem em campos
  // estruturados do questionário. Gerenciada via UI dedicada (CRUD).
  // Match keyword-based no faqService — score por sobreposição de keywords +
  // boost de categoria. Quando há match, a IA é instruída a usar a resposta
  // cadastrada ajustando o tom (ver agentes).
  faq?: Array<{
    id: string;
    categoria: 'geral' | 'financeiro' | 'suporte' | 'comercial' | 'cancelamento';
    pergunta: string;       // exibida no painel admin
    resposta: string;       // texto base que o agente usa
    palavrasChave: string[]; // primeira é "core" (obrigatória pra match)
    ativa: boolean;
    prioridade: number;     // 0-100, maior vence empate
    atualizadoEm: string;   // ISO
  }>;
  contractModel?: {
    uploadedAt: string;
    uploadedBy?: { id?: number; nome?: string };
    fileName: string;
    uploadUrl: string;
    parseStatus: 'ok' | 'pending' | 'error';
    parseError?: string;
    rawSnippet?: string;
    rules: {
      tem_fidelidade: boolean | null;
      meses: number | null;
      base_calculo_multa:
        | 'meses_restantes'
        | 'dias_restantes'
        | 'valor_beneficio_proporcional'
        | 'instalacao_proporcional'
        | 'multa_fixa'
        | 'nao_ha'
        | null;
      regra_multa_texto: string | null;
      multa_fixa_valor: number | null;
      valor_beneficio_total: number | null;
      carencia_dias: number | null;
      excecoes: string[];
      taxa_cancelamento_fixa: number | null;
      clausula_multa_exata: string | null;
      beneficios_listados: string[];
    };
    reviewedByHuman: boolean;
  };

  // ── AI Agent Piloto (Bruno 2026-05-21) ──────────────────────────────────────
  // Settings por tenant pra ligar/desligar o orchestrator gpt-4o-mini com
  // function calling. Substitui o env AI_AGENT_MODE global — cada tenant decide.
  aiAgent?: {
    // 'off'    — fluxo determinístico clássico (default seguro)
    // 'on'     — AI Agent ativo (orchestrator decide tools)
    // 'shadow' — roda em paralelo mas NÃO aplica (só loga decisão pra comparar)
    mode?: 'off' | 'on' | 'shadow';
    // Few-shot dinâmico via ai_agent_outcomes (memória adaptativa Opção B).
    // Default: true quando mode='on'. Permite desligar pra A/B testar.
    fewShotMemoryEnabled?: boolean;
    // Pre-gate EMERGENCIA via IntentReal antes do orchestrator (Opção A).
    // Default: true. Pula AI Agent quando categoria=EMERGENCIA, escala direto.
    preGateEmergencia?: boolean;
  };
}

// Mídia recebida do cliente (foto, áudio, PDF) com policy de retenção LGPD.
// Cron diário (`mediaRetentionService.purgeExpiredMedia`) apaga o arquivo físico
// quando expires_at < now() e marca purged_at. O registro NÃO é deletado: serve
// pra auditoria saber que existiu uma mídia e por que foi removida.
export const mediaAssets = pgTable('media_assets', {
  id:             uuid('id').defaultRandom().primaryKey(),
  workspaceId:    uuid('workspace_id').notNull(),
  conversationId: integer('conversation_id'),
  mediaUrl:       text('media_url').notNull(),    // ex: /uploads/meta_xxx.jpeg
  mimeType:       text('mime_type'),
  // Heurística inicial — pode ser atualizada quando o agente reconhece o contexto:
  //  'comprovante_pagto' (financeiro), 'led_onu' (suporte), 'documento', 'unclassified'
  category:       varchar('category', { length: 30 }).notNull().default('unclassified'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
  expiresAt:      timestamp('expires_at').notNull(),
  purgedAt:       timestamp('purged_at'),
  source:         varchar('source', { length: 20 }), // 'meta' | 'instagram' | 'evolution'
}, (t) => [
  uniqueIndex("media_assets_url_unique").on(t.mediaUrl),
]);
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type InsertMediaAsset = typeof mediaAssets.$inferInsert;

// Audit log de acesso ao relatório diário — requisito LGPD (Art. 6º X).
// Retenção: 2 anos (limpeza manual ou via script).
export const dailyReportAccessLog = pgTable('daily_report_access_log', {
  id:          uuid('id').defaultRandom().primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  userId:      integer('user_id').notNull(),
  reportDate:  date('report_date').notNull(),
  accessedAt:  timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress:   text('ip_address'),
  userAgent:   text('user_agent'),
  action:      varchar('action', { length: 30 }).notNull(), // view | copy | download
}, (t) => [
  index("idx_darl_workspace_date").on(t.workspaceId, t.reportDate),
  index("idx_darl_user_date").on(t.userId, t.accessedAt),
]);

export type DailyReportAccessLog = typeof dailyReportAccessLog.$inferSelect;
export type InsertDailyReportAccessLog = typeof dailyReportAccessLog.$inferInsert;

// ── Agent trace events (Bruno, 2026-05-12) ──────────────────────────────────
// Timeline de decisões do agente por conversa. Cada decisão crítica (AI
// classifier, intent gateway, agente despachado, cobertura verificada,
// handoff, tags aplicadas, etc) grava uma linha aqui. Permite reconstruir
// pós-fato POR QUE o bot tomou cada decisão numa conversa específica.
//
// Sem UI — é ferramenta de diagnóstico interna. Consulta via scripts/trace.ts
// ou query direta no DB. Auto-purge >30 dias roda no boot scheduler.
//
// `stage` é enum-like (string curto) pra facilitar grep/filtro. Lista atual
// em server/utils/agentTrace.ts (TRACE_STAGES).
//
// `payload` é jsonb compacto — só os dados RELEVANTES da decisão, não dump
// completo. Ex: { dept, sub, conf } pro classifier; { available, region }
// pra cobertura; { from, to, reason } pro intent gateway.
export const agentTraceEvents = pgTable('agent_trace_events', {
  id:             uuid('id').defaultRandom().primaryKey(),
  workspaceId:    uuid('workspace_id').notNull(),
  conversationId: integer('conversation_id').notNull(),
  protocolId:     uuid('protocol_id'),                       // opcional, set quando disponível
  stage:          varchar('stage', { length: 40 }).notNull(),
  payload:        jsonb('payload').notNull().default({}),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  // Lookup principal: trace de uma conversa em ordem cronológica
  index("idx_agent_trace_conv_created").on(t.conversationId, t.createdAt),
  // Auto-purge eficiente por createdAt
  index("idx_agent_trace_created").on(t.createdAt),
  // Filtro por workspace + stage (analytics ad-hoc)
  index("idx_agent_trace_ws_stage").on(t.workspaceId, t.stage),
]);

export type AgentTraceEvent = typeof agentTraceEvents.$inferSelect;
export type InsertAgentTraceEvent = typeof agentTraceEvents.$inferInsert;

// ── Métricas agregadas do Agent V2 (Bruno 2026-05-27, Frente 3 rastreabilidade) ──
// Agregação 5min de agent_trace_events pra dashboard ops:
//   - Detectar regressões silenciosas que smokes não pegam (ex: % escalação subiu de 15→40%)
//   - Latência média/p95 por setor (ERP lento, Vision lento)
//   - Tools failing > N → fonte comum de "bot escalou e não sei pq"
//
// Cron 5min lê janela [now-5min, now], agrupa por (workspace, sector), grava aqui.
// Retenção 30d (DELETE em cron diário). Dashboard lê últimas 24h por default.
export const agentMetrics5min = pgTable('agent_metrics_5min', {
  id:               uuid('id').defaultRandom().primaryKey(),
  workspaceId:      uuid('workspace_id').notNull(),
  bucketStart:      timestamp('bucket_start').notNull(), // bucket de 5min (timestamp arredondado p/ baixo)
  sector:           varchar('sector', { length: 32 }),    // FINANCEIRO/SUPORTE_TECNICO/VENDAS/CANCELAMENTO/HUMANO/GERAL/null=todos
  // Volume
  totalTurnos:      integer('total_turnos').notNull().default(0),
  // Decisão
  countEscalation:  integer('count_escalation').notNull().default(0),  // intent=HUMANO no turn_end
  countConsultative: integer('count_consultative').notNull().default(0), // action=CONSULTATIVE_RESPONSE
  countHandlerError: integer('count_handler_error').notNull().default(0), // stage v2_handler_error
  // Tools
  countToolsCalled: integer('count_tools_called').notNull().default(0),
  countToolsFailed: integer('count_tools_failed').notNull().default(0),
  countToolsSlow:   integer('count_tools_slow').notNull().default(0),   // latencyMs > 3000
  // Latência (ms) — totalMs do turn_end
  avgTotalMs:       integer('avg_total_ms'),
  p95TotalMs:       integer('p95_total_ms'),
  maxTotalMs:       integer('max_total_ms'),
  // Metadata
  createdAt:        timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_agent_metrics_5min_ws_bucket').on(t.workspaceId, t.bucketStart),
  index('idx_agent_metrics_5min_bucket').on(t.bucketStart),
]);

export type AgentMetrics5min = typeof agentMetrics5min.$inferSelect;
export type InsertAgentMetrics5min = typeof agentMetrics5min.$inferInsert;
