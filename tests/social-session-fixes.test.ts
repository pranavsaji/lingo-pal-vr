/**
 * Café à deux session fixes: change goes to whoever paid, a guest who leaves gets a
 * clean solo visit, a timed-out guest wait is really over, and a guest request that
 * produced no turn (stale after a trip) is released at once, not after REPLY_TIMEOUT_MS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentTurn } from '../src/agent/protocol';
import type { TurnResult } from '../src/agent/director';
import { applyActions, emptyOrder, payWith, type Effect, type OrderState } from '../src/agent/tools';
import { Emitter, type PlaceId } from '../src/game-state';
import { REPLY_TIMEOUT_MS, SocialSession, type GameBridge, type GuestScope, type LinkLike } from '../src/social/session';
import type { LinkEvent } from '../src/social/transport';

const INV = { code: 'ABCD', secret: 'ABCDEFGHJKMNPRST' };

class FakeLink implements LinkLike {
  peer: FakeLink | null = null;
  opened = false;
  closed = false;
  via = 'fake';
  constructor(public on: (e: LinkEvent) => void) {}
  async open(): Promise<void> {
    this.opened = true;
    if (this.peer?.opened) {
      this.on({ kind: 'peer', peerId: 'p2', via: 'fake' });
      this.peer.on({ kind: 'peer', peerId: 'p1', via: 'fake' });
    }
  }
  send(m: object): void {
    const data = JSON.parse(JSON.stringify(m));
    const p = this.peer;
    if (p && !this.closed) queueMicrotask(() => p.on({ kind: 'msg', data, peerId: 'x' }));
  }
  sendPose(): void {}
  setStream(): void {}
  async close(): Promise<void> {
    this.closed = true;
    const p = this.peer;
    if (p) queueMicrotask(() => p.on({ kind: 'leave', peerId: 'x' }));
  }
}

function fakeGame(name: string) {
  const events = {
    turn: new Emitter<AgentTurn>(),
    order: new Emitter<OrderState>(),
    effects: new Emitter<Effect[]>(),
    subtitle: new Emitter<{ who: 'lune' | 'learner'; fr: string; en: string }>(),
    place: new Emitter<PlaceId>(),
    travel: new Emitter<PlaceId>(),
    coinDropped: new Emitter<number>(),
  };
  const store = {
    order: emptyOrder(),
    xp: 0,
    profile: { name, memories: {} as Record<string, string> },
    setOrder(o: OrderState) {
      this.order = o;
      events.order.emit(o);
    },
    addXp(n: number) {
      this.xp += n;
      return this.xp;
    },
    remember() {},
  };
  const calls: AgentEvent[] = [];
  const effects: Effect[] = [];
  events.effects.on((fx) => effects.push(...fx));
  const ctx = { vocabIds: new Set(['croissant', 'cafe']) };
  let resets = 0;
  const director = {
    /** Like AgentDirector after a trip mid-request: the reply is dropped, nothing is emitted. */
    stale: false,
    async handle(ev: AgentEvent, _scope?: GuestScope): Promise<TurnResult> {
      calls.push(ev);
      const empty: AgentTurn = { fr: '', en: '', replies: [], actions: [], points: 0, source: 'script' };
      if (this.stale) return { turn: empty, effects: [], rejected: [] };
      const actions: unknown[] = [];
      if (ev.kind === 'say' && /croissant/i.test(ev.text)) actions.push({ type: 'serve_items', itemId: 'croissant', quantity: 1 });
      if (ev.kind === 'say' && /addition/i.test(ev.text)) actions.push({ type: 'quote_total' });
      if (ev.kind === 'paid') actions.push({ type: 'give_change' });
      const { state, effects: fx } = applyActions(store.order, actions, ctx);
      store.setOrder(state);
      const turn: AgentTurn = { fr: 'Très bien.', en: 'Very well.', replies: [], actions, points: 5, source: 'ai' };
      if (fx.length) events.effects.emit(fx);
      events.turn.emit(turn);
      return { turn, effects: fx, rejected: [] };
    },
    pay(cents: number): Promise<TurnResult> | null {
      const res = payWith(store.order, cents);
      if (res.state === store.order) return null;
      store.setOrder(res.state);
      return this.handle(res.ok ? { kind: 'paid', paidCents: res.state.trayCents, totalCents: 0, changeCents: res.state.changeCents } : { kind: 'short', paidCents: res.state.trayCents, shortByCents: res.shortByCents });
    },
    resetConversation() {
      resets++;
    },
  };
  const appState: { place: PlaceId; travelling?: boolean } = { place: 'cafe' };
  const bridge: GameBridge = { events, director, store, appState, speaking: () => false, inXr: () => false };
  return { bridge, events, store, director, calls, effects, appState, resets: () => resets, originalHandle: director.handle };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function connected() {
  const host = fakeGame('Pranav');
  const guest = fakeGame('Sam');
  let hostLink: FakeLink | null = null;
  const hs = new SocialSession(host.bridge, (_i, on) => (hostLink = new FakeLink(on)), () => Date.now());
  const gs = new SocialSession(
    guest.bridge,
    (_i, on) => {
      const l = new FakeLink(on);
      l.peer = hostLink;
      hostLink!.peer = l;
      return l;
    },
    () => Date.now(),
  );
  hs.host(INV);
  gs.join(INV);
  await flush();
  await vi.advanceTimersByTimeAsync(700); // the scripted welcome
  return { host, guest, hs, gs, hostLink: () => hostLink! };
}

/** The host orders a croissant and asks for the bill, straight through the shopkeeper. */
async function billOnTheTray(host: ReturnType<typeof fakeGame>) {
  await host.originalHandle.call(host.director, { kind: 'say', text: 'Un croissant', fingers: 0 });
  await host.originalHandle.call(host.director, { kind: 'say', text: "L'addition", fingers: 0 });
  expect(host.store.order.phase).toBe('paying');
}

describe('Café à deux: session fixes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the host's change is not mirrored into the guest's dish; the guest's change is", async () => {
    const { host, guest, hs } = await connected();
    await billOnTheTray(host);
    await host.director.pay(1000); // the host pays with a note
    await flush();
    expect(host.effects.some((e) => e.kind === 'return_change')).toBe(true);
    expect(hs.changeIsMine()).toBe(true);
    expect(guest.effects.some((e) => e.kind === 'return_change')).toBe(false);

    // Next order: the guest pays, so the change is theirs.
    await vi.advanceTimersByTimeAsync(1000);
    await billOnTheTray(host);
    void guest.director.pay(1000);
    await flush();
    expect(host.store.order.phase).toBe('paid');
    expect(guest.effects.some((e) => e.kind === 'return_change')).toBe(true);
    expect(hs.changeIsMine()).toBe(false); // the host's coin dish gives nothing back
  });

  it('a guest who leaves gets a clean order and one fresh greeting from their own shopkeeper', async () => {
    const { host, guest, gs } = await connected();
    await billOnTheTray(host);
    await flush();
    expect(guest.store.order.lines).toHaveLength(1); // the host's order, mirrored
    expect(guest.calls).toHaveLength(0);
    await gs.leave();
    expect(guest.store.order).toEqual(emptyOrder());
    expect(guest.resets()).toBe(1);
    expect(guest.calls).toEqual([{ kind: 'arrive' }]);
  });

  it('a guest leaving mid-trip lets the trip reset and greet (no double greeting)', async () => {
    const { guest, gs } = await connected();
    guest.appState.travelling = true;
    await gs.leave();
    expect(guest.calls).toHaveLength(0);
    expect(guest.resets()).toBe(0);
  });

  it('declining an invite greets through the overridable solo greeting', async () => {
    const g = fakeGame('');
    const s = new SocialSession(g.bridge, (_i, on) => new FakeLink(on), () => Date.now());
    const greet = vi.fn();
    s.greetSolo = greet;
    s.invited(INV);
    s.decline();
    expect(greet).toHaveBeenCalledTimes(1);
    expect(g.calls).toHaveLength(0);
  });

  it('a timed-out guest wait is over: a later host turn neither pays the guest XP nor ends a new wait', async () => {
    const { host, guest, hostLink } = await connected();
    const deliver = hostLink().on;
    hostLink().on = () => undefined; // the host never hears this request
    let done = false;
    void guest.director.handle({ kind: 'idle' }).then(() => (done = true));
    await flush();
    await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS);
    expect(done).toBe(true);
    hostLink().on = deliver;
    await host.originalHandle.call(host.director, { kind: 'say', text: 'Bonjour', fingers: 0 });
    await flush();
    expect(guest.store.xp).toBe(0); // the host's AI turn (5 points) is not the guest's
  });

  it('a guest request whose reply was dropped as stale is released at once', async () => {
    const { host, guest } = await connected();
    host.director.stale = true;
    let done = false;
    void guest.director.handle({ kind: 'idle' }).then(() => (done = true));
    await flush();
    expect(host.calls.at(-1)).toEqual({ kind: 'idle' });
    expect(done).toBe(true); // released by an ack, not after REPLY_TIMEOUT_MS
  });

  it('a guest request that got a reply is not also acked', async () => {
    const { host, guest, hostLink } = await connected();
    const sent: { t: string }[] = [];
    const link = hostLink();
    const send = link.send.bind(link);
    link.send = (m: object) => {
      sent.push(m as { t: string });
      send(m);
    };
    await guest.director.handle({ kind: 'idle' });
    await flush();
    expect(host.calls.at(-1)).toEqual({ kind: 'idle' });
    expect(sent.map((m) => m.t)).toContain('turn');
    expect(sent.map((m) => m.t)).not.toContain('ack');
  });
});
