/**
 * La liste de courses: a daily shopping list across Paris. One thing to buy in
 * three shops (the café, then two more), seeded by the date so it is the same
 * all day and new tomorrow. An item counts when it is paid for in its shop.
 * The first week's list is café, bakery, market; once more shops are open
 * (bistrot, métro, pharmacie) the two others rotate among all of them.
 */

import placesData from '../../shared/places.json';
import type { PlaceId } from '../game-state.js';
import { daySeed, type Day } from './dates.js';

export interface QuestTask {
  place: PlaceId;
  itemId: string;
  qty: number;
  done: boolean;
}

export interface Quest {
  day: Day;
  tasks: QuestTask[];
  /** Reward given (XP + celebration), so it is paid once. */
  rewarded: boolean;
}

/** Bonus XP for finishing the whole list. */
export const QUEST_XP = 60;

/** The starter shops: always eligible, so a beginner's list is café, bakery, market. */
const STARTERS: PlaceId[] = ['cafe', 'boulangerie', 'marche'];
/** Every shop in map order (src/places/places.ts PLACE_ORDER; kept here so this module stays light). */
const ORDER: PlaceId[] = ['cafe', 'boulangerie', 'marche', 'bistrot', 'metro', 'pharmacie'];
const menus = placesData.places as unknown as Record<PlaceId, { menu: { id: string }[] }>;

/**
 * @param focusWords optional words the shopkeeper planned for today (weakest
 * SRS words and mistakes, see state/plan.ts): a shop whose menu has one buys
 * it instead of the seeded pick. Without it the list is purely date-seeded.
 * @param unlocks the learner's unlock ids: newer shops (scenario unlocks named after the shop) join the rotation.
 */
export function dailyQuest(day: Day, focusWords?: readonly string[], unlocks: readonly string[] = []): Quest {
  const seed = daySeed(day);
  const pool = ORDER.filter((p) => p !== 'cafe' && (STARTERS.includes(p) || unlocks.includes(p)));
  const picks: PlaceId[] = ['cafe'];
  if (pool.length <= 2) picks.push(...pool);
  else {
    const a = Math.abs(seed >>> 5) % pool.length;
    let b = Math.abs(seed >>> 11) % (pool.length - 1);
    if (b >= a) b++;
    picks.push(pool[Math.min(a, b)], pool[Math.max(a, b)]); // map order
  }
  const tasks = picks.map((place, i) => {
    const menu = menus[place].menu;
    const s = (seed >>> (i * 7)) ^ (seed * (i + 3));
    const focus = focusWords?.find((w) => menu.some((m) => m.id === w));
    const item = (focus && menu.find((m) => m.id === focus)) || menu[Math.abs(s) % menu.length];
    return { place, itemId: item.id, qty: 1 + (Math.abs(s >>> 3) % 3), done: false };
  });
  return { day, tasks, rewarded: false };
}

/**
 * Tick off tasks satisfied by an order paid in `place`. Returns the tasks that
 * were just completed (empty if none).
 */
export function applyPaidOrder(quest: Quest, place: PlaceId, lines: { itemId: string; qty: number }[]): QuestTask[] {
  const fresh: QuestTask[] = [];
  for (const t of quest.tasks) {
    if (t.done || t.place !== place) continue;
    const bought = lines.filter((l) => l.itemId === t.itemId).reduce((a, l) => a + l.qty, 0);
    if (bought >= t.qty) {
      t.done = true;
      fresh.push(t);
    }
  }
  return fresh;
}

export function questComplete(quest: Quest): boolean {
  return quest.tasks.every((t) => t.done);
}

/** The pending task in a shop, for the shopkeeper's prompt ("2 croissant"). */
export function pendingHere(quest: Quest | null, place: PlaceId): QuestTask | null {
  return quest?.tasks.find((t) => t.place === place && !t.done) ?? null;
}
