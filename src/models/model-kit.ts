/**
 * Tiny construction kit shared by the procedural cafe models.
 *
 * - `merge()` bakes many primitive parts (each with its own transform and optional
 *   vertex colour) into ONE BufferGeometry so a whole sub-assembly costs one draw call.
 * - Shared materials / geometries / textures are registered in module-level sets so
 *   `disposeObject()` in cafe-models.ts never frees something another instance uses.
 *
 * Pure module: no World, no DOM (canvas helpers guard `typeof document`), no timers.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  LatheGeometry,
  type Material,
  Matrix4,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  Quaternion,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
} from '@iwsdk/core';

export const SHARED_MATERIALS = new Set<Material>();
export const SHARED_GEOMETRIES = new Set<BufferGeometry>();
export const SHARED_TEXTURES = new Set<Texture>();

const matCache = new Map<string, Material>();

/** Return (and cache) a shared material by key. */
export function sharedMat<M extends Material>(key: string, make: () => M): M {
  let m = matCache.get(key) as M | undefined;
  if (!m) {
    m = make();
    m.name = key;
    matCache.set(key, m);
    SHARED_MATERIALS.add(m);
  }
  return m;
}

/** Shared vertex-coloured standard material (white base, colour comes from the geometry). */
export function vcMat(key: string, params: MeshStandardMaterialParameters = {}): MeshStandardMaterial {
  return sharedMat(`vc:${key}`, () => new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0, ...params }));
}

const geoCache = new Map<string, BufferGeometry>();
/** Return (and cache) a shared geometry by key. */
export function sharedGeo(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
    SHARED_GEOMETRIES.add(g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _up = new Vector3(0, 1, 0);

/** Translation, Euler rotation (XYZ) and scale packed into a Matrix4. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 {
  return new Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/** Matrix from explicit position / quaternion / scale. */
export function TQ(pos: Vector3, quat: Quaternion, sx = 1, sy = sx, sz = sx): Matrix4 {
  return new Matrix4().compose(pos, quat, _s.set(sx, sy, sz));
}

/** Matrix that places a Y-up primitive centred between a and b, its +Y along a->b. */
export function spanMatrix(a: Vector3, b: Vector3): { m: Matrix4; len: number } {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new Quaternion().setFromUnitVectors(_up, dir.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  return { m: new Matrix4().compose(mid, q, _s.set(1, 1, 1)), len };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export interface Part {
  g: BufferGeometry;
  m?: Matrix4;
  /** Optional sRGB hex vertex colour (only meaningful with a vertexColors material). */
  c?: number;
}

const _c = new Color();

/**
 * Bake parts into one geometry (position, normal, uv and — when any part has `c` — color).
 * Keeps an index buffer when every input is indexed; otherwise de-indexes all inputs.
 * Never mirror with a negative scale here (it would flip winding); mirror positions instead.
 */
export function merge(parts: Part[]): BufferGeometry {
  const colored = parts.some((p) => p.c !== undefined);
  const allIndexed = parts.every((p) => p.g.index !== null);
  const prepared = parts.map((p) => {
    const g = allIndexed ? p.g.clone() : p.g.index ? p.g.toNonIndexed() : p.g.clone();
    if (p.m) g.applyMatrix4(p.m);
    return g;
  });
  let vCount = 0;
  let iCount = 0;
  for (const g of prepared) {
    vCount += g.getAttribute('position').count;
    if (allIndexed) iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = colored ? new Float32Array(vCount * 3) : null;
  const idx = allIndexed ? (vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount)) : null;
  let vo = 0;
  let io = 0;
  prepared.forEach((g, i) => {
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const U = g.getAttribute('uv');
    if (col) _c.set(parts[i].c ?? 0xffffff);
    for (let k = 0; k < P.count; k++) {
      const o = (vo + k) * 3;
      pos[o] = P.getX(k);
      pos[o + 1] = P.getY(k);
      pos[o + 2] = P.getZ(k);
      if (N) {
        nor[o] = N.getX(k);
        nor[o + 1] = N.getY(k);
        nor[o + 2] = N.getZ(k);
      }
      if (U) {
        uv[(vo + k) * 2] = U.getX(k);
        uv[(vo + k) * 2 + 1] = U.getY(k);
      }
      if (col) {
        col[o] = _c.r;
        col[o + 1] = _c.g;
        col[o + 2] = _c.b;
      }
    }
    if (idx) {
      const I = g.index!;
      for (let j = 0; j < I.count; j++) idx[io + j] = I.getX(j) + vo;
      io += I.count;
    }
    vo += P.count;
    g.dispose();
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new BufferAttribute(col, 3));
  if (idx) out.setIndex(new BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** LatheGeometry from [radius, y] pairs. List the visible surface bottom -> top. */
export function lathe(points: Array<[number, number]>, segments = 16, phiStart = 0, phiLength = Math.PI * 2): LatheGeometry {
  return new LatheGeometry(points.map(([r, y]) => new Vector2(r, y)), segments, phiStart, phiLength);
}

/**
 * Closed thin shell around a lathe profile (bottom -> top), e.g. an apron panel or a horn.
 * Inner surface follows `profile`, outer surface sits `thickness` further out.
 */
export function shell(profile: Array<[number, number]>, thickness: number, segments = 16, phiStart = 0, phiLength = Math.PI * 2): LatheGeometry {
  const outer = profile.map(([r, y]) => [r + thickness, y] as [number, number]);
  const inner = profile.slice().reverse();
  return lathe([...outer, ...inner, outer[0]], segments, phiStart, phiLength);
}

/** Piecewise-linear lookup of r(y) on a [r, y] profile listed bottom -> top. */
export function profileR(profile: Array<[number, number]>, y: number): number {
  if (y <= profile[0][1]) return profile[0][0];
  for (let i = 1; i < profile.length; i++) {
    const [r1, y1] = profile[i];
    if (y <= y1) {
      const [r0, y0] = profile[i - 1];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
    }
  }
  return profile[profile.length - 1][0];
}

/** Deterministic PRNG (mulberry32). */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export const HAS_DOM = typeof document !== 'undefined';

/** Create a canvas + sRGB CanvasTexture, or null outside a DOM (Node tests). */
export function makeCanvasTexture(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture } | null {
  if (!HAS_DOM) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}
