import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { requireAuth, requireAuthOrToken, requireScope } from "../middleware/auth";
import { resolveWorkspaceId, sanitizeConexao, formatPhone, getDefaultLeadStatus, getDefaultWorkspaceId, scheduleAutomation, fetchWithTimeout, safeErr } from "../utils/helpers";
import { dispatchWebhook } from "../services/webhookDispatcher";
import { db } from "../db";
import { conexoes } from "@shared/schema";
import { eq } from "drizzle-orm";

/** Remove acentos e troca tudo que não é [a-zA-Z0-9] por hífen — a regra de nome do
 *  Evolution é "só letras, números, hífen e underscore". Ex: "Nekt Fibra" → "Nekt-Fibra". */
function slugifyCompany(name: string): string {
  return (name || "")
    .normalize("NFD")              // "é" → "e" + acento combinante
    .replace(/[^\x00-\x7F]/g, "")  // descarta os acentos combinantes (e qualquer não-ASCII)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/g, "");
}

/**
 * Estado do pareamento por conexão (Bruno 2026-06-17) — pra o QR SEMPRE funcionar.
 * O front faz polling do /qrcode a cada 3.5s; o whatsmeow emite ~5 QRs por sessão
 * (~100s) e depois ENCERRA ("QR code limit reached") → a instância trava e o QR
 * some pra sempre (foi o que matou a ConexãoNet-01). Aqui rastreamos por conexão
 * pra: (a) só (re)conectar quando NÃO há QR vivo — reconectar a cada poll reinicia
 * a sequência e o QR nunca estabiliza pra escanear; (b) auto-resetar a instância
 * quando a sequência esgota, com cooldown pra não recriar a cada 3.5s.
 */
const qrPairing = new Map<string, { lastConnectAt: number; lastResetAt: number }>();
const QR_RESET_COOLDOWN_MS = 12_000;  // recria a instância no máx 1×/12s (sequência nova dura ~100s)
const QR_CONNECT_COOLDOWN_MS = 6_000; // (re)connect no máx 1×/6s

/**
 * Nome da instância Evolution = "<Empresa>-NN" (ex: "Nekt-Fibra-01") — Bruno 2026-06-10.
 * - Empresa = nome do workspace.
 * - NN = sequência POR EMPRESA (slug), 2 dígitos, começando em 01.
 * - Tem que ser ÚNICO GLOBALMENTE: esse nome vira o `instanceId`, que é o que o
 *   webhook usa pra casar o inbound de volta (lookup SEM filtro de workspace) E o
 *   Evolution exige nome único no servidor. Por isso checamos colisão contra TODOS
 *   os workspaces (só a coluna instanceId — não vaza dado de negócio) e pulamos pro
 *   próximo NN livre.
 */
async function buildEvolutionInstanceName(wsId: string): Promise<string> {
  const ws = await storage.getWorkspace(wsId);
  const company = ws?.nome || "";
  const slug = slugifyCompany(company) || "Empresa";

  // instanceIds já usados em QUALQUER workspace — uniqueness global do canal Evolution.
  const rows = await db.select({ instanceId: conexoes.instanceId }).from(conexoes).where(eq(conexoes.provider, "evolution"));
  const taken = new Set(rows.map((r) => String(r.instanceId || "").toLowerCase()).filter(Boolean));

  for (let seq = 1; seq <= 999; seq++) {
    const candidate = `${slug}-${String(seq).padStart(2, "0")}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${slug}-${randomUUID().slice(0, 6)}`; // fallback improvável (>999 instâncias)
}

export function registerConexaoRoutes(app: Express) {
  app.get("/api/conexoes", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const list = await storage.getConexoes(wsId);
      res.json({ ok: true, data: list.map(sanitizeConexao) });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.post("/api/conexoes", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const count = await storage.countConexoes(wsId);
      // Limite de canais vem do PLANO do workspace (null = ilimitado; sem plano = legado, não barra).
      const ws = await storage.getWorkspace(wsId);
      const plano = ws?.planoId ? await storage.getPlano(ws.planoId) : null;
      const PLAN_LIMIT = (plano as any)?.limiteCanais ?? null;
      if (PLAN_LIMIT != null && count >= PLAN_LIMIT) {
        return res.status(403).json({ ok: false, error: `Limite de ${PLAN_LIMIT} ${PLAN_LIMIT === 1 ? "canal" : "canais"} do seu plano atingido. Faça upgrade.` });
      }

      // Canal não-oficial = Evolution GO (provider='evolution'). O legado web.js/Baileys foi removido.
      const evo = await import("../services/evolutionAdapter");
      if (!evo.evolutionConfigured()) {
        return res.status(400).json({ ok: false, error: "Evolution GO não configurado no servidor (EVOLUTION_BASE_URL / EVOLUTION_GLOBAL_API_KEY)." });
      }
      // Nome da instância = "<Empresa>-NN" (ex: "Nekt-Fibra-01"): aparece no painel do
      // Evolution e é o instanceId que o webhook usa pra casar o inbound de volta.
      const instanceName = await buildEvolutionInstanceName(wsId);
      const token = evo.newInstanceToken();
      const conexao = await storage.createConexao({ nome: instanceName, tipo: "whatsapp", provider: "evolution", token, instanceId: instanceName, status: "connecting", workspaceId: wsId, planoLimite: PLAN_LIMIT ?? 0 });
      try {
        const cr = await evo.createInstance(instanceName, token);
        if (!cr.ok) throw new Error(cr.error || "create falhou");
        const evoId = cr.data?.id || cr.data?.Id || cr.data?.ID;
        if (evoId) await storage.updateConexao(conexao.id, { evolutionId: String(evoId) } as any, wsId);
        await evo.connectInstance(token, evo.resolveWebhookUrl());
      } catch (e: any) { console.error("[Evolution] provision erro:", e.message); }
      const fresh = await storage.getConexao(conexao.id, wsId);
      return res.status(201).json({ ok: true, data: sanitizeConexao(fresh!) });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.get("/api/conexoes/:id/status", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });
      if (conexao.provider === "evolution") {
        const evo = await import("../services/evolutionAdapter");
        if (!conexao.token) return res.json({ ok: true, data: { status: conexao.status, numero: conexao.numero, connected: false, provider: "evolution" } });
        const st = await evo.getStatus(conexao.token);
        const status = st.ok ? (st.connected ? "connected" : (conexao.status === "qr_pending" || conexao.status === "connecting" ? conexao.status : "disconnected")) : conexao.status;
        const numero = st.numero || conexao.numero;
        if (st.ok && status !== conexao.status) await storage.updateConexao(conexao.id, { status, numero, ultimoPing: new Date() } as any, wsId);
        return res.json({ ok: true, data: { status, numero, connected: !!st.connected, provider: "evolution" } });
      }
      return res.json({ ok: true, data: { status: conexao.status, numero: conexao.numero, connected: conexao.status === "connected", provider: conexao.provider } });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.get("/api/conexoes/:id/qrcode", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });

      if (conexao.provider === "evolution") {
        const evo = await import("../services/evolutionAdapter");
        if (!conexao.token) return res.status(400).json({ ok: false, error: "Conexão Evolution sem token de instância" });
        const webhook = evo.resolveWebhookUrl();
        const now = Date.now();
        const ps = qrPairing.get(conexao.id) || { lastConnectAt: 0, lastResetAt: 0 };

        const st = await evo.getStatus(conexao.token);
        if (st.ok && st.connected) {
          qrPairing.delete(conexao.id);
          await storage.updateConexao(conexao.id, { status: "connected", numero: st.numero || conexao.numero, qrCode: null } as any, wsId);
          return res.json({ ok: true, data: { already_connected: true, provider: "evolution" } });
        }

        // 1) Tenta o QR da sequência VIVA, SEM reconectar (reconectar a cada poll
        //    reinicia a sequência e o QR nunca estabiliza pra escanear).
        let qr = await evo.getQrCode(conexao.token);
        if (qr.ok && qr.qrcode) {
          await storage.updateConexao(conexao.id, { qrCode: qr.qrcode, status: "qr_pending" } as any, wsId);
          return res.json({ ok: true, data: { qrcode: qr.qrcode, status: "qr_pending", provider: "evolution" } });
        }

        // 2) Sem QR vivo. Se a sequência ESGOTOU ("limit reached") ou a instância
        //    dessincronizou ("not authorized"), faz reset duro: reconecta e, se ainda
        //    não vier QR, RECRIA a instância (mesmo nome + MESMO token → mapeamento do
        //    banco intacto). Só roda NÃO-conectada (já retornamos acima se conectada).
        //    Cooldown evita recriar a cada poll de 3.5s (a sequência nova dura ~100s).
        const qrErr = (qr.error || "").toLowerCase();
        const exhausted = /limit|reach|expired|not.?authoriz|gone|no.?qr/.test(qrErr);
        if (exhausted && now - ps.lastResetAt > QR_RESET_COOLDOWN_MS) {
          ps.lastResetAt = now; ps.lastConnectAt = now;
          qrPairing.set(conexao.id, ps);
          await evo.connectInstance(conexao.token, webhook).catch(() => {});
          qr = await evo.getQrCode(conexao.token);
          if (!(qr.ok && qr.qrcode) && conexao.instanceId) {
            console.warn(`[Conexoes] QR esgotado (conexao ${conexao.id}) — recriando instância ${conexao.instanceId}`);
            await evo.removeInstanceByName(conexao.instanceId).catch(() => {});
            await evo.createInstance(conexao.instanceId, conexao.token).catch(() => {});
            await evo.connectInstance(conexao.token, webhook).catch(() => {});
            qr = await evo.getQrCode(conexao.token);
          }
          if (qr.ok && qr.qrcode) {
            await storage.updateConexao(conexao.id, { qrCode: qr.qrcode, status: "qr_pending" } as any, wsId);
            return res.json({ ok: true, data: { qrcode: qr.qrcode, status: "qr_pending", provider: "evolution" } });
          }
          return res.json({ ok: true, data: { status: "connecting", message: "Reconectando o WhatsApp...", provider: "evolution" } });
        }

        // 3) Sequência ainda não começou (1ª entrada) → conecta 1× (com cooldown).
        if (now - ps.lastConnectAt > QR_CONNECT_COOLDOWN_MS) {
          ps.lastConnectAt = now;
          qrPairing.set(conexao.id, ps);
          const conn = await evo.connectInstance(conexao.token, webhook).catch((e: any) => ({ ok: false, status: 0, error: e?.message || String(e) }));
          qr = await evo.getQrCode(conexao.token);
          if (qr.ok && qr.qrcode) {
            await storage.updateConexao(conexao.id, { qrCode: qr.qrcode, status: "qr_pending" } as any, wsId);
            return res.json({ ok: true, data: { qrcode: qr.qrcode, status: "qr_pending", provider: "evolution" } });
          }
          // Erro REAL do upstream (Evolution fora do ar, mesmo com fallback) ≠ "QR ainda não pronto".
          if (!qr.ok && (conn as any).ok === false) {
            const detail = qr.error || (conn as any)?.error || "erro desconhecido";
            console.warn(`[Conexoes] QR Evolution indisponível (conexao ${conexao.id}): ${detail}`);
            return res.json({ ok: false, error: "O servidor do WhatsApp (Evolution) está temporariamente indisponível. Tente de novo em instantes." });
          }
        }

        // connect ok mas ainda sem código → genuinamente conectando, mantém o spinner.
        return res.json({ ok: true, data: { status: "connecting", message: "Aguardando QR code...", provider: "evolution" } });
      }

      return res.status(400).json({ ok: false, error: "Esta conexão não suporta QR Code." });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.post("/api/conexoes/:id/disconnect", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });
      if (conexao.provider === "evolution") {
        const evo = await import("../services/evolutionAdapter");
        if (conexao.token) await evo.disconnectInstance(conexao.token).catch(() => {});
        await storage.updateConexao(conexao.id, { status: "disconnected", qrCode: null, numero: null } as any, wsId);
        return res.json({ ok: true, message: "Desconectado com sucesso" });
      }
      await storage.updateConexao(conexao.id, { status: "disconnected", qrCode: null, numero: null } as any, wsId);
      return res.json({ ok: true, message: "Desconectado com sucesso" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.post("/api/conexoes/:id/send", requireAuthOrToken, requireScope("messages:send"), async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });
      const { phone, message } = req.body;
      if (!phone || !message) return res.status(400).json({ ok: false, error: "phone e message sao obrigatorios" });
      const formatted = formatPhone(phone);
      if (conexao.provider === "evolution") {
        if (!conexao.token) return res.status(400).json({ ok: false, error: "Conexão Evolution sem token" });
        const evo = await import("../services/evolutionAdapter");
        const r = await evo.sendText(conexao.token, formatted, message);
        if (!r.sent) return res.status(400).json({ ok: false, error: r.error || "Erro ao enviar" });
        await storage.createMensagemLog({ conexaoId: conexao.id, direction: "outbound", fromNumber: conexao.numero || "", toNumber: formatted, content: message, status: "sent" });
        return res.json({ ok: true, data: { status: "sent" } });
      }
      return res.status(400).json({ ok: false, error: "Conexão não suporta envio direto." });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.patch("/api/conexoes/:id", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });
      const { nome, automacaoId } = req.body;
      const updates: any = {};
      if (nome !== undefined) updates.nome = nome;
      if (automacaoId !== undefined) {
        if (automacaoId) { const auto = await storage.getAutomacao(automacaoId, wsId); if (!auto) return res.status(400).json({ ok: false, error: "Automacao nao encontrada neste workspace" }); if (auto.status !== "ACTIVE") return res.status(400).json({ ok: false, error: "Automacao nao esta ativa" }); }
        const hadAutomacao = !!conexao.automacaoId;
        const removingAutomacao = hadAutomacao && !automacaoId;
        updates.automacaoId = automacaoId || null;

        if (removingAutomacao) {
          try {
            const { conversations: convTable, automationPendingInputs } = await import("@shared/schema");
            const { eq, and, ne } = await import("drizzle-orm");
            const { db } = await import("../db");
            const openConvs = await db.select({ id: convTable.id, telefone: convTable.telefone })
              .from(convTable)
              .where(and(
                eq(convTable.workspaceId, wsId),
                eq(convTable.conexaoId, conexao.id),
                ne(convTable.status, "resolved")
              ));

            if (openConvs.length > 0) {
              for (const conv of openConvs) {
                if (conv.telefone) {
                  try {
                    await db.delete(automationPendingInputs).where(
                      and(eq(automationPendingInputs.phone, conv.telefone), eq(automationPendingInputs.workspaceId, wsId))
                    );
                  } catch {}
                }
              }
              console.log(`[Conexoes] Automação removida da conexão ${conexao.id}: ${openConvs.length} inputs pendentes limpos`);
            }
          } catch (e: any) { console.error("[Conexoes] Erro ao limpar inputs pendentes:", e.message); }
        }
      }
      const updated = await storage.updateConexao(conexao.id, updates, wsId);
      res.json({ ok: true, data: sanitizeConexao(updated!) });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.delete("/api/conexoes/:id", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });
      if (conexao.provider === "evolution") {
        try {
          const evo = await import("../services/evolutionAdapter");
          const evoId = (conexao as any).evolutionId;
          // Usa o id interno guardado (robusto); cai pro resolve-por-nome só em conexões antigas.
          if (evoId) await evo.deleteInstance(String(evoId));
          else await evo.removeInstanceByName(conexao.instanceId || conexao.id);
        } catch (e: any) { console.error("[Evolution] remove erro:", e.message); }
        await storage.deleteConexao(conexao.id, wsId);
        return res.json({ ok: true, message: "Conexao removida" });
      }
      await storage.deleteConexao(conexao.id, wsId);
      res.json({ ok: true, message: "Conexao removida" });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });

  app.post("/api/conexoes/:id/configurar-webhook", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conexao = await storage.getConexao(((req.params.id as string) as string), wsId);
      if (!conexao) return res.status(404).json({ ok: false, error: "Conexao nao encontrada" });
      if (conexao.provider === "evolution") {
        if (!conexao.token) return res.status(400).json({ ok: false, error: "Conexão Evolution sem token" });
        const evo = await import("../services/evolutionAdapter");
        const r = await evo.connectInstance(conexao.token, evo.resolveWebhookUrl());
        return res.json({ ok: r.ok, message: r.ok ? "Webhook do Evolution reconfigurado." : (r.error || "Falha ao reconfigurar webhook") });
      }
      return res.status(400).json({ ok: false, error: "Esta conexão não usa webhook externo." });
    } catch (e: any) { res.status(500).json({ ok: false, error: safeErr(e, "[conexoes]") }); }
  });
}
