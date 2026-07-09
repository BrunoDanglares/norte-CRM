import { useState, useEffect, useMemo, useCallback, useRef, type ComponentType, type SVGProps } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useSoundAlerts } from "@/hooks/useSoundAlerts";
import {
  Search, BarChart3, ChevronDown, ChevronLeft, ChevronRight, X, MessageSquare, Bot, Clock, Check,
  RefreshCw, Inbox, ArrowUpRight, RotateCw, Loader2, CheckCircle2, Bell, BellOff, ArrowLeftRight,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import ContactAvatar from "@/components/ContactAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { CanalIcon } from "@/components/brand-icons";
import { getInitials, sanitizeDisplayName } from "@/lib/constants";
import { agentColor, channelColor } from "@/components/inbox/helpers";
import { SITUATION_LABELS, getSituationTagColor } from "@/lib/situation-tags";
import { renderMessagePreview, isMediaPlaceholder } from "@/components/inbox/MessagePreview";
import { ConversaDrawer } from "@/components/central/ConversaDrawer";
import ResolveDialog from "@/components/inbox/ResolveDialog";
import { useToast } from "@/hooks/use-toast";
import { useUrlState } from "@/hooks/useUrlState";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Conversation } from "@shared/schema";

type View = "ativos" | "encerrados";
type Tone = "primary" | "warning" | "info";
type Bucket = "automacao" | "fila" | "open" | "resolved" | "other";

function formatShortTime(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Horário estilo WhatsApp: hoje → "HH:mm", ontem → "Ontem",
// últimos 7 dias → dia da semana abreviado, mais antigo → "dd/mm/yyyy".
function formatWhatsAppTime(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDay) / 86400000);
  if (dayDiff <= 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 1) return "Ontem";
  if (dayDiff < 7) {
    return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").replace(/^\w/, c => c.toUpperCase());
  }
  return d.toLocaleDateString("pt-BR");
}

// Bruno 2026-05-21: as 3 colunas eram cromaticamente distintas (primary/
// orange/sky) — virou arco-íris quando o tenant escolheu outra paleta.
// Redesign Norte (2026-07): cabeçalho de coluna agora é NEUTRO (ícone em
// quadradinho bg-base-200) + contador em badge soft primary; a distinção fica
// por ícone + título + helper. A `tone` continua na assinatura por compat.
function classifyConv(c: any): Bucket {
  if (c.status === "resolved") return "resolved";
  const auid = c.assignedUserId;
  // Bruno 2026-05-19: REGRA ABSOLUTA — atendente atribuído sempre = Em Andamento.
  // Não importa pipelineEtapa, aiPaused, tag AH, nada. Atribuído precede tudo.
  // Antes a regra tinha um caso especial (assignedUserName='Agente Banana ISP'
  // forçava "automacao" mesmo com auid setado) — quebrava a regra de produto
  // e gerava cards "fantasma" no painel. Cosmético do nome não afeta bucket.
  if (auid) return "open";
  const isAiPaused = c.aiPaused === true;
  const pEtapa = c.pipelineEtapa || "";
  const tags: string[] = c.tags || [];
  // Bruno 2026-05-21: REGRA ABSOLUTA — "Em Fila" é EXCLUSIVAMENTE conversa
  // escalada pra humano (sem atendente). Bot operando = "Em Automação", mesmo
  // que tenha assignedTeamId. O bot atribui equipe via reassignOnSectorChange
  // do suportePipelineService quando o lead muda de pipeline (S9 OS aberta, S8
  // etc.), mas isso NÃO é handoff humano — só agrupamento de Kanban.
  // Os 3 sinais abaixo são todos disparados pelo handoff humano real:
  //   - aiPaused=true: setado em /transfer-team, FALAR_HUMANO, CPF 3x, etc.
  //   - pipelineEtapa "atendimento_humano_*": setado por onEscalateToHumano
  //   - tag AH: aplicada por finalizeHumanHandoff
  // /transfer-team seta os 3 — não precisamos de hasTeamWithoutUser como reforço.
  const isInQueue = isAiPaused
    || pEtapa.includes("atendimento_humano")
    || tags.includes("AH");
  if (isInQueue) return "fila";
  // Sem atendente humano e sem sinal de handoff → bot ativo
  return "automacao";
}

export default function Atendimentos() {
  const [, navigate] = useLocation();
  const [view, setView] = useUrlState<View>("view", "ativos", ["ativos", "encerrados"] as const);
  const [search, setSearch] = useState("");
  const [selectedCanais, setSelectedCanais] = useState<string[]>([]);
  const [selectedAtendentes, setSelectedAtendentes] = useState<string[]>([]);
  const [selectedDeptos, setSelectedDeptos] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [drawerConvId, setDrawerConvId] = useState<number | null>(null);
  const [openFilter, setOpenFilter] = useState<"canais" | "atendentes" | "deptos" | "tags" | null>(null);

  const { data: conversations = [], isRefetching, isLoading: convsLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  // Bruno 2026-05-21: invalida convs E mapa de tags em qualquer mudança.
  // O event `situation_tag_applied` é a fonte primária mas tem dois cantos:
  // (a) tag já existente em CST não re-broadcasta (dedup no situationTagService:340),
  // (b) timing de mount do WS pode perder eventos prévios.
  // Plugando o invalidate do mapa em new_message/conversation_updated
  // garante que o card pega tags acumuladas mesmo nesses casos —
  // o mapa é leve (1 SELECT no workspace) e refetch é barato.
  const invalidateConvsAndTags = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    queryClient.invalidateQueries({ queryKey: ["/api/conversations/situation-tags-map"], exact: true });
  }, []);
  useWebSocket({
    new_message: invalidateConvsAndTags,
    conversation_updated: invalidateConvsAndTags,
    conversation_removed: invalidateConvsAndTags,
    situation_tag_applied: invalidateConvsAndTags,
  });

  // ── Alertas sonoros ──────────────────────────────────────────────────────
  // Bruno 2026-05-19: detecta 2 transições via diff de buckets no cache de
  // conversations — não cria handler WS novo (o useWebSocket acima já invalida
  // a query e re-renderiza). A cada novo snapshot da lista, compara contra o
  // mapa anterior:
  //   - Conv que NÃO existia antes E é a primeira inbound → "newConversation"
  //   - Conv que estava em outro bucket E foi pra "fila" → "queueHandoff"
  // O primeiro carregamento (mapa vazio antes) NÃO toca som — evita beep
  // pra cada conv já existente quando o atendente abre a página.
  const soundAlerts = useSoundAlerts();
  const prevBucketsRef = useRef<Map<number, Bucket>>(new Map());
  useEffect(() => {
    const next = new Map<number, Bucket>();
    for (const c of conversations) {
      next.set(c.id, classifyConv(c as any));
    }
    const isFirstLoad = prevBucketsRef.current.size === 0;
    if (!isFirstLoad) {
      for (const [id, bucket] of next) {
        const prev = prevBucketsRef.current.get(id);
        if (prev === undefined) {
          // Conv totalmente nova nesta lista — primeira inbound
          soundAlerts.play("newConversation");
        } else if (prev !== "fila" && bucket === "fila") {
          // Transição pra fila (bot escalou humano OU atendente liberou)
          soundAlerts.play("queueHandoff");
        }
      }
    }
    prevBucketsRef.current = next;
  }, [conversations, soundAlerts]);

  const { data: usuariosData } = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/usuarios"] });
  const usuariosList = usuariosData?.data || [];
  const { data: equipesData } = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/equipes"] });
  const equipesList = equipesData?.data || [];
  const { data: conexoesData } = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/conexoes"] });
  const conexoesList = conexoesData?.data || [];
  // Canais oficiais Meta + Instagram não passam por /api/conexoes — têm rotas
  // próprias. Buscamos paralelo pra incluí-los no filtro de "Canais" quando
  // conectados, mesmo padrão da página Conexões (sidebar).
  const { data: woficialData } = useQuery<{ connected: boolean; data?: { numero?: string; phoneNumber?: string } }>({
    queryKey: ["/api/whatsapp-official/connection"],
  });
  const { data: igStatus } = useQuery<{ connected: boolean; username?: string }>({
    queryKey: ["/api/instagram/status"],
  });
  // Dados pro ResolveDialog (mesmas queries do inbox.tsx)
  const { data: leadTagsData } = useQuery<any[]>({ queryKey: ["/api/lead-tags"] });
  const availableTags = leadTagsData || [];
  const { data: pipelinesData } = useQuery<any[]>({ queryKey: ["/api/pipelines"], staleTime: 60000 });
  const { data: pipelineStagesData } = useQuery<any[]>({ queryKey: ["/api/pipeline-stages"], staleTime: 60000 });
  const { data: leadsData } = useQuery<any[]>({ queryKey: ["/api/leads"], staleTime: 15000 });
  const [resolveDialogConv, setResolveDialogConv] = useState<any>(null);

  const situationTagOptions = useMemo(() => {
    return Object.entries(SITUATION_LABELS).map(([code, label]) => ({
      id: code,
      label: `${code} — ${label}`,
      color: getSituationTagColor(code).color,
    }));
  }, []);
  const { data: contactsData } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  // Bruno 2026-05-21: tags agora vêm agregadas por CONVERSATION_ID. O endpoint
  // antigo (/api/leads/situation-tags) agrupava por telefone — quando o mesmo
  // cliente tinha protocolo antigo (resolvido) + atual (aberto), o card "Em Fila"
  // herdava tags do protocolo anterior. Isolamento por protocolo agora respeitado:
  // cada conv pega só CST live tags da SUA conversa + tags do protocolo MAIS
  // RECENTE da SUA conversa.
  const { data: situationTagsByConv = {} } = useQuery<Record<string, { code: string; slug: string }[]>>({
    queryKey: ["/api/conversations/situation-tags-map"],
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // Bruno 2026-05-21: staleTime 0 garante refetch imediato em invalidate.
    // Sem isso, react-query usa o defaultStaleTime do queryClient (2min) e
    // ignora invalidações que vêm do WS na mesma janela — card fica sem
    // atualizar até passar 2min OU expirar o staleTime.
    staleTime: 0,
  });

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

  const { toast } = useToast();
  const [reopeningId, setReopeningId] = useState<number | null>(null);
  const reopenMutation = useMutation({
    mutationFn: async (convId: number) => {
      setReopeningId(convId);
      return apiRequest("PATCH", `/api/conversations/${convId}/reopen`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      toast({ title: "Conversa reaberta", description: "Voltou para Em andamento." });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao reabrir",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    },
    onSettled: () => setReopeningId(null),
  });

  // Bruno 2026-05-21: helper agora recebe conversationId (não mais telefone).
  // Isolamento por protocolo: cada card mostra SÓ as tags do seu protocolo
  // atual + CST live da conversa. Tags de protocolos resolvidos anteriores do
  // mesmo cliente NÃO aparecem em outras conversas dele.
  const getConvSituationCodes = useCallback((convId: number | string | null | undefined): string[] => {
    if (convId == null) return [];
    const arr = situationTagsByConv[String(convId)];
    if (!arr || !arr.length) return [];
    return Array.from(new Set(arr.map((t) => t.code)));
  }, [situationTagsByConv]);

  const filtered = useMemo(() => {
    const sLower = search.trim().toLowerCase();
    return conversations.filter((c: any) => {
      if (sLower) {
        const matches =
          (c.nome || "").toLowerCase().includes(sLower) ||
          (c.telefone || "").toLowerCase().includes(sLower);
        if (!matches) return false;
      }
      if (selectedCanais.length > 0) {
        const cx = c.conexaoId != null ? String(c.conexaoId) : null;
        const canalLower = (c.canal || "").toLowerCase().trim();
        // Bruno 2026-05-18: detecção de Meta Cloud mais permissiva.
        // Antes só pegava "whatsapp_oficial" / "whatsapp-oficial" / "meta".
        // Conversas legadas podem ter "WhatsApp Oficial" (com espaço), "meta cloud",
        // "official", "wa_official", etc. Match por substring `oficial` / `meta`
        // garante cobertura. Whatsapp via Evolution NÃO bate nessa regex
        // porque vem como "whatsapp" puro + sempre tem conexaoId.
        const isMeta = !cx && (
          canalLower.includes("oficial") ||
          canalLower === "meta" ||
          canalLower.startsWith("meta ") ||
          canalLower.includes("meta cloud") ||
          canalLower.includes("official")
        );
        const isInsta = canalLower === "instagram";
        const matched =
          (cx && selectedCanais.includes(cx)) ||
          (isMeta && selectedCanais.includes("meta")) ||
          (isInsta && selectedCanais.includes("instagram"));
        if (!matched) return false;
      }
      if (selectedAtendentes.length > 0) {
        const auid = c.assignedUserId != null ? String(c.assignedUserId) : null;
        if (!auid || !selectedAtendentes.includes(auid)) return false;
      }
      if (selectedDeptos.length > 0) {
        const teamId = c.assignedTeamId;
        const team = teamId ? equipesList.find((e: any) => e.id === teamId) : null;
        const teamName = team?.nome || (c.agente || "").replace("[Equipe] ", "");
        if (!teamName || !selectedDeptos.includes(teamName)) return false;
      }
      if (selectedTags.length > 0) {
        const situationCodes = getConvSituationCodes(c.id);
        const legacyTags: string[] = c.tags || [];
        const allCodes = [...situationCodes, ...legacyTags];
        const hasAny = allCodes.some((t) => selectedTags.includes(t));
        if (!hasAny) return false;
      }
      return true;
    });
  }, [conversations, search, selectedCanais, selectedAtendentes, selectedDeptos, selectedTags, equipesList, getConvSituationCodes]);

  const classified = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const tNow = startOfToday.getTime();
    const open: any[] = [];
    const fila: any[] = [];
    const automacao: any[] = [];
    const encerradosHoje: any[] = [];
    for (const c of filtered as any[]) {
      const cat = classifyConv(c);
      if (cat === "open") open.push(c);
      else if (cat === "fila") fila.push(c);
      else if (cat === "automacao") automacao.push(c);
      else if (cat === "resolved") {
        const ra = c.resolvedAt;
        if (ra && new Date(ra).getTime() >= tNow) encerradosHoje.push(c);
      }
    }
    return { open, fila, automacao, encerradosHoje };
  }, [filtered]);

  const activeCount = classified.open.length + classified.fila.length + classified.automacao.length;
  const closedCount = classified.encerradosHoje.length;
  const totalToday = activeCount + closedCount;

  const activeFilterCount = selectedCanais.length + selectedAtendentes.length + selectedDeptos.length + selectedTags.length + (search ? 1 : 0);
  const clearAllFilters = () => {
    setSelectedCanais([]); setSelectedAtendentes([]); setSelectedDeptos([]); setSelectedTags([]); setSearch("");
  };

  const departamentos = useMemo(() => {
    const set = new Set<string>();
    equipesList.forEach((e: any) => e?.nome && set.add(e.nome));
    return Array.from(set).sort();
  }, [equipesList]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-base-200" data-testid="atendimentos-page">
      {/* HEADER — z-30 explícito pra dropdowns sobreporem as colunas kanban
          (backdrop-blur cria stacking context, então só elevar o header todo
          garante que os popovers internos fiquem acima do body). */}
      <div className="relative z-30 border-b border-base-200 bg-base-100/80 backdrop-blur-sm flex-shrink-0">
        <div className="px-6 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-field bg-primary/[0.12] flex items-center justify-center flex-shrink-0">
                <Inbox className="w-4 h-4 text-primary" strokeWidth={2.2} />
              </div>
              <div className="leading-tight min-w-0">
                <h1 className="text-[15px] font-semibold tracking-[-0.01em] truncate" data-testid="text-page-title">Painel de Atendimento</h1>
                <p className="text-[11px] text-base-content/55 mt-0.5 tabular-nums">
                  <AnimatedCount value={totalToday} /> conversa{totalToday === 1 ? "" : "s"} hoje · <AnimatedCount value={activeCount} /> ativa{activeCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => soundAlerts.setEnabled(!soundAlerts.enabled)}
                className={`btn btn-circle btn-ghost btn-sm ${
                  soundAlerts.enabled ? "text-primary" : "text-base-content/60"
                }`}
                title={soundAlerts.enabled ? "Alerta sonoro ligado — clique para silenciar" : "Alerta sonoro desligado — clique para ativar"}
                aria-label={soundAlerts.enabled ? "Desligar alerta sonoro" : "Ligar alerta sonoro"}
                aria-pressed={soundAlerts.enabled}
                data-testid="button-toggle-sound-alerts"
              >
                {soundAlerts.enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true })}
                className="btn btn-circle btn-ghost btn-sm text-base-content/60"
                title="Atualizar"
                aria-label="Atualizar lista de conversas"
                data-testid="button-refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 transition-transform ${isRefetching ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => navigate("/relatorios?tab=auditoria")}
                className="btn btn-outline btn-sm gap-1.5 border-base-300 text-base-content/70"
                data-testid="button-visao-analitica"
              >
                <BarChart3 className="w-3.5 h-3.5" /> Visão analítica
                <ArrowUpRight className="w-3 h-3 opacity-60" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ViewToggle
              view={view}
              setView={setView}
              activeCount={activeCount}
              closedCount={closedCount}
            />

            <div className="w-px h-5 bg-base-300 mx-0.5" aria-hidden />

            <FilterPill
              label="Canais"
              count={selectedCanais.length}
              open={openFilter === "canais"}
              setOpen={(b) => setOpenFilter(b ? "canais" : null)}
              items={[
                ...conexoesList
                  .filter((c: any) => c.status === "connected")
                  .map((c: any) => ({ id: String(c.id), label: c.nome || c.numero || "WhatsApp" })),
                ...(woficialData?.connected
                  ? [{ id: "meta", label: woficialData.data?.numero || woficialData.data?.phoneNumber || "WhatsApp Oficial" }]
                  : []),
                ...(igStatus?.connected
                  ? [{ id: "instagram", label: igStatus.username ? `Instagram @${igStatus.username}` : "Instagram" }]
                  : []),
              ]}
              selected={selectedCanais}
              onToggle={(id) => setSelectedCanais((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
              onClear={() => setSelectedCanais([])}
            />
            <FilterPill
              label="Atendentes"
              count={selectedAtendentes.length}
              open={openFilter === "atendentes"}
              setOpen={(b) => setOpenFilter(b ? "atendentes" : null)}
              items={usuariosList
                .filter((u: any) => u.status === "ACTIVE")
                .map((u: any) => ({ id: String(u.id), label: u.nome }))}
              selected={selectedAtendentes}
              onToggle={(id) => setSelectedAtendentes((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
              onClear={() => setSelectedAtendentes([])}
            />
            <FilterPill
              label="Departamentos"
              count={selectedDeptos.length}
              open={openFilter === "deptos"}
              setOpen={(b) => setOpenFilter(b ? "deptos" : null)}
              items={departamentos.map((d) => ({ id: d, label: d }))}
              selected={selectedDeptos}
              onToggle={(id) => setSelectedDeptos((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
              onClear={() => setSelectedDeptos([])}
            />
            <FilterPill
              label="Tags de situação"
              count={selectedTags.length}
              open={openFilter === "tags"}
              setOpen={(b) => setOpenFilter(b ? "tags" : null)}
              items={situationTagOptions}
              selected={selectedTags}
              onToggle={(id) => setSelectedTags((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
              onClear={() => setSelectedTags([])}
              searchable
            />

            <div className="relative ml-auto w-[260px] group">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/50 group-focus-within:text-primary transition-colors" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone…"
                className="w-full pl-8 pr-8 py-1.5 rounded-field border border-base-300 bg-base-100 text-[11.5px] placeholder:text-base-content/50 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all"
                data-testid="input-search-atendimentos"
                aria-label="Buscar atendimentos"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-base-200 text-base-content/60 hover:text-base-content transition-colors"
                  aria-label="Limpar busca"
                  data-testid="button-clear-search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <AnimatePresence>
              {activeFilterCount > 0 && (
                <motion.button
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.16 }}
                  onClick={clearAllFilters}
                  className="text-[10.5px] text-base-content/60 hover:text-base-content flex items-center gap-1 px-2 py-1 rounded-full hover:bg-base-200 transition-colors"
                  data-testid="button-clear-filters"
                >
                  <X className="w-3 h-3" /> Limpar filtros
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* BODY (z-0 explícito pra ficar abaixo do header z-30 e seus dropdowns) */}
      <div className="relative z-0 flex-1 min-h-0 overflow-hidden p-4 md:p-5">
        <AnimatePresence mode="wait" initial={false}>
          {view === "ativos" ? (
            <motion.div
              key="ativos"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="flex gap-4 h-full min-h-0 overflow-x-auto"
            >
              <KanbanColumn
                title="Em andamento"
                hint="Atendentes humanos cuidando agora"
                icon={MessageSquare}
                tone="primary"
                cards={classified.open}
                onOpenCard={setDrawerConvId}
                onResolveCard={setResolveDialogConv}
                contactAvatarByPhone={contactAvatarByPhone}
                getConvSituationCodes={getConvSituationCodes}
                isLoading={convsLoading}
                emptyTitle="Tudo no controle"
                emptyHint="Quando um atendente assumir uma conversa, ela aparece aqui."
                bucket="open"
              />
              <KanbanColumn
                title="Em Fila"
                hint="Aguardando alguém pegar"
                icon={Clock}
                tone="warning"
                cards={classified.fila}
                onOpenCard={setDrawerConvId}
                contactAvatarByPhone={contactAvatarByPhone}
                getConvSituationCodes={getConvSituationCodes}
                isLoading={convsLoading}
                emptyTitle="Fila zerada"
                emptyHint="Nenhuma conversa aguardando atendente humano."
                bucket="fila"
              />
              <KanbanColumn
                title="Em Automação"
                hint="Assistente Norte no controle"
                icon={Bot}
                tone="info"
                cards={classified.automacao}
                onOpenCard={setDrawerConvId}
                contactAvatarByPhone={contactAvatarByPhone}
                getConvSituationCodes={getConvSituationCodes}
                isLoading={convsLoading}
                emptyTitle="Agente offline"
                emptyHint="Nenhuma conversa rolando com o Assistente Norte agora."
                bucket="automacao"
                emptyMascotPose="sleep"
              />
            </motion.div>
          ) : (
            <motion.div
              key="encerrados"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="h-full overflow-y-auto pr-1"
            >
              <EncerradosGrid
                cards={classified.encerradosHoje}
                onOpenCard={setDrawerConvId}
                contactAvatarByPhone={contactAvatarByPhone}
                getConvSituationCodes={getConvSituationCodes}
                onReopen={(id) => reopenMutation.mutate(id)}
                reopeningId={reopeningId}
                isLoading={convsLoading}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConversaDrawer convId={drawerConvId} onClose={() => setDrawerConvId(null)} />

      {resolveDialogConv && (() => {
        // Mesma lógica de inbox.tsx pra preencher conv.pipeline antes do dialog
        const pipelineFromTeam = resolveDialogConv.assignedTeamId
          ? equipesList.find((e: any) => e.id === resolveDialogConv.assignedTeamId)?.pipelineKey
          : null;
        const matchedLeadR = (leadsData || []).find((l: any) =>
          l.telefone && resolveDialogConv.telefone &&
          l.telefone.replace(/\D/g, "").slice(-10) === resolveDialogConv.telefone.replace(/\D/g, "").slice(-10) &&
          resolveDialogConv.telefone.replace(/\D/g, "").length >= 8
        );
        const pipelineFromLead = matchedLeadR?.pipeline || null;
        const resolvedConv = {
          ...resolveDialogConv,
          pipeline: resolveDialogConv.pipeline || pipelineFromTeam || pipelineFromLead || null,
        };
        return (
          <ResolveDialog
            conv={resolvedConv}
            onClose={() => setResolveDialogConv(null)}
            availableTags={availableTags as any}
            equipesList={equipesList}
            pipelinesData={pipelinesData}
            pipelineStagesData={pipelineStagesData}
          />
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AnimatedCount — número que faz "popLayout" toda vez que o valor muda. Usado
// nos contadores das pills do header e nas colunas. Sem CLS porque a largura
// é fixa pelo tabular-nums.
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

// ─────────────────────────────────────────────────────────────────────────────
function ViewToggle({
  view, setView, activeCount, closedCount,
}: {
  view: View;
  setView: (v: View) => void;
  activeCount: number;
  closedCount: number;
}) {
  const opts: { key: View; label: string; count: number }[] = [
    { key: "ativos", label: "Todos atendimentos", count: activeCount },
    { key: "encerrados", label: "Encerrados hoje", count: closedCount },
  ];
  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Filtro de atendimentos">
      {opts.map((o) => {
        const isActive = view === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setView(o.key)}
            className={`seg-tab text-[11.5px] ${isActive ? "seg-tab-active" : ""}`}
            data-testid={`tab-${o.key}`}
            aria-pressed={isActive}
          >
            <span>{o.label}</span>
            <span
              className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold ${
                isActive ? "bg-primary-content/20 text-primary-content" : "bg-base-200 text-base-content/60"
              }`}
            >
              <AnimatedCount value={o.count} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function FilterPill({
  label, count, open, setOpen, items, selected, onToggle, onClear, searchable = false,
}: {
  label: string;
  count: number;
  open: boolean;
  setOpen: (b: boolean) => void;
  items: { id: string; label: string; color?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const visibleItems = useMemo(() => {
    if (!searchable || !q.trim()) return items;
    const needle = q.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(needle));
  }, [items, q, searchable]);
  const prefersReducedMotion = useReducedMotion();
  const pillRef = useRef<HTMLDivElement>(null);
  // setOpen é uma arrow nova a cada render do pai — guarda a última via ref pra
  // o efeito assinar só quando `open` muda (não a cada render).
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  // Recolhe ao clicar/tocar FORA (qualquer lugar da tela) ou apertar Esc.
  // Listener no document é robusto a ancestrais com transform (Framer Motion /
  // PageShell), que quebram o backdrop position:fixed e por isso não fechava.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) setOpenRef.current(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenRef.current(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={pillRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`btn btn-sm btn-outline gap-1.5 font-medium ${
          count > 0
            ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary/60"
            : "border-base-300 text-base-content/70"
        }`}
        data-testid={`button-filter-${label.toLowerCase().replace(/\s+/g, "-")}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {label}
        {count > 0 && (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-content text-[9px] font-bold tabular-nums"
          >
            {count}
          </motion.span>
        )}
        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
              className="absolute left-0 z-40 mt-1.5 min-w-[240px] max-w-[300px] bg-base-100 border border-base-300 rounded-box shadow-xl overflow-hidden origin-top-left"
              role="listbox"
              aria-label={label}
            >
              {searchable && (
                <div className="px-2.5 py-2 border-b border-base-200 bg-base-200/40">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-base-content/50" />
                    <input
                      type="text"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Buscar…"
                      autoFocus
                      className="w-full pl-7 pr-2 py-1 rounded-field bg-base-100 border border-base-300 text-[10.5px] focus:outline-none focus:border-primary/40"
                    />
                  </div>
                </div>
              )}
              <div className="max-h-[300px] overflow-y-auto py-1">
                {visibleItems.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-base-content/60 text-center">
                    {searchable && q ? "Nada encontrado" : "Sem opções"}
                  </div>
                ) : (
                  <>
                    {count > 0 && (
                      <button
                        onClick={() => { onClear(); }}
                        className="w-full text-left px-3 py-1.5 text-[10.5px] text-base-content/60 hover:bg-base-200 flex items-center gap-1.5 border-b border-base-200 transition-colors"
                      >
                        <X className="w-3 h-3" /> Limpar seleção
                      </button>
                    )}
                    {visibleItems.map((item) => {
                      const isSelected = selected.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => onToggle(item.id)}
                          role="option"
                          aria-selected={isSelected}
                          className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                            isSelected ? "bg-primary/[0.08] text-base-content" : "hover:bg-base-200 text-base-content"
                          }`}
                        >
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected ? "border-primary bg-primary" : "border-base-content/30 group-hover:border-base-content/50"
                          }`}>
                            {isSelected && (
                              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                                <Check className="w-2.5 h-2.5 text-primary-content" strokeWidth={3} />
                              </motion.span>
                            )}
                          </div>
                          {item.color && (
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-black/[0.06]"
                              style={{ background: item.color }}
                            />
                          )}
                          <span className="flex-1 truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function KanbanColumn({
  title, hint, icon: Icon, tone, cards, onOpenCard, onResolveCard, contactAvatarByPhone,
  getConvSituationCodes, isLoading = false, emptyTitle, emptyHint, bucket, emptyMascotPose,
}: {
  title: string;
  hint: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: Tone;
  cards: any[];
  onOpenCard: (id: number) => void;
  onResolveCard?: (conv: any) => void;
  contactAvatarByPhone: Record<string, string | null>;
  getConvSituationCodes: (convId: number | string | null | undefined) => string[];
  isLoading?: boolean;
  emptyTitle: string;
  emptyHint: string;
  bucket?: Bucket;
  emptyMascotPose?: "wave" | "neutral" | "celebrate" | "sleep";
}) {
  const prefersReducedMotion = useReducedMotion();
  const showSkeleton = isLoading && cards.length === 0;

  return (
    <div className="relative flex flex-col flex-1 min-w-[270px] bg-base-100 border border-base-200 rounded-box overflow-hidden min-h-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-12" aria-hidden />
      <div className="relative px-3.5 py-2.5 border-b border-base-200 bg-base-100 flex-shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-8 rounded-field bg-base-200 text-base-content/70 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <div className="leading-tight min-w-0">
            <h3 className="text-[12px] font-semibold tracking-tight truncate">{title}</h3>
            <p className="text-[9.5px] text-base-content/55 truncate">{hint}</p>
          </div>
        </div>
        <span className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary">
          {showSkeleton ? "—" : <AnimatedCount value={cards.length} />}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1.5">
        {showSkeleton ? (
          Array.from({ length: 4 }).map((_, i) => <ConvCardSkeleton key={`sk-${i}`} />)
        ) : cards.length === 0 ? (
          <EmptyState icon={Icon} title={emptyTitle} hint={emptyHint} mascotPose={emptyMascotPose} />
        ) : (
          <AnimatePresence initial={false}>
            {cards.map((c, idx) => (
              <motion.div
                key={c.id}
                layout
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6, scale: 0.99 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.97 }}
                transition={
                  prefersReducedMotion
                    ? undefined
                    : { duration: 0.22, delay: Math.min(idx * 0.025, 0.3), ease: [0.4, 0, 0.2, 1] }
                }
              >
                <ConvCard
                  conv={c}
                  onClick={() => onOpenCard(c.id)}
                  contactAvatarByPhone={contactAvatarByPhone}
                  situationCodes={getConvSituationCodes(c.id)}
                  bucket={bucket}
                  onResolve={onResolveCard ? () => onResolveCard(c) : undefined}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ConvCardSkeleton() {
  return (
    <div className="bg-base-100 border border-base-200 rounded-box p-2.5">
      <div className="flex items-start gap-2.5">
        <Skeleton className="w-9 h-9 rounded-[10px]" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-8" />
          </div>
          <Skeleton className="h-2.5 w-full" />
          <div className="flex items-center gap-1.5 pt-1">
            <Skeleton className="h-3.5 w-14 rounded" />
            <Skeleton className="h-3.5 w-20 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ConvCard({
  conv, onClick, contactAvatarByPhone, situationCodes, bucket,
  onReopen, isReopening = false, onResolve,
}: {
  conv: any;
  onClick: () => void;
  contactAvatarByPhone: Record<string, string | null>;
  situationCodes: string[];
  bucket?: Bucket;
  onReopen?: () => void;
  isReopening?: boolean;
  onResolve?: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  // Prefetch on hover/focus: deixa as queries do detalhe quentes ANTES do click.
  // Quando o drawer abre, mensagens já estão no cache → render instantâneo, sem
  // ver tela se formando. staleTime curto evita refetch repetido no mesmo hover.
  const prefetchConv = useCallback(() => {
    const cid = conv.id;
    if (!cid) return;
    queryClient.prefetchQuery({
      queryKey: ["/api/conversations", cid, "messages"],
      staleTime: 5000,
    });
  }, [conv.id]);
  const isResolved = bucket === "resolved";
  const phoneRaw = (conv.telefone || "").replace(/\D/g, "");
  // Bruno 2026-06-19: prioriza conv.avatar (o /api/conversations já entrega a foto
  // aqui — igual a ficha e o inbox fazem em ConversationList.tsx:546). Antes o card
  // só olhava o mapa de /api/contacts (teto de 100 contatos + 2 variações de telefone),
  // então a foto que aparecia na ficha NÃO aparecia no card do painel. O mapa segue
  // como fallback pra quem não tiver conv.avatar populado.
  const fotoUrl =
    conv.avatar ||
    contactAvatarByPhone[phoneRaw] ||
    contactAvatarByPhone[phoneRaw.startsWith("55") ? phoneRaw.slice(2) : `55${phoneRaw}`] ||
    null;
  const lastMsg = (conv.ultimaMensagem || conv.lastMessage || "").toString().trim();
  // "Em fila desde HH:mm" — só aparece em cards da coluna fila. Proxy honesto:
  // updatedAt da conversation (atualizado quando entra no pipeline humano).
  // Não temos campo dedicado `transferredAt` no schema (Bruno, 2026-05-17).
  const aguardandoDesde = bucket === "fila" ? formatShortTime(conv.updatedAt) : null;
  const encerradoAs = isResolved ? formatShortTime(conv.resolvedAt) : null;
  // WhatsApp-style: horário da última mensagem nos cards "Em andamento" e
  // "Em automação". updatedAt é atualizado em todo INSERT de message
  // (message-processor.ts L700), então serve como proxy honesto.
  const lastMessageTime =
    (bucket === "open" || bucket === "automacao") ? formatWhatsAppTime(conv.updatedAt) : null;
  // Bruno 2026-05-18: setor com 3 camadas de fallback.
  // Camada 1 (live): conv.agente / pipeline / fluxoAtual (válidos enquanto
  //   atendimento está ativo).
  // Camada 2 (resolved): infere pelo PREFIXO das situation tags (S* = Suporte,
  //   F* = Financeiro, C* = Comercial). Backend zera conv.agente ao resolver
  //   (informationalResolveService.ts:112) — situation_tags em CST sobrevivem.
  // Camada 3: vazio (sem badge).
  // Bruno 2026-05-20: `conv.agente` virou poluído com nome do atendente em
  // conversas legadas → aparecia "CLAUDIANA LIMA" como badge de setor. Filtra
  // só identificadores conhecidos de equipe; nome de pessoa cai pro fallback.
  const KNOWN_DEPT_TOKEN = /^(suporte(_tecnico)?|financeiro|comercial|vendas|cancelamento|reputacao)$/i;
  const departamento = (() => {
    const candidates = [conv.agente, conv.pipeline, (conv as any).fluxoAtual, (conv as any).fluxo_atual]
      .map(v => (v || "").toString().trim())
      .filter(Boolean);
    for (const raw of candidates) {
      const normalized = raw.replace(/^\[Equipe\]\s*/, "").trim();
      if (!KNOWN_DEPT_TOKEN.test(normalized)) continue;
      return normalized
        .replace(/^suporte_tecnico$/i, "Suporte")
        .replace(/^vendas$/i, "Comercial")
        .replace(/^(\w)(\w*)$/i, (_: string, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
    }
    // Fallback inferindo das tags. Cancelamento (CANCEL/C6) precede Comercial.
    const hasCancel = situationCodes.some(c => /^C6$|^CANCEL/i.test(c));
    if (hasCancel) return "Cancelamento";
    const prefix = situationCodes.find(c => /^[SFC]\d/i.test(c))?.charAt(0).toUpperCase();
    if (prefix === 'S') return "Suporte";
    if (prefix === 'F') return "Financeiro";
    if (prefix === 'C') return "Comercial";
    return "";
  })();
  const atendente = conv.assignedUserName;
  const canal = conv.canal;
  const unread = isResolved ? 0 : Number(conv.unread || 0);
  const isHighPriority = !isResolved && conv.prioridade === "alta";
  const chColor = canal ? channelColor(canal) : null;

  // Mostra até 4 tags (era 3). Tags são informação chave pro atendente.
  const topSituationCodes = situationCodes.slice(0, 4);

  // Bruno 2026-05-21: hover de cards resolvidos era emerald; agora primary
  // pra acompanhar tema. Não-resolvidos já estavam em primary.
  const hoverClass = isResolved
    ? "hover:border-base-300"
    : "hover:border-base-300";

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={prefetchConv}
      onFocus={prefetchConv}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      whileHover={prefersReducedMotion ? undefined : { y: -2 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={`group w-full text-left bg-base-100 border border-base-200 rounded-box p-3 ${hoverClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background transition-[border-color,box-shadow] duration-150 relative cursor-pointer select-none`}
      data-testid={`card-conv-${conv.id}`}
      aria-label={isResolved ? `Abrir conversa encerrada com ${conv.nome}` : `Abrir conversa com ${conv.nome}`}
    >
      {isHighPriority && (
        <span className="absolute top-2 left-2 w-1.5 h-8 rounded-full bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.4)]" aria-label="Prioridade alta" />
      )}
      <div className="flex items-start gap-3">
        <div className="relative flex-shrink-0">
          <ContactAvatar nome={conv.nome} fotoUrl={fotoUrl} size={44} rounded="11px" />
          {chColor && (
            <span
              className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[1.5px] border-base-100 flex items-center justify-center"
              style={{ background: chColor }}
              aria-hidden
            >
              {canal && <CanalIcon canal={canal} className="w-2 h-2 text-white" />}
            </span>
          )}
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-content text-[8.5px] font-bold flex items-center justify-center border-2 border-base-100 tabular-nums" aria-label={`${unread} mensagens não lidas`}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              {/* Bruno 2026-05-19: ícone "recebida de [A]" quando conv foi
                  transferida manualmente. Só aparece em Em Andamento; some
                  no resolve, release ou nova transferência (backend zera). */}
              {bucket === "open" && conv.transferredFromUserName && (
                <span
                  className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  title={`Recebida de ${conv.transferredFromUserName}`}
                  aria-label={`Conversa recebida por transferência de ${conv.transferredFromUserName}`}
                  data-testid={`transfer-badge-${conv.id}`}
                >
                  <ArrowLeftRight className="w-2.5 h-2.5" strokeWidth={2.5} />
                </span>
              )}
              <div className="font-semibold text-[13px] text-base-content truncate leading-tight">{sanitizeDisplayName(conv.nome) || conv.telefone || "Cliente"}</div>
            </div>
            <div className="flex items-start gap-1.5 flex-shrink-0 pt-[1px]">
              <div className="text-right leading-tight">
                {lastMessageTime && (
                  <div className="text-[10px] text-base-content/60 tabular-nums whitespace-nowrap font-medium">
                    {lastMessageTime}
                  </div>
                )}
                {aguardandoDesde && (
                  <div className="text-[9.5px] text-base-content/55 tabular-nums mt-0.5 whitespace-nowrap">
                    Em fila desde: <span className="font-semibold">{aguardandoDesde}</span>
                  </div>
                )}
                {encerradoAs && (
                  <div
                    className="text-[9.5px] tabular-nums mt-0.5 whitespace-nowrap font-medium"
                    style={{ color: "color-mix(in oklch, hsl(var(--primary)) 70%, hsl(var(--foreground)))" }}
                  >
                    Encerrado às <span className="font-bold">{encerradoAs}</span>
                  </div>
                )}
              </div>
              {isResolved && onReopen && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (!isReopening) onReopen(); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  disabled={isReopening}
                  className="p-1.5 rounded-lg text-base-content/60 hover:text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  title="Reabrir conversa"
                  aria-label={`Reabrir conversa com ${conv.nome}`}
                  data-testid={`button-reopen-${conv.id}`}
                >
                  {isReopening ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              {!isResolved && onResolve && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onResolve(); }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-lg text-base-content/60 hover:text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
                  title="Finalizar conversa"
                  aria-label={`Finalizar conversa com ${conv.nome}`}
                  data-testid={`button-resolve-${conv.id}`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          {(() => {
            // Bruno 2026-05-20: destaque pra última msg do cliente (mesmo padrão
            // do ConversationList). Cliente com unread → negrito; cliente sem
            // unread → peso médio + cor forte; atendente/bot → muted + "Você:".
            const lastDir = (conv as any).lastMessageDirection;
            const isCustomerLast = lastDir === "in";
            const hasUnread = Number(conv.unread || 0) > 0 && !isResolved;
            const previewBase = "text-[11.5px] mt-1 leading-snug line-clamp-2";
            const previewCls = isCustomerLast && hasUnread
              ? `${previewBase} text-base-content font-semibold`
              : isCustomerLast
                ? `${previewBase} text-base-content/80 font-medium`
                : `${previewBase} text-base-content/60`;
            return (
              <div className={previewCls}>
                {lastDir === "out" && lastMsg && !isMediaPlaceholder(lastMsg) && (
                  <span className="text-base-content/50 font-normal">Você: </span>
                )}
                {lastMsg
                  ? renderMessagePreview(lastMsg)
                  : <span className="italic text-base-content/45">sem mensagens ainda</span>}
              </div>
            );
          })()}
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {isResolved && (
              // Bruno 2026-05-23: minimalista — espelha estilo das outras
              // etiquetas (setor/situação). Sem bg/uppercase, só dot + label.
              <span className="inline-flex items-center gap-[3px] text-[10px] font-medium leading-none text-primary">
                <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 bg-primary" aria-hidden />
                Finalizado
              </span>
            )}
            {departamento && (() => {
              // Bruno 2026-05-23: minimalista — sem bg/border/uppercase. Só dot
              // + "Setor · Nome" em text-primary. Espelha estilo do inbox.
              const firstName = (() => {
                const n = (atendente || "").toString().trim();
                if (!n || n === "Agente Banana ISP") return "";
                return n.split(/\s+/)[0];
              })();
              const labelCap = departamento.charAt(0).toUpperCase() + departamento.slice(1).toLowerCase();
              return (
                <span
                  // Bruno 2026-06-14: descrição do setor em PRETO (text-base-content,
                  // adapta claro/escuro); o pontinho segue na cor do tema.
                  className="inline-flex items-center gap-[3px] text-[10px] font-medium leading-none text-base-content"
                  title={firstName ? `Setor ${departamento} — atendido por ${atendente}` : `Setor: ${departamento}`}
                  data-testid={`badge-departamento-${conv.id}`}
                >
                  <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 bg-primary" aria-hidden />
                  {labelCap}{firstName ? ` · ${firstName}` : ""}
                </span>
              );
            })()}
            {topSituationCodes.map((code) => (
              // Bruno 2026-05-23: chips monocromáticos — sem cor por código.
              // Borda fininha + texto muted. Hover/title revela o nome completo.
              <span
                key={code}
                className="text-[9px] font-medium tabular-nums text-base-content/60 border border-base-300 rounded px-1 py-[0.5px] leading-none"
                title={SITUATION_LABELS[code] || code}
              >
                {code}
              </span>
            ))}
            {situationCodes.length > 4 && (
              <span className="text-[9px] font-medium text-base-content/55 tabular-nums">
                +{situationCodes.length - 4}
              </span>
            )}
            {(() => {
              // Bruno 2026-05-20: pílula direita só existe pra bot (Agente Banana).
              // Atendente humano agora aparece embutido no chip do departamento
              // ("Suporte/Claudiana"), evitando o nome duplicado no card.
              const isBananaAgentName = atendente === "Agente Banana ISP";
              const showBotPill = bucket === "automacao" && (!atendente || isBananaAgentName);
              if (showBotPill) {
                return (
                  <span className="ml-auto text-[9px] font-semibold px-1 py-[2px] rounded flex items-center gap-1.5 text-base-content/60">
                    <Bot className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    <span className="max-w-[110px] truncate">Assistente Norte</span>
                  </span>
                );
              }
              // Caso raro: humano atribuído mas sem setor → mostra ele no canto.
              if (!!atendente && !isBananaAgentName && !departamento) {
                return (
                  <span className="ml-auto text-[9px] font-medium px-1 py-[2px] rounded flex items-center gap-1.5 text-base-content/60">
                    <span
                      className="w-3.5 h-3.5 rounded-full text-white text-[7.5px] font-bold flex items-center justify-center"
                      style={{ background: agentColor(atendente) }}
                      aria-hidden
                    >
                      {getInitials(atendente)}
                    </span>
                    <span className="max-w-[80px] truncate">{atendente}</span>
                  </span>
                );
              }
              return null;
            })()}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid de encerrados — reusa ConvCard com bucket="resolved" pra manter padrão
// visual idêntico ao kanban (mesmas tags, mesma tipografia, mesmo avatar)
// + botão Reabrir que volta a conversa pra Em andamento.
const ENCERRADOS_PAGE_SIZE = 15;

function EncerradosGrid({
  cards, onOpenCard, contactAvatarByPhone, getConvSituationCodes,
  onReopen, reopeningId, isLoading = false,
}: {
  cards: any[];
  onOpenCard: (id: number) => void;
  contactAvatarByPhone: Record<string, string | null>;
  getConvSituationCodes: (convId: number | string | null | undefined) => string[];
  onReopen: (id: number) => void;
  reopeningId: number | null;
  isLoading?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [page, setPage] = useState(1);

  const total = cards.length;
  const totalPages = Math.max(1, Math.ceil(total / ENCERRADOS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * ENCERRADOS_PAGE_SIZE;
  const pageCards = cards.slice(start, start + ENCERRADOS_PAGE_SIZE);

  // Reseta pra página 1 quando filtros mudam o total
  // (cards prop reflete os filtros aplicados pelo parent).
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [total, totalPages, page]);

  if (isLoading && cards.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <ConvCardSkeleton key={`sk-${i}`} />)}
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
          animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="text-center px-4 py-16"
        >
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-base-200 grid place-items-center">
            <Check className="w-7 h-7 text-base-content/40" />
          </div>
          <div className="font-medium text-base-content text-[13px]">Nada encerrado hoje ainda</div>
          <div className="text-base-content/55 mt-1 mx-auto leading-relaxed text-[11.5px] max-w-[260px]">
            As conversas finalizadas no dia aparecem aqui pra você revisar.
          </div>
        </motion.div>
      </div>
    );
  }

  // Gera sequência de páginas com elipses: [1, …, p-1, p, p+1, …, totalPages].
  const pageNumbers: (number | "…")[] = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out: (number | "…")[] = [1];
    const left = Math.max(2, safePage - 1);
    const right = Math.min(totalPages - 1, safePage + 1);
    if (left > 2) out.push("…");
    for (let i = left; i <= right; i++) out.push(i);
    if (right < totalPages - 1) out.push("…");
    out.push(totalPages);
    return out;
  })();

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Bruno 2026-05-21: paginação leve. Antes cada card tinha motion.div
          com `layout` + stagger `idx*0.02` até 400ms + exit animation. Ao
          trocar página, 15 cards exit + 15 entry sequenciais = visualmente
          travado. Trocado por single fade do grid inteiro (~150ms) com
          key=page — 1 animação só, sem layout cost.
          Bruno 2026-05-21 (segunda iteração): flex-1 no wrapper pra empurrar
          o paginador pro rodapé, mesmo quando a última página tem poucos
          cards. Antes ele subia atrás dos 2-3 cards remanescentes. */}
      <div className="relative flex-1 min-h-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`page-${safePage}`}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={prefersReducedMotion ? undefined : { opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={prefersReducedMotion ? undefined : { duration: 0.14, ease: 'easeOut' }}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
          >
            {pageCards.map((c) => (
              <ConvCard
                key={c.id}
                conv={c}
                onClick={() => onOpenCard(c.id)}
                contactAvatarByPhone={contactAvatarByPhone}
                // Bruno 2026-05-21: era c.telefone (refac incompleto). Helper
                // agora indexa por conversationId; passar telefone retornava []
                // sempre — tags sumiam dos cards de "Encerrados hoje".
                situationCodes={getConvSituationCodes(c.id)}
                bucket="resolved"
                onReopen={() => onReopen(c.id)}
                isReopening={reopeningId === c.id}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {totalPages > 1 && (
        <div
          className="flex items-center justify-between gap-3 px-1 py-2 mt-1 border-t border-base-200 flex-wrap"
          data-testid="encerrados-pagination"
        >
          <span className="text-[11px] text-base-content/60 tabular-nums">
            Mostrando <span className="font-semibold text-base-content">{start + 1}</span>
            –<span className="font-semibold text-base-content">{Math.min(start + ENCERRADOS_PAGE_SIZE, total)}</span>
            {" "}de <span className="font-semibold text-base-content">{total}</span> encerrados
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage <= 1}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-base-300 text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Página anterior"
              data-testid="encerrados-page-prev"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            {pageNumbers.map((p, i) => p === "…" ? (
              <span key={`ell-${i}`} className="px-1.5 text-[10px] text-base-content/60 select-none">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                className={`min-w-[28px] h-7 px-2 rounded-md text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                  p === safePage
                    ? "bg-primary text-primary-content"
                    : "text-base-content/60 hover:text-base-content hover:bg-base-200 border border-transparent"
                }`}
                aria-current={p === safePage ? "page" : undefined}
                data-testid={`encerrados-page-${p}`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-base-300 text-base-content/60 hover:text-base-content hover:bg-base-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              aria-label="Próxima página"
              data-testid="encerrados-page-next"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({
  icon: Icon, title, hint, big = false, mascotPose,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  hint: string;
  big?: boolean;
  // Bruno 2026-05-19: quando setada, substitui o ícone genérico pela banana
  // mascote — usado em colunas onde o vazio merece personalidade (ex: "Em
  // Automação" sem nada rolando = bot dormindo).
  mascotPose?: "wave" | "neutral" | "celebrate" | "sleep";
}) {
  const prefersReducedMotion = useReducedMotion();
  const mascotSize = big ? 128 : 104;
  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className={`text-center px-4 ${big ? "py-16" : "py-10"}`}
    >
      {(
        <div className={`mx-auto rounded-box bg-base-200 flex items-center justify-center mb-3 ${big ? "w-14 h-14" : "w-10 h-10"}`}>
          <Icon className={`text-base-content/40 ${big ? "w-6 h-6" : "w-4 h-4"}`} strokeWidth={1.8} />
        </div>
      )}
      <div className={`font-medium text-base-content ${big ? "text-[13px]" : "text-[11.5px]"}`}>{title}</div>
      <div className={`text-base-content/55 mt-1 mx-auto leading-relaxed ${big ? "text-[11.5px] max-w-[260px]" : "text-[10.5px] max-w-[200px]"}`}>{hint}</div>
    </motion.div>
  );
}
