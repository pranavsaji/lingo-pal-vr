/**
 * Power levels: the second line of defence for the frame rate, after fixed
 * foveation (see quality-system.ts). When foveation is already at its maximum and
 * frames still miss the display's budget for a few seconds, the app drops one
 * cheap-to-lose extra at a time. Core gameplay (shopkeeper, items, coins, hands,
 * panels) is never touched. Pure logic, no World: unit-tested in tests/power.test.ts.
 *
 * Level  What is dropped (each level includes the ones before it)
 *   0    nothing
 *   1    the key light's shadow map is redrawn every 4th frame instead of every frame
 *   2    background customers hidden (skinned meshes, their shadows and animation)
 *   3    depth occlusion off (mixed reality only)
 *   4    decor extras hidden (string lights, plants, lanterns, chalkboards, gramophone)
 *   5    shadow map frozen (last frame's shadows stay; no shadow pass at all)
 */

export const POWER_LEVEL_NAMES = ['full', 'shadows 1/4', 'no customers', 'no occlusion', 'no decor', 'shadows frozen'] as const;
export const MAX_POWER_LEVEL = POWER_LEVEL_NAMES.length - 1;

/** Levels at which each extra is dropped (systems compare `level >= POWER.x`). */
export const POWER = { shadowsSlow: 1, customers: 2, occlusion: 3, decor: 4, shadowsFrozen: 5 } as const;

/** Seconds over budget (with foveation maxed) before dropping the next extra. */
export const OVER_BUDGET_S = 3;
/** First wait (s) on budget before restoring one extra; doubles after each relapse. */
export const RELAX_BASE_S = 30;
export const RELAX_MAX_S = 240;
/** A relapse this soon (s) after restoring an extra counts as a flicker. */
export const RELAPSE_WINDOW_S = 20;

export interface PowerGovernor {
  level: number;
  /** Seconds continuously over budget while foveation is maxed. */
  overS: number;
  /** Seconds continuously on budget. */
  calmS: number;
  /** Current calm period needed to restore one extra (hysteresis, grows on relapse). */
  relaxS: number;
  /** Seconds since the last restore (Infinity before the first). */
  sinceRelaxS: number;
}

export function createGovernor(): PowerGovernor {
  return { level: 0, overS: 0, calmS: 0, relaxS: RELAX_BASE_S, sinceRelaxS: Infinity };
}

/**
 * Advances the governor by `dt` seconds of measured frames and returns the new level.
 * `avgFrameS` is the smoothed frame time, `budgetS` the display's frame time (1/72 s),
 * `foveationMaxed` whether fixed foveation has nothing left to give.
 *
 * Frame deltas in XR are quantised to vsync, so "on budget" is the only headroom signal
 * a web page gets (avg within 3% of the budget). Restoring therefore waits much longer
 * (30 s) than dropping (3 s), and every relapse within 20 s of a restore doubles that
 * wait (up to 4 min), so the level settles instead of flickering.
 */
export function stepGovernor(g: PowerGovernor, avgFrameS: number, budgetS: number, dt: number, foveationMaxed: boolean): number {
  g.sinceRelaxS += dt;
  const over = avgFrameS > budgetS * 1.1;
  const calm = avgFrameS < budgetS * 1.03;
  g.overS = over && foveationMaxed ? g.overS + dt : 0;
  g.calmS = calm ? g.calmS + dt : 0;

  if (g.overS >= OVER_BUDGET_S && g.level < MAX_POWER_LEVEL) {
    g.level++;
    g.overS = 0;
    g.calmS = 0;
    if (g.sinceRelaxS < RELAPSE_WINDOW_S) g.relaxS = Math.min(RELAX_MAX_S, g.relaxS * 2);
  } else if (g.calmS >= g.relaxS && g.level > 0) {
    g.level--;
    g.calmS = 0;
    g.sinceRelaxS = 0;
  }
  return g.level;
}
