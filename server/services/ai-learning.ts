import { db } from "../db";
import { conversations, messages } from "@shared/schema";
import { eq, and, desc, isNotNull, sql } from "drizzle-orm";
import { storage } from "../storage";

const learningCache = new Map<string, { summary: string; builtAt: number }>();
const CACHE_TTL = 30 * 60 * 1000;

export async function getWorkspaceLearningContext(workspaceId: string): Promise<string> {
  const cached = learningCache.get(workspaceId);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL) {
    return cached.summary;
  }

  try {
    const summary = await buildLearningFromConversations(workspaceId);
    learningCache.set(workspaceId, { summary, builtAt: Date.now() });
    return summary;
  } catch (e: any) {
    console.error("[AILearning] Failed to build learning context:", e.message);
    return "";
  }
}

async function buildLearningFromConversations(workspaceId: string): Promise<string> {
  const resolvedConvs = await db
    .select({
      id: conversations.id,
      nome: conversations.nome,
      canal: conversations.canal,
      tags: conversations.tags,
      resolvedAt: conversations.resolvedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.status, "resolved"),
        isNotNull(conversations.resolvedAt)
      )
    )
    .orderBy(desc(conversations.resolvedAt))
    .limit(50);

  if (resolvedConvs.length === 0) return "";

  const patterns: {
    commonQuestions: Map<string, number>;
    successfulResponses: string[];
    topicSummaries: string[];
  } = {
    commonQuestions: new Map(),
    successfulResponses: [],
    topicSummaries: [],
  };

  let processedCount = 0;
  for (const conv of resolvedConvs) {
    if (processedCount >= 30) break;
    try {
      const msgs = await db
        .select({
          texto: messages.texto,
          direction: messages.direction,
          agente: messages.agente,
          tipo: messages.tipo,
        })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(messages.id)
        .limit(100);

      if (msgs.length < 4) continue;

      const customerMsgs = msgs.filter(m => m.direction === "in" && m.texto);
      const botMsgs = msgs.filter(m => m.direction === "out" && m.agente === "Bot" && m.texto);
      const humanAgentMsgs = msgs.filter(m => m.direction === "out" && m.agente && m.agente !== "Bot" && m.texto);

      if (customerMsgs.length > 0) {
        const firstMsg = customerMsgs[0]?.texto?.toLowerCase().trim() || "";
        if (firstMsg.length > 5 && firstMsg.length < 200) {
          const normalized = normalizeQuestion(firstMsg);
          patterns.commonQuestions.set(normalized, (patterns.commonQuestions.get(normalized) || 0) + 1);
        }
      }

      if (humanAgentMsgs.length > 0) {
        const exchanges: string[] = [];
        for (let i = 0; i < msgs.length - 1; i++) {
          const curr = msgs[i];
          const next = msgs[i + 1];
          if (curr.direction === "in" && curr.texto && next.direction === "out" && next.agente && next.agente !== "Bot" && next.texto) {
            const q = curr.texto.substring(0, 150);
            const a = next.texto.substring(0, 300);
            exchanges.push(`Pergunta: "${q}" → Resposta humana: "${a}"`);
            if (exchanges.length >= 3) break;
          }
        }
        if (exchanges.length > 0) {
          patterns.successfulResponses.push(...exchanges);
        }
      }

      const tags = conv.tags || [];
      const topicParts: string[] = [];
      if (tags.length > 0) topicParts.push(`Tags: ${tags.join(", ")}`);
      const msgCount = msgs.length;
      const customerFirst = customerMsgs[0]?.texto?.substring(0, 100) || "";
      topicParts.push(`Assunto: "${customerFirst}" (${msgCount} msgs, ${conv.canal})`);
      patterns.topicSummaries.push(topicParts.join(" | "));

      processedCount++;
    } catch {}
  }

  const lines: string[] = [];
  lines.push("\n\n[APRENDIZADO CONTINUO — BASE DE CONHECIMENTO DO WORKSPACE]");
  lines.push("Abaixo esta um resumo de padroes aprendidos com conversas anteriores resolvidas neste workspace.");
  lines.push("Use estas informacoes para melhorar a qualidade do atendimento e responder de forma mais precisa e eficiente.\n");

  const sortedQuestions = [...patterns.commonQuestions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (sortedQuestions.length > 0) {
    lines.push("PERGUNTAS MAIS FREQUENTES DOS CLIENTES:");
    for (const [q, count] of sortedQuestions) {
      lines.push(`  - "${q}" (${count}x)`);
    }
    lines.push("");
  }

  if (patterns.successfulResponses.length > 0) {
    lines.push("EXEMPLOS DE RESPOSTAS HUMANAS BEM-SUCEDIDAS (use como referencia de tom e conteudo):");
    const uniqueResponses = [...new Set(patterns.successfulResponses)].slice(0, 15);
    for (const r of uniqueResponses) {
      lines.push(`  ${r}`);
    }
    lines.push("");
  }

  if (patterns.topicSummaries.length > 0) {
    lines.push(`CONVERSAS RESOLVIDAS RECENTES (${patterns.topicSummaries.length} analisadas):`);
    for (const s of patterns.topicSummaries.slice(0, 10)) {
      lines.push(`  - ${s}`);
    }
    lines.push("");
  }

  lines.push("INSTRUCOES DE USO:");
  lines.push("- Quando um cliente fizer uma pergunta similar a uma frequente, use o padrao de resposta mais adequado.");
  lines.push("- Adapte o tom de voz baseado nas respostas humanas bem-sucedidas.");
  lines.push("- Se um atendente humano corrigiu sua resposta anteriormente, aprenda com a correcao.");
  lines.push("- Priorize resolucao rapida dos problemas mais comuns identificados acima.");
  lines.push("[FIM APRENDIZADO CONTINUO]");

  return lines.join("\n");
}

function normalizeQuestion(text: string): string {
  return text
    .replace(/[!?.,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80);
}

export function invalidateLearningCache(workspaceId: string): void {
  learningCache.delete(workspaceId);
}
