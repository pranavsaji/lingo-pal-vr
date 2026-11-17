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
import { parseIntent } from '../agent/intent.js';
import { emptyOrder, orderTotal, type Effect, type OrderState } from '../agent/tools.js';
import { Emitter, type PlaceId } from '../game-state.js';
import { decodeMsg, displayName, liteTurn, PROTOCOL_VERSION, type Msg, type Role, type TurnLite } from './protocol.js';
import type { Invite } from './secret.js';
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
    /** `scope`: a guest's turn (the shopkeeper sees only the guest's name, none of my profile). */
    handle(ev: AgentEvent, scope?: GuestScope): Promise<TurnResult>;
    pay(cents: number, declared?: boolean): Promise<TurnResult> | null;
    /** A fresh shopkeeper conversation (an ex-guest starts their own visit). */
    resetConversation?(): void;
  };
  store: {
    readonly order: OrderState;
    setOrder(o: OrderState): void;
    addXp(n: number): number;
    remember(key: string, value: string): void;
    readonly profile: { name: string; memories: Record<string, string> };
  };
  appState: { place: PlaceId; travelling?: boolean };
  /** Is the shopkeeper talking right now? (announcements wait for her to finish) */
  speaking(): boolean;
  /** Am I in an immersive session? */
  inXr(): boolean;
}

/** Context for a turn the host's shopkeeper takes on behalf of the guest. */
export interface GuestScope {
  name: string;
}

export interface LinkLike {
  open(): Promise<void>;
  send(m: object): void;
  sendPose(buf: ArrayBuffer): void;
  setStream(s: MediaStream | null): void;
  close(): Promise<void>;
  readonly via: string;
}

export type LinkFactory = (invite: Invite, on: (e: LinkEvent) => void) => LinkLike;

/** 'invited': a ?room= link was opened; nothing is sent until the learner confirms. */
export type SessionState = 'off' | 'invited' | 'waiting' | 'connected';

/** Guest requests the host has not answered after this long are released. */
export const REPLY_TIMEOUT_MS = 15_000;
/** "Still nobody" hint after this long without the friend. */
export const LONELY_MS = 25_000;
const ANNOUNCE_MIN_MS = 900;
const ANNOUNCE_MAX_MS = 9000;
export const MIN_ACT_GAP_MS = 600;
/** A guest may put money on the shared tray at most this many times per order. */
export const MAX_PAYS_PER_ORDER = 12;
/** A guest payment may overpay by at most one 10-euro note. */
const MAX_OVERPAY_CENTS = 1000;

const emptyTurn = (): AgentTurn => ({ fr: '', en: '', replies: [], actions: [], points: 0, source: 'script' });
const noop = (): TurnResult => ({ turn: emptyTurn(), effects: [], rejected: [] });

export class SocialSession {
  role: Role | null = null;
  code = '';
  invite: Invite | null = null;
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
  private lastPayAt = -Infinity;
  private paysThisOrder = 0;
  /** Host: who put the last money on the shared tray, so only they get the change back. */
  private lastPayer: Role = 'host';
  /** Host: turns sent to the guest so far (a guest request that produced none is acked). */
  private turnsSent = 0;

  /**
   * How my own shopkeeper greets me when I am back to solo (after "Non merci" or leaving
   * as a guest). The app swaps in the first-run tutorial when that is still owed.
   */
  greetSolo: () => void = () => void this.g.director.handle({ kind: 'arrive' });

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
  host(invite: Invite): void {
    this.start(invite, 'host');
  }

  /**
   * A friend's link was opened: ask first ("Rejoindre ?"), connect nothing yet.
   * The shopkeeper is forwarded already so she does not greet me solo meanwhile.
   */
  invited(invite: Invite): void {
    if (this.active) return;
    this.invite = invite;
    this.code = invite.code;
    this.role = 'guest';
    this.state = 'invited';
    this.patchDirector();
    this.changed.emit();
  }

  /** "Rejoindre" (button, dwell, or saying "oui"). */
  accept(): void {
    if (this.state !== 'invited' || !this.invite) return;
    this.start(this.invite, 'guest');
  }

  /** "Non merci": back to solo, and my own shopkeeper greets me. */
  decline(): void {
    if (this.state !== 'invited') return;
    this.unpatchDirector();
    this.state = 'off';
    this.role = null;
    this.code = '';
    this.invite = null;
    this.changed.emit();
    this.greetSolo();
  }

  /** Join a friend's room right away (tests; the app asks first with invited()). */
  join(invite: Invite): void {
    this.start(invite, 'guest');
    this.patchDirector();
  }

  private start(invite: Invite, role: Role): void {
    if (this.active && this.state !== 'invited') return;
    this.invite = invite;
    this.code = invite.code;
    this.role = role;
    this.state = 'waiting';
    this.note = null;
    this.lonely = false;
    this.link = this.makeLink(invite, (e) => this.onLink(e));
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
    if (this.state === 'invited') return this.decline();
    if (!this.active) return;
    this.link?.send({ t: 'bye' });
    const link = this.link;
    const wasGuest = this.role === 'guest';
    this.link = null;
    this.reset();
    this.state = 'off';
    this.role = null;
    this.code = '';
    this.invite = null;
    if (wasGuest) this.soloAgain();
    this.changed.emit();
    await link?.close();
  }

  /**
   * An ex-guest's own shop: the host's mirrored order and the forwarded conversation are
   * gone, so start a clean visit with a greeting, as on arrival. Mid-trip, the trip itself
   * resets the order and greets on arrival: do nothing here, or she would greet twice.
   */
  private soloAgain(): void {
    if (this.g.appState.travelling) return;
    this.g.store.setOrder(emptyOrder());
    this.g.director.resetConversation?.();
    this.greetSolo();
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
    this.lastPayer = 'host';
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
          if (this.state === 'connected') {
            this.turnsSent++;
            this.send({ t: 'turn', turn: lite, holder: this.turns.holder });
          }
        }),
        ev.order.on((order) => {
          if (order.phase !== 'paying' && order.phase !== 'paid') this.paysThisOrder = 0;
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
    // Change coins go to whoever paid: the guest's dish only fills when the guest paid.
    const shared = fx.filter(
      (e) => e.kind !== 'memory' && e.kind !== 'quiz' && e.kind !== 'correction' && e.kind !== 'goodbye' && (e.kind !== 'return_change' || this.lastPayer === 'guest'),
    );
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
      case 'pay':
        void this.guestPay(m.cents);
        break;
      case 'travel':
        if (m.place !== this.g.appState.place) {
          this.g.events.travel.emit(m.place);
          // If I could not go (not open for me, another trip running), tell the guest where I
          // really am. A cold load can take longer than 5 s: wait for it (up to 25 s) instead of
          // sending the old shop and bouncing us both back.
          let waited = 0;
          const check = () => {
            if (this.g.appState.place === m.place) return;
            if (this.g.appState.travelling && waited < 25000) {
              waited += 1000;
              this.later(check, 1000);
              return;
            }
            this.send({ t: 'place', place: this.g.appState.place });
          };
          this.later(check, 5000);
        }
        break;
    }
  }

  private async guestAct(ev: AgentEvent): Promise<void> {
    const now = this.now();
    if (now - this.lastActAt < MIN_ACT_GAP_MS || this.guestInFlight > 0) {
      this.send({ t: 'ack' }); // too fast, or one request already running: dropped
      return;
    }
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
    this.guestInFlight++;
    const sent = this.turnsSent;
    try {
      // Guest-scoped: the shopkeeper sees the guest's name, none of my memories, mistakes or history.
      await (this.original ?? this.g.director).handle(ev, { name: this.friendName });
    } catch (err) {
      console.warn('[social] guest turn failed', err);
    } finally {
      this.guestInFlight--;
    }
    this.releaseIfSilent(sent);
  }

  /**
   * A guest request that sent no turn back (failed, or a stale reply dropped by the director
   * after a trip) would hold the guest's wait until REPLY_TIMEOUT_MS: release it now.
   */
  private releaseIfSilent(sentBefore: number): void {
    if (this.turnsSent === sentBefore) this.send({ t: 'ack' });
  }

  /** Did my own payment earn the change being handed back? (The coin dish asks.) */
  changeIsMine(): boolean {
    return !(this.role === 'host' && this.state === 'connected' && this.lastPayer === 'guest');
  }

  /** Validate a guest payment (pace, amount, count) before it touches my tray. */
  acceptPay(cents: number, now: number): boolean {
    const o = this.g.store.order;
    const due = orderTotal(o.lines) - o.trayCents;
    if (o.phase !== 'paying' || due <= 0) return false;
    if (now - this.lastPayAt < MIN_ACT_GAP_MS || this.guestInFlight > 0) return false;
    if (this.paysThisOrder >= MAX_PAYS_PER_ORDER) return false;
    // Coins and notes are multiples of 10 cents (or "c'est juste": exactly what is due).
    const valid = cents === due || (cents % 10 === 0 && cents <= due + MAX_OVERPAY_CENTS);
    if (!valid) return false;
    this.lastPayAt = now;
    this.paysThisOrder++;
    return true;
  }

  private async guestPay(cents: number): Promise<void> {
    if (!this.acceptPay(cents, this.now())) {
      this.send({ t: 'ack' }); // release the guest's waiting coins
      return;
    }
    this.g.events.coinDropped.emit(cents); // the clink on my tray too
    this.lastPayer = 'guest';
    const p = (this.original ?? this.g.director).pay(cents);
    if (!p) {
      this.send({ t: 'ack' });
      return;
    }
    this.guestInFlight++;
    const sent = this.turnsSent;
    try {
      await p;
    } catch {
      // released below
    } finally {
      this.guestInFlight--;
    }
    this.releaseIfSilent(sent);
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
        // Never persist anything the peer sends (memories are not even accepted by decodeMsg).
        const scene = m.fx.filter((e) => e.kind !== 'memory');
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
      // My own coins, chips or voice: the change is mine (guest payments go through guestPay).
      d.pay = (cents, declared) => {
        this.lastPayer = 'host';
        return original.pay(cents, declared);
      };
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
      this.later(() => {
        // Timed out: stop waiting for real, or the host's next AI turn would pay the guest XP
        // and any host turn would resolve a later wait early.
        this.resolvers = this.resolvers.filter((r) => r !== done);
        if (!this.resolvers.length) this.awaitingReply = false;
        done();
      }, REPLY_TIMEOUT_MS);
    });
  }

  private forward(ev: AgentEvent): Promise<TurnResult> {
    if (this.state === 'invited' && ev.kind === 'say') {
      // Voice answer to "Rejoindre le café de votre ami ?"
      const intent = parseIntent(ev.text).kind;
      const t = ev.text.trim().toLowerCase();
      if (intent === 'no' || /^non\b/.test(t)) this.decline(); // "non merci" parses as thanks
      else if (intent === 'yes' || /^(oui|ouais|d'accord|rejoindre)\b/.test(t)) this.accept();
      return Promise.resolve(noop());
    }
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
  if (s.state === 'invited') return { fr: 'Rejoindre le café de votre ami ?', en: "Join your friend's café?" };
  if (s.note) return s.note;
  if (s.state === 'connected') return { fr: `Connecté avec ${s.friendName}`, en: `Connected with ${s.friendName}` };
  if (s.state === 'waiting') {
    if (s.lonely) return { fr: 'Toujours personne… Vérifiez le code.', en: 'Still nobody… Check the code.' };
    return s.role === 'host' ? { fr: 'En attente de votre ami…', en: 'Waiting for your friend…' } : { fr: 'Recherche de votre ami…', en: 'Looking for your friend…' };
  }
  return { fr: '', en: '' };
}
