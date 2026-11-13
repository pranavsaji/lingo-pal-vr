/**
 * Procedural planning: at the end of a visit the shopkeeper plans tomorrow
 * from the learner's weakest spaced-repetition words and recorded mistakes.
 * The plan picks a theme to announce ("Demain, on travaille les fruits !")
 * and focus words that steer tomorrow's shopping list (dailyQuest).
 */

import { addDays, type Day } from './dates.js';
import type { Mistake } from './mistakes.js';
import type { SrsCard } from './srs.js';

export interface TomorrowPlan {
  /** The day the plan is for. */
  day: Day;
  /** Item/word ids to practise, most needed first (max 4). */
  focusWords: string[];
  themeFr: string;
  themeEn: string;
}

interface Theme {
  fr: string;
  en: string;
  words: string[];
}

export const THEMES: Theme[] = [
  { fr: 'les fruits', en: 'fruit', words: ['pomme', 'orange', 'poire', 'banane', 'citron', 'kiwi', 'avocat', 'grenade'] },
  { fr: 'les viennoiseries', en: 'pastries', words: ['croissant', 'pain_chocolat', 'eclair', 'macaron', 'tarte', 'gateau'] },
  { fr: 'le pain et le fromage', en: 'bread and cheese', words: ['baguette', 'petit_pain', 'fromage'] },
  { fr: 'les boissons', en: 'drinks', words: ['cafe', 'eau', 'verre'] },
  { fr: 'les légumes', en: 'vegetables', words: ['oignon', 'patate_douce'] },
];
const NUMBERS = { fr: 'les nombres', en: 'numbers' };
const PRICES = { fr: 'les prix', en: 'prices' };

export interface PlanInput {
  today: Day;
  srs: Record<string, SrsCard>;
  mistakes: readonly Mistake[];
  /** Words met this session (fallback when nothing is weak yet). */
  seenToday?: readonly string[];
  /** Maps a French noun ("pain au chocolat") to its id, for item mistakes. */
  idForNoun?: (noun: string) => string | undefined;
}

/** Tomorrow's focus. Null when there is nothing to go on (a learner who did nothing). */
export function planTomorrow(input: PlanInput): TomorrowPlan | null {
  const weight = new Map<string, number>();
  const add = (id: string | undefined, w: number) => {
    if (id && w > 0) weight.set(id, (weight.get(id) ?? 0) + w);
  };
  for (const [id, c] of Object.entries(input.srs)) add(id, (2.5 - c.ease) * 10 + c.lapses * 3);
  let numbers = 0;
  let prices = 0;
  for (const m of input.mistakes) {
    if (m.kind === 'quantity') numbers += m.count * 3;
    else if (m.kind === 'payment') prices += m.count * 3;
    else if (m.kind === 'pronunciation') add(input.idForNoun?.(m.want) ?? m.want, m.count * 4);
    else add(input.idForNoun?.(m.want), m.count * 2);
  }
  if (weight.size === 0) for (const id of input.seenToday ?? []) add(id, 1);

  const focusWords = [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id)
    .slice(0, 4);

  let best: { fr: string; en: string; score: number } | null = null;
  for (const t of THEMES) {
    const score = t.words.reduce((s, w) => s + (weight.get(w) ?? 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { fr: t.fr, en: t.en, score };
  }
  if (numbers > 0 && numbers >= (best?.score ?? 0)) best = { ...NUMBERS, score: numbers };
  if (prices > 0 && prices >= (best?.score ?? 0)) best = { ...PRICES, score: prices };
  if (!best) return null;
  return { day: addDays(input.today, 1), focusWords, themeFr: best.fr, themeEn: best.en };
}
