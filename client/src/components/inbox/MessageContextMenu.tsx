import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Reply, Pencil, Trash2, Download, ChevronDown, Forward, Search, Loader2, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ContactAvatar from "@/components/ContactAvatar";

// Bruno 2026-05-19: menu de contexto da mensagem no chat. Pra cada msg
// renderiza um botão "⋮" que abre dropdown com Reply/Edit/Delete/Download.
// As ações disponíveis dependem da direção + tipo + idade da msg:
//   - Reply: sempre (in + out, qualquer tipo)
//   - Edit: só texto outbound, dentro de 15min
//   - Delete: out (sempre) + in (soft-delete local)
//   - Download: só mídia (image/audio/video/document/file)

interface MessageContextMenuProps {
  msg: any;
  conversationId: number;
  onReply: (msg: any) => void;
  isOut?: boolean;
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export default function MessageContextMenu({ msg, conversationId, onReply, isOut: isOutProp }: MessageContextMenuProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.texto || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bruno 2026-05-20: encaminhar mensagem pra outra conversa. Usa rota
  // existente POST /api/conversations/:id/messages — não precisa endpoint
  // backend novo. Filtra conversas abertas (status != resolved) com search.
  const [forwarding, setForwarding] = useState(false);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardBusy, setForwardBusy] = useState(false);

  const { data: forwardConvs = [] } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
    enabled: forwarding,
    staleTime: 30_000,
  });

  const filteredForward = useMemo(() => {
    const q = forwardSearch.trim().toLowerCase();
    return forwardConvs
      .filter((c) => c.id !== conversationId && c.status !== "resolved")
      .filter((c) => !q || (c.nome || "").toLowerCase().includes(q) || (c.telefone || "").includes(q))
      .slice(0, 80);
  }, [forwardConvs, forwardSearch, conversationId]);

  const doForward = async (targetConvId: number) => {
    if (forwardBusy) return;
    setForwardBusy(true);
    try {
      const tipo = msg.tipo || "text";
      const payload: any = { texto: msg.texto || "", tipo };
      if (msg.arquivo) payload.arquivo = msg.arquivo;
      if (msg.nomeArquivo) payload.nomeArquivo = msg.nomeArquivo;
      const res = await apiRequest("POST", `/api/conversations/${targetConvId}/messages`, payload);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || d.error || "Falha ao encaminhar");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", targetConvId, "messages"] });
      setForwarding(false);
      setForwardSearch("");
      toast({ title: "Mensagem encaminhada", description: "A mensagem foi enviada na conversa selecionada." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setForwardBusy(false);
    }
  };

  if (msg.deletedAt) return null; // msg já excluída — sem menu

  const isOut = isOutProp ?? msg.direction === "out";
  const tipo = msg.tipo || "text";
  const isMedia = ["image", "audio", "video", "document", "file"].includes(tipo);
  const isText = tipo === "text";
  const ageMs = msg.createdAt ? Date.now() - new Date(msg.createdAt).getTime() : Infinity;
  const canEdit = isOut && isText && ageMs < FIFTEEN_MIN_MS;

  // Bruno 2026-05-21: copy de texto. Vale pra:
  //  - texto puro (tipo === "text")
  //  - transcrição de áudio (salva em msg.texto; placeholders "[audio*]" do
  //    useAudioRecorder não contam — ver MessageArea L1487 hasTranscription)
  //  - caption de mídia (imagem/vídeo/documento com legenda real, sem o
  //    marcador "[imagem]"/"[video]"/"[documento]" do receiver)
  const rawTexto = String(msg.texto || "").trim();
  const placeholderRe = /^\[(audio|áudio|imagem|image|video|vídeo|documento|document|arquivo|sticker|figurinha)\b/i;
  const hasRealText = !!rawTexto && !placeholderRe.test(rawTexto);
  const isAudioWithTranscription = tipo === "audio" && hasRealText;
  const canCopy = hasRealText && (isText || isAudioWithTranscription || isMedia);
  const copyableText = canCopy ? rawTexto : "";

  const doCopy = async () => {
    if (!copyableText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyableText);
      } else {
        // Fallback pra contextos sem Clipboard API (file://, http inseguro).
        const ta = document.createElement("textarea");
        ta.value = copyableText;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast({ title: "Copiado", description: "Texto copiado pra área de transferência." });
    } catch (err: any) {
      toast({ title: "Erro", description: err?.message || "Não foi possível copiar.", variant: "destructive" });
    }
  };

  const doDelete = async (forEveryone: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiRequest("DELETE", `/api/messages/${msg.id}`, forEveryone ? { forEveryone: true } : undefined);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Falha ao excluir");
      }
      const body = await res.json().catch(() => ({}));
      // Atualiza cache localmente — o WS message_updated também chega
      queryClient.setQueryData<any[]>(
        ["/api/conversations", conversationId, "messages"],
        (old = []) => old?.map((m) => m.id === msg.id ? { ...m, deletedAt: new Date().toISOString() } : m),
      );
      setConfirmDelete(false);
      if (forEveryone) {
        const fe = body?.forEveryone;
        if (fe?.ok) {
          toast({ title: "Apagada para todos", description: "A mensagem foi substituída no WhatsApp do cliente." });
        } else {
          const reasonMap: Record<string, string> = {
            only_outbound: "Só dá pra apagar pra todos mensagens que você enviou.",
            only_text: "WhatsApp só permite apagar texto pra todos (mídia não).",
            window_expired: "Janela de 15min pra apagar pra todos expirou.",
            no_external_id: "Mensagem ainda não foi entregue ao WhatsApp.",
            no_phone: "Telefone do cliente não disponível.",
            no_meta_connection: "Conexão WhatsApp oficial não configurada.",
          };
          const desc = reasonMap[fe?.reason] || `Removida do painel mas continua no WhatsApp do cliente (${fe?.reason || "erro desconhecido"}).`;
          toast({ title: "Removida só do painel", description: desc });
        }
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // Pré-cálculo: "Apagar pra todos" só faz sentido pra outbound + texto + <15min.
  const canDeleteForEveryone = isOut && (msg.tipo === "text" || !msg.tipo) && ageMs < FIFTEEN_MIN_MS;

  const doEdit = async () => {
    if (busy) return;
    const novoTexto = editText.trim();
    if (!novoTexto || novoTexto === msg.texto) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest("PATCH", `/api/messages/${msg.id}`, { texto: novoTexto });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Falha ao editar");
      }
      queryClient.setQueryData<any[]>(
        ["/api/conversations", conversationId, "messages"],
        (old = []) => old?.map((m) => m.id === msg.id ? { ...m, texto: novoTexto, editedAt: new Date().toISOString(), originalTexto: m.originalTexto || m.texto } : m),
      );
      setEditing(false);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const doDownload = () => {
    if (!msg.arquivo) return;
    const url = msg.arquivo;
    const a = document.createElement("a");
    a.href = url;
    a.download = msg.nomeArquivo || `download_${msg.id}`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* Bruno 2026-05-21: trigger agora vive na action bar lateral FORA
              da bolha (ver MessageArea, container com `right-full`/`left-full`).
              Antes era absolute dentro da bolha e cobria texto de mensagens
              curtas (ex: "Vou explicar"). Visibilidade hover é controlada
              pelo container pai; data-[state=open] mantém o estilo ativo
              enquanto o dropdown estiver aberto. */}
          <button
            type="button"
            className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-card/95 hover:bg-secondary border border-border/60 text-foreground shadow-sm cursor-pointer transition-colors backdrop-blur-sm data-[state=open]:bg-secondary"
            aria-label="Ações da mensagem"
            data-testid={`msg-menu-${msg.id}`}
          >
            <ChevronDown className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="w-52 z-[100]">
          <DropdownMenuItem onClick={() => onReply(msg)} data-testid={`msg-action-reply-${msg.id}`}>
            <Reply className="w-3.5 h-3.5 mr-2" />
            Responder
          </DropdownMenuItem>
          {canCopy && (
            <DropdownMenuItem onClick={doCopy} data-testid={`msg-action-copy-${msg.id}`}>
              <Copy className="w-3.5 h-3.5 mr-2" />
              {isAudioWithTranscription ? "Copiar transcrição" : "Copiar texto"}
            </DropdownMenuItem>
          )}
          {canEdit && (
            <DropdownMenuItem onClick={() => { setEditText(msg.texto || ""); setEditing(true); }} data-testid={`msg-action-edit-${msg.id}`}>
              <Pencil className="w-3.5 h-3.5 mr-2" />
              Editar mensagem
            </DropdownMenuItem>
          )}
          {isMedia && msg.arquivo && (
            <DropdownMenuItem onClick={doDownload} data-testid={`msg-action-download-${msg.id}`}>
              <Download className="w-3.5 h-3.5 mr-2" />
              Download
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => { setForwardSearch(""); setForwarding(true); }} data-testid={`msg-action-forward-${msg.id}`}>
            <Forward className="w-3.5 h-3.5 mr-2" />
            Encaminhar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmDelete(true)}
            className="text-rose-600 dark:text-rose-400 focus:text-rose-700"
            data-testid={`msg-action-delete-${msg.id}`}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Excluir mensagem
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit inline dialog — Bruno 2026-05-21: createPortal pro body.
          Sem isso, o `fixed inset-0` fica preso dentro do ConversaDrawer
          (vaul cria containing block via transform), o modal aparece cortado
          encavalado no chat e os botões deixam de funcionar. Portal garante
          que renderize na viewport inteira como esperado.
          pointer-events-auto explícito: o Radix DropdownMenu marca `pointer-events:none`
          no <body> enquanto fecha — como o modal vira filho do body via portal,
          herda o bloqueio e os botões não recebem clique. */}
      {editing && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto" onClick={() => !busy && setEditing(false)}>
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto [&_*]:pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold mb-1">Editar mensagem</h3>
            <p className="text-[12px] text-muted-foreground mb-3">A edição só vale no painel — o cliente continua vendo a mensagem original no WhatsApp.</p>
            {/* Bruno 2026-05-21: pointer-events-auto explícito em CADA elemento
                interativo do dialog. Mesmo com o card pai tendo a class, alguns
                browsers (Chromium em particular) não propagam corretamente quando
                o body está com pointer-events:none aplicado pelo Radix Dialog
                scope. Sintoma: textarea não recebe foco/click, botões inertes. */}
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full min-h-[110px] text-[13.5px] p-3 rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring pointer-events-auto"
              autoFocus
              data-testid="edit-textarea"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="h-10 px-5 text-[13px] font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-50 pointer-events-auto"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={doEdit}
                disabled={busy || !editText.trim()}
                className="h-10 px-5 text-[13px] font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 pointer-events-auto"
                data-testid="btn-save-edit"
              >
                {busy ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirm delete dialog — Bruno 2026-05-19: botões maiores + opção "apagar pra todos". */}
      {confirmDelete && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
          onClick={() => !busy && setConfirmDelete(false)}
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-5 pointer-events-auto [&_*]:pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold mb-1">Excluir mensagem?</h3>
            <p className="text-[12.5px] text-muted-foreground mb-4 leading-relaxed">
              {canDeleteForEveryone
                ? "Você pode apagar só do painel (cliente continua vendo no celular) ou apagar pra todos (substitui por “mensagem removida” no WhatsApp do cliente)."
                : isOut
                  ? "A mensagem some do painel. O cliente continua vendo a original no WhatsApp dele."
                  : "A mensagem some do painel CRM. (Apagar pra todos só vale pra mensagens enviadas por você, no formato texto, dentro de 15 min.)"}
            </p>
            <div className="flex flex-col sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="h-10 px-5 text-[13px] font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-50 order-3 sm:order-1 pointer-events-auto"
                data-testid="btn-cancel-delete"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => doDelete(false)}
                disabled={busy}
                className="h-10 px-5 text-[13px] font-medium rounded-lg border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 transition-colors disabled:opacity-50 order-2 pointer-events-auto"
                data-testid="btn-delete-local"
              >
                {busy ? "..." : "Apagar do painel"}
              </button>
              {canDeleteForEveryone && (
                <button
                  type="button"
                  onClick={() => doDelete(true)}
                  disabled={busy}
                  className="h-10 px-5 text-[13px] font-semibold rounded-lg bg-error hover:bg-error/90 text-error-content transition-colors disabled:opacity-50 order-1 sm:order-3 pointer-events-auto"
                  data-testid="btn-delete-for-everyone"
                >
                  {busy ? "Apagando..." : "Apagar para todos"}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Bruno 2026-05-20: dialog de encaminhar mensagem — escolhe conversa
          destino numa lista pesquisável (mesmo padrão do "Nova conversa"). */}
      {forwarding && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
          onClick={() => !forwardBusy && setForwarding(false)}
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col pointer-events-auto [&_*]:pointer-events-auto" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "80vh" }}>
            <div className="px-5 pt-4 pb-3 border-b border-border">
              <h3 className="text-[15px] font-semibold mb-2 flex items-center gap-2">
                <Forward className="w-4 h-4 text-primary" />
                Encaminhar mensagem
              </h3>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  placeholder="Buscar contato ou número…"
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-background text-[12.5px] outline-none focus:border-primary/50 pointer-events-auto"
                  data-testid="forward-search-input"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredForward.length === 0 ? (
                <div className="px-5 py-10 text-center text-[12px] text-muted-foreground">
                  Nenhuma conversa encontrada.
                </div>
              ) : (
                filteredForward.map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => doForward(c.id)}
                    disabled={forwardBusy}
                    className="w-full flex items-center gap-2.5 px-5 py-2.5 hover:bg-secondary/60 border-b border-border/40 last:border-b-0 transition-colors text-left disabled:opacity-50 pointer-events-auto"
                    data-testid={`forward-target-${c.id}`}
                  >
                    <ContactAvatar nome={c.nome || "?"} fotoUrl={c.avatar} size={32} rounded="50%" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate">{c.nome || "Sem nome"}</div>
                      {c.telefone && <div className="text-[10.5px] text-muted-foreground tabular-nums truncate">{c.telefone}</div>}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => { setForwarding(false); setForwardSearch(""); }}
                disabled={forwardBusy}
                className="h-9 px-4 text-[12.5px] font-medium rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-50 pointer-events-auto"
                data-testid="btn-cancel-forward"
              >
                Cancelar
              </button>
              {forwardBusy && (
                <span className="ml-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Encaminhando…
                </span>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
