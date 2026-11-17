import { describe, expect, it } from 'vitest';
import { defaultProfile, loadProfile, PROFILE_KEY, type KV } from '../src/state/profile';
import { notePurchase } from '../src/state/passport';
import {
  nextSituationLine,
  nextTrip,
  readiness,
  readinessStrip,
  SITUATIONS,
  todaysPlan,
  tripDaysLeft,
  tripLabel,
} from '../src/state/readiness';
import { Store } from '../src/state/store';
import { appState } from '../src/game-state';

function memKV(init: Record<string, string> = {}): KV {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('Prêt pour Paris readiness', () => {
  it('has four situations in each of the seven places', () => {
    expect(SITUATIONS).toHaveLength(28);
    expect(new Set(SITUATIONS.map((s) => `${s.place}/${s.kind}`)).size).toBe(28);
  });

  it('starts at 0 % and only moves with game-verified events', () => {
    const p = defaultProfile();
    expect(readiness(p).percent).toBe(0);
    notePurchase(p.passport, 'cafe', [{ itemId: 'cafe', qty: 1 }], true); // paid exactly at the café
    const r = readiness(p);
    expect(r.done).toBe(2); // ordered + paid right
    expect(r.places[0].done).toEqual({ order: true, speak: false, pay: true, real: false });
    expect(r.percent).toBe(7);
    expect(readinessStrip(r, 'J-12')).toBe('PRÊT POUR PARIS 7 % · J-12');
    expect(readinessStrip(r, '')).toBe('PRÊT POUR PARIS 7 %');
  });

  it('a change-giving payment is an order but not "pay right"', () => {
    const p = defaultProfile();
    notePurchase(p.passport, 'boulangerie', [{ itemId: 'baguette', qty: 1 }], false);
    expect(readiness(p).places[1].done).toEqual({ order: true, speak: false, pay: false, real: false });
  });

  it('Store records "said it here" (70 %+) and "no help, here" per shop', () => {
    const s = new Store(memKV(), '2026-11-14');
    appState.place = 'marche';
    s.recordPronunciation(65);
    expect(s.profile.passport.placeSpoken.marche).toBeUndefined();
    s.recordPronunciation(82);
    s.recordRealLifeOrder();
    expect(s.profile.passport.placeSpoken.marche).toBe(1);
    expect(s.profile.passport.placeRealLife.marche).toBe(1);
    appState.place = 'cafe';
  });

  it('old saved profiles keep loading, with empty readiness counters and no trip', () => {
    const old = defaultProfile() as unknown as Record<string, unknown>;
    const pp = old.passport as Record<string, unknown>;
    delete pp.placeSpoken;
    delete pp.placeExact;
    delete pp.placeRealLife;
    const settings = old.settings as Record<string, unknown>;
    delete settings.trip;
    delete settings.tripSet;
    (pp.placeOrders as Record<string, number>).cafe = 1;
    old.xp = 107;
    const p = loadProfile(memKV({ [PROFILE_KEY]: JSON.stringify(old) }));
    expect(p.xp).toBe(107);
    expect(p.passport.placeSpoken).toEqual({});
    expect(p.passport.placeExact).toEqual({});
    expect(p.passport.placeRealLife).toEqual({});
    expect(p.settings.trip).toBe(0);
    expect(p.settings.tripSet).toBe('');
    expect(readiness(p).done).toBe(1);
  });
});

describe("today's 10-minute plan", () => {
  it('a brand-new learner is sent to the café, then told what opens next', () => {
    const p = defaultProfile();
    const plan = todaysPlan(p);
    expect(plan[0]).toMatchObject({ place: 'cafe', kind: 'order' });
    expect(plan.some((x) => x.kind === 'unlock' && x.place === 'boulangerie')).toBe(true);
  });

  it('prefers a new open place, then a missing skill where you have ordered, then weak words', () => {
    const p = defaultProfile();
    p.onboarded = true;
    p.stats.orders = 1;
    notePurchase(p.passport, 'cafe', [], false);
    const plan = todaysPlan(p, ['le croissant', 'la baguette']);
    expect(plan.map((x) => `${x.place}/${x.kind}`)).toEqual(['boulangerie/order', 'cafe/speak', 'null/words']);
    expect(plan[2].fr).toBe('Revoir : le croissant, la baguette');
  });

  it('respects unlock order: never plans a locked place except as "what opens it"', () => {
    const p = defaultProfile();
    p.onboarded = true;
    p.stats.orders = 1;
    for (const item of todaysPlan(p, [], 10)) {
      if (item.place === 'bistrot' || item.place === 'metro' || item.place === 'pharmacie' || item.place === 'hotel') expect(item.kind).toBe('unlock');
    }
  });

  it('suggests a no-help order only once the learner was invited to vraie vie', () => {
    const p = defaultProfile();
    p.onboarded = true;
    p.stats.orders = 1;
    p.passport.placeOrders.cafe = 1;
    p.passport.placeSpoken.cafe = 1;
    p.passport.placeExact.cafe = 1;
    expect(todaysPlan(p, [], 10).some((x) => x.kind === 'real')).toBe(false);
    p.realLifeInvited = true;
    expect(todaysPlan(p, [], 10).some((x) => x.kind === 'real' && x.place === 'cafe')).toBe(true);
  });

  it('goodbye line names the first next step', () => {
    const p = defaultProfile();
    expect(nextSituationLine(p)?.fr).toBe('Prochaine étape pour Paris : commander au comptoir du Café Lune.');
  });

  it('goodbye line reads as one natural sentence for every kind of step', () => {
    const p = defaultProfile();
    p.onboarded = true;
    p.stats.orders = 1;
    p.passport.placeOrders.cafe = 1;
    // Next: the bakery is open and never visited.
    expect(nextSituationLine(p)).toEqual({ fr: 'Prochaine étape pour Paris : acheter votre pain à la boulangerie.', en: 'Next step for Paris: buy your bread at the bakery.' });
    p.passport.placeOrders.boulangerie = 1;
    p.passport.placeOrders.marche = 1;
    // Every shop is open after the tutorial: the next one on the map is the bistrot.
    expect(nextSituationLine(p)?.fr).toBe('Prochaine étape pour Paris : commander un déjeuner au bistrot.');
    for (const pl of ['bistrot', 'metro', 'pharmacie', 'hotel'] as const) p.passport.placeOrders[pl] = 1;
    // Everything has been ordered in: say it out loud at the café.
    expect(nextSituationLine(p)?.fr).toBe('Prochaine étape pour Paris : commander à voix haute au Café Lune.');
  });
});

describe('Mon voyage à Paris (trip countdown)', () => {
  it('cycles none > 7 > 14 > 30 > none', () => {
    expect([nextTrip(0), nextTrip(7), nextTrip(14), nextTrip(30)]).toEqual([7, 14, 30, 0]);
  });

  it('counts down from the day it was set', () => {
    expect(tripLabel(0, '', '2026-11-14')).toBe('');
    expect(tripDaysLeft(14, '2026-11-14', '2026-11-16')).toBe(12);
    expect(tripLabel(14, '2026-11-14', '2026-11-16')).toBe('J-12');
    expect(tripLabel(7, '2026-11-01', '2026-11-14')).toBe('Jour J');
  });
});

describe('voice: "Prêt pour Paris"', () => {
  it('opens the readiness view (and "Paris" alone still opens the map)', async () => {
    const { parseVoiceCommand } = await import('../src/voice/voice-commands');
    const idle = { paying: false, inputMode: 'hands' } as never;
    expect(parseVoiceCommand('Prêt pour Paris ?', idle)).toEqual({ kind: 'open', panel: 'ready' });
    expect(parseVoiceCommand('Am I ready for Paris', idle)).toEqual({ kind: 'open', panel: 'ready' });
    expect(parseVoiceCommand('Paris', idle)).toEqual({ kind: 'open', panel: 'map' });
  });
});
