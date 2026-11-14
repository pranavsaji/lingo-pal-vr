/**
 * "Vraie vie" (real-life) mode: the graduation from training wheels.
 *
 * The shopkeepers speak natural Parisian French at a normal pace, the English
 * translation and the three reply chips are hidden (a "Traduire" and an "Aide"
 * button bring them back, counted as help), the coach's hints become
 * in-character prompts, and each visit has exactly one realistic curveball
 * ("Sur place ou à emporter ?") from the shop's list in shared/places.json.
 * Paying an order with no help earns "Bravo, vous parlez comme à Paris !".
 *
 * Pure logic only (no World, no DOM): the director, the offline script, the
 * coach and the chat panel share it, and tests drive it directly.
 */

import type { PlaceId } from '../game-state.js';
import type { Profile, Settings } from '../state/profile.js';
import { normalizeFrench } from '../voice/pronunciation.js';
import { parseIntent } from './intent.js';
import { PLACES, priceToEnglish, priceToFrench, type Curveball } from './menu.js';
import type { AgentRequest, AgentTurn, CurveStage, ReplyOption } from './protocol.js';

// ---- Curveballs ------------------------------------------------------------------

export function curveballsFor(place: string): Curveball[] {
  return PLACES[place as PlaceId]?.realLife ?? [];
}

/** This visit's curveball (`roll` in [0, 1)). */
export function pickCurveball(place: string, roll: number): Curveball | null {
  const list = curveballsFor(place);
  if (!list.length) return null;
  return list[Math.max(0, Math.min(list.length - 1, Math.floor(roll * list.length)))];
}

export function findCurveball(place: string, fr: string): Curveball | undefined {
  return fr ? curveballsFor(place).find((c) => c.fr === fr) : undefined;
}

/** The learner's words answer the curveball ("à emporter", "sur place", "A, L, E, X"). */
export function curveballAnswered(cb: Curveball, text: string): boolean {
  const n = normalizeFrench(text);
  if (!n) return false;
  const padded = ` ${n} `;
  return cb.accept.some((a) => (a === '#spell' ? n.split(' ').filter((t) => /^[a-z]$/.test(t)).length >= 3 : padded.includes(` ${a} `)));
}

/** Words too common to show that she asked a given question. */
const COMMON = new Set(['vous', 'votre', 'avez', 'voulez', 'etes', 'pour', 'avec', 'dans', 'cest', 'quoi', 'merci', 'plait']);

/** Her line asked the curveball (exactly, or most of its key words when she rephrased it). */
export function askedCurveball(cb: Curveball, line: string): boolean {
  const want = normalizeFrench(cb.fr);
  const got = ` ${normalizeFrench(line)} `;
  if (got.includes(` ${want} `)) return true;
  const keys = want.split(' ').filter((w) => w.length >= 4 && !COMMON.has(w));
  if (keys.length < 2) return false;
  return keys.filter((w) => got.includes(` ${w} `)).length / keys.length >= 0.6;
}

/** "Plus lentement", "moins vite": the one request that slows her down (one line). */
export function asksSlower(text: string): boolean {
  return /\b(plus lentement|moins vite|lentement|slower|slow down|slowly)\b/.test(normalizeFrench(text));
}

/** "Vous pouvez répéter ?", or just "Pardon ?" / "Comment ?" (not "Pardon, un café"). */
export function asksRepeat(text: string): boolean {
  const n = normalizeFrench(text);
  return /\b(repeter|repete|repetez|encore une fois|repeat|say that again)\b/.test(n) || /^(pardon|comment|hein|quoi)( madame| monsieur)?$/.test(n);
}

/**
 * The curveball's next stage after a turn. `said`: what the learner said this
 * turn (null when they did not speak). Asking her to slow down or repeat is not
 * an answer. One retry, then she moves on.
 */
export function advanceCurveball(stage: CurveStage, said: string | null, herLine: string, cb: Curveball): CurveStage {
  let s = stage;
  if (said !== null && (s === 'asked' || s === 'again') && !asksSlower(said) && !asksRepeat(said)) {
    s = curveballAnswered(cb, said) ? 'done' : s === 'asked' ? 'again' : 'done';
  }
  if (s === 'todo' && askedCurveball(cb, herLine)) s = 'asked';
  return s;
}

// ---- Invitation (once, after the 5th paid order) --------------------------------

export const INVITE_AFTER_ORDERS = 5;

export function invitationDue(p: Pick<Profile, 'onboarded' | 'realLifeInvited' | 'settings' | 'stats'>): boolean {
  return p.onboarded && !p.realLifeInvited && !p.settings.realLife && p.stats.orders >= INVITE_AFTER_ORDERS;
}

export const INVITE = {
  fr: "Prêt pour la vraie vie ? Pas d'anglais, pas d'aide !",
  en: 'Ready for real life? No English, no help!',
  replies: [
    { fr: "Oui, c'est parti !", en: "Yes, let's go!" },
    { fr: 'Pas encore, merci.', en: 'Not yet, thanks.' },
    { fr: "C'est quoi, la vraie vie ?", en: 'What is real life?' },
  ] as ReplyOption[],
};

export type InviteAnswer = 'yes' | 'no' | 'what' | null;

export function acceptsInvite(text: string): InviteAnswer {
  const n = normalizeFrench(text);
  if (/\b(c est quoi|qu est ce que|comment ca marche|what is|what s)\b/.test(n)) return 'what';
  if (/^(non|pas encore|pas maintenant|plus tard|une autre fois|not yet|no)\b/.test(n)) return 'no';
  if (/^(oui|ouais|d accord|volontiers|avec plaisir|allons y|c est parti|pret|prete|je suis pret|bien sur|yes|ok)\b/.test(n) || /\bvraie vie\b/.test(n)) return 'yes';
  return null;
}

const replyTurn = (fr: string, en: string, replies: ReplyOption[], kind = 'nod'): AgentTurn => ({
  fr,
  en,
  replies,
  actions: [{ type: 'emote', kind }],
  points: 0,
  source: 'script',
});

const AFTER_INVITE: ReplyOption[] = [
  { fr: 'Merci, au revoir !', en: 'Thanks, goodbye!' },
  { fr: 'À demain !', en: 'See you tomorrow!' },
  { fr: 'Je voudrais autre chose.', en: 'I would like something else.' },
];

export function inviteReply(a: Exclude<InviteAnswer, null>): AgentTurn {
  if (a === 'yes') return replyTurn("C'est parti ! À partir de maintenant, c'est comme à Paris.", "Here we go! From now on, it's just like Paris.", AFTER_INVITE, 'clap');
  if (a === 'no') return replyTurn('Pas de souci ! Quand vous voulez, dites « vraie vie ».', 'No worries! Whenever you like, say "vraie vie".', AFTER_INVITE);
  return replyTurn(
    'Comme à Paris : je parle normalement, sans anglais, sans aide. On essaie ?',
    'Like in Paris: I speak normally, no English, no help. Shall we try?',
    INVITE.replies.slice(0, 2).concat({ fr: "Pardon, vous pouvez répéter plus lentement ?", en: 'Sorry, can you repeat more slowly?' }),
    'think',
  );
}

/** Paid with no help: "comme un vrai Parisien" when the learner's gender is known, else neutral. */
export function celebration(memories: Record<string, string>): { fr: string; en: string } {
  const g = normalizeFrench(memories.gender ?? '');
  if (/^(f|femme|female|woman)$/.test(g)) return { fr: 'Bravo, comme une vraie Parisienne !', en: 'Bravo, just like a real Parisian!' };
  if (/^(m|homme|male|man)$/.test(g)) return { fr: 'Bravo, comme un vrai Parisien !', en: 'Bravo, just like a real Parisian!' };
  return { fr: 'Bravo, vous parlez comme à Paris !', en: 'Bravo, you speak like they do in Paris!' };
}

// ---- Chat panel gating --------------------------------------------------------------

export interface ChatGate {
  /** English under her line. */
  english: boolean;
  /** The three reply chips. */
  chips: boolean;
  /** English under each chip. */
  chipEnglish: boolean;
  /** The "Traduire" button. */
  translateButton: boolean;
  /** The "Aide" button. */
  aideButton: boolean;
  /** "VRAIE VIE" badge in the chat header. */
  badge: boolean;
}

/**
 * What the chat panel shows. Real-life mode hides English (unless "Traduire")
 * and the chips (unless "Aide"). Eyes-only learners keep the chips, their input
 * method, but still without English. French text is never hidden.
 */
export function chatGate(s: Pick<Settings, 'realLife' | 'subtitles' | 'gazeDwell'>, reveal: { translated: boolean; aide: boolean }): ChatGate {
  if (!s.realLife) {
    return { english: s.subtitles || reveal.translated, chips: true, chipEnglish: true, translateButton: false, aideButton: false, badge: false };
  }
  const chips = s.gazeDwell || reveal.aide;
  return { english: reveal.translated, chips, chipEnglish: reveal.aide, translateButton: !reveal.translated, aideButton: !chips, badge: true };
}

// ---- Offline script in real-life mode ------------------------------------------------

/** Teaching phrasing -> what a Paris shopkeeper actually says. */
const NATURAL: [RegExp, string][] = [
  [/Autre chose \?/g, 'Et avec ceci ?'],
  [/^Ça fait /, 'Ça vous fait '],
  [/ Posez (?:les pièces|votre carte) sur le plateau\./g, ''],
  [/ ?(?:Petit rappel|On répète ensemble|Aujourd'hui, on compte bien)[^!.?]*[!.?]/g, ''],
];
const NATURAL_EN: [RegExp, string][] = [
  [/Anything else\?/g, 'Anything else with that?'],
  [/ Put (?:the coins|your card) on the tray\./g, ''],
  [/ ?(?:Quick reminder|Let's practise together|Today, let's count)[^!.?]*[!.?]/g, ''],
];

function natural(t: AgentTurn): AgentTurn {
  let fr = t.fr;
  let en = t.en;
  for (const [re, s] of NATURAL) fr = fr.replace(re, s);
  for (const [re, s] of NATURAL_EN) en = en.replace(re, s);
  return { ...t, fr: fr.trim(), en: en.trim() };
}

/** The last sentence of a line: the simpler repeat ("Voilà un croissant ! Sur place ou à emporter ?" -> the question). */
export function simpler(line: string): string {
  const parts = line.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  return (parts[parts.length - 1] ?? line).trim();
}

const ACTIONABLE = new Set(['order', 'ask_price', 'done_ordering', 'pay', 'bye', 'name']);
const unsure = (t: AgentTurn) => /^Pardon \?/.test(t.fr);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What she says to keep things moving, by phase. */
function carryOn(req: AgentRequest): { fr: string; en: string } {
  const s = req.scene;
  if (s.phase === 'ordering') return { fr: 'Et avec ceci ?', en: 'Anything else with that?' };
  if (s.phase === 'paying') {
    const due = Math.max(0, s.totalCents - s.trayCents);
    return { fr: `Ça vous fait ${priceToFrench(due)}.`, en: `That comes to ${priceToEnglish(due)}.` };
  }
  if (s.phase === 'paid') return { fr: 'Bonne journée !', en: 'Have a nice day!' };
  return { fr: "Qu'est-ce que je vous sers ?", en: 'What can I get you?' };
}

/** Ask the curveball at the end of her line (instead of "Et avec ceci ?"). */
function ask(t: AgentTurn, cb: Curveball): AgentTurn {
  const fr = t.fr.replace(/\s*Et avec ceci \?$/, '');
  const en = t.en.replace(/\s*Anything else with that\?$/, '');
  return { ...t, fr: `${fr} ${cb.fr}`.trim(), en: `${en} ${cb.en}`.trim(), replies: cb.replies };
}

/**
 * The offline script in real-life mode: French-only phrasing, one curveball per
 * visit with simple answer checking (any accepted answer works; anything else:
 * she asks once more, then moves on), and "plus lentement" repeats her last
 * line, simpler. `base` is the regular script (src/agent/script.ts).
 */
export function realLifeScripted(req: AgentRequest, base: (r: AgentRequest) => AgentTurn): AgentTurn {
  const rl = req.scene.realLife;
  const e = req.event;
  if (!rl) return base(req);
  const name = req.profile.name ? `, ${req.profile.name}` : '';

  if (e.kind === 'arrive') {
    const t = base(req);
    if (req.scene.place === 'hotel' || !req.profile.name) return natural(t);
    return req.scene.place === 'cafe'
      ? { ...t, fr: `Bonjour${name} ! Qu'est-ce que je vous sers ?`, en: `Hello${name}! What can I get you?` }
      : { ...t, fr: `Bonjour${name} ! Je vous écoute.`, en: `Hello${name}! I'm listening.` };
  }
  if (e.kind === 'idle') return { ...base(req), fr: 'Je vous écoute ?', en: "I'm listening?" };

  const cb = findCurveball(req.scene.place, rl.curveball);
  if (e.kind === 'say' && (asksSlower(e.text) || asksRepeat(e.text))) {
    const last = [...req.history].reverse().find((h) => h.role === 'lune')?.text;
    if (last) {
      const again = simpler(last);
      const pending = cb && (rl.stage === 'asked' || rl.stage === 'again') && askedCurveball(cb, again);
      return {
        ...base({ ...req, event: { kind: 'idle' } }),
        fr: asksSlower(e.text) ? `Bien sûr. ${again}` : again,
        en: 'Of course. (She says it again, more simply.)',
        actions: [{ type: 'emote', kind: 'nod' }],
        points: 2,
        ...(pending ? { replies: cb.replies } : {}),
      };
    }
  }

  const t = natural(base(req));
  if (!cb) return t;
  if (e.kind === 'say' && (rl.stage === 'asked' || rl.stage === 'again')) {
    const acts = ACTIONABLE.has(parseIntent(e.text, e.fingers).kind) && !unsure(t);
    const go = carryOn(req);
    if (curveballAnswered(cb, e.text)) {
      if (acts) return { ...t, fr: `${cb.ok.fr} ${t.fr}`, en: `${cb.ok.en} ${t.en}`, points: t.points + 5 };
      return { ...t, fr: `${cb.ok.fr} ${go.fr}`, en: `${cb.ok.en} ${go.en}`, actions: [{ type: 'emote', kind: 'nod' }], points: 10 };
    }
    if (rl.stage === 'asked') {
      if (acts) return { ...t, fr: `${t.fr} Et sinon, ${lower(cb.fr)}`, en: `${t.en} And otherwise: ${cb.en}`, replies: cb.replies };
      return { ...t, fr: `Pardon ? ${cb.fr}`, en: `Sorry? ${cb.en}`, actions: [{ type: 'emote', kind: 'think' }], points: 0, replies: cb.replies };
    }
    // Second miss: let it go and carry on.
    if (acts) return t;
    return { ...t, fr: `Bon, pas grave. ${go.fr}`, en: `Well, never mind. ${go.en}`, actions: [{ type: 'emote', kind: 'shrug' }], points: 0 };
  }
  // Ask it once, right after serving the first items (not over a pending offer).
  const served = t.actions.some((a) => (a as { type?: string }).type === 'serve_items');
  const offering = t.actions.some((a) => (a as { type?: string }).type === 'offer');
  if (rl.stage === 'todo' && e.kind === 'say' && served && !offering) return ask(t, cb);
  return t;
}
