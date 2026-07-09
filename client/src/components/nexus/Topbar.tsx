// Topbar reconstruído sobre a ESTRUTURA REAL do Nexus 4.0.0 (admin-layout/Topbar):
// esquerda = toggle do menu + caixa de busca; direita = tema + settings +
// notificações + perfil. O título vive no conteúdo da página (como no Nexus);
// mostramos um discreto em telas grandes. Lógica wireada aos dados do CRM.
import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTheme } from "@/components/theme-provider";
import { authService } from "@/services/auth";

export const NexusTopbar = ({ title, onOpenSettings }: { title?: string; onOpenSettings?: () => void }) => {
  const { resolved, setTheme } = useTheme();
  const [, setLocation] = useLocation();

  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const notifQuery = useQuery<any>({ queryKey: ["/api/notificacoes"], refetchInterval: 15000 });
  const notifRaw = notifQuery.data;
  const notifList: any[] = Array.isArray(notifRaw) ? notifRaw : (notifRaw as any)?.data || [];
  const unread = notifList.filter((n: any) => !n.lida).length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 30);
  }, [searchOpen]);

  const toggleTheme = () => {
    const next = resolved === "dark" ? "light" : "dark";
    setTheme(next);
    apiRequest("PUT", "/api/perfil/me", { tema: next })
      .then((r) => r.json())
      .then((j) => { if (j.ok) { authService.setUser(j.data); queryClient.invalidateQueries({ queryKey: ["/api/perfil/me"] }); } })
      .catch(() => {});
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInputRef.current?.value.trim();
    setSearchOpen(false);
    if (q) setLocation(`/crm?q=${encodeURIComponent(q)}`);
  };

  const u = authService.getUser();
  const nome = u?.nome || "Usuário";
  const email = u?.email || "";
  const initials = nome.trim().split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "U";

  return (
    <div role="navigation" aria-label="Barra superior" className="flex items-center justify-between px-3 bg-base-100" id="layout-topbar">
      {/* Esquerda: toggle + busca (estrutura Nexus) */}
      <div className="inline-flex items-center gap-3">
        <label className="btn btn-square btn-ghost btn-sm" aria-label="Alternar menu" htmlFor="layout-sidebar-toggle-trigger">
          <span className="iconify lucide--menu size-5" />
        </label>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="btn btn-outline btn-sm btn-ghost border-base-300 text-base-content/60 hidden h-9 w-56 justify-start gap-2 md:flex"
        >
          <span className="iconify lucide--search size-4" />
          <span className="font-normal">Buscar…</span>
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="btn btn-outline btn-sm btn-square btn-ghost border-base-300 text-base-content/60 flex size-9 md:hidden"
          aria-label="Buscar"
        >
          <span className="iconify lucide--search size-4" />
        </button>
        {title && <h1 className="hidden lg:block text-[15px] font-semibold tracking-tight text-base-content/90 ml-1">{title}</h1>}
      </div>

      {/* Direita: tema + settings + notificações + perfil */}
      <div className="inline-flex items-center gap-0.5">
        <button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={toggleTheme} aria-label="Alternar tema">
          <span className={`iconify size-4.5 ${resolved === "dark" ? "lucide--sun" : "lucide--moon"}`} />
        </button>

        <button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={onOpenSettings} aria-label="Personalização">
          <span className="iconify lucide--settings-2 size-4.5" />
        </button>

        {/* Notificações */}
        <div className="relative" ref={notifRef}>
          <button type="button" className="btn btn-circle btn-ghost btn-sm relative" onClick={() => { setNotifOpen((v) => !v); setUserOpen(false); }} aria-label="Notificações">
            <span className="iconify lucide--bell size-4.5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-error px-1 text-[9px] font-bold text-error-content">{unread}</span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute end-0 top-11 z-50 w-80 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-xl">
              <div className="flex items-center justify-between border-b border-base-200 px-4 py-3">
                <span className="text-[13px] font-semibold">Notificações</span>
                <button className="text-[11px] text-primary hover:underline" onClick={() => { apiRequest("POST", "/api/notificacoes/read-all").then(() => queryClient.invalidateQueries({ queryKey: ["/api/notificacoes"] })).catch(() => {}); }}>Marcar todas</button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifList.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-base-content/50">Nenhuma notificação</div>}
                {notifList.map((n: any) => (
                  <button key={n.id} className={`flex w-full items-start gap-2 border-b border-base-200/60 px-4 py-3 text-left hover:bg-base-200/50 ${!n.lida ? "bg-primary/[0.05]" : ""}`}
                    onClick={() => { if (n.link) { setNotifOpen(false); setLocation(n.link); } }}>
                    <span className={`mt-1 size-2 rounded-full ${!n.lida ? "bg-primary" : "bg-transparent"}`} />
                    <p className={`text-[12px] leading-snug ${!n.lida ? "font-medium" : "text-base-content/60"}`}>{n.mensagem || n.titulo}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Perfil (avatar + nome/email, estilo Nexus) */}
        <div className="relative" ref={userRef}>
          <button type="button" className="btn btn-ghost gap-2 px-1.5 h-10" onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); }} aria-label="Perfil">
            <span className="grid size-8 place-items-center overflow-hidden mask mask-squircle bg-primary text-[11px] font-bold text-primary-content">
              {u?.avatarUrl ? <img src={u.avatarUrl} alt="" className="size-8 object-cover" /> : initials}
            </span>
            <span className="text-start max-sm:hidden -space-y-0.5">
              <span className="block text-[13px] font-medium leading-none text-base-content">{nome.split(" ")[0]}</span>
              <span className="block text-[11px] text-base-content/50 leading-none mt-0.5 truncate max-w-[120px]">{email}</span>
            </span>
          </button>
          {userOpen && (
            <ul className="absolute end-0 top-12 z-50 menu w-52 rounded-box border border-base-300 bg-base-100 p-1 shadow-xl">
              <li className="menu-title text-[11px]">Conta</li>
              <li><Link href="/perfil" onClick={() => setUserOpen(false)}><span className="iconify lucide--user size-4" />Meu Perfil</Link></li>
              <li><Link href="/workspace" onClick={() => setUserOpen(false)}><span className="iconify lucide--users size-4" />Workspace</Link></li>
              <li><Link href="/billing" onClick={() => setUserOpen(false)}><span className="iconify lucide--credit-card size-4" />Assinatura</Link></li>
              <li><Link href="/suporte" onClick={() => setUserOpen(false)}><span className="iconify lucide--help-circle size-4" />Suporte</Link></li>
              <li><button type="button" className="text-error hover:bg-error/10" onClick={() => { setUserOpen(false); authService.logout(); }}><span className="iconify lucide--log-out size-4" />Sair</button></li>
            </ul>
          )}
        </div>
      </div>

      {/* Modal de busca (command palette do Nexus, simplificado + funcional) */}
      {searchOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 bg-black/40" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitSearch} className="bg-base-100 rounded-box border border-base-300 shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="iconify lucide--search text-base-content/60 size-5" />
                <input ref={searchInputRef} type="search" className="grow bg-transparent outline-none text-[15px]" placeholder="Buscar contatos, conversas…" aria-label="Buscar" />
                <button type="button" className="btn btn-xs btn-circle btn-ghost" onClick={() => setSearchOpen(false)} aria-label="Fechar">
                  <span className="iconify lucide--x size-4" />
                </button>
              </div>
              <div className="border-t border-base-200 px-4 py-2 text-[11px] text-base-content/50">
                Enter para buscar no CRM
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
