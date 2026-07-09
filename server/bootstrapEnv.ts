// Bootstrap de ambiente — DEVE ser o PRIMEIRO import do index.ts, antes de
// qualquer módulo que leia process.env no carregamento (db.ts lê DATABASE_URL,
// routes/auth.ts lê GOOGLE_CLIENT_ID).
//
// Problema que isto resolve: o `--import dotenv/config` (no script `npm run dev`)
// carrega o .env, MAS o dotenv por padrão NÃO sobrescreve variáveis que já existem
// no ambiente — nem quando estão VAZIAS. Se o terminal/VS Code que lança o dev
// tiver, por exemplo, GOOGLE_CLIENT_ID="" herdado na sessão, o valor real do .env
// é ignorado e o botão "Entrar com Google" some. Forçar override resolve isso.
//
// Só roda em desenvolvimento: em produção (EasyPanel) o ambiente vem do painel e
// não há .env no container, então isto é no-op e o comportamento de prod não muda.
import { config } from "dotenv";

if (process.env.NODE_ENV !== "production") {
  config({ override: true });
}
