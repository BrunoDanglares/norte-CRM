// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Ingestão de CRM + Site → Brand Kit (munição extra pro agente).
//
// FONTES (todas genéricas, servem qualquer segmento — o CRM é multi-segmento):
//   • FAQ dos clientes  ← mensagens recebidas (messages.direction='in') → IA extrai
//                          as dúvidas/objeções mais frequentes.
//   • Prova social      ← deals (negócios). "Ganhos" detectados por stage; fallback
//                          nos maiores por valor.
//   • Site              ← scrape da URL + IA resume o que o negócio faz/oferece.
//
// Nada aqui assume nicho: os prompts pedem à IA que resuma o que ENCONTRAR.
// Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { messages, deals } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getBrandKit, upsertBrandKit } from "./instaflixService";
import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";
import { assertSafeOutboundUrl, safeOutboundFetch } from "../utils/ssrfGuard";
import { renderSite } from "./siteRenderer";

// stage de deal que indica negócio fechado/ganho (vocabulário varia por tenant).
const WON_RE = /ganho|ganhou|won|fechad|closed|conclu/i;

async function chamarIA<T = any>(workspaceId: string, system: string, user: string): Promise<T | null> {
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return null;
  const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    return JSON.parse(resp.choices?.[0]?.message?.content || "{}") as T;
  } catch {
    return null;
  }
}

export interface CrmSyncResult {
  faqCount: number;
  provaSocialCount: number;
  mensagensAnalisadas: number;
  dealsAnalisados: number;
}

export async function sincronizarCRM(workspaceId: string): Promise<CrmSyncResult> {
  // ── FAQ: mensagens recebidas dos clientes ──
  const inbound = await db.select({ texto: messages.texto })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.direction, "in")))
    .orderBy(desc(messages.id))
    .limit(300);
  const textos = inbound.map((m) => (m.texto || "").trim()).filter((t) => t.length > 2);

  let faqClientes: string[] = [];
  if (textos.length >= 3) {
    const r = await chamarIA<{ faq: string[] }>(
      workspaceId,
      "Você recebe mensagens REAIS enviadas por clientes a um negócio (qualquer segmento). Extraia as 8 a 12 DÚVIDAS/OBJEÇÕES/INTERESSES mais frequentes, como perguntas curtas e genéricas em português, SEM dados pessoais (nomes, telefones, valores específicos). Responda JSON { faq: string[] }.",
      textos.slice(0, 200).map((t, i) => `${i + 1}. ${t.slice(0, 200)}`).join("\n"),
    );
    faqClientes = Array.isArray(r?.faq) ? r!.faq.slice(0, 12) : [];
  }

  // ── Prova social: deals ──
  const negocios = await db.select().from(deals)
    .where(eq(deals.workspaceId, workspaceId))
    .orderBy(desc(deals.valor))
    .limit(50);

  const ganhos = negocios.filter((d) => WON_RE.test(d.stage || ""));
  const base = ganhos.length ? ganhos : negocios;
  const provaSocial: string[] = base.slice(0, 10).map((d) => {
    const empresa = d.empresa ? ` — ${d.empresa}` : "";
    const valor = Number(d.valor) > 0 ? ` (R$ ${d.valor})` : "";
    return `${d.titulo}${empresa}${valor}`;
  });
  if (negocios.length) {
    provaSocial.unshift(
      `${ganhos.length ? `${ganhos.length} negócio(s) fechado(s)` : `${negocios.length} negócio(s) no CRM`} — use como prova de resultado/experiência, sem citar dados privados.`,
    );
  }

  await upsertBrandKit(workspaceId, {
    faqClientes,
    provaSocial,
    fontesConhecimento: {
      ...(((await getBrandKit(workspaceId))?.fontesConhecimento as any) || {}),
      crm: { mensagensAnalisadas: textos.length, dealsAnalisados: negocios.length, ganhos: ganhos.length },
    },
    ultimaSincronizacao: new Date(),
  });

  return {
    faqCount: faqClientes.length,
    provaSocialCount: provaSocial.length,
    mensagensAnalisadas: textos.length,
    dealsAnalisados: negocios.length,
  };
}

export interface SiteSyncResult {
  url: string;
  resumo: string;
  paginas: number;      // quantas páginas foram lidas
  temPlanos: boolean;   // achou planos/preços?
  aviso?: string;       // conteúdo pobre (SPA sem SEO) → orienta o usuário
  produtosServicos?: string;  // o que a análise preencheu (pra UI refletir)
  planosValores?: string;
  paleta?: string[];          // cores de marca captadas do site (só se o campo estava vazio)
  hashtags?: string[];        // hashtags captadas (só se o campo estava vazio)
}

// ── Fetch robusto de HTML (headers de navegador + timeout + SSRF guard + cap de bytes) ──
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_HTML_BYTES = 5 * 1024 * 1024; // teto de 5MB por página (anti response-bomb / OOM)

// Lê o corpo com TETO DE BYTES durante o streaming (o AbortController só limita TEMPO).
async function lerCapado(res: Response, maxBytes: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body) return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { chunks.push(value); total += value.length; if (total >= maxBytes) break; }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

// fetch de HTML passando pela guarda anti-SSRF (valida host + revalida cada redirect).
async function fetchHtml(url: string, timeoutMs = 12000): Promise<{ ok: boolean; html: string; finalUrl: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await safeOutboundFetch(url, {
      headers: {
        "User-Agent": UA_BROWSER,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, html: "", finalUrl: res.url };
    if (!/html|text\/plain|xml/i.test(res.headers.get("content-type") || "")) return { ok: false, html: "", finalUrl: res.url };
    return { ok: true, html: await lerCapado(res, MAX_HTML_BYTES), finalUrl: res.url };
  } catch {
    return { ok: false, html: "", finalUrl: url }; // inclui host bloqueado pelo SSRF guard
  } finally {
    clearTimeout(t);
  }
}

// Domínio pode só responder em https / www / http — tenta as variantes (cada uma revalidada).
async function fetchHtmlComFallback(url: string): Promise<{ ok: boolean; html: string; finalUrl: string }> {
  const tentativas = [url];
  try {
    const u = new URL(url);
    if (!u.hostname.startsWith("www.")) tentativas.push(`${u.protocol}//www.${u.hostname}${u.pathname}`);
    tentativas.push(`http://${u.hostname}${u.pathname}`);
  } catch { /* url já validada antes */ }
  for (const t of tentativas) {
    const r = await fetchHtml(t);
    if (r.ok && r.html) return r;
  }
  return { ok: false, html: "", finalUrl: url };
}

function limparTextoHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Decodifica as entidades HTML mais comuns (o resto vira espaço via regex acima).
function decodeEntities(s: string): string {
  return String(s || "")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&#x?[0-9a-f]+;/gi, " ").replace(/\s+/g, " ").trim();
}

// EXTRAÇÃO DO <head>: title, meta description/keywords, og:* e a DESCRIÇÃO do JSON-LD —
// contexto extra pra IA (e fonte das hashtags via keywords). Preço NÃO sai daqui (o JSON-LD
// de SEO fica desatualizado); o preço real vem do texto VISÍVEL do render. Bruno 2026-07-09.
function extrairMetadados(html: string): { texto: string } {
  const partes: string[] = [];
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  if (title) partes.push(`Título: ${title}`);

  const wanted = /^(description|keywords|author|og:title|og:description|og:site_name|twitter:title|twitter:description)$/i;
  const vistos = new Set<string>();
  let m: RegExpExecArray | null;
  const metaRe = /<meta\b[^>]*>/gi;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const key = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([\s\S]*?)["']/i) || [])[1];
    if (!key || !content || !wanted.test(key)) continue;
    const val = decodeEntities(content);
    const dedup = key.toLowerCase() + "|" + val.toLowerCase();
    if (val && !vistos.has(dedup)) { vistos.add(dedup); partes.push(`${key}: ${val}`); }
  }

  // JSON-LD (dados estruturados) — SÓ a descrição rica. NÃO extraímos preço de "offers":
  // o JSON-LD de SEO costuma estar DESATUALIZADO (o FTTH Planner declarava R$49 no JSON-LD
  // mas a página renderizada mostra R$100+). O preço REAL vem do texto VISÍVEL do render.
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRe.exec(html))) {
    let data: any;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes: any[] = Array.isArray(data) ? data : (Array.isArray(data?.["@graph"]) ? data["@graph"] : [data]);
    for (const node of nodes) {
      if (node && typeof node === "object" && node.description) {
        partes.push(`Dados estruturados${node.name ? ` (${node.name})` : ""}: ${decodeEntities(String(node.description))}`);
      }
    }
  }

  return { texto: partes.join("\n") };
}

// Descobre páginas internas pelo sitemap.xml (complementa o scrape de <a> — SPAs
// não têm links no HTML). Ignora âncoras (#) e assets. Bruno 2026-07-09.
async function coletarSitemap(baseUrl: string): Promise<string[]> {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const host = base.hostname.replace(/^www\./, "");
  const r = await fetchHtml(`${base.origin}/sitemap.xml`, 8000);
  if (!r.ok || !r.html) return [];
  const locs = [...r.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  const out: string[] = [];
  for (const loc of locs) {
    if (loc.includes("#")) continue;                                        // âncora SPA → mesma página
    let u: URL; try { u = new URL(loc); } catch { continue; }
    if (u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|mp4|webp|svg|css|js|ico|xml|woff2?)$/i.test(u.pathname)) continue;
    const chave = u.origin + u.pathname;
    if (chave === base.origin + base.pathname) continue;
    out.push(chave);
  }
  return out;
}

// Páginas úteis pra criar conteúdo — priorizadas na varredura.
const LINK_PRIORIDADE_RE = /(plano|preco|pre[çc]o|price|pricing|assinatura|servi[çc]o|produto|funcionalidade|recurso|feature|solu[çc]|sobre|about|cat[aá]logo|card[aá]pio|tabela)/i;

// Coleta links INTERNOS da home e ordena por prioridade (planos/preços/serviços primeiro).
function coletarLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const host = base.hostname.replace(/^www\./, "");
  const score = new Map<string, number>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim().split("#")[0];
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs: URL;
    try { abs = new URL(href, base); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (abs.hostname.replace(/^www\./, "") !== host) continue;              // só interno
    if (/\.(pdf|jpe?g|png|gif|zip|mp4|webp|svg|css|js|ico|woff2?)$/i.test(abs.pathname)) continue;
    const chave = abs.origin + abs.pathname;
    if (chave === base.origin + base.pathname) continue;                    // pula a própria home
    const alvo = href + " " + m[2].replace(/<[^>]+>/g, " ");
    score.set(chave, Math.max(score.get(chave) || 0, LINK_PRIORIDADE_RE.test(alvo) ? 2 : 1));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

// Normaliza hashtags: tira '#', espaços e acentos/símbolos, minúsculo, dedupe, teto 8.
function normalizarHashtags(arr: any[]): string[] {
  const out: string[] = [];
  for (const h of arr || []) {
    const tag = String(h || "").trim()
      .replace(/^#+/, "").replace(/\s+/g, "")
      .replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    if (tag && tag.length >= 2 && !out.includes(tag)) out.push(tag);
    if (out.length >= 8) break;
  }
  return out;
}

// Fallback de hashtags: as keywords do <head> (linha "keywords: a, b, c" dos metadados).
function keywordsDoMeta(metaTexto: string): string[] {
  const m = String(metaTexto || "").match(/^keywords:\s*(.+)$/im);
  if (!m) return [];
  return m[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

// LEITURA MINUCIOSA (Bruno 2026-07-09): RENDERIZA o site num navegador headless (executa
// o JS → lê os preços/planos REAIS de sites SPA), varre páginas internas, e extrai de forma
// estruturada e adaptada ao SEGMENTO tudo que ajuda a criar conteúdo — resumo, produtos,
// PLANOS E VALORES reais, paleta de cores e hashtags. Copia preços do que está VISÍVEL;
// nunca inventa. Fetch passa pela guarda anti-SSRF.
export async function sincronizarSite(workspaceId: string, urlRaw: string): Promise<SiteSyncResult> {
  let url = String(urlRaw || "").trim();
  if (!url) throw new Error("Informe a URL do site.");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { assertSafeOutboundUrl(url); } catch { throw new Error("URL inválida ou bloqueada. Confira o endereço (ex.: https://seusite.com.br)."); }

  // 1) Renderiza a home num navegador headless (JS → preços/planos REAIS de SPAs) e capta
  //    a paleta de cores. Fallback: fetch simples (SSR, ou se o navegador não estiver disponível).
  let homeHtml = "";
  let baseUrl = url;
  let bodyHome = "";
  let paletaSite: string[] = [];
  try {
    const rd = await renderSite(url);
    homeHtml = rd.html;
    bodyHome = rd.texto;
    paletaSite = rd.paleta;
    baseUrl = rd.finalUrl;
  } catch {
    const home = await fetchHtmlComFallback(url);
    if (!home.ok || !home.html) {
      throw new Error("Não consegui acessar o site. Confira o endereço (sem espaços, domínio correto) — talvez ele bloqueie leitura automática.");
    }
    homeHtml = home.html;
    bodyHome = limparTextoHtml(home.html);
    baseUrl = home.finalUrl;
  }

  // 2) <head> (SEO: title/meta/og/JSON-LD) — contexto extra (e fonte das hashtags via keywords).
  const metadados = extrairMetadados(homeHtml);

  // 3) Páginas internas prioritárias (scrape de <a> do DOM renderizado [cap p/ evitar ReDoS]
  //    + sitemap.xml), buscadas com fetch seguro; até 4 extras.
  const linksScrape = coletarLinks(homeHtml.slice(0, 300000), baseUrl);
  const linksSitemap = await coletarSitemap(baseUrl);
  const links = [...new Set([...linksScrape, ...linksSitemap])].slice(0, 4);
  const paginas: { url: string; texto: string }[] = [{ url: baseUrl, texto: bodyHome }];
  for (const link of links) {
    if (paginas.length >= 5) break;
    const p = await fetchHtml(link);
    if (p.ok && p.html) {
      const txt = limparTextoHtml(p.html);
      if (txt.length > 120) paginas.push({ url: link, texto: txt });
    }
  }

  const bk0 = await getBrandKit(workspaceId);
  const paletaAtual = Array.isArray(bk0?.paletaCores) ? (bk0!.paletaCores as string[]) : [];
  const hashtagsAtuais = Array.isArray(bk0?.hashtagsPadrao) ? (bk0!.hashtagsPadrao as string[]) : [];
  // Paleta/hashtags: só PREENCHE se o campo estiver vazio (não sobrescreve escolha do tenant).
  const paletaFinal = paletaAtual.length ? paletaAtual : paletaSite;

  // 4) Conteúdo pobre (site bloqueia leitura mesmo renderizado): NÃO deixamos a IA inventar.
  const bodyTexto = paginas.map((p) => p.texto).join(" ").replace(/\s+/g, " ").trim();
  const conteudoPobre = metadados.texto.length < 80 && bodyTexto.length < 200;
  if (conteudoPobre) {
    await upsertBrandKit(workspaceId, {
      siteUrl: url,
      paletaCores: paletaFinal,
      ultimaSincronizacao: new Date(),
    });
    return {
      url, resumo: "", paginas: paginas.length, temPlanos: false,
      aviso: "Não consegui ler o conteúdo do site (pode bloquear leitura automática). Preencha os campos à mão ou envie os materiais (PDF/print) em “Materiais do negócio”.",
      paleta: (!paletaAtual.length && paletaSite.length) ? paletaSite : undefined,
    };
  }

  // 5) Corpo pra IA: metadados + páginas (o texto VISÍVEL do render já traz os preços reais).
  const corpo = [
    metadados.texto ? `--- METADADOS DO SITE (head/SEO) ---\n${metadados.texto}` : "",
    ...paginas.map((p) => `--- PÁGINA: ${p.url} ---\n${p.texto}`),
  ].filter(Boolean).join("\n\n").slice(0, 24000);

  // 6) Extração estruturada, adaptada ao segmento.
  const segmento = String((bk0 as any)?.segmento || "").trim();
  const r = await chamarIA<{ resumo: string; produtosServicos?: string; planosValores?: string; hashtags?: string[]; faq?: string[] }>(
    workspaceId,
    `Você recebe METADADOS (SEO) + o TEXTO VISÍVEL das páginas do site de um negócio${segmento ? ` do segmento "${segmento}"` : ""}. Extraia, em português, TUDO que for útil pra criar conteúdo de Instagram — SEM inventar nada fora do que está no texto. Se um dado não estiver lá, deixe vazio. Responda JSON: {
  resumo: string (3-5 frases: o que o negócio faz, pra quem, e os diferenciais — só com base no texto),
  produtosServicos: string (lista curta do que é vendido/oferecido/das funcionalidades),
  planosValores: string (planos, pacotes e PREÇOS REAIS. PREFIRA os preços que aparecem no TEXTO VISÍVEL das páginas — os "dados estruturados" do SEO podem estar DESATUALIZADOS. Liste TODOS os planos com o valor EXATO — ex.: "Básico R$ 100/mês; Pro R$ 199,90/mês". Sem preço no texto → retorne ""),
  hashtags: array de 5-8 hashtags SEM '#', relevantes ao negócio/segmento (ex.: fibraoptica, provedor, ftth),
  faq: array de strings (dúvidas/objeções que o site responde) }.`,
    corpo,
  );

  const resumo = (r?.resumo || "").trim() || bk0?.siteResumo || "";
  const faqNovas = Array.isArray(r?.faq) ? r!.faq.map((q) => String(q).trim()).filter(Boolean).slice(0, 8) : [];
  const faqAtuais = Array.isArray(bk0?.faqClientes) ? (bk0!.faqClientes as string[]) : [];
  const produtos = (r?.produtosServicos || "").trim();
  // Planos: do texto VISÍVEL (via IA). NÃO usa mais o JSON-LD como verdade (pode estar velho).
  const planos = (r?.planosValores || "").trim();
  // Hashtags: da IA; fallback nas keywords do <head>.
  const hashtagsIA = Array.isArray(r?.hashtags) ? r!.hashtags : [];
  const hashtagsSite = normalizarHashtags(hashtagsIA.length ? hashtagsIA : keywordsDoMeta(metadados.texto));
  const hashtagsFinal = hashtagsAtuais.length ? hashtagsAtuais : hashtagsSite;

  await upsertBrandKit(workspaceId, {
    siteUrl: url,
    siteResumo: resumo,
    // "Analisar" é ação explícita → atualiza produtos/planos quando o site trouxe algo.
    produtosServicos: produtos || bk0?.produtosServicos || null,
    planosValores: planos || bk0?.planosValores || null,
    // Paleta/hashtags: preenche só se estava vazio (não sobrescreve escolha do tenant).
    paletaCores: paletaFinal,
    hashtagsPadrao: hashtagsFinal,
    faqClientes: faqNovas.length ? Array.from(new Set([...faqAtuais, ...faqNovas])).slice(0, 12) : faqAtuais,
    ultimaSincronizacao: new Date(),
  });

  return {
    url, resumo, paginas: paginas.length, temPlanos: !!planos,
    produtosServicos: produtos || undefined,
    planosValores: planos || undefined,
    paleta: (!paletaAtual.length && paletaSite.length) ? paletaSite : undefined,
    hashtags: (!hashtagsAtuais.length && hashtagsSite.length) ? hashtagsSite : undefined,
  };
}
