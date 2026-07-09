// client/src/components/hsm-templates-section.tsx
// Gerenciamento de Templates HSM (Meta). Bruno 2026-06-11: movido da tela de
// Canais (WhatsApp Oficial) pra ser usado SÓ no Disparo Programado. Autossuficiente:
// carrega os próprios templates + sincroniza + cria/exclui. Extraído de
// whatsapp-oficial.tsx (componente WhatsappTemplatesSection).
import { useState, useEffect } from "react";
import { RefreshCw, Plus, X, Loader2, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const inputCls = "w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} dias atrás`;
  return new Date(dateStr).toLocaleDateString("pt-BR");
}

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  APPROVED: { label: "Aprovado", bg: "#0f2e23", color: "#5DCAA5" },
  PENDING: { label: "Pendente", bg: "#3a2e10", color: "#EF9F27" },
  REJECTED: { label: "Rejeitado", bg: "#2e1010", color: "#E24B4A" },
  IN_APPEAL: { label: "Em revisão", bg: "#1a2040", color: "#4CB8F0" },
};

const CATEGORY_MAP: Record<string, { label: string; bg: string; color: string }> = {
  UTILITY: { label: "Utilidade", bg: "#1e1540", color: "#8b5cf6" },
  MARKETING: { label: "Marketing", bg: "#3a2e10", color: "#EF9F27" },
  AUTHENTICATION: { label: "Autenticação", bg: "#0f2e23", color: "#5DCAA5" },
};

const LANG_MAP: Record<string, string> = {
  pt_BR: "Português (BR)",
  en_US: "Inglês (EUA)",
  es_ES: "Español",
};

export function HsmTemplatesSection() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    try {
      const res = await apiRequest("GET", "/api/whatsapp-official/templates");
      const data = await res.json();
      setTemplates(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Erro ao carregar templates", variant: "destructive" });
    }
  }

  const onReload = loadTemplates;

  async function onSyncAll() {
    setSyncing(true);
    try {
      const res = await apiRequest("POST", "/api/whatsapp-official/templates/sync");
      const data = await res.json();
      toast({ title: `${data.synced || 0} templates sincronizados` });
      loadTemplates();
    } catch (err: any) {
      toast({ title: err.message || "Erro ao sincronizar", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    templateName: "",
    category: "UTILITY",
    language: "pt_BR",
    headerType: "",
    headerContent: "",
    bodyText: "",
    footerText: "",
  });

  const approved = templates.filter(t => t.status === "APPROVED").length;
  const pending = templates.filter(t => t.status === "PENDING").length;
  const rejected = templates.filter(t => t.status === "REJECTED").length;

  async function handleSyncOne(id: number) {
    setSyncingId(id);
    try {
      await apiRequest("POST", `/api/whatsapp-official/templates/${id}/sync`);
      toast({ title: "Status atualizado" });
      onReload();
    } catch (err: any) {
      toast({ title: err.message || "Erro ao sincronizar", variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDelete(t: any) {
    if (!confirm(`Excluir o template '${t.templateName}'?`)) return;
    setDeletingId(t.id);
    try {
      await apiRequest("DELETE", `/api/whatsapp-official/templates/${t.id}`);
      toast({ title: "Template excluido" });
      onReload();
    } catch (err: any) {
      toast({ title: err.message || "Erro ao excluir", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubmit() {
    if (!form.templateName || !/^[a-z0-9_]+$/.test(form.templateName)) {
      toast({ title: "Nome invalido. Use apenas letras minusculas, numeros e underscores.", variant: "destructive" });
      return;
    }
    if (!form.bodyText) {
      toast({ title: "Corpo da mensagem e obrigatorio", variant: "destructive" });
      return;
    }
    if (form.bodyText.length > 1024) {
      toast({ title: "Corpo da mensagem excede 1024 caracteres", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/whatsapp-official/templates", {
        templateName: form.templateName,
        category: form.category,
        language: form.language,
        headerType: form.headerType || null,
        headerContent: form.headerType === "TEXT" ? form.headerContent : undefined,
        bodyText: form.bodyText,
        footerText: form.footerText || undefined,
      });
      toast({ title: "Template enviado! A Meta leva 24-48h para aprovar." });
      setShowModal(false);
      setForm({ templateName: "", category: "UTILITY", language: "pt_BR", headerType: "", headerContent: "", bodyText: "", footerText: "" });
      onReload();
    } catch (err: any) {
      toast({ title: err.message || "Erro ao criar template", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6" data-testid="section-hsm-templates">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-foreground font-semibold text-base">Templates HSM</h2>
        <div className="flex gap-2">
          <button
            onClick={onSyncAll}
            disabled={syncing}
            className="px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs flex items-center gap-1.5 transition border border-border"
            data-testid="button-sync-all-templates"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar todos"}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs flex items-center gap-1.5 transition font-medium"
            data-testid="button-new-template"
          >
            <Plus className="w-3 h-3" />
            Novo template
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Aprovados", value: approved, color: "#5DCAA5" },
          { label: "Pendentes", value: pending, color: "#EF9F27" },
          { label: "Rejeitados", value: rejected, color: "#E24B4A" },
        ].map(c => (
          <div key={c.label} className="rounded-lg bg-muted/50 p-3 border border-border/50" data-testid={`stat-${c.label.toLowerCase()}`}>
            <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>{c.label}</p>
            <p style={{ fontSize: 22, fontWeight: 600, color: c.color }}>{c.value}</p>
          </div>
        ))}
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-10" data-testid="empty-templates">
          <p className="text-foreground/80 text-sm mb-1">Nenhum template criado ainda.</p>
          <p className="text-muted-foreground text-xs mb-4">Crie um template e aguarde a aprovação da Meta (24-48h).</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition flex items-center gap-1.5 mx-auto"
            data-testid="button-create-first"
          >
            <Plus className="w-3.5 h-3.5" />
            Criar primeiro template
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t: any) => {
            const st = STATUS_MAP[t.status] || { label: t.status, bg: "#1a1a2e", color: "#999" };
            const cat = CATEGORY_MAP[t.category] || { label: t.category, bg: "#1a1a2e", color: "#999" };
            return (
              <div key={t.id} className="rounded-lg bg-muted/50 p-3 border border-border/50" data-testid={`template-card-${t.id}`}>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span style={{ fontFamily: "monospace", fontSize: 13, color: "hsl(var(--primary))", fontWeight: 600 }}>{t.templateName}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: st.bg, color: st.color }}>{st.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: cat.bg, color: cat.color }}>{cat.label}</span>
                </div>
                <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", lineHeight: 1.4, marginBottom: 4 }}>
                  {t.bodyText?.length > 120 ? t.bodyText.substring(0, 120) + "..." : t.bodyText}
                </p>
                {t.status === "REJECTED" && t.rejectionReason && (
                  <p style={{ fontSize: 11, color: "#E24B4A", marginBottom: 4 }}>Motivo: {t.rejectionReason}</p>
                )}
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-3" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                    <span>{LANG_MAP[t.language] || t.language}</span>
                    <span>{t.variablesCount} variáveis</span>
                    <span>{t.createdAt ? timeAgo(t.createdAt) : "—"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleSyncOne(t.id)}
                      disabled={syncingId === t.id}
                      className="p-1.5 rounded-md hover:bg-muted transition"
                      title="Sincronizar status"
                      data-testid={`button-sync-${t.id}`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${syncingId === t.id ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      disabled={deletingId === t.id}
                      className="p-1.5 rounded-md hover:bg-destructive/10 transition"
                      title="Excluir template"
                      data-testid={`button-delete-${t.id}`}
                    >
                      {deletingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-destructive" /> : <Trash2 className="w-3.5 h-3.5 text-destructive/70" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
          data-testid="modal-create-template"
        >
          <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, padding: 24, width: 560, maxWidth: "90%" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-foreground font-semibold text-base">Novo Template HSM</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground transition" data-testid="button-close-modal">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nome do template *</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="ex: cobranca_vencimento"
                  value={form.templateName}
                  onChange={e => setForm({ ...form, templateName: e.target.value })}
                  data-testid="input-template-name"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Apenas letras minúsculas, números e underscores. Ex: cobranca_3dias</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Categoria</label>
                  <select className={inputCls} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} data-testid="select-category">
                    <option value="UTILITY">Utilidade — notificações, cobranças</option>
                    <option value="MARKETING">Marketing — promoções</option>
                    <option value="AUTHENTICATION">Autenticação — códigos</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Idioma</label>
                  <select className={inputCls} value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} data-testid="select-language">
                    <option value="pt_BR">Português - Brasil</option>
                    <option value="en_US">English - US</option>
                    <option value="es_ES">Español</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Cabeçalho</label>
                <select className={inputCls} value={form.headerType} onChange={e => setForm({ ...form, headerType: e.target.value, headerContent: "" })} data-testid="select-header-type">
                  <option value="">Nenhum</option>
                  <option value="TEXT">Texto</option>
                </select>
                {form.headerType === "TEXT" && (
                  <input
                    type="text"
                    className={`${inputCls} mt-2`}
                    placeholder="Texto do cabeçalho"
                    value={form.headerContent}
                    onChange={e => setForm({ ...form, headerContent: e.target.value })}
                    data-testid="input-header-content"
                  />
                )}
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Corpo da mensagem *</label>
                <textarea
                  className={inputCls}
                  rows={6}
                  placeholder={"Olá {{1}}, sua fatura de R$ {{2}} vence em {{3}} dias.\nAcesse o link para pagar: {{4}}"}
                  value={form.bodyText}
                  onChange={e => setForm({ ...form, bodyText: e.target.value })}
                  data-testid="textarea-body"
                />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[10px] text-muted-foreground">Use {"{{1}}"}, {"{{2}}"}, {"{{3}}"}... para variáveis.</p>
                  <p className="text-[10px] text-muted-foreground">{form.bodyText.length} / 1024</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Rodapé (opcional)</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="Norte Gestão CRM"
                  value={form.footerText}
                  onChange={e => setForm({ ...form, footerText: e.target.value })}
                  data-testid="input-footer"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm transition border border-border"
                data-testid="button-cancel-template"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition flex items-center justify-center gap-2"
                data-testid="button-submit-template"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {submitting ? "Enviando..." : "Enviar para aprovação"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
