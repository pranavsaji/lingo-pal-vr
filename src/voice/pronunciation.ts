/**
 * Compare what the learner said (speech-to-text transcript) with the phrase
 * they were trying to say. Word-level alignment with fuzzy matching gives a
 * 0 to 100 score plus per-word status for green/orange/red highlighting.
 */

import { spellOutNumbers } from '../agent/menu.js';

/** Digits become words, lowercase, strip accents and punctuation, split elisions ("s'il" -> "s il"). */
export function normalizeFrench(text: string): string {
  return spellOutNumbers(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[’'`-]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  const n = normalizeFrench(text);
  return n ? n.split(' ') : [];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 1 for identical words, 0 for unrelated. */
export function wordSimilarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

export type WordStatus = 'ok' | 'close' | 'missed';

export interface PronunciationResult {
  score: number; // 0 to 100
  words: { word: string; status: WordStatus }[];
  /** Expected words in display form (accents kept) aligned with `words`. */
  heard: string;
}

const CLOSE = 0.6;
const OK = 0.85;

/**
 * Align expected words to heard words (LCS-style DP maximizing similarity),
 * so dropped or extra words do not shift every later word into "missed".
 */
export function scorePronunciation(expected: string, heard: string): PronunciationResult {
  const displayWords = expected.replace(/[’']/g, "' ").split(/\s+/).filter((w) => normalizeFrench(w).length > 0);
  const exp = displayWords.map((w) => normalizeFrench(w).replace(/ /g, ''));
  const got = words(heard);
  const n = exp.length;
  const m = got.length;
  // dp[i][j] = best total similarity aligning exp[0..i) with got[0..j)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = wordSimilarity(exp[i - 1], got[j - 1]);
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + (sim >= CLOSE ? sim : 0));
    }
  }
  const best = new Array<number>(n).fill(0);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const sim = wordSimilarity(exp[i - 1], got[j - 1]);
    if (sim >= CLOSE && dp[i][j] === dp[i - 1][j - 1] + sim) {
      best[i - 1] = sim;
      i--;
      j--;
    } else if (dp[i][j] === dp[i - 1][j]) i--;
    else j--;
  }
  const out = displayWords.map((word, k) => ({
    word,
    status: (best[k] >= OK ? 'ok' : best[k] >= CLOSE ? 'close' : 'missed') as WordStatus,
  }));
  const total = n === 0 ? 0 : best.reduce((a, b) => a + b, 0) / n;
  // Small penalty for lots of extra words (rambling or a wrong phrase).
  const extra = Math.max(0, m - n);
  const score = Math.max(0, Math.round(total * 100 - extra * 5));
  return { score, words: out, heard };
}
