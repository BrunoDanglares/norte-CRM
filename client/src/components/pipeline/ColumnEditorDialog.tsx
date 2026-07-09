import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ChevronUp, ChevronDown, Bot, Hand, Flag, Loader2 } from "lucide-react";
import type { PipelineColumn } from "@shared/schema";

interface Props {
  open: boolean;
  onClose: () => void;
  pipeline: string;
  columns: PipelineColumn[];
}

// Editor das colunas do funil de vendas. Mexe em /api/pipeline-columns; o backbone
// operacional do bot (pipeline_stages) NÃO é tocado. Coluna nova nasce MANUAL.
export function ColumnEditorDialog({ open, onClose, pipeline, columns }: Props) {
  const { toast } = useToast();
  const [newLabel, setNewLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/pipeline-columns", pipeline] });

  const addMut = useMutation({
    mutationFn: (label: string) => apiRequest("POST", "/api/pipeline-columns", { label, pipeline }),
    onSuccess: () => { setNewLabel(""); invalidate(); toast({ title: "Coluna criada!" }); },
    onError: (e: any) => toast({ title: "Erro ao criar coluna", description: e?.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<PipelineColumn> }) =>
      apiRequest("PATCH", `/api/pipeline-columns/${id}`, data),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e?.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/pipeline-columns/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Coluna removida" }); },
    onError: (e: any) => toast({ title: "Não foi possível remover", description: e?.message, variant: "destructive" }),
  });

  const reorderMut = useMutation({
    mutationFn: (cols: { id: number; ordem: number }[]) =>
      apiRequest("POST", "/api/pipeline-columns/reorder", { columns: cols }),
    onSuccess: () => invalidate(),
  });

  const sorted = [...columns].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  const move = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= sorted.length) return;
    const reordered = [...sorted];
    const [item] = reordered.splice(idx, 1);
    reordered.splice(next, 0, item);
    reorderMut.mutate(reordered.map((c, i) => ({ id: c.id, ordem: i })));
  };

  const saveLabel = (col: PipelineColumn) => {
    const draft = drafts[col.id];
    if (draft === undefined || draft.trim() === col.label || !draft.trim()) return;
    patchMut.mutate({ id: col.id, data: { label: draft.trim() } });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="modal-column-editor">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Flag className="w-4 h-4" /> Colunas do funil
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] text-muted-foreground -mt-2">
          As colunas <b>automáticas</b> <Bot className="inline w-3 h-3 -mt-0.5" /> recebem os cards sozinhas (o bot move).
          As que <b>você cria</b> são <b>manuais</b> <Hand className="inline w-3 h-3 -mt-0.5" />: o card fica parado onde você arrasta.
        </p>

        <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
          {sorted.map((col, idx) => {
            const isAuto = (col.autoStates?.length ?? 0) > 0;
            const labelValue = drafts[col.id] ?? col.label;
            return (
              <div key={col.id} className="flex items-center gap-2 bg-secondary/40 border border-border/60 rounded-lg p-2" data-testid={`column-row-${col.key}`}>
                <div className="flex flex-col">
                  <button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25" disabled={idx === 0 || reorderMut.isPending} onClick={() => move(idx, -1)} title="Subir">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-25" disabled={idx === sorted.length - 1 || reorderMut.isPending} onClick={() => move(idx, 1)} title="Descer">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <input
                  type="color"
                  value={col.color || "#7c5cbf"}
                  onChange={(e) => patchMut.mutate({ id: col.id, data: { color: e.target.value } })}
                  className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent shrink-0"
                  title="Cor"
                  data-testid={`column-color-${col.key}`}
                />

                <Input
                  value={labelValue}
                  onChange={(e) => setDrafts((d) => ({ ...d, [col.id]: e.target.value }))}
                  onBlur={() => saveLabel(col)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="h-7 text-[12px] flex-1 min-w-0"
                  data-testid={`column-label-${col.key}`}
                />

                <span className="flex items-center gap-1 shrink-0">
                  {isAuto ? (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20" title="Recebe cards automaticamente do bot">
                      <Bot className="w-2.5 h-2.5" /> auto
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border" title="Manual — o card fica onde você arrasta">
                      <Hand className="w-2.5 h-2.5" /> manual
                    </span>
                  )}
                  {col.isTerminal && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20" title="Coluna final — o card é arquivado ao cair aqui">
                      <Flag className="w-2.5 h-2.5" /> final
                    </span>
                  )}
                </span>

                <button
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 disabled:opacity-30"
                  disabled={sorted.length <= 1 || deleteMut.isPending}
                  onClick={() => {
                    if (confirm(`Remover a coluna "${col.label}"? Os cards parados nela voltam pra primeira coluna.`)) deleteMut.mutate(col.id);
                  }}
                  title="Remover coluna"
                  data-testid={`column-delete-${col.key}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Input
            placeholder="Nome da nova coluna (ex: Proposta enviada)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) addMut.mutate(newLabel.trim()); }}
            className="h-8 text-[12px] flex-1"
            data-testid="input-new-column"
          />
          <Button
            size="sm"
            className="gradient-accent text-white h-8 shrink-0"
            disabled={!newLabel.trim() || addMut.isPending}
            onClick={() => addMut.mutate(newLabel.trim())}
            data-testid="button-add-column"
          >
            {addMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Adicionar</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
