/**
 * Plan de Paris: the tabletop diorama's layout and pin logic. Pure (no World,
 * no DOM), shared by the model (src/models/paris-diorama.ts), the system
 * (src/world/diorama-system.ts) and the tests.
 *
 * Board coordinates are metres on the diorama, origin at the centre of the
 * board's underside, +x east (the learner's right), -z north (away from the
 * learner). The map is stylised, not to scale: the Seine enters from the
 * south-east, crosses the centre past the Île de la Cité and bends south-west
 * past the Eiffel Tower; Montmartre is the hill at the back.
 */

import placesData from '../../shared/places.json';

export interface MapXZ {
  x: number;
  z: number;
}

/** Board size and the height of the map surface above the counter. */
export const BOARD = { width: 0.62, depth: 0.42, surfaceY: 0.024 } as const;

/** Where the board sits in the shop (world metres): centred on the counter, in reach of a seated learner. */
export const DIORAMA_WORLD = { x: 0, y: 1.0, z: -0.93 } as const;

/**
 * One pin per place, keyed by place id. Ids that are not in PLACE_ORDER are
 * simply not shown, so this can list places another build has not added yet.
 *
 * Three staggered rows, like theatre seats: the left bank in front (2 pins),
 * the right bank by the river (3), the north at the back (2). Each row sits
 * in the gaps of the row in front, so from a seated learner's eyes every
 * card is in clear view and a fingertip reaching for it does not pass
 * through another pin (tests/diorama.test.ts checks the lines of sight).
 */
export const PARIS_MAP: Record<string, MapXZ> = {
  cafe: { x: -0.14, z: 0.11 }, // Saint-Germain, left bank
  marche: { x: 0.14, z: 0.11 }, // rue Mouffetard, left bank
  pharmacie: { x: -0.27, z: -0.07 }, // Passy, west
  hotel: { x: 0, z: -0.07 }, // by the Louvre
  boulangerie: { x: 0.27, z: -0.07 }, // Le Marais, east
  metro: { x: -0.14, z: -0.17 }, // Opéra
  bistrot: { x: 0.14, z: -0.17 }, // Montmartre
};

/** Landmark spots (board metres). */
export const LANDMARKS = {
  eiffel: { x: -0.155, z: 0.06 },
  notreDame: { x: 0.085, z: 0.005 },
  arc: { x: -0.215, z: -0.13 },
  sacreCoeur: { x: -0.01, z: -0.14 },
} as const;

/** Seine centre line, east to west (Catmull-Rom control points). */
export const SEINE: readonly MapXZ[] = [
  { x: 0.34, z: 0.14 },
  { x: 0.2, z: 0.07 },
  { x: 0.085, z: 0.005 },
  { x: -0.04, z: -0.035 },
  { x: -0.14, z: -0.03 },
  { x: -0.21, z: 0.025 },
  { x: -0.26, z: 0.12 },
  { x: -0.34, z: 0.2 },
];
export const SEINE_WIDTH = 0.026;

/** A point on the Seine, t in [0, 1] from east to west. Writes into `out` (no allocation). */
export function seinePoint(t: number, out: MapXZ): MapXZ {
  const n = SEINE.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const p0 = SEINE[Math.max(i - 1, 0)];
  const p1 = SEINE[i];
  const p2 = SEINE[i + 1];
  const p3 = SEINE[Math.min(i + 2, n)];
  const u2 = u * u;
  const u3 = u2 * u;
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
  out.x = cr(p0.x, p1.x, p2.x, p3.x);
  out.z = cr(p0.z, p1.z, p2.z, p3.z);
  return out;
}

/** Sampled river centre line (for the water ribbon and distance tests). */
export function seineSamples(count = 64): MapXZ[] {
  const pts: MapXZ[] = [];
  for (let i = 0; i <= count; i++) pts.push(seinePoint(i / count, { x: 0, z: 0 }));
  return pts;
}

/** Shortest distance from a point to a polyline. */
export function distanceToPolyline(p: MapXZ, line: readonly MapXZ[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}

/** True when a point lies on the board, `margin` metres inside its edge. */
export function onBoard(p: MapXZ, margin = 0): boolean {
  return Math.abs(p.x) <= BOARD.width / 2 - margin && Math.abs(p.z) <= BOARD.depth / 2 - margin;
}

/**
 * Pin height above the map surface: pins further back stand taller, like
 * stadium seating, so front labels do not hide the ones behind them (the
 * front and back rows share columns; the back row's cards clear the front's).
 */
export function pinHeight(z: number): number {
  const back = (BOARD.depth / 2 - z) / BOARD.depth; // 0 at the front edge, 1 at the back
  return 0.035 + 0.06 * Math.min(1, Math.max(0, back));
}

export type PinState = 'here' | 'open' | 'locked';

export function pinState(id: string, current: string, unlocked: boolean): PinState {
  if (id === current) return 'here';
  return unlocked ? 'open' : 'locked';
}

export interface PinView extends MapXZ {
  id: string;
  state: PinState;
  height: number;
  /** French and English names (shared/places.json). */
  fr: string;
  en: string;
  /** Passport stamp earned for this place. */
  stamped: boolean;
}

interface PlaceNames {
  places: Record<string, { fr?: string; en?: string }>;
}

/** French + English place names from shared/places.json, falling back to the id. */
export function placeNames(id: string): { fr: string; en: string } {
  const p = (placesData as unknown as PlaceNames).places[id];
  return { fr: p?.fr ?? id, en: p?.en ?? id };
}

/**
 * The pins to show, in place order: only places that exist (PLACE_ORDER) and
 * have a spot on the map.
 */
export function dioramaPins(
  order: readonly string[],
  current: string,
  unlocked: (id: string) => boolean,
  stamps: Record<string, unknown> = {},
  names: (id: string) => { fr: string; en: string } = placeNames,
): PinView[] {
  const out: PinView[] = [];
  for (const id of order) {
    const spot = PARIS_MAP[id];
    if (!spot) continue;
    out.push({ id, x: spot.x, z: spot.z, height: pinHeight(spot.z), state: pinState(id, current, unlocked(id)), ...names(id), stamped: Boolean(stamps[id]) });
  }
  return out;
}

/** Counter objects that would poke through the board while it is open (world x/z inside the footprint plus a margin). */
export function underBoard(x: number, z: number, margin = 0.08): boolean {
  return Math.abs(x - DIORAMA_WORLD.x) <= BOARD.width / 2 + margin && Math.abs(z - DIORAMA_WORLD.z) <= BOARD.depth / 2 + margin;
}

/** Pin colour per place (sRGB hex); unknown ids get the neutral one. Locked pins are grey. */
export const PIN_COLORS: Record<string, number> = {
  cafe: 0xc8553d,
  boulangerie: 0xe0a526,
  marche: 0x3f9d4a,
  bistrot: 0x9b2f4f,
  metro: 0x2f6db5,
  pharmacie: 0x16a37a,
  hotel: 0x7d5bb5,
};
export const PIN_NEUTRAL = 0x2a9d8f;
export const PIN_LOCKED = 0x8d9097;

export function pinColor(id: string, state: PinState): number {
  return state === 'locked' ? PIN_LOCKED : (PIN_COLORS[id] ?? PIN_NEUTRAL);
}

/** The label's second line: English (subtitles on), "you are here", or the unlock hint on a locked pin. */
export function pinSubtitle(pin: Pick<PinView, 'state' | 'en'>, hint: { fr: string; en: string }, subtitles: boolean): string {
  if (pin.state === 'here') return subtitles ? 'Vous êtes ici · You are here' : 'Vous êtes ici';
  if (pin.state === 'locked') return subtitles ? hint.en : hint.fr;
  return subtitles ? pin.en : '';
}

// ------------------------------------------------------------------ labels and pick volumes

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** Label card size (metres) and its gap above the pin head. */
export const LABEL = { w: 0.112, h: 0.044, gap: 0.014 } as const;

/** Where labels face: a seated learner's eyes, in board coordinates. */
export const LABEL_EYE: XYZ = { x: 0, y: 1.42 - DIORAMA_WORLD.y, z: -DIORAMA_WORLD.z };

/** A pin's label card centre (board coordinates). */
export function labelCentre(pin: MapXZ & { height: number }): XYZ {
  return { x: pin.x, y: BOARD.surfaceY + pin.height + LABEL.gap + LABEL.h / 2, z: pin.z };
}

/**
 * A pick volume: an oriented box (centre, unit axes, half sizes) in board
 * coordinates. Its z axis faces the learner's eyes, like the card it wraps.
 */
export interface PickBox {
  c: XYZ;
  ax: XYZ;
  ay: XYZ;
  az: XYZ;
  hx: number;
  hy: number;
  hz: number;
}

/**
 * Pin pick volume half sizes: the visible card plus the pin head below it,
 * and only 1 cm either side of the card's face. A thin slab means a finger
 * reaching past a front pin to a back one does not go through the front
 * pin's volume (a thick one sat in the reach path and fired first); the
 * fingertip has to actually be at the card to touch it.
 */
export const PICK = { hx: (LABEL.w + 0.006) / 2, hy: (LABEL.h + 0.034) / 2, hz: 0.01, below: 0.014 } as const;

/** The pick box around a card centred at `card` (board coordinates), facing `eye`. */
export function pickBox(card: XYZ, eye: XYZ = LABEL_EYE): PickBox {
  // Same basis as Object3D.lookAt for a non-camera: +z towards the eye, x = up × z, y = z × x.
  let zx = eye.x - card.x;
  let zy = eye.y - card.y;
  let zz = eye.z - card.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = zz; // (0,1,0) × z
  let xz = -zx;
  const xl = Math.hypot(xx, xz) || 1;
  xx /= xl;
  xz /= xl;
  const ax = { x: xx, y: 0, z: xz };
  const az = { x: zx, y: zy, z: zz };
  const ay = { x: az.y * ax.z - az.z * ax.y, y: az.z * ax.x - az.x * ax.z, z: az.x * ax.y - az.y * ax.x };
  // The box hangs a little below the card so it covers the pin head too.
  const c = { x: card.x - ay.x * PICK.below, y: card.y - ay.y * PICK.below, z: card.z - ay.z * PICK.below };
  return { c, ax, ay, az, hx: PICK.hx, hy: PICK.hy, hz: PICK.hz };
}

/** Pick boxes for these pins, in the same order. */
export function pinPickBoxes(pins: readonly (MapXZ & { height: number })[], eye: XYZ = LABEL_EYE): PickBox[] {
  return pins.map((p) => pickBox(labelCentre(p), eye));
}

/**
 * True when the segment a→b (board coordinates) passes through or ends inside
 * the box. Slab test in the box's frame; no allocation (runs every frame for
 * each fingertip while the board is open).
 */
export function segmentHitsBox(b: PickBox, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const px = ax - b.c.x;
  const py = ay - b.c.y;
  const pz = az - b.c.z;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (let k = 0; k < 3; k++) {
    const axis = k === 0 ? b.ax : k === 1 ? b.ay : b.az;
    const h = k === 0 ? b.hx : k === 1 ? b.hy : b.hz;
    const p = px * axis.x + py * axis.y + pz * axis.z;
    const d = dx * axis.x + dy * axis.y + dz * axis.z;
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return false;
      continue;
    }
    let ta = (-h - p) / d;
    let tb = (h - p) / d;
    if (ta > tb) {
      const s = ta;
      ta = tb;
      tb = s;
    }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/** Distance from a point (board coordinates) to the box (0 inside). */
export function distanceToBox(b: PickBox, x: number, y: number, z: number): number {
  const px = x - b.c.x;
  const py = y - b.c.y;
  const pz = z - b.c.z;
  const ex = Math.max(0, Math.abs(px * b.ax.x + py * b.ax.y + pz * b.ax.z) - b.hx);
  const ey = Math.max(0, Math.abs(px * b.ay.x + py * b.ay.y + pz * b.ay.z) - b.hy);
  const ez = Math.max(0, Math.abs(px * b.az.x + py * b.az.y + pz * b.az.z) - b.hz);
  return Math.hypot(ex, ey, ez);
}
