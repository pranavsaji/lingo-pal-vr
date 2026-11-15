/**
 * "Prêt pour Paris": how ready the learner is for a real trip, measured in real
 * situations (not XP). Each of the seven places has four situations: order there,
 * say it in French well enough to be understood, pay the right amount, and do it
 * with no help ("vraie vie"). Every tick comes from something the game already
 * verified (a paid order, a scored phrase, the register's change, a clean
 * real-life order), so the percentage never moves for free.
 *
 * Also builds "today's 10-minute plan" (the next 2-3 situations to practise) and
 * the optional trip countdown ("J-12"). Pure functions over the profile JSON.
 */

import type { PlaceId } from '../game-state.js';
import { PLACE_ORDER, PLACE_UNLOCK_ORDERS, placeUnlocked } from '../places/places.js';
import { addDays, daysBetween, type Day } from './dates.js';
import type { Profile } from './profile.js';

export type SituationKind = 'order' | 'speak' | 'pay' | 'real';
export const SITUATION_KINDS: SituationKind[] = ['order', 'speak', 'pay', 'real'];

export interface Situation {
  place: PlaceId;
  kind: SituationKind;
  fr: string;
  en: string;
}

/** Place names as the checklist shows them. */
export const PLACE_LABEL: Record<PlaceId, { fr: string; en: string }> = {
  cafe: { fr: 'Café Lune', en: 'Café' },
  boulangerie: { fr: 'Boulangerie', en: 'Bakery' },
  marche: { fr: 'Marché', en: 'Market' },
  bistrot: { fr: 'Bistrot', en: 'Bistro' },
  metro: { fr: 'Métro', en: 'Metro' },
  pharmacie: { fr: 'Pharmacie', en: 'Pharmacy' },
  hotel: { fr: 'Hôtel', en: 'Hotel' },
};

/** What "order" means in each place (the other three situations read the same everywhere). */
const ORDER_LINE: Record<PlaceId, { fr: string; en: string }> = {
  cafe: { fr: 'Commander au comptoir', en: 'Order at the counter' },
  boulangerie: { fr: 'Acheter son pain', en: 'Buy your bread' },
  marche: { fr: 'Acheter des fruits', en: 'Buy fruit' },
  bistrot: { fr: 'Commander un déjeuner', en: 'Order lunch' },
  metro: { fr: 'Acheter un ticket', en: 'Buy a ticket' },
  pharmacie: { fr: 'Demander ce qu’il vous faut', en: 'Ask for what you need' },
  hotel: { fr: 'Réserver une chambre', en: 'Book a room' },
};

export function situation(place: PlaceId, kind: SituationKind): Situation {
  switch (kind) {
    case 'order':
      return { place, kind, ...ORDER_LINE[place] };
    case 'speak':
      return { place, kind, fr: 'Le dire en français', en: 'Say it in French (70 %+)' };
    case 'pay':
      return { place, kind, fr: 'Payer le compte juste', en: 'Pay the exact amount' };
    case 'real':
      return { place, kind, fr: 'Sans aide, comme à Paris', en: 'No help, like real Paris' };
  }
}

export const SITUATIONS: Situation[] = PLACE_ORDER.flatMap((place) => SITUATION_KINDS.map((kind) => situation(place, kind)));

type Facts = Pick<Profile, 'passport' | 'onboarded' | 'stats'>;

/** Counter behind each situation (all recorded by Store from game-verified events). */
function count(p: Facts, place: PlaceId, kind: SituationKind): number {
  const pp = p.passport;
  switch (kind) {
    case 'order':
      return pp.placeOrders[place] ?? 0;
    case 'speak':
      return pp.placeSpoken?.[place] ?? 0;
    case 'pay':
      return pp.placeExact?.[place] ?? 0;
    case 'real':
      return pp.placeRealLife?.[place] ?? 0;
  }
}

export function situationDone(p: Facts, place: PlaceId, kind: SituationKind): boolean {
  return count(p, place, kind) >= 1;
}

export interface Readiness {
  /** 0 to 100. */
  percent: number;
  done: number;
  total: number;
  /** Per place, in map order: which of the four situations are done. */
  places: { place: PlaceId; label: string; done: Record<SituationKind, boolean>; count: number; open: boolean }[];
}

export function readiness(p: Facts): Readiness {
  let done = 0;
  const places = PLACE_ORDER.map((place) => {
    const d = {} as Record<SituationKind, boolean>;
    let n = 0;
    for (const kind of SITUATION_KINDS) {
      d[kind] = situationDone(p, place, kind);
      if (d[kind]) n++;
    }
    done += n;
    return { place, label: PLACE_LABEL[place].fr, done: d, count: n, open: placeUnlocked(place, p) };
  });
  const total = SITUATIONS.length;
  return { percent: Math.round((done / total) * 100), done, total, places };
}

export interface PlanItem {
  place: PlaceId | null;
  kind: SituationKind | 'words' | 'unlock';
  fr: string;
  en: string;
}

/**
 * Today's 10-minute plan: up to three concrete next steps.
 * 1. a place that is open but never ordered in (new place first, map order);
 * 2. the first missing "say it" / "pay right" situation where the learner has ordered;
 * 3. weak words from the carnet, or a real-life try once the learner was invited,
 *    or what opens the next locked place.
 */
export function todaysPlan(p: Facts & Pick<Profile, 'realLifeInvited'>, weakWords: string[] = [], max = 3): PlanItem[] {
  const plan: PlanItem[] = [];
  const open = PLACE_ORDER.filter((pl) => placeUnlocked(pl, p));
  const push = (item: PlanItem) => {
    if (plan.length < max && !plan.some((x) => x.place === item.place && x.kind === item.kind)) plan.push(item);
  };
  const add = (s: Situation) => push({ place: s.place, kind: s.kind, fr: `${PLACE_LABEL[s.place].fr} : ${s.fr}`, en: `${PLACE_LABEL[s.place].en}: ${s.en}` });

  const fresh = open.find((pl) => !situationDone(p, pl, 'order'));
  if (fresh) add(situation(fresh, 'order'));

  for (const pl of open) {
    if (!situationDone(p, pl, 'order')) continue;
    const missing = (['speak', 'pay'] as SituationKind[]).find((k) => !situationDone(p, pl, k));
    if (missing) {
      add(situation(pl, missing));
      break;
    }
  }

  if (weakWords.length) {
    const words = weakWords.slice(0, 3).join(', ');
    push({ place: null, kind: 'words', fr: `Revoir : ${words}`, en: `Review: ${words}` });
  }

  const realReady = p.realLifeInvited || p.stats.orders >= 5;
  if (realReady) {
    const pl = open.find((x) => situationDone(p, x, 'order') && !situationDone(p, x, 'real'));
    if (pl) add(situation(pl, 'real'));
  }

  // Remaining missing situations where the learner has already ordered, in map order.
  for (const pl of open) {
    if (!situationDone(p, pl, 'order')) continue;
    for (const k of SITUATION_KINDS) if (!situationDone(p, pl, k) && (k !== 'real' || realReady)) add(situation(pl, k));
  }

  const locked = PLACE_ORDER.find((pl) => !placeUnlocked(pl, p));
  if (locked && plan.length < max) {
    const need = Math.max(1, (PLACE_UNLOCK_ORDERS[locked] ?? 0) - p.stats.orders);
    const name = PLACE_LABEL[locked];
    push({
      place: locked,
      kind: 'unlock',
      fr: p.onboarded ? `Ouvrir ${name.fr} : encore ${need} commande${need > 1 ? 's' : ''}` : `Ouvrir ${name.fr} : finir le tutoriel`,
      en: p.onboarded ? `Open the ${name.en.toLowerCase()}: ${need} more order${need > 1 ? 's' : ''}` : `Open the ${name.en.toLowerCase()}: finish the tutorial`,
    });
  }
  return plan;
}

// ---- Trip goal ("Mon voyage à Paris") ---------------------------------------------

export const TRIP_CHOICES = [0, 7, 14, 30] as const;
export type TripChoice = (typeof TRIP_CHOICES)[number];

/** Next option when the settings row is pinched: aucun > 7 > 14 > 30 jours > aucun. */
export function nextTrip(current: number): TripChoice {
  const i = TRIP_CHOICES.indexOf(current as TripChoice);
  return TRIP_CHOICES[(i + 1) % TRIP_CHOICES.length];
}

/** Days until the trip (0 = today), or null when no trip is set. */
export function tripDaysLeft(trip: number, tripSet: Day, today: Day): number | null {
  if (!trip || !tripSet) return null;
  return Math.max(0, daysBetween(today, addDays(tripSet, trip)));
}

/** "J-12", "Jour J", or '' with no trip. */
export function tripLabel(trip: number, tripSet: Day, today: Day): string {
  const left = tripDaysLeft(trip, tripSet, today);
  if (left === null) return '';
  return left === 0 ? 'Jour J' : `J-${left}`;
}

/** Home strip: "PRÊT POUR PARIS 34 % · J-12". */
export function readinessStrip(r: Readiness, trip: string): string {
  return `PRÊT POUR PARIS ${r.percent} %${trip ? ` · ${trip}` : ''}`;
}

/** "at the bakery" for spoken lines. */
const AT_PLACE: Record<PlaceId, { fr: string; en: string }> = {
  cafe: { fr: 'au Café Lune', en: 'at the café' },
  boulangerie: { fr: 'à la boulangerie', en: 'at the bakery' },
  marche: { fr: 'au marché', en: 'at the market' },
  bistrot: { fr: 'au bistrot', en: 'at the bistro' },
  metro: { fr: 'au métro', en: 'at the metro' },
  pharmacie: { fr: 'à la pharmacie', en: 'at the pharmacy' },
  hotel: { fr: 'à l’hôtel', en: 'at the hotel' },
};

/** "the bakery" as the object of a sentence. */
const THE_PLACE: Record<PlaceId, string> = {
  cafe: 'le Café Lune',
  boulangerie: 'la boulangerie',
  marche: 'le marché',
  bistrot: 'le bistrot',
  metro: 'le métro',
  pharmacie: 'la pharmacie',
  hotel: 'l’hôtel',
};

/** The order situation as she would say it ("acheter votre pain à la boulangerie"). */
const SPOKEN_ORDER: Record<PlaceId, { fr: string; en: string }> = {
  cafe: { fr: 'commander au comptoir du Café Lune', en: 'order at the café counter' },
  boulangerie: { fr: 'acheter votre pain à la boulangerie', en: 'buy your bread at the bakery' },
  marche: { fr: 'acheter des fruits au marché', en: 'buy fruit at the market' },
  bistrot: { fr: 'commander un déjeuner au bistrot', en: 'order lunch at the bistro' },
  metro: { fr: 'acheter un ticket au métro', en: 'buy a ticket at the metro' },
  pharmacie: { fr: 'demander ce qu’il vous faut à la pharmacie', en: 'ask for what you need at the pharmacy' },
  hotel: { fr: 'réserver une chambre à l’hôtel', en: 'book a room at the hotel' },
};

/** One natural sentence for the goodbye (appended to her turn, no extra AI call): the first step of the plan. */
export function nextSituationLine(p: Facts & Pick<Profile, 'realLifeInvited'>): { fr: string; en: string } | null {
  const first = todaysPlan(p, [], 1)[0];
  if (!first || !first.place || first.kind === 'words') return null;
  const at = AT_PLACE[first.place];
  let step: { fr: string; en: string };
  switch (first.kind) {
    case 'order':
      step = SPOKEN_ORDER[first.place];
      break;
    case 'speak':
      step = { fr: `commander à voix haute ${at.fr}`, en: `order out loud ${at.en}` };
      break;
    case 'pay':
      step = { fr: `payer le compte juste ${at.fr}`, en: `pay the exact amount ${at.en}` };
      break;
    case 'real':
      step = { fr: `commander sans aide ${at.fr}, comme à Paris`, en: `order with no help ${at.en}, like real Paris` };
      break;
    case 'unlock': {
      if (!p.onboarded) return null; // the tutorial says what comes next
      const need = Math.max(1, (PLACE_UNLOCK_ORDERS[first.place] ?? 0) - p.stats.orders);
      const name = PLACE_LABEL[first.place];
      step = {
        fr: `encore ${need} commande${need > 1 ? 's' : ''} pour ouvrir ${THE_PLACE[first.place]}`,
        en: `${need} more order${need > 1 ? 's' : ''} to open the ${name.en.toLowerCase()}`,
      };
      break;
    }
    default:
      return null;
  }
  return { fr: `Prochaine étape pour Paris : ${step.fr}.`, en: `Next step for Paris: ${step.en}.` };
}
