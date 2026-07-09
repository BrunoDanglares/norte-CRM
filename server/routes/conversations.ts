import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireAuthOrToken } from "../middleware/auth";
import { parseId, resolveWorkspaceId, safeErr } from "../utils/helpers";
import { db } from "../db";
import { instaProspectSessions, protocols, leads, conversations, contacts, messages, pipelineStages, teamMembers, conversationSituationTags, automationPendingInputs } from "@shared/schema";
import { eq, and, inArray, desc, sql, isNull, isNotNull, or } from "drizzle-orm";
import { broadcastToWorkspace } from '../services/broadcast';
import { insertMessageWithProtocol } from "../utils/messageInsert";

// ISP removido: o logger de movimentação de conversa (v2TurnLogger) saiu junto
// com o motor de agentes. Mantemos a assinatura como no-op local pra preservar
// todos os call sites não-ISP sem quebrar o type-check.
function logConversationMovement(_event: any): void { /* no-op (ISP removido) */ }

async function generateProtocolNumber(dbConn: typeof db): Promise<string> {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const result = await dbConn.execute(sql`SELECT nextval('protocol_seq') as seq`);
  const seq = String(result.rows[0].seq).padStart(5, "0");
  return `${y}${m}${d}-${seq}`;
}

export function registerConversationRoutes(app: Express) {
  app.post("/api/conversations/refresh-avatars", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const { backfillConversationAvatars } = await import("../services/avatar.service");
      const total = await backfillConversationAvatars(wsId);
      res.json({ updated: total, message: total > 0 ? `${total} fotos atualizadas` : "Nenhuma foto nova encontrada." });
    } catch (e: any) {
      res.json({ updated: 0, message: e.message || "Erro ao buscar fotos" });
    }
  });

  app.get("/api/conversations", requireAuthOrToken, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    // clamp da query string: limit gigante = OOM, offset negativo = erro SQL
    const limit = Math.min(Math.max(parseInt(((req.query.limit as string | undefined) as string | undefined) as string) || 50, 1), 500);
    const offset = Math.max(parseInt(((req.query.offset as string | undefined) as string | undefined) as string) || 0, 0);
    const convs = await storage.getConversations(wsId, { limit, offset });

    // Avatar fallback: conversations sem avatar → buscar foto_url de contacts pelo telefone
    let convsWithAvatar: typeof convs = convs;
    try {
      const noAvatar = convs.filter((c: any) => !c.avatar && c.telefone);
      if (noAvatar.length > 0) {
        const phones = [...new Set(noAvatar.map((c: any) => c.telefone as string))];
        const contactRows = await db
          .select({ telefone: contacts.telefone, fotoUrl: contacts.fotoUrl })
          .from(contacts)
          .where(and(eq(contacts.workspaceId, wsId), inArray(contacts.telefone, phones)));
        const phoneToFoto = new Map(contactRows.map(r => [r.telefone, r.fotoUrl]));
        convsWithAvatar = convs.map((c: any) =>
          !c.avatar && c.telefone && phoneToFoto.get(c.telefone)
            ? { ...c, avatar: phoneToFoto.get(c.telefone) }
            : c
        );
      }
    } catch (_) {}

    let enriched = convsWithAvatar;
    try {
      const conversationIds = convs.map((c: any) => c.id).filter(Boolean);
      if (conversationIds.length > 0) {
        const activeProtocols = await db
          .select({
            conversationId: protocols.conversationId,
            numero: protocols.numero,
            status: protocols.status,
            slaViolado: protocols.slaViolado,
            createdAt: protocols.createdAt,
          })
          .from(protocols)
          .where(
            and(
              eq(protocols.workspaceId, wsId),
              sql`${protocols.conversationId} IN (${sql.join(conversationIds.map((id: number) => sql`${id}`), sql`, `)})`
            )
          )
          .orderBy(desc(protocols.createdAt));

        const protoMap = new Map<number, { numero: string; status: string; slaViolado: boolean }>();
        for (const p of activeProtocols) {
          if (p.conversationId && !protoMap.has(p.conversationId)) {
            protoMap.set(p.conversationId, { numero: p.numero, status: p.status, slaViolado: p.slaViolado ?? false });
          }
        }

        enriched = convs.map((c: any) => {
          const proto = protoMap.get(c.id);
          return {
            ...c,
            protocolNumero: proto?.numero || null,
            protocolStatus: proto?.status || null,
            protocolSlaViolado: proto?.slaViolado || false,
          };
        });
      }
    } catch (e: any) {
      if (!e.message?.includes("does not exist")) {
        console.error("[Conversations] Protocol enrichment error:", e.message);
      }
    }

    // Bruno 2026-05-21: enriquece cada conv com `situationCodes` (F4, S5, C7,
    // etc.) pra o card da lista mostrar as tags em todas as abas (automação,
    // fila, atribuídas, resolvidas).
    //
    // Fontes UNIDAS (paridade com /api/conversations/situation-tags-map):
    //   1. conversation_situation_tags (CST live — enquanto conv está aberta)
    //   2. protocols.tags do PROTOCOLO MAIS RECENTE da conv (snapshot pós-resolve)
    //
    // Bug histórico (Bruno 2026-05-21, conv 679 #202605210008): após resolve,
    // a rota /resolve DELETA toda CST (conversations.ts:505) e move as tags
    // pra `protocols.tags`. Esse enrichment lia SÓ CST → card de conversa
    // resolvida ficava sem tag mesmo com S9+AH no snapshot do protocolo.
    //
    // Bruno 2026-05-21 (refac): refeito SEM CTE — duas queries simples + merge
    // em JS. CTE com sql.join podia falhar silenciosamente em alguns drivers
    // do pg; o catch silencioso engolia. Agora cada query tem catch próprio.
    // Bruno 2026-05-27 (audit conv #1023): preservar ORDEM CRONOLÓGICA das
    // tags (createdAt ASC). Antes usava Set<string> → ordem aleatória do hash
    // — atendente via "C11, C3, C5, C8" em vez de "C3, C8, C5, C11"
    // (cronologia real do fluxo de vendas: cobertura → planos → nova_inst → cadastro).
    const codesByConv = new Map<number, string[]>();
    const seenByConv = new Map<number, Set<string>>(); // dedup mantendo primeira ocorrência
    const pushTag = (cid: number, code: string) => {
      if (!cid || !code) return;
      const seen = seenByConv.get(cid) ?? new Set<string>();
      if (seen.has(code)) return;
      seen.add(code);
      seenByConv.set(cid, seen);
      const list = codesByConv.get(cid) ?? [];
      list.push(code);
      codesByConv.set(cid, list);
    };
    const ids = enriched.map((c: any) => c.id).filter(Boolean) as number[];
    if (ids.length > 0) {
      // Fonte 1: CST live tags (ordenado por createdAt ASC = ordem cronológica)
      try {
        const cstRows = await db
          .select({
            conversationId: conversationSituationTags.conversationId,
            code: conversationSituationTags.situationCode,
          })
          .from(conversationSituationTags)
          .where(
            and(
              eq(conversationSituationTags.workspaceId, wsId),
              sql`${conversationSituationTags.conversationId} IN (${sql.join(ids.map((id: number) => sql`${id}`), sql`, `)})`
            )
          )
          .orderBy(conversationSituationTags.conversationId, conversationSituationTags.createdAt);
        for (const r of cstRows) {
          if (!r.conversationId || !r.code) continue;
          pushTag(r.conversationId, r.code);
        }
      } catch (e: any) {
        console.error("[Conversations] CST enrichment error:", e.message);
      }

      // Fonte 2: protocols.tags do protocolo mais recente — append tags que
      // não vieram da CST (ex: tags antigas só no protocolo). Mantém ordem.
      try {
        const protoRows: any = await db.execute(sql`
          SELECT DISTINCT ON (conversation_id) conversation_id, tags
          FROM protocols
          WHERE workspace_id = ${wsId}
            AND conversation_id IN (${sql.join(ids.map((id: number) => sql`${id}`), sql`, `)})
            AND tags IS NOT NULL
            AND array_length(tags, 1) > 0
          ORDER BY conversation_id, created_at DESC
        `);
        for (const r of (protoRows.rows ?? protoRows) as any[]) {
          const cid = r.conversation_id as number;
          const tagsArr = Array.isArray(r.tags) ? (r.tags as string[]) : [];
          if (!cid || tagsArr.length === 0) continue;
          for (const t of tagsArr) pushTag(cid, t);
        }
      } catch (e: any) {
        console.error("[Conversations] Protocol tags enrichment error:", e.message);
      }
    }
    enriched = enriched.map((c: any) => ({
      ...c,
      situationCodes: codesByConv.get(c.id) ?? [],
    }));

    const userId = req.user?.id;
    const userRole = req.user?.role;
    const isManager = ["admin", "superadmin", "manager", "gerente", "Gerente"].includes(userRole ?? "");

    if (isManager) {
      return res.json(enriched);
    }

    if (userId) {
      try {
        const userTeamRows = await db
          .select({ teamId: teamMembers.teamId })
          .from(teamMembers)
          .where(eq(teamMembers.userId, userId));
        const userTeamIds = userTeamRows.map(t => t.teamId);

        const filtered = enriched.filter((c: any) => {
          // Resolvidas: sempre visível para todos os atendentes
          if (c.status === "resolved") return true;
          // Atribuída explicitamente a mim → sempre visível
          if (c.assignedUserId && c.assignedUserId === userId) return true;
          // Assumida por outro atendente → ocultar
          if (c.assignedUserId && c.assignedUserId !== userId) return false;
          // assignedUserId é null daqui em diante (fila de atendimento humano)
          // Sem equipe atribuída → visível para todos (fallback de segurança)
          if (!c.assignedTeamId) return true;
          // Conversa na fila com equipe atribuída pelo agente banana:
          // SOMENTE atendentes membros daquela equipe podem ver/assumir.
          // Atendente sem nenhuma equipe NÃO vê fila com equipe atribuída.
          if (userTeamIds.length === 0) return false;
          if (userTeamIds.includes(c.assignedTeamId)) return true;
          return false;
        });
        return res.json(filtered);
      } catch {
        return res.json(enriched);
      }
    }
    res.json(enriched);
  });

  app.post("/api/conversations/find-or-create", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const { nome, telefone, canal, instagramUsername, conexaoId } = req.body;
      if (!nome) return res.status(400).json({ message: "nome é obrigatório" });
      // Bruno 2026-06-05 (modal Novo Atendimento): vincula a conversa ao canal
      // escolhido, pra a 1ª mensagem sair pela conexão certa (channel-router lê
      // conv.conexaoId). Só aceita UUID; ignora valor inválido.
      const conexaoIdClean = (typeof conexaoId === "string" && /^[0-9a-f-]{36}$/i.test(conexaoId)) ? conexaoId : null;

      const allConvs = await storage.getConversations(wsId, { limit: 10000, offset: 0 });

      let existing = null;
      if (canal?.toLowerCase() === "instagram" && instagramUsername) {
        existing = allConvs.find((c: any) =>
          c.canal?.toLowerCase() === "instagram" &&
          (c.nome === instagramUsername || c.nome === nome)
        );
      }
      if (!existing && telefone) {
        const cleanPhone = telefone.replace(/\D/g, "");
        existing = allConvs.find((c: any) => {
          const convPhone = (c.telefone || "").replace(/\D/g, "");
          return convPhone && convPhone === cleanPhone;
        });
      }
      if (!existing) {
        existing = allConvs.find((c: any) => c.nome === nome && c.canal?.toLowerCase() === (canal || "whatsapp").toLowerCase());
      }

      if (existing) {
        // Bruno 2026-06-15: re-bind ao canal escolhido no "Novo atendimento".
        // Bug: uma conversa antiga (ex: resolvida, nascida no Meta com
        // conexao_id NULL/whatsapp_official) era reaproveitada SEM reescrever o
        // vínculo de canal. A 1ª msg então saía sem conexaoId → o channel-router
        // caía na conexão Meta ativa → checagem de janela 24h → erro
        // "window_closed" MESMO o atendente tendo escolhido um canal NÃO-OFICIAL
        // (Evolution). Só roda quando veio um conexaoId válido (modal); leads/
        // contatos não passam conexaoId e seguem intactos.
        if (conexaoIdClean && existing.conexaoId !== conexaoIdClean) {
          try {
            const reopen = ["resolved", "closed", "encerrada"].includes(String((existing as any).status || "").toLowerCase());
            const [updated] = await db.update(conversations)
              .set({
                conexaoId: conexaoIdClean,
                ...(canal ? { canal } : {}),
                ...(reopen ? { status: "open" } : {}),
                updatedAt: new Date(),
              })
              .where(and(eq(conversations.id, (existing as any).id), eq(conversations.workspaceId, wsId)))
              .returning();
            if (updated) existing = updated;
          } catch (e: any) {
            console.warn(`[find-or-create] rebind conexao falhou: ${e.message}`);
          }
        }
        return res.json({ ok: true, data: existing, created: false });
      }

      const newConv = await storage.createConversation({
        nome,
        telefone: telefone || null,
        canal: canal || "WhatsApp",
        status: "open",
        unread: 0,
        pendente: false,
        workspaceId: wsId,
        ...(conexaoIdClean ? { conexaoId: conexaoIdClean } : {}),
      } as any);

      return res.json({ ok: true, data: newConv, created: true });
    } catch (err: any) {
      return res.status(500).json({ message: safeErr(err, "[conversations]") });
    }
  });

  app.post("/api/conversations/backfill-avatars", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const { backfillConversationAvatars } = await import("../services/avatar.service");
      const count = await backfillConversationAvatars(wsId);
      res.json({ ok: true, updated: count });
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[conversations]") });
    }
  });

  app.get("/api/conversations/avatar-map", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const rows = await db
        .select({
          telefone: conversations.telefone,
          avatar: conversations.avatar,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, wsId),
            isNotNull(conversations.avatar),
            isNotNull(conversations.telefone)
          )
        );
      const contactRows = await db
        .select({ telefone: contacts.telefone, fotoUrl: contacts.fotoUrl })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, wsId), isNotNull(contacts.fotoUrl), isNotNull(contacts.telefone)));

      const map: Record<string, string> = {};

      function addToMap(phone: string, url: string) {
        const digits = phone.replace(/\D/g, "");
        map[phone] = url;
        map[digits] = url;
        if (digits.startsWith("55") && digits.length >= 12) {
          const sem55 = digits.slice(2);
          map[sem55] = url;
          if (sem55.length === 11) map[sem55.slice(2)] = url;
          if (sem55.length === 10) {
            const ddd = sem55.slice(0, 2);
            const num = sem55.slice(2);
            map[ddd + "9" + num] = url;
            map["55" + ddd + "9" + num] = url;
          }
          if (sem55.length === 11 && sem55[2] === "9") {
            const ddd = sem55.slice(0, 2);
            const num = sem55.slice(3);
            map[ddd + num] = url;
            map["55" + ddd + num] = url;
          }
        }
      }

      for (const r of rows) {
        if (r.telefone && r.avatar) addToMap(r.telefone, r.avatar);
      }
      for (const r of contactRows) {
        if (r.telefone && r.fotoUrl) addToMap(r.telefone, r.fotoUrl);
      }

      res.json(map);
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[conversations]") });
    }
  });

  // Bruno 2026-05-30 (sim Nádia print 409): endpoint pro painel Cliente
  // ler a sessão ISP (CPF + contrato + dados_coletados) salva pelo agente.
  // CustomerTab usa pra puxar enrichment ERP automático quando cliente
  // identifica CPF no chat.
  app.get("/api/conversations/:id/session", requireAuth, async (req, res) => {
    const id = parseId(req.params.id as string);
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    try {
      // ISP removido: isp_session_state (dropada) guardava CPF/contrato/fluxo da
      // sessão do agente. A origem mantida do CPF é o cadastro do contato
      // (contacts.cpf), resolvido logo abaixo. Sem sessão ISP, `session` é null.
      const session: any = null;

      // CPF salvo no CONTATO — sobrevive ao auto-close (que zera a sessão) e vale
      // entre conversas. Lookup DIRETO por telefone: NÃO depende da lista de
      // contatos do front (que vem paginada — em tenant grande tipo Nekt o
      // contato pode não estar nos 100 carregados → CPF "sumia" ao reabrir).
      // Bruno 2026-06-08. É o fallback quando a sessão não tem mais o CPF.
      let contactCpf: string | null = null;
      if (conv?.telefone) {
        try {
          const d = String(conv.telefone).replace(/\D/g, "");
          const alt = d.startsWith("55") ? d.slice(2) : "55" + d;
          const cRows: any = await db.execute(sql`
            SELECT cpf FROM contacts
            WHERE workspace_id = ${wsId}::uuid AND cpf IS NOT NULL AND cpf <> ''
              AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') IN (${d}, ${alt})
            LIMIT 1
          `);
          contactCpf = (cRows.rows ?? cRows)[0]?.cpf ?? null;
        } catch (e: any) {
          console.warn(`[conversations:session] contact.cpf lookup err: ${e?.message}`);
        }
      }

      if (!session) return res.json({ cpf: contactCpf, session: null });

      // Bruno 2026-06-04: persiste o CPF identificado no CONTATO (contacts.cpf)
      // pra valer nas PRÓXIMAS conversas da mesma pessoa. Só preenche quando o
      // contato ainda não tem CPF — NÃO sobrescreve um CPF que o atendente
      // editou no painel (opção A: contacts.cpf é controlado pelo atendente).
      if (session.cpf && conv?.telefone) {
        try {
          const d = String(conv.telefone).replace(/\D/g, "");
          const alt = d.startsWith("55") ? d.slice(2) : "55" + d;
          await db.execute(sql`
            UPDATE contacts SET cpf = ${session.cpf}
            WHERE workspace_id = ${wsId}::uuid
              AND (cpf IS NULL OR cpf = '')
              AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') IN (${d}, ${alt})
          `);
        } catch (e: any) {
          console.warn(`[conversations:session] backfill contact.cpf err: ${e?.message}`);
        }
      }

      res.json({
        cpf: session.cpf ?? contactCpf ?? null,
        contratoId: session.contrato_id ?? null,
        clienteNome: session.cliente_nome ?? null,
        clienteIdErp: session.cliente_id_erp ?? null,
        fluxoAtual: session.fluxo_atual ?? null,
        // etapa NÃO é coluna de isp_session_state — vive em dados_coletados.etapa
        // (jsonb). Antes o SELECT pedia a coluna `etapa` e a query inteira quebrava
        // ("column etapa does not exist"), derrubando o painel da sessão. Bruno 2026-06-19.
        etapa: (session.dados_coletados as any)?.etapa ?? null,
        session,
      });
    } catch (e: any) {
      console.warn(`[conversations:session] err: ${e?.message}`);
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.patch("/api/conversations/:id/tags", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { tags } = req.body;
    if (!Array.isArray(tags)) return res.status(400).json({ message: "tags deve ser um array" });
    const updated = await storage.updateConversationTags(id, tags, wsId);
    res.json({ ok: true, data: updated });
  });

  app.patch("/api/conversations/:id/assign", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { agente, targetUserId } = req.body;

    if (agente && agente.startsWith("[Equipe] ")) {
      const TEAM_TO_INTENT: Record<string, string> = {
        "Financeiro": "FINANCEIRO",
        "Suporte": "SUPORTE_TECNICO",
        "Suporte Técnico": "SUPORTE_TECNICO",
        "Suporte Tecnico": "SUPORTE_TECNICO",
        "Comercial": "VENDAS",
      };
      const teamName = agente.replace("[Equipe] ", "");
      const intent = TEAM_TO_INTENT[teamName];

      if (targetUserId) {
        const targetUser = await storage.getUser(targetUserId);
        // users.id é serial global e getUser não filtra por workspace — sem este
        // cross-check dava pra atribuir a conversa a um usuário de OUTRO tenant
        // (vaza o nome do usuário alheio + oracle de enumeração de id).
        if (!targetUser || (targetUser.workspaceId && targetUser.workspaceId !== wsId)) return res.status(404).json({ message: "Usuario nao encontrado" });
        await db.update(conversations).set({
          agente,
          assignedUserId: targetUser.id,
          assignedUserName: targetUser.nome,
          // Bruno 2026-05-15: humano assumiu → IA pausada automaticamente.
          // Sem isso o toggle visual "Agente Banana ON" permanecia mesmo
          // com isAgentBlockedByStage bloqueando o bot — confundia o operador.
          aiPaused: true,
          updatedAt: new Date(),
        }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));
        // ISP removido: cancelamento de auto-close (informationalResolveService) e
        // sincronização de protocolo (protocol.service) saíram com o módulo ISP.
        try {
          broadcastToWorkspace(wsId, "conversation_updated", {
            conversationId: id,
            assigned_user_id: targetUser.id,
            assigned_user_name: targetUser.nome,
            aiPaused: true,
          });
        } catch {}
        logConversationMovement({
          workspaceId: wsId,
          conversationId: id,
          kind: 'assigned_user_change',
          trigger: 'human',
          actorUserId: (req.user as any)?.id ?? null,
          actorUserName: (req.user as any)?.nome ?? null,
          data: {
            fromUserId: conv.assignedUserId ?? null,
            fromUserName: conv.assignedUserName ?? null,
            toUserId: targetUser.id,
            toUserName: targetUser.nome,
            agente,
            aiPaused: true,
          },
        });
        const finalConv = await storage.getConversation(id, wsId);
        return res.json({ ok: true, data: finalConv });
      }

      if (intent) {
        try {
          const { assignTeamOnly } = await import("../services/teamAssignment");
          await assignTeamOnly(wsId, id, intent);
          logConversationMovement({
            workspaceId: wsId,
            conversationId: id,
            kind: 'assigned_team_change',
            trigger: 'human',
            actorUserId: (req.user as any)?.id ?? null,
            actorUserName: (req.user as any)?.nome ?? null,
            data: { team: teamName, intent, agente },
          });
          const finalConv = await storage.getConversation(id, wsId);
          return res.json({ ok: true, data: finalConv });
        } catch (err: any) {
          console.error("[Assign] assignTeamOnly failed, fallback:", err.message);
        }
      }

      await db.update(conversations).set({
        agente, assignedUserId: null, assignedUserName: null, updatedAt: new Date(),
      }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));
      const fallbackConv = await storage.getConversation(id, wsId);
      return res.json({ ok: true, data: fallbackConv });
    }

    const updated = await storage.updateConversationAgent(id, agente || null, wsId);
    res.json({ ok: true, data: updated });
  });

  // Bruno 2026-05-20: PATCH /:id/claim removido. Substituído por POST /:id/assume
  // (mais completo: lida com takeover por admin, registra msg de sistema, sincroniza
  // protocolo). Os 2 callers no frontend (ActionsSidebar/MessageArea) eram dead-code
  // — declaração de useMutation sem nenhum .mutate() correspondente.

  app.patch("/api/conversations/:id/status", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { status, prioridade, observacao } = req.body;
    const enviarEncerramento = req.body.enviarEncerramento === true || req.body.enviarEncerramento === "true";
    const enviarCsat = req.body.enviarCsat === true || req.body.enviarCsat === "true";
    // pipelineEtapa pode ser passado opcionalmente no body do resolve (evita roundtrip extra)
    const resolveEtapa = req.body.pipelineEtapa !== undefined ? (req.body.pipelineEtapa || null) : ((conv as any).pipelineEtapa || null);
    if (!status || !["open", "pending", "resolved"].includes(status)) {
      return res.status(400).json({ message: "Status invalido" });
    }
    const updates: any = { status, updatedAt: new Date() };
    if (prioridade && ["alta", "media", "baixa"].includes(prioridade)) {
      updates.prioridade = prioridade;
    }

    if (status === "resolved") {
      const resolvedAt = new Date();
      updates.resolvedAt = resolvedAt;
      // Zera TODOS os atributos da conversa ao resolver
      // Bruno 2026-05-17: inclui unread — contador é por PROTOCOLO, não por
      // contato. Próximo protocolo nasce com 0 e conta a partir dali.
      updates.unread = 0;
      updates.agente = null;
      // Bruno 2026-05-21: assignedUserId/assignedUserName/assignedTeamId PRESERVADOS
      // ao resolver — viram snapshot histórico do último atendente/equipe que tocou
      // o atendimento. Isso permite os filtros "Atendentes" e "Departamentos" da aba
      // "Encerrados hoje" funcionarem (antes, sempre null = filtro sumia 100% dos
      // cards). classifyConv() checa status==="resolved" ANTES de assignedUserId,
      // então o card continua indo pra coluna "Encerrados". Reopen re-limpa via
      // message-processor.ts:588.
      updates.pipeline = null;
      updates.pipelineEtapa = null;
      updates.tags = null;
      updates.prioridade = null;
      updates.aiPaused = false;
      // Bruno 2026-05-19: zera rastros de transferência manual no resolve.
      updates.transferredFromUserId = null;
      updates.transferredFromUserName = null;
      updates.transferredAt = null;

      // ── 1. Atualiza conversa e responde ao frontend IMEDIATAMENTE ───────────
      await db.update(conversations).set(updates).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));
      broadcastToWorkspace(wsId, "conversation_updated", {
        conversationId: id, id, status: "resolved",
        agente: null, assigned_user_id: null, assigned_user_name: null,
        assigned_team_id: null, pipeline: null, pipeline_etapa: null,
        tags: null, prioridade: null,
      });
      logConversationMovement({
        workspaceId: wsId,
        conversationId: id,
        kind: 'status_change',
        trigger: 'human',
        actorUserId: req.user?.id ?? null,
        actorUserName: req.user?.nome ?? null,
        data: {
          fromStatus: conv.status,
          toStatus: 'resolved',
          fromPipelineEtapa: (conv as any).pipelineEtapa ?? null,
          fromAgente: conv.agente ?? null,
          observacao: observacao ?? null,
          enviarEncerramento,
          enviarCsat,
        },
      });
      res.json({ ok: true });

      // ── 2. Toda a limpeza e protocolo rodam em background (sem bloquear o frontend) ─
      setImmediate(async () => {
        const convPhone = conv.telefone;
        const resolvedPrioridade = prioridade || conv.prioridade || "media";
        const finalEtapa = resolveEtapa as string | null;
        const userName = req.user?.nome || "Sistema";
        const userId = req.user?.id || null;

        // ── Finaliza lead no Kanban (move para Finalizado e arquiva) ──────
        const convPipelineForResolve = (conv as any).pipeline as string | null;
        if (convPhone && convPipelineForResolve) {
          try {
            const { finalizeLeadOnConversationResolve } = await import("../services/suportePipelineService");
            await finalizeLeadOnConversationResolve({ workspaceId: wsId, phone: convPhone, pipeline: convPipelineForResolve });
          } catch (e: any) {
            console.error("[Resolve] finalizeLeadOnConversationResolve error:", e.message);
          }
        }

        // Snapshot das tags da conversa NO PROTOCOLO ATUAL (não fechado) ANTES de deletar
        // a tabela conversation_situation_tags — preserva as situações ativas no momento
        // do encerramento DESTE atendimento.
        //
        // Bug histórico (Bruno 2026-05-11): a query original NÃO filtrava status e
        // copiava as tags em TODOS os protocolos da conversa (incluindo fechados há
        // semanas), causando vazamento massivo. Agora limita ao protocolo ATIVO —
        // tags são por atendimento, presas ao protocolo que as gerou.
        try {
          const existingTags = await db
            .select({ code: conversationSituationTags.situationCode })
            .from(conversationSituationTags)
            .where(eq(conversationSituationTags.conversationId, id));
          if (existingTags.length > 0) {
            const codes = [...new Set(existingTags.map(t => t.code))];
            const activeProtos = await db
              .select({ id: protocols.id, tags: protocols.tags })
              .from(protocols)
              .where(and(
                eq(protocols.conversationId, id),
                eq(protocols.workspaceId, wsId),
                inArray(protocols.status, ['aberto', 'em_andamento']),
              ));
            for (const pr of activeProtos) {
              const current = (pr.tags as string[] | null) || [];
              const merged = [...new Set([...current, ...codes])];
              if (merged.length !== current.length) {
                await db.update(protocols).set({ tags: merged, updatedAt: new Date() }).where(eq(protocols.id, pr.id));
              }
            }
          }
        } catch (e: any) { console.error("[Resolve] tag snapshot error:", e.message); }

        // Limpezas em paralelo
        await Promise.allSettled([
          convPhone && wsId
            ? db.delete(automationPendingInputs).where(and(eq(automationPendingInputs.phone, convPhone), eq(automationPendingInputs.workspaceId, wsId)))
            : Promise.resolve(),
          (async () => {
            try { const { invalidateLearningCache } = await import("../services/ai-learning"); invalidateLearningCache(wsId); } catch {}
          })(),
          db.delete(conversationSituationTags).where(eq(conversationSituationTags.conversationId, id)).catch((e: any) => console.error("[Resolve] tags cleanup:", e.message)),
          // ISP removido: o reset de identidade da sessão (isp_session_state) e a
          // limpeza de conversation_turns saíram com o módulo ISP — ambas as
          // tabelas foram dropadas. A finalização de métricas de sessão também.
        ]);

        // ISP removido: o fechamento de protocolo ativo via protocol.service
        // (closeConvProtocol + auto-CSAT) saiu com o módulo ISP. Mantemos a
        // criação direta de um protocolo FECHADO na tabela `protocols` (que
        // segue no schema) pra registrar o encerramento do atendimento.
        let createdProtocol: any = null;
        try {
          const numero = await generateProtocolNumber(db);
          const protoValues: any = {
            workspaceId: wsId, numero,
            titulo: `Atendimento ${conv.nome || conv.telefone || ""}`.trim(),
            categoria: "atendimento", prioridade: resolvedPrioridade,
            status: "fechado", conversationId: id,
            contactId: (conv as any).contactId || null,
            agenteId: userId, agenteNome: userName,
            criadoPorId: userId, criadoPorNome: userName,
            createdAt: conv.createdAt ? new Date(conv.createdAt as any) : new Date(),
            resolvedAt, closedAt: resolvedAt,
          };
          if (observacao) { protoValues.descricao = observacao; protoValues.observacaoAtendente = observacao; }
          const [proto] = await db.insert(protocols).values(protoValues).returning();
          createdProtocol = proto;
          console.log(`[Protocol] Created new #${proto.numero} for conv ${id} (${resolvedPrioridade})`);
          if (observacao) {
            try {
              const { protocolEvents } = await import("@shared/schema");
              await db.insert(protocolEvents).values({ workspaceId: wsId, protocolId: proto.id, tipo: "observacao", descricao: observacao, usuarioNome: userName });
            } catch {}
          }
          broadcastToWorkspace(wsId, "protocol_created", { protocol: proto });
        } catch (e: any) { console.error("[Protocol] Close/create failed:", e.message); }

        // Prioridade sync (leads + protocols) em paralelo com Kanban archival
        await Promise.allSettled([
          (async () => {
            if (!prioridade || !["alta", "media", "baixa"].includes(prioridade)) return;
            const ops: Promise<any>[] = [];
            if (conv.telefone) ops.push(db.update(leads).set({ prioridade } as any).where(and(eq(leads.telefone, conv.telefone), eq(leads.workspaceId, wsId))));
            ops.push(db.update(protocols).set({ prioridade, updatedAt: new Date() }).where(eq(protocols.conversationId, id)));
            await Promise.allSettled(ops);
          })(),
          (async () => {
            const KANBAN_KEEP_PATTERNS = ["aguardando", "atendimento_humano",
              // compatibilidade com etapas antigas não migradas
              "instalacao_agendada", "visita_tecnica"];
            const keepInKanban = finalEtapa && KANBAN_KEEP_PATTERNS.some(p => finalEtapa.toLowerCase().includes(p));
            // Só arquiva se sabemos a etapa final E ela é uma etapa terminal (ex: finalizado, resolvido, etc.)
            // Se finalEtapa for null (conversa sem etapa definida), não arquiva para evitar remoção indevida
            const ARCHIVE_PATTERNS = ["finalizado", "resolvido", "ativado", "perdido", "escalado", "cancelado", "inadimplente", "fechado", "instalado", "pago", "regularizado"];
            const isTerminalEtapa = finalEtapa && ARCHIVE_PATTERNS.some(p => finalEtapa.toLowerCase().includes(p));
            if (isTerminalEtapa && !keepInKanban && conv.telefone && (conv as any).pipeline) {
              const convPipeline = ((conv as any).pipeline as string).toLowerCase();
              await db.update(leads)
                .set({ archivedAt: new Date(), archivalReason: "conversa_resolvida" })
                .where(and(eq(leads.workspaceId, wsId), eq(leads.telefone, conv.telefone), sql`LOWER(${leads.pipeline}) = ${convPipeline}`))
                .catch((e: any) => console.error("[Resolve] Kanban archival failed:", e.message));
              console.log(`[Resolve] Lead arquivado do Kanban para conv ${id} (etapa terminal: ${finalEtapa})`);
            } else if (!finalEtapa) {
              console.log(`[Resolve] Lead NÃO arquivado para conv ${id} — sem pipelineEtapa definido`);
            }
          })(),
        ]);

        // ISP removido: o envio automático da mensagem de despedida usava o
        // ispSendService (n8nSendService), que saiu com o módulo ISP. O protocolo
        // de encerramento continua sendo criado acima; só o disparo da mensagem
        // de WhatsApp foi removido.
      });
      return; // já respondeu acima
    } else if (status === "open") {
      updates.resolvedAt = null;
    }
    await db.update(conversations).set(updates).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));
    broadcastToWorkspace(wsId, "conversation_updated", {
      conversationId: id,
      id,
      status: updates.status,
      agente: null,
      assigned_user_id: null,
      assigned_user_name: null,
      assigned_team_id: null,
      pipeline: null,
      pipeline_etapa: null,
      tags: null,
      prioridade: null,
    });
    res.json({ ok: true });
  });

  app.patch("/api/conversations/:id/reopen", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { db } = await import("../db");
    const { conversations: convTable } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    // Bruno 2026-05-17: reopen manual = humano assumindo. Atribui ao próprio
    // usuário (mesma semântica do /claim) e pausa IA, pra cair em "Em andamento"
    // do dashboard em vez de "Na automação".
    const reopeningUser = await storage.getUser(req.user!.id);
    const assignedUserId = reopeningUser?.id ?? null;
    const assignedUserName = reopeningUser?.nome ?? null;
    const reopenedAt = new Date();
    await db.update(convTable).set({
      status: "open",
      resolvedAt: null,
      assignedUserId,
      assignedUserName,
      aiPaused: true,
      // Reabertura = novo atendimento → reseta timer da sessão.
      attendingStartedAt: reopenedAt,
      updatedAt: reopenedAt,
    }).where(and(eq(convTable.id, id), eq(convTable.workspaceId, wsId)));
    broadcastToWorkspace(wsId, "conversation_updated", {
      conversationId: id,
      status: "open",
      pendente: false,
      assigned_user_id: assignedUserId,
      assigned_user_name: assignedUserName,
      aiPaused: true,
    });
    logConversationMovement({
      workspaceId: wsId,
      conversationId: id,
      kind: 'reopen',
      trigger: 'human',
      actorUserId: req.user?.id ?? null,
      actorUserName: req.user?.nome ?? null,
      data: {
        fromStatus: 'resolved',
        toStatus: 'open',
        assignedUserId,
        assignedUserName,
      },
    });
    // De-archive the lead when conversation is reopened
    try {
      const { leads: leadsTable } = await import("@shared/schema");
      if (conv.telefone) {
        await db.update(leadsTable)
          .set({ archivedAt: null, archivalReason: null })
          .where(and(eq(leadsTable.workspaceId, wsId), eq(leadsTable.telefone, conv.telefone)));
      }
    } catch {}
    res.json({ ok: true, message: "Conversa reaberta" });
  });

  app.patch("/api/conversations/:id/prioridade", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { prioridade } = req.body;
    if (prioridade !== null && !["alta", "media", "baixa"].includes(prioridade)) return res.status(400).json({ message: "Prioridade invalida" });
    const { db } = await import("../db");
    const { conversations } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    await db.update(conversations).set({ prioridade: prioridade || null, updatedAt: new Date() }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));
    // ISP removido: a sincronização do protocolo ativo (protocol.service) saiu
    // com o módulo ISP. A prioridade da conversa segue persistida acima.
    res.json({ ok: true });
  });

  // Bruno 2026-05-20: typing indicator entre atendentes. Quando atendente A
  // está digitando no composer, broadcast pra workspace pra outros atendentes
  // que estão vendo a mesma conversa ouvirem o evento e mostrarem "X está
  // digitando…". TTL no frontend (3s desde último evento). Sem persistência —
  // só side-channel via WS.
  app.post("/api/conversations/:id/typing", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const userId = req.user!.id;
    const userName = (req.user as any).nome || (req.user as any).email || "Atendente";
    try {
      broadcastToWorkspace(wsId, "user_typing", {
        conversationId: id,
        userId,
        userName,
        at: Date.now(),
      });
    } catch {}
    res.json({ ok: true });
  });

  app.patch("/api/conversations/:id/ai-paused", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { aiPaused } = req.body;
    const { db } = await import("../db");
    const { conversations } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    await db.update(conversations).set({ aiPaused: !!aiPaused, updatedAt: new Date() }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));
    broadcastToWorkspace(wsId, "conversation_updated", { id, aiPaused: !!aiPaused });
    res.json({ ok: true });
  });

  app.patch("/api/conversations/:id/pipeline-etapa", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { pipelineEtapa } = req.body;
    const { db } = await import("../db");
    const { conversations, leads } = await import("@shared/schema");
    const { eq, and, sql: sqlFn } = await import("drizzle-orm");
    await db.update(conversations).set({ pipelineEtapa: pipelineEtapa || null }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));

    // Sincroniza lead.status pelo telefone+pipeline (Inbox → Kanban)
    // Usa LOWER() nos dois lados para ser case-insensitive (dado legado pode ter "Financeiro" vs "financeiro")
    if (pipelineEtapa && conv.telefone && (conv as any).pipeline) {
      const convPipelineLower = ((conv as any).pipeline as string).toLowerCase();
      db.update(leads)
        .set({ status: pipelineEtapa, archivedAt: null, archivalReason: null })
        .where(and(
          eq(leads.workspaceId, wsId),
          eq(leads.telefone, conv.telefone),
          sqlFn`LOWER(${leads.pipeline}) = ${convPipelineLower}`
        ))
        .catch((err: any) => console.error('[ConvSync] Erro ao sincronizar lead.status:', err.message));

      // Também atualiza conversations.pipeline para pipelineKey normalizado (corrige dado legado)
      db.update(conversations)
        .set({ pipeline: convPipelineLower })
        .where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)))
        .catch(() => {});
    }

    res.json({ ok: true });
  });

  app.patch("/api/conversations/:id/read", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const { db } = await import("../db");
    const { conversations: convTable } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const userId = req.user!.id;

    if (conv.assignedUserId && conv.assignedUserId !== userId) {
      await db.update(convTable).set({ unread: 0, pendente: false, lastOperatorViewAt: new Date() })
        .where(and(eq(convTable.id, id), eq(convTable.workspaceId, wsId)));
      return res.json({
        ok: true,
        warning: `Esta conversa está atribuída a ${conv.assignedUserName || 'outro atendente'}`,
        assignedTo: conv.assignedUserName,
      });
    }

    const updates: any = { unread: 0, pendente: false, lastOperatorViewAt: new Date() };
    await db.update(convTable).set(updates).where(and(eq(convTable.id, id), eq(convTable.workspaceId, wsId)));

    res.json({ ok: true });
  });

  app.patch("/api/conversations/:id/transfer", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    const currentUser = await storage.getUser(req.user!.id);
    if (conv.assignedUserId && conv.assignedUserId !== req.user!.id && currentUser?.role !== "admin") {
      return res.status(403).json({ message: "Apenas o atendente atual pode transferir esta conversa" });
    }
    const { targetUserId } = req.body;
    if (!targetUserId && targetUserId !== null) return res.status(400).json({ message: "targetUserId obrigatorio" });
    const { db } = await import("../db");
    const { conversations: convTable } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    if (targetUserId === null) {
      // Humano LIBEROU a conversa — reativa IA automaticamente.
      // Bruno 2026-05-15: simétrico ao claim/assign que pausa IA.
      // Bruno 2026-05-19 (conv 202605190008): pipelineEtapa também precisa
      // voltar pra em_automacao. Sem isso, o guard isAgentBlockedByStage
      // continua bloqueando (regra absoluta: atendimento_humano = bot trava).
      // Liberação é a ÚNICA forma manual de o bot voltar a responder após
      // entrar em atendimento humano.
      await db.update(convTable).set({
        assignedUserId: null,
        assignedUserName: null,
        aiPaused: false,
        // Limpa rastros de transferência manual — release zera o histórico.
        transferredFromUserId: null,
        transferredFromUserName: null,
        transferredAt: null,
      }).where(and(eq(convTable.id, id), eq(convTable.workspaceId, wsId)));
      // Move pipelineEtapa pra em_automacao_<setor> via transição oficial —
      // mantém o Kanban consistente (card volta pra coluna "Em Automação"
      // do setor atual).
      try {
        const { transitionStage } = await import("../services/pipelineStateMachine");
        await transitionStage(wsId, id, "em_automacao", "release");
      } catch (e: any) {
        console.warn(`[release] pipeline transition err: ${e?.message}`);
      }
      // ISP removido: o tracking de transição humano → bot no protocolo
      // (protocolBucketTracker) saiu com o módulo ISP.
      try {
        broadcastToWorkspace(wsId, "conversation_updated", {
          conversationId: id,
          assigned_user_id: null,
          assigned_user_name: null,
          aiPaused: false,
        });
      } catch {}
      logConversationMovement({
        workspaceId: wsId,
        conversationId: id,
        kind: 'assigned_user_change',
        trigger: 'human',
        actorUserId: req.user?.id ?? null,
        actorUserName: req.user?.nome ?? null,
        data: {
          action: 'release',
          fromUserId: conv.assignedUserId ?? null,
          fromUserName: conv.assignedUserName ?? null,
          toUserId: null,
          toUserName: null,
          aiPaused: false,
        },
      });
      res.json({ ok: true, message: "Conversa liberada — IA reativada" });
    } else {
      const targetUser = await storage.getUser(targetUserId);
      // Anti cross-tenant: users.id é serial global e getUser não filtra por
      // workspace — sem este cross-check dava pra transferir a conversa pra um
      // usuário de OUTRO tenant (vaza nome alheio + enumeração de id).
      if (!targetUser || (targetUser.workspaceId && targetUser.workspaceId !== wsId)) return res.status(404).json({ message: "Usuario nao encontrado" });
      // Bruno 2026-05-19: rastreia quem transferiu pra exibir ícone no card
      // "recebida de [A]" pro atendente que recebe. Limpa em release/resolved
      // ou em nova transferência (cadeia A→B→C: novo registro substitui).
      const fromUserId = req.user!.id;
      const fromUserName = currentUser?.nome || null;
      const transferredAtNow = new Date();
      await db.update(convTable).set({
        assignedUserId: targetUser.id,
        assignedUserName: targetUser.nome,
        // Bruno 2026-05-15: transferência pra outro humano mantém IA pausada.
        aiPaused: true,
        transferredFromUserId: fromUserId,
        transferredFromUserName: fromUserName,
        transferredAt: transferredAtNow,
      }).where(and(eq(convTable.id, id), eq(convTable.workspaceId, wsId)));
      // ISP removido: cancelamento de auto-close (informationalResolveService)
      // saiu com o módulo ISP.
      try {
        broadcastToWorkspace(wsId, "conversation_updated", {
          conversationId: id,
          assigned_user_id: targetUser.id,
          assigned_user_name: targetUser.nome,
          aiPaused: true,
          transferred_from_user_id: fromUserId,
          transferred_from_user_name: fromUserName,
          transferred_at: transferredAtNow.toISOString(),
        });
      } catch {}
      logConversationMovement({
        workspaceId: wsId,
        conversationId: id,
        kind: 'transfer_to_user',
        trigger: 'human',
        actorUserId: fromUserId,
        actorUserName: fromUserName,
        data: {
          fromUserId,
          fromUserName,
          toUserId: targetUser.id,
          toUserName: targetUser.nome,
          aiPaused: true,
        },
      });
      res.json({ ok: true, message: `Conversa transferida para ${targetUser.nome}` });
    }
  });

  app.delete("/api/conversations/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });

    if (conv.telefone && (conv.canal === "Instagram" || conv.canal === "instagram" || conv.canal === "instagram_dm")) {
      await db.update(instaProspectSessions)
        .set({ status: "finalizado", updatedAt: new Date() })
        .where(and(
          eq(instaProspectSessions.igUserId, conv.telefone),
          eq(instaProspectSessions.workspaceId, wsId),
        ))
        .returning();
    }

    // ─── Limpeza completa de tabelas relacionadas antes de remover ──────────
    try {
      await db.delete(conversationSituationTags).where(eq(conversationSituationTags.conversationId, id));
      console.log(`[Remove] Situation tags cleared for conversation ${id}`);
    } catch (e: any) { console.error("[Remove] Situation tags cleanup failed:", e.message); }
    // ISP removido: isp_session_state e conversation_turns (dropadas) eram limpas
    // aqui junto com a conversa. Saíram com o módulo ISP.
    try {
      if (conv.telefone && (conv as any).pipeline) {
        const convPipeline = ((conv as any).pipeline as string).toLowerCase();
        await db.update(leads)
          .set({ archivedAt: new Date(), archivalReason: "conversa_removida" })
          .where(and(
            eq(leads.workspaceId, wsId),
            eq(leads.telefone, conv.telefone),
            sql`LOWER(${leads.pipeline}) = ${convPipeline}`
          ));
        console.log(`[Remove] Lead arquivado do Kanban para conv ${id}`);
      }
    } catch (e: any) { console.error("[Remove] Kanban archival failed:", e.message); }
    // ISP removido: o flush de métricas de sessão (agents/sessionMetrics) saiu
    // com o módulo ISP.

    await storage.deleteConversation(id, wsId);
    broadcastToWorkspace(wsId, "conversation_removed", { id });
    res.json({ ok: true });
  });

  app.get("/api/conversations/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    res.json({ ok: true, data: conv });
  });

  app.get("/api/conversations/:id/historico", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    const conv = await storage.getConversation(id, wsId);
    if (!conv) return res.status(404).json({ message: "Conversa nao encontrada" });
    // internal - sem paginação intencional (histórico completo para estatísticas)
    const msgs = await storage.getMessages(id, { limit: 10000 });
    const outMsgs = msgs.filter((m: any) => m.direction === "out");
    const totalMessages = msgs.length;
    const respostasAtendente = outMsgs.length;
    const convCreated = conv.createdAt ? new Date(conv.createdAt) : new Date();
    const now = new Date();
    const diffMs = now.getTime() - convCreated.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    let tempoAberto = "";
    if (diffMins < 60) tempoAberto = `${diffMins}min`;
    else if (diffMins < 1440) tempoAberto = `${Math.floor(diffMins / 60)}h ${diffMins % 60}min`;
    else tempoAberto = `${Math.floor(diffMins / 1440)}d ${Math.floor((diffMins % 1440) / 60)}h`;
    let tempoMedioResp = "—";
    if (msgs.length > 1) {
      let totalRespTime = 0;
      let respCount = 0;
      let lastInTime = 0;
      for (const m of msgs) {
        const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        if (!t) continue;
        if (m.direction === "in") { lastInTime = t; }
        else if (m.direction === "out" && lastInTime > 0) {
          const gap = t - lastInTime;
          if (gap > 0 && gap < 86400000) { totalRespTime += gap; respCount++; }
          lastInTime = 0;
        }
      }
      if (respCount > 0) {
        const avgMs = totalRespTime / respCount;
        const avgMin = Math.floor(avgMs / 60000);
        const avgSec = Math.floor((avgMs % 60000) / 1000);
        if (avgMin >= 60) tempoMedioResp = `${Math.floor(avgMin / 60)}h ${avgMin % 60}min`;
        else tempoMedioResp = `${avgMin}min ${avgSec}s`;
      }
    }
    const timeline: { tipo: string; titulo: string; subtitulo: string; data: string; cor: string }[] = [];
    timeline.push({ tipo: "conversa_aberta", titulo: "Conversa iniciada", subtitulo: conv.canal || "WhatsApp", data: conv.createdAt ? new Date(conv.createdAt).toISOString() : now.toISOString(), cor: "#10b981" });
    if (msgs.length > 0) {
      const firstMsg = msgs[0];
      timeline.push({ tipo: "primeira_mensagem", titulo: firstMsg.direction === "in" ? "Primeira mensagem recebida" : "Primeira mensagem enviada", subtitulo: (firstMsg.texto || "").substring(0, 50) + ((firstMsg.texto || "").length > 50 ? "..." : ""), data: firstMsg.createdAt ? new Date(firstMsg.createdAt).toISOString() : conv.createdAt ? new Date(conv.createdAt).toISOString() : now.toISOString(), cor: "#3b82f6" });
    }
    if ((conv as any).agente) {
      timeline.push({ tipo: "atendente_atribuido", titulo: `Atendente atribuido: ${(conv as any).agente}`, subtitulo: "Atribuicao", data: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : now.toISOString(), cor: "#8b5cf6" });
    }
    const convTags = (conv as any).tags || [];
    for (const tag of convTags) {
      timeline.push({ tipo: "tag_adicionada", titulo: `Tag "${tag}" adicionada`, subtitulo: "Conversa", data: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : now.toISOString(), cor: "#f59e0b" });
    }
    try {
      // internal - sem paginação intencional (busca lead matching por nome/telefone)
      const allLeads = await storage.getLeads(wsId, { limit: 10000 });
      const convNomeDigits = (conv.nome || "").replace(/\D/g, "");
      const matchedLead = allLeads.find((l: any) => {
        if (l.nome === conv.nome || l.contato === conv.nome) return true;
        if (l.telefone && convNomeDigits.length >= 8 && l.telefone.replace(/\D/g, "") === convNomeDigits) return true;
        if (l.telefone && conv.nome && l.telefone.replace(/\D/g, "").endsWith(convNomeDigits) && convNomeDigits.length >= 10) return true;
        return false;
      });
      if (matchedLead) {
        const allStages = await storage.getPipelineStages(wsId);
        const stage = allStages.find((s: any) => s.key === matchedLead.status);
        timeline.push({ tipo: "pipeline_stage", titulo: `Pipeline: ${stage?.label || matchedLead.status}`, subtitulo: matchedLead.pipeline ? `Pipeline ${matchedLead.pipeline}` : "Vendas", data: matchedLead.createdAt ? new Date(matchedLead.createdAt).toISOString() : now.toISOString(), cor: stage?.color || "#a78bfa" });
        if (matchedLead.owner) {
          timeline.push({ tipo: "lead_owner", titulo: `Responsavel: ${matchedLead.owner}`, subtitulo: "Lead", data: matchedLead.createdAt ? new Date(matchedLead.createdAt).toISOString() : now.toISOString(), cor: "#06b6d4" });
        }
        if (matchedLead.valor && Number(matchedLead.valor) > 0) {
          timeline.push({ tipo: "lead_valor", titulo: `Valor: R$ ${Number(matchedLead.valor).toLocaleString("pt-BR")}`, subtitulo: "Lead", data: matchedLead.createdAt ? new Date(matchedLead.createdAt).toISOString() : now.toISOString(), cor: "#10b981" });
        }
        const leadTags = matchedLead.tags || [];
        for (const tag of leadTags) {
          timeline.push({ tipo: "lead_tag", titulo: `Tag "${tag}" no lead`, subtitulo: "Lead CRM", data: matchedLead.createdAt ? new Date(matchedLead.createdAt).toISOString() : now.toISOString(), cor: "#ef4444" });
        }
      }
    } catch (e: any) { console.error("[Conversations] timeline lead enrichment failed:", e.message); }
    if ((conv as any).assignedUserName) {
      timeline.push({ tipo: "atendente_responsavel", titulo: `Atendido por: ${(conv as any).assignedUserName}`, subtitulo: "Responsavel pelo atendimento", data: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : now.toISOString(), cor: "#8b5cf6" });
    }
    if (conv.status === "resolved") {
      const resolvedBy = (conv as any).assignedUserName || (conv as any).agente || null;
      timeline.push({ tipo: "conversa_resolvida", titulo: "Conversa resolvida", subtitulo: resolvedBy ? `Resolvida por ${resolvedBy}` : "Status", data: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : now.toISOString(), cor: "#6b7280" });
    }
    if (msgs.length > 1) {
      const lastMsg = msgs[msgs.length - 1];
      timeline.push({ tipo: "ultima_mensagem", titulo: lastMsg.direction === "in" ? "Ultima mensagem recebida" : "Ultima mensagem enviada", subtitulo: (lastMsg.texto || "").substring(0, 50) + ((lastMsg.texto || "").length > 50 ? "..." : ""), data: lastMsg.createdAt ? new Date(lastMsg.createdAt).toISOString() : now.toISOString(), cor: "#58B4F2" });
    }
    timeline.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
    res.json({ ok: true, stats: { totalMessages, tempoAberto, respostasAtendente, tempoMedioResp }, timeline });
  });

  // ── ROTA 1: Atribuir equipe ──────────────────────────────────────────────
  app.post("/api/conversations/:id/assign-team", requireAuth, async (req, res) => {
    try {
      const id = parseId(((req.params.id as string) as string));
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const wsId = await resolveWorkspaceId(req);
      const { team_id, team_name, pipeline_etapa } = req.body;

      if (!team_id || !team_name) {
        return res.status(400).json({ error: "team_id e team_name são obrigatórios" });
      }

      const conv = await storage.getConversation(id, wsId);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

      if ((conv as any).assignedTeamId === team_id) {
        return res.json({ success: true, unchanged: true });
      }

      // Busca pipelineKey da equipe (lowercase) para evitar mismatch com leads.pipeline
      const { teams: teamsTableA } = await import("@shared/schema");
      const teamRowsA = await db.select({ pipelineKey: teamsTableA.pipelineKey }).from(teamsTableA).where(eq(teamsTableA.id, team_id)).limit(1);
      const pipelineKeyA = teamRowsA[0]?.pipelineKey ?? team_name.toLowerCase();

      const setData: Record<string, any> = {
        assignedTeamId: team_id,
        pipeline: pipelineKeyA,
        updatedAt: new Date(),
      };
      if (pipeline_etapa) setData.pipelineEtapa = pipeline_etapa;

      await db.update(conversations)
        .set(setData)
        .where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));

      await insertMessageWithProtocol({
        conversationId: id,
        workspaceId: wsId,
        direction: "system",
        tipo: "system",
        texto: `🔀 Conversa atribuída à equipe ${team_name} pelo agente`,
        status: "sent",
      });

      try {
        broadcastToWorkspace(wsId, "conversation_updated", {
          conversationId: id,
          assigned_team_id: team_id,
          team_name,
          pipeline: pipelineKeyA,
        });
      } catch {}

      // Cria/mantém o card na primeira etapa do pipeline instantaneamente
      try {
        const phone = (conv as any).telefone || (conv as any).phone || '';
        const contactName = (conv as any).nome || (conv as any).name || phone;
        if (phone && ['suporte', 'financeiro', 'comercial'].includes(pipelineKeyA)) {
          const { upsertLeadAtFirstStage } = await import('../services/suportePipelineService');
          await upsertLeadAtFirstStage({
            workspaceId: wsId,
            conversationId: id,
            phone,
            contactName,
            pipelineKey: pipelineKeyA,
          });
        }
      } catch (pipeErr: any) {
        console.error('[assign-team] upsertLeadAtFirstStage error (non-fatal):', pipeErr.message);
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("[assign-team]", error);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  // ── ROTA 2: Atendente assume a conversa ─────────────────────────────────
  app.post("/api/conversations/:id/assume", requireAuth, async (req, res) => {
    try {
      const id = parseId(((req.params.id as string) as string));
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const wsId = await resolveWorkspaceId(req);

      const conv = await storage.getConversation(id, wsId);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

      const userId = req.user!.id;
      // Bruno 2026-05-21: takeover por admin foi descontinuado. Admin agora
      // entra como espectador + manda mensagem interna (ver /api/chat-interno).
      // Atendente original NÃO perde mais a conversa. Qualquer tentativa de
      // assumir conv que já tem dono diferente segue retornando 409.
      const cleanName = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
      if (conv.assignedUserId && conv.assignedUserId !== userId) {
        return res.status(409).json({
          error: `Conversa já está sendo atendida por ${cleanName(conv.assignedUserName)}`,
        });
      }

      const claimingUser = await storage.getUser(userId);
      if (!claimingUser) return res.status(404).json({ error: "Usuário não encontrado" });
      const claimingNome = cleanName(claimingUser.nome);

      // Bruno 2026-05-21: guard de team membership. Regra de produto:
      //  - admin/gerente SEM nenhuma equipe → modo espectador, não assume
      //    conversa (mas continua mandando nota interna por outra rota);
      //  - admin/gerente COM equipes → só assume conversa cuja
      //    assignedTeamId pertença a uma das suas equipes (ou sem equipe).
      // Atendentes comuns sem equipe já são filtrados na listagem (GET /api/
      // conversations:117) e por consistência também caem nesse guard.
      const MANAGER_ROLES = ["admin", "superadmin", "manager", "gerente", "Gerente"];
      const claimingIsManager = MANAGER_ROLES.includes(claimingUser.role ?? "");
      const userTeamRows = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId));
      const userTeamIds = userTeamRows.map(r => r.teamId);
      if (userTeamIds.length === 0) {
        return res.status(403).json({
          error: claimingIsManager
            ? "Você precisa estar cadastrado em pelo menos uma equipe pra assumir conversas. Acesse Configurações → Equipe & Workspace."
            : "Você não está em nenhuma equipe. Peça pro administrador te adicionar.",
        });
      }
      if (conv.assignedTeamId && !userTeamIds.includes(conv.assignedTeamId)) {
        return res.status(403).json({
          error: "Você não é membro da equipe responsável por esta conversa.",
        });
      }

      // Bruno 2026-05-21: paridade com /assume-with-team — pausa IA E move
      // pipelineEtapa pra atendimento_humano_<setor>. Bug recorrente: /assume
      // só setava assignedUserId, deixando aiPaused=false e pipelineEtapa em
      // "em_automacao_*". Resultado: bot mid-flight conseguia escapar do guard
      // (race) OU caminhos de re-classificação (reassignOnSectorChange etc.)
      // não viam sinal forte de "humano assumiu" e zeravam assignedUserId →
      // conv voltava pra coluna "Em Automação" e bot respondia.
      // Defesa em profundidade: aiPaused + pipelineEtapa + assignedUserId.
      await db.update(conversations).set({
        assignedUserId: claimingUser.id,
        assignedUserName: claimingNome,
        aiPaused: true,
        pendente: false,
        updatedAt: new Date(),
      }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));

      // Resolve pipelineKey pra mover pipelineEtapa via helper canônico.
      // Prioridade: conv.pipeline → team.pipelineKey → undefined (onEscalate
      // resolve via session/fallback).
      let pipelineKeyForEscalate: string | undefined = (conv as any).pipeline?.toLowerCase() || undefined;
      if (!pipelineKeyForEscalate && conv.assignedTeamId) {
        try {
          const { teams: teamsTbl } = await import("@shared/schema");
          const trows = await db.select({ pipelineKey: teamsTbl.pipelineKey })
            .from(teamsTbl).where(eq(teamsTbl.id, conv.assignedTeamId)).limit(1);
          if (trows[0]?.pipelineKey) pipelineKeyForEscalate = trows[0].pipelineKey;
        } catch {}
      }
      try {
        const { onEscalateToHumano } = await import("../services/pipelineStateMachine");
        await onEscalateToHumano(wsId, id, pipelineKeyForEscalate);
      } catch (e: any) {
        console.warn(`[assume] onEscalateToHumano err: ${e?.message}`);
      }

      // ISP removido: o tracking de transição bot → humano no protocolo
      // (protocolBucketTracker) saiu com o módulo ISP.

      await insertMessageWithProtocol({
        conversationId: id,
        workspaceId: wsId,
        direction: "system",
        tipo: "system",
        texto: `✅ ${claimingNome} assumiu o atendimento`,
        status: "sent",
      });

      try {
        broadcastToWorkspace(wsId, "conversation_updated", {
          conversationId: id,
          assigned_user_id: claimingUser.id,
          assigned_user_name: claimingNome,
          aiPaused: true,
          pendente: false,
        });
      } catch {}

      return res.json({ success: true, agente: claimingNome });
    } catch (error) {
      console.error("[assume]", error);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  // ── ROTA 2.5: Atribuir equipe + assumir + mover pipeline (atômico) ──────
  // Bruno 2026-05-21: combina /assign-team + /assume + transição de pipeline
  // em uma única chamada. Antes o front fazia 2 POSTs separados — se o
  // /assume falhasse silenciosamente (ex: 403 por team membership), a conv
  // ficava com setor atribuído MAS sem atendente assumido, e o usuário
  // precisava clicar "Assumir atendimento" novamente.
  //
  // Aqui o usuário atribui A SI MESMO + à equipe num único ato:
  //  - assignedTeamId = team_id
  //  - assignedUserId = req.user.id
  //  - pipeline = pipelineKey da equipe
  //  - pipelineEtapa = atendimento_humano_<setor>
  //  - aiPaused = true
  //  - pendente = false
  //
  // NÃO exige team membership porque a ação é "atribuir A MIM" — se o user
  // pode operar a conv (já passa por requireAuth), pode também se atribuir.
  app.post("/api/conversations/:id/assume-with-team", requireAuth, async (req, res) => {
    try {
      const id = parseId(((req.params.id as string) as string));
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const wsId = await resolveWorkspaceId(req);
      const { team_id, team_name } = req.body;

      if (!team_id || !team_name) {
        return res.status(400).json({ error: "team_id e team_name são obrigatórios" });
      }

      const conv = await storage.getConversation(id, wsId);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

      const userId = req.user!.id;
      const cleanName = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

      // Não toma conv de outro atendente
      if (conv.assignedUserId && conv.assignedUserId !== userId) {
        return res.status(409).json({
          error: `Conversa já está sendo atendida por ${cleanName(conv.assignedUserName)}`,
        });
      }

      const claimingUser = await storage.getUser(userId);
      if (!claimingUser) return res.status(404).json({ error: "Usuário não encontrado" });
      const claimingNome = cleanName(claimingUser.nome);

      // Resolve pipelineKey da equipe alvo
      const { teams: teamsTableX } = await import("@shared/schema");
      const teamRowsX = await db.select({ pipelineKey: teamsTableX.pipelineKey })
        .from(teamsTableX).where(eq(teamsTableX.id, team_id)).limit(1);
      const pipelineKeyX = teamRowsX[0]?.pipelineKey ?? team_name.toLowerCase();

      // Update atômico — TUDO de uma vez
      await db.update(conversations).set({
        assignedTeamId: team_id,
        assignedUserId: claimingUser.id,
        assignedUserName: claimingNome,
        pipeline: pipelineKeyX,
        aiPaused: true,
        pendente: false,
        updatedAt: new Date(),
      }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));

      // Move pipelineEtapa pra atendimento_humano_<setor> via helper canônico
      try {
        const { onEscalateToHumano } = await import("../services/pipelineStateMachine");
        await onEscalateToHumano(wsId, id, pipelineKeyX);
      } catch (e: any) {
        console.warn(`[assume-with-team] onEscalateToHumano err: ${e?.message}`);
      }

      // ISP removido: o tracking de transição bot → humano no protocolo
      // (protocolBucketTracker) saiu com o módulo ISP.

      // Msg system única ("X assumiu como equipe Y")
      await insertMessageWithProtocol({
        conversationId: id,
        workspaceId: wsId,
        direction: "system",
        tipo: "system",
        texto: `✅ ${claimingNome} assumiu o atendimento (equipe ${team_name})`,
        status: "sent",
      });

      // Cria/mantém lead no pipeline destino
      try {
        const phone = (conv as any).telefone || (conv as any).phone || '';
        const contactName = (conv as any).nome || (conv as any).name || phone;
        if (phone && ['suporte', 'financeiro', 'comercial'].includes(pipelineKeyX)) {
          const { upsertLeadAtFirstStage } = await import('../services/suportePipelineService');
          await upsertLeadAtFirstStage({
            workspaceId: wsId,
            conversationId: id,
            phone,
            contactName,
            pipelineKey: pipelineKeyX,
          });
        }
      } catch (pipeErr: any) {
        console.warn('[assume-with-team] upsertLeadAtFirstStage err:', pipeErr.message);
      }

      try {
        broadcastToWorkspace(wsId, "conversation_updated", {
          conversationId: id,
          assigned_team_id: team_id,
          team_name,
          assigned_user_id: claimingUser.id,
          assigned_user_name: claimingNome,
          pipeline: pipelineKeyX,
          aiPaused: true,
          pendente: false,
        });
      } catch {}

      return res.json({ success: true, agente: claimingNome, team_name });
    } catch (error: any) {
      console.error("[assume-with-team]", error);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  // ── ROTA 3: Transferir para outra equipe ────────────────────────────────
  app.post("/api/conversations/:id/transfer-team", requireAuth, async (req, res) => {
    try {
      const id = parseId(((req.params.id as string) as string));
      if (!id) return res.status(400).json({ error: "ID inválido" });
      const wsId = await resolveWorkspaceId(req);
      const { team_id, team_name, motivo } = req.body;

      if (!team_id || !team_name) {
        return res.status(400).json({ error: "team_id e team_name são obrigatórios" });
      }

      const conv = await storage.getConversation(id, wsId);
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

      // Busca pipelineKey da equipe (lowercase) para evitar mismatch com leads.pipeline
      const { teams: teamsTable } = await import("@shared/schema");
      const teamRows = await db.select({ pipelineKey: teamsTable.pipelineKey }).from(teamsTable).where(eq(teamsTable.id, team_id)).limit(1);
      const pipelineKey = teamRows[0]?.pipelineKey ?? team_name.toLowerCase();

      // Bruno 2026-05-21 (print conv 202605200002): REGRA ABSOLUTA — transferir
      // SEMPRE manda pra FILA (etapa atendimento_humano sem assignedUserId).
      // Antes setávamos pipelineEtapa=firstStage (geralmente "novo"), o card
      // caía na coluna "Novo"/"Em Automação" do destino. Atendente que recebeu
      // a transferência não via o card na fila e o bot podia voltar a responder
      // se algum guard falhasse.
      //
      // Fix combinado:
      //   - aiPaused=true  → bloqueia bot (isAgentBlockedByStage também bloqueia
      //                       quando prefix === 'atendimento_humano')
      //   - assignedUserId=null → fica em fila
      //   - pipelineEtapa = atendimento_humano_<setor> (via onEscalateToHumano)
      await db.update(conversations).set({
        assignedTeamId: team_id,
        pipeline: pipelineKey,
        aiPaused: true,
        assignedUserId: null,
        assignedUserName: null,
        pendente: true,
        updatedAt: new Date(),
      }).where(and(eq(conversations.id, id), eq(conversations.workspaceId, wsId)));

      // Move pipelineEtapa pra atendimento_humano_<setor> via helper oficial
      // (mapeia pra key com sufixo correto: atendimento_humano_com/sup/fin).
      try {
        const { onEscalateToHumano } = await import("../services/pipelineStateMachine");
        await onEscalateToHumano(wsId, id, pipelineKey);
      } catch (e: any) {
        console.warn(`[transfer-team] onEscalateToHumano err: ${e?.message}`);
      }

      const msg = motivo
        ? `🔀 Transferido para equipe ${team_name}. Motivo: ${motivo}`
        : `🔀 Transferido para equipe ${team_name}`;

      await insertMessageWithProtocol({
        conversationId: id,
        workspaceId: wsId,
        direction: "system",
        tipo: "system",
        texto: msg,
        status: "sent",
      });

      try {
        broadcastToWorkspace(wsId, "conversation_updated", {
          conversationId: id,
          assigned_team_id: team_id,
          team_name,
          pipeline: pipelineKey,
          pendente: true,
          assigned_user_id: null,
          assigned_user_name: null,
          aiPaused: true,
        });
      } catch {}

      logConversationMovement({
        workspaceId: wsId,
        conversationId: id,
        kind: 'assigned_team_change',
        trigger: 'human',
        actorUserId: req.user?.id ?? null,
        actorUserName: req.user?.nome ?? null,
        data: {
          action: 'transfer_team',
          fromTeamId: (conv as any).assignedTeamId ?? null,
          toTeamId: team_id,
          toTeamName: team_name,
          pipeline: pipelineKey,
          motivo: motivo ?? null,
          aiPaused: true,
          assignedUserIdReset: true,
        },
      });

      return res.json({ success: true });
    } catch (error) {
      console.error("[transfer-team]", error);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

}
