/**
 * Agent tools: the only way Madame Lune (AI or offline script) can change the
 * world. Every proposed action is validated against the deterministic order
 * state before it is applied; invalid actions are dropped and reported.
 *
 * Pure module: no World, no DOM. Systems subscribe to the returned effects.
 */

import { MAX_QUANTITY, makeChange, menuItem, type Denomination } from './menu.js';

// ---- Order state machine ----------------------------------------------------

export type OrderPhase = 'browsing' | 'ordering' | 'paying' | 'paid';

export interface OrderLine {
  itemId: string;
  qty: number;
}

export interface OrderState {
  phase: OrderPhase;
  lines: OrderLine[];
  /** Coins/notes the learner has put on the tray, in cents. */
  trayCents: number;
  /** Change owed after payment (set when paid). */
  changeCents: number;
  /** Change already handed back by the agent. */
  changeGiven: boolean;
  /** Free extras on the tray, never priced (the bistrot's carafe d'eau); see freeExtras in order-guard.ts. */
  free?: string[];
}

export function emptyOrder(): OrderState {
  return { phase: 'browsing', lines: [], trayCents: 0, changeCents: 0, changeGiven: false };
}

export function orderTotal(lines: OrderLine[]): number {
  let t = 0;
  for (const l of lines) t += (menuItem(l.itemId)?.priceCents ?? 0) * l.qty;
  return t;
}

export function itemCount(lines: OrderLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

// ---- Actions (tool calls) ---------------------------------------------------

export const EMOTES = ['nod', 'shrug', 'wave', 'laugh', 'think', 'clap'] as const;
export type Emote = (typeof EMOTES)[number];

export const MEMORY_KEYS = ['name', 'favorite_order', 'goal', 'hometown', 'mood', 'last_topic'] as const;
export type MemoryKey = (typeof MEMORY_KEYS)[number];

export type AgentAction =
  | { type: 'serve_items'; itemId: string; quantity: number }
  | { type: 'remove_item'; itemId: string }
  | { type: 'quote_total'; totalCents?: number }
  | { type: 'give_change'; cents?: number }
  | { type: 'start_quiz'; wordIds: string[] }
  | { type: 'remember'; key: MemoryKey; value: string }
  | { type: 'correct'; expected: string; heard: string; tip: string }
  | { type: 'emote'; kind: Emote }
  | { type: 'point_at'; itemId: string }
  | { type: 'end_visit' }
  | { type: 'offer'; itemId: string; quantity: number; reason?: OfferReason };

export type OfferReason = 'substitute' | 'upsell';

export const ACTION_TYPES: AgentAction['type'][] = [
  'serve_items',
  'remove_item',
  'quote_total',
  'give_change',
  'start_quiz',
  'remember',
  'correct',
  'emote',
  'point_at',
  'end_visit',
  'offer',
];

/** What the scene should do as a result of applied actions. */
export type Effect =
  | { kind: 'spawn'; itemId: string; quantity: number }
  | { kind: 'despawn'; itemId: string }
  | { kind: 'show_total'; totalCents: number }
  | { kind: 'return_change'; cents: number; coins: Denomination[] }
  | { kind: 'quiz'; wordIds: string[] }
  | { kind: 'memory'; key: MemoryKey; value: string }
  | { kind: 'correction'; expected: string; heard: string; tip: string }
  | { kind: 'emote'; emote: Emote }
  | { kind: 'point'; itemId: string }
  | { kind: 'goodbye' }
  /** The shopkeeper proposed an item (not served until the learner accepts). */
  | { kind: 'offer'; itemId: string; quantity: number; reason: OfferReason };

export interface Rejection {
  action: unknown;
  reason: string;
}

export interface ValidationContext {
  /** Known vocabulary ids (for quizzes and pointing). */
  vocabIds: ReadonlySet<string>;
  /** Pieces left of low-stock items (id -> count); other items are unlimited. */
  stock?: Readonly<Record<string, number>>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

/**
 * Validate and apply a batch of actions in order. Returns the new state, the
 * scene effects to play, and the rejected actions with reasons.
 * Never throws; never trusts numbers from the model.
 */
export function applyActions(
  state: OrderState,
  actions: unknown[],
  ctx: ValidationContext,
): { state: OrderState; effects: Effect[]; rejected: Rejection[] } {
  let s: OrderState = { ...state, lines: state.lines.map((l) => ({ ...l })) };
  const effects: Effect[] = [];
  const rejected: Rejection[] = [];
  const reject = (action: unknown, reason: string) => rejected.push({ action, reason });

  for (const a of actions.slice(0, 8)) {
    if (!isObj(a) || typeof a.type !== 'string') {
      reject(a, 'not an action');
      continue;
    }
    switch (a.type) {
      case 'serve_items': {
        const item = typeof a.itemId === 'string' ? menuItem(a.itemId) : undefined;
        const q = a.quantity;
        if (!item) { reject(a, 'unknown menu item'); break; }
        if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) { reject(a, 'quantity must be 1 to 5'); break; }
        if (s.phase === 'paid' && !s.changeGiven) { reject(a, 'give change first'); break; }
        if (s.phase === 'paid') s = emptyOrder(); // previous order settled: start a new one
        if (s.trayCents > 0) { reject(a, 'payment in progress'); break; }
        const line = s.lines.find((l) => l.itemId === item.id);
        const already = line?.qty ?? 0;
        if (already + q > MAX_QUANTITY) { reject(a, 'too many of one item'); break; }
        const left = ctx.stock?.[item.id];
        if (left !== undefined && already + q > left) { reject(a, left <= 0 ? 'sold out' : `only ${left} left`); break; }
        if (line) line.qty += q;
        else s.lines.push({ itemId: item.id, qty: q });
        s.phase = 'ordering';
        effects.push({ kind: 'spawn', itemId: item.id, quantity: q });
        break;
      }
      case 'remove_item': {
        const idx = s.lines.findIndex((l) => l.itemId === a.itemId);
        if (idx < 0) { reject(a, 'item not in order'); break; }
        if (s.phase === 'paying' || s.phase === 'paid') { reject(a, 'order already closed'); break; }
        s.lines.splice(idx, 1);
        if (s.lines.length === 0) s.phase = 'browsing';
        effects.push({ kind: 'despawn', itemId: a.itemId as string });
        break;
      }
      case 'quote_total': {
        if (s.lines.length === 0) { reject(a, 'nothing ordered'); break; }
        const total = orderTotal(s.lines);
        if (a.totalCents !== undefined && a.totalCents !== total) {
          // Model got the maths wrong: keep the action, use the true total.
          reject({ ...a }, `model total ${String(a.totalCents)} corrected to ${total}`);
        }
        if (s.phase !== 'paid') s.phase = 'paying';
        effects.push({ kind: 'show_total', totalCents: total });
        break;
      }
      case 'give_change': {
        if (s.phase !== 'paid') { reject(a, 'not paid yet'); break; }
        if (s.changeGiven) { reject(a, 'change already given'); break; }
        if (a.cents !== undefined && a.cents !== s.changeCents) {
          reject({ ...a }, `model change ${String(a.cents)} corrected to ${s.changeCents}`);
        }
        s.changeGiven = true;
        effects.push({ kind: 'return_change', cents: s.changeCents, coins: makeChange(s.changeCents) });
        break;
      }
      case 'start_quiz': {
        const ids = Array.isArray(a.wordIds) ? a.wordIds.filter((w): w is string => typeof w === 'string' && ctx.vocabIds.has(w)) : [];
        if (ids.length === 0) { reject(a, 'no known words'); break; }
        effects.push({ kind: 'quiz', wordIds: [...new Set(ids)].slice(0, 5) });
        break;
      }
      case 'remember': {
        if (!(MEMORY_KEYS as readonly string[]).includes(a.key as string)) { reject(a, 'memory key not allowed'); break; }
        if (!str(a.value, 40)) { reject(a, 'memory value must be 1 to 40 chars'); break; }
        effects.push({ kind: 'memory', key: a.key as MemoryKey, value: (a.value as string).trim() });
        break;
      }
      case 'correct': {
        if (!str(a.expected, 80) || !str(a.heard, 80) || !str(a.tip, 80)) { reject(a, 'bad correction'); break; }
        effects.push({ kind: 'correction', expected: a.expected as string, heard: a.heard as string, tip: a.tip as string });
        break;
      }
      case 'emote': {
        if (!(EMOTES as readonly string[]).includes(a.kind as string)) { reject(a, 'unknown emote'); break; }
        effects.push({ kind: 'emote', emote: a.kind as Emote });
        break;
      }
      case 'point_at': {
        if (typeof a.itemId !== 'string' || !ctx.vocabIds.has(a.itemId)) { reject(a, 'unknown item'); break; }
        effects.push({ kind: 'point', itemId: a.itemId });
        break;
      }
      case 'end_visit': {
        effects.push({ kind: 'goodbye' });
        break;
      }
      case 'offer': {
        const item = typeof a.itemId === 'string' ? menuItem(a.itemId) : undefined;
        const q = a.quantity;
        if (!item) { reject(a, 'unknown menu item'); break; }
        if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) { reject(a, 'quantity must be 1 to 5'); break; }
        if (s.phase === 'paying' || (s.phase === 'paid' && !s.changeGiven)) { reject(a, 'order closed'); break; }
        const left = ctx.stock?.[item.id];
        if (left !== undefined && q > left) { reject(a, 'not in stock'); break; }
        const reason: OfferReason = a.reason === 'substitute' ? 'substitute' : 'upsell';
        effects.push({ kind: 'offer', itemId: item.id, quantity: q, reason });
        break;
      }
      default:
        reject(a, 'unknown action type');
    }
  }
  return { state: s, effects, rejected };
}

/**
 * The learner pays (coins dropped on the tray). Deterministic: the agent is
 * then told the outcome, it does not decide it.
 */
export function payWith(state: OrderState, cents: number): { state: OrderState; ok: boolean; shortByCents: number } {
  const total = orderTotal(state.lines);
  if (state.lines.length === 0 || state.phase === 'paid') return { state, ok: false, shortByCents: 0 };
  const tray = state.trayCents + cents;
  if (tray < total) {
    return { state: { ...state, trayCents: tray, phase: 'paying' }, ok: false, shortByCents: total - tray };
  }
  return { state: { ...state, trayCents: tray, phase: 'paid', changeCents: tray - total, changeGiven: tray === total }, ok: true, shortByCents: 0 };
}
