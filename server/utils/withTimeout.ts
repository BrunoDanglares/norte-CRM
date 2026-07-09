/**
 * Wraps any promise with a timeout.
 * Rejects with a descriptive error if the promise takes longer than `ms`.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[Timeout] ${label} excedeu ${ms}ms`));
    }, ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}
