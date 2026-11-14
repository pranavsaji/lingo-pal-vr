/**
 * Hand gesture classifier from WebXR hand joints. Pure and allocation-free:
 * input is a Float32Array of 25 joints x 3 (positions in a Y-up reference
 * space, in XRHand iteration order); output is written into a reused frame.
 *
 * Counting accepts both conventions: French (thumb first: thumb = 1,
 * thumb + index = 2) and English (index first). We count extended digits.
 */

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
] as const;

export const JOINT_COUNT = 25;

export type Handedness = 'left' | 'right';

export interface GestureFrame {
  /** thumb, index, middle, ring, pinky */
  extended: [boolean, boolean, boolean, boolean, boolean];
  count: number;
  thumbsUp: boolean;
  thumbsDown: boolean;
  openPalm: boolean;
  /** Open palm facing the ceiling: push-to-talk. */
  palmUp: boolean;
  /** Thumb tip touching index tip. */
  pinching: boolean;
}

export function newGestureFrame(): GestureFrame {
  return { extended: [false, false, false, false, false], count: 0, thumbsUp: false, thumbsDown: false, openPalm: false, palmUp: false, pinching: false };
}

// Tunables (meters / ratios). Validated against synthetic hands in tests;
// re-check on device (PLAN Phase 3 acceptance: >90% over 20 tries).
export const TUNING = {
  fingerReachRatio: 1.45, // |wrist->tip| / |wrist->proximal| above this = extended
  fingerStraightCos: 0.6, // cos between proximal->intermediate and intermediate->tip
  // Thumb out = how far the thumb's end sits beyond the index side of the palm
  // (palm units) + how much the thumb points away from the palm (cos). Measured
  // on IWER's captured-skeleton poses (tests/hand-poses.test.ts): extended thumbs
  // score 1.57-1.75 (open, thumbs-up, finger-gun, call); a thumb resting beside
  // the curled fingers ('point') 1.29, a relaxed hand 1.11, tucked thumbs
  // (peace, three, four, fist) below 0.3.
  thumbOutOn: 1.45, // becomes extended above this...
  thumbOutOff: 1.37, // ...and stays extended until it drops below this (no flicker)
  thumbStraightCos: 0.7,
  verticalCos: 0.6, // thumb direction vs world up for thumbs up/down
  palmUpCos: 0.6,
  pinchRatio: 0.25, // |thumbTip->indexTip| / palm size
};

function dist(j: Float32Array, a: number, b: number): number {
  const dx = j[a * 3] - j[b * 3];
  const dy = j[a * 3 + 1] - j[b * 3 + 1];
  const dz = j[a * 3 + 2] - j[b * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Cosine of the angle between (b - a) and (d - c). */
function cosBetween(j: Float32Array, a: number, b: number, c: number, d: number): number {
  const x1 = j[b * 3] - j[a * 3], y1 = j[b * 3 + 1] - j[a * 3 + 1], z1 = j[b * 3 + 2] - j[a * 3 + 2];
  const x2 = j[d * 3] - j[c * 3], y2 = j[d * 3 + 1] - j[c * 3 + 1], z2 = j[d * 3 + 2] - j[c * 3 + 2];
  const l = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1) * Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2);
  return l > 1e-9 ? (x1 * x2 + y1 * y2 + z1 * z2) / l : 0;
}

/** Y component of the normalized vector a -> b. */
function upComponent(j: Float32Array, a: number, b: number): number {
  const l = dist(j, a, b);
  return l > 1e-9 ? (j[b * 3 + 1] - j[a * 3 + 1]) / l : 0;
}

/**
 * How clearly the thumb sticks out sideways: the distance of the thumb's end
 * (tip and last joint, averaged against jitter) beyond the index-finger side of
 * the palm, in palm lengths, plus the cosine between the whole thumb
 * (metacarpal -> tip) and the outward palm direction. Independent of hand
 * orientation, size and handedness (the axis runs index -> pinky on both hands).
 */
export function thumbOutScore(j: Float32Array, palm: number): number {
  // y: wrist -> middle proximal (along the palm).
  const yx = (j[33] - j[0]) / palm, yy = (j[34] - j[1]) / palm, yz = (j[35] - j[2]) / palm;
  // x: index proximal (6) -> pinky proximal (21), made perpendicular to y.
  let xx = j[63] - j[18], xy = j[64] - j[19], xz = j[65] - j[20];
  const along = xx * yx + xy * yy + xz * yz;
  xx -= along * yx;
  xy -= along * yy;
  xz -= along * yz;
  const xl = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (xl < 1e-6) return 0;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  // Thumb tip (4) and distal joint (3), averaged, beyond the index proximal (6); outward is -x.
  const ex = (j[12] + j[9]) / 2 - j[18], ey = (j[13] + j[10]) / 2 - j[19], ez = (j[14] + j[11]) / 2 - j[20];
  const out = -(ex * xx + ey * xy + ez * xz) / palm;
  // Direction thumb metacarpal (1) -> tip (4) against x.
  const tx = j[12] - j[3], ty = j[13] - j[4], tz = j[14] - j[5];
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  const point = tl > 1e-6 ? -(tx * xx + ty * xy + tz * xz) / tl : 0;
  return out + point;
}

function fingerExtended(j: Float32Array, finger: number): boolean {
  const base = 5 + (finger - 1) * 5; // metacarpal index
  const prox = base + 1;
  const inter = base + 2;
  const tip = base + 4;
  const reach = dist(j, 0, tip) / Math.max(1e-6, dist(j, 0, prox));
  return reach > TUNING.fingerReachRatio && cosBetween(j, prox, inter, inter, tip) > TUNING.fingerStraightCos;
}

/**
 * Classify one hand. `joints` must hold 75 floats. Writes into `out` and
 * returns it. Returns all-false when the hand data is degenerate.
 */
export function classifyHand(joints: Float32Array, handedness: Handedness, out: GestureFrame): GestureFrame {
  const palm = dist(joints, 0, 11); // wrist -> middle proximal
  if (!(palm > 0.02)) {
    out.extended[0] = out.extended[1] = out.extended[2] = out.extended[3] = out.extended[4] = false;
    out.count = 0;
    out.thumbsUp = out.thumbsDown = out.openPalm = out.palmUp = out.pinching = false;
    return out;
  }
  const thumbOut = thumbOutScore(joints, palm);
  out.extended[0] =
    thumbOut > (out.extended[0] ? TUNING.thumbOutOff : TUNING.thumbOutOn) && cosBetween(joints, 2, 3, 3, 4) > TUNING.thumbStraightCos;
  for (let f = 1; f <= 4; f++) out.extended[f] = fingerExtended(joints, f);

  let count = 0;
  for (let f = 0; f < 5; f++) if (out.extended[f]) count++;
  out.count = count;

  const onlyThumb = out.extended[0] && !out.extended[1] && !out.extended[2] && !out.extended[3] && !out.extended[4];
  const thumbUp = upComponent(joints, 2, 4);
  out.thumbsUp = onlyThumb && thumbUp > TUNING.verticalCos;
  out.thumbsDown = onlyThumb && thumbUp < -TUNING.verticalCos;
  out.openPalm = count === 5;

  // Palm normal = cross(indexProx - wrist, pinkyProx - wrist), mirrored for the left hand.
  const ax = joints[18] - joints[0], ay = joints[19] - joints[1], az = joints[20] - joints[2]; // joint 6
  const bx = joints[63] - joints[0], by = joints[64] - joints[1], bz = joints[65] - joints[2]; // joint 21
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  if (handedness === 'left') { nx = -nx; ny = -ny; nz = -nz; }
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  out.palmUp = out.openPalm && nl > 1e-9 && ny / nl > TUNING.palmUpCos;

  out.pinching = dist(joints, 4, 9) / palm < TUNING.pinchRatio;
  return out;
}

/**
 * Debounce: a value must be held for `holdMs` before it is reported, and each
 * stable value is reported once. Prevents flicker between counts. A different
 * value seen for less than `glitchMs` (a frame or two of tracking noise) is
 * ignored instead of restarting the hold.
 */
export class GestureStabilizer {
  private candidate = -1;
  private since = 0;
  private emitted = -1;
  private other = -1;
  private otherSince = 0;

  constructor(private holdMs = 400, private glitchMs = 100) {}

  /** Returns the newly stable value, or null when nothing new. */
  update(value: number, nowMs: number): number | null {
    if (value === this.candidate) {
      this.other = -1;
    } else if (this.candidate === -1) {
      this.candidate = value;
      this.since = nowMs;
      return null;
    } else {
      if (value !== this.other) {
        this.other = value;
        this.otherSince = nowMs;
      }
      if (nowMs - this.otherSince < this.glitchMs) return null;
      this.candidate = value;
      this.since = this.otherSince;
      this.other = -1;
    }
    if (value !== this.emitted && nowMs - this.since >= this.holdMs) {
      this.emitted = value;
      return value;
    }
    return null;
  }

  get stable(): number {
    return this.emitted;
  }

  reset(): void {
    this.candidate = -1;
    this.emitted = -1;
    this.other = -1;
  }
}
