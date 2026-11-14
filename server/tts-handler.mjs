/**
 * Natural French voices for the shopkeepers (Inworld TTS-2), server side so the
 * key never reaches the headset. Used by vite.config.ts (dev) and api/tts.mjs (Vercel).
 *
 * GET /api/tts?probe=1          -> 200 { ok: true } when a voice provider is configured, else 503
 * GET /api/tts?s=<speaker>&t=<text>[&slow=1] -> audio/mpeg
 *
 * Responses are deterministic for (speaker, text, slow), so they are sent with
 * long CDN cache headers: a greeting or a price said once is free afterwards.
 *
 * Env: INWORLD_API_KEY (Basic credential from the Inworld console).
 * Cost (check current pricing): about $25 per million characters for inworld-tts-2.
 */

import { createDailyBudget, createRateLimiter, crossSite } from './limits.mjs';

const INWORLD = 'https://api.inworld.ai/tts/v1/voice';
const MAX_CHARS = 240;

/**
 * Who speaks with which voice. Inworld has one French woman's voice (Hélène), so
 * Madame Rose gets a different delivery through a TTS-2 bracketed instruction
 * (not spoken) and a slightly faster pace.
 */
export const SPEAKERS = {
  lune: { voiceId: 'Hélène', style: '[warm, gentle, smiling café owner, speaking clearly for a learner]', rate: 0.95 },
  paul: { voiceId: 'Alain', style: '[cheerful, proud baker, friendly and clear]', rate: 0.95 },
  rose: { voiceId: 'Hélène', style: '[lively, chatty market seller with energy, clear for a learner]', rate: 1.05 },
  // Inworld's French voices are Hélène, Alain and Étienne: the new shopkeepers differ by voice, delivery and pace.
  marcel: { voiceId: 'Étienne', style: '[relaxed, warm Paris waiter, unhurried and friendly, clear for a learner]', rate: 0.92 },
  karim: { voiceId: 'Alain', style: '[brisk but kind metro ticket agent, crisp and efficient, clear for a learner]', rate: 1.05 },
  ines: { voiceId: 'Hélène', style: '[calm, soft-spoken, reassuring pharmacist, gentle and clear]', rate: 0.9 },
  claire: { voiceId: 'Hélène', style: '[polished, welcoming hotel receptionist, bright and professional, clear for a learner]', rate: 1.0 },
  learner: { voiceId: 'Étienne', style: '', rate: 0.95 },
};

const rateLimited = createRateLimiter({ windowMs: 60_000, max: 60 });
/**
 * Characters of speech per day per server instance (~$25 per million characters):
 * TTS_DAILY_CHAR_BUDGET, default 150,000 (about $3.75). Cached lines are served
 * by the CDN and never reach this function, so real use stays far below it.
 */
let budget = null;

/** Returns { status, headers, body } (body is a Buffer for audio, an object for JSON). */
export async function handleTts(query, env = process.env, ip = 'local', headers = {}) {
  const key = env.INWORLD_API_KEY;
  if (query.probe) return key ? json(200, { ok: true, provider: 'inworld' }) : json(503, { ok: false });
  if (!key) return json(503, { error: 'INWORLD_API_KEY not set' });
  const speaker = SPEAKERS[query.s];
  const text = typeof query.t === 'string' ? query.t.replace(/\s+/g, ' ').trim() : '';
  if (!speaker || !text) return json(400, { error: 'need s (speaker) and t (text)' });
  if (text.length > MAX_CHARS) return json(413, { error: 'text too long' });
  if (/[[\]]/.test(text)) return json(400, { error: 'brackets are reserved for delivery instructions' });
  if (crossSite(headers)) return json(403, { error: 'same-origin only' });
  if (rateLimited(ip)) return json(429, { error: 'slow down' });
  budget ??= createDailyBudget(Number(env.TTS_DAILY_CHAR_BUDGET) || 150_000);
  if (!budget.take(text.length + (speaker.style?.length ?? 0))) return json(429, { error: 'daily voice budget used up' });

  const rate = speaker.rate * (query.slow === '1' ? 0.8 : 1);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(INWORLD, {
      method: 'POST',
      headers: { Authorization: `Basic ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: speaker.style ? `${speaker.style} ${text}` : text,
        voiceId: speaker.voiceId,
        modelId: 'inworld-tts-2',
        audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000, speakingRate: rate },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return json(502, { error: `tts ${res.status}` });
    const data = await res.json();
    const audio = Buffer.from(String(data.audioContent ?? ''), 'base64');
    if (audio.length < 200) return json(502, { error: 'no audio' });
    return {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        // Same speaker + text = same audio: cache at the CDN for a year, in the browser for a day.
        'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      },
      body: audio,
    };
  } catch (err) {
    return json(502, { error: String(err).slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }
}

function json(status, body) {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body };
}
