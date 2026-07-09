import { useState, useEffect } from "react";
import {
  Smartphone,
  CheckCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Wifi,
  Loader2,
  Zap,
  Copy,
  AlertTriangle,
  Check,
  ChevronDown,
} from "lucide-react";
import { apiRequest, apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const inputCls = "w-full px-3 py-2 rounded-field bg-base-100 border border-base-300 text-base-content text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors";
const btnPrimaryCls = "px-6 py-3 rounded-field bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition";

export default function WhatsAppOficial() {
  const { toast } = useToast();
  const [connection, setConnection] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [formData, setFormData] = useState({
    waba_id: "",
    phone_number_id: "",
    access_token: "",
    app_secret: "",
  });
  const [showAppSecret, setShowAppSecret] = useState(false);

  useEffect(() => {
    loadConnection();
  }, []);

  async function loadConnection() {
    try {
      const res = await apiRequest("GET", "/api/whatsapp-official/connection");
      const data = await res.json();
      if (data.connected === false) {
        setConnection(null);
      } else {
        setConnection(data.data || data);
      }
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!formData.waba_id || !formData.phone_number_id || !formData.access_token) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    setConnecting(true);
    try {
      const res = await apiRequest("POST", "/api/whatsapp-official/connect", {
        waba_id: formData.waba_id,
        phone_number_id: formData.phone_number_id,
        access_token: formData.access_token,
        app_secret: formData.app_secret,
      });
      const data = await res.json();
      setConnection(data.data || data);
      setShowManualForm(false);
      setFormData({ waba_id: "", phone_number_id: "", access_token: "", app_secret: "" });
      toast({ title: "WhatsApp conectado com sucesso!" });
    } catch (err: any) {
      toast({ title: err.message || "Erro ao conectar", variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await apiRequest("POST", "/api/whatsapp-official/test");
      const data = await res.json();
      if (data.success) {
        toast({ title: `Conexão OK — ${data.phoneNumber} (${data.qualityRating})` });
      } else {
        toast({ title: data.error || "Falha no teste", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: err.message || "Erro ao testar", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar o WhatsApp Oficial?")) return;
    try {
      await apiRequest("DELETE", "/api/whatsapp-official/connection");
      setConnection(null);
      toast({ title: "WhatsApp desconectado" });
    } catch (err: any) {
      toast({ title: err.message || "Erro ao desconectar", variant: "destructive" });
    }
  }

  function getTierLabel(tier: string) {
    const map: Record<string, string> = {
      TIER_1K: "1.000 msg/dia",
      TIER_10K: "10.000 msg/dia",
      TIER_100K: "100.000 msg/dia",
      TIER_UNLIMITED: "Ilimitado",
    };
    return map[tier] || tier || "—";
  }

  function getQualityColor(rating: string) {
    if (rating === "GREEN") return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
    if (rating === "YELLOW") return "text-amber-600 dark:text-amber-400 bg-amber-500/10";
    return "text-red-600 dark:text-red-400 bg-red-500/10";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-spinner">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="py-8 px-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="page-title">
          <div className="w-9 h-9 rounded-field flex items-center justify-center bg-emerald-500/15 dark:bg-emerald-500/10">
            <Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          WhatsApp API Oficial (Meta)
        </h1>
        <p className="text-muted-foreground mt-1">
          Canal oficial da Meta — sem risco de banimento, templates HSM e escala ilimitada.
        </p>
      </div>

      <div className="rounded-box border border-base-200 bg-base-100 p-6">
        {connection ? (
          <>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold" data-testid="status-connected">
                  Conectado via API Oficial
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing}
                  className="px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm transition flex items-center gap-2 border border-border"
                  data-testid="button-test"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  {testing ? "Testando..." : "Testar"}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 rounded-lg border border-destructive/30 hover:bg-destructive/10 text-destructive text-sm transition"
                  data-testid="button-disconnect"
                >
                  Desconectar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Número</p>
                <p className="text-foreground font-medium" data-testid="text-phone-number">
                  {connection.displayPhoneNumber || connection.display_phone_number || "—"}
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Empresa</p>
                <p className="text-foreground font-medium" data-testid="text-business-name">
                  {connection.businessName || connection.business_name || "—"}
                </p>
              </div>
            </div>
          </div>

          <WebhookSetupGuide connection={connection} />
          </>
        ) : (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
              <Smartphone className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-foreground font-semibold text-lg">
                Conectar WhatsApp via API Oficial
              </h3>
              <p className="text-muted-foreground text-sm mt-1">
                Use a API oficial da Meta para enviar mensagens com total segurança.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm text-left max-w-sm mx-auto">
              {[
                "Sem risco de banimento",
                "Templates HSM aprovados",
                "Status de entrega em tempo real",
                "Escala ilimitada",
              ].map((b) => (
                <div key={b} className="flex items-center gap-2 text-foreground/80">
                  <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  {b}
                </div>
              ))}
            </div>

            {!showManualForm ? (
              <button
                onClick={() => setShowManualForm(true)}
                className={btnPrimaryCls}
                data-testid="button-connect-manual"
              >
                Conectar Manualmente
              </button>
            ) : (
              <div className="text-left space-y-3 max-w-md mx-auto mt-4">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">WABA ID</label>
                  <input
                    type="text"
                    placeholder="Ex: 2354425141729203"
                    value={formData.waba_id}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, waba_id: e.target.value }))
                    }
                    className={inputCls}
                    data-testid="input-waba-id"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Phone Number ID</label>
                  <input
                    type="text"
                    placeholder="Ex: 966609613212096"
                    value={formData.phone_number_id}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, phone_number_id: e.target.value }))
                    }
                    className={inputCls}
                    data-testid="input-phone-number-id"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Access Token</label>
                  <div className="relative">
                    <input
                      type={showToken ? "text" : "password"}
                      placeholder="Token permanente do System User"
                      value={formData.access_token}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, access_token: e.target.value }))
                      }
                      className={inputCls + " pr-10"}
                      data-testid="input-access-token"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((p) => !p)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Encontre em developers.facebook.com → WhatsApp → Configuração da API
                  </p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">App Secret</label>
                  <div className="relative">
                    <input
                      type={showAppSecret ? "text" : "password"}
                      placeholder="Chave Secreta do App (HMAC do webhook)"
                      value={formData.app_secret}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, app_secret: e.target.value }))
                      }
                      className={inputCls + " pr-10"}
                      data-testid="input-app-secret"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAppSecret((p) => !p)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showAppSecret ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    developers.facebook.com → Configurações do app → Básico → Chave Secreta do App
                  </p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => setShowManualForm(false)}
                    className="flex-1 px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm transition border border-border"
                    data-testid="button-cancel"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="flex-1 px-4 py-2 rounded-field bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition"
                    data-testid="button-connect"
                  >
                    {connecting ? "Conectando..." : "Conectar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {connection && <LinkedAutomacaoSelector connection={connection} onUpdate={loadConnection} />}
    </div>
  );
}

function WebhookSetupGuide({ connection }: { connection: any }) {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const webhookVerified = connection.webhookVerified ?? connection.webhook_verified ?? false;

  const webhookUrl = `${window.location.origin}/api/webhook/meta`;

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      toast({ title: "Copiado!" });
      setTimeout(() => setCopiedField(null), 2000);
    });
  }

  const steps = [
    {
      num: 1,
      title: "Abra o painel do App na Meta",
      desc: (
        <span>
          Acesse{" "}
          <a
            href="https://developers.facebook.com/apps/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
            data-testid="link-meta-developers"
          >
            developers.facebook.com/apps
          </a>
          {" "}e selecione seu App.
        </span>
      ),
    },
    {
      num: 2,
      title: "Vá em WhatsApp > Configuração",
      desc: "No menu lateral, clique em WhatsApp > Configuration (ou Configuração).",
    },
    {
      num: 3,
      title: "Configure a Callback URL",
      desc: "Em 'Callback URL', clique em Edit e cole a URL abaixo:",
      copyable: { label: "Callback URL", value: webhookUrl, field: "url" },
    },
    {
      num: 4,
      title: "Configure o Verify Token",
      desc: "No campo 'Verify Token', cole o token abaixo (mesmo configurado no sistema):",
      copyable: { label: "Verify Token", value: connection.webhookVerifyToken || connection.webhook_verify_token || "—", field: "token" },
    },
    {
      num: 5,
      title: "Salve e ative os campos",
      desc: "Clique em 'Verify and Save'. Depois, em 'Webhook fields', marque o campo 'messages' e clique em Subscribe.",
    },
  ];

  return (
    <div className={`rounded-box border mt-4 ${webhookVerified ? "border-base-200 bg-base-100" : "border-amber-500/30 bg-amber-500/5"}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-4 text-left cursor-pointer hover:bg-muted/30 transition-colors rounded-box"
        data-testid="button-toggle-webhook-guide"
      >
        {webhookVerified ? (
          <Wifi className="w-5 h-5 text-emerald-500 flex-shrink-0" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-foreground font-semibold text-sm" data-testid="text-webhook-title">
            Configuração do Webhook
          </h3>
          <p className="text-xs text-muted-foreground">
            {webhookVerified
              ? "Webhook configurado — mensagens recebidas serão processadas automaticamente."
              : "Configure o webhook na Meta para receber mensagens no CRM."}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="px-5 pb-5">
          <div className="space-y-3">
            {steps.map((step) => (
              <div key={step.num} className="flex gap-3" data-testid={`webhook-step-${step.num}`}>
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">{step.num}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground text-sm font-medium">{step.title}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{step.desc}</p>
                  {step.copyable && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0 bg-base-100 border border-base-300 rounded-field px-3 py-2 font-mono text-xs text-base-content truncate" data-testid={`text-webhook-${step.copyable.field}`}>
                        {step.copyable.value}
                      </div>
                      <button
                        onClick={() => copyToClipboard(step.copyable!.value, step.copyable!.field)}
                        className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 border border-border text-foreground text-xs flex items-center gap-1.5 transition flex-shrink-0"
                        data-testid={`button-copy-${step.copyable.field}`}
                      >
                        {copiedField === step.copyable.field ? (
                          <><Check className="w-3.5 h-3.5 text-emerald-500" /> Copiado</>
                        ) : (
                          <><Copy className="w-3.5 h-3.5" /> Copiar</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-border">
            <a
              href={`https://developers.facebook.com/apps/`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/15 text-primary text-sm font-medium transition"
              data-testid="link-open-meta-panel"
            >
              <ExternalLink className="w-4 h-4" /> Abrir painel da Meta
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkedAutomacaoSelector({ connection, onUpdate }: { connection: any; onUpdate: () => void }) {
  const { toast } = useToast();
  const [automacoes, setAutomacoes] = useState<any[]>([]);
  const [loadingAutos, setLoadingAutos] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(connection.automacaoId || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch("/api/automacoes");
        const all = data?.data || [];
        setAutomacoes(all.filter((a: any) => a.status === "ACTIVE" && Array.isArray(a.nodes) && a.nodes.some((n: any) => n.type === "trigger")));
      } catch { setAutomacoes([]); }
      setLoadingAutos(false);
    }
    load();
  }, []);

  useEffect(() => {
    setSelectedId(connection.automacaoId || "");
  }, [connection.automacaoId]);

  async function handleChange(val: string) {
    const newId = val === "none" ? "" : val;
    setSelectedId(newId);
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/whatsapp-official/connection/automacao", { automacaoId: newId || null });
      toast({ title: newId ? "Automação vinculada" : "Automação desvinculada" });
      onUpdate();
    } catch (err: any) {
      toast({ title: err.message || "Erro ao vincular", variant: "destructive" });
      setSelectedId(connection.automacaoId || "");
    }
    setSaving(false);
  }

  const selectedName = automacoes.find((a: any) => a.id === selectedId)?.nome;

  return (
    <div className="rounded-box border border-base-200 bg-base-100 p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-base-content/60" />
            <span className="text-[13px] font-semibold">Automação vinculada</span>
          </div>
          <p className="text-[12px] text-base-content/55 leading-relaxed">Selecione uma automação ativa para executar automaticamente quando uma nova mensagem chegar nesta conexão.</p>
        </div>
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3">
            <div className="relative w-full max-w-[420px]">
              <select
                value={selectedId || "none"}
                onChange={(e) => handleChange(e.target.value)}
                className={inputCls}
                data-testid="select-oficial-automacao"
                disabled={saving}
              >
                <option value="none">Nenhuma automação</option>
                {automacoes.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </div>
            {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {selectedId && !saving && <CheckCircle className="w-4 h-4 text-emerald-500" />}
          </div>
          {!loadingAutos && automacoes.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-2">Nenhuma automação ativa encontrada. Ative uma automação na página de Automações.</p>
          )}
          {selectedId && selectedName && (
            <div className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <Zap className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-foreground"><strong>{selectedName}</strong> será executada quando um novo lead enviar mensagem.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

