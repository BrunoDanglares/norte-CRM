// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Serviço de dados + orquestração de publicação.
//
// Concentra o acesso ao banco das tabelas instaflix_* e a ação de publicar
// (resolve a conexão → chama a Graph API → atualiza status). Rotas e schedulers
// chamam este serviço; não tocam a Graph API direto. Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import {
  instaflixBrandKits,
  instaflixPosts,
  instaflixScheduleRules,
  instaflixPillars,
  instagramConnections,
  type InstaflixBrandKit,
  type InstaflixPost,
  type InstaflixScheduleRule,
  type InstaflixPillar,
} from "@shared/schema";
import { eq, and, desc, lte } from "drizzle-orm";
import { publicarPost as graphPublicarPost } from "./instagramGraphClient";

// ── Brand kit ────────────────────────────────────────────────────────────────
export async function getBrandKit(workspaceId: string): Promise<InstaflixBrandKit | null> {
  const [row] = await db.select().from(instaflixBrandKits)
    .where(eq(instaflixBrandKits.workspaceId, workspaceId))
    .orderBy(desc(instaflixBrandKits.updatedAt))
    .limit(1);
  return row ?? null;
}

// Lista das URLs das variações de logo da marca. Fonte da verdade é o campo novo
// `logos` ([{ url }]); cai no campo antigo `logoUrl` pra marcas que só têm uma logo
// (compat retroativa). A ordem importa: a primeira é a "primária". Bruno 2026-07-07.
export function brandLogoUrls(bk: InstaflixBrandKit | null): string[] {
  if (!bk) return [];
  const arr = Array.isArray((bk as any).logos) ? ((bk as any).logos as Array<{ url?: string }>) : [];
  const urls = arr.map((l) => l?.url).filter((u): u is string => typeof u === "string" && !!u);
  if (urls.length) return urls;
  return bk.logoUrl ? [bk.logoUrl] : [];
}

export async function upsertBrandKit(workspaceId: string, data: Record<string, any>): Promise<InstaflixBrandKit> {
  const existing = await getBrandKit(workspaceId);
  if (existing) {
    const [row] = await db.update(instaflixBrandKits)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(instaflixBrandKits.id, existing.id), eq(instaflixBrandKits.workspaceId, workspaceId)))
      .returning();
    return row;
  }
  const [row] = await db.insert(instaflixBrandKits).values({ ...data, workspaceId }).returning();
  return row;
}

// ── Conexão do Instagram (a conta que publica) ───────────────────────────────
export async function getActiveConnection(workspaceId: string) {
  const [conn] = await db.select().from(instagramConnections)
    .where(and(eq(instagramConnections.workspaceId, workspaceId), eq(instagramConnections.isActive, true)))
    .limit(1);
  return conn ?? null;
}

// ── Posts ────────────────────────────────────────────────────────────────────
export async function createPost(data: Record<string, any>): Promise<InstaflixPost> {
  const [row] = await db.insert(instaflixPosts).values(data as any).returning();
  return row;
}

export async function listPosts(workspaceId: string, opts?: { status?: string; limit?: number }): Promise<InstaflixPost[]> {
  const where = opts?.status
    ? and(eq(instaflixPosts.workspaceId, workspaceId), eq(instaflixPosts.status, opts.status))
    : eq(instaflixPosts.workspaceId, workspaceId);
  return db.select().from(instaflixPosts)
    .where(where)
    .orderBy(desc(instaflixPosts.createdAt))
    .limit(opts?.limit ?? 100);
}

export async function getPost(id: string, workspaceId: string): Promise<InstaflixPost | null> {
  const [row] = await db.select().from(instaflixPosts)
    .where(and(eq(instaflixPosts.id, id), eq(instaflixPosts.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function updatePost(id: string, workspaceId: string, data: Record<string, any>): Promise<InstaflixPost | null> {
  const [row] = await db.update(instaflixPosts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(instaflixPosts.id, id), eq(instaflixPosts.workspaceId, workspaceId)))
    .returning();
  return row ?? null;
}

export async function deletePost(id: string, workspaceId: string): Promise<void> {
  await db.delete(instaflixPosts).where(and(eq(instaflixPosts.id, id), eq(instaflixPosts.workspaceId, workspaceId)));
}

// Aprovar = mandar pra fila de publicação (status 'agendado' com horário).
// Se um horário foi passado, usa ele. Senão, preserva o slot que o gerador já
// tinha definido (rascunho automático); se não houver, publica assim que possível (now).
export async function aprovarPost(id: string, workspaceId: string, aprovadoPor: string, scheduledAt?: Date): Promise<InstaflixPost | null> {
  const patch: Record<string, any> = { status: "agendado", aprovadoPor };
  if (scheduledAt) {
    patch.scheduledAt = scheduledAt;
  } else {
    const post = await getPost(id, workspaceId);
    if (!post?.scheduledAt) patch.scheduledAt = new Date();
  }
  return updatePost(id, workspaceId, patch);
}

// Agendar/reagendar = definir data-hora e mandar pra fila de publicação. Serve
// tanto pra post aguardando aprovação (aprova + agenda) quanto pra reagendar um já
// agendado. O publicador (scheduler 60s) publica quando scheduledAt <= agora.
export async function agendarPost(id: string, workspaceId: string, scheduledAt: Date, aprovadoPor?: string): Promise<InstaflixPost | null> {
  const patch: Record<string, any> = { status: "agendado", scheduledAt };
  if (aprovadoPor) patch.aprovadoPor = aprovadoPor;
  return updatePost(id, workspaceId, patch);
}

// Cancelar agendamento = volta pra 'aguardando_aprovacao' e limpa a data (sai da fila).
export async function desagendarPost(id: string, workspaceId: string): Promise<InstaflixPost | null> {
  return updatePost(id, workspaceId, { status: "aguardando_aprovacao", scheduledAt: null });
}

// Regras de agenda ATIVAS (todos os tenants) — usado pelo scheduler gerador.
export async function getActiveRules(): Promise<InstaflixScheduleRule[]> {
  return db.select().from(instaflixScheduleRules).where(eq(instaflixScheduleRules.ativo, true));
}

// Dedup do gerador: já existe um post desta regra pra este horário exato?
export async function getPostByRuleSlot(ruleId: string, slot: Date): Promise<InstaflixPost | null> {
  const [row] = await db.select().from(instaflixPosts)
    .where(and(eq(instaflixPosts.ruleId, ruleId), eq(instaflixPosts.scheduledAt, slot)))
    .limit(1);
  return row ?? null;
}

export async function getPillarById(id: string, workspaceId: string): Promise<InstaflixPillar | null> {
  const [row] = await db.select().from(instaflixPillars)
    .where(and(eq(instaflixPillars.id, id), eq(instaflixPillars.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function reprovarPost(id: string, workspaceId: string): Promise<InstaflixPost | null> {
  return updatePost(id, workspaceId, { status: "reprovado" });
}

// ── Claim atômico pro publicador (espelha disparos_programados) ───────────────
// Marca 'agendado' vencido como 'publicando' num único UPDATE, pra o próximo tick
// (ou outra réplica) não re-selecionar e publicar de novo (double-post).
export async function claimPostsParaPublicar(): Promise<InstaflixPost[]> {
  return db.update(instaflixPosts)
    .set({ status: "publicando", updatedAt: new Date() })
    .where(and(
      eq(instaflixPosts.status, "agendado"),
      lte(instaflixPosts.scheduledAt, new Date()),
    ))
    .returning();
}

// Recupera posts presos em 'gerando' (geração órfã: o servidor reiniciou no meio
// da geração em background, ou o processo morreu). Uma geração VIVA atualiza
// `progresso`/updated_at a cada etapa (no máx. ~1-2min entre updates); 'gerando'
// sem update há vários minutos = órfão → marca como 'falhou' pra não ficar eterno.
export async function recuperarGeracoesPresas(minutes: number): Promise<void> {
  const cutoff = new Date(Date.now() - minutes * 60_000);
  await db.update(instaflixPosts)
    .set({
      status: "falhou",
      errorMessage: "Geração interrompida (o servidor reiniciou no meio). Gere o post de novo.",
      updatedAt: new Date(),
    })
    .where(and(
      eq(instaflixPosts.status, "gerando"),
      lte(instaflixPosts.updatedAt, cutoff),
    ));
}

// Recupera posts presos em 'publicando' (crash de um run anterior) e devolve
// pra 'agendado'. Publicar leva no máx. alguns minutos; 'publicando' antigo = órfão.
export async function recuperarPublicacoesPresas(minutes: number): Promise<void> {
  const cutoff = new Date(Date.now() - minutes * 60_000);
  await db.update(instaflixPosts)
    .set({ status: "agendado", updatedAt: new Date() })
    .where(and(
      eq(instaflixPosts.status, "publicando"),
      lte(instaflixPosts.updatedAt, cutoff),
    ));
}

// Guarda pra publicação manual imediata (rota "publicar agora"). Bloqueia se já
// está 'publicado' ou 'publicando' EM CURSO (recente). Bruno 2026-07-07: uma
// 'publicando' parada há >90s = travada (a publicação anterior deu hang/crash),
// então PERMITE retentar — senão o post fica preso e o botão some pro usuário.
export async function claimPostParaPublicarManual(id: string, workspaceId: string): Promise<InstaflixPost | null> {
  const post = await getPost(id, workspaceId);
  if (!post) return null;
  if (post.status === "publicado") return null;
  if (post.status === "publicando") {
    const ageMs = Date.now() - new Date(post.updatedAt as any).getTime();
    if (ageMs < 90_000) return null;   // publicação recente de verdade → não duplica
  }
  return updatePost(id, workspaceId, { status: "publicando" });
}

export async function markPublicado(id: string, info: { igMediaId?: string; igContainerId?: string; permalink?: string }): Promise<void> {
  await db.update(instaflixPosts).set({
    status: "publicado",
    publishedAt: new Date(),
    igMediaId: info.igMediaId,
    igContainerId: info.igContainerId,
    igPermalink: info.permalink,
    updatedAt: new Date(),
  }).where(eq(instaflixPosts.id, id));
}

export async function markFalhou(id: string, errorMessage: string): Promise<void> {
  await db.update(instaflixPosts).set({
    status: "falhou",
    errorMessage: errorMessage?.slice(0, 1000),
    updatedAt: new Date(),
  }).where(eq(instaflixPosts.id, id));
}

// ── Publicação de fato ───────────────────────────────────────────────────────
// Resolve a conexão, extrai as URLs das mídias na ordem, publica via Graph e
// atualiza o status do post. Usada pela rota "publicar agora" E pelo scheduler.
export async function publicarPostAgora(post: InstaflixPost): Promise<{ ok: boolean; error?: string; mediaId?: string }> {
  try {
    const conn = post.instagramConnectionId
      ? (await db.select().from(instagramConnections).where(eq(instagramConnections.id, post.instagramConnectionId)).limit(1))[0]
      : await getActiveConnection(post.workspaceId);

    if (!conn) {
      await markFalhou(post.id, "Sem conexão do Instagram ativa");
      return { ok: false, error: "Sem conexão do Instagram ativa" };
    }

    const midias = Array.isArray(post.midias) ? (post.midias as any[]) : [];

    // As mídias são gravadas como URL RELATIVA (/uploads/...) pra funcionar no
    // preview local. Pra publicar, a Meta precisa de URL ABSOLUTA pública →
    // montamos aqui via PUBLIC_BASE_URL (em dev local = URL do túnel cloudflared/ngrok).
    const base = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
    const absolutizar = (u: string): string => {
      if (!u) return "";
      if (/^https?:\/\//i.test(u)) return u;      // já absoluta
      return base ? `${base}${u.startsWith("/") ? "" : "/"}${u}` : "";
    };

    const imagens = midias
      .slice()
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map((m) => absolutizar(m.url))
      .filter(Boolean);

    if (imagens.length === 0) {
      const msg = base
        ? "Post sem imagens"
        : "Configure PUBLIC_BASE_URL (ou um túnel público) para publicar — as imagens estão só em /uploads local, que a Meta não alcança";
      await markFalhou(post.id, msg);
      return { ok: false, error: msg };
    }

    const res = await graphPublicarPost(conn.igUserId, conn.accessToken, {
      imagens,
      legenda: post.legenda || undefined,
    });

    if (!res.ok) {
      await markFalhou(post.id, res.error || "Falha na publicação");
      return { ok: false, error: res.error };
    }

    await markPublicado(post.id, {
      igMediaId: res.data.mediaId,
      igContainerId: res.data.containerId,
      permalink: res.data.permalink,
    });
    return { ok: true, mediaId: res.data.mediaId };
  } catch (err: any) {
    await markFalhou(post.id, err?.message || String(err));
    return { ok: false, error: err?.message || String(err) };
  }
}
