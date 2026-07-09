/**
 * Paridade de canais (Bruno 2026-06-10).
 *
 * Na API Oficial (Meta) o cliente CLICA um botão interativo → o webhook recebe
 * `button_reply.id` (o buttonId). Na Evolution (whatsmeow) o WhatsApp DESCARTA
 * botões/listas interativas em canais não-oficiais, então o agente envia as
 * opções como TEXTO NUMERADO (1️⃣2️⃣3️⃣) e o cliente RESPONDE DIGITANDO o número.
 *
 * Sem tradução, o motor recebe o texto "1"/"2"/"3" em vez do buttonId e não sabe
 * qual opção foi escolhida — os fluxos de menu quebram na Evolution.
 *
 * A mensagem `interactive` que o bot enviou já guarda a estrutura do menu no
 * campo `arquivo` (JSON com `buttons:[{id,title}]` ou `sections:[{rows:[{id}]}]`),
 * então basta ler o último menu e mapear o número → id. Funciona nos dois canais
 * (também tolera o cliente Meta que prefere digitar o número a clicar).
 */

const NUMBER_ONLY = /^(\d{1,2})[.\)\-º°:]?$/;

/** Versão pura/testável: dado o JSON do menu e o texto, devolve o id da opção. */
export function pickNumberedOptionId(
  interactiveArquivo: string | null | undefined,
  text: string,
): string | null {
  if (!interactiveArquivo) return null;
  const mt = (text || "").trim().match(NUMBER_ONLY);
  if (!mt) return null;
  const num = parseInt(mt[1], 10);
  if (num < 1 || num > 20) return null;
  try {
    const meta = JSON.parse(interactiveArquivo);
    const opts: any[] = Array.isArray(meta?.buttons)
      ? meta.buttons
      : Array.isArray(meta?.sections)
        ? meta.sections.flatMap((s: any) => (Array.isArray(s?.rows) ? s.rows : []))
        : [];
    const chosen = opts[num - 1];
    return chosen?.id != null ? String(chosen.id) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve o número digitado → id do botão consultando a ÚLTIMA mensagem do bot.
 * Só resolve se a última outbound foi um menu `interactive` (evita falso-positivo
 * quando o cliente manda um número que não é escolha de menu, ex: "2" como resposta
 * livre). Retorna null se não for número, não houver menu, ou o índice não existir.
 */
export async function resolveNumberedButtonReply(
  _workspaceId: string,
  conversationId: number,
  text: string,
): Promise<string | null> {
  if (!NUMBER_ONLY.test((text || "").trim())) return null;
  // import dinâmico: mantém a lógica pura (pickNumberedOptionId) livre da conexão
  // com o banco, pra ser testável sem DATABASE_URL.
  const { db } = await import("../db");
  const { messages } = await import("@shared/schema");
  const { and, eq, desc } = await import("drizzle-orm");
  const [lastOut] = await db
    .select({ tipo: messages.tipo, arquivo: messages.arquivo })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!lastOut || lastOut.tipo !== "interactive") return null;
  return pickNumberedOptionId(lastOut.arquivo as any, text);
}

/**
 * Resolve o TÍTULO da opção pelo id, lendo o último menu interativo do bot.
 * Bruno 2026-06-11 (conv 2875): clique de botão NATIVO na Evolution chega com texto
 * VAZIO (só o buttonId) → a escolha do cliente NÃO aparecia no chat. Resolve o título
 * (ex.: "🐢 Internet lenta") pra persistir a msg inbound com o texto da opção escolhida
 * — paridade Meta, que entrega selectedDisplayText. Lê o MESMO arquivo do pickNumberedOptionId.
 */
export async function resolveButtonTitleById(
  conversationId: number,
  buttonId: string,
): Promise<string | null> {
  if (!buttonId) return null;
  const { db } = await import("../db");
  const { messages } = await import("@shared/schema");
  const { and, eq, desc } = await import("drizzle-orm");
  const [lastOut] = await db
    .select({ tipo: messages.tipo, arquivo: messages.arquivo })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!lastOut || lastOut.tipo !== "interactive" || !lastOut.arquivo) return null;
  try {
    const meta = JSON.parse(lastOut.arquivo as string);
    const opts: any[] = Array.isArray(meta?.buttons)
      ? meta.buttons
      : Array.isArray(meta?.sections)
        ? meta.sections.flatMap((s: any) => (Array.isArray(s?.rows) ? s.rows : []))
        : [];
    const found = opts.find((o) => String(o?.id) === String(buttonId));
    return found?.title != null ? String(found.title) : null;
  } catch {
    return null;
  }
}
