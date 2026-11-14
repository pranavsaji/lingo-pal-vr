/**
 * Le Passeport de Paris: a collectible stamp per shop plus milestone stamps,
 * earned only from real progress (orders paid, streak, words, change, level).
 * Pure functions over the plain JSON kept in the profile.
 */

import type { Day } from './dates.js';
import { levelFor, LEVELS } from './progression.js';

/** Counters the stamps need that the rest of the profile does not keep. */
export interface PassportProgress {
  /** Stamp id -> day it was earned. */
  stamps: Record<string, Day>;
  /** Orders paid per shop. */
  placeOrders: Record<string, number>;
  /** Croissants bought (any shop). */
  croissants: number;
  /** Payments with the exact amount (no change). */
  exactPayments: number;
  /** Shopping lists finished. */
  listsDone: number;
  /** Best pronunciation score on a phrase (0 to 100). */
  bestPron: number;
}

export function emptyPassport(): PassportProgress {
  return { stamps: {}, placeOrders: {}, croissants: 0, exactPayments: 0, listsDone: 0, bestPron: 0 };
}

/** Everything a stamp can be earned from. */
export interface StampFacts {
  passport: PassportProgress;
  streakDays: number;
  wordsSeen: number;
  xp: number;
}

export type StampKind = 'shop' | 'streak' | 'skill';

export interface Stamp {
  id: string;
  kind: StampKind;
  /** Short French name on the stamp. */
  fr: string;
  en: string;
  /** How to earn it (English hint on the locked stamp). */
  how: string;
  /** Progress toward it: have / need. */
  progress(f: StampFacts): { have: number; need: number };
}

const A2_XP = LEVELS.find((l) => l.id === 'A2.1')?.minXp ?? 800;

const orders = (place: string) => (f: StampFacts) => ({ have: f.passport.placeOrders[place] ?? 0, need: 1 });

export const STAMPS: Stamp[] = [
  { id: 'cafe', kind: 'shop', fr: 'Café Lune', en: 'Café Lune', how: 'Pay for an order at the café', progress: orders('cafe') },
  { id: 'boulangerie', kind: 'shop', fr: 'Boulangerie', en: 'The bakery', how: 'Pay for an order at the bakery', progress: orders('boulangerie') },
  { id: 'marche', kind: 'shop', fr: 'Marché', en: 'The market', how: 'Pay for an order at the market', progress: orders('marche') },
  { id: 'bistrot', kind: 'shop', fr: 'Bistrot', en: 'The bistro', how: 'Pay for a lunch at the bistro', progress: orders('bistrot') },
  { id: 'metro', kind: 'shop', fr: 'Métro', en: 'The metro', how: 'Buy a ticket at the metro', progress: orders('metro') },
  { id: 'pharmacie', kind: 'shop', fr: 'Pharmacie', en: 'The pharmacy', how: 'Pay for an order at the pharmacy', progress: orders('pharmacie') },
  { id: 'croissant', kind: 'skill', fr: 'Premier croissant', en: 'First croissant', how: 'Buy a croissant', progress: (f) => ({ have: f.passport.croissants, need: 1 }) },
  { id: 'appoint', kind: 'skill', fr: "L'appoint", en: 'Exact change', how: 'Pay the exact amount 3 times', progress: (f) => ({ have: f.passport.exactPayments, need: 3 }) },
  { id: 'liste', kind: 'skill', fr: 'Liste complète', en: 'Full list', how: 'Finish a daily shopping list', progress: (f) => ({ have: f.passport.listsDone, need: 1 }) },
  { id: 'serie-3', kind: 'streak', fr: '3 jours', en: '3 days in a row', how: 'Come back 3 days in a row', progress: (f) => ({ have: f.streakDays, need: 3 }) },
  { id: 'serie-7', kind: 'streak', fr: '7 jours', en: '7 days in a row', how: 'Come back 7 days in a row', progress: (f) => ({ have: f.streakDays, need: 7 }) },
  { id: 'mots-20', kind: 'skill', fr: '20 mots', en: '20 words', how: 'Collect 20 words', progress: (f) => ({ have: f.wordsSeen, need: 20 }) },
  { id: 'habitue', kind: 'shop', fr: 'Habitué du marché', en: 'Market regular', how: 'Pay 5 orders at the market', progress: (f) => ({ have: f.passport.placeOrders.marche ?? 0, need: 5 }) },
  { id: 'accent', kind: 'skill', fr: 'Bel accent', en: 'Lovely accent', how: 'Score 90+ saying a phrase', progress: (f) => ({ have: f.passport.bestPron >= 90 ? 1 : 0, need: 1 }) },
  { id: 'niveau-a2', kind: 'skill', fr: 'Niveau A2', en: 'Level A2', how: `Reach A2 (${A2_XP} XP)`, progress: (f) => ({ have: levelFor(f.xp).index >= 3 ? 1 : 0, need: 1 }) },
];

/** Stamp slots on the passport panel (public/ui/passport.uikitml: st-0 .. st-15, 4 rows of 4). */
export const STAMP_SLOTS = 16;

export function stampById(id: string): Stamp | undefined {
  return STAMPS.find((s) => s.id === id);
}

function met(s: Stamp, f: StampFacts): boolean {
  const p = s.progress(f);
  return p.have >= p.need;
}

/** Stamps whose requirement is met but not yet in the passport. */
export function dueStamps(f: StampFacts): string[] {
  return STAMPS.filter((s) => !f.passport.stamps[s.id] && met(s, f)).map((s) => s.id);
}

/** Put the due stamps in the passport (dated today). Returns the new ids. */
export function collectStamps(f: StampFacts, today: Day): string[] {
  const fresh = dueStamps(f);
  for (const id of fresh) f.passport.stamps[id] = today;
  return fresh;
}

/** The locked stamp closest to done (highest have/need), for "Prochain tampon". */
export function nextStamp(f: StampFacts): { stamp: Stamp; have: number; need: number } | null {
  let best: { stamp: Stamp; have: number; need: number } | null = null;
  let bestRatio = -1;
  for (const s of STAMPS) {
    if (f.passport.stamps[s.id]) continue;
    const p = s.progress(f);
    const ratio = Math.min(1, p.have / p.need);
    if (ratio > bestRatio) {
      best = { stamp: s, have: Math.min(p.have, p.need), need: p.need };
      bestRatio = ratio;
    }
  }
  return best;
}

/** Record a paid order in the passport counters. */
export function notePurchase(pp: PassportProgress, place: string, lines: { itemId: string; qty: number }[], exact: boolean): void {
  pp.placeOrders[place] = (pp.placeOrders[place] ?? 0) + 1;
  for (const l of lines) if (l.itemId === 'croissant') pp.croissants += l.qty;
  if (exact) pp.exactPayments += 1;
}

/** "12/11" for a stamp date. */
export function stampDate(day: Day): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}
