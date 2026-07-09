import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DateTimeLocalPicker } from "@/components/ui/date-time-picker";
import { MessageInput } from "@/components/ui/message-input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  Eye,
  MessageSquare,
  Megaphone,
  Pause,
  Play,
  Plus,
  Rocket,
  Send,
  Smartphone,
  Users,
  XCircle,
  Clock,
  BarChart3,
  Zap,
  AlertTriangle,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { Campanha } from "@shared/schema";
import { PageHeader } from "@/components/page/PageShell";

type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled" | "error";

const statusConfig: Record<CampaignStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  draft: { label: "Rascunho", variant: "secondary", className: "bg-muted/50 text-muted-foreground" },
  scheduled: { label: "Agendada", variant: "outline", className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" },
  running: { label: "Enviando", variant: "outline", className: "bg-primary/10 text-tertiary-600 dark:text-tertiary-500 border-primary/20" },
  paused: { label: "Pausada", variant: "outline", className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20" },
  completed: { label: "Concluída", variant: "outline", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  cancelled: { label: "Cancelada", variant: "destructive", className: "" },
  error: { label: "Erro", variant: "destructive", className: "" },
};

type View = "list" | "detail" | "create";
type FilterStatus = "all" | "draft" | "scheduled" | "running" | "completed";

const filterLabels: { key: FilterStatus; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "draft", label: "Rascunho" },
  { key: "scheduled", label: "Agendada" },
  { key: "running", label: "Enviando" },
  { key: "completed", label: "Concluída" },
];

interface Conexao {
  id: string;
  nome: string;
  provider: string;
  status: string;
  telefone?: string;
}

interface CampDraft {
  connectionId: string;
  connectionName: string;
  name: string;
  messageText: string;
  audienceType: string;
  ratePerMinute: number;
  batchSize: number;
  delayMs: number;
  scheduledAt: string;
}

export default function Campanhas({ embedded }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<View>("list");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [step, setStep] = useState(1);
  const { toast } = useToast();
  const [draft, setDraft] = useState<CampDraft>({
    connectionId: "",
    connectionName: "",
    name: "",
    messageText: "",
    audienceType: "all",
    ratePerMinute: 30,
    batchSize: 10,
    delayMs: 2000,
    scheduledAt: "",
  });

  const { data: campanhasResp, isLoading, isError } = useQuery<{ ok: boolean; data: Campanha[] }>({
    queryKey: ["/api/campanhas"],
  });
  const campaigns = campanhasResp?.data ?? [];

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/campanhas", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campanhas"] });
      toast({ title: "Campanha criada com sucesso" });
      setView("list");
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao criar campanha", description: err.message, variant: "destructive" });
    },
  });

  const filtered = filter === "all" ? campaigns : campaigns.filter(c => c.status === filter);

  function openDetail(idx: number) {
    setActiveIdx(idx);
    setView("detail");
  }

  function openCreate() {
    setStep(1);
    setDraft({
      connectionId: "",
      connectionName: "",
      name: "",
      messageText: "",
      audienceType: "all",
      ratePerMinute: 30,
      batchSize: 10,
      delayMs: 2000,
      scheduledAt: "",
    });
    setView("create");
  }

  function submitCampaign() {
    if (!draft.connectionId) {
      toast({ title: "Selecione uma conexão", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      nome: draft.name || "Nova Campanha",
      channel: "whatsapp",
      connectionId: draft.connectionId,
      template: draft.messageText || "",
      status: "draft",
      total: 0,
      sent: 0,
      read: 0,
      replies: 0,
      failed: 0,
      audienceType: draft.audienceType,
      ratePerMinute: draft.ratePerMinute,
      batchSize: draft.batchSize,
      delayMs: draft.delayMs,
      scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
    });
  }

  if (view === "detail" && activeIdx !== null) {
    const camp = filtered[activeIdx] || campaigns[activeIdx];
    if (camp) {
      return <CampaignDetail campaign={camp} onBack={() => setView("list")} embedded={embedded} />;
    }
  }

  if (view === "create") {
    return (
      <CampaignCreate
        step={step}
        setStep={setStep}
        draft={draft}
        setDraft={setDraft}
        onBack={() => setView("list")}
        onSubmit={submitCampaign}
        isSubmitting={createMutation.isPending}
        embedded={embedded}
      />
    );
  }

  if (isLoading) {
    return (
      <div className={embedded ? "px-5 pt-4 flex-1 flex flex-col" : "min-h-full flex flex-col"} data-testid="page-campanhas">
        {!embedded && (
          <div className="px-6 py-4 border-b bg-card flex items-center justify-between gap-4 flex-shrink-0 flex-wrap">
            <div>
              <h2 className="text-base font-semibold" data-testid="text-campanhas-title">Campanhas em Massa</h2>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">Envio em massa via conexão WhatsApp</p>
            </div>
          </div>
        )}
        <div className="flex-1 p-4 flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={embedded ? "flex-1 flex flex-col items-center justify-center gap-3" : "min-h-full flex flex-col items-center justify-center gap-3"} data-testid="page-campanhas-error">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Erro ao carregar campanhas</p>
        <Button size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/campanhas"] })} data-testid="button-retry-campanhas">
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className={embedded ? "px-5 pt-4 space-y-4 flex-1 flex flex-col overflow-hidden" : "min-h-full flex flex-col bg-background page-banana-wash"} data-testid="page-campanhas">
      {!embedded && (
        <div className="px-6 pt-5 pb-4 flex-shrink-0">
          <PageHeader
            title="Campanhas em Massa"
            subtitle="Envio em massa via conexão WhatsApp"
            actions={
              <Button
                size="sm"
                onClick={openCreate}
                className="h-9 gap-1.5 text-[12px] font-bold"
                data-testid="button-nova-campanha"
              >
                <Plus className="w-3.5 h-3.5" /> Nova Campanha
              </Button>
            }
          />
        </div>
      )}
      <div className="flex items-center gap-1.5 px-6 pb-3">
        {filterLabels.map((f) => {
          const isActive = filter === f.key;
          return (
            <button
              key={f.key}
              className={`seg-tab ${isActive ? "seg-tab-active" : ""}`}
              onClick={() => setFilter(f.key)}
              data-testid={`filter-camp-${f.key}`}
            >
              {f.label}
            </button>
          );
        })}
        {embedded && (
          <Button size="sm" className="h-8 px-3 flex-shrink-0 ml-auto" onClick={openCreate} data-testid="button-nova-campanha">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Nova Campanha
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
        {filtered.map((camp, i) => {
          const sc = statusConfig[camp.status as CampaignStatus] || statusConfig.draft;
          const pct = camp.total > 0 ? Math.round((camp.sent / camp.total) * 100) : 0;
          const dateStr = camp.createdAt ? new Date(camp.createdAt).toLocaleDateString("pt-BR") : "";

          return (
            <Card
              key={camp.id}
              className="group p-3 cursor-pointer flex items-center gap-3 border-border/60 transition-colors hover:border-primary/40"
              onClick={() => openDetail(i)}
              data-testid={`card-campaign-${camp.id}`}
            >
              <div className="w-9 h-9 rounded-lg bg-primary/[0.08] ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0">
                <Smartphone className="w-4 h-4 text-primary" strokeWidth={2} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[13px] font-semibold tracking-tight truncate" data-testid={`text-camp-name-${camp.id}`}>{camp.nome}</span>
                  <span className={`inline-flex items-center px-1.5 py-0 h-[18px] rounded text-[10px] font-medium flex-shrink-0 ${sc.className}`} data-testid={`badge-camp-status-${camp.id}`}>
                    {sc.label}
                  </span>
                </div>
                <div className="flex gap-3 flex-wrap text-[11px]">
                  <span className="text-muted-foreground flex items-center gap-1 tabular-nums">
                    <Users className="w-3 h-3" /> {camp.total.toLocaleString("pt-BR")} destinatários
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-500 flex items-center gap-1 font-medium tabular-nums">
                    <Check className="w-3 h-3" /> {camp.sent.toLocaleString("pt-BR")} enviados
                  </span>
                  <span className="text-sky-600 dark:text-sky-400 flex items-center gap-1 font-medium tabular-nums">
                    <Eye className="w-3 h-3" /> {camp.read.toLocaleString("pt-BR")} leram
                  </span>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                {camp.status === "running" && (
                  <>
                    <div className="text-[11px] text-sky-600 dark:text-sky-400 font-bold flex items-center gap-1 justify-end tabular-nums">
                      <Zap className="w-3 h-3" /> {pct}%
                    </div>
                    <div className="w-20 mt-1">
                      <Progress value={pct} className="h-1" />
                    </div>
                  </>
                )}
                <div className="text-[10.5px] text-muted-foreground/80 mt-0.5 tabular-nums">{dateStr}</div>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          filter !== "all"
            ? <div className="text-center text-muted-foreground text-sm py-12">Nenhuma campanha encontrada com esse filtro</div>
            : <EmptyState icon="📢" title="Nenhuma campanha ainda" description="Envie mensagens em massa para seus contatos com segmentacao." actionLabel="Criar Campanha" onAction={openCreate} />
        )}
      </div>
    </div>
  );
}

function CampaignDetail({ campaign, onBack, embedded }: { campaign: Campanha; onBack: () => void; embedded?: boolean }) {
  const deliveryRate = campaign.total > 0 ? Math.round((campaign.sent / campaign.total) * 100) : 0;
  const readRate = campaign.sent > 0 ? Math.round((campaign.read / campaign.sent) * 100) : 0;
  const replyRate = campaign.sent > 0 ? Math.round((campaign.replies / campaign.sent) * 100) : 0;
  const failRate = campaign.total > 0 ? Math.round((campaign.failed / campaign.total) * 100) : 0;
  const dateStr = campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString("pt-BR") : "";

  const kpis = [
    { icon: Send, label: "Enviados", val: campaign.sent.toLocaleString("pt-BR"), pct: deliveryRate + "%", color: "text-tertiary-500", bg: "bg-primary/10" },
    { icon: Check, label: "Entregues", val: campaign.sent.toLocaleString("pt-BR"), pct: deliveryRate + "%", color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { icon: Eye, label: "Leram", val: campaign.read.toLocaleString("pt-BR"), pct: readRate + "%", color: "text-primary", bg: "bg-primary/10" },
    { icon: MessageSquare, label: "Responderam", val: campaign.replies.toLocaleString("pt-BR"), pct: replyRate + "%", color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { icon: XCircle, label: "Falhas", val: campaign.failed.toLocaleString("pt-BR"), pct: failRate + "%", color: "text-red-500", bg: "bg-red-500/10" },
  ];

  const funnel = [
    { label: "Total enviado", val: campaign.total, pct: 100, color: "bg-primary" },
    { label: "Entregue", val: campaign.sent, pct: deliveryRate, color: "bg-primary" },
    { label: "Abriu / Leu", val: campaign.read, pct: readRate, color: "bg-primary" },
    { label: "Respondeu", val: campaign.replies || Math.round(campaign.read * 0.11), pct: replyRate || 11, color: "bg-yellow-500" },
  ];

  const configItems = [
    { l: "Canal", v: "WhatsApp (Conexão)" },
    { l: "Rate limit", v: (campaign.ratePerMinute || 30) + " msg/min" },
    { l: "Batch size", v: (campaign.batchSize || 10) + " por lote" },
    { l: "Público", v: campaign.audienceType || "all" },
    { l: "Iniciada em", v: dateStr },
  ];

  return (
    <div className={embedded ? "flex-1 flex flex-col overflow-hidden" : "min-h-full flex flex-col"} data-testid="page-campaign-detail">
      <div className="px-5 py-3 border-b bg-card flex items-center gap-3 flex-shrink-0 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-camp-back">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" data-testid="text-camp-detail-name">{campaign.nome}</div>
          <div className="text-[10.5px] text-muted-foreground">{campaign.total.toLocaleString("pt-BR")} destinatários</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {campaign.status === "running" && (
            <Button variant="outline" size="sm" data-testid="button-camp-pause">
              <Pause className="w-3.5 h-3.5 mr-1" /> Pausar
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" data-testid="button-camp-resume">
              <Play className="w-3.5 h-3.5 mr-1" /> Retomar
            </Button>
          )}
          <Button variant="outline" size="sm" data-testid="button-camp-export">
            <Download className="w-3.5 h-3.5 mr-1" /> Exportar
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5">
        <div className="grid grid-cols-5 gap-2.5">
          {kpis.map((k, i) => (
            <Card key={i} className="p-3 text-center" data-testid={`stat-detail-${i}`}>
              <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mx-auto mb-1`}>
                <k.icon className={`w-4 h-4 ${k.color}`} />
              </div>
              <div className="text-lg font-bold text-foreground">{k.val}</div>
              <div className="text-[10.5px] text-muted-foreground">{k.label}</div>
              <div className={`text-[11px] font-bold ${k.color}`}>{k.pct}</div>
            </Card>
          ))}
        </div>

        <Card className="p-4" data-testid="card-delivery-funnel">
          <div className="text-[13px] font-semibold mb-3.5">Funil de Entrega</div>
          {funnel.map((row, i) => (
            <div key={i} className="flex items-center gap-2.5 mb-2">
              <div className="w-[120px] text-[11.5px] text-muted-foreground flex-shrink-0">{row.label}</div>
              <div className="flex-1 h-[22px] bg-muted/30 rounded overflow-hidden">
                <div
                  className={`h-full ${row.color} rounded flex items-center pl-2 transition-all duration-500`}
                  style={{ width: `${row.pct}%` }}
                >
                  <span className="text-[10px] font-bold text-white whitespace-nowrap">
                    {row.val.toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>
              <div className={`w-10 text-right text-[11px] font-bold`} style={{ color: "inherit" }}>{row.pct}%</div>
            </div>
          ))}
        </Card>

        <Card className="p-4" data-testid="card-campaign-config">
          <div className="text-[13px] font-semibold mb-3">Configuração da Campanha</div>
          <div className="grid grid-cols-3 gap-2.5">
            {configItems.map((f, i) => (
              <div key={i} className="p-2.5 bg-muted/20 rounded-lg">
                <div className="text-[9.5px] font-bold text-muted-foreground mb-0.5 uppercase">{f.l}</div>
                <div className="text-xs font-bold">{f.v}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function CampaignCreate({
  step,
  setStep,
  draft,
  setDraft,
  onBack,
  onSubmit,
  isSubmitting,
  embedded,
}: {
  step: number;
  setStep: (s: number) => void;
  draft: CampDraft;
  setDraft: (d: CampDraft) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  embedded?: boolean;
}) {
  const steps = ["Conexão", "Mensagem", "Público", "Ritmo de Envio", "Revisão"];

  const estimatedContacts = { all: 3241, tag: 847, segment: 512, manual: 25 };
  const audienceCount = estimatedContacts[draft.audienceType as keyof typeof estimatedContacts] || 1284;
  const estimatedMinutes = Math.ceil(audienceCount / (draft.ratePerMinute || 30));

  const canAdvance = step === 1 ? !!draft.connectionId : true;

  return (
    <div className={embedded ? "flex-1 flex flex-col overflow-hidden" : "min-h-full flex flex-col"} data-testid="page-campaign-create">
      <div className="px-5 py-3 border-b bg-card flex items-center gap-3 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-create-back">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Voltar
        </Button>
        <div className="text-sm font-semibold">Nova Campanha</div>
      </div>

      <div className="px-6 py-3.5 border-b bg-card flex items-center gap-0 flex-shrink-0">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-1 last:flex-initial">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${
                i + 1 === step
                  ? "bg-primary text-primary-content"
                  : i + 1 < step
                  ? "bg-success text-success-content"
                  : "bg-base-200 text-base-content/60"
              }`}
            >
              {i + 1 < step ? <Check className="w-3 h-3" /> : i + 1}
            </div>
            <span className={`text-[10.5px] ${i + 1 === step ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-border mx-1.5" />}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[560px] mx-auto">
          {step === 1 && <StepConnection draft={draft} setDraft={setDraft} />}
          {step === 2 && <StepMessage draft={draft} setDraft={setDraft} />}
          {step === 3 && <StepAudience draft={draft} setDraft={setDraft} audienceCount={audienceCount} />}
          {step === 4 && <StepRateLimit draft={draft} setDraft={setDraft} audienceCount={audienceCount} estimatedMinutes={estimatedMinutes} />}
          {step === 5 && <StepReview draft={draft} audienceCount={audienceCount} />}
        </div>

        <div className="flex justify-between mt-6 max-w-[560px] mx-auto">
          <Button
            variant="ghost"
            onClick={() => setStep(step - 1)}
            className={step === 1 ? "invisible" : ""}
            data-testid="button-step-prev"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Anterior
          </Button>
          <Button
            onClick={() => {
              if (step === 5) onSubmit();
              else setStep(step + 1);
            }}
            disabled={(step === 5 && isSubmitting) || !canAdvance}
            data-testid="button-step-next"
          >
            {step === 5 ? (
              isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Criando...
                </>
              ) : (
                <>
                  <Rocket className="w-3.5 h-3.5 mr-1" /> Criar Campanha
                </>
              )
            ) : (
              <>
                Próximo <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepConnection({ draft, setDraft }: { draft: CampDraft; setDraft: (d: CampDraft) => void }) {
  const { data: rawConexoes, isLoading } = useQuery<{ ok: boolean; data: Conexao[] }>({
    queryKey: ["/api/conexoes"],
  });
  const conexoes = rawConexoes?.data ?? [];

  if (isLoading) {
    return (
      <div>
        <h3 className="text-[15px] font-semibold mb-1.5">Selecione a conexão</h3>
        <p className="text-xs text-muted-foreground mb-5">Escolha qual conexão WhatsApp será usada para enviar a campanha</p>
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-[72px] w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (conexoes.length === 0) {
    return (
      <div>
        <h3 className="text-[15px] font-semibold mb-1.5">Selecione a conexão</h3>
        <p className="text-xs text-muted-foreground mb-5">Escolha qual conexão WhatsApp será usada para enviar a campanha</p>
        <Card className="p-6 text-center">
          <WifiOff className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma conexão encontrada</p>
          <p className="text-xs text-muted-foreground mt-1">Crie uma conexão WhatsApp na página de Conexões primeiro</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-1.5">Selecione a conexão</h3>
      <p className="text-xs text-muted-foreground mb-5">Escolha qual conexão WhatsApp será usada para enviar a campanha</p>
      <div className="space-y-2">
        {conexoes.map((con) => {
          const isConnected = con.status === "connected";
          const isSelected = draft.connectionId === con.id;
          return (
            <Card
              key={con.id}
              className={`p-4 cursor-pointer transition-all flex items-center gap-3 ${
                isSelected ? "border-primary border-2 bg-primary/5" : "hover:border-primary/30"
              } ${!isConnected ? "opacity-60" : ""}`}
              onClick={() => {
                setDraft({ ...draft, connectionId: con.id, connectionName: con.nome });
              }}
              data-testid={`connection-${con.id}`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isConnected ? "bg-emerald-500/10" : "bg-muted"
              }`}>
                {isConnected ? (
                  <Wifi className="w-5 h-5 text-emerald-500" />
                ) : (
                  <WifiOff className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold truncate">{con.nome}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    isConnected
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {isConnected ? "Conectado" : "Desconectado"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  WhatsApp Evolution
                  {con.telefone && ` · ${con.telefone}`}
                </div>
              </div>
              {isSelected && (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <Check className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {!draft.connectionId && (
        <div className="mt-3 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Selecione uma conexão para continuar</span>
        </div>
      )}
    </div>
  );
}

function StepMessage({ draft, setDraft }: { draft: CampDraft; setDraft: (d: CampDraft) => void }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-1.5">Mensagem da Campanha</h3>
      <p className="text-xs text-muted-foreground mb-5">Configure o nome e a mensagem que será enviada</p>

      <div className="space-y-3">
        <div>
          <Input
            label="Nome da Campanha"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            data-testid="input-camp-name"
          />
        </div>

        <div>
          <p className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Mensagem</p>
          <div>
            <MessageInput
              value={draft.messageText}
              onChange={(v) => setDraft({ ...draft, messageText: v })}
              placeholder="Digite a mensagem que será enviada para todos os destinatários..."
              rows={5}
              minHeight="120px"
              variables={["nome", "telefone", "empresa"]}
              data-testid="input-camp-message"
            />
          </div>
        </div>

        {draft.messageText && (
          <Card className="p-3 bg-primary/5 border-primary/20" data-testid="card-message-preview">
            <div className="text-xs">
              <strong>Prévia da mensagem:</strong>
              <br />
              <span className="text-muted-foreground whitespace-pre-wrap">{draft.messageText}</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function StepAudience({
  draft,
  setDraft,
  audienceCount,
}: {
  draft: CampDraft;
  setDraft: (d: CampDraft) => void;
  audienceCount: number;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-1.5">Segmentação de Público</h3>
      <p className="text-xs text-muted-foreground mb-5">Defina quem receberá esta campanha</p>

      <div className="space-y-3">
        <div>
          <p className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Tipo de público</p>
          <Select
            value={draft.audienceType}
            onValueChange={(v) => setDraft({ ...draft, audienceType: v })}
          >
            <SelectTrigger className="mt-1" data-testid="select-audience-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os contatos com telefone</SelectItem>
              <SelectItem value="tag">Por tag</SelectItem>
              <SelectItem value="segment">Por segmento dinâmico</SelectItem>
              <SelectItem value="manual">Seleção manual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(draft.audienceType === "tag" || draft.audienceType === "segment") && (
          <div>
            <Input label="Tags" placeholder="cliente-ativo, lead-quente, trial..." data-testid="input-tags" />
          </div>
        )}

        <Card className="p-3.5 bg-muted/20" data-testid="card-audience-preview">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Destinatários estimados</span>
            <span className="text-xl font-bold text-base-content" data-testid="text-audience-count">
              {audienceCount.toLocaleString("pt-BR")}
            </span>
          </div>
          <div className="text-[10.5px] text-muted-foreground mt-1">Contatos com número de telefone válido</div>
        </Card>
      </div>
    </div>
  );
}

function StepRateLimit({
  draft,
  setDraft,
  audienceCount,
  estimatedMinutes,
}: {
  draft: CampDraft;
  setDraft: (d: CampDraft) => void;
  audienceCount: number;
  estimatedMinutes: number;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-1.5">Ritmo de Envio e Agendamento</h3>
      <p className="text-xs text-muted-foreground mb-5">Configure o ritmo de envio para evitar bloqueios</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Input
            label="Mensagens por minuto"
            type="number"
            value={draft.ratePerMinute}
            min={1}
            max={80}
            onChange={(e) => setDraft({ ...draft, ratePerMinute: +e.target.value })}
            data-testid="input-rate-per-min"
          />
          <div className="text-[10px] text-muted-foreground mt-0.5">Max: 80/min (limite WhatsApp)</div>
        </div>
        <div>
          <Input
            label="Tamanho do lote"
            type="number"
            value={draft.batchSize}
            min={1}
            max={200}
            onChange={(e) => setDraft({ ...draft, batchSize: +e.target.value })}
            data-testid="input-batch-size"
          />
        </div>
      </div>

      <div className="mt-3">
        <Input
          label="Pausa entre lotes (ms)"
          type="number"
          value={draft.delayMs}
          onChange={(e) => setDraft({ ...draft, delayMs: +e.target.value })}
          data-testid="input-delay-ms"
        />
      </div>

      <Card className="p-3.5 bg-primary/5 border-primary/20 mt-3" data-testid="card-rate-estimate">
        <div className="text-xs font-bold mb-1 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" /> Estimativa para {audienceCount.toLocaleString("pt-BR")} contatos
        </div>
        <div className="text-xs text-muted-foreground">~{estimatedMinutes} minutos de envio</div>
      </Card>

      <div className="mt-4">
        <p className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Agendamento (opcional)</p>
        <div>
          <DateTimeLocalPicker
            value={draft.scheduledAt}
            onChange={(v) => setDraft({ ...draft, scheduledAt: v })}
            data-testid="input-schedule"
          />
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Deixe em branco para lançar imediatamente</div>
      </div>
    </div>
  );
}

function StepReview({ draft, audienceCount }: { draft: CampDraft; audienceCount: number }) {
  const reviewRows = [
    { l: "Conexão", v: draft.connectionName || "Não selecionada" },
    { l: "Nome", v: draft.name || "(sem nome)" },
    { l: "Mensagem", v: draft.messageText ? (draft.messageText.length > 60 ? draft.messageText.slice(0, 60) + "..." : draft.messageText) : "(vazia)" },
    { l: "Público", v: audienceCount.toLocaleString("pt-BR") + " contatos" },
    { l: "Ritmo de envio", v: draft.ratePerMinute + " msg/min · lotes de " + draft.batchSize },
    { l: "Agendamento", v: draft.scheduledAt || "Imediato após criação" },
  ];

  return (
    <div>
      <h3 className="text-[15px] font-semibold mb-3.5 flex items-center gap-2">
        <Check className="w-4 h-4 text-emerald-500" /> Revisão da Campanha
      </h3>
      <div className="flex flex-col gap-2">
        {reviewRows.map((r, i) => (
          <div key={i} className="flex p-2.5 bg-muted/20 rounded-lg gap-3" data-testid={`review-row-${i}`}>
            <div className="w-[110px] text-[11px] font-bold text-muted-foreground flex-shrink-0">{r.l}</div>
            <div className="text-[12.5px] font-bold">{r.v}</div>
          </div>
        ))}
      </div>
      <Card className="p-3 bg-primary/5 border-primary/20 mt-4" data-testid="card-review-warning">
        <div className="text-[11.5px] text-muted-foreground flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <span>
            Após criar, a campanha ficará em <strong>Rascunho</strong>. Você precisará construir o público e então clicar em <strong>Lançar</strong> para iniciar os envios.
          </span>
        </div>
      </Card>
    </div>
  );
}