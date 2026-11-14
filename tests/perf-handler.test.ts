import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM server module
import { handlePerf, sanitizePerf } from '../server/perf-handler.mjs';

const GOOD = { device: 'Quest 3', mode: 'vr', place: 'cafe', avgFps: 71.8, low1Fps: 58.2, p95Ms: 14.3, drawCalls: 290, triangles: 300000, fbScale: 1.2, foveation: 0.4, power: 0, sessionS: 95 };

function capture() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
}

describe('/api/perf', () => {
  it('logs one [perf] JSON line with only the whitelisted fields', async () => {
    const { lines, log } = capture();
    const res = await handlePerf({ ...GOOD, email: 'a@b.c', ua: 'secret', note: 'hi' }, { VERCEL_GIT_COMMIT_SHA: 'abcdef123456' }, '1.2.3.4', {}, log);
    expect(res.status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0].startsWith('[perf] ')).toBe(true);
    expect(JSON.parse(lines[0].slice(7))).toEqual({ build: 'abcdef1', ...GOOD });
    expect(lines[0]).not.toContain('1.2.3.4'); // the IP is never logged
    expect(lines[0]).not.toContain('secret');
  });
  it('accepts the raw JSON string too (dev server)', async () => {
    const { lines, log } = capture();
    expect((await handlePerf(JSON.stringify(GOOD), {}, 'raw-ip', {}, log)).status).toBe(204);
    expect(JSON.parse(lines[0].slice(7)).build).toBe('local');
  });
  it('clamps numbers and rejects free text or unknown values', () => {
    expect(sanitizePerf({ ...GOOD, avgFps: 1e9, foveation: -3, drawCalls: 12.7 })).toMatchObject({ avgFps: 240, foveation: 0, drawCalls: 13 });
    expect(sanitizePerf({ ...GOOD, device: "Quest 3 (Bob's)" })).toBeNull();
    expect(sanitizePerf({ ...GOOD, place: 'Le café de Marie' })).toBeNull();
    expect(sanitizePerf({ ...GOOD, mode: 'xr' })).toBeNull();
    expect(sanitizePerf({ ...GOOD, avgFps: '60' })).toBeNull();
    expect(sanitizePerf({ ...GOOD, power: undefined })).toBeNull();
    expect(sanitizePerf([GOOD])).toBeNull();
    expect(sanitizePerf(null)).toBeNull();
    expect(sanitizePerf({ ...GOOD, place: 'pharmacie' })).not.toBeNull(); // new shops need no server change
  });
  it('refuses other sites, oversized bodies, bad JSON and floods', async () => {
    const { lines, log } = capture();
    expect((await handlePerf(GOOD, {}, 'x1', { 'sec-fetch-site': 'cross-site' }, log)).status).toBe(403);
    expect((await handlePerf({ ...GOOD, pad: 'x'.repeat(2000) }, {}, 'x2', {}, log)).status).toBe(413);
    expect((await handlePerf('{nope', {}, 'x3', {}, log)).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await handlePerf(GOOD, {}, 'flood', {}, log)).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    expect(lines).toHaveLength(6);
  });
});
