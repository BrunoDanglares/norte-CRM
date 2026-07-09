import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Shield, Users, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { NorteBrand } from "@/components/brand/NorteBrand";

interface InviteInfo {
  email: string;
  role: string;
  roleLabel: string;
  workspaceName: string;
  teams: string[];
  expiresAt: string;
}

export default function AceitarConvitePage() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [error, setError] = useState("");

  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [senhaConfirm, setSenhaConfirm] = useState("");
  const [cargo, setCargo] = useState("");
  const [telefone, setTelefone] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) { setError("Link de convite invalido. Solicite um novo convite ao administrador."); setLoadingInfo(false); return; }
    setToken(t);
    fetch(`/api/usuarios/convite/${t}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) setInviteInfo(data.data);
        else setError(data.error || "Convite invalido ou expirado.");
        setLoadingInfo(false);
      })
      .catch(() => { setError("Erro ao verificar convite."); setLoadingInfo(false); });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return setError("Informe seu nome.");
    if (senha.length < 6) return setError("A senha deve ter pelo menos 6 caracteres.");
    if (senha !== senhaConfirm) return setError("As senhas nao conferem.");
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/usuarios/aceitar-convite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_token: token, nome: nome.trim(), senha, cargo: cargo.trim() || null, telefone: telefone.trim() || null }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || "Erro ao aceitar convite."); setSubmitting(false); return; }
      localStorage.setItem("flowcrm_token", data.data.token);
      setSuccess(true);
      setTimeout(() => setLocation("/"), 2000);
    } catch { setError("Erro de conexao. Tente novamente."); setSubmitting(false); }
  }

  if (loadingInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0a0a12 0%, #12121e 50%, #0a0a12 100%)" }}>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0a0a12 0%, #12121e 50%, #0a0a12 100%)" }}>
        <Card className="w-full max-w-md p-8 text-center border-emerald-500/30 bg-emerald-500/5">
          <CheckCircle2 className="w-16 h-16 text-emerald-600 dark:text-emerald-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-foreground mb-2">Conta criada com sucesso!</h2>
          <p className="text-sm text-muted-foreground">Redirecionando para o sistema...</p>
        </Card>
      </div>
    );
  }

  if (!inviteInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #0a0a12 0%, #12121e 50%, #0a0a12 100%)" }}>
        <Card className="w-full max-w-md p-8 text-center border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-16 h-16 text-rose-600 dark:text-rose-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-foreground mb-2">Convite invalido</h2>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={() => setLocation("/login")} data-testid="button-go-login">
            Ir para Login
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-banana-50 via-white to-banana-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <NorteBrand size={48} />
          </div>
          <p className="text-sm text-muted-foreground">Complete seu cadastro para acessar o sistema</p>
        </div>

        <Card className="p-6 border-border/50" data-testid="card-invite-form">
          <div className="rounded-lg p-4 mb-5 border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-foreground">Detalhes do convite</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Workspace:</span>
                <span className="font-semibold text-foreground">{inviteInfo.workspaceName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Funcao:</span>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5" style={{ borderColor: "var(--banana-500)", color: "var(--banana-700)" }}>
                  {inviteInfo.roleLabel}
                </Badge>
              </div>
              {inviteInfo.teams.length > 0 && (
                <div className="flex justify-between items-start">
                  <span className="text-muted-foreground">Equipe(s):</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {inviteInfo.teams.map(t => (
                      <Badge key={t} variant="outline" className="text-[10px] px-2 py-0.5">
                        <Users className="w-2.5 h-2.5 mr-1" />{t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Email:</span>
                <span className="text-xs text-foreground">{inviteInfo.email}</span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              label="Nome completo *"
              value={nome}
              onChange={e => setNome(e.target.value)}
              data-testid="input-invite-nome"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Cargo"
                value={cargo}
                onChange={e => setCargo(e.target.value)}
                data-testid="input-invite-cargo"
              />
              <Input
                label="Telefone"
                value={telefone}
                onChange={e => setTelefone(e.target.value)}
                data-testid="input-invite-telefone"
              />
            </div>
            <Input
              label="Senha *"
              type={showPass ? "text" : "password"}
              value={senha}
              onChange={e => setSenha(e.target.value)}
              data-testid="input-invite-senha"
              rightElement={
                <button type="button" onClick={() => setShowPass(!showPass)} className="text-muted-foreground hover:text-foreground">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            <Input
              label="Confirmar senha *"
              type={showPass ? "text" : "password"}
              value={senhaConfirm}
              onChange={e => setSenhaConfirm(e.target.value)}
              data-testid="input-invite-senha-confirm"
            />

            {error && (
              <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400 bg-red-500/10 p-3 rounded-lg border border-red-500/20" data-testid="text-invite-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
              </div>
            )}

            <Button type="submit" className="w-full gradient-accent gradient-accent-glow text-white font-bold" disabled={submitting || !nome.trim() || senha.length < 6} data-testid="button-accept-invite">
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Criando conta...</> : "Criar Conta e Entrar"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button onClick={() => setLocation("/login")} className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back-login">
              Ja tem uma conta? Fazer login
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
