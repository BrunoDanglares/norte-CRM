import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { CanalIcon, WhatsAppIcon, InstagramIcon } from "@/components/brand-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CANAIS, formatCurrency, getInitials } from "@/lib/constants";
import { apiRequest, apiFetch, queryClient } from "@/lib/queryClient";
import { getSituationTagColor, SITUATION_LABELS, getSituationLabel, type SituationTagsByPhone } from "@/lib/situation-tags";
import { MetricsBar } from "@/components/pipeline/MetricsBar";
import { StageEmpty } from "@/components/pipeline/StageEmpty";
import { StageColumnHeader } from "@/components/pipeline/StageColumnHeader";
import { ColumnEditorDialog } from "@/components/pipeline/ColumnEditorDialog";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  Plus,
  Search,
  Download,
  Pencil,
  MessageSquare,
  ClipboardList,
  Trash2,
  LayoutList,
  LayoutGrid,
  ArrowUpDown,
  X,
  Settings,
  StickyNote,
  Trash2 as Trash2Icon,
  Clock,
  User as UserIcon,
  ShoppingCart,
  Headphones,
  Upload,
  Loader2,
  CheckCircle,
  FileText,
  Wifi,
  Ticket,
  XCircle,
  Calendar,
  Phone,
  Bot,
  Check,
  Rows3 as Rows3Icon,
  Rows2 as Rows2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { EmptyState } from "@/components/ui/empty-state";
import ContactAvatar from "@/components/ContactAvatar";
import type { Lead, PipelineStage, Pipeline, PipelineColumn, Anotacao } from "@shared/schema";
import ContactProfilePanel from "@/components/ContactProfilePanel";
import HistoryPage from "@/pages/isp/History";
import { AtendimentosTable } from "@/components/central/AtendimentosTable";
import { ConversaDrawer } from "@/components/central/ConversaDrawer";
import type { SortingState, OnChangeFn } from "@tanstack/react-table";

type CrmTab = "pipeline" | "historico";
type ViewMode = "tbl" | "kan";
type SortKey = "nome" | "valor" | null;

function AnotacoesTab({ leads }: { leads: Lead[] }) {
  const [newNote, setNewNote] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<number | "all">("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const { toast } = useToast();

  const filterLeadId = selectedLeadId === "all" ? undefined : selectedLeadId;

  const { data: notesData, isLoading } = useQuery<{ ok: boolean; data: Anotacao[] }>({
    queryKey: ["/api/anotacoes", filterLeadId ? `leadId=${filterLeadId}` : ""],
    queryFn: () =>
      apiFetch(`/api/anotacoes${filterLeadId ? `?leadId=${filterLeadId}` : ""}`),
  });

  const notes = notesData?.data || [];

  const createMutation = useMutation({
    mutationFn: (body: { conteudo: string; leadId?: number }) =>
      apiRequest("POST", "/api/anotacoes", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anotacoes"] });
      setNewNote("");
      toast({ title: "Anotação criada!" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, conteudo }: { id: number; conteudo: string }) =>
      apiRequest("PATCH", `/api/anotacoes/${id}`, { conteudo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anotacoes"] });
      setEditingId(null);
      toast({ title: "Anotação atualizada!" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/anotacoes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anotacoes"] });
      toast({ title: "Anotação removida!" });
    },
  });

  const handleCreate = () => {
    if (!newNote.trim()) return;
    createMutation.mutate({
      conteudo: newNote.trim(),
      leadId: filterLeadId,
    });
  };

  const leadMap = useMemo(() => {
    const m: Record<number, string> = {};
    leads.forEach((l) => { m[l.id] = l.nome; });
    return m;
  }, [leads]);

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="max-w-[720px] mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <select
            className="bg-secondary border border-border rounded-lg py-1.5 px-2.5 text-xs text-foreground outline-none cursor-pointer"
            style={{ width: 200 }}
            value={selectedLeadId}
            onChange={(e) => setSelectedLeadId(e.target.value === "all" ? "all" : parseInt(e.target.value))}
            data-testid="select-anotacoes-lead"
          >
            <option value="all">Todos os leads</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            {notes.length} anotação(ões)
          </span>
        </div>

        <div className="bg-secondary/60 border border-border rounded-xl p-3.5 mb-5">
          <Textarea
            placeholder="Escreva uma nova anotação..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="min-h-[80px] text-xs bg-background/50 border-border mb-2.5"
            data-testid="textarea-new-note"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              className="gradient-accent text-white text-xs font-semibold"
              onClick={handleCreate}
              disabled={createMutation.isPending || !newNote.trim()}
              data-testid="button-save-note"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {createMutation.isPending ? "Salvando..." : "Adicionar anotação"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <StickyNote className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-semibold mb-1">Nenhuma anotação ainda</p>
            <p className="text-xs">Adicione anotações sobre seus contatos acima.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="bg-secondary/40 border border-border rounded-xl p-3.5 group"
                data-testid={`note-card-${note.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <UserIcon className="w-3 h-3" />
                    <span className="font-bold">{note.criadoPorNome || "Usuário"}</span>
                    {note.leadId && leadMap[note.leadId] && (
                      <>
                        <span className="opacity-40">|</span>
                        <span className="text-primary font-semibold">{leadMap[note.leadId]}</span>
                      </>
                    )}
                    <span className="opacity-40">|</span>
                    <Clock className="w-3 h-3" />
                    <span>{note.createdAt ? new Date(note.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { setEditingId(note.id); setEditingContent(note.conteudo); }}
                      data-testid={`button-edit-note-${note.id}`}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => { if (confirm("Remover esta anotação?")) deleteMutation.mutate(note.id); }}
                      data-testid={`button-delete-note-${note.id}`}
                    >
                      <Trash2Icon className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {editingId === note.id ? (
                  <div>
                    <Textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="min-h-[60px] text-xs bg-background/50 border-border mb-2"
                      data-testid={`textarea-edit-note-${note.id}`}
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} data-testid="button-cancel-edit">
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="gradient-accent text-white text-xs"
                        onClick={() => updateMutation.mutate({ id: note.id, conteudo: editingContent })}
                        disabled={updateMutation.isPending}
                        data-testid="button-confirm-edit"
                      >
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{note.conteudo}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Bruno 2026-06-08: cadastro manual de cliente na lista de Clientes.
// Normaliza telefone pro formato armazenado (só dígitos, com DDI). Número BR
// local (10-11 dígitos = DDD + número) ganha 55 na frente pra bater com os
// telefones que chegam do WhatsApp (ex: 559391264650).
function normalizeBrPhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

const catLabels: Record<string, string> = { suporte_tecnico: "Suporte técnico", financeiro: "Financeiro", comercial: "Comercial", geral: "Geral" };
const statusLabels: Record<string, string> = { aberto: "Aberto", em_andamento: "Em andamento", aguardando_cliente: "Aguardando cliente", resolvido: "Finalizado", fechado: "Fechado" };
// Bruno 2026-05-21: 'resolvido' (Finalizado) era #5DCAA5 verde fixo; agora primary do tema.
const statusColors: Record<string, string> = { aberto: "#4CB8F0", em_andamento: "hsl(205, 88%, 58%)", aguardando_cliente: "#EF9F27", resolvido: "hsl(var(--primary))", fechado: "hsl(205, 15%, 55%)" };

export default function Leads() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCanal, setFilterCanal] = useState<string>(() => {
    if (typeof window !== "undefined" && window.location.pathname === "/atendimento/clientes") return "whatsapp";
    const params = new URLSearchParams(window.location.search);
    const sub = params.get("subtab") || params.get("tab");
    return sub === "contatos" ? "whatsapp" : "";
  });
  const [pipelineTab, setPipelineTab] = useState("comercial");
  // Bruno 2026-05-18: density toggle persistido em localStorage (lembra a
  // preferência entre navegações). Default 'compact' (Linear-style).
  const [tableDensity, setTableDensity] = useState<'compact' | 'comfortable'>(() => {
    try {
      const saved = localStorage.getItem('leads.tableDensity');
      return saved === 'comfortable' ? 'comfortable' : 'compact';
    } catch { return 'compact'; }
  });
  useEffect(() => {
    try { localStorage.setItem('leads.tableDensity', tableDensity); } catch {}
  }, [tableDensity]);
  // Bruno 2026-05-15: direção do slide entre tabs (Comercial → Suporte → Financeiro)
  // baseada na ordem visual das pills no header. Index maior = entra da direita;
  // menor = entra da esquerda. Respeita prefers-reduced-motion.
  const prevTabIdxRef = useRef(0);
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);
  const prefersReducedMotion = useReducedMotion();
  // Módulo Protocolos removido: a Central só tem a visão de Contatos agora.
  // `historySubTab` permanece pra compat do efeito de rota, mas resolve sempre
  // pra "contatos".
  const [historySubTab, setHistorySubTab] = useState<string>("contatos");
  const [crmTab, setCrmTab] = useState<CrmTab>(() => {
    // Rota /central → sempre Central de Atendimentos.
    // Rota /atendimento/clientes (modo Atendimento) → reusa a view de contatos da Central.
    // Rota /crm → Pipeline por padrão; com ?subtab=... ou ?tab=... antigo, mostra Central (compat).
    if (typeof window !== "undefined") {
      if (window.location.pathname === "/central") return "historico";
      if (window.location.pathname === "/atendimento/clientes") return "historico";
    }
    const params = new URLSearchParams(window.location.search);
    const t = params.get("subtab") || params.get("tab");
    if (t === "contatos" || t === "historico" || t === "protocolos") return "historico";
    return "pipeline";
  });

  // Bruno 2026-05-19: modal antigo (Dialog + showModal + editingLead) removido.
  // Edição agora é exclusiva via ContactProfilePanel (drawer lateral direito,
  // setado em setProfileLead). Mantém-se apenas createMutation/updateMutation/
  // deleteMutation pra uso de outros caminhos (drawer pode salvar via
  // updateMutation; deleteMutation via onDelete na tabela).
  const [profileLead, setProfileLead] = useState<Lead | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [fadingCards, setFadingCards] = useState<Set<number>>(new Set());
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [landingId, setLandingId] = useState<number | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const touchDragRef = useRef<{ leadId: number; ghost: HTMLElement | null; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean; pointerId: number } | null>(null);
  const dragHappened = useRef(false);
  const { toast } = useToast();
  const [location, navigate] = useLocation();

  // Sincroniza estado com a rota atual (sidebar pode trocar /crm <-> /central).
  useEffect(() => {
    if (location === "/atendimento/clientes") {
      // Modo Atendimento reusa a view de contatos da Central — força historico+contatos.
      if (crmTab !== "historico") setCrmTab("historico");
      if (historySubTab !== "contatos") setHistorySubTab("contatos");
      if (filterCanal !== "whatsapp") setFilterCanal("whatsapp");
    } else if (location === "/central") {
      if (crmTab !== "historico") setCrmTab("historico");
      // Sincroniza sub-tab e filtro de canal com a URL.
      // Central agora é só Contatos (Protocolos removido).
      if (historySubTab !== "contatos") setHistorySubTab("contatos");
      if (filterCanal !== "whatsapp") setFilterCanal("whatsapp");
    } else if (location === "/crm") {
      const params = new URLSearchParams(window.location.search);
      const oldTab = params.get("tab");
      // Migra URLs antigas /crm?tab=... → /central (só Contatos hoje).
      if (oldTab === "historico" || oldTab === "contatos" || oldTab === "protocolos") {
        navigate(`/central?subtab=contatos`, { replace: true });
        return;
      }
      if (crmTab !== "pipeline") {
        setCrmTab("pipeline");
        setFilterCanal("");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const handleWsSituationTagApplied = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads/situation-tags"] });
  }, []);

  // Handler quando backend move card pra final stage (finalizado): ativa o
  // fade-out 2s antes de remover visualmente, igual ao drag manual.
  const handleWsLeadStageUpdated = useCallback((payload: any) => {
    const toStage = payload?.toStage || payload?.stageKey || '';
    const leadId = payload?.leadId;
    const isFinal = typeof toStage === 'string' && /ativado|perdido|resolvido|escalado|cancelado|inadimplente|fechado|finalizado/i.test(toStage);
    if (isFinal && typeof leadId === 'number') {
      setFadingCards((prev) => new Set(prev).add(leadId));
      setTimeout(() => {
        setFadingCards((prev) => { const n = new Set(prev); n.delete(leadId); return n; });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      }, 2000);
    } else {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    }
  }, []);

  // Backend arquivou o lead (ex.: conversa mudou de setor — UMA conversa só
  // pode estar em UM Kanban). Remove card imediatamente.
  const handleWsLeadArchived = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
  }, []);

  useWebSocket({
    situation_tag_applied: handleWsSituationTagApplied,
    conversation_updated: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    }, []),
    lead_stage_updated: handleWsLeadStageUpdated,
    lead_archived: handleWsLeadArchived,
  });

  const { data: integConfigData } = useQuery<{ ok: boolean; data: Record<string, { enabled: boolean; config: any }> }>({ queryKey: ["/api/integrations/config"] });
  const ispEnabled = integConfigData?.data?.isp?.enabled === true;

  const effectiveCrmTab = (!ispEnabled && crmTab === "historico") ? "pipeline" : crmTab;
  const isContatosView = effectiveCrmTab === "historico" && historySubTab === "contatos";
  const viewMode: ViewMode = isContatosView ? "tbl" : "kan";

  const [drawerConvId, setDrawerConvId] = useState<number | null>(null);

  const openConversation = async (lead: Lead) => {
    try {
      const res = await apiRequest("POST", "/api/conversations/find-or-create", {
        nome: lead.nome,
        telefone: lead.telefone || lead.contato,
        canal: lead.canal || "WhatsApp",
        instagramUsername: lead.instagramUsername || undefined,
      });
      const data = await res.json();
      if (data.ok && data.data?.id) {
        setDrawerConvId(data.data.id);
      } else {
        toast({ title: "Erro", description: "Não foi possível abrir a conversa", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erro", description: "Falha ao conectar com o servidor", variant: "destructive" });
    }
  };

  const [annotationLeadId, setAnnotationLeadId] = useState<number | null>(null);
  const [annotationText, setAnnotationText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (annotationLeadId !== null && !target.closest(`[data-testid='annotation-popover-${annotationLeadId}']`) && !target.closest(`[data-testid='button-annotation-${annotationLeadId}']`)) {
        setAnnotationLeadId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [annotationLeadId]);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // Bruno 2026-06-08: cadastro manual de cliente direto na lista de Clientes.
  const [showCreateModal, setShowCreateModal] = useState(false);
  const emptyNewClient = { nome: "", telefone: "", email: "", empresa: "", notas: "" };
  const [newClient, setNewClient] = useState(emptyNewClient);
  // Editor de colunas do funil (add/rename/cor/reorder/remove).
  const [showColumnEditor, setShowColumnEditor] = useState(false);

  const { data: allLeads = [], isLoading, isFetching, error: leadsError, refetch: refetchLeads } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
    queryFn: () => apiFetch("/api/leads?limit=500"),
    refetchInterval: 15000,
  });

  const { data: pipelineList = [] } = useQuery<Pipeline[]>({
    queryKey: ["/api/pipelines"],
  });

  useEffect(() => {
    if (pipelineList.length > 0) {
      const activePipelines = pipelineList.filter(p => p.active !== false);
      const currentIsActive = activePipelines.some(p => p.key === pipelineTab);
      if (!currentIsActive && activePipelines.length > 0) {
        setPipelineTab(activePipelines[0].key);
      }
    }
  }, [pipelineList]);

  const { data: situationTagsRaw = {} } = useQuery<Record<string, { code: string; slug: string }[]>>({
    queryKey: ["/api/leads/situation-tags"],
    refetchInterval: 15000,
  });
  const situationTagsByPhone = useMemo(() => {
    const out: Record<string, { code: string; slug: string }[]> = {};
    for (const [phone, tags] of Object.entries(situationTagsRaw)) {
      out[phone] = tags;
      const norm = phone.replace(/\D/g, "");
      if (norm !== phone && !out[norm]) out[norm] = tags;
    }
    return out;
  }, [situationTagsRaw]);

  const { data: avatarMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/conversations/avatar-map"],
    refetchInterval: 60000,
  });

  // Módulo Protocolos removido: o pipeline não depende mais de /api/protocols.
  // A relevância da coluna passa a ser gated apenas por conversa aberta
  // (phonesWithOpenConv) e os cards caem pra prioridade do próprio lead.
  const protocolsByPhone: Record<string, any[]> = {};

  const { data: allConversations = [] } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 15000,
  });

  // Phones that have at least one open (non-resolved) conversation
  const phonesWithOpenConv = useMemo(() => {
    const set = new Set<string>();
    for (const c of allConversations) {
      if (c.status !== "resolved" && c.telefone) {
        set.add(c.telefone);
        set.add(c.telefone.replace(/\D/g, ""));
      }
    }
    return set;
  }, [allConversations]);

  const leads = useMemo(() => {
    const matchPipelineFilter = (lp: string) =>
      pipelineTab === "comercial" ? (lp === "comercial" || lp === "vendas" || !lp) : lp === pipelineTab;

    const candidates = allLeads.filter((l) => {
      if ((l as any).archivedAt) return false;
      const lp = ((l as any).pipeline || "").toLowerCase();
      if (!matchPipelineFilter(lp)) return false;
      if (!l.telefone) return false;
      const norm = l.telefone.replace(/\D/g, "");
      // Funil de vendas: deal parado MANUALMENTE numa coluna (display_column)
      // permanece visível mesmo sem conversa aberta — o vendedor decide quando
      // movê-lo. Só os cards que seguem o bot somem quando a conversa encerra.
      if ((l as any).displayColumn) return true;
      // Hide cards whose conversations are all resolved (no open conversation for this phone)
      if (allConversations.length > 0 && !phonesWithOpenConv.has(l.telefone) && !phonesWithOpenConv.has(norm)) return false;
      return true;
    });

    // Deduplicate: per phone on this tab, keep only the most recently active lead
    // (protects against the system creating multiple leads for the same contact)
    const seen = new Map<string, typeof candidates[0]>();
    for (const l of candidates) {
      const phoneKey = (l.telefone || "").replace(/\D/g, "");
      const existing = seen.get(phoneKey);
      const lDate = new Date((l as any).updatedAt || (l as any).createdAt || 0).getTime();
      const eDate = existing ? new Date((existing as any).updatedAt || (existing as any).createdAt || 0).getTime() : 0;
      if (!existing || lDate > eDate) seen.set(phoneKey, l);
    }
    const result = [...seen.values()];
    return result;
  }, [allLeads, pipelineTab, phonesWithOpenConv, allConversations.length]);

  const { data: igStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/instagram/status"],
  });

  const { data: allStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline-stages", "all"],
    queryFn: async () => {
      return apiFetch(`/api/pipeline-stages`);
    },
  });

  const dbStages = useMemo(() => {
    const tabStages = allStages.filter((s) => s.pipeline === pipelineTab);
    if (tabStages.length > 0) return tabStages;
    // Fallback: use comercial stages when the current pipeline has no dedicated stages
    // (leads in suporte/financeiro already use comercial stage keys)
    return allStages.filter((s) => s.pipeline === "comercial");
  }, [allStages, pipelineTab]);

  // ── Funil de vendas: colunas de EXIBIÇÃO do CRM (camada por cima do backbone) ──
  // O backbone (dbStages) continua sendo a fonte do lead.status que o bot grava;
  // estas colunas decidem ONDE o card aparece e quais estados do bot absorvem.
  const { data: funnelColumns = [] } = useQuery<PipelineColumn[]>({
    queryKey: ["/api/pipeline-columns", pipelineTab],
    queryFn: () => apiFetch(`/api/pipeline-columns?pipeline=${pipelineTab}`),
  });
  const sortedColumns = useMemo(
    () => [...funnelColumns].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
    [funnelColumns],
  );
  // Prefixo universal do bot a partir de um lead.status (tira o sufixo _<8hex>).
  const prefixOf = useCallback((status?: string | null) =>
    (status || "").replace(/_[a-f0-9]{8}$/, ""), []);
  // Resolve a stageKey universal do backbone para um prefixo (ex: 'novo' → 'novo_ab12cd34').
  const universalKeyFor = useCallback((prefix: string): string | null => {
    const s = dbStages.find((st) => prefixOf(st.key) === prefix);
    return s?.key || null;
  }, [dbStages, prefixOf]);
  // Primeira coluna não-terminal (destino dos órfãos — normalmente "Novo").
  const firstNonTerminalKey = useMemo(() => {
    const c = sortedColumns.find((col) => !col.isTerminal) || sortedColumns[0];
    return c?.key || null;
  }, [sortedColumns]);
  // Decide em QUAL coluna o card aparece (precedência: parking manual → estado
  // do bot → órfão na primeira coluna).
  const columnKeyForLead = useCallback((lead: Lead): string | null => {
    const dc = (lead as any).displayColumn;
    if (dc && sortedColumns.some((c) => c.key === dc)) return dc;
    const prefix = prefixOf(lead.status);
    const auto = sortedColumns.find((c) => (c.autoStates || []).includes(prefix));
    if (auto) return auto.key;
    return firstNonTerminalKey;
  }, [sortedColumns, prefixOf, firstNonTerminalKey]);

  const { data: leadAnnotationsData } = useQuery<{ ok: boolean; data: Anotacao[] }>({
    queryKey: ["/api/anotacoes", annotationLeadId ? `leadId=${annotationLeadId}` : ""],
    queryFn: () =>
      apiFetch(`/api/anotacoes${annotationLeadId ? `?leadId=${annotationLeadId}` : ""}`),
    enabled: annotationLeadId !== null,
  });
  const leadAnnotations = leadAnnotationsData?.data || [];

  const { data: allAnnotationsData } = useQuery<{ ok: boolean; data: Anotacao[] }>({
    queryKey: ["/api/anotacoes", "all"],
    queryFn: () =>
      apiFetch(`/api/anotacoes`),
    enabled: viewMode === "tbl",
  });
  const allAnnotationsMap = useMemo(() => {
    const m: Record<number, number> = {};
    (allAnnotationsData?.data || []).forEach((a) => {
      if (a.leadId) m[a.leadId] = (m[a.leadId] || 0) + 1;
    });
    return m;
  }, [allAnnotationsData]);


  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/leads/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Contato removido!" });
    },
  });

  // Bruno 2026-06-08: cria cliente manualmente (nome + telefone obrigatórios).
  const createClientMutation = useMutation({
    mutationFn: async (data: typeof emptyNewClient) => {
      const tel = normalizeBrPhone(data.telefone);
      const body: Record<string, any> = {
        nome: data.nome.trim(),
        contato: tel || data.nome.trim(),
        telefone: tel || null,
        canal: "WhatsApp",
      };
      if (data.email.trim()) body.email = data.email.trim();
      if (data.empresa.trim()) body.empresa = data.empresa.trim();
      if (data.notas.trim()) body.notas = data.notas.trim();
      const r = await apiRequest("POST", "/api/leads", body);
      return r.json();
    },
    onSuccess: (lead: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setShowCreateModal(false);
      setNewClient(emptyNewClient);
      // Garante que o novo cliente fique visível na aba WhatsApp.
      setFilterCanal("whatsapp");
      setSearch("");
      setCurrentPage(1);
      toast({ title: "Cliente cadastrado!", description: lead?.nome ? `${lead.nome} foi adicionado.` : undefined });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao cadastrar cliente", description: e?.message || String(e), variant: "destructive" });
    },
  });


  // Arraste manual de um card pra uma COLUNA do funil (targetColKey = pipeline_columns.key).
  // 3 caminhos: terminal (arquiva), manual (estaciona via display_column), automática
  // (volta a seguir o bot via status universal, com guard anti-regressão).
  const handleDrop = (leadId: number, targetColKey: string) => {
    const col = sortedColumns.find((c) => c.key === targetColKey);
    if (!col) return;
    const lead = (allLeads as Lead[]).find((l) => l.id === leadId);
    if (!lead) return;
    if (columnKeyForLead(lead) === col.key) return; // já está aqui — no-op

    const prev = queryClient.getQueryData<Lead[]>(["/api/leads"]);
    const optimistic = (patch: Partial<Lead>) =>
      queryClient.setQueryData<Lead[]>(["/api/leads"], (old) =>
        old ? old.map((l) => (l.id === leadId ? { ...l, ...patch } : l)) : []);
    const rollback = () => {
      if (prev) queryClient.setQueryData(["/api/leads"], prev);
      setFadingCards((p) => { const n = new Set(p); n.delete(leadId); return n; });
      toast({ title: "Erro ao mover card", variant: "destructive" });
    };

    // 1) TERMINAL (Ganho/Perdido): finaliza no bot + arquiva com o motivo certo.
    if (col.isTerminal) {
      const finalKey = universalKeyFor("finalizado");
      const body: any = finalKey ? { status: finalKey, displayColumn: col.key } : { displayColumn: col.key };
      optimistic(body);
      setFadingCards((p) => new Set(p).add(leadId));
      setTimeout(() => {
        setFadingCards((p) => { const n = new Set(p); n.delete(leadId); return n; });
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      }, 2000);
      apiRequest("PATCH", `/api/leads/${leadId}`, body)
        .then(() => {
          apiRequest("PATCH", `/api/history/leads/${leadId}/archive`, { reason: col.terminalReason || "finalizado" }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
        })
        .catch(rollback);
      toast({ title: `Card movido para ${col.label}` });
      return;
    }

    // 2) NÃO-TERMINAL (automática OU manual): REGRA DE OURO — o arraste no funil
    // NUNCA mexe no lead.status (estado operacional do bot). Assim o board é
    // impossível de "liberar o bot por cima do humano" ou des-finalizar. Só
    // ajusta o display_column (posição manual no funil):
    //   - se o estado atual do bot já pertence a esta coluna → display_column=null
    //     (o card volta a SEGUIR o bot naturalmente nesta coluna automática);
    //   - senão → estaciona o card aqui (display_column = col.key).
    const currentPrefix = prefixOf(lead.status);
    const followsBotHere = (col.autoStates || []).includes(currentPrefix);
    const body: any = { displayColumn: followsBotHere ? null : col.key };
    optimistic(body);
    apiRequest("PATCH", `/api/leads/${leadId}`, body)
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/leads"] }))
      .catch(rollback);
    toast({ title: `Card movido para ${col.label}` });
  };

  // Bruno 2026-05-18: dedup por telefone — cada contato aparece UMA vez.
  // A tabela `leads` no banco tem 1 row por interação/conversa (Bruno
  // pode aparecer 50x se chamou 50x). Aqui consolidamos: telefone único,
  // mantém o lead MAIS RECENTE (allLeads já vem ordenado desc createdAt).
  // Fallback pra leads sem telefone: dedup por nome+email.
  const dedupedLeads = useMemo(() => {
    const seen = new Map<string, Lead>();
    for (const lead of allLeads) {
      const phoneKey = (lead.telefone || '').replace(/\D/g, '');
      const key = phoneKey || `_noplhone_${(lead.nome || '').toLowerCase()}|${(lead.email || '').toLowerCase()}|${lead.id}`;
      if (!seen.has(key)) seen.set(key, lead);
    }
    return Array.from(seen.values());
  }, [allLeads]);
  const contactsSource = viewMode === "tbl" ? dedupedLeads : leads;
  const filtered = contactsSource
    .filter((l) => {
      const q = search.toLowerCase().trim();
      if (q) {
        const keywords = q.split(/\s+/).filter(Boolean);
        const haystack = [
          l.nome,
          l.contato,
          l.telefone || "",
          (l.telefone || "").replace(/\D/g, ""),
          l.email || "",
          l.empresa || "",
          l.canal || "",
          l.status || "",
          ...(l.tags || []),
          l.notas || "",
        ].join(" ").toLowerCase();
        const matchSearch = keywords.every((kw) => haystack.includes(kw));
        if (!matchSearch) return false;
      }
      const matchStatus = !filterStatus || l.status === filterStatus;
      const matchCanal = !filterCanal || (filterCanal === "whatsapp" ? l.canal?.toLowerCase().startsWith("whatsapp") : l.canal?.toLowerCase() === filterCanal);
      return matchStatus && matchCanal;
    })
    .sort((a, b) => {
      if (!sortKey) return 0;
      if (sortKey === "valor") {
        return sortAsc
          ? (Number(a.valor) || 0) - (Number(b.valor) || 0)
          : (Number(b.valor) || 0) - (Number(a.valor) || 0);
      }
      return sortAsc
        ? a.nome.localeCompare(b.nome)
        : b.nome.localeCompare(a.nome);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedLeads = viewMode === "tbl" ? filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : filtered;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // Bridge TanStack SortingState <-> sort externo (sortKey/sortAsc).
  // Mantém parent como source of truth (pipeline kanban também ordena).
  const tableSorting: SortingState = sortKey ? [{ id: sortKey, desc: !sortAsc }] : [];
  const handleTableSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(tableSorting) : updater;
    if (next.length === 0) { setSortKey(null); return; }
    const s = next[0];
    setSortKey(s.id as SortKey);
    setSortAsc(!s.desc);
  };

  const handleExportContacts = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("flowcrm_token");
      const res = await fetch("/api/contacts/export", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Erro ao exportar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contatos_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exportação concluída" });
    } catch (e: any) {
      toast({ title: "Erro na exportação", description: e.message, variant: "destructive" });
    } finally { setExporting(false); }
  };

  const handleImportContacts = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const token = localStorage.getItem("flowcrm_token");
      const fd = new FormData();
      fd.append("file", importFile);
      const res = await fetch("/api/contacts/import", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Erro ao importar");
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Importação concluída", description: `${data.imported} novos, ${data.updated} atualizados` });
    } catch (e: any) {
      toast({ title: "Erro na importação", description: e.message, variant: "destructive" });
    } finally { setImporting(false); }
  };

  const exportCSV = () => {
    const headers = ["Nome", "Contato", "Email", "Telefone", "Empresa", "Status", "Canal", "Owner"];
    const rows = leads.map((l) => [
      l.nome, l.contato, l.email || "", l.telefone || "", l.empresa || "",
      l.status, l.canal, l.owner || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-4 h-full overflow-y-auto">
        <Skeleton className="h-6 w-32" />
        <div className="flex gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-32" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
      </div>
    );
  }

  // Funil: agrupa os leads visíveis por coluna (precedência em columnKeyForLead).
  const leadsByColumn: Record<string, Lead[]> = {};
  for (const c of sortedColumns) leadsByColumn[c.key] = [];
  for (const l of filtered) {
    const k = columnKeyForLead(l as Lead);
    if (k && leadsByColumn[k]) leadsByColumn[k].push(l as Lead);
    else if (sortedColumns[0]) leadsByColumn[sortedColumns[0].key].push(l as Lead);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {effectiveCrmTab === "historico" && (
        <div className="flex-1 overflow-hidden flex flex-col" data-testid="tab-historico-content">
          <HistoryPage
            contatosOnly={location === "/atendimento/clientes"}
            contatosContent={
              <div className="flex flex-col h-full">
                <div
                  className="flex items-center gap-3 flex-shrink-0 border-b border-border"
                  style={{ padding: "10px 18px" }}
                  data-testid="toolbar-leads"
                >
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Buscar nome, telefone, tag, canal..."
                      className="w-full bg-base-200 border border-base-200 rounded-field py-1.5 pl-8 pr-7 text-[11px] text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/60"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                      data-testid="input-search-leads"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        data-testid="button-clear-search"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="flex-shrink-0 gradient-accent text-white"
                    onClick={() => { setNewClient(emptyNewClient); setShowCreateModal(true); }}
                    data-testid="button-new-client"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Novo cliente
                  </Button>
                  <div className="relative">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="flex-shrink-0" data-testid="button-more-actions">
                          <Settings className="w-3.5 h-3.5 mr-1" /> Ações
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => { setShowImportModal(true); setImportFile(null); setImportResult(null); }} data-testid="button-import-csv">
                          <Upload className="w-3.5 h-3.5 mr-2" /> Importar CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={exportCSV} disabled={exporting} data-testid="button-export-csv">
                          {exporting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-2" />}
                          Exportar CSV
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-b border-base-200 flex-shrink-0 px-2 py-1.5">
                  <div className="inline-flex flex-wrap gap-1" role="tablist">
                  {[
                    { key: "whatsapp", label: "WhatsApp", count: contactsSource.filter((l) => l.canal?.toLowerCase().startsWith("whatsapp")).length, Icon: WhatsAppIcon },
                    ...(igStatus?.connected ? [{ key: "instagram", label: "Instagram", count: contactsSource.filter((l) => l.canal?.toLowerCase() === "instagram").length, Icon: InstagramIcon }] : []),
                  ].map((tab) => {
                    const isActive = filterCanal === tab.key;
                    // Redesign Norte: pílula seg-tab (ativa = azul sólido bg-primary),
                    // igual às demais abas do CRM. Antes era underline (border-b-2).
                    return (
                      <button
                        key={tab.key}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => { setFilterCanal(isActive ? "" : tab.key); setCurrentPage(1); }}
                        className={`seg-tab ${isActive ? "seg-tab-active" : ""}`}
                        data-testid={`tab-channel-${tab.key}`}
                      >
                        <tab.Icon className="w-3.5 h-3.5" />
                        {tab.label}
                        <span className={`text-[10px] px-1.5 py-0 rounded-full ${isActive ? "bg-primary-content/20 text-primary-content" : "bg-base-200 text-base-content/60"}`}>
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                  </div>
                  {/* Bruno 2026-05-18: density toggle no canto direito da barra de tabs */}
                  <div className="flex items-center">
                    <div className="inline-flex items-center gap-0.5 bg-base-200/60 border border-base-200 rounded-field p-[2px]" data-testid="density-toggle">
                      {(['compact', 'comfortable'] as const).map((d) => {
                        const active = tableDensity === d;
                        const Icon = d === 'compact' ? Rows3Icon : Rows2Icon;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setTableDensity(d)}
                            className={`h-6 w-6 rounded inline-flex items-center justify-center transition-all ${
                              active
                                ? 'bg-foreground text-background'
                                : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
                            }`}
                            title={d === 'compact' ? 'Linhas compactas' : 'Linhas confortáveis'}
                            aria-pressed={active}
                            data-testid={`density-${d}`}
                          >
                            <Icon className="w-3 h-3" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-auto">
                  <AtendimentosTable
                    leads={paginatedLeads}
                    sorting={tableSorting}
                    onSortingChange={handleTableSortingChange}
                    density={tableDensity}
                    onSelectLead={(lead) => setProfileLead(lead)}
                    onOpenChat={(lead) => openConversation(lead)}
                    onDelete={(lead) => { if (confirm("Remover este lead?")) deleteMutation.mutate(lead.id); }}
                    isLoading={isFetching && allLeads.length === 0}
                    error={leadsError ? ((leadsError as any)?.message || "Erro ao carregar contatos") : null}
                    onRetry={() => refetchLeads()}
                    emptyState={
                      search || filterStatus || filterCanal
                        ? <div className="text-center py-12 text-muted-foreground text-sm">Nenhum contato encontrado com esses filtros</div>
                        : <EmptyState icon="👥" title="Nenhum contato ainda" description="Importe contatos ou aguarde novas conversas chegarem pelo WhatsApp ou Instagram." actionLabel="Importar Contatos" onAction={() => navigate("/contatos")} />
                    }
                  />
                </div>
                {filtered.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between px-[18px] py-2.5 border-t border-border flex-shrink-0 bg-secondary/30">
                    <span className="text-[11px] text-muted-foreground">
                      {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} de {filtered.length} contatos
                    </span>
                    <div className="flex items-center gap-1">
                      <button className="px-2.5 py-1 rounded border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" disabled={safePage <= 1} onClick={() => setCurrentPage(safePage - 1)} data-testid="button-page-prev">Anterior</button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                        .reduce<(number | string)[]>((acc, p, idx, arr) => { if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("..."); acc.push(p); return acc; }, [])
                        .map((p, i) =>
                          typeof p === "string" ? (
                            <span key={`ellipsis-${i}`} className="px-1 text-[11px] text-muted-foreground">...</span>
                          ) : (
                            <button key={p} className={`w-7 h-7 rounded text-[11px] font-semibold transition-colors ${p === safePage ? "bg-primary text-primary-content" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} onClick={() => setCurrentPage(p)} data-testid={`button-page-${p}`}>{p}</button>
                          )
                        )}
                      <button className="px-2.5 py-1 rounded border border-border text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" disabled={safePage >= totalPages} onClick={() => setCurrentPage(safePage + 1)} data-testid="button-page-next">Próxima</button>
                    </div>
                  </div>
                )}
              </div>
            }
          />
        </div>
      )}

      {effectiveCrmTab === "pipeline" && (<>
      {viewMode !== "tbl" && (
        <MetricsBar leads={filtered} protocolsByPhone={protocolsByPhone} />
      )}
      {viewMode !== "tbl" && (
        <div className="flex items-center gap-2 px-[18px] py-2 border-b border-border/60 flex-shrink-0" data-testid="pipeline-tabs">
          {(() => {
            const activePipelines = pipelineList.filter((p) => p.active !== false);
            return activePipelines.map((p, idx) => {
            const IconComp = p.icon === "Headphones" ? Headphones : p.icon === "ShoppingCart" ? ShoppingCart : LayoutGrid;
            const isActive = pipelineTab === p.key;
            return (
              <button
                key={p.key}
                className={`seg-tab ${isActive ? "seg-tab-active" : ""}`}
                onClick={() => {
                  if (p.key === pipelineTab) return;
                  // Direção do slide: tab nova à direita da atual → entra da direita (1).
                  // Tab nova à esquerda → entra da esquerda (-1).
                  const newIdx = idx;
                  const oldIdx = prevTabIdxRef.current;
                  setSlideDirection(newIdx > oldIdx ? 1 : -1);
                  prevTabIdxRef.current = newIdx;
                  setPipelineTab(p.key);
                  setFilterStatus("");
                }}
                data-testid={`tab-pipeline-${p.key}`}
              >
                <IconComp className="w-3.5 h-3.5" />
                {p.label}
              </button>
            );
            });
          })()}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto flex-shrink-0 h-7 text-[11px]"
            onClick={() => setShowColumnEditor(true)}
            data-testid="button-manage-columns"
          >
            <Settings className="w-3.5 h-3.5 mr-1" /> Gerenciar colunas
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 relative" style={{ scrollbarWidth: "thin", scrollbarColor: "hsl(var(--border)) transparent" }}>
            {sortedColumns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <p className="text-sm font-medium">Carregando o funil…</p>
                <p className="text-xs">Use "Gerenciar colunas" pra criar as etapas do seu funil de vendas.</p>
              </div>
            ) : (
            <AnimatePresence mode="wait" initial={false} custom={slideDirection}>
            <motion.div
              key={pipelineTab}
              className="flex gap-3 h-full w-full"
              custom={slideDirection}
              variants={prefersReducedMotion ? undefined : {
                // Slide curto (24px) + fade. Suficiente pra dar continuidade
                // sem deixar a tela "andar" demais. Easing ease-out na entrada,
                // ease-in na saída — sensação de "puxa o novo, empurra o velho".
                enter: (dir: 1 | -1) => ({ x: dir * 24, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (dir: 1 | -1) => ({ x: dir * -24, opacity: 0 }),
              }}
              initial={prefersReducedMotion ? { opacity: 0 } : "enter"}
              animate={prefersReducedMotion ? { opacity: 1 } : "center"}
              exit={prefersReducedMotion ? { opacity: 0 } : "exit"}
              transition={{
                x: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
                opacity: { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
              }}
            >
              {(() => {
                return sortedColumns.map((col, stageIdx) => {
                const stageKey = col.key;
                const stageLeads = leadsByColumn[col.key] || [];
                const stageTotal = stageLeads.reduce((a, l) => a + (Number(l.valor) || 0), 0);

                const isDropTarget = overColumn === stageKey && draggingId !== null;
                const isFinalStageColumn = col.isTerminal;
                return (
                  <div
                    key={stageKey}
                    className={`flex-1 min-w-0 h-full flex flex-col border rounded-box overflow-hidden transition-all duration-200 ${isDropTarget ? "kanban-col-drop-target" : "bg-base-200/40 border-base-200"}`}
                    data-testid={`kanban-col-${stageKey}`}
                  >
                    <StageColumnHeader
                      stageKey={stageKey}
                      label={col.label}
                      color={col.color}
                      count={stageLeads.length}
                      gradientIndex={stageIdx}
                      totalStages={sortedColumns.length}
                      isFinal={isFinalStageColumn}
                    />

                    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-[7px] min-h-[80px]">
                      {stageLeads.filter((lead) => {
                        // Colunas terminais (Ganho/Perdido) só mostram o card durante
                        // o fade-out de 2s antes de sumir (o lead é arquivado).
                        if (!isFinalStageColumn) return true;
                        return fadingCards.has(lead.id);
                      }).map((lead) => {
                        const isFinalStage = isFinalStageColumn;
                        const isFading = fadingCards.has(lead.id);
                        const prioColors: Record<string, string> = { alta: "#ef4444", media: "#FED30E", baixa: "#10b981" };
                        const prioKey = (lead as any).prioridade || "media";
                        const leadProtos = lead.telefone ? (protocolsByPhone[lead.telefone] || protocolsByPhone[lead.telefone.replace(/\D/g, "")] || []) : [];
                        const protoPrio = leadProtos.length > 0 ? (leadProtos[0].prioridade || "media") : null;
                        const effectivePrio = protoPrio || prioKey;
                        const spineColor = isFinalStage ? "transparent" : (prioColors[effectivePrio] || prioColors.media);
                        const activeProto = leadProtos.find((p: any) => p.status === "aberto" || p.status === "em_andamento") || leadProtos[0] || null;
                        const displayPhone = lead.telefone || lead.contato || "";

                        const rawPhone = (displayPhone || "").replace(/\D/g, "");
                        const fmtPhone = rawPhone.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, "+$1 ($2) $3-$4") || displayPhone;
                        const avatarUrl = avatarMap[displayPhone] || avatarMap[rawPhone] || (rawPhone.startsWith("55") ? avatarMap[rawPhone.slice(2)] : undefined) || null;

                        const now = Date.now();
                        const lastActivityTs = leadProtos.length > 0 && leadProtos[0].createdAt
                          ? new Date(leadProtos[0].createdAt).getTime()
                          : new Date(lead.createdAt || now).getTime();
                        const diffMs = Math.max(0, now - lastActivityTs);
                        const diffMin = Math.floor(diffMs / 60000);
                        const timeLabel = diffMin < 1 ? "agora" : diffMin < 60 ? `${diffMin}min` : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h` : `${Math.floor(diffMin / 1440)}d`;
                        const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24)) || 1;
                        const isOld = daysSince > 14;

                        const sitTags = lead.telefone ? (situationTagsByPhone[lead.telefone] || situationTagsByPhone[lead.telefone.replace(/\D/g, "")] || []) : [];

                        const isDragging = draggingId === lead.id;
                        const isLanding = landingId === lead.id;
                        return (
                          <div
                            key={lead.id}
                            className={`group relative shrink-0 bg-base-100 border border-base-200 rounded-box select-none overflow-hidden
                              ${isDragging
                                ? "kanban-card-dragging"
                                : isLanding
                                ? "kanban-card-land"
                                : isFading
                                ? "kanban-card-fadeout"
                                : "cursor-grab active:cursor-grabbing hover:-translate-y-[2px] hover:border-base-300 transition-all duration-200"
                              }`}
                            style={{
                              padding: "9px 9px 7px 11px",
                              touchAction: "none",
                              boxShadow: isDragging ? "none" : `inset 3px 0 0 ${spineColor}`,
                            }}
                            onPointerDown={(e) => {
                              if (e.button !== 0 && e.pointerType === "mouse") return;
                              const el = e.currentTarget as HTMLElement;
                              el.setPointerCapture(e.pointerId);
                              const rect = el.getBoundingClientRect();
                              const ox = e.clientX - rect.left;
                              const oy = e.clientY - rect.top;
                              const ghost = el.cloneNode(true) as HTMLElement;
                              // Use transform-only positioning (no top/left reflow) + will-change for GPU compositing
                              ghost.style.cssText = `position:fixed;top:0;left:0;width:${rect.width}px;will-change:transform;transform:translate(${rect.left}px,${rect.top}px) rotate(2.5deg) scale(1.05);border-radius:10px;box-shadow:0 24px 48px rgba(0,0,0,.28),0 8px 16px rgba(0,0,0,.14);pointer-events:none;z-index:99999;opacity:0.92;visibility:hidden;`;
                              document.body.appendChild(ghost);
                              const state = { leadId: lead.id, ghost, startX: e.clientX, startY: e.clientY, ox, oy, moved: false, pointerId: e.pointerId };
                              touchDragRef.current = state as any;

                              const onMove = (ev: PointerEvent) => {
                                if (ev.pointerId !== state.pointerId) return;
                                const dx = ev.clientX - state.startX, dy = ev.clientY - state.startY;
                                if (!state.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
                                if (!state.moved) {
                                  state.moved = true;
                                  ghost.style.visibility = "";
                                  setDraggingId(lead.id);
                                }
                                // GPU-composited transform — no layout recalculation
                                ghost.style.transform = `translate(${ev.clientX - state.ox}px,${ev.clientY - state.oy}px) rotate(2.5deg) scale(1.05)`;
                                const under = document.elementFromPoint(ev.clientX, ev.clientY);
                                const colKey = under?.closest("[data-testid^='kanban-col-']")?.getAttribute("data-testid")?.replace("kanban-col-", "") ?? null;
                                setOverColumn(colKey);
                              };

                              const onUp = (ev: PointerEvent) => {
                                if (ev.pointerId !== state.pointerId) return;
                                el.removeEventListener("pointermove", onMove);
                                el.removeEventListener("pointerup", onUp);
                                el.removeEventListener("pointercancel", onUp);
                                el.releasePointerCapture(ev.pointerId);
                                ghost.remove();
                                touchDragRef.current = null;
                                setDraggingId(null); setOverColumn(null);
                                if (!state.moved) return;
                                dragHappened.current = true;
                                const under = document.elementFromPoint(ev.clientX, ev.clientY);
                                const colKey = under?.closest("[data-testid^='kanban-col-']")?.getAttribute("data-testid")?.replace("kanban-col-", "");
                                if (colKey && colKey !== lead.status) { setLandingId(lead.id); setTimeout(() => setLandingId(null), 500); handleDrop(lead.id, colKey); }
                              };

                              // Native listeners — bypass React batching for maximum responsiveness
                              el.addEventListener("pointermove", onMove);
                              el.addEventListener("pointerup", onUp);
                              el.addEventListener("pointercancel", onUp);
                            }}
                            onClick={() => { if (dragHappened.current) { dragHappened.current = false; return; } setProfileLead(lead); }}
                            data-testid={`kanban-card-${lead.id}`}
                          >
                            {(() => {
                              // Detecta quem está atendendo o card (bot vs humano)
                              // pra mostrar selo discreto no canto superior direito.
                              const statusLower = (lead.status || "").toLowerCase();
                              const isHumanoStage = /humano|atendente|escalad/.test(statusLower);
                              const isDoneStage = isFinalStage;
                              const SeloIcon = isDoneStage ? Check : isHumanoStage ? UserIcon : Bot;
                              const seloTitle = isDoneStage
                                ? "Atendimento finalizado"
                                : isHumanoStage
                                ? "Em atendimento humano"
                                : "Atendimento automático";
                              // Bot = único toque de cor da marca; humano/finalizado = neutro.
                              const isBot = !isDoneStage && !isHumanoStage;

                              return (
                                <span
                                  className="absolute top-2 right-2 flex items-center justify-center w-[15px] h-[15px] rounded-full pointer-events-none"
                                  style={isBot
                                    ? { background: "hsl(var(--primary)/0.16)", color: "var(--banana-700)" }
                                    : { background: "hsl(var(--muted-foreground)/0.10)", color: "hsl(var(--muted-foreground))" }}
                                  title={seloTitle}
                                  data-testid={`lead-actor-${lead.id}`}
                                >
                                  <SeloIcon className="w-[9px] h-[9px]" strokeWidth={2.75} />
                                </span>
                              );
                            })()}

                            <div className="flex items-center gap-1.5 pr-4">
                              <ContactAvatar
                                nome={lead.nome || "?"}
                                fotoUrl={avatarUrl}
                                size={28}
                                rounded="50%"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-[11.5px] font-semibold truncate leading-snug" data-testid={`lead-name-${lead.id}`}>
                                  {lead.nome}
                                </div>
                                {displayPhone && (
                                  <div className="text-[9.5px] text-muted-foreground/70 truncate leading-tight tabular-nums" data-testid={`lead-phone-${lead.id}`}>
                                    {fmtPhone}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Primeira tag em destaque (label completa) + restante chips */}
                            {sitTags.length > 0 && (
                              <div className="mt-2">
                                {(() => {
                                  const primaryTag = sitTags[0];
                                  const tc = getSituationTagColor(primaryTag.code);
                                  const fullLabel = getSituationLabel(primaryTag.code, primaryTag.slug);
                                  return (
                                    <div
                                      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[9.5px] max-w-full bg-muted/50 border border-border/50"
                                      title={`${primaryTag.code} — ${fullLabel}`}
                                    >
                                      <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ backgroundColor: tc.color }} />
                                      <span className="font-semibold tabular-nums text-foreground/85">{primaryTag.code}</span>
                                      <span className="text-muted-foreground truncate">{fullLabel}</span>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            <div className="mt-1.5 flex flex-wrap gap-1" style={{ minHeight: sitTags.length > 1 || activeProto ? "20px" : "0" }}>
                              {activeProto && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium text-muted-foreground/75 bg-muted/40 border border-border/40" style={{ fontFamily: "monospace" }} data-testid={`proto-active-${activeProto.id}`}>
                                  #{activeProto.numero?.replace(/^PRT-/, '')}
                                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: prioColors[activeProto.prioridade] || "var(--banana-500)" }} />
                                </span>
                              )}
                              {sitTags.slice(1, 4).map((t, i) => {
                                const fullLabel = getSituationLabel(t.code, t.slug);
                                return (
                                  <span
                                    key={i}
                                    className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[8px] font-semibold text-foreground/55 bg-muted/40 border border-border/40 cursor-default tabular-nums"
                                    title={`${t.code} — ${fullLabel}`}
                                  >
                                    {t.code}
                                  </span>
                                );
                              })}
                              {sitTags.length > 4 && (
                                <span
                                  className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[8px] font-semibold cursor-default text-muted-foreground/55 bg-muted/40 border border-border/40"
                                  title={`Mais ${sitTags.length - 4} situações`}
                                >
                                  +{sitTags.length - 4}
                                </span>
                              )}
                            </div>

                            <div className={`flex items-center justify-between mt-1.5 pt-1.5 border-t text-[8.5px] ${isOld ? "text-rose-600 dark:text-rose-400 border-red-400/20" : "text-muted-foreground/55 border-border/40"}`}>
                              <span className="flex items-center gap-0.5 tabular-nums">
                                <Calendar className="w-[9px] h-[9px]" />
                                {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString("pt-BR") : "—"}
                              </span>
                              <span
                                className={`font-medium tabular-nums px-1.5 py-0.5 rounded ${isOld ? "font-bold" : ""}`}
                                style={isOld ? { background: "rgba(225,29,72,0.10)" } : {}}
                              >
                                {isOld && "⚠ "}{timeLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {stageLeads.length === 0 && (
                        <StageEmpty stageKey={stageKey} stageLabel={col.label} isDropTarget={isDropTarget} />
                      )}
                      {isDropTarget && stageLeads.length > 0 && (
                        <div className="flex items-center justify-center gap-1.5 py-3 pointer-events-none">
                          {[0, 1, 2].map((i) => (
                            <div
                              key={i}
                              className="w-1.5 h-1.5 rounded-full"
                              style={{
                                background: "var(--banana-500)",
                                animation: `kanban-drop-pulse 0.75s ease-in-out ${i * 0.18}s infinite`,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
              })()}
            </motion.div>
            </AnimatePresence>
            )}
          </div>
      </>)}


      <Dialog open={showImportModal} onOpenChange={(open) => { setShowImportModal(open); if (!open) { setImportFile(null); setImportResult(null); } }}>
        <DialogContent className="max-w-md" data-testid="modal-import-contacts">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4" /> Importar Contatos via CSV
            </DialogTitle>
          </DialogHeader>
          {!importResult ? (
            <>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) setImportFile(e.target.files[0]); }}
                data-testid="input-csv-file"
              />
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${importFile ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/40"}`}
                onClick={() => csvFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f && f.name.endsWith(".csv")) setImportFile(f); }}
                data-testid="dropzone-csv"
              >
                {importFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                    <p className="text-[12.5px] font-semibold text-foreground">{importFile.name}</p>
                    <p className="text-[10.5px] text-muted-foreground">{(importFile.size / 1024).toFixed(1)} KB</p>
                    <button className="text-[10px] text-rose-600 dark:text-rose-400 hover:text-red-300 underline" onClick={(e) => { e.stopPropagation(); setImportFile(null); }} data-testid="button-remove-file">Remover</button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                    <p className="text-[12.5px] font-semibold mb-1">Arraste um arquivo CSV ou clique para selecionar</p>
                    <p className="text-[11px] text-muted-foreground">Formato aceito: .csv (max 5MB)</p>
                  </>
                )}
              </div>
              <div className="bg-muted/30 border border-border rounded-lg p-3 text-[11.5px] text-muted-foreground space-y-1.5">
                <p className="font-bold text-foreground text-[11px] uppercase tracking-wider">Formato esperado:</p>
                <p>nome, empresa, telefone, email, canal, tags, notas</p>
                <p className="text-[10.5px]">Separe tags com ponto-e-vírgula (;). Aceita separador , ou ;</p>
                <p className="text-[10.5px]">Contatos com telefone duplicado serão atualizados automaticamente.</p>
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => setShowImportModal(false)}>Cancelar</Button>
                <Button size="sm" className="gradient-accent text-white" onClick={handleImportContacts} disabled={!importFile || importing} data-testid="button-start-import">
                  {importing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Importando...</> : "Iniciar Importação"}
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-[13px] font-bold text-foreground">Importação concluída!</p>
                  <p className="text-[11px] text-muted-foreground">{importResult.total} linhas processadas</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Novos", value: importResult.imported, color: "text-emerald-600 dark:text-emerald-400" },
                  { label: "Atualizados", value: importResult.updated, color: "text-tertiary-600 dark:text-tertiary-500" },
                  { label: "Ignorados", value: importResult.skipped, color: "text-muted-foreground" },
                  { label: "Erros", value: importResult.errors, color: "text-rose-600 dark:text-rose-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-card border border-border rounded-lg p-3 text-center">
                    <div className={`text-xl font-bold ${color}`}>{value}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              {importResult.errorDetails?.length > 0 && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                  <p className="text-[10.5px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">Detalhes dos erros:</p>
                  {importResult.errorDetails.map((err: string, i: number) => (
                    <p key={i} className="text-[10.5px] text-muted-foreground">{err}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowImportModal(false); setImportFile(null); setImportResult(null); }}>Fechar</Button>
                <Button size="sm" className="gradient-accent text-white" onClick={() => { setImportFile(null); setImportResult(null); }} data-testid="button-import-another">Importar Outro</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bruno 2026-06-08: cadastro manual de cliente */}
      <Dialog open={showCreateModal} onOpenChange={(open) => { setShowCreateModal(open); if (!open) setNewClient(emptyNewClient); }}>
        <DialogContent className="max-w-md" data-testid="modal-new-client">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" /> Novo cliente
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const telDigits = newClient.telefone.replace(/\D/g, "");
            const nomeOk = newClient.nome.trim().length >= 2;
            const telOk = telDigits.length >= 10;
            const normalized = normalizeBrPhone(newClient.telefone);
            const dup = telOk && dedupedLeads.find((l) => (l.telefone || "").replace(/\D/g, "") === normalized);
            const canSubmit = nomeOk && telOk && !dup && !createClientMutation.isPending;
            const submit = () => { if (canSubmit) createClientMutation.mutate(newClient); };
            return (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">Nome <span className="text-rose-500">*</span></label>
                  <Input
                    value={newClient.nome}
                    onChange={(e) => setNewClient((s) => ({ ...s, nome: e.target.value }))}
                    placeholder="Ex: João da Silva"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    data-testid="input-new-client-nome"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">Telefone (WhatsApp) <span className="text-rose-500">*</span></label>
                  <Input
                    value={newClient.telefone}
                    onChange={(e) => setNewClient((s) => ({ ...s, telefone: e.target.value }))}
                    placeholder="(93) 99126-4650"
                    inputMode="tel"
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    data-testid="input-new-client-telefone"
                  />
                  {dup ? (
                    <p className="text-[10.5px] text-amber-600 dark:text-amber-400">Já existe um cliente com esse telefone ({dup.nome}).</p>
                  ) : (
                    <p className="text-[10.5px] text-muted-foreground">Inclua o DDD. O código do país (55) é adicionado automaticamente.</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">E-mail</label>
                    <Input
                      type="email"
                      value={newClient.email}
                      onChange={(e) => setNewClient((s) => ({ ...s, email: e.target.value }))}
                      placeholder="opcional"
                      onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                      data-testid="input-new-client-email"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground">Empresa</label>
                    <Input
                      value={newClient.empresa}
                      onChange={(e) => setNewClient((s) => ({ ...s, empresa: e.target.value }))}
                      placeholder="opcional"
                      onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                      data-testid="input-new-client-empresa"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground">Notas</label>
                  <Textarea
                    value={newClient.notas}
                    onChange={(e) => setNewClient((s) => ({ ...s, notas: e.target.value }))}
                    placeholder="Observações sobre o cliente (opcional)"
                    rows={3}
                    data-testid="input-new-client-notas"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
                  <Button size="sm" className="gradient-accent text-white" onClick={submit} disabled={!canSubmit} data-testid="button-save-new-client">
                    {createClientMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Salvando...</> : "Cadastrar cliente"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <ContactProfilePanel
        open={!!profileLead}
        onClose={() => setProfileLead(null)}
        entity={profileLead as any}
        entityKind="lead"
        onOpenConversation={() => { if (profileLead) openConversation(profileLead); setProfileLead(null); }}
      />

      <ConversaDrawer convId={drawerConvId} onClose={() => setDrawerConvId(null)} />

      <ColumnEditorDialog
        open={showColumnEditor}
        onClose={() => setShowColumnEditor(false)}
        pipeline={pipelineTab}
        columns={funnelColumns}
      />

    </div>
  );
}

