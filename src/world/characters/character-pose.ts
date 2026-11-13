/**
 * The shopkeeper pose contract. NpcSystem computes one CharacterPose per frame
 * (gaze, emotes, pointing, lip flap, blinks, breathing) and hands it to whichever
 * driver is active: the rigged human (HumanRig) or the procedural Madame Lune
 * fallback (ProceduralLuneDriver). Angles are radians in the character's own
 * space: +Z faces the learner, her own left is +X.
 *
 * Arm angles follow the procedural rig's convention: the upper arm hangs along -Y
 * at zero, and its direction is Euler(armX, 0, armZ, 'XYZ') applied to (0,-1,0)
 * (armX < 0 swings it forward toward +Z; armZ > 0 swings it toward +X). The
 * forearm bends about the elbow by forearmX (< 0 bends it forward).
 */

import type { Object3D } from '@iwsdk/core';

export interface CharacterPose {
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** Extra eye rotation on top of the head (rigs with eye bones). */
  eyeYaw: number;
  eyePitch: number;
  lArmX: number;
  lArmZ: number;
  lForearmX: number;
  rArmX: number;
  rArmZ: number;
  rForearmX: number;
  /** Forearm twist added to the resting palms-down pronation (+ turns palms up). Human rig only. */
  lTwist: number;
  rTwist: number;
  /** Upper-arm rotation about its own axis (+ = inward: a bent forearm swings toward the body's midline). Human rig only. */
  lArmY: number;
  rArmY: number;
  /** 0..1 shoulder raise (shrug). Human rig only. */
  shoulderRaise: number;
  /** 0..1 index-finger pointing blend per hand (rigs with finger bones). */
  lPoint: number;
  rPoint: number;
  /** 0 closed .. 1 fully open (talking). */
  mouthOpen: number;
  /** 0 open .. 1 closed. */
  blink: number;
  /** Breathing phase, -1..1. */
  breath: number;
  // --- Body language (human rig only; the procedural fallback ignores these) ---
  /** Upper-body lean (spine above the hips): + pitches forward, + yaw turns toward +X, + roll tips toward +X. */
  torsoPitch: number;
  torsoYaw: number;
  torsoRoll: number;
  /** Weight shift -1..1 (+ = onto her left leg, at +X): hips slide and tip, the spine re-centres the shoulders. */
  hipSway: number;
  /** Wrist flex per hand (+ bends the hand toward the palm, - lifts the back of the hand). */
  lWrist: number;
  rWrist: number;
  /** Finger curl per hand: 0 relaxed, -1 open flat palm, +1 loose fist (pointing overrides). */
  lGrip: number;
  rGrip: number;
  /**
   * Legs (rigs created with `legs: true`; otherwise they keep the bind pose). Same convention
   * as the arms: the thigh hangs along -Y at zero, Euler(thighX, 0, thighZ) swings it
   * (thighX < 0 lifts the knee forward toward +Z); knee > 0 folds the shin back; foot > 0 lifts the toes.
   */
  lThighX: number;
  lThighZ: number;
  lKnee: number;
  lFoot: number;
  rThighX: number;
  rThighZ: number;
  rKnee: number;
  rFoot: number;
}

/** Arms at rest: slightly forward, forearms toward the counter edge. */
export const REST_ARMS = { lArmX: -0.35, lArmZ: 0.12, lForearmX: -0.9, rArmX: -0.35, rArmZ: -0.12, rForearmX: -0.9 } as const;

export function createPose(): CharacterPose {
  return {
    headPitch: 0, headYaw: 0, headRoll: 0, eyeYaw: 0, eyePitch: 0,
    ...REST_ARMS,
    lTwist: 0, rTwist: 0, lArmY: 0, rArmY: 0, shoulderRaise: 0,
    lPoint: 0, rPoint: 0, mouthOpen: 0, blink: 0, breath: 0,
    torsoPitch: 0, torsoYaw: 0, torsoRoll: 0, hipSway: 0,
    lWrist: 0, rWrist: 0, lGrip: 0, rGrip: 0,
    lThighX: 0, lThighZ: 0, lKnee: 0, lFoot: 0, rThighX: 0, rThighZ: 0, rKnee: 0, rFoot: 0,
  };
}

/** Anything NpcSystem can animate: a root to place, a head to aim from, shoulders to point from. */
export interface CharacterDriver {
  readonly root: Object3D;
  readonly head: Object3D;
  readonly leftShoulder: Object3D;
  readonly rightShoulder: Object3D;
  apply(pose: CharacterPose): void;
}
