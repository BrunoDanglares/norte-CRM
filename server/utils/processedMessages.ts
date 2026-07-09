const cache = new Map<string, number>();
const TTL_MS = 5 * 60 * 1000;

export function isDuplicate(wamid: string): boolean {
  const now = Date.now();
  for (const [id, ts] of cache.entries()) {
    if (now - ts > TTL_MS) cache.delete(id);
  }
  if (cache.has(wamid)) return true;
  cache.set(wamid, now);
  return false;
}
