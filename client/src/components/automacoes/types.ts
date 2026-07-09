import {
  Zap, MessageSquare, Clock, GitBranch, Tag, UserCheck, PenLine, Brain, Flag,
  Pause, Play, Globe, ImagePlus, List, CreditCard, Webhook,
  Variable, GitMerge, Split, Timer, Repeat, Bell, FileOutput, Wifi, ShieldCheck,
  Bot,
} from "lucide-react";

export interface FlowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, any>;
  x: number;
  y: number;
  next: string[];
  nextTrue?: string;
  nextFalse?: string;
  nextOptions?: Record<string, string>;
  nextTextInput?: string;
}

export interface Automation {
  id?: string;
  nome: string;
  trigger: string;
  triggerType?: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT";
  execucoes: number;
  passos: number;
  nodes: FlowNode[];
  _local?: boolean;
}


export const NODE_TYPES: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  trigger:       { icon: Zap,            color: "#FAC209", label: "Gatilho" },
  send_message:  { icon: MessageSquare,  color: "#9b7ee0", label: "Enviar Mensagem" },
  delay:         { icon: Clock,          color: "#FBCA22", label: "Aguardar" },
  condition:     { icon: GitBranch,      color: "#fbbf24", label: "Condicao" },
  tag_lead:      { icon: Tag,            color: "#f97316", label: "Marcar Contato" },
  assign_agent:  { icon: UserCheck,      color: "#a78bfa", label: "Atribuir Atendente" },
  update_lead:   { icon: PenLine,        color: "#2dd4bf", label: "Atualizar Pipeline" },
  ai_response:   { icon: Brain,          color: "#e879f9", label: "Resposta IA" },
  webhook:       { icon: Globe,          color: "#fb7185", label: "Webhook" },
  send_image:    { icon: ImagePlus,      color: "#f472b6", label: "Enviar Imagem/PDF" },
  lista_opcoes:  { icon: List,           color: "#8B5CF6", label: "Lista de Opcoes" },
  stripe_payment:{ icon: CreditCard,     color: "#10B981", label: "Cobrar via Stripe" },
  set_variable:  { icon: Variable,      color: "#06b6d4", label: "Definir Variavel" },
  advanced_condition:{ icon: GitMerge,   color: "#eab308", label: "Condicao Avancada" },
  split_ia:      { icon: Split,         color: "#c084fc", label: "Split IA" },
  wait_event:    { icon: Timer,         color: "#FAC209", label: "Esperar Evento" },
  loop:          { icon: Repeat,        color: "#f59e0b", label: "Loop" },
  alerta_interno:{ icon: Bell,          color: "#ef4444", label: "Alerta Interno" },
  gerar_documento:{ icon: FileOutput,   color: "#8b5cf6", label: "Gerar Documento" },
  engine_isp:    { icon: Bot,           color: "#f97316", label: "Engine ISP" },
  isp_action:    { icon: Wifi,          color: "#FAC209", label: "Ação ISP" },
  isp_unlock:    { icon: ShieldCheck,   color: "#10b981", label: "Desbloqueio ISP" },
  end:           { icon: Flag,          color: "#6b6190", label: "Fim do Fluxo" },
};

export const NODE_CATEGORIES: { key: string; label: string; types: string[] }[] = [
  {
    key: "basicos",
    label: "Básicos",
    types: ["send_message", "send_image", "delay", "condition", "tag_lead", "assign_agent", "update_lead", "lista_opcoes", "end"],
  },
  {
    key: "avancados",
    label: "Avançados",
    types: ["ai_response", "advanced_condition", "split_ia", "set_variable", "wait_event", "loop", "alerta_interno", "gerar_documento"],
  },
  {
    key: "integracoes",
    label: "Integrações",
    types: ["webhook", "stripe_payment"],
  },
];

export const NODE_DESCRIPTIONS: Record<string, string> = {
  trigger: "O Gatilho e o ponto de partida de toda automacao. Ele define QUANDO o fluxo sera ativado.\n\nExemplos de uso:\n- Disparar o fluxo quando o cliente enviar uma mensagem no WhatsApp.\n- Iniciar uma sequencia de boas-vindas quando um novo contato for criado.\n- Agendar um lembrete diario as 9h para enviar ofertas.",
  send_message: "Envia uma mensagem de texto para o contato no canal ativo (WhatsApp, Instagram, etc). Suporta variaveis como {{nome}} para personalizar.\n\nExemplos de uso:\n- Enviar 'Ola {{nome}}, obrigado pelo contato!' assim que o contato chegar.\n- Mandar uma mensagem de follow-up apos 24h sem resposta.\n- Enviar o link de um catalogo com o nome do cliente personalizado.",
  send_image: "Envia uma imagem, PDF ou arquivo para o contato. Voce pode fazer upload direto do arquivo ou informar uma URL. Suporta legenda junto com o arquivo.\n\nExemplos de uso:\n- Enviar a foto de um produto quando o cliente perguntar sobre ele.\n- Mandar o PDF do catalogo de precos automaticamente.\n- Enviar um comprovante ou boleto em PDF apos gerar pagamento.",
  delay: "Adiciona uma pausa no fluxo antes de continuar para o proximo bloco. Configuravel em segundos, minutos, horas ou dias.\n\nExemplos de uso:\n- Esperar 5 minutos antes de enviar a segunda mensagem de boas-vindas.\n- Aguardar 24 horas para mandar um follow-up.\n- Dar um intervalo de 3 dias entre cada lembrete de cobranca.",
  condition: "Avalia uma condicao simples (Se/Entao). Verifica um campo do contato com um operador e direciona o fluxo para 'Sim' ou 'Nao'.\n\nExemplos de uso:\n- Se o canal for 'whatsapp', enviar mensagem; senao, enviar e-mail.\n- Se o status do contato for 'qualificado', atribuir a um vendedor.\n- Se a tag do contato contem 'VIP', enviar para o gerente.",
  advanced_condition: "Condicao avancada com multiplos grupos de regras combinados com logica E/OU. Ideal para regras de negocio complexas.\n\nExemplos de uso:\n- Se (canal = whatsapp E status = novo) OU (tag contem 'vip'), seguir caminho A.\n- Se (valor > 5000 E cidade = 'SP') E (origem = 'site'), enviar para equipe premium.\n- Se (tag contem 'interessado' E ultimo contato > 7 dias) OU (status = 'inativo'), disparar reengajamento.",
  tag_lead: "Adiciona, remove ou substitui tags no contato. Tags sao etiquetas para categorizar e segmentar contatos.\n\nExemplos de uso:\n- Adicionar a tag 'quente' quando o cliente demonstrar interesse.\n- Remover a tag 'pendente' apos o pagamento ser confirmado.\n- Substituir 'prospeccao' por 'cliente-ativo' apos fechar a venda.",
  assign_agent: "Atribui o contato a um atendente da equipe. Estrategias: Round Robin, Menos Ocupado, Especifico ou IA decide.\n\nExemplos de uso:\n- Distribuir novos contatos igualmente entre 3 vendedores (Round Robin).\n- Atribuir ao atendente com menos conversas abertas (Menos Ocupado).\n- Enviar contatos VIP sempre para o gerente comercial (Especifico).",
  update_lead: "Move o contato para uma etapa especifica de um pipeline. Avanca contatos automaticamente no funil de vendas.\n\nExemplos de uso:\n- Mover o contato para 'Proposta Enviada' apos enviar o orcamento.\n- Avancar para 'Negociacao' quando o cliente pedir desconto.\n- Mover para 'Fechado/Ganho' apos confirmacao de pagamento.",
  ai_response: "Usa inteligencia artificial (OpenAI GPT-4o) para gerar respostas automaticas. Processa texto, imagens, audio e documentos.\n\nExemplos de uso:\n- Responder perguntas sobre produtos usando um prompt treinado.\n- Analisar uma foto enviada pelo cliente e descrever o produto.\n- Transcrever um audio do cliente e gerar uma resposta personalizada.",
  webhook: "Envia dados para uma URL externa via HTTP POST. Integra com sistemas externos e APIs de terceiros.\n\nExemplos de uso:\n- Enviar dados do contato para o seu ERP quando ele for qualificado.\n- Notificar um sistema externo sempre que uma venda for fechada.\n- Registrar atividades do contato em um banco de dados externo.",
  lista_opcoes: "Apresenta uma lista de opcoes para o cliente escolher (como um menu). Cada opcao direciona para um caminho diferente.\n\nExemplos de uso:\n- Perguntar 'O que deseja? 1-Vendas, 2-Suporte, 3-Financeiro' e direcionar.\n- Oferecer '1-Agendar consulta, 2-Ver precos, 3-Falar com atendente'.\n- Criar um menu de produtos: '1-Produto A, 2-Produto B, 3-Outro'.",
  stripe_payment: "Gera um link de pagamento via Stripe com valor, descricao e moeda configurados.\n\nExemplos de uso:\n- Gerar link de R$99,90 para a assinatura mensal e enviar ao cliente.\n- Criar cobranca de US$49 para servico de consultoria.\n- Enviar link de pagamento personalizado apos aprovacao de orcamento.",
  set_variable: "Define ou atualiza uma variavel usavel nos blocos seguintes via {{variables.nome}}. Escopos: Sessao, Contato ou Global.\n\nExemplos de uso:\n- Salvar {{variables.produto_interesse}} = 'Plano Premium' para usar depois.\n- Gravar {{variables.desconto}} = '15%' no escopo do contato permanentemente.\n- Definir {{variables.promo_ativa}} = 'sim' como variavel global do workspace.",
  split_ia: "Usa IA para classificar a intencao da mensagem do cliente em categorias. Cada categoria tem uma saida diferente no fluxo.\n\nExemplos de uso:\n- Classificar em 'vendas', 'suporte' ou 'financeiro' e direcionar para equipes.\n- Identificar se o cliente quer 'comprar', 'trocar' ou 'devolver' um produto.\n- Separar mensagens em 'urgente', 'normal' ou 'spam' automaticamente.",
  wait_event: "Pausa o fluxo e aguarda um evento especifico. Se nao ocorrer no tempo limite, segue pelo caminho de timeout.\n\nExemplos de uso:\n- Aguardar a resposta do cliente por ate 2 horas; se nao responder, enviar lembrete.\n- Pausar ate o pagamento ser confirmado; se expirar em 24h, cancelar pedido.\n- Esperar ate receber um webhook externo confirmando entrega do produto.",
  loop: "Repete uma acao ate uma condicao ser atendida ou atingir o maximo de tentativas. Configuravel com intervalo.\n\nExemplos de uso:\n- Enviar lembrete de cobranca a cada 3 dias, no maximo 5 vezes.\n- Reenviar mensagem de follow-up a cada 24h ate o cliente responder.\n- Verificar status de pagamento a cada hora, ate 48 tentativas.",
  alerta_interno: "Envia notificacao interna para usuarios ou equipes do FlowCRM. Aparece no sino de notificacoes com niveis de prioridade.\n\nExemplos de uso:\n- Alertar a equipe de vendas (prioridade alta) quando um contato VIP chegar.\n- Notificar o gerente (urgente) quando uma reclamacao for detectada.\n- Avisar toda a equipe (prioridade baixa) sobre nova promocao configurada.",
  gerar_documento: "Gera documento HTML a partir de um template com variaveis substituidas pelos dados reais do contato.\n\nExemplos de uso:\n- Gerar orcamento com nome, valor e descricao do servico preenchidos.\n- Criar contrato de prestacao de servico com dados do cliente.\n- Montar recibo de pagamento com valor, data e nome do comprador.",
  engine_isp: "Engine ISP completa com IA — atendimento autonomo do provedor de internet. Processa a mensagem do cliente, identifica CPF, classifica departamento (Financeiro, Suporte, Comercial, Cancelamento) e resolve a demanda integrando com o ERP (SGP).\n\nExemplos de uso:\n- Atendimento autonomo completo: saudacao, identificacao por CPF, consulta de boletos, 2a via, desbloqueio de confianca.\n- Suporte tecnico: abrir chamado, verificar status de conexao, troubleshooting automatico.\n- Comercial: informar planos, verificar cobertura, iniciar processo de instalacao.\n- Cancelamento: entender motivo, oferecer retencao, registrar solicitacao.",
  isp_action: "Consulta dados do provedor de internet (SGP): clientes, boletos, chamados técnicos. Integra com o sistema de gestão do provedor.\n\nExemplos de uso:\n- Buscar cliente por CPF e verificar status da conexão.\n- Listar boletos em aberto e enviar 2ª via automaticamente.\n- Abrir chamado técnico quando o cliente relatar problema de sinal.",
  end: "Marca o fim do fluxo de automacao. Nenhuma acao adicional sera executada apos este bloco.\n\nExemplos de uso:\n- Encerrar o fluxo apos enviar mensagem de despedida.\n- Finalizar a automacao depois que o contato for atribuido a um atendente.\n- Marcar o fim do caminho 'Nao' de uma condicao que nao requer acao.",
};

export const TRIGGER_OPTIONS = [
  { value: "new_message",         label: "Nova mensagem recebida" },
  { value: "instagram_dm",        label: "DM do Instagram recebida" },
  { value: "conversation_opened", label: "Conversa iniciada" },
  { value: "lead_created",        label: "Contato criado" },
  { value: "lead_status_changed", label: "Status do contato alterado" },
  { value: "lead_won",            label: "Contato marcado como Ganho" },
  { value: "lead_lost",           label: "Contato marcado como Perdido" },
  { value: "tag_added",           label: "Tag adicionada ao contato" },
  { value: "scheduled",           label: "Agendado (horario fixo)" },
  { value: "form_submitted",      label: "Formulario enviado" },
  { value: "inactivity",          label: "Inatividade detectada" },
];

export const UNIT_LABELS: Record<string, string> = { seconds: "seg", minutes: "min", hours: "h", days: "dias" };

// Bruno 2026-05-15: paleta consistente com design system banana —
//   ACTIVE  = banana-500 (#FAC209) — estado positivo principal
//   PAUSED  = warning amber-500 (#F59E0B) — atenção/aguardando
//   DRAFT   = neutral muted (#9CA3AF) — rascunho discreto (era #6b6190 roxo
//             off-brand antes; rascunho não compete visualmente com ativo)
// Bruno 2026-06-02: dots ATIVO/PAUSADO seguem a cor do tema via tokens
// --chip-*-dot (antes #FAC209/#F59E0B hardcoded amarelo/âmbar). Rascunho
// fica cinza neutro. Usado no header do editor (FlowCanvas) e no card.
export const STATUS_CONF: Record<string, { dot: string; label: string; btn: string; btnIcon: typeof Play }> = {
  ACTIVE: { dot: "var(--chip-active-dot)", label: "Ativa",    btn: "Pausar",  btnIcon: Pause },
  PAUSED: { dot: "var(--chip-paused-dot)", label: "Pausada",  btn: "Ativar",  btnIcon: Play },
  DRAFT:  { dot: "#9CA3AF",                label: "Rascunho", btn: "Ativar",  btnIcon: Play },
};

export const TEMPLATES: {
  id: string; icon: typeof Zap; name: string; desc: string; cat: string; trigger: string;
  nodes: FlowNode[];
}[] = [
  {
    id: "boas_vindas", icon: MessageSquare, name: "Boas-vindas WhatsApp",
    desc: "Resposta automatica para novos contatos no WA", cat: "Atendimento", trigger: "Conversa iniciada",
    nodes: [
      { id: "n1", type: "trigger", label: "Conversa iniciada", config: { triggerType: "conversation_opened", channel: "whatsapp" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "delay", label: "Aguardar 3s", config: { value: 3, unit: "seconds" }, x: 180, y: 150, next: ["n3"] },
      { id: "n3", type: "send_message", label: "Boas-vindas", config: { content: "Ola {{nome}}!\n\nBem-vindo(a) ao nosso atendimento!\n\nEm que posso te ajudar hoje?" }, x: 180, y: 270, next: ["n4"] },
      { id: "n4", type: "assign_agent", label: "Atribuir a equipe", config: { strategy: "round_robin" }, x: 180, y: 410, next: ["n5"] },
      { id: "n5", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 530, next: [] },
    ],
  },
  {
    id: "qualificacao", icon: Brain, name: "Qualificacao com IA",
    desc: "IA classifica contatos em Quente, Morno ou Frio", cat: "Vendas", trigger: "Contato criado",
    nodes: [
      { id: "n1", type: "trigger", label: "Contato criado", config: { triggerType: "lead_created" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "ai_response", label: "Classificar com IA", config: { systemPrompt: "Classifique o lead e responda APENAS: HOT, WARM ou COLD", model: "gpt-4o-mini", saveAs: "aiScore" }, x: 180, y: 150, next: ["n3"] },
      { id: "n3", type: "condition", label: "E lead quente?", config: { field: "aiScore", operator: "contains", value: "HOT" }, x: 180, y: 300, next: [], nextTrue: "n4", nextFalse: "n5" },
      { id: "n4", type: "tag_lead", label: "Tag: Lead Quente", config: { tags: ["lead-quente", "prioridade-alta"], action: "add" }, x: 60, y: 440, next: ["n6"] },
      { id: "n5", type: "tag_lead", label: "Tag: Lead Morno", config: { tags: ["lead-morno"], action: "add" }, x: 300, y: 440, next: ["n6"] },
      { id: "n6", type: "assign_agent", label: "Atribuir vendedor", config: { strategy: "least_busy" }, x: 180, y: 570, next: ["n7"] },
      { id: "n7", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 690, next: [] },
    ],
  },
  {
    id: "followup", icon: Clock, name: "Follow-up Apos Proposta",
    desc: "Acompanha leads em estagio de proposta", cat: "Vendas", trigger: "Status: Proposta",
    nodes: [
      { id: "n1", type: "trigger", label: "Status -> Proposta", config: { triggerType: "lead_status_changed" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "delay", label: "Aguardar 24h", config: { value: 24, unit: "hours" }, x: 180, y: 150, next: ["n3"] },
      { id: "n3", type: "send_message", label: "Follow-up Dia 1", config: { content: "Ola {{nome}}!\n\nPassando para ver se teve chance de analisar nossa proposta.\n\nFicou alguma duvida?" }, x: 180, y: 270, next: ["n4"] },
      { id: "n4", type: "delay", label: "Aguardar 3 dias", config: { value: 3, unit: "days" }, x: 180, y: 410, next: ["n5"] },
      { id: "n5", type: "condition", label: "Respondeu?", config: { field: "replied", operator: "eq", value: "true" }, x: 180, y: 530, next: [], nextTrue: "n7", nextFalse: "n6" },
      { id: "n6", type: "send_message", label: "Follow-up Final", config: { content: "Oi {{nome}}, ultima tentativa!\n\nPosso oferecer condicoes especiais para fecharmos esta semana?" }, x: 60, y: 660, next: ["n7"] },
      { id: "n7", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 790, next: [] },
    ],
  },
  {
    id: "notif_lead", icon: Zap, name: "Notificar Equipe - Novo Contato",
    desc: "Avisa a equipe quando chega contato novo", cat: "Comercial", trigger: "Contato criado",
    nodes: [
      { id: "n1", type: "trigger", label: "Contato criado", config: { triggerType: "lead_created" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "send_message", label: "Alerta equipe", config: { content: "Novo lead!\n{{nome}}\n{{empresa}}\n{{telefone}}\nR$ {{valor}}\nCanal: {{canal}}" }, x: 180, y: 150, next: ["n3"] },
      { id: "n3", type: "assign_agent", label: "Atribuir vendedor", config: { strategy: "round_robin" }, x: 180, y: 290, next: ["n4"] },
      { id: "n4", type: "tag_lead", label: "Tag: novo-lead", config: { tags: ["novo"], action: "add" }, x: 180, y: 410, next: ["n5"] },
      { id: "n5", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 530, next: [] },
    ],
  },
  {
    id: "reativacao", icon: Clock, name: "Reativacao de Leads Frios",
    desc: "Reengaja leads sem resposta ha 7+ dias", cat: "Retencao", trigger: "Inatividade",
    nodes: [
      { id: "n1", type: "trigger", label: "Inatividade 7 dias", config: { triggerType: "inactivity" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "condition", label: "Contato ainda ativo?", config: { field: "status", operator: "neq", value: "GANHO" }, x: 180, y: 150, next: [], nextTrue: "n3", nextFalse: "n5" },
      { id: "n3", type: "send_message", label: "Reativacao", config: { content: "Oi {{nome}}!\n\nFaz um tempinho que nao conversamos...\n\nTem algum projeto novo que posso te ajudar?" }, x: 80, y: 290, next: ["n4"] },
      { id: "n4", type: "tag_lead", label: "Tag: reativado", config: { tags: ["reativado"], action: "add" }, x: 80, y: 420, next: ["n5"] },
      { id: "n5", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 550, next: [] },
    ],
  },
  {
    id: "pos_venda", icon: Flag, name: "Pos-venda & NPS",
    desc: "Agradecimento + pesquisa NPS apos fechar", cat: "Retencao", trigger: "Contato ganho",
    nodes: [
      { id: "n1", type: "trigger", label: "Contato marcado como Ganho", config: { triggerType: "lead_won" }, x: 180, y: 30, next: ["n2"] },
      { id: "n2", type: "send_message", label: "Agradecimento", config: { content: "{{nome}}, muito obrigado pela confianca!\n\nE uma honra ter voce como cliente!" }, x: 180, y: 150, next: ["n3"] },
      { id: "n3", type: "delay", label: "Aguardar 5 dias", config: { value: 5, unit: "days" }, x: 180, y: 280, next: ["n4"] },
      { id: "n4", type: "send_message", label: "Pesquisa NPS", config: { content: "Ola {{nome}}!\n\nDe 0 a 10, quanto nos indicaria a um amigo?" }, x: 180, y: 400, next: ["n5"] },
      { id: "n5", type: "tag_lead", label: "Tag: cliente-ativo", config: { tags: ["cliente", "nps-enviado"], action: "add" }, x: 180, y: 530, next: ["n6"] },
      { id: "n6", type: "end", label: "Fim do fluxo", config: {}, x: 180, y: 650, next: [] },
    ],
  },
];

export function genId() {
  return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export const INITIAL_AUTOMATIONS: Automation[] = [
  { nome: "Boas-vindas WhatsApp", status: "ACTIVE", trigger: "Conversa iniciada", execucoes: 1247, passos: 5, _local: true, nodes: TEMPLATES[0].nodes },
  { nome: "Qualificacao com IA", status: "ACTIVE", trigger: "Contato criado", execucoes: 388, passos: 7, _local: true, nodes: TEMPLATES[1].nodes },
  { nome: "Follow-up Proposta", status: "PAUSED", trigger: "Status: Proposta", execucoes: 94, passos: 7, _local: true, nodes: TEMPLATES[2].nodes },
  { nome: "Notif. Novo Contato", status: "ACTIVE", trigger: "Contato criado", execucoes: 521, passos: 5, _local: true, nodes: TEMPLATES[3].nodes },
  { nome: "Reativacao Frios", status: "DRAFT", trigger: "Inatividade", execucoes: 0, passos: 5, _local: true, nodes: TEMPLATES[4].nodes },
];

export interface TestLogEntry {
  nodeId: string;
  type: string;
  label: string;
  status: string;
  duration: number;
  output: Record<string, any>;
}

export function buildTestLog(nodes: FlowNode[]): { executedAt: string; success: boolean; log: TestLogEntry[] } {
  return {
    executedAt: new Date().toISOString(),
    success: true,
    log: nodes.map((n) => {
      const c = n.config || {};
      const out =
        n.type === "trigger" ? { triggered: true }
        : n.type === "delay" ? { waited: `${c.value || 0} ${UNIT_LABELS[c.unit] || "min"}` }
        : n.type === "send_message" ? { sent: true, preview: (c.content || "").slice(0, 60) }
        : n.type === "send_image" ? { sent: true, imageUrl: c.imageUrl || "", caption: (c.caption || "").slice(0, 60) }
        : n.type === "condition" ? { field: c.field, result: "true" }
        : n.type === "ai_response" ? { reply: "[Resposta simulada da IA]", model: c.model }
        : n.type === "engine_isp" ? { handled: true, intent: "FINANCEIRO", mode: "engine_autonoma" }
        : n.type === "webhook" ? { statusCode: 200, url: c.url }
        : n.type === "lista_opcoes" ? { title: c.title || "Sem titulo", options_count: (c.options || []).length, status: "waiting_input" }
        : n.type === "end" ? { finished: true }
        : {};
      return { nodeId: n.id, type: n.type, label: n.label, status: "success", duration: Math.floor(Math.random() * 90) + 10, output: out };
    }),
  };
}

export function getNodePreview(node: FlowNode): string {
  const c = node.config ?? {};
  switch (node.type) {
    case "trigger": return TRIGGER_OPTIONS.find((o) => o.value === c.triggerType)?.label || "Configure o gatilho";
    case "send_message": return c.content ? (c.content as string).replace(/\n/g, " ").slice(0, 48) + ((c.content as string).length > 48 ? "..." : "") : "Escreva a mensagem...";
    case "send_image": {
      const fileLabel = c.fileType === "pdf" ? (c.fileName || "PDF") : "Imagem";
      return c.imageUrl ? (c.caption ? (c.caption as string).slice(0, 40) : `${fileLabel} configurado(a)`) : "Envie um arquivo";
    }
    case "delay": return c.value ? `Aguardar ${c.value} ${UNIT_LABELS[c.unit] || c.unit}` : "Configure o tempo";
    case "condition": return c.field ? `Se ${c.field} ${c.operator || ""} "${c.value || ""}"` : "Configure a condicao";
    case "tag_lead": return (c.tags as string[])?.length ? `${c.action === "remove" ? "-" : "+"} ${(c.tags as string[]).join(", ")}` : "Selecione as tags";
    case "assign_agent": {
      const stratLabel = ({ round_robin: "Round Robin", least_busy: "Menos ocupado", specific: c.agentName || "Especifico", ai: "IA decide" } as Record<string, string>)[c.strategy] || "Configure a estrategia";
      return c.team ? `${stratLabel} (${c.team})` : stratLabel;
    }
    case "update_lead": {
      if (c.pipeline && c.stage) return `${c.pipelineLabel || c.pipeline} → ${c.stageLabel || c.stage}`;
      if (c.pipeline) return `${c.pipelineLabel || c.pipeline} (selecione etapa)`;
      return "Selecione pipeline e etapa";
    }
    case "ai_response": {
      const filesCount = (c.aiFiles || []).length;
      const filesTag = filesCount > 0 ? ` | ${filesCount} arquivo${filesCount > 1 ? "s" : ""}` : "";
      return c.model ? `${c.model}${filesTag}` : "Configure o modelo";
    }
    case "webhook": return c.url ? (c.url as string).replace("https://", "").slice(0, 40) : "Configure a URL";
    case "lista_opcoes": {
      const opts = (c.options as { id: string; label: string }[]) || [];
      if (opts.length === 0) return "Configure as opcoes";
      const styleTag = c.list_style === "buttons" ? "[Botoes] " : c.list_style === "text" ? "[Texto] " : "";
      const optionalTag = c.blocking === false ? "[Opcional] " : "";
      const labels = opts.slice(0, 3).map(o => o.label).join(", ");
      return optionalTag + styleTag + (opts.length > 3 ? `${labels} +${opts.length - 3}` : labels);
    }
    case "stripe_payment": return c.description ? `R$ ${c.display_amount || "0"} — ${c.description}` : "Configure o pagamento";
    case "engine_isp": {
      return c.enabled === false ? "Desativada" : "Engine ISP autônoma";
    }
    case "isp_action": {
      const actions: Record<string, string> = { search_customer: "Buscar cliente", get_invoices: "Listar boletos", second_copy: "2ª via", trust_unlock: "Desbloqueio", payment_confirmed: "Confirmar pagamento", payment_promise: "Promessa pagamento", service_order: "Ordem de serviço", create_ticket: "Abrir chamado", get_ticket_status: "Status chamado" };
      return actions[c.action] || "Configure a ação ISP";
    }
    case "isp_unlock": {
      const unlockActions: Record<string, string> = { trust_unlock: "Desbloqueio de confiança", payment_confirmed: "Confirmar pagamento" };
      return unlockActions[c.unlock_action] || "Configure o desbloqueio";
    }
    case "set_variable": return c.variable_name ? `${c.variable_name} = ${(c.variable_value || "").toString().slice(0, 20)}` : "Configure a variavel";
    case "advanced_condition": {
      const groups = c.condition_groups || [];
      return groups.length > 0 ? `${groups.length} grupo(s) — ${c.group_logic || "AND"}` : "Configure as condicoes";
    }
    case "split_ia": {
      const cats = c.categories || [];
      return cats.length > 0 ? `${cats.length} categorias: ${cats.slice(0, 3).join(", ")}` : "Configure as categorias";
    }
    case "wait_event": return c.event_type ? `Aguardar: ${c.event_type} (${c.timeout_minutes || 60}min)` : "Configure o evento";
    case "loop": return c.max_attempts ? `Max ${c.max_attempts}x a cada ${c.interval_value || 1} ${c.interval_unit || "hours"}` : "Configure o loop";
    case "alerta_interno": return c.alert_title ? `${c.alert_priority === "alta" ? "⚠ " : ""}${c.alert_title.slice(0, 30)}` : "Configure o alerta";
    case "gerar_documento": return c.document_name ? c.document_name.slice(0, 35) : "Configure o template";
    case "end": return "Fim do fluxo";
    default: return "";
  }
}

export function mapApiToLocal(a: any): Automation {
  const nodesArr = Array.isArray(a.nodes) ? a.nodes : [];
  const trigLabel = TRIGGER_OPTIONS.find((o) => o.value === a.triggerType)?.label || a.triggerType || "";
  return {
    id: a.id,
    nome: a.nome,
    trigger: trigLabel,
    triggerType: a.triggerType,
    status: a.status || "DRAFT",
    execucoes: a.execucoes ?? 0,
    passos: nodesArr.length,
    nodes: nodesArr,
    _local: false,
  };
}
