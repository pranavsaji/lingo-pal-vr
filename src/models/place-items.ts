/**
 * Procedural counter items and set dressing for the bistrot, the metro and the
 * pharmacie: everyday things the learner pinches and names (a ticket, a crêpe,
 * a box of plasters...). Each item is ONE merged, vertex-coloured mesh (plus one
 * glass mesh for drinks), so a whole shop's items cost about one draw call each.
 * "Printed" labels are thin coloured slabs: no textures, nothing to load.
 *
 * Every item builder returns a parentless Group whose base sits at local y = 0,
 * about 0.08-0.2 m across. Materials are created per build (the shop set and its
 * items are disposed with their entity when the learner travels).
 *
 * Pure module: no World, no timers; canvas signs return a plain material without a DOM.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from '@iwsdk/core';
import { PLACES, priceToDigits } from '../agent/menu.js';
import type { PlaceId } from '../game-state.js';
import { buildChalkboard } from './cafe-models.js';
import { lathe, makeCanvasTexture, makeRandom, merge, T, type Part } from './model-kit.js';

/** Item shapes built here (vocab.ts `shape`). */
export const PLACE_ITEM_SHAPES = [
  'plat',
  'soupe',
  'salade',
  'crepe',
  'jus',
  'carafe',
  'addition',
  'ticket',
  'carnet',
  'forfait',
  'plan_metro',
  'pansements',
  'creme',
  'mouchoirs',
  'sirop',
  'paracetamol',
] as const;
export type PlaceItemShape = (typeof PLACE_ITEM_SHAPES)[number];

export function isPlaceItemShape(s: string): s is PlaceItemShape {
  return (PLACE_ITEM_SHAPES as readonly string[]).includes(s);
}

// sRGB palette.
const K = {
  porcelain: 0xf6f3ec,
  rim: 0x1f3b63,
  steak: 0x6b3a22,
  fries: 0xe6b54a,
  bean: 0x4f8a2f,
  soup: 0xb8743a,
  bread: 0xd9a15a,
  cheese: 0xf1d98a,
  leaf: 0x5fae3b,
  leafDark: 0x3d7d25,
  tomato: 0xd8352a,
  crepe: 0xe0a95b,
  crepeDark: 0xb87a35,
  sugar: 0xffffff,
  juice: 0xf39a1d,
  water: 0xcfe8f2,
  paper: 0xfbfaf6,
  ink: 0x3a3b40,
  inkLight: 0x9a9da6,
  ticket: 0xf2efe6,
  ticketBand: 0x6a4fa3,
  stripe: 0x5a3b22,
  pass: 0x2f6db5,
  passAccent: 0xf5d90a,
  lineGreen: 0x2a9d48,
  lineYellow: 0xf2c230,
  lineRed: 0xd1495b,
  lineBlue: 0x3d6fb6,
  boxWhite: 0xf7f7f4,
  boxBlue: 0x6fa8dc,
  plaster: 0xe7c3a0,
  cross: 0x2a9d48,
  sunscreen: 0xf6a623,
  sunscreenDeep: 0xe0721a,
  sun: 0xffd84a,
  cap: 0xfafafa,
  tissue: 0xdfeef8,
  tissueBand: 0x4f8fc9,
  amber: 0x7a3d12,
  label: 0xf4efe2,
  red: 0xc8102e,
  wood: 0x8a5a35,
};

function vc(roughness = 0.6, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness });
}

function glass(color = 0xe8f4f8, opacity = 0.35): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false });
}

function mesh(name: string, geo: BufferGeometry, mat: Material, shadow = true): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function one(name: string, parts: Part[], roughness = 0.6): Group {
  const g = new Group();
  g.name = name;
  g.add(mesh(`${name} Body`, merge(parts), vc(roughness)));
  return g;
}

/** A flat dinner plate (radius r), as lathe parts with its blue rim line. */
function plate(r: number, parts: Part[]): number {
  parts.push({ g: lathe([[0, 0], [r * 0.62, 0], [r * 0.66, 0.006], [r * 0.9, 0.012], [r, 0.016], [r * 0.97, 0.018], [r * 0.6, 0.008], [0, 0.008]], 28), c: K.porcelain });
  parts.push({ g: new CylinderGeometry(r * 0.965, r * 0.965, 0.0012, 28, 1, true), m: T(0, 0.0165), c: K.rim });
  return 0.008; // food rests here
}

/** A box with rounded-looking bevel strips, base at y = 0. */
function box(w: number, h: number, d: number, c: number, x = 0, z = 0, ry = 0): Part {
  return { g: new BoxGeometry(w, h, d), m: T(x, h / 2, z, 0, ry), c };
}

/** A thin printed slab on a face: (x, y, z) centre, size, colour. */
function print(w: number, h: number, d: number, x: number, y: number, z: number, c: number, ry = 0): Part {
  return { g: new BoxGeometry(w, h, d), m: T(x, y, z, 0, ry), c };
}

// ---------------------------------------------------------------------------
// Le Bistrot
// ---------------------------------------------------------------------------

function buildPlat(): Group {
  const p: Part[] = [];
  const f = plate(0.105, p);
  p.push({ g: new SphereGeometry(0.04, 14, 10), m: T(-0.025, f + 0.011, -0.005, 0, 0.4, 0, 1.25, 0.32, 0.9), c: K.steak });
  const rand = makeRandom(7);
  for (let i = 0; i < 7; i++) p.push({ g: new BoxGeometry(0.007, 0.007, 0.05), m: T(0.045 + rand() * 0.02, f + 0.006 + i * 0.002, -0.02 + rand() * 0.03, 0, rand() * 1.2 - 0.6), c: K.fries });
  for (let i = 0; i < 5; i++) p.push({ g: new CylinderGeometry(0.003, 0.003, 0.045, 6), m: T(-0.01 + i * 0.008, f + 0.004, 0.05, Math.PI / 2, 0.2 + i * 0.1, 0), c: K.bean });
  return one('Plat du jour', p, 0.45);
}

function bowl(r: number, h: number, parts: Part[], c = K.porcelain): void {
  const t = 0.004;
  parts.push({ g: lathe([[0, 0], [r * 0.55, 0], [r * 0.62, 0.006], [r * 0.95, h * 0.75], [r, h], [r - t, h], [r * 0.95 - t, h * 0.75], [r * 0.6 - t, 0.006 + t], [0, 0.006 + t]], 24), c });
}

function buildSoupe(): Group {
  const p: Part[] = [];
  p.push({ g: lathe([[0, 0], [0.07, 0], [0.078, 0.008], [0.07, 0.008], [0, 0.006]], 24), c: K.porcelain }); // saucer
  for (const s of [-1, 1]) p.push({ g: new CylinderGeometry(0.005, 0.005, 0.03, 8), m: T(s * 0.064, 0.05, 0, 0, 0, Math.PI / 2), c: 0x8a4b2a }); // handles
  const parts: Part[] = [];
  bowl(0.058, 0.055, parts, 0x8a4b2a);
  for (const x of parts) p.push({ g: x.g, m: T(0, 0.006), c: x.c });
  p.push({ g: new CylinderGeometry(0.052, 0.052, 0.003, 24), m: T(0, 0.05), c: K.soup });
  p.push({ g: new CylinderGeometry(0.03, 0.03, 0.01, 18), m: T(0.004, 0.055, 0, 0, 0, 0, 1, 1, 0.75), c: K.bread });
  p.push({ g: new SphereGeometry(0.03, 14, 8), m: T(0.004, 0.06, 0, 0, 0, 0, 1.05, 0.22, 0.8), c: K.cheese });
  return one('Soupe', p, 0.5);
}

function buildSalade(): Group {
  const p: Part[] = [];
  bowl(0.072, 0.045, p);
  const rand = makeRandom(11);
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 0.045;
    p.push({ g: new SphereGeometry(0.022, 10, 6), m: T(Math.cos(a) * r, 0.04 + rand() * 0.014, Math.sin(a) * r, rand() * 0.8 - 0.4, rand() * 3, rand() * 0.8 - 0.4, 1, 0.3, 0.75), c: i % 3 ? K.leaf : K.leafDark });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    p.push({ g: new SphereGeometry(0.011, 10, 8), m: T(Math.cos(a) * 0.03, 0.058, Math.sin(a) * 0.03), c: K.tomato });
  }
  return one('Salade', p, 0.5);
}

function buildCrepe(): Group {
  const p: Part[] = [];
  const f = plate(0.1, p);
  // Folded in four: two stacked quarter discs, slightly offset.
  for (let i = 0; i < 2; i++) {
    p.push({ g: new CylinderGeometry(0.088, 0.088, 0.007, 16, 1, false, 0, Math.PI / 2), m: T(-0.04 + i * 0.002, f + 0.004 + i * 0.006, 0.035 - i * 0.002, 0, Math.PI / 4 + 0.2, 0), c: i ? K.crepe : K.crepeDark });
  }
  const rand = makeRandom(3);
  for (let i = 0; i < 6; i++) p.push({ g: new SphereGeometry(0.006, 6, 4), m: T(-0.01 + rand() * 0.03, f + 0.016, -0.01 + rand() * 0.03, 0, 0, 0, 1.4, 0.2, 1.1), c: K.crepeDark });
  for (let i = 0; i < 9; i++) p.push({ g: new SphereGeometry(0.0022, 4, 3), m: T(-0.015 + rand() * 0.04, f + 0.017, -0.015 + rand() * 0.04), c: K.sugar });
  return one('Crepe', p, 0.55);
}

function buildJus(): Group {
  const g = new Group();
  g.name = 'Jus orange';
  const p: Part[] = [];
  p.push({ g: new CylinderGeometry(0.0305, 0.0275, 0.082, 20), m: T(0, 0.045), c: K.juice });
  p.push({ g: new CylinderGeometry(0.003, 0.003, 0.14, 6), m: T(0.01, 0.1, 0, 0, 0, -0.22), c: K.red });
  p.push({ g: new CylinderGeometry(0.028, 0.028, 0.006, 16, 1, false, 0, Math.PI), m: T(-0.03, 0.1, 0, Math.PI / 2, 0, 0.3), c: K.juice });
  g.add(mesh('Jus orange Body', merge(p), vc(0.35)));
  g.add(mesh('Jus orange Glass', lathe([[0, 0.004], [0.028, 0.004], [0.028, 0], [0.034, 0.105], [0.0325, 0.105], [0.027, 0.006]], 20), glass(), false));
  return g;
}

function buildCarafe(): Group {
  const g = new Group();
  g.name = 'Carafe';
  g.add(mesh('Carafe Water', lathe([[0, 0.006], [0.043, 0.006], [0.047, 0.02], [0.045, 0.08], [0.032, 0.11], [0, 0.11]], 20), glass(0x9fd3e6, 0.55), false));
  g.add(mesh('Carafe Glass', lathe([[0, 0.003], [0.046, 0.003], [0.046, 0], [0.051, 0.02], [0.049, 0.08], [0.031, 0.13], [0.023, 0.17], [0.028, 0.19], [0.025, 0.19], [0.02, 0.17], [0.028, 0.13]], 20), glass(), false));
  return g;
}

function buildAddition(): Group {
  const p: Part[] = [];
  p.push({ g: lathe([[0, 0], [0.05, 0], [0.062, 0.01], [0.058, 0.011], [0, 0.004]], 24), c: K.porcelain });
  const tilt = T(0, 0.006, 0, 0, 0.35);
  const at = (x: number, z: number, w: number, d: number, c: number, y = 0.0045): Part => ({ g: new BoxGeometry(w, 0.0012, d), m: tilt.clone().multiply(T(x, y, z)), c });
  p.push(at(0, 0, 0.055, 0.095, K.paper, 0.003));
  for (let i = 0; i < 4; i++) p.push(at(-0.006, -0.03 + i * 0.012, 0.03, 0.003, K.inkLight));
  p.push(at(0, 0.03, 0.04, 0.005, K.ink));
  p.push({ g: new SphereGeometry(0.007, 8, 6), m: T(0.035, 0.009, 0.02, 0, 0, 0, 1, 0.5, 1), c: 0xf2f2f2 }); // a mint
  return one('Addition', p, 0.5);
}

// ---------------------------------------------------------------------------
// Le Métro
// ---------------------------------------------------------------------------

/** The little counter tray tickets are slid across on. */
function counterTray(p: Part[]): number {
  p.push({ g: new BoxGeometry(0.17, 0.006, 0.11), m: T(0, 0.003), c: 0x3b3e45 });
  for (const s of [-1, 1]) p.push({ g: new BoxGeometry(0.17, 0.008, 0.006), m: T(0, 0.006, s * 0.052), c: 0x2b2d33 });
  return 0.006;
}

/** One ticket lying flat (about 1.8x real size so it reads at arm's length). */
function ticket(p: Part[], y: number, ry = 0, x = 0, z = 0): void {
  const M = T(x, y, z, 0, ry);
  const at = (w: number, d: number, px: number, pz: number, c: number): Part => ({ g: new BoxGeometry(w, 0.0008, d), m: M.clone().multiply(T(px, 0.0012, pz)), c });
  p.push({ g: new BoxGeometry(0.12, 0.0012, 0.054), m: M.clone().multiply(T(0, 0.0006, 0)), c: K.ticket });
  p.push(at(0.03, 0.054, -0.045, 0, K.ticketBand));
  p.push(at(0.084, 0.008, 0.016, -0.015, K.stripe));
  p.push(at(0.05, 0.004, 0.006, 0.006, K.ink));
  p.push(at(0.03, 0.004, -0.004, 0.016, K.inkLight));
}

function buildTicket(): Group {
  const p: Part[] = [];
  const y = counterTray(p);
  ticket(p, y, 0.15);
  return one('Ticket', p, 0.55);
}

function buildCarnet(): Group {
  const p: Part[] = [];
  const y = counterTray(p);
  for (let i = 0; i < 10; i++) ticket(p, y + i * 0.0013, 0.12 + Math.sin(i * 1.7) * 0.05, Math.sin(i * 2.3) * 0.003, Math.cos(i * 1.3) * 0.002);
  p.push({ g: new BoxGeometry(0.018, 0.016, 0.058), m: T(0.02, y + 0.007, 0, 0, 0.13), c: K.paper }); // paper band
  return one('Carnet', p, 0.55);
}

function buildForfait(): Group {
  const p: Part[] = [];
  p.push({ g: new BoxGeometry(0.1, 0.018, 0.04), m: T(0, 0.009), c: 0x2b2d33 }); // card stand
  const M = T(0, 0.012, -0.004, -0.28);
  const at = (w: number, h: number, x: number, y: number, c: number): Part => ({ g: new BoxGeometry(w, h, 0.0008), m: M.clone().multiply(T(x, y, 0.0016)), c });
  p.push({ g: new BoxGeometry(0.13, 0.082, 0.0025), m: M.clone().multiply(T(0, 0.041, 0)), c: K.pass });
  p.push(at(0.13, 0.014, 0, 0.066, K.passAccent));
  p.push(at(0.03, 0.036, -0.042, 0.032, K.paper));
  p.push(at(0.05, 0.006, 0.022, 0.04, K.paper));
  p.push(at(0.036, 0.005, 0.015, 0.026, 0xbcd3f0));
  p.push(at(0.016, 0.016, 0.046, 0.022, K.passAccent));
  return one('Forfait', p, 0.4);
}

function buildPlanMetro(): Group {
  const p: Part[] = [];
  // A folded pocket map lying open: paper with two fold creases, the network on top.
  p.push({ g: new BoxGeometry(0.15, 0.003, 0.15), m: T(0, 0.0015), c: 0xf3eedf });
  for (const x of [-0.025, 0.025]) p.push({ g: new BoxGeometry(0.0015, 0.0008, 0.15), m: T(x, 0.0032), c: 0xd8d0bd });
  const line = (x: number, z: number, len: number, ry: number, c: number): Part => ({ g: new BoxGeometry(0.005, 0.0012, len), m: T(x, 0.0036, z, 0, ry), c });
  p.push(line(0, 0, 0.13, 0.2, K.lineGreen), line(-0.004, 0.01, 0.12, -0.45, K.lineYellow), line(0.006, -0.01, 0.12, 0.75, K.lineRed), line(-0.008, 0, 0.12, 1.35, K.lineBlue));
  p.push(line(0.02, 0.045, 0.06, 1.3, 0x9fc6e0), line(-0.03, 0.05, 0.06, 1.85, 0x9fc6e0)); // the river
  for (const [x, z] of [[0, 0], [0.02, -0.03], [-0.025, 0.02], [0.03, 0.02], [-0.02, -0.035]] as const) {
    p.push({ g: new CylinderGeometry(0.005, 0.005, 0.0016, 10), m: T(x, 0.0042, z), c: 0xffffff });
  }
  p.push({ g: new BoxGeometry(0.15, 0.0012, 0.022), m: T(0, 0.0036, -0.064), c: 0x1f4e8c }); // title band
  return one('Plan du metro', p, 0.6);
}

// ---------------------------------------------------------------------------
// La Pharmacie (generic, unbranded packaging)
// ---------------------------------------------------------------------------

/** An upright carton, front face toward +Z, with printed bands on the front. */
function carton(p: Part[], w: number, h: number, d: number, body: number, bands: [number, number, number, number, number][], x = 0, ry = 0): void {
  const M = T(x, 0, 0, 0, ry);
  p.push({ g: new BoxGeometry(w, h, d), m: M.clone().multiply(T(0, h / 2, 0)), c: body });
  // [width, height, x, y, colour] on the front face.
  for (const [bw, bh, bx, by, c] of bands) p.push({ g: new BoxGeometry(bw, bh, 0.0008), m: M.clone().multiply(T(bx, by, d / 2 + 0.0004)), c });
}

function buildPansements(): Group {
  const p: Part[] = [];
  carton(p, 0.11, 0.07, 0.035, K.boxWhite, [
    [0.11, 0.014, 0, 0.012, K.boxBlue],
    [0.06, 0.016, 0, 0.042, K.plaster], // a plaster drawn on the box
    [0.022, 0.012, 0, 0.042, 0xf5e6d6],
    [0.05, 0.005, -0.02, 0.06, K.ink],
  ]);
  // One plaster lying in front of the box.
  p.push({ g: new BoxGeometry(0.07, 0.002, 0.02), m: T(0.01, 0.001, 0.045, 0, 0.25), c: K.plaster });
  p.push({ g: new BoxGeometry(0.024, 0.0025, 0.014), m: T(0.01, 0.0015, 0.045, 0, 0.25), c: 0xf5e6d6 });
  return one('Pansements', p, 0.6);
}

function buildCreme(): Group {
  const p: Part[] = [];
  const flat = (y: number): ReturnType<typeof T> => T(0, y, 0, 0, 0, 0, 1, 1, 0.6);
  p.push({ g: lathe([[0, 0], [0.024, 0], [0.031, 0.006], [0.033, 0.09], [0.027, 0.11], [0.013, 0.116], [0, 0.116]], 20), m: flat(0), c: K.sunscreen });
  p.push({ g: new CylinderGeometry(0.0335, 0.0335, 0.03, 20, 1, true), m: T(0, 0.035, 0, 0, 0, 0, 1, 1, 0.6), c: K.sunscreenDeep });
  p.push({ g: new CylinderGeometry(0.014, 0.014, 0.022, 14), m: T(0, 0.126), c: K.cap });
  p.push({ g: new CylinderGeometry(0.014, 0.014, 0.0012, 18), m: T(0, 0.07, 0.0205, Math.PI / 2, 0, 0), c: K.sun }); // the sun
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    p.push({ g: new BoxGeometry(0.003, 0.008, 0.0012), m: T(Math.cos(a) * 0.02, 0.07 + Math.sin(a) * 0.02, 0.0205, 0, 0, a - Math.PI / 2), c: K.sun });
  }
  return one('Creme solaire', p, 0.35);
}

function buildMouchoirs(): Group {
  const p: Part[] = [];
  const pack = (y: number, ry: number, x: number): void => {
    const M = T(x, y, 0, 0, ry);
    p.push({ g: new BoxGeometry(0.1, 0.03, 0.05), m: M.clone().multiply(T(0, 0.015, 0)), c: K.tissue });
    p.push({ g: new BoxGeometry(0.1, 0.012, 0.0008), m: M.clone().multiply(T(0, 0.012, 0.0254)), c: K.tissueBand });
    p.push({ g: new BoxGeometry(0.06, 0.0009, 0.006), m: M.clone().multiply(T(0, 0.0304, 0)), c: K.tissueBand }); // opening strip
    p.push({ g: new SphereGeometry(0.012, 8, 6), m: M.clone().multiply(T(0.01, 0.032, 0, 0, 0, 0, 1.4, 0.5, 0.8)), c: K.paper }); // a tissue peeking out
  };
  pack(0, 0.1, -0.005);
  pack(0.03, -0.15, 0.008);
  return one('Mouchoirs', p, 0.75);
}

function buildSirop(): Group {
  const p: Part[] = [];
  p.push({ g: lathe([[0, 0], [0.027, 0], [0.029, 0.004], [0.029, 0.085], [0.021, 0.1], [0.011, 0.108], [0.011, 0.118], [0, 0.118]], 20), c: K.amber });
  p.push({ g: new CylinderGeometry(0.0295, 0.0295, 0.046, 20, 1, true), m: T(0, 0.05), c: K.label });
  p.push({ g: new CylinderGeometry(0.0297, 0.0297, 0.008, 20, 1, true), m: T(0, 0.066), c: K.lineGreen });
  p.push({ g: new CylinderGeometry(0.0297, 0.0297, 0.003, 20, 1, true), m: T(0, 0.04), c: K.ink });
  p.push({ g: new CylinderGeometry(0.014, 0.014, 0.022, 16), m: T(0, 0.126), c: K.cap }); // dosing cup on the cap
  return one('Sirop', p, 0.3);
}

function buildParacetamol(): Group {
  const p: Part[] = [];
  carton(p, 0.1, 0.06, 0.028, K.boxWhite, [
    [0.1, 0.01, 0, 0.05, K.lineGreen],
    [0.055, 0.006, -0.015, 0.033, K.ink],
    [0.04, 0.004, -0.022, 0.022, K.inkLight],
    [0.016, 0.016, 0.03, 0.026, K.boxBlue],
  ]);
  return one('Paracetamol', p, 0.55);
}

const BUILDERS: Record<PlaceItemShape, () => Group> = {
  plat: buildPlat,
  soupe: buildSoupe,
  salade: buildSalade,
  crepe: buildCrepe,
  jus: buildJus,
  carafe: buildCarafe,
  addition: buildAddition,
  ticket: buildTicket,
  carnet: buildCarnet,
  forfait: buildForfait,
  plan_metro: buildPlanMetro,
  pansements: buildPansements,
  creme: buildCreme,
  mouchoirs: buildMouchoirs,
  sirop: buildSirop,
  paracetamol: buildParacetamol,
};

/** Build one pinchable counter item (base at y = 0). */
export function buildPlaceItem(shape: PlaceItemShape): Group {
  return BUILDERS[shape]();
}

// ---------------------------------------------------------------------------
// Set dressing (behind the counter; hidden in mixed reality with the room)
// ---------------------------------------------------------------------------

/** A flat sign: a canvas-drawn face (plain colour without a DOM), facing +Z. */
function sign(name: string, w: number, h: number, px: number, draw: (ctx: CanvasRenderingContext2D, cw: number, ch: number) => void, fallback: number): Mesh {
  const ct = makeCanvasTexture(px, Math.round((px * h) / w));
  if (ct) draw(ct.ctx, ct.canvas.width, ct.canvas.height);
  const m = new MeshStandardMaterial({ color: ct ? 0xffffff : fallback, map: ct?.tex ?? null, roughness: 0.55 });
  return mesh(name, new PlaneGeometry(w, h), m, false);
}

const SIGN_FONT = 'Arial, Helvetica, sans-serif';

/** A sidewalk chalkboard with today's lunch menu and prices (from shared/places.json). */
function bistrotDressing(): Group {
  const g = new Group();
  g.name = 'Bistrot Dressing';
  const board = buildChalkboard('Le menu');
  board.setLines(PLACES.bistrot.menu.map((m) => `${m.noun}  ${priceToDigits(m.priceCents)}`));
  board.root.position.set(-1.55, 1.2, -2.45); // hung above the counter end, like the café's board
  board.root.rotation.y = 0.3;
  g.add(board.root);
  return g;
}

/** The ticket window: a slim enamel-blue frame over the counter with its sign, and a network poster. */
function metroDressing(): Group {
  const g = new Group();
  g.name = 'Metro Dressing';
  const frame: Part[] = [];
  for (const s of [-1, 1]) frame.push({ g: new BoxGeometry(0.045, 1.14, 0.045), m: T(s * 1.12, 1.55, -1.28), c: 0x1f4e8c });
  frame.push({ g: new BoxGeometry(2.3, 0.08, 0.07), m: T(0, 2.14, -1.28), c: 0x1f4e8c });
  frame.push({ g: new BoxGeometry(2.3, 0.02, 0.08), m: T(0, 2.09, -1.28), c: 0xc9a227 });
  g.add(mesh('Window Frame', merge(frame), vc(0.4, 0.3), false));
  const plate = sign('Guichet Sign', 0.9, 0.2, 512, (c, w, h) => {
    c.fillStyle = '#1f4e8c';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f5f1e6';
    c.lineWidth = 6;
    c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#f5f1e6';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `bold ${Math.round(h * 0.42)}px ${SIGN_FONT}`;
    c.fillText('GUICHET', w / 2, h * 0.42);
    c.font = `${Math.round(h * 0.17)}px ${SIGN_FONT}`;
    c.fillText('Tickets  ·  Plans', w / 2, h * 0.78);
  }, 0x1f4e8c);
  plate.position.set(0, 2.3, -1.25);
  g.add(plate);
  // A made-up network (no real line names) on a poster behind the back counter.
  const poster = sign('Network Poster', 0.7, 0.5, 512, (c, w, h) => {
    c.fillStyle = '#f7f4ea';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1f4e8c';
    c.fillRect(0, 0, w, h * 0.12);
    c.fillStyle = '#ffffff';
    c.font = `bold ${Math.round(h * 0.07)}px ${SIGN_FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('PLAN DU MÉTRO', 14, h * 0.06);
    c.strokeStyle = '#9fc6e0';
    c.lineWidth = 10;
    c.beginPath();
    c.moveTo(0, h * 0.62);
    c.bezierCurveTo(w * 0.3, h * 0.5, w * 0.55, h * 0.8, w, h * 0.6);
    c.stroke();
    const rand = makeRandom(21);
    const colors = ['#2a9d48', '#f2c230', '#d1495b', '#3d6fb6', '#9b5de5', '#f28c28'];
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const col of colors) {
      c.strokeStyle = col;
      c.lineWidth = 6;
      c.beginPath();
      let x = rand() * w * 0.2;
      let y = h * 0.2 + rand() * h * 0.7;
      c.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += w * (0.18 + rand() * 0.1);
        y = Math.min(h * 0.95, Math.max(h * 0.18, y + (rand() - 0.5) * h * 0.4));
        c.lineTo(x, y);
      }
      c.stroke();
    }
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#2b2d33';
    c.lineWidth = 3;
    for (let k = 0; k < 14; k++) {
      c.beginPath();
      c.arc(w * (0.1 + rand() * 0.8), h * (0.22 + rand() * 0.7), 6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }, 0xf7f4ea);
  poster.position.set(-1.0, 1.42, -2.44);
  g.add(poster);
  return g;
}

/** The green cross (lit, as on every French pharmacy) and a shelf of small boxes. */
function pharmacieDressing(): Group {
  const g = new Group();
  g.name = 'Pharmacie Dressing';
  const crossMat = new MeshStandardMaterial({ color: 0x2fbf5a, emissive: 0x22c55e, emissiveIntensity: 0.9, roughness: 0.4 });
  const cross = new Mesh(merge([{ g: new BoxGeometry(0.34, 0.11, 0.04) }, { g: new BoxGeometry(0.11, 0.34, 0.04) }]), crossMat);
  cross.name = 'Green Cross';
  cross.position.set(-1.0, 2.36, -2.36);
  g.add(cross);
  const shelf: Part[] = [];
  const Z = -2.42;
  for (const s of [-1, 1]) shelf.push({ g: new BoxGeometry(0.03, 1.15, 0.24), m: T(s * 1.32, 0.93 + 0.575, Z), c: K.boxWhite });
  const planks = [1.28, 1.62, 1.96];
  for (const y of planks) shelf.push({ g: new BoxGeometry(2.64, 0.02, 0.24), m: T(0, y - 0.01, Z), c: K.boxWhite });
  const colors = [K.boxWhite, K.boxBlue, 0x9fd3c7, 0xf2b5c4, 0xfafafa, 0xbcd3f0, 0xd9ead3, 0xf6e7a1];
  const rand = makeRandom(5);
  for (const y of planks) {
    let x = -1.28;
    while (x < 1.24) {
      const w = 0.04 + rand() * 0.05;
      const h = 0.07 + rand() * 0.11;
      const c = colors[Math.floor(rand() * colors.length)];
      if (x + w > 1.28) break;
      shelf.push({ g: new BoxGeometry(w, h, 0.06), m: T(x + w / 2, y + h / 2, Z + 0.06), c });
      shelf.push({ g: new BoxGeometry(w, 0.008, 0.0008), m: T(x + w / 2, y + h * 0.7, Z + 0.0904), c: rand() < 0.5 ? K.lineGreen : K.boxBlue });
      x += w + 0.004 + rand() * 0.012;
    }
  }
  g.add(mesh('Pharmacy Shelves', merge(shelf), vc(0.65), false));
  return g;
}

/** Shop-specific set dressing, or null when the shop has none. */
export function buildPlaceDressing(place: PlaceId): Group | null {
  if (place === 'bistrot') return bistrotDressing();
  if (place === 'metro') return metroDressing();
  if (place === 'pharmacie') return pharmacieDressing();
  return null;
}
