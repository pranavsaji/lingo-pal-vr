import { describe, expect, it } from 'vitest';
import { PLACES } from '../src/agent/menu.js';
import { emptyLog, logFor, weekReport, type History } from '../src/state/history.js';
import { applyPaidOrder, dailyQuest, pendingHere, questComplete } from '../src/state/quest.js';
import { Store } from '../src/state/store.js';

describe('la liste de courses', () => {
  it('is stable for a day, new the next day, one task per shop from its menu', () => {
    const a = dailyQuest('2026-11-13');
    expect(dailyQuest('2026-11-13')).toEqual(a);
    expect(a.tasks.map((t) => t.place)).toEqual(['cafe', 'boulangerie', 'marche']);
    for (const t of a.tasks) {
      expect(PLACES[t.place].menu.some((m) => m.id === t.itemId)).toBe(true);
      expect(t.qty).toBeGreaterThanOrEqual(1);
      expect(t.qty).toBeLessThanOrEqual(3);
    }
    const days = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(dailyQuest(`2026-11-${10 + i}`).tasks.map((t) => [t.itemId, t.qty]))));
    expect(days.size).toBeGreaterThan(5);
  });
  it('ticks a task only when enough is paid in the right shop', () => {
    const q = dailyQuest('2026-11-13');
    const cafe = q.tasks[0];
    expect(applyPaidOrder(q, 'boulangerie', [{ itemId: cafe.itemId, qty: 5 }]).length).toBe(0);
    if (cafe.qty > 1) expect(applyPaidOrder(q, 'cafe', [{ itemId: cafe.itemId, qty: cafe.qty - 1 }]).length).toBe(0);
    expect(applyPaidOrder(q, 'cafe', [{ itemId: cafe.itemId, qty: cafe.qty }]).length).toBe(1);
    expect(pendingHere(q, 'cafe')).toBeNull();
    expect(questComplete(q)).toBe(false);
  });
  it('pays the bonus once when the whole list is done (store)', () => {
    const kv = new Map<string, string>();
    const store = new Store({ getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) }, '2026-11-13');
    const q = store.questToday();
    const xp0 = store.profile.xp;
    let completed = false;
    for (const t of q.tasks) completed = store.questPaid(t.place, [{ itemId: t.itemId, qty: t.qty }]).completed || completed;
    expect(completed).toBe(true);
    expect(store.profile.xp).toBe(xp0 + 60);
    expect(store.questPaid('cafe', [{ itemId: q.tasks[0].itemId, qty: 9 }]).completed).toBe(false);
  });
});

describe('weekly report', () => {
  it('totals the last seven days and compares with the week before', () => {
    const h: History = {};
    logFor(h, '2026-11-13').xp = 50;
    logFor(h, '2026-11-13').seconds = 600;
    logFor(h, '2026-11-11').xp = 120;
    Object.assign(logFor(h, '2026-11-10'), { pronSum: 160, pronCount: 2, newWords: 4, orders: 2 });
    logFor(h, '2026-11-02').xp = 30; // previous week
    const r = weekReport(h, '2026-11-13');
    expect(r.days).toHaveLength(7);
    expect(r.days[6]).toMatchObject({ day: '2026-11-13', isToday: true, xp: 50, minutes: 10 });
    expect(r.totals).toMatchObject({ xp: 170, minutes: 10, newWords: 4, orders: 2 });
    expect(r.pronunciation).toBe(80);
    expect(r.lastWeek.xp).toBe(30);
    expect(r.bestDay?.day).toBe('2026-11-11');
    expect(r.days.map((d) => d.label).join('')).toBe('SDLMMJV'); // Nov 7, 2026 is a Saturday
  });
  it('keeps only the last 28 days', () => {
    const h: History = { '2026-09-01': emptyLog() };
    logFor(h, '2026-11-13');
    expect(Object.keys(h)).toEqual(['2026-11-13']);
  });
});
