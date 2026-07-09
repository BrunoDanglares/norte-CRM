import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getSituationTagColor, SITUATION_LABELS, getSituationLabel, type ConversationSituationTag } from "@/lib/situation-tags";
import { sanitizeDisplayName } from "@/lib/constants";
import {
  Check, Clock, Loader2, User, Users, ChevronDown,
  MessageSquare, AlertTriangle, FileText, Tag, Send,
  Flame, TrendingDown, Minus, CheckCircle2, BarChart3
} from "lucide-react";

interface ResolveDialogProps {
  conv: any;
  onClose: () => void;
  /**
   * Callback chamado APÓS a finalização ser confirmada (request disparado,
   * antes do await). Usado pelo Inbox em modo embed pra fechar o ConversaDrawer
   * pai junto — Bruno 2026-05-21: ao finalizar conv pelo drawer flutuante, o
   * próprio drawer fecha (atendimento concluído, faz sentido sair da tela).
   */
  onResolveSuccess?: () => void;
  availableTags: { id: number; nome: string; cor: string }[];
  equipesList: any[];
  pipelinesData: any[] | undefined;
  pipelineStagesData: any[] | undefined;
}

function parseUTC(str: string): Date {
  // PostgreSQL timestamps may come without timezone info — force UTC parsing
  if (!str.endsWith("Z") && !str.includes("+") && !/[+-]\d{2}:\d{2}$/.test(str)) {
    return new Date(str.replace(" ", "T") + "Z");
  }
  return new Date(str);
}

function formatDuration(startStr: string | null | undefined): string {
  if (!startStr) return "—";
  const diffMs = Date.now() - parseUTC(String(startStr)).getTime();
  if (diffMs < 0 || isNaN(diffMs)) return "—";
  const totalSec = Math.floor(diffMs / 1000);
  if (totalSec < 60) return "< 1min";
  const totalMin = Math.floor(totalSec / 60);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

const PIPELINE_COLORS: Record<string, string> = {
  comercial: "hsl(var(--primary))",
  suporte: "#10b981",
  financeiro: "#f59e0b",
};

const PRIORIDADE_OPTIONS = [
  { key: "alta",  label: "Alta",  icon: Flame,       color: "#ef4444" },
  { key: "media", label: "Média", icon: Minus,        color: "#f59e0b" },
  { key: "baixa", label: "Baixa", icon: TrendingDown, color: "#10b981" },
];

export default function ResolveDialog({
  conv, onClose, onResolveSuccess, availableTags, equipesList, pipelinesData, pipelineStagesData,
}: ResolveDialogProps) {
  const { toast } = useToast();
  const [pipelineEtapa, setPipelineEtapa] = useState(conv.pipelineEtapa || "");
  const [selectedSector, setSelectedSector] = useState("");
  const [prioridade, setPrioridade] = useState(conv.prioridade || "media");
  const [observacao, setObservacao] = useState("");
  const [enviarProtocoloCsat, setEnviarProtocoloCsat] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const startTs = conv.createdAt || conv.created_at || null;
  const [tempoAtendimento, setTempoAtendimento] = useState(() => formatDuration(startTs));

  useEffect(() => {
    setTempoAtendimento(formatDuration(startTs));
    const interval = setInterval(() => setTempoAtendimento(formatDuration(startTs)), 60000);
    return () => clearInterval(interval);
  }, [startTs]);

  const resolveConvId = conv?.id;
  const { data: resolveSitTags = [] } = useQuery<ConversationSituationTag[]>({
    queryKey: ["/api/conversations", resolveConvId, "situation-tags"],
    enabled: !!resolveConvId,
  });

  // ISP removido: a config de CSAT vinha de GET /api/isp/capabilities (rota
  // removida). Sem o módulo ISP, o CSAT por protocolo fica desligado por padrão.

  function confirmResolve() {
    if (submitting) return;
    setSubmitting(true);

    // Fecha o dialog imediatamente — não bloqueia a UI
    onClose();
    // Avisa o parent que a finalização foi disparada — Inbox em modo embed
    // usa pra fechar o ConversaDrawer pai (atendimento concluído).
    onResolveSuccess?.();

    // Atualização otimista: remove da lista de ativas na hora
    queryClient.setQueryData<any[]>(["/api/conversations"], (old) =>
      old ? old.map((c: any) => c.id === conv.id ? { ...c, status: "resolved" } : c) : old
    );

    // Dispara em background — sem await no chamador
    (async () => {
      try {
        // pipelineEtapa vai no body do resolve — backend usa para archival decision
        await apiRequest("PATCH", `/api/conversations/${conv.id}/status`, {
          status: "resolved",
          prioridade,
          observacao: observacao.trim() || null,
          enviarEncerramento: enviarProtocoloCsat,
          enviarCsat: enviarProtocoloCsat,
          pipelineEtapa: pipelineEtapa || null,
        });
        toast({ title: "✅ Conversa finalizada!" });
      } catch (e: any) {
        toast({ title: "Erro ao finalizar", description: e.message, variant: "destructive" });
      } finally {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"], exact: true });
      }
    })();
  }

  const convAgente = conv.agente || "";
  const teamM = convAgente.match(/^\[Equipe\]\s*(.+)$/);
  const resolveTeam = teamM ? equipesList.find((eq: any) => eq.nome === teamM[1]) : null;
  const assignedPipeKey = resolveTeam?.pipelineKey || conv.pipeline || null;
  // If assigned, use it; otherwise fall back to agent-selected sector
  const resolvePipeKey = assignedPipeKey || (selectedSector || null);
  const pipeColor = PIPELINE_COLORS[resolvePipeKey || ""] || "#8b5cf6";
  const resolvePipeLabel = resolvePipeKey
    ? (pipelinesData || []).find((p: any) => p.key === resolvePipeKey)?.label || resolvePipeKey
    : null;

  const allStages = (pipelineStagesData || []).sort((a: any, b: any) => (a.ordem || 0) - (b.ordem || 0));
  const pipeStages = resolvePipeKey
    ? (() => { const f = allStages.filter((s: any) => s.pipeline === resolvePipeKey); return f.length > 0 ? f : allStages; })()
    : [];

  const atendente = conv.assignedUserName || conv.agente || "—";
  const atendenteIsBot = atendente === "Agente Banana ISP" || atendente === "Bot";
  const setor = resolvePipeLabel || conv.setor || "—";

  // Bruno 2026-05-21: createPortal pro body. Sem isso, quando o dialog é
  // disparado de dentro do ConversaDrawer (vaul tem containing block via
  // transform), o `fixed inset-0` fica preso na área do drawer (lado direito)
  // em vez de cobrir a viewport inteira. Buttons ficam encavalados / inertes.
  //
  // Bruno 2026-05-21 (2ª camada): `pointerEvents: 'auto'` explícito no overlay
  // pra escapar do `pointer-events: none` que o vaul aplica em <body> via
  // Radix Dialog scope quando modal=true. Mesmo com modal=false no Drawer.Root,
  // pode haver race em hot-reload. Defesa em profundidade: o dialog SEMPRE
  // é clicável, independente do estado interno do vaul.
  return createPortal(
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center p-4"
      style={{ pointerEvents: "auto" }}
      data-testid="resolve-dialog-overlay"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />

      <div
        // Bruno 2026-05-21: [&_*]:pointer-events-auto aplica pointer-events:auto
        // em TODOS os descendentes do card. Sem isso, textarea/buttons/toggle/
        // pipeline-radios herdam pointer-events:none do <body> (vaul/Radix
        // Dialog scope) e ficam inertes. Mais robusto que aplicar em cada
        // elemento individualmente.
        className="relative bg-card rounded-2xl shadow-2xl w-full max-w-[680px] animate-in fade-in zoom-in-95 overflow-hidden pointer-events-auto [&_*]:pointer-events-auto"
        style={{
          border: "1px solid hsl(var(--border))",
          boxShadow: "0 25px 50px -12px rgba(20, 18, 0, 0.18), 0 0 0 1px var(--brand-brown-tint)",
        }}
        data-testid="resolve-dialog"
      >
        {/* Bruno 2026-05-21: strip topo agora deriva de --primary do tema
            (era var(--banana-500/400/300) hardcoded amarelo). */}
        <div
          className="h-1"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--primary)) 0%, color-mix(in oklch, hsl(var(--primary)) 80%, white) 50%, color-mix(in oklch, hsl(var(--primary)) 60%, white) 100%)",
          }}
        />

        {/* ── HEADER ──────────────────────────────────────────── */}
        <div className="px-5 py-3.5 border-b border-border" style={{ background: "var(--banana-tab-bg)" }}>
          <div className="flex items-center gap-4">
            {/* Left: mascote + title */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
                <div className="w-10 h-10 rounded-full" style={{ background: "hsl(var(--primary) / 0.12)" }} />
                {/* Check sobreposto — comunica "resolver". Bruno 2026-06-11:
                    segue --primary do tema (era verde #22C55E hardcoded). */}
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: "hsl(var(--primary))", boxShadow: "0 0 0 2px hsl(var(--card))" }}
                >
                  <Check className="w-2.5 h-2.5" strokeWidth={3.5} style={{ color: "hsl(var(--primary-foreground))" }} />
                </div>
              </div>
              <div>
                <h3 className="text-[14px] font-bold leading-tight" style={{ color: "var(--brand-brown)" }}>
                  Finalizar Conversa
                </h3>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MessageSquare className="w-2.5 h-2.5" />{sanitizeDisplayName(conv.nome) || conv.telefone || "Cliente"}
                </p>
              </div>
            </div>

            {/* Right: meta grid */}
            <div className="ml-auto grid grid-cols-2 gap-1.5" data-testid="resolve-meta-chips">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card/80 backdrop-blur-sm border border-border/60 text-[10px]">
                <Clock className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "var(--brand-brown)" }} />
                <span className="font-bold tabular-nums" data-testid="resolve-duration-info">{tempoAtendimento}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card/80 backdrop-blur-sm border border-border/60 text-[10px]">
                <Users className="w-2.5 h-2.5 flex-shrink-0" style={{ color: pipeColor }} />
                <span className="font-semibold capitalize truncate">{setor}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card/80 backdrop-blur-sm border border-border/60 text-[10px]">
                <User className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "var(--brand-brown)" }} />
                <span className="font-semibold truncate">{atendenteIsBot ? "🤖 Agente IA" : atendente}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── BODY: 2-COLUMN LAYOUT ───────────────────────────── */}
        <div className="flex gap-0 divide-x divide-border">

          {/* LEFT COL — Pipeline stages (list style matching sidebar) */}
          <div className="flex-[1.2] px-4 py-4" data-testid="resolve-pipeline-section">
            {/* Header */}
            <div className="text-[10px] font-bold tracking-wide uppercase mb-2.5" style={{ color: "var(--brand-brown)" }}>
              {resolvePipeLabel ? `Pipeline — ${resolvePipeLabel}` : "Pipeline — Etapa Final"}
            </div>

            {/* No-sector: optional sector selector */}
            {!assignedPipeKey && (
              <div className="mb-3">
                <div className="relative">
                  <select
                    value={selectedSector}
                    onChange={e => { setSelectedSector(e.target.value); setPipelineEtapa(""); }}
                    className="w-full appearance-none bg-muted/30 border border-border rounded-lg px-3 py-2 text-[11px] text-foreground outline-none transition-colors pr-7"
                    style={{}}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--brand-brown)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--brand-brown-tint)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }}
                    data-testid="resolve-sector-select"
                  >
                    <option value="">— Setor (opcional)</option>
                    {(pipelinesData || []).map((p: any) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            )}

            {/* Stage list — Bruno 2026-05-21: era s.color (cor de cada stage
                vinda do backend, virava arco-íris). Agora tudo segue --primary
                do tema; distinção entre stages fica só por label + posição. */}
            {pipeStages.length > 0 ? (
              <div className="space-y-[3px]" data-testid="resolve-pipeline-stages">
                {pipeStages.map((s: any) => {
                  const isActive = pipelineEtapa === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setPipelineEtapa(isActive ? "" : s.key)}
                      className="w-full flex items-center gap-2.5 rounded-lg py-[8px] px-2.5 text-[11.5px] transition-all border text-left"
                      style={isActive ? {
                        borderColor: "hsl(var(--primary))",
                        background: "linear-gradient(90deg, hsl(var(--primary) / 0.13) 0%, hsl(var(--primary) / 0.04) 100%)",
                        color: "hsl(var(--primary))",
                        boxShadow: "inset 3px 0 0 hsl(var(--primary))",
                      } : {
                        borderColor: "transparent",
                        background: "transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "hsl(var(--primary) / 0.06)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "transparent";
                      }}
                      data-testid={`resolve-pipeline-stage-${s.key}`}
                    >
                      <div
                        className="w-[11px] h-[11px] rounded-full flex-shrink-0 border-2 transition-all"
                        style={{
                          borderColor: "hsl(var(--primary))",
                          background: isActive ? "hsl(var(--primary))" : "transparent",
                          boxShadow: isActive ? "0 0 0 3px hsl(var(--primary) / 0.15)" : "none",
                        }}
                      />
                      <span className={`flex-1 truncate ${isActive ? "font-bold" : "text-muted-foreground"}`}>
                        {s.label || s.key}
                      </span>
                      {isActive && <Check className="w-3 h-3 flex-shrink-0 ml-auto" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground/50 italic py-2">
                {assignedPipeKey ? "Sem etapas configuradas" : "Selecione um setor para ver as etapas"}
              </div>
            )}
          </div>

          {/* RIGHT COL — Situação + Prioridade + Observação + CSAT */}
          <div className="flex-1 px-4 py-4 flex flex-col gap-3.5">

            {/* Situação */}
            <div data-testid="resolve-situation-section">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--brand-brown)" }}>
                <Tag className="w-3 h-3" style={{ color: "var(--brand-brown)" }} />
                Situação
              </label>
              <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-2 min-h-[32px] flex flex-wrap gap-1 items-center">
                {resolveSitTags.length > 0 ? resolveSitTags.map((t, i) => {
                  const tc = getSituationTagColor(t.code);
                  const label = getSituationLabel(t.code, t.slug);
                  return (
                    <span
                      key={t.id || i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: tc.bg, color: tc.color }}
                      data-testid={`resolve-situation-tag-${t.code}`}
                    >
                      <span className="opacity-60 font-mono text-[8px]">{t.code}</span>
                      {label}
                    </span>
                  );
                }) : (
                  <span className="text-[10px] text-muted-foreground/50 italic">Sem situação registrada</span>
                )}
              </div>
            </div>

            {/* Prioridade */}
            <div data-testid="resolve-prioridade-section">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--brand-brown)" }}>
                <AlertTriangle className="w-3 h-3" style={{ color: "var(--brand-brown)" }} />
                Prioridade
              </label>
              <div className="flex gap-1.5" data-testid="resolve-prioridade">
                {PRIORIDADE_OPTIONS.map(p => {
                  const Icon = p.icon;
                  const isSelected = prioridade === p.key;
                  return (
                    <button
                      key={p.key}
                      onClick={() => setPrioridade(p.key)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-[11px] font-bold transition-all"
                      style={isSelected
                        ? { background: p.color + "18", borderColor: p.color + "60", color: p.color, boxShadow: `0 0 0 2px ${p.color}20` }
                        : { background: "transparent", borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))", opacity: 0.6 }
                      }
                      data-testid={`resolve-prioridade-${p.key}`}
                    >
                      <Icon className="w-3.5 h-3.5" />{p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Observação */}
            <div className="flex-1" data-testid="resolve-observacao-section">
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--brand-brown)" }}>
                <FileText className="w-3 h-3" style={{ color: "var(--brand-brown)" }} />
                Observação
              </label>
              <textarea
                placeholder="Acordos, pendências, observações..."
                value={observacao}
                onChange={e => setObservacao(e.target.value)}
                rows={3}
                className="w-full bg-muted/30 border border-border rounded-lg px-2.5 py-2 text-[12px] outline-none transition-all resize-none placeholder:text-muted-foreground/40"
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--brand-brown)"; e.currentTarget.style.boxShadow = "0 0 0 3px var(--brand-brown-tint)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }}
                data-testid="resolve-observacao"
              />
            </div>

            {/* CSAT toggle */}
            <div
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 cursor-pointer transition-colors hover:[background:hsl(var(--primary)/0.06)]"
              onClick={() => setEnviarProtocoloCsat(v => !v)}
              data-testid="resolve-checkbox-protocolo-csat"
            >
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--brand-brown)" }} />
                <div>
                  <div className="text-[11px] font-semibold">Enviar protocolo + CSAT</div>
                  <div className="text-[9px] text-muted-foreground">Pesquisa de satisfação automática</div>
                </div>
              </div>
              <div
                className="w-9 h-5 rounded-full transition-all flex-shrink-0 relative ml-3"
                style={{ background: enviarProtocoloCsat ? "var(--brand-brown)" : "hsl(var(--border))" }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: enviarProtocoloCsat ? "calc(100% - 18px)" : "2px" }}
                />
              </div>
            </div>

          </div>
        </div>

        {/* ── FOOTER ───────────────────────────────────────────── */}
        <div className="px-5 py-3.5 border-t border-border flex items-center gap-2.5 bg-muted/10">
          <button
            className="px-5 py-2.5 rounded-xl bg-card text-foreground text-[12px] font-semibold transition-colors border hover:[background:hsl(var(--primary)/0.08)]"
            style={{ borderColor: "hsl(var(--border))" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--brand-brown-tint)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "hsl(var(--border))"; }}
            onClick={onClose}
            disabled={submitting}
            data-testid="resolve-dialog-cancel"
          >
            Cancelar
          </button>
          <button
            // Bruno 2026-06-11: CTA principal agora segue o dourado do tema
            // (mesmo gradiente do .gradient-accent / botão "Comercial"). Era
            // verde #22C55E hardcoded. Texto = --primary-foreground (preto na
            // banana/laranja, branco no lilás/azul). Varia com a paleta.
            className="flex-1 py-3 rounded-xl text-[13px] font-bold active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            style={{
              background: "linear-gradient(140deg, color-mix(in oklch, hsl(var(--primary)) 80%, white) 0%, hsl(var(--primary)) 55%, color-mix(in oklch, hsl(var(--primary)) 88%, black) 100%)",
              color: "hsl(var(--primary-foreground))",
              boxShadow: "0 8px 20px -4px hsl(var(--primary) / 0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
            onClick={confirmResolve}
            disabled={submitting}
            data-testid="resolve-dialog-confirm"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {submitting ? "Finalizando..." : "Finalizar Conversa"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
