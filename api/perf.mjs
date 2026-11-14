/**
 * Vercel serverless function: POST /api/perf (tester mode frame-rate reports, see TESTING.md).
 * Logs one `[perf]` JSON line per valid report; stores nothing.
 */
import { handlePerf } from '../server/perf-handler.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (Number(req.headers['content-length'] ?? 0) > 1024) {
    res.status(413).json({ error: 'too large' });
    return;
  }
  try {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    const { status, body } = await handlePerf(req.body ?? null, process.env, ip, req.headers);
    if (body === null) res.status(status).end();
    else res.status(status).json(body);
  } catch {
    res.status(500).json({ error: 'perf report failed' });
  }
}
