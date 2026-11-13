import { describe, expect, it } from 'vitest';
import { parseIntent } from '../src/agent/intent.js';
import { MENU, PLACES, setMenuPlace, type MenuItem } from '../src/agent/menu.js';
import { dailySpecial } from '../src/agent/scenarios.js';
import { scriptedTurn } from '../src/agent/script.js';
import type { AgentRequest } from '../src/agent/protocol.js';
import { placeUnlocked } from '../src/places/places.js';
import { PLACE_VOCAB, setVocabPlace, VOCAB } from '../src/vocab.js';
// @ts-expect-error plain ESM server module
import { PLACE_IDS, systemPrompt, toolsFor } from '../server/agent-handler.mjs';

const places = ['cafe', 'boulangerie', 'marche'] as const;

describe('shops share one source of truth', () => {
  it('every menu item has a word on display, prices are payable in 10c coins', () => {
    for (const p of places) {
      const ids = new Set(PLACE_VOCAB[p].map((v) => v.id));
      for (const m of PLACES[p].menu as MenuItem[]) {
        expect(ids.has(m.id), `${p}/${m.id}`).toBe(true);
        expect(m.priceCents % 10).toBe(0);
      }
      for (const w of PLACES[p].words) expect(ids.has(w), `${p}/${w}`).toBe(true);
      expect(PLACE_VOCAB[p].length).toBeLessThanOrEqual(12); // Carnet has 12 rows
    }
  });
  it('the server builds each shop prompt and tools from the same data', () => {
    expect(PLACE_IDS).toEqual([...places]);
    for (const p of places) {
      const prompt: string = systemPrompt(p);
      expect(prompt).toContain(PLACES[p].shopkeeper.name);
      for (const m of PLACES[p].menu) expect(prompt).toContain(`${m.id} ${m.priceCents}`);
      const serve = toolsFor(p).find((t: { name: string }) => t.name === 'serve_items');
      expect(serve.input_schema.properties.itemId.enum).toEqual(PLACES[p].menu.map((m: MenuItem) => m.id));
    }
    expect(systemPrompt('boulangerie')).toContain('masculine agreement');
  });
});

describe('switching shops', () => {
  it('swaps the live menu and words in place', () => {
    const menuRef = MENU;
    const vocabRef = VOCAB;
    setMenuPlace('marche');
    setVocabPlace('marche');
    expect(menuRef.map((m) => m.id)).toContain('banane');
    expect(vocabRef.map((v) => v.id)).toContain('cageot');
    setMenuPlace('cafe');
    setVocabPlace('cafe');
    expect(menuRef.map((m) => m.id)).toContain('cafe');
  });
  it('parses bakery orders with the longest name first', () => {
    setMenuPlace('boulangerie');
    const o = parseIntent('Je voudrais deux pains au chocolat et un petit pain');
    expect(o).toEqual({ kind: 'order', items: [{ itemId: 'pain_chocolat', qty: 2 }, { itemId: 'petit_pain', qty: 1 }] });
    setMenuPlace('cafe');
  });
  it('understands travel by voice', () => {
    expect(parseIntent('Allons à la boulangerie !')).toEqual({ kind: 'travel', place: 'boulangerie' });
    expect(parseIntent('Je vais au marché')).toEqual({ kind: 'travel', place: 'marche' });
    expect(parseIntent('Où est la boulangerie ?').kind).not.toBe('travel');
  });
  it('opens shops early enough for a five-minute visit', () => {
    const fresh = { onboarded: false, stats: { orders: 0 } } as never;
    expect(placeUnlocked('cafe', fresh)).toBe(true);
    expect(placeUnlocked('boulangerie', fresh)).toBe(false);
    expect(placeUnlocked('boulangerie', { onboarded: true, stats: { orders: 0 } } as never)).toBe(true);
    expect(placeUnlocked('marche', { onboarded: true, stats: { orders: 1 } } as never)).toBe(true);
  });
  it('each shopkeeper greets in their own shop with their special', () => {
    for (const p of places) {
      const special = dailySpecial({ y: 2026, m: 11, d: 13 } as never, [], p);
      expect(PLACES[p].menu.some((m: MenuItem) => m.id === special.item.id)).toBe(true);
      setMenuPlace(p);
      const req = {
        profile: { name: '', level: 'A1.1', sessions: 1, streakDays: 1, weakWords: [], memories: {}, lastVisit: '' },
        scene: { phase: 'browsing', order: [], totalCents: 0, totalWords: 'zéro euro', trayCents: 0, lookingAt: null, holding: null, scenario: p, special: { itemId: special.item.id, challenge: '' }, place: p },
        event: { kind: 'arrive' },
        history: [],
      } as unknown as AgentRequest;
      const t = scriptedTurn(req);
      if (p !== 'cafe') expect(t.fr).toContain(PLACES[p].shopkeeper.name);
    }
    setMenuPlace('cafe');
  });
});
