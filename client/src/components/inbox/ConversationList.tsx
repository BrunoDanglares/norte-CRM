import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getInitials, sanitizeDisplayName } from "@/lib/constants";
import ContactAvatar from "@/components/ContactAvatar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SECTOR_COLORS } from "@/lib/situation-tags";

// Setor atribuído pela IA / pipeline. Cores semânticas via SECTOR_COLORS
// (mesma fonte do StatusBadge). Devolve null se conversa não tem pipeline
// nem tags semânticas — nesse caso a pill não aparece. (Bruno, 2026-05-17)
// Bruno 2026-05-17: alinhado com Fluxograma.tsx (cores red pro Cancelamento).
// Adicionado setor 'K' (Kancelamento/red-600) pra distinguir do F (amber).
const SETOR_BY_PIPELINE: Record<string, { label: string; sector: 'S' | 'F' | 'C' | 'N' | 'X' | 'K' }> = {
  suporte: { label: 'Suporte', sector: 'S' },
  suporte_tecnico: { label: 'Suporte', sector: 'S' },
  financeiro: { label: 'Financeiro', sector: 'F' },
  vendas: { label: 'Comercial', sector: 'C' },
  comercial: { label: 'Comercial', sector: 'C' },
  cancelamento: { label: 'Cancelamento', sector: 'K' },
  reputacao: { label: 'Reputação', sector: 'N' },
};
const SETOR_BY_PREFIX: Record<string, { label: string; sector: 'S' | 'F' | 'C' | 'N' }> = {
  S: { label: 'Suporte', sector: 'S' },
  F: { label: 'Financeiro', sector: 'F' },
  C: { label: 'Comercial', sector: 'C' },
  N: { label: 'Reputação', sector: 'N' },
};
function deriveSetor(conv: any): { label: string; color: string; bg: string } | null {
  // 1) pipeline é fonte mais confiável
  const pipeline = String(conv.pipeline || '').toLowerCase().trim();
  if (pipeline && SETOR_BY_PIPELINE[pipeline]) {
    const m = SETOR_BY_PIPELINE[pipeline];
    return { label: m.label, ...SECTOR_COLORS[m.sector] };
  }
  // 2) fallback: primeira tag com prefixo F/S/C/N
  const tags: string[] = conv.tags || [];
  for (const t of tags) {
    const prefix = (t || '').charAt(0).toUpperCase();
    if (SETOR_BY_PREFIX[prefix]) {
      const m = SETOR_BY_PREFIX[prefix];
      return { label: m.label, ...SECTOR_COLORS[m.sector] };
    }
  }
  // 3) fallback: extrai do campo `agente` ("[Equipe] Financeiro" etc.)
  const agente = String(conv.agente || '').replace(/^\[Equipe\]\s*/i, '').toLowerCase();
  if (agente && SETOR_BY_PIPELINE[agente]) {
    const m = SETOR_BY_PIPELINE[agente];
    return { label: m.label, ...SECTOR_COLORS[m.sector] };
  }
  return null;
}
import {
  Search, Check, User, Bot,
  Trash2, RefreshCw, ChevronDown, ChevronLeft, ChevronRight
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from "motion/react";
import { WhatsAppIcon, InstagramIcon } from "@/components/brand-icons";
import type { Conversation } from "@shared/schema";
import { channelColor, agentColor, formatLastMessageTime, type ConvExtended } from "./helpers";
import { renderMessagePreview, isMediaPlaceholder } from "./MessagePreview";
import NovoAtendimentoModal from "./NovoAtendimentoModal";

function AnimatedCount({ value, className = "" }: { value: number; className?: string }) {
  const prefersReducedMotion = useReducedMotion();
  if (prefersReducedMotion) return <span className={`tabular-nums ${className}`}>{value}</span>;
  return (
    <span className={`relative inline-flex tabular-nums ${className}`} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

interface ConversationListProps {
  conversations: Conversation[];
  filtered: ConvExtended[];
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  setChatMode: (mode: "cliente" | "interno") => void;
  search: string;
  setSearch: (s: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  conexaoFilter: string | null;
  setConexaoFilter: (s: string | null) => void;
  conexoesList: any[];
  availableTags: { id: number; nome: string; cor: string }[];
  totalUnread: number;
  wsConnected: boolean;
  refreshSpinning: boolean;
  setRefreshSpinning: (b: boolean) => void;
  openResolveDialog: (conv: any) => void;
  setConfirmDeleteConv: (id: number | null) => void;
  contactsData: any[] | undefined;
  newChatOpen: boolean;
  setNewChatOpen: (b: boolean) => void;
  newChatSearch: string;
  setNewChatSearch: (s: string) => void;
  conexaoDropdownOpen: boolean;
  setConexaoDropdownOpen: (b: boolean) => void;
  conexaoDropdownRef: React.RefObject<HTMLDivElement>;
  channelFilter?: string;
  setChannelFilter?: (s: string) => void;
  instagramEnabled?: boolean;
  whatsappEnabled?: boolean;
  equipesList?: any[];
}

export default function ConversationList({
  conversations, filtered, selectedId, setSelectedId, setChatMode,
  search, setSearch, statusFilter, setStatusFilter,
  conexaoFilter, setConexaoFilter, conexoesList, availableTags,
  totalUnread, wsConnected, refreshSpinning, setRefreshSpinning,
  openResolveDialog, setConfirmDeleteConv,
  contactsData, newChatOpen, setNewChatOpen, newChatSearch, setNewChatSearch,
  conexaoDropdownOpen, setConexaoDropdownOpen, conexaoDropdownRef,
  channelFilter, setChannelFilter, instagramEnabled = true, whatsappEnabled = true,
  equipesList = [],
}: ConversationListProps) {
  const contactAvatarByPhone = useMemo(() => {
    const map: Record<string, string | null> = {};
    if (!contactsData) return map;
    for (const c of contactsData) {
      if (c.telefone && c.fotoUrl) {
        const raw = String(c.telefone).replace(/\D/g, "");
        map[raw] = c.fotoUrl;
        if (raw.startsWith("55") && raw.length > 10) map[raw.slice(2)] = c.fotoUrl;
        else if (!raw.startsWith("55") && raw.length >= 8) map[`55${raw}`] = c.fotoUrl;
      }
    }
    return map;
  }, [contactsData]);

  const reopenMutation = useMutation({
    mutationFn: (convId: number) => apiRequest("PATCH", `/api/conversations/${convId}/reopen`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    },
  });

  const showChannelFilter = instagramEnabled && whatsappEnabled;

  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollArrows = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    updateScrollArrows();
    el.addEventListener("scroll", updateScrollArrows, { passive: true });
    const ro = new ResizeObserver(updateScrollArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollArrows);
      ro.disconnect();
    };
  }, [updateScrollArrows]);

  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    const activeBtn = el.querySelector(`[data-testid="button-filter-${statusFilter}"]`) as HTMLElement | null;
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    setTimeout(updateScrollArrows, 200);
  }, [statusFilter, updateScrollArrows]);

  return (
    <div className="w-[296px] flex-shrink-0 border-r border-border flex flex-col bg-background overflow-hidden">

      <div className="px-3.5 pt-3 pb-2 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-[7px]">
            <span className="text-[13.5px] font-bold" data-testid="text-inbox-title">Conversas</span>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${wsConnected ? "bg-emerald-500" : "bg-red-500"}`}
              title={wsConnected ? "Conectado em tempo real" : "Reconectando..."}
              data-testid="indicator-ws-status"
            />
          </div>
          <button
            onClick={async () => {
              if (refreshSpinning) return;
              setRefreshSpinning(true);
              try {
                await apiRequest("POST", "/api/conversations/refresh-avatars");
              } catch {}
              await queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
              setTimeout(() => setRefreshSpinning(false), 1200);
            }}
            className={`p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary transition-all ${refreshSpinning ? "pointer-events-none" : ""}`}
            title="Atualizar conversas"
            data-testid="button-refresh-conversations"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 transition-transform duration-500 ${refreshSpinning ? "animate-[spin_0.6s_ease-in-out_infinite] text-primary" : "hover:rotate-45"}`}
            />
          </button>
        </div>

        {conexoesList.length > 0 && (
          <div className="flex items-center gap-1.5 px-0">
          <div className="relative flex-1" data-testid="conexao-dropdown" ref={conexaoDropdownRef}>
            <button
              onClick={() => setConexaoDropdownOpen(!conexaoDropdownOpen)}
              className="w-full flex items-center justify-between px-2.5 py-[5px] rounded-lg border border-border hover:border-primary/30 transition-colors bg-background text-[11.5px]"
              data-testid="button-conexao-dropdown"
            >
              <div className="flex items-center gap-2 min-w-0">
                {(() => {
                  if (!conexaoFilter) {
                    return <span className="font-bold truncate">Todas as conexões</span>;
                  }
                  const sel = conexoesList.find((c: any) => c.id === conexaoFilter);
                  if (!sel) return <span className="text-muted-foreground">Selecione uma conexão</span>;
                  return (
                    <>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sel.status === "connected" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <WhatsAppIcon className="w-3 h-3 flex-shrink-0" />
                      <span className="font-bold truncate">{sel.nome}</span>
                    </>
                  );
                })()}
              </div>
              <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ml-1 ${conexaoDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {conexaoDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setConexaoDropdownOpen(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden" data-testid="conexao-dropdown-list">
                  <button
                    onClick={() => {
                      setConexaoFilter(null);
                      localStorage.removeItem("flowcrm_conexao_filter");
                      setSelectedId(null);
                      setConexaoDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-[11.5px] hover:bg-secondary/60 transition-colors ${
                      !conexaoFilter ? "bg-secondary/40 font-bold" : ""
                    }`}
                    data-testid="dropdown-conexao-all"
                  >
                    <span className="truncate">Todas as conexões</span>
                    {!conexaoFilter && <Check className="w-3 h-3 ml-auto text-primary flex-shrink-0" />}
                  </button>
                  {conexoesList.filter((cx: any) => cx.status === "connected").map((cx: any) => (
                    <button
                      key={cx.id}
                      onClick={() => {
                        setConexaoFilter(cx.id);
                        localStorage.setItem("flowcrm_conexao_filter", cx.id);
                        setSelectedId(null);
                        setConexaoDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-[11.5px] hover:bg-secondary/60 transition-colors ${
                        conexaoFilter === cx.id ? "bg-secondary/40 font-bold" : ""
                      }`}
                      data-testid={`dropdown-conexao-${cx.id}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cx.status === "connected" ? "bg-emerald-400" : "bg-red-400"}`} />
                      <WhatsAppIcon className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{cx.nome}</span>
                      {conexaoFilter === cx.id && <Check className="w-3 h-3 ml-auto text-primary flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Bruno 2026-06-05: modal "Novo atendimento" (substituiu o popup simples). */}
          <NovoAtendimentoModal
            open={newChatOpen}
            onClose={() => setNewChatOpen(false)}
            conexoesList={conexoesList}
            contactsData={contactsData}
            conversations={conversations}
            onStarted={(id) => { if (id != null) setSelectedId(id); }}
          />
          </div>
        )}
      </div>

      {showChannelFilter && setChannelFilter && (() => {
        const waUnread = conversations.filter(c => c.canal?.toLowerCase() === "whatsapp" && (c.unread || 0) > 0 && c.status !== "resolved").reduce((a, c) => a + (c.unread || 0), 0);
        const igUnread = conversations.filter(c => c.canal?.toLowerCase() === "instagram" && (c.unread || 0) > 0 && c.status !== "resolved").reduce((a, c) => a + (c.unread || 0), 0);
        const channels = [
          { key: "whatsapp", label: "WA", color: "#25d366", icon: <WhatsAppIcon className="w-3.5 h-3.5" style={channelFilter === "whatsapp" ? { color: "white" } : {}} />, unread: waUnread },
          { key: "instagram", label: "IG", color: "#e1306c", icon: <InstagramIcon className="w-3.5 h-3.5" style={channelFilter === "instagram" ? { color: "white" } : {}} />, unread: igUnread },
        ];
        return (
          <div className="flex border-b border-border flex-shrink-0">
            {channels.map((ch) => (
              <button
                key={ch.key}
                onClick={() => setChannelFilter(ch.key)}
                className={`flex-1 py-[6px] text-[10px] font-semibold transition-all flex items-center justify-center gap-1 relative ${
                  channelFilter === ch.key
                    ? "text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                style={channelFilter === ch.key ? { background: ch.color || "hsl(var(--primary))" } : {}}
                data-testid={`button-channel-${ch.key}`}
              >
                {ch.icon || ch.label}
                {ch.unread > 0 && (
                  <span
                    className="absolute text-[8px] font-semibold leading-none rounded-full flex items-center justify-center"
                    style={{
                      // Bruno 2026-05-21: era #FED30E hardcoded; agora --primary.
                      background: "hsl(var(--primary))",
                      color: "hsl(var(--primary-foreground))",
                      minWidth: 15, height: 15, padding: "0 4px", top: 2, right: "calc(50% - 18px)",
                    }}
                    data-testid={`badge-unread-${ch.key}`}
                  >
                    {ch.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        );
      })()}

      <div className="border-b border-border flex-shrink-0 relative">
        {canScrollLeft && (
          <button
            onClick={() => tabScrollRef.current?.scrollBy({ left: -90, behavior: "smooth" })}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-6 bg-gradient-to-r from-card via-card/95 to-transparent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Rolar abas para esquerda"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => tabScrollRef.current?.scrollBy({ left: 90, behavior: "smooth" })}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-6 bg-gradient-to-l from-card via-card/95 to-transparent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Rolar abas para direita"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        <div
          ref={tabScrollRef}
          className="flex overflow-x-auto scrollbar-none scroll-smooth"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none", scrollPaddingInline: "32px" }}
        >
          {(() => {
            const baseForCounts = conversations.filter((c) => {
              const cxId = (c as any).conexaoId;
              const canalLower = c.canal.toLowerCase();
              const isWa = canalLower === "whatsapp" || canalLower === "whatsapp_official";
              let passConexao = true;
              if (conexaoFilter) {
                if (conexaoFilter.startsWith("meta_official_")) {
                  passConexao = canalLower === "whatsapp_official";
                } else {
                  passConexao = cxId === conexaoFilter;
                }
              }
              const passChannel = !channelFilter || (channelFilter === "whatsapp" ? isWa : canalLower === channelFilter);
              return passConexao && passChannel;
            });
            const nonResolved = baseForCounts.filter((c) => c.status !== "resolved");
            // Fila tem prioridade — se está em fila, NÃO conta em automação
            const filaCount = nonResolved.filter((c) => {
              const isAiPaused = (c as any).aiPaused === true;
              const auid = (c as any).assignedUserId;
              const pEtapa = (c as any).pipelineEtapa || "";
              const tags: string[] = (c as any).tags || [];
              return (isAiPaused || pEtapa.includes("atendimento_humano") || tags.includes("AH")) && !auid;
            }).length;
            const autoCount = nonResolved.filter((c) => {
              const isAiPaused = (c as any).aiPaused === true;
              const auid = (c as any).assignedUserId;
              const aname = (c as any).assignedUserName || "";
              const pEtapa = (c as any).pipelineEtapa || "";
              const tags: string[] = (c as any).tags || [];
              const isInQueue = (isAiPaused || pEtapa.includes("atendimento_humano") || tags.includes("AH")) && !auid;
              if (isInQueue) return false;
              return (!isAiPaused && !auid) || aname === "Agente Banana ISP";
            }).length;
            const openCount = nonResolved.filter((c) => {
              const isPendente = (c as any).pendente === true;
              const isAiPaused = (c as any).aiPaused === true;
              const auid = (c as any).assignedUserId;
              const aname = (c as any).assignedUserName || "";
              const pEtapa = (c as any).pipelineEtapa || "";
              const tags: string[] = (c as any).tags || [];
              const isBotActive = (!isAiPaused && !auid) || aname === "Agente Banana ISP";
              const isInQueue = (isAiPaused || pEtapa.includes("atendimento_humano") || tags.includes("AH")) && !auid;
              return !isPendente && !!auid && !isBotActive && !isInQueue;
            }).length;
            const tabs = [
              { key: "open", label: "Andamento", count: openCount },
              { key: "fila", label: "Em Fila", count: filaCount },
              { key: "automacao", label: "Automação", count: autoCount },
            ];
            return (
              <LayoutGroup id="inbox-tabs-pill">
                <div className="flex-1 flex items-center gap-0.5 p-0.5 rounded-full bg-muted/70 border border-border/60 mx-2 my-1.5">
                  {tabs.map((s) => {
                    const isActive = statusFilter === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => setStatusFilter(s.key)}
                        className={`relative flex-1 justify-center px-2 py-1 rounded-full text-[10.5px] font-semibold flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card whitespace-nowrap ${
                          isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                        data-testid={`button-filter-${s.key}`}
                        aria-pressed={isActive}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="inbox-tabs-view-pill"
                            className="absolute inset-0 rounded-full bg-primary shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.55)]"
                            transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          />
                        )}
                        <span className="relative z-10">{s.label}</span>
                        {s.count > 0 && (
                          <span
                            className={`relative z-10 inline-flex items-center justify-center min-w-[18px] h-[16px] px-1.5 rounded-full text-[9px] font-bold ${
                              isActive
                                ? "bg-primary-foreground/20 text-primary-foreground"
                                : s.key === "fila"
                                  ? "bg-orange-500/20 text-orange-600"
                                  : s.key === "automacao"
                                    ? "bg-primary/15 text-primary"
                                    : "bg-background text-muted-foreground"
                            }`}
                          >
                            <AnimatedCount value={s.count} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            );
          })()}
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome, número ou mensagem..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-[11px] focus:outline-none focus:border-primary/50"
              data-testid="input-search-conversations"
            />
          </div>
          {/* Bruno 2026-06-05: botão "+" (Novo chat) movido pra cá, à direita do
              campo de busca. Dispara o mesmo newChatOpen (popup fixed acima). */}
          {conexoesList.length > 0 && (
            <button
              type="button"
              className="gradient-accent text-white w-[30px] h-[30px] rounded-lg text-[15px] font-bold flex items-center justify-center flex-shrink-0 leading-none"
              title="Novo chat"
              onClick={() => { setNewChatOpen(!newChatOpen); setNewChatSearch(""); }}
              data-testid="button-new-conversation"
            >+</button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-0">
          {filtered.map((c) => {
            const conv = c as ConvExtended;
            const isSelected = selectedId === conv.id;
            const cc = channelColor(conv.canal);
            const hasPriority = conv.prioridade === "alta" && conv.status !== "resolved";
            // Team/agent pre-computed to know if Row 2 will render
            const _assignedName = (conv as any).assignedUserName || "";
            const _isBotActive = _assignedName === "Agente Banana ISP" || (!(conv as any).aiPaused && !(conv as any).assignedUserId);
            const _setor = deriveSetor(conv);
            const hasRow2 = _isBotActive || _assignedName || !!_setor;
            // Tempo da ÚLTIMA MENSAGEM (formato estável estilo WhatsApp).
            // Bruno (2026-05-17): tirado o cronômetro com segundos do card —
            // a contagem ao vivo do ATENDIMENTO ATUAL é mostrada no header do
            // chat (LiveDuration). Aqui é só "quando foi a última msg".
            // Prioriza lastCustomerMessageAt (interação real) sobre updatedAt
            // (que muda por claim, status, prioridade — não reflete msg).
            const tempoStr = formatLastMessageTime(
              (conv as any).lastCustomerMessageAt || conv.updatedAt
            );
            return (
              <div
                key={conv.id}
                className={`relative pl-3 pr-1 py-2 border-b border-border/70 cursor-pointer transition-all duration-150 ${
                  isSelected
                    ? "border-l-[3px] border-l-primary"
                    : (conv as any).pendente
                      ? "border-l-[3px] border-l-transparent hover:bg-primary/[0.06] dark:hover:bg-white/[0.04]"
                      : "hover:bg-primary/[0.06] dark:hover:bg-white/[0.04] border-l-[3px] border-l-transparent"
                }`}
                style={{
                  ...(isSelected
                    ? { background: "var(--banana-soft-fade)" }
                    : {}),
                  ...((conv as any).pendente && !isSelected ? { background: "var(--conv-pendente-bg)" } : {}),
                }}
                onClick={() => { setSelectedId(conv.id); setChatMode("cliente"); }}
                data-testid={`card-conversation-${conv.id}`}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "stretch" }}>
                    {/* LEFT CELL: stacks avatar row + full-width team/agent row */}
                    <div className="flex flex-col min-w-0 overflow-hidden">
                      {/* Row 1: avatar (with channel badge overlay) + name/message */}
                      <div className="flex gap-2 items-start min-w-0">
                        <div className="relative flex-shrink-0">
                          <ContactAvatar
                            nome={conv.nome}
                            fotoUrl={conv.avatar || (conv.telefone ? (contactAvatarByPhone[String(conv.telefone).replace(/\D/g, "")] ?? null) : null)}
                            size={36}
                            rounded="50%"
                          />
                          {/* Channel badge — only for non-default channels (Instagram) */}
                          {conv.canal?.toLowerCase() === "instagram" && (
                            <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center w-[14px] h-[14px] rounded-full bg-pink-500 shadow-sm" data-testid={`badge-channel-${conv.id}`}>
                              <InstagramIcon className="w-2 h-2 text-white" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 overflow-hidden flex-1">
                          <div className="flex justify-between items-center mb-[2px]">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="font-display text-[13.5px] font-semibold tracking-tight leading-tight truncate text-foreground">
                                {sanitizeDisplayName(conv.nome) || conv.telefone || "Cliente"}
                              </span>
                              {hasPriority && (
                                <span className="flex-shrink-0" data-testid={`indicator-priority-${conv.id}`}>
                                  <span className="w-[5px] h-[5px] rounded-full bg-red-500 inline-block" />
                                </span>
                              )}
                              {/* Bruno 2026-05-29: badge SIMULAÇÃO — conversa de
                                  teste live do agente (rota /api/isp/agent/simulate-live).
                                  Não vai pelo WhatsApp/Meta/etc. Cor roxa pra destacar. */}
                              {((conv as any).isSimulation === true || (conv as any).is_simulation === true) && (
                                <span
                                  className="flex-shrink-0 inline-flex items-center px-1.5 py-[1px] rounded-full text-[8.5px] font-bold bg-purple-500/20 text-purple-600 border border-purple-500/40"
                                  data-testid={`badge-simulation-${conv.id}`}
                                  title="🧪 Simulação — conversa de teste do agente (sem envio real)"
                                >
                                  🧪 SIM
                                </span>
                              )}
                            </div>
                            {/* Bruno 2026-05-22: horário SEMPRE visível ao lado do
                                nome (estilo WhatsApp). Antes ficava escondido
                                quando conv tinha chip de setor (hasRow2=true) e
                                aparecia em text-[9px] dentro da Row 2 — ilegível.
                                Agora é fixo aqui, tabular-nums pra alinhar coluna. */}
                            {tempoStr && (
                              <span className="text-[11px] text-muted-foreground flex-shrink-0 ml-2 leading-tight tabular-nums" data-testid={`conv-time-${conv.id}`}>
                                {tempoStr}
                              </span>
                            )}
                          </div>
                          {(() => {
                            // Bruno 2026-05-20: última msg do cliente fica em destaque
                            // (negrito + cor mais forte), padrão WhatsApp. Quando a
                            // última foi do atendente/bot, mostra "Você: " prefix em
                            // muted pra dar pista clara de direção sem pesar visual.
                            const lastDir = (conv as any).lastMessageDirection;
                            const isCustomerLast = lastDir === "in";
                            const hasUnread = (conv.unread || 0) > 0 && conv.status !== "resolved";
                            const emphasize = isCustomerLast && hasUnread;
                            const previewCls = emphasize
                              ? "text-[12px] text-foreground font-semibold truncate leading-tight mt-0.5"
                              : isCustomerLast
                                ? "text-[12px] text-foreground/85 font-medium truncate leading-tight mt-0.5"
                                : "text-[12px] text-muted-foreground truncate leading-tight mt-0.5";
                            return (
                              <div className={previewCls} data-testid={`preview-${conv.id}`}>
                                {lastDir === "out" && conv.ultimaMensagem && !isMediaPlaceholder(conv.ultimaMensagem) && (
                                  <span className="text-muted-foreground/70 font-normal">Você: </span>
                                )}
                                {conv.ultimaMensagem ? renderMessagePreview(conv.ultimaMensagem) : "Sem mensagens"}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Row 2: chip único "SETOR/Firstname" + tempo. Mesmo padrão
                          do card do painel (atendimentos.tsx:1149) — antes setor,
                          team e atendente vinham em pílulas separadas e o nome
                          da equipe duplicava o setor ("COMERCIAL Comercial"). */}
                      {hasRow2 && (() => {
                        const firstName = (() => {
                          const n = (_assignedName || "").toString().trim();
                          if (!n || n === "Agente Banana ISP") return "";
                          return n.split(/\s+/)[0];
                        })();
                        const isBananaAgentName = _assignedName === "Agente Banana ISP";
                        const showBotPill = _isBotActive && (!_assignedName || isBananaAgentName);
                        const labelUpper = (_setor?.label || "").toUpperCase();
                        return (
                          <div className="flex items-center gap-1 w-full mt-[3px] pt-[3px] border-t border-border/30 min-w-0" data-testid={`badge-assigned-${conv.id}`}>
                            {_setor && (
                              // Bruno 2026-05-23: minimalista + cor do tema. Não
                              // diferencia mais setor por cor (antes amber/blue/green/red);
                              // usa --primary do tenant pra consistência visual.
                              <span
                                // Bruno 2026-06-14: descrição do setor em PRETO (text-foreground,
                                // adapta claro/escuro); o pontinho segue na cor do tema como marcador.
                                className="flex-shrink-0 inline-flex items-center gap-[3px] text-[9px] font-medium leading-none text-foreground"
                                title={firstName ? `Setor ${labelUpper} — atendido por ${_assignedName}` : `Setor: ${labelUpper}`}
                                data-testid={`badge-setor-${conv.id}`}
                              >
                                <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 bg-primary" aria-hidden />
                                <span className="truncate">{_setor.label}{firstName ? ` · ${firstName}` : ""}</span>
                              </span>
                            )}
                            {showBotPill ? (
                              <span
                                className="inline-flex items-center gap-1 text-[9px] font-semibold text-muted-foreground min-w-0"
                                data-testid={`badge-bot-${conv.id}`}
                              >
                                <Bot className="w-3 h-3 text-primary flex-shrink-0" />
                                <span className="truncate">Assistente Norte</span>
                              </span>
                            ) : !_setor && _assignedName && !isBananaAgentName ? (
                              <span className="inline-flex items-center gap-1 text-[9px] font-medium text-muted-foreground min-w-0">
                                <User className="w-[9px] h-[9px] flex-shrink-0" />
                                <span className="truncate">{_assignedName}</span>
                              </span>
                            ) : null}
                            {/* Bruno 2026-05-22: tempo removido daqui — agora vive
                                no canto superior direito da Row 1 ao lado do nome,
                                em tamanho legível (text-[11px]). */}
                          </div>
                        );
                      })()}

                    </div>

                    {/* Bruno 2026-05-19: divisória vertical removida — card
                        agora fica "inteiro", sem split visual. Badge unread +
                        reopen mantidos integrados na coluna direita. */}
                    <div className="flex flex-col items-center justify-center gap-1.5 w-[22px] ml-1">
                      {conv.unread > 0 && conv.status !== "resolved" && (
                        <span
                          className="text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 unread-pulse"
                          style={{
                            // Bruno 2026-05-21: era banana-500/700 hardcoded.
                            // Agora segue --primary do tema (banana/lilac/blue/orange/mono).
                            background: "hsl(var(--primary))",
                            color: "hsl(var(--primary-foreground))",
                            border: "1px solid color-mix(in oklch, hsl(var(--primary)) 75%, black)",
                          }}
                          data-testid={`badge-unread-${conv.id}`}
                        >
                          {conv.unread}
                        </span>
                      )}
                      {/* Bruno 2026-05-19: ações de resolver + apagar removidas
                          do card. Resolver agora é feito pelo botão no header do
                          chat (CircleX vermelho). Apagar conversa não tem mais
                          ação rápida — operação destrutiva que vivia mal num
                          card de lista. */}
                      {statusFilter === "resolved" && (
                        <button
                          className="w-5 h-5 rounded flex items-center justify-center text-tertiary-500 hover:text-tertiary-600 hover:bg-tertiary-500/10 transition-colors"
                          onClick={(e) => { e.stopPropagation(); reopenMutation.mutate(conv.id); }}
                          title="Reabrir conversa"
                          data-testid={`button-reopen-conv-${conv.id}`}
                          disabled={reopenMutation.isPending}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <EmptyState icon="💬" title="Nenhuma conversa ainda" description="Quando clientes enviarem mensagens pelo WhatsApp ou Instagram, elas aparecerão aqui." />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
