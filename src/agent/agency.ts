/**
 * Multi-step agency in the world, decided by the game (pure, deterministic):
 *  - low stock: one item per shop per day runs out; the shopkeeper serves what
 *    is left and proposes a substitute (validated by the `offer` tool);
 *  - upsell: a related item, once per visit;
 *  - the change test: once the learner is past the tutorial and doing well,
 *    she sometimes gives slightly wrong change on purpose and praises them if
 *    they catch it, else corrects herself.
 * The shopkeeper (AI or script) only proposes; applyActions enforces stock.
 */

import { daySeed, type Day } from '../state/dates.js';
import { priceToEnglish, priceToFrench, type MenuItem } from './menu.js';
import type { AgentTurn, ReplyOption } from './protocol.js';

// ---- Substitutes and pairings --------------------------------------------------

/** Close alternatives, best first (filtered by what the shop sells). */
const SUBSTITUTES: Record<string, string[]> = {
  croissant: ['pain_chocolat', 'gateau', 'baguette'],
  pain_chocolat: ['croissant', 'eclair'],
  baguette: ['petit_pain', 'croissant'],
  petit_pain: ['baguette'],
  eclair: ['macaron', 'tarte', 'pain_chocolat'],
  macaron: ['eclair', 'tarte'],
  tarte: ['gateau', 'eclair'],
  gateau: ['tarte', 'croissant', 'eclair'],
  cafe: ['eau', 'orange'],
  eau: ['orange', 'cafe'],
  orange: ['pomme', 'citron', 'eau'],
  pomme: ['poire', 'orange', 'banane'],
  poire: ['pomme', 'kiwi'],
  banane: ['kiwi', 'pomme'],
  kiwi: ['banane', 'citron'],
  citron: ['orange', 'kiwi'],
  avocat: ['citron', 'oignon'],
  grenade: ['pomme', 'poire'],
  oignon: ['patate_douce', 'avocat'],
  patate_douce: ['oignon', 'avocat'],
  fromage: ['baguette', 'pomme'],
  // Bistrot, métro, pharmacie.
  plat_du_jour: ['salade', 'soupe'],
  soupe: ['salade', 'plat_du_jour'],
  salade: ['soupe', 'plat_du_jour'],
  crepe: ['salade'],
  jus_orange: ['eau'],
  ticket: ['carnet', 'forfait_jour'],
  carnet: ['ticket', 'forfait_jour'],
  forfait_jour: ['carnet', 'ticket'],
  plan_metro: ['ticket'],
  pansements: ['mouchoirs'],
  creme_solaire: ['mouchoirs'],
  mouchoirs: ['pansements'],
  sirop: ['paracetamol', 'mouchoirs'],
  paracetamol: ['sirop'],
  petit_dejeuner: ['plan_ville'],
  plan_ville: ['carte_postale'],
  carte_postale: ['plan_ville'],
  parapluie: ['plan_ville'],
};

/** "Goes well with": what she suggests on top of an order. */
const PAIRINGS: Record<string, string[]> = {
  cafe: ['croissant', 'gateau'],
  croissant: ['cafe', 'pain_chocolat'],
  baguette: ['fromage', 'croissant'],
  fromage: ['baguette', 'pomme'],
  gateau: ['cafe', 'macaron'],
  eau: ['croissant'],
  orange: ['croissant'],
  pomme: ['poire', 'fromage'],
  pain_chocolat: ['croissant'],
  petit_pain: ['croissant'],
  eclair: ['macaron'],
  tarte: ['macaron'],
  macaron: ['eclair'],
  poire: ['pomme'],
  banane: ['kiwi'],
  kiwi: ['banane'],
  citron: ['avocat'],
  avocat: ['citron'],
  oignon: ['patate_douce'],
  patate_douce: ['oignon'],
  grenade: ['pomme'],
  plat_du_jour: ['jus_orange', 'crepe'],
  soupe: ['eau'],
  salade: ['jus_orange'],
  crepe: ['jus_orange'],
  ticket: ['plan_metro'],
  carnet: ['plan_metro'],
  forfait_jour: ['plan_metro'],
  sirop: ['mouchoirs'],
  paracetamol: ['mouchoirs'],
  pansements: ['creme_solaire'],
  nuit: ['petit_dejeuner'],
  plan_ville: ['carte_postale'],
  parapluie: ['plan_ville'],
};

/**
 * A substitute the shop can serve: a listed alternative first, else the item
 * with the closest price. Never the item itself or anything out of stock.
 */
export function substituteFor(itemId: string, menu: readonly MenuItem[], outOf: (id: string) => boolean): MenuItem | null {
  const ok = (m: MenuItem | undefined): m is MenuItem => !!m && m.id !== itemId && !outOf(m.id);
  for (const id of SUBSTITUTES[itemId] ?? []) {
    const m = menu.find((x) => x.id === id);
    if (ok(m)) return m;
  }
  const self = menu.find((m) => m.id === itemId);
  if (!self) return null;
  let best: MenuItem | null = null;
  for (const m of menu) if (ok(m) && (!best || Math.abs(m.priceCents - self.priceCents) < Math.abs(best.priceCents - self.priceCents))) best = m;
  return best;
}

/** A related item not already ordered and in stock, or null. */
export function upsellFor(orderIds: readonly string[], menu: readonly MenuItem[], outOf: (id: string) => boolean): MenuItem | null {
  for (const id of orderIds) {
    for (const p of PAIRINGS[id] ?? []) {
      if (orderIds.includes(p) || outOf(p)) continue;
      const m = menu.find((x) => x.id === p);
      if (m) return m;
    }
  }
  return null;
}

// ---- Stock -------------------------------------------------------------------------

/**
 * Today's "victime de son succès": one menu item per shop per day has a single
 * piece left, the plat du jour (`prefer`) when it can be. Never the item on the
 * learner's shopping list (`protect`), so the list can always be finished.
 */
export function lowStockToday(day: Day, place: string, menu: readonly MenuItem[], protect: readonly string[], prefer?: string): Record<string, number> {
  const pool = menu.filter((m) => !protect.includes(m.id));
  if (pool.length === 0) return {};
  if (prefer && pool.some((m) => m.id === prefer)) return { [prefer]: 1 };
  let h = daySeed(day);
  for (let i = 0; i < place.length; i++) h = (Math.imul(h, 31) + place.charCodeAt(i)) >>> 0;
  return { [pool[h % pool.length].id]: 1 };
}

// ---- The change test ---------------------------------------------------------------

export interface TrickInput {
  onboarded: boolean;
  /** Orders paid before this one (all time). */
  ordersBefore: number;
  changeCents: number;
  trickedThisSession: boolean;
  /** Times she has already done it (all time). */
  tricksBefore: number;
  /** Mistakes recorded this session. */
  sessionMistakes: number;
  /** Average pronunciation this session, null if not scored. */
  sessionPronunciation: number | null;
  /** 0 to 1 random roll. */
  roll: number;
}

/**
 * Only past the tutorial, only when doing well, at most once per session.
 * The first time it happens as soon as the learner qualifies (a judge sees it);
 * later it is occasional.
 */
export function shouldTrickChange(t: TrickInput): boolean {
  if (!t.onboarded || t.ordersBefore < 1 || t.changeCents < 20 || t.trickedThisSession) return false;
  if (t.sessionMistakes > 1) return false;
  if (t.sessionPronunciation !== null && t.sessionPronunciation < 70) return false;
  return t.tricksBefore === 0 || t.roll < 0.3;
}

/** Slightly wrong: 10 to 50 cents short, never zero or negative. */
export function trickAmount(changeCents: number): number {
  const delta = changeCents >= 100 ? 50 : changeCents >= 40 ? 20 : 10;
  return Math.max(10, changeCents - delta);
}

/** Did the learner challenge the change? `text` is normalized French (no accents). */
export function caughtTrick(text: string, missingCents: number, trueCents: number, amountSaid: number | null): boolean {
  if (amountSaid !== null && (amountSaid === missingCents || amountSaid === trueCents)) return true;
  return /\b(manque|erreur|pas assez|pas juste|faux|attendez|attends|combien|tromp\w*|recompt\w*|non)\b/.test(text);
}

// ---- Items from another shop -------------------------------------------------------

/**
 * The learner asked for something this shop does not sell but another does
 * ("un pain au chocolat" at the café). `norm` is normalized French.
 */
export function findElsewhere(norm: string, here: string, places: Record<string, { menu: MenuItem[] }>): { item: MenuItem; place: string; alias: string } | null {
  const padded = ` ${norm} `;
  const sold = new Set(places[here]?.menu.map((m) => m.id) ?? []);
  // Names this shop sells that are in the sentence: "jus d orange" at the bistrot is not the café's "orange".
  const local: string[] = [];
  for (const item of places[here]?.menu ?? []) for (const a of item.aliases) if (padded.includes(` ${a} `)) local.push(` ${a} `);
  let best: { item: MenuItem; place: string; alias: string } | null = null;
  for (const [place, data] of Object.entries(places)) {
    if (place === here) continue;
    for (const item of data.menu) {
      if (sold.has(item.id)) continue;
      for (const alias of item.aliases) {
        if (!padded.includes(` ${alias} `) || local.some((l) => l.includes(` ${alias} `))) continue;
        if (!best || alias.length > best.alias.length) best = { item, place, alias };
      }
    }
  }
  return best;
}

// ---- The change test: her lines (local, no model call) ------------------------------

const AFTER_PAID: ReplyOption[] = [
  { fr: 'Merci, au revoir !', en: 'Thanks, goodbye!' },
  { fr: 'À demain !', en: 'See you tomorrow!' },
  { fr: 'Merci beaucoup !', en: 'Thank you very much!' },
];

const local = (fr: string, en: string, actions: unknown[], points: number, replies: ReplyOption[]): AgentTurn => ({
  fr,
  en,
  actions,
  points,
  replies,
  source: 'script',
});

/** She hands back slightly wrong change (in words) and waits; no coins move yet. */
export function trickOpenTurn(saidCents: number, favorite: string): AgentTurn {
  const remember = favorite ? [{ type: 'remember', key: 'favorite_order', value: favorite.slice(0, 40) }] : [];
  return local(
    `Merci ! Je vous rends ${priceToFrench(saidCents)}.`,
    `Thank you! Here is ${priceToEnglish(saidCents)} change.`,
    [{ type: 'emote', kind: 'nod' }, ...remember],
    20,
    [
      { fr: 'Attendez… ça fait combien ?', en: 'Wait… how much is that?' },
      { fr: 'Merci, au revoir !', en: 'Thanks, goodbye!' },
      { fr: 'Merci beaucoup !', en: 'Thank you very much!' },
    ],
  );
}

/** Caught: praise and the right change. Missed: she corrects herself (and still says goodbye if asked). */
export function trickResolveTurn(o: { caught: boolean; trueCents: number; name: string; feminine: boolean; bye: boolean }): AgentTurn {
  const tromp = o.feminine ? 'trompée' : 'trompé';
  const name = o.name ? `, ${o.name}` : '';
  const give = { type: 'give_change', cents: o.trueCents };
  if (o.caught) {
    return local(
      `Bien vu${name} ! Je me suis ${tromp} exprès. Voilà ${priceToFrench(o.trueCents)}.`,
      `Well spotted${name}! I got it wrong on purpose. Here is ${priceToEnglish(o.trueCents)}.`,
      [give, { type: 'emote', kind: 'clap' }],
      20,
      AFTER_PAID,
    );
  }
  const bye = o.bye ? ` À demain${name} !` : '';
  return local(
    `Oh, pardon ! Je me suis ${tromp} : je vous rends ${priceToFrench(o.trueCents)}.${bye}`,
    `Oh, sorry! My mistake: here is ${priceToEnglish(o.trueCents)} change.${o.bye ? ` See you tomorrow${name}!` : ''}`,
    o.bye ? [give, { type: 'emote', kind: 'laugh' }, { type: 'end_visit' }] : [give, { type: 'emote', kind: 'laugh' }],
    0,
    AFTER_PAID,
  );
}
