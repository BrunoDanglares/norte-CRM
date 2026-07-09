import { Router } from "express";
import { db } from "../db";
import {
  conversations, protocols, conexoes, teams, conversationSituationTags,
  users, authSessions, agentTraceEvents
} from "@shared/schema";
import { eq, and, gte, lte, sql, count, isNotNull, isNull, inArray, desc, ilike, or } from "drizzle-orm";
import { resolveWorkspaceId } from "../utils/helpers";

const router = Router();

// Protocolos resolvidos/fechados são exibidos como "encerrado" no relatório
// (igual à tela de atendimentos: o cliente fechou). Centralizado pra reuso.
const STATUS_ENCERRADO = ["resolvido", "fechado"];

function categoriaLabel(c: string | null): string {
  switch (c) {
    case "suporte_tecnico": return "Suporte";
    case "financeiro": return "Financeiro";
    case "comercial": return "Comercial";
    default: return "Geral";
  }
}

// ── Limites de dia ancorados em BRT (UTC-3, sem horário de verão desde 2019) ──
// Bruno 2026-06-04 (varredura): o parse antigo usava setHours no fuso do
// PROCESSO. Em dev (BRT) batia, mas o container de prod roda UTC → meia-noite
// "local" virava meia-noite UTC e o BETWEEN sobre colunas TIMESTAMPTZ deslocava
// ~3h nas bordas (registros 00:00-03:00 entravam/saíam do período errado). Aqui
// fixamos o fuso de negócio (BRT) independente do TZ do processo.
const BRT_OFFSET_MS = 3 * 3600 * 1000;
function brtDayStart(y: number, mo0: number, d: number): Date {
  // meia-noite BRT = 03:00 UTC do mesmo dia
  return new Date(Date.UTC(y, mo0, d, 0, 0, 0, 0) + BRT_OFFSET_MS);
}
function brtDayEnd(y: number, mo0: number, d: number): Date {
  return new Date(brtDayStart(y, mo0, d).getTime() + 86400000 - 1);
}
function brtDateParts(s: string): { y: number; mo0: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? { y: +m[1], mo0: +m[2] - 1, d: +m[3] } : null;
}

function parseRange(query: any): { dataInicio: Date; dataFim: Date } {
  const now = new Date();
  if (query.periodo === "hoje") {
    // "hoje" = dia-calendário BRT (não do processo). Lê os componentes BRT de
    // now deslocando -3h e usando os getters UTC.
    const brtNow = new Date(now.getTime() - BRT_OFFSET_MS);
    const y = brtNow.getUTCFullYear(), mo0 = brtNow.getUTCMonth(), d = brtNow.getUTCDate();
    return { dataInicio: brtDayStart(y, mo0, d), dataFim: brtDayEnd(y, mo0, d) };
  }
  if (query.periodo === "7d") {
    const inicio = new Date(now.getTime() - 7 * 86400000);
    return { dataInicio: inicio, dataFim: now };
  }
  if (query.periodo === "90d") {
    const inicio = new Date(now.getTime() - 90 * 86400000);
    return { dataInicio: inicio, dataFim: now };
  }
  if (query.dataInicio && query.dataFim) {
    // Cliente manda só a data (YYYY-MM-DD) no fuso do navegador (BRT). Ancoramos
    // os 2 extremos no dia-calendário BRT → instantes UTC determinísticos.
    const ini = brtDateParts(String(query.dataInicio));
    const fim = brtDateParts(String(query.dataFim));
    if (ini && fim) {
      return {
        dataInicio: brtDayStart(ini.y, ini.mo0, ini.d),
        dataFim: brtDayEnd(fim.y, fim.mo0, fim.d),
      };
    }
    // Fallback: string já com hora/offset explícito → parse direto.
    return { dataInicio: new Date(String(query.dataInicio)), dataFim: new Date(String(query.dataFim)) };
  }
  const inicio = new Date(now.getTime() - 30 * 86400000);
  return { dataInicio: inicio, dataFim: now };
}

router.get("/stats/atendimentos", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const wsFilter = eq(conversations.workspaceId, wsId);
    const periodFilter = and(
      wsFilter,
      gte(conversations.createdAt, dataInicio),
      lte(conversations.createdAt, dataFim),
      // Bruno 2026-06-04: fora conversas de simulação/teste (alinha com a aba
      // Atendimentos e com o Dashboard ISP, que também passam a excluir).
      sql`COALESCE(${conversations.isSimulation}, false) = false`
    );

    const [{ total }] = await db.select({ total: count() }).from(conversations).where(periodFilter);

    const [{ resolvidas }] = await db.select({ resolvidas: count() }).from(conversations)
      .where(and(periodFilter, inArray(conversations.status, ["resolved", "resolvido"])));

    const [{ avgHours }] = await db.select({
      avgHours: sql<string>`ROUND(AVG(EXTRACT(EPOCH FROM (${conversations.resolvedAt} - ${conversations.createdAt})) / 3600)::numeric, 1)`
    }).from(conversations)
      .where(and(periodFilter, isNotNull(conversations.resolvedAt)));

    const porCanal = await db.select({
      canal: conversations.canal,
      total: count()
    }).from(conversations).where(periodFilter).groupBy(conversations.canal).orderBy(sql`count(*) DESC`);

    const porAgente = await db.select({
      agenteNome: conversations.assignedUserName,
      total: count(),
      resolvidas: sql<number>`COUNT(*) FILTER (WHERE ${conversations.status} IN ('resolved', 'resolvido'))`,
    }).from(conversations)
      .where(and(periodFilter, isNotNull(conversations.assignedUserName)))
      .groupBy(conversations.assignedUserName)
      .orderBy(sql`count(*) DESC`)
      .limit(10);

    const volumePorDia = await db.select({
      data: sql<string>`TO_CHAR(${conversations.createdAt}::date, 'DD/MM')`,
      total: count()
    }).from(conversations).where(periodFilter)
      .groupBy(sql`${conversations.createdAt}::date`)
      .orderBy(sql`${conversations.createdAt}::date ASC`);

    const taxaResolucao = total > 0 ? Math.round((resolvidas / total) * 100) : 0;

    res.json({
      totalConversas: total,
      conversasResolvidas: resolvidas,
      tempoMedioResolucao: avgHours ? parseFloat(avgHours) : null,
      porCanal,
      porAgente,
      volumePorDia,
      taxaResolucao,
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro atendimentos:", err);
    res.status(500).json({ error: "Erro ao buscar relatório de atendimentos" });
  }
});

router.get("/stats/protocolos", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const periodFilter = and(
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      // Bruno 2026-06-04: exclui protocolos de conversas de simulação/teste — o
      // widget CSAT do Dashboard tem que bater com a aba Pesquisa de Satisfação.
      // protocols não dá join em conversations aqui, então usa NOT EXISTS (mantém
      // protocolos sem conversa vinculada).
      sql`NOT EXISTS (SELECT 1 FROM ${conversations} cs WHERE cs.id = ${protocols.conversationId} AND cs.is_simulation = true)`
    );

    const [{ total }] = await db.select({ total: count() }).from(protocols).where(periodFilter);

    const porStatus = await db.select({
      status: protocols.status,
      total: count()
    }).from(protocols).where(periodFilter).groupBy(protocols.status);

    const porCategoria = await db.select({
      categoria: protocols.categoria,
      total: count()
    }).from(protocols).where(periodFilter).groupBy(protocols.categoria).orderBy(sql`count(*) DESC`);

    const [{ slaViolados }] = await db.select({ slaViolados: count() }).from(protocols)
      .where(and(periodFilter, eq(protocols.slaViolado, true)));

    const taxaSlaViolado = total > 0 ? Math.round((slaViolados / total) * 100) : 0;

    const [{ csatMedia }] = await db.select({
      csatMedia: sql<string>`ROUND(AVG(${protocols.csatNota})::numeric, 1)`
    }).from(protocols).where(and(periodFilter, isNotNull(protocols.csatNota)));

    const distribuicaoCsat = await db.select({
      nota: protocols.csatNota,
      total: count()
    }).from(protocols)
      .where(and(periodFilter, isNotNull(protocols.csatNota)))
      .groupBy(protocols.csatNota)
      .orderBy(sql`${protocols.csatNota} ASC`);

    const [{ avgHours }] = await db.select({
      avgHours: sql<string>`ROUND(AVG(EXTRACT(EPOCH FROM (${protocols.resolvedAt} - ${protocols.createdAt})) / 3600)::numeric, 1)`
    }).from(protocols).where(and(periodFilter, isNotNull(protocols.resolvedAt)));

    // Bruno 2026-05-17: média de tempo bot vs humano (em minutos pra ter
    // granularidade — atendimento típico é minutos, não horas).
    const [tempoBucketAvg] = await db.select({
      avgBotMin: sql<string>`ROUND(AVG(${protocols.tempoBotSeconds}) / 60.0, 1)`,
      avgHumanoMin: sql<string>`ROUND(AVG(${protocols.tempoHumanoSeconds}) / 60.0, 1)`,
      totalBotHoras: sql<string>`ROUND(SUM(${protocols.tempoBotSeconds}) / 3600.0, 1)`,
      totalHumanoHoras: sql<string>`ROUND(SUM(${protocols.tempoHumanoSeconds}) / 3600.0, 1)`,
      protocolosCalculados: count(),
    }).from(protocols).where(and(periodFilter, isNotNull(protocols.resolvedAt)));

    const volumePorDia = await db.select({
      data: sql<string>`TO_CHAR(${protocols.createdAt}::date, 'DD/MM')`,
      total: count()
    }).from(protocols).where(periodFilter)
      .groupBy(sql`${protocols.createdAt}::date`)
      .orderBy(sql`${protocols.createdAt}::date ASC`);

    res.json({
      total,
      porStatus,
      porCategoria,
      slaViolados,
      taxaSlaViolado,
      csatMedia: csatMedia ? parseFloat(csatMedia) : null,
      distribuicaoCsat,
      tempoMedioResolucao: avgHours ? parseFloat(avgHours) : null,
      tempoMedioBotMin: tempoBucketAvg?.avgBotMin ? parseFloat(tempoBucketAvg.avgBotMin) : null,
      tempoMedioHumanoMin: tempoBucketAvg?.avgHumanoMin ? parseFloat(tempoBucketAvg.avgHumanoMin) : null,
      tempoTotalBotHoras: tempoBucketAvg?.totalBotHoras ? parseFloat(tempoBucketAvg.totalBotHoras) : null,
      tempoTotalHumanoHoras: tempoBucketAvg?.totalHumanoHoras ? parseFloat(tempoBucketAvg.totalHumanoHoras) : null,
      volumePorDia,
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro protocolos:", err);
    res.status(500).json({ error: "Erro ao buscar relatório de protocolos" });
  }
});

// Relatório ISP REMOVIDO (módulo ISP arrancado do CRM). Mantém a assinatura do
// endpoint pro frontend não quebrar: sempre desabilitado, sem dados.
router.get("/stats/isp", async (_req, res) => {
  res.json({ enabled: false });
});

// ──────────────────────────────────────────────────────────────────────────
// Relatório de ATENDIMENTOS (base = protocolos, igual à tela de protocolos do
// Bruno, mas enriquecido com canal/departamento/avatar pra UI de relatórios).
// ──────────────────────────────────────────────────────────────────────────

// Lista paginada de atendimentos. Cada atendimento = 1 protocolo.
router.get("/atendimentos", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const limite = Math.min(parseInt((req.query.limite as string) || "20") || 20, 100);
    const offset = parseInt((req.query.offset as string) || "0") || 0;
    const busca = ((req.query.busca as string) || "").trim();
    const statusFiltro = (req.query.status as string) || "";   // encerrado | aberto | em_andamento | aguardando
    const origem = (req.query.origem as string) || "";          // atendente | automacao

    const conds: any[] = [
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      // Bruno 2026-06-02: fora protocolos de conversas de simulação/teste.
      sql`COALESCE(${conversations.isSimulation}, false) = false`,
    ];
    if (busca) {
      const term = `%${busca}%`;
      conds.push(or(
        ilike(protocols.numero, term),
        ilike(protocols.contatoNome, term),
        ilike(protocols.contatoTelefone, term),
        ilike(conversations.nome, term),
        ilike(conversations.telefone, term),
      ));
    }
    if (statusFiltro === "encerrado") conds.push(inArray(protocols.status, STATUS_ENCERRADO));
    else if (statusFiltro) conds.push(eq(protocols.status, statusFiltro));
    if (origem === "atendente") conds.push(isNotNull(protocols.agenteId));
    else if (origem === "automacao") conds.push(sql`${protocols.agenteId} IS NULL`);

    const where = and(...conds);

    const [{ total }] = await db.select({ total: count() })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(where);

    const rows = await db.select({
      id: protocols.id,
      numero: protocols.numero,
      titulo: protocols.titulo,
      categoria: protocols.categoria,
      status: protocols.status,
      agenteNome: protocols.agenteNome,
      agenteId: protocols.agenteId,
      csatNota: protocols.csatNota,
      conversationId: protocols.conversationId,
      contatoNome: protocols.contatoNome,
      contatoTelefone: protocols.contatoTelefone,
      createdAt: protocols.createdAt,
      resolvedAt: protocols.resolvedAt,
      closedAt: protocols.closedAt,
      convNome: conversations.nome,
      convTelefone: conversations.telefone,
      convAvatar: conversations.avatar,
      convCanal: conversations.canal,
      conexaoNome: conexoes.nome,
      departamentoNome: teams.nome,
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(conexoes, eq(conversations.conexaoId, conexoes.id))
      .leftJoin(teams, eq(conversations.assignedTeamId, teams.id))
      .where(where)
      .orderBy(desc(protocols.createdAt))
      .limit(limite)
      .offset(offset);

    const items = rows.map(r => ({
      id: r.id,
      numero: r.numero,
      titulo: r.titulo,
      categoria: r.categoria,
      status: STATUS_ENCERRADO.includes(r.status) ? "encerrado" : r.status,
      statusRaw: r.status,
      origem: r.agenteId ? "atendente" : "automacao",
      agenteNome: r.agenteNome,
      csatNota: r.csatNota,
      conversationId: r.conversationId,
      nome: r.contatoNome || r.convNome || "Sem nome",
      telefone: r.contatoTelefone || r.convTelefone || null,
      avatar: r.convAvatar || null,
      canal: r.conexaoNome || r.convCanal || "—",
      departamento: r.departamentoNome || categoriaLabel(r.categoria),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt || r.closedAt || null,
    }));

    res.json({ items, total: Number(total) || 0, limite, offset });
  } catch (err: any) {
    console.error("[Relatórios] Erro lista atendimentos:", err);
    res.status(500).json({ error: "Erro ao listar atendimentos" });
  }
});

// Distribuição por hora do dia — alimenta o gráfico "Horário dos atendimentos
// iniciados". IMPORTANTE: registrar ANTES de "/atendimentos/:id" senão o
// Express casa "horarios" como :id.
router.get("/atendimentos/horarios", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const where = and(
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      // Bruno 2026-06-02: fora horários de conversas de simulação/teste.
      sql`COALESCE(${conversations.isSimulation}, false) = false`,
    );

    const rows = await db.select({
      hora: sql<number>`EXTRACT(HOUR FROM ${protocols.createdAt})::int`,
      total: count(),
      atendentes: sql<number>`COUNT(*) FILTER (WHERE ${protocols.agenteId} IS NOT NULL)::int`,
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(where)
      .groupBy(sql`EXTRACT(HOUR FROM ${protocols.createdAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${protocols.createdAt})`);

    const [{ dias }] = await db.select({
      dias: sql<number>`GREATEST(COUNT(DISTINCT ${protocols.createdAt}::date), 1)::int`
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(where);

    const byHora: Record<number, { total: number; atendentes: number }> = {};
    for (const r of rows) byHora[Number(r.hora)] = { total: Number(r.total), atendentes: Number(r.atendentes) };

    const diasNum = Number(dias) || 1;
    const horas = Array.from({ length: 24 }, (_, h) => {
      const d = byHora[h] || { total: 0, atendentes: 0 };
      return {
        hora: h,
        label: `${String(h).padStart(2, "0")}:00`,
        total: d.total,
        atendentes: d.atendentes,
        mediaPorDia: Math.round((d.total / diasNum) * 10) / 10,
      };
    });
    res.json({ horas, dias: diasNum });
  } catch (err: any) {
    console.error("[Relatórios] Erro horários atendimentos:", err);
    res.status(500).json({ error: "Erro ao buscar horários" });
  }
});

// Detalhe de UM atendimento — alimenta o painel lateral (igual print 2).
router.get("/atendimentos/:id", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const id = req.params.id;

    const [r] = await db.select({
      id: protocols.id,
      numero: protocols.numero,
      titulo: protocols.titulo,
      categoria: protocols.categoria,
      status: protocols.status,
      agenteNome: protocols.agenteNome,
      agenteId: protocols.agenteId,
      csatNota: protocols.csatNota,
      conversationId: protocols.conversationId,
      contatoNome: protocols.contatoNome,
      contatoTelefone: protocols.contatoTelefone,
      titularNome: protocols.titularNome,
      createdAt: protocols.createdAt,
      resolvedAt: protocols.resolvedAt,
      closedAt: protocols.closedAt,
      tempoBotSeconds: protocols.tempoBotSeconds,
      tempoHumanoSeconds: protocols.tempoHumanoSeconds,
      convNome: conversations.nome,
      convTelefone: conversations.telefone,
      convAvatar: conversations.avatar,
      convCanal: conversations.canal,
      convAttendingStartedAt: conversations.attendingStartedAt,
      convCreatedAt: conversations.createdAt,
      conexaoNome: conexoes.nome,
      departamentoNome: teams.nome,
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(conexoes, eq(conversations.conexaoId, conexoes.id))
      .leftJoin(teams, eq(conversations.assignedTeamId, teams.id))
      .where(and(eq(protocols.id, id), eq(protocols.workspaceId, wsId)))
      .limit(1);

    if (!r) return res.status(404).json({ error: "Atendimento não encontrado" });

    const inicio = r.createdAt;
    const fim = r.resolvedAt || r.closedAt || null;
    const duracaoSegundos = fim && inicio
      ? Math.max(0, Math.floor((new Date(fim).getTime() - new Date(inicio).getTime()) / 1000))
      : null;
    // TME aproximado = espera antes do humano assumir (attendingStartedAt da
    // conversa - createdAt da conversa). 0 quando o bot resolveu tudo.
    let tmeSegundos: number | null = null;
    if (r.convAttendingStartedAt && r.convCreatedAt) {
      tmeSegundos = Math.max(0, Math.floor(
        (new Date(r.convAttendingStartedAt).getTime() - new Date(r.convCreatedAt).getTime()) / 1000
      ));
    }

    res.json({
      id: r.id,
      numero: r.numero,
      titulo: r.titulo,
      categoria: r.categoria,
      status: STATUS_ENCERRADO.includes(r.status) ? "encerrado" : r.status,
      statusRaw: r.status,
      origem: r.agenteId ? "atendente" : "automacao",
      nome: r.contatoNome || r.convNome || "Sem nome",
      telefone: r.contatoTelefone || r.convTelefone || null,
      avatar: r.convAvatar || null,
      titularNome: r.titularNome || null,
      canal: r.conexaoNome || r.convCanal || "—",
      departamento: r.departamentoNome || categoriaLabel(r.categoria),
      agenteNome: r.agenteNome || null,
      csatNota: r.csatNota ?? null,
      conversationId: r.conversationId,
      inicio,
      fim,
      duracaoSegundos,
      tmeSegundos,
      tempoBotSeconds: r.tempoBotSeconds ?? null,
      tempoHumanoSeconds: r.tempoHumanoSeconds ?? null,
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro detalhe atendimento:", err);
    res.status(500).json({ error: "Erro ao buscar atendimento" });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Relatórios por ESTADO da conversa — espelham as colunas da Central de
// Atendimentos (client/src/pages/atendimentos.tsx → classifyConv). Base =
// `conversations` (não `protocols`): reflete o estado AO VIVO de cada conversa,
// exatamente como o painel/chat mostra.
//
//   Encerrados      status resolved/resolvido
//   Em Andamento    atendente humano atribuído (assigned_user_id) e não encerrada
//   Em espera       escalada pra humano, na FILA de um setor: tem sinal de
//                   handoff + tem equipe, mas ainda sem atendente
//   Não Atribuídos  escalada pra humano SEM setor e SEM atendente (órfã — risco
//                   de ficar sem resposta)
//   Automação       bot conduzindo sozinho (sem humano e sem sinal de handoff)
//
// Sinais de handoff = idênticos ao front: aiPaused | pipelineEtapa
// "atendimento_humano" | tag AH. Null-safe pra não derrubar bot sem tags.
// ──────────────────────────────────────────────────────────────────────────

const C = conversations;
const filaSignalSql = sql`(${C.aiPaused} = true OR COALESCE(${C.pipelineEtapa}, '') LIKE '%atendimento_humano%' OR COALESCE(${C.tags}, '{}'::text[]) @> ARRAY['AH']::text[])`;
const naoEncerradaSql = sql`${C.status} NOT IN ('resolved','resolvido')`;
const semAtendenteSql = sql`${C.assignedUserId} IS NULL`;
// Bruno 2026-06-02: relatórios NÃO contam conversas de simulação/teste.
const semSimulacaoSql = sql`${C.isSimulation} = false`;

const BUCKETS = ["encerrados", "em-andamento", "em-espera", "nao-atribuidos", "automacao"] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketCondicao(bucket: Bucket) {
  switch (bucket) {
    case "encerrados":
      return inArray(C.status, ["resolved", "resolvido"]);
    case "em-andamento":
      return and(naoEncerradaSql, isNotNull(C.assignedUserId));
    case "em-espera":
      return and(naoEncerradaSql, semAtendenteSql, filaSignalSql, isNotNull(C.assignedTeamId));
    case "nao-atribuidos":
      return and(naoEncerradaSql, semAtendenteSql, filaSignalSql, sql`${C.assignedTeamId} IS NULL`);
    case "automacao":
      return and(naoEncerradaSql, semAtendenteSql, sql`NOT ${filaSignalSql}`);
  }
}

// Eixo de período: encerrados filtram pelo fechamento; estados ao vivo pela abertura.
function periodoSql(bucket: Bucket, ini: Date, fim: Date) {
  const col = bucket === "encerrados"
    ? sql`COALESCE(${C.resolvedAt}, ${C.updatedAt})`
    : sql`${C.createdAt}`;
  return sql`${col} BETWEEN ${ini} AND ${fim}`;
}

// Contagens por bucket — alimentam os badges da sub-nav lateral.
router.get("/conversas/contagens", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const ws = eq(C.workspaceId, wsId);
    const periodAbertura = sql`${C.createdAt} BETWEEN ${dataInicio} AND ${dataFim}`;

    const [live] = await db.select({
      emAndamento: sql<number>`COUNT(*) FILTER (WHERE ${naoEncerradaSql} AND ${C.assignedUserId} IS NOT NULL)::int`,
      emEspera: sql<number>`COUNT(*) FILTER (WHERE ${naoEncerradaSql} AND ${semAtendenteSql} AND ${filaSignalSql} AND ${C.assignedTeamId} IS NOT NULL)::int`,
      naoAtribuidos: sql<number>`COUNT(*) FILTER (WHERE ${naoEncerradaSql} AND ${semAtendenteSql} AND ${filaSignalSql} AND ${C.assignedTeamId} IS NULL)::int`,
      automacao: sql<number>`COUNT(*) FILTER (WHERE ${naoEncerradaSql} AND ${semAtendenteSql} AND NOT ${filaSignalSql})::int`,
    }).from(C).where(and(ws, semSimulacaoSql, periodAbertura));

    const [{ encerrados }] = await db.select({ encerrados: count() }).from(C)
      .where(and(ws, semSimulacaoSql, inArray(C.status, ["resolved", "resolvido"]),
        sql`COALESCE(${C.resolvedAt}, ${C.updatedAt}) BETWEEN ${dataInicio} AND ${dataFim}`));

    res.json({
      encerrados: Number(encerrados) || 0,
      "em-andamento": Number(live?.emAndamento) || 0,
      "em-espera": Number(live?.emEspera) || 0,
      "nao-atribuidos": Number(live?.naoAtribuidos) || 0,
      automacao: Number(live?.automacao) || 0,
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro contagens conversas:", err);
    res.status(500).json({ error: "Erro ao contar conversas" });
  }
});

// Relatório de UM bucket: resumo (KPIs) + série (gráfico) + lista paginada.
router.get("/conversas", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const bucket = String(req.query.bucket || "") as Bucket;
    if (!BUCKETS.includes(bucket)) {
      return res.status(400).json({ error: `bucket inválido. Use: ${BUCKETS.join(", ")}` });
    }
    const { dataInicio, dataFim } = parseRange(req.query);
    const limite = Math.min(parseInt((req.query.limite as string) || "20") || 20, 100);
    const offset = parseInt((req.query.offset as string) || "0") || 0;
    const busca = ((req.query.busca as string) || "").trim();

    const conds: any[] = [eq(C.workspaceId, wsId), semSimulacaoSql, bucketCondicao(bucket), periodoSql(bucket, dataInicio, dataFim)];
    if (busca) {
      const term = `%${busca}%`;
      conds.push(or(ilike(C.nome, term), ilike(C.telefone, term)));
    }
    const where = and(...conds);

    // Referência de tempo: estado "ativo" conta desde quando o atendimento
    // começou (automação/andamento) ou desde a última atualização (fila/espera).
    const refAging = (bucket === "em-andamento" || bucket === "automacao")
      ? sql`COALESCE(${C.attendingStartedAt}, ${C.createdAt})`
      : sql`COALESCE(${C.updatedAt}, ${C.createdAt})`;

    // ── Resumo (KPIs agregados) ──
    const [agg] = await db.select({
      total: count(),
      duracaoMediaSeg: sql<number>`AVG(EXTRACT(EPOCH FROM (COALESCE(${C.resolvedAt}, ${C.updatedAt}) - COALESCE(${C.attendingStartedAt}, ${C.createdAt}))))`,
      agingMediaSeg: sql<number>`AVG(EXTRACT(EPOCH FROM (NOW() - ${refAging})))`,
      agingMaxSeg: sql<number>`MAX(EXTRACT(EPOCH FROM (NOW() - ${refAging})))`,
      semHumano: sql<number>`COUNT(*) FILTER (WHERE ${C.assignedUserId} IS NULL)`,
      atendentes: sql<number>`COUNT(DISTINCT ${C.assignedUserId})`,
    }).from(C).where(where);

    const total = Number(agg?.total) || 0;
    const num = (v: any) => (v == null ? null : Math.round(Number(v)));

    // Bruno 2026-06-13: métricas de VALOR do agente, além da "contenção" binária
    // (semHumanoPct = resolvido 100% sem humano). Os protocolos medem o tempo que
    // o bot conduziu vs o humano (tempo_bot/tempo_humano por atendimento):
    //   automacaoTempoPct = % do tempo total de atendimento conduzido pelo agente.
    //   assistidaPct      = das escalações (que tiveram humano), % onde o agente
    //                       JÁ tinha atuado (triagem/coleta) antes — valor que a
    //                       contenção pura esconde. Só no bucket encerrados.
    let automacaoTempoPct: number | null = null;
    let assistidaPct: number | null = null;
    if (bucket === "encerrados") {
      const [pAgg] = await db.select({
        somaBot: sql<number>`COALESCE(SUM(${protocols.tempoBotSeconds}), 0)`,
        somaHumano: sql<number>`COALESCE(SUM(${protocols.tempoHumanoSeconds}), 0)`,
        comHumano: sql<number>`COUNT(*) FILTER (WHERE ${protocols.tempoHumanoSeconds} > 0 OR ${protocols.agenteId} IS NOT NULL)`,
        // "Assistida" = colaboração REAL: o bot E o humano conduziram tempo no
        // mesmo atendimento (não só o bot ter começado, que é sempre verdade).
        comHumanoEBot: sql<number>`COUNT(*) FILTER (WHERE ${protocols.tempoHumanoSeconds} > 0 AND ${protocols.tempoBotSeconds} > 0)`,
      }).from(protocols)
        .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
        .where(and(
          eq(protocols.workspaceId, wsId),
          sql`COALESCE(${conversations.isSimulation}, false) = false`,
          sql`COALESCE(${protocols.resolvedAt}, ${protocols.closedAt}) BETWEEN ${dataInicio} AND ${dataFim}`,
        ));
      const sBot = Number(pAgg?.somaBot) || 0;
      const sHum = Number(pAgg?.somaHumano) || 0;
      automacaoTempoPct = (sBot + sHum) > 0 ? Math.round((sBot / (sBot + sHum)) * 100) : 0;
      const comHum = Number(pAgg?.comHumano) || 0;
      const comHumBot = Number(pAgg?.comHumanoEBot) || 0;
      assistidaPct = comHum > 0 ? Math.round((comHumBot / comHum) * 100) : 0;
    }

    const resumo = {
      total,
      mediaSeg: bucket === "encerrados" ? num(agg?.duracaoMediaSeg) : num(agg?.agingMediaSeg),
      maxSeg: bucket === "encerrados" ? null : num(agg?.agingMaxSeg),
      semHumanoPct: total > 0 ? Math.round((Number(agg?.semHumano) / total) * 100) : 0,
      atendentesAtivos: Number(agg?.atendentes) || 0,
      automacaoTempoPct,
      assistidaPct,
    };

    // ── Série (gráfico) — dimensão escolhida por bucket ──
    let serie: { label: string; total: number }[] = [];
    let serieTipo = "dia";
    if (bucket === "encerrados") {
      const r = await db.select({
        label: sql<string>`TO_CHAR(COALESCE(${C.resolvedAt}, ${C.updatedAt})::date, 'DD/MM')`,
        total: count(),
      }).from(C).where(where)
        .groupBy(sql`COALESCE(${C.resolvedAt}, ${C.updatedAt})::date`)
        .orderBy(sql`COALESCE(${C.resolvedAt}, ${C.updatedAt})::date ASC`);
      serie = r.map((x) => ({ label: x.label, total: Number(x.total) }));
      serieTipo = "dia";
    } else if (bucket === "em-andamento") {
      const r = await db.select({
        label: sql<string>`COALESCE(${C.assignedUserName}, 'Sem nome')`,
        total: count(),
      }).from(C).where(where).groupBy(C.assignedUserName).orderBy(sql`count(*) DESC`).limit(8);
      serie = r.map((x) => ({ label: x.label, total: Number(x.total) }));
      serieTipo = "atendente";
    } else if (bucket === "em-espera") {
      const r = await db.select({
        label: sql<string>`COALESCE(${teams.nome}, 'Sem setor')`,
        total: count(),
      }).from(C).leftJoin(teams, eq(C.assignedTeamId, teams.id)).where(where)
        .groupBy(teams.nome).orderBy(sql`count(*) DESC`).limit(8);
      serie = r.map((x) => ({ label: x.label, total: Number(x.total) }));
      serieTipo = "departamento";
    } else {
      // nao-atribuidos + automacao → por canal de entrada
      const r = await db.select({
        label: sql<string>`COALESCE(${conexoes.nome}, ${C.canal}, 'Outro')`,
        total: count(),
      }).from(C).leftJoin(conexoes, eq(C.conexaoId, conexoes.id)).where(where)
        .groupBy(conexoes.nome, C.canal).orderBy(sql`count(*) DESC`).limit(8);
      serie = r.map((x) => ({ label: x.label, total: Number(x.total) }));
      serieTipo = "canal";
    }

    // ── Lista paginada ──
    const ordering = bucket === "encerrados"
      ? desc(sql`COALESCE(${C.resolvedAt}, ${C.updatedAt})`)
      : (bucket === "em-espera" || bucket === "nao-atribuidos")
      ? sql`COALESCE(${C.updatedAt}, ${C.createdAt}) ASC`   // mais antigo primeiro (urgência)
      : desc(sql`COALESCE(${C.updatedAt}, ${C.createdAt})`);

    const rows = await db.select({
      id: C.id,
      nome: C.nome,
      telefone: C.telefone,
      avatar: C.avatar,
      canal: C.canal,
      conexaoNome: conexoes.nome,
      departamentoNome: teams.nome,
      assignedUserName: C.assignedUserName,
      assignedUserId: C.assignedUserId,
      isSimulation: C.isSimulation,
      createdAt: C.createdAt,
      attendingStartedAt: C.attendingStartedAt,
      resolvedAt: C.resolvedAt,
      updatedAt: C.updatedAt,
      situacoesFinais: C.situacoesFinais,
    }).from(C)
      .leftJoin(conexoes, eq(C.conexaoId, conexoes.id))
      .leftJoin(teams, eq(C.assignedTeamId, teams.id))
      .where(where)
      .orderBy(ordering)
      .limit(limite)
      .offset(offset);

    // ── Tags de situação por conversa (pros cards da lista) ──
    // Bruno 2026-06-13: mescla as 2 fontes — CST (conversas ATIVAS) + protocols.tags
    // (ENCERRADAS, já que o CST é apagado no resolve). Exclui marcadores auxiliares
    // de roteamento (GERAL/FAQ/QR/SPAM) que não são "situações" úteis no card.
    const pageIdsList = rows.map((r) => r.id);
    const tagsPorConv = new Map<number, Set<string>>();
    const AUX_TAGS = new Set(["GERAL", "FAQ", "QR", "SPAM"]);
    const addTag = (cid: number | null, code: string | null) => {
      if (cid == null || !code) return;
      if (AUX_TAGS.has(code.toUpperCase())) return;
      let s = tagsPorConv.get(cid);
      if (!s) { s = new Set(); tagsPorConv.set(cid, s); }
      s.add(code);
    };
    if (pageIdsList.length > 0) {
      const cstTags = await db.select({ cid: CST.conversationId, code: CST.situationCode })
        .from(CST)
        .where(and(eq(CST.workspaceId, wsId), inArray(CST.conversationId, pageIdsList)));
      for (const t of cstTags) addTag(t.cid, t.code);
      const protRows = await db.select({ cid: protocols.conversationId, tags: protocols.tags })
        .from(protocols)
        .where(and(eq(protocols.workspaceId, wsId), inArray(protocols.conversationId, pageIdsList)));
      for (const pr of protRows) {
        if (Array.isArray(pr.tags)) for (const code of pr.tags) addTag(pr.cid, code);
      }
      // 3ª fonte (Bruno 2026-06-13): histórico permanente da própria conversa —
      // cobre as encerradas que o bot resolveu SEM protocolo (CST já apagado).
      for (const r of rows) {
        if (Array.isArray(r.situacoesFinais)) for (const code of r.situacoesFinais) addTag(r.id, code);
      }
    }
    const sortTags = (codes: string[]) => codes.sort((a, b) => {
      const aAH = a.toUpperCase() === "AH" ? 1 : 0;
      const bAH = b.toUpperCase() === "AH" ? 1 : 0;
      if (aAH !== bAH) return aAH - bAH; // AH (sinal de escalação) por último
      return a.localeCompare(b, undefined, { numeric: true });
    });

    const now = Date.now();
    const ms = (d: any) => (d ? new Date(d).getTime() : null);
    const items = rows.map((r) => {
      const start = ms(r.attendingStartedAt) ?? ms(r.createdAt);
      let tempoSeg: number | null = null;
      if (bucket === "encerrados") {
        const end = ms(r.resolvedAt) ?? ms(r.updatedAt);
        if (start && end) tempoSeg = Math.max(0, Math.floor((end - start) / 1000));
      } else if (bucket === "em-espera" || bucket === "nao-atribuidos") {
        const ref = ms(r.updatedAt) ?? ms(r.createdAt);
        if (ref) tempoSeg = Math.max(0, Math.floor((now - ref) / 1000));
      } else if (start) {
        tempoSeg = Math.max(0, Math.floor((now - start) / 1000));
      }
      return {
        id: r.id,
        conversationId: r.id,
        nome: r.nome || "Sem nome",
        telefone: r.telefone || null,
        avatar: r.avatar || null,
        canal: r.conexaoNome || r.canal || "—",
        departamento: r.departamentoNome || "—",
        atendente: r.assignedUserName || null,
        origem: r.assignedUserId ? "atendente" : "automacao",
        isSimulation: !!r.isSimulation,
        createdAt: r.createdAt,
        tempoSeg,
        tags: sortTags(Array.from(tagsPorConv.get(r.id) ?? [])),
      };
    });

    res.json({ bucket, resumo, serie, serieTipo, lista: { items, total, limite, offset } });
  } catch (err: any) {
    console.error("[Relatórios] Erro relatório de conversas:", err);
    res.status(500).json({ error: "Erro ao gerar relatório de conversas" });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Análises TRANSVERSAIS (não são estados): Classificação de atendimento,
// Departamentos e Total mensal. Também ignoram conversas de simulação.
// ──────────────────────────────────────────────────────────────────────────

const CST = conversationSituationTags;

// Setor a partir do código da situação. Ordem importa: CANCEL_* (cancelamento)
// começa com 'C' mas NÃO é Comercial; AH/FAQ/QR/SPAM são auxiliares.
const setorCaseSql = sql<string>`CASE
  WHEN ${CST.situationCode} ILIKE 'CANCEL%' THEN 'Cancelamento'
  WHEN ${CST.situationCode} IN ('AH','FAQ','QR','GERAL','SPAM') THEN 'Atendimento / Auxiliar'
  WHEN ${CST.situationCode} ILIKE 'F%' THEN 'Financeiro'
  WHEN ${CST.situationCode} ILIKE 'S%' THEN 'Suporte Técnico'
  WHEN ${CST.situationCode} ILIKE 'C%' THEN 'Comercial'
  WHEN ${CST.situationCode} ILIKE 'K%' THEN 'Cancelamento'
  WHEN ${CST.situationCode} ILIKE 'N%' THEN 'Reputação / NPS'
  ELSE 'Outros' END`;

const cstSemSimSql = sql`COALESCE(${conversations.isSimulation}, false) = false`;

// Classificação de atendimento — distribuição das SITUAÇÕES (tags S/F/C/K/N…)
// aplicadas pelo agente. Conta conversas distintas por código.
router.get("/classificacao", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const where = and(
      eq(CST.workspaceId, wsId),
      gte(CST.createdAt, dataInicio),
      lte(CST.createdAt, dataFim),
      cstSemSimSql,
      // Bruno 2026-06-03: AH (Atendimento humano) nunca aparece na Classificação
      // — não é uma situação de assunto, é só o sinal de escalonamento.
      sql`UPPER(COALESCE(${CST.situationCode}, '')) <> 'AH'`,
    );

    const distribuicao = await db.select({
      code: CST.situationCode,
      setor: setorCaseSql,
      total: sql<number>`COUNT(DISTINCT ${CST.conversationId})::int`,
    }).from(CST)
      .leftJoin(conversations, eq(CST.conversationId, conversations.id))
      .where(where)
      .groupBy(CST.situationCode, setorCaseSql)
      .orderBy(sql`COUNT(DISTINCT ${CST.conversationId}) DESC`);

    const porSetor = await db.select({
      setor: setorCaseSql,
      total: sql<number>`COUNT(DISTINCT ${CST.conversationId})::int`,
    }).from(CST)
      .leftJoin(conversations, eq(CST.conversationId, conversations.id))
      .where(where)
      .groupBy(setorCaseSql)
      .orderBy(sql`COUNT(DISTINCT ${CST.conversationId}) DESC`);

    const [tot] = await db.select({
      tags: sql<number>`COUNT(*)::int`,
      convs: sql<number>`COUNT(DISTINCT ${CST.conversationId})::int`,
    }).from(CST)
      .leftJoin(conversations, eq(CST.conversationId, conversations.id))
      .where(where);

    res.json({
      totalTags: Number(tot?.tags) || 0,
      totalConversas: Number(tot?.convs) || 0,
      distribuicao: distribuicao.map((d) => ({ code: d.code, setor: d.setor, total: Number(d.total) })),
      porSetor: porSetor.map((s) => ({ setor: s.setor, total: Number(s.total) })),
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro classificação:", err);
    res.status(500).json({ error: "Erro ao gerar classificação" });
  }
});

// Setor a partir do código de situação (espelha o setorCaseSql, pra usar em JS).
function setorFromCode(code: string): string {
  const c = (code || "").toUpperCase();
  if (c.startsWith("CANCEL")) return "Cancelamento";
  if (["AH", "FAQ", "QR", "GERAL", "SPAM"].includes(c)) return "Atendimento / Auxiliar";
  if (c.startsWith("F")) return "Financeiro";
  if (c.startsWith("S")) return "Suporte Técnico";
  if (c.startsWith("C")) return "Comercial";
  if (c.startsWith("K")) return "Cancelamento";
  if (c.startsWith("N")) return "Reputação / NPS";
  return "Outros";
}

// Escalações — POR QUE o agente passou o atendimento pro humano (tag AH).
// Bruno 2026-06-13: FONTE = protocols.tags. As tags de situação são APAGADAS da
// conversa no resolve e só sobrevivem no snapshot do protocolo (criado no handoff).
// "Escalada" = conversa cujo protocolo (resolvido no período) tem a tag AH. O
// MOTIVO é a distribuição dos OUTROS códigos (assunto: F11, S5, C6…) — mostra
// onde o agente mais escala = onde dá pra automatizar e subir a contenção.
router.get("/escalacoes", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const limite = Math.min(parseInt((req.query.limite as string) || "20") || 20, 100);
    const offset = parseInt((req.query.offset as string) || "0") || 0;

    // ENCERRADAS no período (base do bucket "encerrados") — pra contextualizar a taxa.
    const [enc] = await db.select({ n: count() }).from(C)
      .where(and(
        eq(C.workspaceId, wsId), semSimulacaoSql,
        inArray(C.status, ["resolved", "resolvido"]),
        sql`COALESCE(${C.resolvedAt}, ${C.updatedAt}) BETWEEN ${dataInicio} AND ${dataFim}`,
      ));
    const totalEncerradas = Number(enc?.n) || 0;

    // Filtro comum: protocolos resolvidos no período, não-simulação, com tag AH.
    const escWhere = sql`
      p.workspace_id = ${wsId}
      AND COALESCE(c.is_simulation, false) = false
      AND COALESCE(p.resolved_at, p.closed_at) BETWEEN ${dataInicio} AND ${dataFim}
      AND p.tags @> ARRAY['AH']::text[]`;

    const totRes: any = await db.execute(sql`
      SELECT COUNT(DISTINCT p.conversation_id)::int AS n
      FROM protocols p LEFT JOIN conversations c ON p.conversation_id = c.id
      WHERE ${escWhere}`);
    const totalEscaladas = Number(totRes.rows?.[0]?.n) || 0;

    if (totalEscaladas === 0) {
      return res.json({
        resumo: { totalEscaladas: 0, totalEncerradas, taxaEscalacaoPct: 0, topMotivo: null },
        porMotivo: [], porSetor: [], lista: { items: [], total: 0, limite, offset },
      });
    }

    // Distribuição por MOTIVO (código != AH) — conta conversas distintas por código.
    const motRes: any = await db.execute(sql`
      SELECT code, COUNT(DISTINCT cid)::int AS total FROM (
        SELECT p.conversation_id AS cid, UPPER(unnest(p.tags)) AS code
        FROM protocols p LEFT JOIN conversations c ON p.conversation_id = c.id
        WHERE ${escWhere}
      ) t
      WHERE code <> 'AH'
      GROUP BY code
      ORDER BY total DESC`);
    const porMotivo = (motRes.rows ?? []).map((m: any) => ({
      code: m.code, setor: setorFromCode(m.code), total: Number(m.total),
    }));

    // Por setor — agrega os motivos por setor.
    const setorMap = new Map<string, number>();
    for (const m of porMotivo) setorMap.set(m.setor, (setorMap.get(m.setor) ?? 0) + m.total);
    const porSetor = Array.from(setorMap.entries())
      .map(([setor, total]) => ({ setor, total }))
      .sort((a, b) => b.total - a.total);

    // Lista paginada das conversas escaladas (mais recentes) + motivos por conversa.
    const listRes: any = await db.execute(sql`
      WITH esc AS (
        SELECT p.conversation_id AS cid,
               MAX(COALESCE(p.resolved_at, p.closed_at)) AS fechado,
               array_agg(DISTINCT tc.code) FILTER (WHERE UPPER(tc.code) <> 'AH') AS motivos
        FROM protocols p
        LEFT JOIN conversations c ON p.conversation_id = c.id
        LEFT JOIN LATERAL unnest(p.tags) AS tc(code) ON true
        WHERE ${escWhere}
        GROUP BY p.conversation_id
      )
      SELECT e.cid, e.fechado, e.motivos,
             c.nome, c.telefone, c.avatar, c.canal, c.assigned_user_name AS atendente,
             c.attending_started_at, c.created_at, c.resolved_at, c.updated_at
      FROM esc e LEFT JOIN conversations c ON e.cid = c.id
      ORDER BY e.fechado DESC NULLS LAST
      LIMIT ${limite} OFFSET ${offset}`);

    const items = (listRes.rows ?? []).map((r: any) => {
      const fimT = r.resolved_at || r.updated_at || r.fechado || null;
      const iniT = r.attending_started_at || r.created_at || null;
      const tempoSeg = fimT && iniT
        ? Math.max(0, Math.round((new Date(fimT).getTime() - new Date(iniT).getTime()) / 1000))
        : null;
      return {
        id: Number(r.cid), conversationId: Number(r.cid),
        nome: r.nome ?? "Cliente", telefone: r.telefone ?? null,
        avatar: r.avatar ?? null, canal: r.canal ?? "WhatsApp",
        atendente: r.atendente ?? null,
        motivos: Array.isArray(r.motivos) ? r.motivos.filter(Boolean) : [],
        tempoSeg,
      };
    });

    res.json({
      resumo: {
        totalEscaladas,
        totalEncerradas,
        taxaEscalacaoPct: totalEncerradas > 0 ? Math.min(100, Math.round((totalEscaladas / totalEncerradas) * 100)) : 0,
        topMotivo: porMotivo[0]?.code ?? null,
      },
      porMotivo,
      porSetor,
      lista: { items, total: totalEscaladas, limite, offset },
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro escalações:", err);
    res.status(500).json({ error: "Erro ao gerar escalações" });
  }
});

// Departamentos — demanda agregada por SETOR (derivado das situações), com
// taxa de resolução. Conversa cross-setor conta em cada setor que tocou.
router.get("/departamentos", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const where = and(
      eq(CST.workspaceId, wsId),
      gte(CST.createdAt, dataInicio),
      lte(CST.createdAt, dataFim),
      cstSemSimSql,
    );

    const rows = await db.select({
      setor: setorCaseSql,
      total: sql<number>`COUNT(DISTINCT ${CST.conversationId})::int`,
      resolvidos: sql<number>`COUNT(DISTINCT ${CST.conversationId}) FILTER (WHERE ${conversations.status} IN ('resolved','resolvido'))::int`,
      emEspera: sql<number>`COUNT(DISTINCT ${CST.conversationId}) FILTER (WHERE ${conversations.status} NOT IN ('resolved','resolvido') AND ${conversations.assignedUserId} IS NULL AND ${filaSignalSql})::int`,
    }).from(CST)
      .leftJoin(conversations, eq(CST.conversationId, conversations.id))
      .where(where)
      .groupBy(setorCaseSql)
      .orderBy(sql`COUNT(DISTINCT ${CST.conversationId}) DESC`);

    const departamentos = rows.map((r) => {
      const total = Number(r.total) || 0;
      const resolvidos = Number(r.resolvidos) || 0;
      return {
        setor: r.setor,
        total,
        resolvidos,
        emEspera: Number(r.emEspera) || 0,
        taxaResolucao: total > 0 ? Math.round((resolvidos / total) * 100) : 0,
      };
    });

    res.json({
      departamentos,
      totalSetores: departamentos.length,
      // soma pode exceder conversas distintas (cross-setor) — é a demanda total por setor.
      somaDemanda: departamentos.reduce((a, d) => a + d.total, 0),
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro departamentos:", err);
    res.status(500).json({ error: "Erro ao gerar relatório de departamentos" });
  }
});

// Total mensal — volume de conversas mês a mês (últimos 12 meses fixos,
// ignora o seletor de período). Bot vs humano + resolvidos.
const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
router.get("/mensal", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const fim = new Date();
    const inicio = new Date(fim.getFullYear(), fim.getMonth() - 11, 1, 0, 0, 0, 0);
    const where = and(
      eq(conversations.workspaceId, wsId),
      gte(conversations.createdAt, inicio),
      eq(conversations.isSimulation, false),
    );

    const rows = await db.select({
      mes: sql<string>`TO_CHAR(${conversations.createdAt}, 'YYYY-MM')`,
      total: count(),
      resolvidos: sql<number>`COUNT(*) FILTER (WHERE ${conversations.status} IN ('resolved','resolvido'))::int`,
      automacao: sql<number>`COUNT(*) FILTER (WHERE ${conversations.assignedUserId} IS NULL)::int`,
      humano: sql<number>`COUNT(*) FILTER (WHERE ${conversations.assignedUserId} IS NOT NULL)::int`,
    }).from(conversations).where(where)
      .groupBy(sql`TO_CHAR(${conversations.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${conversations.createdAt}, 'YYYY-MM') ASC`);

    const byMes: Record<string, any> = {};
    for (const r of rows) byMes[r.mes] = r;

    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const r = byMes[ym] || {};
      const total = Number(r.total) || 0;
      const resolvidos = Number(r.resolvidos) || 0;
      return {
        mes: ym,
        label: `${MESES_PT[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`,
        total,
        resolvidos,
        automacao: Number(r.automacao) || 0,
        humano: Number(r.humano) || 0,
        taxaResolucao: total > 0 ? Math.round((resolvidos / total) * 100) : 0,
      };
    });

    const totalGeral = meses.reduce((a, m) => a + m.total, 0);
    const melhor = meses.reduce((a, m) => (m.total > a.total ? m : a), meses[0]);

    res.json({
      meses,
      resumo: {
        total: totalGeral,
        mediaMensal: Math.round(totalGeral / 12),
        melhorMesLabel: melhor?.label ?? "—",
        melhorMesTotal: melhor?.total ?? 0,
      },
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro total mensal:", err);
    res.status(500).json({ error: "Erro ao gerar total mensal" });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Relatórios de ATENDENTES. Base = protocolos (cada protocolo = 1 atendimento),
// agrupados pelo atendente (agente_id). agente_id NULL = bucket "Automação"
// (o bot). Exclui conversas de simulação. Período pela data de criação do
// protocolo — assim o TOTAL da tabela bate com a contagem da janelinha de
// conversas do atendente. Bruno 2026-06-03.
// ──────────────────────────────────────────────────────────────────────────

// Dias do período selecionado (pra coluna "Média" = atendimentos por dia).
function periodDias(ini: Date, fim: Date): number {
  return Math.max(1, Math.round((fim.getTime() - ini.getTime()) / 86400000));
}

const semSimProtocolo = sql`COALESCE(${conversations.isSimulation}, false) = false`;

function atendentesWhere(wsId: string, ini: Date, fim: Date) {
  return and(
    eq(protocols.workspaceId, wsId),
    gte(protocols.createdAt, ini),
    lte(protocols.createdAt, fim),
    semSimProtocolo,
  );
}

// Bot (agenteId IS NULL) sempre rotula "Automação". Sem o CASE, protocolos de
// auto-close gravam agenteNome="Sistema (Auto-resolve)" e o bot fragmentava em
// vários grupos (NULL→Automação + Sistema…→outro) no GROUP BY do /canais.
const agenteNomeSql = sql<string>`CASE WHEN ${protocols.agenteId} IS NULL THEN 'Automação' ELSE COALESCE(${users.nome}, ${protocols.agenteNome}, 'Automação') END`;
const agenteAvatarSql = sql<string | null>`COALESCE(${users.avatarUrl}, ${users.avatar})`;

// Visão geral — atendimentos por atendente: total, %, T.M.A (tempo médio de
// atendimento) e média/dia.
router.get("/atendentes/visao-geral", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const where = atendentesWhere(wsId, dataInicio, dataFim);

    const rows = await db.select({
      agenteId: protocols.agenteId,
      nome: sql<string>`CASE WHEN ${protocols.agenteId} IS NULL THEN 'Automação' ELSE COALESCE(MAX(${users.nome}), MAX(${protocols.agenteNome}), 'Automação') END`,
      avatar: sql<string | null>`MAX(COALESCE(${users.avatarUrl}, ${users.avatar}))`,
      total: count(),
      tmaSeg: sql<number | null>`AVG(EXTRACT(EPOCH FROM (COALESCE(${protocols.resolvedAt}, ${protocols.closedAt}) - ${protocols.createdAt}))) FILTER (WHERE COALESCE(${protocols.resolvedAt}, ${protocols.closedAt}) IS NOT NULL)`,
      encerrados: sql<number>`COUNT(*) FILTER (WHERE ${protocols.status} IN ('resolvido','fechado'))::int`,
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(users, eq(protocols.agenteId, users.id))
      .where(where)
      .groupBy(protocols.agenteId)
      .orderBy(sql`count(*) DESC`);

    const dias = periodDias(dataInicio, dataFim);
    const grandTotal = rows.reduce((a, r) => a + Number(r.total), 0);

    const atendentes = rows.map((r) => {
      const total = Number(r.total) || 0;
      return {
        agenteId: r.agenteId ?? null,
        bot: r.agenteId == null,
        nome: r.nome,
        avatar: r.avatar || null,
        total,
        encerrados: Number(r.encerrados) || 0,
        pct: grandTotal > 0 ? Math.round((total / grandTotal) * 1000) / 10 : 0,
        tmaSeg: r.tmaSeg != null ? Math.round(Number(r.tmaSeg)) : null,
        mediaDia: Math.round((total / dias) * 100) / 100,
      };
    });

    res.json({ atendentes, total: grandTotal, dias });
  } catch (err: any) {
    console.error("[Relatórios] Erro atendentes visão geral:", err);
    res.status(500).json({ error: "Erro ao gerar visão geral de atendentes" });
  }
});

// Por canais — matriz atendente × canal (cada conexão/canal vira uma coluna),
// com média/dia e total por atendente.
router.get("/atendentes/canais", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const where = atendentesWhere(wsId, dataInicio, dataFim);
    const canalSql = sql<string>`COALESCE(${conexoes.nome}, ${conversations.canal}, 'Outro')`;

    const rows = await db.select({
      agenteId: protocols.agenteId,
      nome: agenteNomeSql,
      avatar: agenteAvatarSql,
      canal: canalSql,
      total: count(),
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(conexoes, eq(conversations.conexaoId, conexoes.id))
      .leftJoin(users, eq(protocols.agenteId, users.id))
      .where(where)
      .groupBy(protocols.agenteId, agenteNomeSql, agenteAvatarSql, canalSql);

    const dias = periodDias(dataInicio, dataFim);
    const canaisSet = new Set<string>();
    const byAtendente = new Map<string, { agenteId: number | null; bot: boolean; nome: string; avatar: string | null; porCanal: Record<string, number>; total: number }>();

    for (const r of rows) {
      const key = r.agenteId == null ? "bot" : String(r.agenteId);
      const canal = r.canal || "Outro";
      canaisSet.add(canal);
      let a = byAtendente.get(key);
      if (!a) {
        a = { agenteId: r.agenteId ?? null, bot: r.agenteId == null, nome: r.nome, avatar: r.avatar || null, porCanal: {}, total: 0 };
        byAtendente.set(key, a);
      }
      const n = Number(r.total) || 0;
      a.porCanal[canal] = (a.porCanal[canal] || 0) + n;
      a.total += n;
    }

    const canais = Array.from(canaisSet).sort();
    const atendentes = Array.from(byAtendente.values())
      .sort((a, b) => b.total - a.total)
      .map((a) => ({ ...a, mediaDia: Math.round((a.total / dias) * 100) / 100 }));

    res.json({ canais, atendentes, dias });
  } catch (err: any) {
    console.error("[Relatórios] Erro atendentes por canais:", err);
    res.status(500).json({ error: "Erro ao gerar relatório por canais" });
  }
});

// ── Canais (aba Relatórios > Canais) — Bruno 2026-06-04 ─────────────────────
// Retrata os canais de atendimento REAIS: WhatsApp API Oficial (Meta Cloud),
// WhatsApp não-oficial (Evolution) e Instagram. Base = protocolos (atendimentos),
// classificados pelo `conversations.canal`. Origem (cliente×empresa) = direção
// da 1ª mensagem do atendimento (in=cliente iniciou, out=empresa/disparo iniciou).
// Retorna totais por canal (+%) e a série temporal diária pro gráfico de área.
const CANAL_LABELS: Record<string, string> = {
  whatsapp_oficial: "WhatsApp (API Oficial)",
  whatsapp_webjs: "WhatsApp (Web)",
  instagram: "Instagram",
};
router.get("/canais", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);

    // Agregado por tipo de canal + origem (1ª msg do protocolo via protocolo_id,
    // com fallback temporal pra mensagens antigas sem protocolo_id).
    const aggRes: any = await db.execute(sql`
      WITH base AS (
        SELECT p.id,
          CASE
            WHEN lower(coalesce(c.canal, '')) LIKE '%instagram%' THEN 'instagram'
            WHEN lower(coalesce(c.canal, '')) LIKE '%official%'
              OR lower(coalesce(c.canal, '')) LIKE '%oficial%' THEN 'whatsapp_oficial'
            ELSE 'whatsapp_webjs'
          END AS tipo,
          COALESCE(
            (SELECT m.direction FROM messages m WHERE m.protocolo_id = p.id
               ORDER BY m.created_at ASC LIMIT 1),
            (SELECT m.direction FROM messages m WHERE m.conversation_id = p.conversation_id
               AND m.created_at >= p.created_at - interval '120 seconds'
               ORDER BY m.created_at ASC LIMIT 1)
          ) AS first_dir
        FROM protocols p
        LEFT JOIN conversations c ON c.id = p.conversation_id
        WHERE p.workspace_id = ${wsId}::uuid
          AND p.created_at >= ${dataInicio} AND p.created_at <= ${dataFim}
      )
      SELECT tipo,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE first_dir = 'out')::int AS empresa,
        COUNT(*) FILTER (WHERE first_dir IS DISTINCT FROM 'out')::int AS cliente
      FROM base GROUP BY tipo
    `);

    // Série temporal diária (bucket no dia-calendário BRT) por tipo de canal.
    const serieRes: any = await db.execute(sql`
      SELECT to_char(date_trunc('day', p.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS dia,
        CASE
          WHEN lower(coalesce(c.canal, '')) LIKE '%instagram%' THEN 'instagram'
          WHEN lower(coalesce(c.canal, '')) LIKE '%official%'
            OR lower(coalesce(c.canal, '')) LIKE '%oficial%' THEN 'whatsapp_oficial'
          ELSE 'whatsapp_webjs'
        END AS tipo,
        COUNT(*)::int AS total
      FROM protocols p
      LEFT JOIN conversations c ON c.id = p.conversation_id
      WHERE p.workspace_id = ${wsId}::uuid
        AND p.created_at >= ${dataInicio} AND p.created_at <= ${dataFim}
      GROUP BY dia, tipo ORDER BY dia
    `);

    const agg = (aggRes.rows ?? aggRes) as any[];
    const serieRaw = (serieRes.rows ?? serieRes) as any[];

    const totalGeral = agg.reduce((a, r) => a + Number(r.total), 0);
    const canais = agg
      .map((r) => ({
        tipo: r.tipo as string,
        label: CANAL_LABELS[r.tipo] ?? r.tipo,
        total: Number(r.total),
        cliente: Number(r.cliente),
        empresa: Number(r.empresa),
        pct: totalGeral > 0 ? Math.round((Number(r.total) / totalGeral) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Pivota a série: uma coluna por tipo de canal presente.
    const tipos = canais.map((c) => c.tipo);
    const dias = Array.from(new Set(serieRaw.map((r) => String(r.dia)))).sort();
    const byDia = new Map<string, any>();
    for (const dia of dias) {
      const row: any = { dia };
      for (const t of tipos) row[t] = 0;
      byDia.set(dia, row);
    }
    for (const r of serieRaw) {
      const row = byDia.get(String(r.dia));
      if (row && tipos.includes(r.tipo)) row[r.tipo] = Number(r.total);
    }
    const serie = dias.map((d) => byDia.get(d));

    const numDias = Math.max(1, Math.round((dataFim.getTime() - dataInicio.getTime()) / 86400000));
    res.json({ canais, serie, tipos, labels: CANAL_LABELS, total: totalGeral, dias: numDias });
  } catch (err: any) {
    console.error("[Relatórios] Erro canais:", err);
    res.status(500).json({ error: "Erro ao gerar relatório de canais" });
  }
});

// Conversas atendidas por UM atendente — alimenta a janelinha flutuante.
// agenteId numérico ou "bot" (automação). Cada item abre a conversa no chat.
router.get("/atendentes/conversas", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    // Teto alto (1000) pra o "carregar mais" da janelinha conseguir paginar até o
    // total real por-atendente no período; acima disso a busca cobre o resto.
    const limite = Math.min(parseInt((req.query.limite as string) || "50") || 50, 1000);
    const offset = parseInt((req.query.offset as string) || "0") || 0;
    const busca = ((req.query.busca as string) || "").trim();
    const agenteIdRaw = (req.query.agenteId as string) || "";
    const isBot = agenteIdRaw === "" || agenteIdRaw === "bot" || agenteIdRaw === "null";
    const agenteIdNum = isBot ? null : parseInt(agenteIdRaw);
    if (!isBot && (agenteIdNum == null || Number.isNaN(agenteIdNum))) {
      return res.status(400).json({ error: "agenteId inválido" });
    }

    const conds: any[] = [
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      semSimProtocolo,
      isBot ? isNull(protocols.agenteId) : eq(protocols.agenteId, agenteIdNum as number),
    ];
    if (busca) {
      const term = `%${busca}%`;
      conds.push(or(
        ilike(protocols.numero, term),
        ilike(protocols.contatoNome, term),
        ilike(protocols.contatoTelefone, term),
        ilike(conversations.nome, term),
        ilike(conversations.telefone, term),
      ));
    }
    const where = and(...conds);

    const [{ total }] = await db.select({ total: count() })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(where);

    const rows = await db.select({
      id: protocols.id,
      numero: protocols.numero,
      categoria: protocols.categoria,
      status: protocols.status,
      csatNota: protocols.csatNota,
      conversationId: protocols.conversationId,
      contatoNome: protocols.contatoNome,
      contatoTelefone: protocols.contatoTelefone,
      createdAt: protocols.createdAt,
      resolvedAt: protocols.resolvedAt,
      closedAt: protocols.closedAt,
      convNome: conversations.nome,
      convTelefone: conversations.telefone,
      convAvatar: conversations.avatar,
      convCanal: conversations.canal,
      conexaoNome: conexoes.nome,
      departamentoNome: teams.nome,
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(conexoes, eq(conversations.conexaoId, conexoes.id))
      .leftJoin(teams, eq(conversations.assignedTeamId, teams.id))
      .where(where)
      .orderBy(desc(protocols.createdAt))
      .limit(limite)
      .offset(offset);

    const items = rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      status: STATUS_ENCERRADO.includes(r.status) ? "encerrado" : r.status,
      statusRaw: r.status,
      csatNota: r.csatNota,
      conversationId: r.conversationId,
      nome: r.contatoNome || r.convNome || "Sem nome",
      telefone: r.contatoTelefone || r.convTelefone || null,
      avatar: r.convAvatar || null,
      canal: r.conexaoNome || r.convCanal || "—",
      departamento: r.departamentoNome || categoriaLabel(r.categoria),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt || r.closedAt || null,
    }));

    res.json({ items, total: Number(total) || 0, limite, offset });
  } catch (err: any) {
    console.error("[Relatórios] Erro conversas do atendente:", err);
    res.status(500).json({ error: "Erro ao listar conversas do atendente" });
  }
});

// Logs de autenticação — sessões de login/logout dos atendentes. "Em Sessão" =
// sem logout e com heartbeat recente; senão fim inferido pelo último heartbeat.
const SESSAO_VIVA_MS = 4 * 60 * 1000; // 4min sem heartbeat → considera encerrada
router.get("/atendentes/auth-logs", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const limite = Math.min(parseInt((req.query.limite as string) || "100") || 100, 300);
    const offset = parseInt((req.query.offset as string) || "0") || 0;
    const busca = ((req.query.busca as string) || "").trim();

    const conds: any[] = [
      eq(authSessions.workspaceId, wsId),
      gte(authSessions.loginAt, dataInicio),
      lte(authSessions.loginAt, dataFim),
    ];
    if (busca) conds.push(ilike(authSessions.userNome, `%${busca}%`));
    const where = and(...conds);

    const [{ total }] = await db.select({ total: count() }).from(authSessions).where(where);

    const rows = await db.select({
      id: authSessions.id,
      userId: authSessions.userId,
      userNome: authSessions.userNome,
      ip: authSessions.ip,
      userAgent: authSessions.userAgent,
      loginAt: authSessions.loginAt,
      lastSeenAt: authSessions.lastSeenAt,
      logoutAt: authSessions.logoutAt,
      avatar: sql<string | null>`COALESCE(${users.avatarUrl}, ${users.avatar})`,
      nomeAtual: users.nome,
    })
      .from(authSessions)
      .leftJoin(users, eq(authSessions.userId, users.id))
      .where(where)
      .orderBy(desc(authSessions.loginAt))
      .limit(limite)
      .offset(offset);

    const now = Date.now();
    const items = rows.map((r) => {
      const ms = (d: any) => (d ? new Date(d).getTime() : null);
      const seen = ms(r.lastSeenAt);
      let logout: string | null = r.logoutAt ? new Date(r.logoutAt).toISOString() : null;
      let emSessao = false;
      let inferido = false;
      if (!logout) {
        if (seen != null && now - seen <= SESSAO_VIVA_MS) {
          emSessao = true;
        } else if (seen != null) {
          logout = new Date(seen).toISOString(); // fim inferido pelo último sinal
          inferido = true;
        }
      }
      return {
        id: r.id,
        userId: r.userId,
        nome: r.nomeAtual || r.userNome || "Usuário",
        avatar: r.avatar || null,
        ip: r.ip || null,
        userAgent: r.userAgent || null,
        loginAt: r.loginAt ? new Date(r.loginAt).toISOString() : null,
        logoutAt: logout,
        emSessao,
        inferido,
      };
    });

    res.json({ items, total: Number(total) || 0, limite, offset });
  } catch (err: any) {
    console.error("[Relatórios] Erro logs de autenticação:", err);
    res.status(500).json({ error: "Erro ao gerar logs de autenticação" });
  }
});

// Por atribuição — "Atendimentos Atribuídos": como cada atendente atua no fluxo.
// Por atendente: total de atendimentos iniciados e, desses, quantos ele atendeu
// até o fim (sem transferir) vs quantos TRANSFERIU pra outro atendente. Também:
// retornados (devolvidos pra automação/fila) e encerrados.
//
// MODELO (importante): `protocols.agenteId` é o ÚLTIMO responsável — quando A
// transfere pra B, o protocolo migra pra B (agenteId=B). Então a base de
// protocolos por agente já É o conjunto "atendidos SEM transferência" (o que o
// agente ficou até o fim). Quem transferiu não aparece ali — esse sinal vem do
// log canônico do painel (agent_trace_events, stage v2_conv_movement):
//   - kind=transfer_to_user                       → ATOR enviou a conversa pra outro humano
//   - kind=assigned_user_change + action=release  → ATOR devolveu pra automação
// Logo, por atendente:
//   naoTransferidos = protocolos que ele finalizou (kept)
//   transferidos    = conversas distintas que ele enviou pra outro (transfOut)
//   iniciados       = kept + transfOut   (tudo que passou pela mão dele)
//   retornados      = conversas que ele devolveu pra automação
//   encerrados      = protocolos dele resolvidos/fechados
//
// Limitação: agent_trace_events tem auto-purge ~30d — transferências mais antigas
// não entram (banner avisa). Janelas de 7d/30d são precisas.
router.get("/atendentes/atribuicao", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const where = atendentesWhere(wsId, dataInicio, dataFim);

    // 1) Base por agente: o que cada um FINALIZOU/possui (kept) + encerrados.
    const baseRows = await db.select({
      agenteId: protocols.agenteId,
      nome: agenteNomeSql,
      avatar: agenteAvatarSql,
      kept: count(),
      encerrados: sql<number>`COUNT(*) FILTER (WHERE ${protocols.status} IN ('resolvido','fechado'))::int`,
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(users, eq(protocols.agenteId, users.id))
      .where(where)
      .groupBy(protocols.agenteId, agenteNomeSql, agenteAvatarSql);

    // 2) Movimentações manuais (transfer/release) do período, por ator humano.
    const movRows = await db.select({
      conversationId: agentTraceEvents.conversationId,
      kind: sql<string>`${agentTraceEvents.payload}->>'kind'`,
      action: sql<string | null>`${agentTraceEvents.payload}->>'action'`,
      actorUserId: sql<string | null>`${agentTraceEvents.payload}->>'actorUserId'`,
    })
      .from(agentTraceEvents)
      .where(and(
        eq(agentTraceEvents.workspaceId, wsId),
        eq(agentTraceEvents.stage, "v2_conv_movement"),
        gte(agentTraceEvents.createdAt, dataInicio),
        lte(agentTraceEvents.createdAt, dataFim),
        sql`${agentTraceEvents.payload}->>'trigger' = 'human'`,
      ));

    // Por ator: conjunto de conversationIds que ele transferiu (saída) e devolveu.
    const transfOutByUser = new Map<number, Set<number>>();
    const releaseByUser = new Map<number, Set<number>>();
    const addTo = (m: Map<number, Set<number>>, user: number, conv: number) => {
      let s = m.get(user);
      if (!s) { s = new Set(); m.set(user, s); }
      s.add(conv);
    };
    for (const mv of movRows) {
      const actor = mv.actorUserId != null ? parseInt(mv.actorUserId) : NaN;
      const conv = mv.conversationId;
      if (Number.isNaN(actor) || conv == null) continue;
      if (mv.kind === "transfer_to_user") addTo(transfOutByUser, actor, conv);
      else if (mv.kind === "assigned_user_change" && mv.action === "release") addTo(releaseByUser, actor, conv);
    }

    // 3) Monta uma linha por agente: base (kept) ∪ atores de transferência/release
    // (um agente pode ter transferido tudo e não ter protocolo próprio no período).
    type Acc = {
      agenteId: number | null; bot: boolean; nome: string; avatar: string | null;
      kept: number; encerrados: number; transferidos: number; retornados: number;
    };
    const byId = new Map<number, Acc>();
    let botRow: Acc | null = null;
    for (const r of baseRows) {
      const acc: Acc = {
        agenteId: r.agenteId ?? null, bot: r.agenteId == null, nome: r.nome, avatar: r.avatar || null,
        kept: Number(r.kept) || 0, encerrados: Number(r.encerrados) || 0, transferidos: 0, retornados: 0,
      };
      if (r.agenteId == null) botRow = acc; else byId.set(r.agenteId, acc);
    }
    // Atores sem protocolo próprio no período → busca nome/avatar pra exibir.
    const actorIds = new Set<number>([...transfOutByUser.keys(), ...releaseByUser.keys()]);
    const missing = Array.from(actorIds).filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const urows = await db.select({
        id: users.id, nome: users.nome,
        avatar: sql<string | null>`COALESCE(${users.avatarUrl}, ${users.avatar})`,
      }).from(users).where(inArray(users.id, missing));
      const uinfo = new Map(urows.map((u) => [u.id, u]));
      for (const id of missing) {
        const u = uinfo.get(id);
        byId.set(id, {
          agenteId: id, bot: false, nome: u?.nome || `Usuário ${id}`, avatar: u?.avatar || null,
          kept: 0, encerrados: 0, transferidos: 0, retornados: 0,
        });
      }
    }
    for (const [id, set] of transfOutByUser) { const a = byId.get(id); if (a) a.transferidos = set.size; }
    for (const [id, set] of releaseByUser) { const a = byId.get(id); if (a) a.retornados = set.size; }

    const dias = periodDias(dataInicio, dataFim);
    const all = [...byId.values(), ...(botRow ? [botRow] : [])];
    const grandTotal = all.reduce((s, a) => s + a.kept + a.transferidos, 0);
    const atendentes = all.map((a) => {
      const iniciados = a.kept + a.transferidos;
      return {
        agenteId: a.agenteId,
        bot: a.bot,
        nome: a.nome,
        avatar: a.avatar,
        iniciados,
        transferidos: a.transferidos,
        naoTransferidos: a.kept,
        retornados: a.retornados,
        encerrados: a.encerrados,
        pct: grandTotal > 0 ? Math.round((iniciados / grandTotal) * 1000) / 10 : 0,
        mediaDia: Math.round((iniciados / dias) * 100) / 100,
      };
    }).sort((a, b) => b.iniciados - a.iniciados);

    res.json({ atendentes, total: grandTotal, dias });
  } catch (err: any) {
    console.error("[Relatórios] Erro atendentes por atribuição:", err);
    res.status(500).json({ error: "Erro ao gerar relatório por atribuição" });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Relatório de CLIENTES — "Total por cliente": quantos atendimentos cada
// cliente final teve no período. Cliente = telefone (cai pro conversation_id
// quando não há telefone). Clicar abre a conversa mais recente do cliente.
// Bruno 2026-06-03.
// ──────────────────────────────────────────────────────────────────────────
router.get("/clientes", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const limite = Math.min(parseInt((req.query.limite as string) || "20") || 20, 100);
    const offset = parseInt((req.query.offset as string) || "0") || 0;
    const busca = ((req.query.busca as string) || "").trim();

    const C2 = conversations;
    // Chave do cliente: telefone (conversa → protocolo); na ausência, id da
    // conversa; e por fim id do protocolo. O 'conv:'||conversationId vira NULL
    // quando conversationId é NULL (|| propaga NULL no PG), então o COALESCE cai
    // pro 'proto:'||id — sem isso protocolos sem telefone E sem conversa
    // colapsavam todos numa "cliente" fictícia 'conv:?'.
    const clientKey = sql`COALESCE(NULLIF(${C2.telefone}, ''), NULLIF(${protocols.contatoTelefone}, ''), 'conv:' || ${protocols.conversationId}::text, 'proto:' || ${protocols.id}::text)`;
    const ultimoSql = sql`MAX(COALESCE(${protocols.resolvedAt}, ${protocols.closedAt}, ${protocols.createdAt}))`;

    const baseConds: any[] = [
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      sql`COALESCE(${C2.isSimulation}, false) = false`,
    ];
    const conds = [...baseConds];
    if (busca) {
      const term = `%${busca}%`;
      conds.push(or(
        ilike(protocols.numero, term),
        ilike(protocols.contatoNome, term),
        ilike(protocols.contatoTelefone, term),
        ilike(C2.nome, term),
        ilike(C2.telefone, term),
      ));
    }
    const where = and(...conds);

    const [{ totalClientes }] = await db.select({
      totalClientes: sql<number>`COUNT(DISTINCT ${clientKey})::int`,
    })
      .from(protocols)
      .leftJoin(C2, eq(protocols.conversationId, C2.id))
      .where(where);

    const rows = await db.select({
      nome: sql<string>`COALESCE(MAX(${C2.nome}), MAX(${protocols.contatoNome}), 'Sem nome')`,
      telefone: sql<string | null>`COALESCE(MAX(${C2.telefone}), MAX(${protocols.contatoTelefone}))`,
      avatar: sql<string | null>`MAX(${C2.avatar})`,
      // Conversa do protocolo MAIS RECENTE (não o maior id) — bate com o ultimoAt
      // exibido. MAX(conversationId) podia abrir uma conversa antiga.
      conversationId: sql<number | null>`(array_agg(${protocols.conversationId} ORDER BY COALESCE(${protocols.resolvedAt}, ${protocols.closedAt}, ${protocols.createdAt}) DESC) FILTER (WHERE ${protocols.conversationId} IS NOT NULL))[1]`,
      total: count(),
      ultimoAt: ultimoSql,
    })
      .from(protocols)
      .leftJoin(C2, eq(protocols.conversationId, C2.id))
      .where(where)
      .groupBy(clientKey)
      .orderBy(sql`COUNT(*) DESC`, sql`${ultimoSql} DESC`)
      .limit(limite)
      .offset(offset);

    // Top 12 pro gráfico — só o período, ignora busca/paginação.
    const topRows = await db.select({
      nome: sql<string>`COALESCE(MAX(${C2.nome}), MAX(${protocols.contatoNome}), 'Sem nome')`,
      total: count(),
    })
      .from(protocols)
      .leftJoin(C2, eq(protocols.conversationId, C2.id))
      .where(and(...baseConds))
      .groupBy(clientKey)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(12);

    res.json({
      items: rows.map((r) => ({
        conversationId: r.conversationId ?? null,
        nome: r.nome,
        telefone: r.telefone || null,
        avatar: r.avatar || null,
        total: Number(r.total) || 0,
        ultimoAt: r.ultimoAt ? new Date(r.ultimoAt as any).toISOString() : null,
      })),
      total: Number(totalClientes) || 0,
      top: topRows.map((t) => ({ nome: t.nome, total: Number(t.total) || 0 })),
      limite,
      offset,
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro clientes:", err);
    res.status(500).json({ error: "Erro ao gerar relatório de clientes" });
  }
});

// Atendimentos (protocolos) de UM cliente — alimenta o modal "ver atendimentos"
// da aba Clientes. Filtra pelo telefone do cliente (normalizado, em conv ou
// protocolo) OU pela conversa quando não há telefone. Mesmo shape do /atendimentos.
router.get("/clientes/atendimentos", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const telefone = ((req.query.telefone as string) || "").trim();
    const conversationId = parseInt((req.query.conversationId as string) || "") || null;
    const limite = Math.min(parseInt((req.query.limite as string) || "50") || 50, 200);
    if (!telefone && !conversationId) {
      return res.status(400).json({ error: "telefone ou conversationId obrigatório" });
    }

    const conds: any[] = [
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      sql`COALESCE(${conversations.isSimulation}, false) = false`,
    ];
    if (telefone) {
      const digits = telefone.replace(/\D/g, "");
      conds.push(sql`(
        regexp_replace(coalesce(${conversations.telefone}, ''), '[^0-9]', '', 'g') = ${digits}
        OR regexp_replace(coalesce(${protocols.contatoTelefone}, ''), '[^0-9]', '', 'g') = ${digits}
      )`);
    } else if (conversationId) {
      conds.push(eq(protocols.conversationId, conversationId));
    }
    const where = and(...conds);

    const rows = await db.select({
      id: protocols.id,
      numero: protocols.numero,
      titulo: protocols.titulo,
      categoria: protocols.categoria,
      status: protocols.status,
      agenteNome: protocols.agenteNome,
      agenteId: protocols.agenteId,
      csatNota: protocols.csatNota,
      conversationId: protocols.conversationId,
      contatoNome: protocols.contatoNome,
      contatoTelefone: protocols.contatoTelefone,
      createdAt: protocols.createdAt,
      resolvedAt: protocols.resolvedAt,
      closedAt: protocols.closedAt,
      convNome: conversations.nome,
      convTelefone: conversations.telefone,
      convAvatar: conversations.avatar,
      convCanal: conversations.canal,
      conexaoNome: conexoes.nome,
      departamentoNome: teams.nome,
    })
      .from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(conexoes, eq(conversations.conexaoId, conexoes.id))
      .leftJoin(teams, eq(conversations.assignedTeamId, teams.id))
      .where(where)
      .orderBy(desc(protocols.createdAt))
      .limit(limite);

    const items = rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      titulo: r.titulo,
      categoria: r.categoria,
      status: STATUS_ENCERRADO.includes(r.status) ? "encerrado" : r.status,
      statusRaw: r.status,
      origem: r.agenteId ? "atendente" : "automacao",
      agenteNome: r.agenteNome,
      csatNota: r.csatNota,
      conversationId: r.conversationId,
      nome: r.contatoNome || r.convNome || "Sem nome",
      telefone: r.contatoTelefone || r.convTelefone || null,
      avatar: r.convAvatar || null,
      canal: r.conexaoNome || r.convCanal || "—",
      departamento: r.departamentoNome || categoriaLabel(r.categoria),
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt || r.closedAt || null,
    }));

    res.json({ items, total: items.length });
  } catch (err: any) {
    console.error("[Relatórios] Erro atendimentos do cliente:", err);
    res.status(500).json({ error: "Erro ao listar atendimentos do cliente" });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Relatório de PESQUISA DE SATISFAÇÃO — CSAT (protocols.csat_nota 1-5) + NPS
// (nps_dispatches.nota 0-10/1-5). Bruno 2026-06-04. Período da CSAT pela
// criação do protocolo (consistente com os outros relatórios); NPS pela
// resposta. Exclui simulação.
// ──────────────────────────────────────────────────────────────────────────
router.get("/satisfacao", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);

    // ── CSAT (base = protocols) ──────────────────────────────────────────
    const csatPeriod = and(
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      sql`COALESCE(${conversations.isSimulation}, false) = false`,
    );

    const [csatAgg] = await db.select({
      respostas: sql<number>`COUNT(*) FILTER (WHERE ${protocols.csatNota} IS NOT NULL)::int`,
      // Bruno 2026-06-04 (review): inclui quem tem nota mesmo sem flag enviado
      // (auto-close/backfill gravam nota sem marcar csat_enviado) → garante
      // respostas <= enviadas (taxa nunca passa de 100%).
      enviadas: sql<number>`COUNT(*) FILTER (WHERE ${protocols.csatEnviado} = true OR ${protocols.csatNota} IS NOT NULL)::int`,
      media: sql<string>`ROUND(AVG(${protocols.csatNota})::numeric, 2)`,
      satisfeitos: sql<number>`COUNT(*) FILTER (WHERE ${protocols.csatNota} >= 4)::int`,
      detratores: sql<number>`COUNT(*) FILTER (WHERE ${protocols.csatNota} <= 2)::int`,
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(csatPeriod);

    const csatDistRows = await db.select({
      nota: protocols.csatNota,
      total: count(),
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(and(csatPeriod, isNotNull(protocols.csatNota)))
      .groupBy(protocols.csatNota);
    const csatDistMap: Record<number, number> = {};
    for (const r of csatDistRows) csatDistMap[Number(r.nota)] = Number(r.total);
    const csatDistribuicao = [1, 2, 3, 4, 5].map((n) => ({ nota: n, total: csatDistMap[n] || 0 }));

    const csatPorDia = await db.select({
      label: sql<string>`TO_CHAR(COALESCE(${protocols.csatRespondidoEm}, ${protocols.createdAt})::date, 'DD/MM')`,
      media: sql<string>`ROUND(AVG(${protocols.csatNota})::numeric, 2)`,
      total: count(),
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(and(csatPeriod, isNotNull(protocols.csatNota)))
      .groupBy(sql`COALESCE(${protocols.csatRespondidoEm}, ${protocols.createdAt})::date`)
      .orderBy(sql`COALESCE(${protocols.csatRespondidoEm}, ${protocols.createdAt})::date ASC`);

    const csatPorSetor = await db.select({
      setor: protocols.categoria,
      media: sql<string>`ROUND(AVG(${protocols.csatNota})::numeric, 2)`,
      total: count(),
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(and(csatPeriod, isNotNull(protocols.csatNota)))
      .groupBy(protocols.categoria)
      .orderBy(sql`COUNT(*) DESC`);

    const csatPorAgente = await db.select({
      agenteId: protocols.agenteId,
      nome: sql<string>`CASE WHEN ${protocols.agenteId} IS NULL THEN 'Automação' ELSE COALESCE(MAX(${users.nome}), MAX(${protocols.agenteNome}), 'Automação') END`,
      avatar: sql<string | null>`MAX(COALESCE(${users.avatarUrl}, ${users.avatar}))`,
      media: sql<string>`ROUND(AVG(${protocols.csatNota})::numeric, 2)`,
      total: count(),
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .leftJoin(users, eq(protocols.agenteId, users.id))
      .where(and(csatPeriod, isNotNull(protocols.csatNota)))
      .groupBy(protocols.agenteId)
      .orderBy(sql`AVG(${protocols.csatNota}) DESC, COUNT(*) DESC`);

    const csatRecentes = await db.select({
      id: protocols.id,
      numero: protocols.numero,
      nota: protocols.csatNota,
      respondidoEm: protocols.csatRespondidoEm,
      createdAt: protocols.createdAt,
      categoria: protocols.categoria,
      agenteNome: protocols.agenteNome,
      conversationId: protocols.conversationId,
      contatoNome: protocols.contatoNome,
      convNome: conversations.nome,
      convAvatar: conversations.avatar,
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(and(csatPeriod, isNotNull(protocols.csatNota)))
      .orderBy(desc(sql`COALESCE(${protocols.csatRespondidoEm}, ${protocols.createdAt})`))
      .limit(15);

    const csatRespostas = Number(csatAgg?.respostas) || 0;
    const csatEnviadas = Number(csatAgg?.enviadas) || 0;

    // ── NPS REMOVIDO (módulo ISP/NPS arrancado do CRM) ───────────────────
    // Tabela nps_dispatches saiu do uso. Mantém o shape do bloco `nps` no
    // payload (zeros/arrays vazios) pro frontend da aba Satisfação não quebrar.
    const npsEscala = 10;
    const npsDistribuicao: { nota: number; total: number }[] = [];
    const npsPorDia: { label: string; promotores: number; detratores: number; total: number }[] = [];
    const npsRespostas = 0;
    const npsProm = 0;
    const npsDet = 0;
    const npsScore: number | null = null;

    res.json({
      csat: {
        media: csatAgg?.media ? parseFloat(csatAgg.media) : null,
        respostas: csatRespostas,
        enviadas: csatEnviadas,
        taxaResposta: csatEnviadas > 0 ? Math.round((csatRespostas / csatEnviadas) * 100) : null,
        pctSatisfeitos: csatRespostas > 0 ? Math.round((Number(csatAgg?.satisfeitos) / csatRespostas) * 100) : null,
        pctInsatisfeitos: csatRespostas > 0 ? Math.round((Number(csatAgg?.detratores) / csatRespostas) * 100) : null,
        distribuicao: csatDistribuicao,
        porDia: csatPorDia.map((r) => ({ label: r.label, media: r.media ? parseFloat(r.media) : 0, total: Number(r.total) })),
        porSetor: csatPorSetor.map((r) => ({ setor: categoriaLabel(r.setor), media: r.media ? parseFloat(r.media) : 0, total: Number(r.total) })),
        porAgente: csatPorAgente.map((r) => ({ agenteId: r.agenteId ?? null, bot: r.agenteId == null, nome: r.nome, avatar: r.avatar || null, media: r.media ? parseFloat(r.media) : 0, total: Number(r.total) })),
        recentes: csatRecentes.map((r) => ({
          id: r.id,
          numero: r.numero,
          nota: r.nota,
          quando: r.respondidoEm || r.createdAt,
          setor: categoriaLabel(r.categoria),
          agenteNome: r.agenteNome,
          conversationId: r.conversationId,
          nome: r.contatoNome || r.convNome || "Sem nome",
          avatar: r.convAvatar || null,
        })),
      },
      nps: {
        escala: npsEscala,
        score: npsScore,
        respostas: npsRespostas,
        enviadas: 0,
        taxaResposta: null,
        promotores: npsProm,
        neutros: 0,
        detratores: npsDet,
        pctPromotores: npsRespostas > 0 ? Math.round((npsProm / npsRespostas) * 100) : 0,
        pctNeutros: 0,
        pctDetratores: npsRespostas > 0 ? Math.round((npsDet / npsRespostas) * 100) : 0,
        distribuicao: npsDistribuicao,
        porDia: npsPorDia.map((r) => ({ label: r.label, promotores: Number(r.promotores), detratores: Number(r.detratores), total: Number(r.total) })),
      },
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro satisfação:", err);
    res.status(500).json({ error: "Erro ao gerar relatório de satisfação" });
  }
});

// Respostas recentes de CSAT filtradas por nota (estrelas) — alimenta o filtro
// por quantidade de estrelas da aba Pesquisa de Satisfação. Mesmo shape dos
// itens de csat.recentes do /satisfacao, mas só dispara quando há filtro ativo
// (a lista "Todas" já vem no payload do /satisfacao). nota inválida = sem filtro.
router.get("/satisfacao/recentes", async (req, res) => {
  try {
    const wsId = await resolveWorkspaceId(req);
    const { dataInicio, dataFim } = parseRange(req.query);
    const notaRaw = parseInt((req.query.nota as string) || "");
    const nota = notaRaw >= 1 && notaRaw <= 5 ? notaRaw : null;
    const limite = Math.min(parseInt((req.query.limite as string) || "50") || 50, 200);

    const conds: any[] = [
      eq(protocols.workspaceId, wsId),
      gte(protocols.createdAt, dataInicio),
      lte(protocols.createdAt, dataFim),
      sql`COALESCE(${conversations.isSimulation}, false) = false`,
      isNotNull(protocols.csatNota),
    ];
    if (nota != null) conds.push(eq(protocols.csatNota, nota));

    const rows = await db.select({
      id: protocols.id,
      numero: protocols.numero,
      nota: protocols.csatNota,
      respondidoEm: protocols.csatRespondidoEm,
      createdAt: protocols.createdAt,
      categoria: protocols.categoria,
      agenteNome: protocols.agenteNome,
      conversationId: protocols.conversationId,
      contatoNome: protocols.contatoNome,
      convNome: conversations.nome,
      convAvatar: conversations.avatar,
    }).from(protocols)
      .leftJoin(conversations, eq(protocols.conversationId, conversations.id))
      .where(and(...conds))
      .orderBy(desc(sql`COALESCE(${protocols.csatRespondidoEm}, ${protocols.createdAt})`))
      .limit(limite);

    res.json({
      recentes: rows.map((r) => ({
        id: r.id,
        numero: r.numero,
        nota: r.nota,
        quando: r.respondidoEm || r.createdAt,
        setor: categoriaLabel(r.categoria),
        agenteNome: r.agenteNome,
        conversationId: r.conversationId,
        nome: r.contatoNome || r.convNome || "Sem nome",
        avatar: r.convAvatar || null,
      })),
    });
  } catch (err: any) {
    console.error("[Relatórios] Erro satisfacao/recentes:", err);
    res.status(500).json({ error: "Erro ao listar respostas de satisfação" });
  }
});

export default router;
