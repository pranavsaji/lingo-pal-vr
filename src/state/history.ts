/**
 * Daily activity log and the weekly progress report (Productivity: measurable
 * progress). Pure functions over plain JSON stored in the profile; kept to the
 * last 28 days.
 */

import { addDays, type Day } from './dates.js';

export interface DayLog {
  xp: number;
  /** Time in the app, seconds. */
  seconds: number;
  /** Words heard for the first time. */
  newWords: number;
  /** Orders paid. */
  orders: number;
  /** Pronunciation score sum and count (average = sum / count). */
  pronSum: number;
  pronCount: number;
  /** Orders paid in "vraie vie" mode with no help (older logs lack it). */
  realLife?: number;
}

export type History = Record<Day, DayLog>;

export const KEEP_DAYS = 28;

export function emptyLog(): DayLog {
  return { xp: 0, seconds: 0, newWords: 0, orders: 0, pronSum: 0, pronCount: 0 };
}

/** The log for `day`, created if missing. Older days are pruned. */
export function logFor(history: History, day: Day): DayLog {
  if (!history[day]) {
    history[day] = emptyLog();
    const oldest = addDays(day, -KEEP_DAYS);
    for (const d of Object.keys(history)) if (d < oldest) delete history[d];
  }
  return history[day];
}

/** French one-letter weekday labels, Monday first (L M M J V S D). */
const WEEKDAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export interface WeekReport {
  days: { day: Day; label: string; xp: number; minutes: number; isToday: boolean }[];
  totals: { xp: number; minutes: number; newWords: number; orders: number; activeDays: number; realLifeOrders: number };
  /** Average pronunciation this week (0 to 100), null if nothing was scored. */
  pronunciation: number | null;
  /** Same metric for the week before, for a trend arrow. */
  lastWeek: { xp: number; minutes: number; pronunciation: number | null };
  bestDay: { day: Day; label: string; xp: number } | null;
}

function weekday(day: Day): string {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
}

function summarize(history: History, days: Day[]) {
  let xp = 0, seconds = 0, newWords = 0, orders = 0, pronSum = 0, pronCount = 0, activeDays = 0, realLifeOrders = 0;
  for (const d of days) {
    const l = history[d];
    if (!l) continue;
    xp += l.xp;
    seconds += l.seconds;
    newWords += l.newWords;
    orders += l.orders;
    pronSum += l.pronSum;
    pronCount += l.pronCount;
    realLifeOrders += l.realLife ?? 0;
    if (l.xp > 0 || l.seconds >= 60) activeDays++;
  }
  return { xp, minutes: Math.round(seconds / 60), newWords, orders, activeDays, realLifeOrders, pronunciation: pronCount ? Math.round(pronSum / pronCount) : null };
}

/** The last seven days ending today, plus the seven before for comparison. */
export function weekReport(history: History, today: Day): WeekReport {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const prev = Array.from({ length: 7 }, (_, i) => addDays(today, i - 13));
  const now = summarize(history, days);
  const before = summarize(history, prev);
  const rows = days.map((day) => ({
    day,
    label: weekday(day),
    xp: history[day]?.xp ?? 0,
    minutes: Math.round((history[day]?.seconds ?? 0) / 60),
    isToday: day === today,
  }));
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (r.xp > (b?.xp ?? 0) ? r : b), null);
  return {
    days: rows,
    totals: { xp: now.xp, minutes: now.minutes, newWords: now.newWords, orders: now.orders, activeDays: now.activeDays, realLifeOrders: now.realLifeOrders },
    pronunciation: now.pronunciation,
    lastWeek: { xp: before.xp, minutes: before.minutes, pronunciation: before.pronunciation },
    bestDay: best ? { day: best.day, label: best.label, xp: best.xp } : null,
  };
}
