// ─────────────────────────────────────────────────────────────────────────
// Limpeza de resíduo ISP no banco (dev/local). Duas frentes:
//   1) Respostas rápidas: troca os 4 templates DEFAULT com conteúdo ISP
//      (fibra/ONU/Wi-Fi/instabilidade na rede) por versões genéricas de CRM,
//      e acentua "Pesquisa de Satisfacao".
//   2) Conversas de TESTE/eval (🧪, sim_bot, iter, gap, GAPA, AC, EmDia,
//      Suspenso, Probe, CsatFlag, coleta, verify) + TODAS as linhas dependentes
//      (qualquer tabela com coluna conversation_id) — apagadas em transação.
//
// SEGURANÇA:
//   - DRY-RUN por padrão. Só aplica com a flag `--apply`.
//   - Faz backup (JSON) das conversas apagadas antes de deletar.
//   - Roda em transação (rollback em erro).
//   - Pool próprio pequeno (max 3) pra não saturar o Postgres.
//   - Confere que o host é localhost antes de qualquer escrita.
//
// Uso:  tsx scripts/limpar-residuo-isp.ts            (dry-run, só mostra)
//       tsx scripts/limpar-residuo-isp.ts --apply    (aplica)
// ─────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const URL = process.env.DATABASE_URL || "";
const OUT = path.join(process.cwd(), "scripts", "_backups");

// Guardrail: só roda em banco local (dev). Recusa qualquer host remoto.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(URL)) {
  console.error("ABORT: DATABASE_URL não aponta pra localhost. Este script só roda no banco de dev.");
  process.exit(1);
}

const pool = new Pool({ connectionString: URL, max: 3, statement_timeout: 0 });

// RESET TOTAL do inbox: o banco local é ~100% dado de teste/eval do agente ISP
// (🧪, sim_bot, iter, GAPA, AC, "t", "🏷️ T##", "Smoke ONU", auto-testes do Bruno…).
// Pattern-matching deixava centenas de resíduos, então zeramos TODAS as conversas
// pra um slate limpo. Contatos/leads NÃO são tocados (só conversas + dependentes).
const TEST_WHERE = `(TRUE)`;

async function main() {
  const c = await pool.connect();
  try {
    const total = (await c.query(`SELECT count(*)::int n FROM conversations`)).rows[0].n;
    const doomed = (await c.query(`SELECT count(*)::int n FROM conversations WHERE ${TEST_WHERE}`)).rows[0].n;
    const keptSample = (await c.query(
      `SELECT nome FROM conversations WHERE NOT ${TEST_WHERE} ORDER BY id DESC LIMIT 30`
    )).rows.map((r: any) => r.nome);

    console.log(`\n── CONVERSAS ──`);
    console.log(`  total: ${total} · a deletar (teste): ${doomed} · mantidas: ${total - doomed}`);
    console.log(`  amostra MANTIDAS:`, keptSample);

    // Tabelas dependentes (coluna conversation_id inteira)
    const depTables = (await c.query(
      `SELECT table_name FROM information_schema.columns
       WHERE column_name = 'conversation_id' AND data_type = 'integer' AND table_schema = 'public'
       ORDER BY table_name`
    )).rows.map((r: any) => r.table_name);
    console.log(`  tabelas dependentes:`, depTables.join(", "));

    const ispRR = (await c.query(
      `SELECT count(*)::int n FROM respostas_rapidas
       WHERE atalho IN ('/planos','/contratacao','/suporte','/incidente')
         AND (texto ILIKE '%fibra%' OR texto ILIKE '%mega%' OR texto ILIKE '%ONU%'
              OR texto ILIKE '%roteador%' OR texto ILIKE '%instabilidade na rede%' OR texto ILIKE '%SSID%')`
    )).rows[0].n;
    const surveyRR = (await c.query(`SELECT count(*)::int n FROM respostas_rapidas WHERE titulo = 'Pesquisa de Satisfacao'`)).rows[0].n;
    console.log(`\n── RESPOSTAS RÁPIDAS ──`);
    console.log(`  templates ISP a genericizar: ${ispRR} · pesquisas a acentuar: ${surveyRR}`);

    if (!APPLY) {
      console.log(`\n[DRY-RUN] Nada foi alterado. Rode com --apply pra executar.\n`);
      process.exit(0);
    }

    // Backup das conversas doomed (id/nome/telefone/ws) antes de apagar.
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const doomedRows = (await c.query(
      `SELECT id, nome, telefone, status, workspace_id, agente FROM conversations WHERE ${TEST_WHERE}`
    )).rows;
    const backupFile = path.join(OUT, `conversas-apagadas-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(doomedRows, null, 2), "utf8");
    console.log(`\n[backup] ${doomedRows.length} conversas salvas em ${backupFile}`);

    await c.query("BEGIN");
    const sub = `(SELECT id FROM conversations WHERE ${TEST_WHERE})`;

    // 1) apaga dependentes
    for (const t of depTables) {
      const r = await c.query(`DELETE FROM "${t}" WHERE conversation_id IN ${sub}`);
      console.log(`   ${t}: ${r.rowCount} linhas`);
    }
    // 2) apaga conversas
    const convDel = await c.query(`DELETE FROM conversations WHERE ${TEST_WHERE}`);
    console.log(`   conversations: ${convDel.rowCount} linhas`);

    // 3) genericiza os templates ISP (todos os workspaces)
    await c.query(`UPDATE respostas_rapidas SET titulo = 'Nossos Serviços', categoria = 'Comercial',
      texto = '📋 Confira o que a {{empresa}} oferece, {{nome}}! Me diz qual seu interesse que eu te passo as opções, valores e condições ideais pra você. 😊'
      WHERE atalho = '/planos' AND (texto ILIKE '%fibra%' OR texto ILIKE '%mega%')`);
    await c.query(`UPDATE respostas_rapidas SET titulo = 'Dados para Cadastro', categoria = 'Comercial',
      texto = '🥳 Ótimo! Para finalizar, preciso de algumas informações. Pode me enviar tudo de uma vez:\n\n👤 1. Nome completo\n📄 2. CPF ou CNPJ\n✉️ 3. E-mail\n📞 4. Telefone principal\n📍 5. Endereço completo\n\nAssim que receber, dou sequência pra você! 😊'
      WHERE atalho = '/contratacao' AND texto ILIKE '%SSID%'`);
    await c.query(`UPDATE respostas_rapidas SET titulo = 'Suporte', categoria = 'Suporte',
      texto = '🔧 {{nome}}, vamos resolver! Me conta: o que está acontecendo? Desde quando? Se puder, envie um print ou foto que ajude a entender.\n\nCom essas informações eu já consigo te ajudar ou acionar a equipe responsável. 😊'
      WHERE atalho = '/suporte' AND (texto ILIKE '%ONU%' OR texto ILIKE '%roteador%' OR texto ILIKE '%fast.com%')`);
    await c.query(`UPDATE respostas_rapidas SET titulo = 'Aviso de Instabilidade', categoria = 'Suporte',
      texto = '⚠️ Aviso — Instabilidade\n\nOlá {{nome}}! 👋 Pedimos sinceras desculpas pelo transtorno.\n\nEstamos cientes de uma instabilidade que pode estar afetando o serviço e nossa equipe já está trabalhando para normalizar tudo o mais rápido possível. 🔧\n\nAgradecemos a sua compreensão e paciência! 🙏 — {{empresa}}'
      WHERE atalho = '/incidente' AND texto ILIKE '%instabilidade na rede%'`);

    // 4) acentua a pesquisa de satisfação
    await c.query(`UPDATE respostas_rapidas SET titulo = 'Pesquisa de Satisfação',
      texto = 'Olá! Gostaríamos de saber sua opinião sobre nosso atendimento. Por favor, avalie de 1 a 5:\n\n1 - Muito insatisfeito\n2 - Insatisfeito\n3 - Neutro\n4 - Satisfeito\n5 - Muito satisfeito\n\nResponda com o número correspondente.'
      WHERE titulo = 'Pesquisa de Satisfacao'`);
    await c.query(`UPDATE pesquisas_satisfacao SET titulo = 'Pesquisa de Satisfação' WHERE titulo = 'Pesquisa de Satisfacao'`).catch(() => {});

    await c.query("COMMIT");
    console.log(`\n✅ Aplicado com sucesso. Backup em ${backupFile}\n`);
    process.exit(0);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("ERRO — rollback aplicado:", e);
    process.exit(1);
  } finally {
    c.release();
  }
}
main();
