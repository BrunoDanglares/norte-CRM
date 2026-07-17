import { Fragment, useRef, useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { UseMutationResult, useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatWallpaper } from "./ChatWallpaper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { getInitials, sanitizeDisplayName } from "@/lib/constants";
import ContactAvatar from "@/components/ContactAvatar";
import { useLocation } from "wouter";
import type { Message } from "@shared/schema";
import {
  Send, MessageSquare, Phone, Mail, Hash, User, Paperclip,
  Smile, Mic, FileText, Image, File, Play, Download, MapPin,
  Lock, MessageCircle, Trash2, Wifi, Users, Zap, Bot, X, Clock,
  Maximize2, ExternalLink, Shield, AlertTriangle, ListOrdered, CornerDownRight, ChevronRight, ChevronDown, Loader2, UserCheck, RefreshCw,
  CircleX, ArrowLeftRight, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { WhatsAppIcon, InstagramIcon } from "@/components/brand-icons";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import MiniAudioPlayer from "./MiniAudioPlayer";
import MessageContextMenu from "./MessageContextMenu";
import LinkPreview from "./LinkPreview";
import { useConversationReactions, ReactionPicker, ReactionList } from "./MessageReactions";
import StatusIcon from "./StatusIcon";
import ContactPickerDialog from "./ContactPickerDialog";
import LocationPickerDialog from "./LocationPickerDialog";
import { SECTOR_COLORS } from "@/lib/situation-tags";
import { channelColor, agentColor, formatVistoDetalhado, formatRecordingTime, captionFromMessageText, isPureMediaPlaceholder, type ConvExtended } from "./helpers";
import { LiveDuration } from "./LiveDuration";
import { parseWhatsAppText, isEmojiOnly } from "@/utils/formatMessage";

function channelIcon(canal: string) {
  const c = canal.toLowerCase();
  if (c === "whatsapp") return <Phone className="w-[7px] h-[7px] text-white" />;
  if (c === "instagram") return <Hash className="w-[7px] h-[7px] text-white" />;
  if (c === "email") return <Mail className="w-[7px] h-[7px] text-white" />;
  return <MessageSquare className="w-[7px] h-[7px] text-white" />;
}

// Bruno 2026-05-21: bolha de fallback pra mídia inbound que falhou no download
// inicial. Webhook grava mediaId + downloadFailed=true em vez da URL CDN
// (que expira em ~5min). Botão tenta re-baixar via POST /api/messages/:id/retry-media.
// Sucesso → backend atualiza arquivo, broadcast invalida a query, bolha re-renderiza
// com a mídia carregada.
function MediaRetryBubble({
  msgId,
  label,
  icon,
}: {
  msgId: number;
  label: string;
  icon: React.ReactNode;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/messages/${msgId}/retry-media`, {});
      const data = await res.json();
      if (data?.ok && data.arquivo) {
        toast({ description: "Mídia re-baixada com sucesso." });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      } else {
        toast({ description: data?.error || "Falha ao re-baixar mídia.", variant: "destructive" });
      }
    } catch (err: any) {
      const msg = err?.message || "Erro ao re-baixar mídia.";
      toast({ description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 w-[220px] p-3 rounded-lg bg-muted/40 border border-border" data-testid={`media-retry-${msgId}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-[12px] italic">{label}</span>
      </div>
      <button
        type="button"
        onClick={handleRetry}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md bg-background border border-border hover:bg-accent transition-colors disabled:opacity-50"
        data-testid={`media-retry-button-${msgId}`}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        {loading ? "Baixando..." : "Re-baixar"}
      </button>
    </div>
  );
}

// Bruno 2026-07-16: o áudio chega e é salvo certinho, mas a transcrição pode
// falhar por motivo TRANSITÓRIO — o caso real foi a chave OpenAI estourar quota
// (429) e o circuit breaker do resolveTranscriptionCandidates bloquear a chave
// por 5min: nessa janela a transcrição volta vazia e o texto fica "[áudio]".
// Este botão re-roda o Whisper no arquivo que JÁ está no disco (não re-baixa
// nada — o arquivo está íntegro). Aparece só em áudio inbound sem transcrição.
function TranscribeButton({ msgId }: { msgId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const handleTranscribe = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/messages/${msgId}/transcribe`, {});
      const data = await res.json();
      if (data?.ok && data.texto) {
        toast({ description: "Áudio transcrito." });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      } else {
        toast({ description: data?.error || "Não consegui transcrever este áudio.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ description: err?.message || "Erro ao transcrever.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={handleTranscribe}
      disabled={loading}
      title="Transcrever este áudio"
      className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md bg-background/70 border border-border hover:bg-accent transition-colors disabled:opacity-50"
      data-testid={`msg-transcribe-button-${msgId}`}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
      {loading ? "Transcrevendo..." : "Transcrever"}
    </button>
  );
}

// Separador horizontal entre atendimentos no chat. Marca o início de um novo
// protocolo, organizando visualmente o histórico quando o mesmo contato passa
// por várias conversas. Também serve de âncora para rolagem ao abrir um
// protocolo a partir da Central de Atendimentos.
function ProtocolDivider({ pid, meta }: { pid: string; meta: any | null }) {
  const numero = meta?.numero?.replace(/^PRT-/, "");
  const status = meta?.status as string | undefined;
  const categoria = meta?.categoria as string | undefined;
  const slaViolado = !!meta?.slaViolado;

  const statusLabel = status === "aberto" ? "Aberto"
    : status === "em_andamento" ? "Em andamento"
    : status === "resolvido" ? "Finalizado"
    : status === "fechado" ? "Fechado"
    : status || "";
  const statusColor = status === "resolvido" ? "#5DCAA5"
    : status === "em_andamento" ? "#F59E0B"
    : status === "fechado" ? "var(--muted-foreground)"
    : "#EF9F27";
  const categoriaLabel = categoria === "suporte_tecnico" ? "Suporte"
    : categoria === "financeiro" ? "Financeiro"
    : categoria === "comercial" ? "Comercial"
    : categoria === "geral" ? "Geral"
    : categoria || "";

  return (
    <div
      data-protocol-divider={pid}
      data-testid={`protocol-divider-${pid}`}
      className="flex items-center gap-2 my-4 select-none"
      style={{ scrollMarginTop: 16 }}
    >
      <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
      <div
        className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[10.5px] font-semibold"
        style={{
          background: slaViolado ? "rgba(226,75,74,0.10)" : "hsl(var(--secondary))",
          border: `1px solid ${slaViolado ? "rgba(226,75,74,0.30)" : "hsl(var(--border))"}`,
          color: slaViolado ? "#E24B4A" : "var(--foreground)",
        }}
      >
        <Shield className="w-3 h-3" style={{ color: slaViolado ? "#E24B4A" : statusColor }} />
        {numero ? (
          <span className="font-mono" style={{ color: slaViolado ? "#E24B4A" : statusColor }}>
            #{numero}
          </span>
        ) : (
          <span style={{ color: "var(--muted-foreground)" }}>Atendimento</span>
        )}
        {categoriaLabel && (
          <span className="text-[9.5px] opacity-70 font-medium">· {categoriaLabel}</span>
        )}
        {statusLabel && (
          <span className="text-[9.5px] opacity-70 font-medium">· {statusLabel}</span>
        )}
        {slaViolado && (
          <AlertTriangle className="w-2.5 h-2.5" />
        )}
      </div>
      <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
    </div>
  );
}

interface MessageAreaProps {
  selected: ConvExtended | undefined;
  selectedId: number | null;
  messages: Message[];
  chatMode: "cliente" | "interno";
  setChatMode: (m: "cliente" | "interno") => void;
  newMsg: string;
  setNewMsg: (s: string) => void;
  handleSend: () => void;
  sendMutation: UseMutationResult<any, any, any, any>;
  internalMsg: string;
  setInternalMsg: (s: string) => void;
  internalTarget: string;
  setInternalTarget: (s: string) => void;
  sendInternalMutation: UseMutationResult<any, any, any, any>;
  internalMessages: any[];
  workspaceUsers: any[];
  currentUserId: number | undefined;
  currentUserName: string;
  workspaceName: string;
  meData: any;
  // Bruno 2026-06-04: contexto read-only (Relatórios/drawer abrem em embedMode).
  // Quando true, o composer fica fechado — visualização só-leitura.
  readOnly?: boolean;
  isRecording: boolean;
  recordingTime: number;
  startRecording: () => void;
  stopRecording: (send: boolean) => void;
  showEmoji: boolean;
  setShowEmoji: (b: boolean) => void;
  onEmojiSelect: (emoji: any) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  signMessages: boolean;
  setSignMessages: (b: boolean) => void;
  conexoesList: any[];
  setContactPopupOpen: (b: boolean) => void;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  contactsData?: any[];
  // Banner discreto (Q4=b) quando o agente automatizado muda o status/equipe
  // da conversa selecionada — atendente vê aviso sem perder a conversa de
  // vista nem ser bloqueado por modal.
  flowNotice?: { kind: 'resolved' | 'moved_team' | 'sla_violated'; text: string } | null;
  onDismissFlowNotice?: () => void;
  onReplyToMessage?: (msg: any) => void;
  replyingTo?: any | null;
  onCancelReply?: () => void;
  // Bruno 2026-05-19: ações rápidas no header. Resolver e Transferir.
  // Visíveis APENAS quando há conversa selecionada e conv != resolvida.
  onResolveConv?: () => void;
  onTransferConv?: () => void;
  // Bruno 2026-05-19: respostas rápidas migraram pro composer (gatilho "/").
  // Antes ficavam num grid no ActionsSidebar — agora abrem como autocomplete
  // acima do textarea quando o atendente digita "/" como primeiro caractere.
  quickReplies?: Array<{ title: string; txt: string; tipoMidia: string | null; arquivoUrl: string | null; arquivoNome: string | null }>;
  useQuickReply?: (qr: { title: string; txt: string; tipoMidia: string | null; arquivoUrl: string | null; arquivoNome: string | null }) => void;
}

// Bruno (2026-05-13): renderiza a lista interativa do WhatsApp no chat com o
// MESMO comportamento visual do app — botão "Ver opções" colapsado por
// padrão; ao clicar, expande as rows (title + description). State local
// por mensagem (cada bolha lembra se foi aberta).
function InteractiveListMenu({
  meta, msgId, msgDir, buttonLabelFallback, onRowClick,
}: {
  meta: { sections?: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>; buttonLabel?: string };
  msgId: number | string;
  msgDir: "in" | "out";
  buttonLabelFallback: string;
  onRowClick: (row: { title: string; description?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!meta?.sections?.length) return null;
  const buttonLabel = (meta.buttonLabel || buttonLabelFallback || "Ver opções").toUpperCase();

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`menu-toggle-${msgId}`}
        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wide border transition-all duration-150 cursor-pointer ${
          msgDir === "out"
            ? "bg-black/10 text-black/85 border-black/20 hover:bg-black/15 active:bg-black/20"
            : "bg-primary/5 text-primary border-primary/15 hover:bg-primary/10 active:bg-primary/15"
        }`}
      >
        <ListOrdered className="w-3.5 h-3.5" />
        <span>{buttonLabel}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="mt-1.5 space-y-1.5">
          {meta.sections.map((sec, si) => (
            <div key={si}>
              {sec.title && (
                <div className={`text-[10px] font-semibold mt-1 ${msgDir === "out" ? "text-black/75" : "text-foreground/70"}`}>
                  {sec.title}
                </div>
              )}
              {sec.rows?.map((row, ri) => {
                // Bruno 2026-05-15: trim defensivo — description pode chegar
                // como string vazia '' (caller antigo) ou só whitespace; tratar
                // como ausência pra não renderizar div vazia.
                const desc = (row.description || '').trim();
                const hasDesc = desc.length > 0;
                return (
                  <button
                    key={ri}
                    type="button"
                    data-testid={`menu-item-${msgId}-${ri}`}
                    onClick={() => onRowClick({ title: row.title, description: hasDesc ? desc : undefined })}
                    className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-lg mt-0.5 text-[12px] text-left transition-all duration-150 ${
                      msgDir === "out"
                        ? "bg-black/8 text-black/90 hover:bg-black/15 active:bg-black/20 active:scale-[0.98]"
                        : "bg-primary/5 border border-primary/10 hover:bg-primary/10 hover:border-primary/20 active:bg-primary/15 active:scale-[0.98]"
                    } cursor-pointer`}
                  >
                    <CornerDownRight className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-50" />
                    <div className="flex-1">
                      <div className="font-semibold">{row.title}</div>
                      {hasDesc && (
                        <div
                          className={`text-[10.5px] mt-0.5 leading-snug ${
                            msgDir === "out" ? "text-black/65" : "text-foreground/55"
                          }`}
                        >
                          {desc}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-30" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MessageArea({
  selected, selectedId, messages, chatMode, setChatMode,
  newMsg, setNewMsg, handleSend, sendMutation,
  internalMsg, setInternalMsg, internalTarget, setInternalTarget,
  sendInternalMutation, internalMessages, workspaceUsers,
  currentUserId, currentUserName, workspaceName, meData, readOnly,
  isRecording, recordingTime, startRecording, stopRecording,
  showEmoji, setShowEmoji, onEmojiSelect,
  fileInputRef, textareaRef, handleFileSelect,
  signMessages, setSignMessages, conexoesList,
  setContactPopupOpen, messagesEndRef, contactsData,
  flowNotice, onDismissFlowNotice,
  onReplyToMessage, replyingTo, onCancelReply,
  onResolveConv, onTransferConv,
  quickReplies, useQuickReply,
}: MessageAreaProps) {
  const [, navigate] = useLocation();
  const [aiActive, setAiActive] = useState(!selected?.aiPaused);
  const [mediaLightbox, setMediaLightbox] = useState<{ type: "image" | "video"; src: string; caption?: string; raw?: string } | null>(null);
  // Bruno 2026-05-21: dialogs do composer pra enviar contato e localização.
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);

  // Bruno 2026-05-19: picker de respostas rápidas no composer. Abre quando o
  // textarea começa com "/"; tudo após a barra vira query de filtro (título e
  // corpo). Setas ↑/↓ navegam, Enter aplica, Esc cancela. Pra mídia (PDF/áudio/
  // imagem/vídeo) o useQuickReply já dispara o envio direto — aqui só limpamos
  // o "/" do textarea. Pra texto, o handler do pai sobrescreve o newMsg com o
  // template resolvido (substitui {{nome}}/{{empresa}}).
  const [qrIndex, setQrIndex] = useState(0);
  const qrTrigger = newMsg.startsWith("/");
  const qrQuery = qrTrigger ? newMsg.slice(1).trim().toLowerCase() : "";
  const qrFiltered = useMemo(() => {
    if (!qrTrigger || !quickReplies?.length) return [] as NonNullable<typeof quickReplies>;
    if (!qrQuery) return quickReplies.slice(0, 12);
    return quickReplies
      .filter((qr) =>
        qr.title.toLowerCase().includes(qrQuery) ||
        (qr.txt || "").toLowerCase().includes(qrQuery)
      )
      .slice(0, 12);
  }, [qrTrigger, qrQuery, quickReplies]);
  const qrOpen = qrTrigger && qrFiltered.length > 0;

  useEffect(() => {
    setQrIndex(0);
  }, [qrQuery, qrTrigger]);

  const applyQuickReply = (qr: { title: string; txt: string; tipoMidia: string | null; arquivoUrl: string | null; arquivoNome: string | null } | undefined) => {
    if (!qr || !useQuickReply) return;
    // Mídia é enviada direto pelo handler — o textarea ainda tem o "/<query>",
    // então limpamos antes pra não sobrar lixo. Pro texto, useQuickReply já
    // sobrescreve newMsg.
    if (qr.tipoMidia && qr.arquivoUrl) {
      setNewMsg("");
    }
    useQuickReply(qr);
    textareaRef.current?.focus();
  };

  const qrIconFor = (tipoMidia: string | null) => {
    if (tipoMidia === "imagem") return <Image className="w-3.5 h-3.5 opacity-70" />;
    if (tipoMidia === "pdf") return <FileText className="w-3.5 h-3.5 opacity-70" />;
    if (tipoMidia === "audio") return <Mic className="w-3.5 h-3.5 opacity-70" />;
    if (tipoMidia === "video") return <Play className="w-3.5 h-3.5 opacity-70" />;
    return <MessageSquare className="w-3.5 h-3.5 opacity-70" />;
  };

  useEffect(() => {
    setAiActive(!selected?.aiPaused);
  }, [selected?.id, selected?.aiPaused]);

  useEffect(() => {
    if (!newMsg && textareaRef.current) {
      textareaRef.current.style.height = "";
    }
  }, [newMsg, textareaRef]);

  useEffect(() => {
    if (!mediaLightbox) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMediaLightbox(null); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mediaLightbox]);

  const aiToggleMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      await apiRequest("PATCH", `/api/conversations/${selected?.id}/ai-paused`, { aiPaused: paused });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
    },
  });

  // Bruno 2026-05-21: admin não toma mais conversa. Quando admin abre conv de
  // outro atendente, ele entra em modo espectador (vê o chat) e só pode mandar
  // mensagem interna pelo composer. O label do botão e o helper line refletem
  // isso — sem takeover.
  const currentUserRole: string = meData?.data?.role || "";
  const isManager = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(currentUserRole);
  // Bruno 2026-05-21: team membership gating do takeover.
  //   - Admin/atendente SEM nenhuma equipe → não pode assumir (espectador puro).
  //   - Admin COM equipes → só assume conv cuja assignedTeamId está nas suas
  //     equipes (ou conv sem equipe atribuída).
  // Notas internas seguem liberadas independente disso (regra de produto:
  // admin sem equipe ainda lê/escreve nota interna).
  //
  // IMPORTANTE: meData pode estar carregando OU vir de cache anterior ao
  // deploy desta funcionalidade (sem o campo teamIds). Nesses casos NÃO
  // travamos — só viramos espectador quando temos confirmação explícita do
  // backend (Array, mesmo que vazio). Stale cache é tolerado até a próxima
  // janela de staleTime (2min) ou refetch on-focus.
  const teamIdsRaw = (meData?.data as any)?.teamIds;
  const teamIdsLoaded = Array.isArray(teamIdsRaw);
  const myTeamIds: string[] = teamIdsLoaded ? teamIdsRaw : [];
  const hasNoTeams = teamIdsLoaded && myTeamIds.length === 0;
  const convTeamId: string | null = (selected as any)?.assignedTeamId ?? null;
  const notInConvTeam = teamIdsLoaded && !!convTeamId && !myTeamIds.includes(convTeamId);

  const assignedToMe = !!(selected?.assignedUserId && currentUserId && selected.assignedUserId === currentUserId);
  const assignedToOther = !!(selected?.assignedUserId && currentUserId && selected.assignedUserId !== currentUserId);
  // Espectador (composer só libera em chatMode="interno"):
  //   1. conv é de outro atendente — admin que abre vê chat interno;
  //   2. admin sem nenhuma equipe — não pode assumir, mas escreve nota interna;
  //   3. admin com equipes mas fora da equipe atribuída desta conv.
  // Atendentes não-admin sem equipe / fora da equipe não caem aqui — o GET
  // /api/conversations já oculta essas conversas pra eles (conversations.ts:117).
  const isManagerSpectator = !!(
    assignedToOther ||
    (isManager && hasNoTeams) ||
    (isManager && notInConvTeam)
  );
  // Bruno 2026-05-21: permissões granulares pro composer.
  //  - canTypeCliente: pode escrever pro cliente (dono real da conv)
  //  - canSeeInternal: pode ler/escrever nota interna (admin ou dono)
  //  - canTakeOver: pode clicar "Assumir" (conv livre + tem equipe compatível)
  //  - canType: composer aparece se algum dos 2 acima é true (senão cai no CTA Assumir grande)
  const notResolved = !!selected && selected.status !== "resolved";
  const canTypeCliente = notResolved && assignedToMe;
  const canSeeInternal = notResolved && (isManager || assignedToMe);
  const canTakeOver = notResolved && !(selected as any)?.assignedUserId && !hasNoTeams && !notInConvTeam;
  const canType = canTypeCliente || canSeeInternal;

  // Bruno 2026-05-21: chatMode reseta a cada conv pra não vazar contexto.
  // Default sempre "cliente" (inclusive Admin) — nota interna é opt-in.
  useEffect(() => {
    setChatMode("cliente");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Bruno 2026-05-18: botão "Assumir atendimento" agora vive no rodapé do chat
  // (onde estaria o composer) em vez do ActionsSidebar. CTA mais imediato
  // — atendente bate o olho e sabe o próximo passo. Mesmo endpoint do botão
  // antigo (POST /:id/assume) pra preservar lógica de conflito (409).
  const { toast } = useToast();

  const assumeMutation = useMutation({
    mutationFn: async (convId: number) => {
      const res = await apiRequest("POST", `/api/conversations/${convId}/assume`, {});
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const err: any = new Error(data.error || "Conversa já em atendimento");
        err.conflict = true;
        throw err;
      }
      if (!res.ok) throw new Error(data.error || "Erro ao assumir");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      toast({
        title: "Atendimento assumido",
        description: "Você assumiu o atendimento",
      });
    },
    onError: (err: any) => {
      toast({
        title: err.conflict ? "Conflito" : "Erro",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Bruno 2026-05-20: reactions de emoji por mensagem. Hook puxa todas as
  // reactions da conv atual em um map { messageId -> [reactions] }, invalidado
  // ao receber WS reaction_updated (propagado via CustomEvent pelo inbox.tsx).
  const reactionsByMsg = useConversationReactions(selectedId);
  useEffect(() => {
    function onReactionUpdated() {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", selectedId, "reactions"] });
    }
    window.addEventListener("chat:reaction_updated", onReactionUpdated as EventListener);
    return () => window.removeEventListener("chat:reaction_updated", onReactionUpdated as EventListener);
  }, [selectedId]);

  // Bruno 2026-05-20: typing indicator entre atendentes. Quando outro atendente
  // do mesmo workspace está digitando na MESMA conversa que tenho aberta,
  // aparece "Fulano está digitando…" abaixo do header. Evento via WS,
  // propagado por CustomEvent (window) pelo inbox.tsx pra evitar prop drilling.
  // TTL 3s desde último evento — sem hook on-blur do composer remoto, o
  // timer expira sozinho. Próprio user não conta (filtra pelo userId).
  const [typingUsers, setTypingUsers] = useState<{ userName: string; at: number }[]>([]);
  useEffect(() => {
    function onTyping(ev: Event) {
      const detail = (ev as CustomEvent).detail || {};
      if (!selectedId || detail.conversationId !== selectedId) return;
      if (detail.userId === currentUserId) return;
      setTypingUsers((prev) => {
        const filtered = prev.filter((u) => u.userName !== detail.userName);
        return [...filtered, { userName: detail.userName || "Atendente", at: Date.now() }];
      });
    }
    window.addEventListener("chat:user_typing", onTyping as EventListener);
    return () => window.removeEventListener("chat:user_typing", onTyping as EventListener);
  }, [selectedId, currentUserId]);

  useEffect(() => {
    if (typingUsers.length === 0) return;
    const t = setInterval(() => {
      setTypingUsers((prev) => prev.filter((u) => Date.now() - u.at < 3000));
    }, 1000);
    return () => clearInterval(t);
  }, [typingUsers.length]);

  // Emite POST /typing com throttle de 3s — manda no primeiro keystroke e
  // re-arma a cada 3s enquanto continua digitando.
  const lastTypingSentRef = useRef(0);
  useEffect(() => {
    if (!newMsg || !selectedId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    apiRequest("POST", `/api/conversations/${selectedId}/typing`, {}).catch(() => {});
  }, [newMsg, selectedId]);

  // Bruno 2026-05-20: busca dentro da conversa (Ctrl+F / Cmd+F). Captura o
  // atalho enquanto o chat está aberto, abre input flutuante no topo da área
  // de mensagens, filtra por texto e navega entre matches com Enter/Shift+Enter.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchMatches = useMemo(() => {
    if (!searchOpen || !searchQuery.trim()) return [] as number[];
    const q = searchQuery.trim().toLowerCase();
    return messages
      .filter((m: any) => !m.deletedAt && typeof m.texto === "string" && m.texto.toLowerCase().includes(q))
      .map((m: any) => m.id as number);
  }, [searchOpen, searchQuery, messages]);

  useEffect(() => {
    setSearchIdx(0);
  }, [searchQuery, searchOpen]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const isFind = (e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F");
      if (isFind) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, searchOpen]);

  useEffect(() => {
    if (!searchOpen || searchMatches.length === 0) return;
    const target = searchMatches[Math.max(0, Math.min(searchIdx, searchMatches.length - 1))];
    const el = document.querySelector(`[data-msg-id="${target}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("msg-flash-highlight");
      setTimeout(() => el.classList.remove("msg-flash-highlight"), 1200);
    }
  }, [searchIdx, searchMatches, searchOpen]);

  const searchGo = (delta: 1 | -1) => {
    if (searchMatches.length === 0) return;
    setSearchIdx((i) => (i + delta + searchMatches.length) % searchMatches.length);
  };

  // Bruno 2026-05-20: FAB scroll-to-bottom — quando o atendente rola pra cima
  // pra ler histórico, aparece um botão flutuante pra voltar ao fim. Usa
  // IntersectionObserver no messagesEndRef: invisível = mostra botão.
  const [showScrollFab, setShowScrollFab] = useState(false);
  useEffect(() => {
    const el = messagesEndRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowScrollFab(!entry.isIntersecting),
      { threshold: 0.01, rootMargin: "0px 0px -80px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [messagesEndRef, selectedId]);

  // Bruno 2026-05-21: popup "Escolha o setor" REMOVIDO. Decisão de produto:
  // assumir SEMPRE atribui direto ao atendente clicador, sem barreira de setor.
  // Atendente decide o setor manualmente DEPOIS, via TransferDialog (botão de
  // transferência no header) com a conversa já em andamento.
  const { data: equipesData } = useQuery<{ ok: boolean; data: any[] }>({
    queryKey: ["/api/equipes"],
    staleTime: 5 * 60 * 1000,
  });
  const equipesAtivas = useMemo(() => {
    const list = equipesData?.data || [];
    return list.filter((e: any) => e?.ativo !== false && e?.nome);
  }, [equipesData]);

  const handleAssumeClick = (convId: number) => {
    if (!selected) return;
    assumeMutation.mutate(convId);
  };

  // Bruno 2026-05-21: handler do composer decide o destino baseado no
  // chatMode. Em modo "interno" envia pra /api/chat-interno (nota lateral
  // no feed, cliente nunca recebe). Em modo "cliente" cai no handleSend
  // original (rota normal de mensagem).
  const handleComposerSend = () => {
    if (chatMode === "interno") {
      const texto = newMsg.trim();
      if (!texto) return;
      sendInternalMutation.mutate({ texto });
      setNewMsg("");
      return;
    }
    handleSend();
  };


  // Bruno 2026-05-18: reabrir conversa resolved direto do rodapé do chat
  // (em vez do banner Lock antigo). Backend já atribui ao usuário que reabriu
  // (PATCH /:id/reopen seta assignedUserId), então o composer aparece
  // automaticamente após invalidar a query — chat continua aberto no drawer.
  const reopenMutation = useMutation({
    mutationFn: async (convId: number) => {
      const res = await apiRequest("PATCH", `/api/conversations/${convId}/reopen`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || "Erro ao reabrir");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      queryClient.invalidateQueries({ queryKey: ["/api/messages", selected?.id] });
      toast({ title: "Atendimento reaberto", description: "A conversa voltou para em andamento" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  // Mapa: protocoloId → ID da PRIMEIRA mensagem desse protocolo. Permite
  // marcar onde inserir o separador horizontal no chat. Mensagens sem
  // protocoloId (legadas/órfãs) não geram separador.
  const firstMsgIdByProto = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of messages) {
      const pid = (m as any).protocoloId as string | null | undefined;
      if (pid && !map.has(pid)) map.set(pid, m.id);
    }
    return map;
  }, [messages]);

  // Bruno 2026-05-20: lookup O(1) da mensagem citada quando msg.replyToMessageId
  // é populado. Usado pra renderizar o quote-preview dentro da bolha + permitir
  // clicar no quote pra rolar até a mensagem original.
  const messagesById = useMemo(() => {
    const map = new Map<number, any>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bruno 2026-05-21: feed agora intercala msgs do cliente com notas internas
  // (chat_interno) ordenadas por createdAt. Item interno carrega `__internal=true`
  // e renderiza como nota lateral central (estilo msg de sistema, fundo amarelo
  // discreto, borda tracejada) em vez de bubble de chat.
  const mergedFeed = useMemo(() => {
    const items: any[] = [];
    for (const m of messages) items.push(m);
    for (const n of internalMessages || []) {
      items.push({ ...n, __internal: true, id: `int-${n.id}` });
    }
    items.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return ta - tb;
    });
    return items;
  }, [messages, internalMessages]);

  // Scroll + flash highlight na msg original quando clica no quote.
  const scrollToMessage = (msgId: number) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("msg-flash-highlight");
    setTimeout(() => el.classList.remove("msg-flash-highlight"), 1600);
  };

  if (!selected) {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 flex items-center justify-center relative">
          <ChatWallpaper />
          <div className="text-center select-none relative z-10">
            <div className="empty-state-float mb-5">
              <div className="w-28 h-28 mx-auto rounded-full grid place-items-center" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                <MessageSquare className="w-12 h-12" style={{ color: "hsl(var(--primary) / 0.45)" }} strokeWidth={1.6} />
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground/50">Escolha uma conversa ao lado para começar</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div key={selectedId} className="flex-1 flex flex-col min-w-0 overflow-hidden conv-area-enter">
      <>
        <div className="relative px-4 py-2.5 bg-card border-b border-border flex items-center justify-between flex-shrink-0" style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Bruno 2026-05-21: header sempre mostra info do contato.
                Modo interno é sinalizado apenas pelo banner amarelo do composer
                e pelas notas inline no feed — sem trocar identidade do chat. */}
            <>
                {(() => {
                  // Bruno 2026-06-18: foto do header clicável → abre no lightbox de mídia
                  // (mesmo visualizador das imagens do chat). Resolve a fotoUrl 1× p/ reuso.
                  const headerFotoUrl: string | null = selected.avatar || (() => {
                    if (!selected.telefone || !contactsData) return null;
                    const raw = String(selected.telefone).replace(/\D/g, "");
                    const match = contactsData.find((c: any) => {
                      const cr = String(c.telefone || "").replace(/\D/g, "");
                      return cr === raw || cr === `55${raw}` || (cr.startsWith("55") && cr.slice(2) === raw);
                    });
                    return match?.fotoUrl ?? null;
                  })();
                  return (
                    <div className="relative flex-shrink-0">
                      <ContactAvatar
                        nome={selected.nome}
                        fotoUrl={headerFotoUrl}
                        size={36}
                        rounded="50%"
                        onClick={headerFotoUrl ? () => setMediaLightbox({ type: "image", src: headerFotoUrl!, caption: selected.nome }) : undefined}
                      />
                      <div
                        className="absolute -bottom-[3px] -right-[3px] w-[14px] h-[14px] rounded-[4px] flex items-center justify-center border-[1.5px] border-card"
                        style={{ background: channelColor(selected.canal) }}
                        title={selected.canal}
                      >
                        {channelIcon(selected.canal)}
                      </div>
                    </div>
                  );
                })()}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      className="font-display text-[15.5px] font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer bg-transparent border-none p-0"
                      onClick={() => { setContactPopupOpen(true); }}
                      data-testid="text-conversation-name"
                    >
                      {sanitizeDisplayName(selected.nome) || selected.telefone || "Cliente"}
                    </button>
                    {selected.empresa && (
                      <span className="text-[10.5px] text-muted-foreground">&middot; {selected.empresa}</span>
                    )}
                    {(() => {
                      const cx = conexoesList.find((c: any) => c.id === (selected as any).conexaoId);
                      return cx ? (
                        <span className="text-[8.5px] px-[6px] py-[1px] rounded-[8px] font-semibold bg-primary/10 text-primary flex items-center gap-1" data-testid="badge-conexao-name">
                          <Wifi className="w-2.5 h-2.5" />{cx.nome}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="text-[11.5px] text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {typingUsers.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-500 font-medium" data-testid="typing-indicator">
                        <span className="inline-flex gap-0.5">
                          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "120ms" }} />
                          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: "240ms" }} />
                        </span>
                        {typingUsers.length === 1
                          ? `${typingUsers[0].userName} está digitando…`
                          : `${typingUsers.length} pessoas digitando…`}
                      </span>
                    ) : null}
                    {typingUsers.length === 0 && (() => {
                      const vistoText = formatVistoDetalhado(selected.updatedAt as any);
                      const isRecent = vistoText === "agora" || (vistoText.includes("min") && parseInt(vistoText.replace(/\D/g, "")) <= 5);
                      return (
                        <span className={`flex items-center gap-1 ${isRecent ? "text-emerald-400" : "text-muted-foreground"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isRecent ? "bg-emerald-400" : "bg-muted-foreground"}`} />
                          {isRecent ? "ativo agora" : vistoText ? `visto ${vistoText}` : ""}
                        </span>
                      );
                    })()}
                    {(() => {
                      // Cronômetro do TURNO ATUAL, não da conversa inteira. Usa
                      // lastCustomerMessageAt como início do turno corrente (a
                      // base por protocolo saiu com o módulo Protocolos). Conversa
                      // resolvida congela em resolvedAt. NUNCA usa selected.createdAt
                      // (data da conv inteira).
                      let startRaw: string | null = null;
                      let endRaw: string | null = null;

                      if ((selected as any).lastCustomerMessageAt) {
                        startRaw = (selected as any).lastCustomerMessageAt;
                        endRaw = (selected as any).status === 'resolved' ? ((selected as any).resolvedAt || null) : null;
                      } else {
                        return null;
                      }

                      const isResolved = !!endRaw;
                      return (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span
                            className="inline-flex items-center gap-1 tabular-nums"
                            title={isResolved ? "Duração do atendimento (aberto → resolvido)" : "Tempo do atendimento atual — tick ao vivo"}
                          >
                            <Clock className="w-2.5 h-2.5" />
                            <LiveDuration start={startRaw} end={endRaw} />
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Bruno 2026-05-19: ações rápidas — Resolver (X vermelho) + Transferir.
                Mostradas só quando há conversa selecionada que NÃO está resolvida.
                Estilo "card button" com bg sutil, border, sombra (mesma vibe shadcn). */}
            {selected && selected.status !== "resolved" && (onTransferConv || onResolveConv) && (
              <div className="flex items-center gap-1 mr-0.5">
                {onTransferConv && (
                  <button
                    type="button"
                    onClick={onTransferConv}
                    className="w-8 h-8 rounded-lg inline-flex items-center justify-center bg-card border border-border text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/30 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    title="Transferir atendimento"
                    aria-label="Transferir atendimento"
                    data-testid="btn-header-transfer"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>
                )}
                {onResolveConv && (
                  <button
                    type="button"
                    onClick={onResolveConv}
                    className="w-8 h-8 rounded-lg inline-flex items-center justify-center bg-card border border-border text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/35 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    title="Finalizar conversa"
                    aria-label="Finalizar conversa"
                    data-testid="btn-header-resolve"
                  >
                    <CircleX className="w-4 h-4" />
                  </button>
                )}
                <span aria-hidden className="w-px h-5 bg-border/70 mx-1" />
              </div>
            )}
            {/* Bruno 2026-05-21: removido o par Chat/Interno do header.
                O switch entre os dois modos agora vive INLINE no composer
                (botão "Nota interna" ao lado dos outros — paperclip, emoji…). */}
          </div>
        </div>


        {flowNotice && (
          <div
            className="flex-shrink-0 border-b flex items-center gap-2 px-4 py-2"
            style={{
              background: flowNotice.kind === 'sla_violated'
                ? 'rgba(226,75,74,0.10)'
                : flowNotice.kind === 'resolved'
                  ? 'rgba(93,202,165,0.10)'
                  : 'hsl(var(--primary)/0.06)',
              borderColor: flowNotice.kind === 'sla_violated'
                ? 'rgba(226,75,74,0.30)'
                : flowNotice.kind === 'resolved'
                  ? 'rgba(93,202,165,0.30)'
                  : 'hsl(var(--primary)/0.20)',
            }}
            data-testid="flow-notice-bar"
          >
            <span className="text-[11px] font-medium" style={{
              color: flowNotice.kind === 'sla_violated'
                ? '#E24B4A'
                : flowNotice.kind === 'resolved'
                  ? '#5DCAA5'
                  : 'hsl(var(--primary))',
            }}>
              {flowNotice.text}
            </span>
            <button
              className="ml-auto flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={onDismissFlowNotice}
              title="Fechar aviso"
              data-testid="button-dismiss-flow-notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bruno 2026-05-21: removido o "Chat Secreto" como aba separada.
            Notas internas agora vivem inline no feed principal (estilo nota
            lateral) e o composer alterna entre cliente/interno via banner. */}
        <>

        <div className="flex flex-col flex-1 relative overflow-hidden" style={{ minHeight: 0 }}>
          <ChatWallpaper />
          {/* Bruno 2026-05-20: barra de busca flutuante (Ctrl+F). Aparece no
              topo do chat com input + counter + navegação. Esc fecha. */}
          {searchOpen && (
            <div
              className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-full bg-card border border-border shadow-lg backdrop-blur-sm"
              data-testid="chat-search-bar"
              style={{ boxShadow: "0 6px 20px rgba(0,0,0,0.15)" }}
            >
              <Search className="w-3.5 h-3.5 text-muted-foreground ml-1" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchGo(e.shiftKey ? -1 : 1);
                  } else if (e.key === "Escape") {
                    setSearchOpen(false);
                    setSearchQuery("");
                  }
                }}
                placeholder="Buscar na conversa…"
                className="bg-transparent outline-none text-[12.5px] w-[220px] placeholder:text-muted-foreground/70"
                data-testid="chat-search-input"
              />
              <span className="text-[10.5px] tabular-nums text-muted-foreground px-1 min-w-[44px] text-center">
                {searchQuery.trim() === "" ? "" : searchMatches.length === 0 ? "0/0" : `${searchIdx + 1}/${searchMatches.length}`}
              </span>
              <button
                type="button"
                onClick={() => searchGo(-1)}
                disabled={searchMatches.length === 0}
                className="w-6 h-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30"
                title="Anterior (Shift+Enter)"
                aria-label="Match anterior"
              >
                <ChevronDown className="w-3.5 h-3.5 rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => searchGo(1)}
                disabled={searchMatches.length === 0}
                className="w-6 h-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-30"
                title="Próximo (Enter)"
                aria-label="Próximo match"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                className="w-6 h-6 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary"
                title="Fechar (Esc)"
                aria-label="Fechar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {/* Overlay sutil — radial gradients pigmentando o chat com a cor do
              tema. Bruno 2026-05-21: era rgba(250,194,9,...) banana hardcoded;
              agora usa --primary com opacidade baixa, então o fundo segue
              banana/lilac/blue/orange automaticamente. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none z-[1] chat-bg-wash"
          />
        <ScrollArea className="relative z-10 flex-1 msg-scroll-area" style={{ background: 'transparent' }}>
          <div className="w-full flex flex-col" style={{ padding: "24px clamp(6px, 1.5vw, 16px) 24px" }}>
            {mergedFeed.map((msg, idx) => {
              // Bruno 2026-05-21: notas internas (chat_interno) renderizam
              // ANTES de qualquer outra lógica, no estilo "nota lateral"
              // centralizada. Não passam pela máquina de bubble do chat.
              if (msg.__internal) {
                const horaInt = msg.createdAt
                  ? new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                  : "";
                return (
                  <div key={msg.id} className="flex justify-center my-2 px-2" data-testid={`internal-note-${msg.id}`}>
                    <div
                      className="px-3 py-1.5 rounded-md max-w-[78%]"
                      style={{
                        // Bruno 2026-05-21: azul claro (sky-500) pra diferenciar
                        // notas internas das mensagens do cliente (banana).
                        background: "rgba(14,165,233,0.10)",
                        border: "1px dashed rgba(14,165,233,0.45)",
                      }}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] mb-0.5">
                        <Lock className="w-2.5 h-2.5" style={{ color: "rgba(14,165,233,0.95)" }} />
                        <span className="font-semibold" style={{ color: "rgba(14,165,233,0.95)" }}>
                          {(msg.userName || "").trim().replace(/\s+/g, " ")}
                        </span>
                        <span className="text-muted-foreground/70">· nota interna</span>
                      </div>
                      <div className="text-[12px] leading-snug whitespace-pre-wrap text-foreground/90">
                        {msg.texto}
                      </div>
                      <div className="text-[9px] text-muted-foreground/70 mt-0.5 text-right tabular-nums">
                        {horaInt}
                      </div>
                    </div>
                  </div>
                );
              }
              // Bruno 2026-05-20: separador "Hoje / Ontem / dd 'de' MMMM"
              // antes da primeira msg de cada dia. Substitui o "Hoje"
              // hardcoded — agora reflete o dia real de cada mensagem.
              const msgDate = (() => {
                const raw = (msg as any).createdAt;
                if (!raw) return null;
                const d = new Date(raw);
                return Number.isNaN(d.getTime()) ? null : d;
              })();
              // prev/next ignoram notas internas pra preservar agrupamento por dia
              // e sameSenderAsPrev/Next entre msgs reais.
              const prevMsgRaw = (() => {
                for (let j = idx - 1; j >= 0; j--) if (!mergedFeed[j].__internal) return mergedFeed[j];
                return null;
              })();
              const prevDate = (() => {
                if (!prevMsgRaw) return null;
                const raw = (prevMsgRaw as any).createdAt;
                if (!raw) return null;
                const d = new Date(raw);
                return Number.isNaN(d.getTime()) ? null : d;
              })();
              const sameDayAsPrev = msgDate && prevDate
                && msgDate.getFullYear() === prevDate.getFullYear()
                && msgDate.getMonth() === prevDate.getMonth()
                && msgDate.getDate() === prevDate.getDate();
              const showDateSep = !!msgDate && !sameDayAsPrev;
              const dateSepLabel = (() => {
                if (!msgDate) return null;
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const startOfMsg = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
                const diffDays = Math.round((startOfToday.getTime() - startOfMsg.getTime()) / 86_400_000);
                if (diffDays === 0) return "Hoje";
                if (diffDays === 1) return "Ontem";
                if (diffDays < 7) return msgDate.toLocaleDateString("pt-BR", { weekday: "long" });
                if (msgDate.getFullYear() === now.getFullYear()) {
                  return msgDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
                }
                return msgDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
              })();
              const dateDivider = showDateSep && dateSepLabel ? (
                <div key={`day-${idx}`} className="flex justify-center my-3" data-testid={`date-sep-${idx}`}>
                  <span className="msg-date-sep capitalize">{dateSepLabel}</span>
                </div>
              ) : null;
              const isRecent = idx >= messages.length - 10;
              const animDelay = isRecent ? `${(idx - (messages.length - 10)) * 18}ms` : "0ms";

              // Separador horizontal entre atendimentos: aparece antes da
              // primeira mensagem de cada protocolo, dividindo conversas
              // distintas do mesmo contato. Mensagens sem protocoloId
              // (legadas/órfãs) não disparam separador.
              const pid = (msg as any).protocoloId as string | null | undefined;
              const isFirstOfProto = !!(pid && firstMsgIdByProto.get(pid) === msg.id);
              // Metadados do protocolo saíram com o módulo Protocolos; o divider
              // agrupa atendimentos pelo protocoloId das mensagens (dado vivo) e
              // renderiza um separador neutro ("Atendimento").
              const separator = isFirstOfProto && pid ? (
                <ProtocolDivider key={`div-${pid}`} pid={pid} meta={null} />
              ) : null;

              // Mensagens de sistema: nota interna discreta, nunca bolha
              if ((msg as any).direction === 'system' || (msg as any).tipo === 'system') {
                return (
                  <Fragment key={msg.id}>
                    {dateDivider}
                    {separator}
                    <div
                      className={isRecent ? "msg-enter-system" : ""}
                      style={{
                        textAlign: 'center',
                        margin: '10px 0',
                        fontSize: 11,
                        color: 'var(--muted-foreground)',
                        opacity: 0.65,
                        userSelect: 'none',
                        letterSpacing: '0.01em',
                        animationDelay: isRecent ? animDelay : undefined,
                      }}
                      data-testid={`system-msg-${msg.id}`}
                    >
                      ── {msg.texto} ──
                    </div>
                  </Fragment>
                );
              }

              const prevMsg = (() => {
                for (let j = idx - 1; j >= 0; j--) if (!mergedFeed[j].__internal) return mergedFeed[j];
                return null;
              })();
              const nextMsg = (() => {
                for (let j = idx + 1; j < mergedFeed.length; j++) if (!mergedFeed[j].__internal) return mergedFeed[j];
                return null;
              })();
              const sameSenderAsPrev = prevMsg && prevMsg.direction === msg.direction;
              const sameSenderAsNext = nextMsg && nextMsg.direction === msg.direction;
              const isOut = msg.direction === "out";
              const texto = msg.texto || "";
              const msgTipo = (msg as any).tipo || "text";
              const emojiOnly = isEmojiOnly(texto) && msgTipo === "text";
              // Pra cards (imagem/áudio/interactive/menu legado), o timestamp
              // deve aparecer no FIM (canto inferior direito), não inline.
              // Pra texto puro, o timestamp usa float:right e se encaixa na
              // última linha (padrão WhatsApp).
              const isCardLayout =
                msgTipo === "interactive" ||
                msgTipo === "image" ||
                msgTipo === "audio" ||
                msgTipo === "document" ||
                texto.startsWith("[Menu]") ||
                texto.startsWith("[Botões]");

              // Bruno 2026-05-14: msg.hora pode vir null pra mensagens
              // persistidas sem setar o campo (CSAT, NPS, schedulers, qualquer
              // chamador de insertMessageWithProtocol que omite `hora`). Cai
              // pro createdAt formatado em HH:MM (timezone São Paulo) pra
              // garantir que TODA mensagem mostra timestamp.
              // Bruno 2026-06-04: alguns inserts gravam `hora` como placeholder
              // inválido (ex: "x" das baterias) — isso aparecia no lugar do
              // horário na bolha do CLIENTE. Só aceita HH:MM; qualquer outra
              // coisa (placeholder/lixo/null) cai pro createdAt (horário real).
              const horaRaw = typeof msg.hora === "string" ? msg.hora.trim() : "";
              const horaDisplay = /^\d{1,2}:\d{2}/.test(horaRaw) ? horaRaw : (() => {
                const ts = (msg as any).createdAt;
                if (!ts) return "";
                try {
                  return new Date(ts).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Sao_Paulo",
                  });
                } catch {
                  return "";
                }
              })();

              const bubbleRadius = isOut
                ? (sameSenderAsNext ? "8px 8px 3px 8px" : "8px 8px 0 8px")
                : (sameSenderAsNext ? "8px 8px 8px 3px" : "8px 8px 8px 0");

              return (
              <Fragment key={msg.id}>
              {dateDivider}
              {separator}
              <div
                className={`flex flex-col ${isOut ? "items-end" : "items-start"}${isRecent ? (isOut ? " msg-enter-out" : " msg-enter-in") : ""}`}
                style={{ marginBottom: sameSenderAsNext ? 2 : 10, animationDelay: isRecent ? animDelay : undefined, scrollMarginTop: 80, scrollMarginBottom: 80, borderRadius: 8 }}
                data-testid={`message-${msg.id}`}
                data-msg-id={msg.id}
              >
                {isOut && !sameSenderAsPrev && (() => {
                  const raw = msg.agente || "";
                  // Bruno 2026-06-09 (auditoria Nekt): o BOT é o ÚNICO outbound que
                  // grava agente='Banana AI' (ispSendService sempre seta). Qualquer
                  // outro outbound (atendente assinado, não-assinado=workspaceName,
                  // ou echo do WhatsApp Business com agente=null) é HUMANO. Antes,
                  // `!raw` (agente null) e `raw===workspaceName` caíam no avatar de
                  // bot → áudio/echo do atendente aparecia como "Banana AI falando
                  // depois do humano assumir" (falso positivo que enganou a própria
                  // auditoria). Agora só agente='Banana AI' é bot.
                  const isBananaAI = /banana\s*ai/i.test(raw) || raw === "Agente Banana ISP";
                  const isBotAvatar = isBananaAI;
                  const displayName = isBananaAI
                    ? (workspaceName || "Assistente")
                    : (raw || "Atendente");
                  const avatarBg = isBotAvatar ? "hsl(var(--primary))" : agentColor(displayName);
                  const avatarFg = isBotAvatar ? "hsl(var(--primary-foreground))" : "white";
                  return (
                    <div className="text-muted-foreground flex items-center gap-1" style={{ fontSize: "0.7rem", fontWeight: 700, opacity: 0.7, marginBottom: 2 }}>
                      <div
                        className="w-[14px] h-[14px] rounded text-[6.5px] font-extrabold flex items-center justify-center"
                        style={{ background: avatarBg, color: avatarFg }}
                      >
                        {getInitials(displayName)}
                      </div>
                      {displayName}
                    </div>
                  );
                })()}
                <div className="msg-bubble-wrapper group relative" style={{ maxWidth: "min(68%, 540px)" }}>
                  {/* Bruno 2026-05-21: action bar lateral fora da bolha. Antes
                      o chevron e o reaction trigger ficavam absolute DENTRO da
                      bolha, encobrindo o texto em mensagens curtas (ex: "Vou
                      explicar"). Agora os ícones ficam no espaço lateral
                      interno (à esquerda da bolha outbound, à direita da
                      inbound), verticalmente centrados. opacity-0 no idle e
                      revela no hover do wrapper (.group) ou quando algum filho
                      ganha foco (focus-within cobre teclado / dropdown aberto). */}
                  {!emojiOnly && !msg.deletedAt && (
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 z-30 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${isOut ? "right-full mr-1.5" : "left-full ml-1.5"}`}
                      data-testid={`msg-actions-${msg.id}`}
                    >
                      {currentUserId && (
                        <ReactionPicker
                          messageId={msg.id}
                          conversationId={selectedId!}
                          currentUserId={currentUserId}
                          reactions={reactionsByMsg[msg.id] || []}
                          isOut={isOut}
                        />
                      )}
                      <MessageContextMenu
                        msg={msg}
                        conversationId={selectedId!}
                        onReply={(m) => onReplyToMessage?.(m)}
                        isOut={isOut}
                      />
                    </div>
                  )}
                  <div
                    className={`msg-bubble ${
                      emojiOnly
                        ? "msg-emoji-only"
                        : isOut
                          ? "gradient-accent msg-bubble-out"
                          : "bg-secondary border border-border msg-bubble-in"
                    }`}
                    style={{
                      borderRadius: emojiOnly ? "0" : bubbleRadius,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "break-word",
                      wordBreak: "break-word",
                      // Bruno 2026-05-15: pra cards, padding-bottom extra
                      // acomoda o timestamp absolute no canto inferior direito.
                      padding: emojiOnly ? "4px 0" : "7px 12px",
                      boxShadow: emojiOnly ? "none" : "0 1px 0.5px rgba(0,0,0,0.13)",
                      background: emojiOnly ? "transparent" : undefined,
                      border: emojiOnly ? "none" : undefined,
                      // relative pra timestamp absolute do isCardLayout ancorar aqui.
                      position: isCardLayout ? "relative" : undefined,
                      opacity: msg.deletedAt ? 0.55 : undefined,
                    }}
                  >
                    {/* Timestamp ANTES do conteúdo pra texto puro: com float:right
                        ele se encaixa no fim da última linha (padrão WhatsApp).
                        Pra cards, o timestamp é renderizado DEPOIS como linha
                        separada — ver `isCardLayout` mais abaixo. */}
                    {!emojiOnly && !isCardLayout && (
                      <span className="msg-timestamp-inline">
                        {(msg as any).editedAt && !(msg as any).deletedAt && (
                          <span className="italic opacity-70 mr-1" title="Mensagem editada">editada</span>
                        )}
                        <span>{horaDisplay}</span>
                        {isOut && <StatusIcon status={msg.status} />}
                      </span>
                    )}
                    {/* Bruno 2026-05-20: quote preview da msg citada (replyTo).
                        Renderiza DENTRO da bolha, com barra colorida à esquerda.
                        Click → scroll + flash na msg original (padrão WhatsApp). */}
                    {(msg as any).replyToMessageId && !(msg as any).deletedAt && (() => {
                      const quoted = messagesById.get((msg as any).replyToMessageId);
                      if (!quoted) {
                        return (
                          <div className="mb-1.5 px-2 py-1 rounded bg-black/5 dark:bg-white/10 border-l-[3px] border-foreground/30 text-[11px] italic opacity-70">
                            Mensagem original não disponível
                          </div>
                        );
                      }
                      const qIsOut = quoted.direction === "out";
                      const qTipo = quoted.tipo || "text";
                      const qLabel = qIsOut ? (quoted.agente || "Você") : (selected?.nome || "Cliente");
                      const qPreview =
                        qTipo === "audio" ? "🎤 Áudio"
                        : qTipo === "image" ? "🖼️ Imagem"
                        : qTipo === "document" || qTipo === "file" ? `📄 ${quoted.nomeArquivo || "Documento"}`
                        : qTipo === "video" ? "🎬 Vídeo"
                        : (quoted.texto || "").slice(0, 120);
                      return (
                        <button
                          type="button"
                          onClick={() => scrollToMessage(quoted.id)}
                          className={`block w-full text-left mb-1.5 px-2 py-1 rounded border-l-[3px] transition-colors cursor-pointer ${
                            isOut
                              ? "bg-black/10 hover:bg-black/15 border-black/60"
                              : "bg-foreground/10 hover:bg-foreground/15 border-primary"
                          }`}
                          data-testid={`msg-quote-${msg.id}`}
                          title="Ir para a mensagem original"
                        >
                          <div className={`text-[10.5px] font-semibold mb-0.5 ${isOut ? "text-black/80" : "text-primary"}`}>
                            {qLabel}
                          </div>
                          <div className={`text-[12px] truncate ${isOut ? "text-black/70" : "text-foreground/75"}`}>
                            {qPreview}
                          </div>
                        </button>
                      );
                    })()}
                    {(() => {
                      const tipo = (msg as any).tipo || "text";
                      const arquivo = (msg as any).arquivo || "";
                      const nomeArquivo = (msg as any).nomeArquivo || "";
                      const texto = msg.texto || "";

                      // Bruno 2026-05-19: msg excluída — placeholder italic. NÃO
                      // renderiza conteúdo original. Histórico fica preservado
                      // no banco (deletedAt + originalTexto inexistente; é
                      // soft-delete, dado bruto continua acessível pra auditoria).
                      if ((msg as any).deletedAt) {
                        return (
                          <div className="flex items-center gap-1.5 italic text-foreground/60" style={{ fontSize: "12.5px" }} data-testid={`msg-deleted-${msg.id}`}>
                            🚫 Mensagem excluída
                          </div>
                        );
                      }

                      if (tipo === "image" && arquivo) {
                        const imgProxy = /fbcdn\.net|cdninstagram\.com|scontent/i.test(arquivo);
                        const imgSrc = imgProxy ? `/api/media-proxy?url=${encodeURIComponent(arquivo)}` : arquivo;
                        // Bruno 2026-05-22: usa helper que cobre todos placeholders
                        // ([imagem], [figurinha], [sticker], [video], etc) — antes só
                        // filtrava "[imagem]"/"[image]" e sticker virava "[figurinha]"
                        // de caption embaixo da imagem.
                        const caption = captionFromMessageText(texto);
                        return (
                          <div className="max-w-[260px] cursor-pointer group" onClick={() => setMediaLightbox({ type: "image", src: imgSrc, caption, raw: arquivo })} data-testid={`msg-image-${msg.id}`}>
                            <div className="relative">
                              <img
                                src={imgSrc}
                                alt={nomeArquivo || "Imagem"}
                                className="max-w-full max-h-[200px] rounded-lg object-cover"
                                onError={(e) => {
                                  const img = e.target as HTMLImageElement;
                                  img.style.display = "none";
                                  const fallback = img.parentElement?.querySelector(".img-fallback");
                                  if (fallback) (fallback as HTMLElement).style.display = "flex";
                                }}
                              />
                              <div className="img-fallback hidden items-center justify-center gap-2 w-[200px] h-[120px] rounded-lg bg-muted/50 border border-border">
                                <Image className="w-5 h-5 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Imagem indisponível</span>
                              </div>
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                                <Maximize2 className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                              </div>
                            </div>
                            {caption && <p className="text-[12px] mt-1 whitespace-pre-wrap break-words">{caption}</p>}
                          </div>
                        );
                      }
                      if (tipo === "image" && !arquivo && texto.startsWith("[imagem")) {
                        const mediaId = (msg as any).mediaMetadata?.mediaId;
                        if (mediaId) {
                          return <MediaRetryBubble msgId={msg.id} label="Imagem não baixada" icon={<Image className="w-4 h-4" />} />;
                        }
                        return (
                          <div className="flex items-center gap-2 opacity-70">
                            <Image className="w-4 h-4 flex-shrink-0" />
                            <span className="text-[12px] italic">Imagem recebida</span>
                          </div>
                        );
                      }
                      if (tipo === "audio" && arquivo) {
                        const audioProxy = /fbcdn\.net|cdninstagram\.com|scontent/i.test(arquivo);
                        // Bruno 2026-06-05: WhatsApp manda OGG/Opus — Safari/iOS não
                        // tocam. Roteia áudio local incompatível pelo /api/audio-compat
                        // (transcodifica pra MP3 sob demanda + cacheia). Chrome também
                        // passa por aqui (recebe MP3), sem prejuízo.
                        const isLocalIncompativel = /^\/uploads\/.+\.(ogg|opus|oga|webm)$/i.test(arquivo);
                        const audioSrc = audioProxy
                          ? `/api/media-proxy?url=${encodeURIComponent(arquivo)}`
                          : isLocalIncompativel
                            ? `/api/audio-compat?u=${encodeURIComponent(arquivo)}`
                            : arquivo;
                        // Bruno 2026-05-19: "[Audio 0:03]" do useAudioRecorder é
                        // só um placeholder no campo texto — não é transcrição.
                        // Suprime variantes "[audio*]" e "[Audio*]" pra não
                        // duplicar duração que já aparece no player.
                        const hasTranscription = texto
                          && !/^\[(audio|áudio)\b/i.test(texto.trim());
                        const contactAvatarUrl = selected?.avatar || (() => {
                          if (!selected?.telefone || !contactsData) return null;
                          const raw = String(selected.telefone).replace(/\D/g, "");
                          const match = contactsData.find((c: any) => {
                            const cr = String(c.telefone || "").replace(/\D/g, "");
                            return cr === raw || cr === `55${raw}` || (cr.startsWith("55") && cr.slice(2) === raw);
                          });
                          return match?.fotoUrl ?? null;
                        })();
                        return (
                          <div>
                            <MiniAudioPlayer
                              src={audioSrc}
                              msgId={msg.id}
                              isOut={msg.direction === "out"}
                              contactName={selected?.nome}
                              contactAvatarUrl={contactAvatarUrl}
                            />
                            {hasTranscription ? (
                              <p className="mt-0.5 italic whitespace-pre-wrap break-words" style={{ fontSize: "0.75rem", opacity: 0.7 }} data-testid={`msg-transcription-${msg.id}`}>
                                📝 {texto}
                              </p>
                            ) : msg.direction === "in" ? (
                              // Áudio recebido que ficou sem transcrição (texto = "[áudio]"):
                              // oferece re-rodar o Whisper. Ver TranscribeButton. Bruno 2026-07-16.
                              <TranscribeButton msgId={msg.id} />
                            ) : null}
                          </div>
                        );
                      }
                      if ((tipo === "audio" || texto === "[audio]") && !arquivo) {
                        // Bruno 2026-05-19: outbound sem arquivo = falha de upload.
                        // Antes mostrava "Audio recebido" pra qualquer caso (confunde
                        // com áudio do cliente). Agora diferencia direção e estado.
                        const isOutAudio = msg.direction === "out";
                        const failed = (msg.status as any) === "failed";
                        const mediaId = (msg as any).mediaMetadata?.mediaId;
                        // Inbound com download falho → botão re-baixar.
                        if (!isOutAudio && mediaId) {
                          return <MediaRetryBubble msgId={msg.id} label="Áudio não baixado" icon={<Mic className="w-4 h-4" />} />;
                        }
                        return (
                          <div className={`flex items-center gap-2 ${failed ? "text-rose-600 dark:text-rose-400" : "opacity-70"}`}>
                            <Mic className={`w-4 h-4 flex-shrink-0 ${failed ? "text-rose-500" : "text-green-500"}`} />
                            <span className="text-[12px] italic">
                              {isOutAudio
                                ? (failed ? "Falha ao enviar áudio" : "Áudio enviado")
                                : "Áudio recebido"}
                            </span>
                          </div>
                        );
                      }
                      if ((tipo === "file" || tipo === "document") && arquivo) {
                        const isPdf = nomeArquivo?.endsWith(".pdf") || arquivo?.includes(".pdf") || texto?.includes(".pdf");
                        const displayName = nomeArquivo || (texto?.replace("[documento] ", "").split(" - ")[0]) || "Arquivo";
                        return (
                          <a
                            href={arquivo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-[260px] no-underline group cursor-pointer"
                            data-testid={`msg-file-download-${msg.id}`}
                          >
                            <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${msg.direction === "out" ? "border-black/20 hover:bg-black/8" : "border-border bg-secondary/50 hover:bg-secondary"}`}>
                              {isPdf ? (
                                <div className="w-10 h-10 flex-shrink-0">
                                  <svg viewBox="0 0 40 40" className="w-full h-full drop-shadow-sm" fill="none" aria-hidden="true">
                                    <defs>
                                      <linearGradient id={`pdf-grad-${msg.id}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#f87171" />
                                        <stop offset="100%" stopColor="#b91c1c" />
                                      </linearGradient>
                                    </defs>
                                    <path d="M9 3 H26 L35 12 V35 a2 2 0 0 1 -2 2 H9 a2 2 0 0 1 -2 -2 V5 a2 2 0 0 1 2 -2 z" fill={`url(#pdf-grad-${msg.id})`} />
                                    <path d="M26 3 V11 a1 1 0 0 0 1 1 H35 Z" fill="#fecaca" fillOpacity="0.92" />
                                    <path d="M26 3 L35 12" stroke="#7f1d1d" strokeOpacity="0.25" strokeWidth="0.5" />
                                    <text x="20" y="28.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="white" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="0.4">PDF</text>
                                  </svg>
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <File className="w-5 h-5 text-primary" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-semibold truncate">{displayName}</div>
                                <div className={`text-[10px] flex items-center gap-1 ${msg.direction === "out" ? "text-black/65" : "text-muted-foreground"}`}>
                                  <Download className="w-3 h-3" /> {isPdf ? "Abrir PDF" : "Baixar arquivo"}
                                </div>
                              </div>
                            </div>
                            {texto && !texto.startsWith("[documento") && !texto.startsWith("[video") && <p className="text-[11px] mt-1.5 whitespace-pre-wrap break-words">{texto}</p>}
                          </a>
                        );
                      }
                      if (texto.startsWith("[documento:") || texto.startsWith("[documento]") || texto.startsWith("[Arquivo:")) {
                        const mediaId = (msg as any).mediaMetadata?.mediaId;
                        if (mediaId) {
                          return <MediaRetryBubble msgId={msg.id} label="Documento não baixado" icon={<FileText className="w-4 h-4" />} />;
                        }
                        return (
                          <div className="flex items-center gap-2 opacity-70">
                            <FileText className="w-4 h-4 flex-shrink-0" />
                            <span className="text-[12px] italic">Documento recebido</span>
                          </div>
                        );
                      }
                      if (texto === "[figurinha]" || texto === "[sticker]") {
                        // Bruno 2026-05-20: sticker sem fundo de bubble (estilo
                        // WhatsApp: figurinha "flutua" sem container). Como o
                        // pipeline atual ainda não baixa a imagem do sticker,
                        // mostramos placeholder visual marcante em vez de texto
                        // genérico — atendente identifica de relance.
                        return (
                          <div className="flex items-center gap-2 py-1" data-testid={`msg-sticker-${msg.id}`}>
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/20 dark:from-white/5 dark:to-white/10 border border-primary/20 dark:border-white/10 flex items-center justify-center text-[26px]" aria-hidden>
                              😀
                            </div>
                            <span className="text-[11px] italic opacity-70">Figurinha</span>
                          </div>
                        );
                      }
                      if (tipo === "video" && arquivo) {
                        const needsProxy = /fbcdn\.net|cdninstagram\.com|scontent/i.test(arquivo);
                        const videoSrc = needsProxy ? `/api/media-proxy?url=${encodeURIComponent(arquivo)}` : arquivo;
                        // Bruno 2026-05-22: helper unificado de caption.
                        const caption = captionFromMessageText(texto);
                        return (
                          <div className="max-w-[280px] cursor-pointer group" onClick={() => setMediaLightbox({ type: "video", src: videoSrc, caption, raw: arquivo })}>
                            <div className="relative">
                              <video
                                id={`vid-${msg.id}`}
                                src={videoSrc}
                                preload="metadata"
                                playsInline
                                muted
                                className="rounded-lg max-h-[240px] w-full bg-black"
                                data-testid={`msg-video-${msg.id}`}
                                onError={(e) => {
                                  (e.target as HTMLVideoElement).style.display = "none";
                                }}
                                onClick={(e) => { e.stopPropagation(); setMediaLightbox({ type: "video", src: videoSrc, caption, raw: arquivo }); }}
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 rounded-lg transition-colors flex items-center justify-center pointer-events-none">
                                <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
                                  <Maximize2 className="w-5 h-5 text-white" />
                                </div>
                              </div>
                            </div>
                            {caption && <p className="text-[12px] mt-1 whitespace-pre-wrap break-words">{caption}</p>}
                          </div>
                        );
                      }
                      if (texto === "[video]" || texto.startsWith("[video")) {
                        const mediaId = (msg as any).mediaMetadata?.mediaId;
                        if (mediaId) {
                          return <MediaRetryBubble msgId={msg.id} label="Vídeo não baixado" icon={<Play className="w-4 h-4" />} />;
                        }
                        return (
                          <div className="flex items-center gap-2 opacity-70">
                            <Play className="w-4 h-4 flex-shrink-0" />
                            <span className="text-[12px] italic">Vídeo recebido</span>
                          </div>
                        );
                      }
                      // ─── Bolha de CONTATO (vCard) — Bruno 2026-05-22 ──────
                      // Estilo WhatsApp: avatar 44px, nome em destaque, telefone
                      // formatado BR (+55 (XX) XXXXX-XXXX), divisor edge-to-edge,
                      // botão "Mensagem" full-width inbound+outbound; "Salvar"
                      // ao lado só inbound.
                      if (tipo === "contact") {
                        const meta = (msg as any).mediaMetadata as any;
                        const contacts: any[] = meta?.contacts || [];
                        const isOut = msg.direction === "out";
                        const formatBrPhone = (raw: string): string => {
                          const d = String(raw || "").replace(/\D/g, "");
                          if (!d) return "";
                          if (d.length === 13 && d.startsWith("55")) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
                          if (d.length === 12 && d.startsWith("55")) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
                          if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
                          if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
                          return raw;
                        };
                        const dividerCls = isOut ? "border-black/20" : "border-border/70";
                        return (
                          <div className="w-[260px]" data-testid={`msg-contact-${msg.id}`}>
                            {contacts.length === 0 && (
                              <div className="flex items-center gap-2 opacity-70">
                                <User className="w-4 h-4 flex-shrink-0" />
                                <span className="text-[12px] italic">Contato compartilhado</span>
                              </div>
                            )}
                            {contacts.slice(0, 2).map((c, idx) => {
                              const firstPhone = c.phones?.[0]?.number || c.phones?.[0]?.waId || "";
                              const cleanPhone = String(firstPhone).replace(/\D/g, "");
                              const waLink = cleanPhone ? `https://wa.me/${cleanPhone}` : null;
                              const displayPhone = formatBrPhone(firstPhone);
                              const isLast = idx === Math.min(contacts.length, 2) - 1;
                              return (
                                <div key={idx} className={idx > 0 ? `mt-2.5 pt-2.5 border-t ${dividerCls}` : ""}>
                                  <div className="flex items-center gap-3 pb-2.5">
                                    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${isOut ? "bg-black/15" : "bg-primary/15"}`}>
                                      <User className={`w-[22px] h-[22px] ${isOut ? "text-black/70" : "text-primary"}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[14px] font-semibold truncate leading-tight">{c.name || "Sem nome"}</div>
                                      {displayPhone && (
                                        <div className={`text-[12px] tabular-nums mt-0.5 truncate ${isOut ? "text-black/65" : "text-muted-foreground"}`}>
                                          {displayPhone}
                                        </div>
                                      )}
                                      {c.organization && (
                                        <div className={`text-[10.5px] italic truncate ${isOut ? "text-black/55" : "text-muted-foreground/85"}`}>
                                          {c.organization}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  {firstPhone && isLast && (
                                    <div
                                      className={`flex border-t ${dividerCls}`}
                                      style={{ marginLeft: -12, marginRight: -12, marginBottom: -7 }}
                                    >
                                      {waLink && (
                                        <a
                                          href={waLink}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-[12.5px] font-medium transition-colors ${isOut ? "hover:bg-black/10 text-black/85" : "hover:bg-primary/10 text-primary"}`}
                                          data-testid={`btn-contact-chat-${msg.id}-${idx}`}
                                        >
                                          <MessageCircle className="w-3.5 h-3.5" /> Mensagem
                                        </a>
                                      )}
                                      {!isOut && (
                                        <button
                                          type="button"
                                          onClick={async () => {
                                            try {
                                              await apiRequest("POST", "/api/contacts", {
                                                nome: c.name || firstPhone,
                                                telefone: firstPhone,
                                                email: c.emails?.[0]?.email || null,
                                                empresa: c.organization || null,
                                              });
                                              toast({ title: "Contato salvo", description: `${c.name || firstPhone} adicionado aos contatos.` });
                                            } catch (err: any) {
                                              toast({ title: "Erro ao salvar", description: err?.message || "Tente novamente.", variant: "destructive" });
                                            }
                                          }}
                                          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-[12.5px] font-medium transition-colors border-l ${dividerCls} hover:bg-primary/10 text-primary`}
                                          data-testid={`btn-contact-save-${msg.id}-${idx}`}
                                        >
                                          <UserCheck className="w-3.5 h-3.5" /> Salvar
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {contacts.length > 2 && (
                              <div className={`text-[10.5px] italic mt-2 ${isOut ? "text-black/55" : "text-muted-foreground"}`}>
                                +{contacts.length - 2} contato{contacts.length - 2 === 1 ? "" : "s"} adicional{contacts.length - 2 === 1 ? "" : "is"}
                              </div>
                            )}
                          </div>
                        );
                      }
                      // ─── Bolha de LOCALIZAÇÃO — Bruno 2026-05-21 ──────────
                      // Inbound/outbound: lat/long + nome/endereço opcional.
                      // Render: thumbnail estático do OpenStreetMap + label +
                      // botão "Abrir no Maps". Clique no thumb abre Maps direto.
                      if (tipo === "location") {
                        const meta = (msg as any).mediaMetadata as any;
                        const lat = meta?.latitude;
                        const lng = meta?.longitude;
                        const locName = meta?.name || "";
                        const locAddr = meta?.address || "";
                        const isOut = msg.direction === "out";
                        if (lat == null || lng == null) {
                          return (
                            <div className="flex items-center gap-2 opacity-70">
                              <MapPin className="w-4 h-4 flex-shrink-0" />
                              <span className="text-[12px] italic">Localização recebida</span>
                            </div>
                          );
                        }
                        const mapsLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                        // OpenStreetMap static tile como thumbnail (sem API key).
                        // Marker via overlay CSS (centrado), sem dependência de
                        // serviço externo de static-maps.
                        return (
                          <a
                            href={mapsLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-[290px] no-underline group"
                            data-testid={`msg-location-${msg.id}`}
                          >
                            <div className={`relative overflow-hidden rounded-lg border ${isOut ? "border-black/15" : "border-border"}`}>
                              <div
                                className="w-full h-[140px] bg-cover bg-center"
                                style={{
                                  backgroundImage: `url("https://tile.openstreetmap.org/13/${Math.floor((Number(lng) + 180) / 360 * Math.pow(2, 13))}/${Math.floor((1 - Math.log(Math.tan(Number(lat) * Math.PI / 180) + 1 / Math.cos(Number(lat) * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, 13))}.png")`,
                                }}
                                aria-label="Mapa"
                              />
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <MapPin className="w-7 h-7 text-rose-500 drop-shadow-md" fill="currentColor" />
                              </div>
                              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                                <div className="text-[11px] text-white font-semibold truncate">
                                  {locName || "Localização"}
                                </div>
                                {locAddr && (
                                  <div className="text-[10px] text-white/85 truncate">{locAddr}</div>
                                )}
                              </div>
                            </div>
                            <div className={`flex items-center gap-1.5 mt-1 text-[10.5px] ${isOut ? "text-black/65" : "text-muted-foreground"} group-hover:underline`}>
                              <ExternalLink className="w-3 h-3" /> Abrir no Google Maps
                            </div>
                          </a>
                        );
                      }
                      if (tipo === "interactive") {
                        let meta: any = null;
                        try { meta = arquivo ? JSON.parse(arquivo) : null; } catch {}
                        const isMenu = meta?.interactiveType === 'list' || texto.startsWith("[Menu]");
                        const isButton = meta?.interactiveType === 'button' || meta?.interactiveType === 'buttons' || texto.startsWith("[Botões]");
                        const isFlow = meta?.interactiveType === 'flow';
                        // Pra Flow nativo do Meta, remove o marcador textual
                        // (━━━━━ + "📋 Formulário interativo enviado...") porque
                        // vamos renderizar visualmente o card abaixo. Para
                        // botão/lista, o body já vem limpo.
                        const bodyText = isFlow
                          ? (meta?.body || texto)
                            .replace(/\n*━+\n*📋\s*_?Formulário interativo enviado[^_\n]*_?/gi, '')
                            .trim()
                          : (meta?.body || texto.replace(/^\[(Menu|Botões)\]\s*/, ''));
                        // Bruno 2026-05-15: largura aumentada 230→290px e card
                        // marcado relative pra timestamp absolute caber no
                        // canto inferior sem esticar altura (era linha separada
                        // com marginTop, deixava card estreito+alto).
                        return (
                          <div className="w-[290px] relative" data-testid={`msg-interactive-${msg.id}`}>
                            {meta?.header && (
                              <div className={`text-[11px] font-bold mb-1 ${msg.direction === "out" ? "text-black/80" : "text-foreground/80"}`}>
                                {meta.header}
                              </div>
                            )}
                            <div className="text-[13.5px] leading-[1.35] whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: parseWhatsAppText(bodyText) }} />
                            {meta?.footer && (
                              <div className={`text-[10px] mt-1 italic ${msg.direction === "out" ? "text-black/55" : "text-muted-foreground"}`}>
                                {meta.footer}
                              </div>
                            )}
                            {isFlow && (
                              <div className="mt-1.5 -mx-0.5">
                                <div className={`rounded-md border-t pt-1.5 ${msg.direction === "out" ? "border-black/15" : "border-foreground/10"}`}>
                                  <button
                                    type="button"
                                    disabled
                                    data-testid={`btn-flow-${msg.id}`}
                                    className={`w-full px-3 py-1.5 rounded-md text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-default ${
                                      msg.direction === "out"
                                        ? "bg-black/10 text-black border border-black/20"
                                        : "bg-primary/10 text-primary border border-primary/25"
                                    }`}
                                    title={meta?.cta || 'Preencher cadastro'}
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                    {meta?.cta || 'Preencher cadastro'}
                                  </button>
                                  <div className={`mt-1 flex items-center justify-center gap-1 text-[10px] ${msg.direction === "out" ? "text-black/55" : "text-muted-foreground"}`}>
                                    Formulário nativo do WhatsApp
                                  </div>
                                </div>
                              </div>
                            )}
                            {isMenu && meta?.sections && (
                              <InteractiveListMenu
                                meta={meta}
                                msgId={msg.id}
                                msgDir={msg.direction as "in" | "out"}
                                buttonLabelFallback="Ver opções"
                                onRowClick={(row) => {
                                  // Bruno (2026-05-13): inclui descrição abaixo do título
                                  // pra espelhar o que aparece no WhatsApp do cliente quando
                                  // ele toca numa row da lista interativa.
                                  const texto = row.description
                                    ? `${row.title}\n${row.description}`
                                    : row.title;
                                  sendMutation.mutate({ texto, direction: "out", agente: signMessages ? currentUserName : (workspaceName || undefined) });
                                }}
                              />
                            )}
                            {isButton && meta?.buttons && (
                              <div className={`mt-1.5 -mx-1 flex flex-col border-t ${msg.direction === "out" ? "border-black/15" : "border-foreground/10"}`}>
                                {meta.buttons.map((btn: any, bi: number) => {
                                  const isLast = bi === meta.buttons.length - 1;
                                  return (
                                    <button
                                      key={bi}
                                      type="button"
                                      data-testid={`btn-reply-${msg.id}-${bi}`}
                                      onClick={() => {
                                        sendMutation.mutate({ texto: btn.title, direction: "out", agente: signMessages ? currentUserName : (workspaceName || undefined) });
                                      }}
                                      style={isLast ? { paddingLeft: 56, paddingRight: 56 } : undefined}
                                      className={`w-full px-3 py-1.5 text-[13px] font-semibold text-center transition-all duration-150 cursor-pointer ${
                                        bi > 0 ? (msg.direction === "out" ? "border-t border-black/12" : "border-t border-foreground/8") : ""
                                      } ${
                                        msg.direction === "out"
                                          ? "text-black hover:bg-black/5 active:bg-black/10"
                                          : "text-primary hover:bg-primary/5 active:bg-primary/10"
                                      }`}
                                      title={btn.title}
                                    >
                                      {btn.title}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {!meta && isMenu && (
                              <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${msg.direction === "out" ? "text-black/55" : "text-muted-foreground"}`}>
                                <ListOrdered className="w-3.5 h-3.5" />
                                Menu interativo enviado
                              </div>
                            )}
                            {!meta && isButton && (
                              <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${msg.direction === "out" ? "text-black/55" : "text-muted-foreground"}`}>
                                <CornerDownRight className="w-3.5 h-3.5" />
                                Botões interativos enviados
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (texto.startsWith("[contato:")) {
                        return (
                          <div className="flex items-center gap-2 opacity-70">
                            <User className="w-4 h-4 flex-shrink-0" />
                            <span className="text-[12px] italic">{texto.replaceAll("[", "").replaceAll("]", "")}</span>
                          </div>
                        );
                      }
                      // Bruno 2026-05-20: localização com mini-mapa OSM estático.
                      // Webhook Meta popula texto como "[localizacao: Nome (lat, lng)]";
                      // canais não-oficiais podem popular "[localizacao]" sem coords. Parseia o que vier.
                      if (texto === "[localizacao]" || texto.startsWith("[localizacao")) {
                        const m = texto.match(/\[localizacao(?::\s*(.*?))?\s*\(([-\d.]+),\s*([-\d.]+)\)\]/);
                        const nome = m?.[1]?.trim() || "";
                        const lat = m?.[2] ? parseFloat(m[2]) : null;
                        const lng = m?.[3] ? parseFloat(m[3]) : null;
                        if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
                          // staticmap.openstreetmap.de — sem chave, gratuito.
                          // delta pra bounding box (~600m em zoom 15)
                          const d = 0.005;
                          const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
                          const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
                          const externalUrl = `https://www.google.com/maps?q=${lat},${lng}`;
                          return (
                            <a
                              href={externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block max-w-[280px] no-underline group"
                              data-testid={`msg-location-${msg.id}`}
                              title="Abrir no Google Maps"
                            >
                              <div className="relative rounded-lg overflow-hidden border border-border">
                                <iframe
                                  src={mapUrl}
                                  className="w-[280px] h-[160px] block pointer-events-none"
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  title={nome ? `Mapa de ${nome}` : "Localização compartilhada"}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-end justify-start p-2">
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/95 dark:bg-black/80 text-[10.5px] font-semibold text-foreground shadow-sm">
                                    <MapPin className="w-3 h-3 text-rose-500" />
                                    {nome || "Localização"}
                                  </span>
                                </div>
                              </div>
                              <div className={`mt-1 text-[10.5px] tabular-nums ${isOut ? "text-black/55" : "text-muted-foreground"}`}>
                                {lat.toFixed(5)}, {lng.toFixed(5)}
                              </div>
                            </a>
                          );
                        }
                        // Fallback (sem coords)
                        return (
                          <div className="flex items-center gap-2 opacity-70">
                            <MapPin className="w-4 h-4 flex-shrink-0 text-rose-500" />
                            <span className="text-[12px] italic">Localização compartilhada</span>
                          </div>
                        );
                      }
                      if (texto.startsWith("[Menu] ") || texto.startsWith("[Botões] ")) {
                        const isMenuLegacy = texto.startsWith("[Menu]");
                        const cleanText = texto.replace(/^\[(Menu|Botões)\]\s*/, '');
                        return (
                          <div data-testid={`msg-interactive-legacy-${msg.id}`}>
                            <div className="text-[13px] whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: parseWhatsAppText(cleanText) }} />
                            <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${msg.direction === "out" ? "text-black/55" : "text-muted-foreground"}`}>
                              {isMenuLegacy
                                ? <><ListOrdered className="w-3.5 h-3.5" /> Menu interativo enviado</>
                                : <><CornerDownRight className="w-3.5 h-3.5" /> Botões interativos enviados</>
                              }
                            </div>
                          </div>
                        );
                      }
                      if (emojiOnly) {
                        return <span className="msg-emoji-text">{texto}</span>;
                      }
                      // Bruno 2026-05-22: guard final — texto que é PURAMENTE
                      // placeholder de mídia ("[figurinha]", "[imagem]", "[video]",
                      // etc) NUNCA vira balão de texto cru. Mostra placeholder
                      // visual neutro. Atendente não precisa ver o sentinela do
                      // backend (que era pra classifier do agente, não pra UI).
                      if (isPureMediaPlaceholder(texto)) {
                        return (
                          <div className="flex items-center gap-2 opacity-70 italic text-[12px]" data-testid={`msg-media-placeholder-${msg.id}`}>
                            <span>Mídia recebida</span>
                          </div>
                        );
                      }
                      const urlRegex = /(https?:\/\/[^\s]+)/g;
                      if (urlRegex.test(texto)) {
                        // Bruno 2026-05-20: link preview OG só pra primeira URL
                        // da mensagem (evita render pesado quando msg tem várias).
                        const firstUrlMatch = texto.match(urlRegex);
                        const firstUrl = firstUrlMatch?.[0];
                        return (
                          <>
                            <span>
                              {texto.split(urlRegex).map((part: string, i: number) =>
                                part.match(urlRegex) ? (
                                  <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={`underline ${isOut ? "text-black/90" : "text-primary"}`}>{part}</a>
                                ) : <span key={i} dangerouslySetInnerHTML={{ __html: parseWhatsAppText(part) }} />
                              )}
                            </span>
                            {firstUrl && <LinkPreview url={firstUrl} isOut={isOut} />}
                          </>
                        );
                      }
                      return <span dangerouslySetInnerHTML={{ __html: parseWhatsAppText(texto) }} />;
                    })()}
                    {/* Bruno 2026-05-20: chips de reactions agrupadas por
                        emoji. Click em chip já reagido remove a do user atual;
                        click em chip não-reagido adiciona. */}
                    {currentUserId && !msg.deletedAt && (reactionsByMsg[msg.id]?.length ?? 0) > 0 && (
                      <ReactionList
                        messageId={msg.id}
                        conversationId={selectedId!}
                        currentUserId={currentUserId}
                        reactions={reactionsByMsg[msg.id] || []}
                      />
                    )}
                    {/* Bruno 2026-05-15: timestamp como SELO no canto inferior
                        direito do card — não ocupa altura própria, fica
                        sobreposto/discreto. Aplica a todos os cards
                        (interactive/image/audio/document/menu legado). */}
                    {!emojiOnly && isCardLayout && (
                      <span
                        className="msg-timestamp-inline"
                        style={{
                          position: 'absolute',
                          bottom: 6,
                          right: 10,
                          float: 'none',
                          top: 'auto',
                          margin: 0,
                          fontSize: '10.5px',
                          lineHeight: 1,
                          padding: 0,
                          background: 'transparent',
                          color: isOut ? 'rgba(26,26,26,0.55)' : 'hsl(var(--muted-foreground))',
                          pointerEvents: 'none',
                          fontVariantNumeric: 'tabular-nums',
                          gap: 3,
                        }}
                      >
                        <span>{horaDisplay}</span>
                        {isOut && <StatusIcon status={msg.status} />}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              </Fragment>
              );
            })}
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Início da conversa com {selected.nome}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
        {/* Bruno 2026-05-20: FAB scroll-to-bottom. Aparece com fade quando o
            atendente rola pra cima. Click → smooth scroll pro fim. */}
        {showScrollFab && (
          <button
            type="button"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
            className="absolute right-4 bottom-4 z-20 w-10 h-10 rounded-full bg-card border border-border shadow-lg flex items-center justify-center text-foreground hover:bg-secondary transition-all duration-150 active:scale-95"
            style={{ boxShadow: "0 4px 14px rgba(0,0,0,0.15)" }}
            aria-label="Voltar ao fim da conversa"
            title="Voltar ao fim"
            data-testid="button-scroll-to-bottom"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        )}
        </div>{/* /chat-wallpaper wrapper */}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
          data-testid="input-file-hidden"
        />

        <div className="border-t border-border bg-card flex-shrink-0" style={{ boxShadow: "0 -1px 6px rgba(0,0,0,0.05)" }}>
          {readOnly ? (
            // Bruno 2026-06-04: contexto read-only (Relatórios/drawer) — composer
            // fechado, só visualização. Pra responder, abrir no Atendimento.
            <div className="px-3.5 py-3 flex items-center justify-center gap-1.5" data-testid="composer-readonly">
              <Lock className="w-3 h-3 text-muted-foreground/70 flex-shrink-0" />
              <p className="text-[11px] text-center text-muted-foreground">Visualização — abra no Atendimento para responder</p>
            </div>
          ) : selected?.status === "resolved" ? (
            // Bruno 2026-05-18: trocou banner Lock por botão CTA "Reabrir
            // atendimento". Backend reopen atribui automaticamente ao usuário
            // que clicou → composer aparece sozinho após invalidar a query,
            // sem fechar o drawer.
            // Bruno 2026-05-21: usa gradient-accent pra seguir a cor do tema
            // (banana/lilac/blue/orange) em vez de hardcoded --banana-*.
            (() => {
              const reopening = reopenMutation.isPending;
              return (
                <div className="px-3.5 py-3 flex flex-col items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => selected && reopenMutation.mutate(selected.id)}
                    disabled={!selected || reopening}
                    data-testid="button-reopen-conversation-composer"
                    className="gradient-accent w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold text-[13px] transition-all duration-150 active:scale-[0.985] hover:brightness-105 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                  >
                    {reopening ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Reabrindo…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Reabrir atendimento
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-center text-muted-foreground">
                    Conversa resolvida — ao reabrir, você assume o atendimento
                  </p>
                </div>
              );
            })()
          ) : !canType ? (
            // Bruno 2026-05-18: botão "Assumir atendimento" agora vive aqui no
            // rodapé do chat (era no ActionsSidebar). CTA grande no fluxo
            // natural de leitura → ação do atendente.
            (() => {
              const otherName = (selected as any)?.assignedUserName || "outro membro";
              const convTeamName = convTeamId
                ? (equipesAtivas.find((e: any) => e.id === convTeamId)?.nome || "outra equipe")
                : null;
              const helperLine = assignedToOther
                ? (isManager
                    ? `Em atendimento por ${otherName} — mude para Interno para deixar notas`
                    : `Em atendimento por ${otherName}`)
                : hasNoTeams
                  ? (isManager
                      ? "Você não está em nenhuma equipe — cadastre-se em Configurações → Equipe & Workspace pra assumir. Use Interno pra deixar notas."
                      : "Você não está em nenhuma equipe — peça pro administrador te adicionar.")
                  : notInConvTeam
                    ? (isManager
                        ? `Esta conversa é da equipe ${convTeamName} — mude para Interno pra deixar notas.`
                        : `Esta conversa é da equipe ${convTeamName} — você não é membro.`)
                    : !selected?.assignedUserId
                      ? "Conversa na fila — assuma para responder"
                      : "Você ainda não assumiu esta conversa";
              const assuming = assumeMutation.isPending;
              const buttonLabel = "Assumir atendimento";
              // Bruno 2026-05-21: assignedToOther DESABILITA o botão pra todos
              // (inclusive admin). Admin que quiser interagir com a conv usa
              // a aba Interno; tomada da conversa foi descontinuada.
              // Atendente/admin sem equipe ou fora da equipe da conv também
              // não assume (espelha guard backend em conversations.ts:1131).
              const buttonDisabled = !selected || assuming || assignedToOther || hasNoTeams || notInConvTeam;
              // Admin espectador em modo cliente: oculta o botão "Assumir" e
              // mostra só o helper line orientando pro modo Interno.
              if (isManagerSpectator) {
                return (
                  <div className="px-3.5 py-3 flex flex-col items-stretch gap-1.5">
                    <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1.5">
                      <Lock className="w-3 h-3" /> {helperLine}
                    </p>
                  </div>
                );
              }
              return (
                <div className="px-3.5 py-3 flex flex-col items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => selected && handleAssumeClick(selected.id)}
                    disabled={buttonDisabled}
                    data-testid="button-assume-conversation-composer"
                    className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl text-white font-semibold text-[13px] transition-all duration-150 active:scale-[0.985] disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                    style={{
                      background: "var(--tertiary-500)",
                      border: "1px solid var(--tertiary-600)",
                    }}
                    onMouseEnter={(e) => {
                      if (!assuming) (e.currentTarget as HTMLButtonElement).style.background = "var(--tertiary-600)";
                    }}
                    onMouseLeave={(e) => {
                      if (!assuming) (e.currentTarget as HTMLButtonElement).style.background = "var(--tertiary-500)";
                    }}
                  >
                    {assuming ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Assumindo…
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-4 h-4" />
                        {buttonLabel}
                      </>
                    )}
                  </button>
                  <p className="text-[11px] text-center text-muted-foreground">{helperLine}</p>
                </div>
              );
            })()
          ) : isRecording ? (
            <div className="px-3.5 py-3 flex items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-bold text-red-500">Gravando</span>
                <span className="text-sm font-mono text-muted-foreground">{formatRecordingTime(recordingTime)}</span>
              </div>
              <button
                className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                onClick={() => stopRecording(false)}
                title="Cancelar"
                data-testid="button-cancel-recording"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                className="gradient-accent px-4 py-2 rounded-[9px] flex items-center gap-2 font-bold text-sm hover:opacity-90 transition-opacity"
                onClick={() => stopRecording(true)}
                data-testid="button-send-recording"
              >
                <Send className="w-4 h-4" /> Enviar
              </button>
            </div>
          ) : (
            <>
              {/* Bruno 2026-05-21: faixa compacta de "Assumir atendimento".
                  Aparece acima do composer quando a conv está livre (sem dono) e
                  o usuário tem permissão de assumir. Substitui o CTA gigante azul
                  pra usuários que JÁ têm o composer disponível (admins + canSeeInternal). */}
              {canTakeOver && !canTypeCliente && (
                <div
                  className="px-3.5 py-2 flex items-center justify-between gap-2 border-b border-border bg-secondary/30"
                  data-testid="strip-assume-compact"
                >
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <UserCheck className="w-3 h-3" />
                    Conversa na fila — assuma para responder ao cliente
                  </span>
                  <button
                    type="button"
                    onClick={() => selected && handleAssumeClick(selected.id)}
                    disabled={!selected || assumeMutation.isPending}
                    data-testid="button-assume-compact"
                    className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    style={{ background: "var(--tertiary-500)", border: "1px solid var(--tertiary-600)" }}
                    onMouseEnter={(e) => { if (!assumeMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = "var(--tertiary-600)"; }}
                    onMouseLeave={(e) => { if (!assumeMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = "var(--tertiary-500)"; }}
                  >
                    {assumeMutation.isPending ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Assumindo…</>
                    ) : (
                      <><UserCheck className="w-3 h-3" /> Assumir atendimento</>
                    )}
                  </button>
                </div>
              )}
              {/* Bruno 2026-05-21: banner amarelo no modo interno. Avisa visualmente
                  que tudo digitado vai pra nota interna (não chega no cliente). */}
              {chatMode === "interno" && (
                <div
                  className="px-3.5 py-1.5 flex items-center gap-1.5 border-b border-t text-[11px] font-semibold"
                  style={{
                    background: "rgba(254,211,14,0.18)",
                    borderColor: "rgba(254,211,14,0.45)",
                    color: "#8b6500",
                  }}
                  data-testid="banner-internal-composer"
                >
                  <Lock className="w-3 h-3 flex-shrink-0" style={{ color: "#a07a00" }} />
                  Essa é uma mensagem interna e não chegará ao cliente final.
                </div>
              )}
              <div
                className="px-3.5 pt-2.5 pb-1 flex items-center gap-1 flex-wrap"
                style={chatMode === "interno" ? { background: "rgba(254,211,14,0.08)" } : undefined}
              >
                <button
                  className="msg-action-icon p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  title={chatMode === "interno" ? "Anexos só no modo cliente" : "Anexar arquivo"}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={chatMode === "interno"}
                  data-testid="button-attach"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                {/* Bruno 2026-05-21: enviar contato + localização. Só no modo
                    cliente (não faz sentido em nota interna). */}
                <button
                  className="msg-action-icon p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  title={chatMode === "interno" ? "Disponível só no modo cliente" : "Enviar contato"}
                  onClick={() => setContactPickerOpen(true)}
                  disabled={chatMode === "interno" || !selectedId}
                  data-testid="button-send-contact"
                >
                  <User className="w-4 h-4" />
                </button>
                <button
                  className="msg-action-icon p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  title={chatMode === "interno" ? "Disponível só no modo cliente" : "Enviar localização"}
                  onClick={() => setLocationPickerOpen(true)}
                  disabled={chatMode === "interno" || !selectedId}
                  data-testid="button-send-location"
                >
                  <MapPin className="w-4 h-4" />
                </button>
                <Popover open={showEmoji} onOpenChange={setShowEmoji}>
                  <PopoverTrigger asChild>
                    <button
                      className="msg-action-icon p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                      title="Emoji"
                      data-testid="button-emoji"
                    >
                      <Smile className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0 border-0 bg-transparent shadow-none"
                    side="top"
                    align="start"
                    sideOffset={8}
                  >
                    <Picker
                      data={data}
                      onEmojiSelect={onEmojiSelect}
                      theme="dark"
                      locale="pt"
                      previewPosition="none"
                      skinTonePosition="search"
                      set="native"
                      perLine={8}
                      maxFrequentRows={2}
                    />
                  </PopoverContent>
                </Popover>
                {/* Bruno 2026-05-21: toggle "Nota interna" integrado no composer.
                    Substitui os botões Chat/Interno do header. Quando ativo,
                    fica amarelo banana + ativa o banner amarelo + envia pra
                    /chat-interno em vez de /messages. */}
                {canSeeInternal && (
                  <button
                    type="button"
                    onClick={() => setChatMode(chatMode === "interno" ? "cliente" : "interno")}
                    disabled={!canTypeCliente && chatMode === "interno"}
                    title={
                      !canTypeCliente
                        ? "Você só pode digitar como nota interna nessa conversa"
                        : (chatMode === "interno" ? "Voltar pro chat do cliente" : "Trocar para nota interna (somente equipe)")
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    style={
                      chatMode === "interno"
                        ? { background: "rgba(254,211,14,0.20)", color: "#a07a00", border: "1px solid rgba(254,211,14,0.45)" }
                        : { background: "transparent", color: "var(--muted-foreground)", border: "1px solid hsl(var(--border))" }
                    }
                    data-testid="toggle-internal-mode"
                  >
                    <Lock className="w-3 h-3" />
                    {chatMode === "interno" ? "Modo nota interna" : "Nota interna"}
                  </button>
                )}
                {/* Bruno 2026-05-19: botão de mic migrou pro slot do "enviar" à
                    direita do textarea. Envio de texto agora é só por Enter. */}
                <div className="flex-1" />
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Bot className={`w-3 h-3 ${aiActive ? "text-primary" : "text-muted-foreground/40"}`} />
                    <span className="text-[9px] text-muted-foreground">{aiActive ? "Assistente Norte" : "Assistente Off"}</span>
                    <button
                      onClick={() => {
                        const newState = !aiActive;
                        setAiActive(newState);
                        aiToggleMutation.mutate(!newState);
                      }}
                      className={`relative w-7 h-[15px] rounded-full transition-colors flex-shrink-0 ${aiActive ? "bg-primary" : "bg-muted"}`}
                      title={aiActive ? "Assistente Norte ativo — clique para desativar" : "Assistente Norte pausado — clique para reativar"}
                      data-testid="toggle-ai"
                    >
                      <div className={`absolute top-[2px] w-[11px] h-[11px] rounded-full bg-white transition-transform ${aiActive ? "left-[14px]" : "left-[2px]"}`} />
                    </button>
                  </div>
                  <div className="w-px h-3 bg-border" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-muted-foreground">{signMessages ? currentUserName : (workspaceName || "Sem assinatura")}</span>
                    <button
                      onClick={() => setSignMessages(!signMessages)}
                      className={`relative w-7 h-[15px] rounded-full transition-colors flex-shrink-0 ${signMessages ? "bg-emerald-500" : "bg-muted"}`}
                      title={signMessages ? "Assinando como " + currentUserName : (workspaceName ? "Enviando como " + workspaceName : "Sem assinatura")}
                      data-testid="toggle-sign-messages"
                    >
                      <div className={`absolute top-[2px] w-[11px] h-[11px] rounded-full bg-white transition-transform ${signMessages ? "left-[14px]" : "left-[2px]"}`} />
                    </button>
                  </div>
                </div>
              </div>

              {selected?.canal?.toLowerCase() === "instagram" && (
                <div className="px-3.5 pb-1">
                  <p className="text-[10px] text-pink-400/80 flex items-center gap-1" data-testid="warning-instagram-24h">
                    <Zap className="w-3 h-3" />
                    Instagram — janela de 24h. Responda rápido para manter a conversa ativa.
                  </p>
                </div>
              )}
              {selected?.canal?.toLowerCase() === "whatsapp oficial" && (
                <div className="px-3.5 pb-1">
                  <p className="text-[10px] text-emerald-400/80 flex items-center gap-1" data-testid="warning-whatsapp-oficial-24h">
                    <Zap className="w-3 h-3" />
                    WhatsApp Oficial — janela de 24h. Responda rápido ou use um template HSM.
                  </p>
                </div>
              )}
              <div
                className="px-3.5 pb-2.5 flex gap-2 items-end relative"
                style={chatMode === "interno" ? { background: "rgba(254,211,14,0.08)" } : undefined}
              >
                {qrOpen && (
                  <div
                    className="absolute left-3.5 right-3.5 bottom-full mb-2 z-30 rounded-xl border border-border bg-popover shadow-2xl overflow-hidden"
                    data-testid="quick-reply-picker"
                  >
                    <div className="px-3 py-1.5 border-b border-border/60 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-primary" />
                        <span>Respostas rápidas</span>
                        <span className="opacity-50">· {qrFiltered.length}</span>
                      </div>
                      <span className="text-[9.5px] opacity-60">↑↓ navegar · Enter usar · Esc fechar</span>
                    </div>
                    <div className="max-h-[280px] overflow-y-auto">
                      {qrFiltered.map((qr, idx) => {
                        const active = idx === qrIndex;
                        return (
                          <button
                            key={qr.title}
                            type="button"
                            onMouseEnter={() => setQrIndex(idx)}
                            onClick={() => applyQuickReply(qr)}
                            className={`w-full flex items-start gap-2.5 px-3 py-2 text-left border-b border-border/40 last:border-b-0 transition-colors ${
                              active ? "bg-primary/10" : "hover:bg-secondary/60"
                            }`}
                            data-testid={`quick-reply-option-${qr.title.toLowerCase()}`}
                          >
                            <span className={`flex-shrink-0 mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`}>
                              {qrIconFor(qr.tipoMidia)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-foreground truncate">{qr.title}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{qr.txt}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* Bruno 2026-05-19: preview da msg sendo respondida (reply/quote). */}
                {replyingTo && (
                  <div className="mb-2 px-3 py-2 rounded-md bg-muted/60 border-l-[3px] border-primary flex items-start gap-2" data-testid="reply-preview">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10.5px] font-semibold text-primary mb-0.5">
                        Respondendo {replyingTo.direction === "out" ? "sua mensagem" : (replyingTo.agente || "cliente")}
                      </div>
                      <div className="text-[12px] text-muted-foreground truncate">
                        {replyingTo.tipo === "audio" ? "🎤 Áudio"
                          : replyingTo.tipo === "image" ? "🖼️ Imagem"
                          : replyingTo.tipo === "contact" ? "📇 Contato"
                          : replyingTo.tipo === "location" ? "📍 Localização"
                          : replyingTo.tipo === "document" || replyingTo.tipo === "file" ? "📄 Documento"
                          : (replyingTo.texto || "").slice(0, 100)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onCancelReply}
                      className="text-muted-foreground hover:text-foreground text-[11px] px-1 py-0.5"
                      aria-label="Cancelar resposta"
                      data-testid="btn-cancel-reply"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="msg-textarea flex-1 text-[14.5px] text-foreground outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={chatMode === "cliente" && !canTypeCliente}
                  placeholder={chatMode === "interno"
                    ? "Nota interna (somente para a equipe). Enter envia."
                    : !canTypeCliente
                      ? "Assuma o atendimento para responder ao cliente"
                      : 'Escreva sua mensagem... ("/" para respostas rápidas, Enter envia)'}
                  value={newMsg}
                  onChange={(e) => {
                    setNewMsg(e.target.value);
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 160) + "px";
                  }}
                  onPaste={(e) => {
                    // Bruno 2026-06-05: colar PRINT (imagem do clipboard) direto no
                    // chat. Antes o Ctrl+V só colava texto. Mesmo caminho do anexo
                    // (sendMutation tipo=image + base64). Só no modo cliente assumido;
                    // interno/sem-assumir cai no paste normal de texto.
                    if (chatMode !== "cliente" || !canTypeCliente) return;
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const it of Array.from(items)) {
                      if (it.type && it.type.startsWith("image/")) {
                        const file = it.getAsFile();
                        if (!file) continue;
                        e.preventDefault();
                        if (file.size > 10 * 1024 * 1024) return; // 10MB
                        const reader = new FileReader();
                        reader.onload = () => {
                          const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
                          sendMutation.mutate({
                            texto: "[Imagem: colada]",
                            direction: "out",
                            agente: signMessages ? currentUserName : (workspaceName || undefined),
                            tipo: "image",
                            arquivo: reader.result as string,
                            nomeArquivo: `print_${Date.now()}.${ext}`,
                          });
                        };
                        reader.readAsDataURL(file);
                        return;
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (qrOpen) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setQrIndex((i) => (i + 1) % qrFiltered.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setQrIndex((i) => (i - 1 + qrFiltered.length) % qrFiltered.length);
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        applyQuickReply(qrFiltered[qrIndex]);
                        return;
                      }
                      if (e.key === "Tab") {
                        e.preventDefault();
                        applyQuickReply(qrFiltered[qrIndex]);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setNewMsg("");
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleComposerSend();
                    }
                  }}
                  rows={2}
                  data-testid="input-message"
                />
                {/* Bruno 2026-05-21: padrão WhatsApp — texto vazio = Mic
                    (gravar áudio); texto preenchido = Send (enviar). Enter
                    continua funcionando como atalho. */}
                {(() => {
                  const hasText = newMsg.trim().length > 0;
                  if (hasText) {
                    return (
                      <button
                        className="msg-send-btn gradient-accent flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleComposerSend}
                        disabled={sendMutation.isPending || (chatMode === "cliente" && !canTypeCliente)}
                        title="Enviar mensagem"
                        aria-label="Enviar mensagem"
                        data-testid="button-send"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                    );
                  }
                  return (
                    <button
                      className="msg-send-btn gradient-accent flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={startRecording}
                      disabled={chatMode === "cliente" && !canTypeCliente}
                      title="Gravar áudio"
                      aria-label="Gravar áudio"
                      data-testid="button-audio"
                    >
                      <Mic className="w-5 h-5" />
                    </button>
                  );
                })()}
              </div>
            </>
          )}
        </div>
        </>
      </>

      {/* Bruno 2026-05-21: dialogs do composer pra enviar contato + localização */}
      {selectedId && (
        <>
          <ContactPickerDialog
            open={contactPickerOpen}
            conversationId={selectedId}
            onClose={() => setContactPickerOpen(false)}
          />
          <LocationPickerDialog
            open={locationPickerOpen}
            conversationId={selectedId}
            onClose={() => setLocationPickerOpen(false)}
          />
        </>
      )}

      {/* Bruno 2026-05-21: createPortal + pointer-events-auto pra escapar do
          containing block do vaul Drawer.Content (transform) e do
          pointer-events:none que vaul aplica no body. Sem isso o lightbox
          ficava preso na lateral do drawer e botões inertes. */}
      {mediaLightbox && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto"
          style={{ animation: "msg-fade 160ms ease both", pointerEvents: "auto" }}
          onClick={() => setMediaLightbox(null)}
          data-testid="media-lightbox-overlay"
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center pointer-events-auto [&_*]:pointer-events-auto"
            style={{ animation: "conv-area-enter 220ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-2 -right-2 z-10 flex gap-2">
              {mediaLightbox.raw && (
                <a
                  href={mediaLightbox.raw}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
                  data-testid="lightbox-external-link"
                  title="Abrir externamente"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button
                onClick={() => setMediaLightbox(null)}
                className="w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
                data-testid="lightbox-close-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {mediaLightbox.type === "image" ? (
              <img
                src={mediaLightbox.src}
                alt="Media"
                className="max-w-[85vw] max-h-[80vh] rounded-xl object-contain shadow-2xl"
                data-testid="lightbox-image"
              />
            ) : (
              <video
                src={mediaLightbox.src}
                controls
                autoPlay
                playsInline
                className="max-w-[85vw] max-h-[80vh] rounded-xl bg-black shadow-2xl"
                data-testid="lightbox-video"
              />
            )}

            {/* Bruno 2026-05-22: guard de placeholder. Caption só renderiza
                se for texto REAL — "[Imagem: icone.png]" / "[figurinha]" / etc
                gerados pelo backend/useMediaHandlers ficam ocultos. */}
            {mediaLightbox.caption && !isPureMediaPlaceholder(mediaLightbox.caption) && (
              <p className="mt-3 text-white/90 text-sm max-w-[60vw] text-center bg-black/40 px-4 py-2 rounded-lg">
                {mediaLightbox.caption}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Bruno 2026-05-21: dialog "Escolha o setor" REMOVIDO.
          Assumir atribui direto ao atendente; setor é definido depois via
          TransferDialog quando atendente decidir, com a conv já em andamento. */}
    </div>
  );
}
