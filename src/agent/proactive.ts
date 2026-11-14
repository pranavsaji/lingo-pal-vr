/**
 * Context-aware help without asking. The shopkeeper notices when the learner
 * hesitates (no speech, gesture or pinch for a while mid-order) or keeps
 * looking at an item, and offers a hint scaled to their level.
 *
 * Local and free: the trigger logic (HintCoach) and the hint lines (hintTurn)
 * are deterministic, so a hint costs no API call and has no latency.
 * Rate limited so she never nags: a minimum gap between hints, a cap per
 * visit, a growing wait when hints go unanswered, one gaze hint per item.
 */

import { menuItem, priceToEnglish, priceToFrench, quantityPhrase, quantityPhraseEn } from './menu.js';
import type { AgentRequest, AgentTurn, ReplyOption } from './protocol.js';
import { findCurveball } from './real-life.js';
import { definite } from './script.js';
import type { OrderPhase } from './tools.js';

export interface CoachConfig {
  /** No speech/gesture/pinch for this long mid-order: a hesitation. */
  hesitateMs: number;
  /** Looking at one item this long: a gaze hint. */
  gazeMs: number;
  /** ...and only when the learner has not acted for this long (looking, not doing). */
  gazeQuietMs: number;
  /** Minimum time between two hints. */
  minGapMs: number;
  /** Hints per visit (shop arrival). */
  maxPerVisit: number;
}

export const DEFAULT_COACH: CoachConfig = { hesitateMs: 9000, gazeMs: 1500, gazeQuietMs: 4000, minGapMs: 25000, maxPerVisit: 4 };

export type HintTrigger = { reason: 'hesitate'; nth: number } | { reason: 'gaze'; itemId: string; nth: number };

export interface CoachContext {
  /** The coach may speak now (past the tutorial, no lesson, nothing pending, she is not talking). */
  eligible: boolean;
  phase: OrderPhase;
  /** A change test is waiting for the learner's answer (hesitation then resolves it). */
  awaitingAnswer: boolean;
  lookingAt: string | null;
  /** Worth a gaze hint: a menu item, not already ordered, not mastered. */
  gazeWorthy: (itemId: string) => boolean;
}

export class HintCoach {
  private lastActivity = 0;
  private gazeId: string | null = null;
  private gazeSince = 0;
  private lastHint = -Infinity;
  private hints = 0;
  /** Hints since the learner last did something: each one doubles the wait. */
  private unanswered = 0;
  private gazeDone = new Set<string>();

  constructor(private cfg: CoachConfig = DEFAULT_COACH) {}

  /** The learner spoke, gestured, pinched, paid: they are not stuck. */
  activity(now: number): void {
    this.lastActivity = now;
    this.unanswered = 0;
  }

  /** She just spoke: the pause is measured from now (unanswered hints still count). */
  restartClock(now: number): void {
    this.lastActivity = now;
  }

  /** New shop / new visit: fresh budget. */
  newVisit(now: number): void {
    this.lastActivity = now;
    this.unanswered = 0;
    this.hints = 0;
    this.lastHint = -Infinity;
    this.gazeDone.clear();
  }

  get hintsThisVisit(): number {
    return this.hints;
  }

  /** Call a few times a second. Returns a trigger at most once per minGap. */
  tick(now: number, ctx: CoachContext): HintTrigger | null {
    if (ctx.lookingAt !== this.gazeId) {
      this.gazeId = ctx.lookingAt;
      this.gazeSince = now;
    }
    const stage = ctx.phase !== 'paid' || ctx.awaitingAnswer;
    if (!ctx.eligible || !stage) {
      // The hesitation clock only runs while she is waiting on the learner.
      this.lastActivity = now;
      return null;
    }
    if (now - this.lastHint < this.cfg.minGapMs || this.hints >= this.cfg.maxPerVisit) return null;

    const g = this.gazeId;
    const quiet = now - this.lastActivity >= this.cfg.gazeQuietMs;
    if (g && quiet && !ctx.awaitingAnswer && now - this.gazeSince >= this.cfg.gazeMs && !this.gazeDone.has(g) && ctx.gazeWorthy(g)) {
      this.gazeDone.add(g);
      return this.fire(now, { reason: 'gaze', itemId: g, nth: this.unanswered });
    }
    const wait = this.cfg.hesitateMs * 2 ** this.unanswered;
    if (now - this.lastActivity >= wait) return this.fire(now, { reason: 'hesitate', nth: this.unanswered });
    return null;
  }

  private fire(now: number, t: HintTrigger): HintTrigger {
    this.lastHint = now;
    this.lastActivity = now;
    this.hints += 1;
    this.unanswered += 1;
    return t;
  }
}

// ---- Hint lines (local script) -------------------------------------------------

/** 0 = A1.1 (model the whole sentence), 1 = A1.2-A1.3 (name it), 2 = A2+ (French-only nudge). */
export function levelTier(level: string): 0 | 1 | 2 {
  if (level.startsWith('A2') || level.startsWith('B')) return 2;
  return level === 'A1.1' || !level ? 0 : 1;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SLOWER: ReplyOption = { fr: "Plus lentement, s'il vous plaît.", en: 'More slowly, please.' };
const DONE: ReplyOption = { fr: "C'est tout, merci.", en: "That's all, thanks." };

const hintOut = (fr: string, en: string, actions: unknown[], replies: ReplyOption[]): AgentTurn => ({
  fr,
  en,
  actions,
  replies,
  points: 0,
  source: 'script',
});

/** What she says when she offers help unasked. */
export function hintTurn(req: AgentRequest, t: { reason: 'hesitate' | 'gaze'; itemId?: string; nth: number }): AgentTurn {
  if (req.scene.realLife) return realLifeHint(req, t);
  const { scene } = req;
  const tier = levelTier(req.profile.level);
  const item = t.itemId ? menuItem(t.itemId) : undefined;

  if (t.reason === 'gaze' && item) {
    const one = cap(quantityPhrase(item, 1));
    const order: ReplyOption = { fr: `${one}, s'il vous plaît.`, en: `${cap(quantityPhraseEn(item, 1))}, please.` };
    const price: ReplyOption = { fr: `C'est combien, ${definite(item)} ?`, en: `How much is the ${item.en}?` };
    const actions = [{ type: 'point_at', itemId: item.id }];
    if (tier === 0) {
      return hintOut(
        `Ça, c'est ${definite(item)}. Dites : « ${one}, s'il vous plaît. »`,
        `That's the ${item.en}. Say: "${order.en}"`,
        actions,
        [order, price, SLOWER],
      );
    }
    if (tier === 1) {
      return hintOut(
        `Vous regardez ${definite(item)} ? ${cap(priceToFrench(item.priceCents))} la pièce.`,
        `Looking at the ${item.en}? ${priceToEnglish(item.priceCents)} each.`,
        actions,
        [order, { fr: `Deux ${item.plural}, s'il vous plaît.`, en: `Two ${item.enPlural}, please.` }, { fr: 'Non, merci.', en: 'No, thank you.' }],
      );
    }
    return hintOut(`${cap(definite(item))} vous fait envie ?`, `Tempted by the ${item.en}?`, actions, [order, price, { fr: 'Non, merci.', en: 'No, thank you.' }]);
  }

  // Hesitation. Second time in a row: offer to slow down.
  if (scene.phase === 'paying') {
    const due = Math.max(0, scene.totalCents - scene.trayCents);
    return hintOut(
      tier === 0 ? `Ça fait ${priceToFrench(due)}. Posez les pièces sur le plateau.` : `Ça fait ${priceToFrench(due)}, s'il vous plaît.`,
      tier === 0 ? `That's ${priceToEnglish(due)}. Put the coins on the tray.` : `That's ${priceToEnglish(due)}, please.`,
      [{ type: 'emote', kind: 'nod' }],
      [{ fr: 'Voilà.', en: 'Here you go.' }, { fr: 'Ça fait combien ?', en: 'How much is it?' }, SLOWER],
    );
  }
  if (t.nth >= 1) {
    return hintOut(
      'Je parle trop vite ? Je peux parler plus lentement.',
      'Am I talking too fast? I can speak more slowly.',
      [{ type: 'emote', kind: 'think' }],
      [SLOWER, { fr: "Non, ça va, merci.", en: "No, I'm fine, thanks." }, scene.phase === 'ordering' ? DONE : { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' }],
    );
  }
  if (scene.phase === 'ordering') {
    return hintOut(
      tier === 0 ? 'Autre chose ? Sinon, dites : « C\'est tout, merci. »' : tier === 1 ? 'Autre chose, ou c\'est tout ?' : 'Et avec ceci ?',
      tier === 0 ? 'Anything else? If not, say: "That\'s all, thanks."' : tier === 1 ? 'Anything else, or is that all?' : 'Anything else with that?',
      [{ type: 'emote', kind: 'nod' }],
      [DONE, { fr: "C'est combien ?", en: 'How much is it?' }, SLOWER],
    );
  }
  // Browsing: the shopping list first (context), else today's special.
  const [qtyStr, listId] = (scene.shoppingList ?? '').split(' ');
  const listItem = listId ? menuItem(listId) : undefined;
  const target = listItem ?? menuItem(scene.special.itemId);
  if (!target) {
    return hintOut('Prenez votre temps.', 'Take your time.', [], [SLOWER, { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' }, { fr: 'Bonjour !', en: 'Hello!' }]);
  }
  const qty = listItem ? Math.max(1, Math.min(5, Number(qtyStr) || 1)) : 1;
  const phrase = cap(quantityPhrase(target, qty));
  const say: ReplyOption = { fr: `${phrase}, s'il vous plaît.`, en: `${cap(quantityPhraseEn(target, qty))}, please.` };
  const actions = [{ type: 'point_at', itemId: target.id }];
  if (tier === 0) {
    return hintOut(
      listItem ? `Votre liste : ${quantityPhrase(target, qty)}. Dites : « ${say.fr} »` : `Prenez votre temps. Dites : « ${say.fr} »`,
      listItem ? `Your list: ${quantityPhraseEn(target, qty)}. Say: "${say.en}"` : `Take your time. Say: "${say.en}"`,
      actions,
      [say, { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' }, SLOWER],
    );
  }
  if (tier === 1) {
    return hintOut(
      listItem ? `Et votre liste de courses ? ${cap(quantityPhrase(target, qty))}, non ?` : `Je vous conseille ${definite(target)}.`,
      listItem ? `What about your shopping list? ${cap(quantityPhraseEn(target, qty))}, right?` : `I recommend the ${target.en}.`,
      actions,
      [say, { fr: 'Non, merci.', en: 'No, thank you.' }, SLOWER],
    );
  }
  return hintOut('Alors, qu\'est-ce qui vous ferait plaisir ?', 'So, what would you like?', actions, [say, { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' }, SLOWER]);
}

/**
 * "Vraie vie": no teaching hints. She prompts the way a Paris shopkeeper would
 * ("Je vous écoute ?", "Et avec ceci ?"), or asks her pending question again.
 */
function realLifeHint(req: AgentRequest, t: { reason: 'hesitate' | 'gaze'; itemId?: string; nth: number }): AgentTurn {
  const { scene } = req;
  const item = t.itemId ? menuItem(t.itemId) : undefined;
  const no: ReplyOption = { fr: 'Non, merci.', en: 'No, thank you.' };
  if (t.reason === 'gaze' && item) {
    const order: ReplyOption = { fr: `${cap(quantityPhrase(item, 1))}, s'il vous plaît.`, en: `${cap(quantityPhraseEn(item, 1))}, please.` };
    return hintOut(`${cap(definite(item))}, ça vous tente ?`, `Fancy the ${item.en}?`, [{ type: 'point_at', itemId: item.id }], [order, { fr: `C'est combien, ${definite(item)} ?`, en: `How much is the ${item.en}?` }, no]);
  }
  const rl = scene.realLife;
  const cb = rl && (rl.stage === 'asked' || rl.stage === 'again') ? findCurveball(scene.place, rl.curveball) : undefined;
  if (cb) return hintOut(`Alors ? ${cb.fr}`, `So? ${cb.en}`, [{ type: 'emote', kind: 'think' }], cb.replies);
  if (scene.phase === 'paying') {
    const due = Math.max(0, scene.totalCents - scene.trayCents);
    return hintOut(`Ça vous fait ${priceToFrench(due)}.`, `That comes to ${priceToEnglish(due)}.`, [{ type: 'emote', kind: 'nod' }], [{ fr: 'Voilà.', en: 'Here you go.' }, { fr: 'Ça fait combien ?', en: 'How much is it?' }, SLOWER]);
  }
  if (scene.phase === 'ordering') {
    return hintOut('Et avec ceci ?', 'Anything else with that?', [{ type: 'emote', kind: 'nod' }], [DONE, { fr: "C'est combien ?", en: 'How much is it?' }, SLOWER]);
  }
  return hintOut(t.nth >= 1 ? 'Alors, je vous écoute ?' : 'Je vous écoute ?', t.nth >= 1 ? "So, I'm listening?" : "I'm listening?", [{ type: 'emote', kind: 'nod' }], [
    { fr: 'Bonjour !', en: 'Hello!' },
    { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' },
    SLOWER,
  ]);
}
