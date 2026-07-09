import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { UseMutationResult, useMutation, useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getSituationTagColor, SITUATION_LABELS, getSituationLabel, type ConversationSituationTag } from "@/lib/situation-tags";
import { getInitials } from "@/lib/constants";
import ContactAvatar from "@/components/ContactAvatar";
import {
  Search, Check, X, User, Users, ArrowRightLeft, ChevronDown,
  Pencil, Trash2, Plus, Clock,
  RefreshCw, Loader2, UserCheck, Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Conversation } from "@shared/schema";
import { WhatsAppIcon, InstagramIcon } from "@/components/brand-icons";
import { agentColor, channelColor, formatTempo, type ConvExtended } from "./helpers";
import CustomerTab from "./CustomerTab";

interface ActionsSidebarProps {
  selected: ConvExtended;
  selectedId: number | null;
  conversations: Conversation[];
  // Bruno 2026-05-21: tab ativo do rail vertical (Início/Cliente/Financeiro/Suporte).
  // Quando "cliente", o painel exibe a ficha compacta do contato em vez do
  // "Painel de Ações" padrão. Restantes ainda caem no default (TBD).
  activeRailTab?: "cliente" | "financeiro" | "suporte" | null;
  contactsData?: any[];
  // Abre o drawer de edição completa da ficha (já existente em inbox.tsx).
  onOpenContactProfile?: () => void;
  usuariosList: any[];
  equipesList: any[];
  allMembers: any[];
  availableTags?: { id: number; nome: string; cor: string }[];
  quickReplies: any[];
  pipelinesData: any[] | undefined;
  pipelineStagesData: any[] | undefined;
  leadsData: any[] | undefined;
  assignMutation: UseMutationResult<any, any, any, any>;
  pipelineEtapaMutation: UseMutationResult<any, any, any, any>;
  assignPanelOpen: boolean;
  setAssignPanelOpen: (b: boolean) => void;
  assignFilter: string;
  setAssignFilter: (s: string) => void;
  assignTab: "equipes" | "usuarios";
  setAssignTab: (t: "equipes" | "usuarios") => void;
  expandedTeamId: string | null;
  setExpandedTeamId: (id: string | null) => void;
  assignPanelRef: React.RefObject<HTMLDivElement>;
  assignBtnRef: React.RefObject<HTMLButtonElement>;
  tagDropdownOpen?: boolean;
  setTagDropdownOpen?: (b: boolean) => void;
  tagDropdownRef?: React.RefObject<HTMLDivElement>;
  editingTag?: { id: number; nome: string; cor: string } | null;
  setEditingTag?: (t: { id: number; nome: string; cor: string } | null) => void;
  newTagName?: string;
  setNewTagName?: (s: string) => void;
  newTagColor?: string;
  setNewTagColor?: (s: string) => void;
  createTagMutation?: UseMutationResult<any, any, any, any>;
  updateTagMutation?: UseMutationResult<any, any, any, any>;
  deleteTagMutation?: UseMutationResult<any, any, any, any>;
  addTagToConversation?: (tag: string) => void;
  removeTagFromConversation?: (tag: string) => void;
  useQuickReply: (qr: any) => void;
  setHistoricoDialogConv: (conv: any) => void;
  setSelectedId: (id: number | null) => void;
  setConfirmDeleteConv?: (id: number | null) => void;
  rightTab?: "acoes" | "resolvidas";
  setRightTab?: (t: "acoes" | "resolvidas") => void;
  resolvedSearch?: string;
  setResolvedSearch?: (s: string) => void;
  setStatusFilter?: (s: string) => void;
  // Highlight pulsante (Q2=c) — quando o agente automatizado muda um campo
  // via WS, o componente pai sinaliza pra animar o card afetado por ~2s.
  // Chave: 'pipeline' | 'prioridade' | 'situacao' | 'atribuicao'.
  isHighlighted?: (field: string) => boolean;
  // Bruno 2026-06-04: contexto READ-ONLY (Relatórios/drawer abrem o inbox em
  // embedMode). Quando true, o painel fica só-leitura mesmo se a conversa
  // estiver assumida — ações (enviar no chat, confirmar, identificar) bloqueadas.
  readOnly?: boolean;
}

export default function ActionsSidebar(props: ActionsSidebarProps) {
  const {
    selected, selectedId, conversations,
    activeRailTab, contactsData, onOpenContactProfile,
    usuariosList, equipesList, allMembers, availableTags, quickReplies,
    pipelinesData, pipelineStagesData, leadsData,
    assignMutation, pipelineEtapaMutation,
    assignPanelOpen, setAssignPanelOpen, assignFilter, setAssignFilter,
    assignTab, setAssignTab, expandedTeamId, setExpandedTeamId,
    assignPanelRef, assignBtnRef,
    tagDropdownOpen, setTagDropdownOpen, tagDropdownRef,
    editingTag, setEditingTag, newTagName, setNewTagName, newTagColor, setNewTagColor,
    createTagMutation, updateTagMutation, deleteTagMutation,
    addTagToConversation, removeTagFromConversation,
    useQuickReply, setHistoricoDialogConv, setSelectedId, setConfirmDeleteConv,
    setStatusFilter,
    isHighlighted,
    readOnly,
  } = props;
  const hl = (field: string) => (isHighlighted?.(field) ? ' field-highlight' : '');

  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Bruno 2026-06-04: gate de MANUSEIO do painel. Só dá pra interagir (enviar
  // no chat, confirmar pagamento, identificar CPF, atribuir) quando a conversa
  // está ASSUMIDA, NÃO finalizada, num contexto ao vivo (não Relatórios/embed),
  // E o usuário é quem ASSUMIU o atendimento OU um ADMIN. Senão, só-leitura.
  const currentUserStr = localStorage.getItem("flowcrm_user");
  const currentUser = currentUserStr ? JSON.parse(currentUserStr) : null;
  const isAdmin = currentUser?.role === "admin";
  const convStatus = String(selected?.status || "").toLowerCase();
  const isResolved = ["resolved", "resolvido", "fechado", "finalizado"].includes(convStatus);
  const assignedUserId = (selected as any)?.assignedUserId;
  const isAssumed = !!assignedUserId;
  const assignedToMe = !!currentUser?.id && String(assignedUserId ?? "") === String(currentUser.id);
  const canInteract = !readOnly && isAssumed && !isResolved && (assignedToMe || isAdmin);
  const blockReason = readOnly
    ? "Visualização — abra no Atendimento para interagir."
    : isResolved
      ? "Conversa finalizada — somente leitura. Reabra para interagir."
      : !isAssumed
        ? "Assuma o atendimento para manusear este painel."
        : (!assignedToMe && !isAdmin)
          ? "Atendimento de outro atendente — somente leitura."
          : null;

  const [transferring, setTransferring] = useState(false);
  const handleTransfer = async (teamId: string, teamName: string) => {
    if (transferring) return;
    setTransferring(true);
    try {
      const res = await apiRequest("POST", `/api/conversations/${selected.id}/transfer-team`, {
        team_id: teamId,
        team_name: teamName,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as any).error || "Erro ao transferir");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      toast({ title: "Transferido", description: `Conversa transferida para ${teamName}` });
      setAssignPanelOpen(false);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setTransferring(false);
    }
  };

  // Bruno 2026-05-21: atribuir setor inline pelo painel de ações. Quando
  // atendente já assumiu (assignedUserId setado) mas conv ainda não tem
  // assignedTeamId, mostra 3 chips Comercial/Financeiro/Suporte e click
  // dispara essa mutation. Difere do handleTransfer porque NÃO solta a
  // conv (não muda assignedUserId — só seta team + pipeline).
  const assignTeamMutation = useMutation({
    mutationFn: async ({ convId, teamId, teamName }: { convId: number; teamId: string; teamName: string }) => {
      const res = await apiRequest("POST", `/api/conversations/${convId}/assign-team`, {
        team_id: teamId,
        team_name: teamName,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erro ao atribuir setor");
      return { ...data, teamName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      toast({ title: "Setor atribuído", description: `Conversa atribuída ao setor ${data.teamName}` });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const [assuming, setAssuming] = useState(false);
  const handleAssume = async () => {
    if (assuming) return;
    setAssuming(true);
    try {
      const res = await apiRequest("POST", `/api/conversations/${selected.id}/assume`, {});
      const data = await res.json();
      if (res.status === 409) {
        toast({ title: "Conflito", description: data.error, variant: "destructive" });
        return;
      }
      if (!res.ok) throw new Error(data.error);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      toast({ title: "Atendimento assumido", description: `Você assumiu o atendimento` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setAssuming(false);
    }
  };

  const convId = selected?.id;
  const { data: convSituationTags = [] } = useQuery<ConversationSituationTag[]>({
    queryKey: ["/api/conversations", convId, "situation-tags"],
    enabled: !!convId,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 5000,
  });

  // Bruno 2026-05-21: "Painel de Ações" REMOVIDO. Sidebar sem header — blocos
  // Pipeline/Prioridade/Tag desapareceram (Pipeline visível no Kanban, prioridade
  // automatic por tag, tag CST no card). Atribuição fica fixa no TOPO em todas
  // as tabs; o resto é roteado por chatRailTab (Início/Cliente/Financeiro/Suporte).
  // Sessão ISP com CPF persistido alimenta tabs Financeiro+Suporte sem precisar
  // re-identificar; se não houver, cada tab tem form próprio.
  //
  // Bruno 2026-06-01 (print Família Reis — CPF some entre abas): o CPF
  // identificado no chat vive em isp_session_state e é exposto por
  // GET /api/conversations/:id/session. A aba Cliente (CustomerTab) já busca isso
  // sozinha; Financeiro/Suporte/Início dependiam de selected.session_cpf (que a
  // LISTA de conversas NÃO popula) → mostravam "Cliente não identificado" mesmo
  // com CPF salvo. Busca a sessão AQUI (uma vez, no pai) e compartilha o CPF entre
  // TODAS as tabs. queryKey idêntica à do CustomerTab → React Query dedupe (1 fetch).
  const { data: sessionData } = useQuery<any>({
    queryKey: ["/api/conversations", convId, "session"],
    enabled: !!convId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/conversations/${convId}/session`, undefined);
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error("Falha ao buscar sessão");
      }
      return res.json();
    },
    staleTime: 10_000,
    // Bruno 2026-06-08: relê SEMPRE ao abrir/reabrir a conversa — senão o cache
    // antigo (cpf NULL, de antes de identificar) vazava no reopen e mostrava
    // "não identificado" mesmo com o CPF já salvo no contato.
    refetchOnMount: "always",
  });
  const sessionCpf = sessionData?.cpf
    || sessionData?.session?.cpf
    || (selected as any)?.session_cpf
    || (selected as any)?.cpf
    || null;

  // Bruno 2026-06-04: CPF persistido no CONTATO (contacts.cpf). Vale como
  // fallback quando a conversa atual ainda não tem CPF identificado — é o que
  // faz o CPF "ficar salvo pras próximas conversas" da mesma pessoa.
  const normPhone = (p: any) => String(p ?? "").replace(/\D/g, "");
  const matchedContact = (() => {
    const list = contactsData; const tel = normPhone(selected?.telefone);
    if (!list?.length || !tel) return null;
    return list.find((c: any) => {
      const cp = normPhone(c.telefone);
      if (!cp) return false;
      if (cp === tel) return true;
      if (cp.startsWith("55") && cp.slice(2) === tel) return true;
      if (tel.startsWith("55") && tel.slice(2) === cp) return true;
      return false;
    }) ?? null;
  })();
  const contactCpf: string | null = matchedContact?.cpf || null;

  // Bruno 2026-05-23: CPF identificado via form compartilhado entre as 3 tabs
  // (Início/Financeiro/Suporte). Antes cada tab tinha seu próprio localCpf e o
  // dado não propagava — identificar em uma exigia re-identificar nas outras.
  // Agora o pai mantém o estado e injeta nas tabs; reset quando a conv muda.
  const [identifiedCpf, setIdentifiedCpf] = useState<string | null>(null);
  // Bruno 2026-06-04: override do atendente (digitou/editou CPF no painel pra
  // pesquisar outro contrato). Vence tudo no painel desta conversa; reset ao
  // trocar de conversa (a próxima resolve pela própria sessão/contato).
  const [overrideCpf, setOverrideCpf] = useState<string | null>(null);
  useEffect(() => {
    setIdentifiedCpf(null);
    setOverrideCpf(null);
  }, [selectedId]);
  const effectiveCpf = overrideCpf || sessionCpf || contactCpf || identifiedCpf;

  // Aplica um CPF digitado/editado no painel: usa já nesta sessão (override) e
  // PERSISTE no contato (vale pras próximas conversas + todas as abas). NÃO
  // mexe na sessão ISP do bot da conversa atual (opção A do Bruno).
  const applyCpf = (rawCpf: string) => {
    const clean = (rawCpf || "").replace(/\D/g, "");
    if (clean.length !== 11) {
      toast({ title: "CPF inválido", description: "Digite os 11 dígitos.", variant: "destructive" });
      return;
    }
    setOverrideCpf(clean);
    // Bruno 2026-06-08: após persistir, invalida /contacts E a /session DESTA
    // conversa. Sem invalidar a /session, o painel ficava com o cache antigo
    // (cpf NULL) e ao fechar/reabrir mostrava "não identificado" mesmo com o CPF
    // já salvo no contato — o /session devolve contacts.cpf como fallback, mas só
    // num refetch. (Em tenant grande o contato não está na lista paginada, então
    // a /session é a única fonte da leitura.)
    const afterSave = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (convId) queryClient.invalidateQueries({ queryKey: ["/api/conversations", convId, "session"] });
    };
    if (matchedContact?.id) {
      apiRequest("PATCH", `/api/contacts/${matchedContact.id}`, { cpf: clean })
        .then(afterSave)
        .catch(() => {});
    } else {
      // Sem contato ainda (ou lista stale na corrida com o auto-create) → CRIA
      // com telefone+CPF. O POST é idempotente e faz upsert do cpf no servidor,
      // cobrindo o caso do contato já existir (inclusive em tenant grande, onde
      // ele não está na lista paginada do front).
      const phone = (selected as any)?.telefone;
      if (phone) {
        apiRequest("POST", "/api/contacts", {
          nome: (selected as any)?.nome || String(phone),
          telefone: phone,
          cpf: clean,
          canal: (selected as any)?.canal || "WhatsApp",
        })
          .then(afterSave)
          .catch(() => {});
      }
    }
  };

  const handleIdentified = (cpf: string) => {
    setIdentifiedCpf(cpf);
    // Refresca a lista de conversas pra trazer session_cpf persistido pelo
    // /api/isp/identify (passa a ser fonte de verdade após reload).
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    // Bruno 2026-06-01: invalida a sessão ISP da conv também — o /identify
    // persiste o CPF em isp_session_state, então o refetch propaga pra TODAS
    // as tabs (Cliente/Financeiro/Suporte) sem precisar re-identificar.
    if (convId) {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", convId, "session"] });
    }
  };

  return (
    <div className="w-[296px] flex-shrink-0 border-l border-border flex flex-col bg-card overflow-hidden sidebar-enter">
      {blockReason && (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-muted/60 border-b border-border flex-shrink-0" data-testid="panel-lock-banner">
          <Lock className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[10px] text-muted-foreground font-medium leading-tight">{blockReason}</span>
        </div>
      )}

      <ScrollArea className="flex-1">
          <div>
            {/* Bruno 2026-05-19: seção "Atribuir / Transferir" migrou pro modal
                TransferDialog acionado pelo botão ArrowLeftRight no header do
                MessageArea. Resumo da atribuição atual permanece visível aqui
                como leitura — ações ficam no modal. */}
            <div className={`border-b border-border p-2.5${!canInteract ? " pointer-events-none opacity-40 select-none" : ""}${hl('atribuicao')}`} data-testid="sidebar-assign-section" ref={assignPanelRef}>
              <div className="label-eyebrow mb-2">Atribuição</div>

              {/* Bruno 2026-05-21: visibilidade do atendente — antes a condição
                  só checava `agente` (text-livre) e `assignedTeamId`. Quando o
                  atendente "Assumia" sem setor, só assignedUserId era setado
                  e o painel mostrava "Sem atribuição" mentindo. Agora cobre
                  assignedUserId/assignedUserName também. */}
              {!selected?.agente
                && !(selected as any).assignedTeamId
                && !(selected as any).assignedUserId
                && !(selected as any).assignedUserName && (
                <div className="text-[10px] text-muted-foreground italic px-0.5">
                  Sem atribuição. Use o botão de transferência no topo do chat.
                </div>
              )}

              {(selected?.agente || (selected as any).assignedTeamId || (selected as any).assignedUserId || (selected as any).assignedUserName) && (() => {
                const assignedTeamId = (selected as any).assignedTeamId;
                const foundTeam = assignedTeamId ? equipesList.find((eq: any) => eq.id === assignedTeamId) : null;
                const isTeam = !!(assignedTeamId || (selected?.agente || "").startsWith("[Equipe]"));
                const teamName = foundTeam?.nome || ((selected?.agente || "").startsWith("[Equipe]") ? selected!.agente.replace("[Equipe] ", "") : null);
                const attendantName = (selected as any).assignedUserName || null;
                // Cores espelham o Fluxograma (Fluxograma.tsx L44-47).
                // Bruno 2026-05-17: padronização visual entre fluxograma,
                // cards de conversa, painel de ações e protocolos.
                const teamColors: Record<string, string> = {
                  "Comercial": "#059669",      // emerald-600
                  "Vendas": "#059669",          // alias
                  "Financeiro": "#d97706",      // amber-600
                  "Suporte": "#2563eb",         // blue-600
                  "Suporte Técnico": "#2563eb",
                  "Suporte Tecnico": "#2563eb",
                  "Cancelamento": "#dc2626",    // red-600
                  "Retenção": "#dc2626",        // alias
                  "Retencao": "#dc2626",
                };
                const tColor = teamName ? (teamColors[teamName] || "#8b5cf6") : "#8b5cf6";
                return (
                  <div className="bg-primary/5 border border-primary/15 rounded-lg mb-2 overflow-hidden">
                    {isTeam && teamName && (
                      <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderLeft: `3px solid ${tColor}` }}>
                        <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${tColor}25` }}>
                          <Users className="w-2.5 h-2.5" style={{ color: tColor }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold truncate" style={{ color: tColor }}>{teamName}</div>
                          <div className="text-[8px] text-muted-foreground">Equipe</div>
                        </div>
                        <Check className="w-3 h-3 flex-shrink-0" style={{ color: tColor }} />
                      </div>
                    )}
                    {isTeam && attendantName && (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border/50" style={{ borderLeft: `3px solid ${tColor}` }}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[7px] font-bold text-white" style={{ backgroundColor: agentColor(attendantName) }}>
                          {getInitials(attendantName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold text-primary truncate">{attendantName}</div>
                          <div className="text-[8px] text-muted-foreground">Atendente</div>
                        </div>
                        <Check className="w-3 h-3 text-primary flex-shrink-0" />
                      </div>
                    )}
                    {isTeam && !attendantName && (
                      <div className="border-t border-border/50" style={{ borderLeft: `3px solid ${tColor}` }}>
                        <div className="flex items-center gap-2 px-2.5 py-1.5">
                          <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <User className="w-2.5 h-2.5 text-muted-foreground" />
                          </div>
                          <div className="text-[9px] text-muted-foreground italic flex-1">Sem atendente</div>
                        </div>
                      </div>
                    )}
                    {!isTeam && (selected.agente || attendantName) && (
                      <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderLeft: "3px solid hsl(var(--primary))" }}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-white" style={{ backgroundColor: agentColor(selected.agente || attendantName || '') }}>
                          {getInitials(selected.agente || attendantName || '')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-bold text-primary truncate">{selected.agente || attendantName}</div>
                          <div className="text-[8px] text-muted-foreground">Atendente</div>
                        </div>
                        <Check className="w-3 h-3 text-primary flex-shrink-0" />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Bruno 2026-05-21: seletor inline de setor — aparece quando
                  conv tem atendente atribuído (assignedUserId) mas AINDA NÃO
                  tem equipe (assignedTeamId). Click numa chip atribui a
                  equipe + move pipeline pra atendimento_humano via /assign-team
                  e o /assign-team já cuida do upsert no Kanban. */}
              {(selected as any).assignedUserId
                && !(selected as any).assignedTeamId
                && !isResolved
                && (() => {
                const activeTeams = (equipesList || []).filter((e: any) => e?.ativo !== false && e?.nome);
                if (activeTeams.length === 0) return null;
                const teamColors: Record<string, { bg: string; color: string; border: string }> = {
                  "Comercial":      { bg: "rgb(16, 185, 129, 0.10)", color: "#059669", border: "#059669" },
                  "Vendas":         { bg: "rgb(16, 185, 129, 0.10)", color: "#059669", border: "#059669" },
                  "Financeiro":     { bg: "rgb(245, 158, 11, 0.10)", color: "#d97706", border: "#d97706" },
                  "Suporte":        { bg: "rgb(59, 130, 246, 0.10)", color: "#2563eb", border: "#2563eb" },
                  "Suporte Técnico":{ bg: "rgb(59, 130, 246, 0.10)", color: "#2563eb", border: "#2563eb" },
                  "Cancelamento":   { bg: "rgb(220, 38, 38, 0.10)",  color: "#dc2626", border: "#dc2626" },
                };
                return (
                  <div className="mt-2 mb-1">
                    <div className="text-[9px] text-muted-foreground mb-1.5">Atribuir a um setor:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeTeams.map((team: any) => {
                        const palette = teamColors[team.nome] || { bg: "rgba(139,92,246,0.10)", color: "#8b5cf6", border: "#8b5cf6" };
                        const isCurrent = (selected as any).assignedTeamId === team.id;
                        return (
                          <button
                            key={team.id}
                            type="button"
                            onClick={() => {
                              if (!selected || assignTeamMutation.isPending) return;
                              assignTeamMutation.mutate({ convId: selected.id, teamId: team.id, teamName: team.nome });
                            }}
                            disabled={assignTeamMutation.isPending || isCurrent}
                            data-testid={`sidebar-team-pill-${team.id}`}
                            className="inline-flex items-center gap-1 px-2 h-6 rounded-full border font-semibold text-[10px] transition-all duration-150 hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: palette.bg,
                              color: palette.color,
                              borderColor: palette.border,
                            }}
                          >
                            <span className="w-1 h-1 rounded-full" style={{ background: palette.color }} aria-hidden />
                            {team.nome}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Bruno 2026-05-21: blocos Pipeline + Prioridade + Tag/Situação
                REMOVIDOS. Substituídos por roteamento por tab. Atendente vê
                Pipeline no Kanban, prioridade vem automática das tags do bot,
                e tags CST ficam visíveis no card do inbox. */}
            {/* Bruno 2026-06-04: gate de manuseio — tabs Cliente/Financeiro/
                Suporte ficam só-leitura (sem clique) quando a conversa não está
                assumida/em andamento, está finalizada, ou é visualização. */}
            <div className={!canInteract ? "pointer-events-none opacity-60 select-none" : ""} data-testid="sidebar-tabs-gate" aria-disabled={!canInteract}>
            {(() => {
              // Tab "cliente" — única após a remoção das abas Financeiro/Suporte (ISP).
              return (
                <CustomerTab
                  selected={selected}
                  contactsData={contactsData}
                  onOpenContactProfile={onOpenContactProfile}
                  effectiveCpf={effectiveCpf}
                  onApplyCpf={applyCpf}
                  availableTags={availableTags}
                />
              );
            })()}
            </div>{/* /sidebar-tabs-gate */}

            {/* ===== BLOCOS LEGADOS REMOVIDOS — Pipeline / Prioridade / Tag ===== */}
            {false && (() => {
              const assignedTeam = (selected as any).assignedTeamId
                ? equipesList.find((eq: any) => eq.id === (selected as any).assignedTeamId)
                : null;
              const activePipelineKey = assignedTeam?.pipelineKey || null;
              const stagesForPipeline = activePipelineKey
                ? (() => { const all = (pipelineStagesData || []).sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0)); const f = all.filter((s: any) => s.pipeline === activePipelineKey); return f.length > 0 ? f : all; })()
                : [];
              const fallbackFirstStage = !selected.pipelineEtapa && stagesForPipeline.length > 0
                ? stagesForPipeline[0]
                : null;
              return stagesForPipeline.length > 0 ? (
                <div className={`border-b border-border p-2.5${isResolved ? " pointer-events-none opacity-40 select-none" : ""}${hl('pipeline')}`} data-testid="sidebar-pipeline-section">
                  <div className="label-eyebrow mb-2">
                    PIPELINE — {(pipelinesData || []).find((p: any) => p.key === activePipelineKey)?.label || activePipelineKey}
                  </div>
                  <div className="space-y-[3px]">
                    {stagesForPipeline.map((stage: any) => {
                      // Distinguir "ativo persistido" (vem do DB) de "ativo por fallback
                      // visual" (Q1=b: primeira etapa quando pipelineEtapa=null).
                      // Importa pro onClick: clicar no fallback deve PERSISTIR a etapa,
                      // não desfazer. Sem essa distinção, atendente clica na primeira
                      // etapa e o mutation envia pipelineEtapa=null (toggle off).
                      const isPersistedActive = !!selected.pipelineEtapa && selected.pipelineEtapa === stage.key;
                      const isFallbackActive = !selected.pipelineEtapa && stage.key === fallbackFirstStage?.key;
                      const isActive = isPersistedActive || isFallbackActive;
                      return (
                        <button
                          key={stage.id}
                          className={`pipe-row w-full ${isActive ? "active" : ""}`}
                          style={{ opacity: isFallbackActive ? 0.85 : 1 }}
                          onClick={() => {
                            if (selected) {
                              pipelineEtapaMutation.mutate({
                                convId: selected.id,
                                pipelineEtapa: isPersistedActive ? null : stage.key,
                              });
                            }
                          }}
                          data-testid={`pipeline-stage-${stage.key}`}
                        >
                          <span className="pipe-dot" />
                          <span className={`truncate text-[12px] ${isActive ? "" : "text-muted-foreground"}`}>{stage.label}</span>
                          {isActive && <Check className="w-3 h-3 flex-shrink-0 ml-auto" style={{ color: "var(--banana-700)" }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="border-b border-border p-2.5 opacity-60" data-testid="sidebar-pipeline-section-empty">
                  <div className="label-eyebrow mb-1">PIPELINE</div>
                  <span className="text-[10px] text-muted-foreground">Atribua uma equipe para ver as etapas</span>
                </div>
              );
            })()}

          </div>
      </ScrollArea>

      {/* Bruno 2026-05-21: Prioridade + Tag/Situação ancorados no rodapé da
          coluna. Prioridade redesenhada em pílulas finas inline (label
          discreto à esquerda, 3 chips compactos), sem icon header. Mantém
          mutation e telemetria intactos. */}
      <div className="flex-shrink-0 border-t border-border bg-card/95">
        <div className={`px-3 py-2 flex items-center gap-2 border-b border-border/60${isResolved ? " pointer-events-none opacity-40 select-none" : ""}${hl('prioridade')}`}>
          <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-[0.08em] flex-shrink-0">Prio</span>
          <div className="flex items-center gap-1 flex-1">
            {[
              { key: "alta",  label: "Alta",  color: "#ef4444" },
              { key: "media", label: "Média", color: "#f59e0b" },
              { key: "baixa", label: "Baixa", color: "#10b981" },
            ].map((p) => {
              const isActive = selected.prioridade === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    const newPrio = isActive ? null : p.key;
                    queryClient.setQueryData(["/api/conversations"], (old: any) =>
                      old ? old.map((c: any) => c.id === selected.id ? { ...c, prioridade: newPrio } : c) : old
                    );
                    apiRequest("PATCH", `/api/conversations/${selected.id}/prioridade`, { prioridade: newPrio }).then(() => {
                      const matchedLead = (leadsData || []).find((l: any) => (l.telefone && selected.telefone && l.telefone === selected.telefone) || l.nome === selected.nome);
                      if (matchedLead) {
                        apiRequest("PATCH", `/api/leads/${matchedLead.id}`, { prioridade: newPrio }).then(() => {
                          queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
                        });
                      }
                    }).catch(() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
                    });
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1 h-6 rounded-full text-[10px] font-semibold transition-all duration-150 hover:brightness-110 active:scale-[0.97]"
                  style={isActive
                    ? { background: `${p.color}1F`, color: p.color, boxShadow: `inset 0 0 0 1px ${p.color}55` }
                    : { background: "transparent", color: "hsl(var(--muted-foreground))", boxShadow: "inset 0 0 0 1px hsl(var(--border))", opacity: 0.7 }
                  }
                  data-testid={`button-priority-${p.key}`}
                  title={`Prioridade: ${p.label}`}
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: isActive ? p.color : "currentColor" }} aria-hidden />
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`px-3 py-2${hl('situacao')}`} data-testid="tags-section">
          <div className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-[0.08em] mb-1.5">Tag / Situação</div>
          <div className="flex flex-wrap gap-1 min-h-[18px]">
            {convSituationTags.length > 0 ? convSituationTags.map((t, i) => {
              const label = getSituationLabel(t.code, t.slug);
              const palette: Record<string, { bg: string; color: string; border: string }> = {
                success: { bg: 'rgba(22, 163, 74, 0.18)',   color: 'rgb(21, 128, 61)',  border: 'rgba(22, 163, 74, 0.55)' },
                warning: { bg: 'rgba(245, 158, 11, 0.22)',  color: 'rgb(146, 64, 14)',  border: 'rgba(245, 158, 11, 0.6)' },
                banana:  { bg: 'var(--banana-100)',         color: 'var(--banana-800)', border: 'var(--banana-400)' },
                neutral: { bg: 'hsl(var(--muted))',         color: 'hsl(var(--foreground))', border: 'hsl(var(--border))' },
                danger:  { bg: 'rgba(220, 38, 38, 0.18)',   color: 'rgb(185, 28, 28)',  border: 'rgba(220, 38, 38, 0.55)' },
              };
              const variant: keyof typeof palette =
                /^N1$/i.test(t.code) ? "danger"
                : /^AH$/i.test(t.code) ? "neutral"
                : /^FAQ$/i.test(t.code) ? "neutral"
                : /^C/i.test(t.code) ? "success"
                : /^F/i.test(t.code) ? "warning"
                : /^S/i.test(t.code) ? "banana"
                : "neutral";
              const p = palette[variant];
              return (
                <span
                  key={t.id || i}
                  className="font-mono inline-flex items-center"
                  style={{
                    padding: '1px 7px',
                    fontSize: '10px',
                    fontWeight: 700,
                    borderRadius: 999,
                    lineHeight: 1.4,
                    letterSpacing: '0.01em',
                    background: p.bg,
                    color: p.color,
                    border: `1px solid ${p.border}`,
                  }}
                  title={`${t.code} — ${label} (${t.origin === 'auto' ? 'automático' : 'manual'})`}
                  data-testid={`situation-tag-${t.code}`}
                >
                  {t.code}
                </span>
              );
            }) : (
              <span className="text-[10px] text-muted-foreground/70 italic">Nenhuma situação detectada</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
