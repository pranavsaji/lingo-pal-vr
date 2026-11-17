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

import { parseVoiceCommand } from '../src/voice/voice-commands';

describe('voice commands do not swallow ordinary sentences', () => {
  const cmd = (t: string) => parseVoiceCommand(t, { paying: false, choosing: false });
  it('keeps small talk and orders for the shopkeeper', () => {
    expect(cmd('Je voudrais passer une commande')).toBe(null);
    expect(cmd("J'adore Paris")).toBe(null);
    expect(cmd('On peut commencer ?')).toBe(null);
    expect(cmd("C'est fermé ?")).toBe(null);
    expect(cmd('Je vais prendre le café')).toBe(null);
  });
  it('still runs the real commands', () => {
    expect(cmd('Passer')?.kind).toBe('skip');
    expect(cmd('Paris')).toEqual({ kind: 'open', panel: 'map' });
    expect(cmd('Le plan de Paris')).toEqual({ kind: 'open', panel: 'map' });
    expect(cmd('Fermer')?.kind).toBe('close');
    expect(cmd('Commencer la mission')?.kind).toBe('mission');
    expect(cmd('Allons au marché')).toEqual({ kind: 'travel', place: 'marche' });
  });
});
