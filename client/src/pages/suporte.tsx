import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import {
  MessageSquare,
  Phone,
  Mail,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  Headphones,
  BookOpen,
  Zap,
  BarChart2,
  Users,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  Radio,
  Link2,
  KanbanSquare,
  Inbox as InboxIcon,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";

// Central de Suporte do CRM Norte Gestão — documentação e ajuda para usar o
// produto (CRM/funil, atendimento, automações, canais, relatórios, equipes).
const WHATSAPP_NUMBER = "5591984927235";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}`;

const quickLinks = [
  { icon: KanbanSquare, label: "CRM & Funil", desc: "Pipeline de vendas em Kanban", url: "/crm", color: "hsl(var(--primary))" },
  { icon: InboxIcon, label: "Atendimento", desc: "Inbox de conversas em tempo real", url: "/atendimento", color: "#8b5cf6" },
  { icon: Zap, label: "Automações", desc: "Builder visual de fluxos", url: "/automacoes", color: "#f59e0b" },
  { icon: Radio, label: "Canais", desc: "WhatsApp (Meta/Evolution) e Instagram", url: "/conexoes", color: "#25D366" },
  { icon: Link2, label: "Integrações", desc: "Stripe, Mercado Pago, Instagram e API", url: "/integracoes", color: "#10b981" },
  { icon: BarChart2, label: "Relatórios", desc: "Métricas de atendimento e CSAT", url: "/relatorios", color: "#0ea5e9" },
];

// Visão geral do que o CRM entrega — orienta quem está começando.
const recursos = [
  { icon: KanbanSquare, title: "Funil de vendas", desc: "Organize leads e clientes em colunas arrastáveis, do primeiro contato ao fechamento.", color: "hsl(var(--primary))" },
  { icon: MessageSquare, title: "Atendimento omnichannel", desc: "WhatsApp e Instagram num só inbox, com histórico, notas e transferência entre equipes.", color: "#8b5cf6" },
  { icon: Zap, title: "Automações visuais", desc: "Monte fluxos de resposta e qualificação sem escrever código, com o builder de nós.", color: "#f59e0b" },
  { icon: BarChart2, title: "Relatórios & CSAT", desc: "Acompanhe volume de atendimentos, resolução automática, satisfação (CSAT) e NPS.", color: "#0ea5e9" },
];

const faqCategories = [
  {
    id: "inicio",
    icon: BookOpen,
    label: "Primeiros Passos",
    questions: [
      {
        q: "Por onde eu começo?",
        a: "Conecte um canal de WhatsApp em Canais, organize seu funil em CRM e, se quiser respostas automáticas, monte um fluxo em Automações. Com isso a operação já roda: as conversas chegam em Atendimento e os cards aparecem no seu funil.",
      },
      {
        q: "O que é um workspace?",
        a: "É o espaço isolado da sua empresa dentro do CRM — todos os seus contatos, conversas, funil e configurações ficam separados de qualquer outra empresa. Você gerencia dados da empresa, equipe e permissões em Workspace.",
      },
      {
        q: "Como convido minha equipe?",
        a: "Em Usuários & Equipe você cria equipes (Comercial, Suporte, Financeiro…) e convida atendentes por e-mail ou cadastro direto. Cada pessoa entra com o papel e as permissões que você definir.",
      },
    ],
  },
  {
    id: "crm",
    icon: KanbanSquare,
    label: "CRM & Funil",
    questions: [
      {
        q: "Como funciona o funil de vendas?",
        a: "O CRM é um Kanban: cada coluna é uma etapa (Novo, Em negociação, Ganho, Perdido…) e cada card é um contato. Você arrasta o card entre as colunas conforme a negociação avança. As colunas são editáveis em Gerenciar colunas.",
      },
      {
        q: "De onde vêm os contatos do funil?",
        a: "Toda conversa recebida vira um contato; você também pode criar contatos manualmente e importar uma base por planilha. Cada contato guarda telefone, dados, tags e o histórico de atendimento.",
      },
      {
        q: "Posso ter mais de um funil?",
        a: "Sim. Você pode organizar pipelines por setor (Comercial, Suporte Técnico, Financeiro) e mover as conversas para o funil certo conforme a necessidade.",
      },
    ],
  },
  {
    id: "atendimento",
    icon: InboxIcon,
    label: "Atendimento",
    questions: [
      {
        q: "Onde os atendentes trabalham as conversas?",
        a: "Em Atendimento (o Chat). Ao assumir uma conversa, o atendente vê o histórico, os dados do contato e as notas internas. Ele responde por texto, mídia, áudio, localização e respostas rápidas.",
      },
      {
        q: "O que são respostas rápidas?",
        a: "São mensagens prontas com atalho (ex.: //ola, //obrigado) para responder em um clique. Crie e organize em Gestão de Conversa → Respostas Rápidas; elas aceitam variáveis como {{nome}} e {{empresa}}.",
      },
      {
        q: "Como funciona o fechamento automático das conversas?",
        a: "Quando o cliente para de responder, a conversa é encerrada por inatividade após alguns minutos e o protocolo é registrado. Qualquer nova mensagem reabre o atendimento, e conversa com atendente humano ativo não é fechada sozinha.",
      },
    ],
  },
  {
    id: "automacoes",
    icon: Zap,
    label: "Automações",
    questions: [
      {
        q: "O que dá pra automatizar?",
        a: "Boas-vindas, menus de departamento, respostas por palavra-chave, qualificação de leads, coleta de dados e encaminhamento para o setor certo. Você monta tudo visualmente em Automações, ligando nós de mensagem, condição, espera e IA.",
      },
      {
        q: "Preciso saber programar?",
        a: "Não. O builder é visual — você arrasta os nós e conecta o fluxo. Cada nó tem um painel de configuração próprio para escrever as mensagens e definir as condições.",
      },
      {
        q: "Como ligo uma automação a um canal?",
        a: "Em Canais, cada conexão tem o campo 'Automação vinculada': escolha o fluxo ativo que deve rodar quando chegar uma nova mensagem naquele canal.",
      },
    ],
  },
  {
    id: "canais",
    icon: Radio,
    label: "WhatsApp & Canais",
    questions: [
      {
        q: "Qual conexão de WhatsApp devo usar?",
        a: "Recomendamos a API Oficial do Meta (WhatsApp Cloud API): estável, com botões, listas e templates HSM para mensagens proativas, sem risco de bloqueio. A conexão via Evolution (QR Code, não-oficial) também funciona e é ótima pra começar rápido. Conecte tudo em Canais.",
      },
      {
        q: "Como envio mensagens em massa?",
        a: "Por templates aprovados pela Meta (HSM), que podem sair fora da janela de 24h. Crie e dispare em Gestão de Conversa → Campanhas e Disparo Programado. Use para avisos, promoções e lembretes.",
      },
      {
        q: "Posso conectar o Instagram?",
        a: "Sim. O Instagram Direct também se conecta em Canais e cai no mesmo inbox de atendimento. A prospecção por DM e comentário tem um módulo próprio (Insta Prospect).",
      },
    ],
  },
  {
    id: "relatorios",
    icon: BarChart2,
    label: "Relatórios",
    questions: [
      {
        q: "Onde vejo as métricas do atendimento?",
        a: "Em Relatórios → Dashboard: total de atendimentos no período, quanto foi resolvido pela automação x escalado para atendente, distribuição por canal e por equipe, e a tendência ao longo do tempo.",
      },
      {
        q: "Como medir a satisfação do cliente?",
        a: "O CRM dispara CSAT ao encerrar o atendimento (nota de 1 a 5) e pode disparar NPS depois da resolução (nota de 0 a 10). Os resultados aparecem em Relatórios → Pesquisa de Satisfação.",
      },
    ],
  },
];

export default function Suporte() {
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("inicio");
  const [openQuestions, setOpenQuestions] = useState<Set<string>>(new Set());

  const toggleQuestion = (key: string) => {
    setOpenQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredFaqs = searchTerm.trim()
    ? faqCategories
        .map((cat) => ({
          ...cat,
          questions: cat.questions.filter(
            (q) =>
              q.q.toLowerCase().includes(searchTerm.toLowerCase()) ||
              q.a.toLowerCase().includes(searchTerm.toLowerCase())
          ),
        }))
        .filter((cat) => cat.questions.length > 0)
    : faqCategories.filter((cat) => cat.id === activeCategory);

  const openWhatsApp = (msg?: string) => {
    const text = msg || "Olá! Preciso de ajuda com o Norte Gestão CRM.";
    window.open(`${WHATSAPP_LINK}?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Headphones className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-suporte-title">Central de Suporte</h1>
            <p className="text-xs text-muted-foreground">Documentação, dúvidas e ajuda para usar o CRM</p>
          </div>
        </div>

        {/* Status / subsistemas */}
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">Plataforma no ar</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {["Atendimento", "CRM", "Automações", "Canais"].map((s) => (
                <span key={s} className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  {s}
                </span>
              ))}
            </div>
            <button
              onClick={() => openWhatsApp("Olá! Preciso de suporte com o Norte Gestão CRM.")}
              className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold hover:underline shrink-0"
              style={{ color: "#25D366" }}
              data-testid="button-status-whatsapp"
            >
              <SiWhatsapp className="w-3.5 h-3.5" /> Suporte em tempo real
            </button>
          </div>
        </Card>

        {/* Contatos de Suporte */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card
            className="p-4 cursor-pointer hover:border-green-500/50 transition-all group"
            onClick={() => openWhatsApp()}
            data-testid="card-suporte-whatsapp"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#25D36615" }}>
                <SiWhatsapp className="w-4 h-4" style={{ color: "#25D366" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold">WhatsApp Suporte</div>
                <div className="text-[10.5px] text-muted-foreground">Resposta em minutos</div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-green-500 transition-colors shrink-0" />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "#25D366" }}>
              <Phone className="w-3 h-3" />
              (91) 98492-7235
            </div>
          </Card>

          <Card className="p-4" data-testid="card-suporte-email">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 shrink-0">
                <Mail className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold">E-mail</div>
                <div className="text-[10.5px] text-muted-foreground">Até 24h úteis</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <Mail className="w-3 h-3" />
              suporte@chatbanana.com.br
            </div>
          </Card>

          <Card className="p-4" data-testid="card-suporte-horario">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/10 shrink-0">
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold">Horário</div>
                <div className="text-[10.5px] text-muted-foreground">Atendimento</div>
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-500">
                <Clock className="w-3 h-3" />
                Seg–Sex: 8h às 18h
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                <Clock className="w-3 h-3" />
                Sáb: 8h às 12h
              </div>
            </div>
          </Card>
        </div>

        {/* Atalhos rápidos */}
        <div>
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" />
            Acessos rápidos
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Card
                  key={link.url}
                  className="p-4 cursor-pointer hover:border-primary/40 transition-all group"
                  onClick={() => navigate(link.url)}
                  data-testid={`quick-link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center mb-2"
                    style={{
                      background: link.color.startsWith("hsl")
                        ? `hsl(var(--primary) / 0.09)`
                        : `${link.color}18`,
                    }}
                  >
                    <Icon className="w-4 h-4" style={{ color: link.color }} />
                  </div>
                  <div className="text-[12px] font-bold leading-tight mb-0.5">{link.label}</div>
                  <div className="text-[10.5px] text-muted-foreground leading-tight">{link.desc}</div>
                  <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: link.color.startsWith("hsl") ? "hsl(var(--primary))" : link.color }}>
                    Acessar <ArrowRight className="w-2.5 h-2.5" />
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* O que o CRM entrega */}
        <Card className="p-5">
          <h2 className="text-[13px] font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            O que o CRM entrega
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {recursos.map((r, i) => {
              const Icon = r.icon;
              return (
                <div key={i} className="rounded-xl border border-border p-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: r.color.startsWith("hsl") ? `hsl(var(--primary) / 0.10)` : `${r.color}18` }}>
                    <Icon className="w-4 h-4" style={{ color: r.color }} />
                  </div>
                  <div className="text-[12px] font-bold leading-tight mb-1">{r.title}</div>
                  <div className="text-[10.5px] text-muted-foreground leading-snug">{r.desc}</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Checklist de primeiros passos */}
        <Card className="p-5">
          <h2 className="text-[13px] font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Checklist de primeiros passos
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {[
              { label: "Conectar o WhatsApp (Meta Oficial ou Evolution)", url: "/conexoes" },
              { label: "Organizar as colunas do seu funil no CRM", url: "/crm" },
              { label: "Criar equipes por setor (Comercial, Suporte…)", url: "/usuarios" },
              { label: "Montar uma automação de boas-vindas", url: "/automacoes" },
              { label: "Cadastrar respostas rápidas", url: "/gestao-conversas" },
              { label: "Conectar integrações (pagamentos, Instagram)", url: "/integracoes" },
              { label: "Ativar CSAT e NPS", url: "/configuracoes" },
              { label: "Acompanhar os Relatórios após os primeiros atendimentos", url: "/relatorios" },
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => navigate(item.url)}
                className="flex items-center gap-2.5 text-left p-2 rounded-lg hover:bg-muted/50 transition-colors group"
                data-testid={`checklist-item-${i}`}
              >
                <div className="w-5 h-5 rounded border-2 border-border group-hover:border-primary/50 transition-colors shrink-0 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-sm bg-muted-foreground/20 group-hover:bg-primary/30 transition-colors" />
                </div>
                <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">{item.label}</span>
                <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
              </button>
            ))}
          </div>
        </Card>

        {/* FAQ */}
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2 mb-4">
            <BookOpen className="w-4 h-4 text-primary" />
            Perguntas Frequentes
          </h2>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar nas perguntas..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-faq-search"
            />
          </div>

          {!searchTerm && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {faqCategories.map((cat) => {
                const CatIcon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setActiveCategory(cat.id)}
                    className={`seg-tab ${activeCategory === cat.id ? "seg-tab-active" : ""}`}
                    data-testid={`tab-faq-${cat.id}`}
                  >
                    <CatIcon className="w-3 h-3" />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            {filteredFaqs.map((cat) =>
              cat.questions.map((q, i) => {
                const key = `${cat.id}-${i}`;
                const isOpen = openQuestions.has(key);
                return (
                  <Card key={key} className={`overflow-hidden transition-all ${isOpen ? "border-primary/30" : ""}`}>
                    <button
                      className="w-full flex items-center justify-between p-4 text-left"
                      onClick={() => toggleQuestion(key)}
                      data-testid={`faq-question-${key}`}
                    >
                      <span className="text-[13px] font-bold pr-4">{q.q}</span>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 shrink-0 text-primary" />
                      ) : (
                        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-border pt-3">
                        <p className="text-[12px] text-muted-foreground leading-relaxed">{q.a}</p>
                      </div>
                    )}
                  </Card>
                );
              })
            )}
            {filteredFaqs.every((cat) => cat.questions.length === 0) && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-semibold">Nenhuma pergunta encontrada</p>
                <p className="text-xs mt-1">Tente outras palavras ou fale conosco pelo WhatsApp</p>
              </div>
            )}
          </div>

          {/* CTA footer */}
          <Card className="mt-5 p-4 border-dashed" data-testid="card-nao-encontrou">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#25D36615" }}>
                <SiWhatsapp className="w-5 h-5" style={{ color: "#25D366" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold mb-0.5">Não encontrou o que precisava?</div>
                <p className="text-[11px] text-muted-foreground">Nossa equipe está pronta pra te ajudar — resposta rápida!</p>
              </div>
              <Button
                onClick={() => openWhatsApp("Olá! Preciso de ajuda com o Norte Gestão CRM.")}
                className="shrink-0 text-white text-xs font-bold"
                style={{ background: "#25D366" }}
                data-testid="button-faq-whatsapp"
              >
                <SiWhatsapp className="w-3.5 h-3.5 mr-1.5" />
                Falar no WhatsApp
              </Button>
            </div>
          </Card>
        </div>

        {/* Aviso de segurança */}
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-[12px] font-bold text-amber-600 dark:text-amber-400 mb-0.5">Nunca compartilhe suas credenciais</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Nossa equipe de suporte nunca solicitará sua senha, tokens de integração ou chaves de acesso. Em caso de dúvida, entre em contato apenas pelos canais oficiais acima.
              </p>
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}
