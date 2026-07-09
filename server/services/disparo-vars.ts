// Bruno 2026-06-05: resolução de variáveis dos disparos programados.
// Tokens do CLIENTE (resolvidos por destinatário a partir do cadastro/ERP) +
// valores FIXOS. Usado tanto pro texto livre (Evolution) quanto pra montar os
// `components` do template HSM (API oficial Meta).
import { db } from "../db";
import { contacts, workspaces } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

export interface DisparoToken {
  token: string;
  label: string;
  erp: boolean; // true = precisa consultar o ERP (CPF do contato)
}

// Catálogo de tokens disponíveis (exportado pra UI montar os seletores).
export const DISPARO_TOKENS: DisparoToken[] = [
  { token: "nome", label: "Nome do cliente", erp: false },
  { token: "primeiro_nome", label: "Primeiro nome", erp: false },
  { token: "telefone", label: "Telefone", erp: false },
  { token: "empresa", label: "Empresa / Provedor", erp: false },
  { token: "saudacao", label: "Saudação (Bom dia/tarde/noite)", erp: false },
  { token: "valor", label: "Valor da fatura (ERP)", erp: true },
  { token: "vencimento", label: "Vencimento da fatura (ERP)", erp: true },
  { token: "link_boleto", label: "Link do boleto (ERP)", erp: true },
  { token: "linha_digitavel", label: "Linha digitável (ERP)", erp: true },
  { token: "pix", label: "PIX copia-e-cola (ERP)", erp: true },
  { token: "plano", label: "Plano contratado (ERP)", erp: true },
];

const ERP_TOKENS = new Set(DISPARO_TOKENS.filter((t) => t.erp).map((t) => t.token));

export type TemplateVarMap = Array<{ index: number; kind: "token" | "fixed"; value: string }>;

function brtNow(): Date {
  return new Date(Date.now() - 3 * 3600 * 1000);
}
function saudacaoBRT(): string {
  const h = brtNow().getUTCHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}
function firstName(nome: string): string {
  return (nome || "").trim().split(/\s+/)[0] || nome || "";
}
function fmtBRDate(s: any): string {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString("pt-BR");
}
function fmtMoney(v: any): string {
  const n = parseFloat(String(v).replace(",", "."));
  if (isNaN(n)) return v ? String(v) : "";
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

async function findContactByPhone(workspaceId: string, phone: string): Promise<any | null> {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return null;
  const last = digits.slice(-10); // ddd + número (tolera 55 e 9º dígito)
  try {
    const rows: any = await db.execute(sql`
      SELECT * FROM contacts
      WHERE workspace_id = ${workspaceId}::uuid
        AND right(regexp_replace(coalesce(telefone, ''), '[^0-9]', '', 'g'), 10) = ${last}
      LIMIT 1
    `);
    return (rows.rows ?? rows)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve os valores dos tokens pedidos pra UM destinatário. ERP é best-effort
 * (consulta só se algum token ERP for pedido; falha silenciosa → string vazia).
 */
export async function resolveTokens(
  workspaceId: string,
  recipient: { contactName?: string | null; phoneNumber: string },
  needed: Set<string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const contact = needed.size > 0 ? await findContactByPhone(workspaceId, recipient.phoneNumber) : null;

  const nome = recipient.contactName || contact?.nome || "";
  if (needed.has("nome")) out.nome = nome;
  if (needed.has("primeiro_nome")) out.primeiro_nome = firstName(nome);
  if (needed.has("telefone")) out.telefone = recipient.phoneNumber || "";
  if (needed.has("saudacao")) out.saudacao = saudacaoBRT();
  if (needed.has("empresa")) {
    let empresa = contact?.empresa || "";
    if (!empresa) {
      try {
        const [ws] = await db.select({ nome: workspaces.nome }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
        empresa = ws?.nome || "";
      } catch {}
    }
    out.empresa = empresa;
  }

  // Bruno 2026-06-28: módulo ISP/ERP removido. Tokens ERP (valor/vencimento/
  // link_boleto/linha_digitavel/pix/plano) resolvem pra string vazia abaixo.
  // Garante chave presente (string vazia) pros tokens pedidos não resolvidos.
  for (const t of needed) if (out[t] === undefined) out[t] = "";
  return out;
}

/** Extrai os tokens {{xxx}} referenciados num texto livre. */
export function extractTextTokens(text: string): Set<string> {
  const s = new Set<string>();
  const known = new Set(DISPARO_TOKENS.map((t) => t.token));
  const re = /\{\{\s*([a-z_]+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) {
    const tok = m[1].toLowerCase();
    if (known.has(tok)) s.add(tok);
  }
  return s;
}

/** Tokens referenciados num mapeamento de variáveis de template. */
export function extractMapTokens(map: TemplateVarMap | null | undefined): Set<string> {
  const s = new Set<string>();
  const known = new Set(DISPARO_TOKENS.map((t) => t.token));
  for (const v of map || []) {
    if (v.kind === "token" && known.has(v.value)) s.add(v.value);
  }
  return s;
}

/** Substitui {{token}} no texto livre pelos valores resolvidos. */
export function renderText(text: string, resolved: Record<string, string>): string {
  return (text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (full, tok) => {
    const v = resolved[String(tok).toLowerCase()];
    return v !== undefined ? v : full;
  });
}

// Sanitiza um parâmetro de template Meta: sem quebras de linha/tabs, sem 4+
// espaços, e NUNCA vazio (a Meta rejeita parâmetro vazio) → fallback "-".
function sanitizeParam(v: string): string {
  const clean = (v ?? "").replace(/[\n\t]/g, " ").replace(/ {4,}/g, "   ").trim();
  return clean.length > 0 ? clean : "-";
}

/**
 * Monta os `components` do template HSM a partir do mapeamento + valores
 * resolvidos. Forma comprovada (isp-schedulers): [{ type:'body', parameters:[{type:'text', text}] }].
 */
export function buildTemplateComponents(map: TemplateVarMap | null | undefined, resolved: Record<string, string>): any[] {
  const ordered = [...(map || [])].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return [];
  const parameters = ordered.map((v) => {
    const raw = v.kind === "fixed" ? (v.value || "") : (resolved[v.value] ?? "");
    return { type: "text", text: sanitizeParam(raw) };
  });
  return [{ type: "body", parameters }];
}
