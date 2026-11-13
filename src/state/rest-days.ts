/**
 * Jours de repos (streak protection). Every 7 days in a row earns one rest
 * day (at most MAX_REST in reserve). Coming back after missed days spends
 * rest days automatically, one per missed day, so the streak survives a busy
 * week. If there are not enough rest days the streak restarts and the reserve
 * is kept (it was earned). Pure functions over local calendar days.
 */

import { addDays, daysBetween, type Day } from './dates.js';
import { touchStreak } from './progression.js';

/** One rest day per this many days in a row. */
export const REST_EVERY = 7;
/** Rest days held in reserve at most. */
export const MAX_REST = 2;

export interface RestStreakResult {
  streakDays: number;
  lastPlayedDay: Day;
  /** First session of a new calendar day. */
  isNewDay: boolean;
  /** A streak of 2+ days was lost. */
  broken: boolean;
  /** Rest days left in reserve after this visit. */
  restDays: number;
  /** The missed days a rest day covered (oldest first; empty when none). */
  restUsed: Day[];
  /** A rest day was earned on this visit (the streak reached a multiple of 7). */
  restEarned: boolean;
}

/**
 * Like touchStreak, but missed days are covered from the rest-day reserve.
 * The streak counts days actually played: a covered gap keeps it alive, it
 * does not add the missed days.
 */
export function touchStreakWithRest(lastPlayedDay: Day, streakDays: number, restDays: number, today: Day): RestStreakResult {
  const reserve = Math.max(0, Math.min(MAX_REST, Math.floor(restDays) || 0));
  const gap = lastPlayedDay ? daysBetween(lastPlayedDay, today) : Infinity;
  const missed = gap - 1;
  let restUsed: Day[] = [];
  let next: { streakDays: number; lastPlayedDay: Day; isNewDay: boolean; broken: boolean };
  if (Number.isFinite(gap) && missed >= 1 && streakDays >= 1 && missed <= reserve) {
    restUsed = Array.from({ length: missed }, (_, i) => addDays(lastPlayedDay, i + 1));
    next = { streakDays: streakDays + 1, lastPlayedDay: today, isNewDay: true, broken: false };
  } else {
    next = touchStreak(lastPlayedDay, streakDays, today);
  }
  let left = reserve - restUsed.length;
  const restEarned = next.isNewDay && next.streakDays > 0 && next.streakDays % REST_EVERY === 0 && left < MAX_REST;
  if (restEarned) left += 1;
  return { ...next, restDays: left, restUsed, restEarned };
}

/** Days until the next rest day is earned (0 when the reserve is full). */
export function daysToNextRest(streakDays: number, restDays: number): number {
  if (restDays >= MAX_REST) return 0;
  const r = streakDays % REST_EVERY;
  return REST_EVERY - r;
}
