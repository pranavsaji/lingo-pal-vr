/**
 * Café à deux: one shared counter for two learners.
 *
 * The host (who opened the room) owns the truth: their shopkeeper (AI agent),
 * order and tray. The guest's game forwards what the guest says, shows and
 * pays to the host, and mirrors back the shopkeeper's lines, the shared order
 * and the scene effects. Turn-taking lives on the host (turns.ts).
 *
 * The game is reached only through the injected GameBridge, so this module is
 * pure enough to test two sessions against each other with fakes.
 */

import type { AgentEvent, AgentTurn } from '../agent/protocol.js';
import type { TurnResult } from '../agent/director.js';
import type { Effect, OrderState } from '../agent/tools.js';
import { Emitter, type PlaceId } from '../game-state.js';
import { decodeMsg, displayName, liteTurn, PROTOCOL_VERSION, type Msg, type Role, type TurnLite } from './protocol.js';
import type { LinkEvent } from './transport.js';
import { TurnTaker, waitLine, welcomeLine, yourTurnLine } from './turns.js';

export interface GameBridge {
  events: {
    turn: Emitter<AgentTurn>;
    order: Emitter<OrderState>;
    effects: Emitter<Effect[]>;
    subtitle: Emitter<{ who: 'lune' | 'learner'; fr: string; en: string }>;
    place: Emitter<PlaceId>;
    travel: Emitter<PlaceId>;
    coinDropped: Emitter<number>;
  };
  director: {
    handle(ev: AgentEvent): Promise<TurnResult>;
    pay(cents: number): Promise<TurnResult> | null;
  };
  store: {
    readonly order: OrderState;
    setOrder(o: OrderState): void;
    addXp(n: number): number;
    remember(key: string, value: string): void;
    readonly profile: { name: string; memories: Record<string, string> };
  };
  appState: { place: PlaceId };
  /** Is the shopkeeper talking right now? (announcements wait for her to finish) */
  speaking(): boolean;
  /** Am I in an immersive session? */
  inXr(): boolean;
}

export interface LinkLike {
  open(): Promise<void>;
  send(m: object): void;
  sendPose(buf: ArrayBuffer): void;
  setStream(s: MediaStream | null): void;
  close(): Promise<void>;
  readonly via: string;
}

export type LinkFactory = (code: string, on: (e: LinkEvent) => void) => LinkLike;

export type SessionState = 'off' | 'waiting' | 'connected';

/** Guest requests the host has not answered after this long are released. */
export const REPLY_TIMEOUT_MS = 15_000;
/** "Still nobody" hint after this long without the friend. */
export const LONELY_MS = 25_000;
const ANNOUNCE_MIN_MS = 900;
const ANNOUNCE_MAX_MS = 9000;
const MIN_ACT_GAP_MS = 600;

const emptyTurn = (): AgentTurn => ({ fr: '', en: '', replies: [], actions: [], points: 0, source: 'script' });
const noop = (): TurnResult => ({ turn: emptyTurn(), effects: [], rejected: [] });

export class SocialSession {
  role: Role | null = null;
  code = '';
  state: SessionState = 'off';
  friendName = '';
  friendXr = false;
  /** The learner whose turn it is at the counter. */
  holder: Role = 'host';
  /** Extra status line (French / English), e.g. "the room is full". */
  note: { fr: string; en: string } | null = null;
  /** True after LONELY_MS with nobody: the UI suggests checking the code. */
  lonely = false;

  /** Anything shown in the UI changed. */
  readonly changed = new Emitter<void>();
  /** The friend said something (speech bubble over their avatar). */
  readonly friendSaid = new Emitter<string>();
  /** Raw pose packet from the friend (decoded by the system). */
  readonly pose = new Emitter<unknown>();
  /** The friend's microphone (null when they leave). */
  readonly stream = new Emitter<MediaStream | null>();

  link: LinkLike | null = null;
  private turns = new TurnTaker();
  private original: GameBridge['director'] | null = null;
  private restore: Partial<GameBridge['director']> = {};
  private offs: (() => void)[] = [];
  private resolvers: (() => void)[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastTurn: TurnLite | null = null;
  private hostPlace: PlaceId | null = null;
  private pendingOrder: OrderState | null = null;
  private awaitingReply = false;
  private guestInFlight = 0;
  private lastGuestSay = '';
  private lastActAt = -Infinity;
  private friendStream: MediaStream | null = null;

  constructor(
    private g: GameBridge,
    private makeLink: LinkFactory,
    private now: () => number = () => performance.now(),
  ) {}

  get active(): boolean {
    return this.state !== 'off';
  }

  get myName(): string {
    const p = this.g.store.profile;
    return displayName(p.name || p.memories.name, this.role ?? 'host');
  }

  nameOf(r: Role): string {
    return r === this.role ? this.myName : this.friendName || displayName('', r);
  }

  /** Open a new room as its host. */
  host(code: string): void {
    this.start(code, 'host');
  }

  /** Join a friend's room. Installs the forwarding right away, before the connection. */
  join(code: string): void {
    this.start(code, 'guest');
    this.patchDirector();
  }

  private start(code: string, role: Role): void {
    if (this.active) return;
    this.code = code;
    this.role = role;
    this.state = 'waiting';
    this.note = null;
    this.lonely = false;
    this.link = this.makeLink(code, (e) => this.onLink(e));
    this.listen();
    this.later(() => {
      if (this.state === 'waiting') {
        this.lonely = true;
        this.changed.emit();
      }
    }, LONELY_MS);
    void this.link.open();
    this.changed.emit();
  }

  async leave(): Promise<void> {
    if (!this.active) return;
    this.link?.send({ t: 'bye' });
    const link = this.link;
    this.link = null;
    this.reset();
    this.state = 'off';
    this.role = null;
    this.code = '';
    this.changed.emit();
    await link?.close();
  }

  private reset(): void {
    this.unpatchDirector();
    for (const off of this.offs) off();
    this.offs = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.flush();
    this.friendName = '';
    this.friendXr = false;
    this.lastTurn = null;
    this.hostPlace = null;
    this.pendingOrder = null;
    this.guestInFlight = 0;
    this.friendStream = null;
    this.stream.emit(null);
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private flush(): void {
    const r = this.resolvers;
    this.resolvers = [];
    for (const fn of r) fn();
    this.awaitingReply = false;
  }

  private send(m: Msg): void {
    this.link?.send(m);
  }

  // ---- Link ---------------------------------------------------------------------

  onLink(e: LinkEvent): void {
    switch (e.kind) {
      case 'peer':
        this.send({ t: 'hello', v: PROTOCOL_VERSION, role: this.role ?? 'host', name: this.myName, xr: this.g.inXr() });
        break;
      case 'leave':
        this.friendLeft();
        break;
      case 'msg': {
        const m = decodeMsg(e.data);
        if (m) this.onMsg(m);
        break;
      }
      case 'pose':
        if (this.state === 'connected') this.pose.emit(e.data);
        break;
      case 'stream':
        // May arrive before the hello: keep it for when we are connected.
        this.friendStream = e.stream;
        if (this.state === 'connected') this.stream.emit(e.stream);
        break;
      case 'error':
        console.warn('[social]', e.error);
        break;
    }
  }

  private friendLeft(): void {
    if (this.state !== 'connected') return;
    const name = this.friendName;
    this.state = 'waiting';
    this.note = { fr: `${name} est parti·e. En attente…`, en: `${name} left. Waiting…` };
    if (this.role === 'host') this.unpatchDirector();
    this.flush();
    this.friendStream = null;
    this.stream.emit(null);
    this.changed.emit();
  }

  private onMsg(m: Msg): void {
    if (m.t === 'hello') return this.onHello(m.role, m.name, m.xr);
    if (m.t === 'full') {
      this.note = { fr: 'Cette salle est complète.', en: 'This room is full.' };
      this.changed.emit();
      return;
    }
    if (m.t === 'bye') return this.friendLeft();
    if (this.state !== 'connected') return;
    if (m.t === 'said') {
      this.friendSaid.emit(m.text);
      return;
    }
    if (this.role === 'host') this.onHostMsg(m);
    else this.onGuestMsg(m);
  }

  private onHello(role: Role, name: string, xr: boolean): void {
    if (role === this.role) {
      // Two hosts (or two guests) with the same code: not our friend.
      this.note = { fr: 'Code déjà utilisé. Créez une nouvelle salle.', en: 'Code already in use. Create a new room.' };
      this.changed.emit();
      return;
    }
    this.friendName = name;
    this.friendXr = xr;
    this.state = 'connected';
    this.note = null;
    this.lonely = false;
    if (this.friendStream) this.stream.emit(this.friendStream);
    if (this.role === 'host') {
      this.patchDirector();
      this.turns.reset(this.now(), 'host');
      this.holder = 'host';
      this.send({ t: 'sync', place: this.g.appState.place, order: this.g.store.order, holder: this.holder, turn: this.lastTurn });
      this.later(() => this.say(welcomeLine(this.friendName, this.myName)), 600);
    }
    this.changed.emit();
  }

  // ---- Host ---------------------------------------------------------------------

  private listen(): void {
    const ev = this.g.events;
    if (this.role === 'host') {
      this.offs.push(
        ev.turn.on((turn) => {
          const lite = liteTurn(turn);
          if (turn.source === 'ai') this.lastTurn = lite;
          if (this.state === 'connected') this.send({ t: 'turn', turn: lite, holder: this.turns.holder });
        }),
        ev.order.on((order) => {
          if (this.state === 'connected') this.send({ t: 'order', order });
        }),
        ev.effects.on((fx) => this.onHostEffects(fx)),
        ev.subtitle.on((s) => {
          if (this.state === 'connected' && s.who === 'learner' && s.fr !== this.lastGuestSay) this.send({ t: 'said', text: s.fr.slice(0, 200) });
        }),
        ev.place.on((place) => {
          if (this.state === 'connected') this.send({ t: 'place', place });
        }),
      );
    } else {
      this.offs.push(
        ev.place.on((place) => {
          if (this.state !== 'connected' || !this.hostPlace) return;
          if (place === this.hostPlace) {
            if (this.pendingOrder) this.g.store.setOrder(this.pendingOrder);
            this.pendingOrder = null;
          } else this.send({ t: 'travel', place }); // the guest picked a shop on the map: go together
        }),
      );
    }
  }

  private onHostEffects(fx: Effect[]): void {
    if (this.state !== 'connected') return;
    // Memories belong to whoever spoke: the host's are never sent; the guest's are sent by act().
    const shared = fx.filter((e) => e.kind !== 'memory' && e.kind !== 'quiz' && e.kind !== 'correction' && e.kind !== 'goodbye');
    if (shared.length) this.send({ t: 'fx', fx: shared });
    if (fx.some((e) => e.kind === 'spawn')) {
      const next = this.turns.served(this.guestInFlight > 0 ? 'guest' : 'host', this.now());
      if (next) {
        this.holder = next;
        this.announce(next);
        this.changed.emit();
      }
    }
  }

  /** "À vous, Sam !" once the shopkeeper has finished her current line. */
  private announce(next: Role): void {
    const start = this.now();
    const tick = () => {
      if (this.state !== 'connected' || this.turns.holder !== next) return;
      const waited = this.now() - start;
      if (waited < ANNOUNCE_MIN_MS || (this.g.speaking() && waited < ANNOUNCE_MAX_MS)) {
        this.later(tick, 300);
        return;
      }
      this.say(yourTurnLine(this.nameOf(next)));
    };
    this.later(tick, ANNOUNCE_MIN_MS);
  }

  /** A scripted shopkeeper line (no AI call), shown and spoken like any turn. */
  private say(line: { fr: string; en: string }): void {
    if (this.state !== 'connected') return;
    const turn: AgentTurn = { ...emptyTurn(), fr: line.fr, en: line.en, replies: this.lastTurn?.replies ?? [] };
    this.g.events.subtitle.emit({ who: 'lune', fr: line.fr, en: line.en });
    this.g.events.turn.emit(turn);
  }

  private onHostMsg(m: Msg): void {
    switch (m.t) {
      case 'act':
        void this.guestAct(m.ev);
        break;
      case 'pay': {
        this.g.events.coinDropped.emit(m.cents); // the clink on my tray too
        // Nothing to pay for: release the guest's waiting coins.
        if (!this.g.director.pay(m.cents)) this.send({ t: 'ack' });
        break;
      }
      case 'travel':
        if (m.place !== this.g.appState.place) {
          this.g.events.travel.emit(m.place);
          // Not open for me yet (or still loading): tell the guest where we really are.
          this.later(() => {
            if (this.g.appState.place !== m.place) this.send({ t: 'place', place: this.g.appState.place });
          }, 5000);
        }
        break;
    }
  }

  private async guestAct(ev: AgentEvent): Promise<void> {
    const now = this.now();
    if (now - this.lastActAt < MIN_ACT_GAP_MS) return;
    this.lastActAt = now;
    if (ev.kind === 'say') {
      const r = this.turns.request('guest', now);
      if (!r.ok) {
        this.send({ t: 'busy', holder: this.turns.holder });
        return;
      }
      if (r.took) {
        this.holder = 'guest';
        this.changed.emit();
      }
      this.lastGuestSay = ev.text;
      this.friendSaid.emit(ev.text);
    }
    // The shopkeeper may remember things about the guest: keep them out of my profile.
    const before = { ...this.g.store.profile.memories };
    const nameBefore = this.g.store.profile.name;
    this.guestInFlight++;
    try {
      const res = await (this.original ?? this.g.director).handle(ev);
      const memories = res.effects.filter((e) => e.kind === 'memory');
      if (memories.length) {
        this.send({ t: 'fx', fx: memories });
        const p = this.g.store.profile;
        for (const e of memories) {
          if (e.kind !== 'memory') continue;
          if (before[e.key] !== undefined) this.g.store.remember(e.key, before[e.key]);
          else delete p.memories[e.key];
        }
        p.name = nameBefore;
      }
    } catch (err) {
      console.warn('[social] guest turn failed', err);
      this.send({ t: 'ack' });
    } finally {
      this.guestInFlight--;
    }
  }

  // ---- Guest --------------------------------------------------------------------

  private onGuestMsg(m: Msg): void {
    const here = () => this.hostPlace === this.g.appState.place;
    switch (m.t) {
      case 'sync':
        this.hostPlace = m.place;
        this.holder = m.holder;
        this.lastTurn = m.turn;
        if (here()) this.g.store.setOrder(m.order);
        else {
          this.pendingOrder = m.order;
          this.g.events.travel.emit(m.place);
        }
        this.changed.emit();
        break;
      case 'turn': {
        this.holder = m.holder;
        if (m.turn.source === 'ai') this.lastTurn = m.turn;
        const t = m.turn;
        if (this.awaitingReply && t.source === 'ai' && t.points > 0) this.g.store.addXp(t.points);
        this.g.events.subtitle.emit({ who: 'lune', fr: t.fr, en: t.en });
        this.g.events.turn.emit({ ...t, actions: [] });
        this.flush();
        this.changed.emit();
        break;
      }
      case 'order':
        if (here()) this.g.store.setOrder(m.order);
        else this.pendingOrder = m.order;
        break;
      case 'fx': {
        const scene = m.fx.filter((e) => e.kind !== 'memory');
        for (const e of m.fx) if (e.kind === 'memory') this.g.store.remember(e.key, e.value);
        if (scene.length && here()) this.g.events.effects.emit(scene);
        break;
      }
      case 'busy': {
        this.holder = m.holder;
        const line = waitLine(this.myName, this.nameOf(m.holder));
        this.g.events.subtitle.emit({ who: 'lune', fr: line.fr, en: line.en });
        this.g.events.turn.emit({ ...emptyTurn(), fr: line.fr, en: line.en, replies: this.lastTurn?.replies ?? [] });
        this.flush();
        this.changed.emit();
        break;
      }
      case 'ack':
        this.flush();
        break;
      case 'place':
        this.hostPlace = m.place;
        if (m.place !== this.g.appState.place) this.g.events.travel.emit(m.place);
        break;
    }
  }

  // ---- Director forwarding ------------------------------------------------------

  /** Replace the director's entry points (guest: forward everything; host: turn-taking). */
  private patchDirector(): void {
    if (this.original) return;
    const d = this.g.director;
    const original = { handle: d.handle.bind(d), pay: d.pay.bind(d) };
    this.original = original;
    // Remember exactly what was there (usually the class methods) to restore it untouched.
    this.restore = { handle: Object.prototype.hasOwnProperty.call(d, 'handle') ? d.handle : undefined, pay: Object.prototype.hasOwnProperty.call(d, 'pay') ? d.pay : undefined };
    if (this.role === 'guest') {
      d.handle = (ev) => this.forward(ev);
      d.pay = (cents) => this.forwardPay(cents);
    } else {
      d.handle = (ev) => {
        if (ev.kind === 'say' && this.state === 'connected') {
          const r = this.turns.request('host', this.now());
          if (!r.ok) {
            this.say(waitLine(this.myName, this.friendName));
            return Promise.resolve(noop());
          }
          if (r.took) {
            this.holder = 'host';
            this.changed.emit();
          }
        }
        return original.handle(ev);
      };
    }
  }

  private unpatchDirector(): void {
    if (!this.original) return;
    const d = this.g.director as Partial<GameBridge['director']>;
    if (this.restore.handle) d.handle = this.restore.handle;
    else delete d.handle;
    if (this.restore.pay) d.pay = this.restore.pay;
    else delete d.pay;
    this.original = null;
  }

  private wait(): Promise<TurnResult> {
    this.awaitingReply = true;
    return new Promise<TurnResult>((resolve) => {
      const done = () => resolve(noop());
      this.resolvers.push(done);
      this.later(done, REPLY_TIMEOUT_MS);
    });
  }

  private forward(ev: AgentEvent): Promise<TurnResult> {
    // The host's shopkeeper greets us herself; nothing to do before we are connected.
    if (ev.kind === 'arrive' || this.state !== 'connected') return Promise.resolve(noop());
    if (ev.kind === 'say') {
      this.g.events.subtitle.emit({ who: 'learner', fr: ev.text, en: '' });
      this.send({ t: 'act', ev: { kind: 'say', text: ev.text.slice(0, 200), fingers: ev.fingers, ...(ev.pronunciation !== undefined ? { pronunciation: ev.pronunciation } : {}) } });
    } else if (ev.kind === 'show' || ev.kind === 'gesture' || ev.kind === 'idle') this.send({ t: 'act', ev });
    else return Promise.resolve(noop());
    return this.wait();
  }

  private forwardPay(cents: number): Promise<TurnResult> | null {
    if (this.state !== 'connected' || cents <= 0) return null;
    this.send({ t: 'pay', cents: Math.round(cents) });
    return this.wait();
  }
}

/** The status line for panels (French, English). */
export function statusLine(s: Pick<SocialSession, 'state' | 'role' | 'friendName' | 'lonely' | 'note'>): { fr: string; en: string } {
  if (s.note) return s.note;
  if (s.state === 'connected') return { fr: `Connecté avec ${s.friendName}`, en: `Connected with ${s.friendName}` };
  if (s.state === 'waiting') {
    if (s.lonely) return { fr: 'Toujours personne… Vérifiez le code.', en: 'Still nobody… Check the code.' };
    return s.role === 'host' ? { fr: 'En attente de votre ami…', en: 'Waiting for your friend…' } : { fr: 'Recherche de votre ami…', en: 'Looking for your friend…' };
  }
  return { fr: '', en: '' };
}
