import { Router, Request, Response } from "express";
import { db } from "../db";
import { whatsappOfficialConnections, whatsappMessageTemplates, waAutomations } from "@shared/schema";
import { eq, and, ne, desc, inArray } from "drizzle-orm";
import { submitTemplate, syncTemplateStatus, countTemplateVariables } from "../services/meta-whatsapp-templates";
import { encrypt } from "../utils/crypto";
import { safeErr } from "../utils/helpers";
import {
  exchangeCodeForToken,
  getLongLivedToken,
  getWABADetails,
  getPhoneNumbers,
  subscribeWebhook,
  syncTemplatesFromMeta,
} from "../services/meta-whatsapp";

const router = Router();

async function resolveWorkspaceId(req: Request): Promise<string> {
  const wsId = req.user?.workspaceId;
  if (wsId && wsId.length > 10) return wsId;
  const { storage } = await import("../storage");
  const user = req.user?.id ? await storage.getUser(req.user.id) : null;
  if (user?.workspaceId && user.workspaceId.length > 10) return user.workspaceId;
  throw new Error("Workspace nao encontrado");
}

router.post("/connect", async (req: Request, res: Response) => {
  try {
    const { code, waba_id, phone_number_id, access_token, app_secret } = req.body;
    if (!waba_id || !phone_number_id) {
      return res.status(400).json({ error: "waba_id e phone_number_id sao obrigatorios" });
    }

    const workspaceId = await resolveWorkspaceId(req);
    let token: string;
    let tokenType: string;
    let tokenExpiresAt: Date | null = null;

    if (code) {
      const shortToken = await exchangeCodeForToken(code);
      const longLived = await getLongLivedToken(shortToken);
      token = longLived.token;
      tokenType = "user";
      tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    } else if (access_token) {
      token = access_token;
      tokenType = "system_user";
    } else {
      return res.status(400).json({ error: "code ou access_token e obrigatorio" });
    }

    let businessName = "";
    let displayPhoneNumber = "";
    let qualityRating = "";
    let messagingLimitTier = "";
    let metaBusinessId = waba_id;

    try {
      const wabaInfo = await getWABADetails(waba_id, token);
      businessName = wabaInfo.name || "";
      metaBusinessId = wabaInfo.id || waba_id;
      const phones = await getPhoneNumbers(waba_id, token);
      const phone = phones.find((p) => p.id === phone_number_id) || phones[0];
      if (phone) {
        displayPhoneNumber = phone.displayPhoneNumber;
        qualityRating = phone.qualityRating || "";
        messagingLimitTier = phone.messagingLimitTier || "";
      }
    } catch (wabaErr: any) {
      console.warn("[WA-Official] WABA phone lookup failed, trying direct:", wabaErr.message);
    }

    if (!displayPhoneNumber) {
      const { getPhoneNumberById } = await import("../services/meta-whatsapp");
      const phoneInfo = await getPhoneNumberById(phone_number_id, token);
      if (!phoneInfo) {
        return res.status(400).json({ error: "Token sem permissao para acessar este WABA/numero. Verifique as permissoes do System User no Meta Business Suite." });
      }
      displayPhoneNumber = phoneInfo.displayPhoneNumber;
      qualityRating = phoneInfo.qualityRating || "";
      messagingLimitTier = phoneInfo.messagingLimitTier || "";
      if (phoneInfo.verifiedName) businessName = phoneInfo.verifiedName;
    }

    try {
      await subscribeWebhook(waba_id, token);
    } catch (webhookErr: any) {
      console.warn("[WA-Official] Webhook subscription failed (non-blocking):", webhookErr.message);
    }

    const values: any = {
      workspaceId,
      wabaId: waba_id,
      phoneNumberId: phone_number_id,
      displayPhoneNumber,
      businessName,
      qualityRating,
      messagingLimitTier,
      accessToken: token,
      tokenType,
      tokenExpiresAt,
      status: "active" as const,
      webhookVerified: true,
      metaBusinessId,
      connectedAt: new Date(),
      updatedAt: new Date(),
    };

    if (typeof app_secret === "string" && app_secret.trim().length > 0) {
      values.appSecret = encrypt(app_secret.trim());
    }

    const existing = await db
      .select()
      .from(whatsappOfficialConnections)
      .where(eq(whatsappOfficialConnections.workspaceId, workspaceId))
      .limit(1);

    let connection;
    if (existing.length > 0) {
      [connection] = await db
        .update(whatsappOfficialConnections)
        .set(values)
        .where(eq(whatsappOfficialConnections.workspaceId, workspaceId))
        .returning();
    } else {
      [connection] = await db
        .insert(whatsappOfficialConnections)
        .values(values)
        .returning();
    }

    // appSecret (segredo do app Meta, valida assinatura de webhook) nunca vai pro front.
    const { accessToken: _t, appSecret: _as, ...safe } = connection;
    res.json({ ok: true, data: { ...safe, token_masked: "••••••••" } });
  } catch (err: any) {
    console.error("[WhatsApp Official] Connect error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/connection", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [conn] = await db
      .select()
      .from(whatsappOfficialConnections)
      .where(
        and(
          eq(whatsappOfficialConnections.workspaceId, workspaceId),
          ne(whatsappOfficialConnections.status, "disconnected")
        )
      )
      .limit(1);

    if (!conn) {
      return res.json({ connected: false });
    }

    // Bruno 2026-06-18 (auditoria): NÃO devolver token/appSecret (segredos Meta) pro front.
    const { accessToken: _t, appSecret: _as, ...safe } = conn;
    res.json({ connected: true, data: { ...safe, token_masked: "••••••••" } });
  } catch (err: any) {
    console.error("[WhatsApp Official] Get connection error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/connection", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    await db
      .update(whatsappOfficialConnections)
      .set({ status: "disconnected", accessToken: "", updatedAt: new Date() })
      .where(eq(whatsappOfficialConnections.workspaceId, workspaceId));

    res.json({ success: true });
  } catch (err: any) {
    console.error("[WhatsApp Official] Disconnect error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.patch("/connection/automacao", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { automacaoId } = req.body;

    if (automacaoId) {
      const { storage } = await import("../storage");
      const auto = await storage.getAutomacao(automacaoId, workspaceId);
      if (!auto) return res.status(400).json({ ok: false, error: "Automacao nao encontrada neste workspace" });
      if (auto.status !== "ACTIVE") return res.status(400).json({ ok: false, error: "Automacao nao esta ativa" });
    }

    const [currentConn] = await db.select().from(whatsappOfficialConnections)
      .where(and(eq(whatsappOfficialConnections.workspaceId, workspaceId), ne(whatsappOfficialConnections.status, "disconnected")))
      .limit(1);

    const hadAutomacao = !!currentConn?.automacaoId;
    const removingAutomacao = hadAutomacao && !automacaoId;

    await db
      .update(whatsappOfficialConnections)
      .set({ automacaoId: automacaoId || null, updatedAt: new Date() })
      .where(
        and(
          eq(whatsappOfficialConnections.workspaceId, workspaceId),
          ne(whatsappOfficialConnections.status, "disconnected")
        )
      );

    if (removingAutomacao) {
      try {
        const { conversations: convTable, automationPendingInputs } = await import("@shared/schema");
        const openConvs = await db.select({ id: convTable.id, telefone: convTable.telefone })
          .from(convTable)
          .where(and(
            eq(convTable.workspaceId, workspaceId),
            eq(convTable.canal, "whatsapp_official"),
            ne(convTable.status, "resolved")
          ));

        if (openConvs.length > 0) {
          for (const conv of openConvs) {
            if (conv.telefone) {
              try {
                await db.delete(automationPendingInputs).where(
                  and(eq(automationPendingInputs.phone, conv.telefone), eq(automationPendingInputs.workspaceId, workspaceId))
                );
              } catch {}
            }
          }
          console.log(`[WA Official] Automação removida: ${openConvs.length} pending inputs limpos`);
        }
      } catch (e: any) { console.error("[WA Official] Erro ao limpar pending inputs:", e.message); }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[WhatsApp Official] Link automacao error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/test", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [conn] = await db
      .select()
      .from(whatsappOfficialConnections)
      .where(
        and(
          eq(whatsappOfficialConnections.workspaceId, workspaceId),
          ne(whatsappOfficialConnections.status, "disconnected")
        )
      )
      .limit(1);

    if (!conn) {
      return res.json({ success: false, error: "Conexao nao encontrada" });
    }

    const phones = await getPhoneNumbers(conn.wabaId, conn.accessToken);
    if (phones.length === 0) {
      return res.json({ success: false, error: "Nenhum numero encontrado" });
    }

    res.json({
      success: true,
      phoneNumber: phones[0].displayPhoneNumber,
      qualityRating: phones[0].qualityRating,
    });
  } catch (err: any) {
    // Auditoria 2026-06-20: detalhe da API Meta só no log; resposta orienta sem vazar interno.
    console.error("[WhatsApp Official] Test error:", err.message);
    res.json({ success: false, error: "Falha ao testar a conexão. Verifique o token de acesso e o WABA ID." });
  }
});

router.get("/templates", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);

    if (((req.query.sync as string | undefined) as string | undefined) === "true") {
      const [conn] = await db
        .select()
        .from(whatsappOfficialConnections)
        .where(
          and(
            eq(whatsappOfficialConnections.workspaceId, workspaceId),
            ne(whatsappOfficialConnections.status, "disconnected")
          )
        )
        .limit(1);

      if (conn) {
        await doSyncTemplates(workspaceId, conn);
      }
    }

    const templates = await db
      .select()
      .from(whatsappMessageTemplates)
      .where(eq(whatsappMessageTemplates.workspaceId, workspaceId));

    res.json({ ok: true, data: templates });
  } catch (err: any) {
    console.error("[WhatsApp Official] Get templates error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/templates/sync", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [conn] = await db
      .select()
      .from(whatsappOfficialConnections)
      .where(
        and(
          eq(whatsappOfficialConnections.workspaceId, workspaceId),
          ne(whatsappOfficialConnections.status, "disconnected")
        )
      )
      .limit(1);

    if (!conn) {
      return res.status(400).json({ error: "Conexao oficial nao encontrada" });
    }

    const count = await doSyncTemplates(workspaceId, conn);
    res.json({ ok: true, synced: count });
  } catch (err: any) {
    console.error("[WhatsApp Official] Sync templates error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

async function doSyncTemplates(
  workspaceId: string,
  conn: typeof whatsappOfficialConnections.$inferSelect
): Promise<number> {
  const metaTemplates = await syncTemplatesFromMeta(conn.wabaId, conn.accessToken);
  let count = 0;

  for (const t of metaTemplates) {
    const bodyComp = t.components?.find((c: any) => c.type === "BODY");
    const headerComp = t.components?.find((c: any) => c.type === "HEADER");
    const footerComp = t.components?.find((c: any) => c.type === "FOOTER");
    const buttonsComp = t.components?.find((c: any) => c.type === "BUTTONS");

    const values = {
      workspaceId,
      connectionId: conn.id,
      templateName: t.name,
      templateId: t.id,
      category: t.category,
      language: t.language,
      status: t.status,
      bodyText: bodyComp?.text || "",
      headerType: headerComp?.format || null,
      headerContent: headerComp?.text || null,
      footerText: footerComp?.text || null,
      buttons: buttonsComp?.buttons || null,
      variablesCount: (bodyComp?.text?.match(/\{\{\d+\}\}/g) || []).length,
      rejectionReason: t.rejection_reason || null,
      approvedAt: t.status === "APPROVED" ? new Date() : null,
      updatedAt: new Date(),
    };

    const existing = await db
      .select()
      .from(whatsappMessageTemplates)
      .where(
        and(
          eq(whatsappMessageTemplates.workspaceId, workspaceId),
          eq(whatsappMessageTemplates.templateName, t.name),
          eq(whatsappMessageTemplates.language, t.language)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(whatsappMessageTemplates)
        .set(values)
        .where(eq(whatsappMessageTemplates.id, existing[0].id));
    } else {
      await db.insert(whatsappMessageTemplates).values(values);
    }
    count++;
  }

  return count;
}

router.post("/templates", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { templateName, category, language, headerType, headerContent, bodyText, footerText, buttons } = req.body;

    if (!templateName || !/^[a-z0-9_]+$/.test(templateName)) {
      return res.status(400).json({ error: "templateName obrigatorio e deve conter apenas letras minusculas, numeros e underscores" });
    }
    if (!bodyText || bodyText.length > 1024) {
      return res.status(400).json({ error: "bodyText obrigatorio e maximo 1024 caracteres" });
    }
    if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
      return res.status(400).json({ error: "category deve ser MARKETING, UTILITY ou AUTHENTICATION" });
    }

    const [conn] = await db.select()
      .from(whatsappOfficialConnections)
      .where(and(eq(whatsappOfficialConnections.workspaceId, workspaceId), ne(whatsappOfficialConnections.status, "disconnected")))
      .limit(1);

    if (!conn) return res.status(400).json({ error: "Conexao oficial nao encontrada" });

    const result = await submitTemplate({
      phoneNumberId: conn.phoneNumberId,
      accessToken: conn.accessToken,
      wabaId: conn.wabaId,
      templateName,
      category,
      language: language || "pt_BR",
      headerType: headerType || null,
      headerContent: headerContent || undefined,
      bodyText,
      footerText: footerText || undefined,
      buttons: buttons || undefined,
    });

    const [template] = await db.insert(whatsappMessageTemplates).values({
      workspaceId,
      connectionId: conn.id,
      templateName,
      templateId: result.templateId,
      category,
      language: language || "pt_BR",
      status: result.status,
      headerType: headerType || null,
      headerContent: headerContent || null,
      bodyText,
      footerText: footerText || null,
      buttons: buttons || null,
      variablesCount: countTemplateVariables(bodyText),
      submittedAt: new Date(),
    }).returning();

    res.status(201).json({ ok: true, data: template });
  } catch (err: any) {
    console.error("[WhatsApp Official] Create template error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/templates/:id/sync", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const templateId = parseInt(((req.params.id as string) as string));

    const [tmpl] = await db.select()
      .from(whatsappMessageTemplates)
      .where(and(eq(whatsappMessageTemplates.id, templateId), eq(whatsappMessageTemplates.workspaceId, workspaceId)))
      .limit(1);

    if (!tmpl) return res.status(404).json({ error: "Template nao encontrado" });

    const [conn] = await db.select()
      .from(whatsappOfficialConnections)
      .where(and(eq(whatsappOfficialConnections.workspaceId, workspaceId), ne(whatsappOfficialConnections.status, "disconnected")))
      .limit(1);

    if (!conn) return res.status(400).json({ error: "Conexao oficial nao encontrada" });

    const result = await syncTemplateStatus({
      wabaId: conn.wabaId,
      accessToken: conn.accessToken,
      templateName: tmpl.templateName,
      language: tmpl.language,
    });

    if (result) {
      const [updated] = await db.update(whatsappMessageTemplates)
        .set({
          status: result.status,
          rejectionReason: result.rejectionReason || null,
          approvedAt: result.status === "APPROVED" ? new Date() : tmpl.approvedAt,
          updatedAt: new Date(),
        })
        .where(eq(whatsappMessageTemplates.id, templateId))
        .returning();
      return res.json({ ok: true, data: updated });
    }

    res.json({ ok: true, data: tmpl });
  } catch (err: any) {
    console.error("[WhatsApp Official] Sync template error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/templates/sync-all", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);

    const [conn] = await db.select()
      .from(whatsappOfficialConnections)
      .where(and(eq(whatsappOfficialConnections.workspaceId, workspaceId), ne(whatsappOfficialConnections.status, "disconnected")))
      .limit(1);

    if (!conn) return res.status(400).json({ error: "Conexao oficial nao encontrada" });

    const pending = await db.select()
      .from(whatsappMessageTemplates)
      .where(and(
        eq(whatsappMessageTemplates.workspaceId, workspaceId),
        inArray(whatsappMessageTemplates.status, ["PENDING", "IN_APPEAL"])
      ));

    let updated = 0;
    for (const tmpl of pending) {
      const result = await syncTemplateStatus({
        wabaId: conn.wabaId,
        accessToken: conn.accessToken,
        templateName: tmpl.templateName,
        language: tmpl.language,
      });

      if (result && result.status !== tmpl.status) {
        await db.update(whatsappMessageTemplates)
          .set({
            status: result.status,
            rejectionReason: result.rejectionReason || null,
            approvedAt: result.status === "APPROVED" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(whatsappMessageTemplates.id, tmpl.id));
        updated++;
      }
    }

    res.json({ ok: true, updated, total: pending.length });
  } catch (err: any) {
    console.error("[WhatsApp Official] Sync all templates error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/templates/:id", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const templateId = parseInt(((req.params.id as string) as string));

    const [tmpl] = await db.select()
      .from(whatsappMessageTemplates)
      .where(and(eq(whatsappMessageTemplates.id, templateId), eq(whatsappMessageTemplates.workspaceId, workspaceId)))
      .limit(1);

    if (!tmpl) return res.status(404).json({ error: "Template nao encontrado" });

    if (tmpl.status === "APPROVED") {
      const [conn] = await db.select()
        .from(whatsappOfficialConnections)
        .where(and(eq(whatsappOfficialConnections.workspaceId, workspaceId), ne(whatsappOfficialConnections.status, "disconnected")))
        .limit(1);

      if (conn) {
        try {
          await fetch(`${GRAPH_API}/${conn.wabaId}/message_templates?name=${encodeURIComponent(tmpl.templateName)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${conn.accessToken}` },
          });
        } catch (e: any) {
          console.warn("[WhatsApp Official] Meta delete template warn:", e.message);
        }
      }
    }

    await db.delete(whatsappMessageTemplates).where(eq(whatsappMessageTemplates.id, templateId));
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[WhatsApp Official] Delete template error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

const GRAPH_API = "https://graph.facebook.com/v21.0";

router.get("/automations", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const rows = await db
      .select()
      .from(waAutomations)
      .where(eq(waAutomations.workspaceId, workspaceId))
      .orderBy(desc(waAutomations.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: safeErr(err, "[whatsapp-official]") });
  }
});

router.post("/automations", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const {
      nome, tipo, keyword, keywordMatchType, templateName,
      replyMessage, aiEnabled, aiSystemPrompt, aiObjective,
      scheduleStart, scheduleEnd,
    } = req.body;

    if (!nome || !tipo) {
      return res.status(400).json({ error: "nome e tipo sao obrigatorios" });
    }

    const [row] = await db.insert(waAutomations).values({
      workspaceId, nome, tipo,
      keyword, keywordMatchType, templateName,
      replyMessage, aiEnabled: aiEnabled || false,
      aiSystemPrompt, aiObjective,
      scheduleStart, scheduleEnd,
    }).returning();

    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: safeErr(err, "[whatsapp-official]") });
  }
});

router.patch("/automations/:id", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const allowed = [
      "nome", "tipo", "keyword", "keywordMatchType", "templateName",
      "replyMessage", "aiEnabled", "aiSystemPrompt", "aiObjective",
      "scheduleStart", "scheduleEnd",
    ];
    const updates: any = { updatedAt: new Date() };
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }

    const [row] = await db.update(waAutomations)
      .set(updates)
      .where(and(eq(waAutomations.id, ((req.params.id as string) as string)), eq(waAutomations.workspaceId, workspaceId)))
      .returning();

    if (!row) return res.status(404).json({ error: "Automacao nao encontrada" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: safeErr(err, "[whatsapp-official]") });
  }
});

router.patch("/automations/:id/toggle", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [existing] = await db.select()
      .from(waAutomations)
      .where(and(eq(waAutomations.id, ((req.params.id as string) as string)), eq(waAutomations.workspaceId, workspaceId)))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Automacao nao encontrada" });

    const [row] = await db.update(waAutomations)
      .set({ ativo: !existing.ativo, updatedAt: new Date() })
      .where(eq(waAutomations.id, ((req.params.id as string) as string)))
      .returning();

    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: safeErr(err, "[whatsapp-official]") });
  }
});

router.delete("/automations/:id", async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [row] = await db.delete(waAutomations)
      .where(and(eq(waAutomations.id, ((req.params.id as string) as string)), eq(waAutomations.workspaceId, workspaceId)))
      .returning();

    if (!row) return res.status(404).json({ error: "Automacao nao encontrada" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: safeErr(err, "[whatsapp-official]") });
  }
});

export default router;
