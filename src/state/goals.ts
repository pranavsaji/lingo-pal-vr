/**
 * The longer arc and the reasons to come back tomorrow. Pure functions:
 * - goalLadder: A1 -> A2 progress with the next rung.
 * - tomorrowHook: one short teaser for tomorrow (next unlock + tomorrow's list).
 * - returnMoment: the "Bon retour !" line summarizing what changed since last visit.
 */

import { numberToFrench, PLACES, quantityPhrase, quantityPhraseEn } from '../agent/menu.js';
import { addDays, daySeed, type Day } from './dates.js';
import { stampById, type PassportProgress } from './passport.js';
import { levelFor, LEVELS, UNLOCKS, type Unlock } from './progression.js';
import { dailyQuest } from './quest.js';

const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- goal ladder -------------------------------------------------------------

export interface GoalLadder {
  /** "A1 > A2" (or "A2 > A2.2" once A2 is reached). */
  label: string;
  /** 0 to 1 toward the big goal. */
  progress: number;
  rungs: { id: string; reached: boolean; current: boolean }[];
  /** The next rung and the XP still needed (null at the top). */
  next: { id: string; xpToNext: number } | null;
}

export function goalLadder(xp: number): GoalLadder {
  const lvl = levelFor(xp);
  const a2 = LEVELS.findIndex((l) => l.id.startsWith('A2'));
  const goalIndex = lvl.index < a2 ? a2 : LEVELS.length - 1;
  const goal = LEVELS[goalIndex];
  const startXp = lvl.index < a2 ? 0 : LEVELS[a2].minXp;
  const progress = goal.minXp > startXp ? Math.min(1, Math.max(0, (xp - startXp) / (goal.minXp - startXp))) : 1;
  return {
    label: lvl.index < a2 ? 'A1 > A2' : `A2 > ${goal.id}`,
    progress: lvl.next ? progress : 1,
    rungs: LEVELS.map((l, i) => ({ id: l.id, reached: i <= lvl.index, current: i === lvl.index })),
    next: lvl.next ? { id: lvl.next, xpToNext: lvl.xpToNext } : null,
  };
}

// ---- tomorrow hook ----------------------------------------------------------

export interface HookInputs {
  xp: number;
  streakDays: number;
  orders: number;
  unlocks: string[];
  passport: PassportProgress;
  today: Day;
}

export interface Line {
  fr: string;
  en: string;
}

const AT: Record<string, Line> = {
  cafe: { fr: 'au café', en: 'at the café' },
  boulangerie: { fr: 'à la boulangerie', en: 'at the bakery' },
  marche: { fr: 'au marché', en: 'at the market' },
};

/** How far an unlock still is, in rough "visits" (for picking the nearest goal), and its line. */
function remaining(u: Unlock, h: HookInputs): { visits: number; line: Line } | null {
  const lvl = levelFor(h.xp);
  if (u.streak !== undefined && h.streakDays < u.streak) {
    const d = u.streak - h.streakDays;
    return { visits: d, line: { fr: `Plus que ${s(d, 'jour')} pour ${u.fr}`, en: `${s(d, 'more day')} for ${u.en}` } };
  }
  if (u.level !== undefined && lvl.index < u.level) {
    const need = (LEVELS[u.level]?.minXp ?? 0) - h.xp;
    return { visits: need / 80, line: { fr: `Encore ${need} XP pour ${u.fr}`, en: `${need} more XP for ${u.en}` } };
  }
  if (u.orders !== undefined && h.orders < u.orders) {
    const n = u.orders - h.orders;
    return { visits: n / 2, line: { fr: `Encore ${s(n, 'commande')} pour ${u.fr}`, en: `${s(n, 'more order')} for ${u.en}` } };
  }
  if (u.stamps !== undefined) {
    const have = Object.keys(h.passport.stamps).length;
    if (have < u.stamps) {
      const n = u.stamps - have;
      return { visits: n, line: { fr: `Encore ${s(n, 'tampon')} pour ${u.fr}`, en: `${s(n, 'more stamp')} for ${u.en}` } };
    }
  }
  if (u.placeOrders !== undefined) {
    const have = h.passport.placeOrders[u.placeOrders.place] ?? 0;
    if (have < u.placeOrders.count) {
      const n = u.placeOrders.count - have;
      const at = AT[u.placeOrders.place] ?? AT.cafe;
      return { visits: n / 2, line: { fr: `Encore ${s(n, 'commande')} ${at.fr} pour ${u.fr}`, en: `${s(n, 'more order')} ${at.en} for ${u.en}` } };
    }
  }
  return null;
}

/** The nearest thing still to unlock ("Encore 40 XP pour la terrasse"), or the next level. */
export function nextGoal(h: HookInputs): Line | null {
  let best: { visits: number; line: Line } | null = null;
  for (const u of UNLOCKS) {
    if (h.unlocks.includes(u.id)) continue;
    const r = remaining(u, h);
    if (r && (!best || r.visits < best.visits)) best = r;
  }
  if (best) return best.line;
  const lvl = levelFor(h.xp);
  return lvl.next ? { fr: `Encore ${lvl.xpToNext} XP pour ${lvl.next}`, en: `${lvl.xpToNext} more XP to ${lvl.next}` } : null;
}

/** One item from tomorrow's shopping list ("Demain : deux baguettes à la boulangerie ?"). */
export function tomorrowList(today: Day): Line {
  const tomorrow = addDays(today, 1);
  const q = dailyQuest(tomorrow);
  const t = q.tasks[daySeed(tomorrow) % q.tasks.length];
  const item = PLACES[t.place]?.menu.find((m) => m.id === t.itemId);
  const at = AT[t.place] ?? AT.cafe;
  if (!item) return { fr: 'Demain : une nouvelle liste', en: 'Tomorrow: a new list' };
  return { fr: `Demain : ${quantityPhrase(item, t.qty)} ${at.fr} ?`, en: `Tomorrow: ${quantityPhraseEn(item, t.qty)} ${at.en}?` };
}

/** Short teaser for tomorrow: tomorrow's list item plus the nearest goal. */
export function tomorrowHook(h: HookInputs): Line {
  const list = tomorrowList(h.today);
  const goal = nextGoal(h);
  return goal ? { fr: `${list.fr} ${goal.fr}.`, en: `${list.en} ${goal.en}.` } : list;
}

// ---- return moment ----------------------------------------------------------

export interface ReturnInputs {
  name: string;
  onboarded: boolean;
  sessions: number;
  isNewDay: boolean;
  broken: boolean;
  streakDays: number;
  restUsed: Day[];
  restEarned: boolean;
  newStamps: string[];
  newUnlocks: string[];
  /** SRS words due today. */
  due: number;
}

export interface ReturnMoment {
  /** Panel title ("Bon retour, Alex !"). */
  title: string;
  /** One short line of what changed, French and English. */
  line: Line;
  /** What Madame Lune says (French) with its translation. */
  voice: Line;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "Bon retour !" for the first visit of a new day (null on a same-day reload or a first visit). */
export function returnMoment(r: ReturnInputs): ReturnMoment | null {
  if (!r.onboarded || r.sessions <= 1 || !r.isNewDay) return null;
  const fr: string[] = [];
  const en: string[] = [];
  const vfr: string[] = [`Bon retour${r.name ? `, ${r.name}` : ''} !`];
  const ven: string[] = [`Welcome back${r.name ? `, ${r.name}` : ''}!`];

  if (r.restUsed.length) {
    fr.push(`Série sauvée (${s(r.restUsed.length, 'jour')} de repos)`);
    en.push(`Streak saved by ${s(r.restUsed.length, 'rest day')}`);
    vfr.push('Votre jour de repos a sauvé votre série.');
    ven.push('Your rest day saved your streak.');
  } else if (r.broken) {
    fr.push('Nouvelle série');
    en.push('A fresh streak');
    vfr.push("On recommence une série aujourd'hui.");
    ven.push('We start a new streak today.');
  } else if (r.streakDays >= 2) {
    fr.push(`${r.streakDays} jours de suite`);
    en.push(`${r.streakDays} days in a row`);
    vfr.push(`${cap(numberToFrench(Math.min(r.streakDays, 9999)))} jours de suite, bravo !`);
    ven.push(`${r.streakDays} days in a row, well done!`);
  }
  if (r.restEarned) {
    fr.push('+1 jour de repos');
    en.push('+1 rest day');
  }
  const stamp = r.newStamps.length ? stampById(r.newStamps[0]) : undefined;
  if (stamp) {
    fr.push(r.newStamps.length > 1 ? `${r.newStamps.length} nouveaux tampons` : `Tampon : ${stamp.fr}`);
    en.push(r.newStamps.length > 1 ? `${r.newStamps.length} new stamps` : `Stamp: ${stamp.en}`);
    vfr.push('Un nouveau tampon dans votre passeport !');
    ven.push('A new stamp in your passport!');
  }
  if (r.due > 0) {
    fr.push(`${s(r.due, 'mot')} à réviser`);
    en.push(`${s(r.due, 'word')} to review`);
    vfr.push(`${cap(numberToFrench(Math.min(r.due, 9999)))} ${r.due === 1 ? 'mot vous attend' : 'mots vous attendent'} dans le carnet.`);
    ven.push(`${s(r.due, 'word')} ${r.due === 1 ? 'is' : 'are'} waiting in your notebook.`);
  }
  const unlock = r.newUnlocks.length ? UNLOCKS.find((u) => u.id === r.newUnlocks[0]) : undefined;
  // The room shows new decor by itself; the line names it only if there is room (one short line).
  if (unlock && fr.length < 4) {
    fr.push(`Nouveau : ${unlock.fr}`);
    en.push(`New: ${unlock.en}`);
    if (!stamp) {
      vfr.push(`Regardez : ${unlock.fr} !`);
      ven.push(`Look: ${unlock.en}!`);
    }
  }
  return {
    title: `Bon retour${r.name ? `, ${r.name}` : ''} !`,
    line: { fr: fr.join(' · '), en: en.join(' · ') },
    voice: { fr: vfr.slice(0, 3).join(' '), en: ven.slice(0, 3).join(' ') },
  };
}
