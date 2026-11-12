import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../src/state/dates';
import { dueWords, newCard, review, LADDER } from '../src/state/srs';
import { levelFor, newlyUnlocked, touchStreak, unlockedIds } from '../src/state/progression';
import { makeChange, numberToFrench, priceToFrench, quantityPhrase, menuItem } from '../src/agent/menu';
import { applyActions, emptyOrder, orderTotal, payWith } from '../src/agent/tools';
import { parseIntent } from '../src/agent/intent';
import { scorePronunciation } from '../src/voice/pronunciation';
import { dailySpecial } from '../src/agent/scenarios';

const T = '2026-11-12';
const ctx = { vocabIds: new Set(['croissant', 'cafe', 'pomme', 'fromage', 'fleur']) };

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(daysBetween('2026-11-12', '2026-11-19')).toBe(7);
  });
});

describe('srs', () => {
  it('climbs the 1, 3, 7, 14 day ladder on "good"', () => {
    let c = newCard(T);
    const intervals: number[] = [];
    for (let i = 0; i < 4; i++) {
      c = review(c, 2, T);
      intervals.push(c.intervalDays);
    }
    expect(intervals).toEqual([1, 3, 7, 14]);
    expect(LADDER[4]).toBe(30);
  });
  it('"again" resets and lowers ease, never below 1.3', () => {
    let c = review(review(newCard(T), 2, T), 2, T);
    for (let i = 0; i < 10; i++) c = review(c, 0, T);
    expect(c.reps).toBe(0);
    expect(c.intervalDays).toBe(1);
    expect(c.ease).toBe(1.3);
    expect(c.lapses).toBe(10);
  });
  it('lists due words, weakest first', () => {
    const weak = { ...newCard(T), ease: 1.5 };
    const strong = { ...newCard(T), ease: 2.5 };
    const later = { ...newCard(T), due: addDays(T, 3) };
    expect(dueWords({ a: strong, b: weak, c: later }, T)).toEqual(['b', 'a']);
  });
});

describe('progression', () => {
  it('maps XP to levels', () => {
    expect(levelFor(0).id).toBe('A1.1');
    expect(levelFor(149).id).toBe('A1.1');
    expect(levelFor(150).id).toBe('A1.2');
    expect(levelFor(5000)).toMatchObject({ id: 'A2.2', next: null, progress: 1 });
    expect(levelFor(275).progress).toBeCloseTo(0.5);
  });
  it('tracks the daily streak', () => {
    expect(touchStreak('', 0, T)).toMatchObject({ streakDays: 1, isNewDay: true });
    expect(touchStreak(T, 4, T)).toMatchObject({ streakDays: 4, isNewDay: false });
    expect(touchStreak(addDays(T, -1), 4, T)).toMatchObject({ streakDays: 5, isNewDay: true, broken: false });
    expect(touchStreak(addDays(T, -3), 4, T)).toMatchObject({ streakDays: 1, broken: true });
  });
  it('unlocks decor and scenarios', () => {
    expect(unlockedIds({ xp: 0, streakDays: 1, orders: 0 })).toEqual([]);
    const after = unlockedIds({ xp: 160, streakDays: 2, orders: 1 });
    expect(after).toEqual(expect.arrayContaining(['string-lights', 'plants', 'chalkboard', 'boulangerie']));
    expect(newlyUnlocked(['plants'], after)).not.toContain('plants');
  });
});

describe('menu and French numbers', () => {
  it('says numbers the French way', () => {
    const cases: [number, string][] = [
      [0, 'zéro'], [17, 'dix-sept'], [21, 'vingt et un'], [40, 'quarante'], [70, 'soixante-dix'],
      [71, 'soixante et onze'], [77, 'soixante-dix-sept'], [80, 'quatre-vingts'], [81, 'quatre-vingt-un'],
      [91, 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf'], [100, 'cent'], [200, 'deux cents'], [250, 'deux cent cinquante'],
    ];
    for (const [n, w] of cases) expect(numberToFrench(n)).toBe(w);
  });
  it('says prices', () => {
    expect(priceToFrench(340)).toBe('trois euros quarante');
    expect(priceToFrench(100)).toBe('un euro');
    expect(priceToFrench(160)).toBe('un euro soixante');
    expect(priceToFrench(50)).toBe('cinquante centimes');
    expect(priceToFrench(1070)).toBe('dix euros soixante-dix');
  });
  it('makes change with euro coins', () => {
    expect(makeChange(160)).toEqual([100, 50, 10]);
    expect(makeChange(0)).toEqual([]);
    expect(makeChange(880)).toEqual([500, 200, 100, 50, 20, 10]);
    expect(() => makeChange(-10)).toThrow();
    expect(() => makeChange(15)).toThrow();
  });
  it('agrees quantities with gender', () => {
    expect(quantityPhrase(menuItem('croissant')!, 2)).toBe('deux croissants');
    expect(quantityPhrase(menuItem('baguette')!, 1)).toBe('une baguette');
    expect(quantityPhrase(menuItem('gateau')!, 3)).toBe('trois gâteaux');
  });
});

describe('tool validation (the AI proposes, the game decides)', () => {
  it('serves valid items and computes the total itself', () => {
    const r = applyActions(emptyOrder(), [{ type: 'serve_items', itemId: 'croissant', quantity: 2 }], ctx);
    expect(r.rejected).toEqual([]);
    expect(r.state.lines).toEqual([{ itemId: 'croissant', qty: 2 }]);
    expect(orderTotal(r.state.lines)).toBe(340);
    expect(r.effects).toEqual([{ kind: 'spawn', itemId: 'croissant', quantity: 2 }]);
  });
  it('rejects bad tool calls without throwing', () => {
    const bad = [
      null,
      'serve',
      { type: 'serve_items', itemId: 'licorne', quantity: 1 },
      { type: 'serve_items', itemId: 'cafe', quantity: 0 },
      { type: 'serve_items', itemId: 'cafe', quantity: 9 },
      { type: 'serve_items', itemId: 'cafe', quantity: 1.5 },
      { type: 'give_change', cents: 100 },
      { type: 'quote_total', totalCents: 1 },
      { type: 'remember', key: 'password', value: 'x' },
      { type: 'remember', key: 'name', value: 'x'.repeat(41) },
      { type: 'emote', kind: 'dance' },
      { type: 'point_at', itemId: 'moon' },
      { type: 'drop_tables' },
    ];
    const r = applyActions(emptyOrder(), bad, ctx);
    expect(r.state.lines).toEqual([]);
    expect(r.effects).toEqual([]);
    expect(r.rejected.length).toBe(8); // only the first 8 actions are considered
  });
  it('corrects a wrong total from the model', () => {
    const s = applyActions(emptyOrder(), [{ type: 'serve_items', itemId: 'croissant', quantity: 2 }], ctx).state;
    const r = applyActions(s, [{ type: 'quote_total', totalCents: 300 }], ctx);
    expect(r.effects).toEqual([{ kind: 'show_total', totalCents: 340 }]);
    expect(r.rejected[0].reason).toMatch(/corrected to 340/);
    expect(r.state.phase).toBe('paying');
  });
  it('handles payment deterministically: short, then change', () => {
    let s = applyActions(emptyOrder(), [{ type: 'serve_items', itemId: 'croissant', quantity: 2 }], ctx).state;
    const short = payWith(s, 200);
    expect(short).toMatchObject({ ok: false, shortByCents: 140 });
    const paid = payWith(short.state, 300);
    expect(paid.ok).toBe(true);
    expect(paid.state.changeCents).toBe(160);
    s = paid.state;
    const change = applyActions(s, [{ type: 'give_change', cents: 999 }], ctx);
    expect(change.effects).toEqual([{ kind: 'return_change', cents: 160, coins: [100, 50, 10] }]);
    const twice = applyActions(change.state, [{ type: 'give_change' }], ctx);
    expect(twice.rejected[0].reason).toBe('change already given');
  });
  it('caps one item at 5 and starts a new order after paying', () => {
    let s = applyActions(emptyOrder(), [{ type: 'serve_items', itemId: 'cafe', quantity: 4 }], ctx).state;
    expect(applyActions(s, [{ type: 'serve_items', itemId: 'cafe', quantity: 2 }], ctx).rejected[0].reason).toBe('too many of one item');
    s = payWith(s, 720).state; // exact
    expect(s.changeGiven).toBe(true);
    const next = applyActions(s, [{ type: 'serve_items', itemId: 'pomme', quantity: 1 }], ctx).state;
    expect(next.lines).toEqual([{ itemId: 'pomme', qty: 1 }]);
    expect(next.trayCents).toBe(0);
  });
});

describe('intent parser', () => {
  it('reads orders with number words, digits and fingers', () => {
    expect(parseIntent("Deux croissants, s'il vous plaît.")).toEqual({ kind: 'order', items: [{ itemId: 'croissant', qty: 2 }] });
    expect(parseIntent("croissant s'il vous plait", 3)).toEqual({ kind: 'order', items: [{ itemId: 'croissant', qty: 3 }] });
    expect(parseIntent('un café', 4)).toEqual({ kind: 'order', items: [{ itemId: 'cafe', qty: 1 }] });
    expect(parseIntent('Je voudrais un café et deux pommes')).toEqual({
      kind: 'order',
      items: [{ itemId: 'cafe', qty: 1 }, { itemId: 'pomme', qty: 2 }],
    });
    expect(parseIntent("une bouteille d'eau")).toEqual({ kind: 'order', items: [{ itemId: 'eau', qty: 1 }] });
  });
  it('reads the rest of the cafe conversation', () => {
    expect(parseIntent("C'est combien ?").kind).toBe('ask_price');
    expect(parseIntent('Le croissant, c\'est combien ?').kind).toBe('ask_price');
    expect(parseIntent("Non, c'est tout.").kind).toBe('done_ordering');
    expect(parseIntent("Je m'appelle Pranav")).toEqual({ kind: 'name', name: 'Pranav' });
    expect(parseIntent('Au revoir !').kind).toBe('bye');
    expect(parseIntent('Bonjour madame').kind).toBe('greet');
    expect(parseIntent('Répéter')).toEqual({ kind: 'command', command: 'repeat' });
    expect(parseIntent('réglages')).toEqual({ kind: 'command', command: 'settings' });
    expect(parseIntent('Oui, merci').kind).toBe('thanks');
    expect(parseIntent('Oui').kind).toBe('yes');
    expect(parseIntent('blablabla').kind).toBe('unknown');
  });
});

describe('pronunciation scoring', () => {
  it('gives 100 for a perfect match, ignoring case, accents and punctuation', () => {
    expect(scorePronunciation("Un café, s'il vous plaît.", 'un cafe s il vous plait').score).toBe(100);
  });
  it('flags a missed word without shifting the rest', () => {
    const r = scorePronunciation("Deux croissants, s'il vous plaît.", 'deux croissants vous plait');
    expect(r.words.map((w) => w.status)).toEqual(['ok', 'ok', 'missed', 'missed', 'ok', 'ok']);
    expect(r.score).toBe(67);
  });
  it('marks near misses as close', () => {
    const r = scorePronunciation('le croissant', 'le croisson');
    expect(r.words[1].status).toBe('close');
    expect(r.score).toBeGreaterThan(70);
    expect(r.score).toBeLessThan(100);
  });
  it('scores silence as 0', () => {
    expect(scorePronunciation('bonjour', '').score).toBe(0);
  });
});

describe('daily special', () => {
  it('is stable within a day and only uses unlocked scenarios', () => {
    expect(dailySpecial(T, [])).toEqual(dailySpecial(T, []));
    for (let i = 0; i < 30; i++) expect(dailySpecial(addDays(T, i), []).scenarioId).toBe('cafe');
    const days = new Set(Array.from({ length: 30 }, (_, i) => dailySpecial(addDays(T, i), ['boulangerie', 'marche']).scenarioId));
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('spoken money', async () => {
  const { parseAmountCents } = await import('../src/agent/intent');
  it('parses euros said aloud', () => {
    expect(parseAmountCents('Voilà cinq euros')).toBe(500);
    expect(parseAmountCents('trois euros quarante')).toBe(340);
    expect(parseAmountCents('un euro soixante-dix')).toBe(170);
    expect(parseAmountCents('quatre-vingts centimes')).toBe(80);
    expect(parseAmountCents('un billet de dix')).toBe(1000);
    expect(parseAmountCents('Voici 3,40 €')).toBe(340);
    expect(parseAmountCents('bonjour')).toBeNull();
  });
  it('turns "voila cinq euros" into a payment intent', () => {
    expect(parseIntent('Voilà cinq euros')).toEqual({ kind: 'pay', cents: 500 });
    expect(parseIntent('Je paie')).toEqual({ kind: 'pay', cents: null });
  });
});
