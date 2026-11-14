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
  /** ...or this many passport stamps. */
  stamps?: number;
  /** ...or this many orders paid in one shop. */
  placeOrders?: { place: string; count: number };
  /** The shop this decor appears in (default: the cafe). */
  place?: string;
}

export const UNLOCKS: Unlock[] = [
  { id: 'string-lights', kind: 'decor', fr: 'les guirlandes', en: 'string lights', orders: 1 },
  { id: 'plants', kind: 'decor', fr: 'les plantes', en: 'plants', streak: 2 },
  { id: 'chalkboard', kind: 'decor', fr: "l'ardoise du jour", en: "today's chalkboard", level: 1 },
  { id: 'boulangerie', kind: 'scenario', fr: 'la boulangerie', en: 'the bakery', level: 1 },
  { id: 'gramophone', kind: 'decor', fr: 'le gramophone', en: 'the gramophone', streak: 3 },
  { id: 'marche', kind: 'scenario', fr: 'le marché', en: 'the market', level: 2 },
  // The newer shops open with paid orders (src/places/places.ts PLACE_UNLOCK_ORDERS).
  { id: 'bistrot', kind: 'scenario', fr: 'le bistrot', en: 'the bistro', orders: 2 },
  { id: 'metro', kind: 'scenario', fr: 'le métro', en: 'the metro', orders: 3 },
  { id: 'pharmacie', kind: 'scenario', fr: 'la pharmacie', en: 'the pharmacy', orders: 4 },
  { id: 'hotel', kind: 'scenario', fr: "l'hôtel", en: 'the hotel', orders: 5 },
  { id: 'terrasse', kind: 'decor', fr: 'la terrasse', en: 'the terrace', streak: 7 },
  // Visible growth in every shop (Reason to Come Back): each milestone changes the room.
  { id: 'lanternes', kind: 'decor', fr: 'les lanternes', en: 'the lanterns', streak: 5 },
  { id: 'mur-tampons', kind: 'decor', fr: 'le tableau des tampons', en: 'the stamp board', stamps: 4 },
  { id: 'fleurs-boulangerie', kind: 'decor', fr: 'les fleurs de la boulangerie', en: 'the bakery flowers', placeOrders: { place: 'boulangerie', count: 3 }, place: 'boulangerie' },
  { id: 'guirlandes-marche', kind: 'decor', fr: 'les guirlandes du marché', en: 'the market lights', placeOrders: { place: 'marche', count: 3 }, place: 'marche' },
  { id: 'guirlandes-bistrot', kind: 'decor', fr: 'les guirlandes du bistrot', en: 'the bistro lights', placeOrders: { place: 'bistrot', count: 3 }, place: 'bistrot' },
  { id: 'plantes-metro', kind: 'decor', fr: 'les plantes du métro', en: 'the metro plants', placeOrders: { place: 'metro', count: 3 }, place: 'metro' },
  { id: 'fleurs-pharmacie', kind: 'decor', fr: 'les fleurs de la pharmacie', en: 'the pharmacy flowers', placeOrders: { place: 'pharmacie', count: 3 }, place: 'pharmacie' },
  { id: 'plantes-hotel', kind: 'decor', fr: "les plantes de l'hôtel", en: 'the hotel plants', placeOrders: { place: 'hotel', count: 3 }, place: 'hotel' },
];

export interface UnlockInputs {
  xp: number;
  streakDays: number;
  orders: number;
  /** Passport stamps earned (optional: older callers leave stamp unlocks locked). */
  stamps?: number;
  /** Orders paid per shop. */
  placeOrders?: Record<string, number>;
}

export function unlockedIds(p: UnlockInputs): string[] {
  const lvl = levelFor(p.xp).index;
  return UNLOCKS.filter(
    (u) =>
      (u.level === undefined || lvl >= u.level) &&
      (u.streak === undefined || p.streakDays >= u.streak) &&
      (u.orders === undefined || p.orders >= u.orders) &&
      (u.stamps === undefined || (p.stamps ?? 0) >= u.stamps) &&
      (u.placeOrders === undefined || (p.placeOrders?.[u.placeOrders.place] ?? 0) >= u.placeOrders.count),
  ).map((u) => u.id);
}

/** Ids present in `after` but not in `before`. */
export function newlyUnlocked(before: string[], after: string[]): string[] {
  const had = new Set(before);
  return after.filter((id) => !had.has(id));
}
