import { describe, expect, it } from 'vitest';
import { classifyHand, GestureStabilizer, newGestureFrame } from '../src/hands/gestures';

type V = [number, number, number];

/**
 * Synthetic right hand, palm facing down, fingers pointing forward (-z).
 * extended = [thumb, index, middle, ring, pinky].
 */
function hand(extended: boolean[], opts: { thumbUp?: boolean; palmUp?: boolean } = {}): Float32Array {
  const j: V[] = [[0, 0, 0]];
  // Thumb (sticks out to -x when extended; tucked under the palm when not).
  if (extended[0] || opts.thumbUp) j.push([-0.02, 0, -0.02], [-0.05, 0, -0.035], [-0.08, 0, -0.045], [-0.105, 0, -0.05]);
  else j.push([-0.02, 0, -0.02], [-0.03, -0.01, -0.045], [-0.02, -0.02, -0.06], [-0.01, -0.02, -0.07]);
  const xs = [-0.03, -0.01, 0.01, 0.03];
  for (let f = 0; f < 4; f++) {
    const x = xs[f];
    j.push([x, 0, -0.03], [x, 0, -0.09]);
    if (extended[f + 1]) j.push([x, 0, -0.13], [x, 0, -0.155], [x, 0, -0.175]);
    else j.push([x, -0.03, -0.11], [x, -0.05, -0.09], [x, -0.04, -0.07]);
  }
  const out = new Float32Array(75);
  j.forEach((p, i) => {
    // Palm up: rotate 180 degrees about z (x -> -x, y -> -y).
    // Thumbs up: a sideways fist, rotated -90 degrees about z so the thumb (-x) points up.
    out[i * 3] = opts.palmUp ? -p[0] : opts.thumbUp ? p[1] : p[0];
    out[i * 3 + 1] = opts.palmUp ? -p[1] : opts.thumbUp ? -p[0] : p[1];
    out[i * 3 + 2] = p[2];
  });
  return out;
}

describe('finger counting', () => {
  const f = newGestureFrame();
  it('counts 0 to 5 in English order (index first)', () => {
    const patterns = [
      [false, false, false, false, false],
      [false, true, false, false, false],
      [false, true, true, false, false],
      [false, true, true, true, false],
      [false, true, true, true, true],
      [true, true, true, true, true],
    ];
    patterns.forEach((p, n) => expect(classifyHand(hand(p), 'right', f).count).toBe(n));
  });
  it('counts in French order (thumb first)', () => {
    expect(classifyHand(hand([true, false, false, false, false]), 'right', f).count).toBe(1);
    expect(classifyHand(hand([true, true, false, false, false]), 'right', f).count).toBe(2);
    expect(classifyHand(hand([true, true, true, false, false]), 'right', f).count).toBe(3);
  });
  it('detects thumbs up and open palm facing up', () => {
    const up = classifyHand(hand([false, false, false, false, false], { thumbUp: true }), 'right', f);
    expect(up.thumbsUp).toBe(true);
    expect(up.count).toBe(1);
    const down = classifyHand(hand([true, true, true, true, true]), 'right', f);
    expect(down).toMatchObject({ openPalm: true, palmUp: false });
    const palmUp = classifyHand(hand([true, true, true, true, true], { palmUp: true }), 'right', f);
    expect(palmUp).toMatchObject({ openPalm: true, palmUp: true });
  });
  it('returns nothing for degenerate data and allocates no new frame', () => {
    const r = classifyHand(new Float32Array(75), 'left', f);
    expect(r).toBe(f);
    expect(r.count).toBe(0);
  });
});

describe('gesture stabilizer', () => {
  it('reports a value once after it is held 400 ms', () => {
    const s = new GestureStabilizer(400);
    expect(s.update(2, 0)).toBeNull();
    expect(s.update(2, 200)).toBeNull();
    expect(s.update(2, 400)).toBe(2);
    expect(s.update(2, 900)).toBeNull();
    expect(s.update(3, 950)).toBeNull(); // flicker
    expect(s.update(2, 1000)).toBeNull();
    expect(s.update(2, 1500)).toBeNull(); // 2 already reported
    expect(s.stable).toBe(2);
  });
});
