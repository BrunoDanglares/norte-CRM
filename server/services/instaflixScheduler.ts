// ═══════════════════════════════════════════════════════════════════════════
// Instaflix — Schedulers (o "tudo automatizado").
//
//   PUBLICADOR (60s): claim atômico de posts 'agendado' vencidos → publica.
//   GERADOR  (10min): pra cada regra de agenda ativa, gera o rascunho do próximo
//                     slot quando ele entra na janela de antecedência.
//
// Padrão do projeto: setInterval com flag de re-entrância (se um tick demora mais
// que o intervalo, o próximo é ignorado). Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

import {
  getActiveRules, getBrandKit, getPillarById, getPostByRuleSlot,
  createPost, getActiveConnection, claimPostsParaPublicar,
  recuperarPublicacoesPresas, recuperarGeracoesPresas, publicarPostAgora,
} from "./instaflixService";
import { gerarRascunhoPost } from "./instaflixStudio";
import { refreshInstagramTokens } from "./instagramTokenRefresh";

let _started = false;
let _pubRunning = false;
let _genRunning = false;
let _refreshRunning = false;

const MAX_GERADOS_POR_TICK = 3; // limita geração de imagem por tick (custo/rate)

// ── Timezone: converte horário de parede da regra → instante UTC (sem lib) ────
// Offset (ms) entre o relógio de parede da timezone e o UTC real, no instante `date`.
function tzOffsetMs(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const p: any = {};
    for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
    const hour = +p.hour === 24 ? 0 : +p.hour;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
    return asUTC - date.getTime();
  } catch {
    return 0; // timezone inválida → trata como UTC
  }
}

// Horário de parede (Y-M-D H:MI) numa timezone → instante UTC (Date).
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const ts = guess - tzOffsetMs(new Date(guess - tzOffsetMs(new Date(guess), timeZone)), timeZone);
  return new Date(ts);
}

// Data de calendário "hoje + addDays" na timezone (ao meio-dia UTC pra evitar borda).
function calendarioNaTz(now: Date, timeZone: string, addDays: number): { y: number; mo: number; d: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const p: any = {};
  for (const part of dtf.formatToParts(now)) p[part.type] = part.value;
  const cd = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + addDays, 12));
  return { y: cd.getUTCFullYear(), mo: cd.getUTCMonth() + 1, d: cd.getUTCDate(), dow: cd.getUTCDay() };
}

// Próximo instante (UTC) que casa com dias+horários da regra NA TIMEZONE dela e
// cai na janela [agora, agora+janelaHoras]. null se nenhum.
export function proximoSlot(
  diasSemana: number[], horarios: string[], janelaHoras: number,
  timeZone = "America/Sao_Paulo", now = new Date(),
): Date | null {
  if (!Array.isArray(diasSemana) || !diasSemana.length) return null;
  if (!Array.isArray(horarios) || !horarios.length) return null;
  const limite = now.getTime() + janelaHoras * 3_600_000;
  let melhor: Date | null = null;
  for (let add = 0; add <= 8; add++) {
    const cal = calendarioNaTz(now, timeZone, add);
    if (!diasSemana.includes(cal.dow)) continue;
    for (const h of horarios) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(h).trim());
      if (!m) continue;
      const slot = zonedToUtc(cal.y, cal.mo, cal.d, Number(m[1]), Number(m[2]), timeZone);
      const t = slot.getTime();
      if (t > now.getTime() && t <= limite && (!melhor || t < melhor.getTime())) melhor = slot;
    }
  }
  return melhor;
}

// ── PUBLICADOR ───────────────────────────────────────────────────────────────
async function tickPublicador() {
  if (_pubRunning) return;
  _pubRunning = true;
  try {
    await recuperarPublicacoesPresas(10);
    await recuperarGeracoesPresas(3);   // gerações órfãs (>3min sem progresso) → 'falhou'
    const claimed = await claimPostsParaPublicar();
    if (claimed.length) console.log(`[Instaflix][Publicador] ${claimed.length} post(s) para publicar`);
    for (const post of claimed) {
      const r = await publicarPostAgora(post);
      console.log(`[Instaflix][Publicador] post=${post.id} → ${r.ok ? `publicado (${r.mediaId})` : `falhou: ${r.error}`}`);
    }
  } catch (e: any) {
    console.error(`[Instaflix][Publicador] erro no tick: ${e?.message || e}`);
  } finally {
    _pubRunning = false;
  }
}

// ── GERADOR ──────────────────────────────────────────────────────────────────
async function tickGerador() {
  if (_genRunning) return;
  _genRunning = true;
  try {
    const rules = await getActiveRules();
    let gerados = 0;
    for (const rule of rules) {
      if (gerados >= MAX_GERADOS_POR_TICK) break;

      const dias = Array.isArray(rule.diasSemana) ? (rule.diasSemana as number[]) : [];
      const horarios = Array.isArray(rule.horarios) ? (rule.horarios as string[]) : [];
      const tz = rule.timezone || "America/Sao_Paulo";
      const slot = proximoSlot(dias, horarios, rule.antecedenciaHoras ?? 24, tz);
      if (!slot) continue;

      // Dedup: já geramos o post desse slot?
      if (await getPostByRuleSlot(rule.id, slot)) continue;

      try {
        const brandKit = await getBrandKit(rule.workspaceId);
        const pillar = rule.pillarId ? await getPillarById(rule.pillarId, rule.workspaceId) : null;
        const conn = rule.instagramConnectionId
          ? { id: rule.instagramConnectionId }
          : await getActiveConnection(rule.workspaceId);

        const rascunho = await gerarRascunhoPost({
          workspaceId: rule.workspaceId,
          brandKit,
          pillar,
          formato: rule.formato === "imagem" ? "imagem" : "carrossel",
          numImagens: rule.numImagens ?? 3,
          // Dia da semana do CONTEÚDO = dia da PUBLICAÇÃO (slot), não da geração.
          dataAlvo: slot,
          timeZone: tz,
        });

        await createPost({
          workspaceId: rule.workspaceId,
          instagramConnectionId: conn?.id ?? null,
          ruleId: rule.id,
          pillarId: pillar?.id ?? null,
          formato: rascunho.formato,
          tema: rascunho.tema,
          briefIa: rascunho.briefIa,
          legenda: rascunho.legenda,
          hashtags: rascunho.hashtags,
          midias: rascunho.midias,
          approvalMode: rule.approvalMode,
          // auto_post → já entra na fila de publicação; senão, aguarda aprovação humana.
          status: rule.approvalMode === "auto_post" ? "agendado" : "aguardando_aprovacao",
          scheduledAt: slot,
          geradoPor: "ia",
        });
        gerados++;
        console.log(`[Instaflix][Gerador] rascunho criado (regra="${rule.nome}", slot=${slot.toISOString()}, modo=${rule.approvalMode})`);
      } catch (e: any) {
        console.error(`[Instaflix][Gerador] falha ao gerar (regra=${rule.id}): ${e?.message || e}`);
      }
    }
  } catch (e: any) {
    console.error(`[Instaflix][Gerador] erro no tick: ${e?.message || e}`);
  } finally {
    _genRunning = false;
  }
}

// ── REFRESH DE TOKEN (1x/dia) ────────────────────────────────────────────────
async function tickRefreshTokens() {
  if (_refreshRunning) return;
  _refreshRunning = true;
  try {
    const r = await refreshInstagramTokens();
    if (r.renovados || r.validos || r.falhas) {
      console.log(`[Instaflix][TokenRefresh] checados=${r.checados} renovados=${r.renovados} validos=${r.validos} falhas=${r.falhas}`);
    }
  } catch (e: any) {
    console.error(`[Instaflix][TokenRefresh] erro: ${e?.message || e}`);
  } finally {
    _refreshRunning = false;
  }
}

// Bruno 2026-07-08: postagens RECORRENTES (gerador automático de rascunhos +
// publicador automático no horário) DESLIGADAS por enquanto. O fluxo é 100% MANUAL:
// gerar no Estúdio + "Publicar agora" no post selecionado. Pra religar tudo, é só
// voltar esta constante pra `true` (o código continua todo aqui).
const RECORRENTES_ATIVOS = false;

export function startInstaflixSchedulers() {
  if (_started) return;
  _started = true;
  // Limpa gerações órfãs de um run anterior (servidor reiniciou no meio de uma
  // geração em background). Roda sempre — mesmo com a recorrência desligada.
  recuperarGeracoesPresas(3).catch(() => {});
  // Refresh de token do Instagram: 1x/dia — mantém a conexão viva. SEMPRE ligado.
  setTimeout(() => {
    tickRefreshTokens();
    setInterval(tickRefreshTokens, 24 * 60 * 60_000);
  }, 120_000);

  if (!RECORRENTES_ATIVOS) {
    console.log("[Boot] Instaflix: recorrência DESLIGADA — geração/publicação são MANUAIS (só refresh de token roda).");
    return;
  }

  // Publicador: a cada 60s.
  setInterval(tickPublicador, 60_000);
  // Gerador: a cada 10min; primeiro run após 30s pra não competir com o boot.
  setTimeout(() => {
    tickGerador();
    setInterval(tickGerador, 10 * 60_000);
  }, 30_000);
  console.log("[Boot] Instaflix schedulers iniciados (publicador 60s, gerador 10min, token-refresh 24h)");
}
