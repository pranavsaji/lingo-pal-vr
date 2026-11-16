import { describe, expect, it } from 'vitest';
import { freeExtras } from '../src/agent/order-guard';
import { emptyOrder, orderTotal } from '../src/agent/tools';

describe('free extras: what she hands over lands on the tray', () => {
  it('the bistrot carafe is served when she agrees to the learner asking for it', () => {
    expect(freeExtras('bistrot', "Une carafe d'eau, s'il vous plaît", "Une carafe d'eau ? Bien sûr, c'est gratuit !", emptyOrder())).toEqual(['carafe']);
    expect(freeExtras('bistrot', 'Le plat du jour', "Voilà la carafe d'eau. Elle est gratuite.", emptyOrder())).toEqual(['carafe']);
  });

  it('never on a refusal, a mere mention, another shop, or twice', () => {
    expect(freeExtras('bistrot', "Une carafe d'eau", "Désolé, plus de carafe aujourd'hui.", emptyOrder())).toEqual([]);
    expect(freeExtras('bistrot', 'Le plat du jour', "Vous voulez une carafe d'eau avec ça ?", emptyOrder())).toEqual([]);
    expect(freeExtras('cafe', "Une carafe d'eau", "Bien sûr, voilà une carafe !", emptyOrder())).toEqual([]);
    expect(freeExtras('bistrot', "Une carafe d'eau", 'Bien sûr, voilà !', { ...emptyOrder(), free: ['carafe'] })).toEqual([]);
  });

  it('is never priced', () => {
    expect(orderTotal([])).toBe(0);
    expect(orderTotal({ ...emptyOrder(), free: ['carafe'] }.lines)).toBe(0);
  });
});
