/**
 * Cost guards for the paid API routes (AI turns, speech-to-text, voices).
 * In-memory per server instance: a real backstop is a spend cap on each
 * provider account. These limit abuse without adding a database.
 */

/**
 * Sliding-window limiter per key (client IP). When the table is full, the
 * oldest keys are evicted one at a time; it is never wiped, so cycling through
 * many IPs cannot reset everyone else's window.
 */
export function createRateLimiter({ windowMs, max, maxKeys = 10_000 }) {
  const hits = new Map();
  return function limited(key, now = Date.now()) {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.delete(key); // re-insert: Map order = least recently seen first
    hits.set(key, list);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return list.length > max;
  };
}

/** A daily allowance (e.g. characters of speech); resets at UTC midnight. */
export function createDailyBudget(limit) {
  let day = '';
  let used = 0;
  return {
    take(amount, now = new Date()) {
      const d = now.toISOString().slice(0, 10);
      if (d !== day) {
        day = d;
        used = 0;
      }
      if (used + amount > limit) return false;
      used += amount;
      return true;
    },
    get used() {
      return used;
    },
  };
}

/**
 * Browsers send Sec-Fetch-Site on every fetch: reject calls made by other
 * websites (hot-linking our paid routes). Absent header = non-browser client,
 * which the rate limit and budget still cover.
 */
export function crossSite(headers) {
  const site = headers?.['sec-fetch-site'];
  return typeof site === 'string' && site !== 'same-origin' && site !== 'none';
}
