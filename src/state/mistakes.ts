/**
 * Mistake memory: concrete learner errors the shopkeeper deliberately reuses
 * ("deux" heard as "douze", 2,00 € handed over for 3,40 €, a word scored low,
 * an item asked for in the wrong shop). Pure functions over a small bounded
 * list stored in the profile.
 */

import { normalizeFrench } from '../voice/pronunciation.js';
import type { Day } from './dates.js';

export type MistakeKind = 'quantity' | 'payment' | 'pronunciation' | 'unknown_item';

export interface Mistake {
  kind: MistakeKind;
  /** What was right ("deux", "3,40 €", "croissant", "pain au chocolat"). */
  want: string;
  /** What the learner said or did ("douze", "2,00 €"; '' when not applicable). */
  got: string;
  count: number;
  last: Day;
}

/** Bounded: the oldest, least repeated mistakes drop off first. */
export const MAX_MISTAKES = 12;

const clean = (s: string) => s.trim().slice(0, 28);

/** Record (or repeat) a mistake. Mutates and returns `list`. */
export function recordMistake(list: Mistake[], m: { kind: MistakeKind; want: string; got: string }, day: Day): Mistake[] {
  const want = clean(m.want);
  const got = clean(m.got);
  if (!want || want === got) return list;
  const hit = list.find((x) => x.kind === m.kind && x.want === want && x.got === got);
  if (hit) {
    hit.count += 1;
    hit.last = day;
  } else {
    list.push({ kind: m.kind, want, got, count: 1, last: day });
  }
  if (list.length > MAX_MISTAKES) {
    list.sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
    list.length = MAX_MISTAKES;
  }
  return list;
}

/** The learner got `want` right: the matching mistakes fade (removed at 0). */
export function easeMistake(list: Mistake[], want: string): Mistake[] {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].want !== want) continue;
    list[i].count -= 1;
    if (list[i].count <= 0) list.splice(i, 1);
  }
  return list;
}

/** Most repeated, then most recent. Does not mutate. */
export function topMistakes(list: readonly Mistake[], n = 3): Mistake[] {
  return [...list].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)).slice(0, n);
}

/** Compact form for the AI prompt: "quantity:deux≠douze". */
export function mistakeForPrompt(m: Mistake): string {
  return m.got ? `${m.kind}:${m.want}≠${m.got}` : `${m.kind}:${m.want}`;
}

/** The visible one-liner after "Lune note :" (short, no wall of text). */
export function mistakeNote(m: Mistake): string {
  switch (m.kind) {
    case 'unknown_item':
      return `pas de ${m.want} ici`;
    case 'pronunciation':
      return `« ${m.want} » à travailler`;
    default:
      return `${m.want} ≠ ${m.got}`;
  }
}

// ---- Detectors (pure) ---------------------------------------------------------

/** French number words 1 to 20 (normalized), the ones learners mix up. */
export const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20,
};

const NUMBER_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(NUMBER_WORDS).filter(([w]) => w !== 'une').map(([w, n]) => [n, w]),
);

export function numberWord(n: number): string {
  return NUMBER_NAME[n] ?? String(n);
}

/** First number word in a phrase, ignoring "un/une" used as an article before a non-number. */
function firstNumber(text: string): { word: string; value: number } | null {
  for (const w of normalizeFrench(text).split(' ')) {
    const v = NUMBER_WORDS[w];
    if (v !== undefined) return { word: w === 'une' ? 'un' : w, value: v };
  }
  return null;
}

/**
 * The learner tried to say `target` (a suggested reply) and was heard as
 * `heard`: did a number come out as a different number? ("deux" -> "douze").
 */
export function numberConfusion(target: string, heard: string): { want: string; got: string } | null {
  const t = firstNumber(target);
  const h = firstNumber(heard);
  if (!t || !h || t.value === h.value) return null;
  return { want: numberWord(t.value), got: numberWord(h.value) };
}

/**
 * Fingers and words disagree: three fingers up while saying "deux". The
 * fingers are the intent (they are hard to get wrong); the word is the slip.
 */
export function fingersConfusion(text: string, fingers: number): { want: string; got: string } | null {
  if (!(fingers >= 1 && fingers <= 5)) return null;
  const h = firstNumber(text);
  if (!h || h.value === fingers || h.value === 1) return null; // "un café" with 2 fingers is ambiguous
  return { want: numberWord(fingers), got: numberWord(h.value) };
}
