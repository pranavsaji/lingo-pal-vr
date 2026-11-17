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
