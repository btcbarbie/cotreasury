// A simple sliding-window limit kept in memory (one server process on Railway;
// it resets on restart, which is fine for keeping AI costs in check).

const hits = new Map<string, number[]>()

/** Record one use of `key`; false (with when it frees up) once `max` uses fall within `windowMs`. */
export function take(key: string, max: number, windowMs: number): { ok: true } | { ok: false; retryAt: number } {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    hits.set(key, recent)
    return { ok: false, retryAt: recent[0] + windowMs }
  }
  recent.push(now)
  hits.set(key, recent)
  return { ok: true }
}
