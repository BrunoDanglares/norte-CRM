import { useEffect, useMemo, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Bruno 2026-05-20: reactions de emoji em mensagens. Local-only — não propaga
// pra Meta. Quick reactions: 6 emojis comuns + botão "+" pra abrir picker do
// emoji-mart já presente no app. Toggle: clicar de novo no mesmo emoji remove.

interface ReactionRow {
  id: string;
  messageId: number;
  emoji: string;
  userId: number;
  userName: string | null;
  createdAt: string;
}

interface ReactionsByMsgMap {
  [messageId: number]: ReactionRow[];
}

const QUICK_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export function useConversationReactions(conversationId: number | null) {
  const { data } = useQuery<{ ok: boolean; data: ReactionRow[] }>({
    queryKey: ["/api/conversations", conversationId, "reactions"],
    enabled: !!conversationId,
    staleTime: 5000,
    refetchInterval: 20000,
    refetchOnWindowFocus: false,
  });

  return useMemo<ReactionsByMsgMap>(() => {
    const map: ReactionsByMsgMap = {};
    if (!data?.data) return map;
    for (const r of data.data) {
      (map[r.messageId] ||= []).push(r);
    }
    return map;
  }, [data]);
}

interface ReactionPickerProps {
  messageId: number;
  conversationId: number;
  currentUserId: number;
  reactions: ReactionRow[];
  isOut: boolean;
  /** Toggle por click. Se passado, abre picker externo (emoji-mart) ao invés do default. */
  onOpenFullPicker?: (messageId: number) => void;
}

export function ReactionPicker({ messageId, conversationId, currentUserId, reactions, isOut, onOpenFullPicker }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Bruno 2026-05-21: click-outside via listener no document em vez de backdrop
  // <div fixed inset-0>. O chat roda dentro de drawer (vaul) com transform, o
  // que faz `fixed` virar relativo ao drawer e o backdrop fica preso no
  // stacking context local da bolha — bolhas vizinhas/áreas do chat capturam
  // o clique antes. Listener no document é imune a stacking context.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const toggle = useMutation({
    mutationFn: async (emoji: string) => {
      const res = await apiRequest("POST", `/api/messages/${messageId}/reactions`, { emoji });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Erro");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "reactions"] });
      setOpen(false);
    },
  });

  const myEmojis = new Set(reactions.filter((r) => r.userId === currentUserId).map((r) => r.emoji));

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-card/95 hover:bg-secondary border border-border/60 text-foreground shadow-sm transition-colors backdrop-blur-sm"
        aria-label="Reagir à mensagem"
        title="Reagir"
        data-testid={`reaction-trigger-${messageId}`}
      >
        <SmilePlus className="w-3.5 h-3.5" />
      </button>
      {open && (
        // Bruno 2026-05-21: alinhamento do popover segue o lado da bolha.
        // isOut (mensagem do atendente, bolha à direita) → ancora à direita
        // do trigger. !isOut (cliente, bolha à esquerda) → ancora à esquerda,
        // senão o popover vaza pra fora do chat.
        <div
          className={`absolute z-40 bottom-full ${isOut ? "right-0" : "left-0"} mb-1.5 px-1.5 py-1 rounded-full bg-popover border border-border shadow-xl flex items-center gap-0.5`}
          data-testid={`reaction-picker-${messageId}`}
        >
          {QUICK_EMOJIS.map((emoji) => {
            const mine = myEmojis.has(emoji);
            return (
              <button
                key={emoji}
                type="button"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(emoji)}
                className={`w-7 h-7 rounded-full text-[18px] inline-flex items-center justify-center transition-transform hover:scale-125 active:scale-95 ${
                  mine ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-secondary"
                }`}
                title={mine ? "Remover reação" : `Reagir com ${emoji}`}
                data-testid={`reaction-emoji-${emoji}`}
              >
                {emoji}
              </button>
            );
          })}
          {onOpenFullPicker && (
            <button
              type="button"
              onClick={() => { setOpen(false); onOpenFullPicker(messageId); }}
              className="w-7 h-7 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary ml-0.5"
              title="Outros emojis"
            >
              <SmilePlus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ReactionListProps {
  messageId: number;
  conversationId: number;
  currentUserId: number;
  reactions: ReactionRow[];
}

/** Renderiza chips abaixo da bubble agrupando reactions por emoji. */
export function ReactionList({ messageId, conversationId, currentUserId, reactions }: ReactionListProps) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async (emoji: string) => {
      const res = await apiRequest("POST", `/api/messages/${messageId}/reactions`, { emoji });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "reactions"] });
    },
  });

  if (!reactions || reactions.length === 0) return null;

  const grouped: Record<string, ReactionRow[]> = {};
  for (const r of reactions) (grouped[r.emoji] ||= []).push(r);
  const entries = Object.entries(grouped);

  return (
    <div className="flex flex-wrap gap-1 mt-1" data-testid={`reaction-list-${messageId}`}>
      {entries.map(([emoji, rows]) => {
        const mine = rows.some((r) => r.userId === currentUserId);
        const tip = rows.map((r) => r.userName || "Atendente").join(", ");
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => toggle.mutate(emoji)}
            disabled={toggle.isPending}
            className={`inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[11px] border transition-colors ${
              mine
                ? "bg-primary/15 border-primary/40 text-foreground"
                : "bg-muted/60 border-border hover:bg-muted text-foreground/85"
            }`}
            title={tip}
            data-testid={`reaction-chip-${emoji}`}
          >
            <span className="text-[13px] leading-none">{emoji}</span>
            {rows.length > 1 && <span className="font-semibold tabular-nums">{rows.length}</span>}
          </button>
        );
      })}
    </div>
  );
}
