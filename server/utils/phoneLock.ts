// Garante processamento serial por número de telefone (por workspace).
// Usa fila encadeada de Promises: mensagem concorrente aguarda a anterior
// terminar — não descarta, o que preserva todas as mensagens recebidas.
// Timeout de 3 minutos por lock evita travar em caso de crash interno.

const phoneLocks = new Map<string, Promise<any>>();
const PHONE_LOCK_TIMEOUT_MS = 3 * 60 * 1000;

export function withPhoneLock<T>(phoneKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = phoneLocks.get(phoneKey) || Promise.resolve();

  const wrappedFn = () =>
    Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[PhoneLock] timeout after ${PHONE_LOCK_TIMEOUT_MS / 1000}s for ${phoneKey}`)),
          PHONE_LOCK_TIMEOUT_MS
        )
      ),
    ]);

  const next = prev.then(() => wrappedFn(), () => wrappedFn());
  const tracked = next.catch(() => {});
  phoneLocks.set(phoneKey, tracked);
  tracked.finally(() => {
    if (phoneLocks.get(phoneKey) === tracked) {
      phoneLocks.delete(phoneKey);
    }
  });
  return next;
}

// ─── Lock anti-eco de envio do bot ───────────────────────────────────────────
// Mecanismo independente do withPhoneLock acima: quando o bot ENVIA uma
// mensagem, registra o telefone + timestamp para que o dedup de inbound
// reconheça o eco do próprio envio (multi-device / echo do canal) e não o
// trate como nova mensagem do cliente. Normaliza variações do número
// (+55, com/sem o 9) e marca todas. Realocado do módulo do canal não-oficial
// legado (removido) por ser genérico a todos os canais (Meta, Evolution).
const botSendingToPhone = new Map<string, number>();
const BOT_SEND_LOCK_MS = 15000;

function normalizePhoneForLock(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set<string>();
  variants.add(digits);
  if (digits.startsWith("55") && digits.length > 10) {
    variants.add(digits.slice(2));
  } else if (digits.length >= 8 && digits.length <= 11) {
    variants.add("55" + digits);
  }
  return Array.from(variants);
}

export function lockPhoneForBotSend(phone: string) {
  const now = Date.now();
  for (const v of normalizePhoneForLock(phone)) {
    botSendingToPhone.set(v, now);
  }
  if (botSendingToPhone.size > 4000) {
    const oldest = botSendingToPhone.keys().next().value;
    if (oldest) botSendingToPhone.delete(oldest);
  }
}

export function isPhoneLockedForBotSend(phone: string): boolean {
  for (const v of normalizePhoneForLock(phone)) {
    const ts = botSendingToPhone.get(v);
    if (ts && Date.now() - ts <= BOT_SEND_LOCK_MS) return true;
  }
  return false;
}
