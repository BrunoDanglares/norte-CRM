import { db } from "../db";
import { contacts, conversations, whatsappOfficialConnections, conexoes } from "@shared/schema";
import { eq, and, isNull, isNotNull, inArray, sql } from "drizzle-orm";

export function getDicebearUrl(name: string): string {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=8b5cf6,4CB8F0,FFB300,5DCAA5,E24B4A&backgroundType=solid&fontSize=38&bold=true`;
}

export async function tryFetchMetaProfilePicture(
  phoneNumberId: string,
  contactPhone: string,
  accessToken: string
): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/contacts?phone=${encodeURIComponent(contactPhone)}&fields=profile_picture_url`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const pic = data?.contacts?.[0]?.profile_picture_url || data?.data?.[0]?.profile_picture_url;
    if (pic && typeof pic === "string" && pic.startsWith("http")) return pic;
    return null;
  } catch {
    return null;
  }
}

interface ContactForAvatar {
  id: number;
  nome: string;
  telefone: string | null;
  fotoUrl: string | null;
  fotoOrigem: string | null;
  fotoTentativaEm: Date | null;
}

export async function resolveContactAvatar(
  contact: ContactForAvatar,
  workspaceId: string
): Promise<string> {
  if (contact.fotoUrl && contact.fotoOrigem === "manual") {
    return contact.fotoUrl;
  }
  if (contact.fotoUrl && contact.fotoOrigem === "meta_api") {
    return contact.fotoUrl;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const shouldTry =
    !contact.fotoTentativaEm || contact.fotoTentativaEm < sevenDaysAgo;

  if (shouldTry && contact.telefone) {
    try {
      const [conn] = await db
        .select({
          accessToken: whatsappOfficialConnections.accessToken,
          phoneNumberId: whatsappOfficialConnections.phoneNumberId,
        })
        .from(whatsappOfficialConnections)
        .where(eq(whatsappOfficialConnections.workspaceId, workspaceId))
        .limit(1);

      await db
        .update(contacts)
        .set({ fotoTentativaEm: new Date() })
        .where(eq(contacts.id, contact.id));

      if (conn) {
        const picUrl = await tryFetchMetaProfilePicture(
          conn.phoneNumberId,
          contact.telefone,
          conn.accessToken
        );
        if (picUrl) {
          await db
            .update(contacts)
            .set({ fotoUrl: picUrl, fotoOrigem: "meta_api" })
            .where(eq(contacts.id, contact.id));
          return picUrl;
        }
      }
    } catch {}
  }

  return getDicebearUrl(contact.nome || "?");
}

export async function backfillConversationAvatars(workspaceId: string): Promise<number> {
  // Bruno 2026-06-18: só entram conversas SEM foto em lugar nenhum (avatar da conv
  // NULL E o contato sem fotoUrl — o front já faz fallback pro contato por telefone)
  // e que NÃO foram tentadas nos últimos 7 dias (retry guard via contacts.fotoTentativaEm).
  // Isso evita martelar Graph/Evolution num sweep periódico pra cliente sem foto/oculta.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const missingAvatars = await db
    .select({
      id: conversations.id,
      telefone: conversations.telefone,
      nome: conversations.nome,
      canal: conversations.canal,
    })
    .from(conversations)
    .leftJoin(
      contacts,
      and(
        eq(contacts.workspaceId, conversations.workspaceId),
        eq(contacts.telefone, conversations.telefone),
      ),
    )
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        isNull(conversations.avatar),
        isNotNull(conversations.telefone),
        isNull(contacts.fotoUrl),
        sql`(${contacts.fotoTentativaEm} IS NULL OR ${contacts.fotoTentativaEm} < ${sevenDaysAgo})`,
      ),
    )
    .limit(50);

  if (missingAvatars.length === 0) return 0;

  // Marca a tentativa AGORA (sucesso OU falha) — honra o retry guard acima pra não
  // voltar nesses contatos antes de 7 dias. Não toca foto manual.
  const phones = missingAvatars.map((c) => c.telefone).filter(Boolean) as string[];
  if (phones.length > 0) {
    await db.update(contacts)
      .set({ fotoTentativaEm: new Date() })
      .where(and(
        eq(contacts.workspaceId, workspaceId),
        inArray(contacts.telefone, phones),
        sql`(${contacts.fotoOrigem} IS DISTINCT FROM 'manual')`,
      ));
  }

  let updated = 0;
  const stillMissing: typeof missingAvatars = [];

  // 1) Canal oficial (Meta Cloud API) — foto vem do Graph API.
  const [conn] = await db
    .select({
      accessToken: whatsappOfficialConnections.accessToken,
      phoneNumberId: whatsappOfficialConnections.phoneNumberId,
    })
    .from(whatsappOfficialConnections)
    .where(eq(whatsappOfficialConnections.workspaceId, workspaceId))
    .limit(1);

  if (conn) {
    for (const conv of missingAvatars) {
      if (!conv.telefone) continue;
      const digits = conv.telefone.replace(/\D/g, "");
      if (digits.length < 10) continue;
      const picUrl = await tryFetchMetaProfilePicture(conn.phoneNumberId, `+${digits}`, conn.accessToken);
      if (picUrl) {
        await db.update(conversations).set({ avatar: picUrl }).where(eq(conversations.id, conv.id));
        updated++;
      } else {
        stillMissing.push(conv);
      }
    }
  } else {
    stillMissing.push(...missingAvatars);
  }

  // 2) Evolution GO — pra conversas ainda sem foto, busca via instância conectada e
  // BAIXA pro /uploads (a URL do WhatsApp não carrega no browser). Grava em
  // conversations.avatar + contacts.fotoUrl (fonte por telefone).
  if (stillMissing.length > 0) {
    const [evoConn] = await db
      .select({ token: conexoes.token })
      .from(conexoes)
      .where(and(
        eq(conexoes.workspaceId, workspaceId),
        eq(conexoes.provider, "evolution"),
        eq(conexoes.status, "connected"),
        isNotNull(conexoes.token),
      ))
      .limit(1);
    if (evoConn?.token) {
      const evo = await import("./evolutionAdapter");
      const { downloadAndCacheAvatar } = await import("./avatarCache");
      for (const conv of stillMissing) {
        if (!conv.telefone) continue;
        try {
          const remote = await evo.getAvatar(evoConn.token, conv.telefone);
          if (!remote) continue;
          const local = await downloadAndCacheAvatar(remote, workspaceId, conv.telefone);
          const pic = local || remote;
          await db.update(conversations).set({ avatar: pic }).where(eq(conversations.id, conv.id));
          await db.update(contacts)
            .set({ fotoUrl: pic, fotoOrigem: "evolution", fotoTentativaEm: new Date() })
            .where(and(
              eq(contacts.workspaceId, workspaceId),
              eq(contacts.telefone, conv.telefone),
              sql`(${contacts.fotoOrigem} IS DISTINCT FROM 'manual')`,
            ));
          updated++;
        } catch {}
      }
    }
  }

  console.log(`[AvatarBackfill] Updated ${updated}/${missingAvatars.length} avatars for workspace ${workspaceId}`);
  return updated;
}

/**
 * Refresh das fotos JÁ salvas (Bruno 2026-06-18): "até eles mudarem a foto". Re-puxa
 * via Evolution conectado as fotos de contato com >7 dias da última tentativa e re-baixa
 * (downloadAndCacheAvatar só REESCREVE se o conteúdo mudou). Como o /uploads/avatars
 * revalida (cache curto), quando o cliente troca a foto no WhatsApp o painel atualiza.
 * Não toca foto MANUAL; se a foto sumiu agora (removida/privada/transiente) MANTÉM a
 * última conhecida (não pisca pra iniciais). Sem Evolution conectado, não há o que fazer.
 */
export async function refreshStaleContactAvatars(workspaceId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [evoConn] = await db
    .select({ token: conexoes.token })
    .from(conexoes)
    .where(and(
      eq(conexoes.workspaceId, workspaceId),
      eq(conexoes.provider, "evolution"),
      eq(conexoes.status, "connected"),
      isNotNull(conexoes.token),
    ))
    .limit(1);
  if (!evoConn?.token) return 0;

  const stale = await db
    .select({ id: contacts.id, telefone: contacts.telefone, fotoUrl: contacts.fotoUrl })
    .from(contacts)
    .where(and(
      eq(contacts.workspaceId, workspaceId),
      isNotNull(contacts.fotoUrl),
      isNotNull(contacts.telefone),
      sql`(${contacts.fotoOrigem} IS DISTINCT FROM 'manual')`,
      sql`(${contacts.fotoTentativaEm} IS NULL OR ${contacts.fotoTentativaEm} < ${sevenDaysAgo})`,
    ))
    .limit(50);
  if (stale.length === 0) return 0;

  const evo = await import("./evolutionAdapter");
  const { downloadAndCacheAvatar } = await import("./avatarCache");
  let refreshed = 0;
  for (const c of stale) {
    if (!c.telefone) continue;
    // Marca a tentativa AGORA — não re-checa antes de 7d mesmo que falhe/sem foto.
    await db.update(contacts).set({ fotoTentativaEm: new Date() }).where(eq(contacts.id, c.id));
    try {
      const remote = await evo.getAvatar(evoConn.token, c.telefone);
      if (!remote) continue; // sem foto agora → mantém a última conhecida
      const local = await downloadAndCacheAvatar(remote, workspaceId, c.telefone);
      // URL estável (mesmo nome): o arquivo já foi (re)escrito se mudou. Só atualiza
      // fotoUrl se apontava pra outra coisa (ex.: URL externa legada → local).
      if (local && local !== c.fotoUrl) {
        await db.update(contacts)
          .set({ fotoUrl: local, fotoOrigem: "evolution" })
          .where(and(eq(contacts.id, c.id), sql`(${contacts.fotoOrigem} IS DISTINCT FROM 'manual')`));
      }
      refreshed++;
    } catch { /* gracioso */ }
  }
  if (refreshed > 0) console.log(`[AvatarRefresh] ${refreshed} foto(s) re-checadas (ws ${String(workspaceId).slice(0, 8)})`);
  return refreshed;
}

/**
 * Sweep periódico de avatares (Bruno 2026-06-18). A foto do cliente só vem via
 * Evolution (o Meta Cloud API não entrega foto de perfil — só o nome). Conversa
 * que entra pelo Meta nasce sem avatar e NADA puxava a foto sozinho (só o clique
 * manual em "atualizar avatares"). Aqui varremos os workspaces ATIVOS e, pra cada
 * um, rodamos o backfill: pega convs sem foto e puxa via uma instância Evolution
 * CONECTADA do workspace (download pro /uploads → conversations.avatar + contacts.fotoUrl).
 * O retry guard de 7 dias (em backfillConversationAvatars) mantém o trabalho limitado.
 * Pré-requisito de dado: o workspace precisa ter ao menos UMA conexão Evolution
 * conectada (senão não há de onde puxar a foto — Meta não dá).
 */
export async function sweepAllWorkspaceAvatars(): Promise<void> {
  try {
    const res = await db.execute(sql`SELECT id FROM workspaces WHERE status = 'ACTIVE'`);
    const rows: any[] = Array.isArray(res) ? res : (res as any).rows || [];
    let total = 0;
    for (const r of rows) {
      const wsId = r.id as string;
      try {
        total += await backfillConversationAvatars(wsId); // preenche quem não tem foto
        await refreshStaleContactAvatars(wsId);           // atualiza quem trocou a foto
      } catch (e: any) {
        console.warn(`[AvatarSweep] ws ${String(wsId).slice(0, 8)} erro (gracioso): ${e?.message}`);
      }
    }
    if (total > 0) console.log(`[AvatarSweep] ${total} avatar(es) preenchidos`);
  } catch (e: any) {
    console.error(`[AvatarSweep] erro: ${e?.message}`);
  }
}
