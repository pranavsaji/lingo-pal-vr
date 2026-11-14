/**
 * Where things sit on the cafe counter (meters; learner at the origin facing -Z).
 * Counter top: y = 1.0, x from -1.1 to 1.1, z from -1.24 (back, Madame Lune's
 * side) to -0.66 (front, the learner's side). Vocabulary items stand in a band
 * around z = -0.9 to -1.0; served food and money live at the front edge; the
 * payment tray and register sit at the back, by Madame Lune.
 */

export type V3 = [number, number, number];

export const COUNTER_Y = 1.0;

/** Served food: two rows of five along the front edge, centered left of the learner. */
export const SERVE = { x0: -0.32, dx: 0.105, perRow: 5, z: [-0.74, -0.83] as const, y: COUNTER_Y };

/** The learner's money dish (mirrored in left-hand mode). */
export function dishPos(leftHanded: boolean): V3 {
  return [leftHanded ? -0.5 : 0.5, COUNTER_Y, -0.74];
}

/**
 * Pal, the English-speaking companion: front corner opposite the money dish
 * (mirrored in left-hand mode), clear of the served-food rows (x >= -0.32),
 * the Plan de Paris board (|x| <= 0.31, z <= -0.72) and the streak candle,
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
