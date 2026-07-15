// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Rotas HTTP. Segue o padrão do módulo Insta (db direto +
// resolveWorkspaceId + requireAuth). Tudo isolado por workspace_id. Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { db } from "../db";
import { instaflixPillars, instaflixScheduleRules } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId, upload } from "../utils/helpers";
import { resolveUploadPath } from "../utils/uploadsDir";
import fs from "fs";
import { gerarRascunhoPost, sugerirPilares } from "../services/instaflixStudio";
import { sincronizarBrandKitDoInstagram } from "../services/instaflixIngest";
import { sincronizarCRM, sincronizarSite } from "../services/instaflixCrmIngest";
import { ingerirDocumento, type DocumentoMarca } from "../services/instaflixDocsIngest";
import { SEGMENTOS } from "../services/instaflixSegmentos";
import { gerarPostCampanha } from "../services/instaflixCampanha";
import { removerFundoLogo, extrairLogosDoPdf } from "../services/instaflixLogoExtract";
import {
  getBrandKit, upsertBrandKit, getActiveConnection, brandLogoUrls,
  createPost, updatePost, listPosts, getPost, deletePost,
  aprovarPost, reprovarPost, publicarPostAgora, claimPostParaPublicarManual,
  agendarPost, desagendarPost,
} from "../services/instaflixService";

const router = Router();

const MAX_LOGOS = 8; // teto de variações por marca

// Anexa uma variação de logo (URL /uploads/...) ao brand kit, mantendo a ordem e
// sincronizando `logoUrl` (= primária = primeira). Dedup + teto de MAX_LOGOS.
async function anexarLogo(workspaceId: string, url: string) {
  const bk = await getBrandKit(workspaceId);
  const urls = Array.from(new Set([...brandLogoUrls(bk), url])).slice(0, MAX_LOGOS);
  return upsertBrandKit(workspaceId, { logos: urls.map((u) => ({ url: u })), logoUrl: urls[0] ?? null });
}

// Catálogo de segmentos (fonte única no backend) — pro dropdown da Marca e pro
// filtro de estilos aplicáveis no Estúdio.
router.get("/segmentos", requireAuth, async (_req, res) => {
  res.json(Object.values(SEGMENTOS).map((s) => ({
    slug: s.slug, nome: s.nome, estilosAplicaveis: s.estilosAplicaveis,
  })));
});

// ── Brand kit ────────────────────────────────────────────────────────────────
router.get("/brand-kit", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    res.json(await getBrandKit(workspaceId));
  } catch {
    res.status(500).json({ error: "Erro ao buscar brand kit" });
  }
});

router.put("/brand-kit", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const allowed = [
      "nome", "descricaoNegocio", "publicoAlvo", "tomVoz", "paletaCores", "fontes",
      "logoUrl", "logos", "hashtagsPadrao", "diretrizes", "exemplosLegendas", "temasRecorrentes",
      "fontesConhecimento", "baseConhecimento", "ativo", "instagramConnectionId",
      "produtosServicos", "siteUrl", "faqClientes", "provaSocial", "documentos", "segmento",
      "onboardingConcluido", "planosValores", "materiaisVisuais",
    ];
    const data: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    res.json(await upsertBrandKit(workspaceId, data));
  } catch (err: any) {
    console.error("[Instaflix] Erro ao salvar brand kit:", err.message);
    res.status(500).json({ error: "Erro ao salvar brand kit" });
  }
});

// Alimenta o Brand Kit a partir da conta do Instagram conectada (perfil + feed).
router.post("/brand-kit/sync", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const result = await sincronizarBrandKitDoInstagram(workspaceId, Number(req.body?.limite) || 25);
    res.json(result);
  } catch (err: any) {
    console.error("[Instaflix] Erro ao sincronizar do Instagram:", err.message);
    res.status(400).json({ error: err.message || "Erro ao sincronizar do Instagram" });
  }
});

// Alimenta o Brand Kit com dados do CRM (FAQ das mensagens + prova social dos deals).
router.post("/brand-kit/sync-crm", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    res.json(await sincronizarCRM(workspaceId));
  } catch (err: any) {
    console.error("[Instaflix] Erro ao sincronizar CRM:", err.message);
    res.status(400).json({ error: err.message || "Erro ao sincronizar do CRM" });
  }
});

// Alimenta o Brand Kit a partir do site do negócio (scrape + resumo por IA).
router.post("/brand-kit/sync-site", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    res.json(await sincronizarSite(workspaceId, req.body?.url));
  } catch (err: any) {
    console.error("[Instaflix] Erro ao sincronizar site:", err.message);
    res.status(400).json({ error: err.message || "Erro ao sincronizar do site" });
  }
});

// ── Logo da marca (VARIAÇÕES) ─────────────────────────────────────────────────
// Cada upload ANEXA uma variação ao brand kit (não substitui). A IA escolhe a que
// combina com o fundo de cada arte na hora de estampar (ver aplicarOverlayMarca).
// Upload de imagem → remove fundo → grava /uploads/... e anexa em `logos`.
router.post("/brand-kit/logo", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: "A logo precisa ser uma imagem (PNG, JPG, WEBP)" });
    }
    // Remove o fundo (chroma-key) → logo TRANSPARENTE, sem "quadradinho feio".
    let logoUrl = `/uploads/${req.file.filename}`;
    try {
      const limpa = await removerFundoLogo(fs.readFileSync(req.file.path));
      const nome = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      fs.writeFileSync(resolveUploadPath(`/uploads/${nome}`), limpa);
      logoUrl = `/uploads/${nome}`;
      try { fs.unlinkSync(req.file.path); } catch { /* original com fundo — ok deixar */ }
    } catch { /* falhou a limpeza → mantém o original enviado */ }
    const bk = await anexarLogo(workspaceId, logoUrl);
    res.json({ ok: true, logoUrl, logos: brandLogoUrls(bk), brandKit: bk });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao enviar logo:", err.message);
    res.status(500).json({ error: "Erro ao enviar logo" });
  }
});

// Remove uma variação de logo do brand kit (e apaga o arquivo do disco).
router.post("/brand-kit/logo/remover", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const url = String(req.body?.url || "");
    if (!/^\/uploads\/[\w.\-]+$/.test(url)) return res.status(400).json({ error: "URL inválida" });
    const bk = await getBrandKit(workspaceId);
    const restantes = brandLogoUrls(bk).filter((u) => u !== url);
    const novo = await upsertBrandKit(workspaceId, {
      logos: restantes.map((u) => ({ url: u })),
      logoUrl: restantes[0] ?? null,
    });
    try { fs.unlinkSync(resolveUploadPath(url)); } catch { /* já sumiu — ok */ }
    res.json({ ok: true, logos: brandLogoUrls(novo), brandKit: novo });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao remover logo:", err.message);
    res.status(500).json({ error: "Erro ao remover logo" });
  }
});

// ── Materiais visuais (mascote, selo, padrão…) ────────────────────────────────
// Upload de UMA variação de material → remove fundo (transparente) → grava /uploads/
// e DEVOLVE a url. O client põe a url no material certo (nome/tipo/variações) e salva
// o array inteiro via PUT /brand-kit (campo materiaisVisuais). Bruno 2026-07-11.
router.post("/brand-kit/material-upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    await resolveWorkspaceId(req); // valida sessão/tenant
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: "O material precisa ser uma imagem (PNG, JPG, WEBP)" });
    }
    // Por padrão remove o fundo (mascote/selo ficam transparentes). semFundo=1 mantém
    // o arquivo original (ex.: padrão de fundo colorido que não deve ser recortado).
    const manterFundo = String(req.body?.semFundo ?? req.query?.semFundo ?? "") === "1";
    let url = `/uploads/${req.file.filename}`;
    if (!manterFundo) {
      try {
        const limpa = await removerFundoLogo(fs.readFileSync(req.file.path));
        const nome = `material-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        fs.writeFileSync(resolveUploadPath(`/uploads/${nome}`), limpa);
        url = `/uploads/${nome}`;
        try { fs.unlinkSync(req.file.path); } catch { /* original com fundo — ok deixar */ }
      } catch { /* falhou a limpeza → mantém o original enviado */ }
    }
    res.json({ ok: true, url });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao enviar material:", err.message);
    res.status(500).json({ error: "Erro ao enviar material" });
  }
});

// Extrai CANDIDATOS de logo de um material PDF: rasteriza as páginas, remove o
// fundo de cada uma e devolve PNGs transparentes recortados pro usuário escolher.
router.post("/brand-kit/documentos/:id/extrair-logos", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const bk = await getBrandKit(workspaceId);
    const docs = Array.isArray(bk?.documentos) ? (bk!.documentos as DocumentoMarca[]) : [];
    const alvo = docs.find((d) => d.id === (req.params.id as string));
    if (!alvo) return res.status(404).json({ error: "Material não encontrado" });
    if (alvo.tipo !== "pdf") return res.status(400).json({ error: "Só dá pra extrair logos de um PDF" });
    const candidatos = await extrairLogosDoPdf(resolveUploadPath(alvo.url), workspaceId, 6);
    res.json({ ok: true, candidatos });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao extrair logos:", err.message);
    res.status(500).json({ error: err.message || "Erro ao extrair logos do PDF" });
  }
});

// Puxa a logo de um LINK de imagem da web (ex.: "copiar endereço da imagem" do
// Google Imagens): baixa → remove o fundo → vira a logo. Bruno 2026-07-07.
router.post("/brand-kit/logo/from-url", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const url = String(req.body?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Cole um link http(s) de uma imagem" });
    // SSRF básico: bloqueia hosts locais/privados.
    try {
      const h = new URL(url).hostname;
      if (/^(localhost|127\.|10\.|0\.0\.0\.0|::1)/i.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
        return res.status(400).json({ error: "Host não permitido" });
      }
    } catch { return res.status(400).json({ error: "URL inválida" }); }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let r: Response;
    try {
      r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 InstaflixBot" } });
    } finally { clearTimeout(timer); }
    if (!r.ok) return res.status(400).json({ error: `Não consegui baixar a imagem (HTTP ${r.status})` });
    if (!/^image\//i.test(r.headers.get("content-type") || "")) return res.status(400).json({ error: "O link não aponta pra uma imagem" });
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 8 * 1024 * 1024) return res.status(400).json({ error: "Imagem muito grande (máx. 8 MB)" });

    const limpa = await removerFundoLogo(Buffer.from(ab));
    const nome = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    fs.writeFileSync(resolveUploadPath(`/uploads/${nome}`), limpa);
    const logoUrl = `/uploads/${nome}`;
    const bk = await anexarLogo(workspaceId, logoUrl);
    res.json({ ok: true, logoUrl, logos: brandLogoUrls(bk), brandKit: bk });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao baixar logo por URL:", err.message);
    res.status(500).json({ error: err.message || "Erro ao baixar a logo do link" });
  }
});

// Anexa como variação uma logo já processada (candidato de PDF; URL /uploads/...).
router.post("/brand-kit/logo/definir", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const url = String(req.body?.url || "");
    if (!/^\/uploads\/[\w.\-]+$/.test(url)) return res.status(400).json({ error: "URL inválida" });
    const bk = await anexarLogo(workspaceId, url);
    res.json({ ok: true, logoUrl: url, logos: brandLogoUrls(bk), brandKit: bk });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao definir logo:", err.message);
    res.status(500).json({ error: "Erro ao definir logo" });
  }
});

// ── Materiais (PDF/imagem) que a IA lê pra aprender do negócio ────────────────
// Upload → ingere (pdf-parse / vision → resumo) → anexa ao array `documentos`.
router.post("/brand-kit/documentos", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const doc = await ingerirDocumento({
      workspaceId,
      nome: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      absPath: req.file.path,
      tamanho: req.file.size,
    });

    const bk = await getBrandKit(workspaceId);
    const atuais = Array.isArray(bk?.documentos) ? (bk!.documentos as DocumentoMarca[]) : [];
    const documentos = [doc, ...atuais].slice(0, 50);
    await upsertBrandKit(workspaceId, { documentos });
    res.json({ ok: true, documento: doc, documentos });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao enviar material:", err.message);
    res.status(500).json({ error: err.message || "Erro ao enviar material" });
  }
});

router.delete("/brand-kit/documentos/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const bk = await getBrandKit(workspaceId);
    const atuais = Array.isArray(bk?.documentos) ? (bk!.documentos as DocumentoMarca[]) : [];
    const alvo = atuais.find((d) => d.id === req.params.id);
    const documentos = atuais.filter((d) => d.id !== req.params.id);
    await upsertBrandKit(workspaceId, { documentos });
    // Best-effort: apaga o arquivo do disco (anti-traversal via resolveUploadPath).
    if (alvo?.url) {
      try { fs.unlinkSync(resolveUploadPath(alvo.url)); } catch { /* já sumiu — ok */ }
    }
    res.json({ ok: true, documentos });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao remover material:", err.message);
    res.status(500).json({ error: "Erro ao remover material" });
  }
});

// ── Pilares ──────────────────────────────────────────────────────────────────
router.get("/pillars", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    res.json(await db.select().from(instaflixPillars)
      .where(eq(instaflixPillars.workspaceId, workspaceId))
      .orderBy(desc(instaflixPillars.createdAt)));
  } catch {
    res.status(500).json({ error: "Erro ao listar pilares" });
  }
});

// Sugestões de pilares pela IA (sob medida pro negócio, com base no brand kit).
router.post("/pillars/suggest", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const brandKit = await getBrandKit(workspaceId);
    const existentes = await db.select({ nome: instaflixPillars.nome }).from(instaflixPillars)
      .where(eq(instaflixPillars.workspaceId, workspaceId));
    const pilares = await sugerirPilares(workspaceId, brandKit, existentes.map((e) => e.nome));
    res.json({ pilares });
  } catch (err: any) {
    console.error("[Instaflix] Erro ao sugerir pilares:", err.message);
    res.status(500).json({ error: err.message || "Erro ao sugerir pilares" });
  }
});

router.post("/pillars", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: "nome é obrigatório" });
    const values: Record<string, any> = { workspaceId, nome };
    for (const k of ["descricao", "objetivo", "peso", "promptGuia", "exemplos", "ativo"]) {
      if (req.body[k] !== undefined) values[k] = req.body[k];
    }
    const [row] = await db.insert(instaflixPillars).values(values as any).returning();
    res.json(row);
  } catch {
    res.status(500).json({ error: "Erro ao criar pilar" });
  }
});

router.patch("/pillars/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const k of ["nome", "descricao", "objetivo", "peso", "promptGuia", "exemplos", "ativo"]) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    const [row] = await db.update(instaflixPillars).set(updates)
      .where(and(eq(instaflixPillars.id, (req.params.id as string)), eq(instaflixPillars.workspaceId, workspaceId)))
      .returning();
    res.json(row);
  } catch {
    res.status(500).json({ error: "Erro ao atualizar pilar" });
  }
});

router.delete("/pillars/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    await db.delete(instaflixPillars)
      .where(and(eq(instaflixPillars.id, (req.params.id as string)), eq(instaflixPillars.workspaceId, workspaceId)));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erro ao deletar pilar" });
  }
});

// ── Regras de agenda ─────────────────────────────────────────────────────────
router.get("/rules", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    res.json(await db.select().from(instaflixScheduleRules)
      .where(eq(instaflixScheduleRules.workspaceId, workspaceId))
      .orderBy(desc(instaflixScheduleRules.createdAt)));
  } catch {
    res.status(500).json({ error: "Erro ao listar regras" });
  }
});

router.post("/rules", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { nome } = req.body;
    if (!nome) return res.status(400).json({ error: "nome é obrigatório" });
    const values: Record<string, any> = { workspaceId, nome };
    for (const k of ["instagramConnectionId", "pillarId", "formato", "diasSemana", "horarios",
      "timezone", "numImagens", "approvalMode", "antecedenciaHoras", "ativo"]) {
      if (req.body[k] !== undefined) values[k] = req.body[k];
    }
    const [row] = await db.insert(instaflixScheduleRules).values(values as any).returning();
    res.json(row);
  } catch {
    res.status(500).json({ error: "Erro ao criar regra" });
  }
});

router.patch("/rules/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const updates: Record<string, any> = { updatedAt: new Date() };
    for (const k of ["nome", "instagramConnectionId", "pillarId", "formato", "diasSemana", "horarios",
      "timezone", "numImagens", "approvalMode", "antecedenciaHoras", "ativo"]) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    const [row] = await db.update(instaflixScheduleRules).set(updates)
      .where(and(eq(instaflixScheduleRules.id, (req.params.id as string)), eq(instaflixScheduleRules.workspaceId, workspaceId)))
      .returning();
    res.json(row);
  } catch {
    res.status(500).json({ error: "Erro ao atualizar regra" });
  }
});

router.patch("/rules/:id/toggle", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [current] = await db.select().from(instaflixScheduleRules)
      .where(and(eq(instaflixScheduleRules.id, (req.params.id as string)), eq(instaflixScheduleRules.workspaceId, workspaceId)))
      .limit(1);
    if (!current) return res.status(404).json({ error: "Regra não encontrada" });
    const [row] = await db.update(instaflixScheduleRules)
      .set({ ativo: !current.ativo, updatedAt: new Date() })
      .where(eq(instaflixScheduleRules.id, (req.params.id as string))).returning();
    res.json(row);
  } catch {
    res.status(500).json({ error: "Erro ao alternar regra" });
  }
});

router.delete("/rules/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    await db.delete(instaflixScheduleRules)
      .where(and(eq(instaflixScheduleRules.id, (req.params.id as string)), eq(instaflixScheduleRules.workspaceId, workspaceId)));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erro ao deletar regra" });
  }
});

// ── Posts ────────────────────────────────────────────────────────────────────
router.get("/posts", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await listPosts(workspaceId, { status }));
  } catch {
    res.status(500).json({ error: "Erro ao listar posts" });
  }
});

router.get("/posts/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const post = await getPost((req.params.id as string), workspaceId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    res.json(post);
  } catch {
    res.status(500).json({ error: "Erro ao buscar post" });
  }
});

// Edição manual do post (legenda/hashtags/tema) antes de aprovar/publicar.
router.patch("/posts/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const updates: Record<string, any> = {};
    if (req.body.legenda !== undefined) updates.legenda = String(req.body.legenda).slice(0, 2200);
    if (req.body.hashtags !== undefined) updates.hashtags = req.body.hashtags;
    if (req.body.tema !== undefined) updates.tema = String(req.body.tema).slice(0, 200);
    // Reordenação do carrossel: re-numera `ordem` pela posição no array (é a ordem publicada).
    if (Array.isArray(req.body.midias)) {
      updates.midias = req.body.midias.slice(0, 10).map((m: any, i: number) => ({ ...m, ordem: i + 1 }));
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "Nada para atualizar" });
    const post = await updatePost((req.params.id as string), workspaceId, updates);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    res.json(post);
  } catch (err: any) {
    console.error("[Instaflix] Erro ao editar post:", err.message);
    res.status(500).json({ error: err.message || "Erro ao editar post" });
  }
});

// Gera um rascunho AGORA (trigger manual). Cria o post JÁ como "gerando" e devolve
// na hora; a IA (que leva ~30-60s) roda em BACKGROUND atualizando `progresso`. Assim
// a prévia aparece imediatamente com barra de % e o usuário navega enquanto carrega.
router.post("/posts/generate", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const formato = req.body.formato === "imagem" ? "imagem" : "carrossel";
    const numImagens = Math.max(2, Math.min(10, Number(req.body.numImagens) || 3));
    // Direção editorial (opcional). Chaves inválidas são ignoradas no estúdio.
    const estilo = typeof req.body.estilo === "string" ? req.body.estilo : undefined;
    const objetivo = typeof req.body.objetivo === "string" ? req.body.objetivo : undefined;
    const briefing = typeof req.body.briefing === "string" ? req.body.briefing.slice(0, 500) : undefined;
    // Faixa do rodapé (controle por post no Estúdio): liga/desliga + cor manual.
    const faixaAtiva = typeof req.body.faixaAtiva === "boolean" ? req.body.faixaAtiva : undefined;
    const faixaCor = typeof req.body.faixaCor === "string" && /^#[0-9a-fA-F]{6}$/.test(req.body.faixaCor) ? req.body.faixaCor : undefined;
    // Toggle do Estúdio: usar os materiais (imagens) do produto como referência visual.
    const inspirarMateriais = req.body.inspirarMateriais === true;
    const conn = await getActiveConnection(workspaceId);

    let pillar = null;
    if (req.body.pillarId) {
      const [p] = await db.select().from(instaflixPillars)
        .where(and(eq(instaflixPillars.id, req.body.pillarId), eq(instaflixPillars.workspaceId, workspaceId)))
        .limit(1);
      pillar = p ?? null;
    }

    // 1) Cria o placeholder "gerando" e responde IMEDIATAMENTE.
    const post = await createPost({
      workspaceId,
      instagramConnectionId: conn?.id ?? null,
      pillarId: pillar?.id ?? null,
      formato,
      tema: pillar?.nome ? `${pillar.nome}…` : "Gerando post…",
      status: "gerando",
      progresso: 0,
      geradoPor: "ia",
    });
    res.json(post);

    // 2) Geração pesada em BACKGROUND (fire-and-forget). Atualiza `progresso` no
    //    banco (o front pega por polling). Sucesso → aguardando_aprovacao; erro → falhou.
    //    Guarda URL RELATIVA (/uploads/...); a URL pública p/ a Meta é montada só
    //    na publicação (ver publicarPostAgora). Bruno 2026-07-04 (local-only).
    void (async () => {
      try {
        const brandKit = await getBrandKit(workspaceId);
        const rascunho = await gerarRascunhoPost({
          workspaceId, brandKit, pillar, formato, numImagens, estilo, briefing, objetivo, faixaAtiva, faixaCor, inspirarMateriais,
          onProgress: (pct) => { void updatePost(post.id, workspaceId, { progresso: pct }).catch(() => {}); },
        });
        await updatePost(post.id, workspaceId, {
          formato: rascunho.formato,
          tema: rascunho.tema,
          briefIa: rascunho.briefIa,
          legenda: rascunho.legenda,
          hashtags: rascunho.hashtags,
          midias: rascunho.midias,
          status: "aguardando_aprovacao",
          progresso: 100,
        });
      } catch (err: any) {
        console.error("[Instaflix] Falha na geração em background:", err?.message || err);
        await updatePost(post.id, workspaceId, {
          status: "falhou",
          progresso: 100,
          errorMessage: String(err?.message || err).slice(0, 1000),
        }).catch(() => {});
      }
    })();
  } catch (err: any) {
    console.error("[Instaflix] Erro ao iniciar geração:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || "Erro ao gerar post" });
  }
});

// Campanha de Oferta (Fase 2, Nível A): anexa a FOTO REAL do produto + a oferta cravada
// → arte com a foto real + selo de oferta + logo, e legenda em volta da oferta fixa.
// Síncrono (composição por sharp é rápida). Nunca auto-post: cai em aguardando_aprovacao.
router.post("/posts/generate-campaign", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    if (!req.file) return res.status(400).json({ error: "Envie a foto do produto" });
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: "A foto do produto precisa ser uma imagem (PNG, JPG, WEBP)" });
    }
    const produtoNome = String(req.body.produtoNome || "").trim();
    if (!produtoNome) return res.status(400).json({ error: "Informe o nome do produto" });

    const tiposValidos = ["desconto_pct", "preco_de_por", "preco_fixo", "condicao", "sem_preco"];
    const ofertaTipo = tiposValidos.includes(req.body.ofertaTipo) ? req.body.ofertaTipo : "sem_preco";
    let ofertaValor: any = {};
    try { ofertaValor = typeof req.body.ofertaValor === "string" ? JSON.parse(req.body.ofertaValor) : (req.body.ofertaValor || {}); } catch { ofertaValor = {}; }
    const cta = typeof req.body.cta === "string" && req.body.cta ? req.body.cta : undefined;
    const briefing = typeof req.body.briefing === "string" ? req.body.briefing.slice(0, 500) : undefined;

    const post = await gerarPostCampanha({
      workspaceId,
      fotoPath: req.file.path,
      fotoUrl: `/uploads/${req.file.filename}`,
      produtoNome, ofertaTipo, ofertaValor, cta, briefing,
    });
    res.json(post);
  } catch (err: any) {
    console.error("[Instaflix] Erro na campanha:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message || "Erro ao gerar campanha" });
  }
});

router.post("/posts/:id/aprovar", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined;
    const aprovadoPor = (req as any).user?.id || (req as any).user?.email || "usuario";
    const post = await aprovarPost((req.params.id as string), workspaceId, String(aprovadoPor), scheduledAt);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    res.json(post);
  } catch {
    res.status(500).json({ error: "Erro ao aprovar post" });
  }
});

router.post("/posts/:id/reprovar", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const post = await reprovarPost((req.params.id as string), workspaceId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });
    res.json(post);
  } catch {
    res.status(500).json({ error: "Erro ao reprovar post" });
  }
});

// Agendar/reagendar: define data-hora e joga pra fila de publicação (o publicador
// publica quando chegar o horário). Serve pra aprovar+agendar OU reagendar.
router.post("/posts/:id/agendar", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const when = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    if (!when || isNaN(when.getTime())) return res.status(400).json({ error: "Data/hora inválida" });
    const atual = await getPost((req.params.id as string), workspaceId);
    if (!atual) return res.status(404).json({ error: "Post não encontrado" });
    if (atual.status === "publicando" || atual.status === "publicado") {
      return res.status(409).json({ error: "Post já está publicando/publicado" });
    }
    const aprovadoPor = (req as any).user?.id || (req as any).user?.email || "usuario";
    const post = await agendarPost((req.params.id as string), workspaceId, when, String(aprovadoPor));
    res.json(post);
  } catch (err: any) {
    console.error("[Instaflix] Erro ao agendar post:", err.message);
    res.status(500).json({ error: "Erro ao agendar post" });
  }
});

// Cancelar agendamento: sai da fila e volta a aguardar aprovação.
router.post("/posts/:id/desagendar", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const atual = await getPost((req.params.id as string), workspaceId);
    if (!atual) return res.status(404).json({ error: "Post não encontrado" });
    if (atual.status === "publicando" || atual.status === "publicado") {
      return res.status(409).json({ error: "Post já está publicando/publicado" });
    }
    const post = await desagendarPost((req.params.id as string), workspaceId);
    res.json(post);
  } catch (err: any) {
    console.error("[Instaflix] Erro ao desagendar post:", err.message);
    res.status(500).json({ error: "Erro ao desagendar post" });
  }
});

// Publica imediatamente (ignora agenda). Claim guardado pra evitar double-post.
router.post("/posts/:id/publicar", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const claimed = await claimPostParaPublicarManual((req.params.id as string), workspaceId);
    if (!claimed) return res.status(409).json({ error: "Post não encontrado ou já em publicação" });
    const result = await publicarPostAgora(claimed);
    if (!result.ok) return res.status(502).json({ error: result.error });
    res.json({ ok: true, mediaId: result.mediaId, post: await getPost((req.params.id as string), workspaceId) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Erro ao publicar" });
  }
});

router.delete("/posts/:id", requireAuth, async (req, res) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    await deletePost((req.params.id as string), workspaceId);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erro ao deletar post" });
  }
});

export default router;
