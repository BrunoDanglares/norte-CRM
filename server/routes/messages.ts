import type { Express } from "express";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { randomBytes } from "crypto";
import { storage } from "../storage";
import { insertMessageSchema } from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { parseId, resolveWorkspaceId } from "../utils/helpers";
import { uploadsDir } from "../utils/uploadsDir";
import { dispatchWebhook } from "../services/webhookDispatcher";
import { sendMessage } from "../services/channel-router";
import { broadcastToWorkspace } from '../services/broadcast';
import { moveConversationToAtendimentoHumano } from '../services/suportePipelineService';

const MAX_MSG_CHARS = 4096;

// Bruno 2026-05-19: outbound de mídia (áudio/imagem/documento) do painel chega
// como data URL base64 ("data:audio/webm;base64,..."). Meta Cloud API exige
// link HTTP público — recusa data URL. Fix: persistir o blob em /uploads/ e
// trocar o campo `arquivo` por URL absoluta antes de salvar a msg no banco e
// passar pro channel-router. Mesmo padrão usado pra mídia inbound do canal não-oficial.
function persistDataUrlToUploads(dataUrl: string, hintedExt?: string): { url: string; mimeType: string; buffer: Buffer; filename: string } | null {
  // [AUDIO-DIAG-19/05] Log de entrada sempre — confirma que a versão nova
  // do código está rodando + mostra exatamente o que chegou.
  console.log(`[AUDIO-DIAG-19/05] persistDataUrlToUploads ENTRY: len=${dataUrl?.length || 0} head="${(dataUrl || '').slice(0, 80)}" hintedExt=${hintedExt || '-'}`);

  if (!dataUrl || typeof dataUrl !== "string") {
    console.warn(`[AUDIO-DIAG-19/05] dataUrl não é string: type=${typeof dataUrl}`);
    return null;
  }

  // Bruno 2026-05-19: regex aceita data URLs com codec hints — MediaRecorder
  // em ogg/opus gera `data:audio/ogg;codecs=opus;base64,...`, com dois `;`
  // antes do `base64,`. A regex antiga (/^data:([^;]+);base64,/) só casava
  // mime simples e retornava null pra ogg+codec → todo áudio gravado falhava.
  // `([^,;]+(?:;[^,;]+)*)` captura mime + qualquer número de parâmetros, e
  // `mimeType.split(';')[0]` extrai só o mime puro pra mapear extensão.
  const match = /^data:([^,;]+(?:;[^,;]+)*);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    console.warn(`[AUDIO-DIAG-19/05] regex não casou — preview: "${dataUrl.slice(0, 120)}"`);
    return null;
  }
  const mimeType = match[1].split(";")[0].toLowerCase();
  const b64 = match[2];
  const buffer = Buffer.from(b64, "base64");
  console.log(`[AUDIO-DIAG-19/05] decoded: mime=${mimeType} bufferBytes=${buffer.length}`);
  if (buffer.length < 50) {
    console.warn(`[AUDIO-DIAG-19/05] buffer muito pequeno (${buffer.length}b) — mime=${mimeType}`);
    return null;
  }
  const extFromMime =
    mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("webm") ? "webm"
    : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a"
    : mimeType.includes("mpeg") || mimeType.includes("mp3") ? "mp3"
    : mimeType.includes("png") ? "png"
    : mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg"
    : mimeType.includes("pdf") ? "pdf"
    : null;
  const ext = extFromMime || (hintedExt ? hintedExt.replace(/^\./, "") : "bin");
  // Auditoria 2026-06-20: nome com CSPRNG (randomBytes, 80 bits) em vez de Math.random
  // (~31 bits, não-CSPRNG) — igual à mídia inbound (inboundMedia.ts). /uploads é público,
  // então a imprevisibilidade do nome é a barreira contra adivinhar a URL de um comprovante/boleto.
  const fileName = `out_${Date.now()}_${randomBytes(10).toString("hex")}.${ext}`;
  // Bruno 2026-06-11: fs ops podem lançar (disco cheio, permissão, path) — sem
  // este guard a exceção subia e virava 500 cru. Retorna null → o handler
  // responde 400 "arquivo inválido" estruturado.
  try {
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
  } catch (e: any) {
    console.error(`[AUDIO-DIAG-19/05] persistDataUrlToUploads fs write FALHOU: ${e?.message}`);
    return null;
  }
  return { url: `/uploads/${fileName}`, mimeType, buffer, filename: fileName };
}

function absoluteUrlFromReq(req: any, relativeUrl: string): string {
  if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
  // Bruno 2026-05-19: Meta Cloud API REJEITA URL HTTP — exige HTTPS pública.
  // Em produção atrás de proxy (EasyPanel/Cloudflare), `req.protocol` pode
  // ser "http" se o proxy não setou X-Forwarded-Proto, ou se trust proxy
  // não está habilitado no Express. Força HTTPS quando NODE_ENV=production
  // ou quando o host não é localhost — só permite HTTP em dev local.
  const xfp = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim();
  const reqProto = req.protocol;
  const host = (req.headers["host"] as string) || req.hostname || "";
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/.test(host);
  const isProd = process.env.NODE_ENV === "production";
  const protocol = (xfp || reqProto || (isProd || !isLocal ? "https" : "http"))
    .toLowerCase();
  // Em prod (ou host público) qualquer "http" detectado vira "https" — Meta
  // não consegue baixar HTTP, então URL HTTP em prod é sempre erro.
  const finalProtocol = (isProd || !isLocal) && protocol === "http" ? "https" : protocol;
  return `${finalProtocol}://${host}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;
}

// Schema com limite de caracteres do WhatsApp para texto
const messageBodySchema = insertMessageSchema.omit({ workspaceId: true }).extend({
  texto: z.string().min(1).max(MAX_MSG_CHARS, `Mensagem muito longa (máximo ${MAX_MSG_CHARS} caracteres)`),
});

export function registerMessageRoutes(app: Express) {
  app.get("/api/conversations/:id/messages", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    // clamp da query string: limit gigante = OOM, offset negativo = erro SQL
    const limit = Math.min(Math.max(parseInt(((req.query.limit as string | undefined) as string | undefined) as string) || 100, 1), 500);
    const offset = Math.max(parseInt(((req.query.offset as string | undefined) as string | undefined) as string) || 0, 0);
    const msgs = await storage.getMessages(id, { limit, offset });
    res.json(msgs);
  });

  app.post("/api/conversations/:id/messages", requireAuth, async (req, res) => {
    const conversationId = parseId(((req.params.id as string) as string));
    if (!conversationId) return res.status(400).json({ message: "Invalid ID" });
    // Bruno 2026-06-11: handler inteiro em try/catch. Antes, qualquer exceção
    // async (DB lento/pool esgotado, createMessage, persist de mídia, hiccup de
    // rede com a Meta no /media) virava 500 CRU e o atendente via "Erro ao
    // enviar mensagem" perdendo o texto. Erro era intermitente (conv 2531 Nekt:
    // delivered antes, falha pontual, delivered depois). Agora captura, loga a
    // causa e responde estruturado — o frontend mostra o motivo real.
    try {
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(conversationId, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });

    // [AUDIO-DIAG-19/05] Log inicial do body — confirma o que está chegando.
    // Se NÃO aparecer no log, o servidor está rodando versão antiga do código
    // (tsx watch travado? reiniciar com `npx tsx server/index.ts` ou rebuild).
    console.log(
      `[AUDIO-DIAG-19/05] POST /messages conv=${conversationId} ` +
      `tipo=${req.body?.tipo || '-'} ` +
      `texto.len=${req.body?.texto?.length || 0} ` +
      `arquivo.len=${req.body?.arquivo?.length || 0} ` +
      `arquivo.head="${(req.body?.arquivo || '').slice(0, 50)}" ` +
      `contentLength=${req.headers['content-length'] || '-'}`
    );

    if (req.body.arquivo && typeof req.body.arquivo === "string" && req.body.arquivo.length > 15 * 1024 * 1024) {
      return res.status(413).json({ message: "Arquivo muito grande. Limite de 10MB." });
    }
    const allowedTypes = ["text", "image", "audio", "file", "video", "document"];
    if (req.body.tipo && !allowedTypes.includes(req.body.tipo)) {
      return res.status(400).json({ message: "Tipo de mensagem invalido" });
    }

    // FIX 2B — Guard envio humano (conv #12: "!*" disparava ação indevida).
    // Bruno 2026-06-11: o limite de "< 3 chars" era agressivo demais — bloqueava
    // respostas LEGÍTIMAS de atendente ("ok", "sim", "ss", "👍", "55") com um
    // 400 que o painel exibia como "Erro ao enviar mensagem". Agora bloqueia só
    // strings curtas compostas SÓ de símbolos/pontuação ("!*", "//", "..").
    // Tem letra/número/emoji (qualquer não-ASCII) → passa.
    const isMsgType = !req.body.tipo || req.body.tipo === 'text';
    const agenteField: string | undefined = req.body.agente;
    const isHumanSender = agenteField && agenteField !== 'Banana AI';
    const tTrim = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
    const temConteudoReal = /[a-zà-ÿ0-9]/i.test(tTrim) || /[^\x00-\x7F]/.test(tTrim);
    if (isMsgType && isHumanSender && tTrim.length > 0 && tTrim.length < 3 && !temConteudoReal) {
      console.warn(`[Messages] human_msg_symbols_only_blocked agente="${agenteField}" texto="${req.body.texto}"`);
      return res.status(400).json({ message: "Mensagem inválida (apenas símbolos). Digite algo com texto.", error: "msg_symbols_only" });
    }

    // Converte data URL → arquivo persistido em /uploads/ + URL pública. Meta
    // Cloud API exige link HTTP; data URL é rejeitado. Mantém compat: se já é
    // URL (HTTP ou /uploads/), passa direto.
    let publicMediaUrl: string | null = null;
    // Bruno 2026-05-19: buffer guardado pra fazer upload direto pra Meta
    // (alternativa ao link, resolve localhost em dev e qualquer caso onde URL
    // pública não é alcançável pelos servers da Meta).
    let mediaUploadBuffer: Buffer | null = null;
    let mediaUploadMime: string | null = null;
    let mediaUploadFilename: string | null = null;
    if (req.body.arquivo && typeof req.body.arquivo === "string" && req.body.arquivo.startsWith("data:")) {
      // Bruno 2026-05-19: log de chegada do data URL — mostra tamanho e header
      // pra confirmar que o body-parser não truncou (default 100kb era o bug
      // raiz; já aumentado pra 15mb em index.ts).
      console.log(`[Messages] data URL chegou: len=${req.body.arquivo.length}b head="${req.body.arquivo.slice(0, 60)}" tipo=${req.body.tipo}`);
      const persisted = persistDataUrlToUploads(req.body.arquivo, req.body.nomeArquivo && path.extname(req.body.nomeArquivo));
      if (persisted) {
        publicMediaUrl = absoluteUrlFromReq(req, persisted.url);
        // Substitui o campo `arquivo` por URL relativa no que vai pro banco —
        // evita persistir data URL gigante na tabela messages.
        req.body.arquivo = persisted.url;
        // Guarda buffer pra upload DIRETO pra Meta (preferível ao link).
        mediaUploadBuffer = persisted.buffer;
        mediaUploadMime = persisted.mimeType;
        mediaUploadFilename = req.body.nomeArquivo || persisted.filename;
      } else {
        // Bruno 2026-05-19: antes só logava warn e seguia, persistindo data URL
        // gigante (5MB+) direto na coluna `arquivo` → linha zumbi pesada que
        // o player não conseguia tocar. Agora rejeita explicitamente — frontend
        // mostra toast e desfaz optimistic (não fica msg quebrada no chat).
        console.warn("[Messages] persistDataUrlToUploads failed — arquivo inválido");
        return res.status(400).json({
          message: "Não foi possível processar o arquivo enviado (formato inválido ou corrompido).",
          error: "invalid_data_url",
        });
      }
    } else if (req.body.arquivo && typeof req.body.arquivo === "string") {
      publicMediaUrl = absoluteUrlFromReq(req, req.body.arquivo);
    }

    // Bruno 2026-05-19: replyToMessageId é o ID local da msg que o atendente
    // está citando. Resolvemos o wamid correspondente pra passar no Meta como
    // context.message_id (gera o quote nativo do WhatsApp).
    let replyToMessageId: number | null = null;
    let replyToWamid: string | null = null;
    if (req.body.replyToMessageId) {
      const rid = parseInt(String(req.body.replyToMessageId), 10);
      if (!isNaN(rid)) {
        const { db: dbR } = await import("../db");
        const { messages: msgsR } = await import("@shared/schema");
        const { eq: eqR, and: andR } = await import("drizzle-orm");
        const [original] = await dbR.select().from(msgsR)
          .where(andR(eqR(msgsR.id, rid), eqR(msgsR.workspaceId, wsId)))
          .limit(1);
        if (original) {
          replyToMessageId = original.id;
          replyToWamid = original.externalMessageId || null;
        }
      }
    }

    const data = {
      ...req.body,
      conversationId,
      hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
      ...(replyToMessageId ? { replyToMessageId } : {}),
    };
    const parsed = messageBodySchema.safeParse(data);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const msg = await storage.createMessage({ ...parsed.data, workspaceId: wsId });

    // Bruno 2026-06-12: transcreve o áudio enviado pelo ATENDENTE (outbound) e
    // mostra a transcrição no chat — paridade com o áudio do cliente (inbound).
    // Fire-and-forget: o áudio aparece na hora; a transcrição entra um instante
    // depois via message_updated (o front renderiza "📝 {texto}" quando o texto
    // não é placeholder "[Audio ...]"). Tenant-keyed (sem chave → no-op gracioso).
    if (data.direction === "out" && req.body.tipo === "audio"
        && typeof req.body.arquivo === "string" && req.body.arquivo) {
      const _audioUrl = req.body.arquivo;
      const _audioMime = mediaUploadMime || undefined;
      (async () => {
        try {
          const { transcribeAudioDirect } = await import("../services/automationEngine");
          const transcript = ((await transcribeAudioDirect(_audioUrl, undefined, _audioMime, wsId)) || "").trim();
          if (!transcript) return;
          const { db: dbT } = await import("../db");
          const { messages: msgsT, conversations: convsT } = await import("@shared/schema");
          const { eq: eqT, and: andT } = await import("drizzle-orm");
          await dbT.update(msgsT).set({ texto: transcript })
            .where(andT(eqT(msgsT.id, msg.id), eqT(msgsT.workspaceId, wsId)));
          broadcastToWorkspace(wsId, "message_updated", {
            conversationId, messageId: msg.id, updates: { texto: transcript },
          });
          // Atualiza o preview do inbox pra mostrar a transcrição (em vez de "[Áudio]").
          await dbT.update(convsT).set({ ultimaMensagem: transcript })
            .where(andT(eqT(convsT.id, conversationId), eqT(convsT.workspaceId, wsId))).catch(() => {});
          console.log(`[Messages] 🎤 áudio do atendente transcrito (msg ${msg.id}): "${transcript.slice(0, 80)}"`);
        } catch (e: any) {
          console.warn(`[Messages] transcrição do áudio do atendente falhou (msg ${msg.id}): ${e?.message}`);
        }
      })();
    }

    try {
      const { db: dbUp } = await import("../db");
      const { conversations: convTable } = await import("@shared/schema");
      const { eq: eqUp, and: andUp } = await import("drizzle-orm");
      await dbUp.update(convTable).set({
        ultimaMensagem: msg.texto,
        tempo: "agora",
        updatedAt: new Date(),
      }).where(andUp(eqUp(convTable.id, conversationId), eqUp(convTable.workspaceId, wsId)));
    } catch (e: any) { console.error("[Messages] conversation update failed:", e.message); }
    if (data.direction === "out") {
      const senderName = (req as any).user?.nome;
      const senderId: number | undefined = (req as any).user?.id;
      if (senderName && conv.agente !== senderName) {
        try {
          const { db: dbAssign } = await import("../db");
          const { conversations: convAssign } = await import("@shared/schema");
          const { eq: eqAssign, and: andAssign } = await import("drizzle-orm");
          await dbAssign.update(convAssign).set({ agente: senderName }).where(andAssign(eqAssign(convAssign.id, conversationId), eqAssign(convAssign.workspaceId, wsId)));
          broadcastToWorkspace(wsId, "conversation_updated", { id: conversationId, agente: senderName });
        } catch (e: any) { console.error("[Messages] auto-assign failed:", e.message); }
      }
      dispatchWebhook("message.sent", { conversa: conv, mensagem: msg }, wsId).catch(() => {});

      // Quando atendente humano envia mensagem → move kanban para "Atendimento Humano" do setor
      // Só executa quando há senderName (humano autenticado), não para mensagens de bot
      const convPipeline = (conv as any).pipeline || null;
      const senderUserId: number | undefined = (req as any).user?.id;
      if (senderName && convPipeline) {
        moveConversationToAtendimentoHumano({
          workspaceId: wsId,
          conversationId,
          phone: (conv as any).telefone || (conv as any).phone || conv.nome || '',
          contactName: conv.nome || '',
          pipeline: convPipeline,
          triggerUserId: senderUserId,
        }).catch((e: any) => console.error('[Messages] moveToAtendimentoHumano failed:', e.message));
      }

      let phone = (conv as any).telefone || (conv as any).phone || "";
      if (!phone) {
        const allLeads = await storage.getLeads(wsId, { limit: 10000 });
        const matchedLead = allLeads.find((l: any) => l.nome === conv.nome || l.telefone === conv.nome);
        phone = matchedLead?.telefone || conv.nome;
      }
      const isInstagram = (conv as any).canal?.toLowerCase() === "instagram";
      const isLidPhone = phone.includes("@lid");
      if (phone && (isInstagram || isLidPhone || /\d{8,}/.test(phone.replace(/\D/g, "")))) {
        let targetConexaoId: string | undefined = undefined;
        if (conv.conexaoId) {
          if (isInstagram) {
            const { instagramConnections } = await import("@shared/schema");
            const { db: dbIg } = await import("../db");
            const { eq: eqIg, and: andIg } = await import("drizzle-orm");
            const [igConn] = await dbIg.select().from(instagramConnections)
              .where(andIg(eqIg(instagramConnections.id, conv.conexaoId), eqIg(instagramConnections.workspaceId, wsId)))
              .limit(1);
            if (igConn) targetConexaoId = igConn.id;
          }
          if (!targetConexaoId) {
            const conexoesList = await storage.getConexoes(wsId);
            const found = conexoesList.find((c: any) => c.id === conv.conexaoId && c.status === "connected");
            if (found) targetConexaoId = found.id;
          }
        }
        if (isInstagram && !targetConexaoId) {
          const { instagramConnections } = await import("@shared/schema");
          const { db: dbIg } = await import("../db");
          const { eq: eqIg } = await import("drizzle-orm");
          const [igConn] = await dbIg.select().from(instagramConnections)
            .where(eqIg(instagramConnections.workspaceId, wsId))
            .limit(1);
          if (igConn) targetConexaoId = igConn.id;
        }
        try {
          const outText = msg.agente ? `*${msg.agente}:*\n${msg.texto}` : msg.texto;
          const msgType = req.body.tipo || "text";
          const sendParams: any = {
            workspaceId: wsId,
            to: phone,
            type: msgType,
            content: outText,
            conversationId: conv.id,
          };
          // Bruno 2026-05-19: replyToWamid (calculado no início do handler)
          // vai como context.message_id no Meta → cliente vê o quote nativo.
          if (replyToWamid) sendParams.replyToMessageId = replyToWamid;
          if (targetConexaoId) sendParams.conexaoId = targetConexaoId;
          if (msgType !== "text" && (publicMediaUrl || req.body.arquivo)) {
            // Meta Cloud API exige URL HTTP absoluta — passa publicMediaUrl
            // calculado acima (já absolute). Fallback pra `req.body.arquivo`
            // só pra casos onde URL veio relativa e o helper não rodou.
            sendParams.mediaUrl = publicMediaUrl || absoluteUrlFromReq(req, req.body.arquivo);
            sendParams.filename = req.body.nomeArquivo || req.body.arquivoNome;
            // Bruno 2026-05-19: voice:true só funciona com ogg/opus, que a Meta
            // recusou aceitar via ffmpeg-static no Windows. Mantemos AAC =
            // áudio entregue como arquivo. Voice note nativo pode ser revisto
            // em ambiente de produção (Linux + ffmpeg do apt).

            // Bruno 2026-05-19: SE temos buffer (data URL recém-chegada do
            // painel) E a conv é Meta Cloud (não Instagram, não Evolution), faz
            // upload DIRETO pra Meta /media e usa `mediaId`. Isso resolve o
            // erro 131053 ("Media upload error: Downloading from weblink
            // failed http 403") que Meta dá quando não consegue baixar
            // localhost OU qualquer URL HTTP em prod. mediaId tem precedência
            // sobre mediaUrl no channel-router.
            if (mediaUploadBuffer && mediaUploadMime && !isInstagram) {
              try {
                const { whatsappOfficialConnections } = await import("@shared/schema");
                const { db: dbMeta } = await import("../db");
                const { eq: eqMeta } = await import("drizzle-orm");
                const [metaConn] = await dbMeta.select()
                  .from(whatsappOfficialConnections)
                  .where(eqMeta(whatsappOfficialConnections.workspaceId, wsId))
                  .limit(1);
                if (metaConn?.phoneNumberId && metaConn?.accessToken) {
                  let bufferToSend = mediaUploadBuffer;
                  let mimeToSend = mediaUploadMime;
                  let filenameToSend = mediaUploadFilename;

                  // Bruno 2026-05-19: pra ÁUDIO, converter sempre pra
                  // audio/ogg+opus via ffmpeg ANTES do upload. Browsers
                  // (Chrome/Edge desktop) gravam em audio/mp4+opus que a Meta
                  // rejeita com erro 131053 ("type is application/octet-stream").
                  // ogg+opus é o formato natural pra voz aceito pela Meta.
                  if (msgType === "audio") {
                    try {
                      const { convertToOggOpus } = await import("../utils/audioConvert");
                      const tConv = Date.now();
                      const converted = await convertToOggOpus(mediaUploadBuffer);
                      bufferToSend = converted.buffer;
                      mimeToSend = converted.mimeType;
                      filenameToSend = `audio.${converted.extension}`;
                      console.log(`[AUDIO-DIAG-19/05] ffmpeg convert OK: in=${mediaUploadBuffer.length}b/${mediaUploadMime} → out=${bufferToSend.length}b/${mimeToSend} ms=${Date.now() - tConv}`);
                    } catch (convErr: any) {
                      console.warn(`[AUDIO-DIAG-19/05] ffmpeg convert FALHOU: ${convErr.message} — tentando upload sem converter`);
                    }
                  }

                  const { uploadMediaToMeta } = await import("../services/meta-whatsapp");
                  const tUp = Date.now();
                  const { mediaId } = await uploadMediaToMeta({
                    phoneNumberId: metaConn.phoneNumberId,
                    accessToken: metaConn.accessToken,
                    buffer: bufferToSend,
                    mimeType: mimeToSend,
                    filename: filenameToSend || undefined,
                  });
                  sendParams.mediaId = mediaId;
                  console.log(`[AUDIO-DIAG-19/05] Meta /media upload OK: mediaId=${mediaId} mime=${mimeToSend} bytes=${bufferToSend.length} ms=${Date.now() - tUp}`);
                }
              } catch (upErr: any) {
                // Falha NÃO bloqueia — cai no fallback `mediaUrl` (vai falhar
                // em dev local mas funciona em prod).
                console.warn(`[AUDIO-DIAG-19/05] Meta /media upload falhou — fallback mediaUrl: ${upErr.message}`);
              }
            }
          }
          const sendResult = await sendMessage(sendParams);
          if (!sendResult.success) {
            if (sendResult.error?.startsWith("WINDOW_CLOSED")) {
              return res.status(422).json({
                error: "window_closed",
                message: "Janela de 24h encerrada. Use um template para retomar a conversa.",
              });
            }
            // Bruno 2026-05-19: retorna 422 também pra falha de mídia (formato
            // rejeitado pela Meta, URL inacessível, etc). Sem isso, atendente
            // enviava áudio webm → Meta rejeitava → cliente não recebia → mas
            // backend retornava 200 e o painel não dava feedback. Mensagem
            // permanece salva (frontend trata 422 sem desfazer optimistic).
            const isMediaFailure = msgType !== "text";
            if (isMediaFailure) {
              // Marca status=failed na linha persistida — sem isso, ao recarregar
              // a página a msg aparece como "sent" apesar da entrega ter falhado.
              try {
                const { db: dbF } = await import("../db");
                const { messages: msgsTblF } = await import("@shared/schema");
                const { eq: eqF } = await import("drizzle-orm");
                await dbF
                  .update(msgsTblF)
                  .set({ status: "failed" })
                  .where(eqF(msgsTblF.id, msg.id));
                broadcastToWorkspace(wsId, "message_updated", {
                  conversationId: conv.id,
                  messageId: msg.id,
                  updates: { status: "failed" },
                });
              } catch (statusErr: any) {
                console.warn("[Messages] mark failed status failed:", statusErr.message);
              }
              return res.status(422).json({
                error: "media_send_failed",
                message: `Não foi possível entregar o ${msgType} ao cliente. Verifique o formato/tamanho.`,
                detail: sendResult.error,
              });
            }
            console.error("[Inbox] Falha ao enviar mensagem:", sendResult.error);
          } else if (sendResult.messageId) {
            // Persiste o wamid retornado pela Meta na msg já salva, pra que o
            // webhook de status (delivered/read) consiga encontrar essa linha e
            // atualizar os tracinhos no painel. Sem isso o outbound do atendente
            // fica preso em "sent" pra sempre.
            try {
              const { db: dbExt } = await import("../db");
              const { messages: msgsTbl } = await import("@shared/schema");
              const { eq: eqExt } = await import("drizzle-orm");
              await dbExt
                .update(msgsTbl)
                .set({ externalMessageId: sendResult.messageId })
                .where(eqExt(msgsTbl.id, msg.id));
            } catch (e: any) {
              console.warn("[Messages] persist externalMessageId failed:", e.message);
            }
          }
        } catch (e) {
          console.error("[Inbox] Falha ao enviar mensagem:", e);
        }

        // Bruno 2026-06-08: REABRE conversa resolvida quando o atendente responde.
        // O POST /messages nunca mexia em `status` → o outbound não tirava a conv
        // de "Encerrados" (valia pros DOIS canais; no canal não-oficial ficou mais
        // visível porque o inbound dele reabre e o do Meta cria conv nova). Reabre só a
        // nível de status/atribuição — NÃO reseta CPF/sessão ISP nem religa o bot
        // (o humano está conduzindo). Channel-agnostic.
        //
        // Bruno 2026-07-15: TAKEOVER automático em QUALQUER conversa (não só na
        // resolvida). Antes, responder numa conversa ABERTA não assumia nem pausava →
        // o bot seguia respondendo POR CIMA do atendente. Agora responder = assume +
        // aiPaused na hora (sai de "Automação" e entra em "Em Andamento"). Espelha o
        // "ponto firme" do /send-template: NÃO rouba conversa de outro atendente ativo.
        if (senderName && agenteField !== "Banana AI") {
          try {
            const { db: dbReopen } = await import("../db");
            const { conversations: convReopen } = await import("@shared/schema");
            const { eq: eqRe, and: andRe } = await import("drizzle-orm");
            const wasResolved = String((conv as any).status || "").toLowerCase() === "resolved";
            // Conversa resolvida guarda o assignedUserId do atendimento ANTERIOR — não
            // é dono ativo. Só respeita "dono diferente" se a conversa estiver ativa.
            const ownedByOther = !wasResolved
              && !!(conv as any).assignedUserId
              && (conv as any).assignedUserId !== (senderId ?? null);
            const assignFields: Record<string, any> = ownedByOther ? {} : {
              assignedUserId: senderId ?? (conv as any).assignedUserId ?? null,
              assignedUserName: senderName,
              aiPaused: true,   // tira a conversa do alcance do bot
              pendente: false,
            };
            const reopenFields: Record<string, any> = wasResolved
              ? { status: "open", resolvedAt: null }
              : {};
            if (Object.keys(assignFields).length || Object.keys(reopenFields).length) {
              await dbReopen.update(convReopen).set({
                ...reopenFields,
                ...assignFields,
                updatedAt: new Date(),
              }).where(andRe(eqRe(convReopen.id, conversationId), eqRe(convReopen.workspaceId, wsId)));
              broadcastToWorkspace(wsId, "conversation_updated", {
                id: conversationId,
                ...(wasResolved ? { status: "open" } : {}),
                ...(Object.keys(assignFields).length ? {
                  pendente: false,
                  aiPaused: true,
                  assigned_user_id: senderId ?? (conv as any).assignedUserId ?? null,
                  assigned_user_name: senderName,
                } : {}),
              });
              console.log(
                `[Messages] conv=${conversationId} outbound de ${senderName}` +
                `${wasResolved ? " → REABERTA" : ""}` +
                `${ownedByOther ? " — dono diferente, não assumiu" : " → assumida + aiPaused (bot pausado)"}`,
              );
            }
          } catch (eRe: any) {
            console.warn("[Messages] takeover on outbound falhou:", eRe?.message);
          }
        }
      }
    }
    // Bruno 2026-05-19: payload completo no broadcast — antes faltavam
    // `tipo`, `arquivo`, `nomeArquivo` e `agente`, fazendo outros atendentes
    // que estavam com a conv aberta receberem o áudio/imagem/doc SEM player
    // (cache do WS sobrescrevia a versão completa que ainda não chegou via
    // HTTP). Caso real Bruno 2026-05-19: áudio sumia do chat e renderizava
    // como "Audio recebido" sem player.
    broadcastToWorkspace(wsId, "new_message", {
      conversationId: conv.id,
      conversation: {
        id: conv.id,
        ultimaMensagem: msg.texto,
      },
      message: {
        id: msg.id,
        conversationId: msg.conversationId,
        texto: msg.texto,
        direction: msg.direction,
        tipo: msg.tipo,
        arquivo: msg.arquivo,
        nomeArquivo: msg.nomeArquivo,
        agente: msg.agente,
        hora: msg.hora,
        status: msg.status,
        externalMessageId: msg.externalMessageId,
        protocoloId: msg.protocoloId,
        createdAt: msg.createdAt,
      },
    });
    res.status(201).json(msg);
    } catch (err: any) {
      // Bruno 2026-06-11: rede de segurança do handler. Loga stack completo
      // (pra diagnóstico no painel EasyPanel → Logs) e responde de forma
      // estruturada em vez de 500 cru. `headersSent` evita duplicar resposta
      // caso a exceção tenha ocorrido após algum `res` já ter sido enviado.
      console.error(`[Messages] POST /messages handler exception conv=${conversationId}:`, err?.stack || err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({
          message: "Não consegui processar o envio agora. Tente novamente em instantes.",
          error: "send_handler_exception",
        });
      }
    }
  });

  // ── POST /api/conversations/:id/send-template — inicia atendimento com HSM ──
  // Bruno 2026-06-24: o modal "Novo atendimento" mandava o template via
  // /api/disparos-programados (caminho de CAMPANHA em massa). Aquele caminho
  // só envia ~1min depois (cron) e — pior — o channel-router NÃO persiste a
  // mensagem na conversa, NÃO cria protocolo e NÃO faz broadcast. Resultado:
  // o template nunca aparecia no chat e nenhum protocolo novo nascia (a conversa
  // mostrava só o histórico do último protocolo). Este endpoint envia o template
  // NA HORA (Meta), persiste a mensagem renderizada na conversa amarrada a um
  // protocolo NOVO (separador no chat = início do atendimento) e faz broadcast —
  // exatamente como um outbound de texto livre, mas via HSM (fura janela 24h).
  app.post("/api/conversations/:id/send-template", requireAuth, async (req, res) => {
    const conversationId = parseId((req.params.id as string));
    if (!conversationId) return res.status(400).json({ message: "Invalid ID" });
    try {
      const wsId = await resolveWorkspaceId(req);
      const conv = await storage.getConversation(conversationId, wsId);
      if (!conv) return res.status(404).json({ message: "Conversa não encontrada" });

      const phone = String((conv as any).telefone || "").replace(/\D/g, "");
      if (!phone) return res.status(400).json({ message: "Conversa sem telefone — não dá pra enviar template." });

      const { templateName, templateLanguage, templateVariables } = req.body || {};
      if (!templateName) return res.status(400).json({ message: "Selecione um template aprovado" });

      const { db } = await import("../db");
      const { whatsappOfficialConnections, whatsappMessageTemplates, conversations: convsTbl } = await import("@shared/schema");
      const { and, eq, inArray, desc } = await import("drizzle-orm");

      // Template só vai pela Meta (HSM). Exige conexão oficial ativa.
      const [metaConn] = await db.select().from(whatsappOfficialConnections)
        .where(and(eq(whatsappOfficialConnections.workspaceId, wsId), eq(whatsappOfficialConnections.status, "active"))).limit(1);
      if (!metaConn) return res.status(400).json({ message: "Disparo por template exige conexão WhatsApp API Oficial (Meta) ativa." });

      const lang = templateLanguage || "pt_BR";
      const [tpl] = await db.select().from(whatsappMessageTemplates)
        .where(and(
          eq(whatsappMessageTemplates.workspaceId, wsId),
          eq(whatsappMessageTemplates.templateName, templateName),
          eq(whatsappMessageTemplates.language, lang),
        )).limit(1);
      if (!tpl) return res.status(400).json({ message: "Template não encontrado nesse idioma." });
      if (String(tpl.status).toUpperCase() !== "APPROVED") return res.status(400).json({ message: "O template selecionado não está aprovado pela Meta." });

      const need = tpl.variablesCount || 0;
      const normVars: Array<{ index: number; kind: string; value: string }> = Array.isArray(templateVariables) ? templateVariables : [];
      if (normVars.length !== need) return res.status(400).json({ message: `Este template tem ${need} variável(eis) — preencha todas.` });
      for (const v of normVars) {
        if (!v || (v.kind !== "token" && v.kind !== "fixed") || !String(v.value ?? "").trim()) {
          return res.status(400).json({ message: "Preencha todas as variáveis do template." });
        }
      }

      // Monta os components (Meta) + resolve tokens (ex: {{nome}}, valor ERP).
      const { resolveTokens, extractMapTokens, buildTemplateComponents } = await import("../services/disparo-vars");
      const resolved = await resolveTokens(wsId, { contactName: conv.nome || "", phoneNumber: phone }, extractMapTokens(normVars as any));
      const components = buildTemplateComponents(normVars as any, resolved);

      // Texto renderizado pro chat: troca {{N}} no corpo do template pelos
      // valores dos parâmetros (na ordem). É o que o cliente vê no WhatsApp.
      const bodyParams: string[] = ((components.find((c: any) => c.type === "body")?.parameters) || []).map((p: any) => p.text);
      const renderedBody = String(tpl.bodyText || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (full, n) => {
        const idx = parseInt(n, 10) - 1;
        return bodyParams[idx] !== undefined ? bodyParams[idx] : full;
      });

      // 1) Envia o template AGORA (Meta). Sem conexaoId → channel-router roteia
      // pela conexão oficial ativa (template não vale no Evolution).
      const sendResult = await sendMessage({
        workspaceId: wsId,
        to: phone,
        type: "template",
        templateName,
        templateLanguage: lang,
        templateComponents: components,
      });
      if (!sendResult.success) {
        console.error(`[send-template] conv=${conversationId} falha:`, sendResult.error);
        return res.status(422).json({ message: sendResult.error || "Falha ao enviar o template pela Meta.", error: "template_send_failed" });
      }

      // 2) Abre/usa protocolo do atendimento. Se já houver um ATIVO (atendimento
      // em curso), reusa; senão cria um NOVO — nunca reabre protocolo fechado
      // (era a causa do "histórico do protocolo antigo voltar" no chat).
      let protocoloId: string | null = null;
      try {
        const { protocols } = await import("@shared/schema");
        const [active] = await db.select({ id: protocols.id }).from(protocols)
          .where(and(
            eq(protocols.workspaceId, wsId),
            eq(protocols.conversationId, conversationId),
            inArray(protocols.status, ["aberto", "em_andamento"]),
          ))
          .orderBy(desc(protocols.createdAt))
          .limit(1);
        if (active) {
          protocoloId = String(active.id);
        }
      } catch (eP: any) {
        console.warn(`[send-template] protocolo (non-fatal) conv=${conversationId}:`, eP?.message);
      }

      // 3) Persiste a mensagem do template na conversa (vinculada ao protocolo)
      // pra aparecer no chat como o outbound que abre o atendimento.
      const senderName = (req as any).user?.nome || null;
      const { insertMessageWithProtocol } = await import("../utils/messageInsert");
      const msg = await insertMessageWithProtocol({
        conversationId,
        workspaceId: wsId,
        direction: "out",
        tipo: "text",
        texto: renderedBody || `Template: ${templateName}`,
        agente: senderName,
        status: "sent",
        hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        externalMessageId: sendResult.messageId || null,
        ...(protocoloId ? { protocoloId } : {}),
      } as any);

      // 4) Atualiza a conversa: preview + reabre + CRAVA a atribuição ao
      // atendente que iniciou. Garante que o atendimento nasce direto em
      // "Em Andamento" e NUNCA em "Automação" (coluna = sem dono + IA ativa).
      // O /assume do modal é best-effort (pode falhar por guard de equipe/409),
      // então é AQUI o ponto firme: assignedUserId + nome humano + aiPaused +
      // pendente=false. Se a conversa já tem dono DIFERENTE (assumida por outro),
      // respeita — não rouba (mantém o atendimento de quem já estava nela).
      const meId = (req as any).user?.id ?? null;
      const meName = senderName || "Atendente";
      // Conversa resolvida guarda o assignedUserId como snapshot do atendimento
      // ANTERIOR — não é dono ativo. Só respeita "dono diferente" se a conversa
      // estiver ativa (alguém atendendo agora); senão, quem iniciou assume.
      const wasResolved = String((conv as any).status || "").toLowerCase() === "resolved";
      const ownedByOther = !wasResolved && !!(conv as any).assignedUserId && (conv as any).assignedUserId !== meId;
      const assignFields = ownedByOther ? {} : {
        assignedUserId: meId,
        assignedUserName: meName,
        aiPaused: true,   // tira a conversa do alcance do bot
        pendente: false,
      };
      try {
        await db.update(convsTbl).set({
          ultimaMensagem: msg.texto,
          tempo: "agora",
          status: "open",
          resolvedAt: null,
          ...assignFields,
          updatedAt: new Date(),
        }).where(and(eq(convsTbl.id, conversationId), eq(convsTbl.workspaceId, wsId)));
      } catch (eU: any) { console.warn(`[send-template] conv update (non-fatal):`, eU?.message); }

      // 5) Broadcast — chat mostra a mensagem na hora + card vai pra "Em Andamento".
      // Chave `conversationId` (é a que o handler do inbox lê) + atribuição, pra
      // a coluna atualizar ao vivo sem esperar refetch.
      broadcastToWorkspace(wsId, "new_message", {
        conversationId,
        conversation: { id: conversationId, ultimaMensagem: msg.texto },
        message: {
          id: msg.id,
          conversationId: msg.conversationId,
          texto: msg.texto,
          direction: msg.direction,
          tipo: msg.tipo,
          agente: msg.agente,
          hora: msg.hora,
          status: msg.status,
          externalMessageId: msg.externalMessageId,
          protocoloId: msg.protocoloId,
          createdAt: msg.createdAt,
        },
      });
      broadcastToWorkspace(wsId, "conversation_updated", {
        conversationId,
        status: "open",
        ...(ownedByOther ? {} : {
          assigned_user_id: meId,
          assigned_user_name: meName,
          pendente: false,
        }),
      });

      return res.status(201).json({ ok: true, messageId: msg.id, protocoloId, channel: sendResult.channel });
    } catch (err: any) {
      console.error(`[send-template] handler exception conv=${conversationId}:`, err?.stack || err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Não consegui iniciar o atendimento por template agora. Tente novamente." });
      }
    }
  });

  // ── DELETE /api/messages/:id — soft delete (opcionalmente apagar pra todos) ──
  // Bruno 2026-05-19: atendente exclui mensagem do painel CRM.
  //   - Sempre: soft-delete local (deleted_at + deleted_by_user_id). UI mostra
  //     "Mensagem excluída". Histórico preservado pra auditoria.
  //   - Body `forEveryone: true`: TENTA editar no Meta substituindo o texto
  //     por "_Esta mensagem foi removida_". Só funciona pra:
  //       (a) outbound (não dá pra editar msg do cliente),
  //       (b) tipo=text (Meta não permite editar mídia),
  //       (c) janela <15min (limite da Meta API),
  //       (d) canal Meta Cloud (não Evolution/Instagram).
  //     Se algum critério falhar OU Meta rejeitar, retorna soft-delete OK +
  //     warning (msg some do painel mas continua no celular do cliente).
  //     Meta NÃO tem endpoint público de DELETE — edit é o caminho mais próximo.
  app.delete("/api/messages/:id", requireAuth, async (req, res) => {
    const msgId = parseId(req.params.id as string);
    if (!msgId) return res.status(400).json({ message: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);
    const userId = (req as any).user?.id || null;
    const forEveryone = req.body?.forEveryone === true || req.query?.forEveryone === "true";

    const { db } = await import("../db");
    const { messages: msgsTbl, conversations: convsTbl } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    const [msg] = await db.select().from(msgsTbl)
      .where(and(eq(msgsTbl.id, msgId), eq(msgsTbl.workspaceId, wsId)))
      .limit(1);
    if (!msg) return res.status(404).json({ message: "Mensagem não encontrada" });
    if ((msg as any).deletedAt) return res.status(409).json({ message: "Mensagem já excluída" });

    let forEveryoneResult: { ok: boolean; reason?: string } = { ok: false, reason: "not_attempted" };

    if (forEveryone) {
      // Pré-checagens. Falhas aqui NÃO bloqueiam o soft-delete local.
      const isOutMsg = msg.direction === "out";
      const isTextMsg = !msg.tipo || msg.tipo === "text";
      const ageMs = msg.createdAt ? Date.now() - new Date(msg.createdAt).getTime() : Infinity;
      const inWindow = ageMs < 15 * 60 * 1000;
      const hasWamid = !!msg.externalMessageId;

      if (!isOutMsg) forEveryoneResult = { ok: false, reason: "only_outbound" };
      else if (!isTextMsg) forEveryoneResult = { ok: false, reason: "only_text" };
      else if (!inWindow) forEveryoneResult = { ok: false, reason: "window_expired" };
      else if (!hasWamid) forEveryoneResult = { ok: false, reason: "no_external_id" };
      else {
        try {
          const [conv] = await db.select().from(convsTbl)
            .where(and(eq(convsTbl.id, msg.conversationId), eq(convsTbl.workspaceId, wsId)))
            .limit(1);
          const phone = (conv as any)?.telefone?.replace(/\D/g, "") || "";
          if (!phone) {
            forEveryoneResult = { ok: false, reason: "no_phone" };
          } else {
            const { whatsappOfficialConnections } = await import("@shared/schema");
            const [metaConn] = await db.select().from(whatsappOfficialConnections)
              .where(eq(whatsappOfficialConnections.workspaceId, wsId))
              .limit(1);
            if (!metaConn?.phoneNumberId || !metaConn?.accessToken) {
              forEveryoneResult = { ok: false, reason: "no_meta_connection" };
            } else {
              const { editTextMessage } = await import("../services/meta-whatsapp");
              await editTextMessage({
                phoneNumberId: metaConn.phoneNumberId,
                accessToken: metaConn.accessToken,
                to: phone,
                text: "_Esta mensagem foi removida_",
                originalMessageId: msg.externalMessageId!,
              });
              forEveryoneResult = { ok: true };
            }
          }
        } catch (err: any) {
          console.warn(`[Messages] forEveryone edit Meta falhou msg=${msgId}: ${err.message}`);
          forEveryoneResult = { ok: false, reason: `meta_error: ${err.message?.slice(0, 100)}` };
        }
      }
    }

    await db.update(msgsTbl).set({
      deletedAt: new Date(),
      deletedByUserId: userId,
    } as any).where(eq(msgsTbl.id, msgId));

    broadcastToWorkspace(wsId, "message_updated", {
      conversationId: msg.conversationId,
      messageId: msgId,
      updates: { deletedAt: new Date().toISOString(), deletedByUserId: userId },
    });

    res.json({ ok: true, forEveryone: forEveryoneResult });
  });

  // ── POST /api/conversations/:id/send-contact — enviar vCard ────────────────
  // Bruno 2026-05-21: atendente envia contato selecionado do picker. Body:
  //   { contacts: [{ name, phones: [{number}], emails?: [...], organization? }] }
  // Persiste em messages com tipo='contact' + mediaMetadata estruturada.
  app.post("/api/conversations/:id/send-contact", requireAuth, async (req, res) => {
    try {
      const conversationId = parseId(req.params.id as string);
      if (!conversationId) return res.status(400).json({ message: "Invalid ID" });
      const wsId = await resolveWorkspaceId(req);
      const conv = await storage.getConversation(conversationId, wsId);
      if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });

      const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
      if (!contacts.length || !contacts[0]?.phones?.length) {
        return res.status(400).json({ message: "Pelo menos 1 contato com telefone é obrigatório" });
      }

      // Texto humanizado pra fallback (preview no card + clients sem render rico)
      const firstName = contacts[0].name || contacts[0].phones[0].number;
      const firstPhone = contacts[0].phones[0].number;
      const extra = contacts.length > 1 ? ` +${contacts.length - 1}` : "";
      const texto = `📇 ${firstName} (${firstPhone})${extra}`;

      const sendResult = await sendMessage({
        workspaceId: wsId,
        to: conv.telefone || "",
        type: "contact",
        contacts,
        conversationId,
      });

      if (!sendResult.success) {
        return res.status(502).json({ message: sendResult.error || "Falha ao enviar contato" });
      }

      const insertedMsg = await storage.createMessage({
        conversationId,
        direction: "out",
        texto,
        tipo: "contact",
        mediaMetadata: { contacts },
        hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        status: "sent",
        workspaceId: wsId,
        externalMessageId: sendResult.messageId || null,
        agente: (req.user as any)?.nome || "Atendente",
      } as any);

      broadcastToWorkspace(wsId, "new_message", { conversationId, message: insertedMsg });
      // Atualiza preview do card
      const { conversations: convsT } = await import("@shared/schema");
      const { db: dbU } = await import("../db");
      const { eq: eqU } = await import("drizzle-orm");
      await dbU.update(convsT).set({ ultimaMensagem: texto, updatedAt: new Date() }).where(eqU(convsT.id, conversationId)).catch(() => {});
      broadcastToWorkspace(wsId, "conversation_updated", { conversationId, ultimaMensagem: texto, tempo: "agora" });

      return res.json({ ok: true, message: insertedMsg });
    } catch (err: any) {
      console.error("[send-contact]", err);
      return res.status(500).json({ message: "Erro interno" });
    }
  });

  // ── POST /api/conversations/:id/send-location — enviar localização ─────────
  // Bruno 2026-05-21: atendente envia localização selecionada no mapa.
  // Body: { latitude, longitude, name?, address? }
  app.post("/api/conversations/:id/send-location", requireAuth, async (req, res) => {
    try {
      const conversationId = parseId(req.params.id as string);
      if (!conversationId) return res.status(400).json({ message: "Invalid ID" });
      const wsId = await resolveWorkspaceId(req);
      const conv = await storage.getConversation(conversationId, wsId);
      if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });

      const lat = parseFloat(req.body?.latitude);
      const lng = parseFloat(req.body?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ message: "latitude/longitude inválidos" });
      }
      const name = typeof req.body?.name === "string" ? req.body.name.slice(0, 80) : undefined;
      const address = typeof req.body?.address === "string" ? req.body.address.slice(0, 200) : undefined;

      const labelParts = [name, address].filter(Boolean);
      const texto = labelParts.length > 0
        ? `📍 ${labelParts.join(" — ")}`
        : `📍 Localização (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

      const sendResult = await sendMessage({
        workspaceId: wsId,
        to: conv.telefone || "",
        type: "location",
        location: { latitude: lat, longitude: lng, name, address },
        conversationId,
      });

      if (!sendResult.success) {
        return res.status(502).json({ message: sendResult.error || "Falha ao enviar localização" });
      }

      const insertedMsg = await storage.createMessage({
        conversationId,
        direction: "out",
        texto,
        tipo: "location",
        mediaMetadata: { latitude: lat, longitude: lng, name: name || null, address: address || null },
        hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
        status: "sent",
        workspaceId: wsId,
        externalMessageId: sendResult.messageId || null,
        agente: (req.user as any)?.nome || "Atendente",
      } as any);

      broadcastToWorkspace(wsId, "new_message", { conversationId, message: insertedMsg });
      const { conversations: convsT } = await import("@shared/schema");
      const { db: dbU } = await import("../db");
      const { eq: eqU } = await import("drizzle-orm");
      await dbU.update(convsT).set({ ultimaMensagem: texto, updatedAt: new Date() }).where(eqU(convsT.id, conversationId)).catch(() => {});
      broadcastToWorkspace(wsId, "conversation_updated", { conversationId, ultimaMensagem: texto, tempo: "agora" });

      return res.json({ ok: true, message: insertedMsg });
    } catch (err: any) {
      console.error("[send-location]", err);
      return res.status(500).json({ message: "Erro interno" });
    }
  });

  // ── PATCH /api/messages/:id — editar texto outbound ───────────────────────
  // Bruno 2026-05-19: edita texto de mensagem outbound. Salva original_texto
  // pra auditoria + edited_at. UI mostra "(editada)" embaixo. Janela: 15min
  // pós-envio. Inbound NÃO pode editar. Mídia NÃO pode editar.
  // NÃO propaga pra Meta — Cloud API só permite editar via endpoint dedicado
  // que exige biz_opaque_callback_data; implementação local-only por simplicidade.
  app.patch("/api/messages/:id", requireAuth, async (req, res) => {
    const msgId = parseId(req.params.id as string);
    if (!msgId) return res.status(400).json({ message: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);

    const { texto: novoTexto } = req.body || {};
    if (!novoTexto || typeof novoTexto !== "string" || !novoTexto.trim()) {
      return res.status(400).json({ message: "Texto obrigatório" });
    }
    if (novoTexto.length > MAX_MSG_CHARS) {
      return res.status(400).json({ message: `Texto excede ${MAX_MSG_CHARS} chars` });
    }

    const { db } = await import("../db");
    const { messages: msgsTbl } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    const [msg] = await db.select().from(msgsTbl)
      .where(and(eq(msgsTbl.id, msgId), eq(msgsTbl.workspaceId, wsId)))
      .limit(1);
    if (!msg) return res.status(404).json({ message: "Mensagem não encontrada" });
    if (msg.direction !== "out") return res.status(403).json({ message: "Só mensagens enviadas podem ser editadas" });
    if (msg.tipo && msg.tipo !== "text") return res.status(403).json({ message: "Apenas mensagens de texto podem ser editadas" });
    if ((msg as any).deletedAt) return res.status(409).json({ message: "Mensagem excluída não pode ser editada" });

    // Janela de 15min — após isso, edit bloqueado pra evitar reescrita de
    // histórico antigo (auditoria + UX: cliente provavelmente já leu).
    const createdAt = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
    const ageMin = (Date.now() - createdAt) / 60000;
    if (ageMin > 15) return res.status(403).json({ message: "Janela de 15min pra editar expirou" });

    const originalToSave = (msg as any).originalTexto || msg.texto;
    await db.update(msgsTbl).set({
      texto: novoTexto.trim(),
      originalTexto: originalToSave,
      editedAt: new Date(),
    } as any).where(eq(msgsTbl.id, msgId));

    broadcastToWorkspace(wsId, "message_updated", {
      conversationId: msg.conversationId,
      messageId: msgId,
      updates: {
        texto: novoTexto.trim(),
        originalTexto: originalToSave,
        editedAt: new Date().toISOString(),
      },
    });

    res.json({ ok: true });
  });

  // ── Reactions de emoji ─────────────────────────────────────────────────
  // Bruno 2026-05-20: toggle de reaction (estilo WhatsApp). Mesmo user + msg
  // + emoji = remove; senão cria. Local-only — não propaga pra Meta. WS
  // broadcast pra atualizar painel em tempo real entre atendentes.
  app.post("/api/messages/:id/reactions", requireAuth, async (req, res) => {
    const msgId = parseId(req.params.id as string);
    if (!msgId) return res.status(400).json({ message: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);
    const userId = (req as any).user?.id;
    const userName = (req as any).user?.nome || (req as any).user?.email || "Atendente";
    const emoji = String(req.body?.emoji || "").trim();
    if (!emoji || emoji.length > 16) return res.status(400).json({ message: "Emoji inválido" });

    const { db } = await import("../db");
    const { messages: msgsTbl, messageReactions } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    const [msg] = await db.select().from(msgsTbl)
      .where(and(eq(msgsTbl.id, msgId), eq(msgsTbl.workspaceId, wsId)))
      .limit(1);
    if (!msg) return res.status(404).json({ message: "Mensagem não encontrada" });

    // Toggle: tenta remover; se não removeu nada, insere.
    const removed = await db.delete(messageReactions)
      .where(and(
        eq(messageReactions.messageId, msgId),
        eq(messageReactions.userId, userId),
        eq(messageReactions.emoji, emoji),
        eq(messageReactions.workspaceId, wsId),
      ))
      .returning();

    let action: "added" | "removed";
    if (removed.length > 0) {
      action = "removed";
    } else {
      await db.insert(messageReactions).values({
        messageId: msgId,
        conversationId: msg.conversationId,
        workspaceId: wsId,
        userId,
        userName,
        emoji,
      });
      action = "added";
    }

    broadcastToWorkspace(wsId, "reaction_updated", {
      messageId: msgId,
      conversationId: msg.conversationId,
      emoji,
      userId,
      userName,
      action,
    });

    res.json({ ok: true, action });
  });

  app.get("/api/conversations/:id/reactions", requireAuth, async (req, res) => {
    const convId = parseId(req.params.id as string);
    if (!convId) return res.status(400).json({ message: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);
    const { db } = await import("../db");
    const { messageReactions } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    const rows = await db.select().from(messageReactions)
      .where(and(eq(messageReactions.conversationId, convId), eq(messageReactions.workspaceId, wsId)));

    res.json({ ok: true, data: rows });
  });

  // Bruno 2026-05-21: re-baixar mídia inbound quando download original falhou.
  // Webhook grava metadata.mediaId + downloadFailed=true em vez de URL CDN
  // ephemeral. UI chama esse endpoint pelo botão "Re-baixar". Funciona ENQUANTO
  // o mediaId continuar válido na Meta (típicamente alguns dias).
  app.post("/api/messages/:id/retry-media", requireAuth, async (req, res) => {
    const id = parseId(req.params.id as string);
    if (!id) return res.status(400).json({ message: "ID inválido" });
    const wsId = await resolveWorkspaceId(req);

    const { db } = await import("../db");
    const { messages, whatsappOfficialConnections } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");

    const [msg] = await db.select().from(messages)
      .where(and(eq(messages.id, id), eq(messages.workspaceId, wsId)))
      .limit(1);
    if (!msg) return res.status(404).json({ error: "Mensagem não encontrada" });

    const meta = (msg.mediaMetadata as any) || {};
    const mediaId = meta.mediaId;
    if (!mediaId) {
      return res.status(400).json({ error: "Mensagem sem mediaId pra re-baixar" });
    }
    if (msg.arquivo) {
      return res.json({ ok: true, arquivo: msg.arquivo, alreadyDownloaded: true });
    }

    const [conn] = await db.select().from(whatsappOfficialConnections)
      .where(eq(whatsappOfficialConnections.workspaceId, wsId))
      .limit(1);
    const token = conn?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "";
    if (!token) {
      return res.status(503).json({ error: "Conexão WhatsApp Cloud não configurada" });
    }

    const metaWhatsApp = await import("../services/meta-whatsapp");
    const local = await metaWhatsApp.downloadMetaMedia(
      mediaId,
      token,
      meta.mimeType,
      { workspaceId: wsId, conversationId: msg.conversationId },
    ).catch(() => null);

    if (!local) {
      return res.status(502).json({
        error: "Não foi possível re-baixar a mídia. O arquivo pode ter expirado no WhatsApp ou o token está inválido.",
      });
    }

    const newMeta = { ...meta, downloadFailed: false, recoveredAt: new Date().toISOString() };
    const [updated] = await db.update(messages)
      .set({ arquivo: local, mediaMetadata: newMeta as any })
      .where(and(eq(messages.id, id), eq(messages.workspaceId, wsId)))
      .returning();

    try {
      broadcastToWorkspace(wsId, "message-updated", { id, arquivo: local, conversationId: msg.conversationId });
    } catch {}

    res.json({ ok: true, arquivo: local, message: updated });
  });
}
