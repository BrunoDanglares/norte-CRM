// Login sem senha por código (OTP) — Bruno 2026-06-15.
//
// Fluxo: a pessoa informa o e-mail da conta e escolhe receber um código de 6
// dígitos por E-MAIL ou WHATSAPP. O código vale 10 min, é guardado só como hash
// (sha256 do `email:codigo`), e a verificação é timing-safe com limite de
// tentativas. Por segurança, o request NUNCA revela se a conta existe.
//
// O identificador da conta é SEMPRE o e-mail (não casamos número de telefone do
// usuário, que é frágil). Pro canal WhatsApp, o código vai para o telefone
// cadastrado no usuário (users.telefone), enviado pela conexão do próprio
// workspace via channel-router.
import { db } from "../db";
import { loginCodes, users } from "@shared/schema";
import { eq, and, isNull, gt, lt, or, isNotNull, desc } from "drizzle-orm";
import { randomInt, createHash, timingSafeEqual } from "crypto";
import { sendLoginCodeEmail } from "./emailService";
import { sendMessage } from "./channel-router";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 código a cada 60s por e-mail
export const CODE_TTL_MINUTES = CODE_TTL_MS / 60000;

export type LoginChannel = "email" | "whatsapp";

function normalizeEmail(e: string): string {
  return (e || "").toLowerCase().trim();
}
function normalizePhone(p: string): string {
  return (p || "").replace(/\D/g, "");
}
function hashCode(identifier: string, code: string): string {
  return createHash("sha256").update(`${identifier}:${code}`).digest("hex");
}

/**
 * Gera e envia um código de login. Resolve o usuário pelo e-mail. SEMPRE retorna
 * sem lançar — o chamador responde genérico independentemente do resultado, pra
 * não permitir enumeração de contas.
 */
export async function requestLoginCode(params: {
  email: string;
  channel: LoginChannel;
  ip?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const email = normalizeEmail(params.email);
  if (!email || !email.includes("@")) return { sent: false, reason: "invalid_email" };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { sent: false, reason: "no_user" };
  if (user.status === "INACTIVE" || user.status === "INVITED") return { sent: false, reason: "inactive" };

  // Anti-flood: já existe um código não consumido criado há menos de 60s?
  const cutoff = new Date(Date.now() - RESEND_COOLDOWN_MS);
  const [recent] = await db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(and(eq(loginCodes.identifier, email), isNull(loginCodes.consumedAt), gt(loginCodes.createdAt, cutoff)))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);
  if (recent) return { sent: false, reason: "cooldown" };

  const phone = normalizePhone(user.telefone || "");
  if (params.channel === "whatsapp" && !phone) return { sent: false, reason: "no_phone" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({
    userId: user.id,
    identifier: email,
    channel: params.channel,
    codeHash: hashCode(email, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    ip: params.ip || null,
  });

  if (params.channel === "whatsapp") {
    if (!user.workspaceId) return { sent: false, reason: "no_workspace" };
    const res = await sendMessage({
      workspaceId: user.workspaceId,
      to: phone,
      type: "text",
      content: `🍌 Seu código de acesso ao ChatBanana é *${code}*.\nVale por ${CODE_TTL_MINUTES} minutos. Não compartilhe com ninguém.`,
      skipWindowCheck: true,
    });
    return { sent: !!res.success, reason: res.success ? undefined : (res.error || "send_failed") };
  }

  const ok = await sendLoginCodeEmail({ to: user.email, code, ttlMinutes: CODE_TTL_MINUTES });
  return { sent: ok, reason: ok ? undefined : "email_not_sent" };
}

/**
 * Verifica o código. Retorna o usuário (linha completa) se válido. Consome o
 * código no sucesso e incrementa tentativas no erro.
 */
export async function verifyLoginCode(params: {
  email: string;
  code: string;
}): Promise<{ ok: true; user: typeof users.$inferSelect } | { ok: false; error: string }> {
  const email = normalizeEmail(params.email);
  const code = (params.code || "").replace(/\D/g, "");
  if (!email || code.length !== 6) return { ok: false, error: "Código inválido." };

  const [row] = await db
    .select()
    .from(loginCodes)
    .where(and(eq(loginCodes.identifier, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, error: "Código inválido ou expirado. Solicite um novo." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Muitas tentativas. Solicite um novo código." };

  const expected = Buffer.from(row.codeHash, "hex");
  const got = Buffer.from(hashCode(email, code), "hex");
  const match = expected.length === got.length && timingSafeEqual(expected, got);

  if (!match) {
    await db.update(loginCodes).set({ attempts: row.attempts + 1 }).where(eq(loginCodes.id, row.id));
    return { ok: false, error: "Código incorreto." };
  }

  await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, row.id));
  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user) return { ok: false, error: "Usuário não encontrado." };
  return { ok: true, user };
}

/**
 * LGPD/minimização (SEC #28): códigos OTP são de uso único e guardam e-mail+IP.
 * Após consumo ou expiração não têm mais valor — purga pra não acumular PII
 * indefinidamente. Roda no scheduler de purge do boot (a cada 6h).
 */
export async function purgeStaleLoginCodes(): Promise<number> {
  const now = new Date();
  const res = await db
    .delete(loginCodes)
    .where(or(isNotNull(loginCodes.consumedAt), lt(loginCodes.expiresAt, now)))
    .returning({ id: loginCodes.id });
  return res.length;
}
