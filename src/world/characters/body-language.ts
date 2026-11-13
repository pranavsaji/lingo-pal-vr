/**
 * Conversational body language for the shopkeepers, as pure, allocation-free state
 * machines that add onto a CharacterPose target (see NpcSystem):
 *
 * - TalkGestures: while the shopkeeper speaks, small "beats" (a forearm lift with
 *   the palm opening), occasional open-palm "presenting" gestures, mostly
 *   alternating hands, sometimes both, sometimes a pause; head nods on some beats,
 *   a head tilt and lean that change per phrase, and the torso turning a touch
 *   toward the gesturing hand. Every channel is low-pass filtered, so gestures
 *   ease in and out and the whole layer fades in when speech starts and out when
 *   it stops. Timing and amplitudes are randomised, so it never loops visibly.
 * - IdleLife: when nothing else is going on, a slow weight shift from foot to
 *   foot, small hand resettles, and an occasional glance away.
 *
 * Callers pass a weight (0..1) to `apply`, which lets emotes and pointing win:
 * NpcSystem fades the layer out while either is active.
 */

import type { CharacterPose } from './character-pose.js';

/** Small seeded PRNG (mulberry32): deterministic in tests, no allocation. */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/** Exponential approach factor for a rate (1/s) over dt (s). */
export function ease(dt: number, rate: number): number {
  return 1 - Math.exp(-dt * rate);
}

/** One hand's gesture channels (0..1), current and goal. */
class HandChannels {
  lift = 0;
  open = 0;
  out = 0;
  fwd = 0;
  liftG = 0;
  openG = 0;
  outG = 0;
  fwdG = 0;
  holdUntil = 0;

  set(lift: number, open: number, out: number, fwd: number, until: number): void {
    this.liftG = lift;
    this.openG = open;
    this.outG = out;
    this.fwdG = fwd;
    this.holdUntil = until;
  }

  step(dt: number, t: number): void {
    if (t >= this.holdUntil) this.liftG = this.openG = this.outG = this.fwdG = 0;
    // Quick into a gesture, slower back to rest: reads as a deliberate beat, not a twitch.
    this.lift += (this.liftG - this.lift) * ease(dt, this.liftG > this.lift ? 7 : 3.2);
    this.open += (this.openG - this.open) * ease(dt, this.openG > this.open ? 6 : 3);
    this.out += (this.outG - this.out) * ease(dt, this.outG > this.out ? 5 : 2.6);
    this.fwd += (this.fwdG - this.fwd) * ease(dt, this.fwdG > this.fwd ? 5 : 2.6);
  }

  reset(): void {
    this.lift = this.open = this.out = this.fwd = 0;
    this.set(0, 0, 0, 0, 0);
  }
}

export class TalkGestures {
  /** 0..1: how much of the talking layer is showing (eases in/out with speech). */
  blend = 0;
  readonly left = new HandChannels();
  readonly right = new HandChannels();
  /** Head nod (rad, + = down), tilt (roll, rad), yaw offset (rad); torso lean (rad). */
  nod = 0;
  tilt = 0;
  yaw = 0;
  lean = 0;
  /** Number of gesture beats started (diagnostics and tests). */
  beats = 0;

  private t = 0;
  private nextBeat = 0;
  private phraseUntil = 0;
  private nodG = 0;
  private nodUntil = 0;
  private tiltG = 0;
  private yawG = 0;
  private leanG = 0;
  private lastHand = 1;
  private dominant = 1;
  private readonly rng: Rng;

  constructor(seed = 7) {
    this.rng = new Rng(seed);
  }

  step(dt: number, speaking: boolean): void {
    const rng = this.rng;
    const t = (this.t += dt);
    this.blend += ((speaking ? 1 : 0) - this.blend) * ease(dt, speaking ? 4 : 2.2);

    if (speaking) {
      if (t >= this.phraseUntil) {
        // A new phrase: fresh head tilt, gaze offset, lean and favourite hand.
        this.phraseUntil = t + rng.range(2.2, 4.6);
        this.tiltG = rng.range(-1, 1) * 0.07;
        this.yawG = rng.range(-1, 1) * 0.07;
        this.leanG = rng.range(0.015, 0.05);
        this.dominant = rng.next() < 0.6 ? 1 : 0; // right-handed more often
      }
      if (t >= this.nextBeat) this.beat(t);
    } else {
      this.phraseUntil = 0;
      this.tiltG = this.yawG = this.leanG = 0;
      // The first gesture lands shortly after speech starts, not on the first syllable.
      this.nextBeat = t + 0.25;
    }

    if (t >= this.nodUntil) this.nodG = 0;
    this.left.step(dt, t);
    this.right.step(dt, t);
    this.nod += (this.nodG - this.nod) * ease(dt, this.nodG > this.nod ? 9 : 5);
    const slow = ease(dt, 1.6);
    this.tilt += (this.tiltG - this.tilt) * slow;
    this.yaw += (this.yawG - this.yaw) * slow;
    this.lean += (this.leanG - this.lean) * slow;
  }

  private beat(t: number): void {
    const rng = this.rng;
    if (rng.next() < 0.14) {
      // A pause: the hands settle for a moment.
      this.nextBeat = t + rng.range(0.9, 1.7);
      return;
    }
    const rb = rng.next();
    const both = rb < 0.18;
    let hand = rb < 0.7 ? 1 - this.lastHand : this.lastHand;
    if (!both && rng.next() < 0.25) hand = this.dominant;
    this.lastHand = hand;

    let amp = rng.range(0.45, 1) * (both ? 0.75 : 1);
    const rk = rng.next();
    let lift: number, open: number, out: number, fwd: number, hold: number;
    if (rk < 0.55) {
      // Beat: a small lift with the palm turning up a little.
      lift = 0.65; open = 0.4; out = 0.18; fwd = 0.3; hold = rng.range(0.2, 0.42);
    } else if (rk < 0.85) {
      // Presenting: open palm out to the side, held a little longer.
      lift = 0.5; open = 1; out = 0.65; fwd = 0.55; hold = rng.range(0.55, 1.05);
    } else {
      // Tiny emphasis.
      lift = 0.3; open = 0.15; out = 0.05; fwd = 0.1; hold = rng.range(0.25, 0.4);
      amp = Math.min(amp, 0.7);
    }
    const until = t + hold;
    if (both || hand === 0) this.left.set(lift * amp, open * amp, out * amp, fwd * amp, until);
    if (both || hand === 1) this.right.set(lift * amp, open * amp, out * amp, fwd * amp, until);
    if (rng.next() < 0.45) {
      this.nodG = rng.range(0.045, 0.09) * amp;
      this.nodUntil = t + rng.range(0.16, 0.28);
    }
    this.beats++;
    this.nextBeat = until + rng.range(0.18, 0.7);
  }

  /**
   * Add the talking layer onto `target` (arm targets, head) and write the body
   * channels (torso, wrists, grips). `w` (0..1) is the caller's permission: 0 while an
   * emote or pointing owns the body.
   */
  apply(target: CharacterPose, w: number): void {
    const k = this.blend * Math.max(0, Math.min(1, w));
    const L = this.left;
    const R = this.right;
    // While speaking the hands come up a touch (engaged), on top of each gesture.
    const home = 0.12;
    target.lArmX -= (0.1 * L.fwd + 0.13 * L.lift + home * 0.5) * k;
    target.rArmX -= (0.1 * R.fwd + 0.13 * R.lift + home * 0.5) * k;
    target.lArmZ += 0.22 * L.out * k;
    target.rArmZ -= 0.22 * R.out * k;
    target.lForearmX -= (0.6 * L.lift + home) * k;
    target.rForearmX -= (0.6 * R.lift + home) * k;
    target.lTwist += 1.15 * L.open * k;
    target.rTwist += 1.15 * R.open * k;
    target.shoulderRaise += 0.06 * (L.out + R.out) * k;
    target.headPitch += this.nod * k;
    target.headRoll += this.tilt * k;
    target.lWrist = (0.12 * L.lift - 0.3 * L.open) * k;
    target.rWrist = (0.12 * R.lift - 0.3 * R.open) * k;
    target.lGrip = -0.75 * L.open * k;
    target.rGrip = -0.75 * R.open * k;
    target.torsoPitch = this.lean * k;
    target.torsoYaw = 0.05 * (L.lift + L.out - R.lift - R.out) * k;
  }

  reset(): void {
    this.blend = this.nod = this.tilt = this.yaw = this.lean = 0;
    this.nodG = this.tiltG = this.yawG = this.leanG = 0;
    this.phraseUntil = this.nodUntil = 0;
    this.left.reset();
    this.right.reset();
  }
}

/**
 * Standing legs for a weight shift `sway` (-1..1, CharacterPose.hipSway): feet a little
 * apart, and the unweighted leg relaxes (knee softly bent). The rig keeps both feet
 * planted under the shifted hips.
 */
export function standingLegs(out: CharacterPose, sway: number): void {
  out.hipSway = sway;
  out.lThighX = -0.03 - 0.06 * Math.max(0, -sway);
  out.lThighZ = 0.04;
  out.lKnee = 0.14 * Math.max(0, -sway);
  out.lFoot = 0;
  out.rThighX = -0.03 - 0.06 * Math.max(0, sway);
  out.rThighZ = -0.04;
  out.rKnee = 0.14 * Math.max(0, sway);
  out.rFoot = 0;
}

/** Quiet-moment life: weight shift, hand resettles and the occasional glance away. */
export class IdleLife {
  /** -1..1 weight shift (CharacterPose.hipSway). */
  sway = 0;
  /** Glance offsets added to the gaze (rad; + yaw toward +X, + pitch down). */
  glanceYaw = 0;
  glancePitch = 0;
  /** Small resting forearm offsets (rad, + lowers the hand). */
  lRest = 0;
  rRest = 0;
  /** Glances started (diagnostics and tests). */
  glances = 0;

  private t = 0;
  private swayG = 0;
  private nextSway = 0;
  private gYawG = 0;
  private gPitchG = 0;
  private nextGlance: number;
  private glanceUntil = 0;
  private lRestG = 0;
  private rRestG = 0;
  private nextSettle = 0;
  private readonly rng: Rng;

  constructor(seed = 11) {
    this.rng = new Rng(seed);
    this.nextGlance = this.rng.range(4, 8);
  }

  /** `quiet`: nothing else is happening, so a glance away is allowed. */
  step(dt: number, quiet: boolean): void {
    const rng = this.rng;
    const t = (this.t += dt);
    if (t >= this.nextSway) {
      // Mostly settle onto one leg or the other; sometimes stand evenly.
      const r = rng.next();
      this.swayG = r < 0.2 ? rng.range(-0.25, 0.25) : (r < 0.6 ? 1 : -1) * rng.range(0.6, 1);
      this.nextSway = t + rng.range(4.5, 9.5);
    }
    if (t >= this.nextSettle) {
      this.lRestG = rng.range(-0.08, 0.1);
      this.rRestG = rng.range(-0.08, 0.1);
      this.nextSettle = t + rng.range(5, 12);
    }
    if (quiet && t >= this.nextGlance && t >= this.glanceUntil) {
      // A short look away: down at the counter or off to one side.
      const side = rng.next() < 0.5 ? -1 : 1;
      const down = rng.next() < 0.55;
      this.gYawG = side * rng.range(down ? 0.12 : 0.3, down ? 0.3 : 0.6);
      this.gPitchG = down ? rng.range(0.18, 0.32) : rng.range(-0.05, 0.08);
      this.glanceUntil = t + rng.range(0.7, 1.6);
      this.nextGlance = this.glanceUntil + rng.range(5, 11);
      this.glances++;
    }
    if (!quiet || t >= this.glanceUntil) this.gYawG = this.gPitchG = 0;
    this.sway += (this.swayG - this.sway) * ease(dt, 0.9);
    const g = ease(dt, 7);
    this.glanceYaw += (this.gYawG - this.glanceYaw) * g;
    this.glancePitch += (this.gPitchG - this.glancePitch) * g;
    const r = ease(dt, 1.2);
    this.lRest += (this.lRestG - this.lRest) * r;
    this.rRest += (this.rRestG - this.rRest) * r;
  }

  /** Add the resting hand offsets onto `target` (scaled by `w`). */
  apply(target: CharacterPose, w: number): void {
    target.lForearmX += this.lRest * w;
    target.rForearmX += this.rRest * w;
  }
}
