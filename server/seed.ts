import { db } from "./db";
import { leads, contacts, conversations, messages, transactions, pipelineStages, permissions, users, teams, teamMembers, planos, iaPrompts, workspaces } from "@shared/schema";
import { eq, sql, notInArray } from "drizzle-orm";
import { PLANS_CATALOG, CANONICAL_PLAN_SLUGS } from "@shared/plansCatalog";
import { scryptSync, randomBytes } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function seed() {
  let existingWs = await db.select().from(workspaces).limit(1);
  let wsId: string;
  if (existingWs.length === 0) {
    const [newWs] = await db.insert(workspaces).values({
      nome: "ChatBanana",
      slug: "chatbanana",
    } as any).returning();
    wsId = newWs.id;
  } else {
    wsId = existingWs[0].id;
  }

  const existingStages = await db.select().from(pipelineStages);
  if (existingStages.length === 0) {
    await db.insert(pipelineStages).values([
      { key: "novo", label: "Novo", color: "#60a5fa", ordem: 0, workspaceId: wsId },
      { key: "contatado", label: "Contatado", color: "#818cf8", ordem: 1, workspaceId: wsId },
      { key: "qualificado", label: "Qualificado", color: "#a78bfa", ordem: 2, workspaceId: wsId },
      { key: "proposta", label: "Proposta", color: "#c084fc", ordem: 3, workspaceId: wsId },
      { key: "negociacao", label: "Negociacao", color: "#e879f9", ordem: 4, workspaceId: wsId },
      { key: "ganho", label: "Ganho", color: "#34d399", ordem: 5, workspaceId: wsId },
      { key: "perdido", label: "Perdido", color: "#f87171", ordem: 6, workspaceId: wsId },
    ]);
  }

  const existingPerms = await db.select().from(permissions);
  if (existingPerms.length === 0) {
    await db.insert(permissions).values([
      {
        role: "admin",
        canViewAllLeads: true,
        canEditOthersLeads: true,
        canViewReports: true,
        canManageConnections: true,
        canManageAutomations: true,
        canExportData: true,
        canInviteUsers: true,
      },
      {
        role: "manager",
        canViewAllLeads: true,
        canEditOthersLeads: false,
        canViewReports: true,
        canManageConnections: false,
        canManageAutomations: false,
        canExportData: false,
        canInviteUsers: false,
      },
      {
        role: "agent",
        canViewAllLeads: false,
        canEditOthersLeads: false,
        canViewReports: false,
        canManageConnections: false,
        canManageAutomations: false,
        canExportData: false,
        canInviteUsers: false,
      },
    ]);
  }

  // Bruno 2026-06-19 — planos SEMPRE sincronizados (idempotente) com o catálogo
  // oficial (@shared/plansCatalog, MESMA grade da landing). Antes era
  // insert-só-se-vazio → a prod ficou com a grade ANTIGA (Starter/Professional/
  // Business 197/297/397) que nunca atualizava, divergindo da landing. Agora:
  // upsert por slug a cada boot + desativa (não deleta — preserva a FK
  // workspaces.plano_id) qualquer plano fora da grade canônica.
  for (const p of PLANS_CATALOG) {
    await db.insert(planos)
      .values({
        nome: p.nome, slug: p.slug, preco: p.preco as any,
        limiteCanais: p.limiteCanais, limiteClientes: p.limiteClientes, limiteUsuarios: p.limiteUsuarios,
        descricao: p.descricao, ativo: true,
      })
      .onConflictDoUpdate({
        target: planos.slug,
        set: {
          nome: p.nome, preco: p.preco as any,
          limiteCanais: p.limiteCanais, limiteClientes: p.limiteClientes, limiteUsuarios: p.limiteUsuarios,
          descricao: p.descricao, ativo: true,
        },
      });
  }
  await db.update(planos).set({ ativo: false }).where(notInArray(planos.slug, CANONICAL_PLAN_SLUGS));

  const existingUsers = await db.select().from(users);
  if (existingUsers.length === 0) {
    const seededUsers = await db.insert(users).values([
      { username: "joao@flowcrm.com", password: hashPassword("senha123"), nome: "Joao Duarte", email: "joao@flowcrm.com", cargo: "CEO & Fundador", role: "admin", status: "ACTIVE", online: true, telefone: "(11) 99999-0001", workspaceId: wsId },
      { username: "ana@flowcrm.com", password: hashPassword("senha123"), nome: "Ana Costa", email: "ana@flowcrm.com", cargo: "Gerente Comercial", role: "manager", status: "ACTIVE", online: true, telefone: "(11) 99999-0002", workspaceId: wsId },
      { username: "bruno@flowcrm.com", password: hashPassword("senha123"), nome: "Bruno Lima", email: "bruno@flowcrm.com", cargo: "Closer Senior", role: "agent", status: "ACTIVE", online: false, telefone: "(11) 99999-0003", workspaceId: wsId },
      { username: "carla@flowcrm.com", password: hashPassword("senha123"), nome: "Carla Mendes", email: "carla@flowcrm.com", cargo: "SDR", role: "agent", status: "ACTIVE", online: true, telefone: "(11) 99999-0004", workspaceId: wsId },
      { username: "diego@flowcrm.com", password: hashPassword("senha123"), nome: "Diego Ferreira", email: "diego@flowcrm.com", cargo: "Account Manager", role: "manager", status: "INACTIVE", online: false, telefone: "(11) 99999-0005", workspaceId: wsId },
    ]).returning();

    // CRM genérico: só a equipe Comercial é nativa default (Bruno 2026-06-28).
    const [teamComercial] = await db.insert(teams).values([
      { nome: "Comercial", descricao: "Equipe de vendas e novos contratos", leaderId: seededUsers[1].id, pipelineKey: "comercial", fixed: true, active: true, workspaceId: wsId },
    ]).returning();

    if (teamComercial) {
      await db.insert(teamMembers).values([
        { teamId: teamComercial.id, userId: seededUsers[1].id },
        { teamId: teamComercial.id, userId: seededUsers[2].id },
        { teamId: teamComercial.id, userId: seededUsers[3].id },
      ]);
    }
  }

  const existingPrompts = await db.select().from(iaPrompts);
  if (existingPrompts.length === 0) {
    await db.insert(iaPrompts).values([
      {
        slug: "atendimento",
        nome: "Atendimento WhatsApp",
        descricao: "Usado no fluxo de atendimento inicial do WhatsApp",
        prompt: "Voce e um assistente de atendimento da empresa. Seja sempre cordial, objetivo e prestativo. Responda em portugues brasileiro. Quando nao souber a resposta, diga que vai verificar e transferir para um humano. Nunca invente informacoes.",
        modelo: "gpt-4o-mini",
        temperatura: "0.70",
        maxTokens: 1000,
      },
      {
        slug: "qualificacao",
        nome: "Qualificacao de Leads",
        descricao: "Classifica leads recebidos no pipeline",
        prompt: "Voce e um especialista em qualificacao de leads B2B. Analise as informacoes do lead e responda APENAS uma das tres palavras: HOT (lead com alto potencial, demonstrou interesse claro e tem perfil ideal), WARM (lead com medio potencial, algum interesse mas precisa de nutricao) ou COLD (lead frio, pouco interesse ou fora do perfil). Responda somente a palavra, sem explicacoes.",
        modelo: "gpt-4o-mini",
        temperatura: "0.20",
        maxTokens: 100,
      },
      {
        slug: "followup",
        nome: "Follow-up Automatico",
        descricao: "Gera mensagens de follow-up personalizadas",
        prompt: "Voce e um especialista em vendas consultivas. Gere uma mensagem de follow-up personalizada, amigavel e nao invasiva para o lead informado. A mensagem deve ter no maximo 3 linhas, usar o primeiro nome do lead, ser em portugues brasileiro e terminar com uma pergunta aberta que incentive a resposta. Nao use emojis em excesso.",
        modelo: "gpt-4o-mini",
        temperatura: "0.80",
        maxTokens: 500,
      },
    ]);
  }

  const existingLeads = await db.select().from(leads);
  if (existingLeads.length > 0) return;

  if (!wsId) {
    console.warn('[Seed] wsId not found, skipping leads/contacts/conversations seed');
    return;
  }

  await db.insert(leads).values([
    { nome: "Imobiliaria Sao Paulo", contato: "Carlos Silva", valor: 15000, status: "proposta", canal: "WhatsApp", owner: "Ana Costa", email: "carlos@imob.com", telefone: "(11) 98765-4321", empresa: "Imob SP", workspaceId: wsId },
    { nome: "Clinica Bem Estar", contato: "Dra. Paula", valor: 8500, status: "qualificado", canal: "Instagram", owner: "Bruno Lima", email: "paula@clinica.com", telefone: "(11) 91234-5678", empresa: "Clinica BE", workspaceId: wsId },
    { nome: "Escritorio JK Adv", contato: "Dr. Marcos", valor: 4200, status: "contatado", canal: "WhatsApp", owner: "Ana Costa", email: "marcos@jk.adv.br", telefone: "(11) 93344-5566", empresa: "JK Advocacia", workspaceId: wsId },
    { nome: "Academia FitLife", contato: "Pedro Alves", valor: 3800, status: "novo", canal: "WhatsApp", owner: "Carlos", email: "pedro@fitlife.com", telefone: "(11) 97788-9900", empresa: "FitLife", workspaceId: wsId },
    { nome: "Restaurante Bella", contato: "Marina Rocha", valor: 6200, status: "negociacao", canal: "WhatsApp", owner: "Bruno Lima", email: "marina@bella.com", telefone: "(11) 95566-7788", empresa: "Bella Cucina", workspaceId: wsId },
    { nome: "Tech Startup Alpha", contato: "Lucas Dev", valor: 22000, status: "ganho", canal: "Email", owner: "Ana Costa", email: "lucas@alpha.io", telefone: "(11) 92233-4455", empresa: "Alpha Tech", workspaceId: wsId },
    { nome: "Construtora Norte", contato: "Roberto Paz", valor: 45000, status: "perdido", canal: "WhatsApp", owner: "Carlos", email: "roberto@norte.com", telefone: "(11) 96677-8899", empresa: "Construtora Norte", workspaceId: wsId },
  ] as any);

  await db.insert(contacts).values([
    { nome: "Carlos Silva", empresa: "Imobiliaria SP", telefone: "(11) 98765-4321", email: "carlos@imob.com", canal: "WhatsApp", tags: ["vip", "imobiliaria"], workspaceId: wsId },
    { nome: "Dra. Paula", empresa: "Clinica Bem Estar", telefone: "(11) 91234-5678", email: "paula@clinica.com", canal: "Instagram", tags: ["saude"], workspaceId: wsId },
    { nome: "Dr. Marcos", empresa: "JK Advocacia", telefone: "(11) 93344-5566", email: "marcos@jk.adv.br", canal: "WhatsApp", tags: ["juridico"], workspaceId: wsId },
    { nome: "Pedro Alves", empresa: "Academia FitLife", telefone: "(11) 97788-9900", email: "pedro@fitlife.com", canal: "WhatsApp", tags: ["fitness"], workspaceId: wsId },
    { nome: "Marina Rocha", empresa: "Bella Cucina", telefone: "(11) 95566-7788", email: "marina@bella.com", canal: "WhatsApp", tags: ["gastronomia", "premium"], workspaceId: wsId },
    { nome: "Lucas Dev", empresa: "Alpha Tech", telefone: "(11) 92233-4455", email: "lucas@alpha.io", canal: "Email", tags: ["tech", "startup"], workspaceId: wsId },
  ]);

  const [conv1] = await db.insert(conversations).values([
    { nome: "Carlos Silva", canal: "WhatsApp", ultimaMensagem: "Pode me enviar a proposta atualizada?", tempo: "5min", unread: 2, status: "open", workspaceId: wsId },
    { nome: "Dra. Paula", canal: "Instagram", ultimaMensagem: "Obrigada! Vou analisar.", tempo: "15min", unread: 0, status: "open", workspaceId: wsId },
    { nome: "Pedro Alves", canal: "WhatsApp", ultimaMensagem: "Qual o prazo de implementacao?", tempo: "1h", unread: 1, status: "open", workspaceId: wsId },
    { nome: "Marina Rocha", canal: "WhatsApp", ultimaMensagem: "Perfeito, vamos fechar!", tempo: "2h", unread: 0, status: "open", workspaceId: wsId },
    { nome: "Lucas Dev", canal: "Email", ultimaMensagem: "Contrato assinado. Obrigado!", tempo: "1d", unread: 0, status: "resolved", workspaceId: wsId },
  ]).returning();

  if (conv1) {
    const convs = await db.select().from(conversations);
    for (const conv of convs) {
      const sampleMessages = [
        { conversationId: conv.id, direction: "in", texto: `Ola, gostaria de saber mais sobre os servicos.`, hora: "09:30", agente: conv.nome, workspaceId: wsId },
        { conversationId: conv.id, direction: "out", texto: `Ola ${conv.nome}! Claro, posso te ajudar. Qual o seu interesse principal?`, hora: "09:32", agente: "Voce", workspaceId: wsId },
        { conversationId: conv.id, direction: "in", texto: `Preciso de uma solucao completa para gerenciamento de clientes.`, hora: "09:35", agente: conv.nome, workspaceId: wsId },
        { conversationId: conv.id, direction: "out", texto: `Temos o plano ideal para voce! Posso agendar uma demonstracao?`, hora: "09:37", agente: "Voce", workspaceId: wsId },
        { conversationId: conv.id, direction: "in", texto: conv.ultimaMensagem || "Vamos conversar!", hora: "09:40", agente: conv.nome, workspaceId: wsId },
      ];
      await db.insert(messages).values(sampleMessages);
    }
  }

  await db.insert(transactions).values([
    { descricao: "Assinatura Alpha Tech", valor: 22000, tipo: "receita", categoria: "SaaS", data: "28/02", status: "pago", workspaceId: wsId },
    { descricao: "Licenca CRM Pro", valor: 497, tipo: "despesa", categoria: "Software", data: "01/03", status: "pago", workspaceId: wsId },
    { descricao: "Comissao Ana Costa", valor: 3300, tipo: "despesa", categoria: "Comissoes", data: "01/03", status: "pago", workspaceId: wsId },
    { descricao: "Proposta Imobiliaria SP", valor: 15000, tipo: "receita", categoria: "SaaS", data: "05/03", status: "pendente", workspaceId: wsId },
    { descricao: "Google Ads - Marco", valor: 1200, tipo: "despesa", categoria: "Marketing", data: "03/03", status: "pago", workspaceId: wsId },
    { descricao: "Consultoria Restaurante", valor: 6200, tipo: "receita", categoria: "Consultoria", data: "04/03", status: "pendente", workspaceId: wsId },
  ] as any);

}
