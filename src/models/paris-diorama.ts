/**
 * Plan de Paris: a stylised tabletop diorama of Paris (about 0.62 x 0.42 m)
 * that opens on the counter as the travel map. Landmarks (Eiffel Tower,
 * Notre-Dame on the Île de la Cité, Arc de Triomphe on its star of avenues,
 * Sacré-Cœur on the Montmartre hill), the Seine with quays and bridges, parks,
 * and Haussmann blocks with grey mansard roofs and street trees.
 *
 * Cost: TWO draw calls. Everything dry is one vertex-coloured mesh ("Land"),
 * the river is one glossy mesh ("Seine"). Pins and labels are built by
 * DioramaSystem because they change with the learner's progress.
 *
 * Origin: centre of the board's underside; +Y up, -Z north (away from the
 * learner). Pure module: no World, no DOM, deterministic.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { BOARD, distanceToPolyline, LANDMARKS, type MapXZ, onBoard, PARIS_MAP, seineSamples, SEINE_WIDTH } from '../places/paris-map.js';
import { lathe, makeRandom, merge, type Part, sharedMat, spanMatrix, T, vcMat } from './model-kit.js';

const S = BOARD.surfaceY;

const COL = {
  wood: 0x5b3a24,
  woodEdge: 0x7a5034,
  land: 0xeadfc4,
  quay: 0xcbbd9c,
  avenue: 0xf6efdd,
  park: 0x8fb36a,
  parkDark: 0x6f9850,
  hill: 0xa9bf86,
  stone: 0xece2c8,
  stoneShade: 0xd7cbaf,
  roof: 0x8a99aa,
  roofDark: 0x76869a,
  roofWarm: 0xb07a5a,
  iron: 0x7a5a3e,
  ironDark: 0x5e4430,
  white: 0xf6f3ec,
  tree: 0x5f8f45,
  treeLight: 0x76a656,
  bridge: 0xd9ccaa,
} as const;

/** A flat horizontal ribbon along a centre line (indexed, normals up). */
function ribbon(line: readonly MapXZ[], width: number, y: number): BufferGeometry {
  const n = line.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // Left normal of the direction (in x/z).
    const nx = -tz * (width / 2);
    const nz = tx * (width / 2);
    const p = line[i];
    pos.set([p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    if (i < n - 1) {
      const k = i * 2;
      // Counter-clockwise seen from above (+Y).
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2 * 2), 2));
  g.setIndex(idx);
  // Fix winding if the left normal points the other way for this line direction.
  g.computeVertexNormals();
  const ny = g.getAttribute('normal').getY(0);
  if (ny < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
  }
  for (let i = 0; i < n * 2; i++) (g.getAttribute('normal') as BufferAttribute).setXYZ(i, 0, 1, 0);
  return g;
}

/** A flat rectangle on the map (a park, an avenue), rotated by yaw. */
function patch(parts: Part[], x: number, z: number, w: number, d: number, yaw: number, lift: number, c: number): void {
  parts.push({ g: new BoxGeometry(w, 0.0016, d), m: T(x, S + lift, z, 0, yaw, 0), c });
}

/** A straight avenue from a to b. */
function avenue(parts: Part[], a: MapXZ, b: MapXZ, width: number, c: number = COL.avenue): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
  patch(parts, (a.x + b.x) / 2, (a.z + b.z) / 2, len, width, yaw, 0.0006, c);
}

/** Truncated four-sided pyramid (a mansard roof or a tower taper), footprint w x d. */
function hipped(w: number, d: number, h: number, top: number): { g: BufferGeometry; sx: number; sz: number } {
  // Cylinder with 4 radial segments rotated 45 deg is a square frustum; scale to the rectangle.
  const g = new CylinderGeometry(top * Math.SQRT1_2, Math.SQRT1_2, h, 4, 1);
  g.rotateY(Math.PI / 4);
  return { g, sx: w, sz: d };
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** A Y-up cylinder spanning a -> b (legs, struts). */
function strut(parts: Part[], a: Vector3, b: Vector3, r0: number, r1: number, c: number, seg = 4): void {
  const { m, len } = spanMatrix(a, b);
  parts.push({ g: new CylinderGeometry(r1, r0, len, seg, 1), m, c });
}

/** La tour Eiffel (about 13 cm): four splayed legs with the great arch between them, two platforms, the tapering spire. */
function eiffel(parts: Part[], at: MapXZ): void {
  const { x, z } = at;
  const y0 = S;
  const base = 0.021;
  const p1 = 0.03; // first platform height
  const top1 = 0.0115;
  // Legs: from the four base corners up to the first platform, slightly curved (two segments each).
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const a = v(x + sx * base, y0, z + sz * base);
      const mid = v(x + sx * (base * 0.62 + top1 * 0.38) + sx * 0.0025, y0 + p1 * 0.5, z + sz * (base * 0.62 + top1 * 0.38) + sz * 0.0025);
      const b = v(x + sx * top1, y0 + p1, z + sz * top1);
      strut(parts, a, mid, 0.0042, 0.0036, COL.iron);
      strut(parts, mid, b, 0.0036, 0.003, COL.iron);
    }
  // The arches: a thin curved beam on each face just under the first platform.
  for (let f = 0; f < 4; f++) {
    const arch = new CylinderGeometry(0.0125, 0.0125, 0.0018, 14, 1, true, Math.PI / 2 - 1.1, 2.2);
    arch.rotateX(Math.PI / 2);
    const yaw = (f * Math.PI) / 2;
    const ox = Math.sin(yaw) * (top1 + 0.003);
    const oz = Math.cos(yaw) * (top1 + 0.003);
    parts.push({ g: arch, m: T(x + ox, y0 + p1 - 0.013, z + oz, 0, yaw, 0, 1, 1.15, 1), c: COL.ironDark });
  }
  // First platform.
  parts.push({ g: new BoxGeometry(top1 * 2 + 0.006, 0.0035, top1 * 2 + 0.006), m: T(x, y0 + p1, z), c: COL.ironDark });
  // Middle section: square frustum up to the second platform.
  const mid = hipped(1, 1, 0.032, 0.55);
  parts.push({ g: mid.g, m: T(x, y0 + p1 + 0.016, z, 0, 0, 0, top1 * 1.7, 1, top1 * 1.7), c: COL.iron });
  parts.push({ g: new BoxGeometry(0.0125, 0.003, 0.0125), m: T(x, y0 + p1 + 0.032, z), c: COL.ironDark });
  // Upper tower and spire (a square lathe with a flared, concave taper).
  const upper = lathe(
    [
      [0.0058, 0],
      [0.0042, 0.015],
      [0.0029, 0.035],
      [0.002, 0.05],
      [0.0024, 0.053],
      [0.0012, 0.058],
      [0.0004, 0.068],
      [0, 0.069],
    ],
    4,
  );
  upper.rotateY(Math.PI / 4);
  parts.push({ g: upper, m: T(x, y0 + p1 + 0.0335, z), c: COL.iron });
  // A little plaza under it.
  parts.push({ g: new CylinderGeometry(0.03, 0.03, 0.0012, 20), m: T(x, S + 0.0007, z), c: COL.avenue });
}

/** Notre-Dame: nave with a steep lead roof, the two square west towers, the spire and a rounded apse. Long axis along `yaw`. */
function notreDame(parts: Part[], at: MapXZ, yaw: number): void {
  const L = 0.046;
  const W = 0.015;
  const H = 0.014;
  const sub: Part[] = [];
  sub.push({ g: new BoxGeometry(L, H, W), m: T(0, H / 2, 0), c: COL.stone });
  // Roof: a triangular prism.
  const roof = new CylinderGeometry(W * 0.62, W * 0.62, L, 3, 1);
  roof.rotateZ(Math.PI / 2);
  roof.rotateX(Math.PI / 2 + Math.PI / 6);
  // After the rotations the prism's ridge lies along x; one apex points up.
  sub.push({ g: roof, m: T(0, H + W * 0.3, 0, 0, 0, 0, 1, 0.95, 1), c: COL.roofDark });
  // West front with two towers (west = -x in local).
  sub.push({ g: new BoxGeometry(0.008, 0.016, W + 0.002), m: T(-L / 2 - 0.002, 0.008, 0), c: COL.stoneShade });
  for (const s of [-1, 1]) sub.push({ g: new BoxGeometry(0.0085, 0.031, 0.0066), m: T(-L / 2 - 0.002, 0.0155, s * 0.0045), c: COL.stone });
  // Apse: half-round east end with a cone roof.
  sub.push({ g: new CylinderGeometry(W / 2, W / 2, H, 12, 1, false, 0, Math.PI), m: T(L / 2, H / 2, 0, 0, 0, 0), c: COL.stone });
  sub.push({ g: new CylinderGeometry(0.0005, W / 2 + 0.0005, 0.007, 12, 1, false, 0, Math.PI), m: T(L / 2, H + 0.0035, 0), c: COL.roof });
  // The spire at the crossing.
  sub.push({ g: new CylinderGeometry(0.0003, 0.0022, 0.022, 6), m: T(L * 0.12, H + 0.016, 0), c: COL.roofDark });
  for (const p of sub) {
    const m = T(at.x, S + 0.0035, at.z, 0, yaw, 0).multiply(p.m ?? T());
    parts.push({ g: p.g, m, c: p.c });
  }
}

/** L'Arc de Triomphe on its round plaza with twelve radiating avenues (l'Étoile). */
function arc(parts: Part[], at: MapXZ): void {
  const { x, z } = at;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const r0 = 0.02;
    const r1 = 0.075 + (i % 3) * 0.02;
    const p0 = { x: x + Math.cos(a) * r0, z: z + Math.sin(a) * r0 };
    const p1 = { x: x + Math.cos(a) * r1, z: z + Math.sin(a) * r1 };
    if (onBoard(p1, 0.01)) avenue(parts, p0, p1, i === 0 ? 0.008 : 0.0045);
  }
  parts.push({ g: new CylinderGeometry(0.026, 0.026, 0.0016, 24), m: T(x, S + 0.0009, z), c: COL.avenue });
  // The arch faces east down the Champs-Élysées: two piers, the attic on top.
  const W = 0.032;
  const D = 0.014;
  const H = 0.033;
  const pier = 0.0105;
  for (const s of [-1, 1]) parts.push({ g: new BoxGeometry(pier, H * 0.74, D), m: T(x, S + (H * 0.74) / 2, z + s * (W / 2 - pier / 2), 0, Math.PI / 2, 0), c: COL.stone });
  parts.push({ g: new BoxGeometry(W, H * 0.26, D), m: T(x, S + H * 0.74 + (H * 0.26) / 2, z, 0, Math.PI / 2, 0), c: COL.stoneShade });
  parts.push({ g: new BoxGeometry(W + 0.002, 0.0015, D + 0.002), m: T(x, S + H + 0.0006, z, 0, Math.PI / 2, 0), c: COL.stone });
}

/** Sacré-Cœur, white, on top of the Montmartre hill: main dome, two small domes, the bell tower behind. */
function sacreCoeur(out: Part[], at: MapXZ): number {
  // Built at the origin, then scaled up 1.35x (a landmark should out-read the blocks) and moved onto the spot.
  const parts: Part[] = [];
  const x = 0;
  const z = 0;
  const hillH = 0.03;
  parts.push({ g: lathe([[0.06, 0], [0.054, 0.006], [0.04, 0.018], [0.024, 0.026], [0.01, hillH], [0, hillH]], 28), m: T(x, S - 0.0005, z), c: COL.hill });
  const y = S + hillH - 0.001;
  parts.push({ g: new BoxGeometry(0.03, 0.012, 0.02), m: T(x, y + 0.006, z), c: COL.white });
  // Main dome: a tall drum and an elongated dome with a lantern.
  parts.push({ g: new CylinderGeometry(0.0075, 0.0075, 0.009, 16), m: T(x, y + 0.016, z - 0.001), c: COL.white });
  parts.push({ g: new SphereGeometry(0.0078, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m: T(x, y + 0.0205, z - 0.001, 0, 0, 0, 1, 1.5, 1), c: COL.white });
  parts.push({ g: new CylinderGeometry(0.0004, 0.0018, 0.008, 8), m: T(x, y + 0.036, z - 0.001), c: COL.stoneShade });
  for (const s of [-1, 1]) {
    parts.push({ g: new CylinderGeometry(0.0038, 0.0038, 0.005, 12), m: T(x + s * 0.0115, y + 0.0145, z + 0.005), c: COL.white });
    parts.push({ g: new SphereGeometry(0.0039, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m: T(x + s * 0.0115, y + 0.017, z + 0.005, 0, 0, 0, 1, 1.4, 1), c: COL.white });
  }
  // Campanile behind.
  parts.push({ g: new BoxGeometry(0.0055, 0.024, 0.0055), m: T(x, y + 0.012, z - 0.013), c: COL.white });
  parts.push({ g: new CylinderGeometry(0.0003, 0.0035, 0.007, 4), m: T(x, y + 0.0275, z - 0.013, 0, Math.PI / 4, 0), c: COL.stoneShade });
  const hill = parts.shift()!; // the hill keeps its size
  out.push({ g: hill.g, m: T(at.x, 0, at.z).multiply(hill.m ?? T()), c: hill.c });
  const lift = T(at.x, y, at.z, 0, 0, 0, 1.35).multiply(T(0, -y, 0));
  for (const p of parts) out.push({ g: p.g, m: lift.clone().multiply(p.m ?? T()), c: p.c });
  return hillH;
}

/** River samples clipped to the board, with the ends extended exactly to the board edge. */
function riverOnBoard(): MapXZ[] {
  const all = seineSamples(72);
  const hw = BOARD.width / 2 - 0.012;
  const hd = BOARD.depth / 2 - 0.012;
  const inside = all.filter((p) => Math.abs(p.x) <= hw && Math.abs(p.z) <= hd);
  const extend = (a: MapXZ, b: MapXZ): MapXZ => {
    // From b (inside) toward a (the next sample outward): walk to the board edge.
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    let t = Infinity;
    if (dx) t = Math.min(t, ((Math.sign(dx) * hw - b.x) / dx));
    if (dz) t = Math.min(t, ((Math.sign(dz) * hd - b.z) / dz));
    if (!Number.isFinite(t) || t < 0) return b;
    return { x: b.x + dx * t, z: b.z + dz * t };
  };
  return [extend(inside[0], inside[1]), ...inside, extend(inside[inside.length - 1], inside[inside.length - 2])];
}

export interface DioramaStats {
  blocks: number;
  trees: number;
}

let proto: Group | null = null;

/**
 * The static diorama (board, land, landmarks, river). Memoized: the manifest
 * prototype and DioramaSystem share one build; place it with `.clone()`.
 */
export function buildParisDiorama(): Group {
  if (proto) return proto;
  const parts: Part[] = [];
  const rand = makeRandom(1889); // the year of the Eiffel Tower
  const { width: BW, depth: BD } = BOARD;

  // Board: dark wood base, a raised lip, the cream map surface.
  parts.push({ g: new BoxGeometry(BW, S - 0.002, BD), m: T(0, (S - 0.002) / 2, 0), c: COL.wood });
  parts.push({ g: new BoxGeometry(BW - 0.014, 0.002, BD - 0.014), m: T(0, S - 0.001, 0), c: COL.land });
  for (const s of [-1, 1]) {
    parts.push({ g: new BoxGeometry(BW, 0.005, 0.007), m: T(0, S + 0.0015, s * (BD / 2 - 0.0035)), c: COL.woodEdge });
    parts.push({ g: new BoxGeometry(0.007, 0.005, BD - 0.014), m: T(s * (BW / 2 - 0.0035), S + 0.0015, 0), c: COL.woodEdge });
  }

  // The Seine: stone quays (dry mesh), the island, bridges. The water itself is its own mesh.
  const river = riverOnBoard();
  parts.push({ g: ribbon(river, SEINE_WIDTH + 0.009, S + 0.0004), c: COL.quay });
  const nd = LANDMARKS.notreDame;
  const ri = river.findIndex((p) => p.x < nd.x);
  const along = river[Math.max(ri - 1, 0)];
  const next = river[Math.min(ri + 1, river.length - 1)];
  const riverYaw = Math.atan2(-(next.z - along.z), next.x - along.x);
  const island = new CircleGeometry(1, 20);
  island.rotateX(-Math.PI / 2);
  parts.push({ g: island, m: T(nd.x, S + 0.0022, nd.z, 0, riverYaw, 0, 0.032, 1, 0.0105), c: COL.quay });
  for (const t of [0.1, 0.2, 0.42, 0.56, 0.68, 0.8]) {
    const i = Math.round(t * (river.length - 1));
    const a = river[Math.max(i - 1, 0)];
    const b = river[Math.min(i + 1, river.length - 1)];
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x) + Math.PI / 2;
    parts.push({ g: new BoxGeometry(SEINE_WIDTH + 0.014, 0.0022, 0.0042), m: T(river[i].x, S + 0.0019, river[i].z, 0, yaw, 0), c: COL.bridge });
  }

  // Parks and the great avenues.
  const eif = LANDMARKS.eiffel;
  const away = { x: 0.055, z: 0.035 };
  const al = Math.hypot(away.x, away.z);
  const cdmYaw = Math.atan2(-away.z, away.x);
  const cdm = { x: eif.x + (away.x / al) * 0.055, z: eif.z + (away.z / al) * 0.055 };
  patch(parts, cdm.x, cdm.z, 0.068, 0.03, cdmYaw, 0.0007, COL.park);
  const tuileries = { x: -0.035, z: -0.056 };
  patch(parts, tuileries.x, tuileries.z, 0.05, 0.017, riverYaw, 0.0007, COL.park);
  const luxembourg = { x: 0.07, z: 0.105 };
  patch(parts, luxembourg.x, luxembourg.z, 0.036, 0.03, 0.1, 0.0007, COL.park);
  const concorde = { x: -0.065, z: -0.07 };
  avenue(parts, LANDMARKS.arc, concorde, 0.008);
  avenue(parts, { x: -0.3, z: 0.0 }, { x: 0.3, z: -0.11 }, 0.0045); // grands boulevards
  avenue(parts, { x: 0.02, z: 0.2 }, { x: 0.06, z: -0.2 }, 0.0045); // boulevard Saint-Michel / Sébastopol
  avenue(parts, { x: -0.3, z: 0.17 }, { x: 0.3, z: 0.07 }, 0.004); // boulevard Saint-Germain

  // Landmarks.
  eiffel(parts, eif);
  notreDame(parts, nd, riverYaw);
  arc(parts, LANDMARKS.arc);
  sacreCoeur(parts, LANDMARKS.sacreCoeur);

  const stats = fill(parts, rand, river, [cdm, tuileries, luxembourg], concorde);
  const land = new Mesh(merge(parts), vcMat('paris-diorama', { roughness: 0.82 }));
  land.name = 'Land';
  land.receiveShadow = true;
  land.castShadow = false;

  const water = new Mesh(
    ribbon(river, SEINE_WIDTH, S + 0.0012),
    sharedMat('paris-seine', () => new MeshStandardMaterial({ color: 0x3a7fae, roughness: 0.32, metalness: 0.0, emissive: 0x0c2c40, emissiveIntensity: 0.5 })),
  );
  water.name = 'Seine';
  water.castShadow = false;

  const root = new Group();
  root.name = 'Paris Diorama';
  root.add(land, water);
  root.userData.stats = stats;
  proto = root;
  return root;
}

/** Distance from p to segment a-b. */
function segDist(p: MapXZ, a: MapXZ, b: MapXZ): number {
  return distanceToPolyline(p, [a, b]);
}

/** Haussmann blocks (cream stone, grey mansard roofs) and street trees, kept clear of the river, landmarks, parks and pins. */
function fill(parts: Part[], rand: () => number, river: MapXZ[], parks: MapXZ[], concorde: MapXZ): DioramaStats {
  const L = LANDMARKS;
  const clearOf: [MapXZ, number][] = [
    [L.eiffel, 0.04],
    [L.arc, 0.032],
    [L.sacreCoeur, 0.058],
    [L.notreDame, 0.03],
    [parks[0], 0.042],
    [parks[1], 0.03],
    [parks[2], 0.028],
    ...Object.values(PARIS_MAP).map((p) => [p, 0.026] as [MapXZ, number]),
  ];
  const free = (p: MapXZ, r: number) =>
    onBoard(p, 0.014 + r) &&
    distanceToPolyline(p, river) > SEINE_WIDTH / 2 + 0.008 + r &&
    clearOf.every(([c, cr]) => Math.hypot(p.x - c.x, p.z - c.z) > cr + r) &&
    segDist(p, L.arc, concorde) > 0.006 + r;

  const body = new BoxGeometry(1, 1, 1);
  const roof = hipped(1, 1, 1, 0.55).g;
  let blocks = 0;
  const step = 0.027;
  for (let gx = -BOARD.width / 2; gx <= BOARD.width / 2; gx += step)
    for (let gz = -BOARD.depth / 2; gz <= BOARD.depth / 2; gz += step) {
      const p = { x: gx + (rand() - 0.5) * 0.006, z: gz + (rand() - 0.5) * 0.006 };
      if (rand() < 0.22) continue; // courtyards and squares: a city, not a grid
      const w = 0.0135 + rand() * 0.005;
      const d = 0.0135 + rand() * 0.005;
      if (!free(p, Math.max(w, d) * 0.55)) continue;
      // Taller blocks toward the centre, lower toward the edges (reads as a city, not a grid).
      const centre = 1 - Math.min(1, Math.hypot(p.x / 0.31, p.z / 0.21));
      const h = 0.009 + rand() * 0.005 + centre * 0.004;
      const yaw = (rand() - 0.5) * 0.25;
      const stone = rand() < 0.5 ? COL.stone : COL.stoneShade;
      parts.push({ g: body, m: T(p.x, S + h / 2, p.z, 0, yaw, 0, w, h, d), c: stone });
      const rh = 0.0045 + rand() * 0.0015;
      const tone = rand();
      parts.push({ g: roof, m: T(p.x, S + h + rh / 2, p.z, 0, yaw, 0, w * 1.02, rh, d * 1.02), c: tone < 0.45 ? COL.roof : tone < 0.85 ? COL.roofDark : COL.roofWarm });
      blocks++;
    }

  // Trees: along both quays, and a few in each park.
  const tree = new IcosahedronGeometry(1, 0);
  let trees = 0;
  const addTree = (x: number, z: number, r: number) => {
    parts.push({ g: tree, m: T(x, S + r * 0.9, z, rand(), rand(), 0, r, r * 1.1, r), c: rand() < 0.5 ? COL.tree : COL.treeLight });
    trees++;
  };
  for (let i = 2; i < river.length - 2; i += 3) {
    const a = river[i - 1];
    const b = river[i + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / l;
    const nz = (b.x - a.x) / l;
    for (const s of [-1, 1]) {
      const off = SEINE_WIDTH / 2 + 0.0095;
      const p = { x: river[i].x + nx * off * s, z: river[i].z + nz * off * s };
      if (onBoard(p, 0.012) && clearOf.slice(0, 4).every(([c, cr]) => Math.hypot(p.x - c.x, p.z - c.z) > cr * 0.8)) addTree(p.x, p.z, 0.0042);
    }
  }
  for (const park of parks)
    for (let k = 0; k < 7; k++) {
      const x = park.x + (rand() - 0.5) * 0.04;
      const z = park.z + (rand() - 0.5) * 0.02;
      addTree(x, z, 0.004 + rand() * 0.0015);
    }
  return { blocks, trees };
}
