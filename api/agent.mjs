/**
 * Vercel serverless function: POST /api/agent
 * Set ANTHROPIC_API_KEY in the Vercel project's Environment Variables.
 */
import { handleAgent } from '../server/agent-handler.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    const { status, body: out } = await handleAgent(body, process.env, ip);
    res.status(status).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
