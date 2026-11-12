/**
 * Vercel serverless function: POST /api/chat
 * Set ANTHROPIC_API_KEY in the Vercel project's Environment Variables.
 */
import { handleChat } from '../server/chat-handler.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { status, body: out } = await handleChat(body);
    res.status(status).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
