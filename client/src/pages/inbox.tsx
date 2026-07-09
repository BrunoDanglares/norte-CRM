import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { apiRequest, apiFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useFieldHighlight } from "@/hooks/useFieldHighlight";
import ContactProfilePanel from "@/components/ContactProfilePanel";
import ContactPopupResolver from "@/components/inbox/ContactPopupResolver";
import { Trash2, Loader2, MessageSquare } from "lucide-react";
import type { Conversation, Message } from "@shared/schema";

import { type ConvExtended } from "@/components/inbox/helpers";
import ConversationList from "@/components/inbox/ConversationList";
import MessageArea from "@/components/inbox/MessageArea";
import ActionsSidebar from "@/components/inbox/ActionsSidebar";
import TransferDialog from "@/components/inbox/TransferDialog";
import ChatRailNav, { type ChatRailTab } from "@/components/inbox/ChatRailNav";
import ResolveDialog from "@/components/inbox/ResolveDialog";
import HistoricoDialog from "@/components/inbox/HistoricoDialog";
import { useAudioRecorder, useFileHandler } from "@/components/inbox/useMediaHandlers";

function readEmbedFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("embed") === "1") return true;
  } catch {}
  // Fallback: rodando dentro de iframe? Tratar como embed também.
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true; // Cross-origin throw => certamente dentro de iframe
  }
  return false;
}

type InboxProps = {
  /** Quando true, esconde a ConversationList da esquerda (modo drawer embarcado). */
  embedMode?: boolean;
  /** Quando setado, abre direto essa conversa sem ler URL nem localStorage. */
  initialConvId?: number | null;
  /**
   * Callback opcional pra fechar o ConversaDrawer pai (modo embed).
   * Bruno 2026-05-21: ao finalizar conv pelo drawer flutuante, o próprio
   * drawer fecha — atendimento encerrado, faz sentido sair da tela.
   */
  onCloseDrawer?: () => void;
  /**
   * Somente-leitura do composer/painel (Bruno 2026-06-05). Desacoplado do
   * embedMode: o drawer da Central/Leads abre INTERATIVO (admin responde dali),
   * só os Relatórios passam readOnly pra manter o preview de análise. Quando
   * undefined, cai no embedMode (compat com o embed legado via iframe).
   */
  readOnly?: boolean;
};

export default function Inbox({ embedMode: embedModeProp, initialConvId, onCloseDrawer, readOnly: readOnlyProp }: InboxProps = {}) {
  // Props têm prioridade sobre detecção via URL/iframe. Quando o drawer renderiza
  // inline (sem iframe), passa embedMode={true} explícito — evita o fallback de
  // window.self !== window.top que sempre dava false fora de iframe.
  const [embedMode] = useState<boolean>(() => embedModeProp ?? readEmbedFlag());
  // readOnly explícito vence; sem ele, mantém o comportamento antigo (embedMode).
  const composerReadOnly = readOnlyProp ?? embedMode;
  const [selectedId, setSelectedIdRaw] = useState<number | null>(initialConvId ?? null);
  const [search, setSearch] = useState("");
  const [newMsg, setNewMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("automacao");
  const [channelFilter, setChannelFilter] = useState<string>("whatsapp");
  const [conexaoFilter, setConexaoFilter] = useState<string | null>(() => localStorage.getItem("flowcrm_conexao_filter") || null);
  const [conexaoDropdownOpen, setConexaoDropdownOpen] = useState(false);
  const [assignPanelOpen, setAssignPanelOpen] = useState(false);
  const [assignFilter, setAssignFilter] = useState("");
  const [assignTab, setAssignTab] = useState<"equipes" | "usuarios">("equipes");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [refreshSpinning, setRefreshSpinning] = useState(false);
  const [historicoDialogConv, setHistoricoDialogConv] = useState<any>(null);
  const assignPanelRef = useRef<HTMLDivElement>(null);
  const conexaoDropdownRef = useRef<HTMLDivElement>(null);
  const [contactPopupOpen, setContactPopupOpen] = useState(false);
  const [signMessages, setSignMessages] = useState(true);
  const [showEmoji, setShowEmoji] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const assignBtnRef = useRef<HTMLButtonElement>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatSearch, setNewChatSearch] = useState("");
  const [confirmDeleteConv, setConfirmDeleteConv] = useState<number | null>(null);
  const [resolveDialogConv, setResolveDialogConv] = useState<any>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  // Bruno 2026-05-19: mensagem sendo respondida (reply/quote). Quando setada,
  // composer mostra preview acima e POST inclui replyToMessageId.
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  // Bruno 2026-05-19: rail entre chat e painel de ações (abas + toggle do
  // painel). Bruno 2026-06-04: aba "Início" removida; "Cliente" é a padrão.
  const [chatRailTab, setChatRailTab] = useState<ChatRailTab | null>("cliente");
  const [actionsSidebarOpen, setActionsSidebarOpen] = useState<boolean>(true);
  const [contextProtocolId, setContextProtocolId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<"cliente" | "interno">("cliente");
  const [internalMsg, setInternalMsg] = useState("");
  const [internalTarget, setInternalTarget] = useState<string>("todos");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;
  const currentUserIdRef = useRef<number | undefined>(undefined);
  const currentUserRoleRef = useRef<string>("");
  // Bruno 2026-06-04: ao ABRIR um chat, o painel volta pra aba "Cliente"
  // (padrão). Reseta sempre que a conversa selecionada muda.
  useEffect(() => {
    if (selectedId != null) setChatRailTab("cliente");
  }, [selectedId]);
  // Highlight pulsante (~2s) em campos do painel quando o agente automatizado
  // muda algo via WS — feedback visual sutil pro atendente sem toast intrusivo.
  // Aplicado em: 'pipeline', 'prioridade', 'situacao', 'equipe', 'atribuicao'.
  const { highlight: highlightField, isHighlighted } = useFieldHighlight();
  // Banner pós-shift de conversa selecionada (Q4=b): quando a conversa que
  // estou vendo é resolvida ou movida pra outra fila, mostra um aviso
  // discreto no topo do painel central. Limpa ao trocar de seleção.
  const [conversationFlowNotice, setConversationFlowNotice] = useState<{
    convId: number;
    kind: 'resolved' | 'moved_team' | 'sla_violated';
    text: string;
  } | null>(null);

  const { data: meData } = useQuery<{ ok: boolean; data: { id: number; nome: string; email: string; role?: string; empresa?: string | null; workspaceName?: string | null } }>({
    queryKey: ["/api/auth/me"],
  });
  const currentUserId = meData?.data?.id;
  const fullName = meData?.data?.nome || "Voce";
  const currentUserName = fullName.split(/\s+/).slice(0, 2).join(" ");
  const currentUserRole = meData?.data?.role || "";
  currentUserIdRef.current = currentUserId;
  currentUserRoleRef.current = currentUserRole;
  const companyName = (meData?.data as any)?.workspaceName || meData?.data?.empresa || "";
  // Bruno 2026-06-08: no CHAT (inbox), admin/gerente enxerga como atendente normal —
  // só conversas DELE + fila. A visão "admin vê tudo" fica só no Painel (atendimentos).
  const isManagerRole = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(currentUserRole);

  const { data: qrData } = useQuery<{ ok: boolean; data: Array<{ id: number; titulo: string; texto: string; ativo: boolean; categoria?: string | null; tipoMidia?: string | null; arquivoUrl?: string | null; arquivoNome?: string | null }> }>({
    queryKey: ["/api/respostas-rapidas"],
  });
  const quickReplies = (qrData?.data || []).filter(r => r.ativo && r.categoria !== "Pesquisa").map(r => ({ title: r.titulo, txt: r.texto, tipoMidia: r.tipoMidia || null, arquivoUrl: r.arquivoUrl || null, arquivoNome: r.arquivoNome || null }));

  const { data: leadTagsData } = useQuery<any[]>({
    queryKey: ["/api/lead-tags"],
  });
  const availableTags: { id: number; nome: string; cor: string }[] = leadTagsData || [];

  const { data: conexoesData } = useQuery<{ ok: boolean; data: any[] }>({
    queryKey: ["/api/conexoes"],
  });
  const { data: integConfigData, isSuccess: integConfigLoaded } = useQuery<{ ok: boolean; data: Record<string, { enabled: boolean; config: any }> }>({ queryKey: ["/api/integrations/config"] });
  const instagramEnabled = integConfigLoaded && integConfigData?.data?.instagram?.enabled === true;
  const whatsappEnabled = integConfigLoaded && (integConfigData?.data?.woficial?.enabled === true || integConfigData?.data?.evolution?.enabled !== false);
  const { data: metaConnData } = useQuery<{ connected: boolean; data?: any }>({
    queryKey: ["/api/whatsapp-official/connection"],
  });
  const conexoesList = useMemo(() => {
    const list = [...(conexoesData?.data || [])];
    if (metaConnData?.connected && metaConnData.data) {
      const mc = metaConnData.data;
      list.push({
        id: `meta_official_${mc.id}`,
        nome: mc.businessName || "WA Oficial",
        status: "connected",
        numero: mc.displayPhoneNumber,
        provider: "meta",
        tipo: "whatsapp",
      });
    }
    return list;
  }, [conexoesData, metaConnData]);

  const { data: pipelinesData } = useQuery<any[]>({
    queryKey: ["/api/pipelines"],
    staleTime: 60000,
  });
  const { data: leadsData } = useQuery<any[]>({
    queryKey: ["/api/leads"],
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 15000,
  });
  const { data: pipelineStagesData } = useQuery<any[]>({
    queryKey: ["/api/pipeline-stages"],
    staleTime: 60000,
  });

  const { data: contactsData } = useQuery<any[]>({
    queryKey: ["/api/contacts"],
  });

  const { data: equipesData } = useQuery<{ ok: boolean; data: any[] }>({
    queryKey: ["/api/equipes"],
  });
  const equipesList = equipesData?.data || [];

  const { data: usuariosData } = useQuery<{ ok: boolean; data: any[] }>({
    queryKey: ["/api/usuarios"],
  });
  const usuariosList = usuariosData?.data || [];

  const allMembers = useMemo(() => {
    const active = usuariosList.filter((u: any) => u.status === "ACTIVE");
    return active.map((u: any) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.cargo || u.role,
    }));
  }, [usuariosList]);

  const assignMutation = useMutation({
    mutationFn: async ({ convId, agente, targetUserId }: { convId: number; agente: string | null; targetUserId?: number | null }) => {
      await apiRequest("PATCH", `/api/conversations/${convId}/assign`, { agente });
      if (targetUserId !== undefined) {
        await apiRequest("PATCH", `/api/conversations/${convId}/transfer`, { targetUserId });
      }
    },
    onMutate: async ({ convId, agente }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations"], exact: true });
      const prev = queryClient.getQueryData<any[]>(["/api/conversations"]);
      queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
        (old || []).map((c: any) => c.id === convId ? { ...c, agente } : c)
      );
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/conversations"], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    },
    onSuccess: () => {
      toast({ title: "Atribuido com sucesso" });
      setAssignPanelOpen(false);
    },
  });

  const pipelineEtapaMutation = useMutation({
    mutationFn: async ({ convId, pipelineEtapa }: { convId: number; pipelineEtapa: string | null }) => {
      return apiRequest("PATCH", `/api/conversations/${convId}/pipeline-etapa`, { pipelineEtapa });
    },
    onMutate: async ({ convId, pipelineEtapa }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations"], exact: true });
      const prev = queryClient.getQueryData<any[]>(["/api/conversations"]);
      queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
        (old || []).map((c: any) => c.id === convId ? { ...c, pipelineEtapa } : c)
      );
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/conversations"], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

  useEffect(() => {
    if (conexoesList.length > 0) {
      const saved = localStorage.getItem("flowcrm_conexao_filter");
      if (saved === null && conexaoFilter === null) return;
      const validSaved = saved && conexoesList.some((c: any) => c.id === saved);
      if (conexaoFilter && !conexoesList.some((c: any) => c.id === conexaoFilter)) {
        const pick = validSaved ? saved : null;
        setConexaoFilter(pick);
        if (pick) localStorage.setItem("flowcrm_conexao_filter", pick);
        else localStorage.removeItem("flowcrm_conexao_filter");
      }
    }
  }, [conexoesList.length]);

  const { data: rawConversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  // No Chat, manager é tratado como atendente: vê só o que está atribuído a ele OU
  // na fila (sem atendente) OU já resolvido. Atendente comum já vem filtrado do
  // backend, então passa direto. (Painel/atendimentos usa a lista crua e vê tudo.)
  const conversations = useMemo(() => {
    // No modo embed (ConversaDrawer de Relatórios/Central/Leads) o admin precisa
    // abrir QUALQUER conversa — não filtra. Só filtra no Chat "cheio".
    if (!isManagerRole || embedMode) return rawConversations;
    return rawConversations.filter(
      (c: any) => c.status === "resolved" || c.assignedUserId === currentUserId || !c.assignedUserId,
    );
  }, [rawConversations, isManagerRole, currentUserId, embedMode]);

  const initialLoadDone = useRef(false);
  const urlParamHandled = useRef<string | null>(null);
  const pendingNavTarget = useRef<{ convId: number; protocolId: string | null } | null>(null);

  // OPTIMIZATION: detecta convId da URL imediatamente na montagem, sem esperar a lista de conversas
  // Isso permite que a query de mensagens dispare em paralelo com a lista de conversas
  useEffect(() => {
    // Quando o componente é renderizado inline pelo ConversaDrawer (modo embed),
    // o convId vem por prop — pular leitura de URL evita corrida + replaceState
    // que afeta o histórico do app pai.
    const cid = initialConvId ?? (() => {
      const urlParams = new URLSearchParams(window.location.search);
      const convIdParam = urlParams.get("convId");
      if (!convIdParam) return null;
      const parsed = Number(convIdParam);
      return parsed || null;
    })();
    if (!cid) return;
    // Marca como handled para que o useEffect principal não re-processe
    urlParamHandled.current = String(cid);
    initialLoadDone.current = true;
    // Define selectedId imediatamente — dispara a query de mensagens em paralelo com a lista
    setSelectedIdRaw(cid);
    if (initialConvId == null) {
      // Só limpa URL quando o convId veio da URL (não quando veio por prop do drawer).
      window.history.replaceState({}, "", window.location.pathname);
    }
    // Busca a conversa individualmente e injeta no cache para que `selected` fique disponível
    apiRequest("GET", `/api/conversations/${cid}`).then(async (resp) => {
      if (!resp.ok) return;
      const body = await resp.json();
      const conv: Conversation = body.data;
      if (!conv) return;
      queryClient.setQueryData(["/api/conversations"], (old: Conversation[] | undefined) => {
        if (!old) return [conv];
        if (old.find((c) => c.id === conv.id)) return old;
        return [conv, ...old];
      });
      setStatusFilter(getConvTab(conv));
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Lê o alvo de navegação do sessionStorage na montagem (enviado por History.tsx)
  useEffect(() => {
    const raw = sessionStorage.getItem("inbox_open_conv");
    if (raw) {
      try {
        const target = JSON.parse(raw);
        if (target?.convId) pendingNavTarget.current = target;
      } catch {}
      sessionStorage.removeItem("inbox_open_conv");
    }
  }, []);

  useEffect(() => {
    if (conversations.length === 0) return;

    // Verifica primeiro o alvo via sessionStorage (navegação da Central de Atendimentos)
    if (pendingNavTarget.current && !initialLoadDone.current) {
      const { convId, protocolId } = pendingNavTarget.current;
      pendingNavTarget.current = null;
      initialLoadDone.current = true;
      const paramKey = String(convId);
      urlParamHandled.current = paramKey;
      if (protocolId) setContextProtocolId(protocolId);
      const matchConv = conversations.find((c) => c.id === convId);
      if (matchConv) {
        setSelectedIdRaw(matchConv.id);
        setStatusFilter(getConvTab(matchConv));
        return;
      }
      // Não está na lista — busca diretamente
      apiRequest("GET", `/api/conversations/${convId}`).then(async (resp) => {
        const body = await resp.json();
        const conv: Conversation = body.data;
        if (!conv) return;
        queryClient.setQueryData(["/api/conversations"], (old: Conversation[] | undefined) => {
          if (!old) return [conv];
          if (old.find((c) => c.id === conv.id)) return old;
          return [conv, ...old];
        });
        setSelectedIdRaw(conv.id);
        setStatusFilter(getConvTab(conv));
      }).catch(() => {});
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const convIdParam = urlParams.get("convId");
    const phoneParam = urlParams.get("phone");
    const hasUrlParam = !!(convIdParam || phoneParam);
    const paramKey = convIdParam || phoneParam || null;

    if (hasUrlParam && urlParamHandled.current !== paramKey) {
      if (convIdParam) {
        const cid = Number(convIdParam);
        const matchConv = conversations.find((c) => c.id === cid);
        if (matchConv) {
          setSelectedIdRaw(matchConv.id);
          const protocolIdParam = urlParams.get("protocolId");
          if (protocolIdParam) setContextProtocolId(protocolIdParam);
          setStatusFilter(getConvTab(matchConv));
          urlParamHandled.current = paramKey;
          initialLoadDone.current = true;
          window.history.replaceState({}, "", window.location.pathname);
          return;
        }
        // Conversa não está na lista carregada (pode ser resolved antiga fora dos 50 recentes)
        // Busca diretamente pela API e injeta na cache
        urlParamHandled.current = paramKey;
        initialLoadDone.current = true;
        window.history.replaceState({}, "", window.location.pathname);
        apiRequest("GET", `/api/conversations/${cid}`).then(async (resp) => {
          if (!resp.ok) return;
          const body = await resp.json();
          const conv: Conversation = body.data;
          if (!conv) return;
          // Injeta na cache do TanStack Query para aparecer na lista
          queryClient.setQueryData(["/api/conversations"], (old: Conversation[] | undefined) => {
            if (!old) return [conv];
            if (old.find((c) => c.id === conv.id)) return old;
            return [conv, ...old];
          });
          setSelectedIdRaw(conv.id);
          setStatusFilter(getConvTab(conv));
        }).catch(() => {});
        return;
      }

      if (phoneParam) {
        const cleanPhone = phoneParam.replace(/\D/g, "");
        const matchConv = conversations.find((c) => (c.telefone || "").replace(/\D/g, "") === cleanPhone);
        if (matchConv) {
          setSelectedIdRaw(matchConv.id);
          setStatusFilter(getConvTab(matchConv));
          urlParamHandled.current = paramKey;
          initialLoadDone.current = true;
          window.history.replaceState({}, "", window.location.pathname);
          return;
        }
      }
      return;
    }

    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    // Bruno 2026-05-21: ao entrar em /inbox SEM URL param (convId/phone),
    // a tela começa com empty state ("Escolha uma conversa ao lado") em vez de
    // restaurar automaticamente a última conv aberta. O auto-restore via
    // localStorage gerava confusão: ao voltar pra "Atendimento" depois de
    // navegar pra outras telas, a conv anterior reaparecia mesmo já tendo
    // sido tratada (ou estando irrelevante naquele momento). Atendente agora
    // escolhe explicitamente o que abrir.
  }, [conversations]);

  const setSelectedId = useCallback((id: number | null) => {
    setSelectedIdRaw(id);
    setContextProtocolId(null);
    // Banner de mudança de fluxo (Q4=b) é específico da conversa selecionada;
    // ao trocar, descarta — caso contrário o aviso da conversa anterior vaza.
    setConversationFlowNotice(null);
    if (id !== null) {
      const conv = conversations.find((c) => c.id === id);
      // Em embed mode (Dashboard de Atendimento abre conversa no drawer flutuante),
      // a tela é só pra REVISAR. NÃO disparar PATCH /read pra não:
      //  - zerar unread (outro atendente pode estar vendo);
      //  - setar pendente=false (afeta classificação no Dashboard);
      //  - bumpar lastOperatorViewAt (entra no auto-close timer e parece "assumiu").
      // Pra assumir de fato existe o botão "Assumir atendimento" no ActionsSidebar.
      if (!embedMode && conv && ((conv.unread > 0) || (conv as any).pendente === true)) {
        apiRequest("PATCH", `/api/conversations/${id}/read`, {}).then(async (resp) => {
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
          try {
            const body = await resp.json();
            if (body.warning) {
              toast({ title: "Aviso", description: body.warning, variant: "default" });
            }
          } catch {}
        }).catch(() => {});
      }
      if (!embedMode) localStorage.setItem("flowcrm_last_conversation", id.toString());
    }
  }, [conversations, embedMode]);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/conversations", selectedId, "messages"],
    enabled: !!selectedId,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 5000,
  });

  // Helper robusto de scroll (Bruno 2026-05-17): scrollIntoView dentro do
  // ScrollArea radix às vezes não funciona pq o viewport interno é o scroll
  // container real. Pega o viewport direto e força scrollTop=scrollHeight.
  // Re-tenta após 150ms pra cobrir imagens carregando (que mudam altura).
  // behavior='smooth' pra novas msgs (visual confortável), 'auto' pra troca
  // de conversa (snappy).
  const stickToBottomRef = useRef(true);
  const scrollMsgsToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const tryScroll = () => {
      const end = messagesEndRef.current;
      if (!end) return;
      // Acha o viewport do ScrollArea radix (data-radix-scroll-area-viewport)
      // OU qualquer ancestor com scroll. Fallback: scrollIntoView direto.
      let viewport: HTMLElement | null = end.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      if (!viewport) {
        let p: HTMLElement | null = end.parentElement;
        while (p) {
          const cs = window.getComputedStyle(p);
          if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
            viewport = p; break;
          }
          p = p.parentElement;
        }
      }
      if (viewport) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      } else {
        end.scrollIntoView({ behavior, block: "end" });
      }
    };
    tryScroll();
    // Segunda passada pra cobrir imagens/conteúdo dinâmico que mediu altura tarde
    setTimeout(tryScroll, 160);
  }, []);

  // Tracker: se usuário rolou pra cima >200px da bottom, não auto-scrolla em
  // novas msgs (UX comum de chat — deixa ele ler mensagens antigas em paz).
  useEffect(() => {
    if (!selectedId) return;
    const end = messagesEndRef.current;
    if (!end) return;
    let viewport: HTMLElement | null = end.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) {
      let p: HTMLElement | null = end.parentElement;
      while (p) {
        const cs = window.getComputedStyle(p);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
          viewport = p; break;
        }
        p = p.parentElement;
      }
    }
    if (!viewport) return;
    const onScroll = () => {
      const dist = viewport!.scrollHeight - viewport!.scrollTop - viewport!.clientHeight;
      stickToBottomRef.current = dist < 200;
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => { viewport!.removeEventListener('scroll', onScroll); };
  }, [selectedId, messages.length]);

  // Ao abrir uma conversa OU ao carregar/atualizar a lista de mensagens dela,
  // garante que a visualização vá para o final (mensagem mais recente) com
  // animação suave de rolagem. Exceção: quando a abertura veio de um protocolo
  // específico (Central de Atendimentos), o MessageArea ancora a rolagem no
  // separador daquele protocolo — não competimos com ele aqui.
  const lastConvIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedId || messages.length === 0) return;
    if (contextProtocolId) return;
    const isConvChange = lastConvIdRef.current !== selectedId;
    lastConvIdRef.current = selectedId;
    // Troca de conversa = sempre rola (snappy), reseta stick.
    if (isConvChange) {
      stickToBottomRef.current = true;
      setTimeout(() => scrollMsgsToBottom("auto"), 30);
      return;
    }
    // Nova msg na mesma conversa — só rola se o usuário tá perto do bottom
    if (!stickToBottomRef.current) return;
    setTimeout(() => scrollMsgsToBottom("smooth"), 30);
  }, [selectedId, messages.length, contextProtocolId, scrollMsgsToBottom]);

  const { data: internalChatData } = useQuery<{ ok: boolean; data: any[]; error?: string }>({
    queryKey: ["/api/chat-interno", selectedId],
    queryFn: async () => {
      return apiFetch(`/api/chat-interno/${selectedId}`);
    },
    // Bruno 2026-05-21: msgs internas agora aparecem inline no feed (estilo
    // nota lateral), então a query roda sempre que há conv selecionada — não
    // mais condicional ao chatMode. Backend cuida da permissão (admin OR
    // atendente atribuído).
    enabled: !!selectedId,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    // Se vier 403 (atendente sem acesso a essa conv) a UI simplesmente não
    // mostra notas internas e nem o toggle Interno. Evita ruído de erro.
    retry: false,
  });
  const internalMessages = internalChatData?.data || [];
  const canSeeInternal = !internalChatData?.error;
  // workspaceUsers fica como array vazio — picker de target foi removido
  // junto com o composer interno legado. Mantido só pra não quebrar prop.
  const workspaceUsers: any[] = [];

  const sendInternalMutation = useMutation({
    mutationFn: (body: { texto: string }) =>
      apiRequest("POST", `/api/chat-interno/${selectedId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat-interno", selectedId] });
      setInternalMsg("");
    },
    onError: () => {
      toast({ title: "Erro ao enviar mensagem interna", variant: "destructive" });
    },
  });

  const { data: historicoData } = useQuery<{
    ok: boolean;
    stats: { totalMessages: number; tempoAberto: string; respostasAtendente: number; tempoMedioResp: string };
    timeline: { tipo: string; titulo: string; subtitulo: string; data: string; cor: string }[];
  }>({
    queryKey: ["/api/conversations", selectedId, "historico"],
    enabled: !!selectedId,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 15000,
  });

  const deleteConvMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setSelectedId(null);
      setConfirmDeleteConv(null);
      toast({ title: "Chat apagado e contexto zerado" });
    },
    onError: () => {
      toast({ title: "Erro ao apagar chat", variant: "destructive" });
    },
  });

  const handleWsNewMessage = useCallback((data: any) => {
    const { conversationId, conversation, message } = data;
    // Bruno 2026-05-21: card só aparecia após F5 quando a conv era NOVA
    // (não estava no cache). setQueryData abaixo só atualiza entradas
    // existentes via .map — conv nova sumia sem invalidate. Detectamos
    // o miss e fazemos refetch pra incluir a conv recém-criada.
    let convInCache = true;
    if (conversation) {
      queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) => {
        if (!old) { convInCache = false; return old; }
        convInCache = old.some((c: any) => c.id === conversationId);
        if (!convInCache) return old; // refetch trata abaixo
        return old.map((c: any) =>
          c.id === conversationId
            ? { ...c, ultimaMensagem: conversation.ultimaMensagem ?? message?.texto ?? c.ultimaMensagem, unread: (c.unread || 0) + (selectedIdRef.current === conversationId ? 0 : 1) }
            : c
        );
      });
    }
    if (selectedIdRef.current === conversationId) {
      // Injeta a mensagem diretamente no cache — sem round-trip HTTP, instantâneo
      if (message) {
        const qk = ["/api/conversations", conversationId, "messages"];
        queryClient.setQueryData(qk, (old: any) => {
          const list: any[] = Array.isArray(old) ? old : (old?.messages ?? old?.data ?? []);
          const alreadyExists = list.some((m: any) => m.id === message.id);
          if (alreadyExists) return Array.isArray(old) ? old : list;
          return [...list, message];
        });
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 80);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "situation-tags"] });
    }
    // Conv nova OU evento sem payload de conv → refetch da lista
    if (!conversation || !convInCache) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    }
  }, []);

  const handleWsConversationUpdated = useCallback((data: any) => {
    const { conversationId, pipeline_etapa, assigned_team_id, pipeline, pendente, assigned_user_id, assigned_user_name, tags, prioridade, agente, status, ultimaMensagem, tempo, nome } = data || {};
    if (conversationId) {
      const myId = currentUserIdRef.current;
      const isManager = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(currentUserRoleRef.current);

      queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) => {
        if (!old) return old;
        const convInCache = old.some((c: any) => c.id === conversationId);

        // Bruno 2026-05-21: qualquer update em conv FORA do cache → refetch.
        // Antes só refetchava no caso específico de "selecionada e atribuída
        // a mim". Conv nova (1ª mensagem) ficava invisível até F5 porque o
        // setQueryData via .map silenciosamente não fazia nada.
        if (!convInCache) {
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
          }, 0);
          return old;
        }

        return old
          .map((c: any) =>
            c.id !== conversationId ? c : {
              ...c,
              ...(pipeline_etapa !== undefined && { pipelineEtapa: pipeline_etapa }),
              ...(assigned_team_id !== undefined && { assignedTeamId: assigned_team_id }),
              ...(pipeline !== undefined && { pipeline }),
              ...(pendente !== undefined && { pendente }),
              ...(assigned_user_id !== undefined && { assignedUserId: assigned_user_id }),
              ...(assigned_user_name !== undefined && { assignedUserName: assigned_user_name }),
              ...(tags !== undefined && { tags }),
              ...(prioridade !== undefined && { prioridade }),
              ...(agente !== undefined && { agente }),
              ...(status !== undefined && { status }),
              ...(ultimaMensagem !== undefined && { ultimaMensagem, updatedAt: new Date().toISOString() }),
              ...(tempo !== undefined && { tempo }),
              ...(nome !== undefined && { nome }),
            }
          )
          .filter((c: any) => {
            if (isManager) return true;
            if (c.id !== conversationId) return true;
            if (c.status === "resolved") return true;
            // Se foi assumida por outro atendente, remove da lista —
            // EXCETO se for a conversa atualmente selecionada: não colapsamos o layout do atendente.
            // A conversa sairá naturalmente no próximo refetch periódico (refetchInterval: 20000).
            if (c.assignedUserId && myId && c.assignedUserId !== myId) {
              if (c.id === selectedIdRef.current) return true;
              return false;
            }
            return true;
          });
      });
    }
    // Invalida situation-tags da conversa selecionada (mensagens são mantidas pelo handleWsNewMessage)
    if (conversationId && selectedIdRef.current === conversationId) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "situation-tags"] });
    }
    // Invalida leads/pipeline quando etapa ou equipe muda — garante sidebar dinâmica.
    // Também invalida pipeline-stages porque cada equipe tem pipelineKey próprio:
    // sem esse invalidate, a sidebar continuava mostrando etapas da equipe ANTERIOR
    // até o staleTime expirar (60s). Caso real: agente atribuiu Suporte Técnico mas
    // painel ficava com "Atribua uma equipe para ver as etapas".
    if (pipeline_etapa !== undefined || assigned_team_id !== undefined || pipeline !== undefined) {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline-stages"] });
    }
    // Highlight pulsante nos campos que mudaram (Q2=c). Só dispara se a
    // conversa afetada é a que o atendente está olhando — caso contrário
    // ele não veria o highlight.
    if (conversationId && selectedIdRef.current === conversationId) {
      if (pipeline_etapa !== undefined || pipeline !== undefined) highlightField('pipeline');
      if (assigned_team_id !== undefined || assigned_user_id !== undefined) highlightField('atribuicao');
      if (prioridade !== undefined) highlightField('prioridade');
      if (tags !== undefined) highlightField('situacao');
    }
    // Banner Q4=b: aviso quando a conversa selecionada é resolvida ou movida
    // pra outra fila (ex: assumida por outro atendente, transferida de equipe).
    // Não troca de view — só informa, não-bloqueante. Limpa ao mudar de seleção.
    if (conversationId && selectedIdRef.current === conversationId) {
      if (status === 'resolved') {
        setConversationFlowNotice({
          convId: conversationId,
          kind: 'resolved',
          text: 'Esta conversa foi finalizada e movida para "Finalizadas".',
        });
      } else if (assigned_team_id !== undefined && assigned_team_id !== null) {
        // Detectar mudança de equipe: comparar com o cache anterior antes do patch.
        // Como o setQueryData acima já mutou, usamos snapshot inferido pelo selected.
        // Preferimos não mostrar banner em primeira atribuição — só quando muda.
        // (Heurística: pipeline+equipe vieram juntos = mudança intencional do agente.)
        if (pipeline !== undefined) {
          setConversationFlowNotice({
            convId: conversationId,
            kind: 'moved_team',
            text: 'O agente atribuiu esta conversa a uma nova equipe.',
          });
        }
      }
    }
  }, [highlightField]);

  const handleWsConversationRemoved = useCallback((data: any) => {
    const removedId = data?.id ?? data?.conversationId;
    if (!removedId) return;
    queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
      old?.filter((c: any) => c.id !== removedId)
    );
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
  }, []);

  const handleWsMessageUpdated = useCallback((data: any) => {
    const { conversationId, messageId, updates } = data || {};
    if (!conversationId || !messageId) return;
    queryClient.setQueryData(
      ["/api/conversations", conversationId, "messages"],
      (old: any[] | undefined) =>
        old?.map((m: any) => m.id === messageId ? { ...m, ...updates } : m)
    );
  }, []);

  const handleWsProtocolUpdated = useCallback((data: any) => {
    const { conversationId, protocolNumero, protocolStatus, protocolSlaViolado, protocol, attachOrphansBefore } = data || {};
    if (!conversationId) return;
    queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
      old?.map(c =>
        c.id === conversationId
          ? { ...c, protocolNumero, protocolStatus, protocolSlaViolado }
          : c
      )
    );

    // Backend pode mandar o protocolo completo junto do broadcast. A feature de
    // Protocolos foi removida, mas o backfill do `protocoloId` nas mensagens em
    // cache continua útil (mantém o agrupamento por atendimento no feed).
    if (protocol && protocol.id) {
      // Backfill do `protocoloId` nas mensagens já no cache que estavam
      // órfãs no momento da criação do protocolo. Espelha o UPDATE que o
      // backend fez nas mensagens órfãs — sem isso, o `firstMsgIdByProto`
      // do MessageArea não reconhecia a primeira mensagem do cliente como
      // pertencente a este protocolo, e o divider só aparecia quando o
      // agente respondesse. Com o patch, aparece no instante da criação.
      const cutoffMs = attachOrphansBefore ? new Date(attachOrphansBefore).getTime() : Date.now();
      queryClient.setQueryData(
        ["/api/conversations", conversationId, "messages"],
        (old: any) => {
          const list: any[] = Array.isArray(old) ? old : (old?.messages ?? old?.data ?? []);
          if (!list.length) return old;
          let touched = false;
          const next = list.map((m: any) => {
            if (m.protocoloId) return m;
            const created = m.createdAt ? new Date(m.createdAt).getTime() : 0;
            if (created && created > cutoffMs) return m;
            touched = true;
            return { ...m, protocoloId: protocol.id };
          });
          if (!touched) return old;
          return Array.isArray(old) ? next : { ...old, messages: next };
        }
      );
      return;
    }
  }, []);

  const handleWsSituationTagApplied = useCallback((data: any) => {
    const { conversationId } = data || {};
    if (!conversationId) return;
    // Invalida AMBAS: a query específica das tags (situation-tags) E a lista
    // de conversas (a tag aplicada também afeta a conv: prioridade, pipeline
    // podem cascade no backend). Antes só invalidava situation-tags e o
    // painel ficava com "Nenhuma situação detectada" até refetch de 15s.
    queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "situation-tags"] });
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    if (selectedIdRef.current === conversationId) {
      highlightField('situacao');
    }
  }, [highlightField]);

  const handleWsProtocolSlaViolated = useCallback((data: any) => {
    const { conversationId, protocolNumero } = data || {};
    if (!conversationId) return;
    // Atualiza a flag protocolSlaViolado no cache da lista de conversas
    queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
      old?.map(c => c.id === conversationId ? { ...c, protocolSlaViolado: true } : c)
    );
    if (selectedIdRef.current === conversationId) {
      setConversationFlowNotice({
        convId: conversationId,
        kind: 'sla_violated',
        text: `⚠️ SLA do protocolo ${protocolNumero ? `#${protocolNumero} ` : ''}foi violado.`,
      });
    }
  }, []);

  // Bruno 2026-05-20: ponte simples pra typing indicator. Quando o WS recebe
  // user_typing, propaga via CustomEvent pra quem ouvir (MessageArea). Evita
  // ter de passar a stream de typing como prop por toda a árvore.
  const handleWsUserTyping = useCallback((data: any) => {
    try {
      window.dispatchEvent(new CustomEvent("chat:user_typing", { detail: data }));
    } catch {}
  }, []);
  const handleWsReactionUpdated = useCallback((data: any) => {
    try {
      window.dispatchEvent(new CustomEvent("chat:reaction_updated", { detail: data }));
    } catch {}
  }, []);
  // Bruno 2026-06-12: nota interna entre atendentes (chat_interno). Sem este
  // handler o broadcast era IGNORADO — a nota só aparecia pra quem enviou (via
  // re-fetch da própria mutation); o OUTRO atendente não a recebia em tempo real.
  // Invalida a query da conversa → a nota entra como bloco CENTRAL ("nota
  // interna"), nunca como bolha do cliente. (O endpoint nunca envia pro cliente.)
  const handleWsChatInternoNew = useCallback((data: any) => {
    const convId = data?.conversationId;
    if (convId == null) return;
    queryClient.invalidateQueries({ queryKey: ["/api/chat-interno", convId] });
  }, []);

  const { connected: wsConnected } = useWebSocket({
    new_message: handleWsNewMessage,
    conversation_updated: handleWsConversationUpdated,
    conversation_removed: handleWsConversationRemoved,
    message_updated: handleWsMessageUpdated,
    protocol_updated: handleWsProtocolUpdated,
    situation_tag_applied: handleWsSituationTagApplied,
    protocol_sla_violated: handleWsProtocolSlaViolated,
    user_typing: handleWsUserTyping,
    reaction_updated: handleWsReactionUpdated,
    chat_interno_new: handleWsChatInternoNew,
  });

  useEffect(() => {
    if (messages.length === 0) return;
    // Quando ancoramos num protocolo específico (vindo da Central de Atendimentos),
    // não rolamos para o final — o foco fica na linha do protocolo até o atendente
    // dispensar o banner de contexto.
    if (contextProtocolId) return;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, [messages.length, contextProtocolId]);

  // Ao voltar do chat interno pro chat com o cliente, rolar para o fim
  // (mensagens recentes). Sem isso o ScrollArea fica preservado no topo após
  // o re-mount, fazendo a conversa parecer "começar do zero" (Bruno, 2026-05-17).
  // Instant (sem smooth) porque é troca de aba — usuário espera snappy.
  useEffect(() => {
    if (chatMode !== "cliente") return;
    if (messages.length === 0) return;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }, 50);
  }, [chatMode]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (assignPanelOpen && assignPanelRef.current && !assignPanelRef.current.contains(t)) {
        setAssignPanelOpen(false);
      }
      if (conexaoDropdownOpen && conexaoDropdownRef.current && !conexaoDropdownRef.current.contains(t)) {
        setConexaoDropdownOpen(false);
      }
    }
    if (assignPanelOpen || conexaoDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [assignPanelOpen, conexaoDropdownOpen]);

  const sendMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/conversations/${selectedId}/messages`, data);
      return res.json() as Promise<Message>;
    },
    onMutate: async (data: any) => {
      const convId = selectedId; // captura selectedId no momento do envio
      const qk = ["/api/conversations", convId, "messages"];
      await queryClient.cancelQueries({ queryKey: qk });
      const prev = queryClient.getQueryData<Message[]>(qk);
      const optimisticId = Date.now();
      const optimistic: Message = {
        id: optimisticId,
        conversationId: convId!,
        texto: data.texto || "",
        direction: "out",
        tipo: data.tipo || "text",
        arquivo: data.arquivo || null,
        nomeArquivo: data.nomeArquivo || null,
        timestamp: new Date().toISOString(),
      } as any;
      queryClient.setQueryData<Message[]>(qk, (old = []) => [...old, optimistic]);
      setNewMsg("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      return { prev, optimisticId, convId };
    },
    onError: (_err: any, _data: any, context: any) => {
      const is422 = typeof _err?.message === "string" && _err.message.startsWith("422");
      if (is422) {
        // Mensagem FOI salva no banco mas a entrega falhou (janela 24h ou outro motivo).
        // Não restauramos o prev — apenas exibimos o aviso e forçamos refetch para que a mensagem
        // salva apareça no chat.
        const isWindowClosed = _err.message.includes("window_closed");
        toast({
          title: isWindowClosed ? "Janela de 24h encerrada" : "Falha na entrega",
          description: isWindowClosed
            ? "Sua mensagem foi salva mas não entregue ao cliente. Use um template HSM para retomar a conversa."
            : "Sua mensagem foi salva mas houve um erro na entrega.",
          variant: "destructive",
        });
        if (context?.convId) {
          queryClient.invalidateQueries({ queryKey: ["/api/conversations", context.convId, "messages"], exact: true });
        }
      } else {
        // Erro genuíno: mensagem NÃO foi salva. Restaura o cache ao estado pré-otimístico.
        if (context?.convId) {
          if (context?.prev !== undefined) {
            queryClient.setQueryData(["/api/conversations", context.convId, "messages"], context.prev);
          } else {
            // prev=undefined significa que a query estava em voo quando mutate foi chamado —
            // remove apenas o otimístico sem apagar o restante do cache.
            queryClient.setQueryData(["/api/conversations", context.convId, "messages"],
              (old: any[] | undefined) => (old || []).filter((m: any) => m.id !== context.optimisticId)
            );
          }
        }
        // Bruno 2026-06-11: mostra a CAUSA real do backend (não mais um genérico
        // fixo). O erro vem no formato "STATUS: {json}" — extrai a `message` do
        // corpo pra o atendente saber o motivo ("Mensagem muito curta", "arquivo
        // inválido", erro do servidor) em vez de só "Erro ao enviar mensagem".
        let motivo = "Tente novamente.";
        const raw = typeof _err?.message === "string" ? _err.message : "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          try {
            const parsed = JSON.parse(raw.slice(jsonStart));
            if (parsed?.message) motivo = String(parsed.message);
          } catch { /* corpo não-JSON — mantém fallback */ }
        } else if (raw) {
          motivo = raw;
        }
        toast({ title: "Erro ao enviar mensagem", description: motivo, variant: "destructive" });
      }
    },
    onSuccess: (realMsg: Message, _data: any, context: any) => {
      if (realMsg?.id && context?.optimisticId && context?.convId) {
        const qk = ["/api/conversations", context.convId, "messages"];
        // Remove otimístico e qualquer duplicata do WS, adiciona a real — sem refetch
        queryClient.setQueryData<Message[]>(qk, (old = []) => {
          const base = Array.isArray(old) ? old : [];
          // Se prev estava definido, usamos ele como base para não perder mensagens históricas
          // caso o cache tenha sido limpo entre onMutate e onSuccess.
          const fallback = Array.isArray(context.prev) ? context.prev : base;
          const merged = [...fallback];
          for (const m of base) {
            if (!merged.some((p: any) => p.id === m.id)) merged.push(m);
          }
          const clean = merged.filter(
            (m: any) => m.id !== context.optimisticId && m.id !== realMsg.id
          );
          return [...clean, realMsg];
        });
        // Se os dados ainda não estavam em cache quando enviamos (prev=undefined),
        // o cancelQueries cancelou o fetch em voo — revalidamos para recuperar as mensagens anteriores.
        if (context.prev === undefined) {
          queryClient.invalidateQueries({ queryKey: qk, exact: true });
        }
        // Atualiza ultimaMensagem na lista diretamente — sem refetch que pode causar race condition
        // (o reassignOnSectorChange corre assíncrono no backend; um refetch imediato pode retornar
        // a conversa sem assignedTeamId, fazendo o backend filtrá-la, e {selected &&} sumir)
        queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
          old?.map((c: any) => c.id === context.convId
            ? { ...c, ultimaMensagem: realMsg.texto, tempo: "agora" }
            : c
          )
        );
        if (context.convId === selectedIdRef.current) {
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      }
    },
    onSettled: () => {
      // NÃO invalida /api/conversations aqui — isso causa race condition com reassignOnSectorChange.
      // O setQueryData acima já atualizou ultimaMensagem. O refetchInterval:20000 sincroniza o resto.
    },
  });

  const currentAgente = signMessages ? currentUserName : undefined;
  const { isRecording, recordingTime, startRecording, stopRecording } = useAudioRecorder(selectedId, sendMutation, currentAgente);
  const { fileInputRef, handleFileSelect } = useFileHandler(selectedId, sendMutation, currentAgente);

  const tagsMutation = useMutation({
    mutationFn: (data: { id: number; tags: string[] }) =>
      apiRequest("PATCH", `/api/conversations/${data.id}/tags`, { tags: data.tags }),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations"], exact: true });
      const prev = queryClient.getQueryData<any[]>(["/api/conversations"]);
      queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
        (old || []).map((c: any) => c.id === data.id ? { ...c, tags: data.tags } : c)
      );
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/conversations"], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (data: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/conversations/${data.id}/status`, { status: data.status }),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations"], exact: true });
      const prev = queryClient.getQueryData<any[]>(["/api/conversations"]);
      queryClient.setQueryData(["/api/conversations"], (old: any[] | undefined) =>
        (old || []).map((c: any) => c.id === data.id ? { ...c, status: data.status } : c)
      );
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) queryClient.setQueryData(["/api/conversations"], context.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    },
  });


  function openResolveDialog(conv: any) {
    setResolveDialogConv(conv);
  }

  const selected = conversations.find((c) => c.id === selectedId) as ConvExtended | undefined;

  // Bruno 2026-05-21: fecha o ConversaDrawer INSTANTANEAMENTE quando a conv
  // selecionada TRANSICIONA pra "resolved" — em modo embed (drawer da
  // Central). Cobre: ResolveDialog clicado, auto-close do agente, outro
  // atendente finalizou via WS, /api/conversations/:id/status PATCH externo.
  //
  // IMPORTANTE: o auto-close NÃO dispara quando o drawer abre numa conv que
  // já estava resolved (clique em card de "Encerrados hoje"). Antes esse
  // efeito disparava na 1ª render e fechava o drawer instantaneamente — o
  // usuário via o modal "piscar" sem conseguir inspecionar a conversa
  // encerrada. Agora só fecha em transição genuína (vi a conv como
  // não-resolved antes, depois ela virou resolved).
  const closedDrawerForResolvedRef = useRef<number | null>(null);
  const sawNonResolvedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!embedMode || !onCloseDrawer || !selected) return;
    if (selected.status !== "resolved") {
      // Marca que vimos essa conv como não-resolved nessa sessão do drawer.
      sawNonResolvedRef.current.add(selected.id);
      return;
    }
    // status === "resolved": só auto-fecha se transicionou (vimos não-resolved
    // antes). Se abriu já resolved, deixa o atendente inspecionar.
    if (!sawNonResolvedRef.current.has(selected.id)) return;
    if (closedDrawerForResolvedRef.current === selected.id) return;
    closedDrawerForResolvedRef.current = selected.id;
    onCloseDrawer();
  }, [embedMode, onCloseDrawer, selected?.id, selected?.status]);

  function getConvTab(conv: any): string {
    if (conv?.status === "resolved") return "resolved";
    const isAiPaused = conv?.aiPaused === true;
    const assignedUserId = conv?.assignedUserId;
    const assignedUserName = conv?.assignedUserName || "";
    const pipelineEtapa = conv?.pipelineEtapa || "";
    const tags: string[] = conv?.tags || [];
    const isBotActive = (!isAiPaused && !assignedUserId) || assignedUserName === "Agente Banana ISP";
    const isInQueue = (isAiPaused || pipelineEtapa.includes("atendimento_humano") || tags.includes("AH")) && !assignedUserId;
    return isInQueue ? "fila" : isBotActive ? "automacao" : "open";
  }

  // ── Auto-troca de aba quando o status/pendente da conversa selecionada muda ──
  // Ex: resolvida recebe nova mensagem → muda pra Em Automação; conversa AH → muda pra Em Fila
  // NÃO muda pra "resolvidas" automaticamente (o autoSelectOnResolve cuida do fluxo de resolução)
  const prevSelectedConvRef = useRef<{ id: number | null; status: string | undefined; pendente: boolean; aiPaused: boolean; assignedUserId: number | null }>({ id: null, status: undefined, pendente: false, aiPaused: false, assignedUserId: null });
  // Marca quando a próxima troca de statusFilter foi disparada por efeito automático
  // (ex.: pós "Assumir") e não por clique do usuário — o auto-close ignora esses casos.
  const autoTabSwitchRef = useRef(false);
  useEffect(() => {
    if (!selected || !initialLoadDone.current) return;
    const prev = prevSelectedConvRef.current;
    const curStatus = selected.status;
    const curPendente = Boolean((selected as any).pendente);
    const curAiPaused = Boolean((selected as any).aiPaused);
    const curAssignedUserId = (selected as any).assignedUserId ?? null;
    const curAssignedUserName = (selected as any).assignedUserName || "";
    const curPipelineEtapa = (selected as any).pipelineEtapa || "";
    const curTags: string[] = (selected as any).tags || [];
    // Só troca de aba se for a MESMA conversa mudando de estado (não quando o usuário muda de seleção).
    // Inclui assignedUserId para cobrir o "Assumir atendimento" — sem isso a conversa some
    // da aba Automação/Fila e o painel volta vazio.
    if (
      prev.id === selected.id
      && (prev.status !== curStatus
        || prev.pendente !== curPendente
        || prev.aiPaused !== curAiPaused
        || prev.assignedUserId !== curAssignedUserId)
    ) {
      if (curStatus === "resolved") return; // autoSelectOnResolve trata esse caso
      const isBotActive = (!curAiPaused && !curAssignedUserId) || curAssignedUserName === "Agente Banana ISP";
      const isInQueue = (curAiPaused || curPipelineEtapa.includes("atendimento_humano") || curTags.includes("AH")) && !curAssignedUserId;
      const targetTab = isInQueue ? "fila" : isBotActive ? "automacao" : "open";
      autoTabSwitchRef.current = true;
      setStatusFilter(targetTab);
    }
    prevSelectedConvRef.current = { id: selected.id, status: curStatus, pendente: curPendente, aiPaused: curAiPaused, assignedUserId: curAssignedUserId };
  }, [selected?.id, selected?.status, (selected as any)?.pendente, (selected as any)?.aiPaused, (selected as any)?.assignedUserId]);

  // ── Auto-seleciona a próxima conversa quando a atual é resolvida e sai da lista ──
  // Em embedMode (drawer da Central de Atendimentos abrindo uma conversa
  // específica) NUNCA auto-pula: o usuário clicou pra ABRIR aquela conv (mesmo
  // resolved). Caso real Bruno 2026-05-19: clicar em conv encerrada (Suzy)
  // abria a próxima ativa (Bruno) porque embedMode também caía neste efeito.
  const autoSelectOnResolveRef = useRef(false);
  useEffect(() => {
    if (embedMode) return;
    if (!selectedId || !initialLoadDone.current) return;
    // Se a conversa selecionada foi resolvida, marca para auto-seleção
    if (selected?.status === "resolved" && statusFilter !== "resolved") {
      autoSelectOnResolveRef.current = true;
    }
  }, [selected?.status, embedMode]);

  const filtered = conversations.filter((c) => {
    const sq = search.toLowerCase();
    const matchSearch = !sq || c.nome.toLowerCase().includes(sq) || (c.telefone || "").toLowerCase().includes(sq) || (c.ultimaMensagem || "").toLowerCase().includes(sq);
    const isPendente = (c as any).pendente === true;
    const isAiPaused = (c as any).aiPaused === true;
    const cAssignedUserId = (c as any).assignedUserId;
    const cAssignedUserName = (c as any).assignedUserName || "";
    const cPipelineEtapa = (c as any).pipelineEtapa || "";
    const cTags: string[] = (c as any).tags || [];
    const isBotActive = (!isAiPaused && !cAssignedUserId) || cAssignedUserName === "Agente Banana ISP";
    const isInQueue = (isAiPaused || cPipelineEtapa.includes("atendimento_humano") || cTags.includes("AH")) && !cAssignedUserId;
    const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const matchStatus = statusFilter === "all"
      ? true
      : statusFilter === "auto_fila"
        ? c.status !== "resolved" && (isBotActive || isInQueue)
        : statusFilter === "automacao"
          // Bruno (2026-05-13): "automacao" e "fila" são abas independentes;
          // fila tem precedência (conversa que virou fila SAI de automação,
          // mesmo que o agente "Banana ISP" continue como responsável).
          ? c.status !== "resolved" && isBotActive && !isInQueue
          : statusFilter === "fila"
            ? c.status !== "resolved" && isInQueue
            : statusFilter === "open"
              ? c.status !== "resolved" && !!cAssignedUserId && !isBotActive && !isInQueue
              : statusFilter === "resolved"
                ? c.status === "resolved" && (!!(c as any).resolvedAt ? new Date((c as any).resolvedAt).getTime() >= cutoff7d : true)
                : c.status === statusFilter;
    const canalLower = c.canal.toLowerCase();
    const isWhatsapp = canalLower === "whatsapp" || canalLower === "whatsapp_official";
    const matchChannel = channelFilter === "whatsapp" ? isWhatsapp : canalLower === channelFilter;
    const cxId = (c as any).conexaoId;
    let matchConexao = true;
    if (conexaoFilter) {
      if (conexaoFilter.startsWith("meta_official_")) {
        matchConexao = canalLower === "whatsapp_official";
      } else {
        matchConexao = cxId === conexaoFilter;
      }
    }
    const isPrivileged = currentUserRole === "admin" || currentUserRole === "superadmin" || currentUserRole === "manager";
    const auid = (c as any).assignedUserId;
    const matchAssignment = isPrivileged || !auid || auid === currentUserId;
    // Conversa selecionada é sempre exibida se o status bate com a aba atual
    // (para não desaparecer ao ser reatribuída, mas SEM ficar presa na aba errada)
    const isSelectedWithMatchingStatus = c.id === selectedId && matchStatus && matchSearch;
    return (matchSearch && matchStatus && matchChannel && matchConexao && matchAssignment) || isSelectedWithMatchingStatus;
  });

  // Ordenação FIFO na aba "Fila": mais antigas no topo, pra atendentes
  // assumirem na ordem de chegada (Bruno 2026-05-13 — antes era um sort
  // composto da aba antiga "Automação/Fila" que priorizava fila acima de
  // automação; agora cada aba é homogênea).
  if (statusFilter === "fila") {
    filtered.sort((a, b) => {
      const aTime = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
      const bTime = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
      return aTime - bTime; // mais antigos no topo
    });
  }

  // Executa auto-seleção quando a conversa resolvida sai da lista filtrada
  useEffect(() => {
    if (embedMode) return; // defesa: drawer da Central nunca auto-pula
    if (!autoSelectOnResolveRef.current) return;
    const isCurrentInList = filtered.some((c) => c.id === selectedId);
    if (!isCurrentInList && filtered.length > 0) {
      autoSelectOnResolveRef.current = false;
      const next = filtered[0];
      setSelectedIdRaw(next.id);
      localStorage.setItem("flowcrm_last_conversation", next.id.toString());
    }
  }, [filtered, selectedId, embedMode]);

  // Fecha a conversa aberta ao trocar para uma aba sem cards.
  // Só age quando a troca foi MANUAL (clique do usuário). Trocas automáticas
  // (ex.: efeito acima após "Assumir") setam autoTabSwitchRef e são ignoradas
  // — assim a conversa permanece aberta enquanto a aba alvo carrega.
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (autoTabSwitchRef.current) {
      autoTabSwitchRef.current = false;
      return;
    }
    // Em embedMode (drawer da Central de Atendimentos) a ConversationList
    // não é renderizada e a seleção vem por prop. Resetar selectedId aqui
    // zerava a conv assim que statusFilter mudava no mount, deixando o
    // drawer travado no empty state. Bruno, 2026-05-18.
    if (embedMode) return;
    // Também guarda contra a corrida de cache miss: se conversations ainda
    // não populou (length 0), filtered também será 0 — não usar isso como
    // sinal de "conv selecionada não visível no filtro".
    if (conversations.length === 0) return;
    if (selectedId && filtered.length === 0) {
      setSelectedIdRaw(null);
      localStorage.removeItem("flowcrm_last_conversation");
    }
  }, [statusFilter]);

  const totalUnread = filtered.filter((c) => c.unread > 0 && c.status !== "resolved").length;

  const handleSend = () => {
    if (!newMsg.trim() || !selectedId) return;
    const payload: any = { texto: newMsg, direction: "out", agente: signMessages ? currentUserName : undefined };
    if (replyingTo?.id) payload.replyToMessageId = replyingTo.id;
    sendMutation.mutate(payload);
    setReplyingTo(null);
  };

  const useQuickReply = (qr: { txt: string; tipoMidia: string | null; arquivoUrl: string | null; arquivoNome: string | null }) => {
    if (sendMutation.isPending) return;
    const contactName = selected?.nome || '';
    const resolvedText = (qr.txt || '')
      .replace(/\{\{nome\}\}/g, contactName)
      .replace(/\{\{empresa\}\}/g, companyName || '');

    if (qr.tipoMidia && qr.arquivoUrl && selectedId) {
      const tipoMap: Record<string, string> = { imagem: "image", pdf: "file", audio: "audio", video: "video" };
      sendMutation.mutate({
        texto: resolvedText,
        direction: "out",
        agente: signMessages ? currentUserName : undefined,
        tipo: tipoMap[qr.tipoMidia] || "text",
        arquivo: qr.arquivoUrl,
        nomeArquivo: qr.arquivoNome || undefined,
      });
    } else {
      setNewMsg(resolvedText);
    }
  };

  function onEmojiSelect(emoji: any) {
    setNewMsg((prev) => prev + emoji.native);
    setShowEmoji(false);
    textareaRef.current?.focus();
  }



  // Só mostra skeleton completo se não temos um convId já definido (navegação direta)
  if (isLoading && !selectedId) {
    return (
      <div className="flex h-full">
        <div className="w-[280px] border-r p-3 space-y-2">
          <Skeleton className="h-8 w-full" />
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
        <div className="flex-1"><Skeleton className="h-full" /></div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">

      {!embedMode && <ConversationList
        conversations={conversations}
        filtered={filtered as ConvExtended[]}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        setChatMode={setChatMode}
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        conexaoFilter={conexaoFilter}
        setConexaoFilter={setConexaoFilter}
        conexoesList={conexoesList}
        availableTags={availableTags}
        totalUnread={totalUnread}
        wsConnected={wsConnected}
        refreshSpinning={refreshSpinning}
        setRefreshSpinning={setRefreshSpinning}
        openResolveDialog={openResolveDialog}
        setConfirmDeleteConv={setConfirmDeleteConv}
        contactsData={contactsData}
        newChatOpen={newChatOpen}
        setNewChatOpen={setNewChatOpen}
        newChatSearch={newChatSearch}
        setNewChatSearch={setNewChatSearch}
        conexaoDropdownOpen={conexaoDropdownOpen}
        setConexaoDropdownOpen={setConexaoDropdownOpen}
        conexaoDropdownRef={conexaoDropdownRef as React.RefObject<HTMLDivElement>}
        channelFilter={channelFilter}
        setChannelFilter={setChannelFilter}
        instagramEnabled={instagramEnabled}
        whatsappEnabled={whatsappEnabled}
        equipesList={equipesList}
      />}

      <MessageArea
        selected={selected}
        selectedId={selectedId}
        messages={messages}
        chatMode={chatMode}
        setChatMode={setChatMode}
        newMsg={newMsg}
        setNewMsg={setNewMsg}
        handleSend={handleSend}
        sendMutation={sendMutation}
        internalMsg={internalMsg}
        setInternalMsg={setInternalMsg}
        internalTarget={internalTarget}
        setInternalTarget={setInternalTarget}
        sendInternalMutation={sendInternalMutation}
        internalMessages={internalMessages}
        workspaceUsers={workspaceUsers}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        workspaceName={companyName}
        meData={meData}
        readOnly={composerReadOnly}
        isRecording={isRecording}
        recordingTime={recordingTime}
        startRecording={startRecording}
        stopRecording={stopRecording}
        showEmoji={showEmoji}
        setShowEmoji={setShowEmoji}
        onEmojiSelect={onEmojiSelect}
        fileInputRef={fileInputRef as React.RefObject<HTMLInputElement>}
        textareaRef={textareaRef as React.RefObject<HTMLTextAreaElement>}
        handleFileSelect={handleFileSelect}
        signMessages={signMessages}
        setSignMessages={setSignMessages}
        conexoesList={conexoesList}
        setContactPopupOpen={setContactPopupOpen}
        messagesEndRef={messagesEndRef as React.RefObject<HTMLDivElement>}
        contactsData={contactsData}
        flowNotice={
          conversationFlowNotice && conversationFlowNotice.convId === selectedId
            ? { kind: conversationFlowNotice.kind, text: conversationFlowNotice.text }
            : null
        }
        onDismissFlowNotice={() => setConversationFlowNotice(null)}
        onReplyToMessage={(m) => setReplyingTo(m)}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onResolveConv={selected ? () => openResolveDialog(selected) : undefined}
        onTransferConv={selected ? () => setTransferDialogOpen(true) : undefined}
        quickReplies={quickReplies}
        useQuickReply={useQuickReply}
      />

      {selected && (
        <ChatRailNav
          active={chatRailTab}
          onSelect={(tab) => setChatRailTab((prev) => (prev === tab ? null : tab))}
          sidebarOpen={actionsSidebarOpen}
          onToggleSidebar={() => setActionsSidebarOpen((v) => !v)}
        />
      )}

      {selected && actionsSidebarOpen && (
        <ActionsSidebar
          key={selectedId}
          selected={selected}
          selectedId={selectedId}
          conversations={conversations}
          activeRailTab={chatRailTab}
          contactsData={contactsData}
          onOpenContactProfile={() => setContactPopupOpen(true)}
          usuariosList={usuariosList}
          equipesList={equipesList}
          allMembers={allMembers}
          availableTags={availableTags}
          quickReplies={quickReplies}
          pipelinesData={pipelinesData}
          pipelineStagesData={pipelineStagesData}
          leadsData={leadsData}
          assignMutation={assignMutation}
          pipelineEtapaMutation={pipelineEtapaMutation}
          assignPanelOpen={assignPanelOpen}
          setAssignPanelOpen={setAssignPanelOpen}
          assignFilter={assignFilter}
          setAssignFilter={setAssignFilter}
          assignTab={assignTab}
          setAssignTab={setAssignTab}
          expandedTeamId={expandedTeamId}
          setExpandedTeamId={setExpandedTeamId}
          assignPanelRef={assignPanelRef as React.RefObject<HTMLDivElement>}
          assignBtnRef={assignBtnRef as React.RefObject<HTMLButtonElement>}
          useQuickReply={useQuickReply}
          setHistoricoDialogConv={setHistoricoDialogConv}
          setSelectedId={setSelectedId}
          setConfirmDeleteConv={setConfirmDeleteConv}
          setStatusFilter={setStatusFilter}
          isHighlighted={isHighlighted}
          readOnly={composerReadOnly}
        />
      )}

      {selected && contactPopupOpen && (
        <ContactPopupResolver
          selected={selected}
          contactsData={contactsData}
          leadsData={leadsData}
          availableTags={availableTags}
          open={contactPopupOpen}
          onClose={() => setContactPopupOpen(false)}
        />
      )}

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        selected={selected || null}
        equipesList={equipesList}
        usuariosList={usuariosList}
        assignMutation={assignMutation}
      />

      {resolveDialogConv && (() => {
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
            // Bruno 2026-05-21: fecha o drawer pai INSTANTANEAMENTE ao finalizar
            // (sem setTimeout). O watcher de status (useEffect abaixo) cobre os
            // outros caminhos — auto-close do agente, finalização por outro
            // atendente via WS, etc.
            onResolveSuccess={embedMode && onCloseDrawer ? onCloseDrawer : undefined}
            availableTags={availableTags as any}
            equipesList={equipesList}
            pipelinesData={pipelinesData}
            pipelineStagesData={pipelineStagesData}
          />
        );
      })()}

      {historicoDialogConv && (
        <HistoricoDialog conv={historicoDialogConv} onClose={() => setHistoricoDialogConv(null)} />
      )}

      <AlertDialog open={confirmDeleteConv !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteConv(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar chat</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as mensagens e dados pendentes deste chat serao removidos permanentemente. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteConvMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteConv && !deleteConvMutation.isPending) deleteConvMutation.mutate(confirmDeleteConv);
              }}
              data-testid="button-confirm-delete"
            >
              {deleteConvMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
