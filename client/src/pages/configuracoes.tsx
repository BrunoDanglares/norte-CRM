import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Bell,
  Globe,
  User,
  Save,
  AlertTriangle,
} from "lucide-react";
import { useLocation } from "wouter";

type ConfigTab =
  | "notificacoes"
  | "idioma"
  | "conta";

const CONFIG_TABS = [
  { id: "notificacoes" as const, icon: Bell, label: "Notificações" },
  { id: "idioma" as const, icon: Globe, label: "Idioma & Região" },
];

const CONTA_TABS = [
  { id: "conta" as const, icon: User, label: "Dados da conta" },
];

function NotificacoesTab() {
  const { toast } = useToast();

  const { data: profileData, isLoading } = useQuery<{ ok: boolean; data: any }>({
    queryKey: ["/api/perfil/me"],
  });

  const userData = profileData?.data;

  const [settings, setSettings] = useState({
    notifEmail: true,
    notifPush: true,
    notifNewLead: true,
    notifNewMsg: true,
    notifCampanha: false,
    notifRelatorio: true,
  });

  useEffect(() => {
    if (userData) {
      setSettings({
        notifEmail: userData.notifEmail ?? true,
        notifPush: true,
        notifNewLead: userData.notifNovosLeads ?? true,
        notifNewMsg: userData.notifMensagens ?? true,
        notifCampanha: userData.notifTarefas ?? false,
        notifRelatorio: userData.notifRelatorios ?? true,
      });
    }
  }, [userData]);

  const saveMutation = useMutation({
    mutationFn: async (updatedSettings: typeof settings) => {
      const res = await apiRequest("PUT", "/api/perfil/me", {
        notif_email: updatedSettings.notifEmail,
        notif_novos_leads: updatedSettings.notifNewLead,
        notif_mensagens: updatedSettings.notifNewMsg,
        notif_tarefas: updatedSettings.notifCampanha,
        notif_relatorios: updatedSettings.notifRelatorio,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/perfil/me"] });
      toast({ title: "Preferências salvas com sucesso" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar preferências", description: err.message, variant: "destructive" });
    },
  });

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const ToggleRow = ({ id, label, desc }: { id: keyof typeof settings; label: string; desc: string }) => (
    <div className="flex items-center justify-between gap-4 py-3 border-b last:border-b-0">
      <div>
        <div className="text-[13px] font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <Switch
        checked={settings[id]}
        onCheckedChange={() => toggleSetting(id)}
        data-testid={`switch-${id}`}
      />
    </div>
  );

  if (isLoading) {
    return (
      <div className="max-w-[620px]">
        <div className="mb-6">
          <Skeleton className="h-6 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Card className="p-5 mb-4">
          <Skeleton className="h-4 w-48 mb-4" />
          <Skeleton className="h-12 w-full mb-3" />
          <Skeleton className="h-12 w-full" />
        </Card>
        <Card className="p-5 mb-4">
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="h-12 w-full mb-3" />
          <Skeleton className="h-12 w-full mb-3" />
          <Skeleton className="h-12 w-full mb-3" />
          <Skeleton className="h-12 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[620px]">
      <div className="mb-6">
        <h2 className="text-[22px] font-bold tracking-tight leading-tight" data-testid="text-notificacoes-title">Notificações</h2>
        <p className="text-[13px] text-muted-foreground mt-1">Controle quais alertas você recebe e como.</p>
      </div>

      <Card className="p-5 mb-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Canais de notificação</div>
        <ToggleRow id="notifEmail" label="Email" desc="Receba um email para cada notificação importante" />
        <ToggleRow id="notifPush" label="Push no navegador" desc="Notificações push em tempo real no browser" />
      </Card>

      <Card className="p-5 mb-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Eventos</div>
        <ToggleRow id="notifNewLead" label="Novo lead criado" desc="Quando um lead entrar no pipeline" />
        <ToggleRow id="notifNewMsg" label="Nova mensagem no Chat" desc="Quando chegar mensagem de qualquer canal" />
        <ToggleRow id="notifCampanha" label="Relatório de campanha" desc="Ao concluir envio de uma campanha" />
        <ToggleRow id="notifRelatorio" label="Relatório semanal" desc="Resumo de performance toda segunda às 9h" />
      </Card>

      <Card className="p-5">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3.5">Horário silencioso</div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">De</Label>
            <Input type="time" defaultValue="22:00" className="mt-1" data-testid="input-quiet-from" />
          </div>
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Até</Label>
            <Input type="time" defaultValue="08:00" className="mt-1" data-testid="input-quiet-to" />
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground mt-2">Notificações push serão silenciadas neste período.</div>
      </Card>

      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => saveMutation.mutate(settings)}
          disabled={saveMutation.isPending}
          data-testid="button-save-notifications"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saveMutation.isPending ? "Salvando..." : "Salvar preferências"}
        </Button>
      </div>
    </div>
  );
}

function IdiomaTab() {
  const { toast } = useToast();

  return (
    <div className="max-w-[520px]">
      <div className="mb-6">
        <h2 className="text-[22px] font-bold tracking-tight leading-tight" data-testid="text-idioma-title">Idioma & Região</h2>
        <p className="text-[13px] text-muted-foreground mt-1">Configure o idioma e formatos regionais da interface.</p>
      </div>

      <Card className="p-5 mb-4">
        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Idioma da interface</Label>
            <Select defaultValue="pt-BR">
              <SelectTrigger className="mt-1" data-testid="select-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Fuso horário</Label>
            <Select defaultValue="America/Sao_Paulo">
              <SelectTrigger className="mt-1" data-testid="select-timezone">
                <SelectValue />
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
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Formato de data</Label>
            <Select defaultValue="dd/mm/yyyy">
              <SelectTrigger className="mt-1" data-testid="select-date-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dd/mm/yyyy">DD/MM/YYYY (Brasil)</SelectItem>
                <SelectItem value="mm/dd/yyyy">MM/DD/YYYY (EUA)</SelectItem>
                <SelectItem value="yyyy-mm-dd">YYYY-MM-DD (ISO)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Formato de moeda</Label>
            <Select defaultValue="brl">
              <SelectTrigger className="mt-1" data-testid="select-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="brl">R$ (Real Brasileiro)</SelectItem>
                <SelectItem value="usd">$ (Dólar)</SelectItem>
                <SelectItem value="eur">&euro; (Euro)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Início da semana</Label>
            <Select defaultValue="monday">
              <SelectTrigger className="mt-1" data-testid="select-week-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sunday">Domingo</SelectItem>
                <SelectItem value="monday">Segunda-feira</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => toast({ title: "Idioma & Região salvo" })}
          data-testid="button-save-idioma"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Salvar
        </Button>
      </div>
    </div>
  );
}

function ContaTab() {
  const [, setLocation] = useLocation();

  const { data: authData, isLoading: authLoading } = useQuery<{ ok: boolean; data: any }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: billingData, isLoading: billingLoading } = useQuery<{ ok: boolean; data: any }>({
    queryKey: ["/api/billing/usage"],
  });

  const isLoading = authLoading || billingLoading;
  const user = authData?.data;
  const billing = billingData?.data;

  const createdAt = user?.ultimoAcesso
    ? new Date(user.ultimoAcesso).toLocaleDateString("pt-BR")
    : "N/A";

  const accountInfo = [
    { l: "ID DA CONTA", v: user ? `acc_${String(user.id).padStart(10, "0")}` : "..." },
    { l: "PLANO", v: billing ? `${billing.plan} - ${billing.status}` : "..." },
    { l: "CRIADA EM", v: createdAt },
    { l: "REGIÃO", v: "sa-east-1 (São Paulo)" },
  ];

  if (isLoading) {
    return (
      <div className="max-w-[580px]">
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <Skeleton className="h-40 w-full mb-4" />
      </div>
    );
  }

  return (
    <div className="max-w-[580px]">
      <div className="mb-6">
        <h2 className="text-[22px] font-bold tracking-tight leading-tight" data-testid="text-conta-title">Dados da Conta</h2>
        <p className="text-[13px] text-muted-foreground mt-1">Informações gerais da sua conta de administrador.</p>
      </div>

      <Card className="p-5 mb-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3.5">Informações da conta</div>
        <div className="grid grid-cols-2 gap-1.5">
          {accountInfo.map((r, i) => (
            <div key={i} className="py-2 border-b">
              <div className="text-[10px] text-muted-foreground font-bold">{r.l}</div>
              <div className="text-xs font-semibold mt-0.5" data-testid={`text-account-${i}`}>{r.v}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="bg-muted/30 border border-border rounded-xl p-4 flex items-center gap-3.5">
        <AlertTriangle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1">
          <div className="text-xs font-bold mb-0.5">Segurança, exportação e exclusão de conta</div>
          <div className="text-[11px] text-muted-foreground">Gerencie senha, 2FA, sessões e dados pessoais na página Meu Perfil.</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="flex-shrink-0"
          onClick={() => setLocation("/perfil")}
          data-testid="button-go-to-perfil"
        >
          Ir para Meu Perfil
        </Button>
      </div>
    </div>
  );
}

export default function Configuracoes() {
  const [activeTab, setActiveTab] = useState<ConfigTab>("notificacoes");
  const [, setLocation] = useLocation();

  const renderContent = () => {
    switch (activeTab) {
      case "notificacoes":
        return <NotificacoesTab />;
      case "idioma":
        return <IdiomaTab />;
      case "conta":
        return <ContaTab />;
      default:
        return <NotificacoesTab />;
    }
  };

  return (
    <div className="flex h-full overflow-hidden" data-testid="page-configuracoes">
      <div className="w-[220px] flex-shrink-0 border-r bg-card overflow-y-auto">
        <div className="px-4 pt-5 pb-3 text-[10.5px] font-bold text-muted-foreground tracking-wider">
          CONFIGURAÇÕES
        </div>
        {CONFIG_TABS.map((t) => {
          const isActive = activeTab === t.id;
          return (
          <div
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`tab-nav-item flex items-center gap-2.5 px-4 py-2.5 text-xs cursor-pointer transition-colors ${
              isActive
                ? "font-bold border-l-[2.5px]"
                : "text-foreground border-l-[2.5px] border-l-transparent hover-elevate"
            }`}
            style={isActive ? {
              // Bruno 2026-05-21: theme-aware (era banana-50 + brand-brown).
              background: "var(--theme-tint-50, var(--banana-50))",
              borderLeftColor: "hsl(var(--primary))",
              color: "hsl(var(--primary))",
            } : {}}
            data-testid={`nav-config-${t.id}`}
          >
            <t.icon className="w-4 h-4 flex-shrink-0" />
            <span>{t.label}</span>
          </div>
          );
        })}

        <div className="px-4 pt-5 pb-3 text-[10.5px] font-bold text-muted-foreground tracking-wider">
          CONTA
        </div>
        {CONTA_TABS.map((t) => {
          const isActive = activeTab === (t.id as ConfigTab);
          return (
          <div
            key={t.id}
            onClick={() => {
              setActiveTab(t.id as ConfigTab);
            }}
            className={`flex items-center gap-2.5 px-4 py-2.5 text-xs cursor-pointer transition-colors ${
              isActive
                ? "font-bold border-l-[2.5px]"
                : "text-foreground border-l-[2.5px] border-l-transparent hover-elevate"
            }`}
            style={isActive ? {
              // Bruno 2026-05-21: theme-aware (era banana-50 + brand-brown).
              background: "var(--theme-tint-50, var(--banana-50))",
              borderLeftColor: "hsl(var(--primary))",
              color: "hsl(var(--primary))",
            } : {}}
            data-testid={`nav-config-${t.id}`}
          >
            <t.icon className="w-4 h-4 flex-shrink-0" />
            <span>{t.label}</span>
          </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-7 px-8 bg-background page-banana-wash">
        {renderContent()}
      </div>
    </div>
  );
}
