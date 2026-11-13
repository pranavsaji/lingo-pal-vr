/**
 * Café à deux: protocol, pose packets, interpolation, turn-taking, QR, and a
 * host + guest session talking through an in-memory link (fake game on each side).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentTurn } from '../src/agent/protocol';
import type { TurnResult } from '../src/agent/director';
import { applyActions, emptyOrder, payWith, type Effect, type OrderState } from '../src/agent/tools';
import { parseIntent } from '../src/agent/intent';
import { Emitter, type PlaceId } from '../src/game-state';
import { blend, PoseInterpolator, STALE_MS } from '../src/social/interp';
import {
  decodeMsg,
  decodePose,
  encodePose,
  F_LEFT,
  F_POINTER,
  F_RIGHT,
  F_XR,
  friendSeat,
  makeRoomCode,
  newPose,
  normalizeRoomCode,
  P_LEFT,
  P_POINTER,
  POSE_FLOATS,
  poseByteLength,
  roomFromSearch,
  ROOM_ALPHABET,
  SEAT_LEFT,
  SEAT_RIGHT,
  seatPoint,
  seatQuat,
  seqNewer,
  shareUrl,
  validEffects,
} from '../src/social/protocol';
import { encodeQr, rsDivisor, rsRemainder } from '../src/social/qr';
import { SocialSession, statusLine, type GameBridge, type LinkLike } from '../src/social/session';
import type { LinkEvent } from '../src/social/transport';
import { TurnTaker, TURN_IDLE_MS } from '../src/social/turns';

describe('room codes and links', () => {
  it('makes readable 4-letter codes and normalizes typed ones', () => {
    let i = 0;
    const seq = [0, 0.5, 0.99, 0.2];
    const code = makeRoomCode(() => seq[i++ % 4]);
    expect(code).toHaveLength(4);
    for (const c of code) expect(ROOM_ALPHABET).toContain(c);
    expect(normalizeRoomCode(' ab-cd ')).toBe('ABCD');
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('ABCO')).toBeNull(); // O is not in the alphabet
    expect(roomFromSearch('?debug&room=wxyz')).toBe('WXYZ');
    expect(roomFromSearch('?debug')).toBeNull();
    expect(shareUrl('https://lingo-pal-vr.vercel.app/', 'ABCD')).toBe('https://lingo-pal-vr.vercel.app/?room=ABCD');
  });
});

describe('voice', () => {
  it('"inviter" opens the invite card', () => {
    expect(parseIntent('Inviter un ami')).toEqual({ kind: 'command', command: 'invite' });
    expect(parseIntent('invitez')).toEqual({ kind: 'command', command: 'invite' });
    expect(parseIntent('Un croissant, s’il vous plaît').kind).not.toBe('command');
  });
});

describe('seats', () => {
  it('puts the friend at the counter end on the opposite side for each learner', () => {
    expect(friendSeat('host')).toBe(SEAT_RIGHT);
    expect(friendSeat('guest')).toBe(SEAT_LEFT);
    const out = [0, 0, 0];
    seatPoint(SEAT_RIGHT, 0, 1.2, 0, out);
    expect(out).toEqual([SEAT_RIGHT.x, 1.2, SEAT_RIGHT.z]);
    // Looking ahead (-Z) from the right seat turns toward the shopkeeper (left and back).
    seatPoint(SEAT_RIGHT, 0, 0, -1, out);
    expect(out[0] - SEAT_RIGHT.x).toBeLessThan(-0.5);
    expect(out[2] - SEAT_RIGHT.z).toBeLessThan(-0.5);
  });

  it('rotates orientations the same way as points', () => {
    // A head yawed 30 deg left, seen from the seat: its forward equals seatPoint of its forward.
    const a = (30 * Math.PI) / 180;
    const q = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
    const r = [0, 0, 0, 0];
    seatQuat(SEAT_LEFT, q[0], q[1], q[2], q[3], r);
    const fwd = (qq: number[]) => {
      // rotate (0,0,-1) by quaternion
      const [x, y, z, w] = qq;
      return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
    };
    const f = fwd(r);
    const local = fwd(q);
    const p = [0, 0, 0];
    seatPoint(SEAT_LEFT, local[0], local[1], local[2], p);
    expect(f[0]).toBeCloseTo(p[0] - SEAT_LEFT.x, 5);
    expect(f[2]).toBeCloseTo(p[2] - SEAT_LEFT.z, 5);
  });
});

describe('pose packets', () => {
  it('round-trips head, both hands and a pointer within a millimeter', () => {
    const p = newPose();
    p.flags = F_XR | F_LEFT | F_RIGHT | F_POINTER;
    p.seq = 65535;
    for (let i = 0; i < POSE_FLOATS; i++) p.data[i] = Math.sin(i) * 1.7;
    const n = Math.hypot(p.data[3], p.data[4], p.data[5], p.data[6]);
    for (let i = 3; i < 7; i++) p.data[i] /= n;
    const buf = encodePose(p);
    expect(buf.byteLength).toBe(poseByteLength(p.flags));
    expect(buf.byteLength).toBeLessThan(330);
    const out = newPose();
    expect(decodePose(buf, out)).toBe(true);
    expect(out.flags).toBe(p.flags);
    expect(out.seq).toBe(65535);
    for (const i of [0, 1, 2, P_LEFT, P_LEFT + 40, P_POINTER + 2]) expect(Math.abs(out.data[i] - p.data[i])).toBeLessThanOrEqual(0.0006);
    for (let i = 3; i < 7; i++) expect(out.data[i]).toBeCloseTo(p.data[i], 3);
    // Typed-array views decode too (some transports deliver Uint8Array).
    expect(decodePose(new Uint8Array(buf), newPose())).toBe(true);
  });

  it('sends only what is tracked, and rejects malformed packets', () => {
    const p = newPose();
    p.flags = F_POINTER;
    expect(encodePose(p).byteLength).toBe(4 + 14 + 6);
    const bad = new Uint8Array(encodePose(p));
    expect(decodePose(bad.slice(0, 10), newPose())).toBe(false);
    expect(decodePose({ evil: true }, newPose())).toBe(false);
    const wrongKind = bad.slice();
    wrongKind[0] = 9;
    expect(decodePose(wrongKind, newPose())).toBe(false);
    const wrongFlags = bad.slice();
    wrongFlags[1] = F_LEFT; // claims a hand but carries none
    expect(decodePose(wrongFlags, newPose())).toBe(false);
  });

  it('clamps absurd values instead of wrapping', () => {
    const p = newPose();
    p.data[0] = 1e6;
    p.data[1] = Number.NaN;
    const out = newPose();
    decodePose(encodePose(p), out);
    expect(out.data[0]).toBe(30);
    expect(out.data[1]).toBe(0);
  });

  it('orders sequence numbers across wraparound', () => {
    expect(seqNewer(2, 1)).toBe(true);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqNewer(5, 5)).toBe(false);
  });
});

describe('messages from the peer are validated', () => {
  it('accepts well-formed messages', () => {
    expect(decodeMsg({ t: 'hello', v: 1, role: 'guest', name: '', xr: false })).toEqual({ t: 'hello', v: 1, role: 'guest', name: 'Sam', xr: false });
    expect(decodeMsg({ t: 'pay', cents: 200 })).toEqual({ t: 'pay', cents: 200 });
    expect(decodeMsg({ t: 'act', ev: { kind: 'say', text: 'Un café', fingers: 1, pronunciation: 88 } })).toEqual({ t: 'act', ev: { kind: 'say', text: 'Un café', fingers: 1, pronunciation: 88 } });
    const order: OrderState = { phase: 'ordering', lines: [{ itemId: 'croissant', qty: 2 }], trayCents: 0, changeCents: 0, changeGiven: false };
    expect(decodeMsg({ t: 'order', order })).toEqual({ t: 'order', order });
    expect(decodeMsg({ t: 'turn', holder: 'guest', turn: { fr: 'Bonjour', en: 'Hello', replies: [{ fr: 'Oui', en: 'Yes' }], points: 5, source: 'ai' } })).not.toBeNull();
  });

  it('drops anything malformed or not allowed', () => {
    const bad: unknown[] = [
      null,
      'hello',
      { t: 'nope' },
      { t: 'pay', cents: -5 },
      { t: 'pay', cents: 1.5 },
      { t: 'pay', cents: 1e9 },
      { t: 'act', ev: { kind: 'paid', paidCents: 1, totalCents: 1, changeCents: 0 } }, // host-only event
      { t: 'act', ev: { kind: 'arrive' } },
      { t: 'act', ev: { kind: 'say', text: 'x'.repeat(500), fingers: 0 } },
      { t: 'act', ev: { kind: 'say', text: '   ', fingers: 0 } },
      { t: 'order', order: { phase: 'hacked', lines: [], trayCents: 0, changeCents: 0, changeGiven: false } },
      { t: 'order', order: { phase: 'paying', lines: [{ itemId: 'croissant', qty: 99 }], trayCents: 0, changeCents: 0, changeGiven: false } },
      { t: 'turn', holder: 'guest', turn: { fr: 'x', en: 'y', replies: [1, 2], points: 0, source: 'ai' } },
      { t: 'hello', v: 1, role: 'admin', name: 'x', xr: false },
      { t: 'place', place: 'moon' },
    ];
    for (const b of bad) expect(decodeMsg(b)).toBeNull();
  });

  it('keeps only playable effects', () => {
    const fx = validEffects([
      { kind: 'spawn', itemId: 'croissant', quantity: 2 },
      { kind: 'spawn', itemId: 'croissant', quantity: 50 },
      { kind: 'quiz', wordIds: ['x'] },
      { kind: 'emote', emote: 'dance' },
      { kind: 'emote', emote: 'wave' },
      { kind: 'memory', key: 'password', value: 'x' },
      { kind: 'memory', key: 'name', value: 'Sam' },
    ]);
    expect(fx).toEqual([
      { kind: 'spawn', itemId: 'croissant', quantity: 2 },
      { kind: 'emote', emote: 'wave' },
      { kind: 'memory', key: 'name', value: 'Sam' },
    ]);
  });
});

describe('pose interpolation', () => {
  const pose = (seq: number, x: number, flags = 0) => {
    const p = newPose();
    p.seq = seq;
    p.flags = flags;
    p.data[0] = x;
    p.data[6] = 1;
    p.data[P_LEFT] = x * 2;
    return p;
  };

  it('renders in the past, between the two packets around that time', () => {
    const it = new PoseInterpolator(100);
    const out = new Float32Array(POSE_FLOATS);
    it.push(pose(1, 0), 1000);
    it.push(pose(2, 1), 1066);
    expect(it.sample(1133, out)).toBe(0); // t = 1033: halfway
    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(out[6]).toBeCloseTo(1, 5);
    it.sample(1050, out); // before the first packet: hold the oldest
    expect(out[0]).toBe(0);
    it.sample(1500, out); // after the newest: hold the newest
    expect(out[0]).toBe(1);
  });

  it('drops late packets and goes stale when the friend stops sending', () => {
    const it = new PoseInterpolator(100);
    const out = new Float32Array(POSE_FLOATS);
    expect(it.sample(0, out)).toBe(-1);
    expect(it.push(pose(5, 0), 0)).toBe(true);
    expect(it.push(pose(4, 9), 10)).toBe(false);
    expect(it.sample(STALE_MS + 1, out)).toBe(-1);
  });

  it('snaps a hand that just appeared instead of sliding it in from zero', () => {
    const out = new Float32Array(POSE_FLOATS);
    const a = pose(1, 0).data;
    const b = pose(2, 1, F_LEFT).data;
    blend(a, 0, b, F_LEFT, 0.25, out);
    expect(out[0]).toBeCloseTo(0.25);
    expect(out[P_LEFT]).toBe(2);
    blend(b, F_LEFT, pose(3, 2, F_LEFT).data, F_LEFT, 0.5, out);
    expect(out[P_LEFT]).toBeCloseTo(3);
  });
});

describe('turn-taking', () => {
  it('serves one learner at a time and passes the turn after an order', () => {
    const t = new TurnTaker(10_000);
    t.reset(0);
    expect(t.request('host', 100)).toEqual({ ok: true, took: false });
    expect(t.request('guest', 200)).toEqual({ ok: false, took: false });
    expect(t.served('guest', 300)).toBeNull(); // not the holder
    expect(t.served('host', 400)).toBe('guest');
    expect(t.request('host', 500).ok).toBe(false);
    expect(t.request('guest', 600).ok).toBe(true);
  });

  it('lets the other learner take over when the holder goes quiet', () => {
    const t = new TurnTaker();
    t.reset(0);
    expect(t.request('guest', TURN_IDLE_MS - 1).ok).toBe(false);
    expect(t.request('guest', TURN_IDLE_MS)).toEqual({ ok: true, took: true });
    expect(t.holder).toBe('guest');
  });
});

describe('QR encoder', () => {
  it('draws finder patterns and timing for a share link', () => {
    const qr = encodeQr('https://lingo-pal-vr.vercel.app/?room=ABCD', 'M');
    expect(qr.version).toBe(3);
    expect(qr.size).toBe(29);
    const at = (x: number, y: number) => qr.modules[y * qr.size + x];
    for (const [cx, cy] of [[3, 3], [qr.size - 4, 3], [3, qr.size - 4]]) {
      expect(at(cx, cy)).toBe(1);
      expect(at(cx - 2, cy)).toBe(0);
      expect(at(cx - 3, cy)).toBe(1);
    }
    for (let i = 8; i < qr.size - 8; i++) expect(at(i, 6)).toBe(i % 2 === 0 ? 1 : 0);
    expect(at(8, qr.size - 8)).toBe(1); // dark module
    expect(encodeQr('hi').version).toBe(1);
    expect(() => encodeQr('x'.repeat(300))).toThrow();
  });

  it('computes Reed-Solomon codewords that divide the generator', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const div = rsDivisor(10);
    const ecc = rsRemainder(data, div);
    expect(ecc).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]); // the classic 1-M "HELLO WORLD" example
    expect(rsRemainder([...data, ...ecc], div).every((b) => b === 0)).toBe(true);
  });
});

// ---- Host + guest through an in-memory link -----------------------------------------

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
    const data = JSON.parse(JSON.stringify(m)); // what really crosses the wire
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
    remember(k: string, v: string) {
      if (k === 'name') this.profile.name = v;
      this.profile.memories[k] = v;
    },
  };
  const calls: AgentEvent[] = [];
  const turns: AgentTurn[] = [];
  events.turn.on((t) => turns.push(t));
  const ctx = { vocabIds: new Set(['croissant', 'cafe']) };
  // A tiny stand-in for the shopkeeper agent: same validation and broadcast order as AgentDirector.
  const director = {
    async handle(ev: AgentEvent): Promise<TurnResult> {
      calls.push(ev);
      const actions: unknown[] = [];
      let fr = 'Très bien.';
      if (ev.kind === 'say' && /croissant/i.test(ev.text)) actions.push({ type: 'serve_items', itemId: 'croissant', quantity: 1 });
      if (ev.kind === 'say' && /café/i.test(ev.text)) actions.push({ type: 'serve_items', itemId: 'cafe', quantity: 1 });
      if (ev.kind === 'say' && /addition/i.test(ev.text)) actions.push({ type: 'quote_total' });
      const nm = ev.kind === 'say' ? ev.text.match(/je m'appelle (\w+)/i) : null;
      if (nm) actions.push({ type: 'remember', key: 'name', value: nm[1] });
      if (ev.kind === 'paid') fr = 'Merci !';
      const { state, effects } = applyActions(store.order, actions, ctx);
      store.setOrder(state);
      for (const e of effects) if (e.kind === 'memory') store.remember(e.key, e.value);
      const turn: AgentTurn = { fr, en: 'Very well.', replies: [{ fr: 'Merci', en: 'Thanks' }], actions, points: 5, source: 'ai' };
      if (effects.length) events.effects.emit(effects);
      events.turn.emit(turn);
      return { turn, effects, rejected: [] };
    },
    pay(cents: number): Promise<TurnResult> | null {
      const res = payWith(store.order, cents);
      if (res.state === store.order) return null;
      store.setOrder(res.state);
      return this.handle(res.ok ? { kind: 'paid', paidCents: res.state.trayCents, totalCents: 0, changeCents: res.state.changeCents } : { kind: 'short', paidCents: res.state.trayCents, shortByCents: res.shortByCents });
    },
  };
  const bridge: GameBridge = { events, director, store, appState: { place: 'cafe' }, speaking: () => false, inXr: () => false };
  return { bridge, events, store, director, calls, turns, originalHandle: director.handle, originalPay: director.pay };
}

describe('host and guest at one counter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(ms = 0) {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(ms / 6);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  function pair() {
    const host = fakeGame('Pranav');
    const guest = fakeGame('');
    let hostLink: FakeLink | null = null;
    const hs = new SocialSession(host.bridge, (_c, on) => (hostLink = new FakeLink(on)), () => Date.now());
    const gs = new SocialSession(
      guest.bridge,
      (_c, on) => {
        const l = new FakeLink(on);
        l.peer = hostLink;
        hostLink!.peer = l;
        return l;
      },
      () => Date.now(),
    );
    return { host, guest, hs, gs };
  }

  it('connects, greets both, takes turns, shares the order and the tray, and leaves cleanly', async () => {
    const { host, guest, hs, gs } = pair();
    hs.host('ABCD');
    expect(statusLine(hs).fr).toMatch(/En attente/);
    gs.join('ABCD');
    // The guest's director is forwarded from the start (before the connection).
    expect(guest.director.handle).not.toBe(guest.originalHandle);
    await settle();
    expect(hs.state).toBe('connected');
    expect(gs.state).toBe('connected');
    expect(hs.friendName).toBe('Sam');
    expect(gs.friendName).toBe('Pranav');
    expect(statusLine(gs).fr).toBe('Connecté avec Pranav');

    // Shopkeeper greets both (scripted, no AI call), on both screens.
    await settle(700);
    expect(host.turns.at(-1)?.fr).toMatch(/bonjour Sam.*Pranav, vous commencez/);
    expect(guest.turns.at(-1)?.fr).toBe(host.turns.at(-1)?.fr);
    expect(host.calls).toHaveLength(0);

    // Guest speaks out of turn: "one moment", the host's agent is not called.
    void guest.director.handle({ kind: 'say', text: 'Un croissant', fingers: 0 });
    await settle();
    expect(host.calls).toHaveLength(0);
    expect(guest.turns.at(-1)?.fr).toMatch(/Un instant, Sam ! Je sers Pranav/);

    // Host orders a coffee: the guest sees the order, then the turn passes to Sam.
    await host.director.handle({ kind: 'say', text: 'Un café', fingers: 0 });
    await settle();
    expect(guest.store.order.lines).toEqual([{ itemId: 'cafe', qty: 1 }]);
    expect(hs.holder).toBe('guest');
    await settle(1200);
    expect(host.turns.at(-1)?.fr).toMatch(/À vous, Sam/);
    expect(guest.turns.at(-1)?.fr).toMatch(/À vous, Sam/);
    expect(gs.holder).toBe('guest');

    // Now the host must wait.
    const before = host.calls.length;
    await host.director.handle({ kind: 'say', text: 'Un croissant', fingers: 0 });
    expect(host.calls.length).toBe(before);
    expect(host.turns.at(-1)?.fr).toMatch(/Un instant, Pranav/);

    // Sam orders a croissant through the host's shopkeeper; both see the shared order.
    const reply = guest.director.handle({ kind: 'say', text: 'Un croissant, s’il vous plaît', fingers: 0 });
    await settle();
    await reply;
    expect(host.calls.at(-1)).toMatchObject({ kind: 'say', text: 'Un croissant, s’il vous plaît' });
    expect(host.store.order.lines).toEqual([{ itemId: 'cafe', qty: 1 }, { itemId: 'croissant', qty: 1 }]);
    expect(guest.store.order).toEqual(host.store.order);
    expect(guest.store.xp).toBe(5); // the guest earns the turn's XP
    await settle(1200);
    expect(guest.turns.at(-1)?.fr).toMatch(/À vous, Pranav/);

    // The shopkeeper's memories about Sam stay out of Pranav's profile.
    await settle(16_000); // Pranav is quiet: Sam may take the turn
    void guest.director.handle({ kind: 'say', text: "Je m'appelle Sam", fingers: 0 });
    await settle();
    expect(host.store.profile.name).toBe('Pranav');
    expect(host.store.profile.memories.name).toBeUndefined();
    expect(guest.store.profile.memories.name).toBe('Sam');

    // Paying together: each puts coins on the one shared tray.
    await settle(1000);
    void guest.director.handle({ kind: 'say', text: "L'addition, s'il vous plaît", fingers: 0 });
    await settle();
    expect(host.store.order.phase).toBe('paying');
    const coins: number[] = [];
    host.events.coinDropped.on((c) => coins.push(c));
    void guest.director.pay(200);
    await settle();
    expect(coins).toEqual([200]);
    expect(guest.store.order.trayCents).toBe(200);
    await host.director.pay(1000);
    await settle();
    expect(host.store.order.phase).toBe('paid');
    expect(guest.store.order.phase).toBe('paid');

    // Sam leaves: the host is back to solo, with the original director.
    await gs.leave();
    await settle();
    expect(gs.active).toBe(false);
    expect(guest.director.handle).toBe(guest.originalHandle);
    expect(guest.director.pay).toBe(guest.originalPay);
    expect(hs.state).toBe('waiting');
    expect(host.director.handle).toBe(host.originalHandle);
    await hs.leave();
    expect(hs.active).toBe(false);
  });

  it('guest forwarding is silent until connected (no local AI call, no hang)', async () => {
    const guest = fakeGame('');
    const gs = new SocialSession(guest.bridge, (_c, on) => new FakeLink(on), () => Date.now());
    gs.join('WXYZ');
    const res = await guest.director.handle({ kind: 'arrive' });
    expect(res.turn.fr).toBe('');
    await guest.director.handle({ kind: 'say', text: 'Bonjour', fingers: 0 });
    expect(guest.calls).toHaveLength(0);
    expect(guest.director.pay(100)).toBeNull();
    await settle(26_000);
    expect(statusLine(gs).fr).toMatch(/Toujours personne/);
    await gs.leave();
    expect(guest.director.handle).toBe(guest.originalHandle);
  });
});
