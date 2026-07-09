import { Fragment, type ReactNode } from "react";

// Formatação inline estilo WhatsApp para previews de mensagens:
//   *texto* → bold, _texto_ → italic, ~texto~ → strike, `texto` → mono
// Aplicada SÓ em previews curtos (cards, lista de conversas) — o MessageArea
// principal já tem renderização própria mais rica.
//
// Regras:
// - Delimitadores precisam ter conteúdo não vazio e não ter espaço logo após
//   o abre (`* abc*` não vira bold) — mesma heurística do WhatsApp.
// - Não aninha (`*_abc_*` vira apenas o nível externo). Aceitável pra preview.
// - Escape: pra mostrar `*` literal use `\*`.

interface Token {
  kind: "text" | "bold" | "italic" | "strike" | "mono";
  value: string;
}

const DELIMS: Array<{ char: string; kind: Token["kind"] }> = [
  { char: "*", kind: "bold" },
  { char: "_", kind: "italic" },
  { char: "~", kind: "strike" },
  { char: "`", kind: "mono" },
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let buffer = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    // Escape: \* \_ \~ \`
    if (ch === "\\" && i + 1 < input.length && DELIMS.some((d) => d.char === input[i + 1])) {
      buffer += input[i + 1];
      i += 2;
      continue;
    }
    const delim = DELIMS.find((d) => d.char === ch);
    if (delim) {
      // Acha o fechamento: mesmo char, conteúdo não vazio, sem espaço após o abre.
      const next = input[i + 1];
      if (next && next !== " " && next !== ch) {
        const closeIdx = input.indexOf(ch, i + 1);
        if (closeIdx > i + 1) {
          // Garante que o caractere antes do fechamento não seja espaço.
          if (input[closeIdx - 1] !== " ") {
            const inner = input.slice(i + 1, closeIdx);
            if (buffer) {
              tokens.push({ kind: "text", value: buffer });
              buffer = "";
            }
            tokens.push({ kind: delim.kind, value: inner });
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }
    buffer += ch;
    i += 1;
  }
  if (buffer) tokens.push({ kind: "text", value: buffer });
  return tokens;
}

export function formatWppText(text: string | null | undefined): ReactNode {
  if (!text) return text ?? "";
  const tokens = tokenize(text);
  if (tokens.length === 0) return text;
  return (
    <>
      {tokens.map((t, idx) => {
        if (t.kind === "text") return <Fragment key={idx}>{t.value}</Fragment>;
        if (t.kind === "bold") return <strong key={idx}>{t.value}</strong>;
        if (t.kind === "italic") return <em key={idx}>{t.value}</em>;
        if (t.kind === "strike") return <s key={idx}>{t.value}</s>;
        if (t.kind === "mono") return <code key={idx} className="font-mono text-[0.92em]">{t.value}</code>;
        return <Fragment key={idx}>{t.value}</Fragment>;
      })}
    </>
  );
}
