/**
 * Pal's head: everything the English-speaking companion decides without a
 * model call. The shopkeepers only speak French; Pal speaks English and helps.
 *
 *  - who counts as a beginner, and when "sounds like" lines are shown;
 *  - which French-recognizer transcripts are really meant for Pal ("Pal",
 *    "help me", "how do I say ...", plain English questions);
 *  - the offline helper (no key, API down): keyword intents -> English, the
 *    French line to say, and how it sounds; never a dead end;
 *  - local lines: the introduction, "what did she say?", proactive hints;
 *  - the request sent to /api/agent in `mode: 'pal'` and the answer check.
 *
 * Pure: no World, no DOM. Pal never takes world actions: an answer is only
 * text (en / fr / sounds / tip), so nothing here can serve, pay or change an order.
 */

import type { PlaceId } from '../game-state.js';
import { PLACES, priceToEnglish, priceToFrench, quantityPhrase, quantityPhraseEn, type MenuItem } from '../agent/menu.js';
import type { AgentTurn, ReplyOption } from '../agent/protocol.js';
import { definite } from '../agent/script.js';
import type { OrderLine, OrderPhase } from '../agent/tools.js';
import { soundsLike } from './sounds-like.js';

export interface PalAnswer {
  /** What Pal says aloud, in plain English (always subtitled). */
  en: string;
  /** The French line to say to the shopkeeper ('' when none). */
  fr: string;
  /** fr respelled for an English speaker ('' when no fr). */
  sounds: string;
  /** Optional short tip ('' when none). */
  tip: string;
  source: 'ai' | 'local';
}

export interface PalContext {
  place: PlaceId;
  phase: OrderPhase;
  order: OrderLine[];
  totalCents: number;
  /** The shopkeeper's last line (null before she spoke). */
  lastLine: { fr: string; en: string } | null;
  /** The reply chips on screen. */
  replies: ReplyOption[];
  realLife: boolean;
  name: string;
}

// ---- Who gets the training wheels ------------------------------------------------

/** First three sessions, or still at level A1. */
export function isBeginner(p: { sessions: number }, levelId: string): boolean {
  return p.sessions <= 3 || !levelId || levelId.startsWith('A1');
}

/**
 * Sounds-like lines under the chips: for beginners or with "Pronunciation help"
 * on (default), never in "vraie vie" unless the learner revealed the chips ("Aide").
 */
export function showSoundsLike(s: { pronunciationHelp: boolean; realLife: boolean }, beginner: boolean, aide = false): boolean {
  if (s.realLife && !aide) return false;
  return beginner || s.pronunciationHelp;
}

/** Pal introduces itself once: after the first-run tutorial, at the next shopkeeper line. */
export function palIntroDue(p: { palIntroduced: boolean; onboarded: boolean }, tutorialRunning: boolean): boolean {
  return !p.palIntroduced && p.onboarded && !tutorialRunning;
}

/** Proactive Pal (a short local English hint when the coach would hint): beginners outside "vraie vie". */
export function shouldPalHint(c: { beginner: boolean; realLife: boolean; introduced: boolean; palBusy: boolean }): boolean {
  return c.beginner && !c.realLife && c.introduced && !c.palBusy;
}

// ---- Transcripts meant for Pal ----------------------------------------------------

const lower = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const EN_MARKERS = /\b(how|what|what's|whats|do|does|did|i|i'm|is|the|can|say|said|mean|means|she|he|you|my|want|would|like|much|please|help|thanks|thank|where|which|this|that's|should)\b/g;
const FR_MARKERS = /\b(je|vous|est|c'est|merci|bonjour|s'il|plait|un|une|des|le|la|les|voila|oui|non|combien|voudrais|madame|monsieur|avec)\b/g;

/** Mostly English words and no French ones: a question for Pal, not a line for the shopkeeper. */
export function looksEnglish(text: string): boolean {
  const n = lower(text);
  const words = n.split(' ').filter(Boolean).length;
  if (words < 3) return false;
  const en = n.match(EN_MARKERS)?.length ?? 0;
  const fr = n.match(FR_MARKERS)?.length ?? 0;
  return en >= 2 && en > fr * 2;
}

/**
 * What the French recognizer heard, for Pal: 'listen' (call Pal: "Pal", "help me"),
 * { ask } (a question to answer now), or null (a line for the shopkeeper).
 */
export function palRoute(text: string): 'listen' | { ask: string } | null {
  const n = lower(text);
  if (!n) return null;
  if (/^(hey |hi |ok |oh )?pal( please)?$/.test(n) || /^(help|help me|help me please|please help|please help me|i need help)$/.test(n)) return 'listen';
  const call = /^(hey |hi |ok )?pal[, ]+(.+)$/.exec(n);
  if (call) return { ask: call[2] };
  if (/\bhow (do|can|would) (i|you) say\b|\bhow to say\b|\bwhat (did|does) (she|he) (say|said|mean)\b|\bwhat does .+ mean\b/.test(n)) return { ask: n };
  if (looksEnglish(n)) return { ask: n };
  return null;
}

// ---- Local lines ---------------------------------------------------------------

const answer = (en: string, fr = '', tip = ''): PalAnswer => ({ en, fr, sounds: fr ? soundsLike(fr) : '', tip, source: 'local' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const keeperOf = (place: PlaceId) => (PLACES[place] ?? PLACES.cafe).shopkeeper;
const pronoun = (place: PlaceId) => (keeperOf(place).gender === 'm' ? 'He' : 'She');

/** Once, at the end of the tutorial (or right after the first greeting). */
export function palIntro(place: PlaceId): PalAnswer {
  return answer(`Hi, I'm Pal! ${pronoun(place)} only speaks French. I'll help you in English. Just pinch me and ask!`);
}

/** "What did she say?": her last line in English (no model call). */
export function whatDidSheSay(ctx: PalContext): PalAnswer {
  const who = pronoun(ctx.place);
  if (!ctx.lastLine?.en) return answer(`${who} hasn't said anything yet. Say hello: "Bonjour" works everywhere!`, `Bonjour, ${keeperOf(ctx.place).gender === 'm' ? 'monsieur' : 'madame'} !`);
  const next = ctx.replies[0];
  return answer(`${who} said: "${ctx.lastLine.en}"`, next?.fr ?? '');
}

/** The last question (or sentence) of a line, at most ~14 words. */
function gist(en: string): string {
  const parts = en.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const q = [...parts].reverse().find((s) => s.trim().endsWith('?')) ?? parts[parts.length - 1] ?? en;
  const words = q.trim().split(/\s+/);
  return words.length > 14 ? `${words.slice(0, 14).join(' ')}...` : q.trim();
}

/** Proactive hint (beginners): what she just asked, in English, and one French answer. */
export function palHint(turn: Pick<AgentTurn, 'en' | 'replies'>, place: PlaceId): PalAnswer {
  const say = turn.replies[0];
  const who = pronoun(place);
  if (!turn.en) return answer('Not sure what to say? Pinch the blue line, or say it out loud!', say?.fr ?? '');
  return answer(`${who}'s asking: "${gist(turn.en)}" Try the blue line!`, say?.fr ?? '');
}

// ---- Offline helper: keyword intents ----------------------------------------------

const EN_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };

/** A menu item named in English ("two coffees", "the cherry tart"), with its quantity. */
export function findItemEn(q: string, menu: MenuItem[]): { item: MenuItem; qty: number } | null {
  const n = ` ${lower(q)} `;
  let best: { item: MenuItem; qty: number; len: number } | null = null;
  for (const item of menu) {
    for (const name of [item.enPlural, item.en, item.noun, item.plural]) {
      const key = lower(name);
      const at = n.indexOf(` ${key} `);
      if (at < 0 || (best && key.length <= best.len)) continue;
      const before = n.slice(0, at).trim().split(' ');
      const qty = EN_NUMBERS[before[before.length - 1]] ?? 1;
      best = { item, qty: Math.max(1, Math.min(5, qty)), len: key.length };
    }
  }
  return best ? { item: best.item, qty: best.qty } : null;
}

/** Fixed English -> French phrasebook (checked after menu items). */
function phrasebook(n: string, ctx: PalContext): PalAnswer | null {
  const sir = keeperOf(ctx.place).gender === 'm' ? 'monsieur' : 'madame';
  const name = /\bmy name is ([a-z]+)/.exec(n)?.[1];
  if (name) return answer('Tell her your name like this:', `Je m'appelle ${cap(name)}.`);
  const book: [RegExp, string, string, string?][] = [
    [/\b(the bill|the check|bill please|check please)\b/, 'Ask for the bill like this:', "L'addition, s'il vous plaît !"],
    [/\b(that's all|thats all|that is all|nothing else|i'm done|im done|i am done|finished)\b/, 'When you have everything, say:', "C'est tout, merci."],
    [/\b(card|credit card)\b/, 'To pay by card, say:', 'Je paie par carte.'],
    [/\b(here you go|here it is|here you are)\b/, 'Handing something over? Say:', 'Voilà.'],
    [/\b(repeat|again|slower|slowly|too fast|didn't understand|didnt understand|don't understand|dont understand)\b/, 'Ask her to say it again, slowly:', "Plus lentement, s'il vous plaît.", 'Any shopkeeper in Paris will happily slow down.'],
    [/\b(goodbye|bye|see you|leave|leaving)\b/, 'To say goodbye, say:', 'Au revoir, bonne journée !'],
    [/\b(thank you|thanks)\b/, 'To say thank you, say:', 'Merci beaucoup !'],
    [/\b(hello|hi|good morning|greet)\b/, 'Start with a hello. In France, always!', `Bonjour, ${sir} !`],
    [/\b(sorry|excuse me)\b/, 'To say sorry or excuse me:', 'Pardon !'],
    [/\b(yes)\b/, 'For a polite yes, say:', 'Oui, avec plaisir !'],
    [/\b(no)\b/, 'For a polite no, say:', 'Non, merci.'],
    [/\b(recommend|suggest|what's good|whats good|best)\b/, 'Ask for her recommendation:', 'Qu\'est-ce que vous recommandez ?'],
    [/\b(please)\b/, '"Please" is:', "S'il vous plaît."],
  ];
  for (const [re, en, fr, tip] of book) if (re.test(n)) return answer(en, fr, tip ?? '');
  return null;
}

/** "What should I say?": the next step for this moment of the visit. */
function nextStep(ctx: PalContext): PalAnswer {
  const who = pronoun(ctx.place);
  if (ctx.phase === 'paying') {
    return answer(`Time to pay: ${priceToEnglish(Math.max(0, ctx.totalCents))}. Put coins on the tray, or say:`, ctx.replies[0]?.fr ?? 'Voilà.');
  }
  if (ctx.phase === 'paid') return answer('All paid! Say goodbye:', 'Merci, au revoir !');
  if (ctx.phase === 'ordering') return answer('Want anything else? If not, say:', "C'est tout, merci.");
  const r = ctx.replies[0];
  if (r) return answer(`${who}'s waiting for your order. Try this one:`, r.fr);
  return answer('Say hello first!', `Bonjour, ${keeperOf(ctx.place).gender === 'm' ? 'monsieur' : 'madame'} !`);
}

/**
 * The offline Pal (no key, API down, or a quick local answer). Keyword intents
 * in English; unknown questions get a gentle pointer at the reply chips.
 */
export function offlinePal(question: string, ctx: PalContext): PalAnswer {
  const n = lower(question);
  const menu = (PLACES[ctx.place] ?? PLACES.cafe).menu;
  if (!n) return nextStep(ctx);
  if (/\bwhat (did|does|was) (she|he|that|it)\b|\bwhat (she|he) said\b|\btranslate\b|\bwhat does (that|it) mean\b|\bwhat was that\b/.test(n)) return whatDidSheSay(ctx);
  const found = findItemEn(n, menu);
  if (/\bhow much\b|\bprice\b|\bcost\b/.test(n)) {
    if (found) return answer(`${cap(quantityPhraseEn(found.item, 1))} is ${priceToEnglish(found.item.priceCents)} here. Ask like this:`, `C'est combien, ${definite(found.item)} ?`);
    if (ctx.order.length && ctx.totalCents > 0) return answer(`Your order comes to ${priceToEnglish(ctx.totalCents)}. To ask, say:`, "C'est combien ?");
    return answer('To ask the price, say:', "C'est combien, s'il vous plaît ?");
  }
  if (found) {
    const { item, qty } = found;
    return answer(`To order ${quantityPhraseEn(item, qty)}, say:`, `${cap(quantityPhrase(item, qty))}, s'il vous plaît.`);
  }
  if (/\b(what (should|do|can) i (say|do)|what now|help|stuck|don't know|dont know)\b/.test(n) && !/\bsay (hello|thank|goodbye|bye|yes|no|please|sorry)\b/.test(n)) return nextStep(ctx);
  const book = phrasebook(n, ctx);
  if (book) return book;
  if (/\b(menu|sell|have|buy|what can i (get|order))\b/.test(n)) {
    const names = menu.slice(0, 3).map((m) => m.enPlural).join(', ');
    return answer(`${pronoun(ctx.place)} sells ${names} and more. Try:`, `${cap(quantityPhrase(menu[0], 1))}, s'il vous plaît.`);
  }
  // Another shop's item ("how do I say croissant" at the market): still give the French.
  for (const p of Object.values(PLACES)) {
    const other = findItemEn(n, p.menu);
    if (other) return answer(`That's sold at ${p.en}. The French is:`, `${cap(quantityPhrase(other.item, other.qty))}, s'il vous plaît.`);
  }
  if (/\bhow do i\b/.test(n)) return nextStep(ctx);
  return answer('Try pinching one of the suggested phrases!');
}

// ---- The AI route ---------------------------------------------------------------

/** Body of POST /api/agent for Pal. Price words come from the engine (the model never computes them). */
export function palRequest(question: string, ctx: PalContext) {
  const menu = (PLACES[ctx.place] ?? PLACES.cafe).menu;
  return {
    mode: 'pal' as const,
    question: question.slice(0, 200),
    pal: {
      place: ctx.place,
      phase: ctx.phase,
      order: ctx.order.slice(0, 8).map((l) => ({ itemId: l.itemId, qty: l.qty })),
      totalEn: priceToEnglish(ctx.totalCents),
      totalWords: priceToFrench(ctx.totalCents),
      prices: Object.fromEntries(menu.map((m) => [m.id, { en: priceToEnglish(m.priceCents), fr: priceToFrench(m.priceCents) }])),
      lastLine: ctx.lastLine ? { fr: ctx.lastLine.fr.slice(0, 200), en: ctx.lastLine.en.slice(0, 240) } : null,
      replies: ctx.replies.slice(0, 3).map((r) => ({ fr: r.fr, en: r.en })),
      name: ctx.name.slice(0, 24),
      realLife: ctx.realLife,
    },
  };
}

/** Shape check of the route's answer; fills `sounds` locally when the model left it out. */
export function parsePalAnswer(data: unknown): PalAnswer | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.en !== 'string' || !d.en.trim()) return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const fr = str(d.fr, 120);
  return { en: str(d.en, 220), fr, sounds: fr ? str(d.sounds, 160) || soundsLike(fr) : '', tip: str(d.tip, 100), source: 'ai' };
}
