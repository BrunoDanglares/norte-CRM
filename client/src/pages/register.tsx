import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  UserPlus, AlertTriangle, Check, Loader2, Rocket, Eye, EyeOff,
} from "lucide-react";
import { authService } from "../services/auth";
import { NorteBrand } from "@/components/brand/NorteBrand";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

export default function Register() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({
    workspace_name: "",
    nome: "",
    email: "",
    senha: "",
    confirm_senha: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("invite")) return;
    if (authService.isAuthenticated()) {
      setLocation("/");
      return;
    }
    authService.getConfig().then((c) => {
      setGoogleClientId(c.googleClientId);
      setTurnstileSiteKey(c.turnstileSiteKey ?? null);
    }).catch(() => {});
  }, []);

  // Entrar/cadastrar com Google. Conta existente → entra direto; conta nova →
  // manda o estado pro /login concluir o cadastro rápido pré-preenchido.
  const handleGoogleCredential = async (credential: string) => {
    setError(""); setLoading(true);
    try {
      const data = await authService.loginWithGoogle(credential);
      if (data?.needsSignup) {
        sessionStorage.setItem("pending_google_signup", JSON.stringify({
          googleSignupToken: data.googleSignupToken,
          email: data.email,
          nome: data.nome,
        }));
        setLocation("/login");
      } else if (data?.token) {
        authService.persistSession(data);
        setLocation("/");
      }
    } catch (err: any) {
      setError(err.message || "Falha ao entrar com o Google");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    if (error) setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.workspace_name || !form.nome || !form.email || !form.senha || !form.confirm_senha) {
      setError("Preencha todos os campos obrigatorios");
      return;
    }
    if (form.senha.length < 8) {
      setError("Senha deve ter no minimo 8 caracteres");
      return;
    }
    if (form.senha !== form.confirm_senha) {
      setError("As senhas nao coincidem");
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError("Complete a verificação de segurança.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_name: form.workspace_name,
          nome: form.nome,
          email: form.email,
          senha: form.senha,
          account_type: "gestor",
          selected_plan: "free",
          turnstileToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar conta");

      localStorage.setItem("flowcrm_token", data.data.token);
      localStorage.setItem("flowcrm_user", JSON.stringify(data.data.user));

      setLocation("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = (() => {
    const s = form.senha;
    if (!s) return { level: 0, label: "", color: "" };
    let score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (/[A-Z]/.test(s)) score++;
    if (/[0-9]/.test(s)) score++;
    if (/[^A-Za-z0-9]/.test(s)) score++;
    if (score <= 1) return { level: 1, label: "Fraca", color: "bg-red-500" };
    if (score <= 2) return { level: 2, label: "Razoavel", color: "bg-yellow-500" };
    if (score <= 3) return { level: 3, label: "Boa", color: "bg-primary" };
    return { level: 4, label: "Forte", color: "bg-emerald-500" };
  })();

  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");

  if (inviteToken) {
    return <RegisterInvite token={inviteToken} />;
  }

  return (
    <AuthLayout logoHeight={88}>
      <div data-testid="page-register">
        <div className="mb-4">
          <h1 className="text-[24px] font-extrabold text-[#1A1A1A] leading-tight tracking-[-0.02em]">
            Registre-se
          </h1>
          <p className="text-[13px] text-neutral-500 mt-1">
            Crie sua conta em segundos e comece o teste grátis de 14 dias.
          </p>
        </div>

        {googleClientId && (
          <div className="mb-3">
            <GoogleSignInButton clientId={googleClientId} onCredential={handleGoogleCredential} text="signup_with" />
            <div className="flex items-center gap-3 my-3">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="text-[11px] text-neutral-400 uppercase tracking-wider">ou cadastre com e-mail</span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>
          </div>
        )}

        {/* autoComplete desligado: a tela de cadastro NÃO deve receber o autofill
            de credenciais salvas do navegador (e-mail/senha do login). Os campos
            de senha usam "new-password" pra o Chrome tratar como criação de conta
            (não oferece a senha salva) — isso também impede o autofill do e-mail. */}
        <form onSubmit={handleSubmit} className="space-y-2.5" autoComplete="off">
          <Input
            label="Nome completo"
            value={form.nome}
            onChange={handleChange("nome")}
            className="h-[52px]"
            autoComplete="off"
            data-testid="input-register-nome"
          />
          <Input
            label="E-mail"
            type="email"
            value={form.email}
            onChange={handleChange("email")}
            className="h-[52px]"
            autoComplete="off"
            data-testid="input-register-email"
          />
          <Input
            label="Nome do seu provedor"
            value={form.workspace_name}
            onChange={handleChange("workspace_name")}
            className="h-[52px]"
            autoComplete="off"
            data-testid="input-register-workspace"
          />
          <div>
            <Input
              label="Senha"
              type={showPassword ? "text" : "password"}
              value={form.senha}
              onChange={handleChange("senha")}
              className="h-[52px]"
              autoComplete="new-password"
              data-testid="input-register-senha"
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-toggle-password"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            {form.senha && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex gap-0.5 flex-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        i <= passwordStrength.level ? passwordStrength.color : "bg-neutral-200"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10.5px] text-neutral-500 font-medium">{passwordStrength.label}</span>
              </div>
            )}
          </div>
          <div>
            <Input
              label="Confirmar senha"
              type={showConfirm ? "text" : "password"}
              value={form.confirm_senha}
              onChange={handleChange("confirm_senha")}
              className="h-[52px]"
              autoComplete="new-password"
              data-testid="input-register-confirm"
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-toggle-confirm"
                  aria-label={showConfirm ? "Ocultar confirmação" : "Mostrar confirmação"}
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            {form.confirm_senha && form.senha !== form.confirm_senha && (
              <p className="text-[10.5px] text-destructive mt-1">As senhas não coincidem</p>
            )}
          </div>

          {error && (
            <div
              className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 flex items-center gap-2 text-[12.5px] text-destructive"
              role="alert"
              data-testid="text-register-error"
            >
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />

          <Button
            type="submit"
            disabled={loading}
            className="w-full gradient-accent gradient-accent-glow font-bold text-[14px] h-11 mt-1"
            data-testid="button-register-submit"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Rocket className="w-4 h-4 mr-1.5" />}
            {loading ? "Criando conta..." : "Criar conta grátis"}
          </Button>
        </form>

        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
          {["Sem cartão de crédito", "Sem fidelidade", "Cancele quando quiser"].map((t) => (
            <span key={t} className="flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-600" />
              {t}
            </span>
          ))}
        </div>

        <div className="mt-2.5 text-center">
          <a
            href="/login"
            onClick={(e) => { e.preventDefault(); setLocation("/login"); }}
            className="text-[12.5px] text-neutral-500 hover:text-[#1A1A1A] transition-colors"
            data-testid="link-register-login"
          >
            Já tem conta?{" "}
            <span className="font-semibold text-[#B07F02] hover:text-[#7A5805]">Fazer login</span>
          </a>
        </div>
      </div>
    </AuthLayout>
  );
}

function RegisterInvite({ token }: { token: string }) {
  const [, setLocation] = useLocation();
  const [info, setInfo] = useState<any>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/partner/invites/info?token=${token}`)
      .then(r => r.json())
      .then(d => { setInfo(d.data); setLoadingInfo(false); })
      .catch(() => setLoadingInfo(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Senha deve ter no mínimo 8 caracteres"); return; }
    if (password !== confirmPassword) { setError("As senhas não coincidem"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar conta");
      localStorage.setItem("flowcrm_token", data.data.token);
      localStorage.setItem("flowcrm_user", JSON.stringify(data.data.user));
      setLocation("/inbox");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!info || info.status !== "pending" || info.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-2">Convite inválido</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {info?.expired ? "Este convite expirou." : info?.status === "accepted" ? "Este convite já foi utilizado." : "Convite não encontrado."}
          </p>
          <Button onClick={() => setLocation("/login")} className="gradient-accent gradient-accent-glow">
            Ir para login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative bg-background flex items-center justify-center p-4 overflow-hidden" data-testid="page-register-invite">
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(180deg, hsl(var(--primary) / 0.08) 0%, transparent 360px),' +
            'radial-gradient(circle at 10% 16%, hsl(var(--primary) / 0.14) 0%, transparent 38%),' +
            'radial-gradient(circle at 90% 88%, hsl(var(--primary) / 0.10) 0%, transparent 42%)',
        }}
      />
      <div className="w-[440px] relative z-10">
        <div className="text-center mb-5">
          <div
            className="flex justify-center mb-3"
            style={{ filter: "drop-shadow(0 8px 18px hsl(var(--primary) / 0.20))" }}
          >
            <NorteBrand size={72} />
          </div>
          <div
            className="rounded-xl p-3.5 mb-1 border"
            style={{
              background: "var(--banana-50)",
              borderColor: "var(--banana-400)",
            }}
          >
            <p className="text-[13px] font-semibold text-foreground">
              Você foi convidado por <span style={{ color: "var(--banana-700)" }}>{info.partnerName}</span>
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-1">
              para usar o ChatBanana como <strong className="text-foreground">{info.businessName}</strong>
            </p>
          </div>
        </div>

        <div
          className="bg-card border rounded-2xl p-6 shadow-lg"
          style={{
            borderColor: "var(--banana-300)",
            boxShadow: "0 8px 32px -8px rgba(184,138,11,0.18), 0 2px 6px -1px rgba(0,0,0,0.04)",
          }}
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="rounded-lg p-3 mb-1 bg-secondary/60 border border-border">
              <p className="text-[11.5px] text-muted-foreground">
                Nome: <span className="text-foreground font-medium">{info.clientName}</span>
              </p>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                Empresa: <span className="text-foreground font-medium">{info.businessName}</span>
              </p>
            </div>

            <Input
              label="Crie sua senha"
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              className="bg-card border-border"
              data-testid="input-invite-password"
              rightElement={
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
            <Input
              label="Confirmar senha"
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
              className="bg-card border-border"
              data-testid="input-invite-confirm"
            />

            {error && (
              <div
                className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 flex items-center gap-2 text-[12.5px] text-destructive"
                role="alert"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full gradient-accent gradient-accent-glow font-semibold text-[13.5px] h-10"
              data-testid="button-invite-submit"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <UserPlus className="w-3.5 h-3.5 mr-1.5" />}
              {loading ? "Criando conta..." : "Aceitar convite e começar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
