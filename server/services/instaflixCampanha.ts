// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Campanha de Oferta (Fase 2, Nível A). Bruno 2026-07-09.
//
// O usuário anexa a FOTO REAL do produto e define a oferta (nunca inventada). A arte
// = foto real composta num canvas 4:5 + selo de oferta desenhado por código + logo
// (comporArteProduto). A legenda é escrita EM VOLTA da oferta FIXA — a IA está
// proibida de inventar outro desconto/preço. Fidelidade 100%; zero oferta fantasma.
//
// Diferente do fluxo normal (gerarRascunhoPost): a IA NÃO recria a imagem do produto
// (isso é o "Nível C" arriscado, que o Bruno decidiu NÃO usar). Aqui o produto é a
// foto de verdade.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "fs";
import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";
import { getBrandKit, createPost, getActiveConnection, brandLogoUrls } from "./instaflixService";
import { comporArteProduto } from "./instaflixImageService";
import { sanitizarLegendaComValores } from "./instaflixStudio";
import type { InstaflixPost } from "@shared/schema";

export type OfertaTipo = "desconto_pct" | "preco_de_por" | "preco_fixo" | "condicao" | "sem_preco";

// Converte um valor digitado (formato BR) em "R$ 0,00". Trata o separador de milhar
// (ponto) e o decimal (vírgula): "1.999,90" → R$ 1.999,90 (antes virava "R$ 2,00").
// Rejeita negativo/lixo → "". Bruno 2026-07-09 (fix da revisão).
function money(n: any): string {
  let s = String(n ?? "").trim().replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");        // BR: ponto=milhar, vírgula=decimal
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");        // "1.999" / "1.234.567" = milhar
  const v = parseFloat(s);
  return isFinite(v) && v > 0 ? "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

// Guardrail da legenda da campanha: reusa a allowlist do estúdio.
// - Sem oferta autorizada (sem_preco / rótulo sem número) → tira TODA oferta.
// - Com oferta autorizada → mantém só as frases cujos números batem com o rótulo cravado.
function sanitizarLegendaCampanha(legenda: string, ofertaRotulo: string): string {
  return sanitizarLegendaComValores(legenda, ofertaRotulo);
}

// Monta o RÓTULO exato da oferta (o que é estampado + citado na legenda). Nunca
// inventa: sai direto do que o usuário cravou no formulário.
export function formatarOferta(tipo: OfertaTipo, valor: any): string {
  switch (tipo) {
    case "desconto_pct": { const p = Number(valor?.pct); return p > 0 ? `${p}% OFF` : ""; }
    case "preco_de_por": { const de = money(valor?.de), por = money(valor?.por); return por ? (de ? `de ${de} por ${por}` : por) : ""; }
    case "preco_fixo": { const p = money(valor?.preco); return p ? `Só ${p}` : ""; }
    case "condicao": return String(valor?.texto || "").trim().slice(0, 40);
    case "sem_preco": default: return "";
  }
}

async function escreverLegendaCampanha(
  workspaceId: string,
  o: { produtoNome: string; ofertaRotulo: string; cta?: string; briefing?: string; marca: string },
): Promise<{ legenda: string; hashtags: string[] }> {
  const fallback = { legenda: `${o.produtoNome}${o.ofertaRotulo ? " — " + o.ofertaRotulo : ""}`, hashtags: [] as string[] };
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return fallback;
  try {
    const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `Você é copywriter de Instagram em português do Brasil. Escreve a legenda de uma CAMPANHA de um produto REAL. A OFERTA é FIXA${o.ofertaRotulo ? `: use EXATAMENTE "${o.ofertaRotulo}"` : " (sem valor específico — foque no DESEJO pelo produto)"} — é PROIBIDO inventar OUTRO desconto, %, preço ou condição diferente. Gancho forte na 1ª linha, desperte desejo pelo produto e feche com o CTA. Inclua 5 a 10 hashtags relevantes (sem '#'). Responda JSON: { legenda (string), hashtags (array de strings SEM '#') }.`,
        },
        {
          role: "user",
          content: `MARCA:\n${o.marca}\n\nPRODUTO: ${o.produtoNome}\nOFERTA (use exatamente esta, não invente outra): ${o.ofertaRotulo || "(sem valor específico)"}\nCTA: ${o.cta || "peça agora"}${o.briefing ? `\nOBSERVAÇÕES: ${o.briefing}` : ""}`,
        },
      ],
    });
    const j = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    const legenda = String(j?.legenda || "").trim() || fallback.legenda;
    const hashtags = (Array.isArray(j?.hashtags) ? j.hashtags : [])
      .map((h: any) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 12);
    return { legenda, hashtags };
  } catch {
    return fallback;
  }
}

export interface CampanhaInput {
  workspaceId: string;
  fotoPath: string;       // caminho da foto do produto em disco (multer)
  fotoUrl: string;        // /uploads/... (referência, guardada em briefIa)
  produtoNome: string;
  ofertaTipo: OfertaTipo;
  ofertaValor: any;       // { pct } | { de, por } | { preco } | { texto }
  cta?: string;           // vender_app | whatsapp | agendar | seguidores
  briefing?: string;
}

// Gera UM post de campanha (síncrono — composição por sharp é rápida). Sempre cai em
// 'aguardando_aprovacao' (nunca auto-post numa peça comercial).
export async function gerarPostCampanha(input: CampanhaInput): Promise<InstaflixPost> {
  const bk = await getBrandKit(input.workspaceId);
  const conn = await getActiveConnection(input.workspaceId);
  const ofertaRotulo = formatarOferta(input.ofertaTipo, input.ofertaValor);
  const marca = [
    bk?.descricaoNegocio && `Negócio: ${bk.descricaoNegocio}`,
    bk?.tomVoz && `Tom de voz: ${bk.tomVoz}`,
    bk?.publicoAlvo && `Público-alvo: ${bk.publicoAlvo}`,
  ].filter(Boolean).join("\n") || "Marca sem descrição configurada.";

  // 1) Arte: FOTO REAL + selo de oferta + logo. (O CTA vai na legenda, não estampado.)
  const foto = fs.readFileSync(input.fotoPath);
  const img = await comporArteProduto(foto, {
    ofertaRotulo,
    logos: brandLogoUrls(bk),
    paleta: (bk?.paletaCores as string[] | undefined) || undefined,
    workspaceId: input.workspaceId,
  });
  if (!img.ok || !img.url) throw new Error(img.error || "Falha ao compor a arte da campanha");

  // 2) Legenda em volta da oferta FIXA. Rede de segurança: remove qualquer oferta que a
  //    IA tenha inventado além da autorizada (a campanha não passa pelo sanitizador do
  //    fluxo normal, então aplicamos aqui). Bruno 2026-07-09.
  const gerado = await escreverLegendaCampanha(input.workspaceId, {
    produtoNome: input.produtoNome, ofertaRotulo, cta: input.cta, briefing: input.briefing, marca,
  });
  const legenda = sanitizarLegendaCampanha(gerado.legenda, ofertaRotulo) || gerado.legenda;
  const hashtags = gerado.hashtags;
  const rodape = hashtags.length ? "\n\n" + hashtags.map((h) => `#${h}`).join(" ") : "";

  // 3) Cria o post (aguardando aprovação).
  return createPost({
    workspaceId: input.workspaceId,
    instagramConnectionId: conn?.id ?? null,
    formato: "imagem",
    tema: `${input.produtoNome}${ofertaRotulo ? " — " + ofertaRotulo : ""}`.slice(0, 200),
    legenda: (legenda + rodape).slice(0, 2200),
    hashtags,
    midias: [{ ordem: 1, url: img.url, tipo: "image", promptIa: "campanha:produto-real", textoOverlay: ofertaRotulo }],
    briefIa: { campanha: { produtoNome: input.produtoNome, ofertaTipo: input.ofertaTipo, ofertaValor: input.ofertaValor, ofertaRotulo, cta: input.cta ?? null, fotoUrl: input.fotoUrl } },
    status: "aguardando_aprovacao",
    progresso: 100,
    geradoPor: "ia",
  });
}
