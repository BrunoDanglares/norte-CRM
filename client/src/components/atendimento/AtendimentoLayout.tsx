import { ReactNode, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutGrid,
  MessageSquare,
  Users,
  Sun,
  Moon,
  Bell,
  BellOff,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { useAudioAlert } from "@/hooks/useAudioAlert";
import { useWebSocket } from "@/hooks/useWebSocket";
import { authService } from "@/services/auth";
import { isManagerOrAdmin } from "@/lib/roles";
import { NorteMark } from "@/components/brand/NorteBrand";
import { apiRequest, queryClient } from "@/lib/queryClient";

const NAV_ITEMS = [
  { label: "Painel", url: "/atendimento", icon: LayoutGrid, testid: "atend-nav-dashboard" },
  { label: "Chat", url: "/atendimento/chat", icon: MessageSquare, testid: "atend-nav-chat" },
  { label: "Clientes", url: "/atendimento/clientes", icon: Users, testid: "atend-nav-clientes" },
];

export function AtendimentoLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { resolved, setTheme } = useTheme();
  const { enabled: audioEnabled, toggle: toggleAudio, play: playAudio } = useAudioAlert();
  const canReturnToGestao = isManagerOrAdmin();
  const user = authService.getUser();
  const prefersReducedMotion = useReducedMotion();

  // Spring suave pra entrada do modo Atendimento. Mini-sidebar desliza da
  // esquerda; main area faz fade + slide leve da direita. Sai do "seco" sem
  // ficar pomposo. Respeita prefers-reduced-motion.
  const sidebarInit = prefersReducedMotion ? { opacity: 0 } : { x: -72, opacity: 0 };
  const sidebarAnim = prefersReducedMotion ? { opacity: 1 } : { x: 0, opacity: 1 };
  const contentInit = prefersReducedMotion ? { opacity: 0 } : { x: 16, opacity: 0 };
  const contentAnim = prefersReducedMotion ? { opacity: 1 } : { x: 0, opacity: 1 };
  const sidebarTrans = { type: "spring" as const, stiffness: 320, damping: 32 };
  const contentTrans = { duration: 0.32, ease: [0.4, 0, 0.2, 1] as [number, number, number, number], delay: 0.04 };

  // Toca beep em nova msg inbound quando alerta está ativo. O hook já gateia
  // por enabled, então plugar incondicionalmente é seguro.
  useWebSocket({
    new_message: (data: any) => {
      if (data?.direction === "inbound" || data?.message?.direction === "inbound") {
        playAudio();
      }
    },
  });

  const initials = useMemo(() => {
    const n = user?.nome || "";
    return n.split(" ").map((w: string) => w[0]).join("").substring(0, 2).toUpperCase() || "EU";
  }, [user]);

  const isActive = (url: string) => {
    if (url === "/atendimento") return location === "/atendimento";
    return location.startsWith(url);
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-base-200">
      {/* Mini-sidebar do modo Atendimento — ícones grandes, label compacto (Nexus) */}
      <motion.aside
        className="w-[72px] min-w-[72px] bg-base-100 border-e border-base-200 flex flex-col items-center flex-shrink-0 [&_a:focus-visible]:outline-none [&_button:focus-visible]:outline-none"
        data-testid="atendimento-sidebar"
        initial={sidebarInit}
        animate={sidebarAnim}
        transition={sidebarTrans}
      >
        {/* Marca Norte (flat, estilo Nexus) */}
        <div className="h-16 w-full flex items-center justify-center flex-shrink-0 border-b border-base-200 group/logo">
          <div className="select-none transition-transform duration-300 ease-out group-hover/logo:scale-[1.06]">
            <NorteMark size={38} />
          </div>
        </div>

        {/* Nav principal */}
        <nav className="flex flex-col items-center gap-1 py-3 flex-1 w-full overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.url);
            return (
              <Tooltip key={item.url} delayDuration={300}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.url}
                    className={`relative flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-box transition-colors group ${
                      active
                        ? "grad-primary text-primary-content font-semibold"
                        : "text-base-content/60 hover:text-base-content hover:bg-base-200"
                    }`}
                    data-testid={item.testid}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-[9px] font-semibold tracking-wide">{item.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Rodapé: modo claro, alerta, voltar à gestão (admin/manager), perfil */}
        <div className="flex flex-col items-center gap-1 py-3 w-full border-t border-base-200">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  const next = resolved === "dark" ? "light" : "dark";
                  setTheme(next);
                  // Persiste no perfil pra que ThemeSyncer não reverta no próximo F5.
                  // Mesmo padrão do TopBar (App.tsx).
                  apiRequest("PUT", "/api/perfil/me", { tema: next })
                    .then((r) => r.json())
                    .then((json) => {
                      if (json?.ok) {
                        authService.setUser(json.data);
                        queryClient.invalidateQueries({ queryKey: ["/api/perfil/me"] });
                      }
                    })
                    .catch(() => {});
                }}
                className="flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-box text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors"
                data-testid="atend-toggle-theme"
              >
                {resolved === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span className="text-[8.5px] font-semibold tracking-wide">{resolved === "dark" ? "Light" : "Dark"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">{resolved === "dark" ? "Modo claro" : "Modo escuro"}</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={toggleAudio}
                className={`flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-box transition-colors ${
                  audioEnabled ? "text-primary bg-primary/10" : "text-base-content/60 hover:text-base-content hover:bg-base-200"
                }`}
                data-testid="atend-toggle-audio"
                aria-pressed={audioEnabled}
              >
                {audioEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                <span className="text-[8.5px] font-semibold tracking-wide">Alerta</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {audioEnabled ? "Alerta sonoro ativo" : "Alerta sonoro desligado"}
            </TooltipContent>
          </Tooltip>

          {canReturnToGestao && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Link
                  href="/inicio"
                  className="flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-box text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  data-testid="atend-back-to-gestao"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-[8.5px] font-semibold tracking-wide leading-tight text-center">Voltar</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Voltar pra gestão</TooltipContent>
            </Tooltip>
          )}

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Link
                href="/atendimento/perfil"
                className="flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-box text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors"
                data-testid="atend-profile"
              >
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-primary text-primary-content text-[10px] font-bold flex items-center justify-center">
                    {initials}
                  </div>
                )}
                <span className="text-[8.5px] font-semibold tracking-wide truncate w-full text-center px-1">
                  {(user?.nome || "Perfil").split(" ")[0]}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">{user?.nome || "Perfil"}</TooltipContent>
          </Tooltip>
        </div>
      </motion.aside>

      <motion.main
        className="flex-1 min-w-0 overflow-hidden"
        initial={contentInit}
        animate={contentAnim}
        transition={contentTrans}
      >
        {children}
      </motion.main>
    </div>
  );
}
