/**
 * Daily scenarios. The "plat du jour" (today's special) is seeded by the date
 * so it is stable all day and different tomorrow: a reason to come back.
 */

import { daySeed, type Day } from '../state/dates.js';
import { MENU, type MenuItem } from './menu.js';

export interface Scenario {
  id: 'cafe' | 'boulangerie' | 'marche';
  fr: string;
  en: string;
  /** Menu ids sold in this scenario. */
  sells: string[];
  /** Unlock id required (undefined = always available). */
  unlock?: string;
}

export const SCENARIOS: Scenario[] = [
  { id: 'cafe', fr: 'Le Café Lune', en: 'Cafe Lune', sells: ['cafe', 'croissant', 'gateau', 'eau', 'orange'] },
  { id: 'boulangerie', fr: 'La Boulangerie', en: 'The Bakery', sells: ['baguette', 'croissant', 'gateau'], unlock: 'boulangerie' },
  { id: 'marche', fr: 'Le Marché', en: 'The Market', sells: ['pomme', 'orange', 'fromage', 'eau'], unlock: 'marche' },
];

export interface DailySpecial {
  scenarioId: Scenario['id'];
  item: MenuItem;
  /** A small learning goal for today, e.g. order with a number. */
  challenge: { fr: string; en: string; qty: number };
}

const CHALLENGES = [
  { fr: 'Commandez-en deux avec vos doigts.', en: 'Order two using your fingers.', qty: 2 },
  { fr: 'Commandez-en trois, poliment.', en: 'Order three, politely.', qty: 3 },
  { fr: 'Demandez le prix, puis payez juste.', en: 'Ask the price, then pay exactly.', qty: 1 },
];

export function availableScenarios(unlocks: string[]): Scenario[] {
  return SCENARIOS.filter((s) => !s.unlock || unlocks.includes(s.unlock));
}

export function dailySpecial(day: Day, unlocks: string[]): DailySpecial {
  const seed = daySeed(day);
  const scenarios = availableScenarios(unlocks);
  const scenario = scenarios[seed % scenarios.length];
  const items = MENU.filter((m) => scenario.sells.includes(m.id));
  const item = items[(seed >>> 8) % items.length];
  const challenge = CHALLENGES[(seed >>> 16) % CHALLENGES.length];
  return { scenarioId: scenario.id, item, challenge };
}
