import { db } from "../db";
import { messages, protocols } from "../../shared/schema";
import type { InsertMessage, Message } from "../../shared/schema";
import { and, eq, sql, inArray } from "drizzle-orm";

// Insere uma mensagem associando-a automaticamente ao protocolo ativo da
// conversa. Usado pelos pontos do código que persistem mensagens via
// `db.insert(messages)` direto (mensagens de sistema, agente IA, etc) ao
// invés de passar por `storage.createMessage`. Essa associação é o que
// permite o frontend desenhar o separador horizontal entre atendimentos
// distintos do mesmo contato no chat.
export async function insertMessageWithProtocol(
  values: InsertMessage,
): Promise<Message> {
  const payload: InsertMessage = values;
  const [created] = await db.insert(messages).values(payload).returning();
  return created as Message;
}

// Defesa contra replay de webhook / multi-device sync do cliente.
//
// Cenário: cliente envia "Porque internet ta lenta" às 22:39 — Meta entrega.
// Cliente fecha conversa. Mais tarde, o WhatsApp do cliente sincroniza um
// device antes offline (celular novo, browser web etc) e re-envia mensagens
// pendentes em batch — Meta entrega DE NOVO, com wamids DIFERENTES (porque
// cada redelivery é uma "nova" mensagem do ponto de vista da Meta).
//
// O UNIQUE INDEX de `external_message_id` não pega esse caso (wamids
// distintos). Esta dedup defensiva por conteúdo + janela curta protege:
// se o mesmo telefone enviou EXATAMENTE o mesmo texto na mesma conversa
// nos últimos `windowSeconds` (default 600s = 10min), considera replay
// e ignora silenciosamente — webhook handler retorna 200 sem agente.
//
// Bug raiz original (Bruno, 2026-05-08 conv 350): mensagem "Porque internet
// fica lenta..." chegou 3x com wamids distintos em 30 minutos.
//
// Bug ampliado (Bruno, 2026-05-08): janela de 30s era insuficiente — replay
// pode chegar minutos/horas depois (Meta retry, multi-device sync). Janela
// aumentada pra 10min com proteção: textos com <6 caracteres ("oi", "ok",
// "sim", "1", "2") mantêm janela 30s pra não bloquear cliente legítimo
// reenviando confirmação curta.
export async function findRecentDuplicateInbound(params: {
  workspaceId: string;
  conversationId: number;
  texto: string;
  windowSeconds?: number;
}): Promise<Message | null> {
  const { workspaceId, conversationId, texto } = params;
  if (!texto || !texto.trim()) return null;

  // Kill switch: DEDUP_INBOUND=off desativa o dedup totalmente (útil em
  // debug/testes manuais quando Bruno reenvia mesma frase várias vezes).
  if ((process.env.DEDUP_INBOUND || '').toLowerCase() === 'off') return null;

  // Bruno 2026-05-17: janela ENCURTADA pra cobrir só replay imediato de
  // webhook Meta (multi-device sync, retry). Antes era 30s/10min e bloqueava
  // teste manual onde Bruno reenviava mesma frase em <10min. Agora:
  // - texto curto (<6 chars): 3s — só replay imediato
  // - texto longo: 5s — janela suficiente pra cobrir burst de retry da Meta
  //   mas curta o bastante pra cliente reenviar livremente
  const isShortText = texto.trim().length < 6;
  const windowSeconds = params.windowSeconds ?? (isShortText ? 3 : 5);

  try {
    const [existing] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "in"),
          eq(messages.texto, texto),
          sql`${messages.createdAt} > NOW() - (${windowSeconds} * INTERVAL '1 second')`,
        ),
      )
      .limit(1);
    if (!existing) return null;

    // Exceção (Bruno, 2026-05-11): se a mensagem duplicada pertence a um
    // protocolo FECHADO/RESOLVIDO, não é replay — é cliente iniciando um
    // novo atendimento que coincidentemente repete a mesma frase (caso
    // real: cliente mandou CPF "103.171.502-94" no protocolo #4, atendente
    // resolveu, cliente abriu novo atendimento e mandou o mesmo CPF — não
    // pode bloquear). Replay genuíno acontece DENTRO do mesmo atendimento
    // ativo (Meta retry, multi-device sync no mesmo turno).
    const existingProtoId = (existing as any).protocoloId;
    if (existingProtoId) {
      try {
        const [proto] = await db
          .select({ status: protocols.status })
          .from(protocols)
          .where(eq(protocols.id, existingProtoId))
          .limit(1);
        if (proto && ['fechado', 'resolvido'].includes(proto.status)) {
          return null;
        }
      } catch {
        // Falha no lookup do protocolo → mantém comportamento seguro (bloqueia)
      }
    }

    return existing as Message;
  } catch {
    return null;
  }
}
