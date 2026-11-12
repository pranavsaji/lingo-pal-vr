/**
 * Server-side AI shopkeeper. The API key never reaches the browser.
 * Used by the local dev server (vite.config.ts) and by Vercel (api/chat.mjs).
 *
 * Env:
 *   ANTHROPIC_API_KEY   required for AI replies (without it the app uses its offline script)
 *   SHOPKEEPER_MODEL    optional, defaults to claude-haiku-5-5
 */

const SYSTEM = `You are Madame Lune, a warm waitress in a small Paris cafe, inside a VR French lesson.
The learner is a beginner (A1 to A2). They answer by pinching one of three reply options, or by
showing you an object, which arrives as "[montre: <object>]".

Rules:
- Speak simple, natural French. At most 18 words. Stay in the cafe scene.
- If the learner shows an object, react to it (name it, offer it, give its price in euros).
- Offer exactly 3 reply options the learner could say next, short and useful, varied in purpose.
- Award "points" from 0 to 20 for the learner's last message (politeness, correct French, moving the order forward).
- Reply with ONLY a JSON object, no prose, no code fences:
{"fr": "...", "en": "English translation", "options": [{"fr": "...", "en": "..."}, {"fr": "...", "en": "..."}, {"fr": "...", "en": "..."}], "points": 10}`;

function toApiMessages(messages) {
  // Assistant turns are stored as JSON; keep only the French line for context.
  const out = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    let content = m.content.slice(0, 600);
    if (m.role === 'assistant') {
      try {
        content = JSON.parse(content).fr ?? content;
      } catch {
        /* keep raw */
      }
    }
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift(); // API must start with a user turn
  return out;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in model reply');
  return JSON.parse(text.slice(start, end + 1));
}

/** Returns { status, body } so each host can send it its own way. */
export async function handleChat(payload, env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { status: 503, body: { error: 'ANTHROPIC_API_KEY not set; client will use offline script' } };

  const messages = toApiMessages(Array.isArray(payload?.messages) ? payload.messages.slice(-12) : []);
  if (messages.length === 0) return { status: 400, body: { error: 'no user message' } };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.SHOPKEEPER_MODEL || 'claude-haiku-5-5',
      max_tokens: 400,
      system: SYSTEM,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { status: 502, body: { error: `model error ${res.status}`, detail: detail.slice(0, 300) } };
  }
  const data = await res.json();
  const text = (data.content ?? []).map((c) => c.text ?? '').join('');
  try {
    const turn = extractJson(text);
    if (!Array.isArray(turn.options) || turn.options.length !== 3) throw new Error('need 3 options');
    return { status: 200, body: turn };
  } catch (err) {
    return { status: 502, body: { error: String(err) } };
  }
}
