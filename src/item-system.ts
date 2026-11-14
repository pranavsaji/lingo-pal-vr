/**
 * Builds the cafe and its pinchable vocabulary objects, then reacts to
 * hover (glow) and pinch/select (bounce + itemPicked event).
 */

import {
  AssetManager,
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
} from '@iwsdk/core';
import { director } from './agent/runtime.js';
import { emptyOrder, type OrderState } from './agent/tools.js';
import { buildHitArea, buildItem } from './cafe-builder.js';
import { VocabItem } from './components.js';
import { events } from './game-state.js';
import { SERVE } from './layout.js';
import { addDwellTarget } from './ui/dwell.js';
import { VOCAB, vocabById, type VocabEntry } from './vocab.js';
import { mergeStaticMeshes, stripTransmission } from './world/static-merge.js';

/** The realistic model when it has loaded, otherwise the procedural stand-in. */
function itemModel(entry: VocabEntry): Group {
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
  scene.rotation.y = entry.rotY ?? 0;
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

const MAX_SERVED = SERVE.perRow * SERVE.z.length;

interface ServedVisual {
  itemId: string;
  entity: Entity;
  root: Group;
  popStart: number;
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
    VOCAB.forEach((entry, index) => {
      const root = new Group();
      root.name = `Item ${entry.fr}`;
      const model = itemModel(entry);
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

  /** Make the food on the counter match the order: add missing, dispose extra. */
  private reconcileServed(order: OrderState): void {
    const wanted: string[] = [];
    for (const l of order.lines) for (let k = 0; k < l.qty; k++) wanted.push(l.itemId);
    wanted.length = Math.min(wanted.length, MAX_SERVED);

    // Keep visuals that still match their slot; dispose the rest.
    const keep: ServedVisual[] = [];
    for (let i = 0; i < this.served.length; i++) {
      const v = this.served[i];
      if (wanted[i] === v.itemId && keep.length === i) keep.push(v);
      else v.entity.dispose();
    }
    const firstNew = keep.length;
    for (let i = firstNew; i < wanted.length; i++) {
      const entry = vocabById(wanted[i]);
      if (!entry) continue;
      const root = new Group();
      root.name = `Served ${entry.fr} ${i + 1}`;
      root.add(itemModel(entry));
      root.position.set(SERVE.x0 + (i % SERVE.perRow) * SERVE.dx, SERVE.y, SERVE.z[Math.floor(i / SERVE.perRow)]);
      root.scale.setScalar(0.001);
      const entity = this.world.createTransformEntity(root);
      keep.push({ itemId: entry.id, entity, root, popStart: this.clock + (i - firstNew) * 0.12 });
    }
    this.served = keep;
  }

  update(delta: number): void {
    this.clock += delta;
    for (const s of this.served) {
      if (s.popStart < 0) continue;
      const t = (this.clock - s.popStart) / POP_SECONDS;
      if (t < 0) continue;
      if (t >= 1) {
        s.root.scale.setScalar(1);
        s.popStart = -1;
      } else {
        // Ease-out-back pop so each item "lands" on the counter.
        const k = 1.70158;
        const u = t - 1;
        s.root.scale.setScalar(Math.max(0.001, 1 + (k + 1) * u * u * u + k * u * u));
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
