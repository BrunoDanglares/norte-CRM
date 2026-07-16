import { db } from "../db";
import { leads, pipelineStages } from "../../shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

const FINAL_LABEL_MAP: Record<string, "ativado" | "perdido"> = {
  "Finalizado": "ativado",
  // Compatibilidade com labels antigos (workspaces não migrados)
  "Cliente Ativado":        "ativado",
  "Cliente Perdido":        "perdido",
  "Resolvido":              "ativado",
  "Escalado / NOC":         "perdido",
  "Pago / Regularizado":    "ativado",
  "Resolvido/Regularizado": "ativado",
  "Inadimplente/Suspenso/Cancelado": "perdido",
  "Não Resolvido":                   "perdido",
};

export async function archiveLead(
  leadId: number,
  reason: "ativado" | "perdido",
  workspaceId: string
): Promise<void> {
  // Bruno 2026-06-18 (auditoria IDOR): filtra por workspace_id — antes arquivava
  // lead de QUALQUER tenant chutando o leadId serial global.
  await db
    .update(leads)
    .set({
      archivedAt: new Date(),
      archivalReason: reason,
    })
    .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)));
}

export function resolveArchivalReasonByLabel(stageLabel: string): "ativado" | "perdido" | null {
  return FINAL_LABEL_MAP[stageLabel] ?? null;
}

export function resolveArchivalReasonByKey(stageKey: string): "ativado" | "perdido" | null {
  // Etapa universal
  if (/^finalizado_/.test(stageKey)) return "ativado";
  // Compatibilidade com prefixos antigos
  if (/^cliente_ativado_/.test(stageKey)) return "ativado";
  if (/^cliente_perdido_/.test(stageKey)) return "perdido";
  if (/^resolvido_/.test(stageKey)) return "ativado";
  if (/^escalado_noc_/.test(stageKey)) return "perdido";
  if (/^pago_regularizado_/.test(stageKey)) return "ativado";
  if (/^inadimplente_suspenso_/.test(stageKey)) return "perdido";
  return null;
}

export async function archiveEndOfShift(): Promise<{ archived: number }> {
  const finalLabels = Object.keys(FINAL_LABEL_MAP);
  const placeholders = finalLabels.map(l => `'${l.replace(/'/g, "''")}'`).join(",");

  const finalStageKeys = await db
    .select({ key: pipelineStages.key, label: pipelineStages.label })
    .from(pipelineStages)
    .where(
      sql`${pipelineStages.label} IN (${sql.raw(placeholders)})`
    );

  if (finalStageKeys.length === 0) return { archived: 0 };

  const keyToReason = new Map<string, "ativado" | "perdido">();
  for (const s of finalStageKeys) {
    const reason = FINAL_LABEL_MAP[s.label];
    if (reason) keyToReason.set(s.key, reason);
  }

  const keys = Array.from(keyToReason.keys());
  if (keys.length === 0) return { archived: 0 };

  // Bruno 2026-07-16: card ESTACIONADO manualmente no funil (display_column
  // setado — ex.: arrastado pra Ganho/Perdido) sobrevive à varredura de fim
  // de expediente. Só cards que seguem o bot (display_column NULL) são varridos.
  const leadsToArchive = await db
    .select({ id: leads.id, status: leads.status })
    .from(leads)
    .where(
      and(
        isNull(leads.archivedAt),
        isNull(leads.displayColumn),
        sql`${leads.status} = ANY(${sql.raw(`ARRAY[${keys.map(k => `'${k}'`).join(",")}]`)})`
      )
    );

  if (leadsToArchive.length === 0) return { archived: 0 };

  for (const lead of leadsToArchive) {
    const reason = keyToReason.get(lead.status) ?? "perdido";
    await db
      .update(leads)
      .set({ archivedAt: new Date(), archivalReason: reason })
      .where(eq(leads.id, lead.id));
  }

  console.log(`[KanbanArchival] ${leadsToArchive.length} leads arquivados (fim de expediente)`);
  return { archived: leadsToArchive.length };
}
