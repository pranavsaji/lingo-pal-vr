/**
 * Where things sit on the cafe counter (meters; learner at the origin facing -Z).
 * Counter top: y = 1.0, x from -1.1 to 1.1, z from -1.24 (back, Madame Lune's
 * side) to -0.66 (front, the learner's side). Vocabulary items stand in a band
 * around z = -0.9 to -1.0; served goods (serve-layout.ts) and money live at the
 * front edge; the payment tray and register sit at the back, by Madame Lune.
 */

export type V3 = [number, number, number];

export const COUNTER_Y = 1.0;

/**
 * The shop's display stand (src/world/display-fixture.ts): the goods for sale stand on
 * it, raised and behind a glass case in the food shops, behind the strip at the
 * learner's edge where the order is served (serve-layout.ts). Stand top: COUNTER_Y + DISPLAY_LIFT.
 */
export const DISPLAY_LIFT = 0.05;
export const DISPLAY_FRONT_Z = -0.87;
/**
 * Stand segments [x0, x1, backZ]: deeper at the sides, shallow in front of the payment
 * tray and the register. Split at the Plan de Paris board's edges (|x| <= 0.31) so the
 * pieces under the board can be hidden while it is open (diorama-system clearCounter).
 */
export const DISPLAY_SEGMENTS: readonly (readonly [number, number, number])[] = [
  [-1.07, -0.34, -1.06],
  [-0.34, -0.09, -1.06],
  [-0.09, 0.19, -0.995],
  [0.19, 0.34, -1.015],
  [0.34, 0.97, -1.015],
];


/** The learner's money dish (mirrored in left-hand mode). */
export function dishPos(leftHanded: boolean): V3 {
  return [leftHanded ? -0.5 : 0.5, COUNTER_Y, -0.74];
}

/**
 * Pal, the English-speaking companion: front corner opposite the money dish
 * (mirrored in left-hand mode), clear of the Plan de Paris board (|x| <= 0.31,
 * z <= -0.72) and the streak candle (served goods keep clear of it: counterKeepOuts),
 * and about 32 degrees from straight ahead (inside the Meta VR Glasses view).
 */
export function palPos(leftHanded: boolean): V3 {
  return [leftHanded ? 0.44 : -0.44, COUNTER_Y, -0.7];
}

/** Payment tray in front of Madame Lune. */
export const TRAY: V3 = [0.05, COUNTER_Y, -1.13];
export const TRAY_RADIUS = 0.17; // drop zone (generous: hands and rays are imprecise)

/** Vintage cash register. */
export const REGISTER: V3 = [0.7, COUNTER_Y, -1.15];

/** Streak candle, front-left of the counter. */
export const FLAME: V3 = [-0.95, COUNTER_Y, -0.76];

/** Where Madame Lune takes paid money (her hand height). */
export const LUNE_HAND: V3 = [0.2, 1.15, -1.45];

/** A counter-top rectangle (world XZ, z0 < z1); see serve-layout.ts. */
export interface CounterRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const around = (c: V3, hx: number, z0: number, z1: number): CounterRect => ({ x0: c[0] - hx, x1: c[0] + hx, z0: c[2] + z0, z1: c[2] + z1 });

/**
 * Fixed things on the counter that served goods must never cover (measured
 * model bounds plus a little room): register, payment tray, money dish, the
 * notes and bank card beside it, Pal (who hops a little) and the streak candle.
 */
/** The display stand's footprint: served goods never go there. */
export function displayStandRects(): CounterRect[] {
  return DISPLAY_SEGMENTS.map(([x0, x1, z0]) => ({ x0, x1, z0, z1: DISPLAY_FRONT_Z }));
}

export function counterKeepOuts(leftHanded: boolean): CounterRect[] {
  const dish = dishPos(leftHanded);
  const outward = leftHanded ? -1 : 1;
  const money: V3 = [dish[0] - outward * 0.17, COUNTER_Y, dish[2]];
  return [
    around(REGISTER, 0.16, -0.12, 0.13),
    around(TRAY, 0.125, -0.125, 0.125),
    around(dish, 0.105, -0.105, 0.105),
    around(money, 0.08, -0.13, 0.055),
    around(palPos(leftHanded), 0.09, -0.09, 0.08),
    around(FLAME, 0.05, -0.05, 0.05),
  ];
}
