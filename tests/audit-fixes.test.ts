/** Regression tests for the code-audit fixes (payment, change, order edits). */
import { describe, expect, it } from 'vitest';
import { AgentDirector } from '../src/agent/director';
import { scriptedTurn } from '../src/agent/script';
import { applyActions, emptyOrder } from '../src/agent/tools';
import { Store } from '../src/state/store';
import type { KV } from '../src/state/profile';

const VOCAB = new Set(['croissant', 'cafe', 'baguette']);
const kv = (): KV => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('the AI forgets give_change after payment', () => {
  it('the game hands the change back, so the next order is not refused', async () => {
    const store = new Store(kv(), '2026-11-14');
    store.startSession();
    // The "model": the scripted shopkeeper, minus any give_change on the paid turn.
    const forgetful = async (req: Parameters<typeof scriptedTurn>[0]) => {
      const t = scriptedTurn(req);
      return req.event.kind === 'paid' ? { ...t, actions: t.actions.filter((a) => (a as { type?: string }).type !== 'give_change') } : t;
    };
    const director = new AgentDirector(store, forgetful, VOCAB);
    await director.handle({ kind: 'say', text: "Deux croissants, s'il vous plaît.", fingers: 2 });
    await director.handle({ kind: 'say', text: "C'est tout, merci.", fingers: 0 });
    expect(store.order.lines.length).toBeGreaterThan(0);
    await director.pay(1000);
    expect(store.order.phase).toBe('paid');
    expect(store.order.changeGiven).toBe(true);
  });
});

describe('changing your mind after the total', () => {
  it('removes an item while nothing is on the tray yet, and asks for a new total', () => {
    const s0 = { ...emptyOrder(), phase: 'paying' as const, lines: [{ itemId: 'croissant', qty: 2 }, { itemId: 'cafe', qty: 1 }] };
    const ctx = { vocabIds: VOCAB, stock: {} as never };
    const r = applyActions(s0 as never, [{ type: 'remove_item', itemId: 'cafe' }], ctx);
    expect(r.rejected).toEqual([]);
    expect(r.state.lines.map((l) => l.itemId)).toEqual(['croissant']);
    expect(r.state.phase).toBe('ordering');
    const paidSome = applyActions({ ...s0, trayCents: 200 } as never, [{ type: 'remove_item', itemId: 'cafe' }], ctx);
    expect(paidSome.rejected.length).toBe(1);
  });
});
