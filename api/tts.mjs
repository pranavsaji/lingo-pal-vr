/**
 * Vercel serverless function: GET /api/tts (natural shopkeeper voices).
 * Set INWORLD_API_KEY in the Vercel project's Environment Variables.
 */
import { handleTts } from '../server/tts-handler.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  try {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    const { status, headers, body } = await handleTts(req.query ?? {}, process.env, ip, req.headers);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.status(status);
    if (Buffer.isBuffer(body)) res.end(body);
    else res.json(body);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
