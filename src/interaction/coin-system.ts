/**
 * Paying with real money, hands-first.
 *
 * Euro coins and notes rest in a dish on the counter. Pinch one (hand ray) and
 * drag it onto the payment tray in front of Madame Lune, then release; a quick
 * pinch-and-release ("tap") sends it to the tray automatically. When the tray
 * covers the bill, payment is committed to the deterministic order state;
 * Madame Lune then counts the change back coin by coin, and each coin flies
 * from the tray into the learner's dish.
 *
 * Accessible alternatives (same state machine): payment chips on the chat
 * panel, voice ("voila cinq euros"; "je paie" places the exact coins), and
 * eyes-only: looking at a coin for a second while paying sends it to the tray.
 * High contrast gives coins a black-on-white face so value never relies on colour.
 */

import { createSystem, DistanceGrabbable, type Entity, Grabbed, Group, MovementMode, RayInteractable, Vector3 } from '@iwsdk/core';
import { priceToDigits } from '../agent/menu.js';
import { orderTotal } from '../agent/tools.js';
import { director } from '../agent/runtime.js';
import { Coin } from '../components.js';
import { appState, events } from '../game-state.js';
import { dishPos, LUNE_HAND, REGISTER, TRAY, TRAY_RADIUS, type V3 } from '../layout.js';
import { buildMoney, buildMoneyDish, buildRegisterDisplay, buildTray, moneyStyle, styleMoney } from '../models/cafe-models.js';
import { buildBankCard } from '../models/place-items.js';
import { addDwellTarget } from '../ui/dwell.js';
import { needsCard, pickCoins, WALLET } from './pick-coins.js';
import { store } from '../state/store.js';

/** The bank card's `cents`: it pays whatever is still due (see landedOnTray). */
const CARD = 0;
const WALLET_CENTS = WALLET.reduce((a, b) => a + b, 0);
const IDLE_REPORT_MS = 2500; // short payment: report after the learner stops adding coins
const TAP_MS = 320;
const TAP_MOVE = 0.04;
/** Released while aimed within this angle of the tray (seen from the head) counts as dropped on it. */
const TRAY_AIM_DEG = 11;
/** Coin grid in the dish (meters from the dish center): 3 rows of 4, every coin individually targetable. */
const COIN_COLS = [-0.075, -0.025, 0.025, 0.075];
const COIN_ROWS = [-0.045, 0, 0.045];
/** homeFor() slot index reserved for the bank card. */
const CARD_SLOT = -1;

const enum State {
  Dish,
  Held,
  Flying,
  Tray,
  Gone,
}

interface Money {
  entity: Entity;
  root: Group;
  cents: number;
  state: State;
  home: Vector3; // dish slot
  homeIndex: number; // stable slot index among coins (or among notes)
  from: Vector3;
  to: Vector3;
  t0: number;
  dur: number;
  arc: number;
  after: State; // state on landing
  grabStart: number;
  grabPos: Vector3;
  undwell: () => void;
  /** The bank card (pays the rest of the bill, then comes back to the dish). */
  card: boolean;
}

export class CoinSystem extends createSystem({
  coins: { required: [Coin] },
  held: { required: [Coin, Grabbed] },
}) {
  private money: Money[] = [];
  private clock = 0;
  private unreported = 0; // cents on the tray not yet sent to the order state
  private lastDropAt = -1;
  private register!: ReturnType<typeof buildRegisterDisplay>;
  private dishRoot!: Group;
  private tmp!: Vector3;
  private head!: Vector3;
  private lastLines = 0;
  private nextCoinSlot = 0;
  private nextNoteSlot = 0;

  init(): void {
    this.tmp = new Vector3();
    this.head = new Vector3();
    const tray = buildTray();
    tray.position.set(...TRAY);
    tray.name = 'Payment Tray';
    this.world.createTransformEntity(tray);

    this.dishRoot = buildMoneyDish();
    this.dishRoot.name = 'Money Dish';
    this.world.createTransformEntity(this.dishRoot);

    this.register = buildRegisterDisplay();
    this.register.root.position.set(...REGISTER);
    this.register.root.name = 'Cash Register';
    this.world.createTransformEntity(this.register.root);
    moneyStyle.highContrast = store.profile.settings.highContrast;
    this.register.setText('Bonjour');

    this.placeDish();
    this.refillWallet();

    this.queries.held.subscribe('qualify', (e) => {
      const m = this.money[e.getValue(Coin, 'slot') ?? -1];
      if (!m) return;
      m.state = State.Held;
      m.grabStart = this.clock;
      m.root.getWorldPosition(m.grabPos);
    });
    this.queries.held.subscribe('disqualify', (e) => {
      const m = this.money[e.getValue(Coin, 'slot') ?? -1];
      if (m && m.state === State.Held) this.release(m);
    });

    this.cleanupFuncs.push(
      events.order.on((o) => {
        // New order started: fresh purse on the counter.
        if (this.lastLines === 0 && o.lines.length > 0 && o.trayCents === 0) this.refillWallet();
        this.lastLines = o.lines.length;
        if (o.phase === 'paying') {
          const due = orderTotal(o.lines) - o.trayCents - this.unreported;
          // Not enough left in the purse (after many orders): fresh purse, nothing is on the tray yet.
          let inDish = 0;
          for (const m of this.money) if (m.state === State.Dish) inDish += m.cents;
          if (inDish < due && due <= WALLET_CENTS && this.unreported === 0 && o.trayCents === 0) this.refillWallet();
          if (needsCard(appState.place, due, this.purse())) this.ensureCard();
          this.register.setText(priceToDigits(due));
        }
        if (o.phase === 'paid') {
          this.register.setText('Merci !');
          this.collectTray();
        }
      }),
      events.effects.on((fx) => {
        for (const e of fx) {
          if (e.kind === 'show_total') this.register.setText(priceToDigits(e.totalCents));
          if (e.kind === 'return_change') this.giveChange(e.coins);
        }
      }),
      events.settings.on((s) => {
        this.placeDish();
        if (s.highContrast !== moneyStyle.highContrast) {
          moneyStyle.highContrast = s.highContrast;
          for (const m of this.money) if (!m.card) styleMoney(m.root, m.cents, s.highContrast);
          this.register.setText(String(this.register.root.userData.text ?? ''));
        }
      }),
      events.payExact.on(() => this.payExact()),
    );
  }

  private placeDish(): void {
    const [x, y, z] = dishPos(store.profile.settings.leftHanded);
    this.dishRoot.position.set(x, y, z);
    for (const m of this.money) {
      this.homeFor(m.homeIndex, m.cents >= 500, m.home);
      if (m.state === State.Dish) m.root.position.copy(m.home);
    }
  }

  /**
   * Coins sit in a grid inside the dish; notes lie side by side on the counter
   * just inside it (toward the learner's center line, where a narrow-view headset
   * such as Meta VR Glasses can still see them), never stacked under coins.
   */
  private homeFor(index: number, isNote: boolean, out: Vector3): Vector3 {
    const left = store.profile.settings.leftHanded;
    const [x, y, z] = dishPos(left);
    const outward = left ? -1 : 1;
    if (index === CARD_SLOT) return out.set(x - outward * 0.17, y + 0.008, z - 0.07);
    if (isNote) return out.set(x - outward * 0.17, y + 0.002 + index * 0.002, z + 0.005 - (index % 2) * 0.075);
    const slot = index % (COIN_COLS.length * COIN_ROWS.length);
    const lift = Math.floor(index / (COIN_COLS.length * COIN_ROWS.length)) * 0.006; // overflow stacks neatly
    return out.set(x + COIN_COLS[slot % COIN_COLS.length], y + 0.014 + lift, z + COIN_ROWS[Math.floor(slot / COIN_COLS.length)]);
  }



  private spawn(cents: number, at: V3 | Vector3, state: State): Money {
    const card = cents === CARD;
    const root = card ? buildBankCard() : buildMoney(cents);
    root.name = card ? 'Bank Card' : `Money ${cents}`;
    if (Array.isArray(at)) root.position.set(at[0], at[1], at[2]);
    else root.position.copy(at);
    const entity = this.world.createTransformEntity(root);
    const slot = this.money.length;
    const isNote = cents >= 500;
    const homeIndex = card ? CARD_SLOT : isNote ? this.nextNoteSlot++ : this.nextCoinSlot++;
    const home = this.homeFor(homeIndex, isNote || card, new Vector3());
    entity.addComponent(Coin, { cents, slot });
    entity.addComponent(RayInteractable);
    entity.addComponent(DistanceGrabbable, {
      // The coin rides the ray at its grab distance: aim at the tray and let go.
      // (Seated learners cannot reach the tray; MoveAtSource would need a 0.6 m reach.)
      movementMode: MovementMode.MoveFromTarget,
      translate: true,
      rotate: false,
      scale: false,
      returnToOrigin: false,
    });
    const m: Money = {
      entity, root, cents, state,
      home,
      homeIndex,
      from: new Vector3(), to: new Vector3(),
      t0: 0, dur: 0, arc: 0, after: state,
      grabStart: 0, grabPos: new Vector3(),
      undwell: () => undefined,
      card,
    };
    // Eyes-only: a one-second look at a coin in the dish sends it to the tray (only while paying).
    m.undwell = addDwellTarget(
      root,
      () => this.toTray(m, 0.12),
      2.6,
      () => m.state === State.Dish && store.order.phase === 'paying',
    );
    this.money.push(m);
    return m;
  }

  private refillWallet(): void {
    for (const m of this.money) {
      m.undwell();
      m.entity.dispose();
    }
    this.money = [];
    this.unreported = 0;
    this.nextCoinSlot = 0;
    this.nextNoteSlot = 0;
    for (const c of WALLET) {
      const m = this.spawn(c, [0, 0, 0], State.Dish);
      m.root.position.copy(m.home);
    }
    if (needsCard(appState.place, orderTotal(store.order.lines), this.purse())) this.ensureCard();
  }

  /** Cents in the dish (coins and notes, not the card). */
  private purse(): number {
    let n = 0;
    for (const m of this.money) if (m.state === State.Dish && !m.card) n += m.cents;
    return n;
  }

  /** Put the bank card in the dish if it is not there yet. */
  private ensureCard(): void {
    if (this.money.some((m) => m.card && m.state !== State.Gone)) return;
    const m = this.spawn(CARD, [0, 0, 0], State.Dish);
    m.root.position.copy(m.home);
  }

  private fly(m: Money, to: V3 | Vector3, dur: number, arc: number, after: State, delay = 0): void {
    m.from.copy(m.root.position);
    if (Array.isArray(to)) m.to.set(to[0], to[1], to[2]);
    else m.to.copy(to);
    m.t0 = this.clock + delay;
    m.dur = dur;
    m.arc = arc;
    m.after = after;
    m.state = State.Flying;
  }

  private release(m: Money): void {
    m.root.getWorldPosition(this.tmp);
    const dx = this.tmp.x - TRAY[0];
    const dz = this.tmp.z - TRAY[2];
    const landed = dx * dx + dz * dz < TRAY_RADIUS * TRAY_RADIUS && this.tmp.y < TRAY[1] + 0.35;
    // Or aimed at the tray from the learner's eyes when released (the coin rides the ray).
    this.player.head.getWorldPosition(this.head);
    const ax = this.tmp.x - this.head.x, ay = this.tmp.y - this.head.y, az = this.tmp.z - this.head.z;
    const bx = TRAY[0] - this.head.x, by = TRAY[1] + 0.02 - this.head.y, bz = TRAY[2] - this.head.z;
    const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
    const aimed = cos > Math.cos((TRAY_AIM_DEG * Math.PI) / 180);
    const onTray = landed || aimed;
    const tapped = this.clock - m.grabStart < TAP_MS / 1000 && this.tmp.distanceTo(m.grabPos) < TAP_MOVE;
    // Putting money on the tray is how a learner asks for the bill: while ordering it closes
    // the order and pays (the shopkeeper may have said the price without formally totalling).
    const o = store.order;
    const paying = o.phase === 'paying' || (o.phase === 'ordering' && o.lines.length > 0);
    if (paying && (onTray || tapped)) {
      this.toTray(m, tapped ? 0.12 : 0.03);
      return;
    }
    if (!paying && (onTray || tapped)) this.register.setText("Commandez d'abord");
    this.fly(m, m.home, 0.4, 0.08, State.Dish);
  }

  /** Send a piece to the next free spot on the tray (counted when it lands). */
  private toTray(m: Money, arc: number, delay = 0): void {
    let n = 0;
    for (const x of this.money) if (x.state === State.Tray || (x.state === State.Flying && x.after === State.Tray)) n++;
    this.fly(m, [TRAY[0] + ((n % 3) - 1) * 0.04, TRAY[1] + 0.012 + n * 0.003, TRAY[2] + (Math.floor(n / 3) - 0.5) * 0.04], 0.35, arc, State.Tray, delay);
  }

  /** "Je paie": the exact coins (or the smallest overpayment) fly from the dish to the tray. */
  private payExact(): void {
    if (store.order.phase !== 'paying') return;
    let pending = 0;
    for (const m of this.money) if (m.state === State.Flying && m.after === State.Tray) pending += m.cents;
    const due = orderTotal(store.order.lines) - store.order.trayCents - this.unreported - pending;
    if (due <= 0) return;
    const card = this.money.find((m) => m.card && m.state === State.Dish);
    if (card && needsCard(appState.place, due, this.purse())) {
      this.toTray(card, 0.12);
      return;
    }
    const dish = this.money.filter((m) => m.state === State.Dish && !m.card);
    const pick = pickCoins(dish.map((m) => m.cents), due);
    if (pick.length === 0) {
      void director.pay(due); // purse cannot cover it (should not happen): pay through the order state
      return;
    }
    pick.forEach((i, k) => this.toTray(dish[i], 0.12, k * 0.18));
  }

  private landedOnTray(m: Money): void {
    const due = orderTotal(store.order.lines) - store.order.trayCents;
    const amount = m.card ? Math.max(0, due - this.unreported) : m.cents;
    this.unreported += amount;
    this.lastDropAt = this.clock;
    events.coinDropped.emit(m.card ? 1000 : m.cents);
    const left = due - this.unreported;
    this.register.setText(m.card && left <= 0 ? 'Carte OK' : left > 0 ? `${priceToDigits(left)}` : 'OK !');
    if (left <= 0) this.report();
  }

  /** Commit coins on the tray to the order state (pays, or Lune says what is missing). */
  private report(): void {
    if (this.unreported <= 0) return;
    const cents = this.unreported;
    this.unreported = 0;
    this.lastDropAt = -1;
    void director.pay(cents);
  }

  /** Paid: Madame Lune takes the money from the tray. */
  private collectTray(): void {
    let i = 0;
    for (const m of this.money) {
      if (m.state !== State.Tray) continue;
      if (m.card) {
        this.fly(m, m.home, 0.5, 0.1, State.Dish, 0.4); // "Voilà votre carte."
        continue;
      }
      this.fly(m, LUNE_HAND, 0.5, 0.1, State.Gone, 0.15 * i++);
    }
  }

  /** Change counted out one coin at a time, from the tray into the dish (timed with the audio). */
  private giveChange(coins: readonly number[]): void {
    coins.forEach((c, i) => {
      const m = this.spawn(c, [TRAY[0], TRAY[1] + 0.02, TRAY[2]], State.Flying);
      m.root.visible = false;
      this.fly(m, m.home, 0.45, 0.12, State.Dish, 0.35 + i * 0.32);
    });
  }

  update(delta: number): void {
    this.clock += delta;
    if (this.lastDropAt >= 0 && this.clock - this.lastDropAt > IDLE_REPORT_MS / 1000) this.report();

    for (const m of this.money) {
      if (m.state !== State.Flying) continue;
      const t = (this.clock - m.t0) / m.dur;
      if (t < 0) continue;
      m.root.visible = true;
      if (t >= 1) {
        m.root.position.copy(m.to);
        m.state = m.after;
        if (m.after === State.Tray) this.landedOnTray(m);
        if (m.after === State.Gone) {
          m.root.visible = false;
          m.root.position.y = -50; // out of ray reach until the purse refills
        }
        continue;
      }
      const e = t * t * (3 - 2 * t); // smoothstep
      m.root.position.lerpVectors(m.from, m.to, e);
      m.root.position.y += Math.sin(Math.PI * t) * m.arc;
      if (m.after === State.Gone) m.root.scale.setScalar(1 - t * 0.9);
    }
  }
}
