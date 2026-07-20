// ═══════════════════════════════════════════════════════════════════════════
// Agenda (agendamentos) — rotas do painel (autenticadas). Módulo genérico
// multi-segmento: serviços + profissionais + disponibilidade + folgas →
// agendamentos, tudo isolado por workspace_id. Motor de slots em
// services/agendaService.ts. A página pública de agendamento vem na Fase 2.
// Bruno 2026-07-11.
// ═══════════════════════════════════════════════════════════════════════════

import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId } from "../utils/helpers";
import { db } from "../db";
import { and, eq, gte, lt, asc, inArray } from "drizzle-orm";
import {
  agendaServicos, agendaProfissionais, agendaServicoProfissional,
  agendaDisponibilidade, agendaBloqueios, agendaAgendamentos,
} from "@shared/schema";
import { computeSlotsLivres, intervaloLivre, findOrCreateLeadForAgenda } from "../services/agendaService";

const STATUS_VALIDOS = ["pendente", "confirmado", "concluido", "cancelado", "faltou"];
const pid = (v: any) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const cleanIds = (a: any): number[] => Array.isArray(a) ? [...new Set(a.map(pid).filter(Boolean))] : [];
const qDate = (v: any): Date | null => { const d = new Date(String(v)); return isNaN(+d) ? null : d; };
const precoCent = (v: any): number | null => { if (v == null) return null; const p = Math.round(Number(v)); return Number.isFinite(p) ? Math.max(0, p) : null; };

export function registerAgendaRoutes(app: Express) {
  // ── Serviço ↔ profissional (N:N) ────────────────────────────────────────
  async function syncServicoProfissionais(wsId: string, servicoId: number, profissionalIds: number[]) {
    await db.delete(agendaServicoProfissional).where(and(
      eq(agendaServicoProfissional.workspaceId, wsId), eq(agendaServicoProfissional.servicoId, servicoId)));
    const ids = cleanIds(profissionalIds);
    if (!ids.length) return;
    const valid = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais)
      .where(and(eq(agendaProfissionais.workspaceId, wsId), inArray(agendaProfissionais.id, ids)));
    const ok = valid.map(v => v.id);
    if (ok.length) await db.insert(agendaServicoProfissional).values(
      ok.map(profId => ({ workspaceId: wsId, servicoId, profissionalId: profId })));
  }
  async function syncProfissionalServicos(wsId: string, profissionalId: number, servicoIds: number[]) {
    await db.delete(agendaServicoProfissional).where(and(
      eq(agendaServicoProfissional.workspaceId, wsId), eq(agendaServicoProfissional.profissionalId, profissionalId)));
    const ids = cleanIds(servicoIds);
    if (!ids.length) return;
    const valid = await db.select({ id: agendaServicos.id }).from(agendaServicos)
      .where(and(eq(agendaServicos.workspaceId, wsId), inArray(agendaServicos.id, ids)));
    const ok = valid.map(v => v.id);
    if (ok.length) await db.insert(agendaServicoProfissional).values(
      ok.map(sId => ({ workspaceId: wsId, servicoId: sId, profissionalId })));
  }

  // ── SERVIÇOS ─────────────────────────────────────────────────────────────
  app.get("/api/agenda/servicos", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const rows = await db.select().from(agendaServicos)
        .where(eq(agendaServicos.workspaceId, wsId)).orderBy(asc(agendaServicos.ordem), asc(agendaServicos.nome));
      const links = await db.select().from(agendaServicoProfissional).where(eq(agendaServicoProfissional.workspaceId, wsId));
      const byServico = new Map<number, number[]>();
      for (const l of links) { const arr = byServico.get(l.servicoId) || []; arr.push(l.profissionalId); byServico.set(l.servicoId, arr); }
      res.json(rows.map(s => ({ ...s, profissionalIds: byServico.get(s.id) || [] })));
    } catch (e: any) { console.error("[Agenda] servicos GET:", e?.message); res.status(500).json({ error: "Erro ao listar serviços" }); }
  });
  app.post("/api/agenda/servicos", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const b = req.body || {};
      if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: "Nome é obrigatório" });
      const [row] = await db.insert(agendaServicos).values({
        workspaceId: wsId, nome: String(b.nome).trim(),
        duracaoMin: Math.max(5, Math.min(600, Number(b.duracaoMin) || 30)),
        precoCentavos: precoCent(b.precoCentavos),
        cor: typeof b.cor === "string" ? b.cor : null,
        ativo: b.ativo === false ? false : true,
        ordem: Number.isInteger(b.ordem) ? b.ordem : 0,
      }).returning();
      await syncServicoProfissionais(wsId, row.id, b.profissionalIds);
      res.json(row);
    } catch (e: any) { console.error("[Agenda] servicos POST:", e?.message); res.status(500).json({ error: "Erro ao criar serviço" }); }
  });
  app.patch("/api/agenda/servicos/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      if (!id) return res.status(400).json({ error: "id inválido" });
      const [existe] = await db.select({ id: agendaServicos.id }).from(agendaServicos)
        .where(and(eq(agendaServicos.id, id), eq(agendaServicos.workspaceId, wsId)));
      if (!existe) return res.status(404).json({ error: "Serviço não encontrado" });
      const b = req.body || {}; const patch: any = {};
      if (typeof b.nome === "string" && b.nome.trim()) patch.nome = b.nome.trim();
      if (b.duracaoMin != null) patch.duracaoMin = Math.max(5, Math.min(600, Number(b.duracaoMin) || 30));
      if (b.precoCentavos !== undefined) patch.precoCentavos = precoCent(b.precoCentavos);
      if (b.cor !== undefined) patch.cor = typeof b.cor === "string" ? b.cor : null;
      if (typeof b.ativo === "boolean") patch.ativo = b.ativo;
      if (Number.isInteger(b.ordem)) patch.ordem = b.ordem;
      if (Object.keys(patch).length) await db.update(agendaServicos).set(patch)
        .where(and(eq(agendaServicos.id, id), eq(agendaServicos.workspaceId, wsId)));
      if (Array.isArray(b.profissionalIds)) await syncServicoProfissionais(wsId, id, b.profissionalIds);
      const [row] = await db.select().from(agendaServicos).where(and(eq(agendaServicos.id, id), eq(agendaServicos.workspaceId, wsId)));
      res.json(row || {});
    } catch (e: any) { console.error("[Agenda] servicos PATCH:", e?.message); res.status(500).json({ error: "Erro ao atualizar serviço" }); }
  });
  app.delete("/api/agenda/servicos/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      // arquiva (ativo=false) — preserva histórico de agendamentos que referenciam o serviço
      await db.update(agendaServicos).set({ ativo: false }).where(and(eq(agendaServicos.id, id), eq(agendaServicos.workspaceId, wsId)));
      res.json({ ok: true });
    } catch (e: any) { console.error("[Agenda] servicos DELETE:", e?.message); res.status(500).json({ error: "Erro ao remover serviço" }); }
  });

  // ── PROFISSIONAIS ──────────────────────────────────────────────────────────
  app.get("/api/agenda/profissionais", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const rows = await db.select().from(agendaProfissionais)
        .where(eq(agendaProfissionais.workspaceId, wsId)).orderBy(asc(agendaProfissionais.ordem), asc(agendaProfissionais.nome));
      const links = await db.select().from(agendaServicoProfissional).where(eq(agendaServicoProfissional.workspaceId, wsId));
      const disp = await db.select().from(agendaDisponibilidade).where(eq(agendaDisponibilidade.workspaceId, wsId));
      const svcByProf = new Map<number, number[]>();
      for (const l of links) { const arr = svcByProf.get(l.profissionalId) || []; arr.push(l.servicoId); svcByProf.set(l.profissionalId, arr); }
      const dispByProf = new Map<number, any[]>();
      for (const d of disp) { const arr = dispByProf.get(d.profissionalId) || []; arr.push(d); dispByProf.set(d.profissionalId, arr); }
      res.json(rows.map(p => ({ ...p, servicoIds: svcByProf.get(p.id) || [], disponibilidade: dispByProf.get(p.id) || [] })));
    } catch (e: any) { console.error("[Agenda] profissionais GET:", e?.message); res.status(500).json({ error: "Erro ao listar profissionais" }); }
  });
  app.post("/api/agenda/profissionais", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const b = req.body || {};
      if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: "Nome é obrigatório" });
      const [row] = await db.insert(agendaProfissionais).values({
        workspaceId: wsId, nome: String(b.nome).trim(),
        avatarUrl: typeof b.avatarUrl === "string" ? b.avatarUrl : null,
        cor: typeof b.cor === "string" ? b.cor : null,
        userId: pid(b.userId) || null,
        ativo: b.ativo === false ? false : true,
        ordem: Number.isInteger(b.ordem) ? b.ordem : 0,
      }).returning();
      if (Array.isArray(b.servicoIds)) await syncProfissionalServicos(wsId, row.id, b.servicoIds);
      res.json(row);
    } catch (e: any) { console.error("[Agenda] profissionais POST:", e?.message); res.status(500).json({ error: "Erro ao criar profissional" }); }
  });
  app.patch("/api/agenda/profissionais/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      if (!id) return res.status(400).json({ error: "id inválido" });
      const [existe] = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais)
        .where(and(eq(agendaProfissionais.id, id), eq(agendaProfissionais.workspaceId, wsId)));
      if (!existe) return res.status(404).json({ error: "Profissional não encontrado" });
      const b = req.body || {}; const patch: any = {};
      if (typeof b.nome === "string" && b.nome.trim()) patch.nome = b.nome.trim();
      if (b.avatarUrl !== undefined) patch.avatarUrl = typeof b.avatarUrl === "string" ? b.avatarUrl : null;
      if (b.cor !== undefined) patch.cor = typeof b.cor === "string" ? b.cor : null;
      if (b.userId !== undefined) patch.userId = pid(b.userId) || null;
      if (typeof b.ativo === "boolean") patch.ativo = b.ativo;
      if (Number.isInteger(b.ordem)) patch.ordem = b.ordem;
      if (Object.keys(patch).length) await db.update(agendaProfissionais).set(patch)
        .where(and(eq(agendaProfissionais.id, id), eq(agendaProfissionais.workspaceId, wsId)));
      if (Array.isArray(b.servicoIds)) await syncProfissionalServicos(wsId, id, b.servicoIds);
      const [row] = await db.select().from(agendaProfissionais).where(and(eq(agendaProfissionais.id, id), eq(agendaProfissionais.workspaceId, wsId)));
      res.json(row || {});
    } catch (e: any) { console.error("[Agenda] profissionais PATCH:", e?.message); res.status(500).json({ error: "Erro ao atualizar profissional" }); }
  });
  app.delete("/api/agenda/profissionais/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      await db.update(agendaProfissionais).set({ ativo: false }).where(and(eq(agendaProfissionais.id, id), eq(agendaProfissionais.workspaceId, wsId)));
      res.json({ ok: true });
    } catch (e: any) { console.error("[Agenda] profissionais DELETE:", e?.message); res.status(500).json({ error: "Erro ao remover profissional" }); }
  });

  // ── DISPONIBILIDADE (substitui em bloco a grade do profissional) ───────────
  app.put("/api/agenda/profissionais/:id/disponibilidade", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const profId = pid(req.params.id);
      if (!profId) return res.status(400).json({ error: "profissional inválido" });
      const [prof] = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais)
        .where(and(eq(agendaProfissionais.id, profId), eq(agendaProfissionais.workspaceId, wsId)));
      if (!prof) return res.status(404).json({ error: "profissional não encontrado" });
      const faixas: any[] = Array.isArray(req.body?.faixas) ? req.body.faixas : [];
      const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
      const validas = faixas.filter(f =>
        Number.isInteger(f?.diaSemana) && f.diaSemana >= 0 && f.diaSemana <= 6 &&
        HHMM.test(f?.horaInicio) && HHMM.test(f?.horaFim) && f.horaInicio < f.horaFim);
      await db.delete(agendaDisponibilidade).where(and(
        eq(agendaDisponibilidade.workspaceId, wsId), eq(agendaDisponibilidade.profissionalId, profId)));
      if (validas.length) await db.insert(agendaDisponibilidade).values(validas.map(f => ({
        workspaceId: wsId, profissionalId: profId, diaSemana: f.diaSemana,
        horaInicio: f.horaInicio, horaFim: f.horaFim, ativo: f.ativo === false ? false : true,
      })));
      const rows = await db.select().from(agendaDisponibilidade).where(and(
        eq(agendaDisponibilidade.workspaceId, wsId), eq(agendaDisponibilidade.profissionalId, profId)));
      res.json(rows);
    } catch (e: any) { console.error("[Agenda] disponibilidade PUT:", e?.message); res.status(500).json({ error: "Erro ao salvar disponibilidade" }); }
  });

  // ── BLOQUEIOS / FOLGAS ─────────────────────────────────────────────────────
  app.get("/api/agenda/bloqueios", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conds: any[] = [eq(agendaBloqueios.workspaceId, wsId)];
      const bi = qDate(req.query.inicio), bf = qDate(req.query.fim);
      if (bi) conds.push(gte(agendaBloqueios.inicio, bi));
      if (bf) conds.push(lt(agendaBloqueios.inicio, bf));
      const rows = await db.select().from(agendaBloqueios).where(and(...conds)).orderBy(asc(agendaBloqueios.inicio));
      res.json(rows);
    } catch (e: any) { console.error("[Agenda] bloqueios GET:", e?.message); res.status(500).json({ error: "Erro ao listar folgas" }); }
  });
  app.post("/api/agenda/bloqueios", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const b = req.body || {};
      const inicio = new Date(b.inicio), fim = new Date(b.fim);
      if (isNaN(+inicio) || isNaN(+fim) || fim <= inicio) return res.status(400).json({ error: "Período inválido" });
      const [row] = await db.insert(agendaBloqueios).values({
        workspaceId: wsId, profissionalId: pid(b.profissionalId) || null,
        inicio, fim, motivo: typeof b.motivo === "string" ? b.motivo : null,
      }).returning();
      res.json(row);
    } catch (e: any) { console.error("[Agenda] bloqueios POST:", e?.message); res.status(500).json({ error: "Erro ao criar folga" }); }
  });
  app.delete("/api/agenda/bloqueios/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      await db.delete(agendaBloqueios).where(and(eq(agendaBloqueios.id, id), eq(agendaBloqueios.workspaceId, wsId)));
      res.json({ ok: true });
    } catch (e: any) { console.error("[Agenda] bloqueios DELETE:", e?.message); res.status(500).json({ error: "Erro ao remover folga" }); }
  });

  // ── SLOTS LIVRES (motor) ───────────────────────────────────────────────────
  app.get("/api/agenda/slots", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const profissionalId = pid(req.query.profissionalId);
      const servicoId = pid(req.query.servicoId);
      const data = String(req.query.data || "");
      if (!profissionalId || !servicoId || !data) return res.status(400).json({ error: "profissionalId, servicoId e data são obrigatórios" });
      const slots = await computeSlotsLivres({ workspaceId: wsId, profissionalId, servicoId, data });
      res.json({ slots });
    } catch (e: any) { console.error("[Agenda] slots GET:", e?.message); res.status(500).json({ error: "Erro ao calcular horários" }); }
  });

  // ── AGENDAMENTOS ───────────────────────────────────────────────────────────
  // Lista por faixa (visão dia/semana). ?inicio=&fim= (ISO) [+profissionalId].
  app.get("/api/agenda/agendamentos", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const conds: any[] = [eq(agendaAgendamentos.workspaceId, wsId)];
      const ai = qDate(req.query.inicio), af = qDate(req.query.fim);
      if (ai) conds.push(gte(agendaAgendamentos.inicio, ai));
      if (af) conds.push(lt(agendaAgendamentos.inicio, af));
      if (req.query.profissionalId) conds.push(eq(agendaAgendamentos.profissionalId, pid(req.query.profissionalId)));
      const rows = await db.select({
        id: agendaAgendamentos.id, servicoId: agendaAgendamentos.servicoId, profissionalId: agendaAgendamentos.profissionalId,
        leadId: agendaAgendamentos.leadId, clienteNome: agendaAgendamentos.clienteNome, clienteTelefone: agendaAgendamentos.clienteTelefone,
        inicio: agendaAgendamentos.inicio, fim: agendaAgendamentos.fim, status: agendaAgendamentos.status,
        origem: agendaAgendamentos.origem, observacoes: agendaAgendamentos.observacoes,
        servicoNome: agendaServicos.nome, servicoCor: agendaServicos.cor, servicoDuracao: agendaServicos.duracaoMin,
        profNome: agendaProfissionais.nome, profCor: agendaProfissionais.cor,
      })
        .from(agendaAgendamentos)
        .leftJoin(agendaServicos, and(eq(agendaAgendamentos.servicoId, agendaServicos.id), eq(agendaServicos.workspaceId, wsId)))
        .leftJoin(agendaProfissionais, and(eq(agendaAgendamentos.profissionalId, agendaProfissionais.id), eq(agendaProfissionais.workspaceId, wsId)))
        .where(and(...conds)).orderBy(asc(agendaAgendamentos.inicio));
      res.json(rows);
    } catch (e: any) { console.error("[Agenda] agendamentos GET:", e?.message); res.status(500).json({ error: "Erro ao listar agendamentos" }); }
  });

  app.post("/api/agenda/agendamentos", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const b = req.body || {};
      const servicoId = pid(b.servicoId), profissionalId = pid(b.profissionalId);
      if (!servicoId || !profissionalId) return res.status(400).json({ error: "Serviço e profissional são obrigatórios" });
      if (!b.clienteNome || !String(b.clienteNome).trim()) return res.status(400).json({ error: "Nome do cliente é obrigatório" });
      const [servico] = await db.select().from(agendaServicos).where(and(eq(agendaServicos.id, servicoId), eq(agendaServicos.workspaceId, wsId)));
      if (!servico) return res.status(404).json({ error: "Serviço não encontrado" });
      const [prof] = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais).where(and(eq(agendaProfissionais.id, profissionalId), eq(agendaProfissionais.workspaceId, wsId)));
      if (!prof) return res.status(404).json({ error: "Profissional não encontrado" });
      const inicio = new Date(b.inicio);
      if (isNaN(+inicio)) return res.status(400).json({ error: "Início inválido" });
      const fim = new Date(inicio.getTime() + (servico.duracaoMin || 30) * 60000);
      const livre = await intervaloLivre({ workspaceId: wsId, profissionalId, inicio, fim });
      if (!livre) return res.status(409).json({ error: "Esse horário acabou de ficar indisponível. Escolha outro." });
      const telefone = typeof b.clienteTelefone === "string" ? b.clienteTelefone : null;
      const leadId = await findOrCreateLeadForAgenda(wsId, String(b.clienteNome).trim(), telefone);
      const [row] = await db.insert(agendaAgendamentos).values({
        workspaceId: wsId, servicoId, profissionalId, leadId,
        clienteNome: String(b.clienteNome).trim(), clienteTelefone: telefone,
        inicio, fim,
        status: STATUS_VALIDOS.includes(b.status) ? b.status : "confirmado",
        origem: ["manual", "publico", "bot"].includes(b.origem) ? b.origem : "manual",
        observacoes: typeof b.observacoes === "string" ? b.observacoes : null,
      }).returning();
      res.json(row);
    } catch (e: any) { console.error("[Agenda] agendamentos POST:", e?.message); res.status(500).json({ error: "Erro ao criar agendamento" }); }
  });

  app.patch("/api/agenda/agendamentos/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      if (!id) return res.status(400).json({ error: "id inválido" });
      const [atual] = await db.select().from(agendaAgendamentos).where(and(eq(agendaAgendamentos.id, id), eq(agendaAgendamentos.workspaceId, wsId)));
      if (!atual) return res.status(404).json({ error: "Agendamento não encontrado" });
      const b = req.body || {}; const patch: any = {};
      if (typeof b.status === "string" && STATUS_VALIDOS.includes(b.status)) patch.status = b.status;
      if (typeof b.observacoes === "string") patch.observacoes = b.observacoes;
      if (typeof b.clienteNome === "string" && b.clienteNome.trim()) patch.clienteNome = b.clienteNome.trim();
      if (b.clienteTelefone !== undefined) patch.clienteTelefone = typeof b.clienteTelefone === "string" ? b.clienteTelefone : null;

      // Remarcar (muda horário e/ou profissional e/ou serviço) → re-valida conflito.
      const novoProf = b.profissionalId !== undefined ? pid(b.profissionalId) : atual.profissionalId;
      const novoServico = b.servicoId !== undefined ? pid(b.servicoId) : atual.servicoId;
      const mudouTempoOuRecurso = b.inicio !== undefined || b.profissionalId !== undefined || b.servicoId !== undefined;
      // Reativar um cancelado (status→ativo) também re-checa conflito: enquanto cancelado
      // o slot fica livre e pode ter sido tomado por outro; sem isto, reativar dá double-book.
      const reativando = atual.status === "cancelado" && !!patch.status && patch.status !== "cancelado";
      if (mudouTempoOuRecurso || reativando) {
        const [servico] = await db.select().from(agendaServicos).where(and(eq(agendaServicos.id, novoServico), eq(agendaServicos.workspaceId, wsId)));
        if (!servico) return res.status(404).json({ error: "Serviço não encontrado" });
        // Valida posse do profissional (evita gravar FK de outro tenant / id inválido → 500).
        const [prof] = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais).where(and(eq(agendaProfissionais.id, novoProf), eq(agendaProfissionais.workspaceId, wsId)));
        if (!prof) return res.status(404).json({ error: "Profissional não encontrado" });
        const inicio = b.inicio !== undefined ? new Date(b.inicio) : atual.inicio;
        if (isNaN(+inicio)) return res.status(400).json({ error: "Início inválido" });
        const fim = new Date(inicio.getTime() + (servico.duracaoMin || 30) * 60000);
        const st = patch.status || atual.status;
        if (st !== "cancelado") {
          const livre = await intervaloLivre({ workspaceId: wsId, profissionalId: novoProf, inicio, fim, ignorarAgendamentoId: id });
          if (!livre) return res.status(409).json({ error: "Conflito de horário com outro agendamento/folga." });
        }
        patch.servicoId = novoServico; patch.profissionalId = novoProf; patch.inicio = inicio; patch.fim = fim;
      }
      if (Object.keys(patch).length) await db.update(agendaAgendamentos).set(patch)
        .where(and(eq(agendaAgendamentos.id, id), eq(agendaAgendamentos.workspaceId, wsId)));
      const [row] = await db.select().from(agendaAgendamentos).where(and(eq(agendaAgendamentos.id, id), eq(agendaAgendamentos.workspaceId, wsId)));
      res.json(row || {});
    } catch (e: any) { console.error("[Agenda] agendamentos PATCH:", e?.message); res.status(500).json({ error: "Erro ao atualizar agendamento" }); }
  });

  app.delete("/api/agenda/agendamentos/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const wsId = await resolveWorkspaceId(req); const id = pid(req.params.id);
      await db.delete(agendaAgendamentos).where(and(eq(agendaAgendamentos.id, id), eq(agendaAgendamentos.workspaceId, wsId)));
      res.json({ ok: true });
    } catch (e: any) { console.error("[Agenda] agendamentos DELETE:", e?.message); res.status(500).json({ error: "Erro ao remover agendamento" }); }
  });
}
