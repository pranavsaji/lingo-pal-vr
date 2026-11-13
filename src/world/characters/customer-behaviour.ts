/**
 * Idle behaviour for a background customer, as a pure, allocation-free generator of
 * CharacterPose frames: a posture (seated with bent legs, or standing with a slow
 * weight shift), breathing and blinks, head turns between a few interests (their
 * table or the goods, the counter, the room, now and then the learner), and an
 * occasional activity gesture (a sip of coffee, chin on hand, a look at the watch,
 * a hand to the chin while choosing). Every channel eases, so nothing pops.
 */

import { ease, Rng, standingLegs } from './body-language.js';
import type { CharacterPose } from './character-pose.js';
import type { Activity, Posture } from './customers.js';

/** Where the learner and the shopkeeper are, as head yaw/pitch relative to the customer's body (rad). */
export interface GazeTargets {
  learnerYaw: number;
  learnerPitch: number;
  counterYaw: number;
  counterPitch: number;
}

/** A gesture the customer plays now and then, as a 0..1 envelope. */
type Gesture = 'none' | 'sip' | 'chin' | 'watch' | 'consider';

const GAZE_MAX_YAW = 1.15;

/** Head yaw/pitch (rad) from a customer at (x, headY, z) with body yaw `yaw` to a world point. */
export function relativeGaze(
  x: number, headY: number, z: number, yaw: number,
  tx: number, ty: number, tz: number,
  out: { yaw: number; pitch: number },
): void {
  const dx = tx - x;
  const dz = tz - z;
  // Rotate the offset into the body frame (rotation by -yaw about +Y).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  out.yaw = Math.atan2(lx, lz);
  out.pitch = -Math.atan2(ty - headY, Math.hypot(lx, lz));
}

export class CustomerBehaviour {
  /** 0..1 envelope of the current gesture. */
  gestureEnv = 0;
  gesture: Gesture = 'none';

  /** How far a held cup tips toward the lips (rad). */
  get cupTilt(): number {
    return this.gesture === 'sip' ? this.gestureEnv * 0.55 : 0;
  }

  private t = 0;
  private readonly rng: Rng;
  // Gaze.
  private yaw = 0;
  private pitch = 0.2;
  private yawG = 0;
  private pitchG = 0.2;
  private gazeMode = 0;
  private gazeUntil = 0;
  private lastLearnerLook = -20;
  // Weight shift (standing).
  private sway = 0;
  private swayG = 0;
  private nextSway = 0;
  // Gestures.
  private gestureStart = 0;
  private gestureLen = 0;
  private nextGesture: number;
  // Blinks.
  private nextBlink: number;
  private readonly breathRate: number;

  constructor(
    readonly posture: Posture,
    readonly activity: Activity,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.nextGesture = this.rng.range(3, 9);
    this.nextBlink = this.rng.range(1, 4);
    this.breathRate = this.rng.range(1.35, 1.75);
    this.t = this.rng.range(0, 10); // desynchronise breathing
  }

  /** Advance by dt and write the full pose into `out`. */
  step(dt: number, gaze: GazeTargets, out: CharacterPose): void {
    const rng = this.rng;
    const t = (this.t += dt);
    this.updateGesture(t, dt);
    const g = this.gestureEnv;

    // --- Posture.
    if (this.posture === 'seated') this.seated(out, g);
    else this.standing(out, t, dt, g);

    // --- Gaze: pick a new interest every few seconds.
    if (t >= this.gazeUntil) this.pickGaze(t, gaze);
    // Keep tracking moving targets (the learner's head) while looking at them.
    if (this.gazeMode === 2) { this.yawG = gaze.learnerYaw; this.pitchG = gaze.learnerPitch; }
    if (this.gazeMode === 1) { this.yawG = gaze.counterYaw; this.pitchG = gaze.counterPitch; }
    let yawG = Math.max(-GAZE_MAX_YAW, Math.min(GAZE_MAX_YAW, this.yawG));
    let pitchG = Math.max(-0.3, Math.min(0.55, this.pitchG));
    // Gestures own the head: sipping looks ahead and up a touch; the watch pulls the eyes down to the wrist.
    if (this.gesture === 'sip') { yawG *= 1 - g; pitchG += (0.08 - pitchG) * g; }
    if (this.gesture === 'watch') { yawG += (0.3 - yawG) * g; pitchG += (0.5 - pitchG) * g; }
    const k = ease(dt, 3.2);
    this.yaw += (yawG - this.yaw) * k;
    this.pitch += (pitchG - this.pitch) * k;
    // Big turns are shared with the shoulders.
    const torsoShare = Math.max(0, Math.abs(this.yaw) - 0.5) * 0.45 * Math.sign(this.yaw);
    out.torsoYaw = torsoShare;
    out.headYaw = this.yaw - torsoShare;
    out.headPitch = this.pitch;
    out.headRoll = Math.sin(t * 0.21 + 1) * 0.03;
    out.eyeYaw = 0;
    out.eyePitch = 0;

    // --- Breathing, blinks, mouth.
    out.breath = Math.sin(t * this.breathRate);
    if (t >= this.nextBlink) {
      const b = (t - this.nextBlink) / 0.14;
      out.blink = b < 1 ? 1 - Math.abs(1 - 2 * b) : 0;
      if (b >= 1) this.nextBlink = t + rng.range(2.2, 5.5);
    } else out.blink = 0;
    out.mouthOpen = 0;
    out.lPoint = out.rPoint = 0;
  }

  private pickGaze(t: number, gaze: GazeTargets): void {
    const rng = this.rng;
    const r = rng.next();
    // Look at the learner rarely and briefly (friendly, never staring).
    if (r < 0.14 && t - this.lastLearnerLook > 14 && Math.abs(gaze.learnerYaw) < GAZE_MAX_YAW + 0.2) {
      this.gazeMode = 2;
      this.lastLearnerLook = t;
      this.gazeUntil = t + rng.range(1.2, 2.2);
      return;
    }
    if (r < 0.36) {
      this.gazeMode = 1; // the counter / shopkeeper
      this.gazeUntil = t + rng.range(1.8, 3.5);
      return;
    }
    this.gazeMode = 0;
    if (r < 0.75) {
      // Their own business: the table, or the goods in front of them.
      this.yawG = rng.range(-0.25, 0.25);
      this.pitchG = this.activity === 'browse' ? rng.range(0.3, 0.5) : this.posture === 'seated' ? rng.range(0.25, 0.45) : rng.range(0.05, 0.2);
      this.gazeUntil = t + rng.range(2.5, 5.5);
    } else {
      // Around the room.
      this.yawG = rng.range(-1, 1) * 0.9;
      this.pitchG = rng.range(-0.08, 0.12);
      this.gazeUntil = t + rng.range(1.5, 3);
    }
  }

  private updateGesture(t: number, dt: number): void {
    const rng = this.rng;
    if (this.gesture === 'none') {
      this.gestureEnv += (0 - this.gestureEnv) * ease(dt, 4);
      if (t >= this.nextGesture) {
        const a = this.activity;
        const r = rng.next();
        this.gesture =
          a === 'sip' ? 'sip'
          : a === 'linger' ? 'chin'
          : a === 'wait' ? (r < 0.55 ? 'watch' : 'consider')
          : 'consider';
        this.gestureStart = t;
        this.gestureLen = this.gesture === 'sip' ? rng.range(3, 4.2) : this.gesture === 'watch' ? rng.range(1.8, 2.6) : rng.range(3.5, 7);
      }
      return;
    }
    const p = (t - this.gestureStart) / this.gestureLen;
    if (p >= 1) {
      this.gesture = 'none';
      this.gestureEnv = 0;
      this.nextGesture = t + rng.range(this.activity === 'sip' ? 6 : 8, this.activity === 'sip' ? 13 : 18);
      return;
    }
    // Smooth rise over the first ~25%, hold, smooth fall over the last ~25%.
    const rise = Math.min(1, p / 0.25);
    const fall = Math.min(1, (1 - p) / 0.25);
    const s = Math.min(rise, fall);
    this.gestureEnv = s * s * (3 - 2 * s);
  }

  private seated(out: CharacterPose, g: number): void {
    // Hips on the seat, thighs forward and level, shins down, feet flat.
    out.lThighX = -1.5; out.lThighZ = 0.1; out.lKnee = 1.45; out.lFoot = 0.05;
    out.rThighX = -1.42; out.rThighZ = -0.08; out.rKnee = 1.62; out.rFoot = 0.08;
    out.hipSway = 0;
    out.torsoPitch = 0.1;
    out.torsoRoll = 0;
    out.shoulderRaise = 0;
    // Forearms resting on the table edge.
    out.lArmY = out.rArmY = 0;
    out.lArmX = -0.55; out.lArmZ = 0.06; out.lForearmX = -1.0; out.lTwist = 0.5; out.lWrist = 0.1; out.lGrip = 0.15;
    out.rArmX = -0.55; out.rArmZ = -0.06; out.rForearmX = -1.0; out.rTwist = 0.5; out.rWrist = 0.1; out.rGrip = 0.15;
    if (this.activity === 'sip') {
      // Right hand round the cup on the table.
      out.rArmX = -0.5; out.rArmZ = 0.02; out.rForearmX = -1.15; out.rTwist = 1.0; out.rWrist = 0; out.rGrip = 0.55;
    }
    if (this.gesture === 'sip') {
      // Cup (right hand) up to the mouth.
      out.rArmX += (-0.95 - out.rArmX) * g;
      out.rArmZ += (0.38 - out.rArmZ) * g;
      out.rArmY += (0.4 - out.rArmY) * g;
      out.rForearmX += (-2.15 - out.rForearmX) * g;
      out.rTwist += (1.05 - out.rTwist) * g;
      out.rWrist += (-0.25 - out.rWrist) * g;
      out.rGrip += (0.55 - out.rGrip) * g;
      out.torsoPitch += 0.04 * g;
    } else if (this.gesture === 'chin') {
      // Elbow on the table, chin on the back of the left hand.
      out.lArmX += (-0.7 - out.lArmX) * g;
      out.lArmZ += (-0.2 - out.lArmZ) * g;
      out.lArmY += (0.5 - out.lArmY) * g;
      out.lForearmX += (-2.2 - out.lForearmX) * g;
      out.lTwist += (1.0 - out.lTwist) * g;
      out.lGrip += (0.6 - out.lGrip) * g;
      out.torsoPitch += 0.08 * g;
    }
  }

  private standing(out: CharacterPose, t: number, dt: number, g: number): void {
    const rng = this.rng;
    if (t >= this.nextSway) {
      const r = rng.next();
      this.swayG = r < 0.2 ? rng.range(-0.2, 0.2) : (r < 0.6 ? 1 : -1) * rng.range(0.6, 1);
      this.nextSway = t + rng.range(4, 9);
    }
    this.sway += (this.swayG - this.sway) * ease(dt, 0.8);
    const sw = this.sway;
    standingLegs(out, sw);
    out.torsoPitch = this.activity === 'browse' ? 0.06 : 0;
    out.torsoRoll = 0;
    out.shoulderRaise = 0;
    // Relaxed arms.
    out.lArmY = out.rArmY = 0;
    out.lArmX = -0.08; out.lArmZ = 0; out.lForearmX = -0.32; out.lTwist = 0.15; out.lWrist = 0.05; out.lGrip = 0.1;
    out.rArmX = -0.08; out.rArmZ = 0; out.rForearmX = -0.32; out.rTwist = 0.15; out.rWrist = 0.05; out.rGrip = 0.1;
    if (this.activity === 'wait') {
      // Hands loosely together in front.
      out.lArmX = -0.2; out.lArmZ = -0.05; out.lArmY = 0.55; out.lForearmX = -1.2; out.lTwist = 0.4;
      out.rArmX = -0.2; out.rArmZ = 0.05; out.rArmY = 0.55; out.rForearmX = -1.2; out.rTwist = 0.4;
    }
    if (this.gesture === 'watch') {
      // Left wrist up, a glance at the watch.
      out.lArmX += (-0.35 - out.lArmX) * g;
      out.lArmZ += (-0.15 - out.lArmZ) * g;
      out.lForearmX += (-1.75 - out.lForearmX) * g;
      out.lTwist += (-0.2 - out.lTwist) * g;
      out.rArmZ += (0.05 - out.rArmZ) * g;
    } else if (this.gesture === 'consider') {
      // Right hand to the chin while choosing.
      out.rArmX += (-0.45 - out.rArmX) * g;
      out.rArmZ += (0.3 - out.rArmZ) * g;
      out.rArmY += (0.5 - out.rArmY) * g;
      out.rForearmX += (-2.25 - out.rForearmX) * g;
      out.rTwist += (1.1 - out.rTwist) * g;
      out.rGrip += (0.5 - out.rGrip) * g;
    }
  }
}
