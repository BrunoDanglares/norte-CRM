// ═══════════════════════════════════════════════════════════════════════════
// Datas comemorativas / de marketing do Brasil — GENÉRICAS (servem qualquer
// segmento). O estratégista do Instaflix recebe as datas próximas pra sugerir
// conteúdo sazonal. Só datas de valor comercial amplo; nada específico de nicho.
//
// Datas de dia fixo (mês/dia). Feriados móveis (Páscoa/Carnaval) ficam de fora
// por ora — exigiriam cálculo; podem entrar depois. Bruno 2026-07-04.
// ═══════════════════════════════════════════════════════════════════════════

export interface DataComemorativa {
  mes: number;   // 1-12
  dia: number;   // 1-31
  nome: string;
}

// Calendário comercial amplo (não depende de segmento).
const CALENDARIO: DataComemorativa[] = [
  { mes: 1, dia: 1, nome: "Ano Novo" },
  { mes: 3, dia: 8, nome: "Dia Internacional da Mulher" },
  { mes: 3, dia: 15, nome: "Dia do Consumidor" },
  { mes: 4, dia: 21, nome: "Tiradentes" },
  { mes: 5, dia: 1, nome: "Dia do Trabalho" },
  { mes: 5, dia: 11, nome: "Dia das Mães (2º domingo de maio — aprox.)" },
  { mes: 6, dia: 12, nome: "Dia dos Namorados" },
  { mes: 8, dia: 10, nome: "Dia dos Pais (2º domingo de agosto — aprox.)" },
  { mes: 9, dia: 7, nome: "Independência do Brasil" },
  { mes: 9, dia: 15, nome: "Dia do Cliente" },
  { mes: 10, dia: 12, nome: "Dia das Crianças" },
  { mes: 10, dia: 15, nome: "Dia do Professor" },
  { mes: 11, dia: 15, nome: "Proclamação da República" },
  { mes: 11, dia: 28, nome: "Black Friday (última sexta de novembro — aprox.)" },
  { mes: 12, dia: 25, nome: "Natal" },
  { mes: 12, dia: 31, nome: "Réveillon" },
];

// Retorna as datas que caem nos próximos `dias` a partir de hoje, ordenadas.
// Recebe `hoje` por parâmetro (Date.now/new Date() são proibidos em alguns
// contextos; aqui o chamador passa a data atual).
//
// `timeZone` (opcional): quando informado, o dia-calendário de referência é
// derivado NA timezone da marca (não no horário local do servidor). Sem isso, um
// servidor em UTC calcularia "em X dias" errado por 1 dia para instantes perto da
// meia-noite no Brasil (ex.: slot 22:30 BRT = 01:30 UTC do dia seguinte).
export function datasComemorativasProximas(hoje: Date, dias = 45, timeZone?: string): Array<{ nome: string; data: Date; emDias: number }> {
  let y = hoje.getFullYear(), mo = hoje.getMonth() + 1, d = hoje.getDate();
  if (timeZone) {
    try {
      const p: Record<string, string> = {};
      for (const part of new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(hoje)) {
        if (part.type !== "literal") p[part.type] = part.value;
      }
      y = +p.year; mo = +p.month; d = +p.day;
    } catch { /* timezone inválida → cai no horário local */ }
  }
  const ini = new Date(y, mo - 1, d);
  const out: Array<{ nome: string; data: Date; emDias: number }> = [];
  for (const d of CALENDARIO) {
    // Considera a ocorrência neste ano e no próximo (pra pegar virada de ano).
    for (const ano of [ini.getFullYear(), ini.getFullYear() + 1]) {
      const data = new Date(ano, d.mes - 1, d.dia);
      const emDias = Math.round((data.getTime() - ini.getTime()) / 86_400_000);
      if (emDias >= 0 && emDias <= dias) out.push({ nome: d.nome, data, emDias });
    }
  }
  return out.sort((a, b) => a.emDias - b.emDias);
}
