import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { instagramConnections, instagramMessages, instagramDataDeletions, conversations, leads } from "@shared/schema";
import { eq, and, desc, like, or, isNull } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId } from "../utils/helpers";
import { parseSignedRequest } from "../utils/metaSignedRequest";
import {
  handleInstaProspectDM,
  handleInstaProspectComment,
  handleInstaProspectStory,
} from "../services/instaProspectService";
import { processInstagramMessage, fetchInstagramProfile } from "../services/instagramMessageProcessor";
import { apiBaseFor, nodeFor } from "../services/instagramGraphClient";
import { resolveIgConnectionForWebhook, isOwnAccountComment } from "../services/igWebhookResolver";

// Garante UMA ÚNICA conexão Instagram ativa por workspace: desativa todas as anteriores
// antes de (re)ativar a atual. Sem isso, reconectar com OUTRO app Meta (ex.: trocar de app)
// deixava a conexão antiga ativa com token do app velho, e a publicação/DM pegava esse token
// velho por engano ("user has not authorized application …"). Bruno 2026-07-11.
async function desativarConexoesInstagram(workspaceId: string) {
  await db.update(instagramConnections)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(instagramConnections.workspaceId, workspaceId), eq(instagramConnections.isActive, true)));
}

// Bruno 2026-06-19 (auditoria IG): o `state` do OAuth carrega o workspaceId e
// ANTES era só base64 (forjável) → CSRF de binding: atacante completava o OAuth
// injetando o workspaceId da vítima e amarrava a conta IG dele ao tenant alvo
// (ou lia/escrevia DMs por outra conta). Agora o state é assinado com HMAC
// (JWT_SECRET) + expira em 10min → callback rejeita state forjado/expirado.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
function signOAuthState(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyOAuthState(state: string): { workspaceId: string } {
  const [body, sig] = String(state).split(".");
  if (!body || !sig) throw new Error("state malformado");
  const expected = crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("state inválido (assinatura)");
  }
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (!data.workspaceId || typeof data.ts !== "number" || Date.now() - data.ts > OAUTH_STATE_TTL_MS) {
    throw new Error("state expirado");
  }
  return { workspaceId: data.workspaceId };
}

export const webhookRouter = Router();

webhookRouter.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken =
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  // Fail-closed (auditoria F): sem verify token configurado, NÃO ecoa o challenge —
  // senão `undefined === undefined` deixava qualquer um completar a subscrição.
  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "Token invalido" });
});

webhookRouter.post("/webhook", async (req: Request, res: Response) => {
  const body = req.body;

  if (body?.object === "whatsapp_business_account") {
    console.warn("[Instagram→Meta] WhatsApp webhook recebido no endpoint Instagram, redirecionando...");
    try {
      const { default: metaRouter } = await import("./webhook-meta");
      req.url = "/";
      return metaRouter(req, res, () => {});
    } catch (err: any) {
      console.error("[Instagram→Meta] Erro ao redirecionar webhook:", err.message);
      return res.sendStatus(200);
    }
  }

  const signature = req.headers["x-hub-signature-256"] as string;
  const appSecret =
    process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
  // Fail-closed (auditoria F, paridade webhook-meta): sem app_secret configurado,
  // REJEITA — antes ambos os branches eram pulados e qualquer payload forjado de
  // "DM de cliente" era processado (dispara bot, custa OpenAI, polui conversa).
  if (!appSecret) {
    console.error("[Instagram] nenhum app_secret configurado — rejeitando webhook");
    return res.sendStatus(500);
  }
  if (!signature) {
    console.warn("[Instagram] Webhook sem assinatura — rejeitando");
    return res.sendStatus(401);
  }
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.warn("[Instagram] Webhook signature inválida — rejeitando");
    return res.sendStatus(401);
  }

  res.status(200).send("EVENT_RECEIVED");

  if (body.object !== "instagram") return;

  for (const entry of body.entry || []) {
    const igUserId = entry.id;

    const conn = await resolveIgConnectionForWebhook(igUserId);

    if (!conn) {
      console.warn(
        "[Instagram] Webhook sem conexao cadastrada para igUserId:",
        igUserId
      );
      continue;
    }

    for (const messaging of entry.messaging || []) {
      const { sender, recipient, message } = messaging;
      if (!message) continue;

      // Retenção (exigência Meta 2026): se o usuário APAGA/desfaz a mensagem, apagamos
      // nossa cópia armazenada. Best-effort — o payload de unsend do IG pode variar;
      // se não vier `is_deleted`, o bloco simplesmente não dispara. Bruno 2026-07-09.
      if (message.is_deleted && message.mid) {
        await db.delete(instagramMessages).where(eq(instagramMessages.igMessageId, message.mid)).catch(() => {});
        continue;
      }

      const isEcho = !!(message.is_echo || sender.id === igUserId);
      const customerIgUserId = isEcho ? recipient.id : sender.id;

      await processInstagramMessage({
        workspaceId: conn.workspaceId,
        connectionId: conn.id,
        igAccountUserId: igUserId,
        accessToken: conn.accessToken,
        senderIgUserId: customerIgUserId,
        recipientIgUserId: igUserId,
        senderUsername: sender.username || "",
        message: {
          mid: message.mid || `ig_${Date.now()}`,
          text: message.text,
          attachments: message.attachments,
          is_echo: isEcho,
        },
      });

      if (!isEcho) {
        await handleInstaProspectDM({
          workspaceId: conn.workspaceId,
          connectionId: conn.id,
          accessToken: conn.accessToken,
          igAccountUserId: igUserId,
          senderIgUserId: sender.id,
          senderIgUsername: sender.username || "",
          messageText: message.text || "",
          attachments: message.attachments,
        });
      }
    }

    // Bug fix (Bruno 2026-07-11): faltava passar o fluxo vinculado (linkedFlowId).
    // Sem ele, handleInstaProspectComment/Story retornavam logo no início e o
    // comentário NUNCA era respondido por este webhook. Espelha o /api/webhook/meta.
    const commentFlowId = conn.automacaoId || conn.commentAutomacaoId;
    const storyFlowId = conn.automacaoId;

    for (const change of entry.changes || []) {
      if (change.field === "comments" && change.value) {
        const { value } = change;
        if (isOwnAccountComment(conn, value.from, igUserId)) {
          // anti-loop: reply do bot é postado como comentário e voltaria como webhook
          console.log(`[Instagram] comentário da PRÓPRIA conta ignorado (anti-loop) comment=${value.id}`);
        } else if (commentFlowId) {
          console.log(`[Instagram] comentário recebido igUser=${igUserId} flow=${commentFlowId} comment=${value.id} texto="${(value.text || "").slice(0, 40)}"`);
          await handleInstaProspectComment({
            workspaceId: conn.workspaceId,
            connectionId: conn.id,
            accessToken: conn.accessToken,
            igAccountUserId: igUserId,
            commentId: value.id,
            postId: value.media?.id || "",
            fromIgUserId: value.from?.id || "",
            fromIgUsername: value.from?.username || "",
            commentText: value.text || "",
            linkedFlowId: commentFlowId,
          });
        }
      }

      if (change.field === "mention" && change.value && storyFlowId) {
        await handleInstaProspectStory({
          workspaceId: conn.workspaceId,
          accessToken: conn.accessToken,
          igAccountUserId: igUserId,
          fromIgUserId: change.value?.sender_id || "",
          fromIgUsername: change.value?.from?.username || "",
          linkedFlowId: storyFlowId,
        });
      }
    }
  }
});

// ── Deauthorize Callback (Meta) ──────────────────────────────────────────────
// A Meta chama quando o usuário REMOVE o app. Recebe signed_request (form POST),
// valida a assinatura e DESATIVA a conexão daquela conta IG. Campo obrigatório no
// painel do app pra liberar o App Review. Responde 200. Bruno 2026-07-09.
webhookRouter.post("/deauthorize", async (req: Request, res: Response) => {
  try {
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "";
    const data = parseSignedRequest(String(req.body?.signed_request || ""), appSecret);
    if (!data?.user_id) {
      console.warn("[Instagram] deauthorize com signed_request inválido");
      return res.sendStatus(400);
    }
    const upd = await db.update(instagramConnections)
      .set({ isActive: false, webhookVerified: false, updatedAt: new Date() })
      .where(eq(instagramConnections.igUserId, String(data.user_id)))
      .returning({ id: instagramConnections.id });
    console.log(`[Instagram] deauthorize: ${upd.length} conexão(ões) desativada(s) p/ igUser=${data.user_id}`);
    return res.sendStatus(200);
  } catch (err: any) {
    console.error("[Instagram] Erro no deauthorize:", err?.message || err);
    return res.sendStatus(200); // Meta espera 200 mesmo em erro interno
  }
});

// ── Data Deletion Request Callback (Meta) ────────────────────────────────────
// A Meta chama quando o usuário pede EXCLUSÃO de dados. Valida o signed_request,
// APAGA os dados daquela conta IG (a conexão; dependências caem por ON DELETE
// CASCADE) e devolve { url, confirmation_code } — a Meta acompanha pelo status.
webhookRouter.post("/data-deletion", async (req: Request, res: Response) => {
  try {
    const appSecret = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "";
    const data = parseSignedRequest(String(req.body?.signed_request || ""), appSecret);
    if (!data?.user_id) {
      console.warn("[Instagram] data-deletion com signed_request inválido");
      return res.status(400).json({ error: "signed_request inválido" });
    }
    const igUserId = String(data.user_id);
    const del = await db.delete(instagramConnections)
      .where(eq(instagramConnections.igUserId, igUserId))
      .returning({ id: instagramConnections.id });
    const confirmationCode = `del_${crypto.randomBytes(9).toString("hex")}`;
    await db.insert(instagramDataDeletions).values({ confirmationCode, igUserId, status: "completed" }).catch(() => {});
    console.log(`[Instagram] data-deletion: ${del.length} conexão(ões) apagada(s) p/ igUser=${igUserId} code=${confirmationCode}`);
    const base = (process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`).replace(/\/$/, "");
    return res.json({
      url: `${base}/api/instagram/data-deletion/status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  } catch (err: any) {
    console.error("[Instagram] Erro no data-deletion:", err?.message || err);
    return res.status(500).json({ error: "erro ao processar exclusão de dados" });
  }
});

// Página de status que a Meta valida com o confirmation_code (URL devolvida acima).
webhookRouter.get("/data-deletion/status", async (req: Request, res: Response) => {
  const code = String(req.query.code || "");
  const [row] = code
    ? await db.select().from(instagramDataDeletions).where(eq(instagramDataDeletions.confirmationCode, code)).limit(1)
    : [];
  if (!row) return res.status(404).send("Código de exclusão não encontrado.");
  return res.status(200).send(
    `<!doctype html><meta charset="utf-8"><title>Exclusão de dados</title>` +
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:48px auto;padding:0 16px">` +
    `<h2>Exclusão de dados concluída</h2>` +
    `<p>O pedido de exclusão de dados do Instagram foi processado.</p>` +
    `<p><b>Código de confirmação:</b> ${code}</p>` +
    `<p><b>Status:</b> ${row.status}</p></div>`,
  );
});

export const protectedRouter = Router();

protectedRouter.get("/connections", async (req: Request, res: Response) => {
  const workspaceId = (req as any).user?.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: "Sem workspace" });

  const connections = await db
    .select()
    .from(instagramConnections)
    .where(eq(instagramConnections.workspaceId, workspaceId));

  const sanitized = connections.map(({ accessToken, ...rest }) => rest);
  res.json({ ok: true, data: sanitized });
});

protectedRouter.get("/messages", async (req: Request, res: Response) => {
  const workspaceId = (req as any).user?.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: "Sem workspace" });

  const igUserId = req.query.igUserId as string;
  // clamp da query string: limit gigante = OOM, negativo = erro SQL
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 500);

  const whereClause = igUserId
    ? and(eq(instagramMessages.workspaceId, workspaceId), eq(instagramMessages.fromIgUserId, igUserId))
    : eq(instagramMessages.workspaceId, workspaceId);

  const messages = await db
    .select()
    .from(instagramMessages)
    .where(whereClause)
    .orderBy(desc(instagramMessages.createdAt))
    .limit(limit);

  res.json({ ok: true, data: messages });
});

protectedRouter.get("/auth-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = process.env.META_APP_ID;
    if (!clientId) return res.status(500).json({ error: "META_APP_ID nao configurado" });

    const workspaceId = await resolveWorkspaceId(req);
    const redirectUri = process.env.META_REDIRECT_URI ||
      `https://${req.get("host")}/api/instagram/callback`;

    const scopes = [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      // Instaflix: publicar no feed (Content Publishing API). Exige App Review
      // da Meta pra usar fora do modo dev / contas sem papel no app. Bruno 2026-07-04.
      "instagram_content_publish",
      // Insights de mídia (loop de aprendizado do Instaflix).
      "instagram_manage_insights",
      "pages_manage_metadata",
      "pages_read_engagement",
      "pages_show_list",
    ].join(",");

    const state = signOAuthState({
      workspaceId,
      ts: Date.now(),
    });

    // auth_type=reauthenticate: força re-autenticação em vez de reusar a sessão FB
    // já aberta — pra um tenant novo poder conectar a conta dele, não a que já está
    // logada no navegador (a do outro tenant). Bruno 2026-07-09.
    const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}&response_type=code&auth_type=reauthenticate`;

    res.json({ url });
  } catch (err: any) {
    console.error("[Instagram OAuth] Erro ao gerar auth-url:", err.message);
    res.status(500).json({ error: "Erro ao gerar URL de autenticacao" });
  }
});

// ── Instagram LOGIN (sem Página do Facebook) ─────────────────────────────────
// Fluxo "API do Instagram com login do Instagram": conecta a conta Business/Creator
// direto pelo Instagram, sem exigir vínculo com Página FB. Suporta publicação.
// Usa INSTAGRAM_APP_ID/SECRET (do produto Instagram no app Meta), ≠ META_APP_*.
// Bruno 2026-07-07.
protectedRouter.get("/ig-auth-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const clientId = process.env.INSTAGRAM_APP_ID;
    if (!clientId) return res.status(500).json({ error: "INSTAGRAM_APP_ID nao configurado" });

    const workspaceId = await resolveWorkspaceId(req);
    const base = (process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`).replace(/\/$/, "");
    const redirectUri = process.env.IG_REDIRECT_URI || `${base}/api/instagram/ig-callback`;

    const scopes = [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
    ].join(",");

    const state = signOAuthState({ workspaceId, ts: Date.now() });
    // force_reauth=true: SEMPRE mostra a tela de login do Instagram em vez de
    // reaproveitar a sessão Meta já aberta no navegador. Sem isso, um tenant novo
    // "reconectava" silenciosamente a MESMA conta já logada (a do outro tenant);
    // com isso, o usuário pode entrar com a conta DELE. Bruno 2026-07-09.
    const url = `https://www.instagram.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&force_reauth=true`;
    res.json({ url });
  } catch (err: any) {
    console.error("[Instagram Login] Erro ao gerar ig-auth-url:", err.message);
    res.status(500).json({ error: "Erro ao gerar URL de login do Instagram" });
  }
});

webhookRouter.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || `https://${req.get("host")}`;

  if (error) {
    return res.redirect(`${frontendUrl}/conexoes?ig_error=${error}`);
  }

  let workspaceId: string;
  try {
    ({ workspaceId } = verifyOAuthState(state as string));
  } catch (e: any) {
    console.warn("[Instagram OAuth] state rejeitado:", e.message);
    return res.redirect(`${frontendUrl}/conexoes?ig_error=${encodeURIComponent("Sessão de conexão inválida ou expirada. Tente conectar novamente.")}`);
  }

  try {
    const redirectUri = process.env.META_REDIRECT_URI ||
      `https://${req.get("host")}/api/instagram/callback`;
    const clientId = process.env.META_APP_ID;
    const clientSecret = process.env.META_APP_SECRET;

    if (!clientId || !clientSecret) throw new Error("META_APP_ID ou META_APP_SECRET nao configurados");

    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `client_id=${clientId}&` +
      `client_secret=${clientSecret}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `code=${code}`
    );
    const tokenData = await tokenRes.json() as any;
    if (tokenData.error) throw new Error(tokenData.error.message || "Erro ao trocar code por token");
    const shortToken = tokenData.access_token;

    const longTokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${clientId}&` +
      `client_secret=${clientSecret}&` +
      `fb_exchange_token=${shortToken}`
    );
    const longTokenData = await longTokenRes.json() as any;
    const longToken = longTokenData.access_token || shortToken;

    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${longToken}`
    );
    const pagesData = await pagesRes.json() as any;
    const page = pagesData.data?.[0];
    if (!page) throw new Error("Nenhuma Pagina do Facebook encontrada");

    const pageToken = page.access_token;
    const pageId = page.id;

    const igRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
    );
    const igData = await igRes.json() as any;
    const igUserId = igData.instagram_business_account?.id;
    if (!igUserId) throw new Error("Nenhuma conta Instagram Business vinculada a Pagina");

    const igProfileRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}?fields=username,profile_picture_url&access_token=${pageToken}`
    );
    const igProfile = await igProfileRes.json() as any;

    const [existing] = await db
      .select()
      .from(instagramConnections)
      .where(and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.igUserId, igUserId)
      ))
      .limit(1);

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    if (existing) {
      await db.update(instagramConnections)
        .set({
          accessToken: pageToken,
          igUsername: igProfile.username || existing.igUsername,
          pageId,
          pageName: page.name,
          tokenExpiresAt: expiresAt,
          isActive: true,
          webhookVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(instagramConnections.id, existing.id));
    } else {
      await db.insert(instagramConnections).values({
        workspaceId,
        igUserId,
        igUsername: igProfile.username || "unknown",
        accessToken: pageToken,
        pageId,
        pageName: page.name,
        tokenExpiresAt: expiresAt,
        webhookVerified: true,
        isActive: true,
      });
    }

    await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?` +
      `subscribed_fields=messages,messaging_postbacks,comments,mention&` +
      `access_token=${pageToken}`,
      { method: "POST" }
    );

    console.log(`[Instagram OAuth] Conexao salva: @${igProfile.username} para workspace ${workspaceId}`);
    res.redirect(`${frontendUrl}/conexoes?ig_success=true`);
  } catch (err: any) {
    console.error("[Instagram OAuth] Erro:", err.message);
    res.redirect(`${frontendUrl}/conexoes?ig_error=${encodeURIComponent(err.message)}`);
  }
});

// ── Callback do Instagram LOGIN ──────────────────────────────────────────────
webhookRouter.get("/ig-callback", async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || `https://${req.get("host")}`;

  if (error) {
    return res.redirect(`${frontendUrl}/conexoes?ig_error=${encodeURIComponent(String(error_description || error))}`);
  }

  let workspaceId: string;
  try {
    ({ workspaceId } = verifyOAuthState(state as string));
  } catch (e: any) {
    return res.redirect(`${frontendUrl}/conexoes?ig_error=${encodeURIComponent("state invalido: " + e.message)}`);
  }

  try {
    const clientId = process.env.INSTAGRAM_APP_ID;
    const clientSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!clientId || !clientSecret) throw new Error("INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET nao configurados");

    const base = (process.env.PUBLIC_BASE_URL || `https://${req.get("host")}`).replace(/\/$/, "");
    const redirectUri = process.env.IG_REDIRECT_URI || `${base}/api/instagram/ig-callback`;

    // 1) code → token de curta duração (POST form-urlencoded)
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: String(code),
    });
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const shortData: any = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) {
      throw new Error(shortData?.error_message || shortData?.error?.message || "Falha ao trocar o code por token");
    }
    const shortToken: string = shortData.access_token;
    const igUserId: string = String(shortData.user_id);

    // 2) curta → longa duração (60 dias). Se FALHAR, NÃO seguimos com o token curto
    // silenciosamente — isso salvava uma conexão "ativa" com token quebrado que só
    // estourava (erro críptico) lá no sync. Falha aqui = devolve o erro REAL da Meta.
    // Bruno 2026-07-09.
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(shortToken)}`
    );
    const longData: any = await longRes.json().catch(() => ({}));
    if (!longRes.ok || !longData.access_token) {
      const m = longData?.error?.message || longData?.error_message || "falha ao gerar o token de longa duração";
      throw new Error(`troca de token falhou: ${m}`);
    }
    const longToken: string = longData.access_token;
    const expiresIn: number = longData.expires_in || 60 * 24 * 60 * 60;

    // 3) VERIFICA o token lendo o perfil. Se não ler, o token não serve pra API —
    // NÃO salvamos conexão quebrada; devolvemos o erro real (que aponta a causa:
    // conta não-profissional, permissão não concedida no consentimento, etc.).
    const meRes = await fetch(`https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(longToken)}`);
    const me: any = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me?.username) {
      const m = me?.error?.message || "não consegui ler o perfil com esse token";
      throw new Error(`${m} — verifique se a conta é Profissional (Business/Criador) e conceda TODAS as permissões na tela do Instagram ao conectar`);
    }
    const igUsername: string = me.username;

    // 4) Assina o app pra receber DMs/comentários DESSA conta (Instagram Login usa o
    // node "me"). Sem isto a conexão nascia "muda" — NÃO chegava evento nenhum — e é
    // o gate que MAIS reprova o App Review de mensagens. Bruno 2026-07-09.
    let webhookVerified = false;
    try {
      const subRes = await fetch(
        `https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages,comments&access_token=${encodeURIComponent(longToken)}`,
        { method: "POST" },
      );
      const subData: any = await subRes.json().catch(() => ({}));
      webhookVerified = subRes.ok && subData?.success !== false;
      if (!webhookVerified) console.warn(`[Instagram Login] subscribed_apps não confirmou: ${JSON.stringify(subData).slice(0, 200)}`);
    } catch (e: any) {
      console.warn(`[Instagram Login] falha ao assinar webhook: ${e?.message || e}`);
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await desativarConexoesInstagram(workspaceId); // mata conexão-fantasma de app antigo
    const [existing] = await db.select().from(instagramConnections)
      .where(and(eq(instagramConnections.workspaceId, workspaceId), eq(instagramConnections.igUserId, igUserId)))
      .limit(1);

    if (existing) {
      await db.update(instagramConnections).set({
        accessToken: longToken, igUsername, tokenExpiresAt: expiresAt,
        isActive: true, pageId: null, pageName: null, webhookVerified, updatedAt: new Date(),
      }).where(eq(instagramConnections.id, existing.id));
    } else {
      await db.insert(instagramConnections).values({
        workspaceId, igUserId, igUsername, accessToken: longToken,
        tokenExpiresAt: expiresAt, webhookVerified, isActive: true,
      });
    }

    console.log(`[Instagram Login] Conexao salva (IG Login): @${igUsername} (${igUserId}) ws=${workspaceId}`);
    res.redirect(`${frontendUrl}/conexoes?ig_success=true`);
  } catch (err: any) {
    console.error("[Instagram Login] Erro callback:", err.message);
    res.redirect(`${frontendUrl}/conexoes?ig_error=${encodeURIComponent(err.message)}`);
  }
});

protectedRouter.post("/connect-token", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { accessToken, igUserId } = req.body;

    if (!accessToken || !igUserId) {
      return res.status(400).json({ error: "accessToken e igUserId sao obrigatorios" });
    }

    const igProfileRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}?fields=username,profile_picture_url&access_token=${accessToken}`
    );
    const igProfile = await igProfileRes.json() as any;

    if (igProfile.error) {
      const igFallbackRes = await fetch(
        `https://graph.instagram.com/v19.0/${igUserId}?fields=user_id,username,profile_picture_url&access_token=${accessToken}`
      );
      const igFallback = await igFallbackRes.json() as any;
      if (igFallback.error) {
        return res.status(400).json({ error: igProfile.error.message || "Token invalido ou expirado" });
      }
      console.warn(`[Instagram] Token validou em graph.instagram mas NAO em graph.facebook — DMs podem nao funcionar. Use um Page Access Token do Facebook para suportar mensagens.`);
      const igUsername = igFallback.username || "unknown";
      await desativarConexoesInstagram(workspaceId); // mata conexão-fantasma de app antigo
      const [existing] = await db.select().from(instagramConnections).where(and(eq(instagramConnections.workspaceId, workspaceId), eq(instagramConnections.igUserId, igUserId))).limit(1);
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      if (existing) {
        await db.update(instagramConnections).set({ accessToken, igUsername, tokenExpiresAt: expiresAt, isActive: true, updatedAt: new Date() }).where(eq(instagramConnections.id, existing.id));
      } else {
        await db.insert(instagramConnections).values({ workspaceId, igUserId, igUsername, accessToken, tokenExpiresAt: expiresAt, webhookVerified: false, isActive: true });
      }
      console.log(`[Instagram] Conexao manual salva (token IG): @${igUsername} (${igUserId}) para workspace ${workspaceId}`);
      return res.json({ ok: true, username: igUsername, warning: "Token do Instagram detectado. Para enviar DMs automaticas, use o Page Access Token do Facebook (via OAuth)." });
    }

    const igUsername = igProfile.username || "unknown";

    await desativarConexoesInstagram(workspaceId); // mata conexão-fantasma de app antigo
    const [existing] = await db
      .select()
      .from(instagramConnections)
      .where(and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.igUserId, igUserId)
      ))
      .limit(1);

    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    if (existing) {
      await db.update(instagramConnections)
        .set({
          accessToken,
          igUsername,
          tokenExpiresAt: expiresAt,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(instagramConnections.id, existing.id));
    } else {
      await db.insert(instagramConnections).values({
        workspaceId,
        igUserId,
        igUsername,
        accessToken,
        tokenExpiresAt: expiresAt,
        webhookVerified: false,
        isActive: true,
      });
    }

    console.log(`[Instagram] Conexao manual salva: @${igUsername} (${igUserId}) para workspace ${workspaceId}`);
    res.json({ ok: true, username: igUsername });
  } catch (err: any) {
    console.error("[Instagram] Erro ao conectar manualmente:", err.message);
    res.status(500).json({ error: "Erro ao conectar conta Instagram" });
  }
});

protectedRouter.get("/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [conn] = await db
      .select()
      .from(instagramConnections)
      .where(and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.isActive, true)
      ))
      .limit(1);

    if (!conn) return res.json({ connected: false });

    const daysUntilExpiry = conn.tokenExpiresAt
      ? Math.floor((new Date(conn.tokenExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      connected: true,
      igUserId: conn.igUserId,
      username: conn.igUsername,
      pageId: conn.pageId,
      pageName: conn.pageName,
      tokenExpiresAt: conn.tokenExpiresAt,
      daysUntilExpiry,
      webhookVerified: conn.webhookVerified,
      dmCount: conn.dmCount,
      dmCountMonth: conn.dmCountMonth,
      automacaoId: conn.automacaoId || null,
      dmAutomacaoId: conn.dmAutomacaoId || null,
      commentAutomacaoId: conn.commentAutomacaoId || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao verificar status" });
  }
});

protectedRouter.get("/posts", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const [conn] = await db
      .select()
      .from(instagramConnections)
      .where(and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.isActive, true)
      ))
      .limit(1);

    if (!conn) return res.status(404).json({ error: "Instagram nao conectado" });

    // Base/nó dependem do TIPO de token: Page Token (padrão) → graph.facebook.com + id
    // numérico; Instagram Login (IGAA) → graph.instagram.com + "me". Antes hardcodava
    // graph.instagram.com/v19.0, o que quebrava com Page Token ("token inválido"). Bruno 2026-07-10.
    const token = conn.accessToken;
    const after = typeof req.query.after === "string" ? req.query.after.replace(/[^a-zA-Z0-9=_-]/g, "") : "";
    let url = `${apiBaseFor(token)}/${nodeFor(conn.igUserId, token)}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count&limit=12&access_token=${encodeURIComponent(token)}`;
    if (after) url += `&after=${encodeURIComponent(after)}`;

    const igRes = await fetch(url);
    const igData = await igRes.json() as any;

    if (igData.error) {
      console.warn("[Instagram] /posts erro do Graph:", igData.error.message || igData.error);
      return res.status(400).json({ error: igData.error.message || "Erro ao buscar posts" });
    }

    res.json({
      posts: (igData.data || []).map((p: any) => ({
        id: p.id,
        caption: p.caption || "",
        mediaType: p.media_type,
        mediaUrl: p.media_url || p.thumbnail_url || null,
        thumbnailUrl: p.thumbnail_url || p.media_url || null,
        timestamp: p.timestamp,
        permalink: p.permalink,
        likeCount: p.like_count || 0,
        commentsCount: p.comments_count || 0,
      })),
      nextCursor: igData.paging?.cursors?.after || null,
    });
  } catch (err: any) {
    console.error("[Instagram] Erro ao buscar posts:", err.message);
    res.status(500).json({ error: "Erro ao buscar publicacoes" });
  }
});

// Conexão IG ativa MAIS RECENTE do workspace (evita conexão-fantasma de app antigo).
async function conexaoIgAtiva(workspaceId: string) {
  const [conn] = await db.select().from(instagramConnections)
    .where(and(eq(instagramConnections.workspaceId, workspaceId), eq(instagramConnections.isActive, true)))
    .orderBy(desc(instagramConnections.updatedAt)).limit(1);
  return conn ?? null;
}

// Lista os comentários de uma publicação (+ 1 nível de respostas). Bruno 2026-07-11.
protectedRouter.get("/posts/:mediaId/comments", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const conn = await conexaoIgAtiva(workspaceId);
    if (!conn) return res.status(404).json({ error: "Instagram nao conectado" });
    const token = conn.accessToken;
    const mediaId = String(req.params.mediaId).replace(/[^a-zA-Z0-9_]/g, "");
    const url = `${apiBaseFor(token)}/${mediaId}/comments?fields=id,text,username,timestamp,like_count,replies{id,text,username,timestamp}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const data = await r.json() as any;
    if (data.error) return res.status(400).json({ error: data.error.message || "Erro ao buscar comentários" });
    res.set("Cache-Control", "no-store"); // reflete o Instagram AGORA (comentário apagado some)
    res.json({
      comments: (data.data || []).map((c: any) => ({
        id: c.id, text: c.text || "", username: c.username || "", timestamp: c.timestamp, likeCount: c.like_count || 0,
        replies: ((c.replies && c.replies.data) || []).map((rp: any) => ({
          id: rp.id, text: rp.text || "", username: rp.username || "", timestamp: rp.timestamp,
        })),
      })),
    });
  } catch (err: any) {
    console.error("[Instagram] Erro ao buscar comentários:", err.message);
    res.status(500).json({ error: "Erro ao buscar comentários" });
  }
});

// Responde (reply) a um comentário. Exercita a permissão instagram_business_manage_comments.
protectedRouter.post("/comments/:commentId/reply", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Escreva uma resposta" });
    if (message.length > 2200) return res.status(400).json({ error: "Resposta muito longa" });
    const conn = await conexaoIgAtiva(workspaceId);
    if (!conn) return res.status(404).json({ error: "Instagram nao conectado" });
    const token = conn.accessToken;
    const commentId = String(req.params.commentId).replace(/[^a-zA-Z0-9_]/g, "");
    const form = new URLSearchParams({ message, access_token: token });
    const r = await fetch(`${apiBaseFor(token)}/${commentId}/replies`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
    });
    const data = await r.json() as any;
    if (!r.ok || data.error) {
      console.warn("[Instagram] reply erro do Graph:", data.error?.message || data.error);
      return res.status(400).json({ error: data.error?.message || "Erro ao responder comentário" });
    }
    res.json({ ok: true, id: data.id });
  } catch (err: any) {
    console.error("[Instagram] Erro ao responder comentário:", err.message);
    res.status(500).json({ error: "Erro ao responder comentário" });
  }
});

protectedRouter.patch("/automacoes", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const { dmAutomacaoId, commentAutomacaoId, automacaoId } = req.body;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (automacaoId !== undefined) updates.automacaoId = automacaoId || null;
    if (dmAutomacaoId !== undefined) updates.dmAutomacaoId = dmAutomacaoId || null;
    if (commentAutomacaoId !== undefined) updates.commentAutomacaoId = commentAutomacaoId || null;

    await db.update(instagramConnections)
      .set(updates)
      .where(and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.isActive, true)
      ));

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Instagram] Erro ao vincular automacao:", err.message);
    res.status(500).json({ error: "Erro ao vincular automacao" });
  }
});

protectedRouter.delete("/disconnect", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    await db.update(instagramConnections)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(instagramConnections.workspaceId, workspaceId),
        eq(instagramConnections.isActive, true)
      ));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao desconectar" });
  }
});

webhookRouter.post("/backfill-names", requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = await resolveWorkspaceId(req);
    const igConns = await db.select().from(instagramConnections).where(eq(instagramConnections.workspaceId, workspaceId));
    if (!igConns.length) return res.json({ ok: true, updated: 0, message: "Sem conexão Instagram" });

    const token = igConns[0].accessToken;
    const igConvs = await db.select({
      id: conversations.id,
      nome: conversations.nome,
      telefone: conversations.telefone,
      avatar: conversations.avatar,
    }).from(conversations).where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.canal, "Instagram"),
        or(
          like(conversations.nome, "@ig_%"),
          like(conversations.nome, "ig_%"),
          like(conversations.nome, "@%"),
          like(conversations.nome, "%[unknown]%")
        )
      )
    );

    let updated = 0;
    const results: any[] = [];
    for (const conv of igConvs) {
      if (!conv.telefone) continue;
      const profile = await fetchInstagramProfile(token, conv.telefone);
      results.push({ convId: conv.id, oldName: conv.nome, igId: conv.telefone, profile });
      if (profile.displayName || profile.username) {
        const newName = profile.displayName || `@${profile.username!.replace(/^@/, "")}`;
        await db.update(conversations).set({
          nome: newName,
          ...(profile.profilePic && !conv.avatar ? { avatar: profile.profilePic } : {}),
        }).where(eq(conversations.id, conv.id));
        try {
          const leadUpd: Record<string, any> = { nome: newName };
          if (profile.username) leadUpd.instagramUsername = `@${profile.username.replace(/^@/, "")}`;
          if (profile.biography) leadUpd.instagramBio = profile.biography;
          await db.update(leads).set(leadUpd).where(
            and(eq(leads.workspaceId, workspaceId), eq(leads.instagramId, conv.telefone))
          );
        } catch {}
        updated++;
      }
    }
    res.json({ ok: true, total: igConvs.length, updated, results });
  } catch (err: any) {
    console.error("[IG Backfill]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default webhookRouter;
