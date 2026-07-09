import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Users,
  Crown,
  Save,
  Trash2,
  Globe,
  ImagePlus,
  Clock,
  Loader2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TabUsuariosEquipes,
  TabPermissoes,
  type UserRow,
  type TeamRow,
  type PermRow,
} from "@/pages/usuarios";

type WorkspaceSubTab = "empresa" | "usuarios-equipes" | "horario" | "permissoes";

const WORKSPACE_SUBS: { key: WorkspaceSubTab; label: string; icon: typeof Building2 }[] = [
  { key: "empresa", label: "Empresa", icon: Building2 },
  { key: "usuarios-equipes", label: "Usuários e Equipes", icon: Users },
  { key: "horario", label: "Horário de Atendimento", icon: Clock },
  { key: "permissoes", label: "Permissões", icon: Crown },
];

function getTabFromSearch(search: string): WorkspaceSubTab {
  try {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    if (t === "usuarios-equipes" || t === "horario" || t === "permissoes" || t === "empresa") return t;
  } catch {}
  return "empresa";
}

export default function WorkspacePage() {
  const [location] = useLocation();
  const [subTab, setSubTab] = useState<WorkspaceSubTab>(() => getTabFromSearch(window.location.search));
  const { toast } = useToast();

  useEffect(() => {
    const t = getTabFromSearch(window.location.search);
    setSubTab(t);
  }, [location]);

  const { data: userData, isLoading: profileLoading } = useQuery<{ ok: boolean; data: any }>({
    queryKey: ["/api/perfil/me"],
  });
  const { data: usersResp, isLoading: usersLoading } = useQuery<{ ok: boolean; data: UserRow[] }>({
    queryKey: ["/api/usuarios"],
  });
  const { data: limitResp } = useQuery<{ ok: boolean; data: { used: number; limit: number; plano: string; nextPlano: string | null } }>({
    queryKey: ["/api/usuarios/limit"],
  });
  const { data: teamsResp, isLoading: teamsLoading } = useQuery<{ ok: boolean; data: TeamRow[] }>({
    queryKey: ["/api/equipes"],
  });
  const { data: permsResp } = useQuery<{ ok: boolean; data: Record<string, PermRow> }>({
    queryKey: ["/api/permissoes"],
  });

  const users = usersResp?.data || [];
  const limit = limitResp?.data || { used: 0, limit: 10, plano: "Business", nextPlano: "Enterprise" };
  const teamsList = teamsResp?.data || [];
  const permsMap = permsResp?.data || {};

  return (
    <div className="h-full flex flex-col" data-testid="page-workspace">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-field bg-primary flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-primary-content" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight" data-testid="text-workspace-title">Workspace</h1>
            <p className="text-[11px] text-muted-foreground">Gerencie sua empresa, equipe, permissões e performance</p>
          </div>
        </div>
      </div>

      <div className="px-5 border-b flex gap-0.5 flex-shrink-0">
        {WORKSPACE_SUBS.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`seg-tab ${active ? "seg-tab-active" : ""}`}
              data-testid={`tab-workspace-${t.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {subTab === "empresa" && (
          <EmpresaContent
            userData={userData}
            isLoading={profileLoading}
            toast={toast}
          />
        )}
        {subTab === "usuarios-equipes" && (
          <TabUsuariosEquipes
            users={users}
            loading={usersLoading}
            limit={limit}
            teams={teamsList}
            teamsLoading={teamsLoading}
            toast={toast}
          />
        )}
        {subTab === "horario" && (
          <HorarioAtendimentoTab toast={toast} />
        )}
        {subTab === "permissoes" && (
          <TabPermissoes perms={permsMap} toast={toast} />
        )}
      </div>
    </div>
  );
}

function EmpresaContent({
  toast,
}: {
  userData?: any;
  isLoading?: boolean;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [tamanho, setTamanho] = useState("");
  const [logo, setLogo] = useState("");
  const [razaoSocial, setRazaoSocial] = useState("");
  const [assinantes, setAssinantes] = useState("");

  const { data: wsData, isLoading } = useQuery<{ ok: boolean; data: any }>({
    queryKey: ["/api/workspace/empresa"],
  });

  useEffect(() => {
    if (wsData?.data) {
      const d = wsData.data;
      setNome(d.nome || "");
      setCnpj(d.cnpj || "");
      setTamanho(d.tamanho || "6-20");
      setLogo(d.logo || "");
      setRazaoSocial(d.razaoSocial || "");
      setAssinantes(d.assinantes || "ate-500");
    }
  }, [wsData]);

  const saveWorkspace = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/workspace/empresa", {
        nome, cnpj, setor: "provedor", tamanho, logo, razaoSocial, assinantes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/empresa"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Dados da empresa salvos com sucesso" });
    },
    onError: (e: Error) => {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    },
  });

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Selecione uma imagem (PNG, JPG, SVG)", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Máximo 5MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("flowcrm_token");
      const resp = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await resp.json();
      if (result.ok && result.url) {
        setLogo(result.url);
        const saveRes = await apiRequest("PUT", "/api/workspace/empresa", { logo: result.url });
        await saveRes.json();
        queryClient.invalidateQueries({ queryKey: ["/api/workspace/empresa"] });
        toast({ title: "Logo atualizado com sucesso" });
      } else {
        toast({ title: "Erro no upload", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Erro no upload", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    setLogo("");
    try {
      await apiRequest("PUT", "/api/workspace/empresa", { logo: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/empresa"] });
      toast({ title: "Logo removido" });
    } catch {}
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-4">
        <Skeleton className="h-32 w-full rounded-box" />
        <Skeleton className="h-64 w-full rounded-box" />
      </div>
    );
  }

  const initials = nome ? nome.substring(0, 2).toUpperCase() : "NG";

  return (
    <div className="p-5 space-y-5">
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={fileInputRef}
        data-testid="input-logo-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleLogoUpload(f);
          e.target.value = "";
        }}
      />

      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <ImagePlus className="w-4 h-4 text-base-content/60" />
              <span className="text-[13px] font-semibold">Logo da Empresa</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">Personalize a identidade visual da sua empresa no CRM.</p>
          </div>
          <div className="lg:col-span-2 flex items-center gap-4 flex-wrap">
            {logo ? (
              <img src={logo} alt="Logo" className="w-14 h-14 rounded-box object-cover border border-border bg-white" />
            ) : (
              <div className="w-14 h-14 rounded-box bg-primary text-primary-foreground text-lg font-bold flex items-center justify-center">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <span className="font-bold text-[13px] block">{nome || "Sua Empresa"}</span>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">{razaoSocial || ""}</span>
            </div>
            <div className="flex gap-1.5 ml-auto">
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-logo"
              >
                <ImagePlus className="w-3.5 h-3.5 mr-1.5" /> {uploading ? "Enviando..." : "Alterar logo"}
              </Button>
              {logo && (
                <Button size="sm" variant="outline" className="text-destructive" onClick={removeLogo} data-testid="button-remove-logo">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4 text-base-content/60" />
              <span className="text-[13px] font-semibold">Dados da Empresa</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">Informações cadastrais e porte da sua empresa.</p>
            <Button
              size="sm"
              onClick={() => saveWorkspace.mutate()}
              disabled={saveWorkspace.isPending}
              className="mt-3"
              data-testid="button-save-workspace"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saveWorkspace.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input label="Nome fantasia *" value={nome} onChange={(e) => setNome(e.target.value)} data-testid="input-company-name" />
            </div>
            <div>
              <Input label="Razão social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} data-testid="input-razao-social" />
            </div>
            <div>
              <Input label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} data-testid="input-cnpj" />
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Porte da empresa</Label>
              <Select value={tamanho || "6-20"} onValueChange={setTamanho}>
                <SelectTrigger className="mt-1.5" data-testid="select-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1-5">1 a 5 colaboradores</SelectItem>
                  <SelectItem value="6-20">6 a 20 colaboradores</SelectItem>
                  <SelectItem value="21-50">21 a 50 colaboradores</SelectItem>
                  <SelectItem value="51-200">51 a 200 colaboradores</SelectItem>
                  <SelectItem value="200+">200+ colaboradores</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Base de clientes</Label>
              <Select value={assinantes || "ate-500"} onValueChange={setAssinantes}>
                <SelectTrigger className="mt-1.5" data-testid="select-subscribers">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ate-500">Até 500 clientes</SelectItem>
                  <SelectItem value="500-2000">500 a 2.000 clientes</SelectItem>
                  <SelectItem value="2000-5000">2.000 a 5.000 clientes</SelectItem>
                  <SelectItem value="5000-15000">5.000 a 15.000 clientes</SelectItem>
                  <SelectItem value="15000+">15.000+ clientes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      <ContractModelCard />
    </div>
  );
}

interface ContractModelRules {
  tem_fidelidade: boolean | null;
  meses: number | null;
  base_calculo_multa:
    | "meses_restantes"
    | "dias_restantes"
    | "valor_beneficio_proporcional"
    | "instalacao_proporcional"
    | "multa_fixa"
    | "nao_ha"
    | null;
  regra_multa_texto: string | null;
  multa_fixa_valor: number | null;
  valor_beneficio_total: number | null;
  carencia_dias: number | null;
  excecoes: string[];
  taxa_cancelamento_fixa: number | null;
  clausula_multa_exata: string | null;
  beneficios_listados: string[];
}

interface ContractModel {
  uploadedAt: string;
  fileName: string;
  uploadUrl: string;
  parseStatus: "ok" | "pending" | "error";
  rawSnippet?: string;
  rules: ContractModelRules;
  reviewedByHuman: boolean;
}

const EMPTY_RULES: ContractModelRules = {
  tem_fidelidade: null,
  meses: null,
  base_calculo_multa: null,
  regra_multa_texto: null,
  multa_fixa_valor: null,
  valor_beneficio_total: null,
  carencia_dias: null,
  excecoes: [],
  taxa_cancelamento_fixa: null,
  clausula_multa_exata: null,
  beneficios_listados: [],
};

const EXCECAO_OPTIONS: { value: string; label: string }[] = [
  { value: "morte_titular", label: "Morte do titular" },
  { value: "mudanca_sem_cobertura", label: "Mudança p/ área sem cobertura" },
  { value: "culpa_isp", label: "Rescisão por culpa do provedor" },
  { value: "outras", label: "Outras" },
];

function ContractModelCard() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: currentModel, refetch } = useQuery<any>({
    queryKey: ["/api/workspace/contract-model"],
  });
  const current: ContractModel | null = currentModel?.data || null;

  const [draft, setDraft] = useState<ContractModel | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const showDraft = draft || current;

  async function handleFile(file: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Apenas PDFs", description: "Envie o contrato em PDF digital (não escaneado).", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("token") || "";
      const res = await fetch("/api/workspace/contract-model/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error(payload.error || "Falha no upload");
      setDraft(payload.data);
      toast({ title: "PDF analisado!", description: "Revise os campos extraídos e salve." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/workspace/contract-model", draft);
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "Falha ao salvar");
      setDraft(null);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/contract-model"] });
      toast({ title: "Modelo de contrato salvo!", description: "A IA usa essas regras como referência no atendimento." });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Remover o modelo de contrato atual?")) return;
    try {
      await apiRequest("DELETE", "/api/workspace/contract-model");
      setDraft(null);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/workspace/contract-model"] });
      toast({ title: "Modelo removido" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  }

  function updateRules(patch: Partial<ContractModelRules>) {
    if (!draft) return;
    setDraft({ ...draft, rules: { ...draft.rules, ...patch } });
  }

  function toggleExcecao(value: string) {
    if (!draft) return;
    const cur = draft.rules.excecoes || [];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    updateRules({ excecoes: next });
  }

  const rules = showDraft?.rules || EMPTY_RULES;
  const isDraft = !!draft;

  return (
    <Card className="p-5 md:p-7">
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-[15px] font-bold">Modelo de Contrato</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-1">
            Faça upload do modelo padrão do seu contrato. A IA extrai as principais cláusulas (fidelidade, multa e exceções) pra usar como referência no atendimento.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            data-testid="contract-model-file-input"
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            data-testid="btn-upload-contract"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <ImagePlus className="w-4 h-4 mr-1.5" />}
            {uploading ? "Analisando..." : current ? "Trocar PDF" : "Enviar PDF"}
          </Button>
          {current && !isDraft && (
            <Button variant="ghost" onClick={handleDelete} className="text-destructive">
              <Trash2 className="w-4 h-4 mr-1.5" /> Remover
            </Button>
          )}
        </div>
      </div>

      {!showDraft && (
        <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
          Nenhum modelo de contrato enviado.
        </div>
      )}

      {showDraft && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2">
            <span className="font-mono">{showDraft.fileName}</span>
            <span>•</span>
            <span>Enviado em {new Date(showDraft.uploadedAt).toLocaleString("pt-BR")}</span>
            {isDraft && <span className="ml-auto text-orange-600 dark:text-orange-400 font-semibold">Revisão pendente</span>}
            {!isDraft && showDraft.reviewedByHuman && <span className="ml-auto text-green-500 font-semibold">Ativo</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Tem fidelidade?</Label>
              <Select
                value={rules.tem_fidelidade === null ? "null" : String(rules.tem_fidelidade)}
                onValueChange={(v) => isDraft && updateRules({ tem_fidelidade: v === "null" ? null : v === "true" })}
                disabled={!isDraft}
              >
                <SelectTrigger className="h-9 mt-1" data-testid="field-tem-fidelidade"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim</SelectItem>
                  <SelectItem value="false">Não</SelectItem>
                  <SelectItem value="null">Indeterminado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Período padrão (meses)</Label>
              <Input
                type="number"
                value={rules.meses ?? ""}
                onChange={(e) => isDraft && updateRules({ meses: e.target.value ? parseInt(e.target.value) : null })}
                disabled={!isDraft}
                className="mt-1 h-9"
                placeholder="ex: 12"
                data-testid="field-meses"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Base de cálculo da multa</Label>
              <Select
                value={rules.base_calculo_multa || "null"}
                onValueChange={(v) => isDraft && updateRules({ base_calculo_multa: v === "null" ? null : (v as any) })}
                disabled={!isDraft}
              >
                <SelectTrigger className="h-9 mt-1" data-testid="field-base-calculo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="meses_restantes">Proporcional a meses restantes</SelectItem>
                  <SelectItem value="dias_restantes">Proporcional a dias restantes</SelectItem>
                  <SelectItem value="valor_beneficio_proporcional">Proporcional ao valor do benefício concedido</SelectItem>
                  <SelectItem value="instalacao_proporcional">Proporcional ao valor da instalação</SelectItem>
                  <SelectItem value="multa_fixa">Valor fixo</SelectItem>
                  <SelectItem value="nao_ha">Sem multa</SelectItem>
                  <SelectItem value="null">Indeterminado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {rules.base_calculo_multa === "multa_fixa" && (
              <div>
                <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Valor fixo da multa (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={rules.multa_fixa_valor ?? ""}
                  onChange={(e) => isDraft && updateRules({ multa_fixa_valor: e.target.value ? parseFloat(e.target.value) : null })}
                  disabled={!isDraft}
                  className="mt-1 h-9"
                  data-testid="field-multa-fixa"
                />
              </div>
            )}
            {rules.base_calculo_multa === "valor_beneficio_proporcional" && (
              <div>
                <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Valor total dos benefícios (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={rules.valor_beneficio_total ?? ""}
                  onChange={(e) => isDraft && updateRules({ valor_beneficio_total: e.target.value ? parseFloat(e.target.value) : null })}
                  disabled={!isDraft}
                  className="mt-1 h-9"
                  data-testid="field-valor-beneficio"
                />
              </div>
            )}
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Carência (dias)</Label>
              <Input
                type="number"
                value={rules.carencia_dias ?? ""}
                onChange={(e) => isDraft && updateRules({ carencia_dias: e.target.value ? parseInt(e.target.value) : null })}
                disabled={!isDraft}
                className="mt-1 h-9"
                placeholder="ex: 30"
                data-testid="field-carencia"
              />
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Taxa fixa adicional (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={rules.taxa_cancelamento_fixa ?? ""}
                onChange={(e) => isDraft && updateRules({ taxa_cancelamento_fixa: e.target.value ? parseFloat(e.target.value) : null })}
                disabled={!isDraft}
                className="mt-1 h-9"
                placeholder="0"
                data-testid="field-taxa-fixa"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Regra da multa (resumo)</Label>
              <Input
                value={rules.regra_multa_texto ?? ""}
                onChange={(e) => isDraft && updateRules({ regra_multa_texto: e.target.value })}
                disabled={!isDraft}
                className="mt-1 h-9"
                placeholder="ex: Proporcional aos meses restantes sobre o valor do benefício concedido"
                data-testid="field-regra-multa"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Cláusula exata do contrato (citação)</Label>
              <textarea
                value={rules.clausula_multa_exata ?? ""}
                onChange={(e) => isDraft && updateRules({ clausula_multa_exata: e.target.value })}
                disabled={!isDraft}
                className="mt-1 w-full px-3 py-2 border border-border rounded-md bg-muted/30 text-[12px] font-mono min-h-[80px] disabled:opacity-70"
                placeholder="Cole aqui a cláusula literal do contrato sobre multa (para o agente citar ao cliente quando pedido)"
                data-testid="field-clausula-exata"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Exceções à multa</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {EXCECAO_OPTIONS.map((opt) => {
                  const active = (rules.excecoes || []).includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => isDraft && toggleExcecao(opt.value)}
                      disabled={!isDraft}
                      className={`px-3 py-1.5 text-[11.5px] rounded-full border transition-colors ${
                        active ? "bg-primary/15 border-primary text-primary" : "border-border text-muted-foreground hover:bg-muted/40"
                      } ${!isDraft ? "opacity-80 cursor-default" : "cursor-pointer"}`}
                      data-testid={`excecao-${opt.value}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Benefícios listados no contrato</Label>
              <textarea
                value={(rules.beneficios_listados || []).join("\n")}
                onChange={(e) => isDraft && updateRules({ beneficios_listados: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                disabled={!isDraft}
                className="mt-1 w-full px-3 py-2 border border-border rounded-md bg-muted/30 text-[12px] min-h-[60px] disabled:opacity-70"
                placeholder="Um benefício por linha (ex: Instalação grátis&#10;Modem incluso&#10;Desconto mensal R$ 20 × 12 meses)"
                data-testid="field-beneficios"
              />
            </div>
            {showDraft.rawSnippet && (
              <div className="md:col-span-2">
                <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Trecho original detectado (evidência)</Label>
                <div className="mt-1 px-3 py-2 border border-border rounded-md bg-muted/20 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">{showDraft.rawSnippet}</div>
              </div>
            )}
          </div>

          {isDraft && (
            <div className="flex gap-2 pt-2 border-t border-border">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving} className="ml-auto" data-testid="btn-save-contract-model">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
                Salvar modelo revisado
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface TimeSlot { start: string; end: string; }
interface ServiceHours {
  enabled: boolean;
  timezone: string;
  weekdays: TimeSlot;
  saturday?: TimeSlot;
  sunday?: TimeSlot;
}

const DEFAULT_HOURS: ServiceHours = {
  enabled: false,
  timezone: "America/Sao_Paulo",
  weekdays: { start: "08:00", end: "18:00" },
  saturday: { start: "", end: "" },
  sunday: { start: "", end: "" },
};

function HorarioAtendimentoTab({ toast }: { toast: ReturnType<typeof useToast>["toast"] }) {
  const [hours, setHours] = useState<ServiceHours>(DEFAULT_HOURS);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = useQuery<{ ok: boolean; data: any }>({
    queryKey: ["/api/tenant-settings"],
  });

  useEffect(() => {
    if (data?.data?.serviceHours) {
      setHours({ ...DEFAULT_HOURS, ...data.data.serviceHours });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/tenant-settings", { serviceHours: hours });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant-settings"] });
      setDirty(false);
      toast({ title: "Horário de atendimento salvo com sucesso" });
    },
    onError: (e: Error) => {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    },
  });

  const updateHours = (field: string, value: any) => {
    setDirty(true);
    setHours(prev => {
      const copy = { ...prev } as any;
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        copy[parent] = { ...(copy[parent] || {}), [child]: value };
      } else {
        copy[field] = value;
      }
      return copy;
    });
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-4 max-w-2xl">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full rounded-box" />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2" data-testid="text-hours-title">
            <Clock className="w-5 h-5 text-primary" />
            Horário de Atendimento
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Configure os horários de funcionamento do atendimento automático</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              data-testid="button-save-hours"
            >
              {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
              Salvar
            </Button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Controle ativo</span>
            <Switch checked={hours.enabled} onCheckedChange={v => updateHours("enabled", v)} data-testid="switch-hours-enabled" />
          </div>
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
                  <Select value={hours.timezone || "America/Sao_Paulo"} onValueChange={(v) => updateHours("timezone", v)}>
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
              <HoursTimeRow label="Segunda a Sexta" fieldPrefix="weekdays" slot={hours.weekdays} onUpdate={updateHours} testPrefix="weekdays" />
              <HoursTimeRow label="Sábado" fieldPrefix="saturday" slot={hours.saturday || { start: "", end: "" }} onUpdate={updateHours} testPrefix="saturday" />
              <HoursTimeRow label="Domingo" fieldPrefix="sunday" slot={hours.sunday || { start: "", end: "" }} onUpdate={updateHours} testPrefix="sunday" />
            </CardContent>
          </Card>
        </>
      )}

      {!hours.enabled && (
        <Card>
          <CardContent className="py-10 text-center">
            <Clock className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Controle de horário desativado</p>
            <p className="text-xs text-muted-foreground mt-1">O atendimento automático fica ativo 24/7 sem restrição de horário</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function HoursTimeRow({ label, fieldPrefix, slot, onUpdate, testPrefix }: {
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
        <span className="text-muted-foreground text-xs">até</span>
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
