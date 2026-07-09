import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX = process.env.ENCRYPTION_KEY;

function getKey(): Buffer {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('[crypto] ENCRYPTION_KEY não configurada ou inválida (deve ser 64 hex chars)');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: iv(24):tag(32):ciphertext(base64)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('base64')}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;
  // Se não estiver no formato criptografado, retorna como está (migração gradual)
  if (!ciphertext.includes(':')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  const [ivHex, tagHex, encryptedB64] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

export function isEncrypted(value: string): boolean {
  if (!value) return false;
  const parts = value.split(':');
  return parts.length === 3 && parts[0].length === 24 && parts[1].length === 32;
}
