/**
 * Finger counting on realistic hands: IWER's hand poses are built on a hand
 * skeleton captured from real Quest hand tracking (relaxed / pinch / point are
 * raw captures). Each pose is checked as-is, then under random orientation,
 * hand size, left/right mirroring and per-joint tracking jitter, and finally as
 * a 72 Hz stream through the same debounce the game uses.
 */
import { describe, expect, it } from 'vitest';
import { libraryHandPoses } from 'iwer/lib/device/configs/hand/library.js';
import { pointHandPose } from 'iwer/lib/device/configs/hand/point.js';
import { pinchHandPose } from 'iwer/lib/device/configs/hand/pinch.js';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import { classifyHand, GestureStabilizer, JOINT_NAMES, newGestureFrame, type Handedness } from '../src/hands/gestures';

type Pose = { jointTransforms: Record<string, { offsetMatrix: number[] }> };
const POSES: Record<string, Pose> = { relaxed: relaxedHandPose, pinch: pinchHandPose, point: pointHandPose, ...libraryHandPoses } as never;

/** Counting gestures and the number a learner means by them. */
const COUNTS: Record<string, number> = {
  fist: 0,
  'thumbs-up': 1, // French "un"
  point: 1, // English "one"
  'finger-gun': 2, // French "deux" (thumb + index)
  peace: 2, // English "two"
  rock: 2,
  call: 2,
  three: 3, // English "three" (thumb holds the pinky)
  four: 4, // thumb folded across the palm
  open: 5,
};

function poseJoints(p: Pose): Float32Array {
  const j = new Float32Array(75);
  JOINT_NAMES.forEach((n, i) => {
    const m = p.jointTransforms[n].offsetMatrix;
    j[i * 3] = m[12];
    j[i * 3 + 1] = m[13];
    j[i * 3 + 2] = m[14];
  });
  return j;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/** Random rotation matrix (uniform quaternion), row-major 3x3. */
function randomRotation(r: () => number): number[] {
  const u1 = r(), u2 = r() * 2 * Math.PI, u3 = r() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  const x = a * Math.sin(u2), y = a * Math.cos(u2), z = b * Math.sin(u3), w = b * Math.cos(u3);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** Rotate, scale, mirror (left hand) and add jitter (meters, per axis) to a pose. */
function transform(src: Float32Array, out: Float32Array, rot: number[], scale: number, left: boolean, jitter: number, r: () => number): Float32Array {
  for (let i = 0; i < 25; i++) {
    const x = src[i * 3] * (left ? -1 : 1) * scale, y = src[i * 3 + 1] * scale, z = src[i * 3 + 2] * scale;
    out[i * 3] = rot[0] * x + rot[1] * y + rot[2] * z + jitter * gauss(r);
    out[i * 3 + 1] = rot[3] * x + rot[4] * y + rot[5] * z + jitter * gauss(r);
    out[i * 3 + 2] = rot[6] * x + rot[7] * y + rot[8] * z + jitter * gauss(r);
  }
  return out;
}

const BASE: Record<string, Float32Array> = Object.fromEntries(Object.entries(POSES).map(([k, p]) => [k, poseJoints(p)]));
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('finger counting on captured-skeleton hand poses', () => {
  it('counts every counting gesture right, on both hands', () => {
    const buf = new Float32Array(75);
    for (const [name, n] of Object.entries(COUNTS)) {
      for (const side of ['right', 'left'] as Handedness[]) {
        const f = classifyHand(transform(BASE[name], buf, IDENTITY, 1, side === 'left', 0, Math.random), side, newGestureFrame());
        expect(f.count, `${name} (${side})`).toBe(n);
      }
    }
  });

  it('a thumb resting beside the fingers is not counted (English "one" is 1, "four" is 4)', () => {
    expect(classifyHand(BASE.point, 'right', newGestureFrame()).extended).toEqual([false, true, false, false, false]);
    expect(classifyHand(BASE.four, 'right', newGestureFrame()).extended).toEqual([false, true, true, true, true]);
  });

  it('pinches block counting and non-counting hands stay low', () => {
    for (const name of ['pinch', 'ok', 'tripod', 'grip']) expect(classifyHand(BASE[name], 'right', newGestureFrame()).pinching, name).toBe(true);
    for (const name of ['microgesture', 'hook', 'key-pinch', 'claw']) expect(classifyHand(BASE[name], 'right', newGestureFrame()).count, name).toBeLessThanOrEqual(1);
  });

  it('thumbs up is recognised when the thumb points up', () => {
    // Turn the pose so its thumb (proximal -> tip) points up.
    const j = BASE['thumbs-up'];
    const d = [j[12] - j[6], j[13] - j[7], j[14] - j[8]]; // thumb proximal (2) -> tip (4)
    const l = Math.hypot(...d);
    const [ax, ay, az] = [d[0] / l, d[1] / l, d[2] / l];
    // Rotation taking (ax, ay, az) onto +y (Rodrigues).
    const v = [-az, 0, ax]; // axis a x up
    const s = Math.hypot(...v), c = ay;
    const k = s > 1e-9 ? v.map((q) => q / s) : [1, 0, 0];
    const C = 1 - c;
    const rot = [
      c + k[0] * k[0] * C, k[0] * k[1] * C - k[2] * s, k[0] * k[2] * C + k[1] * s,
      k[1] * k[0] * C + k[2] * s, c + k[1] * k[1] * C, k[1] * k[2] * C - k[0] * s,
      k[2] * k[0] * C - k[1] * s, k[2] * k[1] * C + k[0] * s, c + k[2] * k[2] * C,
    ];
    const f = classifyHand(transform(j, new Float32Array(75), rot, 1, false, 0, Math.random), 'right', newGestureFrame());
    expect(f).toMatchObject({ count: 1, thumbsUp: true, thumbsDown: false });
  });

  it('stays right under any hand angle, hand size 80-120 %, both hands and 2 mm tracking jitter', () => {
    const r = rng(7);
    const buf = new Float32Array(75);
    const report: string[] = [];
    for (const [name, n] of Object.entries(COUNTS)) {
      let ok = 0;
      const trials = 600;
      for (let t = 0; t < trials; t++) {
        const left = t % 2 === 1;
        const f = classifyHand(transform(BASE[name], buf, randomRotation(r), 0.8 + 0.4 * r(), left, 0.002, r), left ? 'left' : 'right', newGestureFrame());
        if (f.count === n) ok++;
      }
      report.push(`${name} ${((ok / trials) * 100).toFixed(1)}%`);
      expect(ok / trials, report.join(', ')).toBeGreaterThanOrEqual(0.97);
    }
  }, 30_000);

  it('as a 72 Hz stream with 3 mm jitter, the debounced count is right within 1 s and never wrong', () => {
    const r = rng(11);
    const buf = new Float32Array(75);
    for (const [name, n] of Object.entries(COUNTS)) {
      let onTime = 0;
      const trials = 150;
      for (let t = 0; t < trials; t++) {
        const left = t % 2 === 1;
        const rot = randomRotation(r);
        const scale = 0.8 + 0.4 * r();
        const stab = new GestureStabilizer(450);
        const frame = newGestureFrame(); // reused per hand, like the game
        let got: number | null = null;
        for (let ms = 0; ms <= 1000 && got === null; ms += 1000 / 72) {
          const f = classifyHand(transform(BASE[name], buf, rot, scale, left, 0.003, r), left ? 'left' : 'right', frame);
          const v = stab.update(f.count, ms);
          if (v !== null) got = v;
        }
        expect(got === null || got === n, `${name}: emitted ${got}`).toBe(true);
        if (got === n) onTime++;
      }
      expect(onTime / trials, `${name} on time`).toBeGreaterThanOrEqual(0.99);
    }
  }, 30_000);
});
