// ═══════════════════════════════════════════════════════════════════════════
// Agenda — motor de horários livres + integração com o CRM (leads).
//
// Convenção de tempo (v1): os horários da agenda são "relógio de parede" (hora
// local do negócio, Brasil) guardados como TIMESTAMP UTC-naive — i.e. os dígitos
// 14:00 ficam 14:00 no banco, independente do fuso do servidor. Assim TODA a
// lógica (slots, sobreposição, faixas do dia) roda no mesmo espaço, sem drift.
// O fuso só entra num ponto: filtrar slots no passado (comparar com o "agora"
// real). O front exibe formatando em UTC (mostra o dígito guardado). Bruno 2026-07-11.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../db";
import { and, eq, ne, or, isNull, lt, gt, asc } from "drizzle-orm";
import { agendaServicos, agendaProfissionais, agendaDisponibilidade, agendaBloqueios, agendaAgendamentos, leads } from "@shared/schema";
import { storage } from "../storage";

const TZ = "America/Sao_Paulo";

// Offset (min) do fuso do negócio vs UTC — ex.: Brasil = -180. Dinâmico via Intl
// (cobre eventual mudança de regra), com fallback -180.
export function tzOffsetMin(at: Date = new Date(), tz = TZ): number {
  try {
    const p: any = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch { return -180; }
}

export function minutesOf(hhmm: string): number {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function fmtHHMM(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
// (data + minutos do dia) → Date UTC-naive guardando o relógio de parede.
export function wallDate(y: number, mo: number, d: number, min: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, Math.floor(min / 60), min % 60, 0, 0));
}

export interface SlotLivre { inicio: string; fim: string; hora: string; }

// Horários livres de UM profissional pra UM serviço numa data (YYYY-MM-DD):
// faixas de disponibilidade do dia da semana, fatiadas pela duração do serviço,
// menos bloqueios (folgas) e menos agendamentos já ocupados; e sem slots passados.
export async function computeSlotsLivres(opts: {
  workspaceId: string; profissionalId: number; servicoId: number; data: string;
}): Promise<SlotLivre[]> {
  const { workspaceId, profissionalId, servicoId, data } = opts;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data || "");
  if (!m) return [];
  const y = +m[1], mo = +m[2], d = +m[3];

  const [servico] = await db.select().from(agendaServicos)
    .where(and(eq(agendaServicos.id, servicoId), eq(agendaServicos.workspaceId, workspaceId)));
  if (!servico || !servico.ativo) return [];
  const dur = servico.duracaoMin || 30;

  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=dom … 6=sáb
  const ranges = await db.select().from(agendaDisponibilidade).where(and(
    eq(agendaDisponibilidade.workspaceId, workspaceId),
    eq(agendaDisponibilidade.profissionalId, profissionalId),
    eq(agendaDisponibilidade.diaSemana, weekday),
    eq(agendaDisponibilidade.ativo, true),
  ));
  if (!ranges.length) return [];

  const dayStart = wallDate(y, mo, d, 0), dayEnd = wallDate(y, mo, d, 24 * 60 - 1);
  const blocks = (await db.select().from(agendaBloqueios).where(and(
    eq(agendaBloqueios.workspaceId, workspaceId),
    lt(agendaBloqueios.inicio, dayEnd), gt(agendaBloqueios.fim, dayStart),
    or(isNull(agendaBloqueios.profissionalId), eq(agendaBloqueios.profissionalId, profissionalId)),
  ))).map(b => [b.inicio.getTime(), b.fim.getTime()] as [number, number]);

  const ocupados = (await db.select().from(agendaAgendamentos).where(and(
    eq(agendaAgendamentos.workspaceId, workspaceId),
    eq(agendaAgendamentos.profissionalId, profissionalId),
    ne(agendaAgendamentos.status, "cancelado"),
    lt(agendaAgendamentos.inicio, dayEnd), gt(agendaAgendamentos.fim, dayStart),
  ))).map(a => [a.inicio.getTime(), a.fim.getTime()] as [number, number]);

  const busy = [...blocks, ...ocupados];
  const nowWall = Date.now() + tzOffsetMin() * 60000; // "agora" no relógio de parede (UTC-naive ms)
  const seen = new Set<number>();
  const out: SlotLivre[] = [];

  for (const r of ranges) {
    const startMin = minutesOf(r.horaInicio), endMin = minutesOf(r.horaFim);
    for (let t = startMin; t + dur <= endMin; t += dur) {
      const ini = wallDate(y, mo, d, t);
      const fim = new Date(ini.getTime() + dur * 60000);
      const key = ini.getTime();
      if (seen.has(key)) continue;
      if (key < nowWall) continue;                                    // passado
      if (busy.some(([bs, be]) => key < be && fim.getTime() > bs)) continue; // ocupado
      seen.add(key);
      out.push({ inicio: ini.toISOString(), fim: fim.toISOString(), hora: fmtHHMM(t) });
    }
  }
  out.sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  return out;
}

// Verifica se um intervalo [inicio, fim) está livre pro profissional (checagem
// no momento de gravar, evita corrida entre "ver slots" e "agendar").
export async function intervaloLivre(opts: {
  workspaceId: string; profissionalId: number; inicio: Date; fim: Date; ignorarAgendamentoId?: number;
}): Promise<boolean> {
  const { workspaceId, profissionalId, inicio, fim, ignorarAgendamentoId } = opts;
  const blocks = await db.select().from(agendaBloqueios).where(and(
    eq(agendaBloqueios.workspaceId, workspaceId),
    lt(agendaBloqueios.inicio, fim), gt(agendaBloqueios.fim, inicio),
    or(isNull(agendaBloqueios.profissionalId), eq(agendaBloqueios.profissionalId, profissionalId)),
  ));
  if (blocks.length) return false;
  const ags = await db.select().from(agendaAgendamentos).where(and(
    eq(agendaAgendamentos.workspaceId, workspaceId),
    eq(agendaAgendamentos.profissionalId, profissionalId),
    ne(agendaAgendamentos.status, "cancelado"),
    lt(agendaAgendamentos.inicio, fim), gt(agendaAgendamentos.fim, inicio),
  ));
  const conflitos = ignorarAgendamentoId ? ags.filter(a => a.id !== ignorarAgendamentoId) : ags;
  return conflitos.length === 0;
}

// Liga o agendamento ao CRM: acha um lead pelo telefone ou cria um novo (best-effort).
export async function findOrCreateLeadForAgenda(workspaceId: string, nome: string, telefone?: string | null): Promise<number | null> {
  const tel = (telefone || "").replace(/\D/g, "");
  if (!tel) return null;
  try {
    const [byTel] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), eq(leads.telefone, tel))).limit(1);
    if (byTel) return byTel.id;
    const [byContato] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), eq(leads.contato, tel))).limit(1);
    if (byContato) return byContato.id;
    const lead = await storage.createLead({
      nome: nome || tel, contato: tel, telefone: tel, canal: "WhatsApp", source: "agenda", workspaceId,
    } as any);
    return lead?.id ?? null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Integração com o AGENTE (bot) — Fase 1: agendar de verdade pelo WhatsApp.
// "As duas": usa o serviço/profissional configurado no nó; se não houver, cai
// num alvo genérico ("Reunião" + um profissional padrão criado sob demanda com
// disponibilidade seg–sex 09–18). Assim funciona out-of-box e dá pra afinar.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_SERVICO_NOME = "Reunião";
const DEFAULT_PROF_NOME = "Atendimento";
const pidv = (v: any): number => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

export interface AgendaAlvo { servicoId: number; profissionalId: number; }

// Resolve (e cria se preciso) o serviço + profissional que o agente usa pra agendar.
export async function resolveAgendaAlvo(workspaceId: string, config: Record<string, any>): Promise<AgendaAlvo | null> {
  try {
    // ── serviço ──
    let servicoId = pidv(config?.agendaServicoId);
    if (servicoId) {
      const [s] = await db.select({ id: agendaServicos.id }).from(agendaServicos)
        .where(and(eq(agendaServicos.id, servicoId), eq(agendaServicos.workspaceId, workspaceId), eq(agendaServicos.ativo, true)));
      if (!s) servicoId = 0;
    }
    if (!servicoId) {
      const [ex] = await db.select({ id: agendaServicos.id }).from(agendaServicos)
        .where(and(eq(agendaServicos.workspaceId, workspaceId), eq(agendaServicos.nome, DEFAULT_SERVICO_NOME), eq(agendaServicos.ativo, true))).limit(1);
      if (ex) servicoId = ex.id;
      else {
        const [novo] = await db.insert(agendaServicos).values({ workspaceId, nome: DEFAULT_SERVICO_NOME, duracaoMin: 30, ativo: true }).returning({ id: agendaServicos.id });
        servicoId = novo.id;
      }
    }
    // ── profissional ──
    let profissionalId = pidv(config?.agendaProfissionalId);
    if (profissionalId) {
      const [p] = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais)
        .where(and(eq(agendaProfissionais.id, profissionalId), eq(agendaProfissionais.workspaceId, workspaceId), eq(agendaProfissionais.ativo, true)));
      if (!p) profissionalId = 0;
    }
    if (!profissionalId) {
      const [first] = await db.select({ id: agendaProfissionais.id }).from(agendaProfissionais)
        .where(and(eq(agendaProfissionais.workspaceId, workspaceId), eq(agendaProfissionais.ativo, true)))
        .orderBy(asc(agendaProfissionais.ordem)).limit(1);
      if (first) profissionalId = first.id;
      else {
        const [novo] = await db.insert(agendaProfissionais).values({ workspaceId, nome: DEFAULT_PROF_NOME, ativo: true }).returning({ id: agendaProfissionais.id });
        profissionalId = novo.id;
        // disponibilidade padrão: seg(1)–sex(5) 09:00–18:00, pra existir slot livre.
        await db.insert(agendaDisponibilidade).values([1, 2, 3, 4, 5].map(dia => ({
          workspaceId, profissionalId, diaSemana: dia, horaInicio: "09:00", horaFim: "18:00", ativo: true,
        })));
      }
    }
    return { servicoId, profissionalId };
  } catch {
    return null;
  }
}

// Resumo compacto dos horários livres REAIS nos próximos dias — injetado no prompt
// pra o agente oferecer só o que existe (anti-alucinação de horário).
export async function slotsResumoParaAgente(workspaceId: string, alvo: AgendaAlvo, dias = 7): Promise<string> {
  const DIAS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const hojeWall = new Date(Date.now() + tzOffsetMin() * 60000); // relógio de parede
  const linhas: string[] = [];
  let diasComVaga = 0;
  for (let i = 0; i < dias && diasComVaga < 5; i++) {
    const d = new Date(Date.UTC(hojeWall.getUTCFullYear(), hojeWall.getUTCMonth(), hojeWall.getUTCDate() + i));
    const dataStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const slots = await computeSlotsLivres({ workspaceId, profissionalId: alvo.profissionalId, servicoId: alvo.servicoId, data: dataStr });
    if (!slots.length) continue;
    diasComVaga++;
    const horas = slots.slice(0, 6).map(s => s.hora).join(", ");
    linhas.push(`${DIAS_PT[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}: ${horas}${slots.length > 6 ? "…" : ""}`);
  }
  return linhas.join("\n");
}

// Agenda de verdade via agente. dataStr = DD/MM/AAAA, horaStr = HH:MM (hora local).
export async function agendarViaAgente(opts: {
  workspaceId: string; alvo: AgendaAlvo; dataStr: string; horaStr: string; titulo: string;
  clienteNome: string; clienteTelefone?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { workspaceId, alvo, dataStr, horaStr, titulo, clienteNome, clienteTelefone } = opts;
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((dataStr || "").trim());
  const hm = /^(\d{1,2}):(\d{2})$/.exec((horaStr || "").trim());
  if (!dm || !hm) return { ok: false, error: "data/hora inválida" };
  const y = +dm[3], mo = +dm[2], d = +dm[1], hh = +hm[1], mi = +hm[2];
  const [servico] = await db.select().from(agendaServicos).where(and(eq(agendaServicos.id, alvo.servicoId), eq(agendaServicos.workspaceId, workspaceId)));
  if (!servico) return { ok: false, error: "serviço não encontrado" };
  const inicio = wallDate(y, mo, d, hh * 60 + mi);
  if (isNaN(+inicio)) return { ok: false, error: "data/hora inválida" };
  const fim = new Date(inicio.getTime() + (servico.duracaoMin || 30) * 60000);
  const livre = await intervaloLivre({ workspaceId, profissionalId: alvo.profissionalId, inicio, fim });
  if (!livre) return { ok: false, error: "horário ocupado" };
  const nome = (clienteNome || "").trim() || (clienteTelefone || "Cliente");
  const leadId = await findOrCreateLeadForAgenda(workspaceId, nome, clienteTelefone);
  await db.insert(agendaAgendamentos).values({
    workspaceId, servicoId: alvo.servicoId, profissionalId: alvo.profissionalId, leadId,
    clienteNome: nome, clienteTelefone: clienteTelefone || null,
    inicio, fim, status: "confirmado", origem: "bot", observacoes: (titulo || "").trim() || null,
  });
  return { ok: true };
}
