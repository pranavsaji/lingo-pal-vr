import { describe, expect, it } from 'vitest';
import { travelPlace } from '../src/agent/intent';
import { normalizeFrench } from '../src/voice/pronunciation';

const go = (t: string) => travelPlace(normalizeFrench(t));

describe('travel by voice', () => {
  it('goes where the learner says', () => {
    expect(go('Allons à la boulangerie !')).toBe('boulangerie');
    expect(go('Je vais au marché')).toBe('marche');
    expect(go('Retour au café')).toBe('cafe');
    expect(go('Je vais prendre le métro')).toBe('metro');
    expect(go('On va à la pharmacie')).toBe('pharmacie');
    expect(go("Je vais à l'hôtel")).toBe('hotel');
  });
  it('does not mistake an order or small talk for a trip', () => {
    expect(go('Je vais prendre le café, s il vous plaît')).toBe(null);
    expect(go('Ça va, le marché ?')).toBe(null);
  });
});
