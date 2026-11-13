import { describe, expect, it } from 'vitest';
import { framebufferScaleFor, nextFoveationStep } from '../src/world/quality-system.js';

const Q3 = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0 Chrome/126.0 VR Safari/537.36';

describe('clarity settings', () => {
  it('renders sharper on Quest 3 than on lighter devices', () => {
    expect(framebufferScaleFor(Q3)).toBe(1.3);
    expect(framebufferScaleFor(Q3.replace('Quest 3', 'Quest 3S'))).toBe(1.15);
    expect(framebufferScaleFor(Q3.replace('Quest 3', 'Quest 2'))).toBe(1.1);
    expect(framebufferScaleFor('Mozilla/5.0 (Macintosh) Chrome/130')).toBe(1);
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
