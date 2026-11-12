/**
 * Madame Lune's body language. She is the spatial agent, so her tool calls
 * become visible behavior: point_at swings her arm toward the item, emote plays
 * a gesture, and she looks at the learner (or at what the learner looks at).
 * Lip flap is driven by the speech engine; blinks and breathing keep her alive.
 * All animation is procedural and allocation-free per frame.
 */

import { createSystem, MathUtils, Vector3 } from '@iwsdk/core';
import type { Emote } from '../agent/tools.js';
import { director } from '../agent/runtime.js';
import { events } from '../game-state.js';
import { buildMadameLune, type LuneRig } from '../models/cafe-models.js';
import { luneSpeaking } from '../speech.js';
import { store } from '../state/store.js';
import { VOCAB } from '../vocab.js';

const LUNE_POS: [number, number, number] = [0.15, 0, -1.65];
const EMOTE_SECONDS: Record<Emote, number> = { nod: 0.9, shrug: 1.2, wave: 1.6, laugh: 1.3, think: 1.8, clap: 1.4 };
const POINT_SECONDS = 2.2;

export class NpcSystem extends createSystem({}) {
  private rig!: LuneRig;
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
  // Smoothed joint targets.
  private headYaw = 0;
  private headPitch = 0;

  init(): void {
    this.headWorld = new Vector3();
    this.look = new Vector3();
    this.shoulder = new Vector3();
    this.dir = new Vector3();
    this.pointTarget = new Vector3();

    this.rig = buildMadameLune();
    this.rig.root.name = 'Madame Lune';
    this.rig.root.position.set(...LUNE_POS);
    this.world.createTransformEntity(this.rig.root);

    this.cleanupFuncs.push(
      luneSpeaking.on((on) => (this.speaking = on)),
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

  private playEmote(e: Emote): void {
    if (store.profile.settings.reduceMotion && e !== 'nod') return;
    this.emote = e;
    this.emoteStart = this.t;
  }

  private pointAt(itemId: string): void {
    const v = VOCAB.find((x) => x.id === itemId);
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
    const r = this.rig;
    const t = this.t;
    const k = 1 - Math.exp(-delta * 8); // smoothing factor

    // --- Gaze: the item being pointed at, else what the learner looks at (briefly), else the learner.
    r.head.getWorldPosition(this.headWorld);
    const pointing = t < this.pointUntil;
    const lookItem = director.perception.lookingAt;
    if (pointing) this.look.copy(this.pointTarget);
    else if (lookItem && Math.sin(t * 0.7) > 0.3) {
      const v = VOCAB.find((x) => x.id === lookItem);
      if (v) this.look.set(v.position[0], v.position[1], v.position[2]);
      else this.player.head.getWorldPosition(this.look);
    } else this.player.head.getWorldPosition(this.look);
    this.dir.subVectors(this.look, this.headWorld);
    const horiz = Math.hypot(this.dir.x, this.dir.z);
    const yawTarget = MathUtils.clamp(Math.atan2(this.dir.x, this.dir.z), -0.7, 0.7);
    const pitchTarget = MathUtils.clamp(-Math.atan2(this.dir.y, horiz), -0.35, 0.45);
    this.headYaw += (yawTarget - this.headYaw) * k;
    this.headPitch += (pitchTarget - this.headPitch) * k;

    // --- Emote envelope (0..1..0) and phase.
    let emote: Emote | null = this.emote;
    let p = 0;
    let env = 0;
    if (emote) {
      p = (t - this.emoteStart) / EMOTE_SECONDS[emote];
      if (p >= 1) {
        this.emote = emote = null;
      } else {
        env = Math.sin(Math.PI * Math.min(1, p * 1.15));
      }
    }

    let headPitch = this.headPitch;
    let headRoll = 0;
    // Arms at rest: slightly forward, hands on the counter edge.
    let lx = -0.35, lz = 0.12, lfx = -0.9;
    let rx = -0.35, rz = -0.12, rfx = -0.9;

    switch (emote) {
      case 'nod':
        headPitch += Math.sin(p * Math.PI * 4) * 0.22 * env;
        break;
      case 'shrug':
        lz = 0.12 + 0.55 * env; rz = -0.12 - 0.55 * env;
        lfx = -0.9 - 0.6 * env; rfx = -0.9 - 0.6 * env;
        headRoll = 0.18 * env;
        break;
      case 'wave': // her right hand (at -X) waves
        rx = -0.35 - 2.4 * env; rz = -0.12 - 0.35 * env;
        rfx = -0.9 + 0.6 * env + Math.sin(t * 14) * 0.35 * env;
        headRoll = -0.08 * env;
        break;
      case 'laugh':
        headPitch -= 0.25 * env;
        headPitch += Math.sin(t * 22) * 0.05 * env;
        lfx = -1.3 * env - 0.9 * (1 - env); rfx = lfx;
        break;
      case 'think': // hand to chin, head tilted
        rx = -0.35 - 0.9 * env; rz = -0.12 + 0.25 * env; rfx = -0.9 - 1.3 * env;
        headRoll = 0.2 * env;
        headPitch -= 0.12 * env;
        break;
      case 'clap': {
        const c = Math.abs(Math.sin(t * 11));
        lx = rx = -0.35 - 0.75 * env;
        lz = 0.12 - (0.22 + 0.12 * c) * env;
        rz = -0.12 + (0.22 + 0.12 * c) * env;
        lfx = rfx = -0.9 - 0.4 * env;
        break;
      }
    }

    // --- Pointing (overrides her own-left arm, the one nearer most items at +X... choose by side).
    if (pointing) {
      const useLeft = this.pointTarget.x > LUNE_POS[0];
      const arm = useLeft ? r.leftArm : r.rightArm;
      arm.getWorldPosition(this.shoulder);
      this.dir.subVectors(this.pointTarget, this.shoulder).normalize();
      const blend = Math.min(1, (this.pointUntil - t) * 3, (t - (this.pointUntil - POINT_SECONDS)) * 4);
      const theta = Math.atan2(-this.dir.z, -this.dir.y);
      const phi = Math.asin(MathUtils.clamp(this.dir.x, -1, 1));
      if (useLeft) {
        lx = MathUtils.lerp(lx, theta, blend); lz = MathUtils.lerp(lz, phi, blend); lfx = MathUtils.lerp(lfx, -0.1, blend);
      } else {
        rx = MathUtils.lerp(rx, theta, blend); rz = MathUtils.lerp(rz, phi, blend); rfx = MathUtils.lerp(rfx, -0.1, blend);
      }
    }

    r.head.rotation.set(headPitch, this.headYaw, headRoll);
    const sk = 1 - Math.exp(-delta * 12);
    r.leftArm.rotation.x += (lx - r.leftArm.rotation.x) * sk;
    r.leftArm.rotation.z += (lz - r.leftArm.rotation.z) * sk;
    r.rightArm.rotation.x += (rx - r.rightArm.rotation.x) * sk;
    r.rightArm.rotation.z += (rz - r.rightArm.rotation.z) * sk;
    r.leftForearm.rotation.x += (lfx - r.leftForearm.rotation.x) * sk;
    r.rightForearm.rotation.x += (rfx - r.rightForearm.rotation.x) * sk;

    // --- Lip flap: two incommensurate sines read as syllables.
    const open = this.speaking ? 0.25 + Math.abs(Math.sin(t * 13.7) * Math.sin(t * 4.9)) * 1.3 : 0.2;
    r.mouth.scale.y += (open - r.mouth.scale.y) * (1 - Math.exp(-delta * 25));

    // --- Blink every 2.5 to 5 s.
    if (t >= this.nextBlink) {
      const b = (t - this.nextBlink) / 0.14;
      const s = b < 1 ? Math.max(0.1, Math.abs(1 - 2 * b)) : 1;
      for (const eye of r.eyes) eye.scale.y = s;
      if (b >= 1) this.nextBlink = t + 2.5 + ((t * 7.31) % 2.5);
    }

    // --- Breathing.
    r.root.scale.y = 1 + Math.sin(t * 1.6) * 0.006;
  }
}
