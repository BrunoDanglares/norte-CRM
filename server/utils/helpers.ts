import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { storage } from "../storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { uploadsDir } from "./uploadsDir";

export function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort());
  }
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export function coerceValor(body: any) {
  if (body && typeof body.valor === "number") body.valor = String(body.valor);
  return body;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  // Comparação em tempo constante (Bruno 2026-06-14, auditoria): evita timing
  // attack que infere o hash medindo o tempo de resposta de tentativas de login.
  const attempt = scryptSync(plain, salt, 64);
  let expected: Buffer;
  try { expected = Buffer.from(hash, "hex"); } catch { return false; }
  if (attempt.length !== expected.length) return false;
  return timingSafeEqual(attempt, expected);
}

export function parseId(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// Bruno 2026-06-19 (auditoria info-disclosure): erro interno (5xx) NUNCA devolve
// e.message cru ao cliente (vaza estrutura de query/coluna/constraint do Postgres,
// paths, etc.). Loga o detalhe completo SÓ no servidor e retorna mensagem genérica.
export function safeErr(e: unknown, ctx?: string, fallback = "Erro interno"): string {
  if (ctx) console.error(ctx, e);
  else console.error("[safeErr]", e);
  return fallback;
}

let _defaultWorkspaceId: string | null = null;
export async function getDefaultWorkspaceId(): Promise<string> {
  if (_defaultWorkspaceId) return _defaultWorkspaceId;
  const wsList = await storage.getWorkspaces();
  _defaultWorkspaceId = wsList[0]?.id || "";
  return _defaultWorkspaceId;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveWorkspaceId(req: import("express").Request): Promise<string> {
  const wsId = req.user?.workspaceId;
  if (wsId && UUID_REGEX.test(wsId)) return wsId;
  const apiWsId = (req as any).apiToken?.workspaceId;
  if (apiWsId && UUID_REGEX.test(apiWsId)) return apiWsId;
  const user = req.user?.id ? await storage.getUser(req.user.id) : null;
  if (user?.workspaceId && UUID_REGEX.test(user.workspaceId)) return user.workspaceId;
  // Bruno 2026-06-18 (auditoria): FAIL-CLOSED. Antes caía no "workspace default"
  // (primeiro do banco) quando não havia ws válido → leitura/escrita no tenant
  // errado (ex: api_token com workspace_id nulo). Agora lança — sem ws válido,
  // ninguém opera num workspace qualquer.
  throw new Error("workspace_id ausente ou inválido na requisição");
}

export async function getDefaultLeadStatus(wsId: string): Promise<string> {
  try {
    const { db } = await import("../db");
    const { pipelineStages } = await import("@shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const stages = await db.select().from(pipelineStages)
      .where(and(eq(pipelineStages.workspaceId, wsId), eq(pipelineStages.pipeline, "vendas")))
      .orderBy(pipelineStages.ordem);
    if (stages.length > 0) return stages[0].key;
  } catch (e: any) { console.error("[helpers] getDefaultPipelineStatus error:", e.message); }
  return "novo";
}

export async function autoAssignAdminToAllTeams(workspaceId: string, userId: number) {
  try {
    const wsTeams = await storage.getTeams(workspaceId);
    for (const team of wsTeams) {
      await storage.addTeamMember(team.id, userId);
    }
  } catch (err: any) {
    console.error(`[TEAMS] Error auto-assigning admin to teams:`, err.message);
  }
}

export async function autoAssignAllAdminsToTeam(workspaceId: string, teamId: string) {
  try {
    const wsUsers = await storage.getUsers(workspaceId);
    const admins = wsUsers.filter(u => u.role === "admin");
    for (const admin of admins) {
      await storage.addTeamMember(teamId, admin.id);
    }
  } catch (err: any) {
    console.error(`[TEAMS] Error auto-assigning admins to team:`, err.message);
  }
}

export function sanitizeConexao(c: any) {
  const { token, instanceId, qrCode, baileysAuth, ...safe } = c;
  return { ...safe, hasToken: !!token, hasInstanceId: !!instanceId, automacaoId: c.automacaoId || null };
}

export function formatPhone(phone: string): string {
  let clean = phone.replace(/\D/g, "");
  if (!clean.startsWith("55")) clean = "55" + clean;
  return clean;
}

const AUTOMATION_DEBOUNCE_MS = 3000;
const _automationDebounceTimers = new Map<number, NodeJS.Timeout>();

export function scheduleAutomation(conversationId: number, runFn: () => Promise<void>) {
  const existing = _automationDebounceTimers.get(conversationId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(async () => {
    _automationDebounceTimers.delete(conversationId);
    try {
      await runFn();
    } catch (err: any) {
      console.error(`[Debounce] Erro ao executar automacao para conversation ${conversationId}:`, err.message);
    }
  }, AUTOMATION_DEBOUNCE_MS);
  _automationDebounceTimers.set(conversationId, timer);
}

// Bruno 2026-06-02: uploadsDir centralizado no módulo-folha ./uploadsDir
// (honra UPLOAD_DIR, default CWD/uploads). Re-exportado pra não quebrar os
// importadores existentes (routes.ts, perfil.ts) e usado pelo multer abaixo.
export { uploadsDir };

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    cb(null, name);
  },
});

export const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|pdf|mp3|ogg|wav|m4a|aac|opus|mp4|webm|mov|avi)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error("Tipo de arquivo nao permitido. Use imagem, PDF, audio ou video."));
    }
  },
});
