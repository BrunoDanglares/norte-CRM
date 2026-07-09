import { User, ChevronRight, ChevronLeft } from "lucide-react";

// Bruno 2026-05-19: rail vertical entre o MessageArea e o ActionsSidebar.
// Item: cliente (as abas Financeiro/Suporte eram do módulo ISP, removidas).
//
// Layout: coluna ~64px de largura, ícones grandes + label pequena, item ativo
// com indicador amarelo à esquerda e cor de destaque. Topo tem botão de
// expand/collapse do ActionsSidebar.

export type ChatRailTab = "cliente";

interface ChatRailNavProps {
  active?: ChatRailTab | null;
  onSelect?: (tab: ChatRailTab) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

const ITEMS: { id: ChatRailTab; label: string; Icon: typeof User }[] = [
  { id: "cliente", label: "Cliente", Icon: User },
];

export default function ChatRailNav({
  active,
  onSelect,
  sidebarOpen = true,
  onToggleSidebar,
}: ChatRailNavProps) {
  return (
    <div
      className="flex-shrink-0 w-[64px] h-full border-l border-r border-border bg-card/40 flex flex-col"
      data-testid="chat-rail-nav"
    >
      {/* Topo — toggle do painel de ações */}
      <div className="flex items-center justify-center h-12 border-b border-border/60">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="w-8 h-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
          aria-label={sidebarOpen ? "Recolher painel" : "Expandir painel"}
          title={sidebarOpen ? "Recolher painel de ações" : "Expandir painel de ações"}
          data-testid="rail-toggle-sidebar"
        >
          {sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Itens */}
      <div className="flex-1 flex flex-col items-stretch py-2 gap-0.5">
        {ITEMS.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect?.(id)}
              className={`relative flex flex-col items-center justify-center gap-1 py-2.5 mx-1 rounded-md transition-colors group ${
                isActive
                  ? "font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
              // Bruno 2026-07-04: seleção preenchida com o gradiente-token
              // (--gradient-primary, violeta→rosa) + glow, igual aos demais
              // ativos (AtendimentoLayout, seg-tab, btn-primary).
              style={isActive ? { color: "hsl(var(--primary-foreground))", backgroundImage: "var(--gradient-primary)", boxShadow: "var(--shadow-primary-glow)" } : undefined}
              data-testid={`rail-tab-${id}`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className={`text-[10px] leading-none ${isActive ? "font-semibold" : "font-medium"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
