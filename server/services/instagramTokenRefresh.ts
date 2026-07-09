// ═══════════════════════════════════════════════════════════════════════════
// Renovação automática do token do Instagram (evita desconectar a cada ~60 dias).
//
// A tabela instagram_connections guarda um token com tokenExpiresAt. Sem
// renovação, ao expirar o Instaflix (e o DM) param de funcionar. Este job diário
// renova os que estão perto de vencer:
//   • Token de Instagram Login (IGAA…) → /refresh_access_token (ig_refresh_token)
//   • Page/User token do Facebook      → fb_exchange_token (estende long-lived)
//   • Fallback: se não renovou, faz health-check; se o token ainda responde,
//     empurra tokenExpiresAt +60d (ainda é válido); se não, loga p/ reconexão.
//
// Não-destrutivo: NUNCA desativa a conexão (não quebra os fluxos de DM). Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { instagramConnections } from "@shared/schema";
import { eq } from "drizzle-orm";

const GRAPH = "https://graph.facebook.com/v21.0";
const IG_GRAPH = "https://graph.instagram.com";
const DIA_MS = 86_400_000;

function baseFor(token: string) {
  return token?.startsWith("IGAA") ? `${IG_GRAPH}/v21.0` : GRAPH;
}

async function tokenValido(token: string, igUserId: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseFor(token)}/${igUserId}?fields=id&access_token=${encodeURIComponent(token)}`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface RefreshResult {
  checados: number;
  renovados: number;
  validos: number;   // não renovou mas ainda responde (expiry empurrado)
  falhas: number;
}

export async function refreshInstagramTokens(): Promise<RefreshResult> {
  const conns = await db.select().from(instagramConnections).where(eq(instagramConnections.isActive, true));
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;

  let renovados = 0, validos = 0, falhas = 0;

  for (const c of conns) {
    const token = c.accessToken || "";
    if (!token) continue;

    // Só age se faltam <= 10 dias pra expirar (ou sem data registrada).
    const exp = c.tokenExpiresAt ? new Date(c.tokenExpiresAt).getTime() : 0;
    if (exp && (exp - Date.now()) / DIA_MS > 10) continue;

    try {
      let novoToken: string | null = null;
      let expiresIn = 0;

      if (token.startsWith("IGAA")) {
        const res = await fetch(`${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
        const data: any = await res.json().catch(() => ({}));
        if (res.ok && data.access_token) { novoToken = data.access_token; expiresIn = data.expires_in || 0; }
      } else if (appId && appSecret) {
        const url = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        const data: any = await res.json().catch(() => ({}));
        if (res.ok && data.access_token) { novoToken = data.access_token; expiresIn = data.expires_in || 0; }
      }

      if (novoToken) {
        const expiresAt = new Date(Date.now() + (expiresIn ? expiresIn * 1000 : 60 * DIA_MS));
        await db.update(instagramConnections)
          .set({ accessToken: novoToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
          .where(eq(instagramConnections.id, c.id));
        renovados++;
        continue;
      }

      // Não renovou via API → health-check. Se ainda responde, empurra o vencimento.
      if (await tokenValido(token, c.igUserId)) {
        await db.update(instagramConnections)
          .set({ tokenExpiresAt: new Date(Date.now() + 60 * DIA_MS), updatedAt: new Date() })
          .where(eq(instagramConnections.id, c.id));
        validos++;
      } else {
        console.warn(`[IG TokenRefresh] Conexão ${c.id} (@${c.igUsername}) precisa reconectar — token não renovou e não responde.`);
        falhas++;
      }
    } catch (e: any) {
      console.warn(`[IG TokenRefresh] erro na conexão ${c.id}: ${e?.message || e}`);
      falhas++;
    }
  }

  return { checados: conns.length, renovados, validos, falhas };
}
