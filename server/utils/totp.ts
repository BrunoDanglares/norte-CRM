// TOTP (RFC 6238) sem dependência externa — crypto puro. Auditoria 2026-06-20.
// Usado pra 2FA do super-admin (segundo fator após a senha). Compatível com Google
// Authenticator / Authy / 1Password (SHA1, 6 dígitos, passo de 30s).

import crypto from "crypto";

// Base32 decode (RFC 4648, ignora padding e espaços). O secret do TOTP é base32.
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/g, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue; // ignora caractere fora do alfabeto base32
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

// Valida um código TOTP. Janela ±1 passo (30s) pra tolerar relógio dessincronizado.
export function verifyTotp(token: string, base32Secret: string, stepSeconds = 30, window = 1): boolean {
  if (!token || !base32Secret) return false;
  const t = String(token).replace(/\D/g, "");
  if (t.length !== 6) return false;
  const secret = base32Decode(base32Secret);
  if (!secret.length) return false;
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const expectedBuf = Buffer.from(t);
  for (let w = -window; w <= window; w++) {
    const candidate = Buffer.from(hotp(secret, counter + w));
    if (candidate.length === expectedBuf.length && crypto.timingSafeEqual(candidate, expectedBuf)) {
      return true;
    }
  }
  return false;
}

// Gera um secret base32 aleatório (pra enrollment). 20 bytes = 32 chars base32.
export function generateTotpSecret(bytes = 20): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
