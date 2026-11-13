/**
 * The agent loop: build a world snapshot, ask Madame Lune (AI or script) for a
 * turn, validate her tool calls against the deterministic order state, apply
 * them, update the learner profile, and broadcast effects for the scene.
 *
 * "The game owns the truth; the AI proposes." This is the only bridge.
 *
 * Proactive layer (no model call, no latency): mistake memory, hints when the
 * learner hesitates or looks at an item, low stock with substitutes, upsells,
 * the deliberate wrong-change test, and tomorrow's plan. Each adaptation
 * shows one short visible note ("Lune note : deux ≠ douze").
 */

import { appState, events } from '../game-state.js';
import { fingersConfusion, mistakeForPrompt, mistakeNote, numberConfusion } from '../state/mistakes.js';
import { pendingHere } from '../state/quest.js';
import { normalizeFrench } from '../voice/pronunciation.js';
import { caughtTrick, findElsewhere, lowStockToday, shouldTrickChange, trickAmount, trickOpenTurn, trickResolveTurn } from './agency.js';
import { parseAmountCents, parseIntent } from './intent.js';
import { MENU, menuItem, PLACES, priceToDigits, priceToFrench } from './menu.js';
import { hintTurn } from './proactive.js';
import { dailySpecial } from './scenarios.js';
import { definite, orderPhrase } from './script.js';
import type { Store } from '../state/store.js';
import type { AgentEvent, AgentRequest, AgentScene, AgentTurn } from './protocol.js';
import { applyActions, orderTotal, payWith, type Effect, type Rejection } from './tools.js';

export type Transport = (req: AgentRequest, onSlow: () => void) => Promise<AgentTurn>;

export interface TurnResult {
  turn: AgentTurn;
  effects: Effect[];
  rejected: Rejection[];
}

/**
 * A turn taken for someone else at the counter (Café à deux guest): the request
 * carries only their name, none of this learner's profile, memories, mistakes
 * or conversation, and nothing from it is written back to this learner's profile.
 */
export interface GuestScope {
  name: string;
}

export interface Perception {
  lookingAt: string | null;
  holding: string | null;
}

/** What the voice system heard, scored against the reply it was closest to. */
export interface HeardSpeech {
  text: string;
  target: string | null;
  score: number | null;
  missed: string[];
}

/** Function words that are not worth remembering as pronunciation mistakes. */
const STOP = new Set(['vous', 'plait', 'cest', 'avec', 'pour', 'sil', 'est', 'les', 'des', 'une']);

/** "Madame Lune" -> "Lune": the name on the visible notes. */
export function keeperShortName(place: string): string {
  const name = (PLACES[place as keyof typeof PLACES] ?? PLACES.cafe).shopkeeper.name;
  return name.split(' ').pop() ?? name;
}

/** Item id for a French noun from any shop ("pain au chocolat" -> pain_chocolat). */
function idForNoun(noun: string): string | undefined {
  const n = normalizeFrench(noun);
  for (const p of Object.values(PLACES)) {
    for (const m of p.menu) if (m.id === noun || normalizeFrench(m.noun) === n || normalizeFrench(m.plural) === n) return m.id;
  }
  return undefined;
}

export class AgentDirector {
  private history: AgentRequest['history'] = [];
  /** The Café à deux guest's own conversation (never mixed with the learner's). */
  private guestHistory: AgentRequest['history'] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  perception: Perception = { lookingAt: null, holding: null };
  onSlow: () => void = () => {};
  rejectedLog: Rejection[] = [];

  /** The item she just proposed (substitute or upsell); consumed by the next turn. */
  private offer: AgentScene['offer'] = null;
  private upsold = false;
  /** Low-stock pieces sold today, per "place:item". */
  private soldLow = new Map<string, number>();
  /** The wrong-change test in progress. */
  private trick: { trueCents: number; saidCents: number; announced: boolean } | null = null;
  private trickedThisSession = false;
  /** Items bought this session (tomorrow's plan falls back on them). */
  private bought = new Set<string>();
  /** Mistakes already shown as a note this session (each is noted once). */
  private noted = new Set<string>();
  /** The note for the turn being built (set by detectors, shown after the turn). */
  private pendingNote = '';

  constructor(
    private store: Store,
    private transport: Transport,
    private vocabIds: ReadonlySet<string>,
    private random: () => number = Math.random,
  ) {}

  /** A turn is being prepared (the coach stays quiet meanwhile). */
  get busy(): boolean {
    return this.inFlight > 0;
  }

  /** She gave wrong change on purpose and waits for the learner's reaction. */
  get awaitingAnswer(): boolean {
    return !!this.trick?.announced;
  }

  /** Low stock, substitutes, upsells and the change test start after the tutorial and a first order. */
  private agencyOn(): boolean {
    const p = this.store.profile;
    return p.onboarded && p.stats.orders >= 1;
  }

  /** Pieces left of today's low-stock item here (undefined: everything unlimited). */
  stock(): Record<string, number> | undefined {
    if (!this.agencyOn()) return undefined;
    const place = appState.place;
    const special = dailySpecial(this.store.today, this.store.profile.unlocks, place).item.id;
    const listItem = this.store.questToday().tasks.find((t) => t.place === place)?.itemId;
    const base = lowStockToday(this.store.today, place, MENU, listItem ? [listItem] : [], special);
    for (const id of Object.keys(base)) base[id] = Math.max(0, base[id] - (this.soldLow.get(`${place}:${id}`) ?? 0));
    return base;
  }

  buildRequest(event: AgentEvent): AgentRequest {
    const p = this.store.profile;
    const o = this.store.order;
    const special = dailySpecial(this.store.today, p.unlocks, appState.place);
    const mistakes = this.store.topMistakes(3).map(mistakeForPrompt);
    const stock = this.stock();
    const tomorrow = this.store.planTomorrow(idForNoun, this.bought)?.themeFr;
    const req: AgentRequest = {
      profile: {
        name: p.name,
        level: this.store.level.id,
        sessions: p.sessions,
        streakDays: p.streakDays,
        weakWords: this.store.weakWords(),
        memories: { ...p.memories },
        lastVisit: p.lastVisit,
      },
      scene: {
        phase: o.phase,
        order: o.lines.map((l) => ({ ...l })),
        totalCents: orderTotal(o.lines),
        totalWords: priceToFrench(orderTotal(o.lines)),
        trayCents: o.trayCents,
        lookingAt: this.perception.lookingAt,
        holding: this.perception.holding,
        scenario: special.scenarioId,
        special: { itemId: special.item.id, challenge: special.challenge.en },
        place: appState.place,
        shoppingList: (() => {
          const t = pendingHere(this.store.profile.quest, appState.place);
          return t ? `${t.qty} ${t.itemId}` : '';
        })(),
      },
      event,
      history: this.history.slice(-10),
    };
    // Optional context, only when there is something to say (keeps the prompt small).
    if (mistakes.length) req.profile.mistakes = mistakes;
    if (this.offer) req.scene.offer = { ...this.offer };
    if (stock && Object.keys(stock).length) req.scene.lowStock = stock;
    if (this.agencyOn() && !this.upsold) req.scene.canUpsell = true;
    if (tomorrow) req.scene.tomorrow = tomorrow;
    return req;
  }

  /** A new shop: a new shopkeeper does not know the previous conversation. */
  resetConversation(): void {
    this.history = [];
    this.guestHistory = [];
    this.offer = null;
    this.upsold = false;
    this.trick = null;
  }

  /** Serialized: one turn at a time, in order. */
  handle(event: AgentEvent, guest?: GuestScope): Promise<TurnResult> {
    this.inFlight++;
    const run = this.queue.then(() => (guest ? this.runGuest(event, guest) : this.run(event)));
    this.queue = run.catch(() => undefined);
    void run.finally(() => {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }).catch(() => undefined);
    return run;
  }

  /**
   * Speech heard by the voice system: remember number confusions and badly
   * pronounced words; fade mistakes said well. Returns the confusion
   * ("deux≠douze") so the say event can carry it.
   */
  observeSpeech(h: HeardSpeech): string | undefined {
    if (!h.target) return undefined;
    const conf = numberConfusion(h.target, h.text);
    if (conf) {
      this.store.recordMistake('quantity', conf.want, conf.got);
      this.noted.add(`quantity:${conf.want}≠${conf.got}`);
      return `${conf.want}≠${conf.got}`;
    }
    if (h.score !== null && h.score < 70) {
      for (const w of h.missed.filter((x) => x.length >= 4 && !STOP.has(x)).slice(0, 2)) this.store.recordMistake('pronunciation', w, '');
    } else if (h.score !== null && h.score >= 85) {
      for (const w of normalizeFrench(h.target).split(' ')) this.store.easeMistake(w);
    }
    return undefined;
  }

  private note(text: string): string {
    return `${keeperShortName(appState.place)} note : ${text}`;
  }

  /** Mistakes the learner makes in what they say (fingers vs words, items from another shop). */
  private detectSayMistakes(event: Extract<AgentEvent, { kind: 'say' }>): void {
    if (event.misheard) this.pendingNote = this.note(event.misheard.replace('≠', ' ≠ '));
    const fc = fingersConfusion(event.text, event.fingers);
    if (fc && !event.misheard) {
      this.store.recordMistake('quantity', fc.want, fc.got);
      this.noted.add(`quantity:${fc.want}≠${fc.got}`);
      this.pendingNote ||= this.note(`${fc.want} ≠ ${fc.got}`);
    }
    const elsewhere = findElsewhere(normalizeFrench(event.text), appState.place, PLACES);
    if (elsewhere) {
      this.store.recordMistake('unknown_item', elsewhere.item.noun, '');
      this.noted.add(`unknown_item:${elsewhere.item.noun}`);
      this.pendingNote ||= this.note(`pas de ${elsewhere.item.noun} ici`);
    }
  }

  /** Turns the game writes itself: hints and the change test. Null: ask the shopkeeper (AI or script). */
  private localTurn(req: AgentRequest): AgentTurn | null {
    const e = req.event;
    if (this.trick && !this.trick.announced && e.kind === 'paid') {
      this.trick.announced = true;
      return trickOpenTurn(this.trick.saidCents, orderPhrase(req.scene.order).fr);
    }
    if (this.trick?.announced && (e.kind === 'say' || e.kind === 'gesture' || e.kind === 'show' || e.kind === 'hint' || e.kind === 'idle')) {
      const t = this.trick;
      this.trick = null;
      const text = e.kind === 'say' ? e.text : '';
      const caught =
        (e.kind === 'say' && caughtTrick(normalizeFrench(text), t.trueCents - t.saidCents, t.trueCents, parseAmountCents(text))) ||
        (e.kind === 'gesture' && e.gesture === 'thumbs_down');
      this.store.recordTrick(caught);
      if (caught) {
        this.pendingNote = this.note('test de monnaie réussi !');
        events.celebrate.emit();
      } else {
        this.store.recordMistake('payment', priceToDigits(t.trueCents), priceToDigits(t.saidCents));
        this.pendingNote = this.note(`erreur exprès, ${priceToDigits(t.saidCents)} ≠ ${priceToDigits(t.trueCents)}`);
      }
      const keeper = (PLACES[req.scene.place] ?? PLACES.cafe).shopkeeper;
      return trickResolveTurn({
        caught,
        trueCents: t.trueCents,
        name: req.profile.name,
        feminine: keeper.gender === 'f',
        bye: e.kind === 'say' && parseIntent(text).kind === 'bye',
      });
    }
    if (e.kind === 'hint') {
      const item = e.itemId ? menuItem(e.itemId) : undefined;
      this.pendingNote ||= item ? this.note(`vous regardez ${definite(item)}`) : this.note(e.nth >= 1 ? 'je ralentis ?' : 'vous hésitez, petit indice');
      return hintTurn(req, e);
    }
    return null;
  }

  /** One short visible line explaining how she adapted this turn ('' when nothing to say). */
  private noteFor(turn: AgentTurn, effects: Effect[]): string {
    if (this.pendingNote) return this.pendingNote;
    for (const fx of effects) {
      if (fx.kind === 'offer') {
        const item = menuItem(fx.itemId);
        if (item) return this.note(fx.reason === 'substitute' ? `rupture, je propose ${definite(item)}` : `je suggère ${definite(item)}`);
      }
      if (fx.kind === 'goodbye') {
        const plan = this.store.profile.coach.plan;
        if (plan && plan.day > this.store.today) return this.note(`demain, ${plan.themeFr}`);
      }
    }
    // She reused a word the learner confuses (AI prompt or scripted greeting).
    const said = ` ${normalizeFrench([turn.fr, ...turn.replies.map((r) => r.fr)].join(' '))} `;
    for (const m of this.store.topMistakes(3)) {
      const key = mistakeForPrompt(m);
      if (this.noted.has(key) || m.kind === 'payment') continue;
      if (said.includes(` ${normalizeFrench(m.want)} `)) {
        this.noted.add(key);
        return this.note(mistakeNote(m));
      }
    }
    return '';
  }

  private async run(event: AgentEvent): Promise<TurnResult> {
    this.pendingNote = '';
    if (event.kind === 'say') {
      this.history.push({ role: 'learner', text: event.text });
      events.subtitle.emit({ who: 'learner', fr: event.text, en: '' });
      this.detectSayMistakes(event);
      const intent = parseIntent(event.text);
      if (intent.kind === 'command' && intent.command === 'slower') this.store.setSetting('slowSpeech', true);
    }
    const req = this.buildRequest(event);
    this.offer = null; // an offer stands for one learner answer
    const turn = this.localTurn(req) ?? (await this.transport(req, () => this.onSlow()));
    const { state, effects, rejected } = applyActions(this.store.order, turn.actions, { vocabIds: this.vocabIds, stock: this.stock() });
    if (rejected.length) {
      this.rejectedLog.push(...rejected);
      console.warn('[agent] rejected tool calls', rejected);
    }
    this.store.setOrder(state);
    for (const e of effects) {
      if (e.kind === 'memory') this.store.remember(e.key, e.value);
      if (e.kind === 'goodbye') {
        this.store.savePlan(this.store.planTomorrow(idForNoun, this.bought));
        this.store.closeVisit();
      }
      if (e.kind === 'offer') {
        this.offer = { itemId: e.itemId, qty: e.quantity, reason: e.reason };
        if (e.reason === 'upsell') this.upsold = true;
      }
    }
    if (turn.points > 0) this.store.addXp(turn.points);
    this.history.push({ role: 'lune', text: turn.fr });
    events.subtitle.emit({ who: 'lune', fr: turn.fr, en: turn.en });
    if (effects.length) events.effects.emit(effects);
    const note = this.noteFor(turn, effects);
    this.pendingNote = '';
    if (note) events.agentNote.emit(note);
    events.turn.emit(turn);
    return { turn, effects, rejected };
  }

  /**
   * A guest's turn: same shopkeeper, same shared order, but a request scoped
   * to the guest. No memories, mistakes, XP, plans or notes touch this
   * learner's profile, so nothing the guest says can read or write it.
   */
  private async runGuest(event: AgentEvent, guest: GuestScope): Promise<TurnResult> {
    if (event.kind === 'say') {
      this.guestHistory.push({ role: 'learner', text: event.text });
      events.subtitle.emit({ who: 'learner', fr: event.text, en: '' });
    }
    const req = this.buildRequest(event);
    req.profile = { name: guest.name.slice(0, 16), level: 'A1', sessions: 1, streakDays: 0, weakWords: [], memories: {}, lastVisit: '' };
    req.history = this.guestHistory.slice(-10);
    delete req.scene.tomorrow;
    req.scene.shoppingList = '';
    const turn = await this.transport(req, () => this.onSlow());
    const { state, effects, rejected } = applyActions(this.store.order, turn.actions, { vocabIds: this.vocabIds, stock: this.stock() });
    if (rejected.length) this.rejectedLog.push(...rejected);
    this.store.setOrder(state);
    // Only the shared scene: memories, goodbyes (visit summary, plans) and offers stay out.
    const shared = effects.filter((e) => e.kind !== 'memory' && e.kind !== 'goodbye' && e.kind !== 'quiz');
    this.guestHistory.push({ role: 'lune', text: turn.fr });
    events.subtitle.emit({ who: 'lune', fr: turn.fr, en: turn.en });
    if (shared.length) events.effects.emit(shared);
    events.turn.emit(turn);
    return { turn, effects: shared, rejected };
  }

  /** Apply tool actions locally (scripted moments such as the tutorial); same validation, no model call. */
  applyLocal(actions: unknown[]): Effect[] {
    const { state, effects, rejected } = applyActions(this.store.order, actions, { vocabIds: this.vocabIds, stock: this.stock() });
    if (rejected.length) this.rejectedLog.push(...rejected);
    this.store.setOrder(state);
    if (effects.length) events.effects.emit(effects);
    return effects;
  }

  /**
   * Learner put money on the tray (coins/notes in cents). `declared`: they
   * chose the amount (said it or pinched a payment reply), so paying too little
   * is a mistake worth remembering; dropping coins one by one is not.
   */
  pay(cents: number, declared = false): Promise<TurnResult> | null {
    const before = this.store.order;
    const res = payWith(before, cents);
    if (res.state === before) return null; // nothing to pay for
    this.store.setOrder(res.state);
    if (!res.ok) {
      if (declared) this.store.recordMistake('payment', priceToDigits(orderTotal(before.lines) - before.trayCents), priceToDigits(cents));
      return this.handle({ kind: 'short', paidCents: res.state.trayCents, shortByCents: res.shortByCents, shortWords: priceToFrench(res.shortByCents) });
    }
    const total = orderTotal(res.state.lines);
    this.store.recordOrderPaid(res.state.changeCents === 0);
    for (const l of res.state.lines) {
      this.bought.add(l.itemId);
      const key = `${appState.place}:${l.itemId}`;
      this.soldLow.set(key, (this.soldLow.get(key) ?? 0) + l.qty);
    }
    const changeCents = res.state.changeCents;
    const pr = this.store.session.pronunciation;
    if (
      this.agencyOn() &&
      shouldTrickChange({
        onboarded: this.store.profile.onboarded,
        ordersBefore: this.store.profile.stats.orders - 1,
        changeCents,
        trickedThisSession: this.trickedThisSession,
        tricksBefore: this.store.profile.coach.tricks,
        sessionMistakes: this.store.sessionMistakes,
        sessionPronunciation: pr.length ? pr.reduce((a, b) => a + b, 0) / pr.length : null,
        roll: this.random(),
      })
    ) {
      this.trickedThisSession = true;
      this.trick = { trueCents: changeCents, saidCents: trickAmount(changeCents), announced: false };
    }
    return this.handle({ kind: 'paid', paidCents: res.state.trayCents, totalCents: total, changeCents, changeWords: priceToFrench(changeCents) });
  }
}


