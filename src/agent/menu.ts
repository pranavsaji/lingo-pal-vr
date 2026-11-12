/**
 * The cafe menu, euro coins, and French number/price wording.
 * Every price, total and change amount in the app is computed here, in
 * integer cents. The AI never does arithmetic that the learner relies on.
 */

export type Gender = 'm' | 'f';

export interface MenuItem {
  id: string; // matches VOCAB ids
  noun: string; // singular, no article
  plural: string;
  gender: Gender;
  en: string;
  enPlural: string;
  priceCents: number;
}

export const MENU: MenuItem[] = [
  { id: 'croissant', noun: 'croissant', plural: 'croissants', gender: 'm', en: 'croissant', enPlural: 'croissants', priceCents: 170 },
  { id: 'cafe', noun: 'café', plural: 'cafés', gender: 'm', en: 'coffee', enPlural: 'coffees', priceCents: 180 },
  { id: 'baguette', noun: 'baguette', plural: 'baguettes', gender: 'f', en: 'baguette', enPlural: 'baguettes', priceCents: 110 },
  { id: 'pomme', noun: 'pomme', plural: 'pommes', gender: 'f', en: 'apple', enPlural: 'apples', priceCents: 60 },
  { id: 'orange', noun: 'orange', plural: 'oranges', gender: 'f', en: 'orange', enPlural: 'oranges', priceCents: 70 },
  { id: 'fromage', noun: 'fromage', plural: 'fromages', gender: 'm', en: 'cheese', enPlural: 'cheeses', priceCents: 450 },
  { id: 'eau', noun: "bouteille d'eau", plural: "bouteilles d'eau", gender: 'f', en: 'bottle of water', enPlural: 'bottles of water', priceCents: 150 },
  { id: 'gateau', noun: 'gâteau', plural: 'gâteaux', gender: 'm', en: 'cake', enPlural: 'cakes', priceCents: 380 },
];

export const MAX_QUANTITY = 5;

export function menuItem(id: string): MenuItem | undefined {
  return MENU.find((m) => m.id === id);
}

/** Euro coins and notes the learner can pay with, in cents, largest first. */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

/** Greedy change-making; exact for the euro system. Returns [] for 0. */
export function makeChange(cents: number): Denomination[] {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`bad cents ${cents}`);
  if (cents % 10 !== 0) throw new Error(`cents must be a multiple of 10: ${cents}`);
  const out: Denomination[] = [];
  let left = cents;
  for (const d of DENOMINATIONS) {
    while (left >= d) {
      out.push(d);
      left -= d;
    }
  }
  return out;
}

// ---- French numbers ---------------------------------------------------------

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };

function below100(n: number, feminine: boolean): string {
  if (n === 1 && feminine) return 'une';
  if (n <= 16) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7) return u === 1 ? 'soixante et onze' : `soixante-${below100(10 + u, false)}`;
  if (t === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${below100(u, feminine)}`;
  if (t === 9) return `quatre-vingt-${below100(10 + u, false)}`;
  if (u === 0) return TENS[t];
  if (u === 1) return `${TENS[t]} et ${feminine ? 'une' : 'un'}`;
  return `${TENS[t]}-${UNITS[u]}`;
}

/** 0 to 9999 in French words (1990 spelling with hyphens kept simple). */
export function numberToFrench(n: number, feminine = false): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error(`out of range ${n}`);
  if (n < 100) return below100(n, feminine);
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 ? 's' : ''}`;
    return r === 0 ? head : `${head} ${below100(r, feminine)}`;
  }
  const th = Math.floor(n / 1000);
  const r = n % 1000;
  const head = th === 1 ? 'mille' : `${numberToFrench(th)} mille`;
  return r === 0 ? head : `${head} ${numberToFrench(r, feminine)}`;
}

/** 340 -> "trois euros quarante", 100 -> "un euro", 50 -> "cinquante centimes". */
export function priceToFrench(cents: number): string {
  const euros = Math.floor(cents / 100);
  const c = cents % 100;
  if (cents === 0) return 'zéro euro';
  if (euros === 0) return `${numberToFrench(c)} centime${c === 1 ? '' : 's'}`;
  const e = `${numberToFrench(euros)} euro${euros === 1 ? '' : 's'}`;
  return c === 0 ? e : `${e} ${numberToFrench(c)}`;
}

/** 340 -> "3,40 €" (French formatting). */
export function priceToDigits(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')} €`;
}

/** 340 -> "3.40 euros" for English subtitles. */
export function priceToEnglish(cents: number): string {
  return `${(cents / 100).toFixed(2)} euros`;
}

/** "deux croissants", "une baguette", "un café". */
export function quantityPhrase(item: MenuItem, qty: number): string {
  if (qty === 1) return `${item.gender === 'f' ? 'une' : 'un'} ${item.noun}`;
  return `${numberToFrench(qty, item.gender === 'f')} ${item.plural}`;
}

export function quantityPhraseEn(item: MenuItem, qty: number): string {
  if (qty === 1) return `${/^[aeiou]/.test(item.en) ? 'an' : 'a'} ${item.en}`;
  return `${qty} ${item.enPlural}`;
}

/**
 * Spell digits out as French words so speech-to-text output ("2 croissants",
 * "5 €", "3,40 euros") matches phrases written in words, and so the on-device
 * voice reads numbers aloud. "3,40 €" -> "trois euros quarante".
 */
export function spellOutNumbers(text: string): string {
  return text
    .replace(/(\d{1,4})[,.](\d{1,2})\s*(?:€|euros?\b)/gi, (_, e: string, c: string) => priceToFrench(Number(e) * 100 + Number(c.padEnd(2, '0'))))
    .replace(/(\d{1,4})\s*€/g, (_, e: string) => priceToFrench(Number(e) * 100))
    .replace(/(\d{1,4})[,.](\d{2})\b/g, (_, e: string, c: string) => priceToFrench(Number(e) * 100 + Number(c)))
    .replace(/\d{1,4}/g, (n) => numberToFrench(Number(n)))
    .replace(/€/g, 'euros');
}
