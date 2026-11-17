import { describe, expect, it } from 'vitest';
import { lockedMessage, ordersToUnlock, placeUnlocked } from '../src/places/places';

const prof = (orders: number) => ({ onboarded: true, stats: { orders } }) as never;

describe('locked shops on the Plan de Paris', () => {
  it('counts the paid orders still to go', () => {
    expect(ordersToUnlock('bistrot', prof(1))).toBe(1);
    expect(ordersToUnlock('hotel', prof(1))).toBe(4);
    expect(ordersToUnlock('marche', prof(1))).toBe(0);
    expect(placeUnlocked('marche', prof(1))).toBe(true);
  });

  it('says what opens it and that choosing again goes anyway', () => {
    const m = lockedMessage('bistrot', { fr: 'Le Bistrot', en: 'The Bistro' }, prof(1));
    expect(m.fr).toBe('Le Bistrot : après votre deuxième commande.');
    expect(m.en).toBe('The Bistro opens after your second paid order (1 more to go). Choose it again to visit now.');
  });
});
