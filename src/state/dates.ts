/**
 * Local calendar-day helpers. Streaks and spaced repetition are about the
 * learner's own day, so we use local dates (not UTC ISO strings).
 */

export type Day = string; // 'YYYY-MM-DD'

export function localDay(d: Date = new Date()): Day {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parse(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12); // noon avoids DST edges
}

export function addDays(day: Day, n: number): Day {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** Small deterministic hash so "today's special" is stable for the whole day. */
export function daySeed(day: Day): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
