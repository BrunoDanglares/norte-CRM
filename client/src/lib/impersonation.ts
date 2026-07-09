// Impersonação de tenant pelo super-admin ("modo visualização"). Centraliza TODO
// o estado num lugar só pra não divergir entre App, sidebar e modo Atendimento.
//
// Backup da sessão original (a do super-admin) fica em sessionStorage — sobrevive a
// navegações na mesma aba e ao F5, mas some quando a aba fecha. A sessão "ativa"
// (a do tenant) fica em localStorage (flowcrm_token/flowcrm_user), como qualquer login.
// Chaves "partnerToken"/"partnerUser" mantidas por compat com sessões já abertas.

const TOKEN_KEY = "flowcrm_token";
const USER_KEY = "flowcrm_user";
const BK_TOKEN = "partnerToken";
const BK_USER = "partnerUser";
const BK_RETURN = "impersonationReturnTo";

export function isImpersonating(): boolean {
  try {
    return typeof window !== "undefined" && !!sessionStorage.getItem(BK_TOKEN);
  } catch {
    return false;
  }
}

// Nome do tenant sendo visualizado (pra mostrar no banner/sidebar).
export function impersonatedUserName(): string {
  try {
    const u = localStorage.getItem(USER_KEY);
    if (u) return JSON.parse(u)?.nome || "Cliente";
  } catch {}
  return "Cliente";
}

// Salva a sessão atual (super-admin) e assume a sessão do tenant. `returnTo` é pra
// onde o "Voltar ao painel" leva — por padrão, o console do super-admin.
export function enterImpersonation(token: string, user: any, returnTo = "/super-admin"): void {
  try {
    const ownToken = localStorage.getItem(TOKEN_KEY);
    const ownUser = localStorage.getItem(USER_KEY);
    // Só faz backup se há uma sessão própria pra preservar e ainda não estamos
    // impersonando (não sobrescreve o backup do super-admin numa re-entrada).
    if (ownToken && ownUser && !sessionStorage.getItem(BK_TOKEN)) {
      sessionStorage.setItem(BK_TOKEN, ownToken);
      sessionStorage.setItem(BK_USER, ownUser);
      sessionStorage.setItem(BK_RETURN, returnTo);
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, typeof user === "string" ? user : JSON.stringify(user));
  } catch {}
}

// Restaura a sessão original e volta pro painel. ROBUSTO: navega SEMPRE (mesmo se o
// backup sumiu), pra nunca ficar preso no tenant. Se há backup, restaura o token do
// super-admin antes de sair. Hard reload (location.href) zera todo cache em memória
// (React Query) — sem isso sobraria dado do tenant na tela.
export function exitImpersonation(): void {
  let returnTo = "/super-admin";
  try {
    const pt = sessionStorage.getItem(BK_TOKEN);
    const pu = sessionStorage.getItem(BK_USER);
    returnTo = sessionStorage.getItem(BK_RETURN) || "/super-admin";
    if (pt && pu) {
      localStorage.setItem(TOKEN_KEY, pt);
      localStorage.setItem(USER_KEY, pu);
    }
    sessionStorage.removeItem(BK_TOKEN);
    sessionStorage.removeItem(BK_USER);
    sessionStorage.removeItem(BK_RETURN);
  } catch {}
  window.location.href = returnTo;
}
