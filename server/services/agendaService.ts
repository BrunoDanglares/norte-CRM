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
import { and, eq, ne, or, isNull, lt, gt } from "drizzle-orm";
import { agendaServicos, agendaDisponibilidade, agendaBloqueios, agendaAgendamentos, leads } from "@shared/schema";
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
