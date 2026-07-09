import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, ShieldCheck, Package, Clock, Save, RotateCcw, Timer,
  Loader2, CheckCircle2, Trash2, Plus, Search,
  ChevronLeft, AlertTriangle, Globe,
  Download, Wifi, Pencil, Star,
} from "lucide-react";
import { useLocation } from "wouter";

type Tab = "rules" | "plans";

export interface PlanItem {
  id: string;
  name: string;
  speed: string;
  price: number;
  description?: string;
  featured?: boolean;
  sgpId?: number;
}

// Bruno 2026-06-11: planos por CIDADE. O agente confirma a cobertura batendo a
// cidade/CEP que o cliente informa contra nome OFICIAL + apelidos + CEPs aqui
// cadastrados (ex: Nekt — oficial "Senador José Porfírio", apelido "Souzel").
// Cada cidade tem seus próprios planos; se `items` vazio, o agente usa os planos
// padrão (plans.items). Sem cidades cadastradas, o comportamento atual é mantido.
export interface CityPlans {
  id: string;
  name: string;          // nome oficial da cidade
  aliases: string[];     // apelidos / como é conhecida na região
  ceps: string[];        // CEPs ou prefixos de CEP atendidos
  erpId?: number;        // Bruno 2026-06-11: conexão de ERP que atende esta cidade (multi-ERP)
  items: PlanItem[];     // planos desta cidade (vazio = usa os planos padrão)
}

export interface HumanizeRules {
  coalescenceWindowMs?: number;
  coalescenceMaxMs?: number;
  burstGapMs?: number;
  burstExtensionMs?: number;
  mediaFlushMs?: number;
  turnCloseFlushMs?: number;
  abortOnClientTyping?: boolean;
}

export interface BusinessRules {
  suspendedToFinance: boolean;
  allowDepartmentSwitch: boolean;
  confidenceThreshold: number;
  responseDelay: number;
  showOnlyOverdueIfSuspended: boolean;
  allowPix: boolean;
  allowBarcode: boolean;
  allowTrustUnlock: boolean;
  allowAutoOpenTicket: boolean;
  requireRebootStep: boolean;
  faqAiCompose?: 'off' | 'sintese' | 'sintese+fallback';
  humanize?: HumanizeRules;
  // Fase B — Consolidação 9→3 camadas (Bruno, 2026-05-03). Quando ON, o engine
  // usa preflightInterceptors (humano + botão dept + coleta determinística)
  // antes de chamar o LLM. Quando intercepta, pula o orchestrator e ganha
  // ~500-1500ms + custo zero. Default OFF (caminho legado preservado).
  useUnifiedClassifier?: boolean;
}

interface TimeSlot {
  start: string;
  end: string;
}

interface ServiceHours {
  enabled: boolean;
  timezone: string;
  weekdays: TimeSlot;
  saturday?: TimeSlot;
  sunday?: TimeSlot;
}

export interface SettingsData {
  businessRules: BusinessRules;
  plans: { enabled: boolean; items: PlanItem[]; cities?: CityPlans[] };
  serviceHours: ServiceHours;
}


const STATIC_TAB_CONFIG: { key: Tab; label: string; icon: typeof Settings; desc: string }[] = [
  { key: "rules", label: "Regras de Negócio", icon: ShieldCheck, desc: "Comportamento do bot e regras operacionais" },
  { key: "plans", label: "Planos Comerciais", icon: Package, desc: "Planos disponíveis para venda" },
];

// Bruno 2026-06-02: removidos da UI os toggles decorativos (motor V2 não lê,
// comportamento fica chumbado no código): suspendedToFinance,
// showOnlyOverdueIfSuspended, requireRebootStep, useUnifiedClassifier. Os
// campos seguem no tipo/banco/validação — só não são mais editáveis na tela.
const RULE_ITEMS: { key: keyof BusinessRules; label: string; desc: string }[] = [
  { key: "allowDepartmentSwitch", label: "Permitir troca de departamento", desc: "Permite que o cliente solicite transferência entre departamentos durante o atendimento" },
  { key: "allowPix", label: "Permitir PIX", desc: "Habilita envio de chave PIX como opção de pagamento" },
  { key: "allowBarcode", label: "Permitir Código de Barras", desc: "Habilita envio de código de barras do boleto" },
  { key: "allowTrustUnlock", label: "Permitir Desbloqueio por Confiança", desc: "Permite desbloqueio temporário do serviço antes do pagamento ser confirmado" },
  { key: "allowAutoOpenTicket", label: "Abrir chamado automático", desc: "Permite ao atendimento automático abrir um chamado/tarefa quando o caso exige acompanhamento. Se desligado, escala para um humano em vez de abrir." },
];

export default function AdminTenantSettings() {
  const params = useParams<{ tenantId: string }>();
  const userStr = localStorage.getItem("flowcrm_user");
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const tenantId = params?.tenantId || currentUser?.workspaceId || "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("rules");
  const [localSettings, setLocalSettings] = useState<SettingsData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const { data, isLoading, error } = useQuery<{ ok: boolean; data: { settings: SettingsData } }>({
    queryKey: ["/api/admin/tenant-settings", tenantId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/tenant-settings/${tenantId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("flowcrm_token")}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar configuracoes");
      return res.json();
    },
    enabled: !!tenantId,
  });

  useEffect(() => {
    if (data?.data?.settings && !dirty) {
      setLocalSettings(JSON.parse(JSON.stringify(data.data.settings)));
    }
  }, [data?.data?.settings]);

  const saveSettings = async (settingsToSave: SettingsData) => {
    const res = await fetch(`/api/admin/tenant-settings/${tenantId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("flowcrm_token")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settingsToSave),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json.validationErrors
        ? json.validationErrors.map((e: any) => `${e.field}: ${e.message}`).join("\n")
        : json.error;
      throw new Error(msg);
    }
    return json;
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!localSettings) return;
      return saveSettings(localSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenant-settings", tenantId] });
      setDirty(false);
      toast({ title: "Configurações salvas", description: "Alterações aplicadas com sucesso" });
    },
    onError: (err: Error) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/tenant-settings/${tenantId}/reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("flowcrm_token")}` },
      });
      if (!res.ok) throw new Error("Falha ao resetar");
      return res.json();
    },
    onSuccess: (json) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenant-settings", tenantId] });
      setLocalSettings(JSON.parse(JSON.stringify(json.data.settings)));
      setDirty(false);
      setConfirmReset(false);
      toast({ title: "Padrão restaurado", description: "Configurações voltaram ao padrão do sistema" });
    },
    onError: () => {
      toast({ title: "Erro ao resetar", variant: "destructive" });
    },
  });

  const updateRule = useCallback((key: keyof BusinessRules, value: any) => {
    if (!localSettings) return;
    setLocalSettings(prev => prev ? {
      ...prev,
      businessRules: { ...prev.businessRules, [key]: value },
    } : prev);
    setDirty(true);
  }, [localSettings]);

  const updateHumanize = useCallback((key: keyof HumanizeRules, value: boolean | number) => {
    if (!localSettings) return;
    setLocalSettings(prev => prev ? {
      ...prev,
      businessRules: {
        ...prev.businessRules,
        humanize: { ...(prev.businessRules.humanize || {}), [key]: value },
      },
    } : prev);
    setDirty(true);
  }, [localSettings]);

  const updateHours = useCallback((field: string, value: any) => {
    if (!localSettings) return;
    setLocalSettings(prev => {
      if (!prev) return prev;
      const sh = { ...prev.serviceHours };
      if (field === "enabled") sh.enabled = value;
      else if (field === "timezone") sh.timezone = value;
      else {
        const [day, slot] = field.split(".");
        const dayKey = day as "weekdays" | "saturday" | "sunday";
        const slotKey = slot as "start" | "end";
        sh[dayKey] = { ...(sh[dayKey] || { start: "", end: "" }), [slotKey]: value };
      }
      return { ...prev, serviceHours: sh };
    });
    setDirty(true);
  }, [localSettings]);


  const importSGPPlans = async (selected: PlanItem[]) => {
    if (!localSettings) return;
    const updated = { ...localSettings, plans: { ...localSettings.plans, items: selected } };
    setLocalSettings(updated);
    try {
      await saveSettings(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tenant-settings", tenantId] });
      setDirty(false);
      toast({ title: `${selected.length} plano(s) salvos com sucesso` });
    } catch (err: any) {
      toast({ title: "Erro ao salvar planos", description: err.message, variant: "destructive" });
      setDirty(true);
    }
  };

  const togglePlansEnabled = (val: boolean) => {
    if (!localSettings) return;
    setLocalSettings(prev => prev ? { ...prev, plans: { ...prev.plans, enabled: val } } : prev);
    setDirty(true);
  };

  if (!tenantId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Tenant ID não informado</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background" data-testid="page-tenant-settings">
      <div className="border-b px-6 py-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate" data-testid="text-page-title">Central de Configuração</h1>
            <p className="text-xs text-muted-foreground font-mono truncate" data-testid="text-tenant-id">{tenantId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-[10px]">Alterações pendentes</Badge>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmReset(true)}
            disabled={saveMut.isPending || resetMut.isPending}
            data-testid="button-reset"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Restaurar Padrão
          </Button>
          <Button
            size="sm"
            onClick={() => saveMut.mutate()}
            disabled={!dirty || saveMut.isPending}
            data-testid="button-save"
          >
            {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            Salvar Alterações
          </Button>
        </div>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="border-b px-4 flex items-center gap-1 overflow-x-auto shrink-0" data-testid="nav-tabs">
          {STATIC_TAB_CONFIG.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`seg-tab ${active ? "seg-tab-active" : ""}`}
                data-testid={`tab-${t.key}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && <LoadingSkeleton />}
          {error && (
            <Card className="border-destructive/30">
              <CardContent className="py-8 text-center">
                <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-3" />
                <p className="text-sm text-destructive">Erro ao carregar configurações</p>
              </CardContent>
            </Card>
          )}
          {localSettings && !isLoading && (
            <>
              {tab === "rules" && <RulesTab rules={localSettings.businessRules} onUpdate={updateRule} onUpdateHumanize={updateHumanize} />}
              {tab === "plans" && (
                <PlansTab
                  plans={localSettings.plans}
                  onToggle={togglePlansEnabled}
                  onImportSGP={importSGPPlans}
                  tenantId={tenantId}
                />
              )}

            </>
          )}
        </div>
      </div>


      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Restaurar Padrao</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Isso vai apagar todas as configurações personalizadas e restaurar os valores padrão do sistema. Essa ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)} data-testid="button-reset-cancel">Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
              data-testid="button-reset-confirm"
            >
              {resetMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
              Confirmar Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

export function RulesTab({ rules, onUpdate, onUpdateHumanize }: {
  rules: BusinessRules;
  onUpdate: (key: keyof BusinessRules, val: any) => void;
  onUpdateHumanize?: (key: keyof HumanizeRules, val: boolean | number) => void;
}) {
  const humanize = rules.humanize || {};
  const msToSec = (ms: number | undefined, def: number) => Math.round((ms ?? def) / 1000);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/[0.08] ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-4 h-4 text-primary" strokeWidth={2} />
        </div>
        <div className="leading-tight">
          <h2 className="text-[14px] font-semibold tracking-tight" data-testid="text-rules-title">Regras de Negócio</h2>
          <p className="text-[11px] text-muted-foreground/80">Comportamento automático do atendimento</p>
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="divide-y divide-border/50 p-0">
          {RULE_ITEMS.map(item => (
            <div key={item.key} className="group flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-muted/30">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium tracking-tight">{item.label}</div>
                <div className="text-[11px] text-muted-foreground/85 leading-snug mt-0.5">{item.desc}</div>
              </div>
              <Switch
                checked={!!rules[item.key]}
                onCheckedChange={v => onUpdate(item.key, v)}
                data-testid={`switch-rule-${item.key}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="w-4 h-4 text-base-content/60" />
              <span className="text-[13px] font-semibold">Delay de Resposta</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">Tempo em segundos que o bot aguarda antes de responder.</p>
          </div>
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={30}
                step={1}
                value={rules.responseDelay ?? 10}
                onChange={e => onUpdate("responseDelay", Math.max(0, Math.min(30, parseInt(e.target.value) || 0)))}
                className="w-20 text-center font-mono"
                data-testid="input-response-delay"
              />
              <span className="text-xs text-muted-foreground">seg</span>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <div className="flex-1 h-2 rounded-full bg-base-200 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    (rules.responseDelay ?? 10) < 5 ? "bg-error" : (rules.responseDelay ?? 10) < 15 ? "bg-success" : "bg-warning"
                  }`}
                  style={{ width: `${Math.min(Math.max((rules.responseDelay ?? 10) / 30, 0), 1) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">{rules.responseDelay ?? 10}s</span>
            </div>
          </div>
        </div>
      </Card>

      {onUpdateHumanize && (
        <Card className="p-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="w-4 h-4 text-base-content/60" />
                <span className="text-[13px] font-semibold">Humanização e Buffer de Mensagens</span>
              </div>
              <p className="text-[12px] text-base-content/55 leading-relaxed">
                Controla como o bot agrupa mensagens fragmentadas do cliente e evita responder em duplicidade. Valores em segundos.
              </p>
            </div>
            <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium">Janela de agrupamento</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Tempo padrão que o bot espera após cada mensagem pra ver se o cliente mandou mais.
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    type="number"
                    min={2}
                    max={30}
                    step={1}
                    value={msToSec(humanize.coalescenceWindowMs, 6000)}
                    onChange={e => onUpdateHumanize("coalescenceWindowMs", clamp(parseInt(e.target.value) || 6, 2, 30) * 1000)}
                    className="w-20 text-center font-mono"
                    data-testid="input-humanize-window"
                  />
                  <span className="text-xs text-muted-foreground">seg</span>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Teto máximo</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Limite duro de espera, mesmo que o cliente continue digitando.
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    type="number"
                    min={5}
                    max={60}
                    step={1}
                    value={msToSec(humanize.coalescenceMaxMs, 15000)}
                    onChange={e => onUpdateHumanize("coalescenceMaxMs", clamp(parseInt(e.target.value) || 15, 5, 60) * 1000)}
                    className="w-20 text-center font-mono"
                    data-testid="input-humanize-max"
                  />
                  <span className="text-xs text-muted-foreground">seg</span>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Gap de rajada</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Se o intervalo entre duas mensagens for menor que isso, o bot assume que vem mais e estende a espera.
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    type="number"
                    min={500}
                    max={5000}
                    step={100}
                    value={humanize.burstGapMs ?? 1500}
                    onChange={e => onUpdateHumanize("burstGapMs", clamp(parseInt(e.target.value) || 1500, 500, 5000))}
                    className="w-24 text-center font-mono"
                    data-testid="input-humanize-burst-gap"
                  />
                  <span className="text-xs text-muted-foreground">ms</span>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Extensão da rajada</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Quanto tempo a mais esperar ao detectar rajada.
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    type="number"
                    min={1000}
                    max={10000}
                    step={500}
                    value={humanize.burstExtensionMs ?? 4000}
                    onChange={e => onUpdateHumanize("burstExtensionMs", clamp(parseInt(e.target.value) || 4000, 1000, 10000))}
                    className="w-24 text-center font-mono"
                    data-testid="input-humanize-burst-ext"
                  />
                  <span className="text-xs text-muted-foreground">ms</span>
                </div>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 pt-3 border-t">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Cancelar resposta se cliente voltar a digitar</div>
                <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  Quando ativo, se uma nova mensagem chegar enquanto o bot ainda está processando, a resposta em voo é
                  cancelada e o bot responde uma única vez com o contexto completo. <b>Recomendado.</b>
                </div>
              </div>
              <Switch
                checked={humanize.abortOnClientTyping !== false}
                onCheckedChange={v => onUpdateHumanize("abortOnClientTyping", v)}
                data-testid="switch-abort-on-typing"
              />
            </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// Bruno 2026-05-27: PlansTab reescrito sem vínculo SGP.
// Antes: aba "Indisponíveis" carregava planos do SGP via /api/isp/erp/plans,
// que retornava lixo pra tenants sem catálogo configurado (Conexao Net via
// 16 planos "** R$ 0,00/mês"). Agora: CRUD manual puro contra
// tenant_settings.plans.items. Bot lê SOMENTE dessa fonte (handleC8 ajustado
// pra loadTenantPlansRaw em vez de getTenantPlans). Aba "Indisponíveis"
// removida. Prop `onImportSGP` mantida na assinatura por compat com callers
// (isp-prompts.tsx, admin-tenant-settings.tsx) — mas agora chamada onSave.
export function PlansTab({ plans, onToggle, onImportSGP }: {
  plans: { enabled: boolean; items: PlanItem[]; cities?: CityPlans[] };
  onToggle: (v: boolean) => void;
  onImportSGP: (updated: PlanItem[]) => Promise<void> | void;
  tenantId?: string;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<PlanItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const onSave = onImportSGP;

  const extractSpeed = (desc: string) => {
    const match = desc.match(/(\d+)\s*(mega|mbps|mb|giga|gbps|gb)/i);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      if (unit.startsWith('g')) return `${val}Gbps`;
      return `${val}Mbps`;
    }
    return "";
  };

  const openNewPlan = () => {
    setEditingPlan({
      id: `plan-${Date.now()}`,
      name: "",
      speed: "",
      price: 0,
      description: "",
      featured: false,
    });
    setDialogOpen(true);
  };

  const openEditPlan = (plan: PlanItem) => {
    setEditingPlan({ ...plan });
    setDialogOpen(true);
  };

  const savePlan = async () => {
    if (!editingPlan) return;
    const name = (editingPlan.name || "").trim();
    if (!name) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do plano", variant: "destructive" });
      return;
    }
    if (!editingPlan.price || editingPlan.price <= 0) {
      toast({ title: "Preço inválido", description: "Informe o valor mensal", variant: "destructive" });
      return;
    }
    const exists = plans.items.find(p => p.id === editingPlan.id);
    const updated = exists
      ? plans.items.map(p => p.id === editingPlan.id ? editingPlan : p)
      : [...plans.items, editingPlan];
    setSaving(true);
    try {
      await onSave(updated);
      toast({ title: exists ? "Plano atualizado" : "Plano adicionado", description: name });
      setDialogOpen(false);
      setEditingPlan(null);
    } finally {
      setSaving(false);
    }
  };

  const removePlan = async (planId: string) => {
    const updated = plans.items.filter(p => p.id !== planId);
    setRemovingId(planId);
    try {
      await onSave(updated);
      toast({ title: "Plano removido" });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-0 w-full">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-border/60 gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/[0.08] ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0">
            <Package className="w-4 h-4 text-primary" strokeWidth={2} />
          </div>
          <div className="leading-tight">
            <h2 className="text-[14px] font-semibold tracking-tight" data-testid="text-plans-title">Planos Comerciais</h2>
            <p className="text-[11px] text-muted-foreground/80">Planos que o bot pode oferecer aos clientes</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-muted-foreground font-medium">Módulo ativo</span>
          <Switch checked={plans.enabled} onCheckedChange={onToggle} data-testid="switch-plans-enabled" />
        </div>
      </div>

      {!plans.enabled && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="w-12 h-12 text-muted-foreground/20 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">Módulo de planos desativado</p>
          <p className="text-xs text-muted-foreground mt-1">Ative o módulo acima para gerenciar planos comerciais</p>
        </div>
      )}

      {plans.enabled && (
        <div className="pt-4 space-y-4">
          {/* ── Toolbar: adicionar ─────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {plans.items.length === 0
                ? "Nenhum plano cadastrado ainda"
                : `${plans.items.length} plano${plans.items.length === 1 ? '' : 's'} ativo${plans.items.length === 1 ? '' : 's'}`}
            </div>
            <Button size="sm" onClick={openNewPlan} data-testid="button-new-plan" className="gap-1.5 h-8 text-xs">
              <Plus className="w-3.5 h-3.5" /> Novo plano
            </Button>
          </div>

          {/* ── Lista de planos ────────────────────────────────── */}
          {plans.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Package className="w-12 h-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">Nenhum plano cadastrado</p>
              <p className="text-xs text-muted-foreground mt-1 mb-5">Cadastre os planos que o bot vai oferecer aos clientes no fluxo de vendas</p>
              <Button size="sm" onClick={openNewPlan} data-testid="button-add-first-plan">
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Cadastrar primeiro plano
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border border border-border rounded-box overflow-hidden">
              {plans.items.map((plan) => {
                const speed = plan.speed || extractSpeed(plan.name);
                const isRemoving = removingId === plan.id;
                return (
                  <div key={plan.id} className="flex items-center gap-4 px-5 py-4 bg-card hover:bg-muted/30 transition-colors group" data-testid={`card-plan-available-${plan.id}`}>
                    <div className="w-8 h-8 rounded-lg bg-primary/12 flex items-center justify-center shrink-0">
                      {plan.featured ? <Star className="w-4 h-4 text-primary fill-primary" /> : <CheckCircle2 className="w-4 h-4 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold leading-snug flex items-center gap-2">
                        {plan.name}
                        {plan.featured && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">Destaque</Badge>}
                      </div>
                      {speed && <div className="text-xs text-muted-foreground mt-0.5">{speed}</div>}
                      {plan.description && <div className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-2">{plan.description}</div>}
                    </div>
                    <div className="text-right shrink-0 mr-2">
                      <div className="text-base font-bold text-primary">R$ {plan.price.toFixed(2).replace(".", ",")}</div>
                      <div className="text-[10px] text-muted-foreground">/mês</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all"
                      onClick={() => openEditPlan(plan)}
                      data-testid={`button-edit-plan-${plan.id}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      onClick={() => removePlan(plan.id)}
                      disabled={isRemoving}
                      data-testid={`button-remove-plan-${plan.id}`}
                    >
                      {isRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modal: criar / editar plano ───────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingPlan(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPlan && plans.items.find(p => p.id === editingPlan.id) ? "Editar plano" : "Novo plano"}</DialogTitle>
          </DialogHeader>
          {editingPlan && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome do plano *</label>
                <Input
                  value={editingPlan.name}
                  onChange={e => setEditingPlan({ ...editingPlan, name: e.target.value })}
                  placeholder="Ex: Plano Essencial"
                  data-testid="input-plan-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Velocidade</label>
                  <Input
                    value={editingPlan.speed}
                    onChange={e => setEditingPlan({ ...editingPlan, speed: e.target.value })}
                    placeholder="Ex: 600Mbps"
                    data-testid="input-plan-speed"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Preço mensal (R$) *</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editingPlan.price || ''}
                    onChange={e => setEditingPlan({ ...editingPlan, price: parseFloat(e.target.value) || 0 })}
                    placeholder="120.00"
                    data-testid="input-plan-price"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Descrição (opcional)</label>
                <Textarea
                  value={editingPlan.description || ''}
                  onChange={e => setEditingPlan({ ...editingPlan, description: e.target.value })}
                  placeholder="Detalhes adicionais (benefícios, condições, etc)"
                  rows={2}
                  data-testid="input-plan-description"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Star className={`w-4 h-4 ${editingPlan.featured ? 'text-primary fill-primary' : 'text-muted-foreground'}`} />
                  <div className="text-xs">
                    <div className="font-medium">Plano em destaque</div>
                    <div className="text-muted-foreground/80 text-[10px]">Aparece primeiro na lista do bot</div>
                  </div>
                </div>
                <Switch
                  checked={!!editingPlan.featured}
                  onCheckedChange={v => setEditingPlan({ ...editingPlan, featured: v })}
                  data-testid="switch-plan-featured"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditingPlan(null); }} data-testid="button-cancel-plan">
              Cancelar
            </Button>
            <Button onClick={savePlan} disabled={saving} data-testid="button-save-plan">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HoursTab({ hours, onUpdate }: { hours: ServiceHours; onUpdate: (field: string, value: any) => void }) {
  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2" data-testid="text-hours-title">
            <Clock className="w-5 h-5 text-primary" />
            Horario de Atendimento
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Configure os horarios de funcionamento do atendimento automatico</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Controle ativo</span>
          <Switch checked={hours.enabled} onCheckedChange={v => onUpdate("enabled", v)} data-testid="switch-hours-enabled" />
        </div>
      </div>

      {hours.enabled && (
        <>
          <Card>
            <CardContent className="px-5 py-4">
              <div className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Timezone</label>
                  <Select value={hours.timezone || "America/Sao_Paulo"} onValueChange={(v) => onUpdate("timezone", v)}>
                    <SelectTrigger className="font-mono text-sm" data-testid="select-timezone">
                      <SelectValue placeholder="Selecione o fuso horário" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Sao_Paulo">America/Sao_Paulo (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Fortaleza">America/Fortaleza (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Recife">America/Recife (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Bahia">America/Bahia (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Belem">America/Belem (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Maceio">America/Maceio (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Araguaina">America/Araguaina (BRT, GMT-3)</SelectItem>
                      <SelectItem value="America/Manaus">America/Manaus (AMT, GMT-4)</SelectItem>
                      <SelectItem value="America/Porto_Velho">America/Porto_Velho (AMT, GMT-4)</SelectItem>
                      <SelectItem value="America/Boa_Vista">America/Boa_Vista (AMT, GMT-4)</SelectItem>
                      <SelectItem value="America/Cuiaba">America/Cuiaba (AMT, GMT-4)</SelectItem>
                      <SelectItem value="America/Campo_Grande">America/Campo_Grande (AMT, GMT-4)</SelectItem>
                      <SelectItem value="America/Rio_Branco">America/Rio_Branco (ACT, GMT-5)</SelectItem>
                      <SelectItem value="America/Eirunepe">America/Eirunepe (ACT, GMT-5)</SelectItem>
                      <SelectItem value="America/Noronha">America/Noronha (FNT, GMT-2)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 px-5 pt-4">
              <CardTitle className="text-sm">Expediente</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-4">
              <TimeRow label="Segunda a Sexta" fieldPrefix="weekdays" slot={hours.weekdays} onUpdate={onUpdate} testPrefix="weekdays" />
              <TimeRow label="Sabado" fieldPrefix="saturday" slot={hours.saturday || { start: "", end: "" }} onUpdate={onUpdate} testPrefix="saturday" />
              <TimeRow label="Domingo" fieldPrefix="sunday" slot={hours.sunday || { start: "", end: "" }} onUpdate={onUpdate} testPrefix="sunday" />
            </CardContent>
          </Card>
        </>
      )}

      {!hours.enabled && (
        <Card>
          <CardContent className="py-10 text-center">
            <Clock className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Controle de horario desativado</p>
            <p className="text-xs text-muted-foreground mt-1">O bot atendera 24/7 sem restricao de horario</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TimeRow({ label, fieldPrefix, slot, onUpdate, testPrefix }: {
  label: string;
  fieldPrefix: string;
  slot: TimeSlot;
  onUpdate: (field: string, value: string) => void;
  testPrefix: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-sm w-36 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1">
        <Input
          type="time"
          value={slot.start}
          onChange={e => onUpdate(`${fieldPrefix}.start`, e.target.value)}
          className="font-mono text-sm w-32"
          data-testid={`input-${testPrefix}-start`}
        />
        <span className="text-muted-foreground text-xs">ate</span>
        <Input
          type="time"
          value={slot.end}
          onChange={e => onUpdate(`${fieldPrefix}.end`, e.target.value)}
          className="font-mono text-sm w-32"
          data-testid={`input-${testPrefix}-end`}
        />
      </div>
    </div>
  );
}


function LoadingSkeleton() {
  return (
    <div className="space-y-4 w-full">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-4">
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-80" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
