/**
 * French speech-to-text for push-to-talk. The provider key never reaches the headset.
 * GET  -> 200 { provider: 'openai' | 'deepgram' | null } (client probe).
 * POST -> raw audio body (audio/webm or audio/mp4) -> { text }.
 *
 * Env (first one set wins):
 *   OPENAI_API_KEY    -> OpenAI transcriptions; model STT_MODEL (default "whisper-1")
 *   DEEPGRAM_API_KEY  -> Deepgram listen API; model STT_MODEL (default "nova-3")
 * Check current model names and pricing on the provider's docs before launch.
 */

import { createRateLimiter } from './limits.mjs';

const MAX_BYTES = 2_000_000; // ~7 s of opus is far below this

// Per-IP limit: the provider key is billed per request. In-memory, so per
// serverless instance; set a spend cap on the provider account as well.
const limiter = createRateLimiter({ windowMs: 60_000, max: 20 });
/** Per-IP sliding window (shared helper: never wiped, oldest IPs evicted). */
export function sttRateLimited(ip) {
  return limiter(ip);
}

export function sttProvider(env = process.env) {
  if (env.OPENAI_API_KEY) return 'openai';
  if (env.DEEPGRAM_API_KEY) return 'deepgram';
  return null;
}

/** @param {Buffer} audio @param {string} contentType */
export async function handleStt(method, audio, contentType, env = process.env, ip = 'unknown') {
  const provider = sttProvider(env);
  // The client probes with GET; "not configured" is a normal answer, not an error (clean console).
  if (method === 'GET') return { status: 200, body: { provider } };
  if (!provider) return { status: 503, body: { error: 'no STT provider key set' } };
  if (sttRateLimited(ip)) return { status: 429, body: { error: 'slow down' } };
  if (!audio || audio.length < 1000) return { status: 400, body: { error: 'no audio' } };
  if (audio.length > MAX_BYTES) return { status: 413, body: { error: 'audio too long' } };
  const type = /^audio\/[a-z0-9.+-]+/i.exec(contentType || '')?.[0] ?? 'audio/webm';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    if (provider === 'openai') {
      const form = new FormData();
      form.append('file', new Blob([audio], { type }), type.includes('mp4') ? 'speech.mp4' : 'speech.webm');
      form.append('model', env.STT_MODEL || 'whisper-1');
      form.append('language', 'fr');
      // Bias toward cafe vocabulary so short utterances transcribe correctly.
      form.append('prompt', "Bonjour madame. Deux croissants, s'il vous plaît. Un café. C'est combien ? Voilà cinq euros. Merci, au revoir.");
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
        signal: ctrl.signal,
      });
      if (!res.ok) return { status: 502, body: { error: `stt ${res.status}` } };
      const data = await res.json();
      return { status: 200, body: { text: String(data.text ?? '').slice(0, 300) } };
    }
    const model = env.STT_MODEL || 'nova-3';
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&language=fr&smart_format=true`, {
      method: 'POST',
      headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': type },
      body: audio,
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: 502, body: { error: `stt ${res.status}` } };
    const data = await res.json();
    const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return { status: 200, body: { text: String(text).slice(0, 300) } };
  } catch (err) {
    return { status: 502, body: { error: String(err).slice(0, 200) } };
  } finally {
    clearTimeout(timer);
  }
}
