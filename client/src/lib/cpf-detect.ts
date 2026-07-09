// Detecção de CPF/CNPJ digitado pelo cliente no chat — usado pra SUGERIR o
// documento ao atendente no painel "Cliente não identificado" (Bruno 2026-06-05),
// quando ainda não há CPF salvo. Valida dígitos verificadores pra não sugerir
// número aleatório (telefone, protocolo) como se fosse CPF.

export function isValidCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d)) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais (000... / 111...)
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(d[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(d[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(d[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(d[10], 10);
}

export function isValidCnpj(d: string): boolean {
  if (!/^\d{14}$/.test(d)) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number): number => {
    const pesos = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < len; i++) soma += parseInt(d[i], 10) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(d[12], 10) && calc(13) === parseInt(d[13], 10);
}

/**
 * Acha o 1º CPF (11) ou CNPJ (14) VÁLIDO num texto. Aceita formatado
 * (123.456.789-00 / 00.000.000/0000-00) ou plano (12345678900). Retorna só os
 * dígitos, ou null. Os lookbehind/ahead evitam casar no meio de um número maior.
 */
export function findCpfCnpjInText(text: string): string | null {
  if (!text) return null;
  // Sem lookbehind/lookahead (Safari < 16.4 dá SyntaxError no parse). Pega cada
  // "run" que começa e termina em dígito e tem só dígitos + separadores comuns
  // (. - /). Limpa e SÓ aceita se sobrar EXATAMENTE 11 (CPF) ou 14 (CNPJ) —
  // isso já barra telefone (10-11 sem sep dá 11, mas aí o dígito verificador
  // reprova), data, valor, linha de boleto (run longo → ≠ 11/14 → descartado).
  const cpfCands: string[] = [];
  const cnpjCands: string[] = [];
  const re = /\d[\d.\-/]{9,16}\d/g;
  for (const m of text.match(re) || []) {
    const d = m.replace(/\D/g, "");
    if (d.length === 11) cpfCands.push(d);
    else if (d.length === 14) cnpjCands.push(d);
  }
  for (const c of cnpjCands) if (isValidCnpj(c)) return c;
  for (const c of cpfCands) if (isValidCpf(c)) return c;
  return null;
}

type ChatMsg = { direction?: string | null; texto?: string | null };

/**
 * Varre as mensagens do CLIENTE (inbound), da mais RECENTE pra mais antiga, e
 * devolve os dígitos do 1º CPF/CNPJ válido encontrado — ou null. Só inbound: o
 * documento que interessa é o que o cliente digitou, não o que o bot/atendente
 * ecoou.
 */
export function suggestCpfFromMessages(messages: ChatMsg[] | undefined | null): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    // direction ausente = trata como inbound (defensivo); "out" pula.
    if (m.direction && m.direction !== "in") continue;
    const found = findCpfCnpjInText(String(m.texto || ""));
    if (found) return found;
  }
  return null;
}

/** 12345678900 → 123.456.789-00 | 14 díg → 00.000.000/0000-00. */
export function formatCpfCnpj(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}
