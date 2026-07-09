// Valida e faz parse do `signed_request` que a Meta envia nos callbacks de
// Desautorização (deauthorize) e de Exclusão de Dados (data deletion) do Instagram.
// Formato: "<assinatura_base64url>.<payload_base64url>", onde a assinatura é
// HMAC-SHA256(payload, appSecret). Retorna null se a assinatura não bater (nunca
// confie no payload sem validar). Bruno 2026-07-09.
import crypto from "crypto";

export interface SignedRequestPayload {
  user_id?: string;        // ID do usuário do Instagram (escopo do app)
  algorithm?: string;      // deve ser "HMAC-SHA256"
  issued_at?: number;
  [k: string]: any;
}

export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  if (!signedRequest || !appSecret || typeof signedRequest !== "string") return null;
  const [sig, payload] = signedRequest.split(".");
  if (!sig || !payload) return null;
  try {
    const expected = crypto.createHmac("sha256", appSecret).update(payload).digest();
    const got = Buffer.from(sig, "base64url");
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.algorithm && String(data.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    return data as SignedRequestPayload;
  } catch {
    return null;
  }
}
