import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiUpload } from "@/lib/queryClient";
import { authService } from "@/services/auth";
import {
  User,
  Shield,
  Eye,
  EyeOff,
  Check,
  X,
  AlertTriangle,
  Smartphone,
  Laptop,
  Save,
  Key,
  ShieldCheck,
  MessageSquare,
  Target,
  Zap,
  Download,
  FileText,
  BarChart3,
  Ban,
  Loader2,
  Link as LinkIcon,
  Upload,
  ImagePlus,
  Bell,
  Globe,
  Settings,
  ScrollText,
  Camera,
  Trash2,
  Monitor,
  Database,
  LogOut,
} from "lucide-react";

type TabId = "perfil" | "seguranca" | "preferencias" | "termos" | "privacidade";

const ALL_TABS: { key: TabId; label: string; icon: typeof User }[] = [
  { key: "perfil", label: "Perfil", icon: User },
  { key: "seguranca", label: "Segurança", icon: Shield },
  { key: "preferencias", label: "Preferências", icon: Settings },
  { key: "termos", label: "Termos de Uso", icon: ScrollText },
  { key: "privacidade", label: "Política de Privacidade", icon: ShieldCheck },
];

function getInitials(nome: string): string {
  return nome.split(" ").map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function TabPerfil({ user, onUpdate, openAvatarModal, onAvatarModalOpened }: { user: any; onUpdate: (u: any) => void; openAvatarModal?: boolean; onAvatarModalOpened?: () => void }) {
  const { toast } = useToast();
  const [nome, setNome] = useState(user.nome || "");
  const [email] = useState(user.email || "");
  const [phone, setPhone] = useState(user.telefone || "");
  const [cargo, setCargo] = useState(user.cargo || "");
  const [empresa, setEmpresa] = useState(user.empresa || "");
  const [website, setWebsite] = useState(user.website || "");
  const [bio, setBio] = useState(user.bio || "");
  const [saving, setSaving] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(openAvatarModal || false);

  const [notifSettings, setNotifSettings] = useState({
    notifEmail: true, notifPush: true, notifNewLead: true, notifNewMsg: true, notifCampanha: false, notifRelatorio: true,
  });
  const [savingNotif, setSavingNotif] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("flowcrm_token");
    if (!token) return;
    apiRequest("GET", "/api/perfil/me")
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data) {
          setNotifSettings({
            notifEmail: json.data.notifEmail ?? true, notifPush: true,
            notifNewLead: json.data.notifNovosLeads ?? true, notifNewMsg: json.data.notifMensagens ?? true,
            notifCampanha: json.data.notifTarefas ?? false, notifRelatorio: json.data.notifRelatorios ?? true,
          });
        }
      }).catch(() => {});
  }, []);

  const toggleNotif = (key: keyof typeof notifSettings) => setNotifSettings(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSaveNotif = async () => {
    setSavingNotif(true);
    try {
      await apiRequest("PUT", "/api/perfil/me", {
        notif_email: notifSettings.notifEmail, notif_novos_leads: notifSettings.notifNewLead,
        notif_mensagens: notifSettings.notifNewMsg, notif_tarefas: notifSettings.notifCampanha, notif_relatorios: notifSettings.notifRelatorio,
      });
      toast({ title: "Preferências de notificação salvas" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally { setSavingNotif(false); }
  };

  const NotifToggle = ({ id, label, desc }: { id: keyof typeof notifSettings; label: string; desc: string }) => (
    <div className="flex items-center justify-between gap-4 py-3 border-b last:border-b-0">
      <div>
        <div className="text-[12px] font-semibold">{label}</div>
        <div className="text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={notifSettings[id]} onCheckedChange={() => toggleNotif(id)} data-testid={`switch-${id}`} />
    </div>
  );

  useEffect(() => {
    if (openAvatarModal) { setShowAvatarModal(true); onAvatarModalOpened?.(); }
  }, [openAvatarModal]);
  const [avatarUrlInput, setAvatarUrlInput] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarMode, setAvatarMode] = useState<"upload" | "url">("upload");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    setNome(user.nome || "");
    setPhone(user.telefone || "");
    setCargo(user.cargo || "");
    setEmpresa(user.empresa || "");
    setWebsite(user.website || "");
    setBio(user.bio || "");
  }, [user]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/perfil/me", { nome, cargo, telefone: phone, bio, empresa, website });
      const json = await res.json();
      if (json.ok) {
        onUpdate(json.data);
        toast({ title: "Perfil atualizado com sucesso!" });
      }
    } catch (e: any) {
      toast({ title: e.message || "Erro ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Selecione uma imagem (JPG, PNG, GIF, WebP)", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagem muito grande. Máximo 5MB.", variant: "destructive" });
      return;
    }
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleUploadAvatar = async () => {
    if (!avatarFile) {
      toast({ title: "Selecione uma imagem", variant: "destructive" });
      return;
    }
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", avatarFile);
      const uploadRes = await apiUpload("/api/upload", formData);
      const uploadJson = await uploadRes.json();
      if (!uploadJson.ok) throw new Error(uploadJson.error || "Erro no upload");
      const res = await apiRequest("POST", "/api/perfil/avatar", { avatarUrl: uploadJson.url });
      const json = await res.json();
      if (json.ok) {
        onUpdate({ ...user, avatarUrl: json.data.avatarUrl, avatar: json.data.avatarUrl });
        setShowAvatarModal(false);
        setAvatarFile(null);
        setAvatarPreview(null);
        toast({ title: "Foto atualizada!" });
      }
    } catch (e: any) {
      toast({ title: e.message || "Erro ao enviar foto", variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveAvatar = async () => {
    if (avatarMode === "upload") {
      return handleUploadAvatar();
    }
    if (!avatarUrlInput.startsWith("http")) {
      toast({ title: "URL inválida. Deve começar com http:// ou https://", variant: "destructive" });
      return;
    }
    setSavingAvatar(true);
    try {
      const res = await apiRequest("POST", "/api/perfil/avatar", { avatarUrl: avatarUrlInput });
      const json = await res.json();
      if (json.ok) {
        onUpdate({ ...user, avatarUrl: json.data.avatarUrl, avatar: json.data.avatarUrl });
        setShowAvatarModal(false);
        setAvatarUrlInput("");
        toast({ title: "Foto atualizada!" });
      }
    } catch (e: any) {
      toast({ title: e.message || "Erro ao salvar foto", variant: "destructive" });
    } finally {
      setSavingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      const res = await apiRequest("PUT", "/api/perfil/me", {});
      void res;
    } catch {}
    try {
      await apiRequest("POST", "/api/perfil/avatar", { avatarUrl: null });
    } catch {}
    onUpdate({ ...user, avatarUrl: null, avatar: null });
    toast({ title: "Foto removida" });
  };


  return (
    <div className="p-5 space-y-5">
      {showAvatarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowAvatarModal(false); setAvatarFile(null); setAvatarPreview(null); setAvatarMode("upload"); }}>
          <Card className="w-full max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Alterar foto do perfil
            </div>
            <div className="flex gap-1 mb-4 bg-muted/50 rounded-lg p-1">
              <button
                className={`flex-1 text-xs font-bold py-1.5 px-3 rounded-md flex items-center justify-center gap-1.5 transition-all ${avatarMode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAvatarMode("upload")}
                data-testid="tab-upload-photo"
              >
                <Upload className="w-3.5 h-3.5" />
                Enviar do computador
              </button>
              <button
                className={`flex-1 text-xs font-bold py-1.5 px-3 rounded-md flex items-center justify-center gap-1.5 transition-all ${avatarMode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAvatarMode("url")}
                data-testid="tab-url-photo"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                Colar URL
              </button>
            </div>
            {avatarMode === "upload" ? (
              <div className="mb-3">
                {avatarPreview ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                      <img src={avatarPreview} alt="Preview" className="w-24 h-24 rounded-box object-cover border-2 border-border" />
                      <button
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/80 transition-colors"
                        onClick={() => { setAvatarFile(null); setAvatarPreview(null); }}
                        data-testid="button-remove-preview"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-[11px] text-muted-foreground truncate max-w-full">{avatarFile?.name}</span>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-box py-8 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
                    data-testid="label-upload-area"
                  >
                    <ImagePlus className="w-8 h-8 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">Clique para selecionar uma imagem</span>
                    <span className="text-[10px] text-muted-foreground/60">JPG, PNG, GIF ou WebP (max 5MB)</span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} data-testid="input-file-upload" />
                  </label>
                )}
              </div>
            ) : (
              <div className="mb-3">
                <label className="block text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide mb-1">URL da foto</label>
                <Input value={avatarUrlInput} onChange={(e) => setAvatarUrlInput(e.target.value)} placeholder="https://..." data-testid="input-avatar-url" />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowAvatarModal(false); setAvatarFile(null); setAvatarPreview(null); setAvatarMode("upload"); }} data-testid="button-cancel-avatar">Cancelar</Button>
              <Button
                size="sm"
                onClick={handleSaveAvatar}
                disabled={savingAvatar || uploadingAvatar || (avatarMode === "upload" && !avatarFile) || (avatarMode === "url" && !avatarUrlInput)}
                data-testid="button-save-avatar"
              >
                {(savingAvatar || uploadingAvatar) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                Salvar foto
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Foto do Perfil — layout 2 colunas do Nexus (descrição | conteúdo) */}
      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <Camera className="w-4 h-4 text-base-content/60" />
              <span className="text-[13px] font-semibold">Foto do Perfil</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">Personalize sua identidade visual no CRM.</p>
          </div>
          <div className="lg:col-span-2 flex items-center gap-4 flex-wrap">
            <Avatar className="w-16 h-16 rounded-box border-[3px] border-primary/30">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} className="rounded-box" />}
              <AvatarFallback className="rounded-box bg-primary text-primary-content text-lg font-bold">
                {getInitials(user.nome || "U")}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <span className="font-semibold text-[14px] block" data-testid="text-avatar-name">{user.nome || "Seu Nome"}</span>
              <span className="text-[12px] text-base-content/55">{user.cargo || user.role || "Sem cargo definido"}</span>
            </div>
            <div className="flex gap-1.5 ml-auto">
              <Button size="sm" variant="outline" onClick={() => setShowAvatarModal(true)} data-testid="button-change-avatar">
                <ImagePlus className="w-3.5 h-3.5 mr-1.5" /> Alterar foto
              </Button>
              {user.avatarUrl && (
                <Button size="sm" variant="outline" className="text-destructive" onClick={handleRemoveAvatar} data-testid="button-remove-avatar">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Dados Pessoais — layout 2 colunas do Nexus */}
      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-base-content/60" />
              <span className="text-[13px] font-semibold">Dados Pessoais</span>
            </div>
            <p className="text-[12px] text-base-content/55 leading-relaxed">Suas informações de contato e identificação na conta.</p>
            <Button size="sm" onClick={handleSaveProfile} disabled={saving} className="mt-3" data-testid="button-profile-save">
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input label="Nome completo *" value={nome} onChange={(e) => setNome(e.target.value)} data-testid="input-profile-name" />
            </div>
            <div className="relative group">
              <Input label="Email *" type="email" value={email} readOnly disabled className="opacity-60 cursor-not-allowed" data-testid="input-profile-email" />
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-popover border border-border text-[10px] text-muted-foreground px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                O email não pode ser alterado
              </div>
            </div>
            <div>
              <Input label="Telefone / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-profile-phone" />
            </div>
            <div>
              <Input label="Cargo / Função" value={cargo} onChange={(e) => setCargo(e.target.value)} data-testid="input-profile-cargo" />
            </div>
            <div>
              <Input label="Empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} data-testid="input-profile-empresa" />
            </div>
            <div>
              <Input label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-profile-website" />
            </div>
            <div className="sm:col-span-2">
              <Textarea
                label="Bio / Sobre"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
                data-testid="input-profile-bio"
              />
              <div className="text-[10.5px] text-muted-foreground mt-1 text-right">Máximo 200 caracteres</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Canais</span>
          </div>
          <div className="p-4">
            <NotifToggle id="notifEmail" label="Email" desc="Receba um email para cada notificação importante" />
            <NotifToggle id="notifPush" label="Push no navegador" desc="Notificações push em tempo real no browser" />
          </div>
        </Card>

        <Card className="p-0 overflow-hidden lg:col-span-2">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Eventos</span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2">
            <NotifToggle id="notifNewLead" label="Novo lead criado" desc="Quando um lead entrar no pipeline" />
            <NotifToggle id="notifNewMsg" label="Nova mensagem no Chat" desc="Quando chegar mensagem de qualquer canal" />
            <NotifToggle id="notifCampanha" label="Relatório de campanha" desc="Ao concluir envio de uma campanha" />
            <NotifToggle id="notifRelatorio" label="Relatório semanal" desc="Resumo de performance toda segunda às 9h" />
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSaveNotif} disabled={savingNotif} data-testid="button-save-notifications">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {savingNotif ? "Salvando..." : "Salvar notificações"}
        </Button>
      </div>
    </div>
  );
}

function TabSeguranca({ user }: { user: any }) {
  const { toast } = useToast();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [twoFA] = useState(true);

  const pwChecks = {
    len: newPw.length >= 8,
    upper: /[A-Z]/.test(newPw),
    num: /[0-9]/.test(newPw),
    sym: /[^A-Za-z0-9]/.test(newPw),
  };
  const score = Object.values(pwChecks).filter(Boolean).length;
  const strengthLevels = [
    { w: "25%", color: "bg-red-500", label: "Muito fraca", textColor: "text-red-500" },
    { w: "50%", color: "bg-yellow-500", label: "Fraca", textColor: "text-yellow-500" },
    { w: "75%", color: "bg-primary", label: "Boa", textColor: "text-tertiary-500" },
    { w: "100%", color: "bg-emerald-500", label: "Muito forte", textColor: "text-emerald-500" },
  ];
  const strength = score > 0 ? strengthLevels[score - 1] : null;

  const handleChangePassword = async () => {
    setError("");
    if (!currentPw || !newPw || !confirmPw) {
      setError("Preencha todos os campos");
      return;
    }
    if (newPw !== confirmPw) {
      setError("As senhas não coincidem");
      return;
    }
    if (newPw.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("POST", "/api/perfil/alterar-senha", { senhaAtual: currentPw, novaSenha: newPw, confirmarSenha: confirmPw });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast({ title: "Senha alterada com sucesso!" });
    } catch (e: any) {
      setError(e.message || "Erro ao alterar senha");
    } finally {
      setSaving(false);
    }
  };

  const sessions = [
    { device: "Chrome 122 · Windows 11", ip: "187.45.23.10", city: "São Paulo, BR", isPhone: false, time: "Agora", current: true },
    { device: "Safari 17 · iPhone 15 Pro", ip: "187.45.23.11", city: "São Paulo, BR", isPhone: true, time: "Há 2h", current: false },
    { device: "Chrome 121 · MacBook Pro", ip: "189.12.88.44", city: "Campinas, BR", isPhone: false, time: "Há 1d", current: false },
    { device: "Firefox 123 · Ubuntu 22", ip: "200.178.22.15", city: "Rio de Janeiro", isPhone: false, time: "Há 3d", current: false },
  ];

  const logs = [
    { event: "Login bem-sucedido", detail: "Chrome · Windows 11 · São Paulo", time: "Hoje 09:14", success: true },
    { event: "Senha alterada", detail: "Via configurações de perfil", time: "Ontem 15:32", success: true },
    { event: "2FA ativado", detail: "Google Authenticator configurado", time: "01/03/2026", success: true },
    { event: "Tentativa de login falha", detail: "IP desconhecido: 45.89.220.1", time: "25/02/2026", success: false },
  ];

  return (
    <div className="p-5 space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Alterar Senha</span>
          </div>
          <div className="p-4 space-y-3">
            {error && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2" data-testid="text-password-error">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {error}
              </div>
            )}
            <div>
              <Input
                label="Senha atual *"
                type={showCurrent ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                data-testid="input-current-password"
                rightElement={
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowCurrent(!showCurrent)}>
                    {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                }
              />
            </div>
            <div>
              <Input
                label="Nova senha *"
                type={showNew ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                data-testid="input-new-password"
                rightElement={
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowNew(!showNew)}>
                    {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                }
              />
            </div>
            <div>
              <div className="h-[5px] bg-muted/30 rounded-full overflow-hidden mb-1">
                <div className={`h-full rounded-full transition-all duration-300 ${strength?.color || "bg-muted"}`} style={{ width: strength?.w || "0%" }} />
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-[10.5px] ${strength?.textColor || "text-muted-foreground"}`}>{strength?.label || "Força da senha"}</span>
                <div className="flex gap-3">
                  {[
                    { check: pwChecks.len, label: "8+ chars" },
                    { check: pwChecks.upper, label: "Maiúscula" },
                    { check: pwChecks.num, label: "Número" },
                    { check: pwChecks.sym, label: "Símbolo" },
                  ].map((r) => (
                    <span key={r.label} className={`text-[9.5px] flex items-center gap-1 ${r.check ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                      <span className={`w-[7px] h-[7px] rounded-full inline-block ${r.check ? "bg-emerald-400" : "bg-muted"}`} />
                      {r.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <Input
                label="Confirmar nova senha *"
                type={showConfirm ? "text" : "password"}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                data-testid="input-confirm-password"
                rightElement={
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowConfirm(!showConfirm)}>
                    {showConfirm ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                }
              />
              {confirmPw && (
                <div className={`text-[10.5px] mt-1 ${newPw === confirmPw ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {newPw === confirmPw ? <><Check className="w-3 h-3 inline mr-1" />Senhas coincidem</> : <><X className="w-3 h-3 inline mr-1" />Senhas não coincidem</>}
                </div>
              )}
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={handleChangePassword} disabled={saving} data-testid="button-update-password">
                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Shield className="w-3 h-3 mr-1" />}
                Atualizar senha
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-muted-foreground" />
              <span className="text-[12px] font-bold">Autenticação 2FA</span>
            </div>
            {twoFA ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]" data-testid="badge-2fa-active">
                  <Check className="w-3 h-3 mr-1" />
                  Ativo
                </Badge>
                <Button variant="ghost" size="sm" className="text-rose-600 dark:text-rose-400 text-xs" data-testid="button-disable-2fa">Desativar</Button>
              </div>
            ) : (
              <Button size="sm" className="text-xs" data-testid="button-enable-2fa">Ativar 2FA</Button>
            )}
          </div>
          <div className="p-4">
            {twoFA ? (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-box flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400">2FA ativo — conta protegida</div>
                    <div className="text-[11px] text-muted-foreground">App configurado: Google Authenticator</div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" data-testid="button-recovery-codes">
                  <Key className="w-3 h-3 mr-1" />
                  Ver códigos de recuperação
                </Button>
              </div>
            ) : (
              <div className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-box flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div className="text-[11.5px] text-muted-foreground">Sua conta não possui 2FA ativo. Recomendamos fortemente que você ative para aumentar a segurança.</div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-muted-foreground" />
              <span className="text-[12px] font-bold">Sessões Ativas</span>
            </div>
            <Button variant="ghost" size="sm" className="text-rose-600 dark:text-rose-400 text-xs" data-testid="button-revoke-all">
              <Ban className="w-3 h-3 mr-1" />
              Revogar todas
            </Button>
          </div>
          <div className="p-4">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                <div className="w-9 h-9 rounded-lg bg-muted/30 border border-border flex items-center justify-center flex-shrink-0">
                  {s.isPhone ? <Smartphone className="w-4 h-4 text-muted-foreground" /> : <Laptop className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold flex items-center gap-1.5 flex-wrap">
                    {s.device}
                    {s.current && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[9.5px]">Atual</Badge>
                    )}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">IP: {s.ip} · {s.city} · {s.time}</div>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" className="text-rose-600 dark:text-rose-400 text-[10.5px]" data-testid={`button-revoke-${i}`}>Revogar</Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Histórico de Acesso</span>
          </div>
          <div className="p-4">
            {logs.map((e, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${e.success ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                  {e.success ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <X className="w-3 h-3 text-rose-600 dark:text-rose-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold">{e.event}</div>
                  <div className="text-[10.5px] text-muted-foreground">{e.detail}</div>
                </div>
                <div className="text-[10.5px] text-muted-foreground whitespace-nowrap">{e.time}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden border-red-500/20">
        <div className="px-5 py-3 border-b bg-red-500/5 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          <span className="text-[12px] font-bold text-rose-600 dark:text-rose-400">Zona de Perigo</span>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-bold">Excluir conta permanentemente</div>
              <div className="text-[11px] text-muted-foreground">Remove todos os seus dados, leads e histórico. Ação irreversível.</div>
            </div>
            <Button variant="outline" size="sm" className="text-rose-600 dark:text-rose-400 border-red-500/30 text-xs" data-testid="button-delete-account">
              Excluir conta
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function TabPreferencias({ user }: { user: any }) {
  const { toast } = useToast();
  const [exportFormat, setExportFormat] = useState("json");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleteError("");
    if (!deletePassword) {
      setDeleteError("Digite sua senha para confirmar");
      return;
    }
    setDeleting(true);
    try {
      await apiRequest("DELETE", "/api/perfil/conta", { senha: deletePassword });
      authService.logout();
    } catch (e: any) {
      setDeleteError(e.message || "Erro ao excluir conta");
    } finally {
      setDeleting(false);
    }
  };

  const dataTypes = [
    { icon: User, label: "Dados pessoais", desc: "Nome, email, perfil" },
    { icon: MessageSquare, label: "Histórico de msgs", desc: "Todos os chats" },
    { icon: Target, label: "Contatos & negócios", desc: "Pipeline completo" },
    { icon: BarChart3, label: "Relatórios", desc: "Histórico de métricas" },
  ];

  return (
    <div className="p-5 space-y-5">
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <span className="text-[12px] font-bold">Idioma & Região</span>
        </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Idioma</Label>
              <Select defaultValue="pt-BR">
                <SelectTrigger className="mt-1.5" data-testid="select-language"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                  <SelectItem value="en-US">English (US)</SelectItem>
                  <SelectItem value="es">Espanhol</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Fuso horário</Label>
              <Select defaultValue="America/Sao_Paulo">
                <SelectTrigger className="mt-1.5" data-testid="select-timezone"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">America/Sao_Paulo (GMT-3)</SelectItem>
                  <SelectItem value="America/Manaus">America/Manaus (GMT-4)</SelectItem>
                  <SelectItem value="America/Fortaleza">America/Fortaleza (GMT-3)</SelectItem>
                  <SelectItem value="America/Belem">America/Belem (GMT-3)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wide">Formato de data</Label>
              <Select defaultValue="dd/mm/yyyy">
                <SelectTrigger className="mt-1.5" data-testid="select-date-format"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="mt-1.5" data-testid="select-currency"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="mt-1.5" data-testid="select-week-start"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sunday">Domingo</SelectItem>
                  <SelectItem value="monday">Segunda-feira</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => toast({ title: "Idioma & Região salvo" })} data-testid="button-save-idioma">
                <Save className="w-3.5 h-3.5 mr-1.5" /> Salvar
              </Button>
            </div>
          </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Download className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Exportar Meus Dados</span>
          </div>
          <div className="p-4">
            <p className="text-[11px] text-muted-foreground mb-3">Faça o download de todos os seus dados pessoais e histórico de atividade em conformidade com a LGPD.</p>
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              {dataTypes.map((d) => (
                <div key={d.label} className="p-2.5 bg-muted/30 border border-border rounded-box flex gap-2 items-center">
                  <d.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div>
                    <div className="text-[11px] font-bold">{d.label}</div>
                    <div className="text-[10px] text-muted-foreground">{d.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5 items-center flex-wrap">
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="w-auto" data-testid="select-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="zip">ZIP completo</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => toast({ title: "Export iniciado! Você receberá um email com o link em até 5 minutos." })} data-testid="button-export-data">
                <Download className="w-3 h-3 mr-1" />
                Exportar tudo
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden border-red-500/20">
          <div className="px-5 py-3 border-b bg-red-500/5 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span className="text-[12px] font-bold text-rose-600 dark:text-rose-400">Excluir Dados</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-4 p-3 bg-red-500/5 border border-red-500/10 rounded-box">
              <div>
                <div className="text-xs font-bold">Apagar histórico de mensagens</div>
                <div className="text-[10.5px] text-muted-foreground">Remove conversas mais antigas que 12 meses</div>
              </div>
              <Button variant="outline" size="sm" className="text-rose-600 dark:text-rose-400 border-red-500/30 text-xs flex-shrink-0" onClick={() => toast({ title: "Solicitação enviada — histórico antigo será apagado em 24h" })} data-testid="button-delete-messages">
                Apagar
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4 p-3 bg-red-500/5 border border-red-500/10 rounded-box">
              <div>
                <div className="text-xs font-bold">Excluir conta permanentemente</div>
                <div className="text-[10.5px] text-muted-foreground">Remove todos os seus dados. Ação irreversível.</div>
              </div>
              <Button variant="outline" size="sm" className="text-rose-600 dark:text-rose-400 border-red-500/30 text-xs flex-shrink-0" onClick={() => setShowDeleteModal(true)} data-testid="button-delete-account-dados">
                Excluir
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDeleteModal(false)}>
          <Card className="w-full max-w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Confirmar exclusão da conta
            </div>
            <p className="text-xs text-muted-foreground mb-4">Esta ação desativará sua conta permanentemente. Digite sua senha para confirmar.</p>
            {deleteError && (
              <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2" data-testid="text-delete-error">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {deleteError}
              </div>
            )}
            <div className="mb-4">
              <Input label="Senha *" type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} data-testid="input-delete-password" />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowDeleteModal(false); setDeletePassword(""); setDeleteError(""); }} data-testid="button-cancel-delete">Cancelar</Button>
              <Button size="sm" variant="destructive" onClick={handleDeleteAccount} disabled={deleting} data-testid="button-confirm-delete">
                {deleting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                Confirmar exclusão
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}


function TabTermos() {
  return (
    <div className="p-5 space-y-5">
        <div className="space-y-4 max-w-4xl" data-testid="tab-termos-content">
          <div>
            <h2 className="text-base font-bold mb-0.5">Termos e Condições de Uso</h2>
            <p className="text-[11px] text-muted-foreground">Plataforma Norte Gestão — CRM WhatsApp para Empresas Brasileiras · Última atualização: 25/03/2026</p>
          </div>

          {[
            { title: "1. Aceitação dos Termos", content: "Ao acessar ou utilizar a plataforma Norte Gestão (\"Serviço\"), você (\"Usuário\" ou \"Cliente\") concorda com estes Termos e Condições de Uso (\"Termos\"). Se você estiver aceitando estes Termos em nome de uma empresa ou outra entidade legal, declara ter poderes para fazê-lo.\n\nCaso não concorde com qualquer disposição destes Termos, não utilize o Serviço. O uso continuado após alterações nos Termos implica aceitação das novas condições." },
            { title: "2. Descrição do Serviço", content: "O Norte Gestão é uma plataforma SaaS (Software como Serviço) de CRM com integração nativa ao WhatsApp, voltada para pequenas e médias empresas brasileiras. O Serviço oferece:\n\n• Gerenciamento de leads, contatos e conversas via WhatsApp\n• Automações de mensagens com inteligência artificial (IA)\n• Funil de vendas (pipeline) e relatórios de desempenho\n• Disparos programados e campanhas de mensagens em massa\n• Integrações com ferramentas de terceiros (N8n, Zapier, Make, Stripe)\n• Caixa de entrada unificada para equipes\n\nO Serviço é fornecido no modelo multi-tenant, onde cada empresa possui um workspace isolado e independente." },
            { title: "3. Cadastro e Conta", content: "Para utilizar o Norte Gestão, é necessário criar uma conta fornecendo informações verdadeiras, precisas e atualizadas. O Usuário é responsável por:\n\n• Manter a confidencialidade de suas credenciais de acesso (login e senha)\n• Todas as atividades realizadas sob sua conta\n• Notificar imediatamente a Norte Gestão em caso de acesso não autorizado\n\nÉ proibido criar contas com informações falsas, compartilhar credenciais entre múltiplos usuários não autorizados ou criar contas para fins ilícitos." },
            { title: "4. Uso Aceitável", content: "O Usuário concorda em utilizar o Serviço exclusivamente para fins legítimos e em conformidade com a legislação brasileira vigente, incluindo o Marco Civil da Internet (Lei n 12.965/2014) e o Código de Defesa do Consumidor.\n\nSão expressamente proibidos: envio de spam, práticas fraudulentas, acesso não autorizado a dados de outros Clientes, revenda sem autorização, uso de automações para assédio ou discriminação, e coleta de dados sem base legal da LGPD.\n\nA Norte Gestão reserva-se o direito de suspender ou encerrar contas que violem estas regras, sem aviso prévio e sem direito a reembolso." },
            { title: "5. Modelo de Cobrança e Pagamento", content: "O Norte Gestão opera atualmente no modelo gratuito para Gestores de Automação, com cobrança por conexão WhatsApp ativa. Cada conexão WhatsApp ativa gera cobrança mensal recorrente de R$ 87,90. Os valores são cobrados mensalmente via Stripe. A Norte Gestão poderá reajustar os valores mediante notificação prévia de 30 dias. Em caso de falha no pagamento, o acesso poderá ser suspenso após 7 dias corridos." },
            { title: "6. Cancelamento e Rescisão", content: "Pelo Cliente: O cancelamento pode ser realizado a qualquer momento. O acesso permanece ativo até o fim do período pago. Não há reembolso proporcional.\n\nPela Norte Gestão: Reservamo-nos o direito de rescindir o contrato com aviso prévio de 30 dias, salvo em casos de violação grave.\n\nExportação de Dados: Após o cancelamento, o Cliente terá 30 dias para exportar seus dados." },
            { title: "7. Propriedade Intelectual", content: "Todos os direitos sobre a plataforma Norte Gestão são de titularidade exclusiva da Norte Gestão ou de seus licenciantes. O Cliente recebe uma licença limitada, não exclusiva, intransferível e revogável. O Cliente mantém todos os direitos sobre os dados inseridos na plataforma." },
            { title: "8. Limitação de Responsabilidade", content: "O Serviço é fornecido \"como está\" e \"conforme disponível\". A Norte Gestão não será responsável por perdas decorrentes de interrupções causadas por terceiros, conteúdo das mensagens dos Clientes, danos indiretos, ou bloqueios impostos pelo WhatsApp/Meta. A responsabilidade total fica limitada ao valor pago no mês do evento danoso." },
            { title: "9. Disponibilidade e Manutenção", content: "A Norte Gestão se compromete a manter disponibilidade mínima de 99% ao mês. Manutenções programadas serão comunicadas com antecedência mínima de 24 horas." },
            { title: "10. Alterações nos Termos", content: "A Norte Gestão poderá modificar estes Termos a qualquer momento. Alterações relevantes serão comunicadas com antecedência mínima de 15 dias." },
            { title: "11. Lei Aplicável e Foro", content: "Estes Termos são regidos pelas leis da República Federativa do Brasil. Foro da Comarca de Belém, Estado do Pará." },
            { title: "12. Contato", content: "E-mail: legal@chatbanana.com.br\nSite: www.chatbanana.com.br" },
          ].map((section, i) => (
            <Card key={i} className="p-0 overflow-hidden">
              <div className="px-5 py-2.5 border-b bg-muted/30">
                <span className="text-[12px] font-semibold">{section.title}</span>
              </div>
              <div className="px-5 py-3">
                <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
              </div>
            </Card>
          ))}
          <p className="text-[10px] text-center text-muted-foreground pt-2">
            2026 Norte Gestão. Todos os direitos reservados. — Simplificando vendas pelo WhatsApp
          </p>
        </div>
    </div>
  );
}

function TabPrivacidade() {
  return (
    <div className="p-5 space-y-5">
        <div className="space-y-4 max-w-4xl" data-testid="tab-privacidade-content">
          <div>
            <h2 className="text-base font-bold mb-0.5">Política de Privacidade</h2>
            <p className="text-[11px] text-muted-foreground">Plataforma Norte Gestão — Conformidade com a LGPD (Lei n 13.709/2018) · Última atualização: 23/03/2026</p>
          </div>

          <Card className="p-4 border-primary/20 bg-primary/5">
            <p className="text-[12px] text-foreground/80 leading-relaxed">
              A Norte Gestão está comprometida com a proteção dos seus dados pessoais e com o cumprimento da Lei Geral de Proteção de Dados Pessoais (LGPD — Lei n 13.709/2018). Esta Política descreve como coletamos, utilizamos, armazenamos, compartilhamos e protegemos suas informações.
            </p>
          </Card>

          {[
            { title: "1. Controlador de Dados", content: "O controlador dos dados pessoais tratados nesta Política é a empresa responsável pela plataforma Norte Gestão.\n\nE-mail do Encarregado (DPO): privacidade@chatbanana.com.br\nSite: www.chatbanana.com.br\n\nCada empresa (tenant) que utiliza a plataforma atua como controladora independente em relação aos dados de seus próprios clientes finais, sendo a Norte Gestão operadora nessa relação." },
            { title: "2. Dados Pessoais Coletados", content: "Dados dos Clientes: Nome completo, e-mail, dados de pagamento (via Stripe), registros de acesso.\n\nDados dos Leads/Contatos: Número de telefone WhatsApp, nome, histórico de mensagens, informações adicionais no CRM, gravações de áudio transcritas via IA.\n\nDados de Uso: Logs de automações, campanhas disparadas, interações na plataforma." },
            { title: "3. Finalidade e Base Legal", content: "Execução de contrato (Art. 7, V): fornecer o Serviço, processar pagamentos.\nLegítimo interesse (Art. 7, IX): melhorar a plataforma, prevenir fraudes.\nCumprimento de obrigação legal (Art. 7, II): exigências do Marco Civil da Internet.\nConsentimento (Art. 7, I): comunicações de marketing." },
            { title: "4. Compartilhamento de Dados", content: "A Norte Gestão não vende dados pessoais. Compartilhamos apenas com: provedores de infraestrutura, Stripe (pagamentos), OpenAI (processamento de IA), Meta WhatsApp Cloud API, integrações ativadas pelo Cliente, e autoridades competentes quando exigido por lei." },
            { title: "5. Segurança dos Dados", content: "Autenticação com JWT e senhas com hash seguro (scrypt), isolamento por workspace (multi-tenancy), comunicações via HTTPS/TLS, acesso restrito da equipe técnica, monitoramento contínuo." },
            { title: "6. Retenção e Exclusão", content: "Dados de conta ativa: mantidos durante a vigência da assinatura.\nApós cancelamento: preservados por 30 dias para exportação.\nLogs de acesso: 6 meses (Marco Civil).\nDados financeiros: 5 anos (legislação tributária)." },
            { title: "7. Direitos dos Titulares (LGPD)", content: "Confirmação e acesso, correção, anonimização/bloqueio/eliminação, portabilidade, eliminação de dados por consentimento, informação sobre compartilhamento, revogação do consentimento, oposição ao tratamento.\n\nContato: privacidade@chatbanana.com.br — resposta em até 15 dias úteis." },
            { title: "8. Cookies", content: "A plataforma utiliza cookies essenciais para autenticação e sessão. Não utilizamos cookies de rastreamento para fins publicitários." },
            { title: "9. Transferência Internacional", content: "Alguns fornecedores (OpenAI, Stripe) processam dados fora do Brasil, com salvaguardas adequadas conforme Art. 33 da LGPD." },
            { title: "10. Proteção de Menores", content: "O Serviço é destinado exclusivamente a pessoas jurídicas e maiores de 18 anos." },
            { title: "11. Alterações nesta Política", content: "Alterações relevantes serão comunicadas por e-mail ou notificação na plataforma." },
            { title: "12. Contato e DPO", content: "E-mail DPO: privacidade@chatbanana.com.br\nSuporte: suporte@chatbanana.com.br\nSite: www.chatbanana.com.br\nANPD: www.gov.br/anpd" },
          ].map((section, i) => (
            <Card key={i} className="p-0 overflow-hidden">
              <div className="px-5 py-2.5 border-b bg-muted/30">
                <span className="text-[12px] font-semibold">{section.title}</span>
              </div>
              <div className="px-5 py-3">
                <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-line">{section.content}</p>
              </div>
            </Card>
          ))}

          <Card className="p-4 border-emerald-500/20 bg-emerald-500/5 text-center">
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
              Documento em conformidade com a LGPD — Lei n 13.709/2018
            </p>
          </Card>

          <p className="text-[10px] text-center text-muted-foreground pt-2">
            2026 Norte Gestão. Todos os direitos reservados.
          </p>
        </div>
    </div>
  );
}

export default function Perfil() {
  const [activeTab, setActiveTab] = useState<TabId>("perfil");
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [triggerAvatarModal, setTriggerAvatarModal] = useState(false);
  const { toast } = useToast();

  const loadProfile = useCallback(async () => {
    const fallback = authService.getUser();
    if (fallback) {
      setUser(fallback);
    }
    try {
      const token = localStorage.getItem("flowcrm_token");
      if (!token) {
        setLoading(false);
        return;
      }
      const res = await apiRequest("GET", "/api/perfil/me");
      const json = await res.json();
      if (json.ok && json.data) {
        setUser(json.data);
        localStorage.setItem("flowcrm_user", JSON.stringify(json.data));
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleUpdate = (updatedUser: any) => {
    setUser(updatedUser);
    localStorage.setItem("flowcrm_user", JSON.stringify(updatedUser));
    window.dispatchEvent(new Event("flowcrm-user-updated"));
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loading-perfil">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-[13px] text-muted-foreground">Carregando perfil...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="page-perfil">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <Avatar className="w-8 h-8 rounded-lg border-2 border-primary/30">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} className="rounded-lg" />}
            <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-primary/70 text-white text-[11px] font-bold">
              {getInitials(user.nome || "U")}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h1 className="text-[15px] font-semibold tracking-tight" data-testid="text-perfil-title">Meu Perfil</h1>
            <p className="text-[11px] text-muted-foreground">{user.nome} · {user.cargo || user.role || "Usuário"}</p>
          </div>
          <Badge variant="outline" className={`text-[10px] ${user.online ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" : "bg-muted/30 text-muted-foreground border-border"}`} data-testid="badge-online-status">
            <span className={`w-1.5 h-1.5 rounded-full inline-block mr-1 ${user.online ? "bg-emerald-400" : "bg-muted-foreground"}`} />
            {user.online ? "Online" : "Offline"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => authService.logout()}
            data-testid="button-logout"
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
            Sair
          </Button>
        </div>
      </div>

      <div className="px-5 border-b flex gap-0.5 flex-shrink-0 overflow-x-auto">
        {ALL_TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`seg-tab ${active ? "seg-tab-active" : ""}`}
              data-testid={`tab-${t.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "perfil" && <TabPerfil user={user} onUpdate={handleUpdate} openAvatarModal={triggerAvatarModal} onAvatarModalOpened={() => setTriggerAvatarModal(false)} />}
        {activeTab === "seguranca" && <TabSeguranca user={user} />}
        {activeTab === "preferencias" && <TabPreferencias user={user} />}
        {activeTab === "termos" && <TabTermos />}
        {activeTab === "privacidade" && <TabPrivacidade />}
      </div>
    </div>
  );
}
