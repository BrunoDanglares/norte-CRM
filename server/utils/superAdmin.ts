// Identidade do SUPER ADMIN da plataforma (dono que gerencia os tenants no
// console /super-admin). Bruno 2026-06-13.
//
// Usado em 2 lugares: (1) /api/auth/me devolve isSuperAdmin pra sidebar mostrar o
// atalho "Super Gerencial" só pra ele; (2) requireSuperAdmin aceita a SESSÃO NORMAL
// do dono como credencial do console (sem pedir login separado) — "meu login já é
// a credencial do super admin".
//
// Configurável via env SUPER_ADMIN_EMAILS (lista separada por vírgula, lowercased).
// Se não setada, cai no dono (default). O console também aceita o login próprio por
// env SUPER_ADMIN_USER/PASS_HASH — isto é um caminho adicional, não substitui.

const DEFAULT_SUPER_ADMIN_EMAILS = ["danglaresb@gmail.com"];

export function superAdminEmails(): string[] {
  const env = (process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return env.length ? env : DEFAULT_SUPER_ADMIN_EMAILS;
}

export function isSuperAdminEmail(email?: string | null): boolean {
  return !!email && superAdminEmails().includes(email.toLowerCase());
}
