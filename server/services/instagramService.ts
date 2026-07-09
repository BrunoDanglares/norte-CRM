import { db } from "../db";
import { instagramConnections, whatsappOfficialConnections, leads } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const IG_GRAPH_API = "https://graph.instagram.com/v21.0";

async function tryDM(token: string, igUserId: string, recipientIgUserId: string, text: string): Promise<{ ok: boolean; messageId?: string; data?: any }> {
  const apiBase = token.startsWith("IGAA") ? IG_GRAPH_API : GRAPH_API;
  const res = await fetch(`${apiBase}/${igUserId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientIgUserId },
      message: { text },
    }),
  });
  const data = await res.json();
  return { ok: res.ok, messageId: data.message_id, data };
}

export async function sendInstagramDM(
  accessToken: string,
  igUserId: string,
  recipientIgUserId: string,
  text: string
): Promise<{ messageId?: string; error?: string }> {
  try {
    const isIgToken = accessToken?.startsWith("IGAA");

    if (accessToken && accessToken.length > 10) {
      const result = await tryDM(accessToken, igUserId, recipientIgUserId, text);
      if (result.ok) {
        return { messageId: result.messageId };
      }
      const errMsg = JSON.stringify(result.data);
      const isTokenError = errMsg.includes("Cannot parse access token") || errMsg.includes("Invalid OAuth") || errMsg.includes("does not have the capability");
      if (!isTokenError) {
        console.error(`[Instagram DM] Erro (nao token):`, errMsg);
        return { error: errMsg };
      }
      console.warn(`[Instagram DM] Token/permissao erro, tentando fallback...`);
    } else {
      console.warn(`[Instagram DM] Token vazio ou curto, tentando fallback...`);
    }

    {

      const envToken = process.env.WHATSAPP_ACCESS_TOKEN;
      if (envToken && envToken.length > 10) {
        const fallbackResult = await tryDM(envToken, igUserId, recipientIgUserId, text);
        if (fallbackResult.ok) {
          await db.update(instagramConnections)
            .set({ accessToken: envToken, updatedAt: new Date() })
            .where(eq(instagramConnections.igUserId, igUserId));
          return { messageId: fallbackResult.messageId };
        }
        console.error(`[Instagram DM] Fallback WHATSAPP_ACCESS_TOKEN falhou:`, JSON.stringify(fallbackResult.data));
      }

      const [igConn] = await db.select().from(instagramConnections).where(eq(instagramConnections.igUserId, igUserId)).limit(1);
      if (igConn?.workspaceId) {
        const [waConn] = await db.select().from(whatsappOfficialConnections).where(eq(whatsappOfficialConnections.workspaceId, igConn.workspaceId)).limit(1);
        if (waConn?.accessToken && waConn.accessToken.length > 10) {
          const fallbackResult = await tryDM(waConn.accessToken, igUserId, recipientIgUserId, text);
          if (fallbackResult.ok) {
            await db.update(instagramConnections)
              .set({ accessToken: waConn.accessToken, updatedAt: new Date() })
              .where(eq(instagramConnections.id, igConn.id));
            return { messageId: fallbackResult.messageId };
          }
          console.error(`[Instagram DM] Fallback WA DB tambem falhou:`, JSON.stringify(fallbackResult.data));
        }
      }
      console.error(`[Instagram DM] Todos os tokens falharam. Reconecte o Instagram.`);
    }

    return { error: "Token invalido para enviar DM" };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function replyInstagramComment(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  async function tryReply(token: string) {
    const apiBase = token.startsWith("IGAA") ? IG_GRAPH_API : GRAPH_API;
    const res = await fetch(`${apiBase}/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ access_token: token, message }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  }
  try {
    const result = await tryReply(accessToken);
    if (result.ok) return { success: true };
    console.warn(`[Instagram Reply] Token primario falhou:`, JSON.stringify(result.data));

    const envToken = process.env.WHATSAPP_ACCESS_TOKEN;
    if (envToken && envToken !== accessToken) {
      const retry = await tryReply(envToken);
      if (retry.ok) return { success: true };
      console.warn(`[Instagram Reply] Fallback envToken falhou:`, JSON.stringify(retry.data));
    }

    return { success: false, error: JSON.stringify(result.data) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function getActiveInstagramConnection(workspaceId: string) {
  const [conn] = await db
    .select()
    .from(instagramConnections)
    .where(
      and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.isActive, true)
      )
    )
    .limit(1);
  return conn || null;
}

export async function upsertInstagramLead(
  workspaceId: string,
  igUserId: string,
  displayName: string,
  igUsername?: string | null,
  igBio?: string | null
) {
  const existing = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.workspaceId, workspaceId),
        eq(leads.instagramId, igUserId)
      )
    )
    .limit(1);

  if (existing[0]) {
    const hasPlaceholderName = existing[0].nome?.startsWith("@ig_") || existing[0].nome?.startsWith("ig_") || existing[0].nome?.startsWith("@");
    const hasRealName = displayName && !displayName.startsWith("@ig_") && !displayName.startsWith("ig_");
    const upd: Record<string, any> = {};
    if (hasPlaceholderName && hasRealName) {
      upd.nome = displayName;
    }
    if (igUsername && (!existing[0].instagramUsername || existing[0].instagramUsername.startsWith("@ig_"))) {
      upd.instagramUsername = igUsername;
    }
    if (igBio && !existing[0].instagramBio) {
      upd.instagramBio = igBio;
    }
    if (Object.keys(upd).length > 0) {
      const [updated] = await db
        .update(leads)
        .set(upd)
        .where(eq(leads.id, existing[0].id))
        .returning();
      return updated || existing[0];
    }
    return existing[0];
  }

  const [newLead] = await db
    .insert(leads)
    .values({
      workspaceId,
      nome: displayName || `ig_${igUserId}`,
      contato: `ig:${igUserId}`,
      canal: "instagram",
      instagramId: igUserId,
      instagramUsername: igUsername || displayName,
      instagramBio: igBio || null,
      status: "novo",
    })
    .returning();

  return newLead;
}
