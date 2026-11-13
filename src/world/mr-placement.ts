/**
 * "Le café sur votre table": pure placement math for mixed reality.
 *
 * Everything here works in the XR reference space (the real room, y up,
 * meters, floor at y = 0 in local-floor). The virtual cafe never moves:
 * instead the player rig is offset so that the counter's front edge lands on
 * a chosen real-world point, facing the learner. That keeps every system that
 * places items, coins, panels and Madame Lune in fixed world coordinates.
 *
 * No three.js, no DOM: unit-tested in tests/mr-placement.test.ts.
 */

import { COUNTER_Y } from '../layout.js';

export interface P2 {
  x: number;
  z: number;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** A detected real-world plane, already transformed into the reference space. */
export interface PlaneInfo {
  /** WebXR semanticLabel ('table', 'desk', 'floor', ...), lowercase, '' when unknown. */
  label: string;
  /** Up component of the plane normal (1 = horizontal surface facing up). */
  normalY: number;
  /** Surface height (meters above the floor). */
  y: number;
  /** Outline on the floor plane (x, z), in order. */
  polygon: P2[];
}

/** Where the counter's front edge goes in the real room, and which way it faces. */
export interface Placement extends P3 {
  /** Yaw (radians) of the direction from the counter toward the learner: atan2(dx, dz). */
  yaw: number;
}

/** Player rig transform (world = rotateY(yaw) * real + position). */
export interface Rig extends P3 {
  yaw: number;
}

export type TableReason = 'label' | 'height';

/** The counter's front-edge center in the virtual cafe (learner side, see layout.ts). */
export const COUNTER_FRONT: P3 = { x: 0, y: COUNTER_Y, z: -0.66 };
/** Counter top footprint (for the placement reticle): width along x, depth away from the learner. */
export const COUNTER_SIZE = { width: 2.3, depth: 0.58 };
/** Real tables and desks: typical working heights (meters). */
export const TABLE_HEIGHT = { min: 0.5, max: 1.1 };
/** Height assumed when nothing in the room is known (a typical table). */
export const DEFAULT_TABLE_Y = 0.74;
/** Ignore surfaces farther than this from the seated learner (meters, horizontal). */
export const MAX_TABLE_DISTANCE = 2.5;
/** Ignore slivers smaller than this (m^2): window sills, shelf edges. */
export const MIN_TABLE_AREA = 0.06;
const MIN_NORMAL_Y = 0.9;
/** Extra "distance" for a surface behind the learner (they face the table they sit at). */
export const BEHIND_PENALTY = 1.5;
/** A "table" lower than this is a stool or a footrest, not somewhere to serve coffee. */
const LABELLED_MIN_Y = 0.35;

/** Fixed lift used when no surface is known (today's behaviour): a 0.74 m table under a 1.0 m counter. */
export function fallbackRig(): Rig {
  return { x: 0, y: COUNTER_FRONT.y - DEFAULT_TABLE_Y, z: 0, yaw: 0 };
}

export function isTableLabel(label: string): boolean {
  return /\b(table|desk)\b/.test(label.toLowerCase());
}

export function polygonArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
  return Math.abs(a) / 2;
}

export function pointInPolygon(x: number, z: number, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export interface EdgePoint extends P2 {
  /** Horizontal distance from the query point (0 inside the polygon). */
  dist: number;
  /** Outward unit normal of the closest edge. */
  nx: number;
  nz: number;
}

/** Closest point on the polygon outline to (x, z), with the outward normal of that edge. */
export function closestEdgePoint(x: number, z: number, poly: readonly P2[]): EdgePoint | null {
  if (poly.length < 3) return null;
  // Signed area tells the winding, so the outward side of every edge is known.
  let signed = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) signed += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
  const ccw = signed > 0; // counter-clockwise in (x, z)
  let best: EdgePoint | null = null;
  let bestD2 = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-10) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
    const px = a.x + ex * t;
    const pz = a.z + ez * t;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      const len = Math.sqrt(len2);
      // For a CCW polygon in (x, z), (ez, -ex) points outward; flip for CW.
      const nx = (ccw ? ez : -ez) / len;
      const nz = (ccw ? -ex : ex) / len;
      best = { x: px, z: pz, dist: 0, nx, nz };
    }
  }
  if (!best) return null;
  best.dist = pointInPolygon(x, z, poly) ? 0 : Math.sqrt(bestD2);
  return best;
}

/** Horizontal distance from the learner to the nearest part of the surface (0 when above it). */
export function distanceTo(plane: PlaneInfo, head: P2): number {
  return closestEdgePoint(head.x, head.z, plane.polygon)?.dist ?? Infinity;
}

function usable(p: PlaneInfo, head: P2): boolean {
  return p.normalY >= MIN_NORMAL_Y && p.polygon.length >= 3 && polygonArea(p.polygon) >= MIN_TABLE_AREA && distanceTo(p, head) <= MAX_TABLE_DISTANCE;
}

/**
 * Pick the learner's table: the nearest horizontal plane labelled table/desk;
 * else the nearest unlabelled-or-other horizontal plane at table height
 * (never the floor, ceiling or a bed); else null (caller keeps the fixed lift).
 */
export function selectTable(
  planes: readonly PlaneInfo[],
  head: P2,
  forward?: P2,
): { plane: PlaneInfo; reason: TableReason } | null {
  // A seated learner faces their table: a surface behind them counts as BEHIND_PENALTY meters farther.
  const score = (p: PlaneInfo): number => {
    const e = closestEdgePoint(head.x, head.z, p.polygon);
    if (!e) return Infinity;
    const behind = forward && e.dist > 0 && (e.x - head.x) * forward.x + (e.z - head.z) * forward.z < 0;
    return e.dist + (behind ? BEHIND_PENALTY : 0);
  };
  let best: PlaneInfo | null = null;
  let bestD = Infinity;
  for (const p of planes) {
    if (!isTableLabel(p.label) || !usable(p, head) || p.y < LABELLED_MIN_Y) continue;
    const d = score(p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) return { plane: best, reason: 'label' };
  for (const p of planes) {
    if (/floor|ceiling|bed|couch|wall/.test(p.label) || !usable(p, head)) continue;
    if (p.y < TABLE_HEIGHT.min || p.y > TABLE_HEIGHT.max) continue;
    const d = score(p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { plane: best, reason: 'height' } : null;
}

/** Yaw of the horizontal direction from (fromX, fromZ) toward (toX, toZ), or `fallback` when too close. */
export function facingYaw(fromX: number, fromZ: number, toX: number, toZ: number, fallback = 0): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  return dx * dx + dz * dz < 1e-6 ? fallback : Math.atan2(dx, dz);
}

/** Smallest absolute difference between two angles (radians). */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/**
 * Counter on a table: its front edge on the table edge nearest the learner.
 * Square to that edge when the learner sits roughly in front of it (it looks
 * set, not dropped), otherwise turned to face the learner.
 */
export function placeOnTable(plane: PlaneInfo, head: P2, squareWithinRad = Math.PI / 4): Placement {
  const edge = closestEdgePoint(head.x, head.z, plane.polygon);
  if (!edge) return { x: head.x, y: plane.y, z: head.z - 0.66, yaw: 0 };
  const toward = facingYaw(edge.x, edge.z, head.x, head.z, Math.atan2(edge.nx, edge.nz));
  const normal = Math.atan2(edge.nx, edge.nz);
  // Head above the table (leaning in): the edge's outward normal still points at the learner's seat.
  const yaw = edge.dist === 0 || angleBetween(toward, normal) <= squareWithinRad ? normal : toward;
  return { x: edge.x, y: plane.y, z: edge.z, yaw };
}

/** A spot the learner pointed at: the counter's front edge goes there, facing them. */
export function placeAtPoint(point: P3, head: P2, fallbackYaw = 0): Placement {
  return { x: point.x, y: point.y, z: point.z, yaw: facingYaw(point.x, point.z, head.x, head.z, fallbackYaw) };
}

/**
 * The rig transform that puts the virtual counter front (`front`) onto the real
 * placement, with the counter's learner side (+z in the cafe) facing `p.yaw`.
 * world = rotateY(rig.yaw) * real + rig.position.
 */
export function rigFor(p: Placement, front: P3 = COUNTER_FRONT): Rig {
  const yaw = -p.yaw;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // rotateY(yaw) * (x, z): x' = x c + z s, z' = -x s + z c (three.js convention).
  const rx = p.x * c + p.z * s;
  const rz = -p.x * s + p.z * c;
  return { x: front.x - rx, y: front.y - p.y, z: front.z - rz, yaw };
}

/** Apply a rig to a real point (for tests and reticle math). */
export function rigApply(rig: Rig, p: P3): P3 {
  const c = Math.cos(rig.yaw);
  const s = Math.sin(rig.yaw);
  return { x: p.x * c + p.z * s + rig.x, y: p.y + rig.y, z: -p.x * s + p.z * c + rig.z };
}

/** Yaw of a quaternion's +Z axis (for anchors restored from a previous session). */
export function yawOfQuaternion(x: number, y: number, z: number, w: number): number {
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  return Math.atan2(fx, fz);
}

/** Quaternion (x, y, z, w) for a pure yaw. */
export function quaternionOfYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export type SurfaceKind = 'plane' | 'hit' | 'height';
export interface SurfaceHit extends P3 {
  kind: SurfaceKind;
}

/**
 * Where a pointing ray meets a real surface: a detected table-height plane
 * (inside its outline), else an infinite horizontal plane at `fallbackY` so
 * placement still works with no room data (emulator, no room setup).
 * Returns null when the ray points up or the spot is out of reach. Writes into
 * `out` when given (the reticle calls this every frame).
 */
export function rayToSurface(
  origin: P3,
  dir: P3,
  planes: readonly PlaneInfo[],
  fallbackY: number,
  out: SurfaceHit = { x: 0, y: 0, z: 0, kind: 'height' },
  maxDistance = MAX_TABLE_DISTANCE + 1,
): SurfaceHit | null {
  if (dir.y > -1e-3) return null;
  let bestT = Infinity;
  for (const p of planes) {
    if (p.normalY < MIN_NORMAL_Y || p.y < 0.3 || p.y > 1.4 || p.y >= origin.y) continue;
    const t = (p.y - origin.y) / dir.y;
    if (t <= 0 || t >= bestT) continue;
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    if (!pointInPolygon(x, z, p.polygon)) continue;
    bestT = t;
    out.x = x;
    out.y = p.y;
    out.z = z;
    out.kind = 'plane';
  }
  if (bestT < Infinity) return out;
  if (fallbackY >= origin.y) return null;
  const t = (fallbackY - origin.y) / dir.y;
  const x = origin.x + dir.x * t;
  const z = origin.z + dir.z * t;
  if (Math.hypot(x - origin.x, z - origin.z) > maxDistance) return null;
  out.x = x;
  out.y = fallbackY;
  out.z = z;
  out.kind = 'height';
  return out;
}
