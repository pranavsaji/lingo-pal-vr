/**
 * XP, CEFR-style levels, daily streak and unlocks. Pure functions.
 */

import { daysBetween, type Day } from './dates.js';

export const XP = {
  wordHeard: 2,
  mission: 10,
  phraseSpoken: 15,
  orderCompleted: 25,
  correctPayment: 20,
  dailyRitual: 10,
  reviewCorrect: 5,
} as const;

export type XpReason = keyof typeof XP;

export interface Level {
  id: string;
  minXp: number;
}

export const LEVELS: Level[] = [
  { id: 'A1.1', minXp: 0 },
  { id: 'A1.2', minXp: 150 },
  { id: 'A1.3', minXp: 400 },
  { id: 'A2.1', minXp: 800 },
  { id: 'A2.2', minXp: 1400 },
];

export interface LevelInfo {
  index: number;
  id: string;
  next: string | null;
  /** 0 to 1 progress toward the next level (1 at max level). */
  progress: number;
  xpToNext: number;
}

export function levelFor(xp: number): LevelInfo {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].minXp) index = i;
  const cur = LEVELS[index];
  const nxt = LEVELS[index + 1];
  if (!nxt) return { index, id: cur.id, next: null, progress: 1, xpToNext: 0 };
  const span = nxt.minXp - cur.minXp;
  return { index, id: cur.id, next: nxt.id, progress: (xp - cur.minXp) / span, xpToNext: nxt.minXp - xp };
}

export interface StreakResult {
  streakDays: number;
  lastPlayedDay: Day;
  /** First session of a new calendar day. */
  isNewDay: boolean;
  /** A streak of 2+ days was lost. */
  broken: boolean;
}

export function touchStreak(lastPlayedDay: Day, streakDays: number, today: Day): StreakResult {
  if (lastPlayedDay === today) return { streakDays: Math.max(1, streakDays), lastPlayedDay, isNewDay: false, broken: false };
  const gap = lastPlayedDay ? daysBetween(lastPlayedDay, today) : Infinity;
  if (gap === 1) return { streakDays: streakDays + 1, lastPlayedDay: today, isNewDay: true, broken: false };
  return { streakDays: 1, lastPlayedDay: today, isNewDay: true, broken: streakDays >= 2 };
}

export type UnlockKind = 'decor' | 'menu' | 'scenario';

export interface Unlock {
  id: string;
  kind: UnlockKind;
  fr: string;
  en: string;
  /** Requirement: reach this level index, or this streak, or this many orders. */
  level?: number;
  streak?: number;
  orders?: number;
}

export const UNLOCKS: Unlock[] = [
  { id: 'string-lights', kind: 'decor', fr: 'les guirlandes', en: 'string lights', orders: 1 },
  { id: 'plants', kind: 'decor', fr: 'les plantes', en: 'plants', streak: 2 },
  { id: 'chalkboard', kind: 'decor', fr: "l'ardoise du jour", en: "today's chalkboard", level: 1 },
  { id: 'boulangerie', kind: 'scenario', fr: 'la boulangerie', en: 'the bakery', level: 1 },
  { id: 'gramophone', kind: 'decor', fr: 'le gramophone', en: 'the gramophone', streak: 3 },
  { id: 'marche', kind: 'scenario', fr: 'le marché', en: 'the market', level: 2 },
  { id: 'terrasse', kind: 'decor', fr: 'la terrasse', en: 'the terrace', streak: 7 },
];

export interface UnlockInputs {
  xp: number;
  streakDays: number;
  orders: number;
}

export function unlockedIds(p: UnlockInputs): string[] {
  const lvl = levelFor(p.xp).index;
  return UNLOCKS.filter(
    (u) =>
      (u.level === undefined || lvl >= u.level) &&
      (u.streak === undefined || p.streakDays >= u.streak) &&
      (u.orders === undefined || p.orders >= u.orders),
  ).map((u) => u.id);
}

/** Ids present in `after` but not in `before`. */
export function newlyUnlocked(before: string[], after: string[]): string[] {
  const had = new Set(before);
  return after.filter((id) => !had.has(id));
}
