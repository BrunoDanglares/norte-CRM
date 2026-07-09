import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { hashPassword, verifyPassword, upload, uploadsDir, safeErr } from "../utils/helpers";
import fs from "fs";
import path from "path";
import { tenantSettingsService } from "../services/tenantSettingsService";
import { extractTextFromPdfBuffer, parseTenantContractModel } from "../services/tenantContractModelParser";
import { bumpTokenVersion } from "../services/tokenVersionStore";

export function registerPerfilRoutes(app: Express) {
  app.get("/api/perfil/me", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      const { password, inviteToken, ...safe } = user as any;
      res.json({ ok: true, data: safe });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  app.put("/api/perfil/me", requireAuth, async (req, res) => {
    try {
      const { nome, cargo, telefone, bio, empresa, website, linkedin, twitter, instagram, github, tema, colorPreset, notif_novos_leads, notif_mensagens, notif_tarefas, notif_relatorios, notif_email } = req.body;
      const data: any = {};
      if (nome !== undefined) data.nome = nome;
      if (cargo !== undefined) data.cargo = cargo;
      if (telefone !== undefined) data.telefone = telefone;
      if (bio !== undefined) data.bio = bio;
      if (empresa !== undefined) data.empresa = empresa;
      if (website !== undefined) data.website = website;
      if (linkedin !== undefined) data.linkedin = linkedin;
      if (twitter !== undefined) data.twitter = twitter;
      if (instagram !== undefined) data.instagram = instagram;
      if (github !== undefined) data.github = github;
      if (tema !== undefined) data.tema = tema;
      if (colorPreset !== undefined) data.colorPreset = colorPreset;
      if (notif_novos_leads !== undefined) data.notifNovosLeads = notif_novos_leads;
      if (notif_mensagens !== undefined) data.notifMensagens = notif_mensagens;
      if (notif_tarefas !== undefined) data.notifTarefas = notif_tarefas;
      if (notif_relatorios !== undefined) data.notifRelatorios = notif_relatorios;
      if (notif_email !== undefined) data.notifEmail = notif_email;
      const updated = await storage.updateUser(req.user!.id, data);
      if (!updated) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      const { password, inviteToken, ...safe } = updated as any;
      res.json({ ok: true, data: safe });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  app.post("/api/perfil/alterar-senha", requireAuth, async (req, res) => {
    try {
      const { senhaAtual, novaSenha, confirmarSenha } = req.body;
      if (!senhaAtual || !novaSenha || !confirmarSenha) return res.status(400).json({ ok: false, error: "Todos os campos sao obrigatorios" });
      if (novaSenha !== confirmarSenha) return res.status(400).json({ ok: false, error: "A nova senha e a confirmacao nao coincidem" });
      if (novaSenha.length < 6) return res.status(400).json({ ok: false, error: "A nova senha deve ter pelo menos 6 caracteres" });
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      if (!verifyPassword(senhaAtual, user.password)) return res.status(401).json({ ok: false, error: "Senha atual incorreta" });
      const newHash = hashPassword(novaSenha);
      await storage.updateUser(req.user!.id, { password: newHash } as any);
      // Revogação de sessão (auditoria 2026-06-20): trocar a senha invalida TODOS os
      // tokens antigos (inclusive sessões em outros dispositivos). O usuário re-loga.
      await bumpTokenVersion(req.user!.id);
      res.json({ ok: true, message: "Senha alterada com sucesso. Por segurança, faça login novamente.", sessionRevoked: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  app.post("/api/perfil/avatar", requireAuth, async (req, res) => {
    try {
      const { avatarUrl } = req.body;
      if (avatarUrl === null || avatarUrl === "") {
        await storage.updateUser(req.user!.id, { avatarUrl: null, avatar: null } as any);
        return res.json({ ok: true, data: { avatarUrl: null } });
      }
      if (!avatarUrl || (!avatarUrl.startsWith("http://") && !avatarUrl.startsWith("https://"))) {
        return res.status(400).json({ ok: false, error: "URL invalida. Deve comecar com http:// ou https://" });
      }
      await storage.updateUser(req.user!.id, { avatarUrl, avatar: avatarUrl } as any);
      res.json({ ok: true, data: { avatarUrl } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  app.get("/api/workspace/empresa", requireAuth, async (req, res) => {
    try {
      const ws = await storage.getWorkspace(req.user!.workspaceId);
      if (!ws) return res.status(404).json({ ok: false, error: "Workspace nao encontrado" });
      res.json({
        ok: true,
        data: {
          nome: ws.nome,
          cnpj: (ws as any).cnpj || "",
          setor: (ws as any).setor || "",
          tamanho: (ws as any).tamanho || "",
          logo: (ws as any).logo || "",
          razaoSocial: (ws as any).razaoSocial || "",
          assinantes: (ws as any).assinantes || "",
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  app.put("/api/workspace/empresa", requireAuth, async (req, res) => {
    try {
      const { nome, cnpj, setor, tamanho, logo, razaoSocial, assinantes } = req.body;
      const data: any = {};
      if (nome !== undefined) data.nome = nome;
      if (cnpj !== undefined) data.cnpj = cnpj;
      data.setor = "provedor";
      if (tamanho !== undefined) data.tamanho = tamanho;
      if (logo !== undefined) data.logo = logo;
      if (razaoSocial !== undefined) data.razaoSocial = razaoSocial;
      if (assinantes !== undefined) data.assinantes = assinantes;
      const updated = await storage.updateWorkspace(req.user!.workspaceId, data);
      if (!updated) return res.status(404).json({ ok: false, error: "Workspace nao encontrado" });
      // Bruno 2026-06-18 (auditoria): não devolver cpfCnpj + IDs de billing.
      const { cpfCnpj, stripeCustomerId, stripeSubscriptionId, asaasCustomerId, asaasSubscriptionId, ...safe } = updated as any;
      res.json({ ok: true, data: safe });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  // ─── MODELO DE CONTRATO (tenant-level) ─────────────────────────────────
  // GET: retorna o modelo atual (se houver).
  app.get("/api/workspace/contract-model", requireAuth, async (req, res) => {
    try {
      const ts = await tenantSettingsService.getTenantSettings(req.user!.workspaceId);
      res.json({ ok: true, data: ts?.contractModel || null });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  // POST: recebe o PDF, extrai o texto, passa para LLM e propõe regras para o
  // admin revisar. NÃO salva ainda em tenantSettings — só depois do PUT com review.
  app.post(
    "/api/workspace/contract-model/upload",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file) return res.status(400).json({ ok: false, error: "Arquivo PDF ausente" });
        if (!/\.pdf$/i.test(file.originalname)) {
          return res.status(400).json({ ok: false, error: "Envie apenas arquivos PDF" });
        }
        const buffer = fs.readFileSync(file.path);
        let text = "";
        try {
          text = await extractTextFromPdfBuffer(buffer);
        } catch (pdfErr: any) {
          return res.status(400).json({ ok: false, error: `Falha ao ler o PDF: ${pdfErr.message}` });
        }
        if (!text || text.trim().length < 400) {
          return res.status(400).json({
            ok: false,
            error:
              "O PDF parece estar escaneado ou sem texto extraível (menos de 400 caracteres). Envie uma versão digital do contrato.",
          });
        }
        const { rules, rawSnippet } = await parseTenantContractModel(text, req.user!.workspaceId);
        const uploadUrl = `/uploads/${path.basename(file.path)}`;
        res.json({
          ok: true,
          data: {
            uploadedAt: new Date().toISOString(),
            fileName: file.originalname,
            uploadUrl,
            parseStatus: "ok",
            rawSnippet,
            rules,
            reviewedByHuman: false,
          },
        });
      } catch (e: any) {
        res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
      }
    },
  );

  // PUT: salva o modelo já revisado pelo admin em tenantSettings.contractModel.
  app.put("/api/workspace/contract-model", requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.fileName || !body.uploadUrl || !body.rules) {
        return res.status(400).json({ ok: false, error: "Campos obrigatórios ausentes (fileName, uploadUrl, rules)" });
      }
      const contractModel = {
        uploadedAt: body.uploadedAt || new Date().toISOString(),
        uploadedBy: { id: req.user!.id, nome: req.user!.nome },
        fileName: String(body.fileName),
        uploadUrl: String(body.uploadUrl),
        parseStatus: "ok" as const,
        rawSnippet: body.rawSnippet ? String(body.rawSnippet).slice(0, 400) : undefined,
        rules: body.rules,
        reviewedByHuman: true,
      };
      await tenantSettingsService.updateTenantSettings(req.user!.workspaceId, { contractModel } as any);
      res.json({ ok: true, data: contractModel });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });

  // DELETE: remove o modelo de contrato do tenantSettings.
  app.delete("/api/workspace/contract-model", requireAuth, async (req, res) => {
    try {
      await tenantSettingsService.updateTenantSettings(req.user!.workspaceId, { contractModel: null } as any);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });
  // ───────────────────────────────────────────────────────────────────────

  app.delete("/api/perfil/conta", requireAuth, async (req, res) => {
    try {
      const { senha } = req.body;
      if (!senha) return res.status(400).json({ ok: false, error: "Senha e obrigatoria para confirmar" });
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ ok: false, error: "Usuario nao encontrado" });
      if (!verifyPassword(senha, user.password)) return res.status(401).json({ ok: false, error: "Senha incorreta" });
      if (user.role === "admin") {
        const wsUsers = await storage.getUsers(user.workspaceId as string);
        const admins = wsUsers.filter((u: any) => u.role === "admin" && u.status === "ACTIVE");
        if (admins.length <= 1) return res.status(403).json({ ok: false, error: "Nao e possivel excluir o unico administrador da conta" });
      }
      // Auditoria 2026-06-19: via blocklist — entra no Set + fecha as sessões na hora.
      // updateUser cru deixava o JWT do próprio usuário válido por até 7d após o
      // "excluir conta" (requireAuth é stateless, não relê o status no banco).
      const { setUserBlocked } = await import("../services/tenantBlocklist");
      await setUserBlocked(req.user!.id, true);
      res.json({ ok: true, message: "Conta desativada com sucesso" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: safeErr(e, "[perfil]") });
    }
  });
}
