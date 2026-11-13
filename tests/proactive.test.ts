/**
 * Proactive shopkeeper: mistake memory, hesitation/gaze hints (rate limited),
 * low stock + substitutes, upsell, the wrong-change test, and tomorrow's plan.
 * Runs through the real director, store and offline script (no API calls).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { caughtTrick, lowStockToday, shouldTrickChange, substituteFor, trickAmount, upsellFor, type TrickInput } from '../src/agent/agency';
import { AgentDirector } from '../src/agent/director';
import { MENU, menuItem, PLACES, setMenuPlace } from '../src/agent/menu';
import { DEFAULT_COACH, HintCoach, hintTurn, levelTier, type CoachContext } from '../src/agent/proactive';
import { scriptedTurn } from '../src/agent/script';
import { applyActions, emptyOrder } from '../src/agent/tools';
import { appState, events } from '../src/game-state';
import { easeMistake, fingersConfusion, MAX_MISTAKES, mistakeNote, numberConfusion, recordMistake, topMistakes, type Mistake } from '../src/state/mistakes';
import { planTomorrow } from '../src/state/plan';
import { dailyQuest } from '../src/state/quest';
import type { KV } from '../src/state/profile';
import { Store } from '../src/state/store';
import type { Effect } from '../src/agent/tools';
// @ts-expect-error plain ESM server module
import { systemPrompt, toolsFor } from '../server/agent-handler.mjs';

const DAY = '2026-11-13';
const VOCAB = new Set(PLACES.cafe.menu.map((m) => m.id).concat(PLACES.cafe.words));

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const scriptTransport = async (req: Parameters<typeof scriptedTurn>[0]) => scriptedTurn(req);

/** A learner past the tutorial with one order done, at the café. */
function regular(kv: KV = memoryKV(), day = DAY) {
  const store = new Store(kv, day);
  store.profile.onboarded = true;
  store.profile.stats.orders = 1;
  store.profile.name = 'Pranav';
  const director = new AgentDirector(store, scriptTransport, VOCAB, () => 0.99);
  return { store, director };
}

function collect() {
  const effects: Effect[] = [];
  const notes: string[] = [];
  const offs = [events.effects.on((e) => effects.push(...e)), events.agentNote.on((n) => notes.push(n))];
  return { effects, notes, off: () => offs.forEach((f) => f()) };
}

beforeEach(() => {
  appState.place = 'cafe';
  appState.lessonActive = false;
  setMenuPlace('cafe');
});

// ---- Mistake memory -----------------------------------------------------------------

describe('mistake memory', () => {
  it('merges repeats, stays bounded, ranks by count, fades when said right', () => {
    const list: Mistake[] = [];
    recordMistake(list, { kind: 'quantity', want: 'deux', got: 'douze' }, DAY);
    recordMistake(list, { kind: 'quantity', want: 'deux', got: 'douze' }, DAY);
    recordMistake(list, { kind: 'pronunciation', want: 'croissant', got: '' }, DAY);
    expect(list).toHaveLength(2);
    expect(topMistakes(list, 1)[0]).toMatchObject({ want: 'deux', got: 'douze', count: 2 });
    for (let i = 0; i < 30; i++) recordMistake(list, { kind: 'payment', want: `${i},00 €`, got: '1,00 €' }, DAY);
    expect(list.length).toBe(MAX_MISTAKES);
    expect(list.some((m) => m.want === 'deux')).toBe(true); // the repeated one survives
    recordMistake(list, { kind: 'quantity', want: 'trois', got: 'trois' }, DAY); // not a mistake
    expect(list.some((m) => m.want === 'trois')).toBe(false);
    easeMistake(list, 'deux');
    easeMistake(list, 'deux');
    expect(list.some((m) => m.want === 'deux')).toBe(false);
    expect(mistakeNote({ kind: 'quantity', want: 'deux', got: 'douze', count: 1, last: DAY })).toBe('deux ≠ douze');
  });

  it('detects number confusions in speech and between fingers and words', () => {
    expect(numberConfusion("Deux croissants, s'il vous plaît.", 'douze croissants sil vous plait')).toEqual({ want: 'deux', got: 'douze' });
    expect(numberConfusion("Deux croissants, s'il vous plaît.", '2 croissants')).toBeNull();
    expect(numberConfusion("C'est combien ?", 'deux')).toBeNull();
    expect(fingersConfusion('deux cafés', 3)).toEqual({ want: 'trois', got: 'deux' });
    expect(fingersConfusion('un café', 3)).toBeNull(); // "un" may be an article
    expect(fingersConfusion('trois cafés', 3)).toBeNull();
  });

  it('records a misheard number, serves what was meant, and notes it visibly', async () => {
    const { store, director } = regular();
    const c = collect();
    const misheard = director.observeSpeech({ text: 'douze croissants', target: "Deux croissants, s'il vous plaît.", score: 60, missed: ['deux'] });
    expect(misheard).toBe('deux≠douze');
    const r = await director.handle({ kind: 'say', text: 'douze croissants', fingers: 0, misheard });
    expect(r.turn.fr).toMatch(/^Douze \? Non, deux !/);
    expect(store.order.lines.find((l) => l.itemId === 'croissant')?.qty).toBeGreaterThanOrEqual(1);
    expect(c.effects.some((e) => e.kind === 'correction' && e.expected === 'deux')).toBe(true);
    expect(c.notes).toContain('Lune note : deux ≠ douze');
    expect(store.topMistakes(1)[0]).toMatchObject({ kind: 'quantity', want: 'deux', got: 'douze' });
    c.off();
  });

  it('sends the top mistakes to the shopkeeper and reuses them in the next greeting', async () => {
    const kv = memoryKV();
    const { store } = regular(kv);
    store.recordMistake('quantity', 'deux', 'douze');
    const d2 = new AgentDirector(new Store(kv, '2026-11-14'), scriptTransport, VOCAB);
    const req = d2.buildRequest({ kind: 'arrive' });
    expect(req.profile.mistakes).toEqual(['quantity:deux≠douze']);
    const c = collect();
    const hello = await d2.handle({ kind: 'arrive' });
    expect(hello.turn.fr).toMatch(/Petit rappel : deux, pas douze !/);
    expect(hello.turn.replies.some((r) => /^Deux /.test(r.fr))).toBe(true);
    expect(c.notes).toContain('Lune note : deux ≠ douze');
    c.off();
  });

  it('remembers asking for another shop’s item and offers a substitute', async () => {
    const { store, director } = regular();
    const c = collect();
    const r = await director.handle({ kind: 'say', text: "Un pain au chocolat, s'il vous plaît.", fingers: 0 });
    expect(r.turn.fr).toMatch(/pas de pains au chocolat ici\. C'est à la boulangerie/);
    expect(store.order.lines).toEqual([]); // not served as "pain" (a baguette)
    expect(c.effects.some((e) => e.kind === 'offer' && e.reason === 'substitute')).toBe(true);
    expect(store.topMistakes(1)[0]).toMatchObject({ kind: 'unknown_item', want: 'pain au chocolat' });
    expect(c.notes[0]).toBe('Lune note : pas de pain au chocolat ici');
    c.off();
  });

  it('remembers an underpayment only when the learner chose the amount', async () => {
    const { store, director } = regular();
    await director.handle({ kind: 'say', text: 'un fromage', fingers: 0 });
    await director.pay(200); // a coin dropped: paying in steps is fine
    expect(store.profile.coach.mistakes).toEqual([]);
    await director.pay(100, true); // "Voilà un euro" when 2,50 € is due
    expect(store.profile.coach.mistakes[0]).toMatchObject({ kind: 'payment', want: '2,50 €', got: '1,00 €' });
  });
});

// ---- Hints without asking ------------------------------------------------------------

describe('hint coach', () => {
  const ctx = (over: Partial<CoachContext> = {}): CoachContext => ({
    eligible: true,
    phase: 'browsing',
    awaitingAnswer: false,
    lookingAt: null,
    gazeWorthy: () => true,
    ...over,
  });

  it('fires on hesitation after ~9 s, then waits longer each unanswered time', () => {
    const c = new HintCoach();
    c.newVisit(0);
    expect(c.tick(8000, ctx())).toBeNull();
    expect(c.tick(9000, ctx())).toEqual({ reason: 'hesitate', nth: 0 });
    expect(c.tick(20000, ctx())).toBeNull(); // min gap 25 s
    expect(c.tick(26999, ctx())).toBeNull(); // second wait is 18 s after the hint, and the gap
    expect(c.tick(34000, ctx())).toEqual({ reason: 'hesitate', nth: 1 });
    expect(c.tick(34000 + 36000 - 1, ctx())).toBeNull(); // third wait 36 s
    expect(c.tick(34000 + 36000, ctx())).toEqual({ reason: 'hesitate', nth: 2 });
  });

  it('never nags: activity resets, ineligible pauses the clock, max per visit', () => {
    const c = new HintCoach({ ...DEFAULT_COACH, minGapMs: 0, maxPerVisit: 2 });
    c.newVisit(0);
    c.activity(5000);
    expect(c.tick(13000, ctx())).toBeNull();
    expect(c.tick(14000, ctx())?.reason).toBe('hesitate');
    // She is talking / a turn is pending: no hesitation accumulates.
    expect(c.tick(60000, ctx({ eligible: false }))).toBeNull();
    expect(c.tick(61000, ctx())).toBeNull();
    c.activity(61000);
    expect(c.tick(70000, ctx())?.reason).toBe('hesitate');
    expect(c.tick(200000, ctx())).toBeNull(); // 2 per visit
    c.newVisit(200000);
    expect(c.tick(209000, ctx())?.reason).toBe('hesitate');
  });

  it('gaze: 1.5 s on a worthwhile item while not acting, once per item; quiet after payment', () => {
    const c = new HintCoach({ ...DEFAULT_COACH, minGapMs: 0, hesitateMs: 60000 });
    c.newVisit(0);
    expect(c.tick(3000, ctx({ lookingAt: 'fromage' }))).toBeNull();
    expect(c.tick(4400, ctx({ lookingAt: 'fromage' }))).toBeNull(); // 1.4 s of gaze
    expect(c.tick(4500, ctx({ lookingAt: 'fromage' }))).toEqual({ reason: 'gaze', itemId: 'fromage', nth: 0 });
    c.activity(5000);
    expect(c.tick(7000, ctx({ lookingAt: 'orange' }))).toBeNull();
    expect(c.tick(8600, ctx({ lookingAt: 'orange' }))).toBeNull(); // just acted: looking while doing
    expect(c.tick(9000, ctx({ lookingAt: 'orange' }))?.reason).toBe('gaze');
    expect(c.tick(20000, ctx({ lookingAt: 'pomme', gazeWorthy: () => false }))).toBeNull();
    c.tick(21000, ctx({ lookingAt: null }));
    expect(c.tick(21100, ctx({ lookingAt: 'fromage' }))).toBeNull();
    expect(c.tick(24000, ctx({ lookingAt: 'fromage' }))).toBeNull(); // already hinted
    expect(c.tick(60000, ctx({ phase: 'paid' }))).toBeNull(); // order done: she does not hover
    expect(c.tick(60000 + 120000, ctx({ phase: 'paid', awaitingAnswer: true }))?.reason).toBe('hesitate'); // 60 s x2 (one unanswered hint)
  });

  it('scales the hint to the level and costs no API call', async () => {
    expect([levelTier('A1.1'), levelTier('A1.3'), levelTier('A2.1')]).toEqual([0, 1, 2]);
    const { store, director } = regular();
    let calls = 0;
    const d = new AgentDirector(store, async (req) => (calls++, scriptedTurn(req)), VOCAB);
    const c = collect();
    const gaze = await d.handle({ kind: 'hint', reason: 'gaze', itemId: 'fromage', nth: 0 });
    expect(calls).toBe(0);
    expect(gaze.turn.fr).toBe("Ça, c'est le fromage. Dites : « Un fromage, s'il vous plaît. »");
    expect(gaze.effects).toContainEqual({ kind: 'point', itemId: 'fromage' });
    expect(c.notes).toContain('Lune note : vous regardez le fromage');
    const req = director.buildRequest({ kind: 'hint', reason: 'gaze', itemId: 'fromage', nth: 0 });
    req.profile.level = 'A2.1';
    expect(hintTurn(req, { reason: 'gaze', itemId: 'fromage', nth: 0 }).fr).toBe('Le fromage vous fait envie ?');
    const slow = await d.handle({ kind: 'hint', reason: 'hesitate', nth: 1 });
    expect(slow.turn.replies[0].fr).toBe("Plus lentement, s'il vous plaît.");
    await d.handle({ kind: 'say', text: "Plus lentement, s'il vous plaît.", fingers: 0 });
    expect(store.profile.settings.slowSpeech).toBe(true);
    c.off();
  });

  it('a hesitation hint uses the shopping list when there is one', () => {
    const { director } = regular();
    const req = director.buildRequest({ kind: 'hint', reason: 'hesitate', nth: 0 });
    req.profile.level = 'A1.1';
    req.scene.shoppingList = '2 croissant';
    expect(hintTurn(req, { reason: 'hesitate', nth: 0 }).fr).toBe("Votre liste : deux croissants. Dites : « Deux croissants, s'il vous plaît. »");
  });
});

// ---- Multi-step agency -----------------------------------------------------------------

describe('agency in the world', () => {
  it('picks substitutes and pairings the shop sells', () => {
    const none = () => false;
    expect(substituteFor('croissant', PLACES.boulangerie.menu, none)?.id).toBe('pain_chocolat');
    expect(substituteFor('croissant', PLACES.cafe.menu, none)?.id).toBe('gateau');
    expect(substituteFor('pomme', PLACES.marche.menu, (id) => id === 'poire')?.id).toBe('banane');
    expect(upsellFor(['cafe'], PLACES.cafe.menu, none)?.id).toBe('croissant');
    expect(upsellFor(['cafe', 'croissant'], PLACES.cafe.menu, none)?.id).toBe('gateau');
  });

  it('low stock: the special has one piece left, never the shopping-list item; the engine refuses more', () => {
    expect(lowStockToday(DAY, 'cafe', PLACES.cafe.menu, ['croissant'], 'gateau')).toEqual({ gateau: 1 });
    expect(lowStockToday(DAY, 'cafe', PLACES.cafe.menu, ['gateau'], 'gateau').gateau).toBeUndefined();
    const vocab = new Set(['gateau']);
    const r = applyActions(emptyOrder(), [{ type: 'serve_items', itemId: 'gateau', quantity: 2 }], { vocabIds: vocab, stock: { gateau: 1 } });
    expect(r.rejected[0].reason).toBe('only 1 left');
    const sold = applyActions(emptyOrder(), [{ type: 'serve_items', itemId: 'gateau', quantity: 1 }], { vocabIds: vocab, stock: { gateau: 0 } });
    expect(sold.rejected[0].reason).toBe('sold out');
    const offer = applyActions(emptyOrder(), [{ type: 'offer', itemId: 'nope', quantity: 1 }], { vocabIds: vocab });
    expect(offer.rejected[0].reason).toBe('unknown menu item');
  });

  it('serves what is left, offers a substitute, and serves it on "oui"', async () => {
    const { store, director } = regular();
    const low = Object.keys(director.stock() ?? {})[0];
    expect(low).toBeDefined();
    const item = menuItem(low)!;
    const c = collect();
    const r = await director.handle({ kind: 'say', text: `deux ${item.plural}`, fingers: 0 });
    expect(r.turn.fr).toMatch(/Il ne reste que/);
    expect(store.order.lines).toEqual([{ itemId: low, qty: 1 }]);
    const offer = c.effects.find((e) => e.kind === 'offer');
    expect(offer).toMatchObject({ reason: 'substitute', quantity: 1 });
    expect(c.notes[0]).toMatch(/^Lune note : rupture, je propose/);
    await director.handle({ kind: 'say', text: 'Oui, avec plaisir !', fingers: 0 });
    expect(store.order.lines).toEqual([{ itemId: low, qty: 1 }, { itemId: (offer as { itemId: string }).itemId, qty: 1 }]);
    c.off();
  });

  it('upsells a related item once per visit, served only if accepted', async () => {
    const { store, director } = regular();
    const low = Object.keys(director.stock() ?? {})[0];
    const first = MENU.find((m) => m.id !== low && m.id === 'cafe') ? 'un café' : 'une pomme';
    const r = await director.handle({ kind: 'say', text: first, fingers: 0 });
    expect(r.turn.fr).toMatch(/Avec ça, /);
    expect(r.effects.some((e) => e.kind === 'offer' && e.reason === 'upsell')).toBe(true);
    const lines = store.order.lines.length;
    await director.handle({ kind: 'say', text: 'Non merci.', fingers: 0 });
    expect(store.order.lines.length).toBe(lines);
    const again = await director.handle({ kind: 'say', text: 'une orange', fingers: 0 });
    expect(again.turn.fr).not.toMatch(/Avec ça/);
  });

  it('change test: only past the tutorial, doing well, once per session', () => {
    const base: TrickInput = { onboarded: true, ordersBefore: 1, changeCents: 160, trickedThisSession: false, tricksBefore: 0, sessionMistakes: 0, sessionPronunciation: 90, roll: 0.99 };
    expect(shouldTrickChange(base)).toBe(true); // first time: as soon as they qualify
    expect(shouldTrickChange({ ...base, onboarded: false })).toBe(false);
    expect(shouldTrickChange({ ...base, ordersBefore: 0 })).toBe(false);
    expect(shouldTrickChange({ ...base, trickedThisSession: true })).toBe(false);
    expect(shouldTrickChange({ ...base, sessionMistakes: 2 })).toBe(false);
    expect(shouldTrickChange({ ...base, sessionPronunciation: 60 })).toBe(false);
    expect(shouldTrickChange({ ...base, changeCents: 0 })).toBe(false);
    expect(shouldTrickChange({ ...base, tricksBefore: 2 })).toBe(false); // later: occasional
    expect(shouldTrickChange({ ...base, tricksBefore: 2, roll: 0.1 })).toBe(true);
    expect([trickAmount(160), trickAmount(50), trickAmount(20)]).toEqual([110, 30, 10]);
    expect(caughtTrick('attendez ca fait combien', 50, 160, null)).toBe(true);
    expect(caughtTrick('il manque', 50, 160, null)).toBe(true);
    expect(caughtTrick('vous vous etes trompee', 50, 160, null)).toBe(true);
    expect(caughtTrick('merci au revoir', 50, 160, null)).toBe(false);
    expect(caughtTrick('cinquante centimes', 50, 160, 50)).toBe(true);
  });

  async function orderAndPay(director: AgentDirector) {
    await director.handle({ kind: 'say', text: 'une pomme', fingers: 0 }); // 0,60 €
    return director.pay(200); // change 1,40 €
  }

  it('gives slightly wrong change, then praises the learner who catches it', async () => {
    const { store, director } = regular();
    const c = collect();
    let confetti = 0;
    const off = events.celebrate.on(() => confetti++);
    const paid = await orderAndPay(director);
    expect(paid?.turn.fr).toBe('Merci ! Je vous rends quatre-vingt-dix centimes.');
    expect(c.effects.some((e) => e.kind === 'return_change')).toBe(false); // no coins yet
    expect(director.awaitingAnswer).toBe(true);
    const caught = await director.handle({ kind: 'say', text: 'Attendez… ça fait combien ?', fingers: 0 });
    expect(caught.turn.fr).toMatch(/^Bien vu, Pranav ! Je me suis trompée exprès\. Voilà un euro quarante\./);
    expect(c.effects).toContainEqual({ kind: 'return_change', cents: 140, coins: [100, 20, 20] });
    expect(store.profile.coach).toMatchObject({ tricks: 1, caught: 1 });
    expect(confetti).toBe(1);
    expect(c.notes).toContain('Lune note : test de monnaie réussi !');
    off();
    c.off();
  });

  it('corrects herself when the learner misses it (and still says goodbye)', async () => {
    const { store, director } = regular();
    const c = collect();
    await orderAndPay(director);
    const missed = await director.handle({ kind: 'say', text: 'Merci, au revoir !', fingers: 0 });
    expect(missed.turn.fr).toBe('Oh, pardon ! Je me suis trompée : je vous rends un euro quarante. À demain, Pranav !');
    expect(c.effects).toContainEqual({ kind: 'return_change', cents: 140, coins: [100, 20, 20] });
    expect(c.effects.some((e) => e.kind === 'goodbye')).toBe(true);
    expect(store.profile.coach.mistakes.some((m) => m.kind === 'payment' && m.want === '1,40 €' && m.got === '0,90 €')).toBe(true);
    // Once per session.
    await director.handle({ kind: 'say', text: 'une pomme', fingers: 0 });
    const second = await director.pay(200);
    expect(second?.turn.fr).toMatch(/Je vous rends un euro quarante/);
    c.off();
  });

  it('a hesitation during the change test resolves it (she corrects herself)', async () => {
    const { director } = regular();
    await orderAndPay(director);
    const r = await director.handle({ kind: 'hint', reason: 'hesitate', nth: 0 });
    expect(r.turn.fr).toMatch(/^Oh, pardon !/);
    expect(director.awaitingAnswer).toBe(false);
  });

  it('a new learner (tutorial) never gets stock limits, upsells or the change test', async () => {
    const store = new Store(memoryKV(), DAY);
    const d = new AgentDirector(store, scriptTransport, VOCAB);
    expect(d.stock()).toBeUndefined();
    const r = await d.handle({ kind: 'say', text: 'cinq gâteaux', fingers: 0 });
    expect(r.turn.fr).toBe('Voilà cinq gâteaux ! Autre chose ?');
    const paid = await d.pay(2000);
    expect(paid?.effects.some((e) => e.kind === 'return_change')).toBe(true);
  });
});

// ---- Procedural planning ----------------------------------------------------------------

describe("tomorrow's plan", () => {
  const card = (ease: number, lapses = 0) => ({ ease, reps: 0, intervalDays: 1, due: DAY, lapses });

  it('picks a theme from weak words and mistakes', () => {
    expect(planTomorrow({ today: DAY, srs: { pomme: card(1.6, 2), orange: card(2.1), cafe: card(2.4) }, mistakes: [] })).toMatchObject({
      day: '2026-11-14',
      themeFr: 'les fruits',
      focusWords: ['pomme', 'orange', 'cafe'],
    });
    const qty: Mistake = { kind: 'quantity', want: 'deux', got: 'douze', count: 3, last: DAY };
    expect(planTomorrow({ today: DAY, srs: { cafe: card(2.4) }, mistakes: [qty] })?.themeFr).toBe('les nombres');
    expect(planTomorrow({ today: DAY, srs: {}, mistakes: [] })).toBeNull();
    expect(planTomorrow({ today: DAY, srs: {}, mistakes: [], seenToday: ['croissant'] })?.themeFr).toBe('les viennoiseries');
  });

  it('steers the shopping list with focus words without changing the default list', () => {
    const plain = dailyQuest(DAY);
    expect(dailyQuest(DAY, [])).toEqual(plain);
    const focused = dailyQuest(DAY, ['eclair', 'poire']);
    expect(focused.tasks[1].itemId).toBe('eclair');
    expect(focused.tasks[2].itemId).toBe('poire');
    expect(focused.tasks[0]).toEqual(plain.tasks[0]); // café sells neither
  });

  it('says tomorrow\'s theme on goodbye and plans tomorrow\'s list from it', async () => {
    const kv = memoryKV();
    const { store, director } = regular(kv);
    store.profile.srs.poire = card(1.5, 2);
    store.profile.srs.pomme = card(1.8, 1);
    const c = collect();
    const bye = await director.handle({ kind: 'say', text: 'Au revoir !', fingers: 0 });
    expect(bye.turn.fr).toBe('À demain, Pranav ! Bonne journée ! Demain, on travaille les fruits !');
    expect(store.profile.coach.plan).toMatchObject({ day: '2026-11-14', themeFr: 'les fruits' });
    expect(c.notes).toContain('Lune note : demain, les fruits');
    const tomorrow = new Store(kv, '2026-11-14');
    expect(tomorrow.questToday().tasks.find((t) => t.place === 'marche')?.itemId).toBe('poire');
    expect(tomorrow.questToday().tasks.find((t) => t.place === 'cafe')?.itemId).toBe('pomme');
    c.off();
  });
});

describe('server prompt stays compact and knows the new tool', () => {
  it('adds the offer tool and the proactive rules', () => {
    expect(toolsFor('cafe').map((t: { name: string }) => t.name)).toContain('offer');
    const p: string = systemPrompt('cafe');
    expect(p).toMatch(/profile\.mistakes/);
    expect(p).toMatch(/scene\.lowStock/);
    expect(p.length).toBeLessThan(6000);
  });
});
