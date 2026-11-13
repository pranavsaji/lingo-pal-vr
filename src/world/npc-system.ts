/**
 * The shopkeeper's body language. The shopkeeper is the spatial agent, so her tool
 * calls become visible behaviour: point_at swings an arm toward the item, emote
 * plays a gesture, and she looks at the learner (or at what the learner looks at).
 * Lip flap is driven by the speech engine; blinks and breathing keep her alive.
 *
 * Each shop has its own rigged human (Microsoft Rocketbox avatars, see
 * ./characters/shopkeepers.ts): Madame Lune (cafe), Monsieur Paul (boulangerie),
 * Madame Rose (marche). They stand on the same spot and share every behaviour;
 * `events.place` swaps who is behind the counter. If an avatar cannot be loaded
 * the procedural Madame Lune stands in, so the counter is never empty.
 *
 * All animation is procedural and allocation-free per frame: this system builds a
 * CharacterPose, and the active driver (HumanRig or ProceduralLuneDriver) maps it
 * onto bones or groups.
 */

import { AssetManager, createSystem, Group, MathUtils, Vector3 } from '@iwsdk/core';
import type { Emote } from '../agent/tools.js';
import { director } from '../agent/runtime.js';
import { appState, events, type PlaceId } from '../game-state.js';
import { buildMadameLune } from '../models/cafe-models.js';
import { luneSpeaking } from '../speech.js';
import { store } from '../state/store.js';
import { VOCAB } from '../vocab.js';
import { type CharacterDriver, type CharacterPose, createPose } from './characters/character-pose.js';
import { aimArm, EMOTE_SECONDS, emoteEnvelope, lipFlap, poseEmote } from './characters/gestures.js';
import { HumanRig, prepareAvatar } from './characters/human-rig.js';
import { ProceduralLuneDriver } from './characters/procedural-driver.js';
import { SHOPKEEPER_POS, SHOPKEEPERS } from './characters/shopkeepers.js';

const POINT_SECONDS = 2.2;
/** Show the procedural stand-in if an avatar has not arrived after this long. */
const FALLBACK_AFTER_S = 6;
const PLACES = Object.keys(SHOPKEEPERS) as PlaceId[];

/** Closure-free lookup so update() stays allocation-free. */
function findVocab(id: string): (typeof VOCAB)[number] | undefined {
  for (let i = 0; i < VOCAB.length; i++) if (VOCAB[i].id === id) return VOCAB[i];
  return undefined;
}

export class NpcSystem extends createSystem({}) {
  private anchor!: Group;
  private driver: CharacterDriver | null = null;
  private human = false;
  private fallback: ProceduralLuneDriver | null = null;
  private readonly avatars = new Map<PlaceId, HumanRig>();
  private readonly loading = new Set<PlaceId>();
  private readonly failed = new Set<PlaceId>();
  private place: PlaceId = 'cafe';
  private waitingSince = 0;
  private prefetched = false;

  private t = 0;
  private speaking = false;
  private emote: Emote | null = null;
  private emoteStart = 0;
  private pointUntil = -1;
  private pointTarget!: Vector3;
  private nextBlink = 2;
  private headWorld!: Vector3;
  private look!: Vector3;
  private shoulder!: Vector3;
  private dir!: Vector3;
  /** Smoothed pose handed to the driver, and this frame's target. */
  private pose!: CharacterPose;
  private target!: CharacterPose;
  private headYaw = 0;
  private headPitch = 0;

  init(): void {
    this.headWorld = new Vector3();
    this.look = new Vector3();
    this.shoulder = new Vector3();
    this.dir = new Vector3();
    this.pointTarget = new Vector3();
    this.pose = createPose();
    this.target = createPose();

    // One anchor entity on the shopkeeper spot; the active character is its child.
    this.anchor = new Group();
    this.anchor.name = 'Shopkeeper';
    this.anchor.position.set(...SHOPKEEPER_POS);
    this.world.createTransformEntity(this.anchor);
    this.showPlace(appState.place);

    this.cleanupFuncs.push(
      luneSpeaking.on((on) => (this.speaking = on)),
      events.place.on((place) => this.showPlace(place)),
      events.effects.on((fx) => {
        for (const e of fx) {
          if (e.kind === 'emote') this.playEmote(e.emote);
          if (e.kind === 'goodbye') this.playEmote('wave');
          if (e.kind === 'point') this.pointAt(e.itemId);
          if (e.kind === 'show_total' || e.kind === 'return_change') this.pointAtTray();
        }
      }),
      events.heard.on(({ score }) => {
        if (score !== null && score >= 85) this.playEmote('nod');
      }),
      events.gesture.on((g) => {
        if (g === 'wave') this.playEmote('wave');
      }),
    );
  }

  // --- Who is behind the counter -------------------------------------------------

  private showPlace(place: PlaceId): void {
    this.place = place;
    const avatar = this.avatars.get(place);
    if (avatar) {
      this.activate(avatar, true);
      return;
    }
    if (this.failed.has(place) || !SHOPKEEPERS[place]) {
      this.activate(this.getFallback(), false);
      return;
    }
    // The previous shop's shopkeeper does not belong here: clear the counter while loading.
    this.activate(null, false);
    this.waitingSince = this.t;
    void this.loadAvatar(place);
  }

  private async loadAvatar(place: PlaceId): Promise<void> {
    if (this.loading.has(place) || this.avatars.has(place) || this.failed.has(place)) return;
    const spec = SHOPKEEPERS[place];
    this.loading.add(place);
    try {
      await AssetManager.loadGLTFById(spec.assetId);
      const gltf = AssetManager.getGLTF(spec.assetId); // a fresh skeleton-aware clone
      if (!gltf) throw new Error(`glTF "${spec.assetId}" missing from the cache`);
      prepareAvatar(gltf.scene, spec.name);
      const rig = new HumanRig(gltf.scene, spec.rig);
      rig.apply(this.pose);
      this.avatars.set(place, rig);
      if (this.place === place) this.activate(rig, true);
      this.prefetchOthers();
    } catch (err) {
      console.warn(`[NpcSystem] ${spec.name} unavailable, using the procedural shopkeeper`, err);
      this.failed.add(place);
      if (this.place === place) this.activate(this.getFallback(), false);
    } finally {
      this.loading.delete(place);
    }
  }

  /** Once the first avatar is up, warm the other shops' avatars so a shop switch is instant. */
  private prefetchOthers(): void {
    if (this.prefetched) return;
    this.prefetched = true;
    for (const p of PLACES) {
      if (p === this.place) continue;
      AssetManager.loadGLTFById(SHOPKEEPERS[p].assetId).catch(() => {
        // Reported (and the fallback shown) if the learner actually visits that shop.
      });
    }
  }

  private getFallback(): ProceduralLuneDriver {
    if (!this.fallback) {
      const rig = buildMadameLune();
      rig.root.name = 'Madame Lune (procedural)';
      this.fallback = new ProceduralLuneDriver(rig);
    }
    return this.fallback;
  }

  private activate(driver: CharacterDriver | null, human: boolean): void {
    if (this.driver === driver) return;
    if (this.driver) this.anchor.remove(this.driver.root);
    this.driver = driver;
    this.human = human;
    if (driver) {
      driver.apply(this.pose);
      this.anchor.add(driver.root);
    }
  }

  // --- Behaviours --------------------------------------------------------------------

  private playEmote(e: Emote): void {
    if (store.profile.settings.reduceMotion && e !== 'nod') return;
    this.emote = e;
    this.emoteStart = this.t;
  }

  private pointAt(itemId: string): void {
    const v = findVocab(itemId);
    if (!v) return;
    this.pointTarget.set(v.position[0], v.position[1] + 0.05, v.position[2]);
    this.pointUntil = this.t + POINT_SECONDS;
  }

  private pointAtTray(): void {
    this.pointTarget.set(0.05, 1.02, -1.13);
    this.pointUntil = this.t + 1.2;
  }

  update(delta: number): void {
    this.t += delta;
    const t = this.t;
    const d = this.driver;
    if (!d) {
      if (t - this.waitingSince > FALLBACK_AFTER_S) this.activate(this.getFallback(), false);
      return;
    }
    const pose = this.pose;
    const target = this.target;
    const k = 1 - Math.exp(-delta * 8); // gaze smoothing

    // --- Gaze: the item being pointed at, else what the learner looks at (briefly), else the learner.
    d.head.getWorldPosition(this.headWorld);
    const pointing = t < this.pointUntil;
    const lookItem = director.perception.lookingAt;
    if (pointing) this.look.copy(this.pointTarget);
    else if (lookItem && Math.sin(t * 0.7) > 0.3) {
      const v = findVocab(lookItem);
      if (v) this.look.set(v.position[0], v.position[1], v.position[2]);
      else this.player.head.getWorldPosition(this.look);
    } else this.player.head.getWorldPosition(this.look);
    this.dir.subVectors(this.look, this.headWorld);
    const horiz = Math.hypot(this.dir.x, this.dir.z);
    const rawYaw = Math.atan2(this.dir.x, this.dir.z);
    const rawPitch = -Math.atan2(this.dir.y, horiz);
    this.headYaw += (MathUtils.clamp(rawYaw, -0.7, 0.7) - this.headYaw) * k;
    this.headPitch += (MathUtils.clamp(rawPitch, -0.35, 0.45) - this.headPitch) * k;

    // --- Emote envelope (0..1..0) and phase.
    let emote: Emote | null = this.emote;
    let p = 0;
    let env = 0;
    if (emote) {
      p = (t - this.emoteStart) / EMOTE_SECONDS[emote];
      if (p >= 1) this.emote = emote = null;
      else env = emoteEnvelope(p);
    }
    poseEmote(target, emote, this.headPitch, p, env, t, this.human);

    // --- Pointing overrides the arm on the item's side.
    if (pointing) {
      const useLeft = this.pointTarget.x > SHOPKEEPER_POS[0];
      (useLeft ? d.leftShoulder : d.rightShoulder).getWorldPosition(this.shoulder);
      this.dir.subVectors(this.pointTarget, this.shoulder).normalize();
      const blend = Math.min(1, (this.pointUntil - t) * 3, (t - (this.pointUntil - POINT_SECONDS)) * 4);
      aimArm(target, useLeft, this.dir.x, this.dir.y, this.dir.z, blend);
    }

    // --- Head follows directly; eyes lead the head and hold the target through nods.
    pose.headPitch = target.headPitch;
    pose.headYaw = this.headYaw;
    pose.headRoll = target.headRoll;
    const ke = 1 - Math.exp(-delta * 20);
    pose.eyeYaw += (MathUtils.clamp(rawYaw - this.headYaw, -0.35, 0.35) - pose.eyeYaw) * ke;
    pose.eyePitch += (MathUtils.clamp(rawPitch - target.headPitch, -0.25, 0.25) - pose.eyePitch) * ke;

    // --- Arms ease toward their targets.
    const sk = 1 - Math.exp(-delta * 12);
    pose.lArmX += (target.lArmX - pose.lArmX) * sk;
    pose.lArmZ += (target.lArmZ - pose.lArmZ) * sk;
    pose.lForearmX += (target.lForearmX - pose.lForearmX) * sk;
    pose.rArmX += (target.rArmX - pose.rArmX) * sk;
    pose.rArmZ += (target.rArmZ - pose.rArmZ) * sk;
    pose.rForearmX += (target.rForearmX - pose.rForearmX) * sk;
    pose.lTwist += (target.lTwist - pose.lTwist) * sk;
    pose.rTwist += (target.rTwist - pose.rTwist) * sk;
    pose.shoulderRaise += (target.shoulderRaise - pose.shoulderRaise) * sk;
    pose.lPoint += (target.lPoint - pose.lPoint) * sk;
    pose.rPoint += (target.rPoint - pose.rPoint) * sk;

    // --- Lip flap from the speech engine.
    pose.mouthOpen += (lipFlap(this.speaking, t) - pose.mouthOpen) * (1 - Math.exp(-delta * 25));

    // --- Blink every 2.5 to 5 s.
    if (t >= this.nextBlink) {
      const b = (t - this.nextBlink) / 0.14;
      pose.blink = b < 1 ? 1 - Math.abs(1 - 2 * b) : 0;
      if (b >= 1) this.nextBlink = t + 2.5 + ((t * 7.31) % 2.5);
    }

    // --- Breathing.
    pose.breath = Math.sin(t * 1.6);

    d.apply(pose);
  }
}
