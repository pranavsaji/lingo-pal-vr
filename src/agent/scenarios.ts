/**
 * Daily scenarios. The "plat du jour" (today's special) is seeded by the date
 * so it is stable all day and different tomorrow: a reason to come back.
 */

import { daySeed, type Day } from '../state/dates.js';
import type { PlaceId } from '../game-state.js';
import { PLACES, type MenuItem } from './menu.js';

export interface Scenario {
  id: PlaceId;
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
  { id: 'bistrot', fr: 'Le Bistrot', en: 'The Bistro', sells: ['plat_du_jour', 'soupe', 'salade', 'crepe'], unlock: 'bistrot' },
  { id: 'metro', fr: 'Le Métro', en: 'The Metro', sells: ['ticket', 'carnet', 'forfait_jour'], unlock: 'metro' },
  { id: 'pharmacie', fr: 'La Pharmacie', en: 'The Pharmacy', sells: ['pansements', 'mouchoirs', 'creme_solaire', 'sirop'], unlock: 'pharmacie' },
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

/**
 * Today's special. With `place`, it is that shop's special (what its shopkeeper
 * offers); without, a shop is picked for the day among the unlocked ones.
 */
export function dailySpecial(day: Day, unlocks: string[], place?: PlaceId): DailySpecial {
  const seed = daySeed(day);
  const scenarios = availableScenarios(unlocks);
  const scenario = (place && SCENARIOS.find((s) => s.id === place)) || scenarios[seed % scenarios.length];
  const menu = PLACES[scenario.id].menu;
  const preferred = menu.filter((m) => scenario.sells.includes(m.id));
  const items = preferred.length ? preferred : menu;
  const item = items[(seed >>> 8) % items.length];
  const challenge = CHALLENGES[(seed >>> 16) % CHALLENGES.length];
  return { scenarioId: scenario.id, item, challenge };
}
