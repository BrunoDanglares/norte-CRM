// Bruno 2026-05-21: helper único pra garantir que todo contato que entra
// em conversa (Meta, Evolution, Instagram) é registrado em `contacts`. Antes
// só `leads` era criado nos webhooks — a página /contatos ficava órfã,
// mostrando só contatos cadastrados manualmente ou via CSV. Idempotente:
// UNIQUE (workspace_id, telefone) impede duplicata; quando já existe, só
// atualiza o nome se vier algo melhor que o placeholder atual.

import { db } from "../db";
import { contacts } from "@shared/schema";
import { and, eq } from "drizzle-orm";

interface UpsertOpts {
  workspaceId: string;
  telefone: string; // pra Instagram = senderIgUserId, pra WhatsApp = número limpo
  nome: string;
  canal?: string;
}

export async function upsertContactByPhone(opts: UpsertOpts): Promise<void> {
  const { workspaceId, telefone, nome } = opts;
  if (!workspaceId || !telefone || !nome) return;

  try {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.telefone, telefone)))
      .limit(1);

    if (!existing) {
      await db
        .insert(contacts)
        .values({
          nome,
          telefone,
          canal: opts.canal || "WhatsApp",
          workspaceId,
        })
        // Defesa contra race: 2 inbounds simultâneos do mesmo número podem
        // chegar antes do INSERT do primeiro completar. UNIQUE bloqueia o
        // segundo, ON CONFLICT DO NOTHING evita exception.
        .onConflictDoNothing();
      return;
    }

    // Já existe: atualiza nome SÓ se o atual for placeholder (telefone, vazio
    // ou igual ao próprio número) e o novo for um nome real. Evita
    // sobrescrever nome cadastrado manualmente pelo atendente.
    const atualPlaceholder = !existing.nome
      || existing.nome === existing.telefone
      || existing.nome === telefone
      || /^\+?\d{8,}$/.test(existing.nome);
    const novoMelhor = nome && nome !== telefone && !/^\+?\d{8,}$/.test(nome);
    if (atualPlaceholder && novoMelhor) {
      await db
        .update(contacts)
        .set({ nome })
        .where(and(eq(contacts.id, existing.id), eq(contacts.workspaceId, workspaceId)));
    }
  } catch (err: any) {
    // Não falhar o fluxo de mensagem por erro de contact upsert — só logar.
    console.warn(`[contactSync] upsert err phone=${telefone}: ${err.message}`);
  }
}
