import { describe, expect, it } from 'vitest';
import { lockedMessage, ordersToUnlock, placeUnlocked, PLACE_ORDER } from '../src/places/places';

const prof = (onboarded: boolean, orders = 0) => ({ onboarded, stats: { orders } }) as never;

describe('shops on the Plan de Paris', () => {
  it('are all open after the tutorial, with no orders needed', () => {
    for (const p of PLACE_ORDER) {
      expect(placeUnlocked(p, prof(true)), p).toBe(true);
      expect(ordersToUnlock(p, prof(true)), p).toBe(0);
    }
  });

  it('before the tutorial, only the café; a locked choice explains itself and a second choice goes anyway', () => {
    expect(placeUnlocked('cafe', prof(false))).toBe(true);
    expect(placeUnlocked('bistrot', prof(false))).toBe(false);
    const m = lockedMessage('bistrot', { fr: 'Le Bistrot', en: 'The Bistro' }, prof(false));
    expect(m.fr).toBe('Le Bistrot : après le tutoriel.');
    expect(m.en).toBe('The Bistro opens after the tutorial. Choose it again to visit now.');
  });
});
