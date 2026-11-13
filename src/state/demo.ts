/**
 * DEMO SEED (for judges and the video, never used otherwise): `?demo=week`
 * replaces the saved learner with a believable week of history so multi-day
 * progression can be seen in one sitting:
 *
 * - 6 days in a row played up to yesterday, so today's visit makes 7: a rest
 *   day is earned, the "7 jours" stamp is stamped and the terrace appears,
 *   all announced by the "Bon retour !" moment.
 * - 17 words collected (3 due for review today), 5 stamps, 10 orders paid,
 *   2 exact payments (one more earns "L'appoint"), the market not yet visited.
 *
 * `?demo=rest` is the same week with yesterday missed and one rest day in
 * reserve: today the rest day saves the streak.
 *
 * The profile carries `demo` so the UI can label it as a simulation. The URL
 * flag is removed after seeding, so a reload continues from the seeded state.
 */

import { addDays, type Day } from './dates.js';
import type { History } from './history.js';
import { defaultProfile, PROFILE_KEY, type KV, type Profile } from './profile.js';
import { unlockedIds } from './progression.js';
import { newCard, type SrsCard } from './srs.js';

export type DemoVariant = 'week' | 'rest';

const WORDS = ['croissant', 'cafe', 'baguette', 'pomme', 'orange', 'eau', 'gateau', 'verre', 'menu', 'fleur', 'pain_chocolat', 'eclair', 'macaron', 'tarte', 'petit_pain', 'fromage', 'assiette'];

/** Per-day activity: [xp, minutes, new words, orders, pronunciation avg]. */
const WEEK: [number, number, number, number, number][] = [
  [95, 9, 4, 2, 78],
  [120, 12, 3, 2, 81],
  [70, 7, 3, 1, 80],
  [140, 14, 3, 2, 85],
  [85, 8, 2, 1, 84],
  [110, 11, 2, 2, 88],
];

export function demoProfile(today: Day, variant: DemoVariant = 'week'): Profile {
  const p = defaultProfile();
  // Played days, oldest first. "rest": the week ends the day before yesterday.
  const lastPlayed = addDays(today, variant === 'rest' ? -2 : -1);
  const played = WEEK.map((_, i) => addDays(lastPlayed, i - (WEEK.length - 1)));

  const history: History = {};
  played.forEach((day, i) => {
    const [xp, min, words, orders, pron] = WEEK[i];
    history[day] = { xp, seconds: min * 60, newWords: words, orders, pronSum: pron * 3, pronCount: 3 };
  });
  // A lighter week before, so the report shows a trend.
  for (const back of [9, 11, 12]) history[addDays(today, -back)] = { xp: 45, seconds: 300, newWords: 2, orders: 1, pronSum: 150, pronCount: 2 };

  // Word book: older words climbed the ladder; three are due today.
  const srs: Record<string, SrsCard> = {};
  WORDS.forEach((id, i) => {
    const first = played[Math.min(played.length - 1, Math.floor(i / 3))];
    const reps = 1 + (i % 3);
    const intervalDays = [1, 3, 7][reps - 1];
    // Three words are due today (or overdue); the rest come back over the next days.
    const due = i < 3 ? addDays(today, -(i % 2)) : addDays(today, 1 + (i % 5));
    srs[id] = { ...newCard(first), reps, intervalDays, due, ease: i < 3 ? 1.9 + i * 0.1 : 2.5 };
  });

  const xp = 720;
  const orders = 10;
  const stamps: Record<string, Day> = {
    cafe: played[0],
    croissant: played[0],
    boulangerie: played[1],
    'serie-3': played[2],
    liste: played[3],
  };
  const placeOrders = { cafe: 6, boulangerie: 4, marche: 0 };
  Object.assign(p, {
    name: 'Alex',
    xp,
    streakDays: WEEK.length,
    lastPlayedDay: lastPlayed,
    sessions: 9,
    bestScore: 60,
    wordsSeen: [...WORDS],
    srs,
    memories: { name: 'Alex', favorite_order: 'un café et un croissant' },
    onboarded: true,
    lastVisit: `${lastPlayed}: Today: 2 words, 2 orders, 88% pronunciation, +110 XP. Ordered un café et un croissant.`,
    stats: { orders, payments: orders, phrases: 18, pronunciationTotal: 18 * 83, pronunciationCount: 18 },
    history,
    passport: { stamps, placeOrders, croissants: 3, exactPayments: 2, listsDone: 1, bestPron: 88 },
    restDays: variant === 'rest' ? 1 : 0,
    restUsed: [],
    demo: variant,
  } satisfies Partial<Profile>);
  p.unlocks = unlockedIds({ xp, streakDays: p.streakDays, orders, stamps: Object.keys(stamps).length, placeOrders });
  return p;
}

/** Seeds the demo profile when the URL asks for it (`?demo=week` or `?demo=rest`). Returns the same KV. */
export function withDemoSeed(kv: KV | null, today: Day): KV | null {
  if (!kv || typeof window === 'undefined') return kv;
  try {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('demo');
    if (flag !== 'week' && flag !== 'rest') return kv;
    kv.setItem(PROFILE_KEY, JSON.stringify(demoProfile(today, flag)));
    url.searchParams.delete('demo');
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Demo seeding is optional.
  }
  return kv;
}
