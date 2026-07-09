import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/queryClient";
import { sanitizeDisplayName, getInitials } from "@/lib/constants";
import {
  MessageSquare, CheckCircle2, ArrowRightLeft, User, Briefcase,
  Tag, DollarSign, Clock, Loader2
} from "lucide-react";

export default function HistoricoDialog({ conv, onClose }: { conv: any; onClose: () => void }) {
  const { data: histData, isLoading } = useQuery<{ ok: boolean; stats: any; timeline: any[] }>({
    queryKey: ["/api/conversations", conv.id, "historico"],
    queryFn: async () => {
      return apiFetch(`/api/conversations/${conv.id}/historico`);
    },
  });

  const tipoIcon = (tipo: string) => {
    switch (tipo) {
      case "conversa_aberta": return <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />;
      case "conversa_resolvida": return <CheckCircle2 className="w-3.5 h-3.5 text-base-content/50" />;
      case "atendente_atribuido": return <ArrowRightLeft className="w-3.5 h-3.5 text-purple-500" />;
      case "atendente_responsavel": return <User className="w-3.5 h-3.5 text-purple-500" />;
      case "primeira_mensagem": return <MessageSquare className="w-3.5 h-3.5 text-tertiary-500" />;
      case "ultima_mensagem": return <MessageSquare className="w-3.5 h-3.5 text-tertiary-600 dark:text-tertiary-500" />;
      case "pipeline_stage": return <Briefcase className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />;
      case "tag_adicionada": return <Tag className="w-3.5 h-3.5 text-amber-500" />;
      case "lead_tag": return <Tag className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />;
      case "lead_owner": return <User className="w-3.5 h-3.5 text-cyan-500" />;
      case "lead_valor": return <DollarSign className="w-3.5 h-3.5 text-emerald-500" />;
      default: return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const formatDate = (d: string) => {
    const dt = new Date(d);
    return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: `hsl(${(conv.nome || "").split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 360}, 60%, 45%)` }}>
              {getInitials(conv.nome || "")}
            </div>
            <div>
              <div className="text-[14px] font-bold">{sanitizeDisplayName(conv.nome) || conv.telefone || "Cliente"}</div>
              <div className="text-[11px] text-muted-foreground font-normal">Historico do atendimento</div>
            </div>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 pr-1">
            {conv.assignedUserName && (
              <div className="mb-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20" data-testid="historico-atendente-info">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <div className="text-[12px] font-bold text-purple-300">Atendido por</div>
                    <div className="text-[14px] font-semibold text-purple-600 dark:text-purple-400">{conv.assignedUserName}</div>
                  </div>
                </div>
              </div>
            )}

            {conv.agente && (
              <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/10" data-testid="historico-agente-info">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-primary" />
                  <div>
                    <div className="text-[11px] text-muted-foreground">Atribuido a</div>
                    <div className="text-[13px] font-bold">{conv.agente}</div>
                  </div>
                </div>
              </div>
            )}

            {histData?.stats && (
              <div className="grid grid-cols-2 gap-2 mb-4" data-testid="historico-stats">
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <div className="text-[16px] font-semibold text-primary">{histData.stats.totalMessages}</div>
                  <div className="text-[9px] text-muted-foreground">Mensagens</div>
                </div>
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <div className="text-[16px] font-semibold text-emerald-600 dark:text-emerald-400">{histData.stats.respostasAtendente}</div>
                  <div className="text-[9px] text-muted-foreground">Respostas</div>
                </div>
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <div className="text-[16px] font-semibold text-amber-600 dark:text-amber-400">{histData.stats.tempoAberto}</div>
                  <div className="text-[9px] text-muted-foreground">Tempo aberto</div>
                </div>
                <div className="bg-secondary rounded-lg p-2.5 text-center">
                  <div className="text-[16px] font-semibold text-tertiary-600 dark:text-tertiary-500">{histData.stats.tempoMedioResp}</div>
                  <div className="text-[9px] text-muted-foreground">Tempo medio resp.</div>
                </div>
              </div>
            )}

            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Timeline</div>
            <div className="relative pl-5 border-l-2 border-border">
              {(histData?.timeline || []).map((item: any, i: number) => (
                <div key={i} className="relative mb-3 last:mb-0" data-testid={`historico-event-${i}`}>
                  <div className="absolute -left-[25px] top-0.5 w-5 h-5 rounded-full bg-card border-2 border-border flex items-center justify-center">
                    {tipoIcon(item.tipo)}
                  </div>
                  <div className="bg-secondary/50 rounded-lg p-2.5">
                    <div className="text-[11px] font-bold">{item.titulo}</div>
                    <div className="text-[10px] text-muted-foreground">{item.subtitulo}</div>
                    <div className="text-[9px] text-muted-foreground/60 mt-0.5">{formatDate(item.data)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
