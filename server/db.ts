import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// statement_timeout aborta queries que ficaram presas no PG (deadlock leve,
// query mal-otimizada que vai pra full-scan, etc). Sem isso, uma única query
// ruim trava a conexão até o idleTimeout (30s) — o que basicamente faz a
// connection pool engasgar. 30s cobre folga toda query legítima do projeto:
// o request HTTP top-level já tem orçamento ~20s antes de o cliente desistir.
//
// query_timeout é o lado client-side do mesmo orçamento: aborta no driver
// node-pg quando a query demora demais a responder, mesmo que o servidor
// ainda esteja "trabalhando". Cinto + suspensório.
// Bruno 2026-05-30 (Onda 0 escalabilidade): pool 20 → 50.
// Cada turn V2 segura conexão por ~2.5s (queries + LLM + ERP). Pool 20
// estoura em pico de >8 turns/seg (50 tenants ISP médios). Subir pra 50
// dá folga até ~120 tenants sem mexer infra. Postgres aguenta sem stress
// — gargalo é o app, não o DB. PRÓXIMO PASSO (Onda 4): pgBouncer transaction
// pooling — app vê pool infinito, PG vê ~30 conexões reais.
//
// connectionTimeout 5s → 10s: em pico, espera mais antes de 500. Reduz
// burst-induced erros sem mascarar deadlock real (>10s = problema sério).
//
// Bruno 2026-06-02: pool max configurável por env DB_POOL_MAX (default 50, então
// prod não muda). Scripts/baterias devem rodar com DB_POOL_MAX pequeno (ex: 5)
// pra NÃO engolir ~50 conexões do Postgres — foi o que saturou prod em 100/100
// ("too many clients") quando baterias rodaram em paralelo contra o banco de
// produção. Ver memória testes_sempre_local_conexaonet. PRÓXIMO: pgBouncer.
const POOL_MAX = Math.max(1, Number(process.env.DB_POOL_MAX) || 50);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
});

export const db = drizzle(pool, { schema });

// Bruno 2026-06-02: conexão DIRETA (bypass pgBouncer) pra quem precisa de
// semântica de SESSÃO — hoje só os advisory locks dos crons (utils/pg-lock).
// pgBouncer em transaction-pooling solta locks de sessão entre transações
// (server_reset_query DISCARD ALL), o que quebraria o mutex dos schedulers.
// Solução padrão: app → pgBouncer (DATABASE_URL); cron/locks → Postgres direto
// (DIRECT_DATABASE_URL). Enquanto DIRECT_DATABASE_URL não existir (sem pgBouncer),
// directDb REUSA o pool principal — zero conexão extra, zero mudança de comportamento.
const DIRECT_URL = process.env.DIRECT_DATABASE_URL;
export const directDb = (DIRECT_URL && DIRECT_URL !== process.env.DATABASE_URL)
  ? drizzle(new Pool({
      connectionString: DIRECT_URL,
      max: Math.max(1, Number(process.env.DIRECT_POOL_MAX) || 4),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 30000,
    }), { schema })
  : db;
