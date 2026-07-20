import React, { useState, useEffect, useRef, useMemo, lazy, Suspense, memo, useCallback } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { NexusLayout } from "@/components/nexus/NexusLayout";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AtendimentoLayout } from "@/components/atendimento/AtendimentoLayout";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { isManagerOrAdmin, defaultLandingForRole } from "@/lib/roles";
import { authService } from "./services/auth";
import { Button } from "@/components/ui/button";
import {
  Sun,
  Moon,
  Bell,
  User,
  Menu,
  UserCircle,
  Users as UsersIcon,
  CreditCard,
  LogOut,
  MessageCircle,
  Target,
  ClipboardList,
  CheckCircle2,
  UserPlus,
  Loader2,
} from "lucide-react";

import { registerPrefetch } from "@/lib/prefetch";

// Recarrega a página no máximo uma vez a cada 20s (guarda em sessionStorage).
// Usado quando um chunk lazy falha de carregar de vez: em dev quando o tsx-watch
// reinicia o servidor (a porta fica morta durante o boot pesado), em prod quando
// o index.html aberto referencia um chunk com hash antigo depois de um deploy.
// O reload busca um index.html novo e RESETA o cache do React.lazy — que cacheia
// a rejeição pra sempre e jamais re-importa sozinho. A guarda evita reload-loop:
// se o chunk está genuinamente quebrado, cai no fallback de erro com botão manual.
function shouldReloadForChunkError(): boolean {
  try {
    const KEY = "cb:lastChunkReload";
    const last = Number(sessionStorage.getItem(KEY) || "0");
    const now = Date.now();
    if (now - last > 20000) {
      sessionStorage.setItem(KEY, String(now));
      return true;
    }
  } catch { /* sessionStorage indisponível — não recarrega */ }
  return false;
}

function retryImport<T>(fn: () => Promise<T>, retries = 4, delay = 800): Promise<T> {
  return fn().catch((err) => {
    if (retries <= 0) {
      // Esgotou as tentativas com backoff (~8s). Tenta um reload guardado pra
      // recuperar automaticamente; se já recarregou há pouco e ainda falha,
      // propaga o erro pro LazyErrorBoundary mostrar o botão manual de recarregar.
      if (shouldReloadForChunkError()) window.location.reload();
      throw err;
    }
    return new Promise<T>((resolve) =>
      setTimeout(() => resolve(retryImport(fn, retries - 1, Math.min(delay * 1.7, 4000))), delay)
    );
  });
}

// Pré-aquece os módulos mais pesados após o primeiro render para evitar
// "Failed to fetch dynamically imported module" em cold start do Vite
function warmupHeavyModules() {
  const heavy = [
    () => import("@/pages/inbox"),
    () => import("@/pages/leads"),
  ];
  heavy.forEach((fn) => { try { fn().catch(() => {}); } catch (_) {} });
}

const pi = {
  inicio: () => retryImport(() => import("@/pages/inicio")),
  leads: () => retryImport(() => import("@/pages/leads")),

  inbox: () => retryImport(() => import("@/pages/inbox")),
  gestaoConversas: () => retryImport(() => import("@/pages/gestao-conversas")),
  automacoes: () => retryImport(() => import("@/pages/automacoes")),
  conexoes: () => retryImport(() => import("@/pages/conexoes")),
  integracoes: () => retryImport(() => import("@/pages/integracoes")),
  usuarios: () => retryImport(() => import("@/pages/usuarios")),
  billing: () => retryImport(() => import("@/pages/billing")),
  workspace: () => retryImport(() => import("@/pages/workspace")),
  configuracoes: () => retryImport(() => import("@/pages/configuracoes")),
  perfil: () => retryImport(() => import("@/pages/perfil")),
  notFound: () => retryImport(() => import("@/pages/not-found")),
  login: () => retryImport(() => import("@/pages/login")),
  register: () => retryImport(() => import("@/pages/register")),
  landing: () => retryImport(() => import("@/pages/landing")),
  legal: () => retryImport(() => import("@/pages/legal")),

  suporte: () => retryImport(() => import("@/pages/suporte")),
  superAdmin: () => retryImport(() => import("@/pages/super-admin")),
  whatsappOficial: () => retryImport(() => import("@/pages/whatsapp-oficial")),
  instaProspect: () => retryImport(() => import("@/pages/InstaProspect")),
  instaflix: () => retryImport(() => import("@/pages/Instaflix")),
  agenda: () => retryImport(() => import("@/pages/agenda")),
  aceitarConvite: () => retryImport(() => import("@/pages/aceitar-convite")),
  adminTenantSettings: () => retryImport(() => import("@/pages/admin-tenant-settings")),
  atendimentos: () => retryImport(() => import("@/pages/atendimentos")),
  relatorios: () => retryImport(() => import("@/pages/relatorios")),
};

const Inicio = lazy(pi.inicio);
const Leads = lazy(pi.leads);

const Inbox = lazy(pi.inbox);
const GestaoConversas = lazy(pi.gestaoConversas);
const Automacoes = lazy(pi.automacoes);
const Conexoes = lazy(pi.conexoes);
const Integracoes = lazy(pi.integracoes);
const UsuariosPage = lazy(pi.usuarios);
const Billing = lazy(pi.billing);
const WorkspacePage = lazy(pi.workspace);
const Configuracoes = lazy(pi.configuracoes);
const Perfil = lazy(pi.perfil);
const NotFound = lazy(pi.notFound);
const Login = lazy(pi.login);
const Register = lazy(pi.register);
const Landing = lazy(pi.landing);
const Legal = lazy(pi.legal);

const Suporte = lazy(pi.suporte);
const SuperAdmin = lazy(pi.superAdmin);
const WhatsAppOficial = lazy(pi.whatsappOficial);
const InstaProspect = lazy(pi.instaProspect);
const Instaflix = lazy(pi.instaflix);
const Agenda = lazy(pi.agenda);
const AceitarConvite = lazy(pi.aceitarConvite);
const AdminTenantSettings = lazy(pi.adminTenantSettings);
const Atendimentos = lazy(pi.atendimentos);
const Relatorios = lazy(pi.relatorios);

registerPrefetch(
  pi as Record<string, () => Promise<any>>,
  {
    "/inicio": ["inicio"],
    "/crm": ["leads"],
    "/central": ["leads"],
    "/inbox": ["inbox"],
    "/atendimentos": ["atendimentos"],
    "/gestao-conversas": ["gestaoConversas"],
    "/automacoes": ["automacoes"],
    "/conexoes": ["conexoes"],
    "/integracoes": ["integracoes"],
    "/configuracoes": ["adminTenantSettings"],
    "/billing": ["billing"],
    "/assinatura": ["billing"],
    "/perfil": ["perfil"],
    "/suporte": ["suporte"],
    "/usuarios": ["usuarios"],
    "/whatsapp-oficial": ["whatsappOficial"],
  },
  {
    "/": ["/api/leads", "/api/conversations"],
    "/crm": ["/api/leads", "/api/pipelines", "/api/pipeline-stages", "/api/lead-tags"],
    "/inbox": ["/api/conversations"],
    "/automacoes": ["/api/automations"],
    "/conexoes": ["/api/conexoes"],
  }
);

const PAGE_TITLES: Record<string, string> = {
  "/inicio": "Início",
  "/leads": "Pipeline",
  "/pipeline": "Pipeline",
  "/crm": "CRM",
  "/central": "Central de Atendimentos",
  "/inbox": "Chat",
  "/atendimentos": "Painel de Atendimento",
  "/relatorios": "Relatórios",
  "/campanhas": "Campanhas em Massa",
  "/automacoes": "Automações",
  "/conexoes": "Canais",
  "/integracoes": "Integrações",
  "/workspace": "Workspace",
  "/usuarios": "Usuários & Equipe",
  "/billing": "Planos & Faturamento",
  "/assinatura": "Assinatura",
  "/perfil": "Meu Perfil",
  "/respostas-rapidas": "Respostas Rápidas",
  "/gestao-conversas": "Gestão de Conversas",
  "/suporte": "Central de Suporte",
  "/insta-prospect": "Instagram Prospect",
  "/instaflix": "Instaflix",
  "/configuracoes": "Configurações",
  "/whatsapp-oficial": "WhatsApp Oficial",
};


const NOTIF_ICONS: Record<string, typeof MessageCircle> = {
  message: MessageCircle,
  target: Target,
  task: ClipboardList,
  check: CheckCircle2,
  user: UserPlus,
};

function formatTimeAgo(dateStr: string | null) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function TopLoadingBar() {
  const [location] = useLocation();
  const [show, setShow] = useState(false);
  const [key, setKey] = useState(0);
  const prevLoc = useRef(location);

  useEffect(() => {
    if (prevLoc.current !== location) {
      prevLoc.current = location;
      setShow(true);
      setKey((k) => k + 1);
      const timer = setTimeout(() => setShow(false), 650);
      return () => clearTimeout(timer);
    }
  }, [location]);

  if (!show) return null;
  return <div key={key} className="topbar-progress" data-testid="loading-bar" />;
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

// Captura erros de módulos lazy que esgotaram todas as tentativas de retry.
// IMPORTANTE: React.lazy cacheia a rejeição pra SEMPRE — re-renderizar o mesmo
// componente lazy NÃO re-importa (o reset antigo de 3s era inerte e só mantinha
// o spinner girando eternamente). A recuperação real é: reload guardado (busca
// index.html novo + reseta o cache do lazy) e, se mesmo assim falhar, um botão
// manual de recarregar — nunca mais spinner infinito.
class LazyErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn("[LazyErrorBoundary] lazy load failed:", error.message);
    // Tenta recuperar sozinho uma vez (cobre o caso do retryImport ainda não ter
    // recarregado). A guarda em sessionStorage evita reload-loop.
    if (shouldReloadForChunkError()) window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full gap-4 px-6 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">Não foi possível carregar a página</span>
            <span className="text-xs text-muted-foreground max-w-xs">
              O servidor pode estar reiniciando. Recarregue em alguns segundos.
            </span>
          </div>
          <Button size="sm" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AnimatedRoutes() {
  const [location] = useLocation();
  const [displayLocation, setDisplayLocation] = useState(location);
  const [transitionStage, setTransitionStage] = useState<"enter" | "exit">("enter");

  useEffect(() => {
    if (location !== displayLocation) {
      setTransitionStage("exit");
      const timer = setTimeout(() => {
        setDisplayLocation(location);
        setTransitionStage("enter");
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [location, displayLocation]);

  const animClass = transitionStage === "enter"
    ? "animate-page-enter"
    : "animate-page-exit";

  return (
    <div
      key={displayLocation}
      className={`h-full w-full ${animClass}`}
      
    >
      <LazyErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Switch location={displayLocation}>
          <Route path="/"><Redirect to={defaultLandingForRole()} /></Route>
          <Route path="/dashboard"><Redirect to={defaultLandingForRole()} /></Route>
          <Route path="/inicio" component={Inicio} />
          <Route path="/crm" component={Leads} />
          <Route path="/agenda" component={Agenda} />
          {/* Central de Atendimentos foi removida: contatos vivem em Atendimento
              e protocolos compõem Relatórios. Redireciona pra não orfanizar links. */}
          <Route path="/central">{() => { window.location.replace("/atendimentos"); return null; }}</Route>
          <Route path="/leads"><Redirect to="/crm" /></Route>
          <Route path="/pipeline"><Redirect to="/crm" /></Route>
          <Route path="/contatos"><Redirect to="/atendimento/clientes" /></Route>
          <Route path="/inbox">{() => <Inbox />}</Route>
          <Route path="/atendimentos" component={Atendimentos} />
          <Route path="/relatorios" component={Relatorios} />
          {/* Modo Atendimento — reusa as páginas existentes dentro do AtendimentoLayout (sidebar principal escondida). */}
          <Route path="/atendimento" component={Atendimentos} />
          <Route path="/atendimento/chat">{() => <Inbox />}</Route>
          <Route path="/atendimento/clientes" component={Leads} />
          <Route path="/atendimento/perfil" component={Perfil} />
          <Route path="/gestao-conversas" component={GestaoConversas} />
          <Route path="/respostas-rapidas"><Redirect to="/gestao-conversas" /></Route>
          <Route path="/campanhas"><Redirect to="/gestao-conversas?tab=campanhas" /></Route>
          <Route path="/automacoes" component={Automacoes} />
          <Route path="/conexoes" component={Conexoes} />
          <Route path="/integracoes" component={Integracoes} />
          <Route path="/usuarios" component={UsuariosPage} />
          <Route path="/billing" component={Billing} />
          <Route path="/assinatura" component={Billing} />
          <Route path="/workspace" component={WorkspacePage} />
          <Route path="/perfil-redirect">{() => { window.location.replace("/perfil"); return null; }}</Route>
          <Route path="/perfil" component={Perfil} />

          <Route path="/whatsapp-oficial" component={WhatsAppOficial} />
          <Route path="/configuracoes" component={AdminTenantSettings} />
          <Route path="/admin/tenant-settings/:tenantId" component={AdminTenantSettings} />
          <Route path="/insta-prospect" component={InstaProspect} />
          <Route path="/instaflix" component={Instaflix} />
          <Route path="/suporte" component={Suporte} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
      </LazyErrorBoundary>
    </div>
  );
}

const TopBar = memo(function TopBar({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const { theme, resolved, setTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const basePath = location.split("?")[0];
  const title = PAGE_TITLES[location] || PAGE_TITLES[basePath] || "Norte Gestão CRM";

  const handleThemeToggle = () => {
    const newTheme = resolved === "dark" ? "light" : "dark";
    setTheme(newTheme);
    apiRequest("PUT", "/api/perfil/me", { tema: newTheme })
      .then(r => r.json())
      .then(json => {
        if (json.ok) {
          authService.setUser(json.data);
          queryClient.invalidateQueries({ queryKey: ["/api/perfil/me"] });
        }
      })
      .catch(() => {});
  };

  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [, setUserTick] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notifQuery = useQuery<any>({
    queryKey: ["/api/notificacoes"],
    refetchInterval: 15000,
  });
  const notifRaw = notifQuery.data;
  const notifList: any[] = Array.isArray(notifRaw) ? notifRaw : (notifRaw as any)?.data || [];
  const unreadCount = notifList.filter((n: any) => !n.lida).length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    const handleUserUpdate = () => setUserTick(t => t + 1);
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("flowcrm-user-updated", handleUserUpdate);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("flowcrm-user-updated", handleUserUpdate);
    };
  }, []);

  function markAllRead() {
    apiRequest("POST", "/api/notificacoes/read-all").then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/notificacoes"] });
    }).catch(() => {});
  }

  function navigateFromDropdown(path: string) {
    setUserOpen(false);
    setLocation(path);
  }

  // Shadow só aparece quando algum container interno do <main> rolou > 4px.
  // Scroll events não fazem bubbling, então escutamos em capture phase pra
  // pegar scroll de qualquer scrollable descendente. RAF evita work em todo
  // frame de scroll. Filtro pelo closest('main') ignora popovers/dropdowns.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let raf = 0;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement | Document;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest('main')) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrolled(target.scrollTop > 4);
      });
    };
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('scroll', handler, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header
      className="h-16 flex items-center justify-between px-4 md:px-6 flex-shrink-0 gap-3 relative z-50 bg-card border-b border-border transition-shadow duration-200"
      style={{
        boxShadow: scrolled ? 'var(--shadow-md)' : 'none',
      }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMobileMenuToggle}
          className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          data-testid="button-mobile-menu"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1
          className="font-display text-[15px] font-semibold tracking-tight text-foreground"
          data-testid="text-page-title"
        >
          {title}
        </h1>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm relative"
            onClick={() => { setNotifOpen(!notifOpen); setUserOpen(false); }}
            data-testid="button-notifications"
            aria-label="Notificações"
          >
            <Bell className="w-[18px] h-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute -top-[2px] -right-[2px] w-4 h-4 rounded-full bg-destructive text-[9px] font-semibold text-white flex items-center justify-center border-2 border-background">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              className="absolute top-[42px] right-0 w-[320px] bg-card border-[1.5px] border-border rounded-[14px] shadow-[0_8px_32px_rgba(0,0,0,0.3)] z-[200] overflow-hidden"
              data-testid="dropdown-notifications"
            >
              <div className="px-4 py-3 border-b border-border flex justify-between items-center">
                <span className="text-[13px] font-semibold">Notificacoes</span>
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-primary bg-transparent border-none cursor-pointer hover:underline"
                  data-testid="button-mark-all-read"
                >
                  Marcar todas como lidas
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {notifList.length === 0 && (
                  <div className="px-4 py-6 text-center text-muted-foreground text-[12px]">Nenhuma notificacao</div>
                )}
                {notifList.map((n: any) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 flex items-start gap-3 border-b border-border/50 cursor-pointer transition-colors hover:bg-card/80 ${!n.lida ? "bg-primary/[0.05]" : ""}`}
                    data-testid={`notif-item-${n.id}`}
                    onClick={() => {
                      if (!n.lida) {
                        apiRequest("POST", `/api/notificacoes/${n.id}/read`).then(() => {
                          queryClient.invalidateQueries({ queryKey: ["/api/notificacoes"] });
                        }).catch(() => {});
                      }
                      if (n.link) { setNotifOpen(false); setLocation(n.link); }
                    }}
                  >
                    {(() => { const Icon = NOTIF_ICONS[n.iconKey] || MessageCircle; return <Icon className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary opacity-80" />; })()}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[12px] leading-snug ${!n.lida ? "font-semibold" : "text-muted-foreground"}`}>{n.mensagem || n.titulo}</p>
                      <span className="text-[10px] text-muted-foreground mt-1 block">{formatTimeAgo(n.createdAt)}</span>
                    </div>
                    {!n.lida && <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
                  </div>
                ))}
              </div>
              <div className="px-4 py-[10px] border-t border-border text-center">
                <button
                  onClick={() => setNotifOpen(false)}
                  className="text-[11.5px] text-primary bg-transparent border-none cursor-pointer hover:underline"
                  data-testid="button-view-all-notif"
                >
                  Ver todas
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn btn-circle btn-ghost btn-sm"
          onClick={handleThemeToggle}
          data-testid="button-theme-toggle"
          aria-label="Alternar tema"
        >
          {resolved === "light" ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />}
        </button>

        <div className="relative" ref={userRef}>
          {(() => {
            const u = authService.getUser();
            const initials = u?.nome ? u.nome.split(" ").map((w: string) => w[0]).join("").substring(0, 2).toUpperCase() : "JD";
            const displayName = u?.nome || "Joao Duarte";
            const displayEmail = u?.email || "joao@chatbananacrm.com";
            const displayRole = u?.role === "admin" ? "Super Admin" : u?.role === "manager" ? "Gerente" : "Atendente";
            return (
              <>
                <button
                  onClick={() => { setUserOpen(!userOpen); setNotifOpen(false); }}
                  className="w-[34px] h-[34px] rounded-[10px] overflow-hidden gradient-accent text-white text-[12px] font-semibold flex items-center justify-center cursor-pointer border-2 border-transparent hover:border-primary/50 transition-colors flex-shrink-0"
                  data-testid="button-user-avatar"
                  title="Perfil & Configuracoes"
                >
                  {u?.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" /> : initials}
                </button>

                {userOpen && (
                  <div
                    className="absolute top-[42px] right-0 w-[220px] bg-card border-[1.5px] border-border rounded-[14px] shadow-[0_8px_32px_rgba(0,0,0,0.3)] z-[200] overflow-hidden"
                    data-testid="dropdown-user"
                  >
                    <div className="px-4 py-[14px] border-b border-border">
                      <div className="flex items-center gap-[10px]">
                        <div className="w-[38px] h-[38px] rounded-[11px] overflow-hidden gradient-accent text-white text-[14px] font-semibold flex items-center justify-center flex-shrink-0">
                          {u?.avatarUrl ? <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" /> : initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold truncate" data-testid="text-user-name">{displayName}</div>
                          <div className="text-[10.5px] text-muted-foreground truncate" data-testid="text-user-email">{displayEmail}</div>
                          <div className="text-[9.5px] text-primary mt-[1px]">{displayRole} · Pro</div>
                        </div>
                      </div>
                    </div>
                    <div className="py-[6px]">
                      <button
                        onClick={() => navigateFromDropdown("/perfil")}
                        className="w-full px-4 py-[9px] text-[12.5px] cursor-pointer flex items-center gap-[9px] transition-colors hover:bg-muted/50 bg-transparent border-none text-left text-foreground"
                        data-testid="dropdown-item-perfil"
                      >
                        <UserCircle className="w-3.5 h-3.5 opacity-70" /> <span>Meu Perfil</span>
                      </button>
                      <button
                        onClick={() => navigateFromDropdown("/workspace")}
                        className="w-full px-4 py-[9px] text-[12.5px] cursor-pointer flex items-center gap-[9px] transition-colors hover:bg-muted/50 bg-transparent border-none text-left text-foreground"
                        data-testid="dropdown-item-usuarios"
                      >
                        <UsersIcon className="w-3.5 h-3.5 opacity-70" /> <span>Workspace</span>
                      </button>
                      <button
                        onClick={() => navigateFromDropdown("/billing")}
                        className="w-full px-4 py-[9px] text-[12.5px] cursor-pointer flex items-center gap-[9px] transition-colors hover:bg-muted/50 bg-transparent border-none text-left text-foreground"
                        data-testid="dropdown-item-billing"
                      >
                        <CreditCard className="w-3.5 h-3.5 opacity-70" /> <span>Assinatura</span>
                      </button>
                      <div className="h-px bg-border mx-0 my-1" />
                      <button
                        onClick={() => { setUserOpen(false); authService.logout(); }}
                        className="w-full px-4 py-[9px] text-[12.5px] cursor-pointer flex items-center gap-[9px] text-destructive transition-colors hover:bg-destructive/10 bg-transparent border-none text-left"
                        data-testid="dropdown-item-sair"
                      >
                        <LogOut className="w-3.5 h-3.5" /> <span>Sair</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </header>
  );
});

function Router() {
  return <AnimatedRoutes />;
}

function ThemeSyncer() {
  const { setTheme } = useTheme();
  useEffect(() => {
    const syncUser = (user: any) => {
      if (user?.tema && ["dark", "light"].includes(user.tema)) {
        setTheme(user.tema as "dark" | "light");
      }
    };
    syncUser(authService.getUser());
    const handler = () => syncUser(authService.getUser());
    window.addEventListener("flowcrm-user-updated", handler);
    return () => window.removeEventListener("flowcrm-user-updated", handler);
  }, [setTheme]);
  return null;
}

function OnlineHeartbeat() {
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    const user = authService.getUser();
    if (!user?.id) return;
    const setStatus = (online: boolean) => {
      const token = authService.getToken();
      if (!token) return;
      apiRequest("PATCH", `/api/usuarios/${user.id}/online`, { online }).catch(() => {});
    };
    setStatus(true);
    heartbeatRef.current = setInterval(() => setStatus(true), 60000);
    const handleBeforeUnload = () => {
      const token = authService.getToken();
      if (!token || !user?.id) return;
      navigator.sendBeacon?.(`/api/usuarios/${user.id}/offline-beacon`, "");
      setStatus(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") setStatus(false);
      else setStatus(true);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
      setStatus(false);
    };
  }, []);
  return null;
}

function AppLayout() {
  const [location] = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("flowcrm_sidebar_collapsed") === "true");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarStateRef = useRef(sidebarCollapsed);
  const savedBeforeCollapseRef = useRef(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(v => { localStorage.setItem("flowcrm_sidebar_collapsed", String(!v)); return !v; });
  }, []);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  useEffect(() => {
    sidebarStateRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.collapse) {
        savedBeforeCollapseRef.current = sidebarStateRef.current;
        setSidebarCollapsed(true);
      } else if (detail?.restore) {
        setSidebarCollapsed(savedBeforeCollapseRef.current);
      }
    };
    window.addEventListener("flowcrm-sidebar-control", handler);
    return () => window.removeEventListener("flowcrm-sidebar-control", handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  // Eager prefetch dos chunks mais usados após o app montar (baixa prioridade)
  useEffect(() => {
    const EAGER = ["inbox", "leads", "gestaoConversas", "automacoes"];
    let i = 0;
    const next = () => {
      if (i >= EAGER.length) return;
      const key = EAGER[i++];
      (pi as any)[key]?.().finally(next);
    };
    const t = setTimeout(next, 1500);
    return () => clearTimeout(t);
  }, []);

  // Modo embed: quando a app é renderizada dentro de um iframe (ex: drawer
  // da Conversa abrindo /inbox?convId=X&embed=1), omitimos sidebar e topbar
  // pra não duplicar o chrome. Cacheado no mount porque a inbox limpa query
  // string via replaceState, o que faria re-render perder o flag.
  const [isEmbed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      if (new URLSearchParams(window.location.search).get("embed") === "1") return true;
    } catch {}
    try { return window.self !== window.top; } catch { return true; }
  });

  const isPublicRoute = location === "/landing" || location === "/login" || location === "/register" || location === "/aceitar-convite" || location === "/termos" || location === "/privacidade" || (location === "/" && !authService.isAuthenticated());
  const { data: convData } = useQuery<any[]>({ queryKey: ["/api/conversations"], staleTime: 15000, enabled: !isPublicRoute && authService.isAuthenticated() });
  // Mesmo critério do Chat (Bruno 2026-06-08): admin/gerente conta só dele + fila.
  const { data: titleMe } = useQuery<{ ok: boolean; data: { id?: number; role?: string } }>({ queryKey: ["/api/auth/me"], enabled: !isPublicRoute && authService.isAuthenticated() });
  const unreadForTitle = useMemo(() => {
    if (!convData) return 0;
    const mgr = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(titleMe?.data?.role || "");
    const list = mgr ? convData.filter((c: any) => c.assignedUserId === titleMe?.data?.id || !c.assignedUserId) : convData;
    return list.filter((c: any) => c.unread > 0 && c.status !== "resolved").length;
  }, [convData, titleMe]);

  useEffect(() => {
    const basePath = location.split("?")[0];
    const base = PAGE_TITLES[location] || PAGE_TITLES[basePath] || "Norte Gestão CRM";
    document.title = unreadForTitle > 0 ? `(${unreadForTitle}) ${base} | Norte Gestão` : `${base} | Norte Gestão CRM`;
  }, [location, unreadForTitle]);

  if (location === "/landing" || (location === "/" && !authService.isAuthenticated())) {
    return (
      <LazyErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <Landing />
        </Suspense>
      </LazyErrorBoundary>
    );
  }

  if (location === "/login") {
    return (
      <LazyErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <Login />
        </Suspense>
      </LazyErrorBoundary>
    );
  }

  if (location === "/register") {
    return (
      <LazyErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <Register />
        </Suspense>
      </LazyErrorBoundary>
    );
  }

  if (location === "/aceitar-convite") {
    return (
      <LazyErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <AceitarConvite />
        </Suspense>
      </LazyErrorBoundary>
    );
  }

  // Páginas legais públicas (exigidas pela verificação OAuth do Google + LGPD).
  if (location === "/termos" || location === "/privacidade") {
    return (
      <LazyErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <Legal doc={location === "/privacidade" ? "privacidade" : "termos"} />
        </Suspense>
      </LazyErrorBoundary>
    );
  }

  if (location === "/super-admin") {
    return (
      <LazyErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <SuperAdmin />
        </Suspense>
      </LazyErrorBoundary>
    );
  }

  // Modo Atendimento — atendente (não admin/manager) fica preso aqui; admin/manager
  // pode entrar/sair via botão "Voltar à gestão" na mini-sidebar. Sidebar principal
  // escondida pra ambos enquanto a rota começa com /atendimento/.
  // Match exato `/atendimento` ou prefixo `/atendimento/` evita colidir com `/atendimentos`.
  const isAtendimentoRoute = location === "/atendimento" || location.startsWith("/atendimento/");
  if (isAtendimentoRoute) {
    return (
      <ProtectedRoute>
        <ThemeSyncer />
        <TopLoadingBar />
        {/* Banner de modo visualização também no modo Atendimento (a mini-sidebar
            não tem o bloco da sidebar de gestão). */}
        <div className="flex flex-col h-screen w-screen overflow-hidden">
          <ImpersonationBanner />
          <div className="flex-1 min-h-0">
            <AtendimentoLayout>
              <Router />
            </AtendimentoLayout>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // Atendente puro (role !== admin/manager): qualquer URL fora de /atendimento
  // é redirecionada de volta. Garante que o atendente nunca vê a sidebar de
  // gestão, mesmo digitando URL direto. /perfil também redireciona — perfil
  // do atendente é acessado via /atendimento/perfil (dentro da mini-sidebar).
  if (authService.isAuthenticated() && !isManagerOrAdmin()) {
    return <Redirect to="/atendimento" />;
  }

  if (isEmbed) {
    return (
      <ProtectedRoute>
        <ThemeSyncer />
        <TopLoadingBar />
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
          <ImpersonationBanner />
          <main className="flex-1 min-h-0 overflow-hidden">
            <Router />
          </main>
        </div>
      </ProtectedRoute>
    );
  }

  const nexusTitle = PAGE_TITLES[location] || PAGE_TITLES[location.split("?")[0]] || "Norte Gestão CRM";

  return (
    <ProtectedRoute>
      <ThemeSyncer />
      <OnlineHeartbeat />
      <TopLoadingBar />
      <div className="flex h-screen w-full overflow-hidden flex-col">
        <ImpersonationBanner />
        <div className="flex-1 min-h-0">
          <NexusLayout title={nexusTitle}>
            <Router />
          </NexusLayout>
        </div>
      </div>
    </ProtectedRoute>
  );
}

function App() {
  useEffect(() => {
    // Pré-aquece os módulos pesados 2s após o primeiro render
    const t = setTimeout(warmupHeavyModules, 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppLayout />
          <Toaster />
          <SonnerToaster
            position="bottom-right"
            closeButton
            theme="system"
            toastOptions={{
              classNames: {
                toast: "border border-border bg-card text-foreground shadow-md",
                description: "text-muted-foreground",
                actionButton: "bg-primary text-primary-foreground",
                cancelButton: "bg-muted text-muted-foreground",
              },
            }}
          />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
