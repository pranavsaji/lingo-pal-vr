import { describe, expect, it } from 'vitest';
import { framebufferScaleFor, nextFoveationStep, targetFrameRate } from '../src/world/quality-system.js';

const Q3 = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0 Chrome/126.0 VR Safari/537.36';

describe('clarity settings', () => {
  it("renders at each panel's physical resolution, never beyond it", () => {
    expect(framebufferScaleFor(Q3)).toBe(1.2); // ~ the Quest 3 panel (Meta render-scale table)
    expect(framebufferScaleFor(Q3.replace('Quest 3', 'Quest 3S'))).toBe(1.1); // ~ the 3S panel
    expect(framebufferScaleFor(Q3.replace('Quest 3', 'Quest 2'))).toBe(1);
    expect(framebufferScaleFor('Mozilla/5.0 (Macintosh) Chrome/130')).toBe(1);
  });
  it('holds the 72 Hz baseline and never asks for 90 or 120', () => {
    expect(targetFrameRate(72, [72, 80, 90, 120])).toBeNull(); // already there
    expect(targetFrameRate(90, [72, 80, 90, 120])).toBe(72);
    expect(targetFrameRate(120, new Float32Array([72, 90, 120]))).toBe(72);
    expect(targetFrameRate(90, [90, 120])).toBeNull(); // 72 not offered: leave it
    expect(targetFrameRate(undefined, undefined)).toBeNull();
  });
  it('trades periphery resolution for frame rate only when frames drop', () => {
    const budget = 1 / 72;
    expect(nextFoveationStep(0, budget, budget, 0)).toBe(0); // on budget: stay sharp
    expect(nextFoveationStep(0, budget * 1.3, budget, 0)).toBe(1); // dropping frames: foveate more
    expect(nextFoveationStep(3, budget * 2, budget, 0)).toBe(3); // already at max
    expect(nextFoveationStep(2, budget, budget, 5)).toBe(2); // not calm for long enough yet
    expect(nextFoveationStep(2, budget, budget, 12)).toBe(1); // sustained headroom: sharpen again
  });
});
