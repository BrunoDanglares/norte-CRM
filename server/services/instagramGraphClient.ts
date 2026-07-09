// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Cliente centralizado da Graph API para PUBLICAÇÃO no Instagram.
//
// Antes disso, as chamadas à Graph API estavam espalhadas (instagram.ts,
// instagramService.ts) e em versões misturadas (v19 e v21). Este módulo
// concentra o fluxo de Content Publishing num lugar só, numa versão única.
//
// Fluxo oficial da Meta (feed):
//   1. Criar container de mídia            → POST /{ig-user-id}/media
//   2. (carrossel) criar container-pai     → POST /{ig-user-id}/media?media_type=CAROUSEL
//   3. Esperar o container ficar FINISHED  → GET  /{creation-id}?fields=status_code
//   4. Publicar                            → POST /{ig-user-id}/media_publish
//
// Pré-requisitos (garantidos pela conexão existente em instagram_connections):
//   - Conta Instagram Business/Creator ligada a uma Página do Facebook
//   - Page Access Token com escopo instagram_content_publish (ver instagram.ts)
//   - Limite da Meta: 50 posts publicados por API a cada 24h por conta
// Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
const IG_GRAPH_API = `https://graph.instagram.com/${GRAPH_VERSION}`;

// Tokens de Instagram Login começam com "IGAA" e usam graph.instagram.com;
// Page Tokens (o caso padrão da nossa conexão) usam graph.facebook.com.
function apiBaseFor(token: string): string {
  return token?.startsWith("IGAA") ? IG_GRAPH_API : GRAPH_API;
}

// No Instagram Login (token IGAA) o usuário é referenciado como "me" (o id numérico
// dá "object does not exist"); no Page Token usa-se o id numérico da conta.
function nodeFor(igUserId: string, token: string): string {
  return token?.startsWith("IGAA") ? "me" : igUserId;
}

export type GraphResult<T = any> = { ok: boolean; data: T; error?: string };

async function graphFetch<T = any>(
  url: string,
  init: RequestInit,
): Promise<GraphResult<T>> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as any)?.error?.message || JSON.stringify(data);
      return { ok: false, data: data as T, error: msg };
    }
    return { ok: true, data: data as T };
  } catch (err: any) {
    return { ok: false, data: {} as T, error: err?.message || String(err) };
  }
}

function postUrl(base: string, path: string, params: Record<string, string>, token: string): string {
  const qs = new URLSearchParams({ ...params, access_token: token });
  return `${base}/${path}?${qs.toString()}`;
}

// ── 1) Container de IMAGEM ───────────────────────────────────────────────────
// A URL da imagem PRECISA ser pública (a Meta baixa por conta dela). No nosso
// caso, imagens geradas ficam em /uploads/... servidas por express.static.
export async function createImageContainer(
  igUserId: string,
  token: string,
  opts: { imageUrl: string; caption?: string; isCarouselItem?: boolean },
): Promise<GraphResult<{ id: string }>> {
  const base = apiBaseFor(token);
  const params: Record<string, string> = { image_url: opts.imageUrl };
  if (opts.caption) params.caption = opts.caption;
  if (opts.isCarouselItem) params.is_carousel_item = "true";
  return graphFetch(postUrl(base, `${nodeFor(igUserId, token)}/media`, params, token), { method: "POST" });
}

// ── 2) Container de CARROSSEL ────────────────────────────────────────────────
// childrenIds = creation_ids dos itens (2 a 10) criados com isCarouselItem=true.
export async function createCarouselContainer(
  igUserId: string,
  token: string,
  opts: { childrenIds: string[]; caption?: string },
): Promise<GraphResult<{ id: string }>> {
  const base = apiBaseFor(token);
  const params: Record<string, string> = {
    media_type: "CAROUSEL",
    children: opts.childrenIds.join(","),
  };
  if (opts.caption) params.caption = opts.caption;
  return graphFetch(postUrl(base, `${nodeFor(igUserId, token)}/media`, params, token), { method: "POST" });
}

// ── 3) Status do container ───────────────────────────────────────────────────
// status_code: EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED
export async function getContainerStatus(
  containerId: string,
  token: string,
): Promise<GraphResult<{ status_code: string; status?: string; id: string }>> {
  const base = apiBaseFor(token);
  const qs = new URLSearchParams({ fields: "status_code,status", access_token: token });
  return graphFetch(`${base}/${containerId}?${qs.toString()}`, { method: "GET" });
}

// Aguarda o container ficar FINISHED (pronto pra publicar). Imagens costumam
// finalizar em segundos; carrossel/vídeo pode levar mais — por isso o polling.
export async function waitForContainerReady(
  containerId: string,
  token: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<GraphResult<{ status_code: string }>> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const st = await getContainerStatus(containerId, token);
    if (!st.ok) return { ok: false, data: { status_code: "ERROR" }, error: st.error };
    const code = st.data.status_code;
    if (code === "FINISHED") return { ok: true, data: { status_code: code } };
    if (code === "ERROR" || code === "EXPIRED") {
      return { ok: false, data: { status_code: code }, error: `Container ${code}` };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, data: { status_code: "TIMEOUT" }, error: "Timeout aguardando container" };
}

// ── 4) Publicar ──────────────────────────────────────────────────────────────
export async function publishContainer(
  igUserId: string,
  token: string,
  creationId: string,
): Promise<GraphResult<{ id: string }>> {
  const base = apiBaseFor(token);
  return graphFetch(
    postUrl(base, `${nodeFor(igUserId, token)}/media_publish`, { creation_id: creationId }, token),
    { method: "POST" },
  );
}

// Permalink do post publicado (pra mostrar na UI e guardar em instaflix_posts).
export async function getMediaPermalink(
  mediaId: string,
  token: string,
): Promise<GraphResult<{ permalink: string; id: string }>> {
  const base = apiBaseFor(token);
  const qs = new URLSearchParams({ fields: "permalink", access_token: token });
  return graphFetch(`${base}/${mediaId}?${qs.toString()}`, { method: "GET" });
}

// Insights de mídia (loop de aprendizado — fase 2). Métricas variam por tipo.
export async function getMediaInsights(
  mediaId: string,
  token: string,
  metrics: string[] = ["reach", "likes", "comments", "saved", "shares"],
): Promise<GraphResult<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>> {
  const base = apiBaseFor(token);
  const qs = new URLSearchParams({ metric: metrics.join(","), access_token: token });
  return graphFetch(`${base}/${mediaId}/insights?${qs.toString()}`, { method: "GET" });
}

// ── LEITURA do perfil/feed (pra alimentar o Brand Kit do Instaflix) ──────────
// Perfil da conta Business: bio, nome, site, seguidores, foto.
export async function getUserProfile(
  igUserId: string,
  token: string,
): Promise<GraphResult<{ biography?: string; name?: string; username?: string; followers_count?: number; media_count?: number; website?: string; profile_picture_url?: string; id: string }>> {
  const base = apiBaseFor(token);
  const isIg = token?.startsWith("IGAA");
  // Instagram Login não tem o campo `website`; Page Token (graph.facebook) tem.
  const fields = isIg
    ? "user_id,username,name,account_type,followers_count,media_count,profile_picture_url,biography"
    : "biography,name,username,followers_count,media_count,website,profile_picture_url";
  const qs = new URLSearchParams({ fields, access_token: token });
  return graphFetch(`${base}/${nodeFor(igUserId, token)}?${qs.toString()}`, { method: "GET" });
}

export interface IgMediaItem {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

// Posts recentes do feed (legenda, tipo, engajamento). Usado pra aprender voz/temas.
export async function getRecentMedia(
  igUserId: string,
  token: string,
  limit = 25,
): Promise<GraphResult<{ data: IgMediaItem[] }>> {
  const base = apiBaseFor(token);
  const node = nodeFor(igUserId, token);
  const fields = "caption,media_type,media_url,permalink,like_count,comments_count,timestamp";
  const perPage = Math.min(50, Math.max(1, limit));
  let url: string = `${base}/${node}/media?${new URLSearchParams({ fields, limit: String(perPage), access_token: token }).toString()}`;

  // Pagina seguindo paging.next (que já traz o access_token) até juntar `limit`.
  const todas: IgMediaItem[] = [];
  let paginas = 0;
  while (url && todas.length < limit && paginas < 12) {
    const res = await graphFetch<{ data: IgMediaItem[]; paging?: { next?: string } }>(url, { method: "GET" });
    if (!res.ok) {
      if (todas.length) break;                 // já temos algo → devolve o parcial
      return { ok: false, data: { data: [] }, error: res.error };
    }
    todas.push(...(res.data.data || []));
    url = res.data.paging?.next || "";
    paginas++;
  }
  return { ok: true, data: { data: todas.slice(0, limit) } };
}

// ── Orquestração de alto nível ───────────────────────────────────────────────
// Publica uma peça completa (imagem única OU carrossel) e devolve o media_id.
// `imagens` = URLs públicas na ordem desejada. 1 imagem = post simples; 2-10 = carrossel.
export async function publicarPost(
  igUserId: string,
  token: string,
  opts: { imagens: string[]; legenda?: string },
): Promise<GraphResult<{ mediaId: string; containerId: string; permalink?: string }>> {
  const imgs = (opts.imagens || []).filter(Boolean);
  if (imgs.length === 0) {
    return { ok: false, data: {} as any, error: "Nenhuma imagem informada" };
  }
  if (imgs.length > 10) {
    return { ok: false, data: {} as any, error: "Carrossel aceita no máximo 10 imagens" };
  }

  let containerId: string;

  if (imgs.length === 1) {
    // Post de imagem única.
    const c = await createImageContainer(igUserId, token, { imageUrl: imgs[0], caption: opts.legenda });
    if (!c.ok) return { ok: false, data: {} as any, error: `Container falhou: ${c.error}` };
    containerId = c.data.id;
  } else {
    // Carrossel: cria cada item, depois o container-pai.
    const childrenIds: string[] = [];
    for (const url of imgs) {
      const item = await createImageContainer(igUserId, token, { imageUrl: url, isCarouselItem: true });
      if (!item.ok) return { ok: false, data: {} as any, error: `Item do carrossel falhou: ${item.error}` };
      childrenIds.push(item.data.id);
    }
    const parent = await createCarouselContainer(igUserId, token, { childrenIds, caption: opts.legenda });
    if (!parent.ok) return { ok: false, data: {} as any, error: `Container do carrossel falhou: ${parent.error}` };
    containerId = parent.data.id;
  }

  // Espera ficar pronto antes de publicar (evita erro de "media not ready").
  const ready = await waitForContainerReady(containerId, token);
  if (!ready.ok) return { ok: false, data: { containerId } as any, error: ready.error };

  const pub = await publishContainer(igUserId, token, containerId);
  if (!pub.ok) return { ok: false, data: { containerId } as any, error: `Publish falhou: ${pub.error}` };

  const mediaId = pub.data.id;
  const link = await getMediaPermalink(mediaId, token);
  return {
    ok: true,
    data: { mediaId, containerId, permalink: link.ok ? link.data.permalink : undefined },
  };
}
