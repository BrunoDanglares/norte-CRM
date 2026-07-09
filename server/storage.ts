import {
  type User, type InsertUser,
  type Lead, type InsertLead,
  type LeadTag, type InsertLeadTag,
  type Pipeline, type InsertPipeline,
  type PipelineStage, type InsertPipelineStage,
  type PipelineColumn, type InsertPipelineColumn,
  type Contact, type InsertContact,
  type Deal, type InsertDeal,
  type Conversation, type InsertConversation,
  type Message, type InsertMessage,
  type Transaction, type InsertTransaction,
  type Team, type InsertTeam, type TeamMember,
  type Permission, type InsertPermission,
  type Automacao, type InsertAutomacao,
  type AutomacaoLog, type InsertAutomacaoLog,
  type Plano, type InsertPlano,
  type Workspace, type InsertWorkspace,
  type Conexao, type InsertConexao,
  type MensagemLog, type InsertMensagemLog,
  type WebhookEndpoint, type InsertWebhookEndpoint,
  type WebhookLog, type InsertWebhookLog,
  type ApiToken, type InsertApiToken,
  type IaPrompt, type InsertIaPrompt,
  type IaPromptHistorico, type InsertIaPromptHistorico,
  type Campanha, type InsertCampanha,
  type AutomationPendingInput, type InsertAutomationPendingInput,
  type RespostaRapida, type InsertRespostaRapida,
  type Anotacao, type InsertAnotacao,
  type DisparoProgramado, type InsertDisparoProgramado,
  type PartnerInvite, type PartnerImpersonationToken,
  type PesquisaSatisfacao, type InsertPesquisaSatisfacao,
  type RespostaPesquisa, type InsertRespostaPesquisa,
  type TenantSettings as TenantSettingsRow, type InsertTenantSettings,
  tenantSettings,
  pipelines, users, leads, leadTags, pipelineStages, pipelineColumns, contacts, deals, conversations, messages, transactions,
  teams, teamMembers, permissions,
  automacoes, automacaoLogs, automationPendingInputs,
  planos, workspaces,
  conexoes, mensagensLog,
  webhookEndpoints, webhookLogs, apiTokens, iaPrompts, iaPromptHistorico,
  campanhas, integrationConfigs, respostasRapidas, anotacoes, notificacoes,
  disparosProgramados,
  partnerInvites, partnerImpersonationTokens,
  pesquisasSatisfacao, respostasPesquisa,
  chatInterno,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, or, ilike, gte, lte, arrayContains, isNull } from "drizzle-orm";

export interface LeadFilters {
  owner?: string;
  search?: string;
  stage?: string;
  period?: string;
  minValue?: number;
  maxValue?: number;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface ContactFilters {
  limit?: number;
  offset?: number;
}

export interface ConversationFilters {
  limit?: number;
  offset?: number;
}

export interface MessageFilters {
  limit?: number;
  offset?: number;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUsers(workspaceId: string): Promise<User[]>;
  getAllUsersAdmin(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<void>;
  countActiveUsers(): Promise<number>;

  getLeads(workspaceId: string, filters?: LeadFilters): Promise<Lead[]>;
  getLead(id: number, workspaceId: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: number, lead: Partial<InsertLead>, workspaceId: string): Promise<Lead | undefined>;
  deleteLead(id: number, workspaceId: string): Promise<void>;

  getLeadTags(workspaceId: string): Promise<LeadTag[]>;
  createLeadTag(tag: InsertLeadTag): Promise<LeadTag>;
  updateLeadTag(id: number, data: Partial<InsertLeadTag>, workspaceId?: string): Promise<LeadTag>;
  deleteLeadTag(id: number, workspaceId?: string): Promise<void>;

  getPipelines(workspaceId: string): Promise<Pipeline[]>;
  createPipeline(pipeline: InsertPipeline): Promise<Pipeline>;
  updatePipeline(id: number, data: Partial<InsertPipeline>, workspaceId?: string): Promise<Pipeline | undefined>;
  deletePipeline(id: number, workspaceId?: string): Promise<void>;

  getPipelineStages(workspaceId: string, pipeline?: string): Promise<PipelineStage[]>;
  createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage>;
  updatePipelineStage(id: number, data: Partial<InsertPipelineStage>, workspaceId?: string): Promise<PipelineStage | undefined>;
  deletePipelineStage(id: number, workspaceId?: string): Promise<void>;
  getPipelineColumns(workspaceId: string, pipeline?: string): Promise<PipelineColumn[]>;
  createPipelineColumn(column: InsertPipelineColumn): Promise<PipelineColumn>;
  updatePipelineColumn(id: number, data: Partial<InsertPipelineColumn>, workspaceId?: string): Promise<PipelineColumn | undefined>;
  deletePipelineColumn(id: number, workspaceId?: string): Promise<void>;

  getContacts(workspaceId: string, filters?: ContactFilters): Promise<Contact[]>;
  getContact(id: number, workspaceId: string): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  ensureContactForInbound(params: { workspaceId: string; telefone: string; nome?: string; canal?: string }): Promise<void>;
  updateContact(id: number, contact: Partial<InsertContact>, workspaceId: string): Promise<Contact | undefined>;
  deleteContact(id: number, workspaceId: string): Promise<void>;

  getDeals(workspaceId: string): Promise<Deal[]>;
  createDeal(deal: InsertDeal): Promise<Deal>;
  updateDeal(id: number, deal: Partial<InsertDeal>, workspaceId?: string): Promise<Deal | undefined>;

  getConversations(workspaceId: string, filters?: ConversationFilters): Promise<Conversation[]>;
  getConversation(id: number, workspaceId: string): Promise<Conversation | undefined>;
  createConversation(conv: InsertConversation): Promise<Conversation>;
  updateConversationTags(id: number, tags: string[], workspaceId: string): Promise<Conversation>;
  updateConversationAgent(id: number, agente: string | null, workspaceId: string): Promise<Conversation>;
  deleteConversation(id: number, workspaceId: string): Promise<void>;

  getMessages(conversationId: number, filters?: MessageFilters): Promise<Message[]>;
  createMessage(msg: InsertMessage): Promise<Message>;


  getTransactions(workspaceId: string): Promise<Transaction[]>;
  createTransaction(txn: InsertTransaction): Promise<Transaction>;

  getTeams(workspaceId?: string): Promise<Team[]>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: string, data: Partial<InsertTeam>): Promise<Team | undefined>;
  deleteTeam(id: string): Promise<void>;
  getTeamMembers(teamId: string): Promise<TeamMember[]>;
  addTeamMember(teamId: string, userId: number): Promise<void>;
  removeTeamMember(teamId: string, userId: number): Promise<void>;

  getPermissions(): Promise<Permission[]>;
  getPermissionByRole(role: string): Promise<Permission | undefined>;
  updatePermission(id: string, data: Partial<InsertPermission>): Promise<Permission | undefined>;

  getAutomacoes(workspaceId: string): Promise<Automacao[]>;
  getAutomacao(id: string, workspaceId: string): Promise<Automacao | undefined>;
  createAutomacao(data: InsertAutomacao): Promise<Automacao>;
  updateAutomacao(id: string, data: Partial<InsertAutomacao>, workspaceId: string): Promise<Automacao | undefined>;
  deleteAutomacao(id: string, workspaceId: string): Promise<void>;
  incrementExecucoes(id: string): Promise<void>;

  getAutomacaoLogs(automacaoId: string, limit?: number): Promise<AutomacaoLog[]>;
  createAutomacaoLog(data: InsertAutomacaoLog): Promise<AutomacaoLog>;

  createPendingInput(data: InsertAutomationPendingInput): Promise<AutomationPendingInput>;
  getPendingInputByPhone(phone: string, workspaceId: string): Promise<AutomationPendingInput | undefined>;
  deletePendingInput(id: number): Promise<void>;
  deleteExpiredPendingInputs(): Promise<void>;
  getExpiredWaitPendingInputs(): Promise<AutomationPendingInput[]>;

  getPlanos(): Promise<Plano[]>;
  getPlano(id: string): Promise<Plano | undefined>;
  getPlanoBySlug(slug: string): Promise<Plano | undefined>;
  createPlano(data: InsertPlano): Promise<Plano>;

  getWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  createWorkspace(data: InsertWorkspace): Promise<Workspace>;
  updateWorkspace(id: string, data: Partial<InsertWorkspace>): Promise<Workspace | undefined>;

  getLimiteUsuarios(workspaceId: string): Promise<number | null>;

  getConexoes(workspaceId?: string): Promise<Conexao[]>;
  getConexao(id: string, workspaceId: string): Promise<Conexao | undefined>;
  createConexao(data: InsertConexao): Promise<Conexao>;
  updateConexao(id: string, data: Partial<InsertConexao>, workspaceId: string): Promise<Conexao | undefined>;
  deleteConexao(id: string, workspaceId: string): Promise<void>;
  countConexoes(workspaceId?: string): Promise<number>;

  getMensagensLog(conexaoId: string, limit?: number, workspaceId?: string): Promise<MensagemLog[]>;
  createMensagemLog(data: InsertMensagemLog): Promise<MensagemLog>;
  updateMensagemLogByMessageId(messageId: string, data: Partial<InsertMensagemLog>): Promise<void>;
  countMensagensLog(workspaceId?: string): Promise<number>;

  getWebhookEndpoints(workspaceId?: string): Promise<WebhookEndpoint[]>;
  getWebhookEndpoint(id: string, workspaceId?: string): Promise<WebhookEndpoint | undefined>;
  getActiveWebhooksByEvent(evento: string, workspaceId?: string): Promise<WebhookEndpoint[]>;
  createWebhookEndpoint(data: InsertWebhookEndpoint): Promise<WebhookEndpoint>;
  updateWebhookEndpoint(id: string, data: Partial<InsertWebhookEndpoint>, workspaceId?: string): Promise<WebhookEndpoint | undefined>;
  deleteWebhookEndpoint(id: string, workspaceId?: string): Promise<void>;

  getWebhookLogs(endpointId: string, limit?: number): Promise<WebhookLog[]>;
  createWebhookLog(data: InsertWebhookLog): Promise<WebhookLog>;
  deleteWebhookLogs(endpointId: string): Promise<void>;

  getApiTokens(workspaceId?: string): Promise<ApiToken[]>;
  getApiTokenByHash(hash: string): Promise<ApiToken | undefined>;
  createApiToken(data: InsertApiToken): Promise<ApiToken>;
  updateApiToken(id: string, data: Partial<InsertApiToken>, workspaceId?: string): Promise<ApiToken | undefined>;
  deleteApiToken(id: string, workspaceId?: string): Promise<void>;

  getIaPrompts(): Promise<IaPrompt[]>;
  getIaPrompt(id: string): Promise<IaPrompt | undefined>;
  getIaPromptBySlug(slug: string): Promise<IaPrompt | undefined>;
  createIaPrompt(data: InsertIaPrompt): Promise<IaPrompt>;
  updateIaPrompt(id: string, data: Partial<InsertIaPrompt>): Promise<IaPrompt | undefined>;
  deleteIaPrompt(id: string): Promise<void>;

  getIaPromptHistorico(promptId: string): Promise<IaPromptHistorico[]>;
  createIaPromptHistorico(data: InsertIaPromptHistorico): Promise<IaPromptHistorico>;

  getCampanhas(workspaceId: string): Promise<Campanha[]>;
  getCampanha(id: number, workspaceId?: string): Promise<Campanha | undefined>;
  createCampanha(data: InsertCampanha): Promise<Campanha>;
  updateCampanha(id: number, data: Partial<InsertCampanha>, workspaceId?: string): Promise<Campanha | undefined>;
  deleteCampanha(id: number, workspaceId?: string): Promise<void>;

  getLeadByTelefone(telefone: string, workspaceId?: string): Promise<Lead | undefined>;
  getConversationByNome(nome: string, workspaceId?: string): Promise<Conversation | undefined>;
  getConversationByPhone(telefone: string, workspaceId?: string): Promise<Conversation | undefined>;


  getIntegrationConfigs(workspaceId: string): Promise<any[]>;
  upsertIntegrationConfig(workspaceId: string, integrationId: string, enabled: boolean, config?: any): Promise<any>;

  getRespostasRapidas(workspaceId: string): Promise<RespostaRapida[]>;
  getRespostaRapida(id: number, workspaceId?: string): Promise<RespostaRapida | undefined>;
  createRespostaRapida(data: InsertRespostaRapida): Promise<RespostaRapida>;
  updateRespostaRapida(id: number, data: Partial<InsertRespostaRapida>, workspaceId?: string): Promise<RespostaRapida | undefined>;
  deleteRespostaRapida(id: number, workspaceId?: string): Promise<void>;

  getAnotacoes(workspaceId: string, filters?: { leadId?: number; conversationId?: number }): Promise<Anotacao[]>;
  getAnotacao(id: number, workspaceId?: string): Promise<Anotacao | undefined>;
  createAnotacao(data: InsertAnotacao): Promise<Anotacao>;
  updateAnotacao(id: number, data: Partial<InsertAnotacao>, workspaceId?: string): Promise<Anotacao | undefined>;
  deleteAnotacao(id: number, workspaceId?: string): Promise<void>;

  getNotificacoes(workspaceId: string): Promise<any[]>;
  createNotificacao(data: { tipo: string; categoria: string; titulo: string; mensagem: string; link?: string; iconKey?: string; workspaceId: string }): Promise<any>;
  markNotificacaoRead(id: number, workspaceId: string): Promise<void>;
  markAllNotificacoesRead(workspaceId: string): Promise<void>;
  deleteNotificacao(id: number, workspaceId: string): Promise<void>;

  getPartnerClients(partnerWorkspaceId: string): Promise<any[]>;
  getPartnerConnections(partnerWorkspaceId: string): Promise<any[]>;
  getPartnerClientDetail(partnerWorkspaceId: string, clientWorkspaceId: string): Promise<any>;
  createClientWorkspace(data: { partnerWorkspaceId: string; businessName: string; adminName: string; adminEmail: string; adminPassword: string; phone?: string }): Promise<{ workspace: any; user: any }>;
  getPartnerStats(partnerWorkspaceId: string): Promise<{ totalClients: number; activeClients: number; totalLeads: number; totalConversations: number; totalConnections: number; activeConnections: number; monthlyRevenue: number }>;
  createPartnerInvite(data: { partnerWorkspaceId: string; clientEmail: string; clientName: string; businessName: string }): Promise<PartnerInvite>;
  getPartnerInvite(token: string): Promise<PartnerInvite | null>;
  getPartnerInvites(partnerWorkspaceId: string): Promise<PartnerInvite[]>;
  updatePartnerInvite(id: string, data: Partial<any>): Promise<any>;
  createImpersonationToken(data: { partnerWorkspaceId: string; targetWorkspaceId: string; partnerUserId: number }): Promise<string>;
  validateImpersonationToken(token: string): Promise<{ valid: boolean; targetWorkspaceId?: string; partnerWorkspaceId?: string }>;

  getPesquisasSatisfacao(workspaceId: string): Promise<PesquisaSatisfacao[]>;
  getPesquisaSatisfacao(id: number, workspaceId?: string): Promise<PesquisaSatisfacao | undefined>;
  createPesquisaSatisfacao(data: InsertPesquisaSatisfacao): Promise<PesquisaSatisfacao>;
  updatePesquisaSatisfacao(id: number, data: Partial<InsertPesquisaSatisfacao>, workspaceId?: string): Promise<PesquisaSatisfacao | undefined>;
  deletePesquisaSatisfacao(id: number, workspaceId?: string): Promise<void>;
  createRespostaPesquisa(data: InsertRespostaPesquisa): Promise<RespostaPesquisa>;
  getRespostasPesquisa(workspaceId: string, pesquisaId?: number): Promise<RespostaPesquisa[]>;
  getDashboardStats(workspaceId: string): Promise<{
    csat: { media: number; total: number };
    lossReasons: { motivo: string; count: number }[];
    agentMessages: { agente: string; count: number }[];
  }>;
  ensureDefaultQuickReplies(workspaceId: string): Promise<void>;
  ensureDefaultSurvey(workspaceId: string): Promise<PesquisaSatisfacao>;
  getTenantSettings(tenantId: string): Promise<TenantSettingsRow | undefined>;
  upsertTenantSettings(tenantId: string, settingsJson: any): Promise<TenantSettingsRow>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUsers(workspaceId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.workspaceId, workspaceId)).orderBy(users.nome);
  }

  async getAllUsersAdmin(): Promise<User[]> {
    return db.select().from(users).orderBy(users.createdAt);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByInviteToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.inviteToken, token));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async updateUser(id: number, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(chatInterno).where(eq(chatInterno.userId, id));
    await db.delete(teamMembers).where(eq(teamMembers.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async countActiveUsers(): Promise<number> {
    const { and, or } = await import("drizzle-orm");
    const result = await db.select({ count: sql<number>`count(*)` }).from(users)
      .where(or(eq(users.status, "ACTIVE"), eq(users.status, "INVITED")));
    return Number(result[0]?.count || 0);
  }

  async getLeads(workspaceId: string, filters?: LeadFilters): Promise<Lead[]> {
    const conditions: any[] = [eq(leads.workspaceId, workspaceId), isNull(leads.archivedAt)];

    if (filters?.owner) {
      conditions.push(eq(leads.owner, filters.owner));
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(leads.nome, term),
          ilike(leads.contato, term),
          ilike(leads.email, term),
          ilike(leads.telefone, term),
          ilike(leads.empresa, term)
        )
      );
    }

    if (filters?.stage) {
      conditions.push(eq(leads.status, filters.stage));
    }

    if (filters?.period) {
      const now = new Date();
      let start: Date;
      switch (filters.period) {
        case "today":
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week":
          start = new Date(now);
          start.setDate(now.getDate() - 7);
          break;
        case "month":
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case "quarter":
          start = new Date(now);
          start.setMonth(now.getMonth() - 3);
          break;
        case "year":
          start = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          start = new Date(0);
      }
      conditions.push(gte(leads.createdAt, start));
    }

    if (filters?.minValue !== undefined) {
      conditions.push(gte(leads.valor, String(filters.minValue)));
    }

    if (filters?.maxValue !== undefined) {
      conditions.push(lte(leads.valor, String(filters.maxValue)));
    }

    if (filters?.tag) {
      conditions.push(arrayContains(leads.tags, [filters.tag]));
    }

    const pageLimit = filters?.limit ?? 100;
    const pageOffset = filters?.offset ?? 0;
    return db.select().from(leads).where(and(...conditions)).orderBy(desc(leads.createdAt)).limit(pageLimit).offset(pageOffset);
  }

  async getLead(id: number, workspaceId: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)));
    return lead;
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const [created] = await db.insert(leads).values(lead).returning();
    return created;
  }

  async updateLead(id: number, lead: Partial<InsertLead>, workspaceId: string): Promise<Lead | undefined> {
    const [updated] = await db.update(leads).set(lead).where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId))).returning();
    return updated;
  }

  async deleteLead(id: number, workspaceId: string): Promise<void> {
    await db.delete(leads).where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)));
  }

  async getLeadTags(workspaceId: string): Promise<LeadTag[]> {
    return db.select().from(leadTags).where(eq(leadTags.workspaceId, workspaceId)).orderBy(leadTags.nome);
  }

  async createLeadTag(tag: InsertLeadTag): Promise<LeadTag> {
    const [created] = await db.insert(leadTags).values(tag).returning();
    return created;
  }

  async updateLeadTag(id: number, data: Partial<InsertLeadTag>, workspaceId?: string): Promise<LeadTag> {
    const condition = workspaceId ? and(eq(leadTags.id, id), eq(leadTags.workspaceId, workspaceId)) : eq(leadTags.id, id);
    const [updated] = await db.update(leadTags).set(data).where(condition).returning();
    return updated;
  }

  async deleteLeadTag(id: number, workspaceId?: string): Promise<void> {
    const condition = workspaceId ? and(eq(leadTags.id, id), eq(leadTags.workspaceId, workspaceId)) : eq(leadTags.id, id);
    await db.delete(leadTags).where(condition);
  }

  async getPipelines(workspaceId: string): Promise<Pipeline[]> {
    return db.select().from(pipelines).where(eq(pipelines.workspaceId, workspaceId)).orderBy(pipelines.ordem);
  }

  async createPipeline(pipeline: InsertPipeline): Promise<Pipeline> {
    const [created] = await db.insert(pipelines).values(pipeline).returning();
    return created;
  }

  async updatePipeline(id: number, data: Partial<InsertPipeline>, workspaceId?: string): Promise<Pipeline | undefined> {
    const condition = workspaceId ? and(eq(pipelines.id, id), eq(pipelines.workspaceId, workspaceId)) : eq(pipelines.id, id);
    const [updated] = await db.update(pipelines).set(data).where(condition).returning();
    return updated;
  }

  async deletePipeline(id: number, workspaceId?: string): Promise<void> {
    const condition = workspaceId ? and(eq(pipelines.id, id), eq(pipelines.workspaceId, workspaceId)) : eq(pipelines.id, id);
    await db.delete(pipelines).where(condition);
  }

  async getPipelineStages(workspaceId: string, pipeline?: string): Promise<PipelineStage[]> {
    const conditions = [eq(pipelineStages.workspaceId, workspaceId)];
    if (pipeline) conditions.push(eq(pipelineStages.pipeline, pipeline));
    const rows = await db.select().from(pipelineStages).where(and(...conditions)).orderBy(pipelineStages.ordem);
    if (pipeline && rows.length === 0) {
      // Fallback universal: retorna todas as stages do workspace com o campo pipeline
      // sobrescrito para o valor solicitado, permitindo que o frontend filtre corretamente.
      const fallback = await db.select().from(pipelineStages).where(eq(pipelineStages.workspaceId, workspaceId)).orderBy(pipelineStages.ordem);
      return fallback.map(s => ({ ...s, pipeline }));
    }
    return rows;
  }

  async createPipelineStage(stage: InsertPipelineStage): Promise<PipelineStage> {
    const [created] = await db.insert(pipelineStages).values(stage).returning();
    return created;
  }

  async updatePipelineStage(id: number, data: Partial<InsertPipelineStage>, workspaceId?: string): Promise<PipelineStage | undefined> {
    const condition = workspaceId ? and(eq(pipelineStages.id, id), eq(pipelineStages.workspaceId, workspaceId)) : eq(pipelineStages.id, id);
    const [updated] = await db.update(pipelineStages).set(data).where(condition).returning();
    return updated;
  }

  async deletePipelineStage(id: number, workspaceId?: string): Promise<void> {
    const condition = workspaceId ? and(eq(pipelineStages.id, id), eq(pipelineStages.workspaceId, workspaceId)) : eq(pipelineStages.id, id);
    await db.delete(pipelineStages).where(condition);
  }

  // ── Funil de vendas: colunas de exibição do CRM (camada por cima do backbone) ──
  async getPipelineColumns(workspaceId: string, pipeline?: string): Promise<PipelineColumn[]> {
    const conditions = [eq(pipelineColumns.workspaceId, workspaceId)];
    if (pipeline) conditions.push(eq(pipelineColumns.pipeline, pipeline));
    return db.select().from(pipelineColumns).where(and(...conditions)).orderBy(pipelineColumns.ordem);
  }

  async createPipelineColumn(column: InsertPipelineColumn): Promise<PipelineColumn> {
    const [created] = await db.insert(pipelineColumns).values(column).returning();
    return created;
  }

  async updatePipelineColumn(id: number, data: Partial<InsertPipelineColumn>, workspaceId?: string): Promise<PipelineColumn | undefined> {
    const condition = workspaceId ? and(eq(pipelineColumns.id, id), eq(pipelineColumns.workspaceId, workspaceId)) : eq(pipelineColumns.id, id);
    const [updated] = await db.update(pipelineColumns).set(data).where(condition).returning();
    return updated;
  }

  async deletePipelineColumn(id: number, workspaceId?: string): Promise<void> {
    const condition = workspaceId ? and(eq(pipelineColumns.id, id), eq(pipelineColumns.workspaceId, workspaceId)) : eq(pipelineColumns.id, id);
    await db.delete(pipelineColumns).where(condition);
  }

  async getContacts(workspaceId: string, filters?: ContactFilters): Promise<Contact[]> {
    const pageLimit = filters?.limit ?? 100;
    const pageOffset = filters?.offset ?? 0;
    return db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)).orderBy(desc(contacts.createdAt)).limit(pageLimit).offset(pageOffset);
  }

  async getContact(id: number, workspaceId: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId)));
    return contact;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [created] = await db.insert(contacts).values(contact).returning();
    return created;
  }

  // Garante a ficha (contact) do cliente assim que ele fala. Bruno 2026-05-30:
  // antes só existia lead/conversa no inbound — o atendente clicava no nome e
  // dava "Ficha não disponível / não encontrei o cadastro" porque não havia
  // registro em `contacts`. Idempotente: onConflictDoNothing no índice único
  // (workspace_id, telefone). NÃO sobrescreve dados de contato existente (nome
  // pode ter sido editado pelo atendente) — só cria quando falta.
  async ensureContactForInbound(params: { workspaceId: string; telefone: string; nome?: string; canal?: string }): Promise<void> {
    const workspaceId = params.workspaceId;
    const telefone = (params.telefone || "").trim();
    if (!workspaceId || !telefone) return;
    const nome = (params.nome || "").trim() || telefone;
    await db
      .insert(contacts)
      .values({ workspaceId, telefone, nome, canal: params.canal || "WhatsApp" })
      .onConflictDoNothing({ target: [contacts.workspaceId, contacts.telefone] });
  }

  async updateContact(id: number, contact: Partial<InsertContact>, workspaceId: string): Promise<Contact | undefined> {
    const [updated] = await db.update(contacts).set(contact).where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId))).returning();
    return updated;
  }

  async deleteContact(id: number, workspaceId: string): Promise<void> {
    await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId)));
  }

  async getDeals(workspaceId: string): Promise<Deal[]> {
    return db.select().from(deals).where(eq(deals.workspaceId, workspaceId)).orderBy(desc(deals.createdAt));
  }

  async createDeal(deal: InsertDeal): Promise<Deal> {
    const [created] = await db.insert(deals).values(deal).returning();
    return created;
  }

  async updateDeal(id: number, deal: Partial<InsertDeal>, workspaceId?: string): Promise<Deal | undefined> {
    const condition = workspaceId ? and(eq(deals.id, id), eq(deals.workspaceId, workspaceId)) : eq(deals.id, id);
    const [updated] = await db.update(deals).set(deal).where(condition).returning();
    return updated;
  }

  async getConversations(workspaceId: string, filters?: ConversationFilters): Promise<Conversation[]> {
    const pageLimit = filters?.limit ?? 50;
    const pageOffset = filters?.offset ?? 0;
    return db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId)).orderBy(desc(sql`COALESCE(${conversations.lastCustomerMessageAt}, ${conversations.updatedAt})`)).limit(pageLimit).offset(pageOffset);
  }

  async getConversation(id: number, workspaceId: string): Promise<Conversation | undefined> {
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)));
    return conv;
  }

  async createConversation(conv: InsertConversation): Promise<Conversation> {
    const [created] = await db.insert(conversations).values(conv).returning();
    return created;
  }

  async updateConversationTags(id: number, tags: string[], workspaceId: string): Promise<Conversation> {
    const condition = and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId));
    const [updated] = await db.update(conversations).set({ tags }).where(condition).returning();
    return updated;
  }

  async updateConversationAgent(id: number, agente: string | null, workspaceId: string): Promise<Conversation> {
    const condition = and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId));
    const [updated] = await db.update(conversations).set({ agente }).where(condition).returning();
    return updated;
  }

  async deleteConversation(id: number, workspaceId: string): Promise<void> {
    const condition = and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId));
    const [conv] = await db.select().from(conversations).where(condition).limit(1);
    if (!conv) return;
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.conversationId, id));
      const phoneCandidates = new Set<string>();
      if (conv.telefone) phoneCandidates.add(conv.telefone);
      if (conv.nome) phoneCandidates.add(conv.nome);
      try {
        const matchingLeads = await tx.select().from(leads)
          .where(and(eq(leads.nome, conv.nome), eq(leads.workspaceId, workspaceId))).limit(1);
        if (matchingLeads[0]?.telefone) phoneCandidates.add(matchingLeads[0].telefone);
      } catch (e: any) { console.error("[Storage] matchingLeads lookup failed:", e.message); }
      for (const phone of phoneCandidates) {
        await tx.delete(automationPendingInputs).where(
          and(
            eq(automationPendingInputs.phone, phone),
            eq(automationPendingInputs.workspaceId, workspaceId),
          )
        );
      }
      await tx.delete(conversations).where(condition);
    });
    console.log(`[Storage] deleteConversation: id=${id} deleted, pending inputs cleaned for phones: ${[conv.telefone, conv.nome].filter(Boolean).join(", ")}`);
  }

  async getMessages(conversationId: number, filters?: MessageFilters): Promise<Message[]> {
    const pageLimit = filters?.limit ?? 100;
    const pageOffset = filters?.offset ?? 0;
    const rows = await db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(pageLimit)
      .offset(pageOffset);
    return rows.reverse();
  }

  async createMessage(msg: InsertMessage): Promise<Message> {
    // Anexa protocolo ativo da conversa (se houver) — permite ao frontend
    // agrupar mensagens por atendimento e desenhar separador horizontal entre
    // protocolos diferentes do mesmo contato.
    // Protocolos/SLA/CSAT (módulo ISP) foram removidos. resolveActiveProtocolId → null,
    // então nenhum protocolo é anexado.
    let payload: InsertMessage = msg;
    // Insert com ON CONFLICT DO NOTHING: bate no UNIQUE INDEX parcial em
    // external_message_id quando a mensagem recebida (Evolution/Meta/Insta) já foi
    // processada antes (restart/reconexão re-disparando evento). Mensagens sem
    // externalMessageId (NULLs múltiplos permitidos pelo índice parcial) sempre
    // entram normalmente.
    const inserted = await db.insert(messages).values(payload).onConflictDoNothing().returning();
    if (inserted.length > 0) {
      const created = inserted[0];
      if (msg.direction === "out") {
        const condition = msg.workspaceId
          ? and(eq(conversations.id, msg.conversationId), eq(conversations.workspaceId, msg.workspaceId))
          : eq(conversations.id, msg.conversationId);
        await db.update(conversations).set({
          ultimaMensagem: msg.texto,
          tempo: "agora",
        }).where(condition);
      }
      return created;
    }
    // Conflito: busca o registro existente. Sem retry/throw — duplicata
    // legítima é cenário esperado, não erro.
    if (msg.externalMessageId) {
      const [existing] = await db.select().from(messages)
        .where(eq(messages.externalMessageId, msg.externalMessageId))
        .limit(1);
      if (existing) {
        console.log(`[createMessage] Mensagem duplicada ignorada (externalId=${msg.externalMessageId})`);
        return existing;
      }
    }
    // Caso defensivo: insert retornou vazio sem haver externalMessageId — não
    // deveria acontecer. Loga e retorna um stub pra não quebrar o caller.
    console.error(`[createMessage] Insert vazio inesperado, msg=${JSON.stringify({ conversationId: msg.conversationId, direction: msg.direction })}`);
    return { ...payload, id: 0, createdAt: new Date() } as Message;
  }


  async getTransactions(workspaceId: string): Promise<Transaction[]> {
    return db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId)).orderBy(desc(transactions.createdAt));
  }

  async createTransaction(txn: InsertTransaction): Promise<Transaction> {
    const [created] = await db.insert(transactions).values(txn).returning();
    return created;
  }

  async getAutomacoes(workspaceId: string): Promise<Automacao[]> {
    return db.select().from(automacoes).where(eq(automacoes.workspaceId, workspaceId)).orderBy(desc(automacoes.updatedAt));
  }

  async getAutomacao(id: string, workspaceId: string): Promise<Automacao | undefined> {
    const [row] = await db.select().from(automacoes).where(and(eq(automacoes.id, id), eq(automacoes.workspaceId, workspaceId)));
    return row;
  }

  async createAutomacao(data: InsertAutomacao): Promise<Automacao> {
    const [created] = await db.insert(automacoes).values(data).returning();
    return created;
  }

  async updateAutomacao(id: string, data: Partial<InsertAutomacao>, workspaceId: string): Promise<Automacao | undefined> {
    const [updated] = await db.update(automacoes).set(data).where(and(eq(automacoes.id, id), eq(automacoes.workspaceId, workspaceId))).returning();
    return updated;
  }

  async deleteAutomacao(id: string, workspaceId: string): Promise<void> {
    await db.delete(automacoes).where(and(eq(automacoes.id, id), eq(automacoes.workspaceId, workspaceId)));
  }

  async incrementExecucoes(id: string): Promise<void> {
    await db.update(automacoes).set({
      execucoes: sql`${automacoes.execucoes} + 1`,
      ultimaExecucao: sql`NOW()`,
    }).where(eq(automacoes.id, id));
  }

  async getAutomacaoLogs(automacaoId: string, limit = 10): Promise<AutomacaoLog[]> {
    return db.select().from(automacaoLogs)
      .where(eq(automacaoLogs.automacaoId, automacaoId))
      .orderBy(desc(automacaoLogs.createdAt))
      .limit(limit);
  }

  async createAutomacaoLog(data: InsertAutomacaoLog): Promise<AutomacaoLog> {
    const [created] = await db.insert(automacaoLogs).values(data).returning();
    return created;
  }

  async createPendingInput(data: InsertAutomationPendingInput): Promise<AutomationPendingInput> {
    const [created] = await db.insert(automationPendingInputs).values(data).returning();
    return created;
  }

  async getPendingInputByPhone(phone: string, workspaceId: string): Promise<AutomationPendingInput | undefined> {
    const [found] = await db.select().from(automationPendingInputs)
      .where(and(
        eq(automationPendingInputs.phone, phone),
        eq(automationPendingInputs.workspaceId, workspaceId),
        sql`${automationPendingInputs.expiresAt} > NOW()`
      ))
      .orderBy(desc(automationPendingInputs.createdAt))
      .limit(1);
    return found;
  }

  async deletePendingInput(id: number): Promise<void> {
    await db.delete(automationPendingInputs).where(eq(automationPendingInputs.id, id));
  }

  async deleteExpiredPendingInputs(): Promise<void> {
    await db.delete(automationPendingInputs).where(
      and(
        eq(automationPendingInputs.pendingType, "option_list"),
        sql`${automationPendingInputs.expiresAt} < NOW()`
      )
    );
  }

  async getExpiredWaitPendingInputs(): Promise<AutomationPendingInput[]> {
    return db.select().from(automationPendingInputs)
      .where(and(
        eq(automationPendingInputs.pendingType, "wait"),
        sql`${automationPendingInputs.expiresAt} <= NOW()`
      ));
  }

  async getTeams(workspaceId?: string): Promise<Team[]> {
    if (workspaceId) {
      return db.select().from(teams).where(eq(teams.workspaceId, workspaceId)).orderBy(teams.nome);
    }
    return db.select().from(teams).orderBy(teams.nome);
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [created] = await db.insert(teams).values(team).returning();
    return created;
  }

  async updateTeam(id: string, data: Partial<InsertTeam>): Promise<Team | undefined> {
    const [updated] = await db.update(teams).set({ ...data, updatedAt: sql`NOW()` }).where(eq(teams.id, id)).returning();
    return updated;
  }

  async deleteTeam(id: string): Promise<void> {
    await db.delete(teams).where(eq(teams.id, id));
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  }

  async addTeamMember(teamId: string, userId: number): Promise<void> {
    await db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
  }

  async removeTeamMember(teamId: string, userId: number): Promise<void> {
    const { and } = await import("drizzle-orm");
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  }

  async getPermissions(): Promise<Permission[]> {
    return db.select().from(permissions).orderBy(permissions.role);
  }

  async getPermissionByRole(role: string): Promise<Permission | undefined> {
    const [perm] = await db.select().from(permissions).where(eq(permissions.role, role));
    return perm;
  }

  async updatePermission(id: string, data: Partial<InsertPermission>): Promise<Permission | undefined> {
    const [updated] = await db.update(permissions).set({ ...data, updatedAt: sql`NOW()` }).where(eq(permissions.id, id)).returning();
    return updated;
  }

  async getPlanos(): Promise<Plano[]> {
    return db.select().from(planos).orderBy(sql`CASE WHEN preco IS NULL THEN 1 ELSE 0 END, preco ASC`);
  }

  async getPlano(id: string): Promise<Plano | undefined> {
    const [plano] = await db.select().from(planos).where(eq(planos.id, id));
    return plano;
  }

  async getPlanoBySlug(slug: string): Promise<Plano | undefined> {
    const [plano] = await db.select().from(planos).where(eq(planos.slug, slug));
    return plano;
  }

  async createPlano(data: InsertPlano): Promise<Plano> {
    const [created] = await db.insert(planos).values(data).returning();
    return created;
  }

  async getWorkspaces(): Promise<Workspace[]> {
    return db.select().from(workspaces).orderBy(workspaces.createdAt);
  }

  async getWorkspace(id: string): Promise<Workspace | undefined> {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    return ws;
  }

  async createWorkspace(data: InsertWorkspace): Promise<Workspace> {
    const [created] = await db.insert(workspaces).values(data).returning();
    return created;
  }

  async updateWorkspace(id: string, data: Partial<InsertWorkspace>): Promise<Workspace | undefined> {
    const [updated] = await db.update(workspaces).set({ ...data, updatedAt: sql`NOW()` }).where(eq(workspaces.id, id)).returning();
    return updated;
  }

  async getLimiteUsuarios(workspaceId: string): Promise<number | null> {
    const ws = await this.getWorkspace(workspaceId);
    if (!ws || !ws.planoId) return null;
    const plano = await this.getPlano(ws.planoId);
    if (!plano) return null;
    return plano.limiteUsuarios;
  }

  async getConexoes(workspaceId?: string): Promise<Conexao[]> {
    if (workspaceId) {
      return db.select().from(conexoes).where(eq(conexoes.workspaceId, workspaceId)).orderBy(desc(conexoes.createdAt));
    }
    return db.select().from(conexoes).orderBy(desc(conexoes.createdAt));
  }

  async getConexao(id: string, workspaceId: string): Promise<Conexao | undefined> {
    const [row] = await db.select().from(conexoes).where(and(eq(conexoes.id, id), eq(conexoes.workspaceId, workspaceId)));
    return row;
  }

  async createConexao(data: InsertConexao): Promise<Conexao> {
    const [created] = await db.insert(conexoes).values(data).returning();
    return created;
  }

  async updateConexao(id: string, data: Partial<InsertConexao>, workspaceId: string): Promise<Conexao | undefined> {
    const [updated] = await db.update(conexoes).set({ ...data, updatedAt: sql`NOW()` }).where(and(eq(conexoes.id, id), eq(conexoes.workspaceId, workspaceId))).returning();
    return updated;
  }

  async deleteConexao(id: string, workspaceId: string): Promise<void> {
    await db.delete(conexoes).where(and(eq(conexoes.id, id), eq(conexoes.workspaceId, workspaceId)));
  }

  async countConexoes(workspaceId?: string): Promise<number> {
    if (workspaceId) {
      const result = await db.select({ count: sql<number>`count(*)` }).from(conexoes).where(eq(conexoes.workspaceId, workspaceId));
      return Number(result[0]?.count || 0);
    }
    const result = await db.select({ count: sql<number>`count(*)` }).from(conexoes);
    return Number(result[0]?.count || 0);
  }

  async getMensagensLog(conexaoId: string, limit = 50, workspaceId?: string): Promise<MensagemLog[]> {
    // Bruno 2026-05-30 iter 35 — multi-tenant fix.
    // mensagens_log NÃO tem coluna workspace_id direta — escopo é via FK
    // conexao_id → conexoes.workspace_id. Sem wsId: lookup direto por
    // conexaoId (uso interno/legacy; conexaoId é UUID global único).
    // COM wsId: JOIN com conexoes pra garantir que conexao pertence ao
    // tenant — defesa contra conexao_id forjado em rotas multi-tenant.
    if (!workspaceId) {
      return db.select().from(mensagensLog)
        .where(eq(mensagensLog.conexaoId, conexaoId))
        .orderBy(desc(mensagensLog.createdAt))
        .limit(limit);
    }
    const rows = await db.execute(sql`
      SELECT ml.*
      FROM mensagens_log ml
      JOIN conexoes c ON c.id = ml.conexao_id
      WHERE ml.conexao_id = ${conexaoId}::uuid
        AND c.workspace_id = ${workspaceId}::uuid
      ORDER BY ml.created_at DESC
      LIMIT ${limit}
    `);
    return rows.rows as any as MensagemLog[];
  }

  async createMensagemLog(data: InsertMensagemLog): Promise<MensagemLog> {
    const [created] = await db.insert(mensagensLog).values(data).returning();
    return created;
  }

  async updateMensagemLogByMessageId(messageId: string, data: Partial<InsertMensagemLog>): Promise<void> {
    await db.update(mensagensLog).set(data).where(eq(mensagensLog.messageId, messageId));
  }

  async countMensagensLog(workspaceId?: string): Promise<number> {
    // Bruno 2026-05-30 iter 32 — multi-tenant fix.
    // SEM workspaceId: contagem global (uso interno/superadmin/relatórios cross-tenant).
    // COM workspaceId: contagem scoped via JOIN com conexoes.workspaceId — billing per-tenant.
    if (!workspaceId) {
      const result = await db.select({ count: sql<number>`count(*)` }).from(mensagensLog);
      return Number(result[0]?.count || 0);
    }
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM mensagens_log ml
      JOIN conexoes c ON c.id = ml.conexao_id
      WHERE c.workspace_id = ${workspaceId}::uuid
    `);
    return Number((result.rows[0] as any)?.count || 0);
  }

  async getLeadByTelefone(telefone: string, workspaceId?: string): Promise<Lead | undefined> {
    const condition = workspaceId ? and(eq(leads.telefone, telefone), eq(leads.workspaceId, workspaceId)) : eq(leads.telefone, telefone);
    const [lead] = await db.select().from(leads).where(condition);
    return lead;
  }

  async getConversationByNome(nome: string, workspaceId?: string): Promise<Conversation | undefined> {
    const condition = workspaceId ? and(eq(conversations.nome, nome), eq(conversations.workspaceId, workspaceId)) : eq(conversations.nome, nome);
    const [conv] = await db.select().from(conversations).where(condition);
    return conv;
  }

  async getConversationByPhone(telefone: string, workspaceId?: string): Promise<Conversation | undefined> {
    if (!telefone) return undefined;
    const condition = workspaceId ? and(eq(conversations.telefone, telefone), eq(conversations.workspaceId, workspaceId)) : eq(conversations.telefone, telefone);
    const [conv] = await db.select().from(conversations).where(condition);
    return conv;
  }

  async getConversationByPhoneAndCanal(telefone: string, canal: string, workspaceId: string): Promise<Conversation | undefined> {
    if (!telefone) return undefined;
    // Prefer open conversations first (customer is continuing), then by recency.
    // Without ORDER BY the result is non-deterministic when multiple conversations
    // exist for the same phone (e.g. one open/stale + one recently resolved).
    const rows = await db.select().from(conversations).where(
      and(eq(conversations.telefone, telefone), eq(conversations.canal, canal), eq(conversations.workspaceId, workspaceId))
    ).orderBy(
      sql`CASE status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END`,
      desc(conversations.updatedAt)
    );
    return rows[0];
  }

  async getConversationByPhoneAndConexao(telefone: string, conexaoId: string, workspaceId: string): Promise<Conversation | undefined> {
    if (!telefone) return undefined;
    const rows = await db.select().from(conversations).where(
      and(eq(conversations.telefone, telefone), eq(conversations.conexaoId, conexaoId), eq(conversations.workspaceId, workspaceId))
    ).orderBy(
      sql`CASE status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END`,
      desc(conversations.updatedAt)
    );
    return rows[0];
  }

  async getWebhookEndpoints(workspaceId?: string): Promise<WebhookEndpoint[]> {
    // Bruno 2026-05-30 iter 32 — multi-tenant fix.
    // Schema webhook_endpoints tem workspaceId. SEM filtro = leak cross-tenant.
    if (workspaceId) {
      return db.select().from(webhookEndpoints)
        .where(eq(webhookEndpoints.workspaceId, workspaceId))
        .orderBy(desc(webhookEndpoints.createdAt));
    }
    return db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt));
  }

  async getWebhookEndpoint(id: string, workspaceId?: string): Promise<WebhookEndpoint | undefined> {
    // Bruno 2026-05-30 iter 32 — defense in depth contra id forjado cross-tenant.
    const condition = workspaceId
      ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspaceId))
      : eq(webhookEndpoints.id, id);
    const [ep] = await db.select().from(webhookEndpoints).where(condition);
    return ep;
  }

  async getActiveWebhooksByEvent(evento: string, workspaceId?: string): Promise<WebhookEndpoint[]> {
    // Bruno 2026-05-30 iter 32 — dispatch interno chama com workspaceId pra
    // entregar evento só pros webhooks daquele tenant. SEM wsId = backward compat
    // legado (já era assim antes).
    const baseCondition = workspaceId
      ? and(eq(webhookEndpoints.ativo, true), eq(webhookEndpoints.workspaceId, workspaceId))
      : eq(webhookEndpoints.ativo, true);
    const all = await db.select().from(webhookEndpoints).where(baseCondition);
    return all.filter((ep) => {
      const evts = (ep.eventos as string[]) || [];
      return evts.includes(evento);
    });
  }

  async createWebhookEndpoint(data: InsertWebhookEndpoint): Promise<WebhookEndpoint> {
    const [created] = await db.insert(webhookEndpoints).values(data).returning();
    return created;
  }

  async updateWebhookEndpoint(id: string, data: Partial<InsertWebhookEndpoint>, workspaceId?: string): Promise<WebhookEndpoint | undefined> {
    const condition = workspaceId
      ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspaceId))
      : eq(webhookEndpoints.id, id);
    const [updated] = await db.update(webhookEndpoints).set({ ...data, updatedAt: new Date() } as any).where(condition).returning();
    return updated;
  }

  async deleteWebhookEndpoint(id: string, workspaceId?: string): Promise<void> {
    const condition = workspaceId
      ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspaceId))
      : eq(webhookEndpoints.id, id);
    await db.delete(webhookEndpoints).where(condition);
  }

  async getWebhookLogs(endpointId: string, limit = 50): Promise<WebhookLog[]> {
    return db.select().from(webhookLogs).where(eq(webhookLogs.endpointId, endpointId)).orderBy(desc(webhookLogs.createdAt)).limit(limit);
  }

  async createWebhookLog(data: InsertWebhookLog): Promise<WebhookLog> {
    const [created] = await db.insert(webhookLogs).values(data).returning();
    return created;
  }

  async deleteWebhookLogs(endpointId: string): Promise<void> {
    await db.delete(webhookLogs).where(eq(webhookLogs.endpointId, endpointId));
  }

  async getApiTokens(workspaceId?: string): Promise<ApiToken[]> {
    // Bruno 2026-05-30 iter 32 — multi-tenant fix.
    // Schema api_tokens tem workspaceId. SEM filtro = leak cross-tenant (qualquer
    // user logado via tokens de qualquer outro tenant). Caller deve passar wsId.
    if (workspaceId) {
      return db.select().from(apiTokens)
        .where(eq(apiTokens.workspaceId, workspaceId))
        .orderBy(desc(apiTokens.createdAt));
    }
    return db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt));
  }

  async getApiTokenByHash(hash: string): Promise<ApiToken | undefined> {
    const [token] = await db.select().from(apiTokens).where(and(eq(apiTokens.tokenHash, hash), eq(apiTokens.ativo, true)));
    return token;
  }

  async createApiToken(data: InsertApiToken): Promise<ApiToken> {
    const [created] = await db.insert(apiTokens).values(data).returning();
    return created;
  }

  async updateApiToken(id: string, data: Partial<InsertApiToken>, workspaceId?: string): Promise<ApiToken | undefined> {
    // Bruno 2026-05-30 iter 32 — defense in depth: caller deve passar wsId
    // pra evitar update cross-tenant via id forjado.
    const condition = workspaceId
      ? and(eq(apiTokens.id, id), eq(apiTokens.workspaceId, workspaceId))
      : eq(apiTokens.id, id);
    const [updated] = await db.update(apiTokens).set(data).where(condition).returning();
    return updated;
  }

  async deleteApiToken(id: string, workspaceId?: string): Promise<void> {
    const condition = workspaceId
      ? and(eq(apiTokens.id, id), eq(apiTokens.workspaceId, workspaceId))
      : eq(apiTokens.id, id);
    await db.delete(apiTokens).where(condition);
  }

  async getIaPrompts(): Promise<IaPrompt[]> {
    return db.select().from(iaPrompts).orderBy(iaPrompts.nome);
  }

  async getIaPrompt(id: string): Promise<IaPrompt | undefined> {
    const [p] = await db.select().from(iaPrompts).where(eq(iaPrompts.id, id));
    return p;
  }

  async getIaPromptBySlug(slug: string): Promise<IaPrompt | undefined> {
    const [p] = await db.select().from(iaPrompts).where(eq(iaPrompts.slug, slug));
    return p;
  }

  async createIaPrompt(data: InsertIaPrompt): Promise<IaPrompt> {
    const [created] = await db.insert(iaPrompts).values(data).returning();
    return created;
  }

  async updateIaPrompt(id: string, data: Partial<InsertIaPrompt>): Promise<IaPrompt | undefined> {
    const [updated] = await db.update(iaPrompts).set({ ...data, updatedAt: new Date() } as any).where(eq(iaPrompts.id, id)).returning();
    return updated;
  }

  async deleteIaPrompt(id: string): Promise<void> {
    await db.delete(iaPrompts).where(eq(iaPrompts.id, id));
  }

  async getIaPromptHistorico(promptId: string): Promise<IaPromptHistorico[]> {
    return db.select().from(iaPromptHistorico).where(eq(iaPromptHistorico.promptId, promptId)).orderBy(desc(iaPromptHistorico.createdAt));
  }

  async createIaPromptHistorico(data: InsertIaPromptHistorico): Promise<IaPromptHistorico> {
    const [created] = await db.insert(iaPromptHistorico).values(data).returning();
    return created;
  }

  async getCampanhas(workspaceId: string): Promise<Campanha[]> {
    return db.select().from(campanhas).where(eq(campanhas.workspaceId, workspaceId)).orderBy(desc(campanhas.createdAt));
  }

  async getCampanha(id: number, workspaceId?: string): Promise<Campanha | undefined> {
    const condition = workspaceId ? and(eq(campanhas.id, id), eq(campanhas.workspaceId, workspaceId)) : eq(campanhas.id, id);
    const [c] = await db.select().from(campanhas).where(condition);
    return c;
  }

  async createCampanha(data: InsertCampanha): Promise<Campanha> {
    const [created] = await db.insert(campanhas).values(data).returning();
    return created;
  }

  async updateCampanha(id: number, data: Partial<InsertCampanha>, workspaceId?: string): Promise<Campanha | undefined> {
    const condition = workspaceId ? and(eq(campanhas.id, id), eq(campanhas.workspaceId, workspaceId)) : eq(campanhas.id, id);
    const [updated] = await db.update(campanhas).set({ ...data, updatedAt: new Date() } as any).where(condition).returning();
    return updated;
  }

  async deleteCampanha(id: number, workspaceId?: string): Promise<void> {
    const condition = workspaceId ? and(eq(campanhas.id, id), eq(campanhas.workspaceId, workspaceId)) : eq(campanhas.id, id);
    await db.delete(campanhas).where(condition);
  }


  async getIntegrationConfigs(workspaceId: string): Promise<any[]> {
    return db.select().from(integrationConfigs).where(eq(integrationConfigs.workspaceId, workspaceId));
  }

  async upsertIntegrationConfig(workspaceId: string, integrationId: string, enabled: boolean, config?: any): Promise<any> {
    const [existing] = await db.select().from(integrationConfigs)
      .where(and(eq(integrationConfigs.workspaceId, workspaceId), eq(integrationConfigs.integrationId, integrationId)));
    if (existing) {
      const mergedConfig = config ? { ...(existing.config as any || {}), ...config } : existing.config;
      const [updated] = await db.update(integrationConfigs)
        .set({ enabled, config: mergedConfig, updatedAt: new Date() })
        .where(eq(integrationConfigs.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(integrationConfigs)
      .values({ workspaceId, integrationId, enabled, config: config ?? {} })
      .returning();
    return created;
  }

  async getRespostasRapidas(workspaceId: string): Promise<RespostaRapida[]> {
    return db.select().from(respostasRapidas).where(eq(respostasRapidas.workspaceId, workspaceId)).orderBy(respostasRapidas.ordem);
  }

  async getRespostaRapida(id: number, workspaceId?: string): Promise<RespostaRapida | undefined> {
    const conditions = [eq(respostasRapidas.id, id)];
    if (workspaceId) conditions.push(eq(respostasRapidas.workspaceId, workspaceId));
    const [r] = await db.select().from(respostasRapidas).where(and(...conditions));
    return r;
  }

  async createRespostaRapida(data: InsertRespostaRapida): Promise<RespostaRapida> {
    const [r] = await db.insert(respostasRapidas).values(data).returning();
    return r;
  }

  async updateRespostaRapida(id: number, data: Partial<InsertRespostaRapida>, workspaceId?: string): Promise<RespostaRapida | undefined> {
    const conditions = [eq(respostasRapidas.id, id)];
    if (workspaceId) conditions.push(eq(respostasRapidas.workspaceId, workspaceId));
    const [r] = await db.update(respostasRapidas).set(data).where(and(...conditions)).returning();
    return r;
  }

  async deleteRespostaRapida(id: number, workspaceId?: string): Promise<void> {
    const conditions = [eq(respostasRapidas.id, id)];
    if (workspaceId) conditions.push(eq(respostasRapidas.workspaceId, workspaceId));
    await db.delete(respostasRapidas).where(and(...conditions));
  }

  async getAnotacoes(workspaceId: string, filters?: { leadId?: number; conversationId?: number }): Promise<Anotacao[]> {
    const conditions = [eq(anotacoes.workspaceId, workspaceId)];
    if (filters?.leadId) conditions.push(eq(anotacoes.leadId, filters.leadId));
    if (filters?.conversationId) conditions.push(eq(anotacoes.conversationId, filters.conversationId));
    return db.select().from(anotacoes).where(and(...conditions)).orderBy(desc(anotacoes.createdAt));
  }

  async getAnotacao(id: number, workspaceId?: string): Promise<Anotacao | undefined> {
    const conditions = [eq(anotacoes.id, id)];
    if (workspaceId) conditions.push(eq(anotacoes.workspaceId, workspaceId));
    const [r] = await db.select().from(anotacoes).where(and(...conditions));
    return r;
  }

  async createAnotacao(data: InsertAnotacao): Promise<Anotacao> {
    const [r] = await db.insert(anotacoes).values(data).returning();
    return r;
  }

  async updateAnotacao(id: number, data: Partial<InsertAnotacao>, workspaceId?: string): Promise<Anotacao | undefined> {
    const conditions = [eq(anotacoes.id, id)];
    if (workspaceId) conditions.push(eq(anotacoes.workspaceId, workspaceId));
    const [r] = await db.update(anotacoes).set({ ...data, updatedAt: new Date() }).where(and(...conditions)).returning();
    return r;
  }

  async deleteAnotacao(id: number, workspaceId?: string): Promise<void> {
    const conditions = [eq(anotacoes.id, id)];
    if (workspaceId) conditions.push(eq(anotacoes.workspaceId, workspaceId));
    await db.delete(anotacoes).where(and(...conditions));
  }

  async getNotificacoes(workspaceId: string): Promise<any[]> {
    return db.select().from(notificacoes).where(eq(notificacoes.workspaceId, workspaceId)).orderBy(desc(notificacoes.createdAt)).limit(50);
  }

  async createNotificacao(data: { tipo: string; categoria: string; titulo: string; mensagem: string; link?: string; iconKey?: string; workspaceId: string }): Promise<any> {
    const [row] = await db.insert(notificacoes).values({
      tipo: data.tipo,
      categoria: data.categoria,
      titulo: data.titulo,
      mensagem: data.mensagem,
      link: data.link || null,
      iconKey: data.iconKey || "message",
      workspaceId: data.workspaceId,
    }).returning();
    return row;
  }

  async markNotificacaoRead(id: number, workspaceId: string): Promise<void> {
    await db.update(notificacoes).set({ lida: true }).where(and(eq(notificacoes.id, id), eq(notificacoes.workspaceId, workspaceId)));
  }

  async markAllNotificacoesRead(workspaceId: string): Promise<void> {
    await db.update(notificacoes).set({ lida: true }).where(and(eq(notificacoes.workspaceId, workspaceId), eq(notificacoes.lida, false)));
  }

  async deleteNotificacao(id: number, workspaceId: string): Promise<void> {
    await db.delete(notificacoes).where(and(eq(notificacoes.id, id), eq(notificacoes.workspaceId, workspaceId)));
  }

  async getDisparosProgramados(workspaceId: string): Promise<DisparoProgramado[]> {
    return db.select().from(disparosProgramados).where(eq(disparosProgramados.workspaceId, workspaceId)).orderBy(desc(disparosProgramados.scheduledAt));
  }

  async createDisparoProgramado(data: InsertDisparoProgramado): Promise<DisparoProgramado> {
    const [row] = await db.insert(disparosProgramados).values(data).returning();
    return row;
  }

  async getDisparosPendentes(): Promise<DisparoProgramado[]> {
    return db.select().from(disparosProgramados).where(
      and(
        eq(disparosProgramados.status, "pending"),
        lte(disparosProgramados.scheduledAt, new Date()),
      )
    );
  }

  // Bruno 2026-06-05 (revisão pré-deploy): claim ATÔMICO. Marca os pendentes
  // vencidos como 'sending' e retorna num ÚNICO UPDATE — assim o tick seguinte
  // (ou outra réplica) NÃO re-seleciona as mesmas linhas e reenvia (double-send),
  // mesmo que um lote demore mais que o intervalo do scheduler.
  async claimDisparosPendentes(): Promise<DisparoProgramado[]> {
    return db.update(disparosProgramados)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(
        eq(disparosProgramados.status, "pending"),
        lte(disparosProgramados.scheduledAt, new Date()),
      ))
      .returning();
  }

  // Recupera disparos presos em 'sending' (crash de um run anterior) há mais de
  // `minutes` minutos — devolve pra 'pending' pra reprocessar. Envio normal leva
  // segundos, então 'sending' antigo = órfão.
  async recoverStuckDisparos(minutes: number): Promise<void> {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    await db.update(disparosProgramados)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(
        eq(disparosProgramados.status, "sending"),
        lte(disparosProgramados.updatedAt, cutoff),
      ));
  }

  async markDisparoSent(id: string): Promise<void> {
    await db.update(disparosProgramados).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(disparosProgramados.id, id));
  }

  async markDisparoFailed(id: string, errorMessage: string): Promise<void> {
    await db.update(disparosProgramados).set({ status: "failed", errorMessage, updatedAt: new Date() }).where(eq(disparosProgramados.id, id));
  }

  async createNextOccurrence(disparo: DisparoProgramado): Promise<DisparoProgramado | null> {
    const freqDays = (disparo as any).recurrenceFrequencyDays || 30;
    const remaining = (disparo.recurrencePeriod ?? 1) - 1;
    if (remaining <= 0) return null;

    const current = new Date(disparo.scheduledAt);
    const next = new Date(current);
    next.setDate(next.getDate() + freqDays);
    const parentId = disparo.parentDisparoId ?? disparo.id;
    const [row] = await db.insert(disparosProgramados).values({
      workspaceId: disparo.workspaceId,
      leadId: disparo.leadId,
      contactName: disparo.contactName,
      phoneNumber: disparo.phoneNumber,
      messageText: disparo.messageText,
      mediaUrl: disparo.mediaUrl,
      mediaType: disparo.mediaType,
      scheduledAt: next,
      isRecurring: true,
      recurrenceType: disparo.recurrenceType,
      recurrencePeriod: remaining,
      recurrenceFrequencyDays: freqDays,
      parentDisparoId: parentId,
      createdBy: disparo.createdBy,
      status: "pending",
      // Bruno 2026-06-05: a recorrência herda o modo/template/categoria do original.
      dispatchMode: (disparo as any).dispatchMode ?? "texto_livre",
      channelForced: (disparo as any).channelForced ?? null,
      templateName: (disparo as any).templateName ?? null,
      templateLanguage: (disparo as any).templateLanguage ?? "pt_BR",
      templateVariables: (disparo as any).templateVariables ?? null,
      category: (disparo as any).category ?? "manual",
    }).returning();
    return row;
  }

  async deleteDisparoProgramado(id: string, workspaceId: string): Promise<void> {
    await db.delete(disparosProgramados).where(and(eq(disparosProgramados.id, id), eq(disparosProgramados.workspaceId, workspaceId)));
  }

  async cancelDisparoProgramado(id: string, workspaceId: string): Promise<void> {
    await db.update(disparosProgramados).set({ status: "cancelled", updatedAt: new Date() }).where(
      and(eq(disparosProgramados.id, id), eq(disparosProgramados.workspaceId, workspaceId))
    );
  }

  async getPartnerClients(partnerWorkspaceId: string): Promise<any[]> {
    const subs = await db.select().from(workspaces).where(eq(workspaces.parentWorkspaceId, partnerWorkspaceId)).orderBy(desc(workspaces.createdAt));
    const result = [];
    for (const ws of subs) {
      const [admin] = await db.select().from(users).where(and(eq(users.workspaceId, ws.id), eq(users.role, "admin"))).limit(1);
      const [leadCount] = await db.select({ count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.workspaceId, ws.id));
      const [convCount] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.workspaceId, ws.id));
      const wsConnections = await db.select().from(conexoes).where(eq(conexoes.workspaceId, ws.id));
      const activeConns = wsConnections.filter(c => c.status === "connected");
      const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.workspaceId, ws.id));
      result.push({
        ...ws,
        admin: admin ? { id: admin.id, nome: admin.nome, email: admin.email } : null,
        leadsCount: leadCount?.count || 0,
        conversationsCount: convCount?.count || 0,
        connectionsCount: wsConnections.length,
        activeConnectionsCount: activeConns.length,
        usersCount: userCount?.count || 0,
        connections: wsConnections.map(c => ({
          id: c.id,
          nome: c.nome,
          numero: c.numero,
          status: c.status,
          provider: c.provider,
          tipo: c.tipo,
          createdAt: c.createdAt,
        })),
      });
    }
    return result;
  }

  async getPartnerConnections(partnerWorkspaceId: string): Promise<any[]> {
    const subs = await db.select().from(workspaces).where(eq(workspaces.parentWorkspaceId, partnerWorkspaceId));
    const subIds = subs.map(s => s.id);
    if (subIds.length === 0) return [];

    const result = [];
    for (const ws of subs) {
      const wsConns = await db.select().from(conexoes).where(eq(conexoes.workspaceId, ws.id));
      for (const conn of wsConns) {
        result.push({
          ...conn,
          workspaceName: ws.nome,
          workspaceStatus: ws.status,
        });
      }
    }
    return result.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }

  async getPartnerClientDetail(partnerWorkspaceId: string, clientWorkspaceId: string): Promise<any> {
    const ws = await db.select().from(workspaces).where(and(eq(workspaces.id, clientWorkspaceId), eq(workspaces.parentWorkspaceId, partnerWorkspaceId))).then(r => r[0]);
    if (!ws) return null;

    const wsUsers = await db.select({ id: users.id, nome: users.nome, email: users.email, role: users.role, status: users.status, online: users.online }).from(users).where(eq(users.workspaceId, ws.id));
    const wsConns = await db.select().from(conexoes).where(eq(conexoes.workspaceId, ws.id));
    const [leadCount] = await db.select({ count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.workspaceId, ws.id));
    const [convCount] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.workspaceId, ws.id));

    return {
      ...ws,
      users: wsUsers,
      connections: wsConns.map(c => ({
        id: c.id, nome: c.nome, numero: c.numero, status: c.status, provider: c.provider,
        tipo: c.tipo, createdAt: c.createdAt, automacaoId: c.automacaoId,
      })),
      leadsCount: leadCount?.count || 0,
      conversationsCount: convCount?.count || 0,
    };
  }

  async createClientWorkspace(data: { partnerWorkspaceId: string; businessName: string; adminName: string; adminEmail: string; adminPassword: string; phone?: string }): Promise<{ workspace: any; user: any }> {
    const { randomBytes, scryptSync } = await import("crypto");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(data.adminPassword, salt, 64).toString("hex");
    const hashedPassword = `${salt}:${hash}`;

    const [ws] = await db.insert(workspaces).values({
      nome: data.businessName,
      status: "ACTIVE",
      accountType: "empreendedor",
      parentWorkspaceId: data.partnerWorkspaceId,
    }).returning();

    const username = data.adminEmail.toLowerCase().trim().split("@")[0] + "_" + Date.now();
    const [user] = await db.insert(users).values({
      username,
      password: hashedPassword,
      nome: data.adminName,
      email: data.adminEmail.toLowerCase().trim(),
      telefone: data.phone || null,
      role: "admin",
      status: "ACTIVE",
      workspaceId: ws.id,
      online: false,
      accountType: "empreendedor",
    }).returning();

    const s = ws.id.substring(0, 8);
    const UNIVERSAL_STAGES = [
      { prefix: "novo",               label: "Novo",               color: "#5b93d3", ordem: 0 },
      { prefix: "em_automacao",       label: "Em Automação",       color: "#f59e0b", ordem: 1 },
      { prefix: "aguardando",         label: "Aguardando",         color: "#a855f7", ordem: 2 },
      { prefix: "atendimento_humano", label: "Atendimento Humano", color: "#3b82f6", ordem: 3 },
      { prefix: "finalizado",         label: "Finalizado",         color: "#10b981", ordem: 4 },
    ];
    for (const pipeline of ["comercial", "suporte", "financeiro"]) {
      for (const st of UNIVERSAL_STAGES) {
        await db.insert(pipelineStages).values({
          key: `${st.prefix}_${s}`,
          label: st.label,
          color: st.color,
          ordem: st.ordem,
          pipeline,
          workspaceId: ws.id,
        });
      }
    }

    await this.ensureDefaultQuickReplies(ws.id);

    // Herda config do workspace-template (settings + situation_prompts).
    // Snapshot: novo tenant é dono da config imediatamente.
    try {
      const { tenantSettingsService } = await import("./services/tenantSettingsService");
      const seeded = await tenantSettingsService.seedNewTenantFromTemplate(ws.id);
      console.log(`[Storage] Template seeded for ${ws.id}: settings=${seeded.seededSettings}, situations=${seeded.seededSituations}`);
    } catch (e: any) {
      console.error(`[Storage] Failed to seed template for ${ws.id}:`, e.message);
    }

    return { workspace: ws, user: { id: user.id, nome: user.nome, email: user.email } };
  }

  async getPartnerStats(partnerWorkspaceId: string): Promise<{ totalClients: number; activeClients: number; totalLeads: number; totalConversations: number; totalConnections: number; activeConnections: number; monthlyRevenue: number }> {
    const subs = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.parentWorkspaceId, partnerWorkspaceId));
    const subIds = subs.map(s => s.id);
    if (subIds.length === 0) return { totalClients: 0, activeClients: 0, totalLeads: 0, totalConversations: 0, totalConnections: 0, activeConnections: 0, monthlyRevenue: 0 };

    let totalLeads = 0, totalConversations = 0, activeClients = 0, totalConnections = 0, activeConnections = 0;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const wsId of subIds) {
      const [lc] = await db.select({ count: sql<number>`count(*)::int` }).from(leads).where(eq(leads.workspaceId, wsId));
      const [cc] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.workspaceId, wsId));
      totalLeads += lc?.count || 0;
      totalConversations += cc?.count || 0;
      const [recent] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(and(eq(conversations.workspaceId, wsId), gte(conversations.createdAt, thirtyDaysAgo)));
      if ((recent?.count || 0) > 0) activeClients++;

      const wsConns = await db.select().from(conexoes).where(eq(conexoes.workspaceId, wsId));
      totalConnections += wsConns.length;
      activeConnections += wsConns.filter(c => c.status === "connected").length;
    }

    return { totalClients: subIds.length, activeClients, totalLeads, totalConversations, totalConnections, activeConnections, monthlyRevenue: Math.round(totalConnections * 87.90 * 100) / 100 };
  }

  async createPartnerInvite(data: { partnerWorkspaceId: string; clientEmail: string; clientName: string; businessName: string }): Promise<PartnerInvite> {
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [invite] = await db.insert(partnerInvites).values({
      partnerWorkspaceId: data.partnerWorkspaceId,
      clientEmail: data.clientEmail,
      clientName: data.clientName,
      businessName: data.businessName,
      inviteToken: token,
      expiresAt,
      workspaceId: data.partnerWorkspaceId,
    }).returning();
    return invite;
  }

  async getPartnerInvite(token: string): Promise<PartnerInvite | null> {
    const [invite] = await db.select().from(partnerInvites).where(eq(partnerInvites.inviteToken, token));
    return invite || null;
  }

  async getPartnerInvites(partnerWorkspaceId: string): Promise<PartnerInvite[]> {
    return db.select().from(partnerInvites).where(eq(partnerInvites.partnerWorkspaceId, partnerWorkspaceId)).orderBy(desc(partnerInvites.createdAt));
  }

  async updatePartnerInvite(id: string, data: Partial<any>): Promise<any> {
    const [updated] = await db.update(partnerInvites).set(data).where(eq(partnerInvites.id, id)).returning();
    return updated;
  }

  async createImpersonationToken(data: { partnerWorkspaceId: string; targetWorkspaceId: string; partnerUserId: number }): Promise<string> {
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await db.insert(partnerImpersonationTokens).values({
      partnerWorkspaceId: data.partnerWorkspaceId,
      targetWorkspaceId: data.targetWorkspaceId,
      partnerUserId: data.partnerUserId,
      token,
      expiresAt,
    });
    return token;
  }

  async validateImpersonationToken(token: string): Promise<{ valid: boolean; targetWorkspaceId?: string; partnerWorkspaceId?: string }> {
    const [row] = await db.select().from(partnerImpersonationTokens).where(eq(partnerImpersonationTokens.token, token));
    if (!row) return { valid: false };
    if (row.usedAt) return { valid: false };
    if (new Date() > row.expiresAt) return { valid: false };
    await db.update(partnerImpersonationTokens).set({ usedAt: new Date() }).where(eq(partnerImpersonationTokens.id, row.id));
    return { valid: true, targetWorkspaceId: row.targetWorkspaceId, partnerWorkspaceId: row.partnerWorkspaceId };
  }

  async getPesquisasSatisfacao(workspaceId: string): Promise<PesquisaSatisfacao[]> {
    return db.select().from(pesquisasSatisfacao).where(eq(pesquisasSatisfacao.workspaceId, workspaceId)).orderBy(desc(pesquisasSatisfacao.sistema), pesquisasSatisfacao.id);
  }

  async getPesquisaSatisfacao(id: number, workspaceId?: string): Promise<PesquisaSatisfacao | undefined> {
    const conditions = [eq(pesquisasSatisfacao.id, id)];
    if (workspaceId) conditions.push(eq(pesquisasSatisfacao.workspaceId, workspaceId));
    const [r] = await db.select().from(pesquisasSatisfacao).where(and(...conditions));
    return r;
  }

  async createPesquisaSatisfacao(data: InsertPesquisaSatisfacao): Promise<PesquisaSatisfacao> {
    const [r] = await db.insert(pesquisasSatisfacao).values(data).returning();
    return r;
  }

  async updatePesquisaSatisfacao(id: number, data: Partial<InsertPesquisaSatisfacao>, workspaceId?: string): Promise<PesquisaSatisfacao | undefined> {
    const conditions = [eq(pesquisasSatisfacao.id, id)];
    if (workspaceId) conditions.push(eq(pesquisasSatisfacao.workspaceId, workspaceId));
    const [r] = await db.update(pesquisasSatisfacao).set(data).where(and(...conditions)).returning();
    return r;
  }

  async deletePesquisaSatisfacao(id: number, workspaceId?: string): Promise<void> {
    const conditions = [eq(pesquisasSatisfacao.id, id)];
    if (workspaceId) conditions.push(eq(pesquisasSatisfacao.workspaceId, workspaceId));
    await db.delete(pesquisasSatisfacao).where(and(...conditions));
  }

  async createRespostaPesquisa(data: InsertRespostaPesquisa): Promise<RespostaPesquisa> {
    const [r] = await db.insert(respostasPesquisa).values(data).returning();
    return r;
  }

  async getRespostasPesquisa(workspaceId: string, pesquisaId?: number): Promise<RespostaPesquisa[]> {
    const conditions = [eq(respostasPesquisa.workspaceId, workspaceId)];
    if (pesquisaId) conditions.push(eq(respostasPesquisa.pesquisaId, pesquisaId));
    return db.select().from(respostasPesquisa).where(and(...conditions)).orderBy(desc(respostasPesquisa.createdAt));
  }

  async getDashboardStats(workspaceId: string): Promise<{
    csat: { media: number; total: number };
    lossReasons: { motivo: string; count: number }[];
    agentMessages: { agente: string; count: number }[];
  }> {
    const surveyResponses = await db.select().from(respostasPesquisa).where(eq(respostasPesquisa.workspaceId, workspaceId));
    const notasValidas = surveyResponses.filter(r => r.nota !== null && r.nota !== undefined);
    const csatMedia = notasValidas.length > 0 ? notasValidas.reduce((s, r) => s + (r.nota || 0), 0) / notasValidas.length : 0;

    const lostLeads = await db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.status, "perdido")));
    const reasonCounts: Record<string, number> = {};
    lostLeads.forEach(l => {
      const motivo = l.motivoPerda || "Nao informado";
      reasonCounts[motivo] = (reasonCounts[motivo] || 0) + 1;
    });
    const lossReasons = Object.entries(reasonCounts)
      .map(([motivo, count]) => ({ motivo, count }))
      .sort((a, b) => b.count - a.count);

    const msgCounts = await db
      .select({ agente: messages.agente, count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.direction, "out")))
      .groupBy(messages.agente);
    const agentMessages = msgCounts
      .filter(m => m.agente)
      .map(m => ({ agente: m.agente!, count: m.count }));

    return { csat: { media: csatMedia, total: notasValidas.length }, lossReasons, agentMessages };
  }

  async ensureDefaultQuickReplies(workspaceId: string): Promise<void> {
    const existing = await db.select().from(respostasRapidas).where(eq(respostasRapidas.workspaceId, workspaceId));
    if (existing.length > 0) return;

    const defaults = [
      {
        titulo: "Saudação",
        categoria: "Geral",
        atalho: "/ola",
        ordem: 0,
        texto: "😊 Olá {{nome}}! Bem-vindo(a) à *{{empresa}}*! Como posso te ajudar hoje?",
      },
      {
        titulo: "Obrigado",
        categoria: "Geral",
        atalho: "/obrigado",
        ordem: 1,
        texto: "🙏 {{nome}}, a *{{empresa}}* agradece seu contato! Foi um prazer te atender. Qualquer dúvida, estou sempre à disposição. Tenha um ótimo dia! 😄",
      },
      {
        titulo: "Nossos Serviços",
        categoria: "Comercial",
        atalho: "/servicos",
        ordem: 2,
        texto: `📋 *Confira o que a {{empresa}} oferece:*

  Me conta um pouco sobre o que você procura que eu te passo as opções, valores e condições ideais pra você. 😊

  Qual é o seu interesse?`,
      },
      {
        titulo: "Dados para Cadastro",
        categoria: "Comercial",
        atalho: "/cadastro",
        ordem: 3,
        texto: `🥳 Ótimo! Para finalizar, preciso de algumas informações. Pode me enviar tudo de uma vez:

  👤 1. Nome completo
  📄 2. CPF ou CNPJ
  ✉️ 3. E-mail
  📞 4. Telefone principal
  📍 5. Endereço completo

  Assim que receber, dou sequência pra você! 😊`,
      },
      {
        titulo: "Falar com Atendente",
        categoria: "Suporte",
        atalho: "/atendente",
        ordem: 4,
        texto: `👨‍💻 {{nome}}, já estou te encaminhando para um dos nossos atendentes!

  Só um instante que em breve alguém da equipe assume o seu atendimento. 😊`,
      },
      {
        titulo: "Formas de Pagamento",
        categoria: "Financeiro",
        atalho: "/pagamento",
        ordem: 5,
        texto: `💳 *Formas de pagamento da {{empresa}}:*

  • PIX
  • Cartão de crédito
  • Boleto

  Me diga qual você prefere que eu te envio os detalhes! 😊`,
      },
    ];

    for (const item of defaults) {
      await this.createRespostaRapida({ ...item, ativo: true, workspaceId });
    }
  }

  async ensureDefaultSurvey(workspaceId: string): Promise<PesquisaSatisfacao> {
    const existing = await db.select().from(pesquisasSatisfacao).where(
      and(eq(pesquisasSatisfacao.workspaceId, workspaceId), eq(pesquisasSatisfacao.sistema, true))
    );
    if (existing.length > 0) return existing[0];

    const qr = await this.createRespostaRapida({
      titulo: "Pesquisa de Satisfação",
      texto: "Olá! Gostaríamos de saber sua opinião sobre nosso atendimento. Por favor, avalie de 1 a 5:\n\n1 - Muito insatisfeito\n2 - Insatisfeito\n3 - Neutro\n4 - Satisfeito\n5 - Muito satisfeito\n\nResponda com o número correspondente.",
      categoria: "Pesquisa",
      atalho: "/pesquisa",
      ordem: -1,
      ativo: true,
      workspaceId,
    });

    const [survey] = await db.insert(pesquisasSatisfacao).values({
      titulo: "Pesquisa de Satisfacao",
      opcoes: ["Muito satisfeito", "Satisfeito", "Neutro", "Insatisfeito", "Muito insatisfeito"],
      ativo: true,
      sistema: true,
      respostaRapidaId: qr.id,
      workspaceId,
    }).returning();

    return survey;
  }

  async getTenantSettings(tenantId: string): Promise<TenantSettingsRow | undefined> {
    const [row] = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    return row;
  }

  async upsertTenantSettings(tenantId: string, settingsJson: any): Promise<TenantSettingsRow> {
    const [existing] = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    if (existing) {
      const [updated] = await db.update(tenantSettings)
        .set({ settingsJson, updatedAt: sql`now()` })
        .where(eq(tenantSettings.tenantId, tenantId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(tenantSettings)
      .values({ tenantId, settingsJson })
      .returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
