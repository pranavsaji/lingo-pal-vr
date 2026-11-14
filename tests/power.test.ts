import { describe, expect, it } from 'vitest';
import { createGovernor, MAX_POWER_LEVEL, OVER_BUDGET_S, RELAX_BASE_S, RELAX_MAX_S, stepGovernor } from '../src/world/power.js';

const BUDGET = 1 / 72;
const SLOW = BUDGET * 1.5; // dropping every other frame
const ON = BUDGET; // vsync-locked

/** Runs the governor for `seconds` in 1.5 s checks (as QualitySystem does). */
function run(g: ReturnType<typeof createGovernor>, avg: number, seconds: number, maxed = true): number {
  for (let t = 0; t < seconds - 1e-9; t += 1.5) stepGovernor(g, avg, BUDGET, 1.5, maxed);
  return g.level;
}

describe('power governor', () => {
  it('drops nothing while frames are on budget', () => {
    expect(run(createGovernor(), ON, 600)).toBe(0);
  });
  it('waits for foveation to be maxed before dropping extras', () => {
    expect(run(createGovernor(), SLOW, 30, false)).toBe(0);
  });
  it('drops one extra per ~3 s over budget, up to the last level', () => {
    const g = createGovernor();
    expect(run(g, SLOW, 1.5)).toBe(0); // a single slow check is not enough
    expect(run(g, SLOW, 1.5)).toBe(1);
    expect(run(g, SLOW, OVER_BUDGET_S)).toBe(2);
    expect(run(g, SLOW, 60)).toBe(MAX_POWER_LEVEL);
  });
  it('ignores brief spikes: the over-budget timer restarts', () => {
    const g = createGovernor();
    for (let i = 0; i < 20; i++) {
      stepGovernor(g, SLOW, BUDGET, 1.5, true);
      stepGovernor(g, ON, BUDGET, 1.5, true);
    }
    expect(g.level).toBe(0);
  });
  it('restores extras only after a long stable stretch (hysteresis)', () => {
    const g = createGovernor();
    run(g, SLOW, 6);
    expect(g.level).toBe(2);
    expect(run(g, ON, RELAX_BASE_S - 3)).toBe(2); // not yet
    expect(run(g, ON, 3)).toBe(1);
    expect(run(g, ON, RELAX_BASE_S)).toBe(0);
  });
  it('a relapse right after restoring doubles the wait, so it never flickers', () => {
    const g = createGovernor();
    run(g, SLOW, 3);
    expect(g.level).toBe(1);
    run(g, ON, RELAX_BASE_S);
    expect(g.level).toBe(0);
    run(g, SLOW, 3); // relapse within seconds
    expect(g.level).toBe(1);
    expect(g.relaxS).toBe(RELAX_BASE_S * 2);
    expect(run(g, ON, RELAX_BASE_S + 1.5)).toBe(1); // the old wait is no longer enough
    // A load that is fine for ~35 s then too heavy for ~4.5 s, for 15 minutes: a handful of changes.
    let changes = 0;
    let last = g.level;
    for (let cycle = 0; cycle < 23; cycle++) {
      for (let i = 0; i < 26; i++) {
        stepGovernor(g, i < 23 ? ON : SLOW, BUDGET, 1.5, true);
        if (g.level !== last) changes++;
        last = g.level;
      }
    }
    expect(changes).toBeLessThan(12);
    expect(g.relaxS).toBeLessThanOrEqual(RELAX_MAX_S);
  });
});
