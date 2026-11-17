/**
 * Plan de Paris: when the learner opens the map in XR, a little tabletop Paris
 * unfolds on the counter in front of them (on their real desk in mixed
 * reality: the virtual world never moves, the rig does, so the counter and
 * this board follow the placed café). One pin per place: poke it or pinch it
 * (hand ray) to travel there, or look at it for a second in eyes mode. Locked
 * places show a grey pin with a padlock and how to open them.
 *
 * Cost: hidden = `visible = false`, rays off, no per-frame work. Shown = about
 * seven draw calls (land, river, pins, labels, the "you are here" halo, the
 * boat, the hover ring while hovering). The counter goods under the board are
 * hidden while it is open and come back when it closes.
 *
 * The 2D map panel stays: it opens alongside (accessibility, voice, the MR
 * buttons) and is the only map outside XR.
 */

import {
  BoxGeometry,
  type BufferGeometry,
  createSystem,
  CylinderGeometry,
  DoubleSide,
  type Entity,
  Group,
  Hovered,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PokeInteractable,
  Pressed,
  RayInteractable,
  RingGeometry,
  SphereGeometry,
  type Texture,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { ensureAudioContext } from '../audio/audio-hub.js';
import { Coin, VocabItem } from '../components.js';
import { appState, events, type PlaceId } from '../game-state.js';
import { makeCanvasTexture, merge, type Part, T, vcMat } from '../models/model-kit.js';
import { buildParisDiorama } from '../models/paris-diorama.js';
import {
  BOARD, DIORAMA_WORLD, dioramaPins, distanceToBox, LABEL, LABEL_EYE, labelCentre, type MapXZ, pickBox, type PickBox, pinColor, pinSubtitle,
  type PinView, PIN_COLORS, seinePoint, segmentHitsBox, underBoard,
} from '../places/paris-map.js';
import { lockedMessage, ordersToUnlock, PLACE_ORDER, placeUnlocked, unlockHint } from '../places/places.js';
import { speakFrench } from '../speech.js';
import { store } from '../state/store.js';
import { addDwellTarget } from '../ui/dwell.js';
import { tutorialState } from '../ui/input-mode.js';

const S = BOARD.surfaceY;
/** Label card size (metres) and its atlas slot (pixels). */
const LW = LABEL.w;
const LH = LABEL.h;
const SLOT_W = 512;
const SLOT_H = 200;
const ATLAS = 1024;
const COLS = ATLAS / SLOT_W;
/** Where labels face: a seated learner's eyes, in board coordinates. */
const EYE = new Vector3(LABEL_EYE.x, LABEL_EYE.y, LABEL_EYE.z);
/**
 * Fingertip touch. IWSDK's touch pointer presses anything within 2 cm of a
 * PokeInteractable, so a finger reaching past a front pin to a back one
 * grazed the front pin's volume and sent the learner to the wrong place. The
 * touch pointer still gives hover (ring) and hides the hand ray near the
 * board, but its presses are ignored here: a touch counts only when the
 * fingertip's path this frame actually enters a pin's thin pick slab (the
 * card plus 1 cm either side), first slab along the path wins, and that hand
 * has to come back out (TOUCH_RELEASE) before it can touch again.
 */
const TOUCH_NEAR = 0.03; // a Pressed this close to a fingertip came from the touch pointer
const TOUCH_RELEASE = 0.01;
const TOUCH_JUMP = 0.1; // longer frame-to-frame moves are tracking jumps: test the end point only
const HANDS = ['left', 'right'] as const;
/** Ignore the pinch that opened the map; leave a beat between the plop and the trip. */
const OPEN_GRACE_S = 0.45;
/** A second choice of the same locked pin within this many seconds goes there anyway. */
const AGAIN_S = 10;
const TRAVEL_DELAY_S = 0.35;
const BOAT_LAP_S = 46;

type Target = { kind: 'pin'; id: string } | { kind: 'close' };
interface Proxy {
  obj: Object3D;
  target: Target;
  box: PickBox;
}

interface Hidden {
  obj: Object3D;
  visible: boolean;
  pointerEvents: Object3D['pointerEvents'];
}


export class DioramaSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
  hovered: { required: [RayInteractable, Hovered] },
  items: { required: [VocabItem] },
  coins: { required: [Coin] },
}) {
  private built = false;
  private shown = false;
  private slotIsMap = false;
  private flat = false;
  private dirty = true;
  private clock = 0;
  private openedAt = 0;
  private root!: Group;
  private pinsMesh!: Mesh;
  private labelsMesh!: Mesh;
  private atlas: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: Texture } | null = null;
  private halo!: Mesh;
  private hoverRing!: Mesh;
  private boat!: Mesh;
  private pins: PinView[] = [];
  private targets = new Map<Entity, Target>();
  private proxies: Proxy[] = [];
  /** Per hand (left, right): last fingertip in board coordinates, and whether it is still in (or by) a slab. */
  private tipPrev = [new Vector3(), new Vector3()];
  private tipNow = new Vector3();
  private tipLatched = [false, false];
  private tipPrimed = [false, false];
  private hidden: Hidden[] = [];
  private flash: string | null = null;
  private flashAt = 0;
  private pending: { id: string; at: number } | null = null;
  private hereAt: MapXZ & { h: number } = { x: 0, z: 0, h: 0 };
  private popUntil = 0;
  private boatT = 0;
  private boatP: MapXZ = { x: 0, z: 0 };
  private boatQ: MapXZ = { x: 0, z: 0 };
  private tmp = new Vector3();

  init(): void {
    this.flat = typeof location !== 'undefined' && new URLSearchParams(location.search).has('diorama'); // flat-screen stills
    this.cleanupFuncs.push(
      events.panelShown.on((slot) => {
        this.slotIsMap = slot === 'map';
        this.evaluate();
      }),
      this.world.visibilityState.subscribe(() => this.evaluate()),
      events.placeCafe.on((what) => {
        if (what === 'start') this.setShown(false);
      }),
      events.tutorial.on(() => this.setShown(false)),
      // A trip by voice ("au marché") while the board is open: arrive with it folded away.
      events.place.on(() => {
        if (this.shown) events.openPanel.emit('home');
      }),
      events.profile.on(() => (this.dirty = true)),
      events.settings.on(() => (this.dirty = true)),
      events.stamp.on(() => (this.dirty = true)),
    );
    this.queries.pressed.subscribe('qualify', (e) => {
      const t = this.targets.get(e);
      // Ray pinch and mouse press here; fingertip presses are decided in update() (see TOUCH_NEAR).
      if (t && !this.fingertipNear(e)) this.activate(t);
    });
    this.queries.hovered.subscribe('qualify', (e) => {
      const t = this.targets.get(e);
      if (t?.kind === 'pin') this.hover(t.id);
    });
    this.queries.hovered.subscribe('disqualify', (e) => {
      if (this.targets.has(e) && this.built) this.hoverRing.visible = false;
    });
  }

  private wanted(): boolean {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    return this.slotIsMap && (immersive || this.flat) && !tutorialState.running && !appState.placingCafe && !appState.choosingInput;
  }

  private evaluate(): void {
    this.setShown(this.wanted());
  }

  private setShown(show: boolean): void {
    if (show === this.shown) return;
    if (show && !this.built) this.build();
    if (!this.built) return;
    this.shown = show;
    this.root.visible = show;
    for (const p of this.proxies) p.obj.pointerEvents = show ? 'auto' : 'none';
    this.hoverRing.visible = false;
    this.pending = null;
    this.tipPrimed[0] = this.tipPrimed[1] = false;
    if (show) {
      this.openedAt = this.clock;
      this.flash = null;
      this.dirty = true;
      this.render();
      this.clearCounter();
    } else {
      this.restoreCounter();
    }
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    this.built = true;
    this.root = new Group();
    this.root.name = 'Plan de Paris';
    this.root.position.set(DIORAMA_WORLD.x, DIORAMA_WORLD.y, DIORAMA_WORLD.z);
    this.root.add(buildParisDiorama().clone());
    this.root.visible = false;
    const rootEntity = this.world.createTransformEntity(this.root);

    const land = vcMat('paris-diorama', { roughness: 0.82 });
    this.pinsMesh = new Mesh(undefined, land);
    this.pinsMesh.name = 'Pins';
    this.atlas = makeCanvasTexture(ATLAS, ATLAS);
    const labelMat = new MeshBasicMaterial({ map: this.atlas?.tex ?? null, transparent: true, toneMapped: false, side: DoubleSide });
    this.labelsMesh = new Mesh(undefined, labelMat);
    this.labelsMesh.name = 'Pin Labels';
    this.labelsMesh.renderOrder = 2;

    const gold = new MeshBasicMaterial({ color: 0xf5d90a, transparent: true, opacity: 0.9, toneMapped: false, side: DoubleSide, depthWrite: false });
    this.halo = new Mesh(new RingGeometry(0.0125, 0.0175, 28).rotateX(-Math.PI / 2), gold);
    this.halo.name = 'Vous etes ici';
    this.hoverRing = new Mesh(new RingGeometry(0.0145, 0.0185, 28), gold);
    this.hoverRing.name = 'Pin Hover';
    this.hoverRing.visible = false;

    const boatParts: Part[] = [
      { g: new BoxGeometry(0.014, 0.003, 0.0055), m: T(0, 0.0015, 0), c: 0x2b3440 },
      { g: new BoxGeometry(0.008, 0.0028, 0.0042), m: T(-0.001, 0.0044, 0), c: 0xf6f3ec },
      { g: new BoxGeometry(0.003, 0.002, 0.0044), m: T(0.0045, 0.004, 0), c: 0xc8553d },
    ];
    this.boat = new Mesh(merge(boatParts), land);
    this.boat.name = 'Bateau-mouche';
    this.root.add(this.pinsMesh, this.labelsMesh, this.halo, this.hoverRing, this.boat);

    // Labels never change place: lay out the cards (UVs into the atlas) and the pick volumes once.
    this.pins = this.computePins();
    const cards: { m: Object3D; slot: number }[] = [];
    // Pick volumes: never drawn (material.visible = false costs no draw call), but rays, fingers and gaze find them.
    // Thin slabs around each card and its pin head (paris-map.ts pickBox), facing the learner like the cards.
    const pickMat = new MeshBasicMaterial({ visible: false });
    const basis = new Matrix4();
    const ax = new Vector3();
    const ay = new Vector3();
    const az = new Vector3();
    let proxyGeo: BoxGeometry | null = null;
    const add = (target: Target, x: number, y: number, z: number, slot: number) => {
      const card = new Object3D();
      card.position.set(x, y, z);
      card.lookAt(EYE);
      card.updateMatrix();
      cards.push({ m: card, slot });
      const box = pickBox({ x, y, z });
      proxyGeo ??= new BoxGeometry(box.hx * 2, box.hy * 2, box.hz * 2);
      const proxy = new Mesh(proxyGeo, pickMat);
      proxy.name = target.kind === 'pin' ? `Pin ${target.id}` : 'Plan Close';
      proxy.position.set(box.c.x, box.c.y, box.c.z);
      basis.makeBasis(ax.set(box.ax.x, box.ax.y, box.ax.z), ay.set(box.ay.x, box.ay.y, box.ay.z), az.set(box.az.x, box.az.y, box.az.z));
      proxy.quaternion.setFromRotationMatrix(basis);
      const entity = this.world.createTransformEntity(proxy, { parent: rootEntity });
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
      proxy.pointerEvents = 'none';
      this.targets.set(entity, target);
      this.proxies.push({ obj: proxy, target, box });
      // Eyes mode: look at a pin for a second.
      this.cleanupFuncs.push(addDwellTarget(proxy, () => this.activate(target), 3, () => this.shown));
    };
    this.pins.forEach((p, i) => {
      const c = labelCentre(p);
      add({ kind: 'pin', id: p.id }, c.x, c.y, c.z, i);
    });
    // Fermer: a small card on the front-right corner of the board; the title plaque on the front-left.
    add({ kind: 'close' }, BOARD.width / 2 - 0.07, S + 0.03, BOARD.depth / 2 - 0.012, 9);
    const plaque = new Object3D();
    plaque.position.set(-BOARD.width / 2 + 0.085, S + 0.03, BOARD.depth / 2 - 0.012);
    plaque.lookAt(EYE);
    plaque.updateMatrix();
    cards.push({ m: plaque, slot: 8 });

    // Back to front, so overlapping translucent card edges blend correctly.
    cards.sort((a, b) => b.m.position.distanceTo(EYE) - a.m.position.distanceTo(EYE));
    const quads: Part[] = cards.map(({ m, slot }) => {
      const g = new PlaneGeometry(LW, LH);
      const uv = g.getAttribute('uv');
      const u0 = (slot % COLS) * (SLOT_W / ATLAS);
      const v0 = 1 - (Math.floor(slot / COLS) + 1) * (SLOT_H / ATLAS);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (SLOT_W / ATLAS), v0 + uv.getY(k) * (SLOT_H / ATLAS));
      return { g, m: m.matrix };
    });
    this.labelsMesh.geometry = merge(quads);
  }

  private computePins(): PinView[] {
    return dioramaPins(PLACE_ORDER, appState.place, (id) => placeUnlocked(id as PlaceId, store.profile), store.profile.passport.stamps);
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    this.dirty = false;
    this.pins = this.computePins();
    const parts: Part[] = [];
    const stem = new CylinderGeometry(0.0016, 0.0016, 1, 6);
    const base = new CylinderGeometry(0.0075, 0.009, 0.002, 16);
    const head = new SphereGeometry(1, 14, 10);
    for (const p of this.pins) {
      const color = pinColor(p.id, p.state);
      const r = p.state === 'here' ? 0.0115 : 0.0095;
      parts.push({ g: base, m: T(p.x, S + 0.001, p.z), c: 0x3a3330 });
      parts.push({ g: stem, m: T(p.x, S + p.height / 2, p.z, 0, 0, 0, 1, p.height, 1), c: 0x4a4440 });
      parts.push({ g: head, m: T(p.x, S + p.height, p.z, 0, 0, 0, r), c: color });
      if (p.state === 'here') {
        this.hereAt.x = p.x;
        this.hereAt.z = p.z;
        this.hereAt.h = p.height;
      }
    }
    const old: BufferGeometry | null = this.pinsMesh.geometry ?? null;
    this.pinsMesh.geometry = merge(parts);
    old?.dispose();
    for (const g of [stem, base, head]) g.dispose();
    const here = this.pins.find((p) => p.state === 'here');
    this.halo.visible = Boolean(here);
    if (here) this.halo.position.set(here.x, S + 0.0035, here.z);
    this.drawAtlas();
  }

  private drawAtlas(): void {
    const a = this.atlas;
    if (!a) return;
    const g = a.ctx;
    g.clearRect(0, 0, ATLAS, ATLAS);
    const subtitles = store.profile.settings.subtitles;
    this.pins.forEach((p, i) => {
      const hint = unlockHint(p.id as PlaceId);
      this.drawCard(g, i, p, pinSubtitle(p, hint, subtitles));
    });
    const eyes = store.profile.settings.gazeDwell;
    const locked = this.flash ? this.pins.find((p) => p.id === this.flash && p.state === 'locked') : undefined;
    if (locked) {
      // The header explains the knock: how many orders open it, and that a second choice goes anyway.
      const left = ordersToUnlock(locked.id as PlaceId, store.profile);
      const sub = subtitles ? `Opens in ${left} more order${left === 1 ? '' : 's'} · choose again to go` : 'Encore une fois pour y aller';
      this.drawPlain(g, 8, `${locked.fr} : pas encore`, sub, '#3a2a12', '#e2b857');
    } else this.drawPlain(g, 8, 'Plan de Paris', subtitles ? (eyes ? 'Look at a pin to travel' : 'Touch or pinch a pin to travel') : '', '#1d2633', '#e2b857');
    this.drawPlain(g, 9, '×  Fermer', subtitles ? 'Close the map' : '', '#3b3d43', '#fafaf7');
    a.tex.needsUpdate = true;
  }

  private slotOrigin(slot: number): [number, number] {
    return [(slot % COLS) * SLOT_W, Math.floor(slot / COLS) * SLOT_H];
  }

  private drawPlain(g: CanvasRenderingContext2D, slot: number, title: string, sub: string, bg: string, accent: string): void {
    const [ox, oy] = this.slotOrigin(slot);
    g.save();
    g.translate(ox, oy);
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(6, 6, SLOT_W - 12, SLOT_H - 12, 34);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = accent;
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#fafaf7';
    g.font = 'bold 58px sans-serif';
    g.fillText(title, SLOT_W / 2, sub ? 92 : 120, SLOT_W - 50);
    if (sub) {
      g.fillStyle = '#c3cad6';
      g.font = '36px sans-serif';
      g.fillText(sub, SLOT_W / 2, 152, SLOT_W - 50);
    }
    g.restore();
  }

  /** One pin's card: icon disc in the place's colour (padlock when locked), French name, the second line, a stamp when earned. */
  private drawCard(g: CanvasRenderingContext2D, slot: number, p: PinView, sub: string): void {
    const [ox, oy] = this.slotOrigin(slot);
    const locked = p.state === 'locked';
    const here = p.state === 'here';
    const flashing = this.flash === p.id;
    g.save();
    g.translate(ox, oy);
    g.fillStyle = here ? 'rgba(18, 64, 60, 0.95)' : locked ? 'rgba(52, 54, 60, 0.93)' : 'rgba(20, 24, 32, 0.93)';
    g.beginPath();
    g.roundRect(6, 6, SLOT_W - 12, SLOT_H - 12, 34);
    g.fill();
    g.lineWidth = here || flashing ? 9 : 5;
    g.strokeStyle = flashing ? '#e2b857' : here ? '#e2b857' : locked ? '#4a5568' : hex(PIN_COLORS[p.id] ?? 0x2a9d8f);
    g.stroke();
    // Icon disc.
    const cx = 82;
    const cy = SLOT_H / 2;
    g.fillStyle = hex(pinColor(p.id, p.state));
    g.beginPath();
    g.arc(cx, cy, 54, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fafaf7';
    g.fillStyle = '#fafaf7';
    g.lineWidth = 7;
    if (locked) drawPadlock(g, cx, cy);
    else drawIcon(g, p.id, cx, cy);
    // Text.
    g.textAlign = 'left';
    const tx = 154;
    const maxW = SLOT_W - tx - 26;
    g.fillStyle = locked ? '#d5d7dc' : '#fafaf7';
    g.font = 'bold 50px sans-serif';
    g.fillText(p.fr, tx, sub ? 88 : 116, maxW);
    if (sub) {
      g.fillStyle = here ? '#e2b857' : locked ? '#e2b857' : '#b8c0cc';
      g.font = `${sub.length > 24 ? 28 : 34}px sans-serif`;
      wrap(g, sub, tx, 136, maxW, sub.length > 24 ? 32 : 38);
    }
    if (p.stamped) {
      // Passport stamp earned here: a little red cachet.
      g.save();
      g.translate(SLOT_W - 46, 46);
      g.rotate(-0.25);
      g.strokeStyle = '#d64545';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(0, 0, 26, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(-12, 1);
      g.lineTo(-3, 11);
      g.lineTo(14, -10);
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  // ------------------------------------------------------------------ input

  private activate(t: Target): void {
    if (!this.shown || this.pending || this.clock - this.openedAt < OPEN_GRACE_S) return;
    if (t.kind === 'close') {
      this.plop(520, 0.7);
      events.openPanel.emit('home');
      return;
    }
    const pin = this.pins.find((p) => p.id === t.id);
    if (!pin) return;
    if (pin.state === 'here') {
      this.plop(660, 0.8);
      events.openPanel.emit('home'); // already here: just fold the map
      return;
    }
    if (pin.state === 'locked') {
      if (this.flash !== pin.id || this.clock - this.flashAt > AGAIN_S) {
        // First touch: a low double knock, the card flashes, the header and the
        // chat panel say what opens it, and the hint is spoken. No trip yet.
        this.plop(240, 0.9);
        this.plop(200, 0.9, 0.12);
        this.flash = pin.id;
        this.flashAt = this.clock;
        this.drawAtlas();
        const msg = lockedMessage(pin.id as PlaceId, pin, store.profile);
        events.agentNote.emit(store.profile.settings.subtitles ? `${msg.fr} ${msg.en}` : msg.fr);
        speakFrench(unlockHint(pin.id as PlaceId).fr, store.profile.settings.slowSpeech ? 0.7 : 0.9);
        return;
      }
      // Chosen again: go anyway (a lock suggests an order, it never traps the learner).
      appState.travelAnyway = pin.id as PlaceId;
      events.agentNote.emit('');
    }
    // Plop, the gold halo hops onto the chosen pin, then the trip (fade) starts.
    this.plop(720, 0.5);
    this.halo.visible = true;
    this.halo.position.set(pin.x, S + 0.0035, pin.z);
    this.popUntil = this.clock + TRAVEL_DELAY_S;
    this.pending = { id: pin.id, at: this.clock + TRAVEL_DELAY_S };
  }

  /** True when a fingertip is within TOUCH_NEAR of this proxy's slab (the press came from the touch pointer). */
  private fingertipNear(e: Entity): boolean {
    const proxy = this.proxies.find((p) => p.obj === e.object3D);
    if (!proxy) return false;
    for (const hand of HANDS) {
      this.boardPoint(this.player.indexTipSpaces[hand], this.tipNow);
      if (distanceToBox(proxy.box, this.tipNow.x, this.tipNow.y, this.tipNow.z) <= TOUCH_NEAR) return true;
    }
    return false;
  }

  private boardPoint(obj: Object3D, out: Vector3): Vector3 {
    obj.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }

  /**
   * Fingertip touch (see TOUCH_NEAR): the first slab this frame's fingertip
   * path enters fires, once, until that hand comes back out.
   */
  private updateTouch(): void {
    for (let h = 0; h < 2; h++) {
      const tip = this.boardPoint(this.player.indexTipSpaces[HANDS[h]], this.tipNow);
      const prev = this.tipPrev[h];
      if (!this.tipPrimed[h]) {
        // First frame shown: a finger already resting in a slab must come out first.
        this.tipPrimed[h] = true;
        prev.copy(tip);
        this.tipLatched[h] = this.nearestSlab(tip) <= TOUCH_RELEASE;
        continue;
      }
      if (this.tipLatched[h]) {
        if (this.nearestSlab(tip) > TOUCH_RELEASE) this.tipLatched[h] = false;
        prev.copy(tip);
        continue;
      }
      if (prev.distanceTo(tip) > TOUCH_JUMP) prev.copy(tip);
      let best: Proxy | null = null;
      let bestD = Infinity;
      for (const p of this.proxies) {
        if (!segmentHitsBox(p.box, prev.x, prev.y, prev.z, tip.x, tip.y, tip.z)) continue;
        // First touched along the path: the slab nearest the previous fingertip.
        const d = distanceToBox(p.box, prev.x, prev.y, prev.z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      prev.copy(tip);
      if (best) {
        this.tipLatched[h] = true;
        this.activate(best.target);
      }
    }
  }

  private nearestSlab(tip: Vector3): number {
    let d = Infinity;
    for (const p of this.proxies) d = Math.min(d, distanceToBox(p.box, tip.x, tip.y, tip.z));
    return d;
  }

  private hover(id: string): void {
    const p = this.pins.find((x) => x.id === id);
    if (!p || !this.shown) return;
    this.hoverRing.position.set(p.x, S + p.height, p.z);
    this.hoverRing.lookAt(this.tmp.copy(EYE).add(this.root.position));
    this.hoverRing.visible = true;
  }

  /** A short synthesized "plop" (pitch drops), optionally delayed. */
  private plop(freq: number, glide: number, delay = 0): void {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * glide, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(ctx.destination);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    o.start(t);
    o.stop(t + 0.2);
  }

  // ------------------------------------------------------------------ the counter under the board

  /** Hide the goods, served food, tray and tray coins that stand where the board lies (restored on close). */
  private clearCounter(): void {
    this.hidden = [];
    const consider = (obj: Object3D | null | undefined) => {
      if (!obj || !obj.visible) return;
      obj.getWorldPosition(this.tmp);
      if (this.tmp.y < DIORAMA_WORLD.y - 0.1 || this.tmp.y > DIORAMA_WORLD.y + 0.3 || !underBoard(this.tmp.x, this.tmp.z)) return;
      this.hidden.push({ obj, visible: obj.visible, pointerEvents: obj.pointerEvents });
      obj.visible = false;
      obj.pointerEvents = 'none';
    };
    for (const e of this.queries.items.entities) consider(e.object3D);
    for (const e of this.queries.coins.entities) consider(e.object3D);
    for (const child of this.world.scene.children) {
      // Entity roots may sit one level down (under the level root).
      for (const o of [child, ...child.children]) if (o.name === 'Payment Tray' || o.name.startsWith('Served ')) consider(o);
    }
    // The middle of the display stand (display-fixture.ts) and the order's tray.
    this.world.scene.traverse((o) => {
      if (o.userData.displayStand || o.userData.serveTray) consider(o);
    });
  }

  private restoreCounter(): void {
    for (const h of this.hidden) {
      h.obj.visible = h.visible;
      h.obj.pointerEvents = h.pointerEvents;
    }
    this.hidden = [];
  }

  // ------------------------------------------------------------------ frame

  update(delta: number): void {
    if (!this.shown) return;
    this.clock += delta;
    if (tutorialState.running || appState.placingCafe || appState.choosingInput) {
      this.setShown(false);
      return;
    }
    if (this.dirty) this.render();
    if (!this.flat) this.updateTouch();
    if (this.pending && this.clock >= this.pending.at) {
      const id = this.pending.id as PlaceId;
      this.pending = null;
      events.openPanel.emit('home'); // folds the board (and the 2D map)
      events.travel.emit(id);
      return;
    }
    const reduce = store.profile.settings.reduceMotion;
    // The "you are here" halo breathes; after a choice it pops on the chosen pin.
    const pop = this.popUntil > this.clock ? 1 + (1 - (this.popUntil - this.clock) / TRAVEL_DELAY_S) * 0.9 : 1;
    this.halo.scale.setScalar(reduce ? pop : pop * (1 + Math.sin(this.clock * 3.2) * 0.12));
    // A bateau-mouche cruising the Seine (east to west and back).
    if (!reduce) {
      this.boatT = (this.boatT + delta / BOAT_LAP_S) % 2;
      const t = this.boatT < 1 ? this.boatT : 2 - this.boatT;
      const dir = this.boatT < 1 ? 1 : -1;
      seinePoint(0.06 + t * 0.88, this.boatP);
      seinePoint(0.06 + t * 0.88 + 0.01 * dir, this.boatQ);
      this.boat.position.set(this.boatP.x, S + 0.0012, this.boatP.z);
      this.boat.rotation.y = Math.atan2(-(this.boatQ.z - this.boatP.z), this.boatQ.x - this.boatP.x);
    }
  }
}

// ------------------------------------------------------------------ canvas helpers

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Word-wrap up to two lines. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line && row === 0) {
      g.fillText(line, x, y, maxW);
      line = w;
      row++;
    } else line = test;
  }
  g.fillText(line, x, y + row * lineH, maxW);
}

function drawPadlock(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  g.beginPath();
  g.arc(cx, cy - 8, 16, Math.PI, 0);
  g.stroke();
  g.beginPath();
  g.roundRect(cx - 24, cy - 8, 48, 36, 6);
  g.fill();
}

/** A tiny white glyph per place (unknown places: their initial). */
function drawIcon(g: CanvasRenderingContext2D, id: string, cx: number, cy: number): void {
  g.beginPath();
  switch (id) {
    case 'cafe': // cup and saucer
      g.roundRect(cx - 22, cy - 16, 36, 32, [0, 0, 12, 12]);
      g.fill();
      g.beginPath();
      g.arc(cx + 18, cy - 2, 9, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.fillRect(cx - 30, cy + 20, 56, 6);
      return;
    case 'boulangerie': // baguette with cuts
      g.save();
      g.translate(cx, cy);
      g.rotate(-0.6);
      g.beginPath();
      g.ellipse(0, 0, 36, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = hex(PIN_COLORS.boulangerie);
      g.lineWidth = 4;
      for (const x of [-16, 0, 16]) {
        g.beginPath();
        g.moveTo(x - 5, -6);
        g.lineTo(x + 5, 6);
        g.stroke();
      }
      g.restore();
      return;
    case 'marche': // apple
      g.arc(cx - 8, cy + 4, 18, 0, Math.PI * 2);
      g.arc(cx + 8, cy + 4, 18, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(cx + 8, cy - 22, 9, 4, -0.5, 0, Math.PI * 2);
      g.fill();
      return;
    case 'bistrot': // wine glass
      g.moveTo(cx - 18, cy - 26);
      g.lineTo(cx + 18, cy - 26);
      g.quadraticCurveTo(cx + 18, cy + 2, cx, cy + 4);
      g.quadraticCurveTo(cx - 18, cy + 2, cx - 18, cy - 26);
      g.fill();
      g.fillRect(cx - 2.5, cy + 2, 5, 18);
      g.fillRect(cx - 14, cy + 20, 28, 5);
      return;
    case 'metro': // the M sign
      g.font = 'bold 66px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('M', cx, cy + 3);
      g.textBaseline = 'alphabetic';
      return;
    case 'pharmacie': // cross
      g.fillRect(cx - 9, cy - 28, 18, 56);
      g.fillRect(cx - 28, cy - 9, 56, 18);
      return;
    case 'hotel': // bed
      g.fillRect(cx - 30, cy - 2, 60, 14);
      g.fillRect(cx - 30, cy - 22, 7, 44);
      g.fillRect(cx + 23, cy + 6, 7, 16);
      g.beginPath();
      g.arc(cx - 11, cy - 10, 8, 0, Math.PI * 2);
      g.fill();
      return;
    default:
      g.font = 'bold 56px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(id.charAt(0).toUpperCase(), cx, cy + 3);
      g.textBaseline = 'alphabetic';
  }
}

