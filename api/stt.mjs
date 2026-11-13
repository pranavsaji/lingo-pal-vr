/**
 * Vercel serverless function: GET/POST /api/stt (raw audio body).
 * Set OPENAI_API_KEY or DEEPGRAM_API_KEY in the Vercel project's Environment Variables.
 */
import { crossSite } from '../server/limits.mjs';
import { handleStt } from '../server/stt-handler.mjs';

export const config = { api: { bodyParser: false } };

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_100_000) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'GET or POST only' });
    return;
  }
  if (crossSite(req.headers)) {
    res.status(403).json({ error: 'same-origin only' });
    return;
  }
  try {
    const audio = req.method === 'POST' ? await readBody(req) : null;
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    const { status, body } = await handleStt(req.method, audio, req.headers['content-type'], process.env, ip);
    res.status(status).json(body);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
