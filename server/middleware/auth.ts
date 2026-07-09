import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { workspaces } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isBlocked } from "../services/tenantBlocklist";
import { isDelinquent, billingEnforcementOn } from "../services/subscriptionGate";
import { getExpectedTokenVersion } from "../services/tokenVersionStore";

// Paths que SEMPRE passam mesmo com assinatura pendente — pro cliente conseguir
// fazer login, ver os planos e pagar. Sem essa allowlist o paywall trancaria o
// próprio fluxo de pagamento.
const BILLING_EXEMPT_PREFIXES = ["/api/auth", "/api/billing", "/api/asaas", "/api/planos", "/api/workspaces", "/api/logout"];
function isBillingExemptPath(path: string): boolean {
  return BILLING_EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

// Retorna true e RESPONDE 402 se o workspace está inadimplente (e o path não é
// isento). O front trata 402 ≠ 401: manda pro paywall SEM derrubar a sessão.
function billingBlocked(req: Request, res: Response, workspaceId?: string | null): boolean {
  if (!billingEnforcementOn()) return false;
  if (isBillingExemptPath(req.path)) return false;
  if (isDelinquent(workspaceId)) {
    // Bruno 2026-06-19: trial vencido/inadimplente → bloqueia até pagar, mas oferece
    // contato pelo WhatsApp (número do comercial ChatBanana, via env). O front mostra
    // o botão no paywall a partir de `contatoWhatsapp`.
    res.status(402).json({
      error: "Assinatura pendente. Regularize para continuar.",
      paywall: true,
      contatoWhatsapp: process.env.BILLING_CONTACT_WHATSAPP || null,
    });
    return true;
  }
  return false;
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("[FATAL] JWT_SECRET environment variable is not set.");
  process.exit(1);
}
// CLAUDE.md: JWT_SECRET <32 chars deve falhar o boot (proteção contra brute-force).
if (JWT_SECRET.length < 32) {
  console.error(`[FATAL] JWT_SECRET muito curto (${JWT_SECRET.length} chars). Mínimo 32 caracteres por segurança.`);
  process.exit(1);
}

const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';
const LEGACY_SERVICE_TOKEN = process.env.CHATBANANA_N8N_TOKEN || '';

if (!SERVICE_TOKEN) {
  console.warn('[Auth] ⚠ SERVICE_TOKEN nao configurado — rotas via service token estarao BLOQUEADAS');
}

// Bruno 2026-06-13 (auditoria): o service token é UM segredo compartilhado que
// aceita qualquer workspace_id no corpo → quem tem o token lê/escreve em QUALQUER
// tenant. Opt-in de contenção: se SERVICE_TOKEN_WORKSPACES estiver setado (UUIDs
// separados por vírgula), o token SÓ acessa esses workspaces. Vazio = comportamento
// legado (qualquer workspace), pra não quebrar integrações n8n existentes.
// RECOMENDADO preencher em produção com os workspaces que o n8n realmente atende.
const SERVICE_TOKEN_WORKSPACES = new Set(
  (process.env.SERVICE_TOKEN_WORKSPACES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);
if (SERVICE_TOKEN_WORKSPACES.size > 0) {
  console.log(`[Auth] service token restrito a ${SERVICE_TOKEN_WORKSPACES.size} workspace(s)`);
}

export interface AuthPayload {
  id: number;
  email: string;
  role: string;
  nome: string;
  workspaceId: string;
  isServiceToken?: boolean;
  tv?: number; // versão de token (revogação de sessão — auditoria 2026-06-20)
}

export interface ApiTokenPayload {
  id: string;
  permissoes: string[];
  workspaceId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      apiToken?: ApiTokenPayload;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidWorkspaceId(id: string | undefined | null): boolean {
  if (!id) return false;
  return UUID_REGEX.test(id);
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers['authorization'] as string | undefined;
  const xToken = req.headers['x-flowcrm-token'] as string | undefined;
  const xServiceToken = req.headers['x-service-token'] as string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (xToken) return xToken.trim();
  if (xServiceToken) return xServiceToken.trim();
  return undefined;
}

function isServiceToken(_token: string): boolean {
  // Bruno 2026-06-18: n8n é PEÇA MORTA → service token DESATIVADO. Qualquer
  // x-service-token cai no caminho normal (JWT/api_token) e é rejeitado — mata de
  // vez o risco C2 (token-mestre cross-tenant). As branches que chamam isto ficam
  // inertes. Pra uma integração nova, usar api_tokens (hash por tenant), nunca o
  // segredo compartilhado.
  return false;
}

/**
 * Valida workspace_id do service token contra o banco e retorna AuthPayload.
 * Retorna null e já envia a resposta de erro se a validação falhar.
 */
async function resolveServiceUser(req: Request, res: Response): Promise<AuthPayload | null> {
  const workspaceId = req.body?.workspace_id
    ?? req.body?.context?.workspace_id
    ?? (req.query?.workspace_id as string)
    ?? '';

  if (!workspaceId) {
    res.status(400).json({ error: 'workspace_id obrigatório para service token' });
    return null;
  }

  // Bruno 2026-06-18 (auditoria C2): FAIL-CLOSED em produção. O service token é um
  // segredo compartilhado que aceita qualquer workspace_id do corpo → sem allowlist
  // explícita viraria chave-mestra cross-tenant. Em prod EXIGE SERVICE_TOKEN_WORKSPACES.
  if (SERVICE_TOKEN_WORKSPACES.size === 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[auth] service token BLOQUEADO: defina SERVICE_TOKEN_WORKSPACES (fail-closed em produção)');
      res.status(403).json({ error: 'service token sem allowlist de workspace' });
      return null;
    }
    // dev/legado: segue permissivo (valida que o workspace existe logo abaixo).
  } else if (!SERVICE_TOKEN_WORKSPACES.has(String(workspaceId).toLowerCase())) {
    console.warn('[auth] service token sem permissão para o workspace:', workspaceId);
    res.status(403).json({ error: 'workspace_id não autorizado para este token' });
    return null;
  }

  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!rows.length) {
    console.warn('[auth] service token com workspace_id inválido:', workspaceId);
    res.status(401).json({ error: 'workspace_id inválido' });
    return null;
  }

  return {
    id: 0,
    email: 'service@chatbanana.com.br',
    role: 'service',
    nome: 'Service Token',
    workspaceId,
    isServiceToken: true,
  };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }

    if (isServiceToken(token)) {
      const user = await resolveServiceUser(req, res);
      if (!user) return;
      req.user = user;
      return next();
    }

    const payload = jwt.verify(token, JWT_SECRET as string) as unknown as AuthPayload;
    // Bloqueio instantâneo de tenant/usuário (Bruno 2026-06-13): mesmo com JWT
    // válido, se o workspace ou o usuário está bloqueado o acesso cai NA HORA. 401
    // → o front faz handle401() e derruba pro /login (que também recusa bloqueado).
    if (isBlocked(payload.workspaceId, payload.id)) {
      return res.status(401).json({ error: 'Conta bloqueada. Contate o suporte.', blocked: true });
    }
    // Revogação de sessão por versão (auditoria 2026-06-20): só ENFORÇA quando o usuário
    // já teve um bump (expected > 0). Pros demais (e super-admin/service, id<=0) é no-op —
    // tokens antigos sem `tv` continuam válidos, sem deslogar ninguém no deploy.
    if (typeof payload.id === 'number' && payload.id > 0) {
      const expectedTv = getExpectedTokenVersion(payload.id);
      if (expectedTv > 0 && (payload.tv ?? 0) !== expectedTv) {
        return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', sessionRevoked: true });
      }
    }
    if (billingBlocked(req, res, payload.workspaceId)) return;
    req.user = payload;
    return next();
  } catch (err: any) {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

export async function requireApiToken(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Token API nao fornecido" });
  }

  if (isServiceToken(token)) {
    const user = await resolveServiceUser(req, res);
    if (!user) return;
    req.user = user;
    return next();
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  try {
    const apiToken = await storage.getApiTokenByHash(hash);
    if (!apiToken) {
      return res.status(401).json({ error: "Token invalido ou expirado" });
    }
    if (apiToken.expiresAt && new Date(apiToken.expiresAt) < new Date()) {
      return res.status(401).json({ error: "Token expirado" });
    }
    req.apiToken = {
      id: apiToken.id,
      permissoes: (apiToken.permissoes as string[]) || [],
      workspaceId: (apiToken as any).workspaceId || undefined,
    };
    storage.updateApiToken(apiToken.id, { ultimoUso: new Date() } as any).catch(() => {});
    next();
  } catch {
    return res.status(401).json({ error: "Erro ao validar token" });
  }
}

/**
 * Guard de escopo pra api_tokens. Auditoria 2026-06-19: as `permissoes` do api_token
 * eram declaradas (ex: somente-leitura) mas NUNCA verificadas — um token de leitura
 * gravava. JWT humano (req.user, sem apiToken) = full-scope. api_token só passa se o
 * escopo estiver nas permissoes. Token legado sem permissoes (array vazio) = full-scope
 * (retrocompatível, sem quebrar tokens existentes).
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const t = (req as any).apiToken;
    if (t && Array.isArray(t.permissoes) && t.permissoes.length > 0 && !t.permissoes.includes(scope)) {
      return res.status(403).json({ error: `Token sem a permissão necessária: ${scope}` });
    }
    next();
  };
}

export async function requireAuthOrToken(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: "Nao autenticado" });
  }

  if (isServiceToken(token)) {
    const user = await resolveServiceUser(req, res);
    if (!user) return;
    req.user = user;
    return next();
  }

  const headerToken = req.headers["x-flowcrm-token"] as string;
  if (headerToken) {
    return requireApiToken(req, res, next);
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return storage.getApiTokenByHash(hash).then(apiToken => {
    if (apiToken && (!apiToken.expiresAt || new Date(apiToken.expiresAt) >= new Date())) {
      req.apiToken = {
        id: apiToken.id,
        permissoes: (apiToken.permissoes as string[]) || [],
        workspaceId: (apiToken as any).workspaceId || undefined,
      };
      storage.updateApiToken(apiToken.id, { ultimoUso: new Date() } as any).catch(() => {});
      return next();
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET as string) as unknown as AuthPayload;
      if (isBlocked(payload.workspaceId, payload.id)) {
        return res.status(401).json({ error: "Conta bloqueada. Contate o suporte.", blocked: true });
      }
      if (billingBlocked(req, res, payload.workspaceId)) return;
      req.user = payload;
      return next();
    } catch {
      return res.status(401).json({ error: "Nao autenticado" });
    }
  }).catch(() => {
    try {
      const payload = jwt.verify(token, JWT_SECRET as string) as unknown as AuthPayload;
      if (isBlocked(payload.workspaceId, payload.id)) {
        return res.status(401).json({ error: "Conta bloqueada. Contate o suporte.", blocked: true });
      }
      if (billingBlocked(req, res, payload.workspaceId)) return;
      req.user = payload;
      return next();
    } catch {
      return res.status(401).json({ error: "Nao autenticado" });
    }
  });
}

export { JWT_SECRET };
