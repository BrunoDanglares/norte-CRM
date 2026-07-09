import { memo, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { useLocation, Link } from "wouter";
import {
  Kanban,

  Zap,
  Megaphone,
  Plug,
  Link2,
  Radio,
  PanelLeftClose,
  PanelLeftOpen,
  MessagesSquare,

  Eye,
  LogOut,
  Headphones,
  Wifi,
  ClipboardList,
  Bot,
  Headset,
  BarChart3,
  Settings,
  Router,
  FileText,
  BookOpen,
  Home,
  ShieldCheck,
  HeartPulse,
  ChevronsUpDown,
  ChevronDown,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { prefetchRoute } from "@/lib/prefetch";
import { SiMeta, SiWhatsapp, SiInstagram } from "react-icons/si";
import { NorteBrand, NorteMark } from "@/components/brand/NorteBrand";
import { authService } from "@/services/auth";
import { isImpersonating as checkImpersonating, impersonatedUserName, exitImpersonation } from "@/lib/impersonation";

// Bruno 2026-07-04: estrutura fiel ao template Nexus (imagem de referência) —
// grupos "Comunicação" e "Configuração" são CABEÇALHOS RECOLHÍVEIS (chevron +
// sub-itens aninhados com linha vertical), sempre ABERTOS por padrão em cada
// carregamento. "Menu"/"Plataforma" são rótulos de seção simples; Relatórios e
// Suporte são itens soltos (sem cabeçalho).
function getNavGroups(isSuperAdmin = false) {
  const groups: any[] = [
    {
      label: "Menu",
      items: [
        { title: "Início", url: "/inicio", icon: Home },
        { title: "CRM", url: "/crm", icon: Kanban },
      ],
    },
    {
      label: "Comunicação",
      collapsible: true,
      items: [
        { title: "Atendimento", url: "/atendimento", icon: Headset, badgeKey: "chat_unread" },
        { title: "Gestão de Conversa", url: "/gestao-conversas", icon: MessagesSquare },
        { title: "Automações", url: "/automacoes", icon: Zap },
      ],
    },
    {
      label: "",
      items: [
        { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
      ],
    },
    {
      label: "Configuração",
      collapsible: true,
      items: [
        { title: "Canais", url: "/conexoes", icon: Radio },
        { title: "Integrações", url: "/integracoes", icon: Link2 },
      ],
    },
    {
      label: "",
      items: [
        { title: "Suporte", url: "/suporte", icon: Headphones },
      ],
    },
  ];

  // Bruno 2026-06-13: atalho pro console Super Gerencial (gestão de tenants) —
  // SÓ aparece pro super admin da plataforma (isSuperAdmin do /api/auth/me, por
  // email). Os demais tenants nunca veem. O console tem login próprio.
  if (isSuperAdmin) {
    groups.push({
      label: "Plataforma",
      items: [
        { title: "Super Gerencial", url: "/super-admin", icon: ShieldCheck },
      ],
    });
  }

  return groups;
}

export const AppSidebar = memo(function AppSidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const [location] = useLocation();

  const { data: conversationsData } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 15000,
  });
  // Bruno 2026-06-08: o badge de não-lidas do Chat segue o mesmo critério do Chat —
  // admin/gerente conta só o que ele vê lá (dele + fila), não as de outros atendentes.
  const { data: sbMeData } = useQuery<{ ok: boolean; data: { id?: number; role?: string; isSuperAdmin?: boolean } }>({
    queryKey: ["/api/auth/me"],
  });
  const sbIsManager = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(sbMeData?.data?.role || "");
  const sbMyId = sbMeData?.data?.id;
  const sbIsSuperAdmin = sbMeData?.data?.isSuperAdmin === true;
  const chatUnread = useMemo(() => {
    if (!conversationsData) return 0;
    const visible = sbIsManager
      ? conversationsData.filter((c: any) => c.assignedUserId === sbMyId || !c.assignedUserId)
      : conversationsData;
    return visible.filter((c: any) => c.unread > 0 && c.status !== "resolved").length;
  }, [conversationsData, sbIsManager, sbMyId]);

  const badgeValues: Record<string, string> = useMemo(() => {
    const vals: Record<string, string> = {};
    if (chatUnread > 0) vals["chat_unread"] = String(chatUnread);
    return vals;
  }, [chatUnread]);

  const navGroups = useMemo(() => {
    return getNavGroups(sbIsSuperAdmin);
  }, [sbIsSuperAdmin]);

  // Grupos recolhíveis (Comunicação, Configuração): SEMPRE começam abertos a
  // cada carregamento/refresh (Bruno 2026-07-04). O estado não é persistido de
  // propósito — o chevron recolhe só durante a sessão; ao recarregar volta aberto.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isGroupOpen = (label: string) => openGroups[label] ?? true;
  const toggleGroup = (label: string) =>
    setOpenGroups((o) => ({ ...o, [label]: !(o[label] ?? true) }));

  // Impersonação centralizada em @/lib/impersonation (mesma fonte do banner do topo).
  const isImpersonating = checkImpersonating();
  const impersonatedName = isImpersonating ? impersonatedUserName() : "";
  const handleExitImpersonation = exitImpersonation;

  // Card de usuário no rodapé (padrão Nexus/ERP).
  const sbUser = authService.getUser();
  const sbNome = sbUser?.nome || "Usuário";
  const sbEmail = sbUser?.email || "";
  const sbInitials = sbNome.trim().split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "U";

  return (
    <aside
      className={`
        bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden transition-all duration-200
        fixed inset-y-0 left-0 z-50
        md:relative md:inset-auto md:z-auto md:translate-x-0
        ${collapsed ? "w-[56px] min-w-[56px]" : "w-[256px] min-w-[256px]"}
        ${mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"}
      `}
      data-testid="app-sidebar"
    >
      <div
        className={`${collapsed ? "justify-center px-0" : "px-3 justify-between"} h-16 flex items-center flex-shrink-0 bg-sidebar border-b border-sidebar-border relative`}
        data-testid="img-app-logo"
      >
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={onToggle}
                className="flex items-center justify-center rounded-lg hover:bg-secondary transition-colors duration-200 w-11 h-11"
                title="Expandir menu"
                data-testid="button-toggle-sidebar-collapsed"
              >
                <NorteMark size={30} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">Expandir menu</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <button
              onClick={onToggle}
              className="flex items-center min-w-0 transition-opacity duration-200 cursor-pointer"
              data-testid="button-logo-toggle"
              title="Norte Gestão CRM"
            >
              <NorteBrand />
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-secondary transition-colors duration-200 flex-shrink-0"
              title="Recolher menu"
              data-testid="button-toggle-sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
      <nav className="sidebar-menu min-h-0 overflow-y-auto py-2 px-2">
        {navGroups.map((group, gi) => {
          const isCollapsibleGroup = !collapsed && !!group.collapsible;
          const groupOpen = isGroupOpen(group.label);
          const showItems = !isCollapsibleGroup || groupOpen;

          const renderItem = (item: any) => {
            const itemBasePath = item.url.split("?")[0];
            const locationBasePath = location.split("?")[0];
            const isActive = itemBasePath === "/"
              ? locationBasePath === "/"
              : locationBasePath.startsWith(itemBasePath);

            // Nexus menu-item: h-8 rounded-box, ativo = bg-base-200 (sutil), sem
            // barra/gradiente. Fiel ao sidebar-menu do template.
            const linkContent = (
              <div
                className={`menu-item flex items-center h-8 rounded-box cursor-pointer text-[13px] transition-colors select-none ${collapsed ? "justify-center px-0 mx-1" : "gap-2.5 px-2.5 mx-1.5"} ${
                  isActive
                    ? "bg-base-200 font-medium text-base-content"
                    : "text-base-content/70 hover:bg-base-200 hover:text-base-content"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="grow truncate">{item.title}</span>}
                {!collapsed && (item as any).badgeKey && badgeValues[(item as any).badgeKey] && (
                  <span className="badge badge-primary badge-sm text-[9.5px] font-bold px-1.5">
                    {badgeValues[(item as any).badgeKey]}
                  </span>
                )}
              </div>
            );

            const handlePrefetch = () => prefetchRoute(item.url);
            const handleClick = () => { if (mobileOpen) onMobileClose?.(); };

            if (collapsed) {
              return (
                <Tooltip key={item.title} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.url}
                      data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      onMouseEnter={handlePrefetch}
                      onClick={handleClick}
                    >
                      {linkContent}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {item.title}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={item.title}
                href={item.url}
                data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                onMouseEnter={handlePrefetch}
                onClick={handleClick}
              >
                {linkContent}
              </Link>
            );
          };

          return (
            <div key={group.label || `grupo-${gi}`} className="space-y-0.5">
              {/* Rótulo de seção simples (Menu, Plataforma) */}
              {!collapsed && group.label && !group.collapsible && (
                <p className="menu-label px-2.5 pt-3 pb-1 text-[11px] font-medium text-base-content/50">
                  {group.label}
                </p>
              )}
              {/* Cabeçalho recolhível (Comunicação, Configuração) — chevron + toggle */}
              {isCollapsibleGroup && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="menu-label w-full flex items-center gap-1.5 px-2.5 pt-3 pb-1 text-[11px] font-medium text-base-content/50 hover:text-base-content transition-colors"
                  data-testid={`nav-group-toggle-${group.label.toLowerCase()}`}
                  aria-expanded={groupOpen}
                >
                  <span className="grow text-left">{group.label}</span>
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${groupOpen ? "" : "-rotate-90"}`} />
                </button>
              )}
              {collapsed && <div className="pt-2" />}
              {/* Itens — aninhados com linha vertical quando o grupo é recolhível */}
              {showItems && (
                <div className={isCollapsibleGroup ? "ml-3 pl-1 border-l border-base-content/10 space-y-0.5" : "space-y-0.5"}>
                  {group.items.map(renderItem)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex-1" />
      </div>

      {/* Card de usuário no rodapé (padrão Nexus/ERP) → abre o perfil. */}
      <div className={`flex-shrink-0 border-t border-sidebar-border ${collapsed ? "p-1.5" : "p-2"}`} data-testid="sidebar-user-card">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/perfil" className="flex justify-center py-1">
                <span className="grid place-items-center size-8 rounded-[10px] bg-primary text-primary-foreground text-[11px] font-bold overflow-hidden">
                  {sbUser?.avatarUrl ? <img src={sbUser.avatarUrl} alt="" className="size-8 object-cover" /> : sbInitials}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">{sbNome}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href="/perfil"
            className="flex items-center gap-2.5 rounded-box bg-secondary/70 hover:bg-secondary px-2.5 py-2 transition-colors"
            data-testid="sidebar-user-link"
          >
            <span className="grid place-items-center size-8 rounded-[10px] bg-primary text-primary-foreground text-[11px] font-bold shrink-0 overflow-hidden">
              {sbUser?.avatarUrl ? <img src={sbUser.avatarUrl} alt="" className="size-8 object-cover" /> : sbInitials}
            </span>
            <div className="grow min-w-0 -space-y-0.5">
              <p className="truncate text-[12.5px] font-medium text-foreground">{sbNome}</p>
              <p className="truncate text-[11px] text-muted-foreground">{sbEmail}</p>
            </div>
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </Link>
        )}
      </div>

      {isImpersonating && (
        <div className={`flex-shrink-0 border-t border-amber-500/30 bg-amber-500/10 ${collapsed ? "p-1.5" : "p-3"}`} data-testid="sidebar-impersonation">
          {collapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={handleExitImpersonation}
                  className="w-full flex items-center justify-center p-2 rounded-lg bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Modo visualizacao · {impersonatedName} · Clique para sair
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-amber-500">
                <Eye className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Modo visualizacao</span>
              </div>
              <div className="text-[11px] text-amber-400/80 truncate">{impersonatedName}</div>
              <button
                onClick={handleExitImpersonation}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 transition-colors text-[11px] font-semibold"
                data-testid="button-exit-impersonation-sidebar"
              >
                <LogOut className="w-3 h-3" />
                Sair
              </button>
            </div>
          )}
        </div>
      )}

    </aside>
  );
});
