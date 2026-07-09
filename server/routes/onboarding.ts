import type { Express } from "express";
import { requireAuth } from "../middleware/auth";
import { resolveWorkspaceId } from "../utils/helpers";
import { db } from "../db";
import { whatsappOfficialConnections, contacts, automacoes, pipelineStages } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

export function registerOnboardingRoutes(app: Express) {
  app.get("/api/onboarding/status", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);

      const [waResult, contactsResult, autoResult, stagesResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` })
          .from(whatsappOfficialConnections)
          .where(eq(whatsappOfficialConnections.workspaceId, wsId)),
        db.select({ count: sql<number>`count(*)::int` })
          .from(contacts)
          .where(eq(contacts.workspaceId, wsId)),
        db.select({ count: sql<number>`count(*)::int` })
          .from(automacoes)
          .where(eq(automacoes.workspaceId, wsId)),
        db.select({ count: sql<number>`count(*)::int` })
          .from(pipelineStages)
          .where(eq(pipelineStages.workspaceId, wsId)),
      ]);

      const steps = [
        { id: "whatsapp", label: "Conectar WhatsApp", done: (waResult[0]?.count ?? 0) > 0, href: "/configuracoes" },
        { id: "contacts", label: "Importar contatos", done: (contactsResult[0]?.count ?? 0) > 0, href: "/contatos" },
        { id: "automation", label: "Criar automação", done: (autoResult[0]?.count ?? 0) > 0, href: "/automacoes" },
        { id: "pipeline", label: "Configurar pipeline", done: (stagesResult[0]?.count ?? 0) > 0, href: "/pipeline" },
      ];

      const completed = steps.filter(s => s.done).length;

      res.json({ ok: true, completed, total: 4, steps });
    } catch (err: any) {
      console.warn("[Onboarding] status error:", err.message);
      res.status(500).json({ error: "Erro ao buscar status de onboarding" });
    }
  });
}
