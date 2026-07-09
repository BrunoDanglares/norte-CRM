// Health endpoints — diagnóstico de produção (Bruno, hardening 2026-05-03).
//
// /api/health           — basic 200 OK pra UptimeRobot e load balancer
// /api/health/detailed  — diagnóstico completo (DB, conexões Evolution, OpenAI,
//                          memória, uptime, schedulers). Auth-protegido.
//
// Princípio: endpoint básico SEM dependência (pra LB/uptime nunca falhar
// por timeout em DB). Endpoint detailed com checks reais — uso pra
// debug em incidente.

import type { Express } from 'express';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { requireAuth } from '../middleware/auth';

const BOOT_AT = new Date();

interface HealthCheck {
  ok: boolean;
  detail?: string;
  ms?: number;
}

async function checkDatabase(): Promise<HealthCheck> {
  const t0 = Date.now();
  try {
    await db.execute(sql`SELECT 1 as ok`);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, detail: e.message?.slice(0, 200), ms: Date.now() - t0 };
  }
}

// Saturação do pool de conexões do banco — o gargalo REAL de escala (ver db.ts:18).
// "esperando" > 0 de forma recorrente = requisições na fila aguardando uma conexão
// livre: o aviso de que está chegando no teto (~120 tenants no pool 50) ANTES de
// virar erro 500 pro cliente. Não derruba o allOk (um pico breve é normal sob carga);
// é um medidor de capacidade, não um up/down.
async function checkPool(): Promise<HealthCheck> {
  const p: any = pool;
  const total = p.totalCount ?? 0;
  const idle = p.idleCount ?? 0;
  const waiting = p.waitingCount ?? 0;
  const max = p.options?.max ?? (Number(process.env.DB_POOL_MAX) || 50);
  const inUse = total - idle;
  return {
    ok: waiting === 0,
    detail: `em_uso=${inUse}/${max} ociosas=${idle} esperando=${waiting}${waiting > 0 ? ' [FILA]' : ''}`,
  };
}

async function checkOpenAIEnv(): Promise<HealthCheck> {
  const env = process.env.OPENAI_API_KEY || '';
  const aiEnv = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || '';
  if (!env && !aiEnv) {
    return { ok: false, detail: 'sem chave OPENAI_API_KEY nem AI_INTEGRATIONS_OPENAI_API_KEY no env' };
  }
  // Não chama OpenAI aqui — só checa que tem chave configurada. Latência da
  // chamada real seria custosa em health check polled a cada minuto.
  return { ok: true, detail: env ? `env=set(${env.length})` : 'ai_integrations only' };
}

async function checkMemory(): Promise<HealthCheck> {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  // Threshold conservador: 4GB rss começa a preocupar num VPS com 8GB
  const ok = rssMB < 4096;
  return {
    ok,
    detail: `rss=${rssMB}MB heap=${heapMB}MB${ok ? '' : ' [HIGH]'}`,
  };
}

async function checkWhatsappSessions(): Promise<HealthCheck> {
  // Canal não-oficial = Evolution GO (serviço externo). Conta as conexões com
  // status 'connected' no banco — não há mais sessões em memória (o canal
  // não-oficial in-process foi removido na migração para o Evolution).
  try {
    const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM conexoes WHERE provider = 'evolution' AND status = 'connected'`);
    const rows = Array.isArray(r) ? r : (r as any).rows || [];
    const count = rows[0]?.n ?? 0;
    return { ok: true, detail: `${count} conexão(ões) Evolution conectada(s)` };
  } catch {
    return { ok: true, detail: 'Evolution: contagem indisponível' };
  }
}

async function checkActiveTenants(): Promise<HealthCheck> {
  try {
    const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM workspaces`);
    const rows = Array.isArray(r) ? r : (r as any).rows || [];
    const n = rows[0]?.n ?? 0;
    return { ok: true, detail: `${n} workspaces` };
  } catch (e: any) {
    return { ok: false, detail: e.message?.slice(0, 100) };
  }
}

async function checkOpenSessions(): Promise<HealthCheck> {
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM conversations
      WHERE status = 'open' AND updated_at > NOW() - INTERVAL '1 hour'
    `);
    const rows = Array.isArray(r) ? r : (r as any).rows || [];
    return { ok: true, detail: `${rows[0]?.n ?? 0} conversas abertas (última hora)` };
  } catch (e: any) {
    return { ok: false, detail: e.message?.slice(0, 100) };
  }
}

async function checkRecentMessages(): Promise<HealthCheck> {
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM messages
      WHERE created_at > NOW() - INTERVAL '5 minutes'
    `);
    const rows = Array.isArray(r) ? r : (r as any).rows || [];
    return { ok: true, detail: `${rows[0]?.n ?? 0} msgs últimos 5min` };
  } catch (e: any) {
    return { ok: false, detail: e.message?.slice(0, 100) };
  }
}

async function checkSentry(): Promise<HealthCheck> {
  try {
    const { isSentryActive } = await import('../services/sentryOptional');
    const active = isSentryActive();
    return { ok: true, detail: active ? 'ativo' : 'desligado (sem SENTRY_DSN)' };
  } catch {
    return { ok: true, detail: 'módulo indisponível' };
  }
}

export function registerHealthRoutes(app: Express) {
  // Endpoint público pra UptimeRobot, load balancer, etc. SEM dependência —
  // se DB cair, este endpoint AINDA responde 200 (LB não tira instância
  // por DB indisponível, só por servidor caído).
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime_seconds: Math.round((Date.now() - BOOT_AT.getTime()) / 1000),
      boot_at: BOOT_AT.toISOString(),
      version: process.env.GIT_COMMIT?.slice(0, 8) || 'dev',
    });
  });

  // Endpoint detalhado — auth-protegido pra não vazar info interna.
  // Uso: chamar em incidente, debug, monitoring interno.
  app.get('/api/health/detailed', requireAuth, async (req, res) => {
    // Auditoria 2026-06-19: este endpoint faz COUNT global (nº de tenants, sessões
    // e mensagens de TODA a plataforma) + comprimento da chave OpenAI. É diagnóstico
    // do dono → restrito a super-admin. Antes, qualquer tenant logado lia métricas
    // agregadas cross-tenant do SaaS.
    if (!(req as any).user?.superAdmin && String((req as any).user?.role) !== 'superadmin') {
      return res.status(403).json({ ok: false, error: 'Acesso restrito' });
    }
    const t0 = Date.now();
    const [database, dbPool, openai, memory, whatsappSessions, activeTenants, openSessions, recentMessages, sentry] = await Promise.all([
      checkDatabase(),
      checkPool(),
      checkOpenAIEnv(),
      checkMemory(),
      checkWhatsappSessions(),
      checkActiveTenants(),
      checkOpenSessions(),
      checkRecentMessages(),
      checkSentry(),
    ]);

    const allOk = [database, openai, memory, activeTenants, openSessions, recentMessages].every((c) => c.ok);

    res.json({
      ok: allOk,
      checked_in_ms: Date.now() - t0,
      uptime_seconds: Math.round((Date.now() - BOOT_AT.getTime()) / 1000),
      boot_at: BOOT_AT.toISOString(),
      env: {
        node: process.version,
        platform: process.platform,
        timezone: process.env.TZ || 'system',
      },
      checks: {
        database,
        pool: dbPool,
        openai_env: openai,
        memory,
        whatsapp_sessions: whatsappSessions,
        active_tenants: activeTenants,
        open_conversations: openSessions,
        recent_messages: recentMessages,
        sentry,
      },
    });
  });
}
