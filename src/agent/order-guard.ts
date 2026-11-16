/**
 * Holds the shopkeeper to the count the learner asked for. The AI proposes
 * `serve_items`; if the learner clearly said "deux croissants" (or held up two
 * fingers) and the model serves three, the game serves two and fixes the number
 * in her line. Conservative on purpose: only the first serve of an item in an
 * order, never past the stock (a sold-out swap stands), and only 2 to 5 are
 * rewritten in the text ("un croissant" -> "deux croissants" needs grammar).
 */

import { numberToFrench } from './menu.js';
import type { AgentTurn } from './protocol.js';
import type { OrderState } from './tools.js';

export interface CountFix {
  itemId: string;
  from: number;
  to: number;
}

const EN = ['zero', 'one', 'two', 'three', 'four', 'five'];

/** Replace the one standalone `from` word with `to` (keeps a leading capital); unchanged when it is absent or ambiguous. */
function swapWord(text: string, from: string, to: string): string {
  const re = new RegExp(`(^|[^\\p{L}])(${from})(?=$|[^\\p{L}])`, 'giu');
  const hits = text.match(re);
  if (!hits || hits.length !== 1) return text;
  return text.replace(re, (_m, pre: string, word: string) => pre + (word[0] === word[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to));
}

export function holdToAskedCounts(
  turn: AgentTurn,
  asked: readonly { itemId: string; qty: number }[],
  order: OrderState,
  stock?: Readonly<Record<string, number>>,
): { turn: AgentTurn; fixes: CountFix[] } {
  if (!asked.length) return { turn, fixes: [] };
  const fixes: CountFix[] = [];
  const actions = turn.actions.map((a) => {
    if (typeof a !== 'object' || a === null) return a;
    const act = a as Record<string, unknown>;
    if (act.type !== 'serve_items' || typeof act.itemId !== 'string' || typeof act.quantity !== 'number') return a;
    const want = asked.find((x) => x.itemId === act.itemId);
    if (!want || want.qty === act.quantity) return a;
    // Adding to an item already on the counter: the model's increment stands.
    if (order.phase !== 'paid' && order.lines.some((l) => l.itemId === act.itemId)) return a;
    const left = stock?.[act.itemId];
    if (left !== undefined && want.qty > left) return a;
    fixes.push({ itemId: act.itemId, from: act.quantity, to: want.qty });
    return { ...act, quantity: want.qty };
  });
  if (!fixes.length) return { turn, fixes };
  let { fr, en } = turn;
  for (const f of fixes) {
    if (f.from < 2 || f.to < 2 || f.from > 5 || f.to > 5) continue;
    fr = swapWord(fr, numberToFrench(f.from), numberToFrench(f.to));
    en = swapWord(en, EN[f.from], EN[f.to]);
  }
  return { turn: { ...turn, actions, fr, en }, fixes };
}
