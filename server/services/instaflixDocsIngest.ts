// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Ingestão de MATERIAIS enviados pelo usuário (PDF/imagem) → Brand Kit.
//
// O usuário sobe um arquivo na aba Marca ("Materiais") e a IA extrai o conteúdo
// útil pra criação de conteúdo (o que o negócio faz, produtos, preços, tom):
//   • PDF    → pdf-parse extrai o texto → IA condensa num resumo curto.
//   • Imagem → gpt-4o-mini (vision) lê texto visível + descreve → resumo curto.
//
// O resumo entra no contexto dos agentes do Estúdio (ver contextoMarca). O arquivo
// fica em /uploads (URL relativa) e o item vai pro campo `documentos` do brand kit.
// Sem chave OpenAI, ainda salvamos o material com o texto cru (fallback). Bruno 2026-07-07.
// ═══════════════════════════════════════════════════════════════════════════

import fs from "fs";
import { randomUUID } from "crypto";
import { getOpenAIClient } from "./openaiClient";
import { resolveOpenAIKeys } from "./openaiKeyResolver";

export interface DocumentoMarca {
  id: string;
  nome: string;
  url: string;                       // relativa /uploads/...
  tipo: "pdf" | "imagem" | "outro";
  tamanho?: number;                  // bytes
  resumo: string;                    // o que a IA extraiu (usado no contexto)
  addedAt: string;                   // ISO
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
};

function tipoDoNome(nome: string): DocumentoMarca["tipo"] {
  if (/\.pdf$/i.test(nome)) return "pdf";
  if (IMG_EXT.test(nome)) return "imagem";
  return "outro";
}

// Condensa um texto longo (PDF/site/etc) num resumo curto e factual, focado no que
// serve pra criar posts. Sem chave → devolve o texto cru truncado.
async function resumirTexto(workspaceId: string, nome: string, texto: string): Promise<string> {
  const cru = texto.trim();
  if (!cru) return "";
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return cru.slice(0, 1200);
  try {
    const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você resume um material de referência de uma marca para alimentar um gerador de posts de Instagram. Extraia SOMENTE fatos úteis pra criação de conteúdo: o que o negócio faz, produtos/serviços, preços/promoções, diferenciais, público, tom. Ignore rodapé/juridiquês. Responda JSON: { resumo: string (até 900 caracteres, em português, direto ao ponto) }.",
        },
        { role: "user", content: `Material: "${nome}"\n\nConteúdo:\n${cru.slice(0, 8000)}` },
      ],
    });
    const j = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    return String(j?.resumo || "").trim() || cru.slice(0, 1200);
  } catch {
    return cru.slice(0, 1200);
  }
}

// Lê uma imagem local e pede pra IA (vision) extrair texto visível + descrever.
// Sem chave → devolve string vazia (o material fica salvo, só sem resumo).
async function analisarImagem(workspaceId: string, nome: string, absPath: string): Promise<string> {
  const [cand] = await resolveOpenAIKeys(workspaceId);
  if (!cand) return "";
  try {
    const ext = (nome.split(".").pop() || "png").toLowerCase();
    const mime = MIME[ext] || "image/png";
    const b64 = fs.readFileSync(absPath).toString("base64");
    const client = getOpenAIClient({ apiKey: cand.apiKey, baseURL: cand.baseURL, timeout: 60_000 });
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você analisa uma imagem enviada por uma marca (pode ser cardápio, tabela de preços, panfleto, produto, arte). Transcreva o texto visível e descreva o que é útil pra criar posts. Responda JSON: { resumo: string (até 900 caracteres, em português) }.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Imagem: "${nome}". Transcreva o texto e descreva o conteúdo relevante pra marca.` },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ] as any,
        },
      ],
    });
    const j = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    return String(j?.resumo || "").trim();
  } catch {
    return "";
  }
}

export interface IngerirDocumentoInput {
  workspaceId: string;
  nome: string;                      // nome original do arquivo
  url: string;                       // relativa /uploads/...
  absPath: string;                   // caminho em disco (pra ler o conteúdo)
  tamanho?: number;
}

// Processa UM material recém-enviado e devolve o item pronto pro brand kit.
export async function ingerirDocumento(input: IngerirDocumentoInput): Promise<DocumentoMarca> {
  const tipo = tipoDoNome(input.nome);
  let resumo = "";

  try {
    if (tipo === "pdf") {
      // pdf-parse v2: API é a classe PDFParse (não há default como função).
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: fs.readFileSync(input.absPath) });
      let texto = "";
      try {
        const r = await parser.getText();
        texto = r?.text || "";
      } finally {
        await parser.destroy().catch(() => {});
      }
      resumo = await resumirTexto(input.workspaceId, input.nome, texto);
      if (!resumo) resumo = "PDF sem texto extraível (pode ser digitalizado/imagem).";
    } else if (tipo === "imagem") {
      resumo = await analisarImagem(input.workspaceId, input.nome, input.absPath);
      if (!resumo) resumo = "Imagem enviada (análise indisponível — configure a chave OpenAI pra a IA ler o conteúdo).";
    } else {
      resumo = "Formato não suportado para leitura automática.";
    }
  } catch (err: any) {
    resumo = `Não foi possível ler o material: ${String(err?.message || err).slice(0, 200)}`;
  }

  return {
    id: randomUUID().slice(0, 12),
    nome: input.nome,
    url: input.url,
    tipo,
    tamanho: input.tamanho,
    resumo,
    addedAt: new Date().toISOString(),
  };
}
