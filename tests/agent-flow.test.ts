/**
 * End-to-end "wow moment" through the real director, store and offline agent:
 * name -> "Deux croissants" -> price -> pay 5 EUR -> change -> "A demain, Pranav !"
 * -> next day she remembers. Also checks the server's tool-call mapping.
 */
import { describe, expect, it } from 'vitest';
import { AgentDirector } from '../src/agent/director';
import { scriptedTurn } from '../src/agent/script';
import { Store } from '../src/state/store';
import type { KV } from '../src/state/profile';
import { events } from '../src/game-state';
import type { Effect } from '../src/agent/tools';
// @ts-expect-error plain ESM server module
import { handleAgent, toTurn } from '../server/agent-handler.mjs';

const VOCAB = new Set(['croissant', 'cafe', 'baguette', 'pomme', 'orange', 'fromage', 'eau', 'gateau', 'assiette', 'verre', 'menu', 'fleur']);

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const scriptTransport = async (req: Parameters<typeof scriptedTurn>[0]) => scriptedTurn(req);

describe('wow moment, offline agent', () => {
  it('runs the full order and remembers the learner the next day', async () => {
    const kv = memoryKV();
    const store = new Store(kv, '2026-11-12');
    store.startSession();
    const director = new AgentDirector(store, scriptTransport, VOCAB);
    const effects: Effect[] = [];
    const off = events.effects.on((e) => effects.push(...e));

    const hello = await director.handle({ kind: 'arrive' });
    expect(hello.turn.fr).toMatch(/Comment vous appelez-vous/);

    await director.handle({ kind: 'say', text: "Je m'appelle Pranav", fingers: 0 });
    expect(store.profile.name).toBe('Pranav');

    // Two fingers up + "Deux croissants, s'il vous plait."
    const order = await director.handle({ kind: 'say', text: "Deux croissants, s'il vous plaît.", fingers: 2 });
    expect(order.rejected).toEqual([]);
    expect(store.order.lines).toEqual([{ itemId: 'croissant', qty: 2 }]);
    expect(effects).toContainEqual({ kind: 'spawn', itemId: 'croissant', quantity: 2 });

    const price = await director.handle({ kind: 'say', text: "C'est combien ?", fingers: 0 });
    expect(price.turn.fr).toMatch(/trois euros quarante/);
    expect(store.order.phase).toBe('paying');

    const xpBefore = store.profile.xp;
    const paid = await director.pay(500);
    expect(paid?.turn.fr).toMatch(/Je vous rends un euro soixante/);
    expect(effects).toContainEqual({ kind: 'return_change', cents: 160, coins: [100, 50, 10] });
    expect(store.profile.stats.orders).toBe(1);
    expect(store.profile.xp).toBeGreaterThan(xpBefore);
    expect(store.profile.memories.favorite_order).toBe('deux croissants');

    const bye = await director.handle({ kind: 'say', text: 'Au revoir !', fingers: 0 });
    expect(bye.turn.fr).toBe('À demain, Pranav ! Bonne journée ! Demain, on travaille les viennoiseries !'); // she plans tomorrow from today
    expect(store.profile.lastVisit).toMatch(/2026-11-12/);
    off();

    // Next day, fresh app launch on the same storage.
    const tomorrow = new Store(kv, '2026-11-13');
    const start = tomorrow.startSession();
    expect(tomorrow.profile.streakDays).toBe(2);
    expect(start.newUnlocks).toContain('plants');
    const d2 = new AgentDirector(tomorrow, scriptTransport, VOCAB);
    const greet = await d2.handle({ kind: 'arrive' });
    expect(greet.turn.fr).toMatch(/^Re-bonjour, Pranav ! Comme hier, deux croissants \?/);
  });

  it('says what is missing when the learner underpays', async () => {
    const store = new Store(memoryKV(), '2026-11-12');
    const d = new AgentDirector(store, scriptTransport, VOCAB);
    await d.handle({ kind: 'say', text: 'un gâteau', fingers: 0 });
    const r = await d.pay(200);
    expect(r?.turn.fr).toMatch(/Il manque un euro quatre-vingts/);
    expect(store.order.phase).toBe('paying');
  });

  it('serializes overlapping turns in order', async () => {
    const store = new Store(memoryKV(), '2026-11-12');
    const d = new AgentDirector(store, scriptTransport, VOCAB);
    const a = d.handle({ kind: 'say', text: 'un café', fingers: 0 });
    const b = d.handle({ kind: 'say', text: 'deux pommes', fingers: 0 });
    await Promise.all([a, b]);
    expect(store.order.lines).toEqual([{ itemId: 'cafe', qty: 1 }, { itemId: 'pomme', qty: 2 }]);
  });
});

describe('server agent mapping', () => {
  it('maps tool_use blocks to a turn', () => {
    const turn = toTurn([
      { type: 'tool_use', name: 'serve_items', input: { itemId: 'croissant', quantity: 2 } },
      {
        type: 'tool_use',
        name: 'speak',
        input: { fr: 'Voilà !', en: 'Here!', points: 30, replies: [{ fr: 'a', en: 'a' }, { fr: 'b', en: 'b' }, { fr: 'c', en: 'c' }] },
      },
      { type: 'tool_use', name: 'emote', input: { kind: 'nod' } },
    ]);
    expect(turn).toMatchObject({ fr: 'Voilà !', points: 20 });
    expect(turn.actions).toEqual([{ type: 'serve_items', itemId: 'croissant', quantity: 2 }, { type: 'emote', kind: 'nod' }]);
  });
  it('rejects a turn without speak replies, and works without a key', async () => {
    expect(toTurn([{ type: 'text', text: 'Bonjour' }])).toBeNull();
    const r = await handleAgent({}, {});
    expect(r.status).toBe(503);
  });
});
