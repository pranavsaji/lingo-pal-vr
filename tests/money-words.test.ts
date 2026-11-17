import { describe, expect, it } from 'vitest';
import { WALLET } from '../src/interaction/pick-coins';
import { MONEY_WORDS, moneyWordById, moneyWordId, PLACE_VOCAB } from '../src/vocab';

describe('every piece of money has a French name', () => {
  it('names each coin and note in the purse, and the bank card', () => {
    for (const cents of [...WALLET, 0]) {
      const w = moneyWordById(moneyWordId(cents));
      expect(w, `cents ${cents}`).toBeDefined();
      expect(w!.fr).toMatch(/^(la|le) (pièce|billet|carte)/);
    }
  });

  it('names every euro coin and note the change can contain', () => {
    for (const cents of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) expect(moneyWordById(moneyWordId(cents))).toBeDefined();
  });

  it('money words never collide with a shop item', () => {
    const items = new Set(Object.values(PLACE_VOCAB).flat().map((v) => v.id));
    for (const w of MONEY_WORDS) expect(items.has(w.id)).toBe(false);
  });

  it('every shop item has a French name with its article and an English meaning', () => {
    for (const [place, words] of Object.entries(PLACE_VOCAB)) {
      for (const v of words) {
        expect(v.fr, `${place}/${v.id}`).toMatch(/^(le |la |l'|les )./);
        expect(v.en.length, `${place}/${v.id}`).toBeGreaterThan(2);
      }
    }
  });
});

import { payWith, validPayCents } from '../src/agent/tools';

describe('paying a spoken amount', () => {
  const order = { lines: [{ itemId: 'croissant', qty: 2 }], phase: 'paying', trayCents: 0, changeCents: 0, changeGiven: false } as never;
  it('ignores an amount no coin can make, or a mis-heard huge one (no crash, order unchanged)', () => {
    for (const c of [345, 5, 0, -100, 1.5, 100_000]) {
      expect(validPayCents(c), String(c)).toBe(false);
      expect(payWith(order, c).state).toBe(order);
    }
    expect(validPayCents(500)).toBe(true);
  });
});
