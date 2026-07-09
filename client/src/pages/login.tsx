import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Lock, AlertTriangle, Mail, KeyRound, ArrowLeft, Loader2, Rocket, ShieldCheck,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { authService } from "../services/auth";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";

type Mode = "password" | "codeRequest" | "codeVerify" | "googleSignup";

export default function Login() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [remember, setRemember] = useState(true); // "Manter conectado": lembra o e-mail
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  // Login por código (sem senha)
  const [code, setCode] = useState("");
  const [codeChannel, setCodeChannel] = useState<"email" | "whatsapp">("email");

  // Cadastro rápido via Google
  const [googleSignupToken, setGoogleSignupToken] = useState("");
  const [gNome, setGNome] = useState("");
  const [gEmail, setGEmail] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [plan, setPlan] = useState("trial");

  useEffect(() => {
    if (authService.isAuthenticated()) { setLocation("/"); return; }
    // "Manter conectado": pré-preenche o último e-mail usado (se salvo).
    const savedEmail = authService.getRememberedEmail();
    if (savedEmail) setEmail(savedEmail);
    authService.getConfig().then((c) => setGoogleClientId(c.googleClientId)).catch(() => {});
    // Handoff vindo do /register: usuário novo entrou com Google lá → conclui o
    // cadastro rápido aqui (token guardado por 1 navegação no sessionStorage).
    try {
      const raw = sessionStorage.getItem("pending_google_signup");
      if (raw) {
        sessionStorage.removeItem("pending_google_signup");
        const p = JSON.parse(raw);
        if (p?.googleSignupToken) {
          setGoogleSignupToken(p.googleSignupToken);
          setGEmail(p.email || "");
          setGNome(p.nome || "");
          setMode("googleSignup");
        }
      }
    } catch {}
  }, []);

  const finish = (data: { token: string; user: any }) => {
    authService.persistSession(data);
    setLocation("/");
  };

  // "Manter conectado": salva (ou esquece) o e-mail digitado pra pré-preencher
  // no próximo login. Chamado nos fluxos que usam o campo de e-mail.
  const applyRemember = () => {
    if (remember && email) authService.rememberEmail(email);
    else authService.forgetEmail();
  };

  // ── senha ───────────────────────────────────────────────────────────────
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !senha) { setError("Preencha todos os campos"); return; }
    setLoading(true);
    try {
      const res = await authService.login(email, senha);
      applyRemember();
      finish(res.data);
    } catch (err: any) {
      setError(err.message || "Email ou senha incorretos");
    } finally {
      setLoading(false);
    }
  };

  // ── Google ──────────────────────────────────────────────────────────────
  const handleGoogleCredential = async (credential: string) => {
    setError(""); setLoading(true);
    try {
      const data = await authService.loginWithGoogle(credential);
      if (data?.needsSignup) {
        setGoogleSignupToken(data.googleSignupToken);
        setGEmail(data.email || "");
        setGNome(data.nome || "");
        setWorkspaceName("");
        setMode("googleSignup");
      } else if (data?.token) {
        finish(data);
      }
    } catch (err: any) {
      setError(err.message || "Falha ao entrar com o Google");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!workspaceName.trim()) { setError("Informe o nome do seu provedor"); return; }
    setLoading(true);
    try {
      const data = await authService.completeGoogleSignup({
        googleSignupToken,
        workspace_name: workspaceName.trim(),
        selected_plan: plan,
      });
      finish(data);
    } catch (err: any) {
      setError(err.message || "Falha ao criar a conta");
    } finally {
      setLoading(false);
    }
  };

  // ── código (sem senha) ────────────────────────────────────────────────────
  const handleSendCode = async (channel: "email" | "whatsapp") => {
    setError(""); setInfo("");
    if (!email) { setError("Informe seu e-mail"); return; }
    setLoading(true);
    try {
      await authService.requestCode(email, channel);
      setCodeChannel(channel);
      setCode("");
      setMode("codeVerify");
      setInfo(
        channel === "whatsapp"
          ? "Se houver uma conta com esse e-mail e WhatsApp cadastrado, enviamos um código."
          : "Se houver uma conta com esse e-mail, enviamos um código.",
      );
    } catch (err: any) {
      setError(err.message || "Não foi possível enviar o código");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (code.length !== 6) { setError("Digite os 6 dígitos do código"); return; }
    setLoading(true);
    try {
      const data = await authService.verifyCode(email, code);
      applyRemember();
      finish(data);
    } catch (err: any) {
      setError(err.message || "Código inválido");
    } finally {
      setLoading(false);
    }
  };

  const errorBox = error && (
    <div
      className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2.5 flex items-center gap-2 text-[12.5px] text-destructive"
      role="alert"
      data-testid="text-login-error"
    >
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      {error}
    </div>
  );

  return (
    <AuthLayout logoHeight={120}>
      <div data-testid="page-login">
        {/* ════════════════ MODO: SENHA (padrão) ════════════════ */}
        {mode === "password" && (
          <>
            <div className="mb-6">
              <h2 className="text-[26px] font-bold tracking-tight text-[#1A1A1A]">Bem-vindo de volta</h2>
              <p className="text-[14px] text-neutral-500 mt-1">Faça login para continuar no seu painel.</p>
            </div>

            {googleClientId && (
              <div className="mb-4">
                <GoogleSignInButton clientId={googleClientId} onCredential={handleGoogleCredential} text="continue_with" />
                <div className="flex items-center gap-3 my-4">
                  <div className="h-px flex-1 bg-neutral-200" />
                  <span className="text-[11px] text-neutral-400 uppercase tracking-wider">ou</span>
                  <div className="h-px flex-1 bg-neutral-200" />
                </div>
              </div>
            )}

            <form onSubmit={handlePasswordLogin} className="space-y-3">
              <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus data-testid="input-login-email" />
              <Input label="Senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} data-testid="input-login-senha" />
              <label className="flex items-center gap-2 pt-0.5 cursor-pointer select-none w-fit" data-testid="label-login-remember">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                  data-testid="checkbox-login-remember"
                />
                <span className="text-[12.5px] text-neutral-600">Manter conectado e salvar meu e-mail</span>
              </label>
              {errorBox}
              <Button type="submit" disabled={loading} className="w-full gradient-accent gradient-accent-glow font-semibold text-[14px] h-11 mt-1" data-testid="button-login-submit">
                <Lock className="w-3.5 h-3.5 mr-1.5" />
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => { setError(""); setInfo(""); setMode("codeRequest"); }}
              className="mt-3 w-full flex items-center justify-center gap-1.5 text-[12.5px] text-neutral-600 hover:text-[#1A1A1A] transition-colors"
              data-testid="link-login-code"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Entrar com código (sem senha)
            </button>

            <div className="mt-5 text-center">
              <a href="/register" onClick={(e) => { e.preventDefault(); setLocation("/register"); }} className="text-[12.5px] text-neutral-500 hover:text-[#1A1A1A] transition-colors" data-testid="link-login-register">
                Não tem conta? <span className="font-semibold text-primary hover:underline">Criar conta grátis</span>
              </a>
            </div>
          </>
        )}

        {/* ════════════════ MODO: PEDIR CÓDIGO ════════════════ */}
        {mode === "codeRequest" && (
          <>
            <div className="mb-6">
              <h2 className="text-[26px] font-bold tracking-tight text-[#1A1A1A]">Entrar com código</h2>
              <p className="text-[14px] text-neutral-500 mt-1">Enviamos um código de 6 dígitos. Sem precisar de senha.</p>
            </div>

            <div className="space-y-3">
              <Input label="E-mail da conta" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus data-testid="input-code-email" />
              {errorBox}
              <Button type="button" onClick={() => handleSendCode("email")} disabled={loading} className="w-full gradient-accent gradient-accent-glow font-semibold text-[14px] h-11" data-testid="button-code-email">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Mail className="w-4 h-4 mr-1.5" />}
                Receber código por e-mail
              </Button>
              <Button type="button" variant="outline" onClick={() => handleSendCode("whatsapp")} disabled={loading} className="w-full font-semibold text-[14px] h-11" data-testid="button-code-whatsapp">
                <SiWhatsapp className="w-4 h-4 mr-1.5 text-emerald-600" />
                Receber código por WhatsApp
              </Button>
            </div>

            <button type="button" onClick={() => { setError(""); setMode("password"); }} className="mt-4 w-full flex items-center justify-center gap-1.5 text-[12.5px] text-neutral-600 hover:text-[#1A1A1A] transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar para o login com senha
            </button>
          </>
        )}

        {/* ════════════════ MODO: VERIFICAR CÓDIGO ════════════════ */}
        {mode === "codeVerify" && (
          <>
            <div className="mb-6">
              <h2 className="text-[26px] font-bold tracking-tight text-[#1A1A1A]">Digite o código</h2>
              <p className="text-[14px] text-neutral-500 mt-1">
                Enviado por {codeChannel === "whatsapp" ? "WhatsApp" : "e-mail"} para <span className="font-medium text-[#1A1A1A]">{email}</span>.
              </p>
            </div>

            <form onSubmit={handleVerifyCode} className="space-y-4">
              {info && (
                <div className="bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2.5 text-[12px] text-neutral-600">{info}</div>
              )}
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="input-otp">
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {errorBox}
              <Button type="submit" disabled={loading || code.length !== 6} className="w-full gradient-accent gradient-accent-glow font-semibold text-[14px] h-11" data-testid="button-otp-verify">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <ShieldCheck className="w-4 h-4 mr-1.5" />}
                Entrar
              </Button>
            </form>

            <div className="mt-4 flex items-center justify-between text-[12.5px]">
              <button type="button" onClick={() => { setError(""); setInfo(""); setCode(""); setMode("codeRequest"); }} className="flex items-center gap-1.5 text-neutral-600 hover:text-[#1A1A1A] transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Trocar e-mail
              </button>
              <button type="button" onClick={() => handleSendCode(codeChannel)} disabled={loading} className="font-semibold text-[#B07F02] hover:text-[#7A5805] disabled:opacity-50">
                Reenviar código
              </button>
            </div>
          </>
        )}

        {/* ════════════════ MODO: CADASTRO RÁPIDO VIA GOOGLE ════════════════ */}
        {mode === "googleSignup" && (
          <>
            <div className="mb-5">
              <h2 className="text-[26px] font-bold tracking-tight text-[#1A1A1A]">Quase lá! 🎉</h2>
              <p className="text-[14px] text-neutral-500 mt-1">Confirme seus dados para começar.</p>
            </div>

            <div className="rounded-lg p-3 mb-3 bg-neutral-50 border border-neutral-200">
              <p className="text-[12px] text-neutral-600">Entrando como <span className="font-semibold text-[#1A1A1A]">{gNome}</span></p>
              <p className="text-[12px] text-neutral-500">{gEmail}</p>
            </div>

            <form onSubmit={handleGoogleSignup} className="space-y-3">
              <Input label="Nome do seu provedor" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} autoFocus data-testid="input-google-workspace" />
              <div>
                <label className="block text-[12px] font-medium text-neutral-600 mb-1.5">Plano</label>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="w-full h-11 rounded-lg border border-input bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring"
                  data-testid="select-google-plan"
                >
                  <option value="trial">Testar grátis por 14 dias</option>
                  <option value="essencial">Essencial</option>
                  <option value="crescimento">Crescimento</option>
                  <option value="profissional">Profissional</option>
                </select>
                <p className="text-[11px] text-neutral-400 mt-1">Você pode trocar de plano depois, na área de assinatura.</p>
              </div>
              {errorBox}
              <Button type="submit" disabled={loading} className="w-full gradient-accent gradient-accent-glow font-bold text-[14px] h-11 mt-1" data-testid="button-google-signup">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Rocket className="w-4 h-4 mr-1.5" />}
                {loading ? "Criando conta..." : "Criar conta e entrar"}
              </Button>
            </form>

            <button type="button" onClick={() => { setError(""); setMode("password"); }} className="mt-4 w-full flex items-center justify-center gap-1.5 text-[12.5px] text-neutral-600 hover:text-[#1A1A1A] transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Cancelar
            </button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
