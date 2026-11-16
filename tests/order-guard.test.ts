import { describe, expect, it } from 'vitest';
import { askedCounts } from '../src/agent/intent';
import { holdToAskedCounts } from '../src/agent/order-guard';
import type { AgentTurn } from '../src/agent/protocol';
import { emptyOrder } from '../src/agent/tools';

const turn = (actions: unknown[], fr = 'Voilà trois croissants !', en = 'Here are three croissants!'): AgentTurn => ({ fr, en, replies: [], actions, points: 0, source: 'ai' });

describe('the learner says how many; the game serves that many', () => {
  it('reads the counts the learner gave (number words or fingers), not defaults', () => {
    expect(askedCounts('Deux croissants, s’il vous plaît')).toEqual([{ itemId: 'croissant', qty: 2 }]);
    expect(askedCounts('Un croissant', 0)).toEqual([{ itemId: 'croissant', qty: 1 }]);
    expect(askedCounts('Croissant, s’il vous plaît', 3)).toEqual([{ itemId: 'croissant', qty: 3 }]);
    expect(askedCounts('Croissant, s’il vous plaît', 0)).toEqual([]); // no count given: the model decides
    expect(askedCounts('Combien coûte un croissant ?')).toEqual([]); // a question, not an order
  });

  it('a model that serves three when two were asked is held to two, and her line says two', () => {
    const { turn: t, fixes } = holdToAskedCounts(turn([{ type: 'serve_items', itemId: 'croissant', quantity: 3 }]), [{ itemId: 'croissant', qty: 2 }], emptyOrder());
    expect(fixes).toEqual([{ itemId: 'croissant', from: 3, to: 2 }]);
    expect((t.actions[0] as { quantity: number }).quantity).toBe(2);
    expect(t.fr).toBe('Voilà deux croissants !');
    expect(t.en).toBe('Here are two croissants!');
  });

  it('leaves a correct serve, an item already on the counter, and a sold-out swap alone', () => {
    const ok = holdToAskedCounts(turn([{ type: 'serve_items', itemId: 'croissant', quantity: 2 }]), [{ itemId: 'croissant', qty: 2 }], emptyOrder());
    expect(ok.fixes).toEqual([]);
    const already = holdToAskedCounts(turn([{ type: 'serve_items', itemId: 'croissant', quantity: 1 }]), [{ itemId: 'croissant', qty: 3 }], {
      ...emptyOrder(),
      phase: 'ordering',
      lines: [{ itemId: 'croissant', qty: 2 }],
    });
    expect(already.fixes).toEqual([]);
    const sold = holdToAskedCounts(turn([{ type: 'serve_items', itemId: 'cafe', quantity: 1 }]), [{ itemId: 'cafe', qty: 3 }], emptyOrder(), { cafe: 1 });
    expect(sold.fixes).toEqual([]);
  });

  it('fixes the count without rewriting a line where the number is ambiguous or singular', () => {
    const amb = holdToAskedCounts(turn([{ type: 'serve_items', itemId: 'croissant', quantity: 3 }], 'Trois croissants et trois cafés ?'), [{ itemId: 'croissant', qty: 2 }], emptyOrder());
    expect((amb.turn.actions[0] as { quantity: number }).quantity).toBe(2);
    expect(amb.turn.fr).toBe('Trois croissants et trois cafés ?');
    const one = holdToAskedCounts(turn([{ type: 'serve_items', itemId: 'croissant', quantity: 1 }], 'Voilà un croissant.'), [{ itemId: 'croissant', qty: 2 }], emptyOrder());
    expect((one.turn.actions[0] as { quantity: number }).quantity).toBe(2);
    expect(one.turn.fr).toBe('Voilà un croissant.');
  });
});
