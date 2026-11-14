/**
 * Tester mode frame-rate reports (`?perf`, see TESTING.md). Used by vite.config.ts (dev)
 * and api/perf.mjs (Vercel).
 *
 * POST /api/perf  { device, mode, place, avgFps, low1Fps, p95Ms, drawCalls, triangles,
 *                   fbScale, foveation, power, sessionS }  -> 204
 *
 * Anonymous by construction: the handler keeps only the whitelisted fields below,
 * clamps every number, accepts strings only from fixed shapes (no free text), never
 * stores or logs the IP (it is used in memory for the rate limit only), and writes one
 * JSON line prefixed `[perf]` to the function log (read with `vercel logs`).
 */

import { createRateLimiter, crossSite } from './limits.mjs';

const MAX_BYTES = 1024;
const DEVICES = new Set(['Quest 3', 'Quest 3S', 'Quest Pro', 'Quest 2', 'Quest', 'Mobile', 'Desktop', 'Other']);
const MODES = new Set(['vr', 'ar', 'flat']);
/** [min, max, decimals] per numeric field. */
const NUMBERS = {
  avgFps: [0, 240, 1],
  low1Fps: [0, 240, 1],
  p95Ms: [0, 1000, 1],
  drawCalls: [0, 100_000, 0],
  triangles: [0, 50_000_000, 0],
  fbScale: [0.25, 4, 2],
  foveation: [0, 1, 2],
  power: [0, 10, 0],
  sessionS: [0, 86_400, 0],
};

// One report per 30 s is normal; allow bursts (session end) but not floods.
const rateLimited = createRateLimiter({ windowMs: 60_000, max: 6 });

function num(v, [min, max, decimals]) {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const f = 10 ** decimals;
  return Math.round(Math.min(max, Math.max(min, n)) * f) / f;
}

/** The clean record, or null when the payload is not a valid report. Exported for tests. */
export function sanitizePerf(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const device = DEVICES.has(body.device) ? body.device : null;
  const mode = MODES.has(body.mode) ? body.mode : null;
  const place = typeof body.place === 'string' && /^[a-z]{2,16}$/.test(body.place) ? body.place : null;
  if (!device || !mode || !place) return null;
  const out = { device, mode, place };
  for (const [key, range] of Object.entries(NUMBERS)) {
    const v = num(body[key], range);
    if (v === null) return null;
    out[key] = v;
  }
  return out;
}

/**
 * Returns { status, body }. `body` may be a parsed object or the raw JSON string.
 * `log` is injectable for tests.
 */
export async function handlePerf(body, env = process.env, ip = 'local', headers = {}, log = console.log) {
  if (crossSite(headers)) return { status: 403, body: { error: 'same-origin only' } };
  const raw = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  if (raw.length > MAX_BYTES) return { status: 413, body: { error: 'too large' } };
  if (rateLimited(ip)) return { status: 429, body: { error: 'slow down' } };
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return { status: 400, body: { error: 'bad json' } };
    }
  }
  const record = sanitizePerf(parsed);
  if (!record) return { status: 400, body: { error: 'bad report' } };
  const build = typeof env.VERCEL_GIT_COMMIT_SHA === 'string' ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'local';
  log(`[perf] ${JSON.stringify({ build, ...record })}`);
  return { status: 204, body: null };
}
