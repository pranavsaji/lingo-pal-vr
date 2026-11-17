/**
 * Le Bistrot, Le Métro, La Pharmacie, L'Hôtel: every shop on the map is a complete scenario.
 * One test per contract (data, look, words, models, shopkeeper, voice, stamp, travel
 * words), then the shop-specific language and a full offline order in each new shop.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@iwsdk/core', async () => await import('three'));

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Mesh, type Object3D } from 'three';
import { findElsewhere } from '../src/agent/agency';
import { AgentDirector } from '../src/agent/director';
import { parseIntent } from '../src/agent/intent';
import { MENU, PLACES, setMenuPlace, type MenuItem } from '../src/agent/menu';
import type { AgentRequest } from '../src/agent/protocol';
import { SCENARIOS } from '../src/agent/scenarios';
import { scriptedTurn } from '../src/agent/script';
import { buildItem } from '../src/cafe-builder';
import { appState, type PlaceId } from '../src/game-state';
import { buildPlaceDressing } from '../src/models/place-items';
import { PLACE_LOOKS, PLACE_ORDER, placeUnlocked, unlockHint } from '../src/places/places';
import { PLACE_TEXT } from '../src/places/place-text';
import { demoProfile } from '../src/state/demo';
import type { KV } from '../src/state/profile';
import { STAMPS, STAMP_SLOTS } from '../src/state/passport';
import { UNLOCKS } from '../src/state/progression';
import { dailyQuest } from '../src/state/quest';
import { Store } from '../src/state/store';
import { PLACE_VOCAB, setVocabPlace } from '../src/vocab';
import { parseVoiceCommand } from '../src/voice/voice-commands';
import { needsCard, WALLET } from '../src/interaction/pick-coins';
import { CUSTOMERS } from '../src/world/characters/customers';
import { SHOPKEEPERS } from '../src/world/characters/shopkeepers';
// @ts-expect-error plain ESM server module
import { SPEAKERS } from '../server/tts-handler.mjs';
// @ts-expect-error plain ESM server module
import { systemPrompt } from '../server/agent-handler.mjs';

const root = resolve(__dirname, '..');
const assetsSrc = readFileSync(resolve(root, 'src/assets.ts'), 'utf8');
const speechSrc = readFileSync(resolve(root, 'src/speech.ts'), 'utf8');
const mapUi = readFileSync(resolve(root, 'public/ui/map.uikitml'), 'utf8');
const NEW: PlaceId[] = ['bistrot', 'metro', 'pharmacie', 'hotel'];
const idle = { paying: false, choosing: false };

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function triangles(o: Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const g = (c as Mesh).geometry;
    if (!(c as Mesh).isMesh || !g) return;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

describe('every shop on the map is complete', () => {
  it('opens every shop once the tutorial is done (judges can try all seven at once)', () => {
    expect(PLACE_ORDER).toEqual(['cafe', 'boulangerie', 'marche', 'bistrot', 'metro', 'pharmacie', 'hotel']);
    const at = (orders: number) => PLACE_ORDER.filter((p) => placeUnlocked(p, { onboarded: true, stats: { orders } } as never));
    expect(at(0)).toEqual(PLACE_ORDER);
    expect(placeUnlocked('bistrot', { onboarded: false, stats: { orders: 9 } } as never)).toBe(false);
    expect(unlockHint('metro').en).toBe('Opens after the tutorial');
    // ?demo=week opens every shop (and their scenario unlocks).
    const demo = demoProfile('2026-11-13');
    for (const p of PLACE_ORDER) expect(placeUnlocked(p, demo), p).toBe(true);
    for (const p of NEW) expect(demo.unlocks, p).toContain(p);
  });

  for (const place of PLACE_ORDER) {
    it(`${place}: data, look, words, models, shopkeeper, voice, stamp, travel`, () => {
      const data = PLACES[place];
      expect(data, 'shared/places.json').toBeDefined();
      expect(data.menu.length).toBeGreaterThanOrEqual(4);
      for (const m of data.menu as MenuItem[]) {
        expect(m.priceCents % 10, m.id).toBe(0);
        expect(m.priceCents).toBeGreaterThan(0);
        expect(m.aliases.length).toBeGreaterThan(0);
        for (const a of m.aliases) expect(a, `${m.id} alias "${a}" must be normalized`).toMatch(/^[a-z0-9 ]+$/);
      }
      // Look: lighting, backdrop and surfaces exist on disk.
      const look = PLACE_LOOKS[place];
      expect(existsSync(resolve(root, `public/hdri/${look.hdri}_1k.hdr`))).toBe(true);
      expect(existsSync(resolve(root, `public/hdri/${look.hdri}_bg.jpg`))).toBe(true);
      for (const s of [look.floor, look.counterTop, look.counterFront, look.backTop, look.backFront]) expect(existsSync(resolve(root, `public/textures/${s.tex}/diff.webp`)), s.tex).toBe(true);
      for (const p of look.props) expect(assetsSrc.includes(`'${p.model.replace(/^prop-/, '')}'`), p.model).toBe(true);
      // Words: every menu item and object is on the counter, with a model.
      const vocab = PLACE_VOCAB[place];
      const ids = new Set(vocab.map((v) => v.id));
      for (const m of data.menu) expect(ids.has(m.id), `${place}/${m.id}`).toBe(true);
      for (const w of data.words) expect(ids.has(w), `${place}/${w}`).toBe(true);
      for (const v of vocab) {
        if (v.model) {
          const file = resolve(root, `public/models/props/${v.model.replace(/^prop-/, '')}.glb`);
          expect(existsSync(file), v.model).toBe(true);
        } else {
          const g = buildItem(v.shape, v.color);
          expect(triangles(g), `${v.id} has geometry`).toBeGreaterThan(10);
        }
      }
      // Shopkeeper, voice, customers, stamp, scenario, text, map card, travel words.
      const keeper = SHOPKEEPERS[place];
      const m = assetsSrc.match(new RegExp(`'${keeper.assetId}': shopkeeper\\('([^']+)'`));
      expect(m, keeper.assetId).not.toBeNull();
      expect(statSync(resolve(root, 'public/models/characters', m![1])).size).toBeLessThan(1.2 * 1024 * 1024);
      expect(keeper.name).toBe(data.shopkeeper.name);
      const voice = speechSrc.match(new RegExp(`${place}: '([a-z]+)'`));
      expect(voice, `${place} voice in speech.ts KEEPER`).not.toBeNull();
      expect(SPEAKERS[voice![1]], voice![1]).toBeDefined();
      expect(CUSTOMERS[place]).toHaveLength(2);
      expect(STAMPS.some((s) => s.id === place && s.kind === 'shop')).toBe(true);
      expect(SCENARIOS.some((s) => s.id === place)).toBe(true);
      expect(PLACE_TEXT[place]).toBeDefined();
      expect(mapUi).toContain(`id="place-${place}"`);
      expect(mapUi).toContain(`id="place-${place}-status"`);
      expect(systemPrompt(place)).toContain(data.shopkeeper.name);
      const fr = normalize(data.fr.replace(/^(Le|La|Les|L')\s*/, ''));
      expect(parseIntent(`Allons ${PLACE_TEXT[place].at.fr.replace(/^à /, 'à ')}`), fr).toEqual({ kind: 'travel', place });
      expect(parseVoiceCommand(`Allons ${PLACE_TEXT[place].at.fr}`, idle)).toEqual({ kind: 'travel', place });
    });
  }

  it('fits every stamp on the passport panel and announces each new shop', () => {
    expect(STAMPS.length).toBeLessThanOrEqual(STAMP_SLOTS);
    for (const p of NEW) expect(UNLOCKS.find((u) => u.id === p)?.kind).toBe('scenario');
  });
});

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

describe('procedural counter items and set dressing stay cheap', () => {
  const shapes = NEW.flatMap((p) => PLACE_VOCAB[p].filter((v) => !v.model));
  for (const v of shapes) {
    it(`${v.id} (${v.shape}): one or two meshes, low poly, sits on the counter`, () => {
      const g = buildItem(v.shape, v.color);
      let meshes = 0;
      g.traverse((o) => {
        if ((o as Mesh).isMesh) meshes++;
      });
      expect(meshes).toBeGreaterThanOrEqual(1);
      expect(meshes).toBeLessThanOrEqual(2);
      expect(triangles(g)).toBeLessThan(4000);
      const box = new Box3().setFromObject(g);
      expect(box.min.y).toBeGreaterThan(-0.002);
      expect(box.max.y).toBeLessThan(0.25);
      expect(box.max.x - box.min.x).toBeLessThan(0.26);
      expect(box.max.z - box.min.z).toBeLessThan(0.26);
    });
  }
  it('dresses the bistrot, metro and pharmacy in a few draw calls', () => {
    for (const p of NEW) {
      const d = buildPlaceDressing(p);
      expect(d, p).not.toBeNull();
      let meshes = 0;
      d!.traverse((o) => {
        if ((o as Mesh).isMesh) meshes++;
      });
      expect(meshes, p).toBeLessThanOrEqual(6);
      expect(triangles(d!), p).toBeLessThan(6000);
    }
    expect(buildPlaceDressing('cafe')).toBeNull();
  });
});

describe('shop language', () => {
  it('travels by voice in French and English without mistaking orders for trips', () => {
    expect(parseIntent('Allons au bistrot !')).toEqual({ kind: 'travel', place: 'bistrot' });
    expect(parseIntent('Je vais au restaurant')).toEqual({ kind: 'travel', place: 'bistrot' });
    expect(parseIntent('On va au métro')).toEqual({ kind: 'travel', place: 'metro' });
    expect(parseIntent('Je vais prendre le métro')).toEqual({ kind: 'travel', place: 'metro' });
    expect(parseIntent('Direction la pharmacie')).toEqual({ kind: 'travel', place: 'pharmacie' });
    expect(parseVoiceCommand('take me to the pharmacy', idle)).toEqual({ kind: 'travel', place: 'pharmacie' });
    expect(parseVoiceCommand('go to the subway', idle)).toEqual({ kind: 'travel', place: 'metro' });
    expect(parseVoiceCommand("let's go to the bistro", idle)).toEqual({ kind: 'travel', place: 'bistrot' });
    setMenuPlace('metro');
    expect(parseIntent('Je vais prendre un ticket de métro').kind).toBe('order');
    setMenuPlace('cafe');
    expect(parseVoiceCommand('Je vais prendre un café', idle)).toBeNull(); // an order, not a trip
  });

  it('orders a carnet or a metro map instead of opening the Carnet or the map', () => {
    setMenuPlace('metro');
    expect(parseIntent('Un carnet de tickets, s’il vous plaît')).toEqual({ kind: 'order', items: [{ itemId: 'carnet', qty: 1 }] });
    expect(parseIntent('Deux tickets et un plan du métro')).toEqual({ kind: 'order', items: [{ itemId: 'ticket', qty: 2 }, { itemId: 'plan_metro', qty: 1 }] });
    expect(parseVoiceCommand('Un carnet de tickets', idle)).toBeNull();
    expect(parseVoiceCommand('Un plan du métro', idle)).toBeNull();
    expect(parseVoiceCommand('Mon carnet', idle)).toEqual({ kind: 'open', panel: 'carnet' });
    setMenuPlace('cafe');
    expect(parseVoiceCommand('Un plan du métro', idle)).toEqual({ kind: 'open', panel: 'map' });
    expect(parseVoiceCommand('carnet', idle)).toEqual({ kind: 'open', panel: 'carnet' });
  });

  it('understands bistro and pharmacy names, mis-hearings included', () => {
    setMenuPlace('bistrot');
    expect(parseIntent("Un jus d'orange et deux crêpes")).toEqual({ kind: 'order', items: [{ itemId: 'jus_orange', qty: 1 }, { itemId: 'crepe', qty: 2 }] });
    expect(parseIntent('une soupe à l’oignon')).toEqual({ kind: 'order', items: [{ itemId: 'soupe', qty: 1 }] });
    expect(parseIntent("C'est quoi, le plat du jour ?").kind).not.toBe('order');
    expect(parseIntent("L'addition, s'il vous plaît").kind).toBe('ask_price');
    // The café sells "orange" (alias "jus d orange"): at the bistrot that is the juice, not elsewhere.
    expect(findElsewhere('un jus d orange', 'bistrot', PLACES)).toBeNull();
    expect(findElsewhere('un croissant', 'bistrot', PLACES)?.place).toBe('cafe');
    setMenuPlace('pharmacie');
    expect(parseIntent('Une boîte de paracétamol')).toEqual({ kind: 'order', items: [{ itemId: 'paracetamol', qty: 1 }] });
    expect(parseIntent('trois pensements')).toEqual({ kind: 'order', items: [{ itemId: 'pansements', qty: 3 }] });
    expect(parseIntent('Du sirop pour la toux', 2)).toEqual({ kind: 'order', items: [{ itemId: 'sirop', qty: 2 }] });
    setMenuPlace('cafe');
  });
});

function req(place: PlaceId, text: string, over: Partial<AgentRequest['scene']> = {}): AgentRequest {
  return {
    profile: { name: 'Sam', level: 'A1.1', sessions: 2, streakDays: 1, weakWords: [], memories: {}, lastVisit: '' },
    scene: { phase: 'browsing', order: [], totalCents: 0, totalWords: 'zéro euro', trayCents: 0, lookingAt: null, holding: null, scenario: place, special: { itemId: PLACES[place].menu[0].id, challenge: '' }, place, ...over },
    event: { kind: 'say', text, fingers: 0 },
    history: [],
  } as unknown as AgentRequest;
}

describe('offline shopkeepers (no API key)', () => {
  it('greets in each new shop with the shopkeeper, the right agreement and shop replies', () => {
    for (const p of NEW) {
      setMenuPlace(p);
      const t = scriptedTurn({ ...req(p, ''), event: { kind: 'arrive' } } as AgentRequest);
      expect(t.fr).toContain(PLACES[p].shopkeeper.name);
      expect(t.replies).toHaveLength(3);
      expect(t.replies.some((r) => /café/.test(r.fr))).toBe(false); // no café lines outside the café
      const name = scriptedTurn(req(p, "Je m'appelle Sam"));
      expect(name.fr).toMatch(p === 'hotel' ? /^Merci, Sam/ : PLACES[p].shopkeeper.gender === 'm' ? /^Enchanté,/ : /^Enchantée,/);
    }
    setMenuPlace('cafe');
  });

  it('answers small talk: free tap water, directions, where it hurts', () => {
    setMenuPlace('bistrot');
    expect(scriptedTurn(req('bistrot', "Une carafe d'eau, s'il vous plaît")).fr).toMatch(/gratuit/);
    expect(scriptedTurn(req('bistrot', "L'addition, s'il vous plaît", { order: [{ itemId: 'crepe', qty: 1 }], totalCents: 450, totalWords: 'quatre euros cinquante', phase: 'ordering' })).fr).toMatch(/quatre euros cinquante/);
    setMenuPlace('metro');
    expect(scriptedTurn(req('metro', 'Pour aller à Montmartre ?')).fr).toMatch(/Ligne 12/);
    expect(scriptedTurn(req('metro', 'Pour aller à la tour Eiffel ?')).fr).toMatch(/Ligne 6/);
    setMenuPlace('pharmacie');
    expect(scriptedTurn(req('pharmacie', "J'ai mal")).fr).toMatch(/Vous avez mal où/);
    const head = scriptedTurn(req('pharmacie', "J'ai mal à la tête"));
    expect(head.actions).toContainEqual({ type: 'offer', itemId: 'paracetamol', quantity: 1, reason: 'upsell' });
    expect(scriptedTurn(req('pharmacie', "J'ai de la fièvre")).fr).toMatch(/médecin/);
    setMenuPlace('cafe');
  });

  for (const place of NEW) {
    it(`${place}: full offline visit - order, price, pay, change, stamp`, async () => {
      const store = new Store(memoryKV(), '2026-11-13');
      store.startSession();
      appState.place = place;
      setMenuPlace(place);
      setVocabPlace(place);
      const d = new AgentDirector(store, async (r) => scriptedTurn(r), new Set(PLACE_VOCAB[place].map((v) => v.id)));
      const item = MENU[MENU.length - 1];
      const order = await d.handle({ kind: 'say', text: `Un ${item.noun}, s'il vous plaît.`, fingers: 0 });
      expect(order.rejected).toEqual([]);
      expect(store.order.lines.map((l) => l.itemId)).toContain(item.id);
      const price = await d.handle({ kind: 'say', text: PLACE_TEXT[place].bill.fr, fingers: 0 });
      expect(store.order.phase).toBe('paying');
      expect(price.turn.fr).toMatch(/euro|centimes/);
      const total = store.order.lines.reduce((a, l) => a + (MENU.find((m) => m.id === l.itemId)!.priceCents * l.qty), 0);
      const paid = await d.pay(Math.ceil(total / 1000) * 1000);
      expect(paid?.turn.fr).toMatch(/Merci|C'est juste/);
      expect(store.profile.passport.placeOrders[place]).toBe(1);
      expect(store.profile.passport.stamps[place]).toBe('2026-11-13');
      appState.place = 'cafe';
      setMenuPlace('cafe');
      setVocabPlace('cafe');
    });
  }
});

describe("l'hôtel: check-in, nights on the fingers, pay by card", () => {
  it('asks the name, then how many nights', () => {
    setMenuPlace('hotel');
    const hello = scriptedTurn({ ...req('hotel', ''), event: { kind: 'arrive' } } as AgentRequest);
    expect(hello.fr).toMatch(/C'est à quel nom \?/);
    expect(parseIntent('Au nom de Sam')).toEqual({ kind: 'name', name: 'Sam' });
    const name = scriptedTurn(req('hotel', 'Au nom de Sam.'));
    expect(name.fr).toMatch(/Pour combien de nuits \?/);
    expect(name.actions).toContainEqual({ type: 'remember', key: 'name', value: 'Sam' });
    expect(scriptedTurn(req('hotel', "J'ai une réservation.")).fr).toMatch(/C'est à quel nom/);
    expect(scriptedTurn(req('hotel', "Une chambre, s'il vous plaît")).fr).toMatch(/Pour combien de nuits/);
    expect(scriptedTurn(req('hotel', 'À quelle heure est le petit-déjeuner ?')).fr).toMatch(/sept heures à dix heures/);
    // Two fingers up + "nuits".
    expect(parseIntent('nuits', 2)).toEqual({ kind: 'order', items: [{ itemId: 'nuit', qty: 2 }] });
    expect(parseIntent('Deux nuits avec le petit-déjeuner')).toEqual({ kind: 'order', items: [{ itemId: 'nuit', qty: 2 }, { itemId: 'petit_dejeuner', qty: 1 }] });
    const quote = scriptedTurn(req('hotel', "C'est combien ?", { order: [{ itemId: 'nuit', qty: 2 }], totalCents: 18000, totalWords: 'cent quatre-vingts euros', phase: 'ordering' }));
    expect(quote.fr).toMatch(/cent quatre-vingts euros.*carte/);
    setMenuPlace('cafe');
  });

  it('brings out the bank card at the hotel or when the purse cannot cover the bill', () => {
    const purse = WALLET.reduce((a, b) => a + b, 0);
    expect(purse).toBe(2200);
    expect(needsCard('hotel', 120, purse)).toBe(true);
    expect(needsCard('cafe', 340, purse)).toBe(false);
    expect(needsCard('bistrot', 2900, purse)).toBe(true); // two plats du jour
  });

  it('books two nights offline and pays by card (exact, no change)', async () => {
    const store = new Store(memoryKV(), '2026-11-13');
    store.startSession();
    appState.place = 'hotel';
    setMenuPlace('hotel');
    setVocabPlace('hotel');
    const d = new AgentDirector(store, async (r) => scriptedTurn(r), new Set(PLACE_VOCAB.hotel.map((v) => v.id)));
    await d.handle({ kind: 'say', text: 'nuits', fingers: 2 });
    expect(store.order.lines).toContainEqual({ itemId: 'nuit', qty: 2 });
    await d.handle({ kind: 'say', text: "C'est combien ?", fingers: 0 });
    const due = store.order.lines.reduce((a, l) => a + MENU.find((m) => m.id === l.itemId)!.priceCents * l.qty, 0);
    const paid = await d.pay(due, true); // the card pays exactly what is due
    expect(paid?.turn.fr).toMatch(/C'est juste/);
    expect(store.profile.passport.stamps.hotel).toBe('2026-11-13');
    appState.place = 'cafe';
    setMenuPlace('cafe');
    setVocabPlace('cafe');
  });
});

describe('la liste de courses visits the newer shops once they are open', () => {
  it('keeps café, bakery, market for a beginner and rotates the others in later', () => {
    expect(dailyQuest('2026-11-13').tasks.map((t) => t.place)).toEqual(['cafe', 'boulangerie', 'marche']);
    const seen = new Set<string>();
    for (let i = 10; i < 30; i++) {
      const q = dailyQuest(`2026-11-${i}`, undefined, ['bistrot', 'metro', 'pharmacie', 'hotel']);
      expect(q.tasks).toHaveLength(3);
      expect(q.tasks[0].place).toBe('cafe');
      expect(new Set(q.tasks.map((t) => t.place)).size).toBe(3);
      for (const t of q.tasks) {
        seen.add(t.place);
        expect(PLACES[t.place].menu.some((m) => m.id === t.itemId)).toBe(true);
      }
    }
    for (const p of NEW) expect(seen.has(p), p).toBe(true);
  });
});
