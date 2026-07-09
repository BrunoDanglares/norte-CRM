// Teste de geração REAL (Bruno 2026-07-08): valida que o Estúdio respeita
// estilo/objetivo/briefing (bug "só puxa comida do produtos, ignora os campos").
// Cria posts REAIS no workspace (aparecem em "Seus posts") e copia as imagens +
// um manifest pra pasta OUT. Rodar:
//   TEST_OUT="<dir>" npx tsx --import dotenv/config scripts/instaflix-teste-briefing.ts
import fs from "fs";
import path from "path";
import { gerarRascunhoPost } from "../server/services/instaflixStudio";
import { getBrandKit, createPost, updatePost, getActiveConnection } from "../server/services/instaflixService";
import { uploadsDir } from "../server/utils/uploadsDir";

const WORKSPACE = "e6215875-c1aa-4dda-b249-17f8cf100490";
const OUT = process.env.TEST_OUT || path.join(process.cwd(), "tmp-instaflix-teste");
fs.mkdirSync(OUT, { recursive: true });

type Caso = {
  rot: string; formato: "imagem" | "carrossel"; numImagens: number;
  estilo?: string; objetivo?: string; briefing?: string;
};
const CASOS: Caso[] = [
  { rot: "A-promocional-combo", formato: "carrossel", numImagens: 3, estilo: "promocional", objetivo: "vender_app",
    briefing: "Combo de sexta: 2 hambúrgueres artesanais + batata grande + refrigerante, das 18h às 22h, com 20% de desconto" },
  { rot: "B-engajamento-combo", formato: "imagem", numImagens: 1, estilo: "engajamento", objetivo: "vender_app",
    briefing: "combo de sexta às 18h com 20% off" },
  { rot: "C-informativo-sembrief", formato: "imagem", numImagens: 1, estilo: "informativo" },
];

async function main() {
  const brandKit = await getBrandKit(WORKSPACE);
  const conn = await getActiveConnection(WORKSPACE);
  const manifest: any[] = [];

  for (const c of CASOS) {
    console.log("\n" + "=".repeat(78));
    console.log(`CASO ${c.rot} | estilo=${c.estilo} objetivo=${c.objetivo} briefing=${c.briefing ?? "(nenhum)"}`);
    const post = await createPost({
      workspaceId: WORKSPACE, instagramConnectionId: conn?.id ?? null, pillarId: null,
      formato: c.formato, tema: `[TESTE ${c.rot}]`, status: "gerando", progresso: 0, geradoPor: "ia",
    });
    try {
      const r = await gerarRascunhoPost({
        workspaceId: WORKSPACE, brandKit, pillar: null, formato: c.formato, numImagens: c.numImagens,
        estilo: c.estilo, objetivo: c.objetivo, briefing: c.briefing,
        onProgress: (p) => process.stdout.write(`\r  progresso: ${p}%   `),
      });
      await updatePost(post.id, WORKSPACE, {
        formato: r.formato, tema: r.tema, briefIa: r.briefIa, legenda: r.legenda,
        hashtags: r.hashtags, midias: r.midias, status: "aguardando_aprovacao", progresso: 100,
      });
      console.log(`\n  TEMA: ${r.tema}`);
      console.log(`  ÂNGULO: ${r.briefIa?.estrategia?.angulo || ""}`);
      console.log(`  LEGENDA:\n${r.legenda.split("\n").map((l: string) => "    " + l).join("\n")}`);
      r.midias.forEach((m, i) => {
        console.log(`  ── slide ${i + 1} ──`);
        console.log(`    overlay : ${m.textoOverlay || ""}`);
        console.log(`    prompt  : ${(m.promptIa || "").slice(0, 300)}`);
        console.log(`    url     : ${m.url}${m.erro ? "  ERRO: " + m.erro : ""}`);
      });
      const imgs: string[] = [];
      for (const m of r.midias) {
        if (!m.url) continue;
        const fname = m.url.split("/").pop()!;
        const src = path.join(uploadsDir, fname);
        const dst = path.join(OUT, `${c.rot}__${fname}`);
        if (fs.existsSync(src)) { fs.copyFileSync(src, dst); imgs.push(dst); }
      }
      manifest.push({
        caso: c.rot, estilo: c.estilo, objetivo: c.objetivo, briefing: c.briefing ?? null,
        postId: post.id, tema: r.tema, angulo: r.briefIa?.estrategia?.angulo, legenda: r.legenda,
        slides: r.midias.map((m) => ({ overlay: m.textoOverlay, promptIa: m.promptIa, url: m.url, erro: m.erro })),
        imagens: imgs,
      });
    } catch (e: any) {
      console.error(`\n  FALHOU: ${e?.message || e}`);
      await updatePost(post.id, WORKSPACE, { status: "falhou", progresso: 100, errorMessage: String(e?.message || e).slice(0, 500) }).catch(() => {});
      manifest.push({ caso: c.rot, erro: String(e?.message || e) });
    }
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n\n✅ Pronto. Manifest + imagens em: ${OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
