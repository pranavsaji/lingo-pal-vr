/**
 * Spaced repetition (SM-2 lite) over the word bank.
 * Grades: 0 again, 1 hard, 2 good, 3 easy. "Good" follows the ladder
 * 1, 3, 7, 14, 30, 60 days; ease (1.3 to 2.5) ranks the weakest words.
 */

import { addDays, daysBetween, type Day } from './dates.js';

export type Grade = 0 | 1 | 2 | 3;

export interface SrsCard {
  ease: number;
  reps: number; // successful reviews in a row
  intervalDays: number;
  due: Day;
  lapses: number;
}

export const LADDER = [1, 3, 7, 14, 30, 60] as const;
const MIN_EASE = 1.3;
const MAX_EASE = 2.5;

const clampEase = (e: number) => Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(e * 100) / 100));

export function newCard(today: Day): SrsCard {
  return { ease: MAX_EASE, reps: 0, intervalDays: 0, due: today, lapses: 0 };
}

export function review(card: SrsCard, grade: Grade, today: Day): SrsCard {
  if (grade === 0) {
    return { ease: clampEase(card.ease - 0.2), reps: 0, intervalDays: 1, due: addDays(today, 1), lapses: card.lapses + 1 };
  }
  let reps = card.reps;
  let ease = card.ease;
  if (grade === 1) {
    ease -= 0.15; // stay on the same rung
  } else if (grade === 2) {
    reps += 1;
  } else {
    reps += 2;
    ease += 0.1;
  }
  const rung = Math.min(LADDER.length - 1, Math.max(0, reps - 1));
  const intervalDays = grade === 1 ? Math.max(1, card.intervalDays || 1) : LADDER[rung];
  return { ease: clampEase(ease), reps, intervalDays, due: addDays(today, intervalDays), lapses: card.lapses };
}

/** Words due today or overdue, weakest (lowest ease, most overdue) first. */
export function dueWords(cards: Record<string, SrsCard>, today: Day, limit = 3): string[] {
  return Object.entries(cards)
    .filter(([, c]) => daysBetween(c.due, today) >= 0)
    .sort(([, a], [, b]) => a.ease - b.ease || daysBetween(b.due, a.due))
    .slice(0, limit)
    .map(([id]) => id);
}

/** 0 to 4 mastery dots for the Carnet panel. */
export function mastery(card: SrsCard | undefined): number {
  if (!card) return 0;
  return Math.min(4, card.reps);
}
