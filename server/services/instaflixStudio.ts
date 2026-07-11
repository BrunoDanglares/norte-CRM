// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — O "estúdio": pipeline de agentes de IA que gera um post completo.
//
//   Estrategista → decide o tema/ângulo (com base no brand kit + pilar)
//   Copywriter   → legenda + hashtags + CTA na voz da marca
//   Diretor Arte → briefa cada slide (prompt de imagem + texto do slide)
//   Gerador      → cria as imagens (gpt-image-1) e salva em /uploads
//   QA (código)  → normaliza limites do Instagram e valida o resultado
//
// Cada agente é uma chamada chat.completions com saída JSON, usando a chave
// OpenAI do tenant (resolveOpenAIKeys). Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";
import { gerarImagemIA, type TamanhoImagem } from "./instaflixImageService";
import { brandLogoUrls } from "./instaflixService";
import { resolveSegmento } from "./instaflixSegmentos";
import { datasComemorativasProximas } from "./datasComemorativas";
import type { InstaflixBrandKit, InstaflixPillar } from "@shared/schema";

const LEGENDA_MAX = 2200;        // limite duro do Instagram
const HASHTAGS_MAX = 20;         // teto prático (IG permite 30, mas 20 já é muito)
const BRIEFING_MAX = 500;        // limite do briefing livre do usuário (guardrail)

// Estilos de publicação — direção editorial que o usuário escolhe por post. Cada
// um muda o ÂNGULO (estrategista), a CONSTRUÇÃO do texto (copy) e a DIREÇÃO de arte.
// As chaves batem com o select do Estúdio (client/src/pages/Instaflix.tsx). Se um
// valor desconhecido chegar, é ignorado (comportamento = "automático"). Bruno 2026-07-07.
export const ESTILOS_PUBLICACAO: Record<string, { nome: string; guia: string }> = {
  informativo: {
    nome: "Informativo/Educativo",
    guia: "Ensine algo útil e prático (dica, passo a passo, 'como fazer', mito x verdade). Entregue valor sem vender. Meta: autoridade, salvamentos e compartilhamentos.",
  },
  promocional: {
    nome: "Promocional/Oferta",
    guia: "Destaque um produto/combo gerando DESEJO, com um CTA de compra claro. NÃO invente desconto, %, preço nem oferta — só cite uma oferta se ela vier LITERALMENTE no briefing do usuário. Sem oferta no briefing, venda pelo apetite/benefício, não por número. Meta: conversão.",
  },
  institucional: {
    nome: "Institucional",
    guia: "Mostre história, valores, bastidores ou equipe. Humanize a marca e crie identificação. Meta: confiança e conexão.",
  },
  engajamento: {
    nome: "Engajamento",
    guia: "Provoque interação: pergunta, enquete, 'marque um amigo', humor leve e relacionável. Meta: comentários, salvamentos e alcance.",
  },
  prova_social: {
    nome: "Prova social",
    guia: "Use depoimento, resultado ou antes-e-depois. NUNCA exponha dados privados de cliente nem invente números. Mostre transformação real. Meta: reduzir objeção e ajudar na decisão.",
  },
  sazonal: {
    nome: "Sazonal",
    guia: "Conecte com uma data comemorativa ou tendência do momento — SÓ se combinar de forma natural com a marca. Meta: relevância no momento certo.",
  },
  // ── Estilos por segmento (Fase 1) — só aparecem no Estúdio quando o segmento os habilita.
  antes_depois: {
    nome: "Antes e depois",
    guia: "Mostre a TRANSFORMAÇÃO: o antes x o depois (resultado real do produto/serviço). Prova pelo resultado. NUNCA invente resultado nem exponha dado privado de cliente. Meta: convencer pela transformação.",
  },
  tutorial: {
    nome: "Tutorial / Como usar",
    guia: "Ensine a usar/fazer em passos simples ('como usar', passo a passo, dica prática). Meta: valor prático e reduzir a dúvida antes da compra.",
  },
  comparativo: {
    nome: "Comparativo",
    guia: "Compare opções, modelos ou planos de forma JUSTA e visual (specs, prós/contras, 'qual escolher'). Meta: ajudar a decisão.",
  },
  lookbook: {
    nome: "Vitrine / Lookbook",
    guia: "Vitrine de produtos/looks — apresente os itens com desejo visual e styling caprichado. Meta: desejo e descoberta.",
  },
  bastidores: {
    nome: "Bastidores",
    guia: "Mostre os BASTIDORES: como é feito, a rotina, a equipe, o processo. Foco no PROCESSO/dia a dia (distinto do institucional, que é história/valores). Meta: proximidade e autenticidade.",
  },
};

// Objetivo/CTA — a ação que o post busca. Direciona a chamada final do copywriter.
export const OBJETIVOS_CTA: Record<string, string> = {
  vender_app: "A chamada final (CTA) deve levar a pedir/comprar pelo aplicativo.",
  whatsapp: "A chamada final (CTA) deve convidar a chamar no WhatsApp.",
  seguidores: "A chamada final (CTA) deve incentivar a seguir o perfil e ativar as notificações.",
  agendar: "A chamada final (CTA) deve levar a agendar ou reservar um horário.",
};

// Fase 0 (Bruno 2026-07-08): o "objetivo" do pilar deixa de competir com o Estilo e
// vira só o Estilo-PADRÃO — usado quando o usuário deixa o Estilo em "auto". Um eixo,
// uma decisão. (Pilar = TEMA; Estilo = TOM; se não escolher o tom, herda do tema.)
const OBJETIVO_PILAR_PARA_ESTILO: Record<string, string> = {
  autoridade: "informativo",
  vendas: "promocional",
  engajamento: "engajamento",
  bastidores: "institucional",
};

// ── Guardrail comercial: a IA NÃO pode INVENTAR oferta/desconto/preço ─────────
// A diretriz da marca ("nunca oferecer desconto se não for criado por mim") era só
// uma linha fraca no contexto e a IA a ignorava — chegou a estampar "Combo com 20%
// off" numa marca que proíbe. Detectamos qualquer menção a oferta/desconto/preço e,
// se não veio do briefing do usuário, sanitizamos (rede de segurança de código, além
// das regras duras nos prompts). Bruno 2026-07-08.
export const OFERTA_RE = /(\d\s*%|\bpor\s*cento\b|\boff\b|\bdesconto|\bpromo[çc]|\boferta|\bcashback|\bcupom|\bcupons|\bbrinde|\bgr[áa]tis|\bleve\s+\d|\bpague\s+\d|R\$\s*\d)/i;

// Remove fragmentos de oferta de um OVERLAY curto; se sobrar pouco, cai num fallback
// seguro (o tema do post). Nunca deixa o letreiro com desconto que a marca proíbe.
function sanitizarOverlayOferta(txt: string, fallback: string): string {
  let s = String(txt || "")
    .replace(/\d+\s*%\s*(de\s+)?(off|desconto)?/gi, " ")
    .replace(/R\$\s*\d+[.,]?\d*/gi, " ")
    .replace(/\bleve\s+\d+\s*(pague\s+\d+)?\b/gi, " ")
    .replace(/\b(off|descontos?|promo[çc][õo]es?|promo[çc][ãa]o|ofertas?|cashback|cupom|cupons|brindes?|gr[áa]tis)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
  // Remove pontuação e conectores pendurados nas pontas (ex.: sobrou "…com!" / "…de").
  const limpaBordas = (x: string) => {
    let y = x.replace(/^[\s·,;:\-–—!?.]+/g, "").replace(/[\s·,;:\-–—!?.]+$/g, "").trim();
    y = y.replace(/\s+(com|de|do|da|e|para|pra|no|na|o|a|em|por|que)$/i, "").trim();
    return y.replace(/[\s·,;:\-–—!?.]+$/g, "").trim();
  };
  s = limpaBordas(limpaBordas(s)); // 2x: pode ter conector + pontuação em sequência
  const util = s.replace(/[^a-zA-ZÀ-ÿ0-9]/g, "");
  if (util.length < 4) {
    s = String(fallback || "Peça o seu").split(/[.!?\n]/)[0].trim().slice(0, 42) || "Peça o seu";
  }
  return s;
}

// Divisão em FRASES que NÃO quebra dentro de números: corta após .!? só quando vem
// espaço/fim (o ponto de MILHAR de "R$ 1.999,90" é seguido de dígito → NÃO corta) ou
// após quebra de linha. Bruno 2026-07-09 (achado: o split partia "1.999,90" em "1."+"999,90"
// e o guardrail lia "R$ 1." como R$ 1, apagando o preço real).
const SPLIT_FRASE = /(?<=[.!?])(?=\s|$)|(?<=\n)/;

// Remove FRASES da legenda que contenham oferta inventada (mantém o resto).
export function sanitizarLegendaOferta(txt: string): string {
  return String(txt || "")
    .split(SPLIT_FRASE)
    .filter((frag) => !OFERTA_RE.test(frag))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ── Allowlist TIPADA de ofertas (Bruno 2026-07-09, pós-revisão adversarial) ──
// A rede de segurança NÃO pode ser só "números": um PREÇO real (R$ 49) não pode
// autorizar um DESCONTO inventado (49% OFF), e um número qualquer no briefing
// ("20 anos") não pode liberar "20% OFF". Classificamos cada sinal de oferta por
// TIPO (preço em R$, percentual, palavra-gatilho, leve-pague) e só liberamos uma frase
// se CADA sinal dela constar, do MESMO tipo, no texto autorizado (briefing + planos REAIS).

// "1.999,90" / "49" / "49,00" / "49.00" → o MESMO número canônico (compara valor, não string).
function parseBRNum(s: string): number {
  let t = String(s || "").trim();
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");     // BR: ponto=milhar, vírgula=decimal
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");     // "1.999" milhar sem decimal
  const n = parseFloat(t);
  return isFinite(n) ? n : NaN;
}

// Palavras-gatilho de oferta. off/desconto/promo/oferta são sinônimos genéricos de desconto
// (tipo "promo" — o que trava oferta inventada é o NÚMERO, não a palavra); grátis/brinde/
// cashback/cupom são mecanismos DISTINTOS (cada um só passa se o seu tipo constar).
const OFERTA_PALAVRAS: { key: string; re: RegExp }[] = [
  { key: "promo", re: /\boff\b/i },
  { key: "promo", re: /\bdescont/i },
  { key: "promo", re: /\bpromo[çc]/i },
  { key: "promo", re: /\boferta/i },
  { key: "cashback", re: /\bcashback/i },
  { key: "cupom", re: /\bcupom\b|\bcupons\b/i },
  { key: "brinde", re: /\bbrinde/i },
  { key: "gratis", re: /\bgr[áa]tis/i },
];

// Percentuais que são OFERTA (desconto). EXCLUI descritivos ("100% natural/algodão…") e
// comparativos de ATRIBUTO ("30% mais sabor / menos gordura") — esses não são oferta. MAS
// comparativo de PREÇO ("50% a menos / mais barato / em conta") É desconto → conta como oferta.
function percentuaisOferta(texto: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d.,]*)\s*(?:%|por\s*cento)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const dpp = texto.slice(m.index + m[0].length, m.index + m[0].length + 20).toLowerCase().replace(/^\s+/, "");
    // redução de PREÇO ("a menos", "mais barato/em conta/econômico/acessível/em promoção") = OFERTA.
    const reducaoPreco = /^(a\s+menos|(?:mais|menos)\s+(?:barat|em\s+conta|econ[oô]mic|acess[ií]vel|em\s+promo|em\s+oferta))/i.test(dpp);
    // comparativo de ATRIBUTO ("mais sabor", "menos gordura") = descritivo → não é oferta.
    if (!reducaoPreco && /^(?:a\s+)?(?:mais|menos)\s+[a-zà-ÿ]/i.test(dpp)) continue;
    const n = parseBRNum(m[1]);
    // "100% <palavra não-desconto>" (100% natural/algodão/orgânico…) → descritivo, não oferta.
    if (n === 100 && /^[a-zà-ÿ]/i.test(dpp) && !/^(de\s+)?(off|descont|promo|ofert)/i.test(dpp)) continue;
    if (isFinite(n)) out.push(n);
  }
  return out;
}

// Pares "leve X pague Y" canônicos ("X:Y") — o mecanismo só passa com o par EXATO.
function levePaguePares(texto: string): Set<string> {
  const out = new Set<string>();
  for (const m of String(texto).matchAll(/\bleve\s+(\d+)\D{0,14}?pague\s+(\d+)/gi)) out.add(`${m[1]}:${m[2]}`);
  return out;
}

// Instagram NÃO renderiza Markdown — `**negrito**`, `__x__`, `# título`, `` `code` `` saem
// com os símbolos LITERAIS na legenda (feio). Remove os marcadores mantendo o texto.
// Bruno 2026-07-11.
export function limparMarkdown(txt: string): string {
  return String(txt || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")          // **negrito** → negrito
    .replace(/__([^_]+)__/g, "$1")              // __negrito__ → negrito
    .replace(/`([^`]+)`/g, "$1")                // `code` → code
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")   // "## Título" → "Título"
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")        // "> citação" → "citação"
    .replace(/\*\*/g, "")                        // ** solto/desbalanceado
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface OfertasAutorizadas {
  precos: Set<number>;      // valores em R$ autorizados
  percents: Set<number>;    // percentuais de desconto autorizados
  palavras: Set<string>;    // palavras-gatilho autorizadas
  levepague: Set<string>;   // pares "X:Y" de "leve X pague Y" autorizados
}

// Lê o texto AUTORIZADO (briefing + planosValores) e classifica o que pode aparecer.
export function analisarOfertas(texto: string): OfertasAutorizadas {
  const t = String(texto || "");
  const precos = new Set<number>();
  for (const m of t.matchAll(/R\$\s*(\d[\d.,]*)/gi)) { const n = parseBRNum(m[1]); if (isFinite(n)) precos.add(n); }
  const palavras = new Set<string>();
  for (const p of OFERTA_PALAVRAS) if (p.re.test(t)) palavras.add(p.key);
  return { precos, percents: new Set<number>(percentuaisOferta(t)), palavras, levepague: levePaguePares(t) };
}

// true se TODO sinal de oferta do fragmento estiver autorizado (mesmo tipo). Só faz
// sentido chamar quando OFERTA_RE já casou no fragmento.
export function ofertaAutorizada(frag: string, aut: OfertasAutorizadas): boolean {
  const f = String(frag || "");
  // preços em R$
  for (const m of f.matchAll(/R\$\s*(\d[\d.,]*)/gi)) { const n = parseBRNum(m[1]); if (!isFinite(n) || !aut.precos.has(n)) return false; }
  // percentuais de oferta (descritivos são ignorados)
  for (const n of percentuaisOferta(f)) if (!aut.percents.has(n)) return false;
  // palavras-gatilho
  for (const p of OFERTA_PALAVRAS) if (p.re.test(f) && !aut.palavras.has(p.key)) return false;
  // leve-pague: cada par EXATO precisa constar (a promo "leve X pague Y" inventada cai aqui).
  // "leve 3" solto (imperativo legítimo) e "cem por cento natural" (descritivo por extenso)
  // NÃO são derrubados — o desconto por extenso real já carrega palavra-gatilho (loop acima).
  const pares = levePaguePares(f);
  for (const par of pares) if (!aut.levepague.has(par)) return false;
  return true;
}

// Sanitiza a legenda: mantém frases de oferta cujos sinais (preço/%/palavra/leve-pague)
// estejam TODOS autorizados no `textoAutorizado`. Sem nada autorizado → remove toda oferta.
export function sanitizarLegendaComValores(txt: string, textoAutorizado: string): string {
  const aut = analisarOfertas(textoAutorizado);
  const original = String(txt || "");
  // Par "leve X … pague Y" pode ser PARTIDO em 2 frases pelo split ("Leve 3! Pague 2!") e
  // escapar da checagem por-fragmento. Detectamos os pares NÃO autorizados no texto INTEIRO
  // (tolerando pontuação/quebra entre as metades) e derrubamos as frases das duas pontas.
  const tokensProibidos: RegExp[] = [];
  for (const m of original.matchAll(/\bleve\s+(\d+)[\s\S]{0,20}?\bpague\s+(\d+)/gi)) {
    if (!aut.levepague.has(`${m[1]}:${m[2]}`)) {
      tokensProibidos.push(new RegExp(`\\bleve\\s+${m[1]}\\b`, "i"), new RegExp(`\\bpague\\s+${m[2]}\\b`, "i"));
    }
  }
  return original
    .split(SPLIT_FRASE)
    .filter((frag) => {
      if (tokensProibidos.some((re) => re.test(frag))) return false;      // metade de par leve-pague proibido
      return !OFERTA_RE.test(frag) || ofertaAutorizada(frag, aut);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function chamarAgente<T = any>(
  workspaceId: string,
  opts: { system: string; user: string; model?: string; temperature?: number },
): Promise<T> {
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) throw new Error("Nenhuma chave OpenAI configurada pro workspace");
  const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
  const resp = await client.chat.completions.create({
    model: opts.model || "gpt-4o-mini",
    temperature: opts.temperature ?? 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  const txt = resp.choices?.[0]?.message?.content || "{}";
  return JSON.parse(txt) as T;
}

// Escolhe automaticamente o ESTILO (tom) do post entre os aplicáveis ao SEGMENTO — a
// IA decide o melhor com base no pilar + briefing + marca, e varia quando não há sinal
// forte (feed não repetitivo). Fallback seguro (dica do pilar ou aleatório do pool) se
// não houver chave OpenAI ou a resposta vier inválida. Bruno 2026-07-09.
async function escolherEstiloAuto(
  workspaceId: string,
  o: { pool: string[]; dica?: string; pilar: InstaflixPillar | null; briefing: string; marca: string; modelo: string },
): Promise<string | undefined> {
  const pool = (o.pool || []).filter((k) => !!ESTILOS_PUBLICACAO[k]);
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];
  const fallback = o.dica && pool.includes(o.dica) ? o.dica : pool[Math.floor(Math.random() * pool.length)];
  try {
    const opcoes = pool.map((k) => `- ${k}: ${ESTILOS_PUBLICACAO[k].nome} — ${ESTILOS_PUBLICACAO[k].guia}`).join("\n");
    const r = await chamarAgente<{ estilo: string }>(workspaceId, {
      model: o.modelo,
      temperature: 0.5,
      system:
        "Você é um estrategista de conteúdo de Instagram. Escolha O MELHOR estilo (tom) para UM post, entre as opções dadas, com base no TEMA (pilar), no BRIEFING e na MARCA. Se houver briefing/pilar comercial, prefira um estilo de venda; se for tema informativo/humor/bastidores, prefira o tom coerente. Quando NÃO houver sinal forte, VARIE (não repita sempre o mesmo) pra o feed não ficar monótono. Responda SOMENTE JSON: { estilo: \"<uma das chaves EXATAS da lista>\" }.",
      user: `MARCA:\n${o.marca}\n\nPILAR/TEMA: ${o.pilar ? `${o.pilar.nome}. ${o.pilar.descricao || ""} ${o.pilar.promptGuia || ""}`.trim() : "sem pilar (tema livre)"}\nTom sugerido pelo pilar: ${o.dica || "nenhum"}\nBRIEFING: ${o.briefing || "(nenhum)"}\n\nESTILOS DISPONÍVEIS (escolha UMA chave):\n${opcoes}`,
    });
    const escolhido = String(r?.estilo || "").trim();
    return pool.includes(escolhido) ? escolhido : fallback;
  } catch {
    return fallback;
  }
}

// Resumo textual do brand kit pra injetar no contexto dos agentes.
function contextoMarca(bk: InstaflixBrandKit | null): string {
  if (!bk) return "Marca sem brand kit configurado. Use tom profissional e claro.";
  const partes: string[] = [];
  if (bk.descricaoNegocio) partes.push(`Negócio: ${bk.descricaoNegocio}`);
  if (bk.publicoAlvo) partes.push(`Público-alvo: ${bk.publicoAlvo}`);
  if (bk.tomVoz) partes.push(`Tom de voz: ${bk.tomVoz}`);
  // NÃO injeta a paleta de cores aqui de propósito: as cores da marca vão SÓ no
  // letreiro (overlay). Se o diretor de arte visse a paleta, tingia a FOTO com ela
  // (tudo alaranjado). A foto deve ter cor natural/variada. Bruno 2026-07-07.
  if (bk.diretrizes) partes.push(`Diretrizes (do/don't): ${bk.diretrizes}`);
  if (Array.isArray(bk.temasRecorrentes) && bk.temasRecorrentes.length) partes.push(`Temas recorrentes: ${(bk.temasRecorrentes as string[]).join(", ")}`);
  if (Array.isArray(bk.hashtagsPadrao) && bk.hashtagsPadrao.length) partes.push(`Hashtags padrão da marca: ${(bk.hashtagsPadrao as string[]).join(" ")}`);
  // Exemplos de legenda REAIS (aprendidos do feed do Instagram do tenant) — o
  // copywriter imita essa voz. Alimentado por instaflixIngest.
  if (Array.isArray(bk.exemplosLegendas) && bk.exemplosLegendas.length) {
    partes.push(`Exemplos de legendas reais da marca (imite o estilo/voz):\n${(bk.exemplosLegendas as string[]).map((c) => `- ${c}`).join("\n")}`);
  }
  // ── Munição extra (CRM/site) — alimentado por instaflixCrmIngest ──
  if (bk.produtosServicos) partes.push(`Produtos/serviços oferecidos: ${bk.produtosServicos}`);
  if (bk.planosValores) partes.push(`Planos e valores REAIS da marca (pode apresentar estes preços/planos EXATOS no post; NÃO invente outros): ${bk.planosValores}`);
  if (bk.siteResumo) partes.push(`Sobre o negócio (site): ${bk.siteResumo}`);
  if (Array.isArray(bk.faqClientes) && bk.faqClientes.length) {
    partes.push(`Dúvidas frequentes dos clientes (ótimas pautas de conteúdo educativo):\n${(bk.faqClientes as string[]).map((q) => `- ${q}`).join("\n")}`);
  }
  if (Array.isArray(bk.provaSocial) && bk.provaSocial.length) {
    partes.push(`Prova social / resultados (use com moderação, sem dados privados):\n${(bk.provaSocial as string[]).map((p) => `- ${p}`).join("\n")}`);
  }
  // Materiais enviados pelo usuário (PDF/imagem) — fonte de verdade sobre o negócio.
  const docs = (Array.isArray(bk.documentos) ? bk.documentos : []) as Array<{ nome?: string; resumo?: string }>;
  const docsUteis = docs.filter((d) => d?.resumo && String(d.resumo).trim());
  if (docsUteis.length) {
    partes.push(`Materiais de referência enviados pela marca (fonte de verdade — priorize estes fatos):\n${docsUteis.map((d) => `- ${d.nome || "material"}: ${d.resumo}`).join("\n")}`);
  }
  return partes.join("\n");
}

export interface MidiaGerada {
  ordem: number;
  url: string;
  tipo: "image";
  promptIa: string;
  textoOverlay?: string;
  erro?: string;
}

export interface RascunhoPost {
  tema: string;
  briefIa: any;
  legenda: string;
  hashtags: string[];
  midias: MidiaGerada[];
  formato: "imagem" | "carrossel";
}

// ── Seleção dos materiais que viram referência visual (modo "inspirar nos materiais") ──
// A IA já descreveu cada material no upload (campo resumo). Aqui ela escolhe os que
// PRESTAM como inspiração visual de um post — telas boas do app / artes limpas — e
// DESCARTA lixo (prints de erro/bug, borrados, puramente técnicos). Só imagens raster
// (PDF não serve de referência). Fallback heurístico se a IA falhar. Bruno 2026-07-09.
async function selecionarReferenciasVisuais(
  bk: InstaflixBrandKit | null,
  workspaceId: string,
  modelo: string,
): Promise<string[]> {
  if (!bk) return [];
  const docs = (Array.isArray(bk.documentos) ? bk.documentos : []) as Array<{ nome?: string; resumo?: string; url?: string; tipo?: string }>;
  const imgs = docs.filter((d) => d?.url && d.tipo === "imagem");
  if (!imgs.length) return [];   // sem materiais de imagem → sem referência (geração normal)

  const MAX = 3;
  let escolhidas: string[] = [];

  try {
    const lista = imgs.map((d, i) => `${i}. ${d.nome || "material"} — ${(d.resumo || "").slice(0, 200)}`).join("\n");
    const r = await chamarAgente<{ indices: number[] }>(workspaceId, {
      model: modelo,
      temperature: 0,
      system:
        "Você seleciona quais imagens de referência de uma marca servem de INSPIRAÇÃO VISUAL para a arte de um post do Instagram. Escolha as que mostram o PRODUTO/marca de forma apresentável (telas boas do app, artes/materiais limpos). DESCARTE prints de erro/bug, telas quebradas, imagens borradas, sem valor visual ou puramente técnicas/ilegíveis. Responda SOMENTE JSON: { indices: number[] }, no máximo 3, do melhor pro pior. Se nenhuma servir, retorne { indices: [] }.",
      user: `MATERIAIS (índice. nome — resumo):\n${lista}`,
    });
    const idx = Array.isArray(r?.indices) ? r.indices : [];
    escolhidas = idx
      .filter((n) => Number.isInteger(n) && n >= 0 && n < imgs.length)
      .slice(0, MAX)
      .map((n) => imgs[n].url!)
      .filter(Boolean);
  } catch { /* cai no heurístico abaixo */ }

  if (!escolhidas.length) {
    const LIXO = /bug|erro|error|falha|crash|debug|quebrad|borrad/i;
    escolhidas = imgs
      .filter((d) => !LIXO.test(`${d.nome || ""} ${d.resumo || ""}`))
      .slice(0, MAX)
      .map((d) => d.url!)
      .filter(Boolean);
  }

  return Array.from(new Set(escolhidas)).slice(0, MAX);
}

export interface GerarRascunhoOpts {
  workspaceId: string;
  brandKit: InstaflixBrandKit | null;
  pillar: InstaflixPillar | null;
  formato: "imagem" | "carrossel";
  numImagens?: number;            // itens do carrossel (2-10); ignorado se formato='imagem'
  estilo?: string;                // estilo da publicação (chave de ESTILOS_PUBLICACAO)
  briefing?: string;             // instrução livre do usuário (foco do post)
  objetivo?: string;             // CTA/objetivo (chave de OBJETIVOS_CTA)
  faixaAtiva?: boolean;           // faixa colorida no rodapé: true=faixa, false=só sombra (editorial), undefined=IA decide
  faixaCor?: string;              // cor manual da faixa (hex); sem isto herda a cor da marca
  inspirarMateriais?: boolean;    // toggle do Estúdio: usar os materiais (imagens) do produto como referência visual
  temasRecentes?: string[];       // pra não repetir assunto
  tamanho?: TamanhoImagem;
  baseUrl?: string;               // base pública pra montar a URL da imagem
  modeloTexto?: string;           // modelo dos agentes de texto (default gpt-4o-mini)
  dataAlvo?: Date;                // data/hora REAL de publicação (slot agendado). Sem isto → hoje (geração manual)
  timeZone?: string;              // timezone da marca p/ calcular o dia da semana (default America/Sao_Paulo)
  onProgress?: (pct: number) => void; // progresso 0-100 (geração em background)
}

// ── Contexto temporal — dia da semana REAL da publicação ─────────────────────
// A IA (sobretudo o copywriter) tende a "chutar" enquadramentos temporais tipo
// "fim de semana chegando" mesmo numa terça. Aqui damos o dia da semana REAL da
// data-alvo (o slot de publicação quando agendado; hoje na geração manual),
// calculado NA TIMEZONE da marca (o servidor pode rodar em UTC), e orientamos o
// uso coerente do dia como gancho/CTA. Bruno 2026-07-07.
const DIAS_SEMANA_PT = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
];
const IDX_DIA_EN: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

// Índice do dia da semana (0=domingo) NA timezone informada — robusto a servidor
// em UTC (getDay() daria o dia errado perto da meia-noite no Brasil).
function diaDaSemanaNaTz(ref: Date, timeZone: string): number {
  try {
    const nome = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(ref);
    return IDX_DIA_EN[nome] ?? ref.getDay();
  } catch {
    return ref.getDay();
  }
}

// Bloco de contexto temporal (dia da semana + data + datas comemorativas). Três
// variantes conforme o chamador:
//   • agendado (slot real de publicação) → afirma o dia da publicação + hora.
//   • manual (rascunho, data ainda indefinida) → "hoje" é só referência; NÃO
//     ancora num dia específico (o rascunho pode ser publicado noutro dia).
//   • paraArte (diretor de arte) → enxuto: só o FATO do dia + a proibição de dia
//     errado (ele só escreve um overlay curto; gancho/CTA e datas são do copy).
function blocoTemporal(ref: Date, timeZone: string, o: { agendado: boolean; paraArte?: boolean }): string {
  const dow = diaDaSemanaNaTz(ref, timeZone);
  const diaNome = DIAS_SEMANA_PT[dow];
  const ehFimDeSemana = dow === 0 || dow === 6;
  const ehSexta = dow === 5;
  const dataExtenso = new Intl.DateTimeFormat("pt-BR", {
    timeZone, day: "2-digit", month: "long", year: "numeric",
  }).format(ref);
  const horaStr = o.agendado
    ? " por volta das " + new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(ref)
    : "";

  const enquadramento = ehFimDeSemana
    ? `É FIM DE SEMANA (${diaNome}) — clima de descanso, lazer, família/amigos, "aproveitar o dia".`
    : ehSexta
      ? `É SEXTA-FEIRA — pode usar o clima de "fim de semana chegando / sextou", mas SÓ porque é sexta.`
      : `É DIA ÚTIL (${diaNome}) — NÃO trate como fim de semana. O dia é só CONTEXTO, não é o tema: só cite/insinue o dia se agregar de verdade — NÃO transforme todo post em "pausa/rotina no meio da semana".`;

  const proibicao = `Use o dia da semana REAL. É PROIBIDO dizer "fim de semana", "sextou", "fds", "domingou" ou "final de semana chegando" se NÃO for realmente sexta/sábado/domingo.`;

  // Diretor de arte: versão mínima (fato do dia + proibição).
  if (o.paraArte) {
    return [
      `CONTEXTO TEMPORAL (para o textoOverlay estampado na imagem):`,
      `- Dia de referência: ${diaNome}. ${enquadramento}`,
      `- ${proibicao} Na dúvida, faça um overlay atemporal.`,
    ].join("\n");
  }

  // Datas comemorativas próximas — tz-aware (senão, servidor em UTC erra o "em X
  // dias" por 1 em slots perto da meia-noite no Brasil). Janela curta de 10 dias.
  const proximasDatas = datasComemorativasProximas(ref, 10, timeZone).slice(0, 3);
  const datasLinha = proximasDatas.length
    ? `Datas comemorativas próximas: ${proximasDatas.map((d) => `${d.nome} (em ${d.emDias} dia(s))`).join("; ")}. Use UMA só se combinar naturalmente com a marca; senão, ignore. NUNCA antecipe datas distantes ou fora de época.`
    : `Não há datas comemorativas relevantes nesta janela — NÃO invente nem antecipe datas fora de época.`;

  // Manual: data de publicação indefinida — não ancorar num dia específico.
  if (!o.agendado) {
    return [
      `CONTEXTO TEMPORAL (hoje é ${diaNome}, ${dataExtenso} — mas a DATA DE PUBLICAÇÃO ainda NÃO está definida):`,
      `- ${enquadramento}`,
      `Regras de tempo:`,
      `1. ${proibicao}`,
      `2. Como o dia de publicação pode mudar, NÃO ancore o post num dia da semana específico como gancho — escreva de um jeito que continue certo se publicado em outro dia. Evite "hoje é ${diaNome}", "sextou" e afins, a menos que o BRIEFING peça.`,
      `3. ${datasLinha}`,
    ].join("\n");
  }

  // Agendado: dia da publicação conhecido.
  return [
    `CONTEXTO TEMPORAL (o post será PUBLICADO nesta data):`,
    `- Dia da publicação: ${diaNome}, ${dataExtenso}${horaStr}.`,
    `- ${enquadramento}`,
    `Regras de tempo:`,
    `1. ${proibicao}`,
    `2. O dia da semana é CONTEXTO, não obrigação: use-o como gancho/CTA SÓ quando agregar de verdade — muitos posts NÃO precisam citar o dia. Quando usar, seja coerente (dia útil → pausa no meio da semana; sexta → clima de comemorar; fim de semana → programa em família/relax), adaptado ao que a marca vende (delivery → pedir; academia → treinar; loja → aproveitar). Nunca force.`,
    `3. ${datasLinha}`,
  ].join("\n");
}

export async function gerarRascunhoPost(opts: GerarRascunhoOpts): Promise<RascunhoPost> {
  const marca = contextoMarca(opts.brandKit);
  // Perfil de segmento (Fase 1): dá "a cara" do nicho (herói, gênero de foto, luz, se pode
  // mostrar tela, como usar o catálogo). Sem `segmento` no brand kit → 'generico'. Bruno 2026-07-09.
  const perfil = resolveSegmento(opts.brandKit);
  // PILAR = o TEMA/assunto do post. Bloco explícito injetado nos TRÊS agentes (antes só
  // no estrategista — por isso "Humor e Memes" evaporava antes de virar imagem). NÃO
  // carrega mais o "objetivo": ele virou só o Estilo-padrão (ver estiloKey). Fase 0.
  const pilarCtx = opts.pillar
    ? `━━ PILAR (o ASSUNTO/tema deste post — NÃO é o cardápio) ━━\n` +
      `Tema: ${opts.pillar.nome}.${opts.pillar.descricao ? " " + opts.pillar.descricao : ""}${opts.pillar.promptGuia ? " " + opts.pillar.promptGuia : ""}\n` +
      `A CENA e o TEXTO devem ser sobre ESTE tema. Se o tema NÃO for sobre comida/produto (ex.: humor, meme, bastidores, dica, curiosidade), é PROIBIDO fazer um prato/produto em destaque só porque a marca vende isso — o assunto é o TEMA.`
    : "";
  const evitar = (opts.temasRecentes || []).length
    ? `Evite repetir estes temas recentes: ${(opts.temasRecentes || []).join("; ")}.`
    : "";
  const nSlides = opts.formato === "carrossel" ? Math.max(2, Math.min(10, opts.numImagens || 3)) : 1;
  const modelo = opts.modeloTexto || "gpt-4o-mini";

  // Direção editorial escolhida pelo usuário (estilo, briefing livre, objetivo/CTA).
  // Valores desconhecidos são ignorados → cai no comportamento "automático".
  // Estilo em "auto" HERDA do objetivo do pilar (o tom natural do tema). Fase 0.
  // Estilo do usuário só vale se for uma chave RECONHECIDA (senão é ignorado = "auto",
  // e a herança do pilar volta a valer). Evita que um typo de estilo mude o gating.
  const briefing = (opts.briefing || "").trim().slice(0, BRIEFING_MAX);
  // Estilo (tom): a IA ESCOLHE o melhor do conjunto de estilos do SEGMENTO, olhando o
  // pilar + briefing + marca — o usuário NÃO escolhe mais no Estúdio. opts.estilo só é
  // honrado se vier explícito (compat/agendador). O resto do pipeline usa estiloKey igual
  // como se tivesse sido escolhido à mão. Fase 1.5 (Bruno 2026-07-09).
  const poolEstilos = (perfil.estilosAplicaveis || []).filter((k) => !!ESTILOS_PUBLICACAO[k]);
  const dicaEstilo = opts.pillar?.objetivo ? OBJETIVO_PILAR_PARA_ESTILO[opts.pillar.objetivo] : undefined;
  const estiloUser = opts.estilo && ESTILOS_PUBLICACAO[opts.estilo] ? opts.estilo : undefined;
  const estiloKey = estiloUser || await escolherEstiloAuto(opts.workspaceId, { pool: poolEstilos, dica: dicaEstilo, pilar: opts.pillar, briefing, marca, modelo });
  const estiloDef = estiloKey ? ESTILOS_PUBLICACAO[estiloKey] : undefined;
  const objetivoCtx = opts.objetivo && OBJETIVOS_CTA[opts.objetivo] ? OBJETIVOS_CTA[opts.objetivo] : "";

  // Regras INVIOLÁVEIS da marca + guardrail comercial. Vão no TOPO do contexto de
  // TODOS os agentes (acima de estilo/cardápio/tempo). Oferta só é permitida se o
  // BRIEFING trouxer uma. Bruno 2026-07-08.
  const diretrizesMarca = String(opts.brandKit?.diretrizes || "").trim();
  // Fonte de PREÇOS/PLANOS/ofertas AUTORIZADOS: o briefing do usuário + os "planos e
  // valores" REAIS cadastrados na marca. A IA pode APRESENTAR estes; nunca inventar outros.
  const planosTxt = String(opts.brandKit?.planosValores || "").trim();
  const fonteValores = [briefing, planosTxt].filter(Boolean).join("\n");
  // Análise TIPADA (preço/percentual/palavra) das ofertas AUTORIZADAS — mesma base que
  // as redes de sanitização usam, pra o gate do prompt não divergir dos nets.
  const autOfertas = analisarOfertas(fonteValores);
  const temValoresAutorizados = autOfertas.precos.size > 0 || autOfertas.percents.size > 0 || autOfertas.palavras.size > 0;
  const guardComercial = temValoresAutorizados
    ? "REGRA COMERCIAL: você PODE apresentar os PLANOS/PREÇOS/oferta REAIS já listados no contexto da marca e no briefing — use EXATAMENTE esses valores, sem arredondar nem alterar. É PROIBIDO inventar QUALQUER outro desconto, %, preço, R$, promoção, brinde, cashback, cupom, 'grátis' ou 'leve X pague Y' que não esteja listado."
    : "REGRA COMERCIAL (nunca quebre): NÃO invente NENHUM desconto, %, porcentagem, preço, R$, promoção, oferta, 'combo com desconto', brinde, cashback, cupom, 'grátis'/'frete grátis' nem 'leve X pague Y'. Venda pelo produto e pelo desejo, SEM número e SEM oferta.";
  const regrasMarcaBloco = diretrizesMarca ? `REGRAS DA MARCA (INVIOLÁVEIS — valem acima de estilo, cardápio e tempo): ${diretrizesMarca}` : "";
  const guardCtx = `━━ REGRAS INVIOLÁVEIS (obedeça SEMPRE) ━━\n${[regrasMarcaBloco, guardComercial].filter(Boolean).join("\n")}`;
  // Selo curto de CTA estampado no letreiro 'editorial' — só aparece quando há
  // objetivo de VENDA. Sem objetivo (ex.: post informativo), NÃO estampa selo de
  // venda (antes vinha "PEÇA AGORA" fixo até em post educativo). Bruno 2026-07-08.
  const CTA_SELO: Record<string, string> = {
    vender_app: "PEÇA NO APP", whatsapp: "CHAME NO ZAP", agendar: "AGENDE JÁ",
  };
  const ctaSelo = opts.objetivo ? CTA_SELO[opts.objetivo] : undefined;

  // Bloco ÚNICO de direção editorial — o que o USUÁRIO escolheu tem PRIORIDADE sobre
  // cardápio e contexto temporal. Antes estilo/briefing/objetivo se perdiam no meio de
  // vários blocos e a IA caía no "prato genérico + pausa no dia", ignorando a escolha.
  // Agora vai num bloco único, destacado, no topo. Bruno 2026-07-08.
  const direcaoPartes = [
    briefing ? `BRIEFING (o QUE o post deve dizer/mostrar — PRIORIDADE MÁXIMA, acima do cardápio e do dia da semana): ${briefing}` : "",
    estiloDef ? `ESTILO DA PUBLICAÇÃO = ${estiloDef.nome}. ${estiloDef.guia}` : "",
    objetivoCtx ? `OBJETIVO/CTA: ${objetivoCtx}` : "",
  ].filter(Boolean);
  const direcaoCtx = [
    guardCtx, // regras invioláveis SEMPRE no topo (mesmo sem estilo/briefing/objetivo)
    direcaoPartes.length ? `━━ DIREÇÃO EDITORIAL (siga à risca; prevalece sobre cardápio e contexto temporal) ━━\n${direcaoPartes.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  // Contexto temporal — dia da semana REAL da publicação + datas comemorativas
  // (janela CURTA de 10 dias). Ex.: em 07/jul o Dia dos Pais (10/ago, ~34 dias)
  // NÃO deve virar post ainda. dataAlvo = slot agendado; senão, hoje (geração
  // manual). Vai para TODOS os agentes de texto — não só o estrategista.
  const tz = opts.timeZone || "America/Sao_Paulo";
  const dataAlvoValida = opts.dataAlvo instanceof Date && !isNaN(opts.dataAlvo.getTime());
  const refData = dataAlvoValida ? (opts.dataAlvo as Date) : new Date();
  const temporalCtx = blocoTemporal(refData, tz, { agendado: dataAlvoValida });          // estrategista + copywriter
  const temporalCtxArte = blocoTemporal(refData, tz, { agendado: dataAlvoValida, paraArte: true }); // diretor de arte

  // ── Cardápio: GARANTE que a IA ofereça o que o tenant cadastrou em "Produtos/
  // serviços". Sorteia UM item por post (rotação → variedade) e manda o estrategista
  // ancorar nele. Respeita briefing/pilar quando pedem outra coisa. Bruno 2026-07-08.
  const itensCardapio = String(opts.brandKit?.produtosServicos || "")
    .split(/[,;\n•|]+/).map((s) => s.trim()).filter((s) => s.length >= 2);

  // O cardápio tem 3 estados — e NUNCA pode atropelar o Pilar (Fase 0). Fica PASSIVO
  // quando há QUALQUER sinal não-comercial: (a) um PILAR presente — a presença do pilar
  // já significa "o assunto é o TEMA" (vale mesmo se o objetivo do pilar for null/inválido,
  // o que corrige o "Humor virou comida"); ou (b) um Estilo não-comercial. Só NÃO é passivo
  // quando o sinal é comercial (promocional/prova_social) OU quando não há sinal nenhum
  // (geração pura → a marca de delivery quer o produto no post do dia). O Objetivo/CTA
  // controla só o fecho da legenda, não força o cardápio. Bruno 2026-07-09.
  const COMERCIAL_ESTILOS = new Set(["promocional", "prova_social"]);
  const estiloComercial = !!estiloKey && COMERCIAL_ESTILOS.has(estiloKey);
  const cardapioPassivo = (!!opts.pillar || !!estiloKey) && !estiloComercial;

  // Rótulo/verbo do "cardápio" vêm do PERFIL DE SEGMENTO (Fase 1): pra SaaS é "recursos"
  // e o verbo é "pela dor que resolve" (não "prato apetitoso"); pra loja é "catálogo", etc.
  const rotuloCat = perfil.cardapioLabel.toUpperCase();
  let cardapioCtx = "";
  if (itensCardapio.length) {
    const lista = itensCardapio.join(", ");
    if (briefing) {
      // FONTE: o ASSUNTO vem do briefing; o cardápio é só a fonte de itens REAIS.
      cardapioCtx =
        `${rotuloCat} REAIS da marca (nunca invente item fora desta lista): ${lista}.\n` +
        `Use o(s) que sustentam o BRIEFING. NÃO force um item aleatório — quem manda no assunto é o BRIEFING.`;
    } else if (cardapioPassivo) {
      // REFERÊNCIA PASSIVA (Fase 0): estilo não-comercial → o produto NÃO é o assunto.
      // Impede o cardápio de atropelar o Pilar (ex.: "Humor + Engajamento" virando prato).
      cardapioCtx =
        `${rotuloCat} REAIS da marca (só como referência — cite UM se agregar ao tema): ${lista}.\n` +
        `NÃO force nenhum item e NÃO transforme o post num anúncio: o ASSUNTO é o PILAR/tema, não o catálogo.`;
    } else {
      // FOCO FORÇADO: contexto comercial ou geração pura. Sorteia UM item (rotação → variedade).
      const recentes = (opts.temasRecentes || []).join(" ").toLowerCase();
      const naoRepetidos = itensCardapio.filter((i) => !recentes.includes(i.toLowerCase()));
      const pool = naoRepetidos.length ? naoRepetidos : itensCardapio;
      const foco = pool[Math.floor(Math.random() * pool.length)];
      cardapioCtx =
        `${rotuloCat} REAIS da marca (nunca invente item fora desta lista): ${lista}.\n` +
        `FOCO DESTE POST: "${foco}" — ${perfil.focoVerboPT}. Varie entre posts (não repita sempre o mesmo item).`;
    }
  }

  // ── 1) Estrategista ────────────────────────────────────────────────────────
  const estrategia = await chamarAgente<{ tema: string; angulo: string; resumo: string; pontosChave: string[] }>(
    opts.workspaceId,
    {
      model: modelo,
      temperature: 0.8,
      system:
        "Você é um estrategista de conteúdo para Instagram. Escolhe UM tema forte e um ângulo específico para um post. A DIREÇÃO EDITORIAL do usuário (briefing/estilo/objetivo) tem PRIORIDADE: se houver briefing, o post DEVE ser sobre ele; o cardápio é só a fonte de itens REAIS a oferecer, não o tema. Responda SEMPRE em JSON com as chaves: tema (string curta), angulo (string), resumo (string), pontosChave (array de strings).",
      user: `MARCA:\n${marca}\n\n${direcaoCtx}\n\n${pilarCtx}\n${cardapioCtx}\n${evitar}\n${temporalCtx}\nFormato do post: ${opts.formato} (${nSlides} ${nSlides > 1 ? "slides" : "imagem"}).\nGere a estratégia sobre o TEMA (PILAR), seguindo a DIREÇÃO EDITORIAL (prioridade). Use os produtos como itens reais a oferecer SÓ quando o contexto for de venda.`,
    },
  );
  opts.onProgress?.(12);

  // ── 2) Copywriter ──────────────────────────────────────────────────────────
  const copy = await chamarAgente<{ legenda: string; hashtags: string[]; cta: string }>(
    opts.workspaceId,
    {
      model: modelo,
      temperature: 0.85,
      system:
        `Você é um copywriter de Instagram em português do Brasil. Escreve legendas envolventes na voz da marca, com gancho na primeira linha, corpo com valor e um CTA. Inclua 5 a 12 hashtags relevantes (sem '#', só as palavras). A legenda deve ter no máximo ${LEGENDA_MAX} caracteres. TEXTO PURO: o Instagram NÃO formata Markdown — NÃO use '**negrito**', '__', '#' de título, crase, nem '>'; escreva sem esses símbolos (para dar ênfase use CAIXA ALTA ou emojis). Respeite RIGOROSAMENTE o CONTEXTO TEMPORAL: use o dia da semana real e NUNCA diga que é fim de semana/sextou num dia útil. Responda em JSON com as chaves: legenda (string), hashtags (array de strings SEM '#'), cta (string).`,
      user: `MARCA:\n${marca}\n\n${direcaoCtx}\n\n${pilarCtx}\n\nTEMA: ${estrategia.tema}\nÂNGULO: ${estrategia.angulo}\nRESUMO: ${estrategia.resumo}\nPONTOS-CHAVE: ${(estrategia.pontosChave || []).join("; ")}\n${temporalCtx}\n\nEscreva a legenda sobre o TEMA (PILAR) acima, seguindo a DIREÇÃO EDITORIAL (prioridade), coerente com o CONTEXTO TEMPORAL (dia da semana), e, se houver OBJETIVO/CTA, encerre com essa chamada.`,
    },
  );
  opts.onProgress?.(24);

  // Regra de tela por segmento: SaaS/eletrônicos/contabilidade PRECISAM mostrar tela/UI
  // (o herói é a tela); os demais não podem mostrar app/tela. Fase 1.
  const telaRegra = perfil.arte.heroiEhTela
    ? "a cena PODE conter uma tela/interface limpa e ABSTRATA (faz parte do herói), mas NUNCA um app/site/marca REAL, dados reais de cliente, nem logo de concorrente"
    : "a cena NÃO pode conter tela de celular/computador mostrando app ou marca";

  // ── 3) Diretor de Arte ─────────────────────────────────────────────────────
  const arte = await chamarAgente<{ estiloLetreiro?: string; slides: Array<{ ordem: number; prompt: string; textoOverlay?: string }> }>(
    opts.workspaceId,
    {
      model: modelo,
      temperature: 0.7,
      system:
        `Você é um DIRETOR DE ARTE PUBLICITÁRIO de alto nível. Para cada slide, escreve um PROMPT DE IMAGEM em inglês para o gpt-image-1, com qualidade de CAMPANHA COMERCIAL — NUNCA amador/caseiro.

SEGMENTO desta marca: ${perfil.nome}. GÊNERO fotográfico: ${perfil.arte.generoFoto}. HERÓI da cena quando o post for sobre o produto/serviço: ${perfil.heroiEN}.

CONCEITO (o QUE mostrar) — obedece ao PILAR (tema) + DIREÇÃO EDITORIAL (briefing/estilo); NÃO é sempre o produto:
- promocional → destaque o HERÓI do segmento gerando DESEJO e VALOR. NÃO invente desconto/preço na cena; só há oferta se o BRIEFING trouxer uma.
- engajamento → cena RELACIONÁVEL/divertida ligada ao TEMA (situação do dia a dia, humor, cena de meme, pessoas reagindo). Se o TEMA for humor/meme, faça a CENA ENGRAÇADA — NÃO force o produto/herói.
- informativo/tutorial → visual limpo e didático (passo a passo, comparação, conceito).
- institucional/bastidores → pessoas, equipe, processo e rotina da marca.
- prova social / antes-depois → cliente feliz, resultado real ou transformação (sem expor dado privado).
PRINCÍPIO: o ASSUNTO vem do PILAR + estilo. Se o PILAR NÃO for sobre o produto (humor, bastidores, dica), a cena SEGUE O TEMA — NÃO vira um "hero shot" do produto só porque a marca vende isso.

QUALIDADE (sempre): professional commercial advertising photography, professional lighting suited to the scene, shallow depth of field, crisp detail, editorial magazine quality, 8k, hyper detailed. QUANDO A CENA FOR DO PRODUTO/SERVIÇO (o herói do segmento), acrescente estes descritores premium do segmento: ${perfil.arte.descritores}. Cena típica do segmento: ${perfil.arte.cenaTipica}. QUANDO A CENA FOR de pessoas/humor/bastidores/conceito, NÃO use os descritores de produto — use foto editorial/lifestyle premium coerente com a cena. NUNCA use (evite): homemade, amateur, casual snapshot, dull, flat, washed-out, cluttered.

LUZ E FUNDO deste segmento: ${perfil.arte.luz}. NÃO tinja a foto com a cor da MARCA (as cores da marca vão só no letreiro depois; as cores naturais do próprio objeto ficam). EVITE NESTA MARCA: ${perfil.arte.evitar}.

REGRA CRÍTICA (nunca quebre): ${telaRegra}. Em todo caso, a cena NÃO pode conter NENHUM texto, letra, palavra, número, legenda, LOGOTIPO, nome de marca, marca-d'água, placa nem embalagem com rótulo legível. NUNCA invente marca/logo — a logo REAL e a frase são aplicadas por cima depois. Deixe a parte de baixo mais limpa (espaço negativo) pra sobrepor texto/logo. No fim do 'prompt' em inglês acrescente sempre: "no text, no logos, no brand names, no watermarks, clean commercial scene".

textoOverlay: uma FRASE curta e forte estampada na arte (ideal 3 a 6 palavras, máx 7) em pt-BR, que SIGA O ESTILO DA PUBLICAÇÃO — NÃO é sempre "peça agora" (exemplos genéricos, ADAPTE ao segmento e ao tema):
- promocional → headline de DESEJO ou CTA de compra simples ("Você vai amar", "Garanta o seu"). PROIBIDO inventar desconto, %, preço ou oferta — só use um número/oferta se vier LITERALMENTE no BRIEFING.
- engajamento → PERGUNTA ou convite à interação ("Qual seu favorito?", "Marca aquele amigo"). NÃO seja CTA de venda.
- informativo/tutorial → gancho de DICA/curiosidade, SEM vender ("Você sabia?", "Como escolher").
- institucional/bastidores → frase de marca/valores/processo ("Feito com cuidado, todo dia").
- prova social / antes-depois → resultado/elogio curto ("Resultado que fala por si", "Cliente aprovou!").
NÃO use frase mole/genérica. Se houver BRIEFING, a frase reflete o briefing no tom do estilo.

Gere EXATAMENTE ${nSlides} slide(s) com estilo visual CONSISTENTE entre si. Escolha UM estiloLetreiro pro post inteiro (o MESMO pra todos): 'faixa' (faixa da cor da marca no rodapé — versátil), 'cartao' (cartão sólido — chamativo/promocional), 'editorial' (selo + sublinhado — sóbrio/premium/informativo), conforme o clima (promoção/vendas → cartao ou faixa; educativo/autoridade → editorial). Responda em JSON com as chaves: estiloLetreiro (string: faixa|cartao|editorial) e slides = array de { ordem (int a partir de 1), prompt (string em inglês, SEM texto/marca na cena, COM os descritores de qualidade), textoOverlay (headline curta e forte em pt-BR) }.`,
      user: `MARCA:\n${marca}\n\n${direcaoCtx}\n\n${pilarCtx}\n\nTEMA: ${estrategia.tema}\nÂNGULO: ${estrategia.angulo}\nPONTOS-CHAVE: ${(estrategia.pontosChave || []).join("; ")}\n${temporalCtxArte}\n\nCrie o roteiro visual de ${nSlides} slide(s). O CONCEITO deve refletir o PILAR/tema + a DIREÇÃO EDITORIAL (briefing/estilo) — NÃO caia no produto genérico; se o tema não for sobre o produto, a cena NÃO é um hero shot do produto. Se o textoOverlay mencionar tempo/dia, respeite o CONTEXTO TEMPORAL (nunca "fim de semana" num dia útil).`,
    },
  );

  const slides = Array.isArray(arte.slides) ? arte.slides.slice(0, nSlides) : [];
  if (slides.length === 0) throw new Error("Diretor de arte não retornou slides");
  // Rede de segurança: se algum overlay trouxe desconto/%/preço/oferta cujos sinais NÃO
  // constam (do mesmo tipo) nos valores autorizados, limpa ANTES de estampar na imagem
  // (o overlay é "queimado" no PNG). Preços REAIS passam; % inventado cai. Bruno 2026-07-09.
  for (const s of slides) {
    const ov = String(s.textoOverlay || "");
    if (OFERTA_RE.test(ov) && !ofertaAutorizada(ov, autOfertas)) {
      s.textoOverlay = sanitizarOverlayOferta(ov, estrategia.tema);
    }
  }
  // Estilo do letreiro escolhido pela IA (aplicado a TODOS os slides). Fallback 'faixa'.
  // Override do usuário (Estúdio, por post): faixaAtiva=true força a faixa colorida;
  // false troca pro 'editorial' (texto com sombra leve, sem faixa); undefined = IA decide.
  let estiloLetreiro: "faixa" | "cartao" | "editorial" =
    (["faixa", "cartao", "editorial"] as const).includes(arte.estiloLetreiro as any)
      ? (arte.estiloLetreiro as any)
      : "faixa";
  if (opts.faixaAtiva === true) estiloLetreiro = "faixa";
  else if (opts.faixaAtiva === false) estiloLetreiro = "editorial";
  opts.onProgress?.(35);

  // Modo "inspirar nos materiais do produto" (toggle do Estúdio): a IA escolhe os
  // melhores materiais-imagem uma vez (mesmas refs pra todos os slides do carrossel).
  const referencias = opts.inspirarMateriais
    ? await selecionarReferenciasVisuais(opts.brandKit, opts.workspaceId, modelo)
    : [];

  // ── 4) Gerador de imagem (sequencial pra respeitar rate limit da OpenAI) ─────
  // A parte mais lenta: reporta progresso após cada imagem (35% → ~93%).
  const midias: MidiaGerada[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const img = await gerarImagemIA({
      workspaceId: opts.workspaceId,
      prompt: s.prompt,
      size: opts.tamanho || "1024x1536",
      baseUrl: opts.baseUrl,
      logos: brandLogoUrls(opts.brandKit),
      textoOverlay: s.textoOverlay,
      paleta: (opts.brandKit?.paletaCores as string[] | undefined) || undefined,
      estilo: estiloLetreiro,
      faixaCor: opts.faixaCor,
      ctaSelo,
      referencias,
    });
    midias.push({
      ordem: s.ordem ?? i + 1,
      url: img.url || "",
      tipo: "image",
      promptIa: s.prompt,
      textoOverlay: s.textoOverlay,
      erro: img.ok ? undefined : img.error,
    });
    opts.onProgress?.(35 + Math.round(((i + 1) / slides.length) * 58));
  }

  const midiasOk = midias.filter((m) => m.url && !m.erro);
  if (midiasOk.length === 0) {
    throw new Error(`Falha ao gerar imagens: ${midias.map((m) => m.erro).filter(Boolean).join("; ")}`);
  }

  // ── 5) QA (nível de código): normaliza limites do Instagram ──────────────────
  const hashtags = (Array.isArray(copy.hashtags) ? copy.hashtags : [])
    .map((h) => String(h).replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, HASHTAGS_MAX);

  let legenda = limparMarkdown(String(copy.legenda || "")); // Instagram não formata markdown
  // Rede de segurança na legenda: remove frases com desconto/oferta/preço que NÃO
  // constem nos valores autorizados (briefing + planos e valores da marca). Preços
  // REAIS da marca passam; ofertas inventadas caem. Bruno 2026-07-09.
  if (OFERTA_RE.test(legenda)) {
    legenda = sanitizarLegendaComValores(legenda, fonteValores) || legenda;
  }
  const rodapeTags = hashtags.length ? "\n\n" + hashtags.map((h) => `#${h}`).join(" ") : "";
  if ((legenda + rodapeTags).length > LEGENDA_MAX) {
    legenda = legenda.slice(0, LEGENDA_MAX - rodapeTags.length - 1).trim();
  }

  return {
    tema: estrategia.tema,
    briefIa: { estrategia, copy: { cta: copy.cta }, arte: { estiloLetreiro, slides } },
    legenda: legenda + rodapeTags,
    hashtags,
    midias: midiasOk.map((m, idx) => ({ ...m, ordem: idx + 1 })),
    formato: midiasOk.length > 1 ? "carrossel" : "imagem",
  };
}

// ── Sugestão de pilares (1 clique) ───────────────────────────────────────────
// A IA lê o brand kit e sugere pilares de conteúdo sob medida pro negócio
// (agnóstico de segmento). O usuário adiciona os que quiser com um clique.
export interface PilarSugerido {
  nome: string;
  objetivo: string;      // autoridade | engajamento | bastidores (SEM vendas — promo tem área própria)
  descricao: string;
  promptGuia: string;
}

export async function sugerirPilares(
  workspaceId: string,
  brandKit: InstaflixBrandKit | null,
  existentes: string[] = [],
): Promise<PilarSugerido[]> {
  const marca = contextoMarca(brandKit);
  const evitar = existentes.length
    ? `Já existem estes pilares (NÃO repita, sugira DIFERENTES): ${existentes.join("; ")}.`
    : "";
  const r = await chamarAgente<{ pilares: PilarSugerido[] }>(workspaceId, {
    model: "gpt-4o-mini",
    temperature: 0.85,
    system:
      "Você é um estrategista de conteúdo de Instagram. Sugira de 5 a 6 PILARES de CONTEÚDO sob medida pro negócio (qualquer segmento). Um pilar é um tema-guia recorrente que a marca posta. REGRA IMPORTANTE: NÃO sugira pilares de PROMOÇÃO / OFERTA / DESCONTO / CUPOM / combo / venda direta — isso tem uma ÁREA EXCLUSIVA no app; aqui foque só em CONTEÚDO (autoridade, engajamento, bastidores, educativo, comunidade). Varie os objetivos. Responda SOMENTE JSON: { pilares: [{ nome (2-3 palavras, SEM 'promoção/oferta/desconto'), objetivo (exatamente um de: autoridade, engajamento, bastidores), descricao (1 frase curta, SEM oferta/desconto), promptGuia (1 frase de direção pra IA criar posts desse pilar, SEM promoção) }] }.",
    user: `MARCA:\n${marca}\n\n${evitar}\nSugira os pilares agora — NENHUM de promoção/oferta (isso tem área própria).`,
  });
  // Sem 'vendas': promoções têm área própria no app (Bruno 2026-07-09). Fallback → autoridade.
  const OBJ = new Set(["autoridade", "engajamento", "bastidores"]);
  // Rede de segurança: descarta qualquer pilar de cara promocional que escape do prompt.
  const PROMO = /promo|oferta|desconto|cupom|combo|liquida|sale|black ?friday|frete gr[aá]tis|% ?off|leve mais/i;
  return (Array.isArray(r?.pilares) ? r.pilares : [])
    .filter((p) => p?.nome)
    .filter((p) => !PROMO.test(`${p.nome} ${p.descricao || ""} ${p.promptGuia || ""}`))
    .map((p) => ({
      nome: String(p.nome).slice(0, 60),
      objetivo: OBJ.has(String(p.objetivo)) ? p.objetivo : "autoridade",
      descricao: String(p.descricao || ""),
      promptGuia: String(p.promptGuia || ""),
    }))
    .slice(0, 6);
}
