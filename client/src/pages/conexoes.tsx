import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  MessageSquare,
  Camera,
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  Check,
  ExternalLink,
  Inbox,
  BarChart3,
  Megaphone,
  Settings,
  Zap,
  Building2,
  Globe,
  Package,
  Shield,
  RefreshCw,
  CircleDot,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  Send,
  X,
  Contact,
  AlertTriangle,
  Smartphone,
  CheckCircle2,
  Wifi,
} from "lucide-react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/page/PageShell";
import { WhatsAppIcon, InstagramIcon } from "@/components/brand-icons";
import { SiFacebook } from "react-icons/si";
import WhatsAppOficial from "@/pages/whatsapp-oficial";

type ChannelId = "woficial" | "instagram" | "evolution";
type ConnectionStatus = "connected" | "configuring" | "disconnected" | "error" | "qr_pending" | "connecting";

interface ChannelDef {
  id: ChannelId;
  icon: typeof MessageSquare;
  nome: string;
  sub: string;
  color: string;
}

interface ConexaoAPI {
  id: string;
  nome: string;
  tipo: string;
  provider: string;
  hasInstanceId: boolean;
  hasToken: boolean;
  automacaoId: string | null;
  numero: string | null;
  status: string;
  webhookUrl: string | null;
  ultimoPing: string | null;
  workspaceId: string | null;
  planoLimite: number;
  createdAt: string;
  updatedAt: string;
}

const channels: ChannelDef[] = [
  { id: "woficial", icon: MessageSquare, nome: "Whatsapp Oficial", sub: "Meta Cloud API", color: "#25d366" },
  { id: "instagram", icon: Camera, nome: "Instagram", sub: "Direct Messages", color: "#e1306c" },
  { id: "evolution", icon: MessageSquare, nome: "Evolution GO", sub: "WhatsApp API", color: "#10b981" },
];

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: "bg-emerald-400 border-emerald-500",
    configuring: "bg-yellow-500 border-yellow-600",
    qr_pending: "bg-yellow-500 border-yellow-600",
    connecting: "bg-yellow-500 border-yellow-600",
    error: "bg-red-500 border-red-600",
    disconnected: "bg-muted border-border",
  };
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 border ${colors[status] || colors.disconnected}`} />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return <Badge variant="outline" className="text-primary border-primary/40 bg-primary/10" data-testid="badge-status-connected"><CircleDot className="w-2.5 h-2.5 mr-1" />CONECTADO</Badge>;
  }
  if (status === "configuring" || status === "qr_pending" || status === "connecting") {
    return <Badge variant="outline" className="text-yellow-500 border-yellow-500/40 bg-yellow-500/10" data-testid="badge-status-configuring"><CircleDot className="w-2.5 h-2.5 mr-1" />CONFIGURANDO</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground border-border bg-muted/20" data-testid="badge-status-disconnected"><CircleDot className="w-2.5 h-2.5 mr-1" />DESCONECTADO</Badge>;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="text-[10.5px] font-bold text-muted-foreground mb-1.5 uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11.5px] text-primary break-all" data-testid={`text-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</code>
        <Button
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            toast({ title: "Copiado!", description: `${label} copiado para a área de transferência.` });
          }}
          data-testid={`button-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <Copy className="w-3 h-3 mr-1" /> Copiar
        </Button>
      </div>
    </div>
  );
}

function MaskedField({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex items-center justify-between py-2 border-b border-border text-[12.5px]">
      <span className="text-muted-foreground font-semibold">{label}</span>
      <div className="flex items-center gap-2">
        <code className="text-[11.5px]" data-testid={`text-field-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {visible ? value : value.slice(0, 8) + "••••••••••"}
        </code>
        <Button variant="ghost" size="icon" onClick={() => setVisible(!visible)} data-testid={`button-toggle-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function InstagramDetail() {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [tokenForm, setTokenForm] = useState({ accessToken: "", igUserId: "" });
  const [tokenError, setTokenError] = useState("");
  const [selectedAutoId, setSelectedAutoId] = useState<string>("");
  const [selectedDmAutoId, setSelectedDmAutoId] = useState<string>("");
  const [selectedCommentAutoId, setSelectedCommentAutoId] = useState<string>("");

  const { data: igStatus, isLoading, refetch } = useQuery<{
    connected?: boolean;
    username?: string;
    pageName?: string;
    daysUntilExpiry?: number | null;
    dmCount?: number;
    dmCountMonth?: number;
    automacaoId?: string;
    dmAutomacaoId?: string;
    commentAutomacaoId?: string;
  }>({
    queryKey: ["/api/instagram/status"],
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (igStatus?.connected) {
      const autoId = igStatus.automacaoId || igStatus.dmAutomacaoId || igStatus.commentAutomacaoId || "";
      setSelectedAutoId(autoId);
      setSelectedDmAutoId(igStatus.dmAutomacaoId || "");
      setSelectedCommentAutoId(igStatus.commentAutomacaoId || "");
    }
  }, [igStatus?.automacaoId, igStatus?.dmAutomacaoId, igStatus?.commentAutomacaoId, igStatus?.connected]);

  const ispFlowsQuery = useQuery<any[]>({
    queryKey: ["/api/insta-prospect/flows"],
  });
  const allFlows = Array.isArray(ispFlowsQuery.data) ? ispFlowsQuery.data : [];
  const activeFlows = allFlows.filter((f: any) => f.ativo);

  const igAutoMutation = useMutation({
    mutationFn: async (body: { automacaoId?: string | null }) => {
      const res = await apiRequest("PATCH", "/api/instagram/automacoes", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/status"] });
      toast({ title: "Automação atualizada" });
    },
    onError: (e: Error) => {
      toast({ title: "Erro ao vincular automação", description: e.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/instagram/disconnect"),
    onSuccess: () => {
      toast({ title: "Instagram desconectado" });
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/status"] });
    },
    onError: () => toast({ title: "Erro ao desconectar", variant: "destructive" }),
  });

  async function handleConnectToken() {
    if (!tokenForm.accessToken.trim() || !tokenForm.igUserId.trim()) {
      setTokenError("Preencha o Token e o ID da conta Instagram");
      return;
    }
    setConnecting(true);
    setTokenError("");
    try {
      const res = await apiRequest("POST", "/api/instagram/connect-token", {
        accessToken: tokenForm.accessToken.trim(),
        igUserId: tokenForm.igUserId.trim(),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: `Instagram @${data.username} conectado com sucesso!` });
        setTokenForm({ accessToken: "", igUserId: "" });
        queryClient.invalidateQueries({ queryKey: ["/api/instagram/status"] });
      } else {
        setTokenError(data.error || "Erro ao conectar");
      }
    } catch (err: any) {
      setTokenError("Erro ao conectar. Verifique o token e o ID da conta.");
    }
    setConnecting(false);
  }

  // OAuth (recomendado): pega token + ID da conta automaticamente via Facebook.
  async function handleConnectOAuth() {
    setConnecting(true);
    setTokenError("");
    try {
      const res = await apiRequest("GET", "/api/instagram/auth-url");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // redireciona pro consentimento do Facebook
      } else {
        setTokenError(data.error || "Erro ao iniciar conexão");
        setConnecting(false);
      }
    } catch (err: any) {
      setTokenError("Erro ao iniciar conexão com o Facebook");
      setConnecting(false);
    }
  }

  // Instagram Login (sem Página do Facebook): conecta direto pelo Instagram.
  async function handleConnectInstagramLogin() {
    setConnecting(true);
    setTokenError("");
    try {
      const res = await apiRequest("GET", "/api/instagram/ig-auth-url");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // redireciona pro login do Instagram
      } else {
        setTokenError(data.error || "Erro ao iniciar login do Instagram");
        setConnecting(false);
      }
    } catch (err: any) {
      setTokenError("Erro ao iniciar login do Instagram");
      setConnecting(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ig_success") === "true") {
      toast({ title: "Instagram conectado com sucesso!" });
      refetch();
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("ig_error")) {
      toast({ title: `Erro Instagram: ${params.get("ig_error")}`, variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-6 text-center">
        <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin text-pink-500" />
        <p className="text-sm text-muted-foreground">Verificando conexão Instagram...</p>
      </div>
    );
  }

  if (!igStatus?.connected) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3" data-testid="text-ig-not-connected">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-pink-500/10">
              <InstagramIcon className="w-5 h-5" />
            </div>
            Instagram Direct
          </h1>
          <p className="text-muted-foreground mt-1">
            Conecte sua conta Instagram Business para receber e enviar DMs, responder comentários e ativar fluxos de prospecção com IA.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-pink-500/10 flex items-center justify-center mx-auto">
              <Camera className="w-8 h-8 text-pink-500" />
            </div>
            <div>
              <h3 className="text-foreground font-semibold text-lg">
                Conectar sua conta Instagram
              </h3>
              <p className="text-muted-foreground text-sm mt-1">
                A conta precisa ser <b>Profissional (Business/Creator)</b>. Escolha como conectar:
              </p>
            </div>

            {/* OAuth — dois caminhos */}
            <div className="max-w-md mx-auto space-y-2">
              <Button
                onClick={handleConnectInstagramLogin}
                disabled={connecting}
                variant="ghost"
                className="w-full bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] text-white border-0 hover:opacity-90"
                data-testid="button-connect-instagram-login"
              >
                {connecting ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <InstagramIcon className="w-4 h-4 mr-1.5" />}
                Continuar com Instagram
              </Button>
              <p className="text-[10.5px] text-muted-foreground">Recomendado — <b>não</b> exige Página do Facebook.</p>

              <Button
                onClick={handleConnectOAuth}
                disabled={connecting}
                variant="ghost"
                className="w-full bg-[#1877F2] hover:bg-[#166FE5] text-white border-0"
                data-testid="button-connect-instagram-oauth"
              >
                <SiFacebook className="w-4 h-4 mr-1.5" />
                Conectar com Facebook
              </Button>
              <p className="text-[10.5px] text-muted-foreground">Use se sua conta é gerenciada por uma Página do Facebook.</p>

              {tokenError && (
                <p className="text-[11px] text-red-500 flex items-center gap-1 mt-1 justify-center" data-testid="text-ig-connect-error">
                  <AlertCircle className="w-3 h-3" /> {tokenError}
                </p>
              )}
            </div>

            {/* separador */}
            <div className="max-w-md mx-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <div className="h-px bg-border flex-1" />
              ou conecte manualmente com token
              <div className="h-px bg-border flex-1" />
            </div>

            <div className="text-left space-y-3 max-w-md mx-auto mt-4">
              <p className="text-[11px] text-muted-foreground">
                Alternativa avançada: <a href="https://developers.facebook.com" target="_blank" rel="noopener" className="text-primary underline">developers.facebook.com</a> → Graph API Explorer → gere o token e pegue o ID numérico da conta.
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">ID da Conta Instagram</label>
                <Input
                  placeholder="Ex: 17841401783367569"
                  value={tokenForm.igUserId}
                  onChange={(e) => setTokenForm(f => ({ ...f, igUserId: e.target.value }))}
                  data-testid="input-ig-user-id"
                  name="ig-account-id"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Número abaixo do nome da conta no painel Meta</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Access Token</label>
                <Input
                  placeholder="Cole o token gerado no Meta"
                  value={tokenForm.accessToken}
                  onChange={(e) => setTokenForm(f => ({ ...f, accessToken: e.target.value }))}
                  data-testid="input-ig-token"
                  className="font-mono"
                  type="password"
                  name="ig-access-token"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleConnectToken}
                  disabled={connecting}
                  variant="ghost"
                  className="flex-1 bg-gradient-to-r from-[#f09433] via-[#dc2743] to-[#bc1888] text-white border-0 hover:opacity-90"
                  data-testid="button-connect-instagram"
                >
                  {connecting ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Camera className="w-3.5 h-3.5 mr-1" />}
                  Conectar Instagram
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const d = igStatus ?? {};

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      <Card className="p-5 mb-5 flex items-center gap-4 border-pink-500/30 flex-wrap" data-testid="card-instagram-connected">
        <div className="w-[52px] h-[52px] rounded-xl bg-pink-500/10 flex items-center justify-center flex-shrink-0">
          <Camera className="w-6 h-6 text-pink-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-base font-bold">Instagram Direct</span>
            <StatusBadge status="connected" />
          </div>
          <div className="text-[12.5px] text-muted-foreground">
            @{d.username} · {d.pageName || "Página FB"} · Graph API
            {d.daysUntilExpiry != null && d.daysUntilExpiry <= 7 && (
              <span className="text-yellow-500 ml-2">⚠ Token expira em {d.daysUntilExpiry} dias</span>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-ig">
          <RefreshCw className="w-3 h-3 mr-1" /> Atualizar
        </Button>
        <Button variant="outline" size="sm" className="text-red-500" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} data-testid="button-disconnect-instagram">
          Desconectar
        </Button>
      </Card>

      <div className="grid grid-cols-4 gap-3">
        {[
          { v: `@${d.username}`, l: "Conta", icon: Camera, c: "text-pink-500" },
          { v: d.dmCount || 0, l: "DMs total", icon: MessageSquare, c: "text-pink-500" },
          { v: d.dmCountMonth || 0, l: "DMs mes", icon: BarChart3, c: "text-primary" },
          { v: d.daysUntilExpiry != null ? `${d.daysUntilExpiry}d` : "∞", l: "Token expira", icon: Shield, c: d.daysUntilExpiry != null && d.daysUntilExpiry <= 7 ? "text-yellow-500" : "text-primary" },
        ].map((s) => (
          <Card key={s.l} className="p-3.5 text-center" data-testid={`card-ig-stat-${s.l.replace(/\s+/g, "-")}`}>
            <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.c}`} />
            <div className={`text-sm font-bold ${s.c} truncate`}>{s.v}</div>
            <div className="text-[10.5px] text-muted-foreground mt-0.5">{s.l}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5 mt-5" data-testid="card-ig-automacoes">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3.5">Automação vinculada</div>
        <p className="text-[12px] text-muted-foreground mb-4">Selecione uma automação do Instagram para executar automaticamente quando uma interação chegar nesta conexão (comentário, DM ou Stories).</p>

        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-pink-500" />
            Automação
          </label>
          <div className="flex items-center gap-2.5">
            <Select
              value={selectedAutoId || "none"}
              onValueChange={(val) => {
                const newVal = val === "none" ? "" : val;
                setSelectedAutoId(newVal);
                igAutoMutation.mutate({ automacaoId: newVal || null });
              }}
              data-testid="select-ig-automacao"
            >
              <SelectTrigger className="w-full max-w-[400px]" data-testid="select-ig-automacao-trigger">
                <SelectValue placeholder="Nenhuma automação selecionada" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma automação</SelectItem>
                {activeFlows.map((f: any) => {
                  const caps = [
                    f.commentEnabled && "Comentário",
                    f.dmEnabled && "DM",
                    f.storyEnabled && "Stories",
                  ].filter(Boolean).join(", ");
                  return (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                      {caps && <span className="ml-2 text-[10px] text-muted-foreground">({caps})</span>}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {igAutoMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {activeFlows.length === 0 && !ispFlowsQuery.isLoading && (
            <p className="text-[11px] text-muted-foreground mt-2">Nenhuma automação ativa. Crie uma em Automações → Instagram.</p>
          )}
        </div>
      </Card>

      {d.daysUntilExpiry != null && d.daysUntilExpiry <= 14 && (
        <Card className="p-4 mt-4 border-yellow-500/30" data-testid="card-ig-token-warning">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Token expira em {d.daysUntilExpiry} dias</p>
              <p className="text-xs text-muted-foreground">Reconecte para renovar o acesso por mais 60 dias.</p>
            </div>
            <Button size="sm" onClick={handleConnectToken} disabled={connecting} data-testid="button-renew-ig-token">
              {connecting ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : null}
              Reconectar
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// --- Evolution GO (canal novo, serviço externo) ---------------------------
// Self-contained (igual InstagramDetail/ISPConnectionDetail): lista + criar + QR
// + desconectar/excluir. Reusa os endpoints /api/conexoes (que ramificam por
// provider no backend). Bruno 2026-06-09.
function EvolutionDetail() {
  const { toast } = useToast();
  const { data: conexoesResp, isLoading } = useQuery<{ ok: boolean; data: ConexaoAPI[] }>({ queryKey: ["/api/conexoes"] });
  const conexoes = (conexoesResp?.data || []).filter((c) => c.provider === "evolution");
  const [view, setView] = useState<"list" | "qr">("list");
  const [selected, setSelected] = useState<ConexaoAPI | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [connectedOk, setConnectedOk] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createMut = useMutation({
    // O nome da instância é gerado no servidor como "<Empresa>-NN" (ex: "Nekt-Fibra-01").
    mutationFn: async () => (await apiRequest("POST", "/api/conexoes", { tipo: "whatsapp", provider: "evolution" })).json(),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conexoes"] });
      if (data?.ok && data.data) { setSelected(data.data); setView("qr"); }
      else toast({ title: "Erro ao criar", description: data?.error || "Verifique a configuração do Evolution GO no servidor.", variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Erro ao criar conexão", description: e.message, variant: "destructive" }),
  });
  const disconnectMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/conexoes/${id}/disconnect`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/conexoes"] }); toast({ title: "Desconectado" }); },
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/conexoes/${id}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/conexoes"] }); setView("list"); setSelected(null); toast({ title: "Conexão removida" }); },
  });

  // Automação vinculável (paridade com Meta): PATCH é agnóstico de provider.
  const autoQuery = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/automacoes"] });
  const activeAutomacoes = (autoQuery.data?.data || []).filter(
    (a: any) => a.status === "ACTIVE" && Array.isArray(a.nodes) && a.nodes.some((n: any) => n.type === "trigger"),
  );
  const automacaoMut = useMutation({
    mutationFn: async ({ id, automacaoId }: { id: string; automacaoId: string | null }) =>
      (await apiRequest("PATCH", `/api/conexoes/${id}`, { automacaoId })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/conexoes"] }); toast({ title: "Automação atualizada" }); },
    onError: (e: Error) => toast({ title: "Erro ao vincular automação", description: e.message, variant: "destructive" }),
  });

  // Enquanto na tela de QR: faz polling do status (detecta conexão) e do QR.
  useEffect(() => {
    if (view !== "qr" || !selected) return;
    let cancelled = false;
    const token = localStorage.getItem("flowcrm_token") || "";
    const sel = selected;
    setQrImage(null); setQrError(null); setConnectedOk(false);
    async function tick() {
      if (cancelled) return;
      try {
        const s = await (await fetch(`/api/conexoes/${sel.id}/status`, { headers: { Authorization: `Bearer ${token}` } })).json();
        if (s?.ok && s.data?.connected) { setConnectedOk(true); queryClient.invalidateQueries({ queryKey: ["/api/conexoes"] }); return; }
        const q = await (await fetch(`/api/conexoes/${sel.id}/qrcode`, { headers: { Authorization: `Bearer ${token}` } })).json();
        if (q?.ok) {
          if (q.data?.already_connected) { setConnectedOk(true); queryClient.invalidateQueries({ queryKey: ["/api/conexoes"] }); return; }
          if (q.data?.qrcode) { setQrImage(q.data.qrcode); setQrError(null); }
        } else { setQrError(q?.error || "Erro ao gerar QR Code"); }
      } catch {}
    }
    tick();
    pollRef.current = setInterval(tick, 3500);
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [view, selected?.id]);

  // Volta pra lista quando conectar.
  useEffect(() => {
    if (!connectedOk) return;
    const t = setTimeout(() => { setView("list"); setSelected(null); setConnectedOk(false); }, 1600);
    return () => clearTimeout(t);
  }, [connectedOk]);

  const connectedCount = conexoes.filter((c) => c.status === "connected").length;

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>;

  // ── Tela de QR (conectar um número) ───────────────────────────────────
  if (view === "qr" && selected) {
    return (
      <div className="py-8 px-6 max-w-3xl mx-auto">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => { setView("list"); setSelected(null); }}><ArrowLeft className="w-4 h-4 mr-1" /> Voltar</Button>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="grid md:grid-cols-2 gap-6 items-center">
            <div className="flex flex-col items-center justify-center">
              {connectedOk ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center"><CheckCircle2 className="w-8 h-8 text-emerald-500" /></div>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400">Conectado!</div>
                </div>
              ) : qrError ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                  <div className="text-[13px] text-red-500 max-w-xs">{qrError}</div>
                  <Button size="sm" onClick={() => { setQrError(null); setQrImage(null); }}>Tentar de novo</Button>
                </div>
              ) : qrImage ? (
                <div className="p-3 rounded-xl bg-white border border-base-200"><img src={qrImage} alt="QR Code" className="w-56 h-56 rounded-lg" /></div>
              ) : (
                <div className="w-56 h-56 flex items-center justify-center rounded-xl border border-dashed border-border"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
              )}
              <div className="mt-3 text-[11px] text-muted-foreground">O QR recarrega sozinho se expirar.</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1">Conectar {selected.nome}</div>
              <h2 className="text-base font-bold mb-4">Escaneie pelo WhatsApp do celular</h2>
              <div className="space-y-3">
                {[
                  "Abra o WhatsApp no seu celular",
                  "Toque em Mais opções (⋮) ou Ajustes → Aparelhos conectados",
                  "Toque em Conectar um aparelho",
                  "Aponte a câmera para este QR Code",
                ].map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-xs font-bold text-primary">{i + 1}</span></div>
                    <p className="text-[13px] text-foreground/90 flex-1">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Header + lista / empty ────────────────────────────────────────────
  return (
    <div className="py-8 px-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/15 dark:bg-emerald-500/10">
              <Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            WhatsApp Web (Evolution)
          </h1>
          <p className="text-muted-foreground mt-1">Conecte um número via QR Code, como no WhatsApp Web — rápido e sem cadastro na Meta.</p>
        </div>
        {conexoes.length > 0 && (
          <Button size="sm" className="h-9 gap-1.5 text-[12px] font-bold" onClick={() => createMut.mutate()} disabled={createMut.isPending} data-testid="button-new-evolution">
            {createMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Nova conexão
          </Button>
        )}
      </div>

      {conexoes.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto"><Smartphone className="w-8 h-8 text-emerald-600 dark:text-emerald-400" /></div>
            <div>
              <h3 className="text-foreground font-semibold text-lg">Conecte seu primeiro número</h3>
              <p className="text-muted-foreground text-sm mt-1">Leia um QR Code com o WhatsApp do celular e comece a atender em segundos.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-left max-w-sm mx-auto">
              {[
                "Conecta via QR em segundos",
                "Sem cadastro na Meta",
                "Funciona com qualquer número",
                "Ideal pra começar rápido",
              ].map((b) => (
                <div key={b} className="flex items-center gap-2 text-foreground/80"><CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />{b}</div>
              ))}
            </div>
            <Button className="h-10 gap-1.5 font-bold" onClick={() => createMut.mutate()} disabled={createMut.isPending} data-testid="button-new-evolution">
              {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Conectar via QR Code
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" /> Canal não-oficial. Para alto volume e templates aprovados, use o WhatsApp API Oficial.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Conexões", value: conexoes.length },
              { label: "Conectadas", value: connectedCount },
              { label: "Offline", value: conexoes.length - connectedCount },
            ].map((s) => (
              <div key={s.label} className="rounded-box bg-base-200 border border-base-300 p-3">
                <p className="text-[11px] text-base-content/60 mb-0.5">{s.label}</p>
                <p className="text-[22px] font-semibold text-base-content">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {conexoes.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-4" data-testid={`evolution-conexao-${c.id}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/15"><Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
                      {c.status === "connected" && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card animate-pulse" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold truncate">{c.nome}</div>
                      <div className="text-[12px] text-muted-foreground">{c.numero ? `+${c.numero}` : "Sem número conectado"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.status} />
                    {c.status === "connected" ? (
                      <Button size="sm" variant="outline" onClick={() => disconnectMut.mutate(c.id)} disabled={disconnectMut.isPending}>Desconectar</Button>
                    ) : (
                      <Button size="sm" onClick={() => { setSelected(c); setView("qr"); }}><Wifi className="w-3.5 h-3.5 mr-1" />Conectar</Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => { if (confirm(`Excluir a conexão "${c.nome}"?`)) deleteMut.mutate(c.id); }} data-testid={`button-delete-evo-${c.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
                {c.status === "connected" && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5"><Zap className="w-3 h-3" /> Automação vinculada</div>
                    <div className="flex items-center gap-2">
                      <Select value={c.automacaoId || "none"} onValueChange={(val) => automacaoMut.mutate({ id: c.id, automacaoId: val === "none" ? null : val })}>
                        <SelectTrigger className="w-full max-w-[360px]" data-testid={`select-automacao-evo-${c.id}`}><SelectValue placeholder="Nenhuma automação" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhuma automação</SelectItem>
                          {activeAutomacoes.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {automacaoMut.isPending && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    </div>
                    {activeAutomacoes.length === 0 && !autoQuery.isLoading && (
                      <p className="text-[11px] text-muted-foreground mt-1.5">Nenhuma automação ativa. Ative uma em Automações.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Conexoes() {
  const [activeChannel, setActiveChannel] = useState<ChannelId>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "instagram" || tab === "woficial" || tab === "evolution") return tab;
    return "woficial";
  });

  const { data: conexoesResp, isLoading } = useQuery<{ ok: boolean; data: ConexaoAPI[] }>({
    queryKey: ["/api/conexoes"],
  });

  const { data: integConfig } = useQuery<Record<string, any>>({
    queryKey: ["/api/integrations/config"],
  });

  const { data: igStatusData } = useQuery<{ connected: boolean; username?: string }>({
    queryKey: ["/api/instagram/status"],
  });

  const { data: woficialData } = useQuery<{ ok: boolean; connection: any }>({
    queryKey: ["/api/whatsapp-official/connection"],
  });
  const woficialEnabled = integConfig?.data?.woficial?.enabled === true;
  const instagramEnabled = integConfig?.data?.instagram?.enabled !== false;

  const visibleChannels = channels.filter(ch => {
    if (ch.id === "woficial" && !woficialEnabled) return false;
    if (ch.id === "instagram" && !instagramEnabled) return false;
    return true;
  });

  const conexoesList = conexoesResp?.data || [];
  // Evolution usa a tabela conexoes (provider='evolution').
  const evolutionConexoes = conexoesList.filter((c) => c.provider === "evolution");
  const evolutionConnectedCount = evolutionConexoes.filter((c) => c.status === "connected").length;

  function getChannelStatus(id: ChannelId): string {
    if (id === "woficial") return woficialData?.connection ? "connected" : "disconnected";
    if (id === "instagram") return igStatusData?.connected ? "connected" : "disconnected";
    if (id === "evolution") return evolutionConnectedCount > 0 ? "connected" : "disconnected";
    return "disconnected";
  }

  const PLAN_LIMIT = 10;
  const usedConexoes = conexoesList.length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-base-200/40" data-testid="page-conexoes">
      <div className="px-6 pt-5 pb-4 flex-shrink-0">
        <PageHeader
          title="Canais"
          subtitle="Gerencie seus canais de atendimento"
          actions={
            <>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold tabular-nums"
                style={{
                  // Bruno 2026-05-21: era banana-50/300/brand-brown hardcoded;
                  // agora segue --theme-tint-50 + --primary do tema escolhido.
                  background: "var(--theme-tint-50)",
                  borderColor: "hsl(var(--primary) / 0.35)",
                  color: "hsl(var(--primary))",
                }}
                data-testid="badge-conexoes-count"
              >
                {usedConexoes}<span className="text-muted-foreground font-medium">/{PLAN_LIMIT}</span>
                <span className="font-medium opacity-80">conexões</span>
              </span>
            </>
          }
        />
      </div>

      <div className="px-6 flex-shrink-0">
        {/* Channel tabs — estilo Nexus (pílula azul sólida ativa). */}
        <div className="pb-1">
          <div className="flex gap-1 mt-1">
            {visibleChannels.map((ch) => {
              const status = getChannelStatus(ch.id);
              const isActive = activeChannel === ch.id;
              const count = ch.id === "evolution" ? evolutionConexoes.length : 0;
              return (
                <button
                  key={ch.id}
                  className={`seg-tab !px-3 ${isActive ? "seg-tab-active" : ""}`}
                  onClick={() => { setActiveChannel(ch.id); }}
                  data-testid={`tab-channel-${ch.id}`}
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isActive ? "rgba(255,255,255,0.2)" : ch.color + "18" }}>
                    {ch.id === "woficial" ? <WhatsAppIcon className="w-4 h-4" /> : ch.id === "evolution" ? <MessageSquare className="w-4 h-4" style={{ color: isActive ? "#fff" : ch.color }} /> : <InstagramIcon className="w-4 h-4" style={{ color: isActive ? "#fff" : ch.color }} />}
                  </div>
                  {ch.nome}
                  {count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-muted"}`}>{count}</span>}
                  <StatusDot status={status} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : activeChannel === "woficial" ? (
          <div key="ch-woficial" className="anim-tab-fade"><WhatsAppOficial /></div>
        ) : activeChannel === "instagram" ? (
          <div key="ch-instagram" className="anim-tab-fade"><InstagramDetail /></div>
        ) : activeChannel === "evolution" ? (
          <div key="ch-evolution" className="anim-tab-fade"><EvolutionDetail /></div>
        ) : null}
      </div>
    </div>
  );
}
