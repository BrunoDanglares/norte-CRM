// Sidebar do CRM portado do nexus-react@3.3.0 (admin-layout/Sidebar). Adaptações:
// react-router -> wouter; Logo -> NorteBrand; menu dinâmico do CRM (badge de
// não-lidas, item super-admin); dropdown de usuário -> authService. Iconify +
// SimpleBar + o mecanismo de collapse são mantidos idênticos ao template.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import SimpleBarCore from "simplebar-core";
// @ts-ignore
import SimpleBar from "simplebar-react";
import "simplebar-react/dist/simplebar.min.css";

import { NorteBrand } from "@/components/brand/NorteBrand";
import { authService } from "@/services/auth";
import { getNexusMenu } from "@/lib/nexus-menu";
import { SidebarMenuItem } from "./SidebarMenuItem";

function collectLeafUrls(items: any[], out: string[] = []): string[] {
  for (const i of items) {
    if (i.url) out.push(i.url);
    if (i.children) collectLeafUrls(i.children, out);
  }
  return out;
}

// Bruno 2026-07-04: coleta os ids de TODOS os grupos colapsáveis (itens com
// children) — usado pra deixar todos sempre abertos.
function collectParentKeys(items: any[], out: string[] = []): string[] {
  for (const i of items) {
    if (i.children && i.children.length) {
      out.push(i.id);
      collectParentKeys(i.children, out);
    }
  }
  return out;
}

export const NexusSidebar = () => {
  const [location] = useLocation();
  const pathname = location.split("?")[0];
  const scrollRef = useRef<SimpleBarCore | null>(null);

  const { data: conversationsData } = useQuery<any[]>({ queryKey: ["/api/conversations"], refetchInterval: 15000 });
  const { data: meData } = useQuery<{ ok: boolean; data: { id?: number; role?: string; isSuperAdmin?: boolean } }>({ queryKey: ["/api/auth/me"] });
  const isManager = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(meData?.data?.role || "");
  const myId = meData?.data?.id;
  const isSuperAdmin = meData?.data?.isSuperAdmin === true;
  const chatUnread = useMemo(() => {
    if (!conversationsData) return 0;
    const visible = isManager
      ? conversationsData.filter((c: any) => c.assignedUserId === myId || !c.assignedUserId)
      : conversationsData;
    return visible.filter((c: any) => c.unread > 0 && c.status !== "resolved").length;
  }, [conversationsData, isManager, myId]);

  const menuItems = useMemo(() => getNexusMenu({ chatUnread, isSuperAdmin }), [chatUnread, isSuperAdmin]);

  // Casa a rota atual com a folha do menu (prefixo, p/ sub-rotas tipo /atendimento/chat).
  const activeUrl = useMemo(() => {
    const leaves = collectLeafUrls(menuItems);
    const match = leaves
      .filter((u) => pathname === u || pathname.startsWith(u + "/") || (u === "/inicio" && pathname === "/"))
      .sort((a, b) => b.length - a.length)[0];
    return match || pathname;
  }, [menuItems, pathname]);

  // Bruno 2026-07-04: TODOS os grupos (Comunicação, Configuração) começam SEMPRE
  // abertos — a cada refresh/startup. Antes o template abria só o grupo da rota
  // ativa e recolhia os outros; agora abrimos todos. O chevron ainda recolhe
  // manualmente durante a sessão (e a escolha só é desfeita ao recarregar).
  const allParentKeys = useMemo(() => collectParentKeys(menuItems), [menuItems]);
  const [activatedParents, setActivatedParents] = useState<Set<string>>(() => new Set(allParentKeys));
  useEffect(() => {
    setActivatedParents(new Set(allParentKeys));
  }, [allParentKeys]);

  const onToggleActivated = (key: string) => {
    setActivatedParents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Auto-scroll pro item ativo ao navegar.
  useEffect(() => {
    setTimeout(() => {
      const contentElement = scrollRef.current?.getContentElement();
      const scrollElement = scrollRef.current?.getScrollElement();
      const activatedItem = contentElement?.querySelector<HTMLElement>(".active");
      const top = activatedItem?.getBoundingClientRect().top;
      if (activatedItem && scrollElement && top && top !== 0) {
        scrollElement.scrollTo({ top: scrollElement.scrollTop + top - 300, behavior: "smooth" });
      }
    }, 100);
  }, [activatedParents, activeUrl]);

  const u = authService.getUser();
  const nome = u?.nome || "Usuário";
  const email = u?.email || "";
  const initials = nome.trim().split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() || "U";

  return (
    <>
      <input type="checkbox" id="layout-sidebar-toggle-trigger" className="hidden" aria-label="Alternar barra lateral" />
      <input type="checkbox" id="layout-sidebar-hover-trigger" className="hidden" aria-label="Modo compacto" />
      <div id="layout-sidebar-hover" className="bg-base-300 h-screen w-1"></div>

      <div id="layout-sidebar" className="sidebar-menu flex flex-col">
        <div className="flex h-16 min-h-16 items-center justify-between gap-3 ps-5 pe-4">
          <Link href="/inicio"><NorteBrand /></Link>
          <label
            htmlFor="layout-sidebar-hover-trigger"
            title="Recolher menu"
            className="btn btn-circle btn-ghost btn-sm text-base-content/50 max-lg:hidden">
            <span className="iconify lucide--panel-left-close size-4.5" />
          </label>
        </div>

        <div className="relative min-h-0 grow">
          <SimpleBar ref={scrollRef} className="size-full">
            <div className="mb-3 space-y-0.5 px-2.5">
              {menuItems.map((item, index) => (
                <SidebarMenuItem
                  {...item}
                  key={index}
                  activated={activatedParents}
                  onToggleActivated={onToggleActivated}
                />
              ))}
            </div>
          </SimpleBar>
          <div className="from-base-100/60 pointer-events-none absolute start-0 end-0 bottom-0 h-7 bg-linear-to-t to-transparent"></div>
        </div>

        <div className="mb-2">
          <hr className="border-base-300 my-2 border-dashed" />
          <div className="dropdown dropdown-top dropdown-end w-full">
            <div
              tabIndex={0}
              role="button"
              className="bg-base-200 hover:bg-base-300 rounded-box mx-2 mt-0 flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-all">
              <div className="bg-primary text-primary-content mask mask-squircle grid size-8 place-items-center overflow-hidden text-xs font-bold">
                {u?.avatarUrl ? <img src={u.avatarUrl} alt="" className="size-8 object-cover" /> : initials}
              </div>
              <div className="grow -space-y-0.5 overflow-hidden">
                <p className="truncate text-sm font-medium">{nome}</p>
                <p className="text-base-content/60 truncate text-xs">{email}</p>
              </div>
              <span className="iconify lucide--chevrons-up-down text-base-content/60 size-4" />
            </div>
            <ul role="menu" tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box shadow-base-content/10 mb-1 w-52 p-1 shadow-[0px_-10px_40px_0px]">
              <li>
                <Link href="/perfil"><span className="iconify lucide--user size-4" /><span>Meu Perfil</span></Link>
              </li>
              <li>
                <Link href="/workspace"><span className="iconify lucide--users size-4" /><span>Workspace</span></Link>
              </li>
              <li>
                <Link href="/billing"><span className="iconify lucide--credit-card size-4" /><span>Assinatura</span></Link>
              </li>
              <li>
                <button type="button" className="text-error" onClick={() => authService.logout()}>
                  <span className="iconify lucide--log-out size-4" /><span>Sair</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <label htmlFor="layout-sidebar-toggle-trigger" id="layout-sidebar-backdrop"></label>
    </>
  );
};
