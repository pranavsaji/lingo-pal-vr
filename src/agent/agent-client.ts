/**
 * Talks to /api/agent (server holds the API key). Falls back to the offline
 * script on any failure, so a turn always arrives.
 */

import type { AgentRequest, AgentTurn, ReplyOption } from './protocol.js';
import { scriptedTurn } from './script.js';

const HARD_TIMEOUT_MS = 8000;
let aiAvailable: boolean | null = null; // unknown until the first call

export function aiStatus(): 'online' | 'offline' | 'unknown' {
  return aiAvailable === null ? 'unknown' : aiAvailable ? 'online' : 'offline';
}

const isReply = (o: unknown): o is ReplyOption =>
  typeof o === 'object' && o !== null && typeof (o as ReplyOption).fr === 'string' && typeof (o as ReplyOption).en === 'string';

/** Shape check only; tool semantics are validated by applyActions. */
export function parseTurn(data: unknown): AgentTurn | null {
  if (typeof data !== 'object' || data === null) return null;
  const t = data as Record<string, unknown>;
  if (typeof t.fr !== 'string' || !t.fr.trim() || typeof t.en !== 'string') return null;
  const replies = Array.isArray(t.replies) ? t.replies.filter(isReply).slice(0, 3) : [];
  if (replies.length < 3) return null;
  return {
    fr: t.fr.slice(0, 200),
    en: t.en.slice(0, 240),
    replies,
    actions: Array.isArray(t.actions) ? t.actions : [],
    points: typeof t.points === 'number' && Number.isFinite(t.points) ? Math.max(0, Math.min(20, Math.round(t.points))) : 5,
    source: 'ai',
  };
}

export interface TurnOptions {
  /** Called if the answer takes longer than `slowMs` (play a "thinking" nod + filler). */
  onSlow?: () => void;
  slowMs?: number;
}

/** Fire-and-forget: wakes the server route and model connection at app start. */
export function warmUpAgent(): void {
  if (typeof fetch === 'undefined') return;
  fetch('./api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"warmup":true}' })
    .then((res) => {
      if (res.status === 404 || res.status === 503) aiAvailable = false;
      else if (res.ok) aiAvailable = true;
    })
    .catch(() => undefined);
}

export async function fetchAgentTurn(req: AgentRequest, opts: TurnOptions = {}): Promise<AgentTurn> {
  // The greeting must be instant (first impression, cold server): the scripted
  // greeting is personal (name, favorite order, plat du jour) and warms the AI meanwhile.
  if (req.event.kind === 'arrive') {
    warmUpAgent();
    return scriptedTurn(req);
  }
  if (aiAvailable === false || typeof fetch === 'undefined') return scriptedTurn(req);
  const slow = opts.onSlow ? setTimeout(opts.onSlow, opts.slowMs ?? 700) : undefined;
  const ctrl = new AbortController();
  const hard = setTimeout(() => ctrl.abort(), HARD_TIMEOUT_MS);
  try {
    const res = await fetch('./api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 503) {
      aiAvailable = false; // no route or no key: script for the rest of the session
      return scriptedTurn(req);
    }
    if (!res.ok) throw new Error(`agent ${res.status}`);
    const turn = parseTurn(await res.json());
    if (!turn) throw new Error('bad agent shape');
    aiAvailable = true;
    return turn;
  } catch {
    return scriptedTurn(req); // timeout, network hiccup, malformed reply
  } finally {
    clearTimeout(hard);
    if (slow) clearTimeout(slow);
  }
}
