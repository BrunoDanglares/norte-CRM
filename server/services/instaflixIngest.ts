// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Ingestão do Instagram do tenant → Brand Kit.
//
// Este é o coração de "o agente se alimenta das informações da página": lê o
// PERFIL e os POSTS recentes da conta conectada (instagram_connections), extrai
// hashtags/exemplos de legenda por regex, e usa IA pra destilar a marca
// (o que faz, público, tom de voz, temas recorrentes). O resultado popula o
// Brand Kit, que é o contexto que alimenta o estúdio de geração. Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import { getActiveConnection, getBrandKit, upsertBrandKit } from "./instaflixService";
import { getUserProfile, getRecentMedia } from "./instagramGraphClient";
import { extrairPaletaMarca } from "./instaflixImageService";
import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";

interface AnaliseFeed {
  descricaoNegocio?: string;
  publicoAlvo?: string;
  tomVoz?: string;
  temasRecorrentes?: string[];
}

// IA lê bio + legendas e resume a marca. Sem chave OpenAI → volta vazio (a
// extração por regex ainda alimenta hashtags/exemplos).
async function analisarFeedIA(
  workspaceId: string,
  input: { profile: any; captions: string[] },
): Promise<AnaliseFeed> {
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return {};
  const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você analisa o perfil de Instagram de um negócio e resume a marca em português do Brasil. Responda SOMENTE JSON com as chaves: descricaoNegocio (string, o que o negócio faz), publicoAlvo (string), tomVoz (string, como a marca se comunica), temasRecorrentes (array de strings, assuntos que aparecem no feed).",
        },
        {
          role: "user",
          content:
            `Bio: ${input.profile?.biography || "(sem bio)"}\n` +
            `Nome: ${input.profile?.name || ""}\n` +
            `Site: ${input.profile?.website || ""}\n` +
            `Seguidores: ${input.profile?.followers_count ?? "?"}\n\n` +
            `Legendas recentes do feed:\n${input.captions.map((c, i) => `${i + 1}. ${c}`).join("\n") || "(sem legendas)"}`,
        },
      ],
    });
    return JSON.parse(resp.choices?.[0]?.message?.content || "{}") as AnaliseFeed;
  } catch {
    return {};
  }
}

export interface SyncResult {
  brandKit: any;
  postsAnalisados: number;
  igUsername?: string;
}

// Sincroniza o Brand Kit a partir da conta do Instagram conectada ao tenant.
// Campos autorais (descrição/público/tom) só são preenchidos se estiverem VAZIOS
// — respeita o que o usuário já escreveu. Campos "aprendidos do feed"
// (temas, exemplos de legenda, base de conhecimento) são sempre atualizados.
export async function sincronizarBrandKitDoInstagram(workspaceId: string, limite = 25): Promise<SyncResult> {
  const n = Math.max(1, Math.min(100, Math.round(Number(limite)) || 25)); // tenant escolhe (até 100)
  const conn = await getActiveConnection(workspaceId);
  if (!conn) {
    throw new Error("Nenhuma conta do Instagram conectada. Conecte a conta em Canais/Integrações primeiro.");
  }

  const prof = await getUserProfile(conn.igUserId, conn.accessToken);
  if (!prof.ok) {
    const raw = prof.error || "";
    // "Unsupported request" (IGApiException code 100) na leitura básica do /me quase
    // sempre = a conta NÃO é Profissional (Business/Creator): a Graph API do Instagram
    // não lê perfil/mídia de conta pessoal. Mensagem acionável em vez do texto cru da
    // Meta. (Conta Creator/Business lê 100% — verificado.) Bruno 2026-07-09.
    if (/unsupported request|IGApiException/i.test(raw)) {
      throw new Error(
        "Não consegui ler essa conta do Instagram — o token não está autorizado pela API. Verifique: (1) a conta é Profissional (Business/Criador)? (2) reconecte a conta em Canais. " +
        "Se ela JÁ é Profissional e o erro continuar, o app Meta provavelmente está em modo de DESENVOLVIMENTO — nesse modo só a conta dona do app (ou contas adicionadas como testadoras) funcionam; pra conectar contas de clientes o app precisa ser publicado (App Review)."
      );
    }
    throw new Error(`Não consegui ler o perfil do Instagram: ${raw}`);
  }

  const media = await getRecentMedia(conn.igUserId, conn.accessToken, n);
  const posts = media.ok ? (media.data.data || []) : [];

  // ── Paleta da marca: extrai as cores saturadas da foto de perfil (logo) ──
  // É o que faltava pros letreiros usarem a cor REAL da marca (não o violeta padrão).
  let paletaMarca: string[] = [];
  try {
    if (prof.data.profile_picture_url) {
      const r = await fetch(prof.data.profile_picture_url);
      if (r.ok) paletaMarca = await extrairPaletaMarca(Buffer.from(await r.arrayBuffer()));
    }
  } catch { /* falha na extração → segue sem paleta */ }

  // ── Extração determinística (regex) ──
  const captions = posts.map((p) => p.caption).filter((c): c is string => !!c);
  const contagemHashtags: Record<string, number> = {};
  for (const c of captions) {
    for (const tag of c.match(/#[\p{L}0-9_]+/gu) || []) {
      const t = tag.slice(1).toLowerCase();
      contagemHashtags[t] = (contagemHashtags[t] || 0) + 1;
    }
  }
  const topHashtags = Object.entries(contagemHashtags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([t]) => t);
  const exemplosLegendas = captions.slice(0, 6).map((c) => c.slice(0, 300));

  // ── Análise por IA (cap de 30 legendas p/ controlar custo mesmo com 100 posts) ──
  const analise = await analisarFeedIA(workspaceId, { profile: prof.data, captions: captions.slice(0, 30) });

  const atual = await getBrandKit(workspaceId);
  const seVazio = (novo: any, velho: any) => (velho && String(velho).trim() ? velho : novo);
  const arrSeVazio = (novo: any[], velho: any) => (Array.isArray(velho) && velho.length ? velho : novo);

  const brandKit = await upsertBrandKit(workspaceId, {
    instagramConnectionId: conn.id,
    paletaCores: arrSeVazio(paletaMarca, atual?.paletaCores),
    descricaoNegocio: seVazio(analise.descricaoNegocio, atual?.descricaoNegocio),
    publicoAlvo: seVazio(analise.publicoAlvo, atual?.publicoAlvo),
    tomVoz: seVazio(analise.tomVoz, atual?.tomVoz),
    temasRecorrentes: analise.temasRecorrentes?.length ? analise.temasRecorrentes : (atual?.temasRecorrentes ?? []),
    hashtagsPadrao: arrSeVazio(topHashtags, atual?.hashtagsPadrao),
    exemplosLegendas,
    logoUrl: atual?.logoUrl || prof.data.profile_picture_url,
    fontesConhecimento: {
      ...((atual?.fontesConhecimento as any) || {}),
      instagram: {
        igUsername: prof.data.username,
        followers: prof.data.followers_count,
        mediaCount: prof.data.media_count,
        website: prof.data.website,
        syncedPosts: posts.length,
        postsLimite: n,
      },
    },
    baseConhecimento: [
      { tipo: "instagram_perfil", biography: prof.data.biography, name: prof.data.name, website: prof.data.website, followers: prof.data.followers_count },
      ...posts.slice(0, n).map((p) => ({
        tipo: "instagram_post",
        caption: p.caption,
        mediaType: p.media_type,
        likes: p.like_count,
        comments: p.comments_count,
        permalink: p.permalink,
        timestamp: p.timestamp,
      })),
    ],
    ultimaSincronizacao: new Date(),
  });

  return { brandKit, postsAnalisados: posts.length, igUsername: prof.data.username };
}
