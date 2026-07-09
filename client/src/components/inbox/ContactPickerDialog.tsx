// Bruno 2026-05-21: picker de contatos do CRM pra enviar vCard pelo composer.
// Lista os Contacts do workspace, busca por nome/telefone, envia via
// POST /api/conversations/:id/send-contact que persiste + roteia pela Meta.
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, X, User, Loader2, Phone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ContactPickerDialogProps {
  open: boolean;
  conversationId: number;
  onClose: () => void;
}

export default function ContactPickerDialog({ open, conversationId, onClose }: ContactPickerDialogProps) {
  const [query, setQuery] = useState("");
  const { toast } = useToast();

  const { data: contacts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/contacts"],
    enabled: open,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    // Bruno 2026-06-08: `string.includes("")` é sempre true — só compara
    // telefone quando o termo tem dígitos, senão "bru" casava com todos.
    const qDigits = q.replace(/\D/g, "");
    return contacts.filter((c: any) =>
      (c.nome || "").toLowerCase().includes(q) ||
      (!!qDigits && (c.telefone || "").replace(/\D/g, "").includes(qDigits)),
    );
  }, [contacts, query]);

  const sendMut = useMutation({
    mutationFn: async (c: any) => {
      const payload = {
        contacts: [{
          name: c.nome || "",
          phones: [{ number: c.telefone || "", type: "CELL" }],
          ...(c.email ? { emails: [{ email: c.email, type: "WORK" }] } : {}),
          ...(c.empresa ? { organization: c.empresa } : {}),
        }],
      };
      return apiRequest("POST", `/api/conversations/${conversationId}/send-contact`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      toast({ title: "Contato enviado", description: "Cliente vai receber agora." });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao enviar", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <h3 className="text-[13px] font-semibold">Enviar contato</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-border/70">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="w-full pl-8 pr-3 py-1.5 rounded-full border border-border bg-background text-[12px] focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition-all"
              data-testid="input-search-contact"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-[12px]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Carregando contatos…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-[12px] px-4">
              {query ? "Nenhum contato encontrado." : "Você ainda não tem contatos cadastrados."}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((c: any) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={sendMut.isPending || !c.telefone}
                    onClick={() => sendMut.mutate(c)}
                    className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid={`contact-pick-${c.id}`}
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold truncate">{c.nome || "Sem nome"}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1 tabular-nums">
                        {c.telefone ? <><Phone className="w-3 h-3" /> {c.telefone}</> : <em>sem telefone</em>}
                      </div>
                    </div>
                    {sendMut.isPending && sendMut.variables?.id === c.id && (
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
