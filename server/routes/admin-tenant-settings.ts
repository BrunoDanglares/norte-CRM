import type { Express, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET, requireAuth } from "../middleware/auth";
import { safeErr } from "../utils/helpers";
import { tenantSettingsService, DEFAULT_SETTINGS, DEFAULT_AGENT_CAPABILITIES } from "../services/tenantSettingsService";
import type { TenantSettingsJson, AgentCapabilities, AgentCapability } from "@shared/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireAdminOrSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ ok: false, error: "Token obrigatorio" });
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET as string) as any;
    (req as any).user = decoded;
    if (decoded.superAdmin) return next();
    const isManager = decoded.role === "gerente" || decoded.role === "admin" || decoded.accountType === "gestor";
    if (!isManager) return res.status(403).json({ ok: false, error: "Acesso restrito a administradores" });
    // Bruno 2026-06-13 (auditoria): admin/gerente só mexe no PRÓPRIO tenant. Sem
    // isto, um gerente lia/alterava settings de qualquer workspace via :tenantId.
    const tenantId = (req.params.tenantId || req.params.workspaceId) as string | undefined;
    if (tenantId && decoded.workspaceId && tenantId === decoded.workspaceId) return next();
    return res.status(403).json({ ok: false, error: "Acesso restrito ao próprio workspace" });
  } catch {
    return res.status(401).json({ ok: false, error: "Token invalido ou expirado" });
  }
}

interface ValidationError {
  field: string;
  message: string;
}

function validateBusinessRules(rules: any): ValidationError[] {
  const errors: ValidationError[] = [];
  if (rules === undefined || rules === null) return errors;
  if (typeof rules !== "object") {
    errors.push({ field: "businessRules", message: "Deve ser um objeto" });
    return errors;
  }
  if (rules.confidenceThreshold !== undefined) {
    const ct = Number(rules.confidenceThreshold);
    if (isNaN(ct) || ct < 0 || ct > 1) {
      errors.push({ field: "businessRules.confidenceThreshold", message: "Deve ser um numero entre 0 e 1" });
    }
  }
  const boolFields = [
    "suspendedToFinance", "allowDepartmentSwitch", "showOnlyOverdueIfSuspended",
    "allowPix", "allowBarcode", "allowTrustUnlock", "allowAutoOpenTicket", "requireRebootStep",
    "useUnifiedClassifier",
  ];
  for (const f of boolFields) {
    if (rules[f] !== undefined && typeof rules[f] !== "boolean") {
      errors.push({ field: `businessRules.${f}`, message: "Deve ser true ou false" });
    }
  }
  if (rules.faqAiCompose !== undefined && !["off", "sintese", "sintese+fallback"].includes(rules.faqAiCompose)) {
    errors.push({ field: "businessRules.faqAiCompose", message: "Deve ser 'off', 'sintese' ou 'sintese+fallback'" });
  }
  return errors;
}

function validatePlans(plans: any): ValidationError[] {
  const errors: ValidationError[] = [];
  if (plans === undefined || plans === null) return errors;
  if (typeof plans !== "object") {
    errors.push({ field: "plans", message: "Deve ser um objeto" });
    return errors;
  }
  if (plans.enabled !== undefined && typeof plans.enabled !== "boolean") {
    errors.push({ field: "plans.enabled", message: "Deve ser true ou false" });
  }
  if (plans.items !== undefined) {
    if (!Array.isArray(plans.items)) {
      errors.push({ field: "plans.items", message: "Deve ser um array" });
    } else {
      plans.items.forEach((item: any, i: number) => {
        if (!item.name || typeof item.name !== "string" || !item.name.trim()) {
          errors.push({ field: `plans.items[${i}].name`, message: "Nome e obrigatorio" });
        }
        if (!item.speed || typeof item.speed !== "string" || !item.speed.trim()) {
          errors.push({ field: `plans.items[${i}].speed`, message: "Velocidade e obrigatoria" });
        }
        if (item.price === undefined || item.price === null) {
          errors.push({ field: `plans.items[${i}].price`, message: "Preco e obrigatorio" });
        } else {
          const p = Number(item.price);
          if (isNaN(p) || p < 0) {
            errors.push({ field: `plans.items[${i}].price`, message: "Preco deve ser >= 0" });
          }
        }
      });
    }
  }
  return errors;
}

function validateTimeSlot(slot: any, path: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!slot || typeof slot !== "object") return errors;
  // String vazia = dia desligado (UI envia "" quando o usuário desabilita o
  // dia). Pula validação. Sem isso, backend rejeita o salvar inteiro com
  // "Formato invalido, use HH:mm" mesmo o domingo nem estando habilitado.
  if (slot.start !== undefined && slot.start !== "" && !TIME_RE.test(slot.start)) {
    errors.push({ field: `${path}.start`, message: "Formato invalido, use HH:mm" });
  }
  if (slot.end !== undefined && slot.end !== "" && !TIME_RE.test(slot.end)) {
    errors.push({ field: `${path}.end`, message: "Formato invalido, use HH:mm" });
  }
  return errors;
}

function validateServiceHours(hours: any): ValidationError[] {
  const errors: ValidationError[] = [];
  if (hours === undefined || hours === null) return errors;
  if (typeof hours !== "object") {
    errors.push({ field: "serviceHours", message: "Deve ser um objeto" });
    return errors;
  }
  if (hours.enabled !== undefined && typeof hours.enabled !== "boolean") {
    errors.push({ field: "serviceHours.enabled", message: "Deve ser true ou false" });
  }
  if (hours.enabled === true && (!hours.timezone || typeof hours.timezone !== "string")) {
    errors.push({ field: "serviceHours.timezone", message: "Timezone e obrigatorio quando habilitado" });
  }
  if (hours.weekdays) errors.push(...validateTimeSlot(hours.weekdays, "serviceHours.weekdays"));
  if (hours.saturday) errors.push(...validateTimeSlot(hours.saturday, "serviceHours.saturday"));
  if (hours.sunday) errors.push(...validateTimeSlot(hours.sunday, "serviceHours.sunday"));
  return errors;
}

function validateSettings(data: any): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!data || typeof data !== "object") {
    errors.push({ field: "body", message: "Corpo da requisicao deve ser um JSON valido" });
    return errors;
  }
  errors.push(...validateBusinessRules(data.businessRules));
  errors.push(...validatePlans(data.plans));
  errors.push(...validateServiceHours(data.serviceHours));
  return errors;
}

export function registerAdminTenantSettingsRoutes(app: Express) {
  const BASE = "/api/admin/tenant-settings";

  app.get(`${BASE}/:tenantId`, requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = (req.params.tenantId as string) as string;
      if (!UUID_RE.test(tenantId)) {
        return res.status(400).json({ ok: false, error: "tenantId invalido — deve ser UUID" });
      }
      const settings = await tenantSettingsService.getTenantSettings(tenantId);
      console.log(`[Admin Tenant Settings] GET tenant=${tenantId} by user=${(req as any).user?.email || "superadmin"}`);
      res.json({
        ok: true,
        data: {
          tenantId,
          settings,
          defaults: DEFAULT_SETTINGS,
        },
      });
    } catch (e: any) {
      console.error(`[Admin Tenant Settings] GET error:`, e.message);
      res.status(500).json({ ok: false, error: "Erro interno ao buscar configuracoes" });
    }
  });

  app.put(`${BASE}/:tenantId`, requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = (req.params.tenantId as string) as string;
      if (!UUID_RE.test(tenantId)) {
        return res.status(400).json({ ok: false, error: "tenantId invalido — deve ser UUID" });
      }
      const errors = validateSettings(req.body);
      if (errors.length > 0) {
        return res.status(422).json({ ok: false, error: "Dados invalidos", validationErrors: errors });
      }
      const previous = await tenantSettingsService.getTenantSettings(tenantId);
      const updated = await tenantSettingsService.updateTenantSettings(tenantId, req.body as Partial<TenantSettingsJson>);
      console.log(`[Admin Tenant Settings] PUT (full replace) tenant=${tenantId} by user=${(req as any).user?.email || "superadmin"}`);
      res.json({
        ok: true,
        data: {
          tenantId,
          settings: updated,
          previous,
        },
      });
    } catch (e: any) {
      console.error(`[Admin Tenant Settings] PUT error:`, e.message);
      res.status(500).json({ ok: false, error: "Erro interno ao atualizar configuracoes" });
    }
  });

  app.patch(`${BASE}/:tenantId`, requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = (req.params.tenantId as string) as string;
      if (!UUID_RE.test(tenantId)) {
        return res.status(400).json({ ok: false, error: "tenantId invalido — deve ser UUID" });
      }
      const errors = validateSettings(req.body);
      if (errors.length > 0) {
        return res.status(422).json({ ok: false, error: "Dados invalidos", validationErrors: errors });
      }
      const previous = await tenantSettingsService.getTenantSettings(tenantId);
      const updated = await tenantSettingsService.updateTenantSettings(tenantId, req.body as Partial<TenantSettingsJson>);
      const changedKeys = Object.keys(req.body);
      console.log(`[Admin Tenant Settings] PATCH tenant=${tenantId} sections=[${changedKeys.join(",")}] by user=${(req as any).user?.email || "superadmin"}`);
      res.json({
        ok: true,
        data: {
          tenantId,
          settings: updated,
          previous,
          patched: changedKeys,
        },
      });
    } catch (e: any) {
      console.error(`[Admin Tenant Settings] PATCH error:`, e.message);
      res.status(500).json({ ok: false, error: "Erro interno ao atualizar configuracoes" });
    }
  });

  app.post(`${BASE}/:tenantId/reset`, requireAdminOrSuperAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = (req.params.tenantId as string) as string;
      if (!UUID_RE.test(tenantId)) {
        return res.status(400).json({ ok: false, error: "tenantId invalido — deve ser UUID" });
      }
      const previous = await tenantSettingsService.getTenantSettings(tenantId);
      const defaults = await tenantSettingsService.resetTenantSettings(tenantId);
      console.log(`[Admin Tenant Settings] RESET tenant=${tenantId} by user=${(req as any).user?.email || "superadmin"}`);
      res.json({
        ok: true,
        data: {
          tenantId,
          settings: defaults,
          previous,
          message: "Configuracoes restauradas para o padrao",
        },
      });
    } catch (e: any) {
      console.error(`[Admin Tenant Settings] RESET error:`, e.message);
      res.status(500).json({ ok: false, error: "Erro interno ao resetar configuracoes" });
    }
  });

  console.log("[Boot] Admin Tenant Settings routes registered at /api/admin/tenant-settings");

  const VALID_AGENTS = ['FINANCEIRO', 'SUPORTE_TECNICO', 'VENDAS', 'CANCELAMENTO'] as const;

  function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ ok: false, error: "Token obrigatorio" });
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET as string) as any;
      if (!decoded.superAdmin) return res.status(403).json({ ok: false, error: "Acesso restrito a super_admin" });
      (req as any).user = decoded;
      return next();
    } catch {
      return res.status(401).json({ ok: false, error: "Token invalido ou expirado" });
    }
  }

  app.get("/api/admin/capabilities/:workspaceId", requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const workspaceId = (req.params.workspaceId as string) as string;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ ok: false, error: "workspaceId invalido" });
      const settings = await tenantSettingsService.getTenantSettings(workspaceId);
      const br = settings.businessRules ?? {};
      res.json({
        ok: true,
        workspaceId,
        capabilities: br.agent_capabilities ?? DEFAULT_AGENT_CAPABILITIES,
        priorities: br.agent_priorities ?? {},
        fluid_routing_threshold: br.fluid_routing_threshold ?? 0.65,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: safeErr(err, "[admin-tenant-settings]") });
    }
  });

  app.put("/api/admin/capabilities/:workspaceId", requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const workspaceId = (req.params.workspaceId as string) as string;
      if (!UUID_RE.test(workspaceId)) return res.status(400).json({ ok: false, error: "workspaceId invalido" });
      const { capabilities } = req.body;

      if (!capabilities || typeof capabilities !== 'object') {
        return res.status(400).json({ ok: false, error: "capabilities deve ser um objeto" });
      }
      for (const k of Object.keys(capabilities)) {
        if (!VALID_AGENTS.includes(k as any)) return res.status(400).json({ ok: false, error: `Agente desconhecido: ${k}` });
        const c = capabilities[k];
        if (typeof c !== 'object') return res.status(400).json({ ok: false, error: `${k} deve ser um objeto` });
        if (c.enabled !== undefined && typeof c.enabled !== 'boolean') return res.status(400).json({ ok: false, error: `${k}.enabled deve ser boolean` });
        if (c.escalate_to_human_if_disabled !== undefined && typeof c.escalate_to_human_if_disabled !== 'boolean') return res.status(400).json({ ok: false, error: `${k}.escalate_to_human_if_disabled deve ser boolean` });
        if (c.situations !== undefined) {
          if (!Array.isArray(c.situations) || !c.situations.every((s: any) => typeof s === 'string')) {
            return res.status(400).json({ ok: false, error: `${k}.situations deve ser array de strings` });
          }
        }
      }
      const allDisabled = VALID_AGENTS.every(a => capabilities[a]?.enabled === false);
      if (allDisabled) return res.status(400).json({ ok: false, error: "Pelo menos um agente deve permanecer ativo" });

      const settings = await tenantSettingsService.getTenantSettings(workspaceId);
      const br = settings.businessRules ?? {};
      br.agent_capabilities = capabilities as AgentCapabilities;
      await tenantSettingsService.updateTenantSettings(workspaceId, { businessRules: br });
      console.log(`[Admin Capabilities] Updated capabilities for workspace ${workspaceId} by superadmin`);
      res.json({ ok: true, workspaceId, capabilities });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: safeErr(err, "[admin-tenant-settings]") });
    }
  });

  console.log("[Boot] Admin Capabilities routes registered at /api/admin/capabilities");
}
