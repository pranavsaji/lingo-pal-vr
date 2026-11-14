/** A reply still on its way when the learner travels must not land in the next shop. */
import { describe, expect, it } from 'vitest';
import { AgentDirector } from '../src/agent/director';
import { scriptedTurn } from '../src/agent/script';
import { Store } from '../src/state/store';
import type { KV } from '../src/state/profile';
import { events } from '../src/game-state';

const VOCAB = new Set(['croissant', 'cafe', 'baguette']);
const kv = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('travel while the shopkeeper is answering', () => {
  it('drops the in-flight and queued turns of the previous shop', async () => {
    const store = new Store(kv(), '2026-11-14');
    store.startSession();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (req: Parameters<typeof scriptedTurn>[0]) => {
      await gate;
      return scriptedTurn(req);
    };
    const director = new AgentDirector(store, slow, VOCAB);
    const said: string[] = [];
    const off = events.subtitle.on((s) => s.who === 'lune' && said.push(s.fr));

    const inFlight = director.handle({ kind: 'say', text: "Deux croissants, s'il vous plaît.", fingers: 2 });
    const queued = director.handle({ kind: 'say', text: "C'est combien ?", fingers: 0 });
    director.resetConversation(); // the learner travelled
    release();
    const [a, b] = await Promise.all([inFlight, queued]);
    off();

    expect(a.turn.fr).toBe('');
    expect(b.turn.fr).toBe('');
    expect(said).toEqual([]);
    expect(store.order.lines).toEqual([]);
  });
});
