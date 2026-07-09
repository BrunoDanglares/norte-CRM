import type { Express } from "express";
import express from "express";
import path from "path";
import { createServer, type Server } from "http";
import { requireAuth } from "./middleware/auth";
import { upload, uploadsDir } from "./utils/helpers";

import { registerAuthRoutes } from "./routes/auth";
import { registerPartnerRoutes } from "./routes/partner";
import { registerPerfilRoutes } from "./routes/perfil";
import { registerLeadRoutes } from "./routes/leads";
import { registerPipelineRoutes } from "./routes/pipeline";
import { registerPipelineColumnRoutes } from "./routes/pipeline-columns";
import { registerContactRoutes } from "./routes/contacts";
import { registerConversationRoutes } from "./routes/conversations";
import { registerMessageRoutes } from "./routes/messages";
import { registerAutomacaoRoutes } from "./routes/automacoes";
import { registerUsuarioRoutes } from "./routes/usuarios";
import { registerBillingRoutes } from "./routes/billing";
import { registerAsaasRoutes } from "./routes/asaas";
import { registerConexaoRoutes } from "./routes/conexoes";
import { registerWebhookRoutes } from "./routes/webhooks";
import { registerCampanhaRoutes } from "./routes/campanhas";
import { registerAdminRoutes } from "./routes/admin";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerAutomationLogRoutes } from "./routes/automationLogs";
import { registerTenantSettingsRoutes } from "./routes/tenant-settings";
import { registerAdminTenantSettingsRoutes } from "./routes/admin-tenant-settings";
import { registerHealthRoutes } from "./routes/health";
import { registerLinkPreviewRoutes } from "./routes/link-preview";


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Avatares revalidam (cache curto + ETag): a foto é salva com nome FIXO por telefone
  // (<phone>.jpg) e sobrescrita quando o cliente troca de foto. Com o cache geral de 30d
  // o browser nunca veria a troca. Aqui o /uploads/avatars usa max-age curto → o browser
  // revalida e pega a foto nova quando muda (304 quando não mudou). Precede o estático geral.
  app.use("/uploads/avatars", express.static(path.join(uploadsDir, "avatars"), { maxAge: "10m", etag: true }));
  // Bruno 2026-06-18 (auditoria A3): nosniff impede que um arquivo malicioso
  // (SVG/HTML) sirva como script no domínio. (Acesso autenticado/URL assinada
  // pro /uploads é o passo maior, fica pra rodada dedicada — ver relatório.)
  // Extensões que o browser RENDERIZA/EXECUTA inline no nosso domínio (XSS armazenado):
  // nosniff sozinho NÃO basta — um .svg/.html servido com seu próprio Content-Type
  // (image/svg+xml / text/html) ainda roda <script> na origem do app. Como mídia
  // pode entrar por webhook (documento do cliente preserva extensão), forçamos
  // download dessas extensões. Imagem/áudio/vídeo/pdf continuam inline (player/viewer).
  const DANGEROUS_INLINE_EXT = /\.(html?|xhtml|svgz?|xml|js|mjs|cjs|htm)$/i;
  app.use("/uploads", express.static(uploadsDir, {
    maxAge: "30d",
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (DANGEROUS_INLINE_EXT.test(filePath)) {
        res.setHeader("Content-Disposition", "attachment");
        res.setHeader("Content-Type", "application/octet-stream");
      }
    },
  }));

  // Bruno 2026-06-05: áudio do WhatsApp chega em OGG/Opus, que Safari/iOS NÃO
  // tocam no <audio> (Chrome/Android tocam). Este endpoint transcodifica o .ogg
  // pra .mp3 (universal) SOB DEMANDA, cacheia em disco e redireciona pro .mp3
  // estático (express.static dá range support → Safari toca). Cobre áudios
  // antigos e novos. Público (igual /uploads; <audio src> não manda auth header)
  // com validação anti-traversal: só serve dentro de uploadsDir.
  app.get("/api/audio-compat", async (req, res) => {
    const u = String(req.query.u || "");
    try {
      const { resolveAudioCompat } = await import("./utils/audioCompat");
      const r = await resolveAudioCompat(u);
      if (r.status === 302 && r.redirect) return res.redirect(302, r.redirect);
      return res.status(r.status).end();
    } catch (e: any) {
      console.warn(`[audio-compat] falha (${u}):`, e?.message);
      // Fallback: serve o original — pelo menos Chrome/Android tocam.
      return res.redirect(302, u || "/");
    }
  });

  app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["host"] || req.hostname;
    const publicUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    res.json({ ok: true, url: publicUrl, filename: req.file.filename });
  });

  registerAuthRoutes(app);
  registerPartnerRoutes(app);
  registerPerfilRoutes(app);
  registerLeadRoutes(app);
  registerPipelineRoutes(app);
  registerPipelineColumnRoutes(app);
  registerContactRoutes(app);
  registerConversationRoutes(app);
  registerMessageRoutes(app);
  registerAutomacaoRoutes(app);
  registerUsuarioRoutes(app);
  registerBillingRoutes(app);
  registerAsaasRoutes(app);
  registerConexaoRoutes(app);
  registerWebhookRoutes(app);
  registerCampanhaRoutes(app);
  registerAdminRoutes(app);
  registerOnboardingRoutes(app);
  registerAutomationLogRoutes(app);
  registerTenantSettingsRoutes(app);
  registerAdminTenantSettingsRoutes(app);
  registerHealthRoutes(app);
  registerLinkPreviewRoutes(app);

  app.get("/api/media-proxy", requireAuth, async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "URL obrigatória" });
    try {
      const allowed = /^https:\/\/(scontent|video|.*\.fbcdn\.net|.*\.cdninstagram\.com)/i;
      if (!allowed.test(url)) return res.status(403).json({ error: "URL não permitida" });
      const upstream = await fetch(url);
      if (!upstream.ok) return res.status(upstream.status).json({ error: "Falha ao buscar mídia" });
      const ct = upstream.headers.get("content-type");
      if (ct) res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=86400");
      const arrayBuf = await upstream.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
    } catch {
      res.status(502).json({ error: "Erro ao buscar mídia" });
    }
  });

  return httpServer;
}
