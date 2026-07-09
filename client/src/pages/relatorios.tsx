// Página de Relatórios do ChatBanana CRM.
// Bruno 2026-06-02: 1ª entrega — aba Dashboard (reusa /api/relatorios/stats/*)
// + aba Atendimentos → Visão Geral (base = protocolos, igual à tela de
// protocolos, enriquecida com canal/departamento). O menu de 3 pontinhos de
// cada linha abre o painel lateral do atendimento (igual ao print de
// referência) com botão "Ver Atendimento" que abre a conversa no chat.
// Demais abas/sub-abas ficam como "em breve" — implementadas conforme as
// regras forem definidas.

import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense, createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ContactAvatar from "@/components/ContactAvatar";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ComposedChart, BarChart, AreaChart } from "@/components/charts";
import { getSituationLabel, getSituationTagColor, SITUATION_LABELS } from "@/lib/situation-tags";
import { SiWhatsapp, SiInstagram } from "react-icons/si";
import {
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  CheckSquare,
  Bot,
  MessageCircle,
  Inbox as InboxIcon,
  UserX,
  Bookmark,
  Share2,
  TrendingUp,
  ExternalLink,
  Phone,
  Headset,
  Clock,
  Star,
  Users,
  AlertTriangle,
  Radio,
  ArrowLeftRight,
  ShieldCheck,
  Globe,
  LogIn,
  RefreshCw,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

type Periodo = "hoje" | "7d" | "30d" | "90d" | "custom";

function rangeFromPeriodo(p: Periodo): { inicio: Date; fim: Date } {
  const fim = new Date();
  const inicio = new Date();
  if (p === "hoje") {
    inicio.setHours(0, 0, 0, 0);
  } else if (p === "7d") {
    inicio.setDate(inicio.getDate() - 6);
  } else if (p === "30d") {
    inicio.setDate(inicio.getDate() - 29);
  } else if (p === "90d") {
    inicio.setDate(inicio.getDate() - 89);
  } else {
    // custom: fallback (o range real vem do estado customRange no top-level)
    inicio.setDate(inicio.getDate() - 6);
  }
  return { inicio, fim };
}

// Converte "YYYY-MM-DD" (input type=date) → Date local (meia-noite).
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Context só pro filtro PERSONALIZADO — evita prop-drilling do customRange por
// todas as abas. O `range`/`rangeQS` continuam fluindo por props normalmente.
const PeriodoFilterContext = createContext<{
  customRange: { inicio: Date; fim: Date };
  setCustomRange: (inicio: Date, fim: Date) => void;
} | null>(null);

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDateBR(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin ? `${h}h ${restMin}min` : `${h}h`;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  encerrado: { label: "encerrado", cls: "bg-success/15 text-success border-success/30" },
  aberto: { label: "aberto", cls: "bg-info/15 text-info border-info/30" },
  em_andamento: { label: "em andamento", cls: "bg-warning/15 text-warning border-warning/30" },
  aguardando: { label: "aguardando", cls: "bg-base-300/50 text-base-content/60 border-base-300" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, cls: "bg-base-300/50 text-base-content/60 border-base-300" };
  return (
    <Badge variant="outline" className={`text-[11px] font-medium px-2 py-0.5 ${meta.cls}`}>
      {meta.label}
    </Badge>
  );
}

// Drawer que embute a Inbox (somente a conversa do protocolo) sem sair da
// página de Relatórios — reusa o mesmo componente da Central de Atendimentos.
// Lazy pra não puxar o bundle pesado da Inbox no load da página: só carrega
// quando o usuário clica em "Ver Atendimento".
const ConversaDrawer = lazy(() =>
  import("@/components/central/ConversaDrawer").then((m) => ({ default: m.ConversaDrawer }))
);

// Dashboard (métricas ISP) e Auditoria (trace do agente) saíram com o módulo ISP.
// Mantidos como placeholders pra preservar a estrutura de abas dos Relatórios.
const ISPMetrics = (_props: any) => (
  <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Indisponível.</div>
);
const AuditoriaPage = (_props: any) => (
  <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Indisponível.</div>
);

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

interface AtendimentoItem {
  id: string;
  numero: string;
  titulo: string;
  categoria: string;
  status: string;
  statusRaw: string;
  origem: "atendente" | "automacao";
  agenteNome: string | null;
  csatNota: number | null;
  conversationId: number | null;
  nome: string;
  telefone: string | null;
  avatar: string | null;
  canal: string;
  departamento: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface AtendimentoDetalhe extends AtendimentoItem {
  titularNome: string | null;
  inicio: string;
  fim: string | null;
  duracaoSegundos: number | null;
  tmeSegundos: number | null;
  tempoBotSeconds: number | null;
  tempoHumanoSeconds: number | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Tabs (topo) e sub-nav (Atendimentos)
// ──────────────────────────────────────────────────────────────────────────

const TOP_TABS = [
  { key: "dashboard", label: "Dashboard", enabled: true },
  { key: "atendimentos", label: "Atendimentos", enabled: true },
  { key: "atendentes", label: "Atendentes", enabled: true },
  { key: "canais", label: "Canais", enabled: true },
  { key: "clientes", label: "Clientes", enabled: true },
  { key: "auditoria", label: "Auditoria", enabled: true },
  { key: "csat", label: "Pesquisa de Satisfação", enabled: true },
];

const SUB_NAV = [
  { key: "visao-geral", label: "Visão Geral", icon: BarChart3, enabled: true },
  { key: "encerrados", label: "Encerrados", icon: CheckSquare, enabled: true },
  { key: "automacao", label: "Automação", icon: Bot, enabled: true },
  { key: "em-andamento", label: "Em Andamento", icon: MessageCircle, enabled: true },
  { key: "em-espera", label: "Em espera", icon: InboxIcon, enabled: true },
  { key: "nao-atribuidos", label: "Não Atribuídos", icon: UserX, enabled: true },
  { key: "classificacao", label: "Classificação de atendimento", icon: Bookmark, enabled: true },
  { key: "escalacoes", label: "Escalações", icon: ArrowLeftRight, enabled: true },
  { key: "departamentos", label: "Departamentos", icon: Share2, enabled: true },
  { key: "total-mensal", label: "Total mensal", icon: TrendingUp, enabled: true },
];

// Metadados didáticos de cada estado (bucket) — alimentam o cabeçalho, os KPIs
// e o gráfico de cada relatório. Espelham o classifyConv do painel/inbox.
type KpiDef = { label: string; campo: "total" | "mediaSeg" | "maxSeg" | "semHumanoPct" | "atendentesAtivos" | "automacaoTempoPct" | "assistidaPct"; fmt: "num" | "dur" | "pct"; hint?: string };
const BUCKET_META: Record<string, {
  label: string;
  icon: any;
  cor: string;
  descricao: string;
  kpis: KpiDef[];
  serieTitulo: string;
  serieCor: string;
  ordemUrgente?: boolean;   // lista do mais antigo p/ o mais novo (fila)
  tempoLabel: string;       // rótulo da coluna de tempo na lista
}> = {
  encerrados: {
    label: "Atendimentos encerrados",
    icon: CheckSquare,
    cor: "#10b981",
    descricao: "Conversas resolvidas e fechadas no período. Mostra o valor real do agente: contenção (resolveu sozinho), automação de tempo e quanto ele já adianta nas escalações.",
    kpis: [
      { label: "Encerrados", campo: "total", fmt: "num" },
      { label: "Contenção", campo: "semHumanoPct", fmt: "pct", hint: "resolvido 100% pelo agente, sem humano" },
      { label: "Automação de tempo", campo: "automacaoTempoPct", fmt: "pct", hint: "do tempo de atendimento conduzido pelo agente" },
      { label: "Assistida", campo: "assistidaPct", fmt: "pct", hint: "escalações onde o agente já atuou antes" },
    ],
    serieTitulo: "Encerrados por dia",
    serieCor: "#10b981",
    tempoLabel: "Duração",
  },
  automacao: {
    label: "Em automação",
    icon: Bot,
    cor: "#FAC209",
    descricao: "Conversas que o bot está conduzindo sozinho — ainda não precisaram de atendente humano. É a contenção da automação.",
    kpis: [
      { label: "Em automação", campo: "total", fmt: "num" },
      { label: "Tempo médio no bot", campo: "mediaSeg", fmt: "dur", hint: "desde o início da conversa" },
      { label: "Mais antiga", campo: "maxSeg", fmt: "dur", hint: "ativa há mais tempo" },
    ],
    serieTitulo: "Em automação por canal",
    serieCor: "#FAC209",
    tempoLabel: "No bot há",
  },
  "em-andamento": {
    label: "Em andamento",
    icon: MessageCircle,
    cor: "#6366f1",
    descricao: "Conversas com um atendente humano atribuído e atuando. Mede a carga atual da equipe.",
    kpis: [
      { label: "Em andamento", campo: "total", fmt: "num" },
      { label: "Atendentes ativos", campo: "atendentesAtivos", fmt: "num", hint: "com conversa atribuída" },
      { label: "Tempo médio aberto", campo: "mediaSeg", fmt: "dur" },
    ],
    serieTitulo: "Carga por atendente",
    serieCor: "#6366f1",
    tempoLabel: "Aberto há",
  },
  "em-espera": {
    label: "Em espera (fila)",
    icon: InboxIcon,
    cor: "#f59e0b",
    descricao: "Conversas escaladas para humano, na fila de um setor, aguardando alguém da equipe assumir. Foco em tempo de espera / SLA.",
    kpis: [
      { label: "Na fila", campo: "total", fmt: "num" },
      { label: "Espera média", campo: "mediaSeg", fmt: "dur" },
      { label: "Mais antiga", campo: "maxSeg", fmt: "dur", hint: "aguardando há mais tempo" },
    ],
    serieTitulo: "Fila por departamento",
    serieCor: "#f59e0b",
    ordemUrgente: true,
    tempoLabel: "Aguardando há",
  },
  "nao-atribuidos": {
    label: "Não atribuídos",
    icon: UserX,
    cor: "#ef4444",
    descricao: "Escaladas para humano mas sem setor e sem atendente — ninguém é responsável. É o maior risco de conversa ficar sem resposta.",
    kpis: [
      { label: "Sem dono", campo: "total", fmt: "num" },
      { label: "Espera média", campo: "mediaSeg", fmt: "dur" },
      { label: "Mais antiga", campo: "maxSeg", fmt: "dur", hint: "órfã há mais tempo" },
    ],
    serieTitulo: "Não atribuídos por canal",
    serieCor: "#ef4444",
    ordemUrgente: true,
    tempoLabel: "Sem resposta há",
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Página
// ──────────────────────────────────────────────────────────────────────────

export default function Relatorios() {
  // Aceita deep-link `?tab=dashboard|atendimentos` (usado pelos redirects de
  // /central e do link do Suporte). Cai em "atendimentos" se o tab não existir
  // ou estiver desabilitado (ex: `?tab=protocolos` legado, módulo removido).
  const [topTab, setTopTab] = useState<string>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return TOP_TABS.some((x) => x.key === t && x.enabled) ? t! : "atendimentos";
  });
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const [customRange, setCustomRangeState] = useState<{ inicio: Date; fim: Date }>(() => rangeFromPeriodo("7d"));
  const setCustomRange = useCallback((inicio: Date, fim: Date) => {
    // Review: se o usuário inverte (final < inicial), troca em vez de virar
    // intervalo vazio silencioso.
    const [a, b] = inicio.getTime() <= fim.getTime() ? [inicio, fim] : [fim, inicio];
    setCustomRangeState({ inicio: a, fim: b });
    setPeriodo("custom");
  }, []);

  const range = useMemo(
    () => (periodo === "custom" ? customRange : rangeFromPeriodo(periodo)),
    [periodo, customRange]
  );
  const rangeQS = useMemo(
    () => `dataInicio=${toISODate(range.inicio)}&dataFim=${toISODate(range.fim)}`,
    [range]
  );

  // Gaveta da conversa embutida — compartilhada pelas abas Atendimentos e
  // Protocolos (abre o chat sem sair da página de Relatórios).
  const [drawerConvId, setDrawerConvId] = useState<number | null>(null);
  const [mountDrawer, setMountDrawer] = useState(false);
  const openConversaDrawer = useCallback((convId: number) => {
    setMountDrawer(true);
    setDrawerConvId(convId);
  }, []);

  // Mantém abas pesadas (Protocolos/Dashboard) montadas depois da 1ª visita
  // pra troca de aba ficar instantânea — sem remontar nem refazer o fetch.
  const [visited, setVisited] = useState<Record<string, boolean>>({ [topTab]: true });
  useEffect(() => {
    setVisited((v) => (v[topTab] ? v : { ...v, [topTab]: true }));
  }, [topTab]);

  return (
    <TooltipProvider delayDuration={200}>
     <PeriodoFilterContext.Provider value={{ customRange, setCustomRange }}>
      {/* Bruno 2026-06-12: select-none na tela INTEIRA de relatórios — os itens de
          menu/nav são <div onClick> selecionáveis e o clique deixava um caret de
          texto piscando no meio das letras ("Não Atrib|uídos"). Navegação não
          precisa ser selecionável; inputs (busca) seguem editáveis normalmente. */}
      <div className="h-full flex flex-col overflow-hidden bg-background select-none">
        {/* Cabeçalho + tabs (fixos no topo) */}
        <div className="shrink-0 w-full max-w-[1280px] mx-auto px-4 md:px-6 pt-6">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Relatórios</h1>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {TOP_TABS.map((t) => {
              const active = topTab === t.key;
              const btn = (
                <button
                  key={t.key}
                  disabled={!t.enabled}
                  onClick={() => t.enabled && setTopTab(t.key)}
                  className={`seg-tab ${active ? "seg-tab-active" : ""} ${t.enabled ? "" : "opacity-40 cursor-not-allowed"}`}
                >
                  {t.label}
                </button>
              );
              return t.enabled ? btn : (
                <Tooltip key={t.key}>
                  <TooltipTrigger asChild><span>{btn}</span></TooltipTrigger>
                  <TooltipContent>Em breve</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Conteúdo (rola). Abas visitadas ficam montadas e são só escondidas
            (display:none) quando inativas — troca instantânea sem refetch. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {visited.dashboard && (
            <div className={topTab === "dashboard" ? "w-full max-w-[1280px] mx-auto px-4 md:px-6 py-6" : "hidden"}>
              <Suspense fallback={
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando métricas…
                </div>
              }>
                <DashboardTab periodo={periodo} setPeriodo={setPeriodo} range={range} />
              </Suspense>
            </div>
          )}
          {visited.atendimentos && (
            <div className={topTab === "atendimentos" ? "w-full max-w-[1280px] mx-auto px-4 md:px-6 py-6" : "hidden"}>
              <AtendimentosTab rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onOpenConversa={openConversaDrawer} />
            </div>
          )}
          {visited.atendentes && (
            <div className={topTab === "atendentes" ? "w-full max-w-[1280px] mx-auto px-4 md:px-6 py-6" : "hidden"}>
              <AtendentesTab rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onOpenConversa={openConversaDrawer} />
            </div>
          )}
          {visited.canais && (
            <div className={topTab === "canais" ? "w-full max-w-[1280px] mx-auto px-4 md:px-6 py-6" : "hidden"}>
              <CanaisTab rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} />
            </div>
          )}
          {visited.clientes && (
            <div className={topTab === "clientes" ? "w-full max-w-[1280px] mx-auto px-4 md:px-6 py-6" : "hidden"}>
              <ClientesTab rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onOpenConversa={openConversaDrawer} />
            </div>
          )}
          {visited.auditoria && (
            <div className={topTab === "auditoria" ? "h-full" : "hidden"}>
              <Suspense fallback={
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando auditoria…
                </div>
              }>
                <AuditoriaPage />
              </Suspense>
            </div>
          )}
          {visited.csat && (
            <div className={topTab === "csat" ? "w-full max-w-[1280px] mx-auto px-4 md:px-6 py-6" : "hidden"}>
              <SatisfacaoTab rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onOpenConversa={openConversaDrawer} />
            </div>
          )}
        </div>
      </div>

      {/* Gaveta da conversa (lazy) — abre o chat embutido sem sair de Relatórios */}
      {mountDrawer && (
        <Suspense fallback={null}>
          {/* Relatórios = preview de análise → somente-leitura (Bruno 2026-06-05). */}
          <ConversaDrawer convId={drawerConvId} onClose={() => setDrawerConvId(null)} readOnly />
        </Suspense>
      )}
     </PeriodoFilterContext.Provider>
    </TooltipProvider>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Toolbar de período (compartilhada)
// ──────────────────────────────────────────────────────────────────────────

function PeriodoSelect({ periodo, setPeriodo, range }: {
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
}) {
  const ctx = useContext(PeriodoFilterContext);
  const hoje = toISODate(new Date());
  const onChange = (v: string) => {
    // "Personalizado" inicializa o intervalo com o range atual e ativa custom.
    if (v === "custom") ctx?.setCustomRange(range.inicio, range.fim);
    else setPeriodo(v as Periodo);
  };
  const dateCls = "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select value={periodo} onValueChange={onChange}>
        <SelectTrigger className="w-[160px] h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hoje">Hoje</SelectItem>
          <SelectItem value="7d">Últimos 7 dias</SelectItem>
          <SelectItem value="30d">Últimos 30 dias</SelectItem>
          <SelectItem value="90d">Últimos 90 dias</SelectItem>
          <SelectItem value="custom">Personalizado…</SelectItem>
        </SelectContent>
      </Select>
      {periodo === "custom" && ctx ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={toISODate(ctx.customRange.inicio)}
            max={toISODate(ctx.customRange.fim)}
            onChange={(e) => e.target.value && ctx.setCustomRange(parseLocalDate(e.target.value), ctx.customRange.fim)}
            className={dateCls}
            aria-label="Data inicial"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={toISODate(ctx.customRange.fim)}
            min={toISODate(ctx.customRange.inicio)}
            max={hoje}
            onChange={(e) => e.target.value && ctx.setCustomRange(ctx.customRange.inicio, parseLocalDate(e.target.value))}
            className={dateCls}
            aria-label="Data final"
          />
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          de {fmtDateBR(range.inicio)} até {fmtDateBR(range.fim)}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aba ATENDIMENTOS → Visão Geral
// ──────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function AtendimentosTab({ rangeQS, periodo, setPeriodo, range, onOpenConversa }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onOpenConversa: (convId: number) => void;
}) {
  const [subTab, setSubTab] = useState("visao-geral");
  const [inputBusca, setInputBusca] = useState("");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AtendimentoItem | null>(null);

  function verAtendimento(convId: number) {
    setSelected(null);        // fecha o painel lateral antes de abrir a gaveta
    onOpenConversa(convId);
  }

  // Contagens por estado pra mostrar nos badges da sub-nav (espelha o painel).
  const { data: contagens } = useQuery<Record<string, number>>({
    queryKey: ["/api/relatorios/conversas/contagens", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/conversas/contagens?${rangeQS}`),
  });

  const offset = page * PAGE_SIZE;
  const listaQS = `${rangeQS}&limite=${PAGE_SIZE}&offset=${offset}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;

  const { data: lista, isLoading: loadingLista } = useQuery<{ items: AtendimentoItem[]; total: number }>({
    queryKey: ["/api/relatorios/atendimentos", listaQS],
    queryFn: () => apiFetch(`/api/relatorios/atendimentos?${listaQS}`),
  });

  const { data: horarios, isLoading: loadingHorarios } = useQuery<{ horas: any[]; dias: number }>({
    queryKey: ["/api/relatorios/atendimentos/horarios", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/atendimentos/horarios?${rangeQS}`),
  });

  function aplicarBusca() {
    setPage(0);
    setBusca(inputBusca.trim());
  }

  const total = lista?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = lista?.items ?? [];

  const horas = horarios?.horas ?? [];
  const categories = horas.map((h) => h.label);

  return (
    <div className="flex gap-6">
      {/* Sub-nav vertical */}
      <aside className="w-56 shrink-0 hidden md:block">
        <nav className="space-y-1">
          {SUB_NAV.map((s) => {
            const Icon = s.icon;
            const active = subTab === s.key;
            const cnt = contagens?.[s.key];
            const inner = (
              <div
                onClick={() => s.enabled && setSubTab(s.key)}
                className={[
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground",
                  s.enabled ? "hover:bg-muted cursor-pointer" : "opacity-40 cursor-not-allowed",
                ].join(" ")}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate flex-1">{s.label}</span>
                {s.enabled && cnt != null && cnt > 0 && (
                  <span className={[
                    "shrink-0 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  ].join(" ")}>
                    {cnt}
                  </span>
                )}
              </div>
            );
            return s.enabled ? (
              <div key={s.key}>{inner}</div>
            ) : (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild><div>{inner}</div></TooltipTrigger>
                <TooltipContent side="right">Em breve</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        {subTab === "classificacao" ? (
          <ClassificacaoTab periodo={periodo} setPeriodo={setPeriodo} range={range} rangeQS={rangeQS} />
        ) : subTab === "departamentos" ? (
          <DepartamentosTab periodo={periodo} setPeriodo={setPeriodo} range={range} rangeQS={rangeQS} />
        ) : subTab === "escalacoes" ? (
          <EscalacoesTab periodo={periodo} setPeriodo={setPeriodo} range={range} rangeQS={rangeQS} onOpenConversa={onOpenConversa} />
        ) : subTab === "total-mensal" ? (
          <TotalMensalTab />
        ) : subTab !== "visao-geral" ? (
          <ConversasBucketTab
            bucket={subTab}
            periodo={periodo}
            setPeriodo={setPeriodo}
            range={range}
            rangeQS={rangeQS}
            onOpenConversa={onOpenConversa}
          />
        ) : (
        <Card className="p-5">
          <h2 className="text-xl font-semibold text-foreground mb-4">Relatório de atendimentos</h2>

          {/* Busca + período */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Input
                value={inputBusca}
                onChange={(e) => setInputBusca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aplicarBusca()}
                placeholder="Nome do cliente, protocolo ou número"
                className="max-w-sm h-9"
              />
              <Button onClick={aplicarBusca} className="h-9 gap-1.5">
                <Search className="w-4 h-4" /> Pesquisar
              </Button>
            </div>
            <PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} />
          </div>

          {/* Gráfico de horários */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-foreground mb-2">Horário dos atendimentos iniciados</h3>
            {loadingHorarios ? (
              <div className="h-[260px] rounded-md bg-muted/30 animate-pulse" />
            ) : (
              <ComposedChart
                categories={categories}
                series={[
                  { name: "Total", data: horas.map((h) => h.total), type: "bar", color: "#2DD4BF" },
                  { name: "Atendidos por atendentes", data: horas.map((h) => h.atendentes), type: "line", color: "#A3E635" },
                  { name: "Média por dia", data: horas.map((h) => h.mediaPorDia), type: "line", color: "#60A5FA" },
                ]}
                height={260}
              />
            )}
          </div>

          {/* Lista de atendimentos */}
          {loadingLista ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando atendimentos…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nenhum atendimento no período.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((it) => (
                <AtendimentoRow key={it.id} item={it} onOpen={() => setSelected(it)} />
              ))}
            </div>
          )}

          {/* Paginação */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
        )}
      </div>

      {/* Painel lateral do atendimento (só na Visão Geral) */}
      {subTab === "visao-geral" && (
        <AtendimentoSheet item={selected} onClose={() => setSelected(null)} onVerAtendimento={verAtendimento} />
      )}
    </div>
  );
}

function AtendimentoRow({ item, onOpen }: { item: AtendimentoItem; onOpen: () => void }) {
  const quando = item.resolvedAt || item.createdAt;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 py-3 px-2 text-left cursor-pointer hover:bg-primary/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <ContactAvatar nome={item.nome} fotoUrl={item.avatar} size={40} rounded="50%" />

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-primary truncate block max-w-full">
          {item.nome}
        </span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          <SiWhatsapp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate">{item.canal}{item.telefone ? ` - ${item.telefone}` : ""}</span>
        </div>
      </div>

      <div className="hidden sm:flex flex-col items-end gap-1 text-right shrink-0">
        <StatusBadge status={item.status} />
        <span className="text-xs text-muted-foreground">{fmtDateTime(quando)}</span>
        <span className="text-[11px] text-muted-foreground/80 font-mono">{item.numero}</span>
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aba ATENDIMENTOS → relatório por ESTADO da conversa (Encerrados, Automação,
// Em Andamento, Em espera, Não Atribuídos). Base = conversations, espelha as
// colunas da Central de Atendimentos. Cabeçalho didático + 3 KPIs + gráfico +
// lista clicável (abre o chat embutido).
// ──────────────────────────────────────────────────────────────────────────

interface BucketResumo {
  total: number;
  mediaSeg: number | null;
  maxSeg: number | null;
  semHumanoPct: number;
  atendentesAtivos: number;
  automacaoTempoPct: number | null;
  assistidaPct: number | null;
}
interface BucketItem {
  id: number;
  conversationId: number;
  nome: string;
  telefone: string | null;
  avatar: string | null;
  canal: string;
  departamento: string;
  atendente: string | null;
  origem: "atendente" | "automacao";
  isSimulation: boolean;
  createdAt: string;
  tempoSeg: number | null;
  tags?: string[];
}
interface BucketResp {
  bucket: string;
  resumo: BucketResumo;
  serie: { label: string; total: number }[];
  serieTipo: string;
  lista: { items: BucketItem[]; total: number };
}

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16"];

function kpiValor(resumo: BucketResumo, k: KpiDef): string {
  const v = resumo[k.campo];
  if (v == null) return "—";
  if (k.fmt === "dur") return fmtDuration(typeof v === "number" ? v : null);
  if (k.fmt === "pct") return `${v}%`;
  return String(v);
}

function ConversasBucketTab({ bucket, periodo, setPeriodo, range, rangeQS, onOpenConversa }: {
  bucket: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  rangeQS: string;
  onOpenConversa: (convId: number) => void;
}) {
  const meta = BUCKET_META[bucket];
  const [inputBusca, setInputBusca] = useState("");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);

  // Reseta busca/página ao trocar de aba ou período.
  useEffect(() => { setPage(0); setBusca(""); setInputBusca(""); }, [bucket]);
  useEffect(() => { setPage(0); }, [rangeQS]);

  const offset = page * PAGE_SIZE;
  const qs = `bucket=${bucket}&${rangeQS}&limite=${PAGE_SIZE}&offset=${offset}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;
  const { data, isLoading } = useQuery<BucketResp>({
    queryKey: ["/api/relatorios/conversas", qs],
    queryFn: () => apiFetch(`/api/relatorios/conversas?${qs}`),
  });

  function aplicarBusca() { setPage(0); setBusca(inputBusca.trim()); }

  const resumo = data?.resumo;
  const serie = data?.serie ?? [];
  const items = data?.lista.items ?? [];
  const total = data?.lista.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!meta) return null;
  const Icon = meta.icon;
  const serieVertical = data?.serieTipo === "dia";
  const serieLabels = serie.map((s) => s.label);
  const serieData = serie.map((s) => s.total);

  return (
    <Card className="p-5">
      {/* Cabeçalho didático */}
      <div className="flex items-start gap-3 mb-4">
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground leading-tight">{meta.label}</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug max-w-2xl">{meta.descricao}</p>
        </div>
      </div>

      {/* Busca + período */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Input
            value={inputBusca}
            onChange={(e) => setInputBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && aplicarBusca()}
            placeholder="Nome do cliente ou número"
            className="max-w-sm h-9"
          />
          <Button onClick={aplicarBusca} className="h-9 gap-1.5">
            <Search className="w-4 h-4" /> Pesquisar
          </Button>
        </div>
        <PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} />
      </div>

      {/* KPIs */}
      <div className={`grid gap-3 mb-6 ${meta.kpis.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"}`}>
        {meta.kpis.map((k) => (
          <div key={k.label} className="rounded-box border border-base-200 bg-base-200/40 p-3">
            <p className="text-[11px] text-base-content/55 uppercase tracking-wide truncate">{k.label}</p>
            <p className="text-2xl font-semibold text-base-content mt-1 tabular-nums">
              {isLoading || !resumo ? "—" : kpiValor(resumo, k)}
            </p>
            {k.hint && <p className="text-[10.5px] text-base-content/45 mt-0.5 leading-tight">{k.hint}</p>}
          </div>
        ))}
      </div>

      {/* Gráfico */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-foreground mb-2">{meta.serieTitulo}</h3>
        {isLoading ? (
          <div className="h-[240px] rounded-md bg-muted/30 animate-pulse" />
        ) : serie.length === 0 ? (
          <div className="h-[120px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
            Sem dados no período.
          </div>
        ) : serieVertical ? (
          <BarChart
            categories={serieLabels}
            series={[{ name: meta.label, data: serieData, color: meta.serieCor }]}
            height={240}
            showLegend={false}
          />
        ) : (
          <BarChart
            categories={serieLabels}
            series={[{ name: "Conversas", data: serieData }]}
            colors={serieLabels.map((_, i) => PALETTE[i % PALETTE.length])}
            height={Math.max(160, serieLabels.length * 38)}
            horizontal
            showLegend={false}
          />
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando conversas…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhuma conversa neste estado no período.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((it) => (
            <BucketRow key={it.id} item={it} meta={meta} onOpen={() => onOpenConversa(it.conversationId)} />
          ))}
        </div>
      )}

      {/* Paginação */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function BucketRow({ item, meta, onOpen }: {
  item: BucketItem;
  meta: typeof BUCKET_META[string];
  onOpen: () => void;
}) {
  // Tempo em vermelho quando a fila/órfã está velha (> 30 min aguardando).
  const urgente = !!meta.ordemUrgente && (item.tempoSeg ?? 0) > 1800;
  // "Tag" da direita: atendente (em andamento) ou departamento; senão a origem.
  const tag = item.atendente || (item.departamento !== "—" ? item.departamento : null);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 py-3 px-2 text-left cursor-pointer hover:bg-primary/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <ContactAvatar nome={item.nome} fotoUrl={item.avatar} size={40} rounded="50%" />

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground truncate block">{item.nome}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          <SiWhatsapp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate">{item.canal}{item.telefone ? ` · ${item.telefone}` : ""}</span>
        </div>
      </div>

      <div className="hidden sm:flex flex-col items-end gap-1 text-right shrink-0">
        {item.tags && item.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap justify-end max-w-[240px]">
            {item.tags.slice(0, 4).map((code) => {
              const tc = getSituationTagColor(code);
              return (
                <span key={code} title={getSituationLabel(code)} className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ background: tc.bg, color: tc.color }}>
                  {code}
                </span>
              );
            })}
            {item.tags.length > 4 && <span className="text-[10px] text-muted-foreground">+{item.tags.length - 4}</span>}
          </div>
        )}
        {tag && (
          <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full max-w-[160px] truncate">
            {tag}
          </span>
        )}
        <span className={`flex items-center gap-1 text-xs tabular-nums ${urgente ? "text-rose-500 font-semibold" : "text-muted-foreground"}`}>
          {urgente && <AlertTriangle className="w-3 h-3" />}
          <Clock className="w-3 h-3" />
          {meta.tempoLabel} {fmtDuration(item.tempoSeg)}
        </span>
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Análises transversais: Classificação, Departamentos, Total mensal.
// Mesmo padrão visual (cabeçalho didático + KPIs + gráfico + tabela).
// ──────────────────────────────────────────────────────────────────────────

// Cores por setor — alinhadas ao SECTOR_COLORS de lib/situation-tags.ts.
const SETOR_COR: Record<string, string> = {
  "Financeiro": "#d97706",
  "Suporte Técnico": "#2563eb",
  "Comercial": "#059669",
  "Cancelamento": "#dc2626",
  "Reputação / NPS": "#7c3aed",
  "Atendimento / Auxiliar": "#475569",
  "Outros": "#64748b",
};
const corSetor = (s: string) => SETOR_COR[s] || "#64748b";

// Aba Dashboard = Métricas ISP, agora com o MESMO filtro de período das demais
// abas (PeriodoSelect: prontos + personalizado). O ISPMetrics entra embedded+bare
// (sem cabeçalho/selector próprios) e recebe o intervalo via externalFrom/To —
// todos os dados históricos da página passam a seguir esse filtro. Cards de
// "estado atual" (Equipes, em aberto) e de contexto (12 meses) ficam rotulados.
function DashboardTab({ periodo, setPeriodo, range }: {
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
}) {
  const refreshRef = useRef<((s?: boolean) => void) | null>(null);
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <RelHeader
          icon={BarChart3}
          cor="#8b5cf6"
          titulo="Métricas de atendimento"
          descricao="Desempenho dos agentes, situações, tempos e satisfação. O filtro abaixo recorta o período de TODA a página; cards marcados como 'estado atual' ou 'contexto' têm janela própria."
        />
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => refreshRef.current?.(true)}
            data-testid="dashboard-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Atualizar</span>
          </Button>
        </div>
      </Card>
      <ISPMetrics
        embedded
        embeddedBare
        externalFrom={toISODate(range.inicio)}
        externalTo={toISODate(range.fim)}
        onRefresh={(fn: any) => { refreshRef.current = fn; }}
      />
    </div>
  );
}

function RelHeader({ icon: Icon, cor, titulo, descricao }: {
  icon: any; cor: string; titulo: string; descricao: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-foreground leading-tight">{titulo}</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug max-w-2xl">{descricao}</p>
      </div>
    </div>
  );
}

function KpiBox({ label, value, hint, cor }: {
  label: string; value: string | number; hint?: string; cor?: string;
}) {
  return (
    <div className="rounded-box border border-base-200 bg-base-200/40 p-3">
      <p className="text-[11px] text-base-content/55 uppercase tracking-wide truncate">{label}</p>
      <p className="text-2xl font-semibold text-base-content mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[10.5px] text-base-content/45 mt-0.5 leading-tight truncate">{hint}</p>}
    </div>
  );
}

interface ClassifResp {
  totalTags: number;
  totalConversas: number;
  distribuicao: { code: string; setor: string; total: number }[];
  porSetor: { setor: string; total: number }[];
}

// Setor a partir do código da situação — MESMA lógica do setorCaseSql do
// backend (CANCEL_* é Cancelamento, não Comercial; AH/FAQ/QR/SPAM = Auxiliar).
function setorDoCodigo(code: string): string {
  const c = (code || "").toUpperCase();
  if (c.startsWith("CANCEL")) return "Cancelamento";
  if (["AH", "FAQ", "QR", "GERAL", "SPAM"].includes(c)) return "Atendimento / Auxiliar";
  switch (c.charAt(0)) {
    case "F": return "Financeiro";
    case "S": return "Suporte Técnico";
    case "C": return "Comercial";
    case "K": return "Cancelamento";
    case "N": return "Reputação / NPS";
    default: return "Outros";
  }
}

// Catálogo de TODAS as situações conhecidas (lib/situation-tags) agrupado por
// setor — usado pra listar todas as situações existentes de cada setor, mesmo
// as que não ocorreram no período.
const CATALOGO_POR_SETOR: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const code of Object.keys(SITUATION_LABELS)) {
    const s = setorDoCodigo(code);
    (m[s] ||= []).push(code);
  }
  return m;
})();

// Ordem fixa dos setores: os 3 de negócio primeiro, "Atendimento / Auxiliar"
// sempre por último (Bruno 2026-06-03).
const ORDEM_SETORES = ["Financeiro", "Suporte Técnico", "Comercial", "Cancelamento", "Reputação / NPS", "Outros", "Atendimento / Auxiliar"];

function ClassificacaoTab({ periodo, setPeriodo, range, rangeQS }: {
  periodo: Periodo; setPeriodo: (p: Periodo) => void; range: { inicio: Date; fim: Date }; rangeQS: string;
}) {
  const { data, isLoading } = useQuery<ClassifResp>({
    queryKey: ["/api/relatorios/classificacao", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/classificacao?${rangeQS}`),
  });
  const dist = data?.distribuicao ?? [];
  const porSetor = data?.porSetor ?? [];
  const topSit = dist[0];

  // Agrupa por setor: cada setor lista TODAS as situações do catálogo +
  // as que ocorreram (fora do catálogo, ex: F0), com a contagem do período.
  const setores = useMemo(() => {
    const totalPorCode = new Map<string, number>();
    for (const d of dist) totalPorCode.set(d.code, d.total);
    const convPorSetor = new Map<string, number>();
    for (const s of porSetor) convPorSetor.set(s.setor, s.total);

    return ORDEM_SETORES.map((setor) => {
      const doCatalogo = CATALOGO_POR_SETOR[setor] || [];
      const ocorridos = dist.filter((d) => d.setor === setor).map((d) => d.code);
      const codes = Array.from(new Set([...doCatalogo, ...ocorridos]));
      const situacoes = codes
        .map((code) => ({ code, total: totalPorCode.get(code) || 0 }))
        .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code, undefined, { numeric: true }));
      const totalConv = convPorSetor.get(setor) || 0;
      const ocorridas = situacoes.filter((s) => s.total > 0).length;
      const maxNoSetor = Math.max(1, ...situacoes.map((s) => s.total));
      return { setor, situacoes, totalConv, ocorridas, maxNoSetor };
    }).filter((s) => s.situacoes.length > 0);
  }, [dist, porSetor]);

  const maxSetorConv = Math.max(1, ...setores.map((s) => s.totalConv));

  // Abre por padrão o 1º setor com ocorrências; usuário controla daí em diante.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const inicializou = useRef(false);
  useEffect(() => {
    if (inicializou.current || setores.length === 0) return;
    const primeiro = setores.find((s) => s.totalConv > 0);
    if (primeiro) { setAbertos(new Set([primeiro.setor])); inicializou.current = true; }
  }, [setores]);

  function toggle(setor: string) {
    setAbertos((prev) => {
      const n = new Set(prev);
      n.has(setor) ? n.delete(setor) : n.add(setor);
      return n;
    });
  }

  return (
    <Card className="p-5">
      <RelHeader
        icon={Bookmark}
        cor="#8b5cf6"
        titulo="Classificação de atendimento"
        descricao="Situações identificadas pelo agente, agrupadas por setor. Clique em um setor para abrir e ver todas as situações existentes — com quantas vezes cada uma ocorreu no período."
      />
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiBox label="Conversas classificadas" value={isLoading ? "—" : data?.totalConversas ?? 0} cor="#8b5cf6" />
        <KpiBox label="Situações distintas" value={isLoading ? "—" : dist.length} />
        <KpiBox label="Mais comum" value={isLoading || !topSit ? "—" : topSit.code} hint={topSit ? getSituationLabel(topSit.code) : undefined} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />)}
        </div>
      ) : setores.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhuma situação classificada no período.</div>
      ) : (
        <div className="space-y-2">
          {setores.map((s) => {
            const cor = corSetor(s.setor);
            const aberto = abertos.has(s.setor);
            const vazio = s.totalConv === 0;
            return (
              <div key={s.setor} className="rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(s.setor)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${vazio ? "opacity-50" : ""}`}
                  style={{ background: aberto ? cor + "0c" : undefined }}
                >
                  <ChevronRight className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-90" : ""}`} />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cor }} />
                  <span className="text-sm font-semibold flex-1 truncate" style={{ color: cor }}>{s.setor}</span>
                  <div className="hidden sm:block w-28 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                    <div className="h-full rounded-full" style={{ width: `${Math.round((s.totalConv / maxSetorConv) * 100)}%`, background: cor }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-[88px] text-right shrink-0">
                    <span className="font-semibold text-foreground">{s.totalConv}</span> conv · {s.ocorridas} sit.
                  </span>
                </button>
                {aberto && (
                  <div className="divide-y divide-border/40 border-t border-border bg-muted/10">
                    {s.situacoes.map((sit) => {
                      const tc = getSituationTagColor(sit.code);
                      const zero = sit.total === 0;
                      return (
                        <div key={sit.code} className={`flex items-center gap-2 px-3 py-1.5 ${zero ? "opacity-40" : ""}`}>
                          <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded shrink-0 w-12 text-center" style={{ background: tc.bg, color: tc.color }}>{sit.code}</span>
                          <span className="text-xs text-foreground truncate flex-1">{getSituationLabel(sit.code)}</span>
                          <div className="hidden sm:block w-24 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                            {!zero && <div className="h-full rounded-full" style={{ width: `${Math.round((sit.total / s.maxNoSetor) * 100)}%`, background: cor }} />}
                          </div>
                          <span className="text-xs font-semibold tabular-nums w-8 text-right shrink-0">{zero ? "—" : sit.total}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

interface DeptoResp {
  departamentos: { setor: string; total: number; resolvidos: number; emEspera: number; taxaResolucao: number }[];
  totalSetores: number;
  somaDemanda: number;
}

function DepartamentosTab({ periodo, setPeriodo, range, rangeQS }: {
  periodo: Periodo; setPeriodo: (p: Periodo) => void; range: { inicio: Date; fim: Date }; rangeQS: string;
}) {
  const { data, isLoading } = useQuery<DeptoResp>({
    queryKey: ["/api/relatorios/departamentos", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/departamentos?${rangeQS}`),
  });
  const deps = data?.departamentos ?? [];
  const topSetor = deps[0];
  const somaTotal = deps.reduce((a, d) => a + d.total, 0);
  const somaResolv = deps.reduce((a, d) => a + d.resolvidos, 0);
  const taxaGeral = somaTotal > 0 ? Math.round((somaResolv / somaTotal) * 100) : 0;

  return (
    <Card className="p-5">
      <RelHeader
        icon={Share2}
        cor="#0ea5e9"
        titulo="Departamentos"
        descricao="Demanda por setor (Suporte, Financeiro, Comercial, Cancelamento…), derivada das situações dos atendimentos. Uma conversa que toca mais de um setor conta em cada um."
      />
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiBox label="Setores com demanda" value={isLoading ? "—" : deps.length} cor="#0ea5e9" />
        <KpiBox label="Maior volume" value={isLoading || !topSetor ? "—" : topSetor.setor} hint={topSetor ? `${topSetor.total} conversas` : undefined} />
        <KpiBox label="Taxa de resolução" value={isLoading ? "—" : `${taxaGeral}%`} hint="resolvidas / total no período" />
      </div>

      <h3 className="text-sm font-medium text-foreground mb-2">Volume por setor</h3>
      {isLoading ? (
        <div className="h-[220px] rounded-md bg-muted/30 animate-pulse mb-6" />
      ) : deps.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md mb-6">
          Nenhuma demanda classificada no período.
        </div>
      ) : (
        <>
          <div className="mb-6">
            <BarChart
              categories={deps.map((d) => d.setor)}
              series={[{ name: "Conversas", data: deps.map((d) => d.total) }]}
              colors={deps.map((d) => corSetor(d.setor))}
              height={Math.max(160, deps.length * 40)}
              horizontal
              showLegend={false}
            />
          </div>

          <div className="space-y-0">
            <div className="flex items-center gap-3 pb-2 text-[11px] text-muted-foreground border-b border-border">
              <span className="flex-1">Setor</span>
              <span className="w-16 text-right">Conversas</span>
              <span className="w-14 text-right hidden sm:block">Em espera</span>
              <span className="w-40 text-right hidden sm:block">Resolução</span>
            </div>
            {deps.map((d) => (
              <div key={d.setor} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: corSetor(d.setor) }} />
                <span className="text-sm font-medium text-foreground flex-1 truncate">{d.setor}</span>
                <span className="text-sm tabular-nums w-16 text-right">{d.total}</span>
                <span className={`text-sm tabular-nums w-14 text-right hidden sm:block ${d.emEspera > 0 ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>{d.emEspera}</span>
                <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.taxaResolucao}%` }} />
                  </div>
                  <span className="text-xs font-semibold tabular-nums w-9 text-right">{d.taxaResolucao}%</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

interface MensalResp {
  meses: { mes: string; label: string; total: number; resolvidos: number; automacao: number; humano: number; taxaResolucao: number }[];
  resumo: { total: number; mediaMensal: number; melhorMesLabel: string; melhorMesTotal: number };
}

interface EscalacaoItem {
  id: number;
  conversationId: number;
  nome: string;
  telefone: string | null;
  avatar: string | null;
  canal: string;
  atendente: string | null;
  motivos: string[];
  tempoSeg: number | null;
}
interface EscalacoesResp {
  resumo: { totalEscaladas: number; totalEncerradas: number; taxaEscalacaoPct: number; topMotivo: string | null };
  porMotivo: { code: string; setor: string; total: number }[];
  porSetor: { setor: string; total: number }[];
  lista: { items: EscalacaoItem[]; total: number; limite: number; offset: number };
}

function EscalacoesTab({ periodo, setPeriodo, range, rangeQS, onOpenConversa }: {
  periodo: Periodo; setPeriodo: (p: Periodo) => void; range: { inicio: Date; fim: Date }; rangeQS: string;
  onOpenConversa: (convId: number) => void;
}) {
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;
  const qs = `${rangeQS}&limite=${PAGE_SIZE}&offset=${offset}`;
  const { data, isLoading } = useQuery<EscalacoesResp>({
    queryKey: ["/api/relatorios/escalacoes", qs],
    queryFn: () => apiFetch(`/api/relatorios/escalacoes?${qs}`),
  });
  const r = data?.resumo;
  const motivos = data?.porMotivo ?? [];
  const items = data?.lista.items ?? [];
  const total = data?.lista.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="p-5">
      <RelHeader
        icon={ArrowLeftRight}
        cor="#ef4444"
        titulo="Escalações"
        descricao="Por que o agente passou o atendimento pro humano. 'Escalada' = conversa encerrada que recebeu a tag AH. O motivo é a situação (assunto) que levou à escalação — mostra onde dá pra automatizar e subir a contenção."
      />
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiBox label="Escaladas" value={isLoading || !r ? "—" : r.totalEscaladas} cor="#ef4444" hint={r ? `de ${r.totalEncerradas} encerradas` : undefined} />
        <KpiBox label="Taxa de escalação" value={isLoading || !r ? "—" : `${r.taxaEscalacaoPct}%`} hint="passaram por atendente humano" />
        <KpiBox label="Motivo mais comum" value={isLoading || !r || !r.topMotivo ? "—" : r.topMotivo} hint={r?.topMotivo ? getSituationLabel(r.topMotivo) : undefined} />
      </div>

      <h3 className="text-sm font-medium text-foreground mb-2">Motivos de escalação</h3>
      {isLoading ? (
        <div className="h-[220px] rounded-md bg-muted/30 animate-pulse mb-6" />
      ) : motivos.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md mb-6">
          Nenhuma escalação no período. 🎉
        </div>
      ) : (
        <>
          <div className="mb-5">
            <BarChart
              categories={motivos.map((m) => m.code)}
              series={[{ name: "Escalações", data: motivos.map((m) => m.total) }]}
              colors={motivos.map((m) => getSituationTagColor(m.code).color)}
              height={Math.max(160, motivos.length * 34)}
              horizontal
              showLegend={false}
            />
          </div>
          <div className="space-y-0 mb-6">
            <div className="flex items-center gap-3 pb-2 text-[11px] text-muted-foreground border-b border-border">
              <span className="w-12">Cód.</span>
              <span className="flex-1">Motivo (situação)</span>
              <span className="w-36 text-right hidden sm:block">Setor</span>
              <span className="w-14 text-right">Conv.</span>
            </div>
            {motivos.map((m) => {
              const tc = getSituationTagColor(m.code);
              return (
                <div key={m.code} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                  <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded w-12 text-center shrink-0" style={{ background: tc.bg, color: tc.color }}>{m.code}</span>
                  <span className="text-sm text-foreground flex-1 truncate">{getSituationLabel(m.code)}</span>
                  <span className="text-xs text-muted-foreground w-36 text-right hidden sm:block truncate">{m.setor}</span>
                  <span className="text-sm font-semibold tabular-nums w-14 text-right">{m.total}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h3 className="text-sm font-medium text-foreground mb-2">Conversas escaladas</h3>
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Nenhuma conversa escalada no período.</div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onOpenConversa(it.conversationId)}
              className="w-full flex items-center gap-3 py-3 px-2 text-left cursor-pointer hover:bg-primary/[0.08] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ContactAvatar nome={it.nome} fotoUrl={it.avatar} size={40} rounded="50%" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground truncate block">{it.nome}</span>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                  <SiWhatsapp className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="truncate">{it.canal}{it.telefone ? ` · ${it.telefone}` : ""}</span>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-1 shrink-0">
                {it.motivos.slice(0, 3).map((code) => {
                  const tc = getSituationTagColor(code);
                  return <span key={code} className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: tc.bg, color: tc.color }}>{code}</span>;
                })}
                {it.atendente && <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full max-w-[120px] truncate ml-1">{it.atendente}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TotalMensalTab() {
  const { data, isLoading } = useQuery<MensalResp>({
    queryKey: ["/api/relatorios/mensal"],
    queryFn: () => apiFetch(`/api/relatorios/mensal`),
  });
  const meses = data?.meses ?? [];
  const resumo = data?.resumo;

  return (
    <Card className="p-5">
      <RelHeader
        icon={TrendingUp}
        cor="#E6B400"
        titulo="Total mensal"
        descricao="Volume de atendimentos mês a mês, com a divisão entre o que a automação conduziu e o que foi para atendentes. Tendência de longo prazo."
      />
      <p className="text-xs text-muted-foreground mb-5 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" /> Últimos 12 meses
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiBox label="Total (12 meses)" value={isLoading ? "—" : resumo?.total ?? 0} cor="#E6B400" />
        <KpiBox label="Média mensal" value={isLoading ? "—" : resumo?.mediaMensal ?? 0} />
        <KpiBox label="Melhor mês" value={isLoading ? "—" : resumo?.melhorMesLabel ?? "—"} hint={resumo ? `${resumo.melhorMesTotal} atendimentos` : undefined} />
      </div>

      <h3 className="text-sm font-medium text-foreground mb-2">Atendimentos por mês</h3>
      {isLoading ? (
        <div className="h-[260px] rounded-md bg-muted/30 animate-pulse mb-6" />
      ) : (
        <div className="mb-6">
          <ComposedChart
            categories={meses.map((m) => m.label)}
            series={[
              { name: "Total", data: meses.map((m) => m.total), type: "bar", color: "#2DD4BF" },
              { name: "Em automação", data: meses.map((m) => m.automacao), type: "line", color: "#FAC209" },
              { name: "Por atendente", data: meses.map((m) => m.humano), type: "line", color: "#6366f1" },
            ]}
            height={260}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-muted-foreground border-b border-border uppercase tracking-wide">
              <th className="text-left py-2 font-medium">Mês</th>
              <th className="text-right py-2 font-medium">Total</th>
              <th className="text-right py-2 font-medium hidden sm:table-cell">Automação</th>
              <th className="text-right py-2 font-medium hidden sm:table-cell">Atendente</th>
              <th className="text-right py-2 font-medium">Resolvidos</th>
              <th className="text-right py-2 font-medium">Taxa</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.mes} className="border-b border-border/50 last:border-0 hover:bg-base-200/40 transition-colors">
                <td className="py-2 font-medium text-foreground capitalize">{m.label}</td>
                <td className="text-right tabular-nums">{m.total}</td>
                <td className="text-right tabular-nums hidden sm:table-cell text-muted-foreground">{m.automacao}</td>
                <td className="text-right tabular-nums hidden sm:table-cell text-muted-foreground">{m.humano}</td>
                <td className="text-right tabular-nums">{m.resolvidos}</td>
                <td className="text-right tabular-nums font-semibold">{m.taxaResolucao}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Canais — volume de atendimentos por canal de origem (Meta Oficial / Web / Insta)
// ──────────────────────────────────────────────────────────────────────────

interface CanaisResp {
  canais: { tipo: string; label: string; total: number; cliente: number; empresa: number; pct: number }[];
  serie: Record<string, any>[];
  tipos: string[];
  labels: Record<string, string>;
  total: number;
  dias: number;
}

const CANAL_COR: Record<string, string> = {
  whatsapp_oficial: "#25D366",
  whatsapp_webjs: "#0ea5e9",
  instagram: "#E1306C",
};

function CanalTipoIcon({ tipo }: { tipo: string }) {
  if (tipo === "instagram") return <SiInstagram className="w-4 h-4" style={{ color: CANAL_COR.instagram }} />;
  return <SiWhatsapp className="w-4 h-4" style={{ color: tipo === "whatsapp_oficial" ? CANAL_COR.whatsapp_oficial : CANAL_COR.whatsapp_webjs }} />;
}

function CanaisTab({ rangeQS, periodo, setPeriodo, range }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
}) {
  const { data, isLoading } = useQuery<CanaisResp>({
    queryKey: ["/api/relatorios/canais", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/canais?${rangeQS}`),
  });
  const canais = data?.canais ?? [];
  const serie = data?.serie ?? [];
  const tipos = data?.tipos ?? [];
  const total = data?.total ?? 0;
  const topCanal = canais[0];

  const categories = serie.map((s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s.dia));
    return m ? `${m[3]}/${m[2]}` : String(s.dia);
  });
  const series = tipos.map((t) => ({
    name: data?.labels?.[t] ?? t,
    data: serie.map((s) => Number(s[t] ?? 0)),
    color: CANAL_COR[t] ?? "#94a3b8",
  }));

  return (
    <Card className="p-5">
      <RelHeader
        icon={Radio}
        cor="#25D366"
        titulo="Canais"
        descricao="Volume de atendimentos por canal de origem — WhatsApp API Oficial (Meta Cloud), WhatsApp Web e Instagram. Mostra a participação de cada canal, a tendência no período e se o atendimento foi iniciado pelo cliente ou pela empresa."
      />
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <KpiBox label="Atendimentos no período" value={isLoading ? "—" : total} cor="#25D366" />
        <KpiBox label="Canais ativos" value={isLoading ? "—" : canais.length} />
        <KpiBox label="Maior volume" value={isLoading || !topCanal ? "—" : topCanal.label} hint={topCanal ? `${topCanal.pct}% · ${topCanal.total} atendimentos` : undefined} />
      </div>

      <h3 className="text-sm font-medium text-foreground mb-2">Atendimentos por canal ao longo do tempo</h3>
      {isLoading ? (
        <div className="h-[280px] rounded-md bg-muted/30 animate-pulse mb-6" />
      ) : serie.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md mb-6">
          Nenhum atendimento no período.
        </div>
      ) : (
        <div className="mb-6">
          <AreaChart categories={categories} series={series} height={280} smooth />
        </div>
      )}

      <h3 className="text-sm font-medium text-foreground mb-2">Por canal</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-muted-foreground border-b border-border uppercase tracking-wide">
              <th className="text-left py-2 font-medium">Canal</th>
              <th className="text-center py-2 font-medium w-12">Tipo</th>
              <th className="text-right py-2 font-medium hidden sm:table-cell" title="Atendimentos iniciados pelo cliente">Cliente</th>
              <th className="text-right py-2 font-medium hidden sm:table-cell" title="Atendimentos iniciados pela empresa (disparo / template)">Empresa</th>
              <th className="text-right py-2 font-medium w-28">%</th>
              <th className="text-right py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {canais.length === 0 && !isLoading && (
              <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-[13px]">Nenhum atendimento no período.</td></tr>
            )}
            {canais.map((c) => (
              <tr key={c.tipo} className="border-b border-border/50 last:border-0 hover:bg-base-200/40 transition-colors">
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CANAL_COR[c.tipo] ?? "#94a3b8" }} />
                    <span className="font-medium text-foreground truncate">{c.label}</span>
                  </div>
                </td>
                <td className="py-2.5 text-center"><div className="flex justify-center"><CanalTipoIcon tipo={c.tipo} /></div></td>
                <td className="py-2.5 text-right tabular-nums hidden sm:table-cell">{c.cliente}</td>
                <td className="py-2.5 text-right tabular-nums hidden sm:table-cell text-muted-foreground">{c.empresa}</td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2 justify-end">
                    <div className="hidden md:block flex-1 max-w-[80px] h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: CANAL_COR[c.tipo] ?? "#94a3b8" }} />
                    </div>
                    <span className="text-xs font-semibold tabular-nums w-12 text-right">{c.pct}%</span>
                  </div>
                </td>
                <td className="py-2.5 text-right tabular-nums font-semibold">{c.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Painel lateral do atendimento (igual print de referência)
// ──────────────────────────────────────────────────────────────────────────

function AtendimentoSheet({ item, onClose, onVerAtendimento }: {
  item: AtendimentoItem | null;
  onClose: () => void;
  onVerAtendimento: (convId: number) => void;
}) {
  const open = !!item;
  const { data: det, isLoading } = useQuery<AtendimentoDetalhe>({
    queryKey: ["/api/relatorios/atendimentos/detalhe", item?.id],
    queryFn: () => apiFetch(`/api/relatorios/atendimentos/${item!.id}`),
    enabled: open && !!item?.id,
  });

  // Fallback pros dados básicos enquanto o detalhe carrega (usa a linha clicada).
  const d = det || (item ? { ...item, titularNome: null, inicio: item.createdAt, fim: item.resolvedAt, duracaoSegundos: null, tmeSegundos: null, tempoBotSeconds: null, tempoHumanoSeconds: null } as AtendimentoDetalhe : null);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto">
        {d && (
          <div className="flex flex-col">
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground tracking-wide">
                ATENDIMENTO #{d.numero?.slice(-8) || d.numero}
              </p>
            </div>

            {/* Avatar (redondo, igual ao do atendimento) */}
            <div className="flex justify-center pt-6 pb-2">
              <ContactAvatar nome={d.nome} fotoUrl={d.avatar} size={96} rounded="50%" />
            </div>

            {/* Identidade */}
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground leading-tight">{d.nome}</h2>
                <StatusBadge status={d.status} />
              </div>
              {d.telefone && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                  <Phone className="w-3.5 h-3.5" /> {d.telefone}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">Protocolo</p>
              <p className="text-sm font-mono text-foreground">{d.numero}</p>

              <Button
                className="w-full mt-4 gap-2"
                disabled={!d.conversationId}
                onClick={() => d.conversationId && onVerAtendimento(d.conversationId)}
              >
                <ExternalLink className="w-4 h-4" /> Ver Atendimento
              </Button>
              {!d.conversationId && (
                <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
                  Conversa não disponível para este protocolo.
                </p>
              )}
            </div>

            {/* Visão Geral */}
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Visão Geral</h3>
              {isLoading && !det ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-10 rounded bg-muted/40 animate-pulse" />)}
                </div>
              ) : (
                <dl className="space-y-3">
                  <Field icon={Headset} label="Canal de atendimentos" value={d.canal} accent />
                  <Field icon={Users} label="Departamento" value={d.departamento} />
                  <Field icon={Clock} label="Início do atendimento" value={fmtDateTime(d.inicio)} />
                  <Field icon={CheckSquare} label="Fim do atendimento" value={fmtDateTime(d.fim)} />
                  <Field icon={Clock} label="Duração do Atendimento" value={fmtDuration(d.duracaoSegundos)} />
                  <Field icon={Clock} label="TME (Tempo Médio de Espera)" value={fmtDuration(d.tmeSegundos)} />
                  {d.agenteNome && <Field icon={Headset} label="Atendente" value={d.agenteNome} />}
                  {d.csatNota != null && (
                    <Field icon={Star} label="CSAT" value={`${d.csatNota} / 5`} />
                  )}
                </dl>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ icon: Icon, label, value, accent }: {
  icon: any; label: string; value: string; accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground mb-0.5">{label}</dt>
      <dd className={`flex items-center gap-1.5 text-sm ${accent ? "text-emerald-500 font-medium" : "text-foreground"}`}>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${accent ? "text-emerald-500" : "text-muted-foreground"}`} />
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aba ATENDENTES — desempenho por atendente. Sub-relatórios: Visão geral,
// Por canais, Por atribuição e Logs de autenticação. Clicar numa linha de
// atendente abre a janelinha flutuante com as CONVERSAS que ele atendeu — cada
// uma abre o chat embutido. Bruno 2026-06-03 (atribuição: 2026-06-04).
// ──────────────────────────────────────────────────────────────────────────

// T.M.A no formato HH:MM:SS (igual ao print de referência).
function fmtClock(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(ss)}`;
}

// Nome curto do navegador a partir do user-agent (só pra exibição).
function parseBrowser(ua: string | null): string {
  if (!ua) return "Navegador";
  if (/edg/i.test(ua)) return "Edge";
  if (/opr|opera/i.test(ua)) return "Opera";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Navegador";
}

const ATEND_SUB_NAV = [
  { key: "visao-geral", label: "Visão geral", icon: BarChart3, enabled: true },
  { key: "canais", label: "Por canais", icon: Radio, enabled: true },
  { key: "atribuicao", label: "Por atribuição", icon: ArrowLeftRight, enabled: true },
  { key: "auth-logs", label: "Logs de autenticação", icon: ShieldCheck, enabled: true },
];

interface AtendenteVG {
  agenteId: number | null;
  bot: boolean;
  nome: string;
  avatar: string | null;
  total: number;
  encerrados: number;
  pct: number;
  tmaSeg: number | null;
  mediaDia: number;
}
interface AtendenteCanalRow {
  agenteId: number | null;
  bot: boolean;
  nome: string;
  avatar: string | null;
  porCanal: Record<string, number>;
  total: number;
  mediaDia: number;
}
interface AtendenteAtribuicaoRow {
  agenteId: number | null;
  bot: boolean;
  nome: string;
  avatar: string | null;
  iniciados: number;
  transferidos: number;
  naoTransferidos: number;
  retornados: number;
  encerrados: number;
  pct: number;
  mediaDia: number;
}
interface AuthLogItem {
  id: number;
  userId: number;
  nome: string;
  avatar: string | null;
  ip: string | null;
  userAgent: string | null;
  loginAt: string | null;
  logoutAt: string | null;
  emSessao: boolean;
  inferido: boolean;
}
interface AtendenteConversaItem {
  id: string;
  numero: string;
  status: string;
  statusRaw: string;
  csatNota: number | null;
  conversationId: number | null;
  nome: string;
  telefone: string | null;
  avatar: string | null;
  canal: string;
  departamento: string;
  createdAt: string;
  resolvedAt: string | null;
}
type SelectedAtendente = { agenteId: number | null; bot: boolean; nome: string; avatar: string | null };

function AtendentesTab({ rangeQS, periodo, setPeriodo, range, onOpenConversa }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onOpenConversa: (convId: number) => void;
}) {
  const [subTab, setSubTab] = useState("visao-geral");
  const [selected, setSelected] = useState<SelectedAtendente | null>(null);

  function verConversa(convId: number) {
    setSelected(null);
    onOpenConversa(convId);
  }

  return (
    <div className="flex gap-6">
      {/* Sub-nav vertical */}
      <aside className="w-56 shrink-0 hidden md:block">
        <nav className="space-y-1">
          {ATEND_SUB_NAV.map((s) => {
            const Icon = s.icon;
            const active = subTab === s.key;
            const inner = (
              <div
                onClick={() => s.enabled && setSubTab(s.key)}
                className={[
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground",
                  s.enabled ? "hover:bg-muted cursor-pointer" : "opacity-40 cursor-not-allowed",
                ].join(" ")}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate flex-1">{s.label}</span>
              </div>
            );
            return s.enabled ? (
              <div key={s.key}>{inner}</div>
            ) : (
              <Tooltip key={s.key}>
                <TooltipTrigger asChild><div>{inner}</div></TooltipTrigger>
                <TooltipContent side="right">Em breve</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        {subTab === "visao-geral" && (
          <AtendenteVisaoGeral rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onSelect={setSelected} />
        )}
        {subTab === "canais" && (
          <AtendenteCanais rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onSelect={setSelected} />
        )}
        {subTab === "atribuicao" && (
          <AtendenteAtribuicao rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} onSelect={setSelected} />
        )}
        {subTab === "auth-logs" && (
          <AtendenteAuthLogs rangeQS={rangeQS} periodo={periodo} setPeriodo={setPeriodo} range={range} />
        )}
      </div>

      {/* Janelinha flutuante das conversas do atendente */}
      <AtendenteConversasDialog
        atendente={selected}
        rangeQS={rangeQS}
        onClose={() => setSelected(null)}
        onVerConversa={verConversa}
      />
    </div>
  );
}

// Cabeçalho amarelo explicativo (igual aos relatórios da referência).
function RelInfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300 leading-snug mb-4">
      {children}
    </div>
  );
}

function AtendenteHeader({ icon: Icon, titulo, descricao }: { icon: any; titulo: string; descricao: string }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-foreground leading-tight">{titulo}</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">{descricao}</p>
      </div>
    </div>
  );
}

// Avatar + nome do atendente, com destaque pra "Automação" (o bot).
function AtendenteCell({ a }: { a: { nome: string; avatar: string | null; bot: boolean } }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {a.bot ? (
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      ) : (
        <ContactAvatar nome={a.nome} fotoUrl={a.avatar} size={32} rounded="50%" />
      )}
      <span className="text-sm font-medium text-primary truncate">{a.nome}</span>
    </div>
  );
}

// ── Visão geral ──
function AtendenteVisaoGeral({ rangeQS, periodo, setPeriodo, range, onSelect }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onSelect: (a: SelectedAtendente) => void;
}) {
  const { data, isLoading } = useQuery<{ atendentes: AtendenteVG[]; total: number; dias: number }>({
    queryKey: ["/api/relatorios/atendentes/visao-geral", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/atendentes/visao-geral?${rangeQS}`),
  });
  const atendentes = data?.atendentes ?? [];
  const top = atendentes.slice(0, 12);

  return (
    <Card className="p-5">
      <AtendenteHeader icon={BarChart3} titulo="Visão geral" descricao="Atendimentos por atendente no período (a Automação representa o que o bot resolveu sozinho)." />
      <RelInfoBanner>
        Acompanhe o desempenho da equipe: quantos atendimentos cada um conduziu, a participação no total, o tempo médio de atendimento (T.M.A) e a média por dia. Clique numa linha pra ver as conversas atendidas.
      </RelInfoBanner>
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando atendentes…
        </div>
      ) : atendentes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum atendimento no período.</div>
      ) : (
        <>
          {top.length > 0 && (
            <div className="mb-6">
              <BarChart
                categories={top.map((a) => a.nome)}
                series={[{ name: "Atendimentos", data: top.map((a) => a.total) }]}
                colors={top.map((_, i) => PALETTE[i % PALETTE.length])}
                height={Math.max(180, top.length * 34)}
                horizontal
                showLegend={false}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-b border-border uppercase tracking-wide">
                  <th className="text-left py-2 font-medium">Atendente</th>
                  <th className="text-right py-2 font-medium w-16">%</th>
                  <th className="text-right py-2 font-medium w-24">T.M.A</th>
                  <th className="text-right py-2 font-medium w-20">Média</th>
                  <th className="text-right py-2 font-medium w-16">Total</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {atendentes.map((a) => (
                  <tr
                    key={a.bot ? "bot" : a.agenteId}
                    className="border-b border-border/50 last:border-0 hover:bg-primary/[0.06] cursor-pointer transition-colors"
                    onClick={() => onSelect({ agenteId: a.agenteId, bot: a.bot, nome: a.nome, avatar: a.avatar })}
                  >
                    <td className="py-2.5"><AtendenteCell a={a} /></td>
                    <td className="text-right tabular-nums text-muted-foreground">{a.pct}</td>
                    <td className="text-right tabular-nums font-mono text-[12px]">{fmtClock(a.tmaSeg)}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{a.mediaDia}</td>
                    <td className="text-right tabular-nums font-semibold">{a.total}</td>
                    <td className="text-right">
                      <span className="text-[11px] font-semibold text-primary inline-flex items-center gap-0.5">
                        Ver <ChevronRight className="w-3 h-3" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Por canais ──
function AtendenteCanais({ rangeQS, periodo, setPeriodo, range, onSelect }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onSelect: (a: SelectedAtendente) => void;
}) {
  const { data, isLoading } = useQuery<{ canais: string[]; atendentes: AtendenteCanalRow[]; dias: number }>({
    queryKey: ["/api/relatorios/atendentes/canais", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/atendentes/canais?${rangeQS}`),
  });
  const canais = data?.canais ?? [];
  const atendentes = data?.atendentes ?? [];
  const isWpp = (c: string) => /whats|wpp|wa\b|oficial/i.test(c);

  return (
    <Card className="p-5">
      <AtendenteHeader icon={Radio} titulo="Por canais" descricao="Distribuição dos atendimentos de cada atendente entre os canais conectados." />
      <RelInfoBanner>
        Veja quantos atendimentos cada atendente conduziu em cada canal, além da média por dia e do total. Clique numa linha pra abrir as conversas.
      </RelInfoBanner>
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando canais…
        </div>
      ) : atendentes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum atendimento no período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-muted-foreground border-b border-border uppercase tracking-wide">
                <th className="text-left py-2 font-medium sticky left-0 bg-card">Atendente</th>
                {canais.map((c) => (
                  <th key={c} className="text-center py-2 font-medium px-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 justify-center max-w-[120px]">
                      {isWpp(c) ? <SiWhatsapp className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Radio className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{c}</span>
                    </span>
                  </th>
                ))}
                <th className="text-right py-2 font-medium w-20">Média</th>
                <th className="text-right py-2 font-medium w-16">Total</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {atendentes.map((a) => (
                <tr
                  key={a.bot ? "bot" : a.agenteId}
                  className="border-b border-border/50 last:border-0 hover:bg-primary/[0.06] cursor-pointer transition-colors"
                  onClick={() => onSelect({ agenteId: a.agenteId, bot: a.bot, nome: a.nome, avatar: a.avatar })}
                >
                  <td className="py-2.5 sticky left-0 bg-card"><AtendenteCell a={a} /></td>
                  {canais.map((c) => (
                    <td key={c} className="text-center tabular-nums px-2">
                      {a.porCanal[c] ? <span className="text-foreground">{a.porCanal[c]}</span> : <span className="text-muted-foreground/40">—</span>}
                    </td>
                  ))}
                  <td className="text-right tabular-nums text-muted-foreground">{a.mediaDia}</td>
                  <td className="text-right tabular-nums font-semibold">{a.total}</td>
                  <td className="text-right">
                    <ChevronRight className="w-4 h-4 text-primary inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Por atribuição — "Atendimentos Atribuídos" ──
// Barra horizontal empilhada por atendente: Transferidos (passou pra outro) +
// Atendidos sem transferência (conduziu até o fim). Tabela com iniciados,
// transferidos, não transferidos, retornados (devolveu pra automação),
// encerrados e % de participação. Clicar abre as conversas do atendente.
function AtendenteAtribuicao({ rangeQS, periodo, setPeriodo, range, onSelect }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onSelect: (a: SelectedAtendente) => void;
}) {
  const { data, isLoading } = useQuery<{ atendentes: AtendenteAtribuicaoRow[]; total: number; dias: number }>({
    queryKey: ["/api/relatorios/atendentes/atribuicao", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/atendentes/atribuicao?${rangeQS}`),
  });
  const atendentes = data?.atendentes ?? [];
  // Gráfico: top 14 por volume (evita barra gigantesca/ilegível em equipes grandes).
  const top = atendentes.slice(0, 14);

  return (
    <Card className="p-5">
      <AtendenteHeader
        icon={ArrowLeftRight}
        titulo="Atendimentos Atribuídos"
        descricao="Como cada atendente atua no fluxo: quantos atendimentos conduziu e, desses, quantos transferiu vs atendeu até o fim."
      />
      <RelInfoBanner>
        Analise de forma detalhada como cada atendente atua no fluxo de atendimentos. O relatório apresenta o total de atendimentos iniciados, transferidos, não transferidos, retornados e encerrados por atendente, além da porcentagem de participação de cada um. Passe o mouse sobre o título de cada coluna pra ver o que ela significa.
      </RelInfoBanner>
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando atribuição…
        </div>
      ) : atendentes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Nenhum atendimento no período.</div>
      ) : (
        <>
          {top.length > 0 && (
            <div className="mb-6">
              <BarChart
                categories={top.map((a) => a.nome)}
                series={[
                  { name: "Transferidos", data: top.map((a) => a.transferidos), color: "#3b82f6" },
                  { name: "Atendidos sem transferência", data: top.map((a) => a.naoTransferidos), color: "#10b981" },
                ]}
                stacked
                horizontal
                height={Math.max(220, top.length * 34)}
                showLegend
              />
              {atendentes.length > top.length && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Gráfico com os {top.length} atendentes de maior volume — a tabela abaixo lista todos.
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-b border-border uppercase tracking-wide">
                  <th className="text-left py-2 font-medium">Atendente</th>
                  <th className="text-right py-2 font-medium w-20" title="Total de atendimentos iniciados/atribuídos a este atendente no período.">Iniciados</th>
                  <th className="text-right py-2 font-medium w-20" title="Atendimentos que este atendente transferiu para outro atendente.">Transf.</th>
                  <th className="text-right py-2 font-medium w-24" title="Atendimentos que este atendente conduziu até o fim, sem transferir.">Não transf.</th>
                  <th className="text-right py-2 font-medium w-20" title="Atendimentos que este atendente devolveu para a automação / fila.">Retornados</th>
                  <th className="text-right py-2 font-medium w-20" title="Atendimentos resolvidos ou fechados.">Encerrados</th>
                  <th className="text-right py-2 font-medium w-16" title="Participação deste atendente no total de atendimentos do período.">%</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {atendentes.map((a) => (
                  <tr
                    key={a.bot ? "bot" : a.agenteId}
                    className="border-b border-border/50 last:border-0 hover:bg-primary/[0.06] cursor-pointer transition-colors"
                    onClick={() => onSelect({ agenteId: a.agenteId, bot: a.bot, nome: a.nome, avatar: a.avatar })}
                  >
                    <td className="py-2.5"><AtendenteCell a={a} /></td>
                    <td className="text-right tabular-nums font-semibold">{a.iniciados}</td>
                    <td className="text-right tabular-nums text-sky-600 dark:text-sky-400">{a.transferidos}</td>
                    <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{a.naoTransferidos}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{a.retornados}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{a.encerrados}</td>
                    <td className="text-right tabular-nums text-muted-foreground">{a.pct}</td>
                    <td className="text-right">
                      <span className="text-[11px] font-semibold text-primary inline-flex items-center gap-0.5">
                        Ver <ChevronRight className="w-3 h-3" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Logs de autenticação ──
function AtendenteAuthLogs({ rangeQS, periodo, setPeriodo, range }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
}) {
  const { data, isLoading } = useQuery<{ items: AuthLogItem[]; total: number }>({
    queryKey: ["/api/relatorios/atendentes/auth-logs", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/atendentes/auth-logs?${rangeQS}`),
  });
  const items = data?.items ?? [];

  return (
    <Card className="p-5">
      <AtendenteHeader icon={ShieldCheck} titulo="Logs de autenticação" descricao="Acompanhe os acessos da equipe: data e hora de login/logout, IP e se ainda está em sessão." />
      <RelInfoBanner>
        O registro começou agora — sessões anteriores a esta atualização não aparecem. Sessões sem logout explícito têm o fim estimado pelo último sinal de atividade.
      </RelInfoBanner>
      <div className="mb-5"><PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} /></div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando logs…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nenhum acesso registrado no período.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-3 py-3">
              <ContactAvatar nome={it.nome} fotoUrl={it.avatar} size={36} rounded="50%" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground truncate">{it.nome}</span>
                  {it.emSessao ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Em Sessão</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-rose-500/15 text-rose-500 border-rose-500/30">Encerrado</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                  <Globe className="w-3 h-3 shrink-0" />
                  <span className="truncate">{parseBrowser(it.userAgent)}{it.ip ? ` · IP ${it.ip}` : ""}</span>
                </div>
              </div>
              <div className="text-right shrink-0 text-[11px] leading-tight">
                <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
                  <LogIn className="w-3 h-3" /> {fmtDateTime(it.loginAt)}
                </div>
                <div className="text-muted-foreground mt-0.5">
                  {it.emSessao ? (
                    <span className="italic">em sessão</span>
                  ) : (
                    <>Logout: {fmtDateTime(it.logoutAt)}{it.inferido ? " *" : ""}</>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Janelinha flutuante: conversas atendidas por um atendente ──
function AtendenteConversasDialog({ atendente, rangeQS, onClose, onVerConversa }: {
  atendente: SelectedAtendente | null;
  rangeQS: string;
  onClose: () => void;
  onVerConversa: (convId: number) => void;
}) {
  const open = !!atendente;
  const [inputBusca, setInputBusca] = useState("");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(100);

  // Limpa a busca + paginação ao trocar de atendente ou refazer a busca.
  useEffect(() => { setInputBusca(""); setBusca(""); setLimite(100); }, [atendente?.agenteId, atendente?.bot]);
  useEffect(() => { setLimite(100); }, [busca]);

  const agenteKey = atendente ? (atendente.bot ? "bot" : String(atendente.agenteId)) : "";
  const qs = `agenteId=${encodeURIComponent(agenteKey)}&${rangeQS}&limite=${limite}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;
  const { data, isLoading, isFetching } = useQuery<{ items: AtendenteConversaItem[]; total: number }>({
    queryKey: ["/api/relatorios/atendentes/conversas", qs],
    queryFn: () => apiFetch(`/api/relatorios/atendentes/conversas?${qs}`),
    enabled: open,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const temMais = items.length < total;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            {atendente && (atendente.bot ? (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            ) : (
              <ContactAvatar nome={atendente.nome} fotoUrl={atendente.avatar} size={32} rounded="50%" />
            ))}
            <span className="truncate">{atendente?.nome}</span>
            <span className="text-xs font-normal text-muted-foreground ml-auto shrink-0">
              {data ? `${data.total} ${data.total === 1 ? "conversa" : "conversas"}` : ""}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={inputBusca}
              onChange={(e) => setInputBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setBusca(inputBusca.trim())}
              placeholder="Buscar por cliente, telefone ou protocolo…"
              className="pl-8 h-9"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando conversas…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm px-4">
              {busca ? "Nenhuma conversa encontrada para a busca." : "Nenhuma conversa atendida no período."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((it) => {
                const quando = it.resolvedAt || it.createdAt;
                const podeAbrir = it.conversationId != null;
                return (
                  <button
                    key={it.id}
                    type="button"
                    disabled={!podeAbrir}
                    onClick={() => podeAbrir && onVerConversa(it.conversationId!)}
                    className={[
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      podeAbrir ? "hover:bg-primary/[0.08] cursor-pointer" : "opacity-60 cursor-not-allowed",
                    ].join(" ")}
                    title={podeAbrir ? "Abrir conversa" : "Conversa não disponível"}
                  >
                    <ContactAvatar nome={it.nome} fotoUrl={it.avatar} size={36} rounded="50%" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">{it.nome}</span>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                        <SiWhatsapp className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span className="truncate">{it.canal}{it.telefone ? ` · ${it.telefone}` : ""}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 font-mono">{it.numero}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={it.status} />
                      <span className="text-[10.5px] text-muted-foreground">{fmtDateTime(quando)}</span>
                      {podeAbrir && <ExternalLink className="w-3.5 h-3.5 text-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {!isLoading && temMais && (
            <div className="px-4 py-3 text-center border-t border-border">
              <button
                type="button"
                onClick={() => setLimite((l) => l + 100)}
                disabled={isFetching}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {isFetching ? "Carregando…" : `Carregar mais — ${items.length} de ${total}`}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aba CLIENTES — "Total por cliente": quantos atendimentos cada cliente final
// teve no período. Clicar abre a conversa do cliente. Bruno 2026-06-03.
// ──────────────────────────────────────────────────────────────────────────

interface ClienteItem {
  conversationId: number | null;
  nome: string;
  telefone: string | null;
  avatar: string | null;
  total: number;
  ultimoAt: string | null;
}

function ClientesTab({ rangeQS, periodo, setPeriodo, range, onOpenConversa }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onOpenConversa: (convId: number) => void;
}) {
  const [inputBusca, setInputBusca] = useState("");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(0);
  // Bruno 2026-06-04: clicar num cliente abre modal com os atendimentos dele.
  const [clienteModal, setClienteModal] = useState<ClienteItem | null>(null);

  useEffect(() => { setPage(0); }, [rangeQS, busca]);

  const offset = page * PAGE_SIZE;
  const qs = `${rangeQS}&limite=${PAGE_SIZE}&offset=${offset}${busca ? `&busca=${encodeURIComponent(busca)}` : ""}`;
  const { data, isLoading } = useQuery<{ items: ClienteItem[]; total: number; top: { nome: string; total: number }[] }>({
    queryKey: ["/api/relatorios/clientes", qs],
    queryFn: () => apiFetch(`/api/relatorios/clientes?${qs}`),
  });

  function aplicarBusca() { setPage(0); setBusca(inputBusca.trim()); }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const top = data?.top ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const short = (s: string) => (s.length > 26 ? s.slice(0, 24) + "…" : s);

  return (
    <Card className="p-5">
      <AtendenteHeader icon={Users} titulo="Total por cliente" descricao="Total de atendimentos por cliente no período. Clique num cliente pra abrir a conversa." />

      {/* Busca + período */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Input
            value={inputBusca}
            onChange={(e) => setInputBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && aplicarBusca()}
            placeholder="Nome do cliente, protocolo ou número"
            className="max-w-sm h-9"
          />
          <Button onClick={aplicarBusca} className="h-9 gap-1.5">
            <Search className="w-4 h-4" /> Pesquisar
          </Button>
        </div>
        <PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando clientes…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {busca ? "Nenhum cliente encontrado para a busca." : "Nenhum atendimento no período."}
        </div>
      ) : (
        <>
          {/* Gráfico dos clientes com mais atendimentos */}
          {!busca && top.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-foreground mb-2">Clientes com mais atendimentos</h3>
              <BarChart
                categories={top.map((t) => short(t.nome))}
                series={[{ name: "Atendimentos", data: top.map((t) => t.total) }]}
                colors={top.map((_, i) => PALETTE[i % PALETTE.length])}
                height={Math.max(180, top.length * 34)}
                horizontal
                showLegend={false}
              />
            </div>
          )}

          {/* Lista de clientes */}
          <div className="divide-y divide-border">
            {items.map((it, i) => {
              const podeVer = it.conversationId != null || !!it.telefone;
              return (
                <button
                  key={`${it.conversationId ?? "x"}-${it.telefone ?? i}`}
                  type="button"
                  disabled={!podeVer}
                  onClick={() => podeVer && setClienteModal(it)}
                  className={[
                    "w-full flex items-center gap-3 py-3 px-2 text-left transition-colors",
                    podeVer ? "hover:bg-primary/[0.08] cursor-pointer" : "opacity-60 cursor-not-allowed",
                  ].join(" ")}
                  title={podeVer ? "Ver atendimentos do cliente" : "Atendimentos não disponíveis"}
                >
                  <ContactAvatar nome={it.nome} fotoUrl={it.avatar} size={40} rounded="50%" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-primary truncate block">{it.nome}</span>
                    {it.telefone && (
                      <span className="text-xs text-muted-foreground font-mono">{it.telefone}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {it.total} {it.total === 1 ? "atendimento" : "atendimentos"}
                    </span>
                    {podeVer && <ChevronRight className="w-4 h-4 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Paginação */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ClienteAtendimentosDialog
        cliente={clienteModal}
        rangeQS={rangeQS}
        onClose={() => setClienteModal(null)}
        onVerConversa={(convId) => { setClienteModal(null); onOpenConversa(convId); }}
      />
    </Card>
  );
}

// Modal com os atendimentos (protocolos) de UM cliente — abre ao clicar num
// cliente na aba Clientes. Cada atendimento abre a conversa. Bruno 2026-06-04.
function ClienteAtendimentosDialog({ cliente, rangeQS, onClose, onVerConversa }: {
  cliente: ClienteItem | null;
  rangeQS: string;
  onClose: () => void;
  onVerConversa: (convId: number) => void;
}) {
  const open = !!cliente;
  const tel = (cliente?.telefone || "").replace(/\D/g, "");
  const qs = `${rangeQS}&limite=200`
    + (tel ? `&telefone=${encodeURIComponent(tel)}` : "")
    + (!tel && cliente?.conversationId != null ? `&conversationId=${cliente.conversationId}` : "");
  const { data, isLoading } = useQuery<{ items: AtendimentoItem[]; total: number }>({
    queryKey: ["/api/relatorios/clientes/atendimentos", qs],
    queryFn: () => apiFetch(`/api/relatorios/clientes/atendimentos?${qs}`),
    enabled: open,
  });
  const items = data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            {cliente && <ContactAvatar nome={cliente.nome} fotoUrl={cliente.avatar} size={32} rounded="50%" />}
            <div className="min-w-0">
              <div className="truncate leading-tight">{cliente?.nome}</div>
              {cliente?.telefone && <div className="text-[11px] font-normal font-mono text-muted-foreground truncate">{cliente.telefone}</div>}
            </div>
            <span className="text-xs font-normal text-muted-foreground ml-auto shrink-0 self-start mt-1">
              {data ? `${data.total} ${data.total === 1 ? "atendimento" : "atendimentos"}` : ""}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando atendimentos…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm px-4">
              Nenhum atendimento no período.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((it) => {
                const quando = it.resolvedAt || it.createdAt;
                const podeAbrir = it.conversationId != null;
                return (
                  <button
                    key={it.id}
                    type="button"
                    disabled={!podeAbrir}
                    onClick={() => podeAbrir && onVerConversa(it.conversationId!)}
                    className={[
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      podeAbrir ? "hover:bg-primary/[0.08] cursor-pointer" : "opacity-60 cursor-not-allowed",
                    ].join(" ")}
                    title={podeAbrir ? "Abrir conversa" : "Conversa não disponível"}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      {it.origem === "automacao"
                        ? <Bot className="w-4 h-4 text-muted-foreground" />
                        : <Headset className="w-4 h-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">{it.departamento}</span>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                        <span className="font-mono">{it.numero}</span>
                        {it.agenteNome && <span className="truncate">· {it.agenteNome}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={it.status} />
                      <span className="text-[10.5px] text-muted-foreground">{fmtDateTime(quando)}</span>
                      {podeAbrir && <ExternalLink className="w-3.5 h-3.5 text-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aba PESQUISA DE SATISFAÇÃO — CSAT (nota 1-5 pós-atendimento) + NPS (0-10).
// Didática: explica cada métrica, escala e como é coletada. Bruno 2026-06-04.
// ──────────────────────────────────────────────────────────────────────────

interface SatisfacaoResp {
  csat: {
    media: number | null;
    respostas: number;
    enviadas: number;
    taxaResposta: number | null;
    pctSatisfeitos: number | null;
    pctInsatisfeitos: number | null;
    distribuicao: { nota: number; total: number }[];
    porDia: { label: string; media: number; total: number }[];
    porSetor: { setor: string; media: number; total: number }[];
    porAgente: { agenteId: number | null; bot: boolean; nome: string; avatar: string | null; media: number; total: number }[];
    recentes: { id: string; numero: string; nota: number; quando: string; setor: string; agenteNome: string | null; conversationId: number | null; nome: string; avatar: string | null }[];
  };
  nps: {
    escala: number; // 5 ou 10 — define faixas/rótulos
    score: number | null;
    respostas: number;
    enviadas: number;
    taxaResposta: number | null;
    promotores: number; neutros: number; detratores: number;
    pctPromotores: number; pctNeutros: number; pctDetratores: number;
    distribuicao: { nota: number; total: number }[];
    porDia: { label: string; promotores: number; detratores: number; total: number }[];
  };
}

function csatColor(nota: number): string {
  if (nota >= 4) return "#10b981";
  if (nota === 3) return "#f59e0b";
  return "#ef4444";
}
function mediaColor(m: number | null): string {
  if (m == null) return "#64748b";
  if (m >= 4) return "#10b981";
  if (m >= 3) return "#f59e0b";
  return "#ef4444";
}
function npsScoreColor(s: number | null): string {
  if (s == null) return "#64748b";
  if (s >= 50) return "#10b981";
  if (s >= 0) return "#f59e0b";
  return "#ef4444";
}
const CSAT_EMOJI: Record<number, string> = { 1: "😡", 2: "😕", 3: "😐", 4: "😊", 5: "🤩" };

function Stars({ nota, size = 14 }: { nota: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${nota}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }}
          className={i <= nota ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"} />
      ))}
    </span>
  );
}

function SatisfacaoTab({ rangeQS, periodo, setPeriodo, range, onOpenConversa }: {
  rangeQS: string;
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  range: { inicio: Date; fim: Date };
  onOpenConversa: (convId: number) => void;
}) {
  const { data, isLoading } = useQuery<SatisfacaoResp>({
    queryKey: ["/api/relatorios/satisfacao", rangeQS],
    queryFn: () => apiFetch(`/api/relatorios/satisfacao?${rangeQS}`),
  });
  const csat = data?.csat;
  const nps = data?.nps;

  // Filtro por estrelas na lista "Respostas recentes": quando ativo, busca a
  // lista filtrada num endpoint dedicado (não recarrega os agregados/distribuição,
  // que seguem completos). null = "Todas" (usa csat.recentes do payload principal).
  const [notaFiltro, setNotaFiltro] = useState<number | null>(null);
  const { data: recentesFiltradas, isFetching: loadingRecentes } = useQuery<{ recentes: NonNullable<SatisfacaoResp["csat"]>["recentes"] }>({
    queryKey: ["/api/relatorios/satisfacao/recentes", rangeQS, notaFiltro],
    queryFn: () => apiFetch(`/api/relatorios/satisfacao/recentes?${rangeQS}&nota=${notaFiltro}`),
    enabled: notaFiltro != null,
  });
  const recentesView = notaFiltro == null ? (csat?.recentes ?? []) : (recentesFiltradas?.recentes ?? []);

  // NPS escala-aware (review): tenant pode usar escala 1-5 ou 0-10 (q153).
  const isE5 = (nps?.escala ?? 10) === 5;
  // Faixas canônicas (npsService): escala 5 → det 1-2 / neu 3 / prom 4-5.
  const npsFaixa = { prom: isE5 ? "4-5" : "9-10", neu: isE5 ? "3" : "7-8", det: isE5 ? "1-2" : "0-6" };
  const npsEscalaTxt = isE5 ? "1 a 5" : "0 a 10";
  const npsBarColor = (nota: number) => isE5
    ? (nota >= 4 ? "#10b981" : nota === 3 ? "#f59e0b" : "#ef4444")
    : (nota >= 9 ? "#10b981" : nota >= 7 ? "#f59e0b" : "#ef4444");
  const npsScoreLabel = (s: number | null) => s == null ? "" : s >= 50 ? "Excelente 🚀" : s >= 30 ? "Bom 👍" : s >= 0 ? "Ok" : "Crítico ⚠️";

  return (
    <div className="space-y-5">
      {/* Cabeçalho + período */}
      <Card className="p-5">
        <RelHeader
          icon={Star}
          cor="#FFB800"
          titulo="Pesquisa de Satisfação"
          descricao="O que os clientes acharam do atendimento. Duas métricas: o CSAT (nota logo após cada atendimento, de 1 a 5) e o NPS (mede o quanto o cliente recomendaria a empresa)."
        />
        <PeriodoSelect periodo={periodo} setPeriodo={setPeriodo} range={range} />
      </Card>

      {isLoading ? (
        <Card className="p-5">
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando satisfação…
          </div>
        </Card>
      ) : (
        <>
          {/* ── CSAT ── */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Star className="w-4 h-4 text-amber-400" />
              <h2 className="text-lg font-semibold text-foreground">CSAT — Satisfação do atendimento</h2>
            </div>
            <p className="text-[13px] text-muted-foreground mb-4 max-w-3xl leading-snug">
              Enviado automaticamente ao cliente ao encerrar cada atendimento: <b>"de 1 a 5, como você avalia?"</b>.
              Contam como <span className="text-emerald-500 font-medium">satisfeitos</span> as notas 4 e 5; <span className="text-rose-500 font-medium">insatisfeitos</span> as notas 1 e 2.
            </p>

            {!csat || csat.respostas === 0 ? (
              <div className="text-center py-10 px-4 rounded-lg border border-dashed border-border bg-muted/20">
                <Star className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">Ainda sem respostas de CSAT no período</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  A nota é coletada quando o cliente responde a pesquisa enviada ao fim do atendimento. Conforme as respostas chegam, a média e a distribuição aparecem aqui.
                </p>
                {csat && csat.enviadas > 0 && (
                  <p className="text-[11px] text-muted-foreground/70 mt-2">{csat.enviadas} pesquisa(s) enviada(s), nenhuma respondida ainda.</p>
                )}
              </div>
            ) : (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <div className="rounded-box border border-base-200 bg-base-200/40 p-3">
                    <p className="text-[11px] text-base-content/55 uppercase tracking-wide">Nota média</p>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span className="text-2xl font-semibold tabular-nums text-base-content">{csat.media?.toFixed(2) ?? "—"}</span>
                      <span className="text-sm text-muted-foreground">/ 5</span>
                    </div>
                    {csat.media != null && <div className="mt-1"><Stars nota={Math.round(csat.media)} size={13} /></div>}
                  </div>
                  <KpiBox label="Satisfeitos (4-5)" value={`${csat.pctSatisfeitos ?? 0}%`} cor="#10b981" hint={`${csat.pctInsatisfeitos ?? 0}% insatisfeitos (1-2)`} />
                  <KpiBox label="Respostas" value={csat.respostas} hint="clientes que avaliaram" />
                  <KpiBox label="Taxa de resposta" value={csat.taxaResposta != null ? `${csat.taxaResposta}%` : "—"} hint={`${csat.enviadas} enviadas`} />
                </div>

                {/* Distribuição das notas */}
                <h3 className="text-sm font-medium text-foreground mb-2">Distribuição das notas</h3>
                <div className="space-y-1.5 mb-6">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const total = csat.distribuicao.find((d) => d.nota === n)?.total ?? 0;
                    const pct = csat.respostas > 0 ? Math.round((total / csat.respostas) * 100) : 0;
                    return (
                      <div key={n} className="flex items-center gap-3">
                        <span className="w-24 flex items-center gap-1.5 shrink-0">
                          <span className="text-base leading-none">{CSAT_EMOJI[n]}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{n}</span>
                        </span>
                        <div className="flex-1 h-3.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: csatColor(n) }} />
                        </div>
                        <span className="w-20 text-right text-xs text-muted-foreground tabular-nums shrink-0">{total} · {pct}%</span>
                      </div>
                    );
                  })}
                </div>

                {/* Tendência */}
                {csat.porDia.length > 1 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Nota média por dia</h3>
                    <ComposedChart
                      categories={csat.porDia.map((d) => d.label)}
                      series={[
                        { name: "Nota média", data: csat.porDia.map((d) => d.media), type: "line", color: "#FFB800" },
                        { name: "Respostas", data: csat.porDia.map((d) => d.total), type: "bar", color: "#94a3b8" },
                      ]}
                      height={220}
                    />
                  </div>
                )}

                {/* Por setor + Por atendente */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {csat.porSetor.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-2">Por setor</h3>
                      <div className="space-y-2">
                        {csat.porSetor.map((s) => (
                          <div key={s.setor} className="flex items-center gap-3">
                            <span className="w-28 text-sm text-foreground truncate shrink-0">{s.setor}</span>
                            <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${(s.media / 5) * 100}%`, background: mediaColor(s.media) }} />
                            </div>
                            <span className="w-20 text-right text-xs tabular-nums shrink-0" style={{ color: mediaColor(s.media) }}>{s.media.toFixed(2)} <span className="text-muted-foreground">({s.total})</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {csat.porAgente.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-foreground mb-2">Por atendente</h3>
                      <div className="space-y-2">
                        {csat.porAgente.slice(0, 8).map((a) => (
                          <div key={a.bot ? "bot" : a.agenteId} className="flex items-center gap-2.5">
                            {a.bot ? (
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Bot className="w-3.5 h-3.5 text-primary" /></div>
                            ) : (
                              <ContactAvatar nome={a.nome} fotoUrl={a.avatar} size={28} rounded="50%" />
                            )}
                            <span className="flex-1 text-sm text-foreground truncate min-w-0">{a.nome}</span>
                            <Stars nota={Math.round(a.media)} size={12} />
                            <span className="w-14 text-right text-xs tabular-nums shrink-0" style={{ color: mediaColor(a.media) }}>{a.media.toFixed(2)} <span className="text-muted-foreground/70">({a.total})</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Respostas recentes — com filtro por quantidade de estrelas */}
                {csat.recentes.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">Respostas recentes</h3>
                        {notaFiltro != null && loadingRecentes && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setNotaFiltro(null)}
                          className={["px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                            notaFiltro == null ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"].join(" ")}
                        >Todas</button>
                        {[5, 4, 3, 2, 1].map((n) => {
                          const total = csat.distribuicao.find((d) => d.nota === n)?.total ?? 0;
                          const ativo = notaFiltro === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              disabled={total === 0}
                              onClick={() => setNotaFiltro(ativo ? null : n)}
                              title={`${total} resposta(s) com ${n} estrela(s)`}
                              className={["px-2 py-1 rounded-full text-xs font-medium border transition-colors inline-flex items-center gap-1",
                                total === 0 ? "opacity-40 cursor-default border-border bg-muted/20 text-muted-foreground"
                                  : ativo ? "border-amber-400 bg-amber-400/15 text-amber-600 dark:text-amber-400"
                                    : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"].join(" ")}
                            >
                              <span className="tabular-nums">{n}</span>
                              <Star style={{ width: 12, height: 12 }} className="fill-amber-400 text-amber-400" />
                              <span className="tabular-nums opacity-70">{total}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {recentesView.length === 0 ? (
                      <div className="text-center py-6 text-xs text-muted-foreground rounded-lg border border-dashed border-border bg-muted/20">
                        {notaFiltro != null && loadingRecentes
                          ? "Carregando…"
                          : `Nenhuma resposta com ${notaFiltro} estrela${notaFiltro === 1 ? "" : "s"} no período.`}
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {recentesView.map((r) => {
                          const podeAbrir = r.conversationId != null;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              disabled={!podeAbrir}
                              onClick={() => podeAbrir && onOpenConversa(r.conversationId!)}
                              className={["w-full flex items-center gap-3 py-2.5 px-2 text-left transition-colors", podeAbrir ? "hover:bg-primary/[0.06] cursor-pointer" : "opacity-70 cursor-default"].join(" ")}
                              title={podeAbrir ? "Abrir conversa" : "Conversa não disponível"}
                            >
                              <ContactAvatar nome={r.nome} fotoUrl={r.avatar} size={34} rounded="50%" />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-foreground truncate block">{r.nome}</span>
                                <span className="text-[11px] text-muted-foreground">{r.setor}{r.agenteNome ? ` · ${r.agenteNome}` : ""}</span>
                              </div>
                              <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <span className="inline-flex items-center gap-1"><span className="text-base leading-none">{CSAT_EMOJI[r.nota]}</span><Stars nota={r.nota} size={12} /></span>
                                <span className="text-[10.5px] text-muted-foreground">{fmtDateTime(r.quando)}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* ── NPS ── */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-violet-500" />
              <h2 className="text-lg font-semibold text-foreground">NPS — Net Promoter Score</h2>
            </div>
            <p className="text-[13px] text-muted-foreground mb-4 max-w-3xl leading-snug">
              Pergunta enviada um tempo após o atendimento: <b>"de {npsEscalaTxt}, o quanto você recomendaria a gente?"</b>.
              <span className="text-emerald-500 font-medium"> Promotores</span> ({npsFaixa.prom}), <span className="text-amber-500 font-medium">neutros</span> ({npsFaixa.neu}), <span className="text-rose-500 font-medium">detratores</span> ({npsFaixa.det}). O NPS = % promotores − % detratores (vai de −100 a +100).
            </p>

            {!nps || nps.respostas === 0 ? (
              <div className="text-center py-10 px-4 rounded-lg border border-dashed border-border bg-muted/20">
                <TrendingUp className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">Ainda sem respostas de NPS no período</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  O NPS é disparado automaticamente algumas horas após o atendimento. Se estiver desativado, nenhuma pesquisa é enviada.
                </p>
                {nps && nps.enviadas > 0 && (
                  <p className="text-[11px] text-muted-foreground/70 mt-2">{nps.enviadas} pesquisa(s) enviada(s), nenhuma respondida ainda.</p>
                )}
              </div>
            ) : (
              <>
                {/* Score + KPIs */}
                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 mb-6">
                  <div className="rounded-box border border-base-200 p-4 flex flex-col items-center justify-center text-center" style={{ background: `${npsScoreColor(nps.score)}10` }}>
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">NPS</span>
                    <span className="text-5xl font-bold tabular-nums leading-tight text-base-content">{nps.score ?? "—"}</span>
                    <span className="text-[11px] text-muted-foreground mt-1">{npsScoreLabel(nps.score)}</span>
                  </div>
                  <div>
                    {/* Barra empilhada promotores/neutros/detratores */}
                    <div className="flex h-7 rounded-lg overflow-hidden mb-3">
                      {nps.pctDetratores > 0 && <div className="flex items-center justify-center text-[10px] font-semibold text-white" style={{ width: `${nps.pctDetratores}%`, background: "#ef4444" }}>{nps.pctDetratores >= 8 ? `${nps.pctDetratores}%` : ""}</div>}
                      {nps.pctNeutros > 0 && <div className="flex items-center justify-center text-[10px] font-semibold text-white" style={{ width: `${nps.pctNeutros}%`, background: "#f59e0b" }}>{nps.pctNeutros >= 8 ? `${nps.pctNeutros}%` : ""}</div>}
                      {nps.pctPromotores > 0 && <div className="flex items-center justify-center text-[10px] font-semibold text-white" style={{ width: `${nps.pctPromotores}%`, background: "#10b981" }}>{nps.pctPromotores >= 8 ? `${nps.pctPromotores}%` : ""}</div>}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-center">
                        <p className="text-lg font-semibold text-base-content tabular-nums">{nps.promotores}</p>
                        <p className="text-[10.5px] text-muted-foreground">Promotores ({npsFaixa.prom})</p>
                      </div>
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-center">
                        <p className="text-lg font-semibold text-base-content tabular-nums">{nps.neutros}</p>
                        <p className="text-[10.5px] text-muted-foreground">Neutros ({npsFaixa.neu})</p>
                      </div>
                      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-center">
                        <p className="text-lg font-semibold text-base-content tabular-nums">{nps.detratores}</p>
                        <p className="text-[10.5px] text-muted-foreground">Detratores ({npsFaixa.det})</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">{nps.respostas} respostas · taxa de {nps.taxaResposta ?? 0}% ({nps.enviadas} enviadas)</p>
                  </div>
                </div>

                {/* Distribuição 0-10 */}
                <h3 className="text-sm font-medium text-foreground mb-2">Distribuição das notas ({npsEscalaTxt})</h3>
                <BarChart
                  categories={nps.distribuicao.map((d) => String(d.nota))}
                  series={[{ name: "Respostas", data: nps.distribuicao.map((d) => d.total) }]}
                  colors={nps.distribuicao.map((d) => npsBarColor(d.nota))}
                  height={200}
                  showLegend={false}
                />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// Aba DASHBOARD = página de Métricas ISP embutida (ver render acima). O
// dashboard antigo (KPIs + gráficos próprios) foi removido — Bruno 2026-06-02.
