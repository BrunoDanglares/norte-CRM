import { db } from "../db";
import { workspaces, users, authSessions } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Blocklist de tenants/usuários — bloqueio INSTANTÂNEO sem custo de DB por request.
//
// Bruno 2026-06-13: o painel Super Admin precisa BLOQUEAR um tenant (workspace)
// inteiro ou um usuário — barrando login novo E derrubando quem já está logado na
// hora. requireAuth é stateless (só verifica o JWT, sem ir ao banco), então manter
// um Set em memória dá O(1) por request. O Set é a fonte rápida; o banco
// (workspaces.status='blocked' / users.status='INACTIVE') é a fonte durável,
// carregada no boot e mantida em sincronia pelas ações do painel.
//
// Quando o status passa a bloqueado, requireAuth devolve 401 → o front faz
// handle401() → derruba pro /login. O login, por sua vez, recusa workspace/usuário
// bloqueado (ver auth.ts). Por isso o bloqueio é imediato e o cara não volta.
//
// Marcador de workspace bloqueado = status === 'blocked' (valor NOVO e explícito).
// NÃO tratamos 'INACTIVE' legado de workspace como bloqueio — pra não derrubar por
// engano tenants antigos que tenham status estranho e que hoje funcionam (o status
// de workspace nunca foi enforçado até agora).
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_WS_STATUS = "blocked";
// Tenant ARQUIVADO (soft-delete via Super Admin): some da lista e fica barrado
// igual bloqueado. Reversível por restoreWorkspace. NÃO apaga dados.
const ARCHIVED_WS_STATUS = "deleted";

const blockedWorkspaces = new Set<string>();
const blockedUsers = new Set<number>();

/** Carrega o estado durável do banco pra memória. Chamado no boot. */
export async function loadBlocklist(): Promise<void> {
  try {
    const ws = await db.select({ id: workspaces.id, status: workspaces.status }).from(workspaces);
    blockedWorkspaces.clear();
    for (const w of ws) if (w.status === BLOCKED_WS_STATUS || w.status === ARCHIVED_WS_STATUS) blockedWorkspaces.add(w.id);

    const us = await db.select({ id: users.id, status: users.status }).from(users);
    blockedUsers.clear();
    for (const u of us) if (u.status === "INACTIVE") blockedUsers.add(u.id);

    console.log(`[Blocklist] carregada: ${blockedWorkspaces.size} workspace(s) e ${blockedUsers.size} usuário(s) bloqueado(s)`);
  } catch (e: any) {
    console.error("[Blocklist] erro ao carregar:", e.message);
  }
}

/** Checagem síncrona O(1) usada pelo requireAuth e pelo login. */
export function isBlocked(workspaceId?: string | null, userId?: number | null): boolean {
  if (workspaceId && blockedWorkspaces.has(workspaceId)) return true;
  if (userId && blockedUsers.has(userId)) return true;
  return false;
}

export function isWorkspaceBlocked(workspaceId?: string | null): boolean {
  return !!workspaceId && blockedWorkspaces.has(workspaceId);
}

export function isUserBlocked(userId?: number | null): boolean {
  return !!userId && blockedUsers.has(userId);
}

/** Bloqueia/desbloqueia um WORKSPACE inteiro. Persiste o status, atualiza a memória
 *  e (ao bloquear) faz force-logout fechando as sessões abertas do workspace. */
export async function setWorkspaceBlocked(workspaceId: string, blocked: boolean): Promise<void> {
  await db.update(workspaces)
    .set({ status: blocked ? BLOCKED_WS_STATUS : "ACTIVE", updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  if (blocked) {
    blockedWorkspaces.add(workspaceId);
    // Force-logout: marca como encerradas as sessões abertas do workspace (higiene
    // + auditoria). O bloqueio real já vale na hora via requireAuth/blocklist.
    await db.update(authSessions)
      .set({ logoutAt: new Date() })
      .where(and(eq(authSessions.workspaceId, workspaceId), isNull(authSessions.logoutAt)))
      .catch(() => {});
  } else {
    blockedWorkspaces.delete(workspaceId);
  }
}

/** Bloqueia/desbloqueia um USUÁRIO. Persiste status, atualiza memória e (ao
 *  bloquear) fecha as sessões abertas dele. */
export async function setUserBlocked(userId: number, blocked: boolean): Promise<void> {
  await db.update(users)
    .set({ status: blocked ? "INACTIVE" : "ACTIVE" })
    .where(eq(users.id, userId));

  if (blocked) {
    blockedUsers.add(userId);
    await db.update(authSessions)
      .set({ logoutAt: new Date() })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.logoutAt)))
      .catch(() => {});
  } else {
    blockedUsers.delete(userId);
  }
}

/** Arquiva (soft-delete) um WORKSPACE: status='deleted', barra login (entra na
 *  blocklist) e derruba as sessões abertas. Some da lista do Super Admin. NÃO
 *  apaga dados — reversível por restoreWorkspace. Purga real de dados só via
 *  script supervisionado (88 tabelas com workspace_id, FKs mistas). */
export async function archiveWorkspace(workspaceId: string): Promise<void> {
  await db.update(workspaces)
    .set({ status: ARCHIVED_WS_STATUS, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
  blockedWorkspaces.add(workspaceId);
  await db.update(authSessions)
    .set({ logoutAt: new Date() })
    .where(and(eq(authSessions.workspaceId, workspaceId), isNull(authSessions.logoutAt)))
    .catch(() => {});
}

/** Restaura um workspace arquivado: volta status='ACTIVE' e sai da blocklist. */
export async function restoreWorkspace(workspaceId: string): Promise<void> {
  await db.update(workspaces)
    .set({ status: "ACTIVE", updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
  blockedWorkspaces.delete(workspaceId);
}
