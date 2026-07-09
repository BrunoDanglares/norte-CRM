import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Calendar, Clock, Send, Plus, X, Search, Trash2, Ban, RefreshCw, User, AlertCircle, CheckCircle2, XCircle, Loader2, FileText, MessageSquare, ShieldCheck, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DateTimeLocalPicker } from "@/components/ui/date-time-picker";
import { MessageInput } from "@/components/ui/message-input";
import { HsmTemplatesSection } from "@/components/hsm-templates-section";

type StatusType = "pending" | "sent" | "failed" | "cancelled";
type DispatchMode = "texto_livre" | "template";
type TemplateVar = { index: number; kind: "token" | "fixed"; value: string };

interface Disparo {
  id: string;
  contactName: string;
  phoneNumber: string;
  messageText: string | null;
  mediaUrl: string | null;
  mediaType: string;
  scheduledAt: string;
  status: StatusType;
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  isRecurring: boolean;
  recurrenceType: string | null;
  recurrencePeriod: number | null;
  recurrenceFrequencyDays: number | null;
  parentDisparoId: string | null;
  dispatchMode?: DispatchMode | null;
  templateName?: string | null;
  category?: string | null;
}

interface LeadOption { id: string; name: string; phone: string; }
interface HsmTemplate { templateName: string; status: string; category: string; language: string; bodyText: string | null; variablesCount: number | null; }

const statusConfig: Record<StatusType, { label: string; color: string; bg: string; icon: any }> = {
  pending: { label: "Agendado", color: "#f59e0b", bg: "#f59e0b15", icon: Clock },
  sent: { label: "Enviado", color: "#22c55e", bg: "#22c55e15", icon: CheckCircle2 },
  failed: { label: "Falhou", color: "#ef4444", bg: "#ef444415", icon: XCircle },
  cancelled: { label: "Cancelado", color: "#6b7280", bg: "#6b728015", icon: Ban },
};

// Tokens do cliente (espelha server/services/disparo-vars.ts). Resolvidos POR
// destinatário no envio (cadastro/ERP). Os de ERP exigem CPF no contato.
const TOKENS: { token: string; label: string }[] = [
  { token: "nome", label: "Nome do cliente" },
  { token: "primeiro_nome", label: "Primeiro nome" },
  { token: "telefone", label: "Telefone" },
  { token: "empresa", label: "Empresa" },
  { token: "saudacao", label: "Saudação (Bom dia/tarde/noite)" },
  { token: "valor", label: "Valor da fatura (ERP)" },
  { token: "vencimento", label: "Vencimento (ERP)" },
  { token: "link_boleto", label: "Link do boleto (ERP)" },
  { token: "linha_digitavel", label: "Linha digitável (ERP)" },
  { token: "pix", label: "PIX copia-e-cola (ERP)" },
  { token: "plano", label: "Plano contratado (ERP)" },
];
// Valores de amostra só pro PREVIEW (no envio real resolve por cliente).
const SAMPLE: Record<string, string> = {
  nome: "João Silva", primeiro_nome: "João", telefone: "(11) 99999-9999",
  empresa: "Sua Empresa", saudacao: "Bom dia", valor: "R$ 99,90",
  vencimento: "10/06/2026", link_boleto: "https://boleto.exemplo/abc",
  linha_digitavel: "34191.79001 01043.510047 91020.150008 1 99990000009990",
  pix: "00020126…BR.GOV.BCB.PIX…6304ABCD", plano: "Plano Premium",
};
const CATEGORIES = [
  { key: "manual", label: "Manual" },
  { key: "cobranca", label: "Cobrança" },
  { key: "boas_vindas", label: "Boas-vindas" },
  { key: "aniversario", label: "Aniversário" },
];
const catLabel = (k?: string | null) => CATEGORIES.find((c) => c.key === k)?.label || "Manual";

export default function DisparosProgramados({ embedded }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [showHsmManager, setShowHsmManager] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | StatusType>("all");
  const [filterCat, setFilterCat] = useState<string>("all");

  // ── Form ──────────────────────────────────────────────────────────────
  const [dispatchMode, setDispatchMode] = useState<DispatchMode>("texto_livre");
  const [category, setCategory] = useState<string>("manual");
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<LeadOption[]>([]);
  const [message, setMessage] = useState("");
  const [templateName, setTemplateName] = useState<string>("");
  const [templateVars, setTemplateVars] = useState<TemplateVar[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrencePeriod, setRecurrencePeriod] = useState<number>(3);
  const [recurrenceFrequencyDays, setRecurrenceFrequencyDays] = useState<number>(30);
  const [formError, setFormError] = useState("");
  const [leadResults, setLeadResults] = useState<LeadOption[]>([]);
  const [showLeadDropdown, setShowLeadDropdown] = useState(false);

  const { data: disparos = [], isLoading } = useQuery<Disparo[]>({
    queryKey: ["/api/disparos-programados"],
  });

  // Templates HSM aprovados (pro modo Template). Carrega ao abrir o modal.
  const { data: tplResp } = useQuery<{ ok: boolean; data: HsmTemplate[] }>({
    queryKey: ["/api/whatsapp-official/templates"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/whatsapp-official/templates"); return r.json(); },
    enabled: showModal,
  });
  const approvedTemplates = useMemo(
    () => (tplResp?.data || []).filter((t) => String(t.status).toUpperCase() === "APPROVED"),
    [tplResp],
  );
  const currentTemplate = useMemo(
    () => approvedTemplates.find((t) => t.templateName === templateName) || null,
    [approvedTemplates, templateName],
  );

  // Ao escolher um template, gera um campo por variável ({{1}}…{{N}}).
  useEffect(() => {
    if (!currentTemplate) { setTemplateVars([]); return; }
    const n = currentTemplate.variablesCount || 0;
    setTemplateVars((prev) =>
      Array.from({ length: n }, (_, i) =>
        prev[i] || { index: i + 1, kind: i === 0 ? "token" : "fixed", value: i === 0 ? "nome" : "" }
      )
    );
  }, [currentTemplate]);

  const searchLeads = useCallback(async (term: string) => {
    if (term.length < 2) { setLeadResults([]); return; }
    try {
      const res = await apiRequest("GET", `/api/leads?search=${encodeURIComponent(term)}`);
      const data = await res.json();
      const leads = (Array.isArray(data) ? data : data.leads || [])
        .filter((l: any) => l.phone || l.telefone)
        .map((l: any) => ({ id: String(l.id), name: l.name || l.nome || l.contactName || "Sem nome", phone: l.phone || l.telefone || "" }));
      setLeadResults(leads);
      setShowLeadDropdown(leads.length > 0);
    } catch { setLeadResults([]); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchLeads(leadSearch), 300);
    return () => clearTimeout(t);
  }, [leadSearch, searchLeads]);

  function addContact(c: LeadOption) {
    setSelectedContacts((prev) => {
      const key = (c.phone || "").replace(/\D/g, "");
      if (prev.some((p) => (p.phone || "").replace(/\D/g, "") === key)) return prev;
      return [...prev, c];
    });
    setLeadSearch(""); setShowLeadDropdown(false); setLeadResults([]);
  }
  function removeContact(id: string) { setSelectedContacts((prev) => prev.filter((p) => p.id !== id)); }

  // Preview do template com valores de amostra (token) ou fixos.
  const templatePreview = useMemo(() => {
    if (!currentTemplate?.bodyText) return "";
    return currentTemplate.bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (full, n) => {
      const v = templateVars.find((x) => x.index === Number(n));
      if (!v) return full;
      if (v.kind === "fixed") return v.value || "‹vazio›";
      return SAMPLE[v.value] || `‹${v.value}›`;
    });
  }, [currentTemplate, templateVars]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (selectedContacts.length === 0) throw new Error("Selecione ao menos um contato");
      if (!scheduledAt) throw new Error("Selecione a data e hora");
      if (new Date(scheduledAt) <= new Date()) throw new Error("A data deve ser no futuro");

      const recipients = selectedContacts.map((c) => ({ leadId: c.id, contactName: c.name, phoneNumber: c.phone }));
      const base: any = {
        recipients, category, scheduledAt,
        isRecurring,
        recurrenceType: isRecurring ? "monthly" : null,
        recurrencePeriod: isRecurring ? Math.max(1, Math.floor((recurrencePeriod * 30) / recurrenceFrequencyDays)) : null,
        recurrenceFrequencyDays: isRecurring ? recurrenceFrequencyDays : null,
      };

      if (dispatchMode === "template") {
        if (!currentTemplate) throw new Error("Selecione um template aprovado");
        if (templateVars.some((v) => !String(v.value || "").trim())) throw new Error("Preencha todas as variáveis do template");
        await apiRequest("POST", "/api/disparos-programados", {
          ...base, dispatchMode: "template",
          templateName: currentTemplate.templateName,
          templateLanguage: currentTemplate.language || "pt_BR",
          templateVariables: templateVars,
        });
      } else {
        if (!message.trim()) throw new Error("Digite a mensagem");
        await apiRequest("POST", "/api/disparos-programados", { ...base, dispatchMode: "texto_livre", messageText: message, mediaType: "text" });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disparos-programados"] });
      toast({ title: `Disparo agendado para ${selectedContacts.length} contato(s)` });
      resetForm(); setShowModal(false);
    },
    onError: (err: any) => setFormError(err.message || "Erro ao criar disparo"),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("PATCH", `/api/disparos-programados/${id}/cancel`, {}); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/disparos-programados"] }); toast({ title: "Disparo cancelado" }); },
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/disparos-programados/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/disparos-programados"] }); toast({ title: "Disparo excluído" }); },
  });

  function resetForm() {
    setDispatchMode("texto_livre"); setCategory("manual");
    setSelectedContacts([]); setLeadSearch(""); setMessage("");
    setTemplateName(""); setTemplateVars([]);
    setScheduledAt(""); setFormError("");
    setIsRecurring(false); setRecurrencePeriod(3); setRecurrenceFrequencyDays(30);
    setLeadResults([]); setShowLeadDropdown(false);
  }

  const filtered = disparos.filter((d) => {
    if (filterStatus !== "all" && d.status !== filterStatus) return false;
    if (filterCat !== "all" && (d.category || "manual") !== filterCat) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return d.contactName.toLowerCase().includes(s) || d.phoneNumber.includes(s) || (d.messageText || "").toLowerCase().includes(s) || (d.templateName || "").toLowerCase().includes(s);
    }
    return true;
  });

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className={embedded ? "space-y-4 flex flex-col" : "p-6 space-y-4"} data-testid="disparos-programados-page">
      {!embedded && (
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-field bg-primary/10 flex items-center justify-center"><Calendar className="w-5 h-5 text-primary" /></div>
          <div>
            <h1 className="text-[16px] font-semibold" data-testid="text-disparos-title">Disparos Programados</h1>
            <p className="text-[11px] text-muted-foreground">Agende mensagens — template oficial (Meta) ou texto livre (WhatsApp Web)</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar disparos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-9 text-sm" data-testid="input-search-disparos" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[150px] h-9 text-sm"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <SelectTrigger className="w-[150px] h-9 text-sm" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="pending">Agendados</SelectItem>
            <SelectItem value="sent">Enviados</SelectItem>
            <SelectItem value="failed">Falhas</SelectItem>
            <SelectItem value="cancelled">Cancelados</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => setShowHsmManager(true)} data-testid="button-gerenciar-hsm">
          <FileText className="w-3.5 h-3.5 mr-1" /> Templates HSM
        </Button>
        <Button size="sm" className="flex-shrink-0" onClick={() => { resetForm(); setShowModal(true); }} data-testid="button-novo-disparo">
          <Plus className="w-3.5 h-3.5 mr-1" /> Novo Disparo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Calendar className="w-10 h-10 opacity-40" />
          <p className="text-sm">Nenhum disparo encontrado</p>
        </div>
      ) : (
        <div className={embedded ? "flex-1 overflow-y-auto space-y-2" : "space-y-2"}>
          {filtered.map((d) => {
            const sc = statusConfig[d.status] || statusConfig.pending;
            const Icon = sc.icon;
            const isTemplate = d.dispatchMode === "template";
            return (
              <div key={d.id} className="flex items-center gap-4 p-4 bg-card border border-border rounded-box hover:border-primary/30 transition-colors" data-testid={`card-disparo-${d.id}`}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: sc.bg }}><Icon className="w-5 h-5" style={{ color: sc.color }} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">{d.contactName}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={isTemplate ? { background: "#16a34a15", color: "#16a34a" } : { background: "#0ea5e915", color: "#0ea5e9" }}>
                      {isTemplate ? <><ShieldCheck className="w-3 h-3" /> Template · Oficial</> : <><MessageSquare className="w-3 h-3" /> Texto · Web</>}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">{catLabel(d.category)}</span>
                    {d.isRecurring && (
                      <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium" style={{ background: "#2563eb15", color: "#2563eb" }} data-testid={`badge-recurring-${d.id}`}>
                        <RefreshCw className="w-3 h-3" /> {d.recurrenceFrequencyDays ? `a cada ${d.recurrenceFrequencyDays}d` : "Mensal"} · {d.recurrencePeriod || 0} restantes
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                    {d.phoneNumber} · {isTemplate ? `📋 ${d.templateName}` : (d.messageText || "(mídia)")}
                    {d.parentDisparoId && <span className="ml-1.5 opacity-60">· série recorrente</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {formatDate(d.scheduledAt)}
                    {d.sentAt && <span className="ml-2">· Enviado: {formatDate(d.sentAt)}</span>}
                  </div>
                  {d.errorMessage && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {d.errorMessage}</div>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {d.status === "pending" && (
                    <button onClick={() => cancelMutation.mutate(d.id)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Cancelar" data-testid={`button-cancel-${d.id}`}><Ban className="w-4 h-4" /></button>
                  )}
                  <button onClick={() => { if (confirm("Excluir este disparo?")) deleteMutation.mutate(d.id); }} className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-rose-600 dark:text-rose-400 transition-colors" title="Excluir" data-testid={`button-delete-${d.id}`}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg p-0 max-h-[90vh] overflow-hidden flex flex-col" data-testid="modal-novo-disparo">
          <DialogHeader className="p-5 pb-0">
            <DialogTitle className="text-base font-bold">Novo Disparo Programado</DialogTitle>
            <DialogDescription className="sr-only">Agendar envio de mensagem</DialogDescription>
          </DialogHeader>
          <div className="p-5 pt-3 space-y-4 overflow-y-auto">
            {/* Modo de envio */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Como enviar</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setDispatchMode("template")}
                  className={`p-3 rounded-lg border text-left transition-colors ${dispatchMode === "template" ? "border-emerald-500 bg-emerald-500/5" : "border-border hover:border-emerald-500/40"}`}
                  data-testid="mode-template">
                  <div className="flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="w-4 h-4 text-emerald-600" /> Template oficial</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">API Oficial (Meta). Envia a qualquer cliente, mesmo fora de 24h.</div>
                </button>
                <button type="button" onClick={() => setDispatchMode("texto_livre")}
                  className={`p-3 rounded-lg border text-left transition-colors ${dispatchMode === "texto_livre" ? "border-sky-500 bg-sky-500/5" : "border-border hover:border-sky-500/40"}`}
                  data-testid="mode-texto">
                  <div className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="w-4 h-4 text-sky-600" /> Texto livre</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">WhatsApp Web (QR Code). Texto livre pelo número conectado.</div>
                </button>
              </div>
            </div>

            {/* Categoria */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Categoria</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-sm" data-testid="select-category"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Contatos (multi) */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Contatos {selectedContacts.length > 0 && <span className="text-muted-foreground font-normal">({selectedContacts.length})</span>}</label>
              {selectedContacts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedContacts.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-muted text-[12px]">
                      <User className="w-3 h-3 text-muted-foreground" /> {c.name}
                      <button onClick={() => removeContact(c.id)} className="hover:text-rose-600 ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input type="text" placeholder="Buscar contato por nome ou telefone..." value={leadSearch}
                  onChange={(e) => setLeadSearch(e.target.value)} onFocus={() => leadResults.length > 0 && setShowLeadDropdown(true)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" data-testid="input-search-lead" />
                {showLeadDropdown && leadResults.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {leadResults.map((lead) => (
                      <button key={lead.id} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted text-left transition-colors" onClick={() => addContact(lead)} data-testid={`lead-option-${lead.id}`}>
                        <User className="w-3.5 h-3.5 text-muted-foreground" /> <span className="font-medium flex-1">{lead.name}</span> <span className="text-xs text-muted-foreground">{lead.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Conteúdo por modo */}
            {dispatchMode === "template" ? (
              <>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Template aprovado</label>
                  {approvedTemplates.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground p-3 rounded-lg border border-dashed border-border flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        Nenhum template aprovado.{" "}
                        <button type="button" onClick={() => { setShowModal(false); setShowHsmManager(true); }} className="text-primary font-medium hover:underline" data-testid="link-abrir-hsm">
                          Criar ou sincronizar em Templates HSM
                        </button>.
                      </span>
                    </div>
                  ) : (
                    <Select value={templateName} onValueChange={setTemplateName}>
                      <SelectTrigger className="h-9 text-sm" data-testid="select-template"><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                      <SelectContent>
                        {approvedTemplates.map((t) => (
                          <SelectItem key={t.templateName} value={t.templateName}>
                            {t.templateName} · {(t.variablesCount || 0)} var · {t.language}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {currentTemplate && (
                  <>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1 mb-1"><FileText className="w-3 h-3" /> Corpo do template</div>
                      <div className="text-[12.5px] whitespace-pre-wrap leading-snug">{currentTemplate.bodyText}</div>
                    </div>

                    {templateVars.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium block">Variáveis</label>
                        {templateVars.map((v, i) => (
                          <div key={v.index} className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold tabular-nums w-9 text-center rounded bg-muted py-1.5">{`{{${v.index}}}`}</span>
                            <Select value={v.kind} onValueChange={(k) => setTemplateVars((p) => p.map((x, j) => j === i ? { ...x, kind: k as any, value: k === "token" ? "nome" : "" } : x))}>
                              <SelectTrigger className="h-9 text-[12px] w-[120px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="token">Token do cliente</SelectItem>
                                <SelectItem value="fixed">Valor fixo</SelectItem>
                              </SelectContent>
                            </Select>
                            {v.kind === "token" ? (
                              <Select value={v.value} onValueChange={(val) => setTemplateVars((p) => p.map((x, j) => j === i ? { ...x, value: val } : x))}>
                                <SelectTrigger className="h-9 text-[12px] flex-1"><SelectValue placeholder="Token" /></SelectTrigger>
                                <SelectContent>{TOKENS.map((t) => <SelectItem key={t.token} value={t.token}>{t.label}</SelectItem>)}</SelectContent>
                              </Select>
                            ) : (
                              <Input value={v.value} onChange={(e) => setTemplateVars((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="Texto fixo" className="h-9 text-[12px] flex-1" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {templatePreview && (
                      <div className="rounded-lg border p-3" style={{ background: "hsl(var(--primary) / 0.06)", borderColor: "hsl(var(--primary) / 0.2)" }}>
                        <div className="text-[10px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1 mb-1"><Eye className="w-3 h-3" /> Pré-visualização (amostra)</div>
                        <div className="text-[12.5px] whitespace-pre-wrap leading-snug">{templatePreview}</div>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Mensagem</label>
                <MessageInput value={message} onChange={setMessage} placeholder="Digite a mensagem que será enviada..." rows={4} variables={["nome", "primeiro_nome", "empresa", "telefone", "saudacao"]} data-testid="input-message" />
              </div>
            )}

            {/* Data/hora */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Data e hora do envio</label>
              <DateTimeLocalPicker value={scheduledAt} onChange={setScheduledAt} data-testid="input-scheduled-at" />
            </div>

            {/* Recorrência */}
            <div>
              <label className="flex items-center justify-between cursor-pointer select-none" onClick={() => setIsRecurring((v) => !v)}>
                <div>
                  <div className="text-sm font-medium">Disparo recorrente</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">Repetir automaticamente em intervalos</div>
                </div>
                <div className="relative flex-shrink-0" style={{ width: 44, height: 24, borderRadius: 12, background: isRecurring ? "hsl(var(--primary))" : "hsl(var(--border))", transition: "background 0.2s" }} data-testid="toggle-recurring">
                  <div style={{ position: "absolute", top: 3, left: isRecurring ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                </div>
              </label>
              {isRecurring && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Frequência de envio</label>
                    <div className="grid grid-cols-5 gap-2">
                      {([7, 15, 30, 60, 90] as const).map((days) => (
                        <button key={days} type="button" onClick={() => setRecurrenceFrequencyDays(days)}
                          className={`px-2 py-2 rounded-lg text-[12px] font-medium border transition-colors ${recurrenceFrequencyDays === days ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`} data-testid={`button-freq-${days}`}>{days}d</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Período ativo (duração total)</label>
                    <div className="grid grid-cols-4 gap-2">
                      {([3, 6, 12, 24] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setRecurrencePeriod(m)}
                          className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${recurrencePeriod === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`} data-testid={`button-period-${m}`}>{m} meses</button>
                      ))}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border flex items-center gap-2 text-sm text-muted-foreground" style={{ background: "hsl(var(--primary) / 0.06)", borderColor: "hsl(var(--primary) / 0.2)" }}>
                    <RefreshCw className="w-4 h-4 text-primary flex-shrink-0" />
                    <span>A cada <strong className="text-foreground">{recurrenceFrequencyDays} dias</strong> durante <strong className="text-foreground">{recurrencePeriod} meses</strong> ({Math.floor((recurrencePeriod * 30) / recurrenceFrequencyDays)} envios).</span>
                  </div>
                </div>
              )}
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {formError}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 p-5 pt-3 border-t border-border">
            <Button variant="outline" onClick={() => setShowModal(false)} className="flex-1" data-testid="button-cancel-form">Cancelar</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="flex-1" data-testid="button-submit-disparo">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Agendar Disparo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gerenciador de Templates HSM — movido da tela de Canais (Bruno 2026-06-11) */}
      <Dialog open={showHsmManager} onOpenChange={setShowHsmManager}>
        <DialogContent className="max-w-2xl p-0 max-h-[90vh] overflow-hidden flex flex-col" data-testid="modal-hsm-manager">
          <DialogHeader className="p-5 pb-3 border-b border-border">
            <DialogTitle className="text-base font-bold">Templates HSM</DialogTitle>
            <DialogDescription className="text-[12px]">Crie, sincronize e gerencie os modelos oficiais aprovados pela Meta usados nos disparos.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto p-5 pt-4">
            <HsmTemplatesSection />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
