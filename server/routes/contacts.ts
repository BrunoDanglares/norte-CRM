import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { insertContactSchema, insertDealSchema, contacts, conversations } from "@shared/schema";
import { requireAuth, requireAuthOrToken, requireScope } from "../middleware/auth";
import { coerceValor, parseId, resolveWorkspaceId, safeErr } from "../utils/helpers";
import { dispatchWebhook } from "../services/webhookDispatcher";
import { resolveContactAvatar } from "../services/avatar.service";
import { broadcastToWorkspace } from "../services/broadcast";
import { db } from "../db";
import { eq, and, sql, desc } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Tipo de arquivo nao permitido"));
  },
});

function escCsv(v: string): string {
  if (!v) return "";
  let safe = v;
  if (/^[=+\-@\t\r]/.test(safe)) safe = "'" + safe;
  if (safe.includes('"') || safe.includes(",") || safe.includes("\n") || safe.includes(";")) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function detectDelimiter(headerLine: string): string {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { result.push(current.trim()); current = ""; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function registerContactRoutes(app: Express) {
  app.get("/api/contacts/export", requireAuth, async (req, res) => {
    try {
      const wsId = await resolveWorkspaceId(req);
      // internal - sem paginação intencional (exportação CSV completa)
      const contacts = await storage.getContacts(wsId, { limit: 10000 });
      const header = "nome,empresa,telefone,email,canal,tags,notas";
      const rows = contacts.map(c =>
        [c.nome, c.empresa || "", c.telefone || "", c.email || "", c.canal || "WhatsApp", (c.tags || []).join(";"), c.notas || ""]
          .map(escCsv).join(",")
      );
      const csv = [header, ...rows].join("\n");
      const bom = "\uFEFF";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="contatos_${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(bom + csv);
    } catch (e: any) { res.status(500).json({ message: safeErr(e, "[contacts]") }); }
  });

  app.post("/api/contacts/import", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado" });
      const wsId = await resolveWorkspaceId(req);
      const content = req.file.buffer.toString("utf-8").replace(/^\uFEFF/, "");
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ message: "Arquivo vazio ou sem dados" });
      // Teto de linhas: a importação faz 1 INSERT (+ eventual UPDATE) por linha
      // de forma sequencial. Sem clamp, um CSV de 5MB (~dezenas de milhares de
      // linhas) prende o processo num loop longo. 5000 cobre uso real.
      const MAX_IMPORT_ROWS = 5000;
      if (lines.length - 1 > MAX_IMPORT_ROWS) {
        return res.status(413).json({ message: `Arquivo grande demais: máximo ${MAX_IMPORT_ROWS} contatos por importação` });
      }

      const delimiter = detectDelimiter(lines[0]);
      const headerLine = lines[0].toLowerCase();
      const headers = parseCsvLine(headerLine, delimiter);
      const colMap: Record<string, number> = {};
      const aliases: Record<string, string[]> = {
        nome: ["nome", "name", "nome completo", "full name"],
        empresa: ["empresa", "company", "organizacao", "organization"],
        telefone: ["telefone", "phone", "cel", "celular", "whatsapp", "numero"],
        email: ["email", "e-mail", "mail"],
        canal: ["canal", "channel", "origem"],
        tags: ["tags", "etiquetas", "labels"],
        notas: ["notas", "notes", "observacoes", "obs"],
      };
      for (const [field, names] of Object.entries(aliases)) {
        const idx = headers.findIndex(h => names.includes(h.replace(/['"]/g, "").trim()));
        if (idx >= 0) colMap[field] = idx;
      }
      if (colMap.nome === undefined && colMap.telefone === undefined && colMap.email === undefined) {
        return res.status(400).json({ message: "Nao foi possivel identificar as colunas. Use cabeçalho: nome, empresa, telefone, email, canal, tags, notas" });
      }

      // internal - sem paginação intencional (dedup check durante importação CSV)
      const existingContacts = await storage.getContacts(wsId, { limit: 10000 });
      const phoneMap = new Map<string, typeof existingContacts[0]>();
      for (const c of existingContacts) {
        if (c.telefone) phoneMap.set(c.telefone.replace(/\D/g, ""), c);
      }

      let imported = 0, updated = 0, skipped = 0, errors = 0;
      const errorDetails: string[] = [];

      const tagDelimiter = delimiter === ";" ? "|" : ";";

      for (let i = 1; i < lines.length; i++) {
        const vals = parseCsvLine(lines[i], delimiter);
        const get = (f: string) => colMap[f] !== undefined ? (vals[colMap[f]] || "").trim() : "";
        const nome = get("nome");
        const telefone = get("telefone").replace(/[^\d+]/g, "");
        const email = get("email");
        if (!nome && !telefone && !email) { skipped++; continue; }
        const tagsStr = get("tags");
        const tags = tagsStr ? tagsStr.split(/[;|]/).map(t => t.trim()).filter(Boolean) : undefined;
        const data: any = {
          nome: nome || email || telefone,
          empresa: get("empresa") || null,
          telefone: telefone || null,
          email: email || null,
          canal: get("canal") || "WhatsApp",
          tags: tags && tags.length > 0 ? tags : null,
          notas: get("notas") || null,
          workspaceId: wsId,
        };
        try {
          await storage.createContact(data);
          imported++;
        } catch (e: any) {
          if (e.code === "23505" && telefone) {
            try {
              const normalizedPhone = telefone.replace(/\D/g, "");
              const match = phoneMap.get(normalizedPhone);
              if (match) {
                const upd: any = {};
                if (data.nome && data.nome !== match.nome) upd.nome = data.nome;
                if (data.empresa && !match.empresa) upd.empresa = data.empresa;
                if (data.email && !match.email) upd.email = data.email;
                if (data.notas && !match.notas) upd.notas = data.notas;
                if (tags && tags.length > 0) upd.tags = [...new Set([...(match.tags || []), ...tags])];
                if (Object.keys(upd).length > 0) {
                  await storage.updateContact(match.id, upd, wsId);
                  updated++;
                } else { skipped++; }
              } else { skipped++; }
            } catch { errors++; errorDetails.push(`Linha ${i + 1}: Erro ao atualizar duplicata`); }
          } else {
            errors++;
            errorDetails.push(`Linha ${i + 1}: ${e.message?.slice(0, 80)}`);
          }
        }
      }
      res.json({ ok: true, imported, updated, skipped, errors, total: lines.length - 1, errorDetails: errorDetails.slice(0, 10) });
    } catch (e: any) { res.status(500).json({ message: safeErr(e, "[contacts]") }); }
  });

  app.get("/api/contacts", requireAuthOrToken, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    // Auditoria 2026-06-20: clamp do limit (era a única lista sem teto — leads/conversations/messages já clampam).
    // Sem isso, ?limit=99999999 puxava a tabela inteira de contatos pra memória do Node (auto-DoS em tenant grande).
    const limit = Math.min(Math.max(parseInt(((req.query.limit as string | undefined) as string | undefined) as string) || 100, 1), 500);
    const offset = Math.max(parseInt(((req.query.offset as string | undefined) as string | undefined) as string) || 0, 0);
    const contacts = await storage.getContacts(wsId, { limit, offset });
    res.json(contacts);
  });

  // Bruno 2026-06-19: lookup pontual de UM contato por telefone. A lista
  // GET /api/contacts é PAGINADA (teto 100, desc createdAt) → em tenant grande
  // (ex: Nekt) o contato de uma conversa antiga/resolvida fica de fora da
  // página e a ficha do cliente dava "Ficha não disponível" mesmo existindo no
  // banco. Casa por dígitos (com/sem DDI 55) e devolve o contato direto.
  app.get("/api/contacts/by-phone", requireAuthOrToken, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const phone = String((req.query.telefone as string | undefined) ?? "").replace(/\D/g, "");
    if (!phone || phone.length < 8) return res.status(400).json({ message: "Telefone invalido" });
    const alt = phone.startsWith("55") ? phone.slice(2) : "55" + phone;
    try {
      const rows = await db
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            sql`regexp_replace(coalesce(${contacts.telefone}, ''), '[^0-9]', '', 'g') IN (${phone}, ${alt})`,
          ),
        )
        .orderBy(desc(contacts.createdAt))
        .limit(1);
      const existing = rows[0];
      if (!existing) return res.status(404).json({ message: "Contato nao encontrado" });
      res.json(existing);
    } catch (e: any) {
      console.warn(`[contacts] by-phone falhou: ${e?.message}`);
      res.status(500).json({ message: "Falha ao buscar contato" });
    }
  });

  app.post("/api/contacts", requireAuthOrToken, requireScope("contacts:write"), async (req, res) => {
    const parsed = insertContactSchema.omit({ workspaceId: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const wsId = await resolveWorkspaceId(req);
    try {
      const contact = await storage.createContact({ ...parsed.data, workspaceId: wsId });
      storage.createNotificacao({ tipo: "contato_criado", categoria: "Contatos", titulo: "Novo contato", mensagem: `${contact.nome} adicionado aos contatos`, link: "/contatos", iconKey: "user", workspaceId: wsId }).catch(() => {});
      dispatchWebhook("contact.created", contact, wsId).catch(() => {});
      resolveContactAvatar(contact as any, wsId).catch(() => {});
      res.status(201).json(contact);
    } catch (e: any) {
      if (e.code === "23505") {
        // Bruno 2026-05-30: idempotência — em vez de 409 que confunde o UI
        // (CustomerTab POST automático no abrir do painel), tenta achar o
        // contato existente e devolver 200. UX: painel Cliente abre e mostra
        // dados sem erro.
        try {
          // Bruno 2026-06-08: lookup DIRETO por telefone (não getContacts
          // limitado — em tenant grande tipo Nekt o existente podia ficar de
          // fora dos 1000 → não achava → CPF não salvava). Casa por dígitos,
          // com/sem DDI 55.
          const phone = String(parsed.data.telefone ?? "").replace(/\D/g, "");
          const alt = phone.startsWith("55") ? phone.slice(2) : "55" + phone;
          const exRows: any = await db.execute(sql`
            SELECT * FROM contacts
            WHERE workspace_id = ${wsId}::uuid
              AND regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g') IN (${phone}, ${alt})
            LIMIT 1
          `);
          const existing = (exRows.rows ?? exRows)[0];
          if (existing) {
            // Bruno 2026-06-08: UPSERT do CPF. Sem isto, "criar contato com CPF"
            // num telefone que JÁ tem contato (corrida com o auto-create do
            // painel) caía aqui e devolvia o existente SEM o cpf → o CPF
            // identificado pelo atendente sumia ao fechar/reabrir a conversa.
            const incomingCpf = String((parsed.data as any).cpf ?? "").replace(/\D/g, "");
            const existingCpf = String((existing as any).cpf ?? "").replace(/\D/g, "");
            if (incomingCpf && incomingCpf !== existingCpf) {
              try {
                const updated = await storage.updateContact(existing.id, { cpf: incomingCpf } as any, wsId);
                return res.status(200).json(updated ?? existing);
              } catch (upErr: any) {
                console.warn(`[contacts] upsert-cpf na idempotência falhou: ${upErr?.message}`);
              }
            }
            return res.status(200).json(existing);
          }
        } catch (lookupErr: any) {
          console.warn(`[contacts] lookup-after-409 falhou: ${lookupErr?.message}`);
        }
        return res.status(409).json({ message: "Contato com este telefone ja existe neste workspace" });
      }
      throw e;
    }
  });

  app.patch("/api/contacts/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    // Auditoria 2026-06-19: .omit({workspaceId}) espelha o POST — sem isto o corpo
    // podia setar workspaceId e mover o contato (telefone/CPF/notas) pra outro tenant.
    const partial = insertContactSchema.omit({ workspaceId: true }).partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: partial.error.message });
    const contact = await storage.updateContact(id, partial.data, wsId);
    if (!contact) return res.status(404).json({ message: "Contact not found" });

    // Bruno 2026-05-21: nome editado no contato precisa refletir no header
    // do chat da inbox (que lê conversations.nome, não contacts.nome).
    // Propaga pra todas as conversas com o mesmo telefone + broadcast pra
    // atualizar UI em tempo real.
    if (partial.data.nome && contact.telefone) {
      (async () => {
        try {
          const matchingConvs = await db.select({ id: conversations.id })
            .from(conversations)
            .where(and(
              eq(conversations.workspaceId, wsId),
              eq(conversations.telefone, contact.telefone!)
            ));
          if (matchingConvs.length === 0) return;
          await db.update(conversations)
            .set({ nome: contact.nome, updatedAt: new Date() })
            .where(and(
              eq(conversations.workspaceId, wsId),
              eq(conversations.telefone, contact.telefone!)
            ));
          for (const c of matchingConvs) {
            broadcastToWorkspace(wsId, 'conversation_updated', {
              conversationId: c.id,
              nome: contact.nome,
            });
          }
        } catch (err: any) {
          console.error('[ContactSync] Erro ao propagar nome pra conversations:', err.message);
        }
      })();
    }

    res.json(contact);
  });

  app.delete("/api/contacts/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    const wsId = await resolveWorkspaceId(req);
    await storage.deleteContact(id, wsId);
    res.status(204).send();
  });

  app.get("/api/deals", requireAuth, async (req, res) => {
    const wsId = await resolveWorkspaceId(req);
    const deals = await storage.getDeals(wsId);
    res.json(deals);
  });

  app.post("/api/deals", requireAuth, async (req, res) => {
    const parsed = insertDealSchema.omit({ workspaceId: true }).safeParse(coerceValor({...req.body}));
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const wsId = await resolveWorkspaceId(req);
    const deal = await storage.createDeal({ ...parsed.data, workspaceId: wsId });
    storage.createNotificacao({ tipo: "negocio_criado", categoria: "Negocios", titulo: "Novo negocio", mensagem: `${deal.titulo} - R$ ${Number(deal.valor || 0).toFixed(2)}`, link: "/pipeline", iconKey: "target", workspaceId: wsId }).catch(() => {});
    res.status(201).json(deal);
  });

  app.patch("/api/deals/:id", requireAuth, async (req, res) => {
    const id = parseId(((req.params.id as string) as string));
    if (!id) return res.status(400).json({ message: "Invalid ID" });
    // Auditoria 2026-06-19: .omit({workspaceId}) espelha o POST — sem isto o corpo
    // podia re-parentar o próprio negócio pro pipeline de outro tenant.
    const partial = insertDealSchema.omit({ workspaceId: true }).partial().safeParse(coerceValor({...req.body}));
    if (!partial.success) return res.status(400).json({ message: partial.error.message });
    const wsId = await resolveWorkspaceId(req);
    const deal = await storage.updateDeal(id, partial.data, wsId);
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });

  app.post("/api/contacts/:id/foto", requireAuth, avatarUpload.single("foto"), async (req, res) => {
    try {
      const id = parseId(((req.params.id as string) as string));
      if (!id) return res.status(400).json({ message: "Invalid ID" });
      if (!req.file) return res.status(400).json({ message: "Nenhuma imagem enviada" });
      const wsId = await resolveWorkspaceId(req);

      const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
      const dir = path.join("uploads", "avatars", wsId);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${id}.${ext}`;
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, req.file.buffer);

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["host"] || req.hostname;
      const fotoUrl = `${protocol}://${host}/uploads/avatars/${wsId}/${filename}?t=${Date.now()}`;

      await db
        .update(contacts)
        .set({ fotoUrl, fotoOrigem: "manual" })
        .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)));

      res.json({ foto_url: fotoUrl });
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[contacts]") });
    }
  });

  app.get("/api/contacts/:id/avatar", requireAuth, async (req, res) => {
    try {
      const id = parseId(((req.params.id as string) as string));
      if (!id) return res.status(400).json({ message: "Invalid ID" });
      const wsId = await resolveWorkspaceId(req);

      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
        .limit(1);

      if (!contact) return res.status(404).json({ message: "Contato nao encontrado" });

      const avatarUrl = await resolveContactAvatar(contact, wsId);
      res.json({ avatar_url: avatarUrl });
    } catch (e: any) {
      res.status(500).json({ message: safeErr(e, "[contacts]") });
    }
  });
}
