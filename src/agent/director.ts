/**
 * The agent loop: build a world snapshot, ask Madame Lune (AI or script) for a
 * turn, validate her tool calls against the deterministic order state, apply
 * them, update the learner profile, and broadcast effects for the scene.
 *
 * "The game owns the truth; the AI proposes." This is the only bridge.
 */

import { appState, events } from '../game-state.js';
import { pendingHere } from '../state/quest.js';
import { priceToFrench } from './menu.js';
import { dailySpecial } from './scenarios.js';
import type { Store } from '../state/store.js';
import type { AgentEvent, AgentRequest, AgentTurn } from './protocol.js';
import { applyActions, orderTotal, payWith, type Effect, type Rejection } from './tools.js';

export type Transport = (req: AgentRequest, onSlow: () => void) => Promise<AgentTurn>;

export interface TurnResult {
  turn: AgentTurn;
  effects: Effect[];
  rejected: Rejection[];
}

export interface Perception {
  lookingAt: string | null;
  holding: string | null;
}

export class AgentDirector {
  private history: AgentRequest['history'] = [];
  private queue: Promise<unknown> = Promise.resolve();
  perception: Perception = { lookingAt: null, holding: null };
  onSlow: () => void = () => {};
  rejectedLog: Rejection[] = [];

  constructor(
    private store: Store,
    private transport: Transport,
    private vocabIds: ReadonlySet<string>,
  ) {}

  buildRequest(event: AgentEvent): AgentRequest {
    const p = this.store.profile;
    const o = this.store.order;
    const special = dailySpecial(this.store.today, p.unlocks, appState.place);
    return {
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
  }

  /** A new shop: a new shopkeeper does not know the previous conversation. */
  resetConversation(): void {
    this.history = [];
  }

  /** Serialized: one turn at a time, in order. */
  handle(event: AgentEvent): Promise<TurnResult> {
    const run = this.queue.then(() => this.run(event));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(event: AgentEvent): Promise<TurnResult> {
    if (event.kind === 'say') {
      this.history.push({ role: 'learner', text: event.text });
      events.subtitle.emit({ who: 'learner', fr: event.text, en: '' });
    }
    const req = this.buildRequest(event);
    const turn = await this.transport(req, () => this.onSlow());
    const { state, effects, rejected } = applyActions(this.store.order, turn.actions, { vocabIds: this.vocabIds });
    if (rejected.length) {
      this.rejectedLog.push(...rejected);
      console.warn('[agent] rejected tool calls', rejected);
    }
    this.store.setOrder(state);
    for (const e of effects) {
      if (e.kind === 'memory') this.store.remember(e.key, e.value);
      if (e.kind === 'goodbye') this.store.closeVisit();
    }
    if (turn.points > 0) this.store.addXp(turn.points);
    this.history.push({ role: 'lune', text: turn.fr });
    events.subtitle.emit({ who: 'lune', fr: turn.fr, en: turn.en });
    if (effects.length) events.effects.emit(effects);
    events.turn.emit(turn);
    return { turn, effects, rejected };
  }

  /** Apply tool actions locally (scripted moments such as the tutorial); same validation, no model call. */
  applyLocal(actions: unknown[]): Effect[] {
    const { state, effects, rejected } = applyActions(this.store.order, actions, { vocabIds: this.vocabIds });
    if (rejected.length) this.rejectedLog.push(...rejected);
    this.store.setOrder(state);
    if (effects.length) events.effects.emit(effects);
    return effects;
  }

  /** Learner put money on the tray (coins/notes in cents). */
  pay(cents: number): Promise<TurnResult> | null {
    const before = this.store.order;
    const res = payWith(before, cents);
    if (res.state === before) return null; // nothing to pay for
    this.store.setOrder(res.state);
    if (!res.ok) {
      return this.handle({ kind: 'short', paidCents: res.state.trayCents, shortByCents: res.shortByCents, shortWords: priceToFrench(res.shortByCents) });
    }
    const total = orderTotal(res.state.lines);
    this.store.recordOrderPaid(res.state.changeCents === 0);
    const changeCents = res.state.changeCents;
    return this.handle({ kind: 'paid', paidCents: res.state.trayCents, totalCents: total, changeCents, changeWords: priceToFrench(changeCents) });
  }
}
