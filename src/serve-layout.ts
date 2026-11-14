/**
 * Where the shopkeeper sets served goods down on the counter.
 *
 * Pure module (no World, no DOM): the item system measures each item's
 * footprint and passes the counter's keep-out zones (register, tray, money
 * dish, notes and bank card, Pal, the streak candle, the goods on display);
 * this packs one group per order line along the learner's edge of the counter.
 *
 * - Each line is one group: up to two rows of copies side by side, or a neat
 *   stack for paper-flat goods (tickets, maps, room keys).
 * - Big goods show fewer copies (a single tart, two baguettes) and the group
 *   carries a "x5" badge for the rest, so the counter never turns into a pile.
 * - Groups are placed closest to the learner's center first and never touch a
 *   keep-out zone or each other. A line that cannot fit anywhere (eight
 *   different goods at once) is reported in `hidden` instead of overlapping.
 */

/** Axis-aligned rectangle on the counter top (meters, world XZ; z0 < z1, z1 is nearer the learner). */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface ServeGroupIn {
  id: string;
  qty: number;
  /** Footprint width (x) and depth (z) of one copy, and its height, at scale 1. */
  w: number;
  d: number;
  h: number;
}

export interface ServeCopy {
  /** World position of the copy's footprint center; y is the lift above the counter top. */
  x: number;
  y: number;
  z: number;
}

export interface ServeGroupOut {
  id: string;
  qty: number;
  /** Copies drawn (<= qty). A badge shows the full quantity when shown < qty. */
  shown: number;
  copies: ServeCopy[];
  scale: number;
  /** Group bounds (world XZ). */
  rect: Rect;
  /** Height of the group's top above the counter (stacks included). */
  top: number;
  badge: boolean;
}

export interface ServeLayout {
  placed: ServeGroupOut[];
  /** Order lines that could not be set down without overlapping something. */
  hidden: string[];
}

export const SERVE_AREA = {
  /** Front edge of every group: 1.5 cm in from the counter's learner edge (z = -0.66). */
  frontZ: -0.675,
  /** Deepest a group may reach toward the shopkeeper. */
  backZ: -1.0,
  x0: -1.08,
  x1: 1.08,
  /** Groups start here and spread outward: just left of center, between Pal and the money. */
  preferX: -0.04,
} as const;

/** Widest / deepest a group of copies may grow before copies are hidden behind a badge. */
const MAX_GROUP_W = 0.36;
const MAX_GROUP_D = 0.22;
/** Gap between copies in a group, and clearance around groups and keep-outs. */
const GAP = 0.012;
const CLEAR = 0.015;
const STEP = 0.01;
/** Paper-flat goods (tickets, maps, keys) stack instead of spreading. */
export const STACK_MAX_H = 0.025;
const STACK_MAX = 5;

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.z0 < b.z1 + margin && b.z0 < a.z1 + margin;
}

interface Arrangement {
  shown: number;
  gw: number;
  gd: number;
  top: number;
  /** Copy offsets from the group's front-center (x right, z toward the shopkeeper as negative). */
  offsets: ServeCopy[];
}

/** Copies a group can show at most, for this footprint. */
export function copyCapacity(g: ServeGroupIn): number {
  if (g.h <= STACK_MAX_H) return STACK_MAX;
  const cols = Math.max(1, Math.floor((MAX_GROUP_W + GAP) / (g.w + GAP)));
  const rows = Math.max(1, Math.min(2, Math.floor((MAX_GROUP_D + GAP) / (g.d + GAP))));
  return cols * rows;
}

function arrange(g: ServeGroupIn, shown: number, s: number): Arrangement {
  const w = g.w * s;
  const d = g.d * s;
  const h = g.h * s;
  if (g.h <= STACK_MAX_H) {
    const lift = Math.max(h, 0.004) + 0.002;
    const offsets: ServeCopy[] = [];
    for (let i = 0; i < shown; i++) offsets.push({ x: 0, y: i * lift, z: -d / 2 });
    return { shown, gw: w, gd: d, top: (shown - 1) * lift + Math.max(h, 0.004), offsets };
  }
  const cols = Math.max(1, Math.floor((MAX_GROUP_W + GAP) / (g.w + GAP)));
  const rows = shown > cols ? 2 : 1; // copyCapacity() keeps shown <= 2 * cols
  const front = Math.ceil(shown / rows);
  const back = shown - front;
  const gw = front * w + (front - 1) * GAP;
  const gd = rows * d + (rows - 1) * GAP;
  const offsets: ServeCopy[] = [];
  const row = (n: number, z: number) => {
    const span = n * w + (n - 1) * GAP;
    for (let i = 0; i < n; i++) offsets.push({ x: -span / 2 + w / 2 + i * (w + GAP), y: 0, z });
  };
  row(front, -d / 2);
  if (back > 0) row(back, -d - GAP - d / 2);
  return { shown, gw, gd, top: h, offsets };
}

/** Candidate x centers, nearest the preferred spot first. */
function candidates(halfW: number): number[] {
  const lo = SERVE_AREA.x0 + halfW;
  const hi = SERVE_AREA.x1 - halfW;
  const out: number[] = [];
  if (lo > hi) return out;
  const p = Math.min(hi, Math.max(lo, SERVE_AREA.preferX));
  out.push(p);
  for (let k = 1; ; k++) {
    const a = p - k * STEP;
    const b = p + k * STEP;
    if (a < lo && b > hi) break;
    if (a >= lo) out.push(a);
    if (b <= hi) out.push(b);
  }
  return out;
}

/** Fewer copies first, then slightly smaller goods: whatever lets every line show. */
const ATTEMPTS: { cap: number; scale: number }[] = [
  { cap: Infinity, scale: 1 },
  { cap: 2, scale: 1 },
  { cap: 1, scale: 1 },
  { cap: 1, scale: 0.85 },
  { cap: 1, scale: 0.72 },
];

function attempt(groups: ServeGroupIn[], keepOuts: Rect[], cap: number, scale: number): ServeLayout {
  const placed: ServeGroupOut[] = [];
  const hidden: string[] = [];
  const blocked = (r: Rect) => keepOuts.some((k) => rectsOverlap(r, k, CLEAR)) || placed.some((p) => rectsOverlap(r, p.rect, CLEAR));
  // Widest groups first (fewer stranded gaps); ties keep the order of the lines.
  const order = groups.filter((g) => g.qty > 0).map((g, i) => ({ g, i }));
  order.sort((a, b) => b.g.w * Math.min(b.g.qty, 2) - a.g.w * Math.min(a.g.qty, 2) || a.i - b.i);
  for (const { g } of order) {
    const most = Math.min(g.qty, copyCapacity(g), cap);
    let done: ServeGroupOut | null = null;
    for (let shown = most; shown >= 1 && !done; shown--) {
      const a = arrange(g, shown, scale);
      if (SERVE_AREA.frontZ - a.gd < SERVE_AREA.backZ) continue;
      for (const x of candidates(a.gw / 2)) {
        const rect = { x0: x - a.gw / 2, x1: x + a.gw / 2, z0: SERVE_AREA.frontZ - a.gd, z1: SERVE_AREA.frontZ };
        if (blocked(rect)) continue;
        done = {
          id: g.id,
          qty: g.qty,
          shown,
          scale,
          rect,
          top: a.top,
          badge: shown < g.qty,
          copies: a.offsets.map((o) => ({ x: x + o.x, y: o.y, z: SERVE_AREA.frontZ + o.z })),
        };
        break;
      }
    }
    if (done) placed.push(done);
    else hidden.push(g.id);
  }
  return { placed, hidden };
}

/** Pack the order lines along the learner's edge of the counter, clear of `keepOuts`. */
export function layoutServed(groups: ServeGroupIn[], keepOuts: Rect[]): ServeLayout {
  let best: ServeLayout | null = null;
  for (const { cap, scale } of ATTEMPTS) {
    const out = attempt(groups, keepOuts, cap, scale);
    if (!out.hidden.length) return out;
    if (!best || out.hidden.length < best.hidden.length) best = out;
  }
  return best ?? { placed: [], hidden: [] };
}
