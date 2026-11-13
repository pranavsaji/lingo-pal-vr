/**
 * Smooth the friend's pose between network packets (pure, allocation-free
 * after construction). Packets arrive ~15 times a second with jitter; we
 * render a little in the past (DELAY) and blend the two packets around that
 * time: positions lerp, the head quaternion nlerps.
 */

import { F_LEFT, F_POINTER, F_RIGHT, P_HEAD, P_LEFT, P_POINTER, P_RIGHT, POSE_FLOATS, JOINTS, seqNewer, type Pose } from './protocol.js';

const SLOTS = 6;
export const INTERP_DELAY_MS = 110;
/** No packet for this long: the friend is frozen (tab hidden, connection lost). */
export const STALE_MS = 1500;

export class PoseInterpolator {
  private data: Float32Array[] = [];
  private flags = new Int32Array(SLOTS);
  private times = new Float64Array(SLOTS);
  private seqs = new Int32Array(SLOTS);
  private count = 0;
  private head = 0; // index of the newest slot

  constructor(private delayMs = INTERP_DELAY_MS) {
    for (let i = 0; i < SLOTS; i++) this.data.push(new Float32Array(POSE_FLOATS));
  }

  get size(): number {
    return this.count;
  }

  /** Time (ms) of the newest packet, or -Infinity. */
  get lastTime(): number {
    return this.count ? this.times[this.head] : -Infinity;
  }

  clear(): void {
    this.count = 0;
  }

  /** Add a decoded packet received at `now` (ms). Out-of-order packets are dropped. */
  push(p: Pose, now: number): boolean {
    if (this.count && !seqNewer(p.seq, this.seqs[this.head])) return false;
    this.head = (this.head + 1) % SLOTS;
    this.data[this.head].set(p.data);
    this.flags[this.head] = p.flags;
    this.times[this.head] = now;
    this.seqs[this.head] = p.seq;
    this.count = Math.min(SLOTS, this.count + 1);
    return true;
  }

  /**
   * Write the pose at `now - delay` into out. Returns the flags of the result,
   * or -1 when there is nothing to show (no packets, or stale).
   */
  sample(now: number, out: Float32Array): number {
    if (!this.count) return -1;
    if (now - this.times[this.head] > STALE_MS) return -1;
    const t = now - this.delayMs;
    // Walk from newest to oldest for the pair (older, newer) bracketing t.
    let newer = this.head;
    for (let k = 1; k < this.count; k++) {
      const older = (this.head - k + SLOTS) % SLOTS;
      if (this.times[older] <= t) {
        const span = this.times[newer] - this.times[older];
        const a = span > 0 ? Math.min(1, Math.max(0, (t - this.times[older]) / span)) : 1;
        blend(this.data[older], this.flags[older], this.data[newer], this.flags[newer], a, out);
        return this.flags[newer];
      }
      newer = older;
    }
    // t is before every packet we hold (start-up): show the oldest; after: the newest.
    const idx = t < this.times[newer] ? newer : this.head;
    out.set(this.data[idx]);
    return this.flags[idx];
  }
}

function lerpRange(a: Float32Array, b: Float32Array, start: number, n: number, t: number, out: Float32Array): void {
  for (let i = start; i < start + n; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

/** Blend two poses; parts present in only the newer pose snap to it. */
export function blend(a: Float32Array, fa: number, b: Float32Array, fb: number, t: number, out: Float32Array): void {
  lerpRange(a, b, P_HEAD, 3, t, out);
  // Quaternion nlerp along the shorter arc.
  let ax = a[3], ay = a[4], az = a[5], aw = a[6];
  if (ax * b[3] + ay * b[4] + az * b[5] + aw * b[6] < 0) {
    ax = -ax;
    ay = -ay;
    az = -az;
    aw = -aw;
  }
  const qx = ax + (b[3] - ax) * t;
  const qy = ay + (b[4] - ay) * t;
  const qz = az + (b[5] - az) * t;
  const qw = aw + (b[6] - aw) * t;
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  out[3] = qx / n;
  out[4] = qy / n;
  out[5] = qz / n;
  out[6] = qw / n;
  part(a, fa, b, fb, F_LEFT, P_LEFT, JOINTS * 3, t, out);
  part(a, fa, b, fb, F_RIGHT, P_RIGHT, JOINTS * 3, t, out);
  part(a, fa, b, fb, F_POINTER, P_POINTER, 3, t, out);
}

function part(a: Float32Array, fa: number, b: Float32Array, fb: number, flag: number, start: number, len: number, t: number, out: Float32Array): void {
  if (!(fb & flag)) return;
  if (fa & flag) lerpRange(a, b, start, len, t, out);
  else for (let i = start; i < start + len; i++) out[i] = b[i];
}
