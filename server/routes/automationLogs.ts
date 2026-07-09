import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId } from "../utils/helpers";
import { db } from "../db";
import { automationNodeLogs } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export function registerAutomationLogRoutes(app: Express) {
  app.get("/api/automacoes/:id/logs", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      const automacaoId = (req.params.id as string);
      const limit = Math.min(parseInt((req.query.limit as string | undefined) as string) || 50, 200);

      const [recentLogs, nodeCountsRaw] = await Promise.all([
        db.select()
          .from(automationNodeLogs)
          .where(and(
            eq(automationNodeLogs.automacaoId, automacaoId),
            eq(automationNodeLogs.workspaceId, wsId),
          ))
          .orderBy(desc(automationNodeLogs.executedAt))
          .limit(limit),

        db.select({
          nodeId: automationNodeLogs.nodeId,
          count: sql<number>`count(*)::int`,
        })
          .from(automationNodeLogs)
          .where(and(
            eq(automationNodeLogs.automacaoId, automacaoId),
            eq(automationNodeLogs.workspaceId, wsId),
          ))
          .groupBy(automationNodeLogs.nodeId),
      ]);

      const nodeCounts: Record<string, number> = {};
      for (const row of nodeCountsRaw) {
        nodeCounts[row.nodeId] = row.count;
      }

      res.json({ ok: true, recentLogs, nodeCounts });
    } catch (err: any) {
      console.warn("[AutomationLogs] Error:", err.message);
      res.status(500).json({ error: "Erro ao buscar logs" });
    }
  });
}
