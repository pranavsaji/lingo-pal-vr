/**
 * Tester mode numbers (`?perf`): a ring buffer of frame times and the summaries the
 * HUD and the anonymous /api/perf report need. Pure, no World or DOM: unit-tested in
 * tests/perf-stats.test.ts. Nothing here allocates per frame.
 */

/** Frames kept: 30 s at 90 Hz, so a 30 s report window fits at any Quest refresh rate. */
export const FRAME_CAPACITY = 2700;

export interface FrameSummary {
  frames: number;
  avgFps: number;
  /** Average fps over the slowest 1% of frames. */
  low1Fps: number;
  p95Ms: number;
  avgMs: number;
}

export class FrameStats {
  private readonly ms: Float32Array;
  private readonly scratch: Float32Array;
  private head = 0;
  private count = 0;

  constructor(capacity = FRAME_CAPACITY) {
    this.ms = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  push(frameMs: number): void {
    if (!(frameMs > 0) || frameMs > 1000) return; // tab hidden, breakpoint: not a frame
    this.ms[this.head] = frameMs;
    this.head = (this.head + 1) % this.ms.length;
    if (this.count < this.ms.length) this.count++;
  }

  get size(): number {
    return this.count;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Summary of the last `last` frames (all kept frames by default), written into `out`. */
  summary(out: FrameSummary, last = this.count): FrameSummary {
    const n = Math.min(last, this.count);
    out.frames = n;
    if (n === 0) {
      out.avgFps = out.low1Fps = out.p95Ms = out.avgMs = 0;
      return out;
    }
    const cap = this.ms.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.ms[(this.head - 1 - i + cap) % cap];
      this.scratch[i] = v;
      sum += v;
    }
    const view = this.scratch.subarray(0, n);
    view.sort(); // typed arrays sort numerically, in place
    out.avgMs = sum / n;
    out.avgFps = 1000 / out.avgMs;
    out.p95Ms = view[Math.min(n - 1, Math.floor(n * 0.95))];
    const worst = Math.max(1, Math.floor(n * 0.01));
    let worstSum = 0;
    for (let i = n - worst; i < n; i++) worstSum += view[i];
    out.low1Fps = 1000 / (worstSum / worst);
    return out;
  }
}

export function emptySummary(): FrameSummary {
  return { frames: 0, avgFps: 0, low1Fps: 0, p95Ms: 0, avgMs: 0 };
}

/** Coarse device class from the user agent (no version numbers, nothing identifying). */
export function deviceClass(ua: string): string {
  if (/Quest 3S/i.test(ua)) return 'Quest 3S';
  if (/Quest 3/i.test(ua)) return 'Quest 3';
  if (/Quest Pro/i.test(ua)) return 'Quest Pro';
  if (/Quest 2/i.test(ua)) return 'Quest 2';
  if (/Quest|OculusBrowser/i.test(ua)) return 'Quest';
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return 'Mobile';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'Desktop';
  return 'Other';
}

/** The anonymous summary POSTed to /api/perf every 30 s in tester mode (validated server side). */
export interface PerfReport {
  device: string;
  mode: 'vr' | 'ar' | 'flat';
  place: string;
  avgFps: number;
  low1Fps: number;
  p95Ms: number;
  drawCalls: number;
  triangles: number;
  fbScale: number;
  foveation: number;
  power: number;
  sessionS: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildReport(
  s: FrameSummary,
  ctx: { device: string; mode: PerfReport['mode']; place: string; drawCalls: number; triangles: number; fbScale: number; foveation: number; power: number; sessionS: number },
): PerfReport {
  return {
    device: ctx.device,
    mode: ctx.mode,
    place: ctx.place,
    avgFps: round1(s.avgFps),
    low1Fps: round1(s.low1Fps),
    p95Ms: round1(s.p95Ms),
    drawCalls: Math.round(ctx.drawCalls),
    triangles: Math.round(ctx.triangles),
    fbScale: Math.round(ctx.fbScale * 100) / 100,
    foveation: Math.round(ctx.foveation * 100) / 100,
    power: ctx.power,
    sessionS: Math.round(ctx.sessionS),
  };
}
