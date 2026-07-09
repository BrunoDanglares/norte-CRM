const API = "/api";

// Helper único de POST JSON com tratamento de servidor fora do ar / resposta
// não-JSON (mesmo padrão do login). Lança Error com mensagem amigável.
async function postJson(path: string, body: any) {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique sua internet.");
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Servidor indisponível (${res.status}). Tente novamente em instantes.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ocorreu um erro. Tente novamente.");
  return data;
}

export const authService = {
  // Guarda token + usuário no localStorage (sessão logada). Usado por todos os
  // caminhos de login (senha, Google, código).
  persistSession: (data: { token: string; user: any }) => {
    localStorage.setItem("flowcrm_token", data.token);
    localStorage.setItem("flowcrm_user", JSON.stringify(data.user));
  },

  // Config pública: qual login social está ligado (Google client id etc.).
  getConfig: async (): Promise<{ googleClientId: string | null; emailConfigured: boolean; turnstileSiteKey?: string | null }> => {
    try {
      const res = await fetch(`${API}/auth/config`);
      const data = await res.json();
      return data?.data || { googleClientId: null, emailConfigured: false, turnstileSiteKey: null };
    } catch {
      return { googleClientId: null, emailConfigured: false, turnstileSiteKey: null };
    }
  },

  // Entrar com Google. Retorna { token, user } OU { needsSignup, googleSignupToken, email, nome }.
  loginWithGoogle: async (credential: string) => {
    const data = await postJson("/auth/google", { credential });
    return data.data;
  },

  // Conclui o cadastro rápido pré-preenchido do Google. Retorna { token, user }.
  completeGoogleSignup: async (params: { googleSignupToken: string; workspace_name: string; selected_plan?: string }) => {
    const data = await postJson("/auth/google/complete-signup", params);
    return data.data;
  },

  // Pede um código de login (sem senha) por e-mail ou WhatsApp. Resposta genérica.
  requestCode: async (email: string, channel: "email" | "whatsapp") => {
    const data = await postJson("/auth/code/request", { email, channel });
    return data.data as { channel: string; ttlMinutes: number };
  },

  // Verifica o código e entra. Retorna { token, user }.
  verifyCode: async (email: string, code: string) => {
    const data = await postJson("/auth/code/verify", { email, code });
    return data.data;
  },

  login: async (email: string, senha: string) => {
    let res: Response;
    try {
      res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });
    } catch {
      throw new Error("Sem conexão com o servidor. Verifique sua internet.");
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Servidor indisponível (${res.status}). Tente novamente em instantes.`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao fazer login");
    return data;
  },

  me: async () => {
    const token = localStorage.getItem("flowcrm_token");
    if (!token) throw new Error("Sem token");
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Nao autenticado");
    return data;
  },

  logout: () => {
    const token = localStorage.getItem("flowcrm_token");
    const userStr = localStorage.getItem("flowcrm_user");
    if (token && userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u?.id) {
          fetch(`/api/usuarios/${u.id}/online`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ online: false }),
          }).catch(() => {});
        }
        // Fecha a sessão de auth (relatório de Logs de autenticação) na hora.
        fetch(`/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      } catch {}
    }
    localStorage.removeItem("flowcrm_token");
    localStorage.removeItem("flowcrm_user");
    window.location.href = "/login";
  },

  getToken: () => localStorage.getItem("flowcrm_token"),

  getUser: () => {
    const u = localStorage.getItem("flowcrm_user");
    return u ? JSON.parse(u) : null;
  },

  setUser: (user: any) => {
    localStorage.setItem("flowcrm_user", JSON.stringify(user));
  },

  isAuthenticated: () => !!localStorage.getItem("flowcrm_token"),

  // "Manter conectado" / "salvar dados": lembra o último e-mail usado pra
  // pré-preencher o login na próxima vez. Guardamos SÓ o e-mail (a senha fica
  // por conta do gerenciador do navegador). Bruno 2026-06-15.
  rememberEmail: (email: string) => {
    try { localStorage.setItem("flowcrm_remember_email", email.trim()); } catch {}
  },
  forgetEmail: () => {
    try { localStorage.removeItem("flowcrm_remember_email"); } catch {}
  },
  getRememberedEmail: (): string => {
    try { return localStorage.getItem("flowcrm_remember_email") || ""; } catch { return ""; }
  },
};
