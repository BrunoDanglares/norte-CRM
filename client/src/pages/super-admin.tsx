import { useState, useEffect, useMemo, Fragment } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Users,
  Shield,
  Eye,
  Monitor,
  Clock,
  Search,
  Power,
  PowerOff,
  Trash2,
  LogOut,
  Activity,
  Building2,
  UserCheck,
  UserX,
  UserPlus,
  Briefcase,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Lock,
  BarChart3,
  AlertTriangle,
  DollarSign,
  Percent,
  TrendingUp,
  Wifi,
  WifiOff,
  Save,
  Edit3,
  ShieldCheck,
  Ban,
  ArrowLeft,
  Star,
  LogIn,
  KeyRound,
  RotateCcw,
  Tag,
  FileText,
  MessageSquare,
  Smile,
  Sparkles,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NorteBrand } from "@/components/brand/NorteBrand";
import { enterImpersonation } from "@/lib/impersonation";

type AdminTab = "dashboard" | "tenants" | "usuarios" | "logs" | "receita" | "avaliacoes" | "saude";

interface TenantRow {
  id: string; nome: string; status: string; blocked: boolean; archived?: boolean; isVip?: boolean; asaasStatus?: string | null;
  planoNome?: string | null; valorMensal?: number; vencimento?: string | null;
  accountType: string; partnerPlan: string | null; createdAt: string | null;
  trialExpiresAt: string | null; trialDaysLeft: number | null;
  stripeStatus: string | null; stripePeriodEnd: string | null;
  users: number; usersAtivos: number; lastLogin: string | null;
  connections: number; connected: number;
  conversas30d: number; conversasTotal: number; lastActivity: string | null;
  ispSessions30d: number; escalacaoPct: number | null;
  aiKey: boolean; csat: number | null; evalP0: number; evalN: number;
}
interface TenantDetail {
  workspace: any;
  users: { id: number; nome: string; email: string; role: string; status: string; online: boolean; accountType: string; ultimoAcesso: string | null }[];
  connections: { id: string; nome: string; provider: string; numero: string | null; status: string }[];
  planos?: { id: string; nome: string; slug: string; preco: string | null }[];
  aiKey: boolean;
  metrics: { conversas30d: number; lastActivity: string | null; ispSessions30d: number; escalacaoPct: number | null; csat: number | null; evalP0: number };
}

interface AdminStats {
  totalUsers: number;
  onlineUsers: number;
  gestorCount: number;
  empreendedorCount: number;
  activeCount: number;
  inactiveCount: number;
  invitedCount: number;
  totalWorkspaces: number;
  activeWorkspaces: number;
  trialWorkspaces: number;
}

interface AdminUser {
  id: number;
  nome: string;
  email: string;
  role: string;
  status: string;
  online: boolean;
  accountType: string;
  ultimoAcesso: string | null;
  workspaceId: string | null;
  cargo: string | null;
  telefone: string | null;
  avatar: string | null;
  avatarUrl: string | null;
  tema: string | null;
  colorPreset: string | null;
  metaMensal: number;
}

interface AdminWorkspace {
  id: string;
  nome: string;
  status: string;
  accountType: string;
  partnerPlan: string | null;
  trialExpiresAt: string | null;
  createdAt: string | null;
  parentWorkspaceId: string | null;
  maxSubWorkspaces: number;
}

interface LogEntry {
  id: number;
  nome: string;
  email: string;
  role: string;
  status: string;
  online: boolean;
  accountType: string;
  ultimoAcesso: string | null;
  workspaceId: string | null;
  workspaceName: string;
  workspacePlan: string;
  workspaceCreatedAt: string | null;
  trialExpiresAt: string | null;
}

// Timeline de atividade de um usuário (modal da aba Logs).
interface ActivityEvent { ts: string; type: string; title: string; detail: string | null; convId?: number | null; }
interface ActivityData {
  user: { id: number; nome: string; email: string; role: string; accountType: string; workspaceName: string | null };
  total: number; capped: boolean; summary: Record<string, number>; events: ActivityEvent[];
}

// ── Protocolo de Avaliação de Conversas (F2: fila de revisão) ──────────────
interface AvalRow {
  id: string; workspace_id: string; conversation_id: number; verdict: string;
  overall_score: string | null; outcome: string | null; needs_human: boolean;
  judge_confidence: string | null; p0_flags: string[] | null; summary: string | null;
  csat_nota: number | null; msg_count: number | null; human_reviewed: boolean;
  human_verdict: string | null; reviewed_at: string | null; created_at: string;
  ws_nome: string | null; conv_nome: string | null; conv_canal: string | null; conv_status: string | null;
}
interface AvalMsg { direction: string; texto: string; tipo: string | null; agente: string | null; status: string | null; created_at: string; }
interface AvalDetail {
  evaluation: any;
  messages: AvalMsg[];
  tags: { situation_code: string; motivo: string | null; created_at: string }[];
  erpSnapshot: any | null;
}
const VERDICT_STYLE: Record<string, string> = {
  aprovada: "bg-green-500/15 text-green-600",
  revisar: "bg-amber-500/15 text-amber-600",
  reprovada: "bg-red-500/15 text-red-600",
};
interface HealthData {
  total: number;
  byVerdict: Record<string, number>;
  avgOverall: number | null;
  avgByBlock: Record<string, number>;
  paramFails: { param: string; count: number }[];
  p0: { flag: string; count: number }[];
  trend: { day: string; count: number; avg: number | null }[];
  csat: { avg: number | null; n: number };
  review: { reviewed: number; pending: number; divergencias: number };
}
const BLOCK_LABEL: Record<string, string> = {
  entendeu: "Entendeu", resolveu: "Resolveu", experiencia: "Experiência", seguro: "Seguro",
};

// Badge de situação do tenant (fonte = Asaas, modelo vigente). Prioriza
// bloqueio > VIP cortesia > inadimplência > cancelado > assinatura ativa >
// trial > legado (grandfathered, sem assinatura nem trial — ex.: Nekt/Conexão).
function tenantBadge(t: TenantRow): { label: string; cls: string } {
  if (t.archived) return { label: "Arquivado", cls: "bg-muted text-muted-foreground" };
  if (t.blocked) return { label: "Bloqueado", cls: "bg-red-500/15 text-red-600" };
  if (t.isVip) return { label: "VIP · cortesia", cls: "bg-amber-500/15 text-amber-600" };
  const s = t.asaasStatus;
  if (s === "past_due") return { label: "Inadimplente", cls: "bg-amber-500/15 text-amber-600" };
  if (s === "canceled") return { label: "Cancelado", cls: "bg-rose-500/15 text-rose-600" };
  if (s === "active") return { label: "Ativo", cls: "bg-green-500/15 text-green-600" };
  if (t.trialDaysLeft != null) return t.trialDaysLeft >= 0
    ? { label: `Trial ${t.trialDaysLeft}d`, cls: "bg-blue-500/15 text-blue-600" }
    : { label: "Trial vencido", cls: "bg-amber-500/15 text-amber-600" };
  return { label: "Legado", cls: "bg-muted text-muted-foreground/70" };
}
function asaasLabel(s: string | null | undefined): string {
  const m: Record<string, string> = { active: "ativa", past_due: "pgto pendente", canceled: "cancelada" };
  return s ? (m[s] || s) : "sem assinatura";
}

// Nome legível do CANAL a partir do provider técnico. evolution = WhatsApp não-oficial
// (whatsapp-web.js via Evolution); meta_oficial = canal oficial Meta Cloud (vem da tabela
// whatsapp_official_connections); instagram = Instagram Direct. Sem isso a tela mostrava
// "evolution" cru, que não diz nada pro super-admin.
function canalLabel(provider: string | null | undefined): string {
  switch ((provider || "").toLowerCase()) {
    case "evolution":
    case "webjs":
    case "whatsapp-web.js":
      return "WhatsApp · não-oficial";
    case "meta_oficial":
    case "meta":
    case "whatsapp_official":
      return "WhatsApp · oficial (Meta)";
    case "instagram":
      return "Instagram Direct";
    default:
      return provider || "Canal";
  }
}

// Status da conexão em PT-BR (a tabela guarda em inglês: connected/connecting/disconnected;
// o canal oficial usa active/inactive).
function canalStatusLabel(status: string | null | undefined): string {
  const m: Record<string, string> = {
    connected: "conectado", active: "conectado",
    connecting: "conectando", qr_pending: "aguardando QR",
    disconnected: "desconectado", inactive: "inativo",
  };
  return status ? (m[status.toLowerCase()] || status) : "—";
}

// Cargo legível do usuário (o que o cadastro realmente oferece): Administrador / Gerente / Atendente.
// Prioriza o role (gerente vs atendente); cai no accountType (gestor=Administrador) quando não há role.
function cargoLabel(role?: string | null, accountType?: string | null): string {
  const r = (role || "").toLowerCase();
  if (r === "admin" || r === "administrador") return "Administrador";
  if (r === "gerente") return "Gerente";
  if (r === "atendente") return "Atendente";
  if (accountType === "gestor") return "Administrador";
  if (accountType === "empreendedor") return "Atendente";
  return role || accountType || "—";
}
function cargoBadgeClass(label: string): string {
  if (label === "Administrador") return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
  if (label === "Gerente") return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  return "bg-amber-500/15 text-amber-600 dark:text-amber-400"; // Atendente / fallback
}

// Rótulos e ícones da timeline de atividade por usuário (modal da aba Logs).
const ACTIVITY_LABELS: Record<string, string> = {
  login: "Logins", logout: "Logouts", protocolo: "Protocolos", tag: "Tags",
  nota: "Anotações", chat_interno: "Chat interno", msg_apagada: "Msgs apagadas",
  reacao: "Reações", acao_ia: "Ações IA", prompt: "Prompts", relatorio: "Relatórios",
};
function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] || type;
}
function activityIcon(type: string): { icon: any; cls: string } {
  switch (type.split(":")[0]) {
    case "login": return { icon: LogIn, cls: "bg-green-500/15 text-green-600 dark:text-green-400" };
    case "logout": return { icon: LogOut, cls: "bg-base-300/60 text-base-content/60" };
    case "protocolo": return { icon: ShieldCheck, cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" };
    case "tag": return { icon: Tag, cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
    case "nota": return { icon: FileText, cls: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" };
    case "chat_interno": return { icon: MessageSquare, cls: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" };
    case "msg_apagada": return { icon: Trash2, cls: "bg-red-500/15 text-red-600 dark:text-red-400" };
    case "reacao": return { icon: Smile, cls: "bg-pink-500/15 text-pink-600 dark:text-pink-400" };
    case "acao_ia": return { icon: Sparkles, cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400" };
    case "prompt": return { icon: Edit3, cls: "bg-teal-500/15 text-teal-600 dark:text-teal-400" };
    case "relatorio": return { icon: BarChart3, cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400" };
    default: return { icon: Activity, cls: "bg-muted text-muted-foreground" };
  }
}

function adminFetch(path: string, token: string, opts?: RequestInit) {
  return fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers || {}) },
  });
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Formata valor em Real (R$ 1.234,56). Usado nos painéis de MRR/ARR/Receita.
function brl(n: number | null | undefined) {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Mês "2026-06" → "jun/26" pro eixo da evolução de receita.
function mesLabel(m: string) {
  const [y, mo] = (m || "").split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[(parseInt(mo) || 1) - 1] || mo}/${(y || "").slice(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-500/15 text-green-500",
    INACTIVE: "bg-red-500/15 text-red-500",
    INVITED: "bg-amber-500/15 text-amber-500",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${colors[status] || "bg-base-300/60 text-base-content/60"}`}>{status}</span>;
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${online ? "bg-success animate-pulse" : "bg-base-content/30"}`} />
      <span className={`text-[11px] font-semibold ${online ? "text-success" : "text-muted-foreground"}`}>{online ? "Online" : "Offline"}</span>
    </span>
  );
}

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [totp, setTotp] = useState("");
  const [show2fa, setShow2fa] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha, totp }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.totpRequired) setShow2fa(true); // 2FA ativo: revela o campo do código
        setError(data.error || "Erro ao fazer login");
        return;
      }
      onLogin(data.token);
    } catch {
      setError("Erro de conexão");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4"><NorteBrand size={40} /></div>
          <h1 className="text-xl font-bold text-foreground" data-testid="text-admin-title">Super Gerencial</h1>
          <p className="text-xs text-muted-foreground mt-1">Gestão de tenants — acesso restrito ao dono</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Usuário</label>
            <Input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Usuário"
              data-testid="input-admin-usuario"
            />
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Senha</label>
            <Input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha"
              data-testid="input-admin-senha"
            />
          </div>
          {show2fa && (
            <div>
              <label className="block text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Código de autenticação (2FA)</label>
              <Input
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                data-testid="input-admin-totp"
              />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
          <Button type="submit" className="w-full font-bold" disabled={loading} data-testid="button-admin-login">
            <Lock className="w-4 h-4 mr-2" />
            {loading ? "Autenticando..." : "Acessar Painel"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function SuperAdmin() {
  const { toast } = useToast();
  // Bruno 2026-06-13: "meu login já é a credencial do super admin". Se não houver
  // token do console (login próprio por env), cai na SESSÃO NORMAL do dono
  // (flowcrm_token) — o backend (requireSuperAdmin) aceita esse token quando o email
  // é super admin, então o dono entra DIRETO, sem pedir senha. Não-super-admin que
  // teimar na URL leva 403 → cai na tela de login do console (fallback).
  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem("superAdminToken") || localStorage.getItem("flowcrm_token")
  );
  const [tab, setTab] = useState<AdminTab>("dashboard");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [workspacesList, setWorkspacesList] = useState<AdminWorkspace[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [regByDay, setRegByDay] = useState<Record<string, number>>({});
  const [loginByDay, setLoginByDay] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  // Métricas SaaS — Visão Geral (MRR/ARR/churn/clientes) + Receita (por plano + evolução)
  const [overview, setOverview] = useState<any>(null);
  const [receita, setReceita] = useState<any>(null);
  // Avaliações (F2)
  const [avaliacoes, setAvaliacoes] = useState<AvalRow[]>([]);
  const [avalSummary, setAvalSummary] = useState<Record<string, number>>({});
  const [avalWs, setAvalWs] = useState<{ workspace_id: string; nome: string | null }[]>([]);
  const [avalVerdict, setAvalVerdict] = useState("");
  const [avalWsFilter, setAvalWsFilter] = useState("");
  const [avalPending, setAvalPending] = useState(false);
  const [selAval, setSelAval] = useState<AvalDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reviewVerdict, setReviewVerdict] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState<{ done: number; total: number; status: string } | null>(null);
  const [runDays, setRunDays] = useState(30);
  // Tenants (governança)
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [selTenant, setSelTenant] = useState<TenantDetail | null>(null);
  const [tenantBusy, setTenantBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [resetResult, setResetResult] = useState<{ userId: number; password: string } | null>(null);
  // Modal de atividade por usuário (aba Logs): histórico de tudo que o atendente alterou.
  const [activityUser, setActivityUser] = useState<LogEntry | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const handleLogin = (t: string) => {
    setToken(t);
    sessionStorage.setItem("superAdminToken", t);
  };

  const handleLogout = () => {
    setToken(null);
    sessionStorage.removeItem("superAdminToken");
  };

  // "Sair" do console: se a entrada foi pela sessão normal do dono (sem token de
  // console por env), volta pro app — não faz sentido cair na tela de login do
  // console (a sessão do tenant continua válida). Caso contrário, logout normal.
  const handleExitConsole = () => {
    sessionStorage.removeItem("superAdminToken");
    if (localStorage.getItem("flowcrm_token")) {
      window.location.href = "/inicio";
    } else {
      setToken(null);
    }
  };

  // ── Tenants (monitoramento + governança) ──
  const loadTenants = async (archived = showArchived) => {
    if (!token) return;
    setLoadingTenants(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants${archived ? "?archived=1" : ""}`, token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) setTenants(data.data);
    } catch {} finally { setLoadingTenants(false); }
  };
  const openTenant = async (id: string) => {
    if (!token) return;
    setSelTenant(null); setConfirmBlock(null);
    setEditingName(false); setConfirmDelete(false); setDeleteText(""); setResetResult(null);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}`, token);
      const data = await res.json();
      if (data.ok) setSelTenant(data.data);
    } catch {}
  };
  const blockTenant = async (id: string, block: boolean) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/${block ? "block" : "unblock"}`, token, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast({ title: block ? "Tenant bloqueado" : "Tenant desbloqueado", description: block ? "Login barrado e sessões derrubadas na hora." : "Acesso liberado." });
        setConfirmBlock(null);
        await loadTenants();
        if (selTenant?.workspace?.id === id) await openTenant(id);
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  const setTenantVip = async (id: string, vip: boolean) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/vip`, token, { method: "POST", body: JSON.stringify({ vip }) });
      const data = await res.json();
      if (data.ok) {
        toast({ title: vip ? "Cliente VIP ativado" : "VIP removido", description: vip ? "Isento de cobrança e bloqueio — liberado na hora." : "Volta a seguir as regras de cobrança." });
        await loadTenants();
        if (selTenant?.workspace?.id === id) await openTenant(id);
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  const setTenantTrial = async (id: string, days: number) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/trial`, token, { method: "POST", body: JSON.stringify({ days }) });
      const data = await res.json();
      if (data.ok) {
        toast({ title: days > 0 ? `Trial: +${days} dias` : "Trial removido" });
        await loadTenants();
        if (selTenant?.workspace?.id === id) await openTenant(id);
      }
    } catch {} finally { setTenantBusy(false); }
  };
  const setTenantPlano = async (id: string, planoId: string | null) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/plano`, token, { method: "POST", body: JSON.stringify({ planoId }) });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "Plano atualizado", description: "Override manual — não altera a assinatura Asaas." });
        await loadTenants();
        if (selTenant?.workspace?.id === id) await openTenant(id);
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  // Entrar como o tenant: grava o JWT do tenant no localStorage e abre o app dele.
  // Antes de sobrescrever, salva a sessão atual do super-admin em sessionStorage
  // (partnerToken/partnerUser) → o App mostra o banner "Voltar ao painel" e restaura
  // a sessão do dono sem pedir login de novo. (O console também aceita o flowcrm_token
  // do dono por ser super admin, mas o tenant token NÃO é super admin — sem esse
  // backup você ficaria preso no workspace do cliente.)
  const impersonateTenant = async (id: string) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/impersonate`, token, { method: "POST" });
      const data = await res.json();
      if (data.ok && data.token) {
        // Salva a sessão do super-admin (backup) e assume a do tenant. "Voltar ao
        // painel" retorna pra cá (/super-admin). Toda a lógica vive em @/lib/impersonation.
        enterImpersonation(data.token, data.user, "/super-admin");
        toast({ title: "Entrando como o tenant…" });
        window.location.href = "/inicio";
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  const resetUserPassword = async (wsId: string, userId: number, nome: string) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${wsId}/users/${userId}/reset-password`, token, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setResetResult({ userId, password: data.tempPassword });
        try { await navigator.clipboard.writeText(data.tempPassword); } catch {}
        toast({ title: `Senha de ${nome} resetada`, description: `Nova senha copiada: ${data.tempPassword}` });
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  // Abre o modal de atividade do usuário e busca a timeline no backend.
  const openUserActivity = async (u: LogEntry) => {
    if (!token) return;
    setActivityUser(u);
    setActivity(null);
    setActivityLoading(true);
    try {
      const res = await adminFetch(`/api/super-admin/users/${u.id}/activity`, token);
      const data = await res.json();
      if (data.ok) setActivity(data.data);
      else toast({ title: "Erro", description: data.error || "Falha ao carregar atividade", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setActivityLoading(false); }
  };
  const renameTenant = async (id: string, nome: string) => {
    if (!token || nome.trim().length < 2) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/rename`, token, { method: "POST", body: JSON.stringify({ nome: nome.trim() }) });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "Tenant renomeado" });
        setEditingName(false);
        await loadTenants();
        if (selTenant?.workspace?.id === id) await openTenant(id);
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  const deleteTenant = async (id: string) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}`, token, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "Tenant arquivado", description: "Sumiu da lista e o login foi barrado. Dá pra restaurar em 'mostrar arquivados'." });
        setConfirmDelete(false); setDeleteText(""); setSelTenant(null);
        await loadTenants();
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };
  const restoreTenant = async (id: string) => {
    if (!token) return;
    setTenantBusy(true);
    try {
      const res = await adminFetch(`/api/super-admin/tenants/${id}/restore`, token, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast({ title: "Tenant restaurado" });
        await loadTenants();
        if (selTenant?.workspace?.id === id) await openTenant(id);
      } else toast({ title: "Erro", description: data.error || "Falha", variant: "destructive" });
    } catch (e: any) { toast({ title: "Erro", description: e.message, variant: "destructive" }); }
    finally { setTenantBusy(false); }
  };

  const loadDashboard = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await adminFetch("/api/super-admin/dashboard", token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) {
        setStats(data.data.stats);
        setUsersList(data.data.users);
        setWorkspacesList(data.data.workspaces);
        setRegByDay(data.data.registrationsByDay || {});
        setLoginByDay(data.data.loginsByDay || {});
      }
    } catch { toast({ title: "Erro ao carregar dados", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const loadLogs = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await adminFetch("/api/super-admin/logs", token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) setLogs(data.data);
    } catch { toast({ title: "Erro ao carregar logs", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  // Visão Geral: KPIs de negócio da plataforma (MRR/ARR/ARPU, clientes por situação, churn).
  const loadOverview = async () => {
    if (!token) return;
    try {
      const res = await adminFetch("/api/super-admin/overview", token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) setOverview(data.data);
    } catch { /* silencioso — não trava a tela */ }
  };

  // Receita: MRR por plano + evolução mensal (confirmado vs perdido).
  const loadReceita = async () => {
    if (!token) return;
    try {
      const res = await adminFetch("/api/super-admin/receita", token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) setReceita(data.data);
    } catch { /* silencioso */ }
  };

  const loadAvaliacoes = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (avalVerdict) qs.set("verdict", avalVerdict);
      if (avalWsFilter) qs.set("workspaceId", avalWsFilter);
      if (avalPending) qs.set("pending", "1");
      const res = await adminFetch(`/api/super-admin/avaliacoes?${qs.toString()}`, token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) { setAvaliacoes(data.data); setAvalSummary(data.summary || {}); setAvalWs(data.workspaces || []); }
    } catch { toast({ title: "Erro ao carregar avaliações", variant: "destructive" }); }
    finally { setLoading(false); }
  };

  const openAvaliacao = async (id: string) => {
    if (!token) return;
    setLoadingDetail(true); setSelAval(null);
    try {
      const res = await adminFetch(`/api/super-admin/avaliacoes/${id}`, token);
      const data = await res.json();
      if (data.ok) {
        setSelAval(data.data);
        setReviewVerdict(data.data.evaluation.human_verdict || data.data.evaluation.verdict || "");
        setReviewNotes(data.data.evaluation.human_notes || "");
      }
    } catch { toast({ title: "Erro ao abrir avaliação", variant: "destructive" }); }
    finally { setLoadingDetail(false); }
  };

  const saveReview = async () => {
    if (!token || !selAval) return;
    setSavingReview(true);
    try {
      const res = await adminFetch(`/api/super-admin/avaliacoes/${selAval.evaluation.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ humanVerdict: reviewVerdict || null, humanNotes: reviewNotes || null }),
      });
      if (res.ok) { toast({ title: "Revisão salva ✓" }); setSelAval(null); loadAvaliacoes(); }
      else toast({ title: "Erro ao salvar revisão", variant: "destructive" });
    } catch { toast({ title: "Erro ao salvar revisão", variant: "destructive" }); }
    finally { setSavingReview(false); }
  };

  const pollJob = async (jobId: string) => {
    if (!token) return;
    try {
      const res = await adminFetch(`/api/super-admin/avaliacoes-run/${jobId}`, token);
      const data = await res.json();
      if (data.ok && data.job) {
        setRunProgress({ done: data.job.done, total: data.job.total, status: data.job.status });
        if (data.job.status === "running") { setTimeout(() => pollJob(jobId), 2000); return; }
        setRunning(false);
        toast({
          title: data.job.status === "done" ? `Avaliação concluída: ${data.job.ok} ok, ${data.job.failed} falhas` : `Erro na avaliação: ${data.job.error || ""}`,
          variant: data.job.status === "error" ? "destructive" : undefined,
        });
        setTimeout(() => setRunProgress(null), 4000);
        loadAvaliacoes(); loadHealth();
        return;
      }
    } catch { /* erro transitório → tenta de novo */ }
    setTimeout(() => pollJob(jobId), 3000);
  };

  const runEvaluation = async () => {
    if (!token) return;
    if (!avalWsFilter) { toast({ title: "Selecione um tenant primeiro", variant: "destructive" }); return; }
    setRunning(true); setRunProgress({ done: 0, total: 0, status: "running" });
    try {
      const res = await adminFetch("/api/super-admin/avaliacoes-run", token, {
        method: "POST", body: JSON.stringify({ workspaceId: avalWsFilter, days: runDays }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { toast({ title: data.error || "Erro ao iniciar", variant: "destructive" }); setRunning(false); setRunProgress(null); return; }
      if (data.total === 0) { toast({ title: "Nenhuma conversa finalizada nova nessa janela" }); setRunning(false); setRunProgress(null); return; }
      setRunProgress({ done: 0, total: data.total, status: "running" });
      pollJob(data.jobId);
    } catch { toast({ title: "Erro ao iniciar avaliação", variant: "destructive" }); setRunning(false); setRunProgress(null); }
  };

  const loadHealth = async () => {
    if (!token) return;
    try {
      const qs = new URLSearchParams();
      if (avalWsFilter) qs.set("workspaceId", avalWsFilter);
      const res = await adminFetch(`/api/super-admin/avaliacoes-health?${qs.toString()}`, token);
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const data = await res.json();
      if (data.ok) setHealth(data.data);
    } catch { toast({ title: "Erro ao carregar saúde", variant: "destructive" }); }
  };

  useEffect(() => {
    if (token) {
      loadDashboard();
      loadOverview();
      loadReceita();
      loadTenants();
      loadLogs();
      loadAvaliacoes();
      loadHealth();
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (tab === "avaliacoes") loadAvaliacoes();
    if (tab === "saude") loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avalVerdict, avalWsFilter, avalPending]);

  const toggleUserStatus = async (userId: number, currentStatus: string) => {
    if (!token) return;
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await adminFetch(`/api/super-admin/users/${userId}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast({ title: `Usuário ${newStatus === "ACTIVE" ? "ativado" : "desativado"} com sucesso` });
        loadDashboard();
        loadLogs();
      }
    } catch { toast({ title: "Erro ao atualizar status", variant: "destructive" }); }
  };

  const deleteUser = async (userId: number, userName: string) => {
    if (!token) return;
    if (!confirm(`Tem certeza que deseja EXCLUIR permanentemente o usuário "${userName}"? Esta ação não pode ser desfeita.`)) return;
    try {
      const res = await adminFetch(`/api/super-admin/users/${userId}`, token, { method: "DELETE" });
      if (res.ok) {
        toast({ title: `Usuário "${userName}" excluído com sucesso` });
        loadDashboard();
        loadLogs();
      }
    } catch { toast({ title: "Erro ao excluir usuário", variant: "destructive" }); }
  };

  const filteredUsers = useMemo(() => {
    let filtered = [...usersList];
    if (search.trim()) {
      const s = search.toLowerCase();
      filtered = filtered.filter(u =>
        u.nome.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.workspaceId || "").toLowerCase().includes(s) ||
        u.accountType.toLowerCase().includes(s) ||
        cargoLabel(u.role, u.accountType).toLowerCase().includes(s)
      );
    }
    filtered.sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal) : aVal - bVal;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [usersList, search, sortKey, sortDir]);

  const filteredLogs = useMemo(() => {
    if (!search.trim()) return logs;
    const s = search.toLowerCase();
    return logs.filter(l =>
      l.nome.toLowerCase().includes(s) ||
      l.email.toLowerCase().includes(s) ||
      l.workspaceName.toLowerCase().includes(s) ||
      cargoLabel(l.role, l.accountType).toLowerCase().includes(s)
    );
  }, [logs, search]);

  const groupedLogs = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      workspaceName: string;
      workspacePlan: string;
      workspaceCreatedAt: string | null;
      trialExpiresAt: string | null;
      users: LogEntry[];
    }>();
    for (const l of filteredLogs) {
      const key = l.workspaceId || "__none__";
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          workspaceName: l.workspaceName || "Sem workspace",
          workspacePlan: l.workspacePlan,
          workspaceCreatedAt: l.workspaceCreatedAt,
          trialExpiresAt: l.trialExpiresAt,
          users: [],
        };
        groups.set(key, g);
      }
      g.users.push(l);
    }
    // grupos sem workspace por último; resto ordenado por nome do tenant
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.workspaceName.localeCompare(b.workspaceName, "pt-BR");
    });
  }, [filteredLogs]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;

  const onlineNow = usersList.filter(u => u.online);
  const wsMap = new Map(workspacesList.map(w => [w.id, w]));

  const groupedUsers = (() => {
    const groups = new Map<string, {
      key: string;
      workspaceName: string;
      workspacePlan: string | null;
      trialExpiresAt: string | null;
      users: typeof filteredUsers;
    }>();
    for (const u of filteredUsers) {
      const key = u.workspaceId || "__none__";
      let g = groups.get(key);
      if (!g) {
        const ws = u.workspaceId ? wsMap.get(u.workspaceId) : null;
        g = {
          key,
          workspaceName: ws?.nome || "Sem workspace",
          workspacePlan: ws?.partnerPlan || null,
          trialExpiresAt: ws?.trialExpiresAt || null,
          users: [],
        };
        groups.set(key, g);
      }
      g.users.push(u);
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.workspaceName.localeCompare(b.workspaceName, "pt-BR");
    });
  })();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NorteBrand size={34} />
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Super Gerencial
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button onClick={() => { window.location.href = "/inicio"; }} variant="outline" size="sm" className="gap-1.5" data-testid="button-back-to-app">
              <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Voltar ao Norte Gestão</span>
            </Button>
            <Button onClick={() => { loadDashboard(); loadOverview(); loadReceita(); loadTenants(); loadLogs(); }} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" data-testid="button-admin-refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button onClick={handleExitConsole} variant="ghost" size="sm" className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400" data-testid="button-admin-logout">
              <LogOut className="w-4 h-4 mr-1" />Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-1 mb-6 bg-card border border-border rounded-xl p-1 overflow-x-auto">
          {([
            { key: "dashboard", label: "Visão Geral", icon: BarChart3 },
            { key: "receita", label: "Receita", icon: DollarSign },
            { key: "tenants", label: "Tenants", icon: Building2 },
            { key: "usuarios", label: "Usuários", icon: Users },
            { key: "logs", label: "Logs & Registro", icon: Activity },
            { key: "avaliacoes", label: "Avaliações", icon: Eye },
            { key: "saude", label: "Saúde do Agente", icon: TrendingUp },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`seg-tab flex-1 justify-center ${tab === key ? "seg-tab-active" : ""}`}
              data-testid={`tab-admin-${key}`}
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>

        {tab === "tenants" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <Input placeholder="Buscar tenant por nome…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-tenant-search" />
              </div>
              <span className="text-xs text-muted-foreground">{tenants.length} tenants</span>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none" title="Mostra tenants arquivados (excluídos) pra restaurar">
                <input type="checkbox" checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); loadTenants(e.target.checked); }} className="accent-primary" data-testid="toggle-archived" />
                mostrar arquivados
              </label>
              <Button onClick={() => loadTenants()} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" data-testid="button-tenants-refresh">
                <RefreshCw className={`w-4 h-4 ${loadingTenants ? "animate-spin" : ""}`} />
              </Button>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="table-tenants">
                  <thead>
                    <tr className="border-b border-border">
                      {["Tenant", "Situação", "Assinatura", "Usuários", "Canais", "Conversas 30d", "Última atividade", "IA", "CSAT", ""].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] font-medium text-base-content/70 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.filter((t) => !search.trim() || t.nome.toLowerCase().includes(search.toLowerCase())).map((t) => {
                      const b = tenantBadge(t);
                      return (
                        <tr key={t.id} className="border-b border-border/50 hover:bg-base-200/40 cursor-pointer transition-colors" onClick={() => openTenant(t.id)} data-testid={`row-tenant-${t.id}`}>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">{t.blocked && <Ban className="w-3 h-3 text-red-600 shrink-0" />}{t.isVip && <Star className="w-3 h-3 fill-amber-500 text-amber-500 shrink-0" />}{t.nome}</div>
                            <div className="text-[10px] text-muted-foreground/70">{cargoLabel(null, t.accountType)}{t.partnerPlan ? ` · ${t.partnerPlan}` : ""}</div>
                          </td>
                          <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${b.cls}`}>{b.label}</span></td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {t.isVip ? (
                              <span className="text-[11px] text-amber-600 font-semibold">Cortesia (VIP)</span>
                            ) : t.planoNome ? (
                              <div className="text-[11px] leading-tight">
                                <div className="font-semibold text-foreground">{t.planoNome}</div>
                                <div className="text-muted-foreground/70 tabular-nums">
                                  {t.valorMensal ? `${brl(t.valorMensal)}/mês` : "—"}
                                  {t.vencimento ? ` · vence ${new Date(t.vencimento).toLocaleDateString("pt-BR")}` : ""}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/60">sem assinatura</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs tabular-nums"><span className="font-bold text-foreground">{t.usersAtivos}</span><span className="text-muted-foreground/70">/{t.users}</span></td>
                          <td className="px-3 py-2.5 text-xs">
                            <span className="inline-flex items-center gap-1 tabular-nums">{t.connected > 0 ? <Wifi className="w-3 h-3 text-green-600" /> : <WifiOff className="w-3 h-3 text-muted-foreground/60" />}<span className="font-bold text-foreground">{t.connected}</span><span className="text-muted-foreground/70">/{t.connections}</span></span>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-bold text-foreground tabular-nums">{t.conversas30d}</td>
                          <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">{t.lastActivity ? formatDate(t.lastActivity) : "—"}</td>
                          <td className="px-3 py-2.5 text-[11px]">{t.aiKey ? <span className="text-green-600 font-bold" title="Chave OpenAI configurada">✓</span> : <span className="text-amber-600 font-bold" title="Sem chave OpenAI — a IA deste tenant não responde">✗</span>}</td>
                          <td className="px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums">{t.csat != null ? t.csat : "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground/70"><Eye className="w-3.5 h-3.5" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {tenants.length === 0 && (
                <div className="text-center py-10 text-muted-foreground/70">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">{loadingTenants ? "Carregando…" : "Nenhum tenant"}</p>
                </div>
              )}
            </Card>

            {selTenant && (() => {
              const w = selTenant.workspace;
              const m = selTenant.metrics;
              const kpis = [
                { label: "Conversas 30d", value: m.conversas30d },
                { label: "Sessões 30d", value: m.ispSessions30d },
                { label: "Escalação", value: m.escalacaoPct != null ? `${m.escalacaoPct}%` : "—" },
                { label: "CSAT", value: m.csat != null ? m.csat : "—" },
                { label: "P0 (30d)", value: m.evalP0 },
                { label: "Canais", value: `${selTenant.connections.filter(c => c.status === "connected").length}/${selTenant.connections.length}` },
              ];
              return (
                <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4" onClick={() => { setSelTenant(null); setConfirmBlock(null); }} data-testid="modal-tenant-detail">
                <Card className="p-5 space-y-4 w-full max-w-4xl my-8 shadow-2xl" data-testid="card-tenant-detail" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 className="w-4 h-4 text-primary" />
                        {editingName ? (
                          <>
                            <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="h-7 text-sm w-56" autoFocus data-testid="input-rename-tenant" />
                            <Button onClick={() => renameTenant(w.id, nameInput)} disabled={tenantBusy} size="sm" className="h-7" data-testid="button-save-rename">Salvar</Button>
                            <Button onClick={() => setEditingName(false)} variant="ghost" size="sm" className="h-7">Cancelar</Button>
                          </>
                        ) : (
                          <>
                            <h3 className="text-sm font-bold text-foreground">{w.nome}</h3>
                            <button onClick={() => { setNameInput(w.nome); setEditingName(true); }} className="text-muted-foreground hover:text-foreground" title="Renomear" data-testid="button-rename-tenant"><Edit3 className="w-3.5 h-3.5" /></button>
                            {w.blocked && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/15 text-red-600">Bloqueado</span>}
                            {w.status === "deleted" && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-muted text-muted-foreground">Arquivado</span>}
                          </>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                        {cargoLabel(null, w.accountType)}{w.partnerPlan ? ` · ${w.partnerPlan}` : ""} · assinatura {w.isVip ? "cortesia (VIP)" : asaasLabel(w.asaasSubscriptionStatus)} · criado {formatDate(w.createdAt)}
                        {w.trialExpiresAt ? ` · trial até ${formatDate(w.trialExpiresAt)}` : ""}
                        <span className={`ml-1 font-bold ${selTenant.aiKey ? "text-green-600" : "text-amber-600"}`}>· IA {selTenant.aiKey ? "configurada" : "SEM chave"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button onClick={() => impersonateTenant(w.id)} disabled={tenantBusy} size="sm" className="bg-primary text-primary-foreground hover:opacity-90" data-testid="button-impersonate"><LogIn className="w-4 h-4 mr-1" />Entrar como tenant</Button>
                      <Button onClick={() => { setSelTenant(null); setConfirmBlock(null); }} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">Fechar</Button>
                    </div>
                  </div>

                  {/* Ações de governança */}
                  <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted border border-border">
                    {w.blocked ? (
                      <Button onClick={() => blockTenant(w.id, false)} disabled={tenantBusy} size="sm" className="bg-success hover:bg-success/90 text-success-content" data-testid="button-unblock-tenant">
                        <ShieldCheck className="w-4 h-4 mr-1" />Desbloquear tenant
                      </Button>
                    ) : confirmBlock === w.id ? (
                      <Button onClick={() => blockTenant(w.id, true)} disabled={tenantBusy} size="sm" variant="destructive" data-testid="button-confirm-block">
                        <Ban className="w-4 h-4 mr-1" />Confirmar bloqueio?
                      </Button>
                    ) : (
                      <Button onClick={() => setConfirmBlock(w.id)} disabled={tenantBusy} size="sm" variant="outline" className="text-red-600 border-red-500/30 hover:bg-red-500/10" data-testid="button-block-tenant">
                        <Ban className="w-4 h-4 mr-1" />Bloquear tenant
                      </Button>
                    )}
                    <span className="w-px h-6 bg-border mx-1" />
                    {w.isVip ? (
                      <Button onClick={() => setTenantVip(w.id, false)} disabled={tenantBusy} size="sm" variant="outline" className="text-amber-600 border-amber-500/40 hover:bg-amber-500/10" data-testid="button-vip-off">
                        <Star className="w-4 h-4 mr-1 fill-amber-500 text-amber-500" />Remover VIP
                      </Button>
                    ) : (
                      <Button onClick={() => setTenantVip(w.id, true)} disabled={tenantBusy} size="sm" variant="outline" className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10" data-testid="button-vip-on">
                        <Star className="w-4 h-4 mr-1" />Tornar VIP
                      </Button>
                    )}
                    <span className="w-px h-6 bg-border mx-1" />
                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Trial</span>
                    {[7, 15, 30].map((d) => (
                      <Button key={d} onClick={() => setTenantTrial(w.id, d)} disabled={tenantBusy} size="sm" variant="outline" className="h-7 px-2 text-[11px]">+{d}d</Button>
                    ))}
                    <Button onClick={() => setTenantTrial(w.id, 0)} disabled={tenantBusy} size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground">limpar</Button>
                    <span className="w-px h-6 bg-border mx-1" />
                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Plano</span>
                    <select value={w.planoId || ""} disabled={tenantBusy} onChange={(e) => setTenantPlano(w.id, e.target.value || null)} className="h-7 rounded-md border border-border bg-background text-[11px] px-2 text-foreground" data-testid="select-tenant-plano" title="Override manual do plano — não altera a assinatura Asaas">
                      <option value="">Sem plano</option>
                      {(selTenant.planos || []).map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}{p.preco ? ` — R$ ${Number(p.preco).toLocaleString("pt-BR")}` : ""}</option>
                      ))}
                    </select>
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
                    {kpis.map((k, i) => (
                      <div key={i} className="rounded-lg border border-border bg-muted/40 p-2.5">
                        <div className="text-[9px] font-bold text-muted-foreground/70 uppercase">{k.label}</div>
                        <div className="text-lg font-bold text-foreground tabular-nums mt-0.5">{k.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {/* Usuários */}
                    <div>
                      <h4 className="text-[11px] font-bold text-muted-foreground uppercase mb-2 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Usuários ({selTenant.users.length})</h4>
                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                        {selTenant.users.map((u) => (
                          <div key={u.id} data-testid={`tenant-user-${u.id}`}>
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/40">
                              <OnlineDot online={u.online} />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-foreground truncate">{u.nome}</div>
                                <div className="text-[10px] text-muted-foreground/70 truncate">{u.email} · {cargoLabel(u.role, u.accountType)}</div>
                              </div>
                              <button onClick={() => resetUserPassword(w.id, u.id, u.nome)} disabled={tenantBusy} className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40" title="Resetar senha" data-testid={`button-reset-pw-${u.id}`}><KeyRound className="w-3.5 h-3.5" /></button>
                              <StatusBadge status={u.status} />
                            </div>
                            {resetResult?.userId === u.id && (
                              <div className="mt-1 flex items-center gap-2 px-2 py-1.5 rounded-md bg-green-500/10 border border-green-500/30 text-[10.5px]">
                                <KeyRound className="w-3 h-3 text-green-600 shrink-0" />
                                <span className="text-foreground">Nova senha: <span className="font-mono font-bold select-all">{resetResult.password}</span> <span className="text-muted-foreground/70">(copiada — repasse e peça pra trocar)</span></span>
                                <button onClick={() => setResetResult(null)} className="ml-auto text-muted-foreground hover:text-foreground font-bold">×</button>
                              </div>
                            )}
                          </div>
                        ))}
                        {selTenant.users.length === 0 && <p className="text-xs text-muted-foreground/70">Nenhum usuário.</p>}
                      </div>
                    </div>
                    {/* Conexões */}
                    <div>
                      <h4 className="text-[11px] font-bold text-muted-foreground uppercase mb-2 flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" />Canais ({selTenant.connections.length})</h4>
                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                        {selTenant.connections.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/40" data-testid={`tenant-conn-${c.id}`}>
                            {c.status === "connected" ? <Wifi className="w-3.5 h-3.5 text-green-600 shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-foreground truncate">{c.nome}</div>
                              <div className="text-[10px] text-muted-foreground/70 truncate">{canalLabel(c.provider)}{c.numero ? ` · ${c.numero}` : ""}</div>
                            </div>
                            <span className={`text-[10px] font-bold ${c.status === "connected" ? "text-green-600" : "text-muted-foreground/70"}`}>{canalStatusLabel(c.status)}</span>
                          </div>
                        ))}
                        {selTenant.connections.length === 0 && <p className="text-xs text-muted-foreground/70">Nenhum canal.</p>}
                      </div>
                    </div>
                  </div>

                  {/* Danger zone — excluir (arquivar) / restaurar */}
                  <div className="border-t border-border pt-3">
                    {w.status === "deleted" ? (
                      <Button onClick={() => restoreTenant(w.id)} disabled={tenantBusy} size="sm" variant="outline" className="text-green-600 border-green-500/40 hover:bg-green-500/10" data-testid="button-restore-tenant"><RotateCcw className="w-4 h-4 mr-1" />Restaurar tenant</Button>
                    ) : confirmDelete ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-red-600 font-semibold">Digite o nome do tenant pra confirmar:</span>
                        <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={w.nome} className="h-7 w-52 text-xs" data-testid="input-confirm-delete" />
                        <Button onClick={() => deleteTenant(w.id)} disabled={tenantBusy || deleteText.trim() !== w.nome} size="sm" variant="destructive" data-testid="button-confirm-delete"><Trash2 className="w-4 h-4 mr-1" />Excluir</Button>
                        <Button onClick={() => { setConfirmDelete(false); setDeleteText(""); }} variant="ghost" size="sm">Cancelar</Button>
                      </div>
                    ) : (
                      <Button onClick={() => setConfirmDelete(true)} disabled={tenantBusy} size="sm" variant="ghost" className="text-red-600 hover:bg-red-500/10" data-testid="button-delete-tenant"><Trash2 className="w-4 h-4 mr-1" />Excluir tenant</Button>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-1.5">Excluir <b>arquiva</b> o tenant: some da lista e o login é barrado na hora. Não apaga dados — dá pra restaurar em "mostrar arquivados".</p>
                  </div>
                </Card>
                </div>
              );
            })()}
          </div>
        )}

        {tab === "dashboard" && stats && (
          <div className="space-y-6">
            {/* ── KPIs de NEGÓCIO (fonte: /overview — Asaas + subscription_events) ── */}
            {overview && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: "MRR", value: brl(overview.mrr), sub: "receita recorrente / mês", icon: DollarSign, color: "#10b981" },
                    { label: "ARR", value: brl(overview.arr), sub: "projeção anual (MRR × 12)", icon: TrendingUp, color: "hsl(var(--primary))" },
                    { label: "ARPU", value: brl(overview.arpu), sub: "média por cliente pagante", icon: UserCheck, color: "#8b5cf6" },
                    { label: "Churn", value: `${overview.crescimento?.churnPct ?? 0}%`, sub: `${overview.crescimento?.cancelados ?? 0} cancel. · ${brl(overview.crescimento?.mrrPerdido)} em ${overview.days}d`, icon: AlertTriangle, color: (overview.crescimento?.churnPct ?? 0) > 5 ? "#ef4444" : "#f59e0b" },
                  ].map((s, i) => (
                    <Card key={i} className="p-5 bg-base-100 border-base-200">
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-field grid place-items-center shrink-0 bg-base-200 text-base-content/70">
                          <s.icon className="w-[18px] h-[18px]" />
                        </span>
                        <span className="text-[13px] font-medium text-base-content/70">{s.label}</span>
                      </div>
                      <div className="text-[26px] font-bold text-base-content tabular-nums leading-none mt-3.5">{s.value}</div>
                      <p className="text-[11px] text-base-content/45 mt-1.5">{s.sub}</p>
                    </Card>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Pagantes", value: overview.clientes?.pagantes ?? 0, icon: Power, color: "#10b981" },
                    { label: "Em Trial", value: overview.clientes?.trial ?? 0, icon: Clock, color: "#8b5cf6" },
                    { label: "Inadimplentes", value: overview.clientes?.inadimplentes ?? 0, icon: Ban, color: "#ef4444" },
                    { label: "VIP (cortesia)", value: overview.clientes?.vip ?? 0, icon: Star, color: "#f59e0b" },
                    { label: "Cancelados", value: overview.clientes?.cancelados ?? 0, icon: PowerOff, color: "#ef4444" },
                    { label: `Novos (${overview.days}d)`, value: overview.crescimento?.novos ?? 0, icon: UserPlus, color: "hsl(var(--primary))" },
                  ].map((s, i) => (
                    <Card key={i} className="p-4 bg-base-100 border-base-200">
                      <div className="flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-field grid place-items-center shrink-0 bg-base-200 text-base-content/70">
                          <s.icon className="w-[18px] h-[18px]" />
                        </span>
                        <span className="text-[10px] font-medium text-base-content/70 uppercase tracking-wide">{s.label}</span>
                      </div>
                      <div className="text-[22px] font-bold text-base-content tabular-nums leading-none mt-3">{s.value}</div>
                    </Card>
                  ))}
                </div>

                <div className="border-t border-border/60 pt-3">
                  <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wide">Operacional · usuários e atividade da plataforma</p>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Total Usuários", value: stats.totalUsers, icon: Users, color: "hsl(var(--primary))" },
                { label: "Online Agora", value: stats.onlineUsers, icon: Monitor, color: "#10b981" },
                { label: "Gerentes/Atendentes", value: stats.empreendedorCount, icon: UserCheck, color: "#f59e0b" },
                { label: "Administradores", value: stats.gestorCount, icon: Briefcase, color: "#8b5cf6" },
                { label: "Workspaces", value: stats.totalWorkspaces, icon: Building2, color: "hsl(var(--primary))" },
                { label: "Ativos", value: stats.activeCount, icon: Power, color: "#10b981" },
                { label: "Inativos", value: stats.inactiveCount, icon: PowerOff, color: "#ef4444" },
                { label: "Convidados", value: stats.invitedCount, icon: UserPlus, color: "#f59e0b" },
                { label: "WS Ativos", value: stats.activeWorkspaces, icon: Building2, color: "#10b981" },
                { label: "Em Trial", value: stats.trialWorkspaces, icon: Clock, color: "#8b5cf6" },
              ].map((s, i) => (
                <Card key={i} className="p-4 bg-base-100 border-base-200">
                  <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-field grid place-items-center shrink-0 bg-base-200 text-base-content/70">
                      <s.icon className="w-[18px] h-[18px]" />
                    </span>
                    <span className="text-[10px] font-medium text-base-content/70 uppercase tracking-wide">{s.label}</span>
                  </div>
                  <div className="text-[22px] font-bold text-base-content tabular-nums leading-none mt-3">{s.value}</div>
                </Card>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-5 bg-card border-border">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Monitor className="w-4 h-4 text-green-500" />Usuários Online ({onlineNow.length})</h3>
                {onlineNow.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70">Nenhum usuário online no momento</p>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {onlineNow.map(u => (
                      <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted" data-testid={`user-online-${u.id}`}>
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold truncate">{u.nome}</div>
                          <div className="text-[10px] text-muted-foreground/70 truncate">{u.email}</div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 font-bold">{cargoLabel(u.role, u.accountType)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-5 bg-card border-border">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-tertiary-600 dark:text-tertiary-500" />Workspaces ({workspacesList.length})</h3>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {workspacesList.map(ws => (
                    <div key={ws.id} className="flex items-center justify-between p-2 rounded-lg bg-muted" data-testid={`workspace-${ws.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">{ws.nome}</div>
                        <div className="text-[10px] text-muted-foreground/70">{cargoLabel(null, ws.accountType)} · {ws.partnerPlan || "—"} · Criado {formatDate(ws.createdAt)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {ws.trialExpiresAt && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 font-bold">Trial</span>
                        )}
                        <StatusBadge status={ws.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-5 bg-card border-border">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-amber-600 dark:text-amber-400" />Cadastros por Dia</h3>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {Object.entries(regByDay).sort(([a], [b]) => b.localeCompare(a)).map(([day, count]) => (
                    <div key={day} className="flex items-center justify-between py-1">
                      <span className="text-[11px] text-muted-foreground">{day}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-amber-500/30" style={{ width: `${Math.min(count * 30, 150)}px` }}>
                          <div className="h-2 rounded-full bg-amber-500" style={{ width: "100%" }} />
                        </div>
                        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                  {Object.keys(regByDay).length === 0 && <p className="text-xs text-muted-foreground/70">Nenhum registro encontrado</p>}
                </div>
              </Card>

              <Card className="p-5 bg-card border-border">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-tertiary-600 dark:text-tertiary-500" />Logins por Dia</h3>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {Object.entries(loginByDay).sort(([a], [b]) => b.localeCompare(a)).map(([day, count]) => (
                    <div key={day} className="flex items-center justify-between py-1">
                      <span className="text-[11px] text-muted-foreground">{day}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-primary/30" style={{ width: `${Math.min(count * 30, 150)}px` }}>
                          <div className="h-2 rounded-full bg-primary" style={{ width: "100%" }} />
                        </div>
                        <span className="text-[11px] font-bold text-tertiary-600 dark:text-tertiary-500 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                  {Object.keys(loginByDay).length === 0 && <p className="text-xs text-muted-foreground/70">Nenhum login encontrado</p>}
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === "receita" && (
          <div className="space-y-6">
            {!receita ? (
              <Card className="p-8 bg-card border-border text-center text-sm text-muted-foreground/70">Carregando receita…</Card>
            ) : (() => {
              const porPlano: any[] = receita.porPlano || [];
              const evolucao: any[] = receita.evolucao || [];
              const totalMrr = porPlano.reduce((a, p) => a + (Number(p.mrr) || 0), 0);
              const totalClientes = porPlano.reduce((a, p) => a + (Number(p.clientes) || 0), 0);
              const maxBar = Math.max(1, ...evolucao.map(e => Math.max(Number(e.confirmado) || 0, Number(e.perdido) || 0)));
              return (
                <>
                  {/* Resumo */}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {[
                      { label: "MRR total", value: brl(totalMrr), icon: DollarSign, color: "#10b981" },
                      { label: "ARR projetado", value: brl(totalMrr * 12), icon: TrendingUp, color: "hsl(var(--primary))" },
                      { label: "Clientes pagantes", value: totalClientes, icon: UserCheck, color: "#8b5cf6" },
                    ].map((s, i) => (
                      <Card key={i} className="p-5 bg-base-100 border-base-200">
                        <div className="flex items-center gap-2.5">
                          <span className="w-9 h-9 rounded-field grid place-items-center shrink-0 bg-base-200 text-base-content/70">
                            <s.icon className="w-[18px] h-[18px]" />
                          </span>
                          <span className="text-[13px] font-medium text-base-content/70">{s.label}</span>
                        </div>
                        <div className="text-[26px] font-bold text-base-content tabular-nums leading-none mt-3.5">{s.value}</div>
                      </Card>
                    ))}
                  </div>

                  {/* MRR por plano */}
                  <Card className="p-5 bg-card border-border">
                    <h3 className="text-sm font-bold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" />MRR por plano</h3>
                    {porPlano.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70">Nenhuma assinatura ativa ainda.</p>
                    ) : (
                      <div className="space-y-3">
                        {porPlano.map((p, i) => {
                          const share = totalMrr > 0 ? (Number(p.mrr) / totalMrr) * 100 : 0;
                          return (
                            <div key={i} data-testid={`receita-plano-${i}`}>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="font-semibold text-foreground">{p.plano || "—"} <span className="text-muted-foreground/70 font-normal">· {p.clientes} cliente{Number(p.clientes) === 1 ? "" : "s"} × {brl(p.preco)}</span></span>
                                <span className="font-bold text-foreground tabular-nums">{brl(p.mrr)} <span className="text-muted-foreground/60 font-normal">({Math.round(share)}%)</span></span>
                              </div>
                              <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>

                  {/* Evolução mensal */}
                  <Card className="p-5 bg-card border-border">
                    <h3 className="text-sm font-bold mb-1 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-500" />Evolução mensal</h3>
                    <p className="text-[11px] text-muted-foreground/70 mb-4">Receita confirmada (verde) vs perdida por cancelamento (vermelho), a partir do histórico de cobranças.</p>
                    {evolucao.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70">Sem histórico ainda — os eventos começam a ser registrados a partir do próximo pagamento/cancelamento.</p>
                    ) : (
                      <div className="space-y-2.5">
                        {evolucao.map((e, i) => (
                          <div key={i} className="flex items-center gap-3" data-testid={`receita-mes-${e.mes}`}>
                            <span className="w-12 text-[11px] font-semibold text-muted-foreground shrink-0">{mesLabel(e.mes)}</span>
                            <div className="flex-1 space-y-1">
                              <div className="h-2.5 rounded-full bg-green-500/80" style={{ width: `${Math.max(2, (Number(e.confirmado) / maxBar) * 100)}%` }} />
                              {Number(e.perdido) > 0 && (
                                <div className="h-2.5 rounded-full bg-rose-500/70" style={{ width: `${Math.max(2, (Number(e.perdido) / maxBar) * 100)}%` }} />
                              )}
                            </div>
                            <span className="w-44 text-right text-[11px] tabular-nums shrink-0">
                              <span className="text-green-600 dark:text-green-400 font-semibold">{brl(e.confirmado)}</span>
                              {Number(e.cancelamentos) > 0 && <span className="text-rose-500 ml-2">−{brl(e.perdido)} ({e.cancelamentos})</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </>
              );
            })()}
          </div>
        )}

        {tab === "usuarios" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <Input
                  placeholder="Buscar por nome, email, tipo..."
                  className="pl-9 bg-card border-border text-foreground"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-admin-search"
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{filteredUsers.length} usuários · {groupedUsers.length} tenants</span>
            </div>

            <Card className="bg-card border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="table-admin-users">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        { key: "id", label: "ID" },
                        { key: "nome", label: "Nome" },
                        { key: "email", label: "Email" },
                        { key: "accountType", label: "Tipo" },
                        { key: "role", label: "Role" },
                        { key: "status", label: "Status" },
                        { key: "online", label: "Online" },
                        { key: "ultimoAcesso", label: "Último Acesso" },
                      ].map(col => (
                        <th
                          key={col.key}
                          className="px-3 py-2.5 text-left text-[10px] font-medium text-base-content/70 uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors"
                          onClick={() => toggleSort(col.key)}
                        >
                          <span className="flex items-center gap-1">{col.label}<SortIcon col={col.key} /></span>
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium text-base-content/70 uppercase tracking-wide">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedUsers.map(g => {
                      const trialActive = g.trialExpiresAt ? new Date(g.trialExpiresAt) > new Date() : false;
                      return (
                        <Fragment key={g.key}>
                          <tr className="bg-muted/50 border-y border-border" data-testid={`user-group-${g.key}`}>
                            <td colSpan={9} className="px-3 py-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="text-xs font-bold text-foreground">{g.workspaceName}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                                  {g.users.length} {g.users.length === 1 ? "usuário" : "usuários"}
                                </span>
                                {g.workspacePlan && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold uppercase">{g.workspacePlan}</span>
                                )}
                                {g.trialExpiresAt && (
                                  <span className={`text-[10px] ml-auto font-bold whitespace-nowrap ${trialActive ? "text-green-600 dark:text-green-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    trial {formatDate(g.trialExpiresAt)}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {g.users.map(u => (
                            <tr
                              key={u.id}
                              className="border-b border-border/50 hover:bg-base-200/40 transition-colors cursor-pointer"
                              onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                              data-testid={`row-user-${u.id}`}
                            >
                              <td className="px-3 py-2.5 text-xs text-muted-foreground pl-6">#{u.id}</td>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-bold">{u.nome}</div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">{u.email}</td>
                          <td className="px-3 py-2.5">
                            {(() => { const c = cargoLabel(u.role, u.accountType); return (
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${cargoBadgeClass(c)}`}>{c}</span>
                            ); })()}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">{cargoLabel(u.role, u.accountType)}</td>
                          <td className="px-3 py-2.5"><StatusBadge status={u.status} /></td>
                          <td className="px-3 py-2.5"><OnlineDot online={u.online} /></td>
                          <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{formatDate(u.ultimoAcesso)}</td>
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => toggleUserStatus(u.id, u.status)}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  u.status === "ACTIVE"
                                    ? "hover:bg-red-500/15 text-muted-foreground hover:text-rose-600 dark:text-rose-400"
                                    : "hover:bg-green-500/15 text-muted-foreground hover:text-green-600 dark:text-green-400"
                                }`}
                                title={u.status === "ACTIVE" ? "Desativar" : "Ativar"}
                                data-testid={`button-toggle-${u.id}`}
                              >
                                {u.status === "ACTIVE" ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => deleteUser(u.id, u.nome)}
                                className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground hover:text-red-500 transition-colors"
                                title="Excluir usuário"
                                data-testid={`button-delete-${u.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredUsers.length === 0 && (
                <div className="text-center py-10 text-muted-foreground/70">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Nenhum usuário encontrado</p>
                </div>
              )}
            </Card>

            {expandedUser && (() => {
              const u = usersList.find(u => u.id === expandedUser);
              if (!u) return null;
              const ws = u.workspaceId ? wsMap.get(u.workspaceId) : null;
              return (
                <Card className="p-5 bg-card border-border" data-testid="card-user-detail">
                  <div className="flex items-center gap-3 mb-4">
                    <Eye className="w-5 h-5 text-tertiary-600 dark:text-tertiary-500" />
                    <h3 className="text-sm font-bold">Detalhes de {u.nome}</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "ID", value: `#${u.id}` },
                      { label: "Email", value: u.email },
                      { label: "Cargo", value: u.cargo || "—" },
                      { label: "Telefone", value: u.telefone || "—" },
                      { label: "Tipo", value: cargoLabel(u.role, u.accountType) },
                      { label: "Role", value: cargoLabel(u.role, u.accountType) },
                      { label: "Status", value: u.status },
                      { label: "Online", value: u.online ? "Sim" : "Não" },
                      { label: "Meta Mensal", value: `${u.metaMensal}` },
                      { label: "Tema", value: u.tema || "—" },
                      { label: "Color Preset", value: u.colorPreset || "—" },
                      { label: "Último Acesso", value: formatDate(u.ultimoAcesso) },
                      { label: "Workspace ID", value: u.workspaceId || "—" },
                      { label: "Workspace", value: ws?.nome || "—" },
                      { label: "Plano", value: ws?.partnerPlan || "—" },
                      { label: "Trial Expira", value: ws?.trialExpiresAt ? formatDate(ws.trialExpiresAt) : "—" },
                    ].map((item, i) => (
                      <div key={i} className="bg-muted rounded-lg p-2.5">
                        <div className="text-[9px] font-bold text-muted-foreground/70 uppercase">{item.label}</div>
                        <div className="text-[11px] font-semibold text-foreground/80 break-all">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}
          </div>
        )}

        {tab === "logs" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70" />
                <Input
                  placeholder="Buscar nos logs..."
                  className="pl-9 bg-card border-border text-foreground"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-admin-log-search"
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{filteredLogs.length} usuários · {groupedLogs.length} tenants</span>
            </div>

            <Card className="bg-card border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="table-admin-logs">
                  <thead>
                    <tr className="border-b border-border">
                      {["ID", "Nome", "Email", "Tipo", "Status", "Online", "Último Acesso"].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] font-medium text-base-content/70 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedLogs.map(g => {
                      const trialActive = g.trialExpiresAt ? new Date(g.trialExpiresAt) > new Date() : false;
                      return (
                        <Fragment key={g.key}>
                          <tr className="bg-muted/50 border-y border-border" data-testid={`log-group-${g.key}`}>
                            <td colSpan={7} className="px-3 py-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="text-xs font-bold text-foreground">{g.workspaceName}</span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                                  {g.users.length} {g.users.length === 1 ? "usuário" : "usuários"}
                                </span>
                                {g.workspacePlan && g.workspacePlan !== "—" && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold uppercase">{g.workspacePlan}</span>
                                )}
                                <span className="text-[10px] text-muted-foreground/60 ml-auto whitespace-nowrap">
                                  {g.workspaceCreatedAt && <>cadastro {formatDate(g.workspaceCreatedAt)}</>}
                                  {g.trialExpiresAt && (
                                    <span className={`ml-2 font-bold ${trialActive ? "text-green-600 dark:text-green-400" : "text-rose-600 dark:text-rose-400"}`}>
                                      trial {formatDate(g.trialExpiresAt)}
                                    </span>
                                  )}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {g.users.map(l => (
                            <tr key={l.id} onClick={() => openUserActivity(l)} className="group border-b border-border/50 hover:bg-base-200/40 cursor-pointer" title="Ver atividade do usuário" data-testid={`log-row-${l.id}`}>
                              <td className="px-3 py-2.5 text-xs text-muted-foreground pl-6">#{l.id}</td>
                              <td className="px-3 py-2.5 text-xs font-bold">{l.nome}</td>
                              <td className="px-3 py-2.5 text-xs text-muted-foreground">{l.email}</td>
                              <td className="px-3 py-2.5">
                                {(() => { const c = cargoLabel(l.role, l.accountType); return (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${cargoBadgeClass(c)}`}>{c}</span>
                                ); })()}
                              </td>
                              <td className="px-3 py-2.5"><StatusBadge status={l.status} /></td>
                              <td className="px-3 py-2.5"><OnlineDot online={l.online} /></td>
                              <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                                <span className="inline-flex items-center gap-1.5">
                                  {formatDate(l.ultimoAcesso)}
                                  <Activity className="w-3.5 h-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                                </span>
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredLogs.length === 0 && (
                <div className="text-center py-10 text-muted-foreground/70">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Nenhum log encontrado</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Modal: atividade (histórico de alterações) de um usuário — aberto da aba Logs */}
        {activityUser && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4" onClick={() => { setActivityUser(null); setActivity(null); }} data-testid="modal-user-activity">
            <Card className="p-5 space-y-4 w-full max-w-2xl my-8 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="card-user-activity">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary shrink-0" />
                    <h3 className="text-sm font-bold text-foreground truncate">Atividade de {activityUser.nome}</h3>
                  </div>
                  <div className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">
                    {activityUser.email} · {cargoLabel(activityUser.role, activityUser.accountType)}
                    {activityUser.workspaceName && activityUser.workspaceName !== "—" ? ` · ${activityUser.workspaceName}` : ""}
                  </div>
                </div>
                <button onClick={() => { setActivityUser(null); setActivity(null); }} className="text-muted-foreground hover:text-foreground shrink-0" title="Fechar" data-testid="button-close-activity"><X className="w-4 h-4" /></button>
              </div>

              {activityLoading && (
                <div className="text-center py-12 text-muted-foreground/70 text-xs flex flex-col items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin opacity-60" /> Carregando atividade…
                </div>
              )}

              {!activityLoading && activity && activity.total > 0 && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(activity.summary).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                      <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">{activityLabel(k)}: {n}</span>
                    ))}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60">{activity.total} evento(s){activity.capped ? " · mostrando os mais recentes" : ""}</div>
                  <div className="space-y-0 max-h-[55vh] overflow-y-auto pr-1">
                    {activity.events.map((e, i) => {
                      const { icon: Icon, cls } = activityIcon(e.type);
                      return (
                        <div key={i} className="flex items-start gap-2.5 py-1.5" data-testid={`activity-event-${i}`}>
                          <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${cls}`}><Icon className="w-3.5 h-3.5" /></div>
                          <div className="min-w-0 flex-1 border-b border-border/40 pb-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold text-foreground">{e.title}</span>
                              <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">{formatDate(e.ts)}</span>
                            </div>
                            {e.detail && <div className="text-[11px] text-muted-foreground mt-0.5 break-words">{e.detail}</div>}
                            {e.convId != null && <div className="text-[10px] text-muted-foreground/50 mt-0.5">conversa #{e.convId}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {!activityLoading && activity && activity.total === 0 && (
                <div className="text-center py-12 text-muted-foreground/70">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Nenhuma atividade registrada para este usuário ainda.</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === "avaliacoes" && (
          <div className="space-y-4">
            {/* resumo + refresh */}
            <div className="flex flex-wrap items-center gap-2">
              {(["aprovada", "revisar", "reprovada"] as const).map(v => (
                <span key={v} className={`px-3 py-1 rounded-lg text-xs font-bold ${VERDICT_STYLE[v]}`}>{v}: {avalSummary[v] || 0}</span>
              ))}
              <div className="flex-1" />
              <Button onClick={loadAvaliacoes} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" data-testid="button-aval-refresh">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {/* filtros */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={avalWsFilter} onChange={e => setAvalWsFilter(e.target.value)} className="bg-card border border-border text-foreground text-xs rounded-lg px-2 py-1.5" data-testid="select-aval-ws">
                <option value="">Todos os tenants</option>
                {avalWs.map(w => <option key={w.workspace_id} value={w.workspace_id}>{w.nome || w.workspace_id}</option>)}
              </select>
              <select value={avalVerdict} onChange={e => setAvalVerdict(e.target.value)} className="bg-card border border-border text-foreground text-xs rounded-lg px-2 py-1.5" data-testid="select-aval-verdict">
                <option value="">Todos os veredictos</option>
                <option value="reprovada">Reprovada</option>
                <option value="revisar">Revisar</option>
                <option value="aprovada">Aprovada</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={avalPending} onChange={e => setAvalPending(e.target.checked)} /> Só não-revisadas
              </label>
              <span className="text-xs text-muted-foreground/70">{avaliacoes.length} fichas</span>
            </div>

            {/* Avaliar agora (F4) — dispara o juiz pra 100% das finalizadas do tenant */}
            <div className="flex flex-wrap items-center gap-2 bg-muted rounded-lg p-2.5 border border-border">
              <span className="text-[11px] text-muted-foreground">Avaliar 100% das conversas <b className="text-foreground/80">finalizadas</b> do tenant selecionado:</span>
              <select value={runDays} onChange={e => setRunDays(Number(e.target.value))} className="bg-card border border-border text-foreground text-xs rounded-lg px-2 py-1" data-testid="select-run-days">
                <option value={7}>últimos 7 dias</option>
                <option value={30}>últimos 30 dias</option>
                <option value={90}>últimos 90 dias</option>
              </select>
              <Button onClick={runEvaluation} disabled={running || !avalWsFilter} size="sm" className="bg-primary hover:bg-primary/90 text-primary-content text-xs" data-testid="button-run-eval">
                {running ? "Avaliando…" : "▶ Avaliar agora"}
              </Button>
              {!avalWsFilter && <span className="text-[10px] text-amber-500">selecione um tenant acima</span>}
              {runProgress && (
                <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                  <div className="flex-1 h-2 rounded-full bg-base-200"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${runProgress.total ? (runProgress.done / runProgress.total) * 100 : 0}%` }} /></div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{runProgress.done}/{runProgress.total}</span>
                </div>
              )}
            </div>

            {!selAval ? (
              <Card className="bg-card border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full" data-testid="table-avaliacoes">
                    <thead>
                      <tr className="border-b border-border">
                        {["Conversa", "Tenant", "Veredito", "Nota", "Outcome", "P0", "CSAT", "Revisão", ""].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-[10px] font-medium text-base-content/70 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {avaliacoes.map(a => (
                        <tr key={a.id} className="border-b border-border/50 hover:bg-base-200/40 cursor-pointer" onClick={() => openAvaliacao(a.id)} data-testid={`row-aval-${a.id}`}>
                          <td className="px-3 py-2.5">
                            <div className="text-xs font-bold">#{a.conversation_id} {a.conv_nome || ""}</div>
                            <div className="text-[10px] text-muted-foreground/70">{a.conv_canal || "—"}</div>
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{a.ws_nome || "—"}</td>
                          <td className="px-3 py-2.5"><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${VERDICT_STYLE[a.verdict] || ""}`}>{a.verdict}</span></td>
                          <td className="px-3 py-2.5 text-xs font-bold">{a.overall_score ?? "—"}</td>
                          <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{a.outcome || "—"}</td>
                          <td className="px-3 py-2.5 text-[11px]">{(a.p0_flags && a.p0_flags.length) ? <span className="text-red-600 font-bold">{a.p0_flags.join(", ")}</span> : "—"}</td>
                          <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{a.csat_nota ?? "—"}</td>
                          <td className="px-3 py-2.5 text-[11px]">{a.human_reviewed ? <span className="text-green-600">✓ {a.human_verdict || ""}</span> : (a.needs_human ? <span className="text-amber-600">pendente</span> : "—")}</td>
                          <td className="px-3 py-2.5 text-muted-foreground/70"><Eye className="w-3.5 h-3.5" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {avaliacoes.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground/70">
                    <Eye className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">Nenhuma ficha ainda. Rode <span className="font-mono text-muted-foreground">scripts/eval-conversas.ts</span> pra gerar.</p>
                  </div>
                )}
              </Card>
            ) : (
              <div className="space-y-3">
                <Button onClick={() => setSelAval(null)} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" data-testid="button-aval-back">← Voltar à lista</Button>
                {loadingDetail ? <p className="text-xs text-muted-foreground/70">Carregando…</p> : (
                  <div className="grid lg:grid-cols-2 gap-4">
                    <Card className="p-4 bg-card border-border max-h-[70vh] overflow-y-auto">
                      <h3 className="text-sm font-bold mb-3">Conversa #{selAval.evaluation.conversation_id} · {selAval.evaluation.outcome || ""}</h3>
                      <div className="space-y-2">
                        {selAval.messages.map((m, i) => (
                          <div key={i} className={`text-[11px] rounded-lg px-2.5 py-1.5 ${m.direction === "in" ? "bg-muted" : "bg-primary/10"}`}>
                            <span className="text-[9px] font-bold text-muted-foreground/70 uppercase">{m.direction === "in" ? "Cliente" : (m.agente || "Bot")} · {formatDate(m.created_at)}</span>
                            <div className="text-foreground whitespace-pre-wrap break-words">{m.tipo && m.tipo !== "text" ? `[${m.tipo}] ` : ""}{m.texto}{m.status === "failed" ? " ⚠️falhou" : ""}</div>
                          </div>
                        ))}
                        {selAval.messages.length === 0 && <p className="text-xs text-muted-foreground/70">Sem mensagens.</p>}
                      </div>
                    </Card>
                    <Card className="p-4 bg-card border-border max-h-[70vh] overflow-y-auto space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${VERDICT_STYLE[selAval.evaluation.verdict] || ""}`}>{selAval.evaluation.verdict}</span>
                        <span className="text-lg font-bold">{selAval.evaluation.overall_score ?? "—"}</span>
                        <span className="text-[11px] text-muted-foreground/70">conf {selAval.evaluation.judge_confidence ?? "?"} · csat {selAval.evaluation.csat_nota ?? "—"} · {selAval.evaluation.msg_count ?? "?"} msgs</span>
                      </div>
                      {Array.isArray(selAval.evaluation.p0_flags) && selAval.evaluation.p0_flags.length > 0 && (
                        <div className="text-xs text-red-600 font-bold">🔴 P0: {selAval.evaluation.p0_flags.join(", ")}</div>
                      )}
                      <p className="text-[12px] text-foreground/80 italic">{selAval.evaluation.summary || "—"}</p>
                      {selAval.evaluation.block_scores && (
                        <div className="text-[11px] text-muted-foreground">Blocos: {Object.entries(selAval.evaluation.block_scores).map(([k, v]) => `${k} ${v ?? "-"}`).join(" · ")}</div>
                      )}
                      {Array.isArray(selAval.evaluation.issues) && selAval.evaluation.issues.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          <div className="font-bold mb-1">Issues:</div>
                          {selAval.evaluation.issues.map((is: any, i: number) => <div key={i}>• <span className="text-amber-600">{is.param}</span> ({is.severidade}): {is.evidencia}</div>)}
                        </div>
                      )}
                      {selAval.erpSnapshot ? (
                        <div className="text-[11px] text-muted-foreground bg-muted rounded-lg p-2">
                          <div className="font-bold text-emerald-600 mb-1">DADOS_ERP (fonte da verdade)</div>
                          titular={selAval.erpSnapshot.titular_nome ?? "?"} · plano={selAval.erpSnapshot.plano ?? "?"} · em aberto={selAval.erpSnapshot.amount_due ?? "?"} · suspenso={String(selAval.erpSnapshot.is_suspended)}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground/60">sem snapshot ERP nesta conversa (não-identificado ou anterior à instrumentação)</div>
                      )}
                      <div className="border-t border-border pt-3 space-y-2">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase">Sua revisão</div>
                        <div className="flex gap-1.5">
                          {(["aprovada", "revisar", "reprovada"] as const).map(v => (
                            <button key={v} onClick={() => setReviewVerdict(v)} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${reviewVerdict === v ? VERDICT_STYLE[v] : "bg-muted text-muted-foreground/70 hover:text-foreground"}`} data-testid={`button-review-${v}`}>{v}</button>
                          ))}
                        </div>
                        <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3} placeholder="Notas (ex: ALAN é o titular real do CPF — bot correto)" className="w-full bg-muted border border-border rounded-lg text-xs text-foreground p-2" data-testid="textarea-review-notes" />
                        <Button onClick={saveReview} disabled={savingReview} size="sm" className="bg-success hover:bg-success/90 text-success-content w-full" data-testid="button-save-review">
                          <Save className="w-4 h-4 mr-1" />{savingReview ? "Salvando…" : "Salvar revisão"}
                        </Button>
                        {selAval.evaluation.human_reviewed && (
                          <p className="text-[10px] text-green-600">já revisada {selAval.evaluation.reviewed_at ? "em " + formatDate(selAval.evaluation.reviewed_at) : ""}</p>
                        )}
                      </div>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "saude" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <select value={avalWsFilter} onChange={e => setAvalWsFilter(e.target.value)} className="bg-card border border-border text-foreground text-xs rounded-lg px-2 py-1.5" data-testid="select-health-ws">
                <option value="">Todos os tenants</option>
                {avalWs.map(w => <option key={w.workspace_id} value={w.workspace_id}>{w.nome || w.workspace_id}</option>)}
              </select>
              <div className="flex-1" />
              <Button onClick={loadHealth} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" data-testid="button-health-refresh"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></Button>
            </div>

            {!health || health.total === 0 ? (
              <div className="text-center py-16 text-muted-foreground/70">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Sem fichas pra esse filtro. Rode <span className="font-mono text-muted-foreground">scripts/eval-conversas.ts</span> pra popular.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Avaliadas", value: health.total, color: "hsl(var(--primary))" },
                    { label: "Nota média", value: health.avgOverall ?? "—", color: "#10b981" },
                    { label: "Aprovadas", value: health.byVerdict.aprovada || 0, color: "#10b981" },
                    { label: "Revisar", value: health.byVerdict.revisar || 0, color: "#f59e0b" },
                    { label: "Reprovadas", value: health.byVerdict.reprovada || 0, color: "#ef4444" },
                    { label: "CSAT médio", value: health.csat.avg ?? "—", color: "#8b5cf6" },
                  ].map((c, i) => (
                    <Card key={i} className="p-4 bg-base-100 border-base-200">
                      <div className="text-[10px] font-medium text-base-content/70 uppercase tracking-wide mb-1">{c.label}</div>
                      <div className="text-[22px] font-bold text-base-content tabular-nums leading-none">{c.value}</div>
                    </Card>
                  ))}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <Card className="p-5 bg-card border-border">
                    <h3 className="text-sm font-bold mb-3">Nota média por eixo</h3>
                    <div className="space-y-2">
                      {["entendeu", "resolveu", "experiencia", "seguro"].map(b => {
                        const v = health.avgByBlock[b];
                        return (
                          <div key={b} className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground w-24">{BLOCK_LABEL[b] || b}</span>
                            <div className="flex-1 h-2 rounded-full bg-muted">
                              <div className="h-2 rounded-full" style={{ width: `${((v ?? 0) / 10) * 100}%`, background: (v ?? 0) >= 8 ? "#10b981" : (v ?? 0) >= 6 ? "#f59e0b" : "#ef4444" }} />
                            </div>
                            <span className="text-[11px] font-bold w-8 text-right">{v ?? "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>

                  <Card className="p-5 bg-card border-border">
                    <h3 className="text-sm font-bold mb-3">Top parâmetros que falham</h3>
                    {health.paramFails.length === 0 ? <p className="text-xs text-muted-foreground/70">Nenhum.</p> : (
                      <div className="space-y-1.5">
                        {health.paramFails.map(p => {
                          const max = health.paramFails[0].count || 1;
                          return (
                            <div key={p.param} className="flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground w-36 truncate">{p.param}</span>
                              <div className="flex-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${(p.count / max) * 100}%` }} /></div>
                              <span className="text-[11px] font-bold text-amber-600 w-6 text-right">{p.count}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <Card className="p-5 bg-card border-border">
                    <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Erros críticos (P0)</h3>
                    {health.p0.length === 0 ? <p className="text-xs text-green-600">Nenhum P0 🎉</p> : (
                      <div className="space-y-1.5">
                        {health.p0.map(p => (
                          <div key={p.flag} className="flex items-center justify-between">
                            <span className="text-[11px] text-red-600 font-mono">{p.flag}</span>
                            <span className="text-[11px] font-bold text-red-600">{p.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card className="p-5 bg-card border-border">
                    <h3 className="text-sm font-bold mb-3">Revisão humana</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Revisadas", value: health.review.reviewed, color: "#10b981" },
                        { label: "Pendentes", value: health.review.pending, color: "#f59e0b" },
                        { label: "Divergências", value: health.review.divergencias, color: "#ef4444" },
                      ].map((c, i) => (
                        <div key={i} className="bg-muted rounded-lg p-3 text-center">
                          <div className="text-xl font-bold text-foreground tabular-nums">{c.value}</div>
                          <div className="text-[9px] text-muted-foreground/70 uppercase font-bold mt-1">{c.label}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-2">Divergências = onde sua revisão discordou do juiz (sinal pra recalibrar a rubrica).</p>
                  </Card>
                </div>

                <Card className="p-5 bg-card border-border">
                  <h3 className="text-sm font-bold mb-3">Tendência (por dia)</h3>
                  {health.trend.length === 0 ? <p className="text-xs text-muted-foreground/70">Sem dados.</p> : (
                    <div className="space-y-1">
                      {health.trend.map(t => (
                        <div key={t.day} className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground/70 w-20">{t.day}</span>
                          <div className="flex-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full" style={{ width: `${((t.avg ?? 0) / 10) * 100}%`, background: (t.avg ?? 0) >= 8 ? "#10b981" : (t.avg ?? 0) >= 6 ? "#f59e0b" : "#ef4444" }} /></div>
                          <span className="text-[10px] text-muted-foreground w-24 text-right">{t.count} aval · {t.avg ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
