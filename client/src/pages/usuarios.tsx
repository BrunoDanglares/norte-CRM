import { useState, useMemo, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users,
  Shield,
  Crown,
  UserCircle,
  Pencil,
  Trash2,
  Mail,
  UserPlus,
  MoreVertical,
  Target,
  MessageSquare,
  Search,
  Trophy,
  Medal,
  Award,
  Plus,
  Minus,
  ToggleLeft,
  ToggleRight,
  ShoppingCart,
  Headphones,
  DollarSign,
  LayoutGrid,
  Copy,
  Check,
  Link2,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import { getInitials } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/page/PageShell";

type TabKey = "equipe" | "equipes" | "permissoes" | "performance";

export interface UserRow {
  id: number;
  nome: string;
  email: string;
  cargo: string | null;
  telefone: string | null;
  avatarUrl: string | null;
  role: string;
  status: string;
  online: boolean;
  ultimoAcesso: string | null;
  equipes: string[];
  performance: { leads_mes: number; conversas_mes: number };
}

export interface TeamRow {
  id: string;
  nome: string;
  descricao: string | null;
  pipelineKey: string | null;
  fixed: boolean;
  active: boolean;
  leader: { id: number; nome: string; avatarUrl: string | null } | null;
  members: { id: number; nome: string; email: string; avatarUrl: string | null; role: string }[];
}

export interface PermRow {
  id: string;
  role: string;
  canViewAllLeads: boolean;
  canEditOthersLeads: boolean;
  canViewReports: boolean;
  canManageConnections: boolean;
  canManageAutomations: boolean;
  canExportData: boolean;
  canInviteUsers: boolean;
  canViewDashboard: boolean;
  canUseChat: boolean;
  canManagePipeline: boolean;
  canManageCampaigns: boolean;
  canManageInstaProspect: boolean;
  canManageISP: boolean;
  canManageWorkspace: boolean;
}

const PERM_GROUPS: { group: string; perms: { key: string; label: string }[] }[] = [
  {
    group: "Acesso Geral",
    perms: [
      { key: "canViewDashboard", label: "Ver Dashboard" },
      { key: "canUseChat", label: "Usar Chat / Inbox" },
      { key: "canViewReports", label: "Ver relatórios" },
      { key: "canExportData", label: "Exportar dados" },
    ],
  },
  {
    group: "Contatos e Pipeline",
    perms: [
      { key: "canViewAllLeads", label: "Ver todos os contatos" },
      { key: "canEditOthersLeads", label: "Editar contatos de outros" },
      { key: "canManagePipeline", label: "Gerenciar pipeline / etapas" },
    ],
  },
  {
    group: "Automação e IA",
    perms: [
      { key: "canManageAutomations", label: "Gerenciar automações (IA)" },
      { key: "canManageInstaProspect", label: "Gerenciar InstaProspect" },
      { key: "canManageCampaigns", label: "Gerenciar campanhas / disparos" },
    ],
  },
  {
    group: "Configurações",
    perms: [
      { key: "canManageConnections", label: "Gerenciar conexões (WhatsApp/IG)" },
      { key: "canManageWorkspace", label: "Configurar workspace" },
      { key: "canInviteUsers", label: "Convidar usuários" },
    ],
  },
];

const PERM_LABELS = PERM_GROUPS.flatMap(g => g.perms);

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  gerente: "Gerente",
  atendente: "Atendente",
  manager: "Gerente",
  agent: "Atendente",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30",
  gerente: "bg-primary/20 text-tertiary-600 dark:text-tertiary-500 border-primary/30",
  atendente: "bg-base-200 text-base-content/70 border-base-300",
  manager: "bg-primary/20 text-tertiary-600 dark:text-tertiary-500 border-primary/30",
  agent: "bg-base-200 text-base-content/70 border-base-300",
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  INACTIVE: "bg-red-500/20 text-rose-600 dark:text-rose-400 border-red-500/30",
  INVITED: "bg-yellow-500/20 text-amber-600 dark:text-amber-400 border-yellow-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  INVITED: "Convidado",
};

const PIPELINE_META: Record<string, { icon: any; color: string; label: string }> = {
  comercial: { icon: ShoppingCart, color: "#7c5cbf", label: "Comercial" },
  vendas: { icon: ShoppingCart, color: "#7c5cbf", label: "Comercial" },
  suporte: { icon: Headphones, color: "#5b93d3", label: "Suporte" },
  financeiro: { icon: DollarSign, color: "#10b981", label: "Financeiro" },
};

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 35%)`;
}

export default function UsuariosPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/workspace?tab=usuarios-equipes");
  }, [setLocation]);

  return null;
}

export function TabEquipe({
  users,
  loading,
  limit,
  teams,
  toast,
}: {
  users: UserRow[];
  loading: boolean;
  limit: { used: number; limit: number; plano: string; nextPlano: string | null };
  teams: TeamRow[];
  toast: any;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("atendente");
  const [invTeams, setInvTeams] = useState<string[]>([]);
  const [editNome, setEditNome] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCargo, setEditCargo] = useState("");
  const [editTel, setEditTel] = useState("");
  const [editRole, setEditRole] = useState("atendente");
  const [editSenha, setEditSenha] = useState("");
  const [showEditPass, setShowEditPass] = useState(false);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<UserRow | null>(null);

  const meId = (() => { try { const u = localStorage.getItem("flowcrm_user"); return u ? JSON.parse(u).id : null; } catch { return null; } })();

  const seatPct = limit.limit > 0 ? Math.round((limit.used / limit.limit) * 100) : 0;
  const seatColor = seatPct >= 90 ? "text-rose-600 dark:text-rose-400" : seatPct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  const progressBarColor = seatPct >= 90 ? "[&>div]:bg-red-500" : seatPct >= 70 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-emerald-500";
  const limitReached = limit.used >= limit.limit;
  const nearLimit = limit.used === limit.limit - 1;

  const toggleInvTeam = (tid: string) => {
    setInvTeams(prev => prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]);
  };

  const inviteMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/usuarios/invite", {
        email: invEmail,
        role: invRole,
        equipe_ids: invTeams.length > 0 ? invTeams : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      toast({ title: `Convite enviado para ${invEmail}` });
      setInviteOpen(false);
      setInvEmail("");
      setInvRole("atendente");
      setInvTeams([]);
    },
    onError: (e: any) => toast({ title: "Erro ao convidar", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editUser) return;
      await apiRequest("PUT", `/api/usuarios/${editUser.id}`, {
        nome: editNome,
        email: editEmail || undefined,
        cargo: editCargo || null,
        telefone: editTel || null,
        role: editRole,
        ...(editSenha.trim().length >= 6 ? { senha: editSenha.trim() } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Usuário atualizado" });
      setEditOpen(false);
      setEditSenha("");
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/usuarios/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      toast({ title: "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/usuarios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      toast({ title: "Usuário removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  function openEdit(u: UserRow) {
    setEditUser(u);
    setEditNome(u.nome);
    setEditEmail(u.email || "");
    setEditCargo(u.cargo || "");
    setEditTel(u.telefone || "");
    setEditRole(u.role);
    setEditSenha("");
    setShowEditPass(false);
    setEditOpen(true);
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-card/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 bg-background page-banana-wash min-h-full">
      {/* Bruno 2026-05-15: header padrão Banana Trail aplicado. */}
      <PageHeader
        title="Usuários"
        subtitle={`${users.length} ${users.length === 1 ? "membro na equipe" : "membros na equipe"}`}
        actions={
          <Button
            size="sm"
            className={`gradient-accent gradient-accent-glow h-9 gap-1.5 text-[12px] font-bold ${limitReached ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => !limitReached && setInviteOpen(true)}
            disabled={limitReached}
            data-testid="button-invite-user"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Convidar Usuário
          </Button>
        }
        className="mb-5"
      />

      {limitReached && (
        <Card className="mb-4 p-3 bg-yellow-500/10 border-yellow-500/30" data-testid="banner-limit-reached">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-amber-600 dark:text-amber-400">
              Limite de usuários atingido. Faça upgrade do seu plano para adicionar mais membros.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] border-yellow-500/30 text-amber-600 dark:text-amber-400 hover:bg-yellow-500/10"
              onClick={() => window.location.href = "/billing"}
              data-testid="button-view-plans"
            >
              Ver Planos
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="grid-users">
        {users.map((u) => {
          return (
            <Card key={u.id} className="p-4" data-testid={`card-user-${u.id}`}>
              <div className="flex items-start gap-3">
                <div className="relative">
                  <Avatar className="w-11 h-11">
                    <AvatarFallback
                      className="text-[13px] font-bold text-white"
                      style={{ backgroundColor: avatarColor(u.nome) }}
                    >
                      {getInitials(u.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${
                      u.online ? "bg-emerald-400 animate-pulse" : "bg-base-300"
                    }`}
                    data-testid={`indicator-online-${u.id}`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[13px] truncate" data-testid={`text-user-name-${u.id}`}>
                      {u.nome}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 ${ROLE_COLORS[u.role] || ROLE_COLORS.atendente}`}
                      data-testid={`badge-role-${u.id}`}
                    >
                      {ROLE_LABELS[u.role] || u.role}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 ${STATUS_COLORS[u.status] || STATUS_COLORS.ACTIVE}`}
                      data-testid={`badge-status-${u.id}`}
                    >
                      {STATUS_LABELS[u.status] || u.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{u.cargo || "Sem cargo"}</div>
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      {u.performance.leads_mes} leads
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      {u.performance.conversas_mes} conversas
                    </span>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-user-${u.id}`}>
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(u)} data-testid={`menuitem-edit-${u.id}`}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      Editar
                    </DropdownMenuItem>
                    {u.status === "ACTIVE" ? (
                      <DropdownMenuItem
                        onClick={() => statusMut.mutate({ id: u.id, status: "INACTIVE" })}
                        data-testid={`menuitem-deactivate-${u.id}`}
                      >
                        <Minus className="w-3.5 h-3.5 mr-2" />
                        Desativar
                      </DropdownMenuItem>
                    ) : u.status === "INACTIVE" ? (
                      <DropdownMenuItem
                        onClick={() => statusMut.mutate({ id: u.id, status: "ACTIVE" })}
                        data-testid={`menuitem-activate-${u.id}`}
                      >
                        <Plus className="w-3.5 h-3.5 mr-2" />
                        Reativar
                      </DropdownMenuItem>
                    ) : null}
                    {u.id !== meId && (
                      <DropdownMenuItem
                        className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:text-rose-400"
                        onClick={() => setDeleteConfirmUser(u)}
                        data-testid={`menuitem-delete-${u.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-[420px]" data-testid="dialog-invite">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              Convidar Usuário
            </DialogTitle>
            <DialogDescription>Envie um convite por email para adicionar um novo membro.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input
                label="Email *"
                type="email"
                value={invEmail}
                onChange={(e) => setInvEmail(e.target.value)}
                data-testid="input-invite-email"
              />
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Função</Label>
              <Select value={invRole} onValueChange={setInvRole}>
                <SelectTrigger className="mt-1" data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gerente">Gerente</SelectItem>
                  <SelectItem value="atendente">Atendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {teams.length > 0 && (
              <div>
                <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Equipe(s)</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {teams.map((t) => (
                    <Badge
                      key={t.id}
                      variant={invTeams.includes(t.id) ? "default" : "outline"}
                      className={`cursor-pointer text-[10px] px-2 py-1 transition-colors ${invTeams.includes(t.id) ? "bg-primary text-primary-foreground" : ""}`}
                      onClick={() => toggleInvTeam(t.id)}
                      data-testid={`badge-invite-team-${t.id}`}
                    >
                      <Users className="w-2.5 h-2.5 mr-1" />{t.nome}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          {nearLimit && (
            <Card className="p-2.5 bg-yellow-500/10 border-yellow-500/30" data-testid="warn-near-limit">
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                Após este convite, você atingirá o limite do plano {limit.plano}.
              </span>
            </Card>
          )}
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancelar</Button>
            <Button
              className="gradient-accent gradient-accent-glow text-white"
              onClick={() => inviteMut.mutate()}
              disabled={inviteMut.isPending || !invEmail.includes("@")}
              data-testid="button-send-invite"
            >
              <Mail className="w-3.5 h-3.5 mr-1.5" />
              {inviteMut.isPending ? "Enviando..." : "Enviar Convite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) { setEditSenha(""); setShowEditPass(false); } }}>
        <DialogContent className="sm:max-w-[420px]" data-testid="dialog-edit-user">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              Editar Usuário
            </DialogTitle>
            <DialogDescription>Atualize os dados do membro da equipe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input label="Nome" value={editNome} onChange={(e) => setEditNome(e.target.value)} data-testid="input-edit-nome" />
            </div>
            <div>
              <Input label="Email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} data-testid="input-edit-email" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Input label="Cargo" value={editCargo} onChange={(e) => setEditCargo(e.target.value)} data-testid="input-edit-cargo" />
              </div>
              <div>
                <Input label="Telefone" value={editTel} onChange={(e) => setEditTel(e.target.value)} data-testid="input-edit-telefone" />
              </div>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Função</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="mt-1" data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="gerente">Gerente</SelectItem>
                  <SelectItem value="atendente">Atendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Input
                label="Nova Senha (deixe em branco para manter)"
                type={showEditPass ? "text" : "password"}
                value={editSenha}
                onChange={(e) => setEditSenha(e.target.value)}
                data-testid="input-edit-senha"
                rightElement={
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setShowEditPass(p => !p)}>
                    {showEditPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                }
              />
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button
              className="gradient-accent gradient-accent-glow text-white"
              onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending}
              data-testid="button-save-edit"
            >
              {updateMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmUser} onOpenChange={(open) => { if (!open) setDeleteConfirmUser(null); }}>
        <DialogContent className="sm:max-w-[380px]" data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400"><Trash2 className="w-4 h-4" /> Excluir Membro</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{deleteConfirmUser?.nome}</strong> da equipe? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-1">
            <p className="text-[11px] text-red-300">O usuário será desativado e removido permanentemente do workspace, incluindo todas as atribuições de equipes.</p>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setDeleteConfirmUser(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteConfirmUser) { deleteMut.mutate(deleteConfirmUser.id); setDeleteConfirmUser(null); } }}
              disabled={deleteMut.isPending}
              data-testid="button-confirm-delete-user"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {deleteMut.isPending ? "Removendo..." : "Sim, Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TabEquipes({
  teams,
  loading,
  users,
  toast,
}: {
  teams: TeamRow[];
  loading: boolean;
  users: UserRow[];
  toast: any;
}) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRow | null>(null);
  const [managingTeam, setManagingTeam] = useState<TeamRow | null>(null);
  const [teamNome, setTeamNome] = useState("");
  const [teamDesc, setTeamDesc] = useState("");
  const [teamLeader, setTeamLeader] = useState("");
  const [teamPipelineKey, setTeamPipelineKey] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const { data: pipelinesData } = useQuery<any[]>({ queryKey: ["/api/pipelines"] });

  const createMut = useMutation({
    mutationFn: async () => {
      const leaderId = teamLeader && teamLeader !== "none" ? parseInt(teamLeader) : null;
      if (editingTeam) {
        await apiRequest("PUT", `/api/equipes/${editingTeam.id}`, {
          nome: teamNome,
          descricao: teamDesc || null,
          leader_id: leaderId,
          pipeline_key: teamPipelineKey || undefined,
        });
      } else {
        await apiRequest("POST", "/api/equipes", {
          nome: teamNome,
          descricao: teamDesc || null,
          leader_id: leaderId,
          pipeline_key: teamPipelineKey,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      toast({ title: editingTeam ? "Equipe atualizada" : "Equipe criada" });
      setTeamOpen(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/equipes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Equipe removida" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("PATCH", `/api/equipes/${id}/toggle-active`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Status da equipe atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const addMemberMut = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: number }) => {
      await apiRequest("POST", `/api/equipes/${teamId}/membros`, { user_id: userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Membro adicionado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const removeMemberMut = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: number }) => {
      await apiRequest("DELETE", `/api/equipes/${teamId}/membros/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Membro removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  function openNewTeam() {
    setEditingTeam(null);
    setTeamNome("");
    setTeamDesc("");
    setTeamLeader("");
    setTeamPipelineKey("");
    setTeamOpen(true);
  }

  function openEditTeam(t: TeamRow) {
    setEditingTeam(t);
    setTeamNome(t.nome);
    setTeamDesc(t.descricao || "");
    setTeamLeader(t.leader?.id?.toString() || "");
    setTeamPipelineKey(t.pipelineKey || "");
    setTeamOpen(true);
  }

  function openMembers(t: TeamRow) {
    setManagingTeam(t);
    setMemberSearch("");
    setMembersOpen(true);
  }

  const currentTeam = useMemo(() => {
    if (!managingTeam) return null;
    return teams.find((t) => t.id === managingTeam.id) || managingTeam;
  }, [teams, managingTeam]);

  const availableUsers = useMemo(() => {
    if (!currentTeam) return [];
    const memberIds = new Set(currentTeam.members.map((m) => m.id));
    return users.filter(
      (u) => !memberIds.has(u.id) && u.nome.toLowerCase().includes(memberSearch.toLowerCase())
    );
  }, [currentTeam, users, memberSearch]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 bg-card/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-[18px]">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] text-muted-foreground">{teams.length} equipes</span>
        <Button size="sm" className="gradient-accent gradient-accent-glow text-white" onClick={openNewTeam} data-testid="button-new-team">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Nova Equipe
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {teams.map((t) => {
          const pm = PIPELINE_META[t.pipelineKey || ""] || { icon: LayoutGrid, color: "#666", label: t.pipelineKey || "" };
          const PIco = pm.icon;
          return (
          <Card key={t.id} className={`p-4 ${t.active === false ? "opacity-50" : ""}`} style={{ borderLeft: `3px solid ${pm.color}` }} data-testid={`card-team-${t.id}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <PIco className="w-4 h-4 flex-shrink-0" style={{ color: pm.color }} />
                  <span className="font-bold text-[13px]" data-testid={`text-team-name-${t.id}`}>{t.nome}</span>
                  {t.fixed && <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-tertiary-600 dark:text-tertiary-500">Nativa</Badge>}
                  {t.active === false && <Badge variant="outline" className="text-[8px] px-1 py-0 border-red-500/30 text-rose-600 dark:text-rose-400">Inativa</Badge>}
                </div>
                {t.descricao && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">{t.descricao}</div>
                )}
                {t.pipelineKey && (
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0 mt-1" style={{ borderColor: `${pm.color}40`, color: pm.color }}>
                    Pipeline: {pm.label}
                  </Badge>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-team-${t.id}`}>
                    <MoreVertical className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditTeam(t)}>
                    <Pencil className="w-3.5 h-3.5 mr-2" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openMembers(t)}>
                    <Users className="w-3.5 h-3.5 mr-2" />
                    Gerenciar membros
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggleActiveMut.mutate(t.id)}>
                    {t.active === false
                      ? <><ToggleRight className="w-3.5 h-3.5 mr-2 text-green-600 dark:text-green-400" /> Ativar</>
                      : <><ToggleLeft className="w-3.5 h-3.5 mr-2 text-amber-600 dark:text-amber-400" /> Inativar</>}
                  </DropdownMenuItem>
                  {!t.fixed && (
                    <DropdownMenuItem className="text-rose-600 dark:text-rose-400" onClick={() => deleteMut.mutate(t.id)}>
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Excluir
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {t.leader && (
              <div className="flex items-center gap-2 mb-3">
                <Crown className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                <Avatar className="w-5 h-5">
                  <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(t.leader.nome) }}>
                    {getInitials(t.leader.nome)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px]">{t.leader.nome}</span>
                <Badge variant="outline" className="text-[8px] px-1 py-0">Líder</Badge>
              </div>
            )}

            <div className="flex items-center gap-1">
              {t.members.slice(0, 5).map((m) => (
                <Avatar key={m.id} className="w-7 h-7 -ml-1 first:ml-0 border-2 border-card">
                  <AvatarFallback className="text-[9px] font-bold" style={{ backgroundColor: avatarColor(m.nome) }}>
                    {getInitials(m.nome)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {t.members.length > 5 && (
                <span className="text-[10px] text-muted-foreground ml-1">+{t.members.length - 5}</span>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {t.members.length} membro{t.members.length !== 1 ? "s" : ""}
              </span>
            </div>
          </Card>
          );
        })}
      </div>

      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="sm:max-w-[400px]" data-testid="dialog-team-form">
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Editar Equipe" : "Nova Equipe"}</DialogTitle>
            <DialogDescription>
              {editingTeam ? "Atualize os dados da equipe." : "Crie uma nova equipe para organizar seus membros."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input label="Nome *" value={teamNome} onChange={(e) => setTeamNome(e.target.value)} data-testid="input-team-name" />
            </div>
            <div>
              <Input label="Descrição" value={teamDesc} onChange={(e) => setTeamDesc(e.target.value)} data-testid="input-team-desc" />
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Líder</Label>
              <Select value={teamLeader} onValueChange={setTeamLeader}>
                <SelectTrigger className="mt-1" data-testid="select-team-leader">
                  <SelectValue placeholder="Selecionar líder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id.toString()}>{u.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Atribuir Pipeline *</Label>
              <Select value={teamPipelineKey} onValueChange={setTeamPipelineKey}>
                <SelectTrigger className="mt-1" data-testid="select-team-pipeline">
                  <SelectValue placeholder="Selecionar pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {(pipelinesData || []).map((p: any) => (
                    <SelectItem key={p.id} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setTeamOpen(false)}>Cancelar</Button>
            <Button
              className="gradient-accent gradient-accent-glow text-white"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !teamNome.trim() || !teamPipelineKey}
              data-testid="button-save-team"
            >
              {createMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="dialog-manage-members">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Gerenciar Membros — {currentTeam?.nome}
            </DialogTitle>
            <DialogDescription>Adicione ou remova membros da equipe.</DialogDescription>
          </DialogHeader>

          {currentTeam && currentTeam.members.length > 0 && (
            <div className="mb-3">
              <div className="text-[10.5px] font-bold text-muted-foreground uppercase mb-2">
                Membros atuais ({currentTeam.members.length})
              </div>
              <div className="space-y-1">
                {currentTeam.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-md bg-base-200/50">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(m.nome) }}>
                        {getInitials(m.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[12px] flex-1">{m.nome}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-rose-600 dark:text-rose-400 hover:text-red-300"
                      onClick={() => removeMemberMut.mutate({ teamId: currentTeam.id, userId: m.id })}
                      data-testid={`button-remove-member-${m.id}`}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[10.5px] font-bold text-muted-foreground uppercase mb-2">
              Adicionar membros
            </div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Buscar usuário..."
                className="pl-8 h-8 text-[12px]"
                data-testid="input-search-member"
              />
            </div>
            <div className="space-y-1 max-h-[200px] overflow-auto">
              {availableUsers.length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-3">
                  Nenhum usuário disponível
                </div>
              ) : (
                availableUsers.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-base-200/40">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(u.nome) }}>
                        {getInitials(u.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[12px] flex-1">{u.nome}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-emerald-600 dark:text-emerald-400 hover:text-emerald-300"
                      onClick={() => addMemberMut.mutate({ teamId: currentTeam!.id, userId: u.id })}
                      data-testid={`button-add-member-${u.id}`}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-3 text-[11px] border-dashed"
              onClick={() => {
                setMembersOpen(false);
                // Setters do invite (setDirTeams/setInviteMode/setInviteResult/setInviteOpen)
                // foram movidos para o componente pai num refactor; nesse escopo só
                // fecha o modal de membros. Botão segue visível como CTA.
              }}
              data-testid="button-create-new-attendant"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5" />
              Criar novo atendente
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Setores opcionais (Bruno 2026-06-11) — flexibilização por provedor ────────
// Liga/desliga Vendas / Retenção / Suporte N2. Default OFF. Ao ligar, o backend
// cria a equipe + a coluna do Kanban e passa a desviar o fluxo correspondente.
export function TabUsuariosEquipes({
  users,
  loading,
  limit,
  teams,
  teamsLoading,
  toast,
}: {
  users: UserRow[];
  loading: boolean;
  limit: { used: number; limit: number; plano: string; nextPlano: string | null };
  teams: TeamRow[];
  teamsLoading: boolean;
  toast: any;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("atendente");
  const [invTeams, setInvTeams] = useState<string[]>([]);
  const [editNome, setEditNome] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCargo, setEditCargo] = useState("");
  const [editTel, setEditTel] = useState("");
  const [editRole, setEditRole] = useState("atendente");
  const [editSenha, setEditSenha] = useState("");
  const [showEditPass, setShowEditPass] = useState(false);

  const [inviteMode, setInviteMode] = useState<"email" | "direto">("email");
  const [inviteResult, setInviteResult] = useState<{ link: string; emailSent: boolean } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [teamOpen, setTeamOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamRow | null>(null);
  const [managingTeam, setManagingTeam] = useState<TeamRow | null>(null);
  const [teamNome, setTeamNome] = useState("");
  const [teamDesc, setTeamDesc] = useState("");
  const [teamLeader, setTeamLeader] = useState("");
  const [teamPipelineKey, setTeamPipelineKey] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<UserRow | null>(null);

  const [dirNome, setDirNome] = useState("");
  const [dirEmail, setDirEmail] = useState("");
  const [dirSenha, setDirSenha] = useState("");
  const [dirCargo, setDirCargo] = useState("");
  const [dirRole, setDirRole] = useState("atendente");
  const [dirTeams, setDirTeams] = useState<string[]>([]);
  const [showDirPass, setShowDirPass] = useState(false);

  const meId = (() => { try { const u = localStorage.getItem("flowcrm_user"); return u ? JSON.parse(u).id : null; } catch { return null; } })();

  const seatPct = limit.limit > 0 ? Math.round((limit.used / limit.limit) * 100) : 0;
  const seatColor = seatPct >= 90 ? "text-rose-600 dark:text-rose-400" : seatPct >= 70 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  const progressBarColor = seatPct >= 90 ? "[&>div]:bg-red-500" : seatPct >= 70 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-emerald-500";
  const limitReached = limit.used >= limit.limit;
  const nearLimit = limit.used === limit.limit - 1;

  const toggleInvTeam = (tid: string) => {
    setInvTeams(prev => prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]);
  };
  const toggleDirTeam = (tid: string) => {
    setDirTeams(prev => prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]);
  };

  function resetInviteDialog() {
    setInvEmail(""); setInvRole("atendente"); setInvTeams([]);
    setDirNome(""); setDirEmail(""); setDirSenha(""); setDirCargo(""); setDirRole("atendente"); setDirTeams([]); setShowDirPass(false);
    setInviteResult(null); setCopiedLink(false); setInviteMode("email");
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link).then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2500); });
  }

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/usuarios/invite", {
        email: invEmail, role: invRole,
        equipe_ids: invTeams.length > 0 ? invTeams : undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      const link = data?.data?.invite_link || data?.invite_link || "";
      const emailSent = data?.data?.email_sent ?? data?.email_sent ?? false;
      setInviteResult({ link, emailSent });
    },
    onError: (e: any) => toast({ title: "Erro ao convidar", description: e.message, variant: "destructive" }),
  });

  const criarDiretoMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/usuarios/criar-direto", {
        nome: dirNome, email: dirEmail, senha: dirSenha, role: dirRole,
        cargo: dirCargo || null,
        equipe_ids: dirTeams.length > 0 ? dirTeams : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      toast({ title: `Atendente ${dirNome} cadastrado com sucesso!` });
      setInviteOpen(false);
      resetInviteDialog();
    },
    onError: (e: any) => toast({ title: "Erro ao cadastrar", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editUser) return;
      await apiRequest("PUT", `/api/usuarios/${editUser.id}`, {
        nome: editNome,
        email: editEmail || undefined,
        cargo: editCargo || null,
        telefone: editTel || null,
        role: editRole,
        ...(editSenha.trim().length >= 6 ? { senha: editSenha.trim() } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Usuário atualizado" });
      setEditOpen(false);
      setEditSenha("");
    },
    onError: (e: any) => toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/usuarios/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      toast({ title: "Status atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteUserMut = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/usuarios/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios/limit"] });
      toast({ title: "Usuário removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const createTeamMut = useMutation({
    mutationFn: async () => {
      const leaderId = teamLeader && teamLeader !== "none" ? parseInt(teamLeader) : null;
      if (editingTeam) {
        await apiRequest("PUT", `/api/equipes/${editingTeam.id}`, { nome: teamNome, descricao: teamDesc || null, leader_id: leaderId, pipeline_key: teamPipelineKey || undefined });
      } else {
        // Sem pipeline_key: o backend cria um funil próprio com o nome da equipe.
        await apiRequest("POST", "/api/equipes", { nome: teamNome, descricao: teamDesc || null, leader_id: leaderId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipelines"] });
      toast({ title: editingTeam ? "Equipe atualizada" : "Equipe criada" });
      setTeamOpen(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteTeamMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/equipes/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Equipe removida" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleTeamActiveMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("PATCH", `/api/equipes/${id}/toggle-active`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Status da equipe atualizado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const addMemberMut = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: number }) => {
      await apiRequest("POST", `/api/equipes/${teamId}/membros`, { user_id: userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Membro adicionado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const removeMemberMut = useMutation({
    mutationFn: async ({ teamId, userId }: { teamId: string; userId: number }) => {
      await apiRequest("DELETE", `/api/equipes/${teamId}/membros/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usuarios"] });
      toast({ title: "Membro removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  function openEdit(u: UserRow) {
    setEditUser(u); setEditNome(u.nome); setEditEmail(u.email || "");
    setEditCargo(u.cargo || ""); setEditTel(u.telefone || "");
    setEditRole(u.role); setEditSenha(""); setShowEditPass(false); setEditOpen(true);
  }
  function openNewTeam() { setEditingTeam(null); setTeamNome(""); setTeamDesc(""); setTeamLeader(""); setTeamPipelineKey(""); setTeamOpen(true); }
  function openEditTeam(t: TeamRow) { setEditingTeam(t); setTeamNome(t.nome); setTeamDesc(t.descricao || ""); setTeamLeader(t.leader?.id?.toString() || ""); setTeamPipelineKey(t.pipelineKey || ""); setTeamOpen(true); }
  function openMembers(t: TeamRow) { setManagingTeam(t); setMemberSearch(""); setMembersOpen(true); }

  const currentTeam = useMemo(() => {
    if (!managingTeam) return null;
    return teams.find((t) => t.id === managingTeam.id) || managingTeam;
  }, [teams, managingTeam]);

  const availableUsers = useMemo(() => {
    if (!currentTeam) return [];
    const memberIds = new Set(currentTeam.members.map((m) => m.id));
    return users.filter((u) => !memberIds.has(u.id) && u.nome.toLowerCase().includes(memberSearch.toLowerCase()));
  }, [currentTeam, users, memberSearch]);

  if (loading && teamsLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (<div key={i} className="h-24 bg-card/50 rounded-lg animate-pulse" />))}
      </div>
    );
  }

  return (
    <div className="p-5">
      {limitReached && (
        <Card className="mb-5 p-3.5 bg-yellow-500/10 border-yellow-500/30 rounded-xl" data-testid="banner-limit-reached">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-amber-600 dark:text-amber-400">
              Limite de usuários atingido. Faça upgrade do seu plano para adicionar mais membros.
            </span>
            <Button size="sm" variant="outline" className="text-[11px] border-yellow-500/30 text-amber-600 dark:text-amber-400 hover:bg-yellow-500/10"
              onClick={() => window.location.href = "/billing"} data-testid="button-view-plans">
              Ver Planos
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Membros</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">{users.length}</Badge>
          </div>
          <Button
            size="sm"
            className={`gradient-accent gradient-accent-glow text-white ${limitReached ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => !limitReached && setInviteOpen(true)}
            disabled={limitReached}
            data-testid="button-invite-user"
          >
            <UserPlus className="w-3.5 h-3.5 mr-1.5" />
            + Novo Atendente
          </Button>
        </div>
        <div className="p-4">
          <Table data-testid="grid-users">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] font-medium uppercase tracking-wider text-base-content/70">Usuário</TableHead>
                <TableHead className="text-[10px] font-medium uppercase tracking-wider text-base-content/70">Função</TableHead>
                <TableHead className="text-[10px] font-medium uppercase tracking-wider text-base-content/70">Status</TableHead>
                <TableHead className="text-[10px] font-medium uppercase tracking-wider text-base-content/70 text-center">Contatos</TableHead>
                <TableHead className="text-[10px] font-medium uppercase tracking-wider text-base-content/70 text-center">Conversas</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className="group" data-testid={`card-user-${u.id}`}>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="w-9 h-9">
                          <AvatarFallback className="text-[11px] font-bold text-white" style={{ backgroundColor: avatarColor(u.nome) }}>
                            {getInitials(u.nome)}
                          </AvatarFallback>
                        </Avatar>
                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${u.online ? "bg-emerald-400" : "bg-base-300"}`}
                          data-testid={`indicator-online-${u.id}`} />
                      </div>
                      <div>
                        <span className="font-semibold text-[12.5px] block" data-testid={`text-user-name-${u.id}`}>{u.nome}</span>
                        <span className="text-[10.5px] text-muted-foreground">{u.cargo || "Sem cargo"}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${ROLE_COLORS[u.role] || ROLE_COLORS.atendente}`} data-testid={`badge-role-${u.id}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${STATUS_COLORS[u.status] || STATUS_COLORS.ACTIVE}`} data-testid={`badge-status-${u.id}`}>
                      {STATUS_LABELS[u.status] || u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-[11px] text-muted-foreground">{u.performance.leads_mes}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-[11px] text-muted-foreground">{u.performance.conversas_mes}</span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`menu-user-${u.id}`}>
                          <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(u)} data-testid={`menuitem-edit-${u.id}`}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> Editar
                        </DropdownMenuItem>
                        {u.status === "ACTIVE" ? (
                          <DropdownMenuItem onClick={() => statusMut.mutate({ id: u.id, status: "INACTIVE" })} data-testid={`menuitem-deactivate-${u.id}`}>
                            <Minus className="w-3.5 h-3.5 mr-2" /> Desativar
                          </DropdownMenuItem>
                        ) : u.status === "INACTIVE" ? (
                          <DropdownMenuItem onClick={() => statusMut.mutate({ id: u.id, status: "ACTIVE" })} data-testid={`menuitem-activate-${u.id}`}>
                            <Plus className="w-3.5 h-3.5 mr-2" /> Reativar
                          </DropdownMenuItem>
                        ) : null}
                        {u.id !== meId && (
                          <DropdownMenuItem className="text-rose-600 dark:text-rose-400 focus:text-rose-600 dark:text-rose-400" onClick={() => setDeleteConfirmUser(u)} data-testid={`menuitem-delete-${u.id}`}>
                            <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Equipes</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">{teams.length}</Badge>
          </div>
          <Button size="sm" className="gradient-accent gradient-accent-glow text-white" onClick={openNewTeam} data-testid="button-new-team">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Nova Equipe
          </Button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="grid-teams">
          {teams.map((t) => {
            const pMeta = PIPELINE_META[t.pipelineKey || ""] || { icon: LayoutGrid, color: "#666", label: t.pipelineKey || "" };
            const PipeIcon = pMeta.icon;
            return (
            <Card key={t.id} className={`p-4 border-border/60 ${t.active === false ? "opacity-50" : ""}`} style={{ borderLeft: `3px solid ${pMeta.color}` }} data-testid={`card-team-${t.id}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <PipeIcon className="w-4 h-4 flex-shrink-0" style={{ color: pMeta.color }} />
                    <span className="font-bold text-[13px]" data-testid={`text-team-name-${t.id}`}>{t.nome}</span>
                    {t.fixed && <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-tertiary-600 dark:text-tertiary-500">Nativa</Badge>}
                    {t.active === false && <Badge variant="outline" className="text-[8px] px-1 py-0 border-red-500/30 text-rose-600 dark:text-rose-400">Inativa</Badge>}
                  </div>
                  {t.descricao && <div className="text-[10.5px] text-muted-foreground mt-0.5">{t.descricao}</div>}
                  {t.pipelineKey && (
                    <div className="flex items-center gap-1 mt-1">
                      <Badge variant="outline" className="text-[8px] px-1.5 py-0" style={{ borderColor: `${pMeta.color}40`, color: pMeta.color }}>
                        Pipeline: {pMeta.label}
                      </Badge>
                    </div>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" data-testid={`menu-team-${t.id}`}>
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEditTeam(t)}><Pencil className="w-3.5 h-3.5 mr-2" /> Editar</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openMembers(t)}><Users className="w-3.5 h-3.5 mr-2" /> Gerenciar membros</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleTeamActiveMut.mutate(t.id)} data-testid={`toggle-team-active-${t.id}`}>
                      {t.active === false
                        ? <><ToggleRight className="w-3.5 h-3.5 mr-2 text-green-600 dark:text-green-400" /> Ativar</>
                        : <><ToggleLeft className="w-3.5 h-3.5 mr-2 text-amber-600 dark:text-amber-400" /> Inativar</>}
                    </DropdownMenuItem>
                    {!t.fixed && (
                      <DropdownMenuItem className="text-rose-600 dark:text-rose-400" onClick={() => deleteTeamMut.mutate(t.id)}>
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Excluir
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {t.leader && (
                <div className="flex items-center gap-2 mb-3">
                  <Crown className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <Avatar className="w-5 h-5">
                    <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(t.leader.nome) }}>
                      {getInitials(t.leader.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-[11px]">{t.leader.nome}</span>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">Líder</Badge>
                </div>
              )}
              <div className="flex items-center gap-1 pt-2 border-t border-border/40">
                {t.members.slice(0, 5).map((m) => (
                  <Avatar key={m.id} className="w-6 h-6 -ml-1 first:ml-0 border-2 border-card">
                    <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(m.nome) }}>
                      {getInitials(m.nome)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {t.members.length > 5 && <span className="text-[10px] text-muted-foreground ml-1">+{t.members.length - 5}</span>}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {t.members.length} membro{t.members.length !== 1 ? "s" : ""}
                </span>
              </div>
            </Card>
          );
          })}
        </div>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open) { setInviteOpen(false); resetInviteDialog(); } }}>
        <DialogContent className="sm:max-w-[440px]" data-testid="dialog-invite">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4" /> Adicionar Atendente</DialogTitle>
            <DialogDescription>Escolha como deseja adicionar o novo membro.</DialogDescription>
          </DialogHeader>

          {!inviteResult ? (
            <>
              <div className="flex gap-1 bg-muted/40 rounded-lg p-1 mb-1">
                <button
                  onClick={() => setInviteMode("email")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[11.5px] font-semibold transition-all ${inviteMode === "email" ? "bg-base-100 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="tab-invite-email"
                >
                  <Mail className="w-3.5 h-3.5" /> Convidar por Email
                </button>
                <button
                  onClick={() => setInviteMode("direto")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[11.5px] font-semibold transition-all ${inviteMode === "direto" ? "bg-base-100 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="tab-invite-direto"
                >
                  <KeyRound className="w-3.5 h-3.5" /> Cadastrar Direto
                </button>
              </div>

              {inviteMode === "email" ? (
                <div className="space-y-3">
                  <div>
                    <Input label="Email *" type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} data-testid="input-invite-email" />
                  </div>
                  <div>
                    <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Função</Label>
                    <Select value={invRole} onValueChange={setInvRole}>
                      <SelectTrigger className="mt-1" data-testid="select-invite-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gerente">Gerente</SelectItem>
                        <SelectItem value="atendente">Atendente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {teams.length > 0 && (
                    <div>
                      <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Equipe(s)</Label>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {teams.map((t) => (
                          <Badge key={t.id} variant={invTeams.includes(t.id) ? "default" : "outline"}
                            className={`cursor-pointer text-[10px] px-2 py-1 transition-colors ${invTeams.includes(t.id) ? "bg-primary text-primary-foreground" : ""}`}
                            onClick={() => toggleInvTeam(t.id)} data-testid={`badge-invite-team-${t.id}`}>
                            <Users className="w-2.5 h-2.5 mr-1" />{t.nome}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {nearLimit && (
                    <Card className="p-2.5 bg-yellow-500/10 border-yellow-500/30" data-testid="warn-near-limit">
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">Após este convite, você atingirá o limite do plano {limit.plano}.</span>
                    </Card>
                  )}
                  <DialogFooter className="mt-1">
                    <Button variant="ghost" onClick={() => { setInviteOpen(false); resetInviteDialog(); }}>Cancelar</Button>
                    <Button className="gradient-accent gradient-accent-glow text-white" onClick={() => inviteMut.mutate()}
                      disabled={inviteMut.isPending || !invEmail.includes("@")} data-testid="button-send-invite">
                      <Mail className="w-3.5 h-3.5 mr-1.5" /> {inviteMut.isPending ? "Gerando convite..." : "Gerar Convite"}
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Input label="Nome completo *" value={dirNome} onChange={(e) => setDirNome(e.target.value)} data-testid="input-dir-nome" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Input label="Email *" type="email" value={dirEmail} onChange={(e) => setDirEmail(e.target.value)} data-testid="input-dir-email" />
                    </div>
                    <div>
                      <Input label="Cargo" value={dirCargo} onChange={(e) => setDirCargo(e.target.value)} data-testid="input-dir-cargo" />
                    </div>
                  </div>
                  <div>
                    <Input
                      label="Senha *"
                      type={showDirPass ? "text" : "password"}
                      value={dirSenha}
                      onChange={(e) => setDirSenha(e.target.value)}
                      data-testid="input-dir-senha"
                      rightElement={
                        <button type="button" onClick={() => setShowDirPass(!showDirPass)} className="text-muted-foreground hover:text-foreground">
                          {showDirPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Função</Label>
                      <Select value={dirRole} onValueChange={setDirRole}>
                        <SelectTrigger className="mt-1" data-testid="select-dir-role"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gerente">Gerente</SelectItem>
                          <SelectItem value="atendente">Atendente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {teams.length > 0 && (
                    <div>
                      <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Equipe(s)</Label>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {teams.map((t) => (
                          <Badge key={t.id} variant={dirTeams.includes(t.id) ? "default" : "outline"}
                            className={`cursor-pointer text-[10px] px-2 py-1 transition-colors ${dirTeams.includes(t.id) ? "bg-primary text-primary-foreground" : ""}`}
                            onClick={() => toggleDirTeam(t.id)} data-testid={`badge-dir-team-${t.id}`}>
                            <Users className="w-2.5 h-2.5 mr-1" />{t.nome}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {nearLimit && (
                    <Card className="p-2.5 bg-yellow-500/10 border-yellow-500/30">
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">Após este cadastro, você atingirá o limite do plano {limit.plano}.</span>
                    </Card>
                  )}
                  <DialogFooter className="mt-1">
                    <Button variant="ghost" onClick={() => { setInviteOpen(false); resetInviteDialog(); }}>Cancelar</Button>
                    <Button className="gradient-accent gradient-accent-glow text-white" onClick={() => criarDiretoMut.mutate()}
                      disabled={criarDiretoMut.isPending || !dirNome.trim() || !dirEmail.includes("@") || dirSenha.length < 6}
                      data-testid="button-criar-direto">
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" /> {criarDiretoMut.isPending ? "Cadastrando..." : "Cadastrar Atendente"}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className={`rounded-xl p-4 border ${inviteResult.emailSent ? "bg-emerald-500/10 border-emerald-500/30" : "bg-primary/10 border-primary/30"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {inviteResult.emailSent
                    ? <><Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /><span className="text-[12.5px] font-bold text-emerald-600 dark:text-emerald-400">Email enviado para {invEmail}</span></>
                    : <><Mail className="w-4 h-4 text-tertiary-600 dark:text-tertiary-500" /><span className="text-[12.5px] font-bold text-tertiary-600 dark:text-tertiary-500">Convite gerado — compartilhe o link</span></>
                  }
                </div>
                {!inviteResult.emailSent && (
                  <p className="text-[11px] text-muted-foreground">Email não configurado. Copie e envie o link abaixo para o atendente.</p>
                )}
              </div>

              {inviteResult.link && (
                <div>
                  <Label className="text-[10.5px] font-bold text-muted-foreground uppercase flex items-center gap-1"><Link2 className="w-3 h-3" /> Link de Acesso</Label>
                  <div className="mt-1 flex gap-2">
                    <Input value={inviteResult.link} readOnly className="text-[11px] font-mono bg-muted/50" data-testid="input-invite-link" />
                    <Button variant="outline" size="icon" onClick={() => copyLink(inviteResult.link)} className="flex-shrink-0" data-testid="button-copy-link">
                      {copiedLink ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Válido por 48 horas. O atendente deve acessar este link para criar a conta.</p>
                </div>
              )}

              <DialogFooter>
                <Button className="w-full" variant="outline" onClick={() => { setInviteOpen(false); resetInviteDialog(); }} data-testid="button-close-invite-result">
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) { setEditSenha(""); setShowEditPass(false); } }}>
        <DialogContent className="sm:max-w-[420px]" data-testid="dialog-edit-user">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Editar Usuário</DialogTitle>
            <DialogDescription>Atualize os dados do membro da equipe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input label="Nome" value={editNome} onChange={(e) => setEditNome(e.target.value)} data-testid="input-edit-nome" />
            </div>
            <div>
              <Input label="Email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} data-testid="input-edit-email" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Input label="Cargo" value={editCargo} onChange={(e) => setEditCargo(e.target.value)} data-testid="input-edit-cargo" />
              </div>
              <div>
                <Input label="Telefone" value={editTel} onChange={(e) => setEditTel(e.target.value)} data-testid="input-edit-telefone" />
              </div>
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Função</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="mt-1" data-testid="select-edit-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="gerente">Gerente</SelectItem>
                  <SelectItem value="atendente">Atendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Input
                label="Nova Senha (deixe em branco para manter)"
                type={showEditPass ? "text" : "password"}
                value={editSenha}
                onChange={(e) => setEditSenha(e.target.value)}
                data-testid="input-edit-senha"
                rightElement={
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setShowEditPass(p => !p)}>
                    {showEditPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                }
              />
            </div>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button className="gradient-accent gradient-accent-glow text-white" onClick={() => updateMut.mutate()}
              disabled={updateMut.isPending} data-testid="button-save-edit">
              {updateMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmUser} onOpenChange={(open) => { if (!open) setDeleteConfirmUser(null); }}>
        <DialogContent className="sm:max-w-[380px]" data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400"><Trash2 className="w-4 h-4" /> Excluir Membro</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{deleteConfirmUser?.nome}</strong> da equipe? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mt-1">
            <p className="text-[11px] text-red-300">O usuário será desativado e removido permanentemente do workspace, incluindo todas as atribuições de equipes.</p>
          </div>
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setDeleteConfirmUser(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => { if (deleteConfirmUser) { deleteUserMut.mutate(deleteConfirmUser.id); setDeleteConfirmUser(null); } }}
              disabled={deleteUserMut.isPending}
              data-testid="button-confirm-delete-user"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {deleteUserMut.isPending ? "Removendo..." : "Sim, Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
        <DialogContent className="sm:max-w-[400px]" data-testid="dialog-team-form">
          <DialogHeader>
            <DialogTitle>{editingTeam ? "Editar Equipe" : "Nova Equipe"}</DialogTitle>
            <DialogDescription>{editingTeam ? "Atualize os dados da equipe." : "Crie uma nova equipe para organizar seus membros."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input label="Nome *" value={teamNome} onChange={(e) => setTeamNome(e.target.value)} data-testid="input-team-name" />
            </div>
            <div>
              <Input label="Descrição" value={teamDesc} onChange={(e) => setTeamDesc(e.target.value)} data-testid="input-team-desc" />
            </div>
            <div>
              <Label className="text-[10.5px] font-bold text-muted-foreground uppercase">Líder</Label>
              <Select value={teamLeader} onValueChange={setTeamLeader}>
                <SelectTrigger className="mt-1" data-testid="select-team-leader"><SelectValue placeholder="Selecionar líder" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {users.map((u) => (<SelectItem key={u.id} value={u.id.toString()}>{u.nome}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {!editingTeam && (
              <p className="text-[10.5px] text-muted-foreground leading-snug">
                Um funil/quadro próprio com o nome da equipe é criado automaticamente.
              </p>
            )}
          </div>
          <DialogFooter className="mt-3">
            <Button variant="ghost" onClick={() => setTeamOpen(false)}>Cancelar</Button>
            <Button className="gradient-accent gradient-accent-glow text-white" onClick={() => createTeamMut.mutate()}
              disabled={createTeamMut.isPending || !teamNome.trim()} data-testid="button-save-team">
              {createTeamMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="dialog-manage-members">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Gerenciar Membros — {currentTeam?.nome}
            </DialogTitle>
            <DialogDescription>Adicione ou remova membros da equipe.</DialogDescription>
          </DialogHeader>
          {currentTeam && currentTeam.members.length > 0 && (
            <div className="mb-3">
              <div className="text-[10.5px] font-bold text-muted-foreground uppercase mb-2">Membros atuais ({currentTeam.members.length})</div>
              <div className="space-y-1">
                {currentTeam.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-md bg-base-200/50">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(m.nome) }}>{getInitials(m.nome)}</AvatarFallback>
                    </Avatar>
                    <span className="text-[12px] flex-1">{m.nome}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-rose-600 dark:text-rose-400 hover:text-red-300"
                      onClick={() => removeMemberMut.mutate({ teamId: currentTeam.id, userId: m.id })} data-testid={`button-remove-member-${m.id}`}>
                      <Minus className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10.5px] font-bold text-muted-foreground uppercase mb-2">Adicionar membros</div>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Buscar usuário..."
                className="pl-8 h-8 text-[12px]" data-testid="input-search-member" />
            </div>
            <div className="space-y-1 max-h-[200px] overflow-auto">
              {availableUsers.length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-3">Nenhum usuário disponível</div>
              ) : (
                availableUsers.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 p-2 rounded-md hover:bg-base-200/40">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[8px] font-bold" style={{ backgroundColor: avatarColor(u.nome) }}>{getInitials(u.nome)}</AvatarFallback>
                    </Avatar>
                    <span className="text-[12px] flex-1">{u.nome}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600 dark:text-emerald-400 hover:text-emerald-300"
                      onClick={() => addMemberMut.mutate({ teamId: currentTeam!.id, userId: u.id })} data-testid={`button-add-member-${u.id}`}>
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TabPermissoes({
  perms,
  toast,
}: {
  perms: Record<string, PermRow>;
  toast: any;
}) {
  const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [dirty, setDirty] = useState(false);

  const roles = ["admin", "gerente", "atendente"] as const;

  const getVal = (role: string, key: string): boolean => {
    if (role === "admin") return true;
    if (localPerms[role]?.[key] !== undefined) return localPerms[role][key];
    const p = perms[role] || perms[role === "gerente" ? "manager" : role === "atendente" ? "agent" : role];
    if (!p) return false;
    return (p as any)[key] ?? false;
  };

  const toggle = (role: string, key: string) => {
    if (role === "admin") return;
    setLocalPerms((prev) => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [key]: !getVal(role, key) },
    }));
    setDirty(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      for (const role of ["gerente", "atendente"]) {
        if (!localPerms[role]) continue;
        const body: Record<string, boolean> = {};
        for (const { key } of PERM_LABELS) {
          const snakeKey = key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
          body[snakeKey] = getVal(role, key);
        }
        await apiRequest("PUT", `/api/permissoes/${role}`, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/permissoes"] });
      setLocalPerms({});
      setDirty(false);
      toast({ title: "Permissões salvas" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-5">
      <Card className="p-3.5 mb-5 bg-primary/5 border-primary/20 rounded-xl">
        <div className="text-[12px] text-muted-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary flex-shrink-0" />
          Configure o que cada função pode fazer no sistema. Admin sempre tem todas as permissões ativas.
        </div>
      </Card>

      <Card className="p-0 overflow-hidden" data-testid="table-permissions">
        <div className="px-5 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-muted-foreground" />
            <span className="text-[12px] font-bold">Matriz de Permissões</span>
          </div>
          <Button
            size="sm"
            className="gradient-accent gradient-accent-glow text-white"
            onClick={() => saveMut.mutate()}
            disabled={!dirty || saveMut.isPending}
            data-testid="button-save-permissions"
          >
            {saveMut.isPending ? "Salvando..." : "Salvar Permissões"}
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5 w-[240px] text-[10px] font-medium uppercase tracking-wider text-base-content/70">Permissão</TableHead>
              {roles.map((r) => (
                <TableHead key={r} className="text-center">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${ROLE_COLORS[r]}`}
                  >
                    {r === "admin" && <Crown className="w-3 h-3 mr-1" />}
                    {r === "gerente" && <Shield className="w-3 h-3 mr-1" />}
                    {r === "atendente" && <UserCircle className="w-3 h-3 mr-1" />}
                    {ROLE_LABELS[r]}
                  </Badge>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERM_GROUPS.map((group) => (
              <Fragment key={`group-${group.group}`}>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={4} className="pl-5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.group}
                  </TableCell>
                </TableRow>
                {group.perms.map(({ key, label }) => (
                  <TableRow key={key}>
                    <TableCell className="pl-7 text-[12px]">{label}</TableCell>
                    {roles.map((r) => (
                      <TableCell key={r} className="text-center">
                        <Switch
                          checked={getVal(r, key)}
                          onCheckedChange={() => toggle(r, key)}
                          disabled={r === "admin"}
                          data-testid={`switch-${r}-${key}`}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export function TabPerformance({
  users,
  loading,
}: {
  users: UserRow[];
  loading: boolean;
}) {
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");

  const activeUsers = useMemo(() => users.filter((u) => u.status === "ACTIVE"), [users]);

  const ranked = useMemo(() => {
    return [...activeUsers].sort((a, b) => b.performance.leads_mes - a.performance.leads_mes);
  }, [activeUsers]);

  const podium = ranked.slice(0, 3);

  const podiumIcons = [Trophy, Medal, Award];
  const podiumColors = ["text-amber-600 dark:text-amber-400", "text-zinc-300", "text-amber-600"];

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-card/50 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-[18px]">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] text-muted-foreground">{activeUsers.length} membros ativos</span>
        <div className="flex gap-1">
          {(["week", "month", "quarter"] as const).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "ghost"}
              size="sm"
              className="text-[11px] h-7"
              onClick={() => setPeriod(p)}
              data-testid={`button-period-${p}`}
            >
              {p === "week" ? "Esta semana" : p === "month" ? "Este mês" : "Este trimestre"}
            </Button>
          ))}
        </div>
      </div>

      {podium.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {podium.map((u, i) => {
            const PodiumIcon = podiumIcons[i];
            return (
              <Card
                key={u.id}
                className={`p-4 text-center ${i === 0 ? "border-yellow-500/30 bg-yellow-500/5" : ""}`}
                data-testid={`card-podium-${i}`}
              >
                <PodiumIcon className={`w-6 h-6 mx-auto mb-2 ${podiumColors[i]}`} />
                <Avatar className="w-12 h-12 mx-auto mb-2">
                  <AvatarFallback className="text-[14px] font-bold text-white" style={{ backgroundColor: avatarColor(u.nome) }}>
                    {getInitials(u.nome)}
                  </AvatarFallback>
                </Avatar>
                <div className="font-bold text-[13px]">{u.nome}</div>
                <div className="text-[11px] text-muted-foreground">{u.cargo || "Sem cargo"}</div>
                <div className="text-[18px] font-semibold text-base-content mt-2">{u.performance.leads_mes}</div>
                <div className="text-[10px] text-muted-foreground">leads no período</div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="space-y-3">
        {ranked.map((u, i) => {
          const avgResponse = Math.round(2 + Math.random() * 8);
          return (
            <Card key={u.id} className="p-4" data-testid={`card-perf-${u.id}`}>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold text-muted-foreground w-6 text-right">#{i + 1}</span>
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="text-[11px] font-bold text-white" style={{ backgroundColor: avatarColor(u.nome) }}>
                    {getInitials(u.nome)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[12px]">{u.nome}</div>
                  <div className="text-[10px] text-muted-foreground">{u.cargo || "Sem cargo"}</div>
                </div>
                <div className="flex gap-4 text-[11px]">
                  <div className="text-center">
                    <div className="font-bold text-primary">{u.performance.leads_mes}</div>
                    <div className="text-[9px] text-muted-foreground">Contatos</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold">{u.performance.conversas_mes}</div>
                    <div className="text-[9px] text-muted-foreground">Conversas</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold">{avgResponse}min</div>
                    <div className="text-[9px] text-muted-foreground">Resp. média</div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
