/**
 * Asks Pal: quick local answers first (what did she say, no AI needed), then
 * /api/agent in `mode: 'pal'`, then the offline helper on any failure, so an
 * answer always arrives.
 */

import { aiStatus } from '../agent/agent-client.js';
import { offlinePal, palRequest, parsePalAnswer, whatDidSheSay, type PalAnswer, type PalContext } from './pal-brain.js';

const TIMEOUT_MS = 8000;
let palRoute: boolean | null = null; // the route answered (null: unknown yet)

/** Questions answered locally even when the AI is up (instant, free, exact). */
export function localOnly(question: string): boolean {
  return /\bwhat (did|does|was) (she|he|that|it)( just)? (say|said|mean)?\b|\bwhat (she|he) said\b|\btranslate\b/.test(question.toLowerCase());
}

export async function askPal(question: string, ctx: PalContext, transport: typeof fetch | undefined = globalThis.fetch): Promise<PalAnswer> {
  if (localOnly(question)) return whatDidSheSay(ctx);
  if (!question.trim() || !transport || palRoute === false || aiStatus() === 'offline') return offlinePal(question, ctx);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await transport('./api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(palRequest(question, ctx)),
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 503) {
      palRoute = false; // no route or no key: offline Pal for the rest of the session
      return offlinePal(question, ctx);
    }
    const out = res.ok ? parsePalAnswer(await res.json()) : null;
    if (!out) return offlinePal(question, ctx);
    palRoute = true;
    return out;
  } catch {
    return offlinePal(question, ctx);
  } finally {
    clearTimeout(timer);
  }
}

/** Tests: forget what the route said. */
export function resetPalRoute(): void {
  palRoute = null;
}
