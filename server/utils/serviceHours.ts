import { tenantSettingsService } from '../services/tenantSettingsService';
import type { TenantSettingsJson } from '@shared/schema';

export interface ServiceHoursResult {
  enabled: boolean;
  withinHours: boolean;
  currentTime: string;
  timezone: string;
  schedule?: { start: string; end: string } | null;
  dayType: 'weekday' | 'saturday' | 'sunday';
  isHoliday?: boolean;
  holidayBehavior?: 'closed' | 'open' | 'emergency';
  emergencyChannel?: string;
  nextOpen?: string | null;
}

const WEEKDAY_LABELS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTH_LABELS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

function isTimeBetween(now: Date, start: string, end: string, tz: string): boolean {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const currentTotal = currentHour * 60 + currentMinute;

  const s = parseTime(start);
  const e = parseTime(end);
  const startTotal = s.hours * 60 + s.minutes;
  const endTotal = e.hours * 60 + e.minutes;

  return currentTotal >= startTotal && currentTotal < endTotal;
}

function getDayType(now: Date, tz: string): 'weekday' | 'saturday' | 'sunday' {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  });
  const dayName = formatter.format(now);
  if (dayName === 'Sun') return 'sunday';
  if (dayName === 'Sat') return 'saturday';
  return 'weekday';
}

function getCurrentTimeFormatted(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

function getDateISOInTz(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  const d = parts.find(p => p.type === 'day')?.value || '';
  return `${y}-${m}-${d}`;
}

function getDayOfWeekInTz(now: Date, tz: string): number {
  const wk = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wk] ?? 0;
}

function dayTypeFromDow(dow: number): 'weekday' | 'saturday' | 'sunday' {
  if (dow === 0) return 'sunday';
  if (dow === 6) return 'saturday';
  return 'weekday';
}

function isHolidayOn(dateISO: string, holidays?: string[]): boolean {
  if (!holidays || holidays.length === 0) return false;
  const mmdd = dateISO.slice(5);
  return holidays.some(h => h === dateISO || h === mmdd);
}

function scheduleForDayType(sh: any, dt: 'weekday' | 'saturday' | 'sunday'): { start: string; end: string } | null {
  if (dt === 'weekday') return sh.weekdays ?? null;
  if (dt === 'saturday') return sh.saturday && sh.saturday.start && sh.saturday.end ? sh.saturday : null;
  return sh.sunday && sh.sunday.start && sh.sunday.end ? sh.sunday : null;
}

function formatRelativeDayPt(targetISO: string, todayISO: string, targetDow: number): string {
  const diffDays = daysBetween(todayISO, targetISO);
  if (diffDays === 0) return 'hoje';
  if (diffDays === 1) return 'amanhã';
  if (diffDays >= 2 && diffDays <= 6) return WEEKDAY_LABELS_PT[targetDow];
  const [y, m, d] = targetISO.split('-').map(Number);
  return `${d} de ${MONTH_LABELS_PT[m - 1]}`;
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00Z').getTime();
  const b = new Date(bISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentMinutesInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return h * 60 + m;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function computeNextOpen(sh: any, now: Date): string | null {
  if (!sh?.enabled) return null;
  const tz = sh.timezone || 'America/Sao_Paulo';
  const todayISO = getDateISOInTz(now, tz);
  const currentMin = currentMinutesInTz(now, tz);
  const behavior: 'closed' | 'open' | 'emergency' = sh.holidayBehavior ?? 'closed';

  for (let offset = 0; offset < 14; offset++) {
    const dateISO = addDaysISO(todayISO, offset);
    const probe = new Date(dateISO + 'T12:00:00Z');
    const dow = getDayOfWeekInTz(probe, tz);
    const dt = dayTypeFromDow(dow);
    const schedule = scheduleForDayType(sh, dt);
    if (!schedule) continue;

    const holiday = isHolidayOn(dateISO, sh.holidays);
    if (holiday && behavior !== 'open') continue;

    const startMin = timeToMinutes(schedule.start);
    if (offset === 0 && currentMin >= startMin) {
      continue;
    }

    const relative = formatRelativeDayPt(dateISO, todayISO, dow);
    return `${relative} as ${schedule.start}`;
  }
  return null;
}

export function checkServiceHoursFromSettings(settings: TenantSettingsJson): ServiceHoursResult {
  // Bruno 2026-05-26 (audit P0 #1): se tenant não configurou serviceHours,
  // settings.serviceHours vem undefined. Acessar .enabled direto crashava com
  // "Cannot read properties of undefined (reading 'enabled')" — visto no log
  // de conv 859. Fix: tratar como enabled=false (sempre disponível).
  const sh = settings?.serviceHours;
  if (!sh || !sh.enabled) {
    // Bruno 2026-05-30 (iter 55): sh pode ser undefined (tenant sem serviceHours
    // configurado) — acessar sh.timezone crasha. Fallback fixo.
    return {
      enabled: false,
      withinHours: true,
      currentTime: '',
      timezone: sh?.timezone || 'America/Sao_Paulo',
      dayType: 'weekday',
    };
  }

  const now = new Date();
  const tz = sh.timezone || 'America/Sao_Paulo';
  const dayType = getDayType(now, tz);
  const currentTime = getCurrentTimeFormatted(now, tz);
  const todayISO = getDateISOInTz(now, tz);
  const holidayBehavior: 'closed' | 'open' | 'emergency' = sh.holidayBehavior ?? 'closed';
  const isHoliday = isHolidayOn(todayISO, sh.holidays);
  const nextOpen = computeNextOpen(sh, now);

  if (isHoliday && holidayBehavior !== 'open') {
    console.log(`[Service Hours] Holiday detected on ${todayISO} — behavior=${holidayBehavior}`);
    return {
      enabled: true, withinHours: false, currentTime, timezone: tz, schedule: null, dayType,
      isHoliday: true, holidayBehavior, emergencyChannel: sh.emergencyChannel, nextOpen,
    };
  }

  let schedule: { start: string; end: string } | null = null;
  if (dayType === 'weekday') {
    schedule = sh.weekdays;
  } else if (dayType === 'saturday') {
    schedule = sh.saturday || null;
  } else {
    schedule = sh.sunday || null;
  }

  if (!schedule) {
    console.log(`[Service Hours] Outside business hours — no schedule for ${dayType} (${currentTime} ${tz})`);
    return {
      enabled: true, withinHours: false, currentTime, timezone: tz, schedule: null, dayType,
      isHoliday: false, holidayBehavior, emergencyChannel: sh.emergencyChannel, nextOpen,
    };
  }

  const withinHours = isTimeBetween(now, schedule.start, schedule.end, tz);

  if (withinHours) {
    console.log(`[Service Hours] In business hours — ${dayType} ${currentTime} (${schedule.start}-${schedule.end} ${tz})`);
  } else {
    console.log(`[Service Hours] Outside business hours — ${dayType} ${currentTime} (${schedule.start}-${schedule.end} ${tz}) — next=${nextOpen}`);
  }

  return {
    enabled: true, withinHours, currentTime, timezone: tz, schedule, dayType,
    isHoliday: false, holidayBehavior, emergencyChannel: sh.emergencyChannel, nextOpen,
  };
}

export async function isWithinServiceHours(workspaceId: string): Promise<ServiceHoursResult> {
  try {
    const settings = await tenantSettingsService.getTenantSettings(workspaceId);
    return checkServiceHoursFromSettings(settings);
  } catch (err: any) {
    console.error(`[Service Hours] Error checking hours:`, err.message);
    return {
      enabled: false,
      withinHours: true,
      currentTime: '',
      timezone: 'America/Sao_Paulo',
      dayType: 'weekday',
    };
  }
}

// Formata serviceHours como texto humano pra repassar ao cliente — usado
// no FAQ q173 (horário do atendimento humano) e em prompts dos agentes.
// Ex.: "Seg a Sex das 8h às 18h • Sáb das 8h às 12h • Dom fechado"
export function formatServiceHoursAsText(sh: TenantSettingsJson['serviceHours'] | null | undefined): string {
  if (!sh || !sh.enabled) return '';

  const parts: string[] = [];
  const fmt = (t: string): string => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    if (m && m > 0) return `${h}h${String(m).padStart(2, '0')}`;
    return `${h}h`;
  };

  if (sh.weekdays?.start && sh.weekdays?.end) {
    parts.push(`Seg a Sex das ${fmt(sh.weekdays.start)} às ${fmt(sh.weekdays.end)}`);
  }
  if (sh.saturday?.start && sh.saturday?.end) {
    parts.push(`Sáb das ${fmt(sh.saturday.start)} às ${fmt(sh.saturday.end)}`);
  } else {
    parts.push('Sáb fechado');
  }
  if (sh.sunday?.start && sh.sunday?.end) {
    parts.push(`Dom das ${fmt(sh.sunday.start)} às ${fmt(sh.sunday.end)}`);
  } else {
    parts.push('Dom fechado');
  }

  // Plantão de urgência fora do horário (se houver canal de emergência)
  if (sh.holidayBehavior === 'emergency' && sh.emergencyChannel) {
    parts.push(`Plantão de urgência: ${sh.emergencyChannel}`);
  }

  return parts.join(' • ');
}

// Deriva o nível de atendimento em fim de semana a partir dos campos do
// serviceHours — alimenta q172/suporteFimDeSemana automaticamente.
export function deriveSuporteFimDeSemana(
  sh: TenantSettingsJson['serviceHours'] | null | undefined,
): 'sim_sab' | 'sim_sab_dom' | 'somente_urgencia' | 'nao' {
  if (!sh || !sh.enabled) return 'nao';
  const temSab = !!(sh.saturday?.start && sh.saturday?.end);
  const temDom = !!(sh.sunday?.start && sh.sunday?.end);
  if (temSab && temDom) return 'sim_sab_dom';
  if (temSab) return 'sim_sab';
  if (sh.holidayBehavior === 'emergency' && sh.emergencyChannel) return 'somente_urgencia';
  return 'nao';
}
