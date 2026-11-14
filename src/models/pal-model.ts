/**
 * Pal, the English-speaking companion: a small round Paris sparrow (un moineau)
 * in a tiny blue beret who sits on the learner's side of the counter.
 *
 * Contract (metres, +Y up, faces +Z, origin = centre of the feet on the counter):
 *  - envelope about 0.09 x 0.112 x 0.10 (w x h x d);
 *  - three draw calls: `Pal/Body` (body, belly, wings, tail, beak, feet, beret,
 *    merged, vertex coloured), `Pal/Eyes` (pivot at eye height so a Y scale is a
 *    blink), `Pal/Ring` (the listening / talking glow on the counter, hidden at rest);
 *  - under 2k triangles, geometries and materials shared by every instance.
 * Pure module: no World, no DOM, no timers (also the manifest prototype).
 */

import {
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
} from '@iwsdk/core';
import { lathe, merge, sharedGeo, sharedMat, T, vcMat, type Part } from './model-kit.js';

/** Pal's colour everywhere (beret, glow ring, chat bubble): a Paris blue, distinct from the shopkeepers' maroon. */
export const PAL_BLUE = 0x2f5fb3;

const BROWN = 0x9a6a43;
const DARK = 0x6b4529;
const CREAM = 0xf3e6cc;
const ORANGE = 0xe8933a;

/** Eye centre height (the Eyes mesh pivot). */
export const PAL_EYE_Y = 0.074;
/** Height of the whole bird, beret included. */
export const PAL_HEIGHT = 0.112;

/** Egg-shaped body and head in one (radius, y) profile. */
const BODY_PROFILE: Array<[number, number]> = [
  [0.0001, 0.01],
  [0.024, 0.014],
  [0.037, 0.026],
  [0.042, 0.042],
  [0.041, 0.056],
  [0.037, 0.069],
  [0.031, 0.08],
  [0.022, 0.089],
  [0.011, 0.095],
  [0.0001, 0.097],
];

/** A soft beret: flat crown with a rolled edge. */
const BERET_PROFILE: Array<[number, number]> = [
  [0.0001, 0.0],
  [0.024, 0.0],
  [0.031, 0.003],
  [0.03, 0.007],
  [0.022, 0.011],
  [0.0001, 0.012],
];

function bodyGeometry() {
  return sharedGeo('pal:body', () => {
    const sphere = new SphereGeometry(1, 12, 8);
    const parts: Part[] = [
      { g: lathe(BODY_PROFILE, 18), c: BROWN },
      // Cream belly, pushed forward so it reads as a bib from the front.
      { g: sphere, m: T(0, 0.044, 0.018, 0, 0, 0, 0.03, 0.034, 0.026), c: CREAM },
      // Cheeks: light patches beside the eyes.
      { g: sphere, m: T(0.024, 0.066, 0.024, 0, 0, 0, 0.011, 0.009, 0.008), c: CREAM },
      { g: sphere, m: T(-0.024, 0.066, 0.024, 0, 0, 0, 0.011, 0.009, 0.008), c: CREAM },
      // Folded wings hugging the sides (rooted into the body, tips sweeping back).
      { g: sphere, m: T(0.036, 0.047, -0.006, 0.25, 0, -0.18, 0.013, 0.028, 0.032), c: DARK },
      { g: sphere, m: T(-0.036, 0.047, -0.006, 0.25, 0, 0.18, 0.013, 0.028, 0.032), c: DARK },
      // Tail: a flattened cone out of the back, slightly raised.
      { g: new ConeGeometry(0.017, 0.04, 8), m: T(0, 0.03, -0.045, -1.95, 0, 0, 1, 1, 0.35), c: DARK },
      // Beak: short cone pointing at the learner.
      { g: new ConeGeometry(0.0075, 0.017, 10), m: T(0, 0.063, 0.042, Math.PI / 2, 0, 0), c: ORANGE },
      // Feet: two stubby legs with a toe pad each.
      { g: new CylinderGeometry(0.0035, 0.0035, 0.014, 6), m: T(0.012, 0.007, 0.006), c: ORANGE },
      { g: new CylinderGeometry(0.0035, 0.0035, 0.014, 6), m: T(-0.012, 0.007, 0.006), c: ORANGE },
      { g: sphere, m: T(0.012, 0.002, 0.012, 0, 0, 0, 0.0065, 0.0025, 0.01), c: ORANGE },
      { g: sphere, m: T(-0.012, 0.002, 0.012, 0, 0, 0, 0.0065, 0.0025, 0.01), c: ORANGE },
      // Tiny beret, worn at an angle, with its little stalk.
      { g: lathe(BERET_PROFILE, 18), m: T(0.004, 0.09, -0.002, -0.08, 0, -0.22), c: PAL_BLUE },
      { g: new CylinderGeometry(0.0018, 0.0025, 0.008, 6), m: T(0.0015, 0.105, -0.003, -0.08, 0, -0.22), c: PAL_BLUE },
    ];
    return merge(parts);
  });
}

function eyesGeometry() {
  return sharedGeo('pal:eyes', () => {
    const ball = new SphereGeometry(1, 10, 8);
    const parts: Part[] = [];
    for (const s of [1, -1]) {
      // Relative to the eye pivot (y = PAL_EYE_Y): sclera on the head surface, pupil and glint in front.
      parts.push({ g: ball, m: T(0.016 * s, 0, 0.03, 0, 0, 0, 0.009, 0.0095, 0.006), c: 0xffffff });
      parts.push({ g: ball, m: T(0.017 * s, 0.0005, 0.0352, 0, 0, 0, 0.0055, 0.006, 0.0025), c: 0x15110d });
      parts.push({ g: ball, m: T(0.0145 * s + 0.002, 0.003, 0.0375, 0, 0, 0, 0.0016, 0.0016, 0.001), c: 0xffffff });
    }
    return merge(parts);
  });
}

export interface PalRig {
  root: Group;
  /** Body, eyes and beret: bobs, and pulses while talking. */
  body: Group;
  /** Scaled on Y for blinks (pivot at eye height). */
  eyes: Mesh;
  /** Glow ring on the counter: listening (steady) or talking (pulsing). Hidden at rest. */
  ring: Mesh;
  ringMat: MeshBasicMaterial;
}

/** A fresh Pal (shared geometry; its own transforms and its own ring material). */
export function buildPal(): PalRig {
  const root = new Group();
  root.name = 'Pal';
  const body = new Group();
  body.name = 'Pal/Bob';
  const mat = vcMat('pal', { roughness: 0.8 });
  const bodyMesh = new Mesh(bodyGeometry(), mat);
  bodyMesh.name = 'Pal/Body';
  const eyes = new Mesh(eyesGeometry(), mat);
  eyes.name = 'Pal/Eyes';
  eyes.position.y = PAL_EYE_Y;
  body.add(bodyMesh, eyes);
  // Per instance: the ring's colour and opacity follow listening / talking / high contrast.
  const ringMat = new MeshBasicMaterial({ color: PAL_BLUE, transparent: true, opacity: 0.75, depthWrite: false, side: DoubleSide, toneMapped: false });
  const ring = new Mesh(
    sharedGeo('pal:ring', () => new RingGeometry(0.05, 0.062, 32).rotateX(-Math.PI / 2)),
    ringMat,
  );
  ring.name = 'Pal/Ring';
  ring.position.y = 0.002;
  ring.visible = false;
  ring.userData.iwsdkPreviewBounds = 'exclude';
  root.add(body, ring);
  return { root, body, eyes, ring, ringMat };
}
