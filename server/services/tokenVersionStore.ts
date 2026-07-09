// Revogação de sessão por VERSÃO de token (auditoria 2026-06-20).
//
// Problema: o JWT é stateless (7d) — logout e troca de senha NÃO invalidavam o token;
// só bloquear a conta inteira (status INACTIVE) revogava, e isso trancava o dono também.
//
// Solução: cada usuário tem `users.token_version` (int, default 0). O JWT carrega o `tv`
// vigente na emissão. logout / troca de senha / reset incrementam a versão → todos os
// tokens antigos daquele usuário caem (sai de TODOS os dispositivos).
//
// Performance: Map em memória userId→versão, carregado no boot + atualizado a cada bump
// (mesmo padrão do tenantBlocklist) — o requireAuth NÃO bate no banco por request.
// Processo único no EasyPanel (replicas=1), então o Map é autoritativo. Só guarda quem
// tem versão > 0; ausência do Map = versão 0 (default, a imensa maioria).

import { db } from "../db";
import { users } from "@shared/schema";
import { eq, gt, sql } from "drizzle-orm";

const versions = new Map<number, number>();

export async function loadTokenVersions(): Promise<void> {
  try {
    const rows = await db
      .select({ id: users.id, tv: users.tokenVersion })
      .from(users)
      .where(gt(users.tokenVersion, 0));
    versions.clear();
    for (const r of rows) versions.set(r.id, Number(r.tv ?? 0));
    console.log(`[TokenVersion] ${versions.size} usuário(s) com versão > 0`);
  } catch (e: any) {
    console.warn("[TokenVersion] load falhou (assumindo 0 pra todos):", e?.message);
  }
}

// Versão esperada pra validar no requireAuth. Ausente = 0 (nunca teve bump).
export function getExpectedTokenVersion(userId: number): number {
  return versions.get(userId) ?? 0;
}

// Incrementa a versão → invalida TODOS os tokens atuais do usuário. Best-effort: nunca
// derruba o fluxo chamador (logout/troca de senha). Atualiza o Map na hora.
export async function bumpTokenVersion(userId: number): Promise<number> {
  try {
    const [row] = await db
      .update(users)
      .set({ tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1` })
      .where(eq(users.id, userId))
      .returning({ tv: users.tokenVersion });
    const newTv = Number(row?.tv ?? (getExpectedTokenVersion(userId) + 1));
    versions.set(userId, newTv);
    return newTv;
  } catch (e: any) {
    console.warn(`[TokenVersion] bump falhou (user ${userId}):`, e?.message);
    return getExpectedTokenVersion(userId);
  }
}
