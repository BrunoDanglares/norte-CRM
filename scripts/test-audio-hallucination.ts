// Bateria do guard anti-alucinação do Whisper. Rodar: npx tsx scripts/test-audio-hallucination.ts
// Nasceu do fix de 2026-07-16 (falso positivo em fala longa) — este teste pegou
// uma regressão da 1a tentativa de fix. Rode ao mexer em audioHallucination.ts.
import { detectWhisperHallucination } from "../server/utils/audioHallucination";
const CASOS: [string, string, boolean][] = [
  ["ALUCINAÇÃO: frase curta em loop", "Deixe eu ver. Deixe eu ver. Deixe eu ver.", true],
  ["ALUCINAÇÃO: inscreva-se no canal", "Se inscreve no canal. Se inscreve no canal. Se inscreve no canal.", true],
  ["ALUCINAÇÃO: palavra em loop", "obrigado obrigado obrigado obrigado obrigado obrigado obrigado obrigado", true],
  ["ALUCINAÇÃO: loop no fim de texto curto", "então tá bom valeu tchau tchau tchau tchau tchau tchau tchau tchau", true],
  ["ALUCINAÇÃO: frase média dominando", "muito obrigado pela atenção muito obrigado pela atenção muito obrigado pela atenção muito obrigado pela atenção", true],
  ["REAL: fala longa do Tiago (financeiro)",
   "no financeiro, enviar o boleto, o boleto Pix, Copia e Cola, e fazer o desbloqueio de confiança se o cliente pedir o desbloqueio. Detalhe, a gente emite boleto de serviço, quando a gente vende um produto, vende um roteador para o cliente, a gente emite um boleto de serviço. Então se o cliente pedir o boleto, a gente manda o boleto da mensalidade, mas se o cliente pedir o boleto do roteador, a gente manda o boleto de serviço. Se o cliente quiser negociar, a gente transfere para o financeiro. Se o cliente pedir o desbloqueio de confiança, a gente libera se ele tiver dentro da regra. Se o cliente já usou o desbloqueio no mês, a gente não libera de novo e transfere para o financeiro resolver isso com ele.",
   false],
  ["REAL: fala curta natural", "Oi, bom dia, eu queria saber sobre o plano de vocês por favor", false],
  ["REAL: suporte explicando (repete 'o cliente')",
   "E no suporte são duas questões, se é problema de lentidão, travamento ou se é offline. Se for travamento, orientar e ensinar o cliente a reiniciar os equipamentos primeiro, depois pedir para o cliente desconectar todos os dispositivos, ficar só com o celular conectado, e depois solicitar um print de um speed test. A gente tem um servidor próprio, então a gente envia o nosso link para o cliente, exemplo da mensagem, abre o site e envia o print do resultado para a gente.",
   false],
  ["REAL: cliente irritado repetindo", "eu já liguei três vezes, três vezes eu liguei e ninguém resolve, eu quero cancelar isso aqui agora", false],
];
let falhas = 0;
for (const [nome, texto, deveCortar] of CASOS) {
  const v = detectWhisperHallucination(texto);
  const ok = v.hallucinated === deveCortar;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${nome}\n     esperado: ${deveCortar ? "cortar" : "passar"} | obtido: ${v.hallucinated ? `cortou (${v.reason})` : "passou"}`);
}
console.log(`\n${CASOS.length - falhas}/${CASOS.length} corretos ${falhas ? "— ❌ REGRESSÃO!" : "— sem regressão ✅"}`);
