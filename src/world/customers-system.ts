/**
 * Background customers: two other people in each shop (see ./characters/customers.ts
 * for who and where). Pure ambience: no interaction components, no speech, outside
 * the learner's reach and clear of the counter, panels and shopkeeper sight lines.
 *
 * Loading never competes with the shop itself: a shop's customers are fetched only
 * after its shopkeeper has arrived (plus a short grace period), their shaders are
 * compiled and their textures uploaded one per tick before they appear, and each
 * customer is cached once built. `events.place` swaps them; a customer that failed to
 * load (slow network) is retried on the next visit to that shop.
 *
 * In mixed reality they disappear with the rest of the virtual room: their roots are
 * tagged `userData.mrHide` (collected by MixedRealitySystem) and this system also
 * hides its anchor itself whenever the session blends with passthrough, which covers
 * customers that finish loading after MixedRealitySystem collected the shop.
 *
 * Per frame: one behaviour step and one rig pose per visible customer, no allocations.
 */

import {
  AssetManager,
  createSystem,
  Group,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
  Vector3,
} from '@iwsdk/core';
import { appState, events, type PlaceId } from '../game-state.js';
import { type CharacterPose, createPose } from './characters/character-pose.js';
import { buildCoffeeCup, buildSaucer, HeldCup } from './characters/coffee-cup.js';
import { CustomerBehaviour, type GazeTargets, relativeGaze } from './characters/customer-behaviour.js';
import {
  type CustomerSpec,
  CUSTOMERS,
  customerEyeHeight,
  customerRootY,
  TABLE_TOP,
  nearFriendSeat,
} from './characters/customers.js';
import { HumanRig, prepareAvatar } from './characters/human-rig.js';
import { SHOPKEEPER_POS, SHOPKEEPERS } from './characters/shopkeepers.js';

/** Grace period after the shopkeeper is in before customers start downloading (ms). */
const AFTER_SHOPKEEPER_MS = 1500;
/** Pause between texture uploads so no single frame takes the whole hit (ms). */
const UPLOAD_GAP_MS = 40;
/** Extra bounding-sphere radius so gestures stay inside the culling bounds (m). */
const CULL_MARGIN = 0.4;
const SAUCER_HEIGHT = 0.012;
/** Longest wait for asynchronous shader compilation before showing a customer anyway (ms). */
const COMPILE_WAIT_MS = 3000;

interface Customer {
  spec: CustomerSpec;
  root: Object3D;
  rig: HumanRig;
  behaviour: CustomerBehaviour;
  pose: CharacterPose;
  /** Extra objects placed beside the person (cup, saucer), children of the anchor. */
  extras: Object3D[];
  held: HeldCup | null;
  counterYaw: number;
  counterPitch: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CustomersSystem extends createSystem({}) {
  private anchor!: Group;
  private place: PlaceId = 'cafe';
  private active: Customer[] = [];
  /** Built customers by manifest id (cached across shop visits). */
  private readonly built = new Map<string, Customer>();
  private readonly loading = new Set<PlaceId>();
  private readonly learner = new Vector3();
  private readonly gaze: GazeTargets = { learnerYaw: 0, learnerPitch: 0, counterYaw: 0, counterPitch: 0 };
  private readonly rel = { yaw: 0, pitch: 0 };
  private disposed = false;
  private friendHere = false;

  init(): void {
    this.anchor = new Group();
    this.anchor.name = 'Customers';
    this.world.createTransformEntity(this.anchor);
    this.show(appState.place);
    this.cleanupFuncs.push(
      events.place.on((place) => this.show(place)),
      // Café à deux: free the counter-end seats for the friend's avatar.
      events.friendPresent.on((here) => {
        if (here === this.friendHere) return;
        this.friendHere = here;
        this.show(this.place);
      }),
      () => {
        this.disposed = true;
      },
    );
  }

  private show(place: PlaceId): void {
    this.place = place;
    for (const c of this.active) {
      this.anchor.remove(c.root);
      for (const x of c.extras) this.anchor.remove(x);
    }
    this.active = [];
    let missing = false;
    for (const spec of CUSTOMERS[place]) {
      const c = this.built.get(spec.assetId);
      if (c) this.attach(c);
      else missing = true;
    }
    if (missing) void this.load(place);
  }

  private attach(c: Customer): void {
    if (this.friendHere && nearFriendSeat(c.spec.pos[0], c.spec.pos[1])) return;
    this.active.push(c);
    this.anchor.add(c.root);
    for (const x of c.extras) this.anchor.add(x);
  }

  private async load(place: PlaceId): Promise<void> {
    if (this.loading.has(place)) return;
    this.loading.add(place);
    try {
      // The shopkeeper (and the shop) first; customers are background detail.
      await AssetManager.loadGLTFById(SHOPKEEPERS[place].assetId).catch(() => undefined);
      await sleep(AFTER_SHOPKEEPER_MS);
      for (const spec of CUSTOMERS[place]) {
        if (this.disposed) return;
        if (this.built.has(spec.assetId)) continue;
        try {
          const c = await this.build(spec);
          this.built.set(spec.assetId, c);
          if (this.place === place && !this.disposed && !this.active.includes(c)) this.attach(c);
        } catch (err) {
          // A missing customer is only missing ambience: carry on without them (retried next visit).
          console.warn(`[CustomersSystem] ${spec.source} unavailable`, err);
        }
      }
    } finally {
      this.loading.delete(place);
    }
  }

  private async build(spec: CustomerSpec): Promise<Customer> {
    await AssetManager.loadGLTFById(spec.assetId);
    const gltf = AssetManager.getGLTF(spec.assetId); // a fresh skeleton-aware clone
    if (!gltf) throw new Error(`glTF "${spec.assetId}" missing from the cache`);
    const root = gltf.scene;
    prepareAvatar(root, spec.name);
    root.userData.mrHide = true;
    const rig = new HumanRig(root, { legs: true });
    root.position.set(spec.pos[0], customerRootY(spec, rig.hipHeight), spec.pos[1]);
    root.rotation.y = spec.yaw;

    const eye = customerEyeHeight(spec.posture);
    relativeGaze(spec.pos[0], eye, spec.pos[1], spec.yaw, SHOPKEEPER_POS[0], 1.6, SHOPKEEPER_POS[2], this.rel);
    const c: Customer = {
      spec,
      root,
      rig,
      behaviour: new CustomerBehaviour(spec.posture, spec.activity, spec.seed),
      pose: createPose(),
      extras: [],
      held: null,
      counterYaw: this.rel.yaw,
      counterPitch: this.rel.pitch,
    };
    this.stepCustomer(c, 1 / 60);
    root.updateMatrixWorld(true);
    this.addCoffee(c);
    this.fitCulling(root);
    await this.warmUp(c);
    return c;
  }

  /** Cafe customers have a coffee: held (and sipped) by `sip`, on the table for the others. */
  private addCoffee(c: Customer): void {
    const { spec, root } = c;
    if (!spec.table) return;
    const cup = buildCoffeeCup();
    const saucer = buildSaucer();
    for (const o of [cup, saucer]) {
      o.userData.mrHide = true;
      c.extras.push(o);
    }
    const hand = root.getObjectByName('Bip01_R_Hand');
    const index = root.getObjectByName('Bip01_R_Finger1');
    const pinky = root.getObjectByName('Bip01_R_Finger4') ?? root.getObjectByName('Bip01_R_Finger3');
    // The anchor sits at the world origin, so world and anchor space coincide here.
    if (spec.activity === 'sip' && hand && index && pinky) {
      c.held = new HeldCup(cup, hand, index, pinky, -1, TABLE_TOP + SAUCER_HEIGHT);
      this.anchor.add(cup);
      c.held.update(0);
      this.anchor.remove(cup);
      saucer.position.set(cup.position.x, TABLE_TOP, cup.position.z);
    } else {
      // On the table, a hand's width in from the edge on their side.
      const dx = spec.pos[0] - spec.table[0];
      const dz = spec.pos[1] - spec.table[1];
      const d = Math.hypot(dx, dz) || 1;
      const x = spec.table[0] + (dx / d) * 0.2;
      const z = spec.table[1] + (dz / d) * 0.2;
      saucer.position.set(x, TABLE_TOP, z);
      cup.position.set(x, TABLE_TOP + SAUCER_HEIGHT, z);
      cup.rotation.y = spec.yaw + 0.6;
    }
  }

  /** Cull against a generous, posed bounding sphere instead of never culling. */
  private fitCulling(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) {
        mesh.boundingSphere.radius += CULL_MARGIN;
        mesh.frustumCulled = true;
      }
    });
  }

  /** Compile shaders and upload textures ahead of time, a bit per tick, so the shop never hitches. */
  private async warmUp(c: Customer): Promise<void> {
    const renderer = this.world.renderer;
    const textures = new Set<Texture>();
    c.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) textures.add(v as Texture);
      }
    });
    for (const t of textures) {
      if (this.disposed) return;
      try {
        renderer.initTexture(t);
      } catch {
        // Uploaded on first draw instead.
      }
      await sleep(UPLOAD_GAP_MS);
    }
    try {
      const holder = new Group();
      holder.add(c.root, ...c.extras);
      // Bounded: if the driver never reports completion, shaders simply compile on first draw.
      await Promise.race([renderer.compileAsync(holder, this.world.camera, this.world.scene), sleep(COMPILE_WAIT_MS)]);
      holder.remove(c.root, ...c.extras);
    } catch {
      // Compiled on first draw instead.
    }
  }

  private stepCustomer(c: Customer, delta: number): void {
    const s = c.spec;
    const g = this.gaze;
    relativeGaze(s.pos[0], customerEyeHeight(s.posture), s.pos[1], s.yaw, this.learner.x, this.learner.y, this.learner.z, this.rel);
    g.learnerYaw = this.rel.yaw;
    g.learnerPitch = this.rel.pitch;
    g.counterYaw = c.counterYaw;
    g.counterPitch = c.counterPitch;
    c.behaviour.step(delta, g, c.pose);
    c.rig.apply(c.pose);
    // Uses last frame's hand matrices: one frame of lag is invisible at sipping speed.
    if (c.held) c.held.update(c.behaviour.cupTilt);
  }

  update(delta: number): void {
    const mode = this.world.xrSession?.environmentBlendMode;
    const passthrough = mode === 'alpha-blend' || mode === 'additive';
    this.anchor.visible = !passthrough;
    if (passthrough || this.active.length === 0) return;
    this.player.head.getWorldPosition(this.learner);
    const dt = Math.min(delta, 0.1);
    for (let i = 0; i < this.active.length; i++) this.stepCustomer(this.active[i], dt);
  }
}
