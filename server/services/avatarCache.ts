import fs from "fs";
import path from "path";
import { uploadsDir } from "../utils/uploadsDir";
import { safeOutboundFetch } from "../utils/ssrfGuard";

export async function downloadAndCacheAvatar(
  externalUrl: string,
  workspaceId: string,
  phone: string
): Promise<string | null> {
  try {
    if (!externalUrl || !/^https?:\/\//i.test(externalUrl)) return null;
    const dir = path.join(uploadsDir, "avatars", workspaceId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Nome ESTÁVEL por telefone (.jpg) — refresh sobrescreve, e localAvatarExists
    // depende desse padrão. Fotos de perfil do WhatsApp são sempre JPEG.
    const filename = `${phone.replace(/\D/g, "")}.jpg`;
    const localPath = path.join(dir, filename);
    const publicUrl = `/uploads/avatars/${workspaceId}/${filename}`;

    // fetch (≠ https.get cru): segue redirect, tem timeout e valida o tipo —
    // a URL pps.whatsapp.net carrega via fetch mas falha no <img> do browser
    // (hotlink/referer), por isso baixamos e servimos do nosso domínio.
    // Auditoria 2026-06-20: safeOutboundFetch re-valida o host a CADA redirect e bloqueia
    // loopback/rede interna/metadata da cloud (anti-SSRF). pps.whatsapp.net/graph.facebook.com
    // são públicos → comportamento preservado; fecha a porta de um redirect malicioso server-side.
    const res = await safeOutboundFetch(externalUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct && !ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;

    // Bruno 2026-06-18: só reescreve se a foto MUDOU. Se o conteúdo é byte-idêntico,
    // NÃO toca o arquivo — preserva o mtime/ETag pra o /uploads/avatars (que revalida)
    // responder 304 e o browser não re-baixar à toa. Quando a foto muda, o conteúdo
    // difere → reescreve → novo mtime/ETag → o browser pega a foto nova.
    try {
      if (fs.existsSync(localPath)) {
        const existing = await fs.promises.readFile(localPath);
        if (existing.equals(buf)) return publicUrl;
      }
    } catch { /* compara best-effort; na dúvida, reescreve */ }
    await fs.promises.writeFile(localPath, buf);

    return publicUrl;
  } catch (err: any) {
    console.error("[avatarCache] Erro ao baixar avatar:", err?.message || err);
    return null;
  }
}

export function localAvatarExists(workspaceId: string, phone: string): string | null {
  const filename = `${phone.replace(/\D/g, "")}.jpg`;
  const localPath = path.join(uploadsDir, "avatars", workspaceId, filename);
  if (fs.existsSync(localPath)) {
    return `/uploads/avatars/${workspaceId}/${filename}`;
  }
  return null;
}

export async function backfillExpiredAvatars(): Promise<void> {
  try {
    const { db } = await import("../db");
    const { conversations, conexoes, contacts } = await import("@shared/schema");
    const { like, eq, and, or, isNotNull, sql } = await import("drizzle-orm");

    // Pega conversas com URL externa (http%) OU com URL local já cacheada
    // (/uploads/avatars/%). Pras locais, só re-baixa se o ARQUIVO sumiu do disco
    // (caso clássico: backfill rodado em outro ambiente gravou a URL mas o arquivo
    // ficou noutro disco — então em prod o <img> dá 404 → cai pras iniciais).
    const rows = await db
      .select({
        id: conversations.id,
        avatar: conversations.avatar,
        workspaceId: conversations.workspaceId,
        telefone: conversations.telefone,
      })
      .from(conversations)
      .where(or(like(conversations.avatar, "http%"), like(conversations.avatar, "/uploads/avatars/%")))
      .limit(500); // salvaguarda: o resto é coberto pelo webhook (cura por mensagem)

    if (rows.length === 0) return;

    // Token da conexão Evolution conectada por workspace (lazy, cacheado).
    const evoTokenByWs = new Map<string, string>();
    const evoToken = async (ws: string): Promise<string> => {
      if (evoTokenByWs.has(ws)) return evoTokenByWs.get(ws)!;
      const [c] = await db
        .select({ token: conexoes.token })
        .from(conexoes)
        .where(and(
          eq(conexoes.workspaceId, ws),
          eq(conexoes.provider, "evolution"),
          eq(conexoes.status, "connected"),
          isNotNull(conexoes.token),
        ))
        .limit(1);
      const t = c?.token || "";
      evoTokenByWs.set(ws, t);
      return t;
    };

    let evo: typeof import("./evolutionAdapter") | null = null;
    let cached = 0;
    let checked = 0;

    for (const row of rows) {
      if (!row.avatar || !row.workspaceId || !row.telefone) continue;

      // Se o arquivo JÁ existe no disco, só garante o banco apontando pra ele
      // (sem re-baixar) — cobre tanto http% quanto local que já foi cacheado.
      const existing = localAvatarExists(row.workspaceId, row.telefone);
      if (existing) {
        if (row.avatar !== existing) {
          await db.update(conversations).set({ avatar: existing }).where(eq(conversations.id, row.id));
          cached++;
        }
        continue;
      }
      checked++;

      // Arquivo ausente. URL externa: usa a própria. Local-ausente: re-busca fresh via Evolution.
      let externalUrl: string | null = row.avatar.startsWith("http") ? row.avatar : null;
      if (!externalUrl) {
        const token = await evoToken(row.workspaceId);
        if (!token) continue;
        if (!evo) evo = await import("./evolutionAdapter");
        externalUrl = await evo.getAvatar(token, row.telefone);
      }
      if (!externalUrl) continue;

      const localUrl = await downloadAndCacheAvatar(externalUrl, row.workspaceId, row.telefone);
      if (localUrl) {
        await db.update(conversations).set({ avatar: localUrl }).where(eq(conversations.id, row.id));
        await db.update(contacts)
          .set({ fotoUrl: localUrl, fotoOrigem: "evolution", fotoTentativaEm: new Date() })
          .where(and(
            eq(contacts.workspaceId, row.workspaceId),
            eq(contacts.telefone, row.telefone),
            sql`(${contacts.fotoOrigem} IS DISTINCT FROM 'manual')`,
          ));
        cached++;
      }
    }

    if (checked > 0) console.log(`[avatarCache] Backfill: ${cached}/${checked} avatares (re)cacheados`);
  } catch (err: any) {
    console.error("[avatarCache] Erro no backfill:", err?.message || err);
  }
}
