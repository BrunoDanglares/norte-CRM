// Máscaras de PII pra LOGS (Bruno 2026-06-13, auditoria de segurança/LGPD).
// Logs do container ficam legíveis pra quem acessa o painel — nunca logar CPF,
// telefone ou conteúdo de mensagem em texto puro. Para correlação de debug,
// mantém só um sufixo/prefixo curto.

/** CPF/CNPJ → mostra só os 3 primeiros dígitos. Ex: "12345678901" → "123***". */
export function maskCpf(cpf?: string | null): string {
  if (!cpf) return "none";
  const d = String(cpf).replace(/\D/g, "");
  if (!d) return "none";
  if (d.length <= 3) return "***";
  return `${d.slice(0, 3)}***`;
}

/** Telefone → mostra só os 4 últimos dígitos. Ex: "5591999998888" → "***8888". */
export function maskPhone(phone?: string | null): string {
  if (!phone) return "none";
  const d = String(phone).replace(/\D/g, "");
  if (!d) return "none";
  if (d.length <= 4) return "***";
  return `***${d.slice(-4)}`;
}
