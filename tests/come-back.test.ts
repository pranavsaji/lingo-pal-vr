import { describe, expect, it } from 'vitest';
import { parseIntent } from '../src/agent/intent.js';
import { addDays } from '../src/state/dates.js';
import { demoProfile } from '../src/state/demo.js';
import { goalLadder, nextGoal, returnMoment, tomorrowHook, tomorrowList } from '../src/state/goals.js';
import { collectStamps, emptyPassport, nextStamp, notePurchase, STAMP_SLOTS, STAMPS, stampDate, type StampFacts } from '../src/state/passport.js';
import { PLACE_ORDER } from '../src/places/places.js';
import { loadProfile, PROFILE_KEY, type KV } from '../src/state/profile.js';
import { unlockedIds } from '../src/state/progression.js';
import { daysToNextRest, MAX_REST, touchStreakWithRest } from '../src/state/rest-days.js';
import { Store } from '../src/state/store.js';

const memKV = (init: Record<string, string> = {}): KV & { map: Map<string, string> } => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe('jours de repos (streak protection)', () => {
  it('plays like a normal streak when no day is missed', () => {
    const r = touchStreakWithRest('2026-11-12', 4, 1, '2026-11-13');
    expect(r).toMatchObject({ streakDays: 5, isNewDay: true, broken: false, restDays: 1, restUsed: [], restEarned: false });
    expect(touchStreakWithRest('2026-11-13', 5, 1, '2026-11-13')).toMatchObject({ streakDays: 5, isNewDay: false, restDays: 1 });
  });
  it('earns one rest day each 7 days in a row, capped', () => {
    expect(touchStreakWithRest('2026-11-12', 6, 0, '2026-11-13')).toMatchObject({ streakDays: 7, restDays: 1, restEarned: true });
    expect(touchStreakWithRest('2026-11-12', 13, 1, '2026-11-13')).toMatchObject({ streakDays: 14, restDays: 2, restEarned: true });
    expect(touchStreakWithRest('2026-11-12', 20, MAX_REST, '2026-11-13')).toMatchObject({ streakDays: 21, restDays: MAX_REST, restEarned: false });
    // A same-day reload never earns twice.
    expect(touchStreakWithRest('2026-11-13', 7, 1, '2026-11-13')).toMatchObject({ restDays: 1, restEarned: false });
  });
  it('spends rest days automatically on missed days and keeps the streak', () => {
    const one = touchStreakWithRest('2026-11-11', 9, 1, '2026-11-13');
    expect(one).toMatchObject({ streakDays: 10, broken: false, restDays: 0, restUsed: ['2026-11-12'] });
    const two = touchStreakWithRest('2026-11-10', 9, 2, '2026-11-13');
    expect(two).toMatchObject({ streakDays: 10, restDays: 0, restUsed: ['2026-11-11', '2026-11-12'] });
    // Across a month end (local calendar days).
    expect(touchStreakWithRest('2026-11-29', 3, 1, '2026-12-01').restUsed).toEqual(['2026-11-30']);
  });
  it('breaks the streak (and keeps the reserve) when the gap is too long', () => {
    const r = touchStreakWithRest('2026-11-09', 9, 2, '2026-11-13');
    expect(r).toMatchObject({ streakDays: 1, broken: true, restDays: 2, restUsed: [] });
    expect(touchStreakWithRest('', 0, 0, '2026-11-13')).toMatchObject({ streakDays: 1, broken: false, restUsed: [] });
  });
  it('counts days to the next rest day', () => {
    expect(daysToNextRest(5, 0)).toBe(2);
    expect(daysToNextRest(7, 1)).toBe(7);
    expect(daysToNextRest(3, MAX_REST)).toBe(0);
  });
});

const facts = (over: Partial<StampFacts> = {}): StampFacts => ({ passport: emptyPassport(), streakDays: 1, wordsSeen: 0, xp: 0, ...over });

describe('le passeport de Paris', () => {
  it('has unique stamps, one per shop, that fit the passport panel', () => {
    expect(new Set(STAMPS.map((s) => s.id)).size).toBe(STAMPS.length);
    for (const place of PLACE_ORDER) expect(STAMPS.find((s) => s.id === place)?.kind, place).toBe('shop');
    expect(STAMPS.length).toBeLessThanOrEqual(STAMP_SLOTS);
  });
  it('stamps shops, croissants and exact change from real purchases', () => {
    const f = facts();
    expect(collectStamps(f, '2026-11-13')).toEqual([]);
    notePurchase(f.passport, 'cafe', [{ itemId: 'croissant', qty: 2 }, { itemId: 'cafe', qty: 1 }], true);
    expect(collectStamps(f, '2026-11-13').sort()).toEqual(['cafe', 'croissant']);
    expect(f.passport.stamps.cafe).toBe('2026-11-13');
    // Already stamped: never twice.
    notePurchase(f.passport, 'cafe', [], true);
    notePurchase(f.passport, 'cafe', [], true);
    expect(collectStamps(f, '2026-11-14')).toEqual(['appoint']);
    expect(f.passport.stamps.cafe).toBe('2026-11-13');
  });
  it('stamps streak, words and level milestones', () => {
    const f = facts({ streakDays: 7, wordsSeen: 20, xp: 800 });
    expect(collectStamps(f, '2026-11-13').sort()).toEqual(['mots-20', 'niveau-a2', 'serie-3', 'serie-7'].sort());
  });
  it('points at the closest locked stamp', () => {
    const f = facts({ streakDays: 5 });
    f.passport.stamps['serie-3'] = '2026-11-10';
    expect(nextStamp(f)).toMatchObject({ stamp: { id: 'serie-7' }, have: 5, need: 7 });
    expect(stampDate('2026-11-03')).toBe('03/11');
  });
});

describe('goals and tomorrow', () => {
  it('climbs a ladder from A1 to A2', () => {
    const start = goalLadder(0);
    expect(start.label).toBe('A1 > A2');
    expect(start.progress).toBe(0);
    expect(start.next).toEqual({ id: 'A1.2', xpToNext: 150 });
    const mid = goalLadder(400);
    expect(mid.progress).toBeCloseTo(0.5);
    expect(mid.rungs.find((r) => r.current)?.id).toBe('A1.3');
    expect(goalLadder(900).label).toBe('A2 > A2.2');
    expect(goalLadder(5000)).toMatchObject({ progress: 1, next: null });
  });
  it('teases tomorrow: an item from tomorrow\'s list and the nearest unlock', () => {
    const list = tomorrowList('2026-11-13');
    expect(list.fr).toMatch(/^Demain : .+ (au café|à la boulangerie|au marché) \?$/);
    expect(list.en).toMatch(/^Tomorrow: /);
    const base = { xp: 0, streakDays: 6, orders: 5, unlocks: unlockedIds({ xp: 0, streakDays: 6, orders: 5 }), passport: emptyPassport(), today: '2026-11-13' };
    expect(nextGoal(base)?.fr).toBe('Plus que 1 jour pour la terrasse');
    const xpGoal = nextGoal({ ...base, streakDays: 1, xp: 110, unlocks: ['string-lights'] });
    expect(xpGoal?.fr).toBe("Encore 40 XP pour l'ardoise du jour");
    expect(tomorrowHook(base).fr).toContain('la terrasse');
  });
  it('says "Bon retour !" only on the first visit of a new day', () => {
    const base = { name: 'Alex', onboarded: true, sessions: 5, isNewDay: true, broken: false, streakDays: 7, restUsed: [], restEarned: true, newStamps: ['serie-7'], newUnlocks: ['terrasse'], due: 3 };
    const m = returnMoment(base)!;
    expect(m.title).toBe('Bon retour, Alex !');
    expect(m.line.fr).toBe('7 jours de suite · +1 jour de repos · Tampon : 7 jours · 3 mots à réviser');
    expect(m.line.en).toContain('3 words to review');
    expect(m.voice.fr).toBe('Bon retour, Alex ! Sept jours de suite, bravo ! Un nouveau tampon dans votre passeport !');
    expect(returnMoment({ ...base, isNewDay: false })).toBeNull();
    expect(returnMoment({ ...base, sessions: 1 })).toBeNull();
    expect(returnMoment({ ...base, onboarded: false })).toBeNull();
    const saved = returnMoment({ ...base, restUsed: ['2026-11-12'], newStamps: [], newUnlocks: [], restEarned: false, due: 1 })!;
    expect(saved.line.fr).toBe('Série sauvée (1 jour de repos) · 1 mot à réviser');
    expect(saved.voice.fr).toContain('Votre jour de repos a sauvé votre série.');
    expect(saved.voice.fr).toContain('Un mot vous attend');
  });
});

describe('store: passport, rest days and arrival', () => {
  it('stamps purchases through the normal payment path and opens the bakery flowers after 3 orders', () => {
    const kv = memKV();
    const store = new Store(kv, '2026-11-13');
    store.startSession();
    store.setOrder({ phase: 'paid', lines: [{ itemId: 'croissant', qty: 1 }], trayCents: 170, changeCents: 0, changeGiven: false });
    store.recordOrderPaid(true);
    expect(Object.keys(store.profile.passport.stamps).sort()).toEqual(['cafe', 'croissant']);
    expect(store.profile.passport.exactPayments).toBe(1);
  });
  it('loads an old saved profile with safe defaults', () => {
    const kv = memKV({ [PROFILE_KEY]: JSON.stringify({ version: 2, name: 'Old', xp: 300, streakDays: 3, lastPlayedDay: '2026-11-12', sessions: 4, unlocks: [], stats: { orders: 2 } }) });
    const p = loadProfile(kv);
    expect(p.passport).toEqual(emptyPassport());
    expect(p.restDays).toBe(0);
    expect(p.restUsed).toEqual([]);
    expect(p.demo).toBe('');
    const store = new Store(kv, '2026-11-13');
    store.startSession();
    // Retroactive stamps from what the old profile already proves (streak 4 now).
    expect(store.profile.passport.stamps['serie-3']).toBe('2026-11-13');
    expect(store.arrival?.newStamps).toContain('serie-3');
  });
  it('spends a rest day on arrival and announces it', () => {
    const kv = memKV();
    const seed = new Store(kv, '2026-11-13');
    Object.assign(seed.profile, { onboarded: true, sessions: 3, streakDays: 9, lastPlayedDay: '2026-11-11', restDays: 1 });
    seed.markOnboarded(); // persists
    const store = new Store(kv, '2026-11-13');
    store.startSession();
    expect(store.profile.streakDays).toBe(10);
    expect(store.profile.restDays).toBe(0);
    expect(store.profile.restUsed).toEqual(['2026-11-12']);
    expect(store.arrival?.moment?.line.fr).toContain('Série sauvée');
  });
});

describe('?demo=week seed', () => {
  it('is a believable week that turns into a 7-day streak today', () => {
    const today = '2026-11-13';
    const kv = memKV({ [PROFILE_KEY]: JSON.stringify(demoProfile(today, 'week')) });
    const store = new Store(kv, today);
    expect(store.profile.demo).toBe('week');
    expect(Object.keys(store.profile.history).filter((d) => d > addDays(today, -7)).length).toBe(6);
    store.startSession();
    const a = store.arrival!;
    expect(store.profile.streakDays).toBe(7);
    expect(store.profile.restDays).toBe(1);
    expect(a.newStamps).toContain('serie-7');
    expect(a.newUnlocks).toContain('terrasse');
    expect(a.moment?.line.fr).toContain('3 mots à réviser');
    expect(store.weekReport().totals.activeDays).toBe(7); // six seeded days + today's visit
    // A judge can earn stamps quickly: one exact payment, or the first market order.
    expect(store.profile.passport.exactPayments).toBe(2);
    expect(store.profile.passport.placeOrders.marche).toBe(0);
  });
  it('?demo=rest shows a rest day saving the streak', () => {
    const today = '2026-11-13';
    const kv = memKV({ [PROFILE_KEY]: JSON.stringify(demoProfile(today, 'rest')) });
    const store = new Store(kv, today);
    store.startSession();
    expect(store.arrival?.restUsed).toEqual(['2026-11-12']);
    expect(store.profile.streakDays).toBe(7);
  });
});

describe('voice: open the passport', () => {
  it('understands "mon passeport"', () => {
    expect(parseIntent("Mon passeport, s'il vous plaît")).toEqual({ kind: 'command', command: 'passport' });
    expect(parseIntent('mes tampons')).toEqual({ kind: 'command', command: 'passport' });
  });
});

describe('tomorrow teaser follows the shopkeeper plan', () => {
  it('names a planned focus word when tomorrow\'s list contains it', async () => {
    const { tomorrowList } = await import('../src/state/goals.js');
    const { dailyQuest } = await import('../src/state/quest.js');
    const { addDays } = await import('../src/state/dates.js');
    const today = '2026-11-13';
    const q = dailyQuest(addDays(today, 1), ['croissant']);
    const line = tomorrowList(today, ['croissant']);
    if (q.tasks.some((t) => t.itemId === 'croissant')) expect(line.fr).toMatch(/croissant/);
  });
});
