import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, apiFetch, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Pencil, Trash2 } from "lucide-react";

export default function NotasSection({ conversationId }: { conversationId: number }) {
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const { toast } = useToast();

  const { data: notesData, isLoading } = useQuery<{ ok: boolean; data: any[] }>({
    queryKey: ["/api/anotacoes", `conversationId=${conversationId}`],
    queryFn: () =>
      apiFetch(`/api/anotacoes?conversationId=${conversationId}`),
  });

  const notes = notesData?.data || [];

  const createMutation = useMutation({
    mutationFn: (body: { conteudo: string; conversationId: number }) =>
      apiRequest("POST", "/api/anotacoes", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anotacoes"] });
      setNewNote("");
      toast({ title: "Nota salva!" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, conteudo }: { id: number; conteudo: string }) =>
      apiRequest("PATCH", `/api/anotacoes/${id}`, { conteudo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anotacoes"] });
      setEditingId(null);
      toast({ title: "Nota atualizada!" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/anotacoes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anotacoes"] });
      toast({ title: "Nota removida!" });
    },
  });

  return (
    <div className="p-4">
      <div className="text-[10px] font-bold text-muted-foreground tracking-wide uppercase mb-2">NOTAS INTERNAS</div>

      <div className="mb-3">
        <textarea
          className="w-full bg-secondary border border-border rounded-lg p-2.5 text-[11.5px] text-foreground outline-none resize-none focus:border-primary h-20"
          placeholder="Adicionar nota interna sobre este contato..."
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          data-testid="textarea-internal-notes"
        />
        <button
          className="btn btn-primary btn-sm w-full gap-1 mt-1.5 text-[11px] font-bold"
          onClick={() => createMutation.mutate({ conteudo: newNote.trim(), conversationId })}
          disabled={createMutation.isPending || !newNote.trim()}
          data-testid="button-save-notes"
        >
          <Plus className="w-3 h-3" />
          {createMutation.isPending ? "Salvando..." : "Salvar nota"}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-[11px]">Nenhuma nota para esta conversa</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note: any) => (
            <div
              key={note.id}
              className="bg-secondary/60 border border-border rounded-lg p-2.5 group"
              data-testid={`inbox-note-${note.id}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-muted-foreground font-semibold">
                  {note.criadoPorNome || "Usuário"} · {note.createdAt ? new Date(note.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
                <div className="flex gap-1">
                  <button
                    className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setEditingId(note.id); setEditingContent(note.conteudo); }}
                    data-testid={`button-edit-inbox-note-${note.id}`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => { if (confirm("Remover nota?")) deleteMutation.mutate(note.id); }}
                    data-testid={`button-delete-inbox-note-${note.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {editingId === note.id ? (
                <div>
                  <textarea
                    className="w-full bg-background border border-border rounded p-1.5 text-[11px] text-foreground outline-none resize-none focus:border-primary h-16"
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    data-testid={`textarea-edit-inbox-note-${note.id}`}
                  />
                  <div className="flex gap-1.5 justify-end mt-1">
                    <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setEditingId(null)}>Cancelar</button>
                    <button
                      className="text-[10px] text-primary font-bold"
                      onClick={() => updateMutation.mutate({ id: note.id, conteudo: editingContent })}
                      data-testid="button-confirm-inbox-edit"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed">{note.conteudo}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
