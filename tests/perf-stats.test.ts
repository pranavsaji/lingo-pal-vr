import { describe, expect, it } from 'vitest';
import { buildReport, deviceClass, emptySummary, FrameStats } from '../src/world/perf-stats.js';

const Q3 = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0 Chrome/126.0 VR Safari/537.36';

describe('tester mode frame stats', () => {
  it('averages fps and finds the 1% low and p95', () => {
    const s = new FrameStats(1000);
    for (let i = 0; i < 990; i++) s.push(1000 / 72);
    for (let i = 0; i < 10; i++) s.push(50); // ten 50 ms hitches
    const out = s.summary(emptySummary());
    expect(out.frames).toBe(1000);
    expect(out.low1Fps).toBeCloseTo(20, 3);
    expect(out.p95Ms).toBeCloseTo(1000 / 72, 3);
    expect(out.avgFps).toBeGreaterThan(65);
    expect(out.avgFps).toBeLessThan(72);
  });
  it('keeps only the newest frames and can summarise the last N', () => {
    const s = new FrameStats(4);
    for (const ms of [100, 100, 10, 10, 10, 10]) s.push(ms);
    expect(s.size).toBe(4);
    expect(s.summary(emptySummary()).avgMs).toBe(10);
    s.push(30);
    expect(s.summary(emptySummary(), 1).avgMs).toBe(30);
  });
  it('ignores non-frames and is empty-safe', () => {
    const s = new FrameStats(8);
    for (const ms of [0, -5, 5000, Number.NaN]) s.push(ms);
    expect(s.size).toBe(0);
    expect(s.summary(emptySummary()).avgFps).toBe(0);
  });
  it('guesses only a coarse device class', () => {
    expect(deviceClass(Q3)).toBe('Quest 3');
    expect(deviceClass(Q3.replace('Quest 3', 'Quest 3S'))).toBe('Quest 3S');
    expect(deviceClass(Q3.replace('Quest 3', 'Quest 2'))).toBe('Quest 2');
    expect(deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130')).toBe('Desktop');
    expect(deviceClass('curl/8')).toBe('Other');
  });
  it('rounds the report fields', () => {
    const r = buildReport(
      { frames: 100, avgFps: 71.234, low1Fps: 55.55, p95Ms: 14.04, avgMs: 14 },
      { device: 'Quest 3', mode: 'vr', place: 'cafe', drawCalls: 301.6, triangles: 120000.4, fbScale: 1.2, foveation: 0.4, power: 1, sessionS: 92.7 },
    );
    expect(r).toEqual({ device: 'Quest 3', mode: 'vr', place: 'cafe', avgFps: 71.2, low1Fps: 55.6, p95Ms: 14, drawCalls: 302, triangles: 120000, fbScale: 1.2, foveation: 0.4, power: 1, sessionS: 93 });
  });
});
