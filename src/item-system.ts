/**
 * Builds the cafe and its pinchable vocabulary objects, then reacts to
 * hover (glow) and pinch/select (bounce + itemPicked event).
 */

import {
  AssetManager,
  Box3,
  createSystem,
  type Entity,
  Group,
  Hovered,
  Mesh,
  MeshStandardMaterial,
  Pressed,
  RayInteractable,
  RingGeometry,
  MeshBasicMaterial,
  DoubleSide,
  PlaneGeometry,
  ExtrudeGeometry,
  Shape,
  Path,
} from '@iwsdk/core';
import { director } from './agent/runtime.js';
import { emptyOrder, type OrderState } from './agent/tools.js';
import { buildHitArea, buildItem } from './cafe-builder.js';
import { VocabItem } from './components.js';
import { appState, events, type PlaceId } from './game-state.js';
import { COUNTER_Y, counterKeepOuts, displayStandRects } from './layout.js';
import { makeCanvasTexture } from './models/model-kit.js';
import { layoutOrder, type Rect, type ServeGroupIn, type ServeGroupOut } from './serve-layout.js';
import { store } from './state/store.js';
import { addDwellTarget } from './ui/dwell.js';
import { VOCAB, vocabById, type VocabEntry } from './vocab.js';
import { mergeStaticMeshes, stripTransmission } from './world/static-merge.js';

const _box = new Box3();
/** Lift that keeps flat goods (tickets, maps) from z-fighting with the counter top. */
const REST_LIFT = 0.002;

/** Stand the model on y = 0 (its lowest point just touches the counter): no floating, no sinking. */
function grounded(model: Group): Group {
  model.updateMatrixWorld(true);
  _box.setFromObject(model);
  if (!_box.isEmpty()) model.position.y += REST_LIFT - _box.min.y;
  return model;
}

/** The realistic model when it has loaded, otherwise the procedural stand-in, resting on y = 0. */
function itemModel(entry: VocabEntry, served = false): Group {
  return grounded(rawItemModel(entry, served));
}

/** `served`: the model's own yaw is dropped; the item system turns served copies to lie along the counter edge. */
function rawItemModel(entry: VocabEntry, served: boolean): Group {
  const gltf = entry.model ? AssetManager.getGLTF(entry.model) : null;
  if (!gltf) {
    const built = buildItem(entry.shape, entry.color);
    mergeStaticMeshes(built); // a box of macarons: 10 meshes, a few materials
    return built;
  }
  const g = new Group();
  const scene = gltf.scene;
  scene.scale.setScalar(entry.modelScale ?? 1);
  scene.position.y = entry.modelY ?? 0;
  scene.rotation.y = served ? 0 : (entry.rotY ?? 0);
  g.userData.inner = scene;
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // One draw call per material; no refraction pass.
  stripTransmission(scene);
  mergeStaticMeshes(scene);
  g.add(scene);
  return g;
}

interface ItemVisual {
  root: Group;
  baseY: number;
  glowMaterials: MeshStandardMaterial[];
  bounceStart: number; // seconds; -1 when idle
}

const BOUNCE_SECONDS = 0.45;
const POP_SECONDS = 0.35;

/** One item's footprint on the counter, measured from its model (meters, model space). */
interface Footprint {
  w: number;
  d: number;
  h: number;
  /** Footprint center offset from the model origin. */
  cx: number;
  cz: number;
  /** Served copies turn a quarter so their long side runs along the counter edge. */
  yaw: number;
}

interface ServedVisual {
  key: string;
  itemId: string;
  entity: Entity;
  root: Group;
  popStart: number;
  size: number;
}

/** What the order is served on, per shop: a café tray, a bread board, a market crate tray... */
const TRAY_LOOK: Record<PlaceId, { floor: number; rim: number; roughness: number; metalness?: number }> = {
  cafe: { floor: 0x3b2618, rim: 0xc9a24a, roughness: 0.45, metalness: 0.2 },
  boulangerie: { floor: 0xc79a64, rim: 0x9a6c3e, roughness: 0.7 },
  marche: { floor: 0xb58a55, rim: 0x6e4a2a, roughness: 0.85 },
  bistrot: { floor: 0x2b2f33, rim: 0x16181b, roughness: 0.6 },
  metro: { floor: 0x2b4a7a, rim: 0x1b2f50, roughness: 0.5 },
  pharmacie: { floor: 0xf4f6f3, rim: 0x2a9d48, roughness: 0.4 },
  hotel: { floor: 0x4a2c1c, rim: 0xc9a227, roughness: 0.5, metalness: 0.2 },
};
const TRAY_FLOOR_H = 0.005;
const TRAY_RIM_H = 0.016;
const TRAY_RIM_W = 0.008;

/** A rounded rectangle centred on the origin (shape space; extruded, then laid flat). */
function roundRect(path: Shape | Path, w: number, d: number, r: number): void {
  const x = -w / 2;
  const y = -d / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + d - r);
  path.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  path.lineTo(x + r, y + d);
  path.quadraticCurveTo(x, y + d, x, y + d - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

/** The tray (rim: true) or a thin mat under served goods, `rect` on the counter top. */
function buildTray(rect: Rect, place: PlaceId, rim: boolean): Group {
  const look = TRAY_LOOK[place];
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const r = Math.min(0.02, w / 4, d / 4);
  const g = new Group();
  g.name = rim ? 'Serving tray' : 'Serving mat';
  g.userData.serveTray = true;
  const floorShape = new Shape();
  roundRect(floorShape, w, d, r);
  const floorMat = new MeshStandardMaterial({ color: look.floor, roughness: look.roughness, metalness: look.metalness ?? 0 });
  const floor = new Mesh(new ExtrudeGeometry(floorShape, { depth: TRAY_FLOOR_H, bevelEnabled: false, curveSegments: 4 }), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  g.add(floor);
  if (rim) {
    const ring = new Shape();
    roundRect(ring, w, d, r);
    const hole = new Path();
    roundRect(hole, w - 2 * TRAY_RIM_W, d - 2 * TRAY_RIM_W, Math.max(0.002, r - TRAY_RIM_W));
    ring.holes.push(hole);
    const rimMat = new MeshStandardMaterial({ color: look.rim, roughness: look.roughness, metalness: look.metalness ?? 0 });
    const rimMesh = new Mesh(new ExtrudeGeometry(ring, { depth: TRAY_RIM_H, bevelEnabled: false, curveSegments: 4 }), rimMat);
    rimMesh.rotation.x = -Math.PI / 2;
    rimMesh.position.y = 0.001;
    rimMesh.receiveShadow = true;
    g.add(rimMesh);
  }
  g.position.set((rect.x0 + rect.x1) / 2, COUNTER_Y, (rect.z0 + rect.z1) / 2);
  return g;
}

interface ServedBadge {
  key: string;
  entity: Entity;
  root: Mesh;
}

export class ItemSystem extends createSystem({
  items: { required: [VocabItem] },
  hovered: { required: [VocabItem, Hovered] },
  pressed: { required: [VocabItem, Pressed] },
}) {
  private visuals: ItemVisual[] = [];
  private clock = 0;
  private targetIndex = -1;
  private ring!: Mesh;
  private served: ServedVisual[] = [];
  private badges: ServedBadge[] = [];
  private trays: { key: string; entity: Entity; root: Group }[] = [];
  /** Per shop: measured footprints, and the display goods' rectangles that served goods keep clear of. */
  private footprints = new Map<string, Footprint>();
  private displayRects: Rect[] = [];

  private itemEntities: Entity[] = [];
  private itemCleanups: (() => void)[] = [];

  init(): void {
    this.buildItems();
    this.setupShared();
    // A new shop: new words on the counter (models are loaded by PlaceSystem before this fires).
    this.cleanupFuncs.push(
      events.place.on(() => {
        this.targetIndex = -1;
        this.ring.visible = false;
        this.buildItems();
        this.reconcileServed(emptyOrder());
      }),
      () => {
        for (const off of this.itemCleanups) off();
      },
    );
  }

  /** (Re)create the pinchable words of the current shop. */
  private buildItems(): void {
    for (const off of this.itemCleanups) off();
    this.itemCleanups = [];
    for (const e of this.itemEntities) e.dispose();
    this.itemEntities = [];
    this.visuals = [];
    this.footprints.clear();
    this.displayRects = [];
    VOCAB.forEach((entry, index) => {
      const root = new Group();
      root.name = `Item ${entry.fr}`;
      const model = itemModel(entry);
      this.measure(entry, model);
      // Only counter items cast shadows (each caster is an extra draw call per frame).
      if (entry.position[1] < 0.9) model.traverse((o) => (o.castShadow = false));
      root.add(model);
      root.add(buildHitArea(0.11, 0.07));
      root.position.set(...entry.position);

      // Clone materials so each object can glow on its own.
      const glowMaterials: MeshStandardMaterial[] = [];
      model.traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          child.material = child.material.clone();
          glowMaterials.push(child.material);
        }
      });

      const entity = this.world.createTransformEntity(root);
      entity.addComponent(VocabItem, { index });
      // Eyes-only: looking at an object for 1 s picks it, like a pinch.
      this.itemCleanups.push(
        addDwellTarget(root, () => {
          const v = this.visuals[index];
          if (v) v.bounceStart = this.clock;
          events.itemPicked.emit(entry.id);
        }),
      );
      entity.addComponent(RayInteractable);
      this.itemEntities.push(entity);
      this.visuals[index] = { root, baseY: entry.position[1], glowMaterials, bounceStart: -1 };
    });
  }

  /** Record the item's footprint and, for goods on the counter, the rectangle they occupy. */
  private measure(entry: VocabEntry, model: Group): void {
    const [x, y, z] = entry.position;
    model.updateMatrixWorld(true);
    _box.setFromObject(model);
    if (_box.isEmpty()) return;
    if (y > COUNTER_Y - 0.1) this.displayRects.push({ x0: x + _box.min.x, x1: x + _box.max.x, z0: z + _box.min.z, z1: z + _box.max.z });
    // Served copies drop the display yaw (see rawItemModel): measure them unturned.
    const inner = model.userData.inner as Group | undefined;
    if (inner && inner.rotation.y !== 0) {
      const yaw = inner.rotation.y;
      inner.rotation.y = 0;
      model.updateMatrixWorld(true);
      _box.setFromObject(model);
      inner.rotation.y = yaw;
      model.updateMatrixWorld(true);
    }
    const w = _box.max.x - _box.min.x;
    const d = _box.max.z - _box.min.z;
    const cx = (_box.max.x + _box.min.x) / 2;
    const cz = (_box.max.z + _box.min.z) / 2;
    const turn = d > w * 1.15;
    this.footprints.set(entry.id, {
      w: turn ? d : w,
      d: turn ? w : d,
      h: _box.max.y - _box.min.y,
      // A quarter turn maps the offset (cx, cz) to (cz, -cx).
      cx: turn ? cz : cx,
      cz: turn ? -cx : cz,
      yaw: turn ? Math.PI / 2 : 0,
    });
  }

  private setupShared(): void {

    // Mission marker: a soft ring that pulses under the current target.
    this.ring = new Mesh(
      new RingGeometry(0.09, 0.11, 40),
      new MeshBasicMaterial({ color: 0xf5d90a, transparent: true, opacity: 0.85, side: DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.world.createTransformEntity(this.ring);

    this.cleanupFuncs.push(
      events.missionTarget.on((id) => {
        this.targetIndex = VOCAB.findIndex((v) => v.id === id);
        this.ring.visible = this.targetIndex >= 0;
        if (this.targetIndex >= 0) {
          const p = VOCAB[this.targetIndex].position;
          this.ring.position.set(p[0], p[1] + 0.004, p[2]);
        }
      }),
    );

    this.queries.hovered.subscribe('qualify', (e) => {
      this.setGlow(e, 0.35);
      director.perception.lookingAt = VOCAB[e.getValue(VocabItem, 'index') ?? -1]?.id ?? null;
    });
    this.queries.hovered.subscribe('disqualify', (e) => {
      this.setGlow(e, 0);
      const id = VOCAB[e.getValue(VocabItem, 'index') ?? -1]?.id;
      if (director.perception.lookingAt === id) director.perception.lookingAt = null;
    });

    // Agent effects: serve food, gesture at items.
    this.cleanupFuncs.push(
      events.order.on((o) => this.reconcileServed(o)),
      // Left-hand mode mirrors the money dish and Pal: re-pack around them.
      events.settings.on(() => this.reconcileServed(store.order)),
      events.viewFit.on(() => this.reconcileServed(store.order)),
      events.effects.on((effects) => {
        for (const fx of effects) {
          if (fx.kind === 'point') {
            const i = VOCAB.findIndex((v) => v.id === fx.itemId);
            if (this.visuals[i]) this.visuals[i].bounceStart = this.clock;
          }
        }
      }),
    );
    this.queries.pressed.subscribe('qualify', (e) => {
      const index = e.getValue(VocabItem, 'index') ?? -1;
      const visual = this.visuals[index];
      if (!visual) return;
      visual.bounceStart = this.clock;
      events.itemPicked.emit(VOCAB[index].id);
    });
  }

  private setGlow(entity: Entity, amount: number): void {
    const index = entity.getValue(VocabItem, 'index') ?? -1;
    const visual = this.visuals[index];
    if (!visual) return;
    for (const m of visual.glowMaterials) {
      m.emissive.setHex(0xf5d90a);
      m.emissiveIntensity = amount;
    }
  }

  /**
   * Make the goods on the counter match the order: one tidy group per line,
   * packed clear of the register, tray, money, Pal, candle and display goods
   * (see serve-layout.ts). Copies already on the counter stay; new ones pop in.
   */
  private reconcileServed(order: OrderState): void {
    const groups: ServeGroupIn[] = [];
    for (const l of order.lines) {
      const f = this.footprints.get(l.itemId);
      if (f && l.qty > 0) groups.push({ id: l.itemId, qty: l.qty, w: f.w, d: f.d, h: f.h });
    }
    const keepOuts = [...counterKeepOuts(store.profile.settings.leftHanded), ...displayStandRects(), ...this.displayRects];
    const { placed, trays, oneTray } = layoutOrder(groups, keepOuts, appState.narrowView);
    this.syncTrays(trays ?? [], !!oneTray);

    const old = new Map<string, ServedVisual>();
    for (const v of this.served) old.set(v.key, v);
    const next: ServedVisual[] = [];
    let fresh = 0;
    for (const g of placed) {
      const entry = vocabById(g.id);
      const f = this.footprints.get(g.id);
      if (!entry || !f) continue;
      g.copies.forEach((c, k) => {
        const key = `${g.id}#${k}`;
        let v = old.get(key);
        old.delete(key);
        if (!v) {
          const root = new Group();
          root.name = `Served ${entry.fr} ${k + 1}`;
          root.add(itemModel(entry, true));
          root.scale.setScalar(0.001);
          const entity = this.world.createTransformEntity(root);
          v = { key, itemId: g.id, entity, root, popStart: this.clock + fresh++ * 0.12, size: g.scale };
        }
        v.size = g.scale;
        if (v.popStart < 0) v.root.scale.setScalar(g.scale);
        v.root.rotation.y = f.yaw;
        v.root.position.set(c.x - f.cx * g.scale, COUNTER_Y + c.y, c.z - f.cz * g.scale);
        next.push(v);
      });
    }
    for (const v of old.values()) v.entity.dispose();
    this.served = next;
    this.syncBadges(placed);
  }

  /** The tray under the whole order (or one mat per line); kept while its rectangle does not change. */
  private syncTrays(rects: Rect[], oneTray: boolean): void {
    const keys = rects.map((r) => `${appState.place}|${oneTray ? 'tray' : 'mat'}|${[r.x0, r.x1, r.z0, r.z1].map((v) => v.toFixed(3)).join(',')}`);
    const keep = this.trays.filter((t) => keys.includes(t.key));
    for (const t of this.trays) {
      if (keep.includes(t)) continue;
      t.root.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshStandardMaterial).dispose();
        }
      });
      t.entity.dispose();
    }
    this.trays = keep;
    rects.forEach((r, i) => {
      if (this.trays.some((t) => t.key === keys[i])) return;
      const root = buildTray(r, appState.place, oneTray);
      this.trays.push({ key: keys[i], root, entity: this.world.createTransformEntity(root) });
    });
  }

  /** "x5" tags for groups that show fewer copies than were ordered. */
  private syncBadges(placed: ServeGroupOut[]): void {
    for (const b of this.badges) {
      const mat = b.root.material as MeshBasicMaterial;
      mat.map?.dispose();
      b.entity.dispose();
    }
    this.badges = [];
    for (const g of placed) {
      if (!g.badge) continue;
      const ct = makeCanvasTexture(128, 80);
      if (!ct) continue;
      const { ctx, tex } = ct;
      ctx.fillStyle = '#1d1f27';
      ctx.beginPath();
      ctx.roundRect(4, 4, 120, 72, 30);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#f5d90a';
      ctx.stroke();
      ctx.fillStyle = '#fafaf7';
      ctx.font = 'bold 50px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`\u00d7${g.qty}`, 64, 43);
      tex.needsUpdate = true;
      const root = new Mesh(new PlaneGeometry(0.064, 0.04), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      root.name = `Served badge ${g.id}`;
      // Front-right corner of the group, just above it, turned toward the learner.
      root.position.set(Math.min(g.rect.x1, g.rect.x0 + 0.05 + (g.rect.x1 - g.rect.x0) * 0.7), COUNTER_Y + g.top * g.scale + 0.035, g.rect.z1 - 0.02);
      root.lookAt(0, 1.25, 0);
      root.renderOrder = 2;
      const entity = this.world.createTransformEntity(root);
      this.badges.push({ key: g.id, entity, root });
    }
  }

  update(delta: number): void {
    this.clock += delta;
    for (const s of this.served) {
      if (s.popStart < 0) continue;
      const t = (this.clock - s.popStart) / POP_SECONDS;
      if (t < 0) continue;
      if (t >= 1) {
        s.root.scale.setScalar(s.size);
        s.popStart = -1;
      } else {
        // Ease-out-back pop so each item "lands" on the counter.
        const k = 1.70158;
        const u = t - 1;
        s.root.scale.setScalar(s.size * Math.max(0.001, 1 + (k + 1) * u * u * u + k * u * u));
      }
    }
    for (const v of this.visuals) {
      if (v.bounceStart < 0) continue;
      const t = (this.clock - v.bounceStart) / BOUNCE_SECONDS;
      if (t >= 1) {
        v.root.position.y = v.baseY;
        v.root.rotation.y = 0;
        v.bounceStart = -1;
      } else {
        v.root.position.y = v.baseY + Math.sin(t * Math.PI) * 0.08;
        v.root.rotation.y = t * Math.PI * 2;
      }
    }
    if (this.ring.visible) {
      const s = 1 + Math.sin(this.clock * 4) * 0.12;
      this.ring.scale.set(s, s, s);
    }
  }
}
