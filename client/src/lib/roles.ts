import { authService } from "@/services/auth";

export type UserRole = "admin" | "manager" | "atendente" | string;

export function getUserRole(): UserRole {
  const u = authService.getUser();
  return (u?.role as UserRole) || "atendente";
}

export function isManagerOrAdmin(): boolean {
  const r = getUserRole();
  return r === "admin" || r === "manager" || r === "gerente";
}

export function isAtendenteOnly(): boolean {
  return !isManagerOrAdmin();
}

export function defaultLandingForRole(): string {
  // Bruno 2026-06-11: gestor/admin cai na tela inicial de boas-vindas (/inicio);
  // atendente continua direto no modo Atendimento.
  return isManagerOrAdmin() ? "/inicio" : "/atendimento";
}
