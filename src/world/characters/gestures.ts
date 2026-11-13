/**
 * Pure, allocation-free gesture math shared by NpcSystem (and its tests): emote
 * shapes and arm aiming, written into a CharacterPose target. The rig drivers
 * turn the pose into bone or group rotations.
 */

import type { Emote } from '../../agent/tools.js';
import { type CharacterPose, REST_ARMS } from './character-pose.js';

export const EMOTE_SECONDS: Record<Emote, number> = { nod: 0.9, shrug: 1.2, wave: 1.6, laugh: 1.3, think: 1.8, clap: 1.4 };

/** Envelope 0..1..0 over an emote's progress p in [0,1). */
export function emoteEnvelope(p: number): number {
  return p >= 1 || p < 0 ? 0 : Math.sin(Math.PI * Math.min(1, p * 1.15));
}

/**
 * Write arm targets plus emote head offsets into `out`. `basePitch` is the gaze
 * pitch; `p` the emote progress (0..1), `env` its envelope, `t` the clock (s).
 * `human` selects joint ranges that read naturally on a real skeleton (the
 * cartoon values throw a straight arm overhead for "wave", for example).
 */
export function poseEmote(
  out: CharacterPose,
  emote: Emote | null,
  basePitch: number,
  p: number,
  env: number,
  t: number,
  human = false,
): void {
  let headPitch = basePitch;
  let headRoll = 0;
  let lx: number = REST_ARMS.lArmX, lz: number = REST_ARMS.lArmZ, lfx: number = REST_ARMS.lForearmX;
  let rx: number = REST_ARMS.rArmX, rz: number = REST_ARMS.rArmZ, rfx: number = REST_ARMS.rForearmX;
  let lTwist = 0, rTwist = 0, shoulderRaise = 0;

  switch (emote) {
    case 'nod':
      headPitch += Math.sin(p * Math.PI * 4) * 0.22 * env;
      break;
    case 'shrug':
      headRoll = 0.18 * env;
      if (human) {
        lx = rx = -0.35 - 0.2 * env;
        lz = 0.12 + 0.3 * env; rz = -0.12 - 0.3 * env;
        lfx = rfx = -0.9 - 0.55 * env;
        lTwist = rTwist = 1.7 * env;
        shoulderRaise = env;
      } else {
        lz = 0.12 + 0.55 * env; rz = -0.12 - 0.55 * env;
        lfx = -0.9 - 0.6 * env; rfx = -0.9 - 0.6 * env;
      }
      break;
    case 'wave': // her right hand (at -X) waves
      headRoll = -0.08 * env;
      if (human) {
        rx = -0.35 - 0.85 * env;
        rz = -0.12 - 0.45 * env + Math.sin(t * 12) * 0.16 * env;
        rfx = -0.9 - 1.25 * env;
        rTwist = 0.9 * env;
      } else {
        rx = -0.35 - 2.4 * env; rz = -0.12 - 0.35 * env;
        rfx = -0.9 + 0.6 * env + Math.sin(t * 14) * 0.35 * env;
      }
      break;
    case 'laugh':
      headPitch -= 0.25 * env;
      headPitch += Math.sin(t * 22) * 0.05 * env;
      lfx = -1.3 * env - 0.9 * (1 - env); rfx = lfx;
      if (human) shoulderRaise = 0.35 * env * Math.abs(Math.sin(t * 22));
      break;
    case 'think': // hand to chin, head tilted
      headRoll = 0.2 * env;
      headPitch -= 0.12 * env;
      if (human) {
        rx = -0.35 - 0.4 * env; rz = -0.12 + 0.62 * env; rfx = -0.9 - 1.2 * env;
        rTwist = 1.1 * env;
      } else {
        rx = -0.35 - 0.9 * env; rz = -0.12 + 0.25 * env; rfx = -0.9 - 1.3 * env;
      }
      break;
    case 'clap': {
      const c = Math.abs(Math.sin(t * 11));
      lx = rx = -0.35 - (human ? 0.4 : 0.75) * env;
      lz = 0.12 - (0.22 + 0.12 * c) * env;
      rz = -0.12 + (0.22 + 0.12 * c) * env;
      lfx = rfx = -0.9 - (human ? 0.55 : 0.4) * env;
      if (human) lTwist = rTwist = 0.9 * env;
      break;
    }
    default:
      break;
  }
  out.headPitch = headPitch;
  out.headRoll = headRoll;
  out.lArmX = lx; out.lArmZ = lz; out.lForearmX = lfx;
  out.rArmX = rx; out.rArmZ = rz; out.rForearmX = rfx;
  out.lTwist = lTwist; out.rTwist = rTwist;
  out.shoulderRaise = shoulderRaise;
  out.lPoint = 0;
  out.rPoint = 0;
}

/**
 * Blend one arm toward pointing along the unit direction (dx, dy, dz) from its
 * shoulder (character space). The arm direction is Euler(theta, 0, phi) * (0,-1,0).
 */
export function aimArm(out: CharacterPose, useLeft: boolean, dx: number, dy: number, dz: number, blend: number): void {
  const theta = Math.atan2(-dz, -dy);
  const phi = Math.asin(Math.max(-1, Math.min(1, dx)));
  const b = Math.max(0, Math.min(1, blend));
  if (useLeft) {
    out.lArmX += (theta - out.lArmX) * b;
    out.lArmZ += (phi - out.lArmZ) * b;
    out.lForearmX += (-0.1 - out.lForearmX) * b;
    out.lPoint = b;
  } else {
    out.rArmX += (theta - out.rArmX) * b;
    out.rArmZ += (phi - out.rArmZ) * b;
    out.rForearmX += (-0.1 - out.rForearmX) * b;
    out.rPoint = b;
  }
}

/** Lip-flap openness 0..1 at time t: two incommensurate sines read as syllables. */
export function lipFlap(speaking: boolean, t: number): number {
  return speaking ? Math.min(1, 0.04 + Math.abs(Math.sin(t * 13.7) * Math.sin(t * 4.9)) * 0.96) : 0;
}
