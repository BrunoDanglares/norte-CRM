import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Zap, MessageSquare, Clock, GitBranch, Tag, UserCheck, Brain, Flag,
  Pause, Play, Plus, BookOpen, Trash2, X, Copy, Save, TestTube, Check,
  AlertCircle, Link, ChevronRight, ChevronDown, Loader2, List,
  MessageCircle, CreditCard, Webhook, FileText, ImagePlus, Upload,
  LayoutTemplate, RefreshCw, Paperclip, ArrowLeft, Plug, Workflow,
  Sparkles, Undo2, LogOut, Settings2, Eye, EyeOff, Users, CalendarPlus,
  Key, User2, ExternalLink, Variable, GitMerge, Split, Timer, Repeat,
  Bell, FileOutput, Info, Locate, Columns, Calendar, ShieldCheck,
  ClipboardCheck, Download, FileUp, Share2, Wifi, PenLine, MousePointerClick,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiUpload, apiFetchRaw } from "@/lib/queryClient";
import {
  FlowNode, Automation, NODE_TYPES, NODE_CATEGORIES, NODE_DESCRIPTIONS,
  TRIGGER_OPTIONS, UNIT_LABELS, STATUS_CONF, genId, getNodePreview,
} from "./types";
import { SidebarPalette, CategorizedPickerPopup, CategorizedInlineList } from "./NodePicker";
import { ConfigPanel, ImplementarPrompt, AiFilesConfig, AiWebhooksConfig } from "./NodeConfigPanel";

export function EmptyCanvas({ onNew, onTemplates, activeTab }: { onNew: () => void; onTemplates: () => void; activeTab: string }) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-3.5 text-muted-foreground"
      style={{ backgroundImage: "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
      data-testid="auto-canvas-empty"
    >
      {activeTab === "templates" ? (
        <>
          <LayoutTemplate className="w-14 h-14 opacity-15" />
          <div className="text-base font-bold text-foreground">Selecione um template</div>
          <div className="text-[12.5px] text-muted-foreground text-center max-w-[360px] leading-relaxed">
            Templates sao automacoes finalizadas e prontas para uso.<br />Selecione uma na lista ao lado para editar ou gerenciar.
          </div>
        </>
      ) : (
        <>
          <FileText className="w-14 h-14 opacity-15" />
          <div className="text-base font-bold text-foreground">Selecione ou crie um rascunho</div>
          <div className="text-[12.5px] text-muted-foreground text-center max-w-[360px] leading-relaxed">
            Monte fluxos visuais de atendimento, qualificacao e follow-up.<br />Quando estiver pronto, ative para virar um template.
          </div>
          <div className="flex gap-2.5 mt-2">
            <Button size="sm" className="gradient-accent text-white" onClick={onNew} data-testid="button-canvas-new">
              <Plus className="w-3.5 h-3.5 mr-1" /> Nova Automacao
            </Button>
            <Button variant="outline" size="sm" onClick={onTemplates} data-testid="button-canvas-templates">
              <BookOpen className="w-3.5 h-3.5 mr-1" /> Usar Template Pronto
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export interface EdgeInfo { fromId: string; toId: string; branch: string | null; color: string; path: string; sx: number; sy: number; }
export interface EdgeCtxMenu { x: number; y: number; edge: EdgeInfo; }

export function AutomationEditorTabs(props: {
  automation: Automation; nodes: FlowNode[]; selNode: string | null; isDirty: boolean;
  onSelectNode: (id: string | null) => void;
  onAddNode: (type: string, x?: number, y?: number) => void;
  onUpdatePos: (id: string, x: number, y: number) => void;
  onUpdatePosBatch?: (updates: { id: string; x: number; y: number }[]) => void;
  onUndo?: () => void;
  undoCount?: number;
  onUpdateCfg: (id: string, field: string, value: any) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onDeleteNode: (id: string) => void;
  onAddEdge: (fromId: string, toId: string, branch: string | null) => void;
  onRemoveEdge: (fromId: string, toId: string, branch: string | null) => void;
  onInsertNodeOnEdge: (fromId: string, toId: string, branch: string | null, newType: string) => void;
  onQuickAddFromBranch: (fromId: string, branch: string, nodeType: string) => void;
  onSave: () => void; onTest: () => void; onToggle: () => void;
  onRenameName: (newName: string) => void;
  onClose?: () => void;
}) {
  const [showAiPanel, setShowAiPanel] = useState(false);

  const selectedAiNode = props.selNode
    ? props.nodes.find(n => n.id === props.selNode && n.type === "ai_response") || null
    : null;

  useEffect(() => {
    if (props.selNode) {
      const node = props.nodes.find(n => n.id === props.selNode);
      if (node && node.type === "ai_response") {
        setShowAiPanel(true);
      } else if (node && node.type !== "ai_response" && showAiPanel) {
        setShowAiPanel(false);
      }
    }
  }, [props.selNode, props.nodes, showAiPanel]);

  const handleSelectNode = useCallback((id: string | null) => {
    if (id) {
      const node = props.nodes.find(n => n.id === id);
      if (node?.type === "ai_response") {
        setShowAiPanel(true);
        props.onSelectNode(id);
        return;
      }
      setShowAiPanel(false);
    }
    props.onSelectNode(id);
  }, [props.nodes, props.onSelectNode]);

  return (
    <FlowEditor
      {...props}
      onSelectNode={handleSelectNode}
      showAiPanel={showAiPanel}
      aiNode={selectedAiNode}
      onCloseAiPanel={() => { setShowAiPanel(false); props.onSelectNode(null); }}
    />
  );
}

function CollapsibleSection({ title, icon, iconColor, children, defaultOpen = false }: { title: string; icon: React.ReactNode; iconColor?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        data-testid={`collapsible-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </button>
      <div className={`transition-all duration-200 ease-in-out ${open ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}>
        <div className="px-4 pb-4 pt-1 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function AiFullPageConfig({
  aiNode,
  nodes,
  onUpdateCfg,
  onAddNode,
}: {
  aiNode: FlowNode | null;
  nodes: FlowNode[];
  onUpdateCfg: (id: string, field: string, value: any) => void;
  onAddNode: (type: string, x?: number, y?: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<"config" | "files" | "advanced">("config");

  if (!aiNode) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Brain className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold">Nenhum no de IA no fluxo</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Adicione um no de "Resposta IA" ao fluxo para configurar a inteligencia artificial desta automacao.
          </p>
          <Button onClick={() => onAddNode("ai_response")} data-testid="button-add-ai-node">
            <Plus className="w-4 h-4 mr-2" /> Adicionar Resposta IA
          </Button>
        </div>
      </div>
    );
  }

  const c = aiNode.config || {};
  const nodeId = aiNode.id;

  const tabs = [
    { key: "config" as const, label: "Prompt", icon: MessageCircle },
    { key: "files" as const, label: "Funcionalidades", icon: FileText },
    { key: "advanced" as const, label: "Avançado", icon: Sparkles },
  ];

  return (
    <div className="flex-1 overflow-y-auto" data-testid="ai-full-config">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-1 pb-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`seg-tab ${activeTab === tab.key ? "seg-tab-active" : ""}`}
              data-testid={`tab-ai-${tab.key}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "config" && (
          <div className="space-y-4">
            <CollapsibleSection title="Prompt do sistema" icon={<MessageCircle className="w-4 h-4 text-primary" />} defaultOpen>
              <Textarea
                className="text-sm resize-y min-h-[250px] leading-relaxed font-mono"
                placeholder={"Voce e um assistente de vendas da empresa X.\nResponda em portugues de forma objetiva e amigavel.\nSempre confirme os dados do cliente antes de gerar cobrancas.\n\nEspecialidades:\n- Atendimento ao cliente\n- Vendas e orcamentos\n- Suporte tecnico"}
                value={c.systemPrompt || ""}
                onChange={(e) => onUpdateCfg(nodeId, "systemPrompt", e.target.value)}
                data-testid="textarea-ai-prompt-full"
              />
              <div className="text-[9.5px] text-muted-foreground">
                Descreva detalhadamente o papel, tom de voz, regras e conhecimentos da IA. Quanto mais contexto, melhor a qualidade das respostas.
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Implementar no Prompt" icon={<PenLine className="w-4 h-4 text-primary" />}>
              <ImplementarPrompt
                currentPrompt={c.systemPrompt || ""}
                onApply={(newPrompt) => onUpdateCfg(nodeId, "systemPrompt", newPrompt)}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Capacidades CRM da IA" icon={<ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}>
              <div className="text-[10px] text-muted-foreground">
                Habilite funcoes para que a IA classifique automaticamente o cliente dentro do CRM com base na conversa.
              </div>

              {[
                {
                  key: "aiCrmPipeline",
                  icon: Columns,
                  color: "text-tertiary-600 dark:text-tertiary-500",
                  bgColor: "bg-primary/10",
                  borderColor: "border-primary/20",
                  title: "Pipeline / Kanban",
                  desc: "Selecionar automaticamente a etapa do kanban e pipeline apropriada (vendas, suporte, etc).",
                },
                {
                  key: "aiCrmAgenda",
                  icon: Calendar,
                  color: "text-amber-600 dark:text-amber-400",
                  bgColor: "bg-amber-500/10",
                  borderColor: "border-amber-500/20",
                  title: "Agenda / Agendamento",
                  desc: "Realizar agendamento do cliente automaticamente quando identificado na conversa.",
                },
                {
                  key: "aiCrmTags",
                  icon: Tag,
                  color: "text-purple-600 dark:text-purple-400",
                  bgColor: "bg-purple-500/10",
                  borderColor: "border-purple-500/20",
                  title: "Tags",
                  desc: "Escolher e aplicar tags apropriadas ao lead conforme o contexto da conversa.",
                },
                {
                  key: "aiCrmPrioridade",
                  icon: Flag,
                  color: "text-rose-600 dark:text-rose-400",
                  bgColor: "bg-rose-500/10",
                  borderColor: "border-rose-500/20",
                  title: "Prioridade",
                  desc: "Definir nivel de prioridade do lead (alta, media, baixa) com base na urgencia da conversa.",
                },
                {
                  key: "aiCrmAtribuir",
                  icon: UserCheck,
                  color: "text-cyan-600 dark:text-cyan-400",
                  bgColor: "bg-cyan-500/10",
                  borderColor: "border-cyan-500/20",
                  title: "Atribuir Conversa",
                  desc: "Atribuir automaticamente a conversa ao membro da equipe mais adequado com base no contexto.",
                },
                {
                  key: "aiCrmPesquisaSatisfacao",
                  icon: ClipboardCheck,
                  color: "text-emerald-600 dark:text-emerald-400",
                  bgColor: "bg-emerald-500/10",
                  borderColor: "border-emerald-500/20",
                  title: "Pesquisa de Satisfacao",
                  desc: "Enviar pesquisa de satisfacao automaticamente ao final do atendimento e registrar a avaliacao do cliente.",
                },
              ].map((item) => {
                const enabled = c[item.key] !== false;
                const Icon = item.icon;
                return (
                  <div
                    key={item.key}
                    className={`rounded-lg border p-3 flex items-start gap-3 transition-all ${
                      enabled ? `${item.bgColor} ${item.borderColor}` : "bg-muted/30 border-border opacity-60"
                    }`}
                    data-testid={`crm-capability-${item.key}`}
                  >
                    <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${enabled ? item.bgColor : "bg-muted"}`}>
                      <Icon className={`w-4 h-4 ${enabled ? item.color : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[12px] font-semibold ${enabled ? "" : "text-muted-foreground"}`}>{item.title}</span>
                        <button
                          onClick={() => onUpdateCfg(nodeId, item.key, !enabled)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                            enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                          }`}
                          data-testid={`toggle-${item.key}`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                              enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <p className="text-[10px] text-primary font-medium leading-relaxed">
                  <Info className="w-3 h-3 inline mr-1 -mt-0.5" />
                  Quando habilitadas, a IA analisa a conversa em tempo real e executa as acoes automaticamente no CRM.
                </p>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === "files" && (
          <div className="space-y-4">
            <CollapsibleSection title="Arquivos para a IA enviar" icon={<Paperclip className="w-4 h-4 text-primary" />}>
              <AiFilesConfig nodeId={nodeId} config={c} onUpdateCfg={onUpdateCfg} />
            </CollapsibleSection>

            <CollapsibleSection title="Webhooks da IA" icon={<Webhook className="w-4 h-4 text-primary" />}>
              <AiWebhooksConfig nodeId={nodeId} config={c} onUpdateCfg={onUpdateCfg} />
            </CollapsibleSection>

            <CollapsibleSection title="Gatilhos de Saída" icon={<LogOut className="w-4 h-4 text-primary" />}>
              <AiExitTriggersTab nodeId={nodeId} config={c} onUpdateCfg={onUpdateCfg} />
            </CollapsibleSection>
          </div>
        )}

        {activeTab === "advanced" && (
          <AiAdvancedTab nodeId={nodeId} config={c} onUpdateCfg={onUpdateCfg} />
        )}
      </div>
    </div>
  );
}

interface ExitTrigger {
  id: string;
  matchType: "contains" | "exact" | "starts_with" | "regex";
  keywords: string;
  targetNodeLabel?: string;
}

function AiExitTriggersTab({ nodeId, config, onUpdateCfg }: { nodeId: string; config: any; onUpdateCfg: (id: string, field: string, value: any) => void }) {
  const triggers: ExitTrigger[] = config.exitTriggers || [];

  function addTrigger() {
    const newTrigger: ExitTrigger = {
      id: `et_${Date.now()}`,
      matchType: "contains",
      keywords: "",
    };
    onUpdateCfg(nodeId, "exitTriggers", [...triggers, newTrigger]);
  }

  function updateTrigger(triggerId: string, field: keyof ExitTrigger, value: string) {
    const updated = triggers.map(t => t.id === triggerId ? { ...t, [field]: value } : t);
    onUpdateCfg(nodeId, "exitTriggers", updated);
  }

  function removeTrigger(triggerId: string) {
    onUpdateCfg(nodeId, "exitTriggers", triggers.filter(t => t.id !== triggerId));
  }

  const matchTypeOptions = [
    { value: "contains", label: "Contem a palavra" },
    { value: "exact", label: "Correspondencia exata" },
    { value: "starts_with", label: "Comeca com" },
    { value: "regex", label: "Expressao regular" },
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
        <p className="text-[12px] font-semibold text-primary leading-relaxed">
          Configure palavras-chave que fazem o fluxo sair do modo IA e ir para outro no.
        </p>
      </div>

      {triggers.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">
          <LogOut className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-bold mb-1">Nenhum gatilho de saida configurado</p>
          <p className="text-[11px]">Adicione gatilhos para que a IA saiba quando encerrar e passar o fluxo adiante</p>
        </div>
      )}

      <div className="space-y-4">
        {triggers.map((trigger, idx) => (
          <div key={trigger.id} className="rounded-xl border bg-card p-5 space-y-4" data-testid={`exit-trigger-${idx}`}>
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">Gatilho {idx + 1}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => removeTrigger(trigger.id)}
                data-testid={`button-remove-trigger-${idx}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1.5">Tipo de correspondencia</Label>
              <Select value={trigger.matchType} onValueChange={(v) => updateTrigger(trigger.id, "matchType", v)}>
                <SelectTrigger className="text-xs bg-primary/10 border-primary/30 text-primary font-semibold" data-testid={`select-match-type-${idx}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {matchTypeOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1.5">Palavras-chave</Label>
              <Input
                className="text-xs"
                placeholder="atendente, humano, pessoa"
                value={trigger.keywords}
                onChange={(e) => updateTrigger(trigger.id, "keywords", e.target.value)}
                data-testid={`input-keywords-${idx}`}
              />
              <p className="text-[9.5px] text-muted-foreground mt-1">Separe as palavras por virgula</p>
            </div>

            <div>
              <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1.5">Label do no destino (opcional)</Label>
              <Input
                className="text-xs"
                placeholder="Ex: Transferir para Atendente"
                value={trigger.targetNodeLabel || ""}
                onChange={(e) => updateTrigger(trigger.id, "targetNodeLabel", e.target.value)}
                data-testid={`input-target-label-${idx}`}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addTrigger}
        className="w-full py-3 rounded-xl border-2 border-dashed border-border text-[12px] font-bold text-muted-foreground hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-2"
        data-testid="button-add-exit-trigger"
      >
        <Plus className="w-4 h-4" />
        Adicionar Gatilho de Saida
      </button>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
          <strong>Dica:</strong> Conecte cada gatilho a um no diferente no fluxo. Por exemplo, "atendente" pode ir para o no "Transferir para Atendente".
        </p>
      </div>
    </div>
  );
}

function AiBalanceChecker({ apiKey, provider }: { apiKey: string; provider: "openai" }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const checkBalance = async () => {
    setLoading(true);
    setResult(null);
    try {
      const resp = await apiRequest("POST", "/api/ai/check-balance", { apiKey, provider });
      const data = await resp.json();
      setResult(data);
    } catch {
      setResult({ valid: false, message: "Erro de conexao ao verificar saldo" });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs h-7 gap-1.5"
        onClick={checkBalance}
        disabled={loading}
        data-testid={`button-check-balance-${provider}`}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CreditCard className="w-3 h-3" />}
        {loading ? "Verificando..." : "Verificar saldo / validar chave"}
      </Button>

      {result && (
        <div className={`rounded-lg p-3 space-y-1.5 text-[10px] ${result.valid ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`} data-testid={`balance-result-${provider}`}>
          <div className="flex items-center gap-2">
            {result.valid ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span className={`font-bold ${result.valid ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {result.message}
            </span>
          </div>

          {result.credits && result.credits.total_available !== undefined && (
            <div className="pt-1 space-y-1 border-t border-emerald-500/20 mt-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Creditos disponiveis:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">${Number(result.credits.total_available).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total concedido:</span>
                <span className="font-mono">${Number(result.credits.total_granted).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total usado:</span>
                <span className="font-mono">${Number(result.credits.total_used).toFixed(2)}</span>
              </div>
            </div>
          )}

          {result.usage && result.usage.total_usage_usd !== undefined && (
            <div className="pt-1 space-y-1 border-t border-emerald-500/20 mt-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Uso neste mes:</span>
                <span className="font-bold font-mono">${Number(result.usage.total_usage_usd).toFixed(4)}</span>
              </div>
            </div>
          )}

          {result.balance && (
            <div className="pt-1 space-y-1 border-t border-emerald-500/20 mt-1.5">
              {result.balance.plan && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plano:</span>
                  <span className="font-bold">{result.balance.plan}</span>
                </div>
              )}
              {result.balance.hard_limit_usd !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Limite mensal:</span>
                  <span className="font-mono">${Number(result.balance.hard_limit_usd).toFixed(2)}</span>
                </div>
              )}
            </div>
          )}

          {result.valid && provider === "openai" && !result.credits && !result.usage && !result.balance && (
            <p className="text-muted-foreground pt-1">
              Chave valida. Para detalhes de uso, acesse{" "}
              <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                platform.openai.com/usage
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AiAdvancedTab({ nodeId, config, onUpdateCfg }: { nodeId: string; config: any; onUpdateCfg: (id: string, field: string, value: any) => void }) {
  return (
    <div className="space-y-5 max-w-2xl">
      <CollapsibleSection title="Modelo e Parametros" icon={<Sparkles className="w-4 h-4 text-primary" />}>
        <Select value={config.model || "gpt-4o-mini"} onValueChange={(v) => onUpdateCfg(nodeId, "model", v)}>
          <SelectTrigger className="text-xs" data-testid="select-ai-model-advanced"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="gpt-4o-mini">GPT-4o Mini (rapido)</SelectItem>
            <SelectItem value="gpt-4o">GPT-4o (mais capaz)</SelectItem>
          </SelectContent>
        </Select>

        <div>
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1.5">Temperatura: {config.temperature ?? 0.5}</Label>
          <input
            type="range" min="0" max="1" step="0.1"
            value={config.temperature ?? 0.5}
            className="w-full accent-primary"
            onChange={(e) => onUpdateCfg(nodeId, "temperature", +e.target.value)}
            data-testid="range-temperature-advanced"
          />
          <div className="flex justify-between text-[9.5px] text-muted-foreground mt-0.5">
            <span>Preciso</span><span>Criativo</span>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Variaveis" icon={<Settings2 className="w-4 h-4 text-primary" />}>

        <div>
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Salvar resposta em</Label>
          <Input className="text-xs" placeholder="aiReply" value={config.saveAs || "aiReply"} onChange={(e) => onUpdateCfg(nodeId, "saveAs", e.target.value)} data-testid="input-save-as-advanced" />
          <p className="text-[9.5px] text-muted-foreground mt-1">Nome da variavel onde a resposta da IA sera armazenada</p>
        </div>

        <div>
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Maximo de tokens</Label>
          <Input
            className="text-xs"
            type="number"
            placeholder="2048"
            value={config.maxTokens || ""}
            onChange={(e) => onUpdateCfg(nodeId, "maxTokens", e.target.value ? parseInt(e.target.value) : null)}
            data-testid="input-max-tokens"
          />
          <p className="text-[9.5px] text-muted-foreground mt-1">Limite de tokens na resposta (deixe vazio para padrao)</p>
        </div>

        <div>
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Timeout (segundos)</Label>
          <Input
            className="text-xs"
            type="number"
            placeholder="30"
            value={config.timeout || ""}
            onChange={(e) => onUpdateCfg(nodeId, "timeout", e.target.value ? parseInt(e.target.value) : null)}
            data-testid="input-timeout"
          />
          <p className="text-[9.5px] text-muted-foreground mt-1">Tempo maximo de espera pela resposta da IA</p>
        </div>

        <div>
          <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">Delay antes de responder</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              className="text-xs w-24"
              min="0"
              max="120"
              placeholder="10"
              value={config.replyDelay ?? 10}
              onChange={(e) => onUpdateCfg(nodeId, "replyDelay", e.target.value === "" ? 10 : Math.min(120, Math.max(0, +e.target.value)))}
              data-testid="input-ai-reply-delay"
            />
            <Select value={config.replyDelayUnit || "seconds"} onValueChange={(v) => onUpdateCfg(nodeId, "replyDelayUnit", v)}>
              <SelectTrigger className="text-xs w-28" data-testid="select-ai-delay-unit"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">segundos</SelectItem>
                <SelectItem value="minutes">minutos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[9.5px] text-muted-foreground mt-1">Tempo de espera antes de enviar a resposta. Simula digitacao humana (0 = sem delay, maximo 120)</p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Credenciais de IA" icon={<Brain className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}>

        <div className="rounded-lg p-3 bg-muted/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold text-muted-foreground uppercase">Fonte da chave OpenAI</span>
          </div>
          <div className="flex gap-2">
            <button
              className={`flex-1 rounded-lg p-2.5 border text-left transition-all ${!config.openaiApiKey ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border hover:border-muted-foreground/30"}`}
              onClick={() => onUpdateCfg(nodeId, "openaiApiKey", "")}
              data-testid="button-use-integration-key"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10.5px] font-bold">Chave da Integracao</span>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">Usa a chave principal configurada em Integracoes</p>
            </button>
            <button
              className={`flex-1 rounded-lg p-2.5 border text-left transition-all ${config.openaiApiKey ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border hover:border-muted-foreground/30"}`}
              onClick={() => { if (!config.openaiApiKey) onUpdateCfg(nodeId, "openaiApiKey", " "); }}
              data-testid="button-use-custom-key"
            >
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-[10.5px] font-bold">Chave propria</span>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">Chave exclusiva para este agente</p>
            </button>
          </div>
        </div>

        {config.openaiApiKey ? (
          <div>
            <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">OpenAI API Key (propria)</Label>
            <div className="flex gap-1.5">
              <Input
                type={config._openaiKeyVisible ? "text" : "password"}
                className="text-xs font-mono flex-1"
                placeholder="sk-..."
                value={config.openaiApiKey?.trim() || ""}
                onChange={(e) => onUpdateCfg(nodeId, "openaiApiKey", e.target.value)}
                data-testid="input-openai-api-key"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onUpdateCfg(nodeId, "_openaiKeyVisible", !config._openaiKeyVisible)}
                data-testid="button-toggle-openai-key"
              >
                {config._openaiKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </Button>
            </div>
            <p className="text-[9.5px] text-muted-foreground mt-1">
              Chave exclusiva deste agente para modelos GPT.{" "}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Obter no painel OpenAI
              </a>
            </p>
            {config.openaiApiKey.trim() && (
              <div className="space-y-2 mt-2">
                <div className="flex items-center gap-2 rounded-lg p-2 bg-emerald-500/10">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px #34d399" }} />
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">OpenAI Key propria configurada</span>
                </div>
                <AiBalanceChecker apiKey={config.openaiApiKey.trim()} provider="openai" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg p-2 bg-primary/10">
            <Settings2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-bold text-primary">Usando chave principal da Integracao OpenAI</span>
          </div>
        )}

        <div className="rounded-lg border-dashed border p-2.5">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            A chave OpenAI pode vir das Integracoes (configuracao global) ou ser definida aqui exclusivamente para este agente.
          </p>
        </div>
      </CollapsibleSection>

    </div>
  );
}

function FlowEditor({
  automation, nodes, selNode, isDirty,
  onSelectNode, onAddNode, onUpdatePos, onUpdatePosBatch, onUndo, undoCount,
  onUpdateCfg, onUpdateLabel, onDeleteNode, onAddEdge, onRemoveEdge, onInsertNodeOnEdge,
  onQuickAddFromBranch, onSave, onTest, onToggle, onRenameName, onClose,
  showAiPanel, aiNode: aiNodeProp, onCloseAiPanel,
}: {
  automation: Automation; nodes: FlowNode[]; selNode: string | null; isDirty: boolean;
  onSelectNode: (id: string | null) => void;
  onAddNode: (type: string, x?: number, y?: number) => void;
  onUpdatePos: (id: string, x: number, y: number) => void;
  onUpdatePosBatch?: (updates: { id: string; x: number; y: number }[]) => void;
  onUndo?: () => void;
  undoCount?: number;
  onUpdateCfg: (id: string, field: string, value: any) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onDeleteNode: (id: string) => void;
  onAddEdge: (fromId: string, toId: string, branch: string | null) => void;
  onRemoveEdge: (fromId: string, toId: string, branch: string | null) => void;
  onInsertNodeOnEdge: (fromId: string, toId: string, branch: string | null, newType: string) => void;
  onQuickAddFromBranch: (fromId: string, branch: string, nodeType: string) => void;
  onSave: () => void; onTest: () => void; onToggle: () => void;
  onRenameName: (newName: string) => void;
  onClose?: () => void;
  showAiPanel?: boolean;
  aiNode?: FlowNode | null;
  onCloseAiPanel?: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const didDragRef = useRef(false);
  const connectDragRef = useRef<{ fromId: string; branch: string | null; startFx: number; startFy: number } | null>(null);
  const [connectLine, setConnectLine] = useState<{ fx: number; fy: number; tx: number; ty: number } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [edgeCtxMenu, setEdgeCtxMenu] = useState<EdgeCtxMenu | null>(null);
  const [edgeInsertPicker, setEdgeInsertPicker] = useState<{ edge: EdgeInfo; x: number; y: number } | null>(null);
  const [, forceUpdate] = useState(0);
  const [isRenamingCanvas, setIsRenamingCanvas] = useState(false);
  const [canvasRenameValue, setCanvasRenameValue] = useState("");
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number } | null>(null);
  const skipNextCanvasClickRef = useRef(0);
  const [bananaOpen, setBananaOpen] = useState(false);
  const [bananaPrompt, setBananaPrompt] = useState("");
  const [bananaContext, setBananaContext] = useState("");
  const [bananaLoading, setBananaLoading] = useState(false);
  const [bananaResult, setBananaResult] = useState<any>(null);
  const [bananaStream, setBananaStream] = useState("");
  const [bananaShowContext, setBananaShowContext] = useState(false);
  const [bananaFiles, setBananaFiles] = useState<{ name: string; url: string; type: string }[]>([]);
  const [bananaUploading, setBananaUploading] = useState(false);
  const bananaFileRef = useRef<HTMLInputElement>(null);
  const [bananaTab, setBananaTab] = useState<"criar" | "credenciais">("criar");
  const [bananaCustomKey, setBananaCustomKey] = useState("");
  const [bananaKeySource, setBananaKeySource] = useState<"integration" | "custom">("integration");
  const [bananaKeyVisible, setBananaKeyVisible] = useState(false);
  const [bananaSingleAI, setBananaSingleAI] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsData, setLogsData] = useState<{ recentLogs: any[]; nodeCounts: Record<string, number> }>({ recentLogs: [], nodeCounts: {} });
  const { toast: canvasToast } = useToast();

  useEffect(() => {
    let interval: any;
    async function fetchLogs() {
      try {
        const resp = await fetch(`/api/automacoes/${automation.id}/logs?limit=50`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("flowcrm_token") || ""}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.ok) setLogsData({ recentLogs: data.recentLogs || [], nodeCounts: data.nodeCounts || {} });
        }
      } catch {}
    }
    fetchLogs();
    if (logsOpen) {
      interval = setInterval(fetchLogs, 30000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [automation.id, logsOpen]);

  function exportAgentJson() {
    const exportData = {
      _chatbanana_agent: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      nome: automation.nome,
      triggerType: automation.triggerType || automation.trigger,
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        config: n.config,
        x: n.x,
        y: n.y,
        next: n.next,
        nextTrue: n.nextTrue,
        nextFalse: n.nextFalse,
        nextOptions: n.nextOptions,
        nextTextInput: n.nextTextInput,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agente-${automation.nome.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    canvasToast({ title: "Agente exportado com sucesso!" });
  }

  function importAgentFromJson(jsonStr: string) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data._chatbanana_agent || !Array.isArray(data.nodes)) {
        setImportError("Arquivo invalido. Use um JSON exportado pelo Chat Banana.");
        return;
      }
      const importedNodes: FlowNode[] = data.nodes.map((n: any) => ({
        id: n.id || crypto.randomUUID().substring(0, 8),
        type: n.type || "send_message",
        label: n.label || "",
        config: n.config || {},
        x: n.x || 0,
        y: n.y || 0,
        next: n.next || [],
        nextTrue: n.nextTrue,
        nextFalse: n.nextFalse,
        nextOptions: n.nextOptions,
        nextTextInput: n.nextTextInput,
      }));
      if (importedNodes.length === 0) {
        setImportError("O agente importado nao possui nos.");
        return;
      }
      window.dispatchEvent(new CustomEvent("banana-creator-apply", { detail: { nodes: importedNodes } }));
      if (data.nome) {
        onRenameName(data.nome);
      }
      setImportOpen(false);
      setImportJson("");
      setImportError("");
      canvasToast({ title: `Agente "${data.nome || "importado"}" carregado com sucesso!` });
    } catch (e: any) {
      setImportError("JSON invalido: " + e.message);
    }
  }

  const sc = STATUS_CONF[automation.status] || STATUS_CONF.DRAFT;
  const BtnIcon = sc.btnIcon;

  const { data: usuariosData } = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/usuarios"] });
  const { data: equipesData } = useQuery<{ ok: boolean; data: any[] }>({ queryKey: ["/api/equipes"] });
  const atendentes = usuariosData?.data?.filter((u: any) => u.status === "ACTIVE") || [];
  const equipesLista = equipesData?.data || [];

  const { data: editorPipelines = [] } = useQuery<{ id: number; key: string; label: string; cor: string; active: boolean }[]>({ queryKey: ["/api/pipelines"] });
  const { data: editorStages = [] } = useQuery<{ id: number; key: string; label: string; pipeline: string; color: string }[]>({
    queryKey: ["/api/pipeline-stages", "all"],
    queryFn: async () => {
      const res = await fetch(`/api/pipeline-stages`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${localStorage.getItem("flowcrm_token") || ""}` },
      });
      if (!res.ok) throw new Error("Erro ao carregar etapas");
      return res.json();
    },
  });
  const activePipelines = editorPipelines.filter(p => p.active !== false);

  useEffect(() => { forceUpdate((n) => n + 1); }, [nodes]);

  useEffect(() => {
    const handleClick = () => { setEdgeCtxMenu(null); setEdgeInsertPicker(null); };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  function startDrag(e: React.MouseEvent, nodeId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    didDragRef.current = false;
    const isMulti = multiSelected.has(nodeId) && multiSelected.size > 1;
    const groupOrigins = isMulti
      ? [...multiSelected].map(id => {
          const n = nodes.find(nd => nd.id === id);
          return { id, origX: n?.x || 0, origY: n?.y || 0 };
        })
      : null;
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
    let lastDx = 0, lastDy = 0;
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
      lastDx = dx; lastDy = dy;
      if (groupOrigins) {
        for (const g of groupOrigins) {
          const el = document.getElementById("fn-" + g.id);
          if (el) {
            el.style.left = Math.max(0, g.origX + dx) + "px";
            el.style.top = Math.max(0, g.origY + dy) + "px";
          }
        }
      } else {
        onUpdatePos(nodeId, Math.max(0, dragRef.current.origX + dx), Math.max(0, dragRef.current.origY + dy));
      }
    };
    const onUp = () => {
      if (didDragRef.current && (groupOrigins || multiSelected.size > 0)) {
        skipNextCanvasClickRef.current = Date.now();
      }
      if (groupOrigins && didDragRef.current) {
        if (onUpdatePosBatch) {
          onUpdatePosBatch(groupOrigins.map(g => ({
            id: g.id,
            x: Math.max(0, g.origX + lastDx),
            y: Math.max(0, g.origY + lastDy),
          })));
        } else {
          for (const g of groupOrigins) {
            onUpdatePos(g.id, Math.max(0, g.origX + lastDx), Math.max(0, g.origY + lastDy));
          }
        }
      }
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function getOptionPortPos(nodeId: string, branch: string | null): { x: number; y: number } | null {
    if (!branch) return null;
    const nodeEl = document.getElementById("fn-" + nodeId);
    if (!nodeEl) return null;
    let optEl: HTMLElement | null = null;
    try {
      optEl = nodeEl.querySelector(`[data-option-id="${CSS.escape(branch)}"][data-node-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
    } catch {
      const candidates = nodeEl.querySelectorAll<HTMLElement>("[data-option-id]");
      for (const c of candidates) {
        if (c.dataset.optionId === branch && c.dataset.nodeId === nodeId) { optEl = c; break; }
      }
    }
    if (!optEl) return null;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    const nodeRect = nodeEl.getBoundingClientRect();
    const optRect = optEl.getBoundingClientRect();
    const isSideBySide = branch === "true" || branch === "false";
    if (isSideBySide) {
      const x = (node.x || 0) + (optRect.left - nodeRect.left) + optRect.width / 2;
      const y = (node.y || 0) + (optRect.top - nodeRect.top) + optRect.height;
      return { x, y };
    }
    const x = (node.x || 0) + nodeEl.offsetWidth;
    const y = (node.y || 0) + (optRect.top - nodeRect.top) + optRect.height / 2;
    return { x, y };
  }

  function startConnectDrag(e: React.MouseEvent, nodeId: string, branch: string | null) {
    e.stopPropagation();
    e.preventDefault();
    const el = document.getElementById("fn-" + nodeId);
    if (!el || !canvasRef.current) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const optPort = getOptionPortPos(nodeId, branch);
    const fx = optPort ? optPort.x : (node.x || 0) + 90;
    const fy = optPort ? optPort.y : (node.y || 0) + el.offsetHeight + 2;
    connectDragRef.current = { fromId: nodeId, branch, startFx: fx, startFy: fy };
    setConnectLine({ fx, fy, tx: fx, ty: fy });

    const onMove = (ev: MouseEvent) => {
      if (!connectDragRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const tx = ev.clientX - rect.left + canvasRef.current.scrollLeft;
      const ty = ev.clientY - rect.top + canvasRef.current.scrollTop;
      setConnectLine({ fx: connectDragRef.current.startFx, fy: connectDragRef.current.startFy, tx, ty });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setConnectLine(null);
      if (!connectDragRef.current || !canvasRef.current) return;
      const fromData = connectDragRef.current;
      connectDragRef.current = null;
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = ev.clientX - rect.left + canvasRef.current.scrollLeft;
      const my = ev.clientY - rect.top + canvasRef.current.scrollTop;
      for (const n of nodes) {
        if (n.id === fromData.fromId) continue;
        const nel = document.getElementById("fn-" + n.id);
        if (!nel) continue;
        const nx = n.x || 0;
        const ny = n.y || 0;
        const nw = nel.offsetWidth;
        const nh = nel.offsetHeight;
        if (mx >= nx - 10 && mx <= nx + nw + 10 && my >= ny - 10 && my <= ny + nh + 10) {
          onAddEdge(fromData.fromId, n.id, fromData.branch);
          return;
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function computeMarqueeHits(sx: number, sy: number, cx: number, cy: number): Set<string> {
    const mx = Math.min(sx, cx);
    const my = Math.min(sy, cy);
    const mw = Math.abs(cx - sx);
    const mh = Math.abs(cy - sy);
    if (mw < 5 && mh < 5) return new Set();
    const hit = new Set<string>();
    for (const n of nodes) {
      const el = document.getElementById("fn-" + n.id);
      const nx = n.x || 0;
      const ny = n.y || 0;
      const nw = el?.offsetWidth || 180;
      const nh = el?.offsetHeight || 60;
      if (nx + nw > mx && nx < mx + mw && ny + nh > my && ny < my + mh) hit.add(n.id);
    }
    return hit;
  }

  function startMarquee(e: React.MouseEvent) {
    if (e.button !== 0 || !canvasRef.current) return;
    const target = e.target as HTMLElement;
    if (target !== canvasRef.current && target.id !== "nodes-layer") return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left + canvasRef.current.scrollLeft;
    const sy = e.clientY - rect.top + canvasRef.current.scrollTop;
    marqueeRef.current = { startX: sx, startY: sy };
    setMarquee({ startX: sx, startY: sy, curX: sx, curY: sy });

    const onMove = (ev: MouseEvent) => {
      if (!marqueeRef.current || !canvasRef.current) return;
      const r = canvasRef.current.getBoundingClientRect();
      const cx = ev.clientX - r.left + canvasRef.current.scrollLeft;
      const cy = ev.clientY - r.top + canvasRef.current.scrollTop;
      setMarquee({ startX: marqueeRef.current.startX, startY: marqueeRef.current.startY, curX: cx, curY: cy });
      const live = computeMarqueeHits(marqueeRef.current.startX, marqueeRef.current.startY, cx, cy);
      setMultiSelected(live);
      if (live.size > 0) onSelectNode(null);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!marqueeRef.current || !canvasRef.current) { setMarquee(null); marqueeRef.current = null; return; }
      const m = marqueeRef.current;
      setMarquee((prev) => {
        if (!prev) return null;
        const selected = computeMarqueeHits(m.startX, m.startY, prev.curX, prev.curY);
        if (selected.size === 0) { setMultiSelected(new Set()); } else {
          skipNextCanvasClickRef.current = Date.now();
        }
        marqueeRef.current = null;
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData("nodeType");
    if (!type || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + canvasRef.current.scrollLeft - 90;
    const y = e.clientY - rect.top + canvasRef.current.scrollTop - 30;
    onAddNode(type, Math.max(10, x), Math.max(10, y));
    setShowPicker(false);
  }

  function getEdges(): EdgeInfo[] {
    const edges: EdgeInfo[] = [];
    nodes.forEach((node) => {
      const el = document.getElementById("fn-" + node.id);
      if (!el) return;
      const defaultFx = (node.x || 0) + 90;
      const defaultFy = (node.y || 0) + el.offsetHeight + 2;
      const make = (toId: string, color: string, branch: string | null) => {
        const toNode = nodes.find((n) => n.id === toId);
        const toEl = document.getElementById("fn-" + toId);
        if (!toNode || !toEl) return;
        const tx = (toNode.x || 0) + 90;
        const ty = (toNode.y || 0) - 2;
        const optPort = getOptionPortPos(node.id, branch);
        const sx = optPort ? optPort.x : defaultFx;
        const sy = optPort ? optPort.y : defaultFy;
        const midY = (sy + ty) / 2;
        edges.push({
          fromId: node.id, toId, branch, color, sx, sy,
          path: `M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`,
        });
      };
      (node.next || []).forEach((id) => make(id, "hsl(var(--muted-foreground) / 0.4)", null));
      if (node.nextTrue) make(node.nextTrue, "#34d399", "true");
      if (node.nextFalse) make(node.nextFalse, "#f87171", "false");
      if (node.nextOptions) {
        Object.entries(node.nextOptions).forEach(([key, toId]) => make(toId, "#8B5CF6", key));
      }
      if (node.nextTextInput) make(node.nextTextInput, "#94a3b8", "text_input");
    });
    return edges;
  }

  function renderEdges() {
    const edges = getEdges();
    const elements: JSX.Element[] = [];
    edges.forEach((edge) => {
      const edgeKey = edge.fromId + "-" + edge.toId + "-" + (edge.branch || "def");
      if (edge.branch) {
        elements.push(
          <circle
            key={edgeKey + "-dot"}
            cx={edge.sx}
            cy={edge.sy}
            r="3.5"
            fill={edge.color}
            opacity=".9"
            className="pointer-events-none"
          />
        );
      }
      elements.push(
        <path
          key={edgeKey + "-v"}
          d={edge.path}
          stroke={edge.color}
          strokeWidth="2"
          fill="none"
          opacity=".8"
          markerEnd="url(#arrowhead)"
          className="pointer-events-none"
        />
      );
      elements.push(
        <path
          key={edgeKey + "-hit"}
          d={edge.path}
          stroke="transparent"
          strokeWidth="14"
          fill="none"
          className="cursor-pointer"
          style={{ pointerEvents: "stroke" }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEdgeCtxMenu({ x: e.clientX, y: e.clientY, edge });
            setEdgeInsertPicker(null);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemoveEdge(edge.fromId, edge.toId, edge.branch);
          }}
        />
      );
    });
    if (connectLine) {
      const midY = (connectLine.fy + connectLine.ty) / 2;
      elements.push(
        <path
          key="connect-line-live"
          d={`M${connectLine.fx},${connectLine.fy} C${connectLine.fx},${midY} ${connectLine.tx},${midY} ${connectLine.tx},${connectLine.ty}`}
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeDasharray="6 4"
          fill="none"
          opacity=".7"
          className="pointer-events-none"
        />
      );
    }
    return elements;
  }

  const selectedNode = nodes.find((n) => n.id === selNode);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3.5 py-2 bg-card border-b flex items-center gap-2 flex-shrink-0 min-h-[46px] flex-wrap">
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose} title="Voltar" data-testid="button-close-flow-editor">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        {isRenamingCanvas ? (
          <input
            autoFocus
            className="font-semibold text-[13px] flex-1 min-w-0 bg-transparent border-b border-primary outline-none"
            value={canvasRenameValue}
            onChange={(e) => setCanvasRenameValue(e.target.value)}
            onBlur={() => {
              const trimmed = canvasRenameValue.trim();
              setIsRenamingCanvas(false);
              if (trimmed && trimmed !== automation.nome) onRenameName(trimmed);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = canvasRenameValue.trim();
                setIsRenamingCanvas(false);
                if (trimmed && trimmed !== automation.nome) onRenameName(trimmed);
              }
              if (e.key === "Escape") setIsRenamingCanvas(false);
            }}
            data-testid="input-rename-canvas"
          />
        ) : (
          <div
            className="font-semibold text-[13px] flex-1 min-w-0 truncate cursor-text"
            onDoubleClick={() => { setCanvasRenameValue(automation.nome); setIsRenamingCanvas(true); }}
            title="Duplo clique para renomear"
            data-testid="text-canvas-name"
          >{automation.nome}</div>
        )}
        {isDirty && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold flex-shrink-0 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> nao salvo</span>}
        <span className="flex items-center gap-1.5 text-[11px] flex-shrink-0">
          {automation.status === "ACTIVE" ? (
            <span className="automation-active-indicator" style={{ width: 18, height: 18 }}>
              <span className="dot-core" />
              <span className="dot-ring" />
              <span className="dot-ring-2" />
            </span>
          ) : (
            <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: sc.dot }} />
          )}
          <span className="font-bold" style={{ color: sc.dot }}>{sc.label}</span>
        </span>
        <button
          onClick={() => { setBananaOpen(true); setBananaResult(null); setBananaStream(""); setBananaPrompt(""); setBananaContext(""); setBananaShowContext(false); setBananaTab("criar"); setBananaSingleAI(false); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:scale-105 active:scale-95 flex-shrink-0 cursor-pointer"
          style={{ background: "#ffffff", color: "#1a1200", border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
          data-testid="button-banana-creator"
        >
          <Brain className="w-3.5 h-3.5 text-primary" />
          Criar com IA
          <Sparkles className="w-3 h-3" />
        </button>
        <div className="h-4 w-px bg-border" />
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={() => setShowPicker((p) => !p)} data-testid="button-add-node">
          <Plus className="w-3 h-3 mr-1" /> No
        </Button>
        {onUndo && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] px-2.5"
            onClick={onUndo}
            disabled={!undoCount}
            title="Desfazer (Ctrl+Z)"
            data-testid="button-undo"
          >
            <Undo2 className="w-3 h-3 mr-1" /> Desfazer
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={() => {
          if (!canvasRef.current || nodes.length === 0) return;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const n of nodes) {
            const el = document.getElementById("fn-" + n.id);
            const nx = n.x || 0;
            const ny = n.y || 0;
            const nw = el?.offsetWidth || 180;
            const nh = el?.offsetHeight || 60;
            if (nx < minX) minX = nx;
            if (ny < minY) minY = ny;
            if (nx + nw > maxX) maxX = nx + nw;
            if (ny + nh > maxY) maxY = ny + nh;
          }
          const cw = canvasRef.current.clientWidth;
          const ch = canvasRef.current.clientHeight;
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          canvasRef.current.scrollTo({
            left: Math.max(0, centerX - cw / 2),
            top: Math.max(0, centerY - ch / 2),
            behavior: "smooth",
          });
        }} data-testid="button-center-flow" title="Centralizar fluxo">
          <Locate className="w-3 h-3" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={onTest} data-testid="button-test-run">
          <Play className="w-3 h-3 mr-1" /> Testar
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={onToggle} data-testid="button-canvas-toggle">
          <BtnIcon className="w-3 h-3 mr-1" /> {automation.status === "ACTIVE" ? "Pausar" : "Ativar"}
        </Button>
        <Button size="sm" className="h-7 text-[11px] px-3 gradient-accent text-white" onClick={onSave} data-testid="button-save-flow">
          <Save className="w-3 h-3 mr-1" /> Salvar
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={exportAgentJson} title="Exportar agente como JSON" data-testid="button-export-agent">
          <Download className="w-3 h-3 mr-1" /> Exportar
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={() => { setImportOpen(true); setImportJson(""); setImportError(""); }} title="Importar agente de JSON" data-testid="button-import-agent">
          <FileUp className="w-3 h-3 mr-1" /> Importar
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button variant="outline" size="sm" className="h-7 text-[11px] px-2.5" onClick={() => setLogsOpen(!logsOpen)} data-testid="button-logs-panel">
          <ClipboardCheck className="w-3 h-3 mr-1" /> Logs
        </Button>
      </div>

      {showPicker && (
        <CategorizedPickerPopup
          onSelect={(type) => { onAddNode(type); setShowPicker(false); }}
          onClose={() => setShowPicker(false)}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <SidebarPalette />

        <div
          ref={canvasRef}
          id="flow-canvas"
          tabIndex={0}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "z") {
              const target = e.target as HTMLElement;
              if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
              e.preventDefault();
              if (onUndo) onUndo();
              return;
            }
            if (e.key === "Delete" || e.key === "Backspace") {
              const target = e.target as HTMLElement;
              if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
              if (multiSelected.size > 0) {
                e.preventDefault();
                const toDelete = [...multiSelected].filter(id => {
                  const nd = nodes.find(n => n.id === id);
                  return nd && nd.type !== "trigger";
                });
                toDelete.forEach(id => onDeleteNode(id));
                setMultiSelected(new Set());
              } else if (selNode) {
                const nd = nodes.find((n) => n.id === selNode);
                if (nd && nd.type === "trigger") return;
                e.preventDefault();
                onDeleteNode(selNode);
              }
            }
          }}
          onMouseDown={startMarquee}
          onClick={(e) => {
            if (Date.now() - skipNextCanvasClickRef.current < 200) return;
            const target = e.target as HTMLElement;
            if (target === canvasRef.current || target.id === "nodes-layer") {
              onSelectNode(null);
              setMultiSelected(new Set());
              setShowPicker(false);
              setEdgeCtxMenu(null);
              setEdgeInsertPicker(null);
            }
          }}
          className="flex-1 overflow-auto relative cursor-default outline-none"
          style={{ backgroundImage: "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
          data-testid="auto-flow-canvas"
        >
          <svg className="absolute top-0 left-0 w-full h-full overflow-visible" style={{ zIndex: 1 }}>
            <defs>
              <marker id="arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="hsl(var(--muted-foreground))" />
              </marker>
            </defs>
            {renderEdges()}
          </svg>
          <div id="nodes-layer" className="relative" style={{ minWidth: 900, minHeight: 800, zIndex: 2 }}>
            {nodes.map((node) => (
              <FlowNodeComponent
                key={node.id}
                node={node}
                isSelected={selNode === node.id || multiSelected.has(node.id)}
                isConnecting={!!connectLine}
                onMouseDown={(e) => startDrag(e, node.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (didDragRef.current) { didDragRef.current = false; return; }
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    setMultiSelected(prev => {
                      const next = new Set(prev);
                      if (next.has(node.id)) { next.delete(node.id); } else { next.add(node.id); }
                      if (selNode && selNode !== node.id) { next.add(selNode); onSelectNode(null); }
                      return next;
                    });
                  } else {
                    setMultiSelected(new Set());
                    onSelectNode(node.id);
                  }
                  canvasRef.current?.focus();
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (node.type === "trigger") return;
                  onDeleteNode(node.id);
                }}
                onStartConnect={startConnectDrag}
                onQuickAddFromBranch={onQuickAddFromBranch}
                allNodes={nodes}
                onConnectToExisting={(fromId, branch, toId) => { onAddEdge(fromId, toId, branch); }}
                onDelete={node.type !== "trigger" ? () => onDeleteNode(node.id) : undefined}
                execCount={logsData.nodeCounts[node.id]}
                onRemoveIncomingEdge={(targetId) => {
                  const parent = nodes.find(n => {
                    if (n.next?.includes(targetId)) return true;
                    if (n.nextTrue === targetId) return true;
                    if (n.nextFalse === targetId) return true;
                    if (n.nextTextInput === targetId) return true;
                    if (n.nextOptions) { return Object.values(n.nextOptions).includes(targetId); }
                    return false;
                  });
                  if (parent) {
                    let branch: string | null = null;
                    if (parent.nextTrue === targetId) branch = "true";
                    else if (parent.nextFalse === targetId) branch = "false";
                    else if (parent.nextTextInput === targetId) branch = "text_input";
                    else if (parent.nextOptions) {
                      const optKey = Object.entries(parent.nextOptions).find(([, v]) => v === targetId)?.[0];
                      if (optKey) branch = optKey;
                    }
                    onRemoveEdge(parent.id, targetId, branch);
                  }
                }}
              />
            ))}
          </div>
          {marquee && (
            <div
              className="absolute border-2 border-primary/60 bg-primary/10 rounded-sm pointer-events-none"
              style={{
                left: Math.min(marquee.startX, marquee.curX),
                top: Math.min(marquee.startY, marquee.curY),
                width: Math.abs(marquee.curX - marquee.startX),
                height: Math.abs(marquee.curY - marquee.startY),
                zIndex: 50,
              }}
              data-testid="marquee-selection"
            />
          )}
          {multiSelected.size > 0 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg px-4 py-2 shadow-xl flex items-center gap-3" style={{ zIndex: 60 }} data-testid="multi-select-bar">
              <span className="text-xs font-bold text-muted-foreground">{multiSelected.size} no(s) selecionado(s)</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  const toDelete = [...multiSelected].filter(id => {
                    const nd = nodes.find(n => n.id === id);
                    return nd && nd.type !== "trigger";
                  });
                  toDelete.forEach(id => onDeleteNode(id));
                  setMultiSelected(new Set());
                }}
                data-testid="button-delete-multi"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Apagar selecionados
              </Button>
            </div>
          )}
        </div>

        {edgeCtxMenu && (
          <div
            className="fixed z-[100] bg-card border-2 border-border rounded-lg shadow-2xl py-1 min-w-[180px]"
            style={{ left: edgeCtxMenu.x, top: edgeCtxMenu.y }}
            onClick={(e) => e.stopPropagation()}
            data-testid="edge-context-menu"
          >
            <button
              className="w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-destructive/10 hover:text-destructive flex items-center gap-2 transition-colors"
              onClick={() => { onRemoveEdge(edgeCtxMenu.edge.fromId, edgeCtxMenu.edge.toId, edgeCtxMenu.edge.branch); setEdgeCtxMenu(null); }}
              data-testid="edge-ctx-remove"
            >
              <X className="w-3.5 h-3.5" /> Remover conexao
            </button>
            <button
              className="w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-primary/10 hover:text-primary flex items-center gap-2 transition-colors"
              onClick={(e) => { e.stopPropagation(); setEdgeInsertPicker({ edge: edgeCtxMenu.edge, x: edgeCtxMenu.x, y: edgeCtxMenu.y }); setEdgeCtxMenu(null); }}
              data-testid="edge-ctx-insert"
            >
              <Plus className="w-3.5 h-3.5" /> Inserir no entre
            </button>
          </div>
        )}

        {edgeInsertPicker && (
          <CategorizedPickerPopup
            fixed
            posX={edgeInsertPicker.x}
            posY={edgeInsertPicker.y}
            title="Inserir no entre"
            excludeTypes={["condition", "lista_opcoes"]}
            onSelect={(type) => { onInsertNodeOnEdge(edgeInsertPicker.edge.fromId, edgeInsertPicker.edge.toId, edgeInsertPicker.edge.branch, type); setEdgeInsertPicker(null); }}
            onClose={() => setEdgeInsertPicker(null)}
          />
        )}

        {selectedNode && selectedNode.type !== "ai_response" && (
          <ConfigPanel
            node={selectedNode}
            onUpdateCfg={onUpdateCfg}
            onUpdateLabel={onUpdateLabel}
            onDelete={() => onDeleteNode(selectedNode.id)}
            onClose={() => onSelectNode(null)}
            atendentes={atendentes}
            equipesLista={equipesLista}
            editorPipelines={editorPipelines}
            editorStages={editorStages}
            activePipelines={activePipelines}
          />
        )}

        {(showAiPanel || selectedNode?.type === "ai_response") && (!selectedNode || selectedNode.type === "ai_response") && (
          <div className="w-[480px] flex-shrink-0 bg-card border-l flex flex-col overflow-hidden" data-testid="ai-side-panel">
            <div className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.06)" }}>
              <span className="w-[26px] h-[26px] rounded-lg grid place-items-center flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.12)" }}><Brain className="w-4 h-4 text-primary" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-primary">Assistente Norte</div>
                <div className="text-[10px] text-muted-foreground">Defina o comportamento, modelo e recursos da inteligencia artificial</div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCloseAiPanel} data-testid="button-close-ai-panel">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AiFullPageConfig
                aiNode={aiNodeProp || null}
                nodes={nodes}
                onUpdateCfg={onUpdateCfg}
                onAddNode={onAddNode}
              />
            </div>
          </div>
        )}
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[520px]" style={{ border: "1px solid rgba(88,180,242,0.3)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileUp className="w-4 h-4 text-tertiary-600 dark:text-tertiary-500" />
              Importar Agente
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Carregue um arquivo JSON exportado pelo Chat Banana para importar um agente completo com todos os nos e configuracoes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                data-testid="input-import-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    setImportJson(text);
                    setImportError("");
                  };
                  reader.readAsText(file);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                className="w-full h-20 border-dashed border-2 hover:border-primary/50 transition-colors"
                onClick={() => importFileRef.current?.click()}
                data-testid="button-upload-agent-file"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Clique para selecionar arquivo .json</span>
                </div>
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase font-bold">ou cole o JSON</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Textarea
              value={importJson}
              onChange={(e) => { setImportJson(e.target.value); setImportError(""); }}
              placeholder='{"_chatbanana_agent": true, "nodes": [...]}'
              className="min-h-[120px] text-xs font-mono"
              data-testid="textarea-import-json"
            />
            {importError && (
              <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-red-500/10 rounded-lg p-2.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {importError}
              </div>
            )}
            {importJson && !importError && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 rounded-lg p-2.5 flex items-center gap-2">
                <Check className="w-3.5 h-3.5" />
                JSON carregado - pronto para importar
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)} data-testid="button-cancel-import">
              Cancelar
            </Button>
            <Button
              size="sm"
              className="gradient-accent text-white"
              disabled={!importJson.trim()}
              onClick={() => importAgentFromJson(importJson)}
              data-testid="button-confirm-import"
            >
              <FileUp className="w-3 h-3 mr-1" /> Importar Agente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bananaOpen} onOpenChange={setBananaOpen}>
        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-hidden flex flex-col" style={{ border: "2px solid hsl(var(--primary) / 0.2)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Brain className="w-5 h-5 text-primary" />
              <span className="text-foreground">Criar com IA</span>
              <Sparkles className="w-4 h-4 text-primary" />
            </DialogTitle>
            <DialogDescription className="text-[11.5px]">
              IA especialista em criar fluxos de automação completos. Descreva o que precisa e receba o fluxo pronto!
            </DialogDescription>
          </DialogHeader>

          {/* Redesign Norte: pílula seg-tab (azul sólido). Antes: amarelo banana #FED30E. */}
          <div className="inline-flex gap-1 -mt-1">
            <button
              onClick={() => setBananaTab("criar")}
              className={`seg-tab ${bananaTab === "criar" ? "seg-tab-active" : ""}`}
              data-testid="tab-banana-criar"
            >
              <Sparkles className="w-3 h-3 inline mr-1" />Criar Fluxo
            </button>
            <button
              onClick={() => setBananaTab("credenciais")}
              className={`seg-tab ${bananaTab === "credenciais" ? "seg-tab-active" : ""}`}
              data-testid="tab-banana-credenciais"
            >
              <Key className="w-3 h-3 inline mr-1" />Credenciais
            </button>
          </div>

          {bananaTab === "credenciais" && (
            <div className="flex flex-col gap-4 flex-1 overflow-y-auto py-2">
              <div className="rounded-lg p-3 bg-muted/50 space-y-2">
                <span className="text-[10.5px] font-bold text-muted-foreground uppercase">Fonte da chave OpenAI</span>
                <div className="flex gap-2">
                  <button
                    className={`flex-1 rounded-lg p-2.5 border text-left transition-all ${bananaKeySource === "integration" ? "border-[#FED30E] bg-[#FED30E]/10 ring-1 ring-[#FED30E]/30" : "border-border hover:border-muted-foreground/30"}`}
                    onClick={() => { setBananaKeySource("integration"); setBananaCustomKey(""); }}
                    data-testid="button-banana-key-integration"
                  >
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-3.5 h-3.5 text-[#FED30E]" />
                      <span className="text-[10.5px] font-bold">Chave da Integracao</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">Usa a chave principal configurada em Integracoes (recomendado)</p>
                  </button>
                  <button
                    className={`flex-1 rounded-lg p-2.5 border text-left transition-all ${bananaKeySource === "custom" ? "border-[#FED30E] bg-[#FED30E]/10 ring-1 ring-[#FED30E]/30" : "border-border hover:border-muted-foreground/30"}`}
                    onClick={() => setBananaKeySource("custom")}
                    data-testid="button-banana-key-custom"
                  >
                    <div className="flex items-center gap-2">
                      <Key className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span className="text-[10.5px] font-bold">Chave personalizada</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-1">Usar uma chave diferente só para o gerador de fluxos</p>
                  </button>
                </div>
              </div>

              {bananaKeySource === "custom" && (
                <div>
                  <Label className="text-[10.5px] uppercase font-bold text-muted-foreground block mb-1">API Key personalizada</Label>
                  <div className="flex gap-1.5">
                    <Input
                      type={bananaKeyVisible ? "text" : "password"}
                      className="text-xs font-mono flex-1"
                      placeholder="sk-..."
                      value={bananaCustomKey}
                      onChange={(e) => setBananaCustomKey(e.target.value)}
                      data-testid="input-banana-custom-key"
                    />
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setBananaKeyVisible(!bananaKeyVisible)} data-testid="button-banana-toggle-key">
                      {bananaKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[9.5px] text-muted-foreground mt-1">
                    Esta chave sera usada apenas pelo Banana Creator.{" "}
                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Obter no painel OpenAI</a>
                  </p>
                </div>
              )}

              {bananaKeySource === "integration" && (
                <div className="flex items-center gap-2 rounded-lg p-2.5 bg-primary/10">
                  <Settings2 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-bold text-primary">Usando a chave principal configurada nas Integracoes</span>
                </div>
              )}

              <div className="rounded-lg border-dashed border p-3">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  O Banana Creator usa a mesma hierarquia de chaves: primeiro verifica se ha uma chave personalizada aqui, depois busca a chave das Integracoes, e por ultimo tenta a chave do ambiente do sistema.
                </p>
              </div>
            </div>
          )}

          {bananaTab === "criar" && !bananaResult ? (
            <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
              <button
                onClick={() => setBananaSingleAI(!bananaSingleAI)}
                className={`flex items-center gap-2.5 w-full rounded-xl p-3 border text-left transition-all ${bananaSingleAI ? "border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30" : "border-border hover:border-muted-foreground/30"}`}
                style={{ background: bananaSingleAI ? undefined : "transparent" }}
                data-testid="button-banana-single-ai"
              >
                <div className={`w-9 h-5 rounded-full flex items-center transition-all ${bananaSingleAI ? "bg-purple-500 justify-end" : "bg-muted justify-start"}`}>
                  <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span className="text-[11px] font-semibold">Fluxo 100% IA</span>
                    <Badge variant="outline" className="text-[8px] px-1.5 py-0 border-purple-500/40 text-purple-600 dark:text-purple-400">PRO</Badge>
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5">Um unico no de IA autonomo que entende tudo, responde, envia imagens, PDFs, links de pagamento e gerencia todo o atendimento sozinho</p>
                </div>
              </button>

              <div>
                <Label className="text-[11px] font-bold mb-1.5 block">{bananaSingleAI ? "Descreva como a IA deve atender" : "Descreva o fluxo que deseja criar"}</Label>
                <Textarea
                  placeholder={bananaSingleAI
                    ? "Ex: Atendimento completo de delivery de pizzas. A IA deve apresentar o cardapio, anotar o pedido, confirmar endereco, oferecer formas de pagamento (Pix/cartao), enviar o PDF do cardapio e o link de pagamento Stripe..."
                    : "Ex: Crie um fluxo completo de atendimento de delivery com cardapio, opcoes de pagamento e confirmacao de pedido..."}
                  value={bananaPrompt}
                  onChange={(e) => setBananaPrompt(e.target.value)}
                  className="min-h-[100px] text-[12px] resize-none"
                  data-testid="input-banana-prompt"
                />
              </div>

              <button
                onClick={() => setBananaShowContext(!bananaShowContext)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-fit"
                style={{ background: "none", border: "none", padding: 0 }}
              >
                {bananaShowContext ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <Settings2 className="w-3.5 h-3.5" />
                Informacoes adicionais do negocio (opcional)
              </button>

              {bananaShowContext && (
                <Textarea
                  placeholder="Insira informacoes especificas do negocio: cardapio, formas de pagamento, horario de funcionamento, endereco, regras especiais..."
                  value={bananaContext}
                  onChange={(e) => setBananaContext(e.target.value)}
                  className="min-h-[80px] text-[12px] resize-none"
                  data-testid="input-banana-context"
                />
              )}

              <div>
                <input
                  ref={bananaFileRef}
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) return;
                    setBananaUploading(true);
                    try {
                      for (const file of Array.from(files)) {
                        const fd = new FormData();
                        fd.append("file", file);
                        const resp = await apiUpload("/api/upload", fd);
                        const data = await resp.json();
                        if (data.url) {
                          const ftype = file.type.startsWith("image/") ? "image" : "pdf";
                          setBananaFiles(prev => [...prev, { name: file.name, url: data.url, type: ftype }]);
                        }
                      }
                    } catch {}
                    setBananaUploading(false);
                    if (bananaFileRef.current) bananaFileRef.current.value = "";
                  }}
                />
                <button
                  onClick={() => bananaFileRef.current?.click()}
                  disabled={bananaUploading || bananaLoading}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer w-fit disabled:opacity-50"
                  style={{ background: "none", border: "none", padding: 0 }}
                  data-testid="button-banana-upload"
                >
                  {bananaUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                  {bananaUploading ? "Enviando..." : "Anexar imagens ou PDFs (cardapio, catalogo, etc.)"}
                </button>

                {bananaFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {bananaFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 bg-muted/50 rounded px-2 py-1 text-[10px]">
                        {f.type === "image" ? <ImagePlus className="w-3 h-3 text-pink-600 dark:text-pink-400" /> : <FileText className="w-3 h-3 text-tertiary-600 dark:text-tertiary-500" />}
                        <span className="max-w-[120px] truncate">{f.name}</span>
                        <button
                          onClick={() => setBananaFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="ml-0.5 text-muted-foreground hover:text-rose-600 dark:text-rose-400 transition-colors"
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {bananaStream && (
                <div className="bg-muted/30 rounded-lg p-3 text-[11px] max-h-[150px] overflow-y-auto font-mono">
                  <div className="flex items-center gap-1.5 mb-2 text-[#FED30E] font-bold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Gerando fluxo...
                  </div>
                  <pre className="whitespace-pre-wrap text-muted-foreground text-[10px]">{bananaStream.slice(0, 500)}{bananaStream.length > 500 ? "..." : ""}</pre>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  disabled={!bananaPrompt.trim() || bananaLoading}
                  className="flex-1 font-semibold text-[12px]"
                  style={{ background: bananaLoading ? undefined : "linear-gradient(135deg, #FED30E 0%, #e8b600 100%)", color: bananaLoading ? undefined : "#1a1200" }}
                  onClick={async () => {
                    setBananaLoading(true);
                    setBananaResult(null);
                    setBananaStream("");
                    try {
                      const resp = await apiFetchRaw("/api/banana-creator/generate", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ prompt: bananaPrompt.trim(), context: bananaContext.trim() || undefined, files: bananaFiles.length > 0 ? bananaFiles : undefined, customApiKey: bananaKeySource === "custom" && bananaCustomKey.trim() ? bananaCustomKey.trim() : undefined, singleAI: bananaSingleAI || undefined }),
                      });
                      const reader = resp.body?.getReader();
                      if (!reader) throw new Error("Sem resposta");
                      const decoder = new TextDecoder();
                      let full = "";
                      let sseBuffer = "";
                      let streamDone = false;
                      while (true) {
                        const { done: rdone, value } = await reader.read();
                        if (rdone) break;
                        sseBuffer += decoder.decode(value, { stream: true });
                        const sseLines = sseBuffer.split("\n");
                        sseBuffer = sseLines.pop() || "";
                        for (const line of sseLines) {
                          const trimmed = line.trim();
                          if (!trimmed.startsWith("data: ")) continue;
                          try {
                            const data = JSON.parse(trimmed.slice(6));
                            if (data.error) throw new Error(data.error);
                            if (data.content) { full += data.content; setBananaStream(full); }
                            if (data.done) streamDone = true;
                          } catch (pe: any) {
                            if (pe.message && pe.message !== "Unexpected" && !pe.message.startsWith("Unexpected")) {
                            }
                          }
                        }
                      }
                      if (sseBuffer.trim().startsWith("data: ")) {
                        try {
                          const data = JSON.parse(sseBuffer.trim().slice(6));
                          if (data.content) { full += data.content; }
                          if (data.done) streamDone = true;
                        } catch {}
                      }
                      if (full.length > 0) {
                        try {
                          let cleaned = full.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
                          const jsonStart = cleaned.indexOf("{");
                          const jsonEnd = cleaned.lastIndexOf("}");
                          if (jsonStart >= 0 && jsonEnd > jsonStart) {
                            cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
                          }
                          const parsed = JSON.parse(cleaned);
                          setBananaResult(parsed);
                        } catch (parseErr: any) {
                          console.error("[BananaCreator] Parse error:", parseErr.message, "full start:", full.substring(0, 100));
                          setBananaResult({ error: "Nao foi possivel interpretar a resposta da IA. Tente novamente.", raw: full });
                        }
                      } else {
                        setBananaResult({ error: "Resposta vazia da IA. Tente novamente." });
                      }
                    } catch (e: any) {
                      setBananaResult({ error: e.message || "Erro ao gerar fluxo" });
                    } finally {
                      setBananaLoading(false);
                    }
                  }}
                  data-testid="button-banana-generate"
                >
                  {bananaLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Gerando...</> : <><span className="mr-1">{bananaSingleAI ? "🧠" : "🍌"}</span> {bananaSingleAI ? "Gerar Agente IA" : "Gerar Fluxo Completo"}</>}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                {(bananaSingleAI ? [
                  "Atendente de delivery que anota pedidos e envia cardapio",
                  "Consultor de vendas B2B que qualifica e agenda reunioes",
                  "Recepcionista de clinica que agenda consultas e envia orientacoes",
                  "Atendente de e-commerce que mostra produtos e envia links de pagamento",
                  "Suporte tecnico que resolve problemas e escala para humano",
                  "Corretor de imoveis que apresenta opcoes e agenda visitas",
                ] : [
                  "Fluxo de atendimento delivery completo",
                  "Qualificacao de leads B2B",
                  "Agendamento de consultas medicas",
                  "Suporte tecnico com triagem por IA",
                  "Follow-up pos-venda automatizado",
                  "Pesquisa de satisfacao NPS",
                ]).map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setBananaPrompt(suggestion)}
                    className="text-[10px] text-left px-2.5 py-2 rounded-lg border border-border hover:border-[#FED30E55] hover:bg-[#FED30E08] transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                    style={{ background: "transparent" }}
                  >
                    <Sparkles className="w-3 h-3 inline mr-1 text-[#FED30E]" />{suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : bananaTab === "criar" && bananaResult?.error ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <AlertCircle className="w-8 h-8 text-destructive" />
              <p className="text-[12px] text-center text-muted-foreground">{bananaResult.error}</p>
              {bananaResult.raw && (
                <details className="w-full">
                  <summary className="text-[10px] text-muted-foreground cursor-pointer">Ver resposta bruta</summary>
                  <pre className="text-[9px] bg-muted/30 rounded p-2 mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap">{bananaResult.raw}</pre>
                </details>
              )}
              <Button variant="outline" size="sm" onClick={() => { setBananaResult(null); setBananaStream(""); }}>Tentar novamente</Button>
            </div>
          ) : bananaTab === "criar" && bananaResult ? (
            <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
              <div className="bg-[#FED30E08] border border-[#FED30E33] rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🍌</span>
                  <span className="text-[13px] font-semibold">{bananaResult.nome || "Fluxo gerado"}</span>
                  <Check className="w-4 h-4 text-emerald-500" />
                </div>
                {bananaResult.descricao && <p className="text-[11px] text-muted-foreground">{bananaResult.descricao}</p>}
              </div>

              <div className="bg-muted/20 rounded-lg p-3">
                <div className="text-[11px] font-bold mb-2 flex items-center gap-1.5">
                  <Workflow className="w-3.5 h-3.5 text-primary" />
                  {bananaResult.nodes?.length || 0} blocos no fluxo
                </div>
                <div className="space-y-1 max-h-[120px] overflow-y-auto">
                  {bananaResult.nodes?.map((n: any, i: number) => {
                    const nt = NODE_TYPES[n.type] || NODE_TYPES.end;
                    const Icon = nt.icon;
                    return (
                      <div key={i} className="flex items-center gap-2 text-[10.5px]">
                        <Icon className="w-3 h-3 flex-shrink-0" style={{ color: nt.color }} />
                        <span className="font-bold" style={{ color: nt.color }}>{nt.label}</span>
                        <span className="text-muted-foreground truncate">{n.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {bananaResult.feedback && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <div className="text-[11px] font-bold mb-1.5 flex items-center gap-1.5 text-primary">
                    <Info className="w-3.5 h-3.5" />
                    O que personalizar
                  </div>
                  <p className="text-[10.5px] text-muted-foreground leading-relaxed">{bananaResult.feedback}</p>
                  {bananaResult.campos_personalizar?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {bananaResult.campos_personalizar.map((c: string) => (
                        <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="text-[11px]" onClick={() => { setBananaResult(null); setBananaStream(""); }} data-testid="button-banana-retry">
                  <RefreshCw className="w-3 h-3 mr-1" /> Gerar outro
                </Button>
                <Button
                  size="sm"
                  className="text-[11px] font-semibold flex-1"
                  style={{ background: "linear-gradient(135deg, #FED30E 0%, #e8b600 100%)", color: "#1a1200" }}
                  onClick={() => {
                    if (bananaResult.nodes?.length) {
                      const rawNodes: FlowNode[] = bananaResult.nodes.map((n: any) => {
                        const cfg = { ...(n.config || {}) };
                        if (n.type === "lista_opcoes") {
                          const resolvedBtnLabel = cfg.buttonText || cfg.button_text || cfg.button_label || cfg.buttonLabel || "Ver opcoes";
                          cfg.button_label = resolvedBtnLabel;
                          cfg.buttonText = resolvedBtnLabel;
                          if (!cfg.list_style) cfg.list_style = "buttons";
                          const nOpts: Record<string, string> = { ...(n.nextOptions || {}) };
                          if (Array.isArray(cfg.options)) {
                            cfg.options = cfg.options.map((o: any, i: number) => {
                              const optId = o.id || `opt_${i + 1}`;
                              if (o.next && !nOpts[`opt_${optId}`]) {
                                nOpts[`opt_${optId}`] = o.next;
                              }
                              return { ...o, id: optId, label: o.label || `Opcao ${i + 1}` };
                            });
                          }
                          if (Object.keys(nOpts).length > 0) {
                            (n as any)._nextOptions = nOpts;
                          }
                        }
                        if (n.type === "send_message" && !cfg.content) {
                          cfg.content = n.label || "Mensagem";
                        }
                        const resolvedNextOptions = (n as any)._nextOptions || n.nextOptions;
                        return {
                          id: n.id || genId(),
                          type: n.type || "end",
                          label: n.label || "",
                          config: cfg,
                          x: n.x ?? 250,
                          y: n.y ?? 0,
                          next: n.next || [],
                          ...(n.nextTrue ? { nextTrue: n.nextTrue } : {}),
                          ...(n.nextFalse ? { nextFalse: n.nextFalse } : {}),
                          ...(resolvedNextOptions ? { nextOptions: resolvedNextOptions } : {}),
                        };
                      });

                      const nodeMap = new Map<string, FlowNode>();
                      rawNodes.forEach(n => nodeMap.set(n.id, n));
                      const positioned = new Set<string>();
                      const VERTICAL_GAP = 200;
                      const BRANCH_SPREAD = 220;
                      const CENTER_X = 250;

                      function layoutNode(nodeId: string, x: number, y: number): number {
                        if (positioned.has(nodeId)) return y;
                        const node = nodeMap.get(nodeId);
                        if (!node) return y;
                        node.x = x;
                        node.y = y;
                        positioned.add(nodeId);
                        let nextY = y + VERTICAL_GAP;

                        const isBranching = node.type === "condition" || node.type === "advanced_condition" || node.type === "split_ia";
                        const hasOptionBranches = node.type === "lista_opcoes" && node.nextOptions && Object.keys(node.nextOptions).length > 0;

                        if (isBranching && (node.nextTrue || node.nextFalse)) {
                          let maxBranchY = nextY;
                          if (node.nextTrue) {
                            const endY = layoutNode(node.nextTrue, x - BRANCH_SPREAD, nextY);
                            maxBranchY = Math.max(maxBranchY, endY);
                          }
                          if (node.nextFalse) {
                            const endY = layoutNode(node.nextFalse, x + BRANCH_SPREAD, nextY);
                            maxBranchY = Math.max(maxBranchY, endY);
                          }
                          nextY = maxBranchY;
                        } else if (hasOptionBranches) {
                          const optEntries = Object.entries(node.nextOptions!);
                          const totalWidth = (optEntries.length - 1) * BRANCH_SPREAD;
                          const startX = x - totalWidth / 2;
                          let maxBranchY = nextY;
                          optEntries.forEach(([, targetId], i) => {
                            const branchX = startX + i * BRANCH_SPREAD;
                            const endY = layoutNode(targetId, branchX, nextY);
                            maxBranchY = Math.max(maxBranchY, endY);
                          });
                          nextY = maxBranchY;
                          const remainingNext = (node.next || []).filter((nid: string) => !positioned.has(nid) && !optEntries.some(([, tid]) => tid === nid));
                          for (const nid of remainingNext) {
                            nextY = layoutNode(nid, x, nextY);
                          }
                        } else if (node.next?.length) {
                          if (node.next.length === 1) {
                            nextY = layoutNode(node.next[0], x, nextY);
                          } else {
                            const totalWidth = (node.next.length - 1) * BRANCH_SPREAD;
                            const startX = x - totalWidth / 2;
                            let maxBranchY = nextY;
                            node.next.forEach((nid: string, i: number) => {
                              const branchX = startX + i * BRANCH_SPREAD;
                              const endY = layoutNode(nid, branchX, nextY);
                              maxBranchY = Math.max(maxBranchY, endY);
                            });
                            nextY = maxBranchY;
                          }
                        }
                        return nextY;
                      }

                      const triggerNode = rawNodes.find(n => n.type === "trigger") || rawNodes[0];
                      if (triggerNode) {
                        layoutNode(triggerNode.id, CENTER_X, 60);
                      }
                      let orphanY = Math.max(...rawNodes.filter(n => positioned.has(n.id)).map(n => n.y), 0) + VERTICAL_GAP;
                      rawNodes.forEach(n => {
                        if (!positioned.has(n.id)) {
                          n.x = CENTER_X;
                          n.y = orphanY;
                          orphanY += VERTICAL_GAP;
                          positioned.add(n.id);
                        }
                      });

                      onRenameName(bananaResult.nome || automation.nome);
                      const event = new CustomEvent("banana-creator-apply", { detail: { nodes: rawNodes } });
                      window.dispatchEvent(event);
                    }
                    setBananaOpen(false);
                  }}
                  data-testid="button-banana-apply"
                >
                  <span className="mr-1">🍌</span> Aplicar Fluxo no Canvas
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {logsOpen && (
        <div className="absolute top-12 right-0 bottom-0 w-[340px] bg-card border-l border-border z-50 flex flex-col" data-testid="logs-panel">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
            <span className="text-xs font-bold flex items-center gap-1.5">
              <ClipboardCheck className="w-3.5 h-3.5" /> Logs de Execucao
            </span>
            <button onClick={() => setLogsOpen(false)} className="text-muted-foreground hover:text-foreground" data-testid="button-close-logs">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {logsData.recentLogs.length === 0 ? (
              <div className="text-center text-muted-foreground text-xs py-8" data-testid="logs-empty">
                Nenhuma execucao registrada ainda
              </div>
            ) : (
              logsData.recentLogs.map((log: any) => (
                <div key={log.id} className="px-2.5 py-2 rounded-lg border border-border bg-background text-[11px]" data-testid={`log-entry-${log.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold truncate max-w-[160px]">{log.nodeType}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      log.status === "success" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                      log.status === "error" ? "bg-red-500/15 text-rose-600 dark:text-rose-400" :
                      "bg-yellow-500/15 text-amber-600 dark:text-amber-400"
                    }`}>
                      {log.status === "success" ? "OK" : log.status === "error" ? "ERRO" : log.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                    {new Date(log.executedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                  {log.errorMessage && (
                    <div className="mt-1 text-rose-600 dark:text-rose-400 text-[10px] break-words">{log.errorMessage}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const FlowNodeComponent = memo(function FlowNodeComponent({
  node, isSelected, isConnecting, onMouseDown, onClick, onDoubleClick, onStartConnect, onQuickAddFromBranch, allNodes, onConnectToExisting, onDelete, onRemoveIncomingEdge, execCount,
}: {
  node: FlowNode; isSelected: boolean; isConnecting: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onStartConnect: (e: React.MouseEvent, nodeId: string, branch: string | null) => void;
  onQuickAddFromBranch: (fromId: string, branch: string, nodeType: string) => void;
  allNodes?: FlowNode[];
  onConnectToExisting?: (fromId: string, branch: string, toId: string) => void;
  onDelete?: () => void;
  onRemoveIncomingEdge?: (targetId: string) => void;
  execCount?: number;
}) {
  const [quickAddBranch, setQuickAddBranch] = useState<string | null>(null);
  const [showExistingPicker, setShowExistingPicker] = useState<string | null>(null);
  const dragClickRef = useRef<{ didDrag: boolean }>({ didDrag: false });
  const conf = NODE_TYPES[node.type] || NODE_TYPES.end;
  const Icon = conf.icon;

  function handleBranchButtonMouseDown(e: React.MouseEvent, optId: string) {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    dragClickRef.current.didDrag = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && (dx * dx + dy * dy > 25)) {
        dragging = true;
        dragClickRef.current.didDrag = true;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        onStartConnect(e, node.id, optId);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const hasIncomingEdge = node.type !== "trigger" && allNodes?.some(n => {
    if (n.next?.includes(node.id)) return true;
    if (n.nextTrue === node.id || n.nextFalse === node.id) return true;
    if (n.nextTextInput === node.id) return true;
    if (n.nextOptions) return Object.values(n.nextOptions).includes(node.id);
    return false;
  });

  const portStyle = "absolute left-1/2 -translate-x-1/2 rounded-full transition-all z-10";

  return (
    <div
      id={"fn-" + node.id}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`absolute bg-card rounded-xl cursor-grab select-none transition-all group/node ${isConnecting ? "pointer-events-auto" : ""}`}
      style={{
        left: node.x || 0,
        top: node.y || 0,
        width: 180,
        border: `2px solid ${isSelected ? conf.color : "hsl(var(--border))"}`,
        boxShadow: isSelected ? `0 0 0 3px ${conf.color}20, 0 4px 20px rgba(0,0,0,.3)` : "0 2px 12px rgba(0,0,0,.2)",
      }}
      data-testid={`flow-node-${node.id}`}
    >
      {node.type !== "trigger" && (
        <>
          <div
            className="absolute -top-[5px] left-1/2 -translate-x-1/2 w-[10px] h-[10px] rounded-full bg-card z-10"
            style={{ border: `2px solid hsl(var(--muted-foreground) / 0.4)` }}
            title="Entrada"
          />
          {hasIncomingEdge && (
            <button
              className="absolute -top-[24px] left-1/2 -translate-x-1/2 w-[16px] h-[16px] rounded-full bg-transparent text-transparent hover:bg-destructive/90 hover:text-white flex items-center justify-center transition-all hover:scale-125 hover:shadow-md cursor-pointer z-20"
              onClick={(e) => { e.stopPropagation(); onRemoveIncomingEdge?.(node.id); }}
              onMouseDown={(e) => e.stopPropagation()}
              title="Remover conexao de entrada"
              data-testid={`button-remove-edge-${node.id}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </>
      )}
      {typeof execCount === "number" && execCount > 0 && (
        <div className="absolute -top-2 -right-2 min-w-[18px] h-[18px] rounded-full bg-muted border border-border flex items-center justify-center z-20" data-testid={`node-exec-count-${node.id}`}>
          <span className="text-[8px] font-bold text-muted-foreground px-1">{execCount > 999 ? "999+" : execCount}</span>
        </div>
      )}
      <div
        className="px-2.5 py-2 flex items-center gap-2 border-b rounded-t-xl"
        style={{ background: `${conf.color}18`, borderColor: "hsl(var(--border))" }}
      >
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: conf.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: conf.color }}>{conf.label}</span>
            {node.type === "lista_opcoes" && (
              node.config?.blocking === false ? (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#7C3AED20", color: "#7C3AED" }}>
                  Opcional
                </span>
              ) : (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#8B5CF620", color: "#8B5CF6" }}>
                  <Pause className="w-2.5 h-2.5 inline mr-0.5" />Aguarda
                </span>
              )
            )}
          </div>
          <div className="text-[11px] text-foreground truncate mt-0.5">{node.label}</div>
        </div>
      </div>
      <div className="px-2.5 py-1.5 text-[10.5px] text-muted-foreground leading-snug min-h-[26px]">
        {getNodePreview(node)}
      </div>
      {(node.type === "condition" || node.type === "advanced_condition" || node.type === "loop" || node.type === "wait_event") && (
        <div className="flex border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <div
            className="flex-1 py-1 text-center text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400 border-r cursor-crosshair hover:bg-emerald-400/10"
            style={{ borderColor: "hsl(var(--border))" }}
            onMouseDown={(e) => onStartConnect(e, node.id, "true")}
            title={node.type === "wait_event" ? "Arrastar: Evento recebido" : "Arrastar para conectar: Sim"}
            data-option-id="true"
            data-node-id={node.id}
          >
            <Check className="w-3 h-3 inline mr-0.5" /> {node.type === "wait_event" ? "Evento" : "Sim"}
          </div>
          <div
            className="flex-1 py-1 text-center text-[9.5px] font-semibold text-rose-600 dark:text-rose-400 cursor-crosshair hover:bg-red-400/10"
            onMouseDown={(e) => onStartConnect(e, node.id, "false")}
            title={node.type === "wait_event" ? "Arrastar: Timeout" : "Arrastar para conectar: Nao"}
            data-option-id="false"
            data-node-id={node.id}
          >
            <X className="w-3 h-3 inline mr-0.5" /> {node.type === "wait_event" ? "Timeout" : "Nao"}
          </div>
        </div>
      )}
      {node.type === "split_ia" && (
        <div className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
          {((node.config?.categories || ["vendas", "suporte", "financeiro"]) as string[]).map((cat) => {
            const isConnected = !!(node.nextOptions && node.nextOptions[cat]);
            return (
              <div key={cat}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[9.5px] font-bold border-b last:border-b-0 cursor-crosshair hover:bg-primary/10"
                style={{ color: "#c084fc", borderColor: "hsl(var(--border))" }}
                onMouseDown={(e) => onStartConnect(e, node.id, cat)}
                title={`Arrastar para conectar: ${cat}`}
                data-testid={`split-ia-branch-${cat}`}
                data-option-id={cat}
                data-node-id={node.id}
              >
                <ChevronRight className="w-3 h-3" />
                <span className="truncate flex-1">{cat}</span>
                {isConnected && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
              </div>
            );
          })}
        </div>
      )}
      {node.type === "lista_opcoes" && (
        <div className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
          {((node.config?.options || []) as { id: string; label: string }[]).map((opt) => {
            const isConnected = !!(node.nextOptions && node.nextOptions[opt.id]);
            return (
              <div key={opt.id} className="relative">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[9.5px] font-bold border-b last:border-b-0 cursor-crosshair hover:bg-purple-400/10"
                  style={{ color: "#8B5CF6", borderColor: "hsl(var(--border))" }}
                  onMouseDown={(e) => onStartConnect(e, node.id, opt.id)}
                  title={isConnected ? `Conectado — arraste para reconectar: ${opt.label}` : `Arrastar para conectar: ${opt.label}`}
                  data-option-id={opt.id}
                  data-node-id={node.id}
                >
                  <ChevronRight className="w-3 h-3" />
                  <span className="truncate flex-1">{opt.label || opt.id}</span>
                  {isConnected ? (
                    <button
                      className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center hover:bg-primary/20 transition-colors cursor-crosshair"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (dragClickRef.current.didDrag) return; setQuickAddBranch(quickAddBranch === opt.id ? null : opt.id); setShowExistingPicker(opt.id); }}
                      onMouseDown={(e) => handleBranchButtonMouseDown(e, opt.id)}
                      title={`Reconectar: ${opt.label} — arraste para conectar`}
                      data-testid={`reconnect-${opt.id}`}
                    >
                      <RefreshCw className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    </button>
                  ) : (
                    <button
                      className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center hover:bg-primary/20 transition-colors cursor-crosshair"
                      style={{ color: "#8B5CF6" }}
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (dragClickRef.current.didDrag) return; setQuickAddBranch(quickAddBranch === opt.id ? null : opt.id); }}
                      onMouseDown={(e) => handleBranchButtonMouseDown(e, opt.id)}
                      title={`Criar no para: ${opt.label} — arraste para conectar`}
                      data-testid={`quick-add-${opt.id}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {quickAddBranch === opt.id && (
                  <div
                    className="absolute left-full top-0 ml-1 z-50 bg-card border-2 border-border rounded-lg shadow-2xl p-1.5 min-w-[180px] max-h-[360px] overflow-y-auto grid grid-cols-1 gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {showExistingPicker === opt.id ? (
                      <>
                        <div className="flex items-center gap-1 px-2 py-1">
                          <button onClick={() => setShowExistingPicker(null)} className="text-muted-foreground hover:text-foreground"><ChevronRight className="w-3 h-3 rotate-180" /></button>
                          <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider">Conectar a no existente</span>
                        </div>
                        {(allNodes || []).filter(n => n.id !== node.id && n.type !== "trigger").map(n => {
                          const nc = NODE_TYPES[n.type] || NODE_TYPES.end;
                          const NIcon = nc.icon;
                          const alreadyConnected = node.nextOptions?.[opt.id] === n.id;
                          return (
                            <div
                              key={n.id}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${alreadyConnected ? "bg-primary/20 opacity-60" : "hover:bg-muted/50"}`}
                              onClick={() => {
                                if (!alreadyConnected && onConnectToExisting) {
                                  onConnectToExisting(node.id, opt.id, n.id);
                                }
                                setQuickAddBranch(null);
                                setShowExistingPicker(null);
                              }}
                            >
                              <NIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: nc.color }} />
                              <span className="text-[10px] font-semibold truncate">{n.label || nc.label}</span>
                              {alreadyConnected && <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0 ml-auto" />}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        <div className="text-[8.5px] font-bold text-muted-foreground uppercase px-2 py-1 tracking-wider">Criar no para: {opt.label || opt.id}</div>
                        <CategorizedInlineList
                          excludeTypes={["trigger", "end"]}
                          onSelect={(type) => { onQuickAddFromBranch(node.id, opt.id, type); setQuickAddBranch(null); }}
                          testIdPrefix="quick-add-type"
                        />
                        <div className="border-t border-border/50 mt-1 pt-1">
                          <div
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-primary/10 transition-colors"
                            onClick={() => setShowExistingPicker(opt.id)}
                            data-testid={`connect-existing-${opt.id}`}
                          >
                            <Link className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                            <span className="text-[10.5px] font-semibold text-primary">Conectar a no existente</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="relative">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 text-[9.5px] font-bold cursor-crosshair hover:bg-muted/30"
              style={{ color: "#94a3b8", borderTop: "1px dashed hsl(var(--border))" }}
              onMouseDown={(e) => onStartConnect(e, node.id, "text_input")}
              title="Arrastar para conectar: Texto livre"
              data-option-id="text_input"
              data-node-id={node.id}
            >
              <MessageCircle className="w-3 h-3" />
              <span className="truncate flex-1">Texto livre</span>
              {node.nextTextInput ? (
                <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              ) : (
                <button
                  className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center hover:bg-muted/20 transition-colors cursor-crosshair"
                  style={{ color: "#94a3b8" }}
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (dragClickRef.current.didDrag) return; setQuickAddBranch(quickAddBranch === "text_input" ? null : "text_input"); }}
                  onMouseDown={(e) => handleBranchButtonMouseDown(e, "text_input")}
                  title="Criar no para: Texto livre — arraste para conectar"
                  data-testid="quick-add-text-input"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {quickAddBranch === "text_input" && (
              <div
                className="absolute left-full top-0 ml-1 z-50 bg-card border-2 border-border rounded-lg shadow-2xl p-1.5 min-w-[180px] max-h-[360px] overflow-y-auto grid grid-cols-1 gap-0.5"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {showExistingPicker === "text_input" ? (
                  <>
                    <div className="flex items-center gap-1 px-2 py-1">
                      <button onClick={() => setShowExistingPicker(null)} className="text-muted-foreground hover:text-foreground"><ChevronRight className="w-3 h-3 rotate-180" /></button>
                      <span className="text-[8.5px] font-bold text-muted-foreground uppercase tracking-wider">Conectar a no existente</span>
                    </div>
                    {(allNodes || []).filter(n => n.id !== node.id && n.type !== "trigger").map(n => {
                      const nc = NODE_TYPES[n.type] || NODE_TYPES.end;
                      const NIcon = nc.icon;
                      const alreadyConnected = node.nextTextInput === n.id;
                      return (
                        <div
                          key={n.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${alreadyConnected ? "bg-primary/20 opacity-60" : "hover:bg-muted/50"}`}
                          onClick={() => {
                            if (!alreadyConnected && onConnectToExisting) {
                              onConnectToExisting(node.id, "text_input", n.id);
                            }
                            setQuickAddBranch(null);
                            setShowExistingPicker(null);
                          }}
                        >
                          <NIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: nc.color }} />
                          <span className="text-[10px] font-semibold truncate">{n.label || nc.label}</span>
                          {alreadyConnected && <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0 ml-auto" />}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <div className="text-[8.5px] font-bold text-muted-foreground uppercase px-2 py-1 tracking-wider">Criar no para: Texto livre</div>
                    <CategorizedInlineList
                      excludeTypes={["trigger", "end"]}
                      onSelect={(type) => { onQuickAddFromBranch(node.id, "text_input", type); setQuickAddBranch(null); }}
                    />
                    <div className="border-t border-border/50 mt-1 pt-1">
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-primary/10 transition-colors"
                        onClick={() => setShowExistingPicker("text_input")}
                        data-testid="connect-existing-text-input"
                      >
                        <Link className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                        <span className="text-[10.5px] font-semibold text-primary">Conectar a no existente</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {node.type !== "end" && node.type !== "condition" && node.type !== "lista_opcoes" && (
        <div
          onMouseDown={(e) => onStartConnect(e, node.id, null)}
          title="Arrastar para conectar"
          className={`${portStyle} -bottom-[6px] w-[12px] h-[12px] bg-card cursor-crosshair hover:scale-150`}
          style={{ border: `2px solid ${conf.color}`, color: conf.color }}
        />
      )}
      
    </div>
  );
});


