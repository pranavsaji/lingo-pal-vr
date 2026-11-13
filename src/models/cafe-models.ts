/**
 * Procedural hero props and characters for the Lingo Pal cafe.
 *
 * Every builder is pure: it returns a parentless Object3D hierarchy (no World, no ECS,
 * no scene.add, no timers). Conventions: metres, +Y up, the learner sits at the origin
 * looking toward -Z, so anything that should face the learner faces +Z. Unless stated,
 * every builder's base sits at local y = 0.
 *
 * Performance (Quest 3S @ 72 fps): sub-assemblies are baked into a few vertex-coloured
 * meshes with `merge()`, materials are module-level shared caches, coin/note/confetti
 * geometries are shared, canvas textures are <= 512 px.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import {
  makeCanvasTexture,
  makeRandom,
  merge,
  type Part,
  profileR,
  SHARED_GEOMETRIES,
  SHARED_MATERIALS,
  SHARED_TEXTURES,
  shell,
  sharedGeo,
  sharedMat,
  spanMatrix,
  T,
  TQ,
  lathe,
  vcMat,
} from './model-kit.js';

// ---------------------------------------------------------------------------
// Palette (sRGB hex) — warm Parisian, matched to cafe-builder.ts
// ---------------------------------------------------------------------------

const C = {
  navy: 0x1e2a4f,
  navyDeep: 0x162040,
  cream: 0xf7f0e1,
  creamShade: 0xe9dfca,
  red: 0xc0262f,
  redDeep: 0x931b24,
  skin: 0xf3c8aa,
  skinShade: 0xe6a987,
  blush: 0xee8e8a,
  hair: 0x4b2a1b,
  hairHi: 0x6a3a24,
  eye: 0x2a1812,
  white: 0xffffff,
  lip: 0x8a2a35,
  pearl: 0xf6eedf,
  stocking: 0x2b2733,
  shoe: 0x3b2018,
  pencil: 0xeab52b,
  eraser: 0xf08a9a,
  steel: 0xb8b8b8,
  brass: 0xc9a14a,
  brassDeep: 0x8f6b2a,
  gold: 0xd9b04c,
  silver: 0xcfd2d6,
  wood: 0x7a4a2a,
  woodDark: 0x4e2c18,
  terracotta: 0xc4683f,
  terracottaDeep: 0xa1502e,
  soil: 0x3b281c,
  leaf: 0x3f7a3a,
  leafLight: 0x5d9a48,
  leafDeep: 0x2d5e2c,
  wax: 0xf5ead2,
  chalkboard: 0x23302a,
} as const;

const Z_AXIS = new Vector3(0, 0, 1);
const TAU = Math.PI * 2;

function mk(name: string, geo: BufferGeometry, mat: Material | Material[], shadow = true): Mesh {
  const m = new Mesh(geo, mat);
  m.name = name;
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

function grp(name: string, x = 0, y = 0, z = 0): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

/** Unit sphere template; scale it into ellipsoids inside merge() parts. */
function unitSphere(w = 16, h = 12): SphereGeometry {
  return new SphereGeometry(1, w, h);
}

/** Point on an elliptical lathe body (profile radius scaled by sx/sz) at (x, y), pushed `off` outward along +Z. */
function bodyFrontZ(profile: Array<[number, number]>, sx: number, sz: number, x: number, y: number, off = 0): number {
  const r = profileR(profile, y);
  const a = r * sx;
  const k = Math.max(0, 1 - (x / a) ** 2);
  return r * sz * Math.sqrt(k) + off;
}

// ===========================================================================
// 1. Madame Lune
// ===========================================================================

export interface LuneRig {
  root: Group;
  head: Group;
  mouth: Mesh;
  leftArm: Group;
  rightArm: Group;
  leftForearm: Group;
  rightForearm: Group;
  eyes: Mesh[];
}

/** Torso profile [radius, y], bottom -> top; scaled by TORSO_SX / TORSO_SZ into an ellipse. */
const TORSO: Array<[number, number]> = [
  [0.112, 0.94], [0.118, 0.98], [0.138, 1.07], [0.152, 1.15], [0.149, 1.21],
  [0.137, 1.255], [0.112, 1.295], [0.065, 1.33], [0.036, 1.345], [0, 1.35],
];
const TORSO_SX = 1.18;
const TORSO_SZ = 0.72;
/** Outer skirt silhouette (A-line midi), bottom -> top. */
const SKIRT_SIDE: Array<[number, number]> = [
  [0.205, 0.3], [0.2, 0.36], [0.176, 0.55], [0.142, 0.8], [0.123, 0.9], [0.112, 0.95],
];
const SKIRT_SX = 1.18;
const SKIRT_SZ = 0.8;
const SHOULDER_X = 0.172;
const SHOULDER_Y = 1.265;
const NECK_Y = 1.385;

function luneMats() {
  return {
    cloth: vcMat('lune-cloth', { roughness: 0.88 }),
    skin: vcMat('lune-skin', { roughness: 0.58 }),
    hair: vcMat('lune-hair', { roughness: 0.45, side: DoubleSide }),
    eye: vcMat('lune-eye', { roughness: 0.15 }),
    mouth: sharedMat('lune-mouth', () => new MeshStandardMaterial({ color: C.lip, roughness: 0.45 })),
  };
}

function buildLuneBody(sph: SphereGeometry): BufferGeometry {
  const parts: Part[] = [];
  // Legs + shoes (mostly hidden by the counter, but present for side views).
  for (const s of [-1, 1]) {
    parts.push({ g: new CylinderGeometry(0.036, 0.03, 0.3, 8), m: T(s * 0.062, 0.2, 0), c: C.stocking });
    parts.push({ g: sph, m: T(s * 0.064, 0.028, 0.022, 0, 0, 0, 0.038, 0.028, 0.068), c: C.shoe });
  }
  // Skirt (closed lathe) and fitted bodice.
  parts.push({ g: lathe([[0, 0.3], ...SKIRT_SIDE, [0, 0.955]], 20), m: T(0, 0, 0, 0, 0, 0, SKIRT_SX, 1, SKIRT_SZ), c: C.navy });
  parts.push({ g: lathe(TORSO, 20), m: T(0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ), c: C.navy });
  // Neck.
  parts.push({ g: new CylinderGeometry(0.038, 0.041, 0.12, 12), m: T(0, 1.375, 0.004), c: C.skin });

  // Apron skirt panel: a thin shell that follows the skirt around the front.
  const apronYs = [0.44, 0.55, 0.68, 0.8, 0.9, 0.948];
  const apronSkirt = apronYs.map((y) => [profileR(SKIRT_SIDE, y) + 0.004, y] as [number, number]);
  parts.push({ g: shell(apronSkirt, 0.005, 14, -1.05, 2.1), m: T(0, 0, 0, 0, 0, 0, SKIRT_SX, 1, SKIRT_SZ), c: C.cream });
  // Apron bib on the chest.
  const bibYs = [0.95, 1.0, 1.06, 1.12, 1.172];
  const bib = bibYs.map((y) => [profileR(TORSO, y) + 0.003, y] as [number, number]);
  parts.push({ g: shell(bib, 0.005, 10, -0.6, 1.2), m: T(0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ), c: C.cream });
  // Bib chest pocket (her left, +X) with a red top trim.
  const pocket = [1.0, 1.035, 1.062].map((y) => [profileR(TORSO, y) + 0.008, y] as [number, number]);
  parts.push({ g: shell(pocket, 0.004, 4, 0.14, 0.36), m: T(0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ), c: C.creamShade });
  const trim = [1.058, 1.068].map((y) => [profileR(TORSO, y) + 0.009, y] as [number, number]);
  parts.push({ g: shell(trim, 0.004, 4, 0.13, 0.38), m: T(0, 0, 0, 0, 0, 0, TORSO_SX, 1, TORSO_SZ), c: C.red });
  // Pencil tucked in the pocket (eraser up).
  {
    const px = 0.062;
    const pz = bodyFrontZ(TORSO, TORSO_SX, TORSO_SZ, px, 1.05, 0.004);
    const tilt = -0.16;
    const base = T(px, 1.05, pz, -0.08, 0, tilt);
    parts.push({ g: new CylinderGeometry(0.0038, 0.0038, 0.07, 6), m: base.clone().multiply(T(0, 0.02, 0)), c: C.pencil });
    parts.push({ g: new CylinderGeometry(0.0041, 0.0041, 0.006, 6), m: base.clone().multiply(T(0, 0.058, 0)), c: C.steel });
    parts.push({ g: new CylinderGeometry(0.0038, 0.0038, 0.008, 6), m: base.clone().multiply(T(0, 0.065, 0)), c: C.eraser });
  }
  // Little embroidered heart on the bib.
  {
    const hy = 1.125;
    const hz = bodyFrontZ(TORSO, TORSO_SX, TORSO_SZ, -0.03, hy, 0.0085);
    const heart = T(-0.03, hy, hz, 0, -0.2, 0, 1, 1, 0.35);
    parts.push({ g: new BoxGeometry(0.0115, 0.0115, 0.012), m: heart.clone().multiply(T(0, -0.003, 0, 0, 0, Math.PI / 4)), c: C.red });
    parts.push({ g: sph, m: heart.clone().multiply(T(-0.0042, 0.0012, 0, 0, 0, 0, 0.0059)), c: C.red });
    parts.push({ g: sph, m: heart.clone().multiply(T(0.0042, 0.0012, 0, 0, 0, 0, 0.0059)), c: C.red });
  }
  // Apron straps: bib corners -> over the chest -> shoulder tops.
  for (const s of [-1, 1]) {
    const yA = 1.172;
    const rA = profileR(TORSO, yA) + 0.006;
    const a = new Vector3(s * Math.sin(0.55) * rA * TORSO_SX, yA, Math.cos(0.55) * rA * TORSO_SZ);
    const bx = s * 0.088;
    const b = new Vector3(bx, 1.255, bodyFrontZ(TORSO, TORSO_SX, TORSO_SZ, bx, 1.255, 0.005));
    const c = new Vector3(s * 0.078, 1.322, -0.005);
    for (const [p, q] of [[a, b], [b, c]] as const) {
      const { m, len } = spanMatrix(p, q);
      parts.push({ g: new BoxGeometry(0.02, len + 0.008, 0.004), m, c: C.cream });
    }
  }
  // Waist tie band + bow at the back.
  parts.push({ g: new TorusGeometry(0.118, 0.008, 6, 28), m: T(0, 0.952, 0, Math.PI / 2, 0, 0, TORSO_SX, 0.79, 1), c: C.cream });
  for (const s of [-1, 1]) {
    parts.push({ g: new TorusGeometry(0.02, 0.0065, 6, 12), m: T(s * 0.024, 0.958, -0.097, 0, s * 0.35, s * 0.2, 1, 0.75, 1), c: C.cream });
    parts.push({ g: sph, m: T(s * 0.018, 0.905, -0.099, 0, 0, s * 0.2, 0.011, 0.04, 0.004), c: C.cream });
  }
  parts.push({ g: sph, m: T(0, 0.952, -0.1, 0, 0, 0, 0.011), c: C.creamShade });
  // Red neckerchief (foulard) with a knot and two tails at her left.
  parts.push({ g: new TorusGeometry(0.05, 0.0145, 8, 20), m: T(0, 1.343, 0.002, Math.PI / 2, 0, 0, 1, 0.86, 1), c: C.red });
  parts.push({ g: sph, m: T(0.028, 1.33, 0.046, 0, 0, 0, 0.017, 0.015, 0.014), c: C.redDeep });
  parts.push({ g: sph, m: T(0.024, 1.296, 0.058, -0.25, 0, 0.28, 0.013, 0.034, 0.0055), c: C.red });
  parts.push({ g: sph, m: T(0.043, 1.302, 0.05, -0.3, 0.3, -0.35, 0.012, 0.03, 0.0055), c: C.red });
  return merge(parts);
}

// Face ellipsoid semi-axes, centred HEAD_CY above the neck pivot.
const FA = 0.1;
const FB = 0.113;
const FC = 0.098;
const HEAD_CY = 0.112;

/** Frame on the face surface at (x, y) relative to the head centre; +Z of the frame = surface normal. */
function faceFrame(x: number, y: number, lift = 0): { p: Vector3; q: Quaternion; m: Matrix4 } {
  const k = Math.max(0, 1 - (x / FA) ** 2 - (y / FB) ** 2);
  const z = FC * Math.sqrt(k);
  const n = new Vector3(x / (FA * FA), y / (FB * FB), z / (FC * FC)).normalize();
  const p = new Vector3(x, y + HEAD_CY, z).addScaledVector(n, lift);
  const q = new Quaternion().setFromUnitVectors(Z_AXIS, n);
  return { p, q, m: TQ(p, q) };
}

function buildLuneEye(s: number, sph: SphereGeometry): BufferGeometry {
  const parts: Part[] = [
    { g: sph, m: T(0, 0, 0, 0, 0, 0, 0.0125, 0.0165, 0.0065), c: C.eye },
    { g: sph, m: T(0.0045, 0.0065, 0.0052, 0, 0, 0, 0.0036), c: C.white },
    { g: sph, m: T(-0.0042, -0.0058, 0.0056, 0, 0, 0, 0.0017), c: C.white },
    // Upper lash line arc + a little flick at the outer corner.
    { g: new TorusGeometry(0.0148, 0.0021, 4, 10, Math.PI * 0.78), m: T(0, 0.0015, 0.002, 0, 0, Math.PI * 0.11), c: C.eye },
    { g: new CapsuleGeometry(0.0019, 0.007, 2, 4), m: T(s * 0.0148, 0.0068, 0.002, 0, 0, -s * 0.95), c: C.eye },
  ];
  return merge(parts);
}

function buildLuneHead(head: Group, mats: ReturnType<typeof luneMats>, sph: SphereGeometry): { eyes: Mesh[]; mouth: Mesh } {
  // --- Skin: face, ears, nose, cheeks, pearl earrings ---
  const skin: Part[] = [{ g: new SphereGeometry(1, 24, 18), m: T(0, HEAD_CY, 0, 0, 0, 0, FA, FB, FC), c: C.skin }];
  const nose = faceFrame(0, -0.028, 0.004);
  skin.push({ g: sph, m: nose.m.clone().multiply(T(0, 0, 0, 0, 0, 0, 0.0115, 0.0105, 0.01)), c: C.skinShade });
  for (const s of [-1, 1]) {
    const cheek = faceFrame(s * 0.057, -0.042, 0.0004);
    skin.push({ g: sph, m: cheek.m.clone().multiply(T(0, 0, 0, 0, 0, 0, 0.019, 0.012, 0.004)), c: C.blush });
    skin.push({ g: sph, m: T(s * 0.097, HEAD_CY - 0.012, -0.004, 0, s * 0.35, 0, 0.011, 0.019, 0.009), c: C.skinShade });
    skin.push({ g: sph, m: T(s * 0.1, HEAD_CY - 0.041, -0.002, 0, 0, 0, 0.0072), c: C.pearl });
    skin.push({ g: new CylinderGeometry(0.0012, 0.0012, 0.01, 4), m: T(s * 0.1, HEAD_CY - 0.031, -0.002), c: C.gold });
  }
  head.add(mk('Face', merge(skin), mats.skin));

  // --- Hair: swept-back cap, side-swept fringe, chignon, brows ---
  const hair: Part[] = [
    { g: new SphereGeometry(1, 22, 12, 0, TAU, 0, 1.55), m: T(0, HEAD_CY + 0.006, -0.01, -0.56, 0, 0, 0.114, 0.122, 0.112), c: C.hair },
    { g: sph, m: T(0, HEAD_CY + 0.03, -0.114, 0, 0, 0, 0.047, 0.043, 0.04), c: C.hair },
    { g: new TorusGeometry(0.033, 0.012, 6, 14), m: T(0, HEAD_CY + 0.03, -0.103, 0, 0, 0.4), c: C.hairHi },
  ];
  const fringeA = faceFrame(-0.026, 0.07, 0.008);
  hair.push({ g: sph, m: fringeA.m.clone().multiply(T(0, 0, 0, 0, 0, 0.5, 0.068, 0.026, 0.03)), c: C.hairHi });
  const fringeB = faceFrame(0.036, 0.078, 0.008);
  hair.push({ g: sph, m: fringeB.m.clone().multiply(T(0, 0, 0, 0, 0, -0.38, 0.05, 0.02, 0.026)), c: C.hair });
  const fringeC = faceFrame(0.004, 0.088, 0.008);
  hair.push({ g: sph, m: fringeC.m.clone().multiply(T(0, 0, 0, 0, 0, 0.1, 0.05, 0.02, 0.026)), c: C.hair });
  for (const s of [-1, 1]) {
    // Brows: a soft arch whose top sits on the brow line.
    const brow = faceFrame(s * 0.039, 0.034, 0.0025);
    hair.push({
      g: new TorusGeometry(0.026, 0.0029, 4, 8, 0.9),
      m: brow.m.clone().multiply(T(0, 0, 0, 0, 0, -s * 0.1)).multiply(T(0, -0.026, 0, 0, 0, Math.PI / 2 - 0.45)),
      c: C.hair,
    });
  }
  head.add(mk('Hair', merge(hair), mats.hair));

  // --- Beret (felt), jauntily tilted, with its little stalk ---
  const beretM = T(0.012, HEAD_CY + 0.104, -0.006, -0.16, 0, -0.14);
  const beret: Part[] = [
    { g: new SphereGeometry(1, 22, 10), m: beretM.clone().multiply(T(0, 0, 0, 0, 0, 0, 0.123, 0.04, 0.123)), c: C.red },
    { g: new TorusGeometry(0.079, 0.0088, 6, 24), m: beretM.clone().multiply(T(0, -0.022, 0, Math.PI / 2, 0, 0)), c: C.redDeep },
    { g: new CylinderGeometry(0.0032, 0.0042, 0.018, 6), m: beretM.clone().multiply(T(0, 0.045, 0)), c: C.redDeep },
  ];
  head.add(mk('Beret', merge(beret), mats.cloth));

  // --- Eyes (blink = scale.y) and mouth (talk = scale.y 0.2..1.6) ---
  const eyes: Mesh[] = [];
  for (const s of [1, -1]) {
    const f = faceFrame(s * 0.037, -0.008, 0.0015);
    const eye = mk(s > 0 ? 'Eye_L' : 'Eye_R', buildLuneEye(s, sph), mats.eye, false);
    eye.position.copy(f.p);
    eye.quaternion.copy(f.q);
    head.add(eye);
    eyes.push(eye);
  }
  const mf = faceFrame(0, -0.062, 0.0012);
  const mouthGeo = new SphereGeometry(1, 16, 10);
  mouthGeo.scale(0.018, 0.0068, 0.005);
  const mouth = mk('Mouth', mouthGeo, mats.mouth, false);
  mouth.position.copy(mf.p);
  mouth.quaternion.copy(mf.q);
  head.add(mouth);
  return { eyes, mouth };
}

function buildLuneArm(s: number, mats: ReturnType<typeof luneMats>, sph: SphereGeometry): { arm: Group; forearm: Group } {
  const side = s > 0 ? 'L' : 'R';
  const arm = grp(`Arm_${side}`, s * SHOULDER_X, SHOULDER_Y, 0);
  const upper: Part[] = [
    { g: sph, m: T(-s * 0.006, -0.022, 0, 0, 0, 0, 0.05, 0.05, 0.049), c: C.navy }, // puff sleeve
    { g: new CylinderGeometry(0.042, 0.036, 0.25, 12), m: T(0, -0.125, 0), c: C.navy },
    { g: sph, m: T(0, -0.25, 0, 0, 0, 0, 0.036), c: C.navy },
  ];
  arm.add(mk(`UpperArm_${side}`, merge(upper), mats.cloth));

  const forearm = grp(`Forearm_${side}`, 0, -0.25, 0);
  const lower: Part[] = [
    { g: new CylinderGeometry(0.036, 0.034, 0.07, 12), m: T(0, -0.035, 0), c: C.navy },
    { g: new TorusGeometry(0.034, 0.0068, 6, 16), m: T(0, -0.07, 0, Math.PI / 2, 0, 0), c: C.cream },
    { g: new CylinderGeometry(0.027, 0.021, 0.15, 10), m: T(0, -0.145, 0), c: C.skin },
    // Mitten-style stylised hand, palm facing the body (inward, -s*X).
    { g: sph, m: T(0, -0.252, 0.004, 0, 0, 0, 0.0135, 0.04, 0.03), c: C.skin },
    { g: sph, m: T(-s * 0.001, -0.296, 0.007, 0.14, 0, 0, 0.0115, 0.033, 0.026), c: C.skin },
    { g: new CapsuleGeometry(0.0085, 0.026, 3, 8), m: T(-s * 0.004, -0.248, 0.032, 0.55, 0, 0), c: C.skinShade },
  ];
  forearm.add(mk(`ForearmMesh_${side}`, merge(lower), mats.skin));
  arm.add(forearm);
  return { arm, forearm };
}

/**
 * Madame Lune, the cafe owner (~1.62 m to the crown, beret to ~1.65 m), facing +Z.
 * Rig: head pivots at the neck; arms pivot at the shoulders and hang along -Y at rest
 * (rotation.x < 0 swings forward toward +Z); forearms pivot at the elbows. Her own
 * left arm is at +X. Mouth rest scale (1,1,1); animate scale.y in [0.2, 1.6].
 */
export function buildMadameLune(): LuneRig {
  const mats = luneMats();
  const sph = unitSphere();
  const root = grp('MadameLune');
  root.add(mk('Body', buildLuneBody(sph), mats.cloth));

  const head = grp('Head', 0, NECK_Y, 0.005);
  const { eyes, mouth } = buildLuneHead(head, mats, sph);
  root.add(head);

  const L = buildLuneArm(1, mats, sph);
  const R = buildLuneArm(-1, mats, sph);
  root.add(L.arm, R.arm);
  sph.dispose();
  return {
    root,
    head,
    mouth,
    leftArm: L.arm,
    rightArm: R.arm,
    leftForearm: L.forearm,
    rightForearm: R.forearm,
    eyes,
  };
}

// ===========================================================================
// 2. Euro money
// ===========================================================================

/** All denominations in cents, largest first. */
export const COIN_VALUES = [1000, 500, 200, 100, 50, 20, 10] as const;

/**
 * High-contrast money (Accessibility Forward). When on, new coins and the cash
 * register use a black-on-white face with a large numeral, so every value reads
 * without relying on gold/silver colour. CoinSystem flips it from the settings.
 */
export const moneyStyle = { highContrast: false };

/** Coins are scaled up 2x (relative sizes kept) so they are graspable in VR. */
const COIN_SCALE = 2;

interface CoinSpec { r: number; t: number; outer: number; inner: number | null; innerRatio: number; label: string; sub: string }
const COINS: Record<number, CoinSpec> = {
  200: { r: 0.01287, t: 0.0022, outer: C.silver, inner: C.gold, innerRatio: 0.728, label: '2', sub: 'EURO' },
  100: { r: 0.01163, t: 0.00233, outer: C.gold, inner: C.silver, innerRatio: 0.7, label: '1', sub: 'EURO' },
  50: { r: 0.01213, t: 0.00238, outer: C.gold, inner: null, innerRatio: 0, label: '50', sub: 'CENT' },
  20: { r: 0.01113, t: 0.00214, outer: C.gold, inner: null, innerRatio: 0, label: '20', sub: 'CENT' },
  10: { r: 0.00988, t: 0.00193, outer: C.gold, inner: null, innerRatio: 0, label: '10', sub: 'CENT' },
};

const NOTE_W = 0.12;
const NOTE_D = 0.065;
const NOTE_T = 0.0012;

function coinGeometry(cents: number, spec: CoinSpec): BufferGeometry {
  return sharedGeo(`coin:${cents}`, () => {
    const R = spec.r * COIN_SCALE;
    const t = spec.t * COIN_SCALE;
    const field = t * 0.84;
    const Ri = spec.inner !== null ? R * spec.innerRatio : 0;
    const ring: Array<[number, number]> = [
      [Ri, 0], [R * 0.97, 0], [R, t * 0.14], [R, t * 0.86], [R * 0.97, t], [R * 0.875, t], [R * 0.85, field], [Ri, field],
    ];
    const parts: Part[] = [{ g: lathe(ring, 28), c: spec.outer }];
    if (spec.inner !== null) parts.push({ g: lathe([[0, 0], [Ri, 0], [Ri, field], [0, field]], 28), c: spec.inner });
    const g = merge(parts);
    // Planar top-down UVs so the shared face texture reads upright from +Z.
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, 0.5 - pos.getZ(i) / (2 * R));
    return g;
  });
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** Greyscale "engraving" multiplied over the coin's vertex colours. */
function coinTexture(cents: number, spec: CoinSpec): Texture | null {
  const ct = makeCanvasTexture(128, 128);
  if (!ct) return null;
  const { ctx, tex } = ct;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#b9b4ab';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    drawStar(ctx, 64 + Math.cos(a) * 47, 64 + Math.sin(a) * 47, 3.6);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = spec.label.length > 1 ? 44 : 60;
  ctx.font = `bold ${big}px Georgia, 'Times New Roman', serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(spec.label, 62, 56);
  ctx.fillStyle = '#7b7468';
  ctx.fillText(spec.label, 64, 58);
  ctx.font = 'bold 13px Arial, Helvetica, sans-serif';
  ctx.fillText(spec.sub, 64, 92);
  tex.name = `coin-face:${cents}`;
  SHARED_TEXTURES.add(tex);
  return tex;
}

/** High-contrast face: white disc, thick black rim ring, large black numeral and unit. */
function coinTextureHC(cents: number, spec: CoinSpec): Texture | null {
  const ct = makeCanvasTexture(128, 128);
  if (!ct) return null;
  const { ctx, tex } = ct;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 64, 57, 0, TAU);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.font = `bold ${spec.label.length > 1 ? 54 : 72}px Arial, Helvetica, sans-serif`;
  ctx.fillText(spec.label, 64, 56);
  ctx.font = 'bold 17px Arial, Helvetica, sans-serif';
  ctx.fillText(spec.sub === 'EURO' ? '€' : 'CENT', 64, 98);
  tex.name = `coin-face-hc:${cents}`;
  SHARED_TEXTURES.add(tex);
  return tex;
}

function coinMaterialHC(cents: number, spec: CoinSpec): Material {
  return sharedMat(`coin-hc:${cents}`, () => new MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.7, map: coinTextureHC(cents, spec) }));
}

/** Restyle an existing coin (from buildMoney) for the current contrast setting. Notes keep their printed value. */
export function styleMoney(root: Object3D, cents: number, highContrast: boolean): void {
  if (cents >= 500) return;
  const key = COINS[cents] ? cents : 10;
  const spec = COINS[key];
  const mat = highContrast ? coinMaterialHC(key, spec) : coinMaterial(key, spec);
  root.traverse((o) => {
    if (o instanceof Mesh) o.material = mat;
  });
}

function coinMaterial(cents: number, spec: CoinSpec): Material {
  return sharedMat(`coin:${cents}`, () => new MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.32, map: coinTexture(cents, spec),
  }));
}

/** Banknote face: base tint, EU flag, arch motif, hologram stripe, big value. */
function noteTexture(cents: number): Texture | null {
  const ct = makeCanvasTexture(256, 140);
  if (!ct) return null;
  const { ctx, tex } = ct;
  const ten = cents === 1000;
  const base = ten ? '#d8776c' : '#a9b7a2';
  const deep = ten ? '#9c3a33' : '#5d6e5c';
  const light = ten ? '#f2c2b4' : '#dbe3d3';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 140);
  ctx.fillStyle = light;
  ctx.fillRect(8, 8, 62, 124);
  ctx.strokeStyle = deep;
  ctx.lineWidth = 2;
  ctx.strokeRect(5, 5, 246, 130);
  // Arches (gateway motif of the euro series).
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const x = 100 + i * 34;
    ctx.beginPath();
    ctx.moveTo(x - 14, 118);
    ctx.lineTo(x - 14, 70);
    ctx.arc(x, 70, 14, Math.PI, 0);
    ctx.lineTo(x + 14, 118);
    ctx.stroke();
  }
  // Hologram stripe.
  const g = ctx.createLinearGradient(196, 0, 214, 0);
  g.addColorStop(0, '#d9dde6');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(1, '#b9c2cf');
  ctx.fillStyle = g;
  ctx.fillRect(196, 0, 18, 140);
  // EU flag.
  ctx.fillStyle = '#1d3f94';
  ctx.fillRect(16, 14, 40, 28);
  ctx.fillStyle = '#ffd23a';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    drawStar(ctx, 36 + Math.cos(a) * 9.5, 28 + Math.sin(a) * 9.5, 2.2);
  }
  const label = ten ? '10' : '5';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = 'bold 50px Arial, Helvetica, sans-serif';
  ctx.fillStyle = deep;
  ctx.fillText(label, 38, 92);
  ctx.textAlign = 'right';
  ctx.font = 'bold 34px Arial, Helvetica, sans-serif';
  ctx.fillText(label, 244, 112);
  ctx.font = 'bold 16px Arial, Helvetica, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText('EURO', 90, 24);
  tex.name = `note-face:${cents}`;
  SHARED_TEXTURES.add(tex);
  return tex;
}

function noteMaterial(cents: number): Material {
  return sharedMat(`note:${cents}`, () => {
    const map = noteTexture(cents);
    return new MeshStandardMaterial({ color: map ? 0xffffff : cents === 1000 ? 0xd8776c : 0xa9b7a2, map, roughness: 0.85 });
  });
}

/**
 * Euro money lying flat (face up +Y, base at y = 0). 1000/500 = 10 EUR / 5 EUR notes
 * (0.12 x 0.065 m); 200..10 = coins at 2x real size. `userData.cents` holds the value.
 * Geometries, materials and textures are shared per denomination.
 */
export function buildMoney(cents: number): Group {
  const root = grp(`Money_${cents}`);
  root.userData.cents = cents;
  if (cents >= 500) {
    const denom = cents >= 1000 ? 1000 : 500;
    const geo = sharedGeo(`note:${denom}`, () => new BoxGeometry(NOTE_W, NOTE_T, NOTE_D));
    const note = mk(denom === 1000 ? 'Note_10EUR' : 'Note_5EUR', geo, noteMaterial(denom), false);
    note.position.y = NOTE_T / 2;
    root.add(note);
    return root;
  }
  const key = COINS[cents] ? cents : 10;
  const spec = COINS[key];
  const coin = mk(`Coin_${key}c`, coinGeometry(key, spec), moneyStyle.highContrast ? coinMaterialHC(key, spec) : coinMaterial(key, spec), false);
  root.add(coin);
  return root;
}

// ===========================================================================
// 3. Payment tray + money dish
// ===========================================================================

const brassMat = () => vcMat('brass', { metalness: 0.6, roughness: 0.33 });
const woodMat = () => vcMat('wood', { roughness: 0.62 });
const ceramicMat = () => vcMat('ceramic', { roughness: 0.22 });
const matteMat = () => vcMat('matte', { roughness: 0.8 });

/** "Le plateau": round walnut tray with a brass rim, ~0.24 m across, base at y = 0. */
export function buildTray(): Group {
  const root = grp('Tray');
  const rim: Part[] = [
    { g: lathe([[0.1, 0.003], [0.112, 0.003], [0.119, 0.007], [0.121, 0.02], [0.1185, 0.0228], [0.1155, 0.0205], [0.1125, 0.0125], [0.1, 0.0125]], 32), c: C.brass },
    { g: lathe([[0, 0], [0.112, 0], [0.112, 0.003], [0, 0.003]], 24), c: C.brassDeep },
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    rim.push({ g: new SphereGeometry(0.0045, 8, 6), m: T(Math.cos(a) * 0.09, 0.0045, Math.sin(a) * 0.09), c: C.brassDeep });
  }
  root.add(mk('TrayRim', merge(rim), brassMat()));
  const wood: Part[] = [
    { g: new CylinderGeometry(0.1125, 0.1125, 0.009, 32), m: T(0, 0.0075, 0), c: C.wood },
    // Darker inlay ring on the surface (listed inward so it faces up).
    { g: lathe([[0.094, 0.01205], [0.088, 0.01205]], 32), c: C.woodDark },
    { g: lathe([[0.03, 0.01205], [0.027, 0.01205]], 24), c: C.woodDark },
  ];
  root.add(mk('TrayWood', merge(wood), woodMat()));
  return root;
}

/** Small glazed ceramic dish (~0.2 m) where the learner's coins rest; base at y = 0. */
export function buildMoneyDish(): Group {
  const root = grp('MoneyDish');
  const parts: Part[] = [
    {
      g: lathe([
        [0, 0.003], [0.058, 0.003], [0.06, 0], [0.067, 0], [0.07, 0.006], [0.088, 0.015], [0.098, 0.022],
        [0.1005, 0.026], [0.0975, 0.0275], [0.094, 0.0225], [0.084, 0.017], [0.066, 0.0105], [0, 0.0095],
      ], 36),
      c: C.cream,
    },
    { g: new TorusGeometry(0.0992, 0.0022, 6, 40), m: T(0, 0.0262, 0, Math.PI / 2, 0, 0), c: C.navy },
    { g: lathe([[0.058, 0.0113], [0.0535, 0.0113]], 36), c: C.navy },
    { g: lathe([[0.0505, 0.0112], [0.0492, 0.0112]], 36), c: C.red },
  ];
  root.add(mk('Dish', merge(parts), ceramicMat(), false));
  return root;
}

// ===========================================================================
// 4. Vintage cash register with a canvas display
// ===========================================================================

function drawRegister(ctx: CanvasRenderingContext2D, text: string): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (moneyStyle.highContrast) {
    // High contrast: plain white digits on black, larger, no glow or scanlines.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    let s = 76;
    ctx.font = `bold ${s}px Arial, Helvetica, sans-serif`;
    while (ctx.measureText(text).width > w - 16 && s > 20) {
      s -= 4;
      ctx.font = `bold ${s}px Arial, Helvetica, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, h / 2 + 2);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a140e');
  g.addColorStop(1, '#16251b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  let size = 64;
  ctx.font = `bold ${size}px 'Courier New', Courier, monospace`;
  while (ctx.measureText(text).width > w - 24 && size > 18) {
    size -= 4;
    ctx.font = `bold ${size}px 'Courier New', Courier, monospace`;
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff9a2e';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffc36b';
  ctx.fillText(text, w - 12, h / 2 + 2);
  ctx.shadowBlur = 0;
  // Faint scanlines for a vintage VFD feel.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

/**
 * Vintage brass cash register (~0.26 m wide, base at y = 0) facing +Z.
 * `setText` redraws the amber display (e.g. "3,40 €").
 */
export function buildRegisterDisplay(): { root: Group; setText(text: string): void } {
  const root = grp('CashRegister');
  const body: Part[] = [
    { g: new BoxGeometry(0.27, 0.012, 0.23), m: T(0, 0.006, 0), c: C.brassDeep }, // plinth
    { g: new BoxGeometry(0.25, 0.064, 0.21), m: T(0, 0.044, 0), c: C.brass }, // cash drawer cabinet
    { g: new BoxGeometry(0.21, 0.04, 0.004), m: T(0, 0.044, 0.106), c: C.brassDeep }, // drawer face panel
    { g: new BoxGeometry(0.256, 0.008, 0.216), m: T(0, 0.078, 0), c: C.brassDeep }, // cornice
    { g: new BoxGeometry(0.2, 0.13, 0.095), m: T(0, 0.147, -0.055), c: C.brass }, // upper housing
    { g: new BoxGeometry(0.206, 0.008, 0.1), m: T(0, 0.214, -0.055), c: C.brassDeep }, // housing cap
    { g: new BoxGeometry(0.182, 0.074, 0.006), m: T(0, 0.17, -0.006), c: C.brassDeep }, // display bezel
    // Arched crest plaque on top with a cream inset and a red jewel.
    { g: new CylinderGeometry(0.072, 0.072, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), m: T(0, 0.218, -0.04, -Math.PI / 2, 0, 0), c: C.brass },
    // Side crank (+X).
    { g: new CylinderGeometry(0.018, 0.018, 0.01, 16), m: T(0.13, 0.05, 0.0, 0, 0, Math.PI / 2), c: C.brassDeep },
    { g: new BoxGeometry(0.008, 0.07, 0.012), m: T(0.138, 0.078, 0.0), c: C.brass },
    { g: new CylinderGeometry(0.007, 0.007, 0.03, 8), m: T(0.152, 0.108, 0.0, 0, 0, Math.PI / 2), c: C.woodDark },
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    body.push({ g: new SphereGeometry(0.009, 8, 6), m: T(sx * 0.12, 0.009, sz * 0.1), c: C.brassDeep });
  }
  // Slanted keyboard deck in front of the housing (top face tilts toward the learner).
  const deck = T(0, 0.098, 0.05, 0.42, 0, 0);
  body.push({ g: new BoxGeometry(0.236, 0.034, 0.11), m: deck, c: C.brassDeep });
  root.add(mk('RegisterBody', merge(body), brassMat()));

  const keys: Part[] = [
    { g: new SphereGeometry(0.008, 10, 8), m: T(0, 0.044, 0.112), c: C.cream }, // drawer knob
    { g: new CylinderGeometry(0.056, 0.056, 0.014, 20, 1, false, -Math.PI / 2, Math.PI), m: T(0, 0.218, -0.04, -Math.PI / 2, 0, 0), c: C.cream },
    { g: new SphereGeometry(0.009, 10, 8), m: T(0, 0.252, -0.031), c: C.red },
  ];
  const keyCols = [C.cream, C.cream, C.cream, C.cream, C.cream, C.red];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const x = -0.09 + col * 0.036;
      const z = -0.034 + row * 0.034;
      const tint = row === 2 && col === 5 ? 0x3c8a4f : keyCols[col];
      keys.push({ g: new CylinderGeometry(0.0022, 0.0022, 0.012, 5), m: deck.clone().multiply(T(x, 0.021, z)), c: C.steel });
      keys.push({ g: new CylinderGeometry(0.0105, 0.0105, 0.006, 12), m: deck.clone().multiply(T(x, 0.029, z)), c: tint });
    }
  }
  root.add(mk('RegisterKeys', merge(keys), matteMat(), false));

  const ct = makeCanvasTexture(256, 96);
  const dispMat = new MeshBasicMaterial({ color: ct ? 0xffffff : 0x1a2a1e, map: ct?.tex ?? null, toneMapped: false });
  const display = mk('RegisterDisplay', new PlaneGeometry(0.168, 0.063), dispMat, false);
  display.position.set(0, 0.17, -0.0025);
  root.add(display);

  const setText = (text: string): void => {
    root.userData.text = text;
    if (!ct) return;
    drawRegister(ct.ctx, text);
    ct.tex.needsUpdate = true;
  };
  setText('0,00 €');
  return { root, setText };
}

// ===========================================================================
// 5. Streak flame (candle in a jar)
// ===========================================================================

const FLAME_PROFILE: Array<[number, number]> = [
  [0, 0], [0.0065, 0.004], [0.0098, 0.012], [0.0092, 0.021], [0.0062, 0.032], [0.0028, 0.042], [0, 0.052],
];

/**
 * Candle in a little glass jar (~0.12 m tall at full flame), base at y = 0.
 * setLevel(days): 0 = unlit (flame hidden); 1 = small; grows to max at 7+;
 * an inner white-hot flame appears from day 3 and a soft glow halo from day 5.
 */
export function buildStreakFlame(): { root: Group; setLevel(days: number): void } {
  const root = grp('StreakFlame');
  const candle: Part[] = [
    { g: new CylinderGeometry(0.0315, 0.0315, 0.05, 20), m: T(0, 0.03, 0), c: C.wax },
    { g: lathe([[0.026, 0.0553], [0.0, 0.0553]], 20), c: C.creamShade }, // melt pool
    { g: new CylinderGeometry(0.0012, 0.0012, 0.012, 5), m: T(0, 0.06, 0), c: C.eye },
    // Red ribbon band with a tiny bow at the front, plus a cream label.
    { g: new TorusGeometry(0.0392, 0.0022, 4, 28), m: T(0, 0.046, 0, Math.PI / 2, 0, 0), c: C.red },
    { g: new SphereGeometry(1, 8, 6), m: T(-0.006, 0.046, 0.04, 0, 0.3, 0.5, 0.006, 0.0035, 0.002), c: C.red },
    { g: new SphereGeometry(1, 8, 6), m: T(0.006, 0.046, 0.04, 0, -0.3, -0.5, 0.006, 0.0035, 0.002), c: C.red },
    { g: lathe([[0.0398, 0.022], [0.0398, 0.036]], 10, -0.45, 0.9), c: C.cream },
  ];
  root.add(mk('Candle', merge(candle), matteMat(), false));

  const glassMat = sharedMat('jar-glass', () => new MeshStandardMaterial({
    color: 0xe4f2f0, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.3, depthWrite: false,
  }));
  const jarProfile: Array<[number, number]> = [[0.036, 0.004], [0.0375, 0.012], [0.0375, 0.07], [0.034, 0.08]];
  const jar = merge([{ g: shell(jarProfile, 0.0025, 24) }, { g: new CylinderGeometry(0.0385, 0.037, 0.004, 24), m: T(0, 0.002, 0) }]);
  root.add(mk('Jar', jar, glassMat, false));

  const flameOuterMat = sharedMat('flame-outer', () => new MeshBasicMaterial({
    color: 0xff8a2a, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const flameInnerMat = sharedMat('flame-inner', () => new MeshBasicMaterial({
    color: 0xfff1b8, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const glowMat = sharedMat('flame-glow', () => new MeshBasicMaterial({
    color: 0xff7a1a, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  const flameGeo = sharedGeo('flame', () => lathe(FLAME_PROFILE, 12));
  const flame = grp('Flame', 0, 0.064, 0);
  const outer = mk('FlameOuter', flameGeo, flameOuterMat, false);
  const inner = mk('FlameInner', flameGeo, flameInnerMat, false);
  inner.scale.set(0.55, 0.6, 0.55);
  inner.position.y = 0.002;
  // Soft outer aura: the same teardrop, larger and faint.
  const glow = mk('FlameGlow', flameGeo, glowMat, false);
  glow.scale.set(1.7, 1.3, 1.7);
  glow.position.y = -0.006;
  for (const m of [outer, inner, glow]) {
    m.renderOrder = 2;
    m.userData.iwsdkPreviewBounds = 'exclude';
  }
  flame.add(glow, outer, inner);
  root.add(flame);

  const setLevel = (days: number): void => {
    const d = Math.max(0, Math.floor(days));
    root.userData.level = d;
    flame.visible = d > 0;
    if (d === 0) return;
    const t = (Math.min(d, 7) - 1) / 6; // 0 at day 1, 1 at day 7+
    const s = 0.55 + 0.6 * t;
    flame.scale.set(0.85 + 0.3 * t, s, 0.85 + 0.3 * t);
    inner.visible = d >= 3;
    glow.visible = d >= 5;
  };
  setLevel(0);
  return { root, setLevel };
}

// ===========================================================================
// 6. Decor unlocks
// ===========================================================================

const STRING_SPAN = 2;
const STRING_SAG = 0.28;
const BULB_COUNT = 12;

/**
 * Guinguette string lights: a dark wire hung between attachment points at
 * (-2, 0, 0) and (2, 0, 0), sagging so the bulbs droop to about y = -0.35.
 * The 12 bulbs are ONE InstancedMesh sharing one warm emissive material.
 */
export function buildStringLights(): Group {
  const root = grp('StringLights');
  const sagY = (x: number) => -STRING_SAG * (1 - (x / STRING_SPAN) ** 2);
  const pts: Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const x = -STRING_SPAN + (i / 16) * STRING_SPAN * 2;
    pts.push(new Vector3(x, sagY(x), 0));
  }
  const wire: Part[] = [{ g: new TubeGeometry(new CatmullRomCurve3(pts), 64, 0.0028, 4, false), c: 0x22301f }];
  const bulbPositions: Vector3[] = [];
  for (let i = 0; i < BULB_COUNT; i++) {
    const x = -STRING_SPAN + (STRING_SPAN * 2 * (i + 0.5)) / BULB_COUNT;
    const y = sagY(x);
    wire.push({ g: new CylinderGeometry(0.0085, 0.0075, 0.018, 8), m: T(x, y - 0.008, 0), c: 0x2a3326 });
    bulbPositions.push(new Vector3(x, y - 0.016 - 0.026, 0));
  }
  for (const s of [-1, 1]) {
    wire.push({ g: new TorusGeometry(0.01, 0.0025, 4, 10), m: T(s * STRING_SPAN, 0.006, 0), c: C.brassDeep });
  }
  root.add(mk('Wire', merge(wire), matteMat(), false));

  const bulbMat = sharedMat('bulb-warm', () => new MeshStandardMaterial({
    color: 0xfff1d2, emissive: 0xffc46b, emissiveIntensity: 2.2, roughness: 0.4,
  }));
  const bulbGeo = sharedGeo('bulb', () => {
    const g = new SphereGeometry(1, 10, 8);
    g.scale(0.022, 0.028, 0.022);
    return g;
  });
  const bulbs = new InstancedMesh(bulbGeo, bulbMat, BULB_COUNT);
  bulbs.name = 'Bulbs';
  const m = new Matrix4();
  bulbPositions.forEach((p, i) => bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  bulbs.instanceMatrix.needsUpdate = true;
  bulbs.computeBoundingSphere();
  root.add(bulbs);
  return root;
}

/** Potted leafy plant (~0.6 m tall) in a terracotta pot on a saucer; base at y = 0. */
export function buildPlant(): Group {
  const root = grp('Plant');
  const pot: Part[] = [
    { g: lathe([[0, 0], [0.1, 0], [0.108, 0.014], [0.104, 0.016], [0.096, 0.006], [0, 0.006]], 24), c: C.terracottaDeep },
    { g: lathe([[0, 0.006], [0.07, 0.006], [0.088, 0.19]], 24), c: C.terracotta },
    { g: lathe([[0.088, 0.19], [0.099, 0.193], [0.102, 0.236], [0.094, 0.242], [0.0885, 0.236], [0.087, 0.214]], 24), c: C.terracottaDeep },
    { g: lathe([[0.087, 0.214], [0, 0.218]], 24), c: C.soil },
  ];
  root.add(mk('Pot', merge(pot), matteMat()));

  const rand = makeRandom(1337);
  const leafTpl = new SphereGeometry(1, 10, 6);
  leafTpl.scale(0.034, 0.0055, 0.07);
  leafTpl.translate(0, 0, 0.066);
  const foliage: Part[] = [];
  const tints = [C.leaf, C.leafLight, C.leafDeep, C.leaf];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const LEAVES = 19;
  for (let i = 0; i < LEAVES; i++) {
    const crown = i >= LEAVES - 4;
    const yaw = i * golden + rand() * 0.3;
    const h = crown ? 0.42 + rand() * 0.04 : 0.25 + (i / LEAVES) * 0.17 + rand() * 0.04;
    const rr = crown ? 0.012 : 0.025 + rand() * 0.045;
    const base = new Vector3(Math.sin(yaw) * rr, h, Math.cos(yaw) * rr);
    const elev = crown ? 1.05 + rand() * 0.25 : 0.15 + (i / LEAVES) * 0.7 + rand() * 0.2;
    const leafScale = crown ? 0.95 : 0.85 + rand() * 0.35;
    const mat = new Matrix4().makeTranslation(base.x, base.y, base.z)
      .multiply(new Matrix4().makeRotationY(yaw))
      .multiply(new Matrix4().makeRotationX(-elev))
      .multiply(new Matrix4().makeRotationZ((rand() - 0.5) * 0.6))
      .multiply(new Matrix4().makeScale(leafScale, leafScale, leafScale));
    foliage.push({ g: leafTpl, m: mat, c: tints[i % tints.length] });
    const root0 = new Vector3((rand() - 0.5) * 0.04, 0.214, (rand() - 0.5) * 0.04);
    const { m: sm, len } = spanMatrix(root0, base);
    foliage.push({ g: new CylinderGeometry(0.0028, 0.0035, len, 4), m: sm, c: C.leafDeep });
  }
  root.add(mk('Foliage', merge(foliage), vcMat('foliage', { roughness: 0.55 })));
  leafTpl.dispose();
  return root;
}

const CHALK_FONT = `'Chalkduster', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive`;

function drawChalkboard(ctx: CanvasRenderingContext2D, lines: string[], title = 'Plat du jour'): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = '#26352e';
  ctx.fillRect(0, 0, w, h);
  // Old chalk smudges (deterministic).
  const rand = makeRandom(42);
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(230,240,232,${0.025 + rand() * 0.035})`;
    ctx.lineWidth = 10 + rand() * 26;
    ctx.beginPath();
    const x = rand() * w;
    const y = rand() * h;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 40, x + (rand() - 0.5) * 200, y + (rand() - 0.5) * 30);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f7f4ea';
  ctx.font = `bold 46px ${CHALK_FONT}`;
  ctx.fillText(title, w / 2, 66);
  // Swirly underline in pink chalk + little stars in yellow.
  ctx.strokeStyle = '#f2a7b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(60, 84);
  ctx.bezierCurveTo(140, 100, 240, 70, w - 60, 86);
  ctx.stroke();
  ctx.fillStyle = '#f6e48f';
  drawStar(ctx, 32, 46, 10);
  drawStar(ctx, w - 32, 46, 10);
  // Menu lines, auto-shrunk to fit.
  const shown = lines.slice(0, 8);
  const lineH = Math.min(46, (h - 130) / Math.max(shown.length, 1));
  shown.forEach((line, i) => {
    let size = Math.min(30, lineH * 0.78);
    ctx.font = `${size}px ${CHALK_FONT}`;
    while (ctx.measureText(line).width > w - 40 && size > 12) {
      size -= 2;
      ctx.font = `${size}px ${CHALK_FONT}`;
    }
    ctx.fillStyle = i % 2 === 0 ? '#f4f1e6' : '#f6e7a1';
    ctx.fillText(line, w / 2, 128 + i * lineH + lineH * 0.55);
  });
  // Tiny coffee-cup doodle at the bottom.
  ctx.strokeStyle = '#f4f1e6';
  ctx.lineWidth = 3;
  const cx = w / 2;
  const cy = h - 34;
  ctx.beginPath();
  ctx.moveTo(cx - 18, cy - 12);
  ctx.lineTo(cx - 14, cy + 10);
  ctx.lineTo(cx + 14, cy + 10);
  ctx.lineTo(cx + 18, cy - 12);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 22, cy - 2, 7, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = '#f2a7b8';
  for (const dx of [-6, 4]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - 18);
    ctx.quadraticCurveTo(cx + dx + 6, cy - 26, cx + dx, cy - 34);
    ctx.stroke();
  }
}

/**
 * A-frame sidewalk chalkboard (~0.5 m wide x 0.7 m tall), board facing +Z, base at y = 0.
 * `setLines` redraws the chalk menu under the "Plat du jour" header.
 */
export function buildChalkboard(title = 'Plat du jour'): { root: Group; setLines(lines: string[]): void } {
  const root = grp('Chalkboard');
  const tilt = 0.2;
  const L = 0.7 / Math.cos(tilt);
  const foot = L * Math.sin(tilt);
  const lift = 0.011 * Math.sin(tilt); // keep the rail corners above y = 0
  const frontM = T(0, lift, foot, -tilt, 0, 0);
  const backM = T(0, lift, -foot, tilt, 0, 0);
  const wood: Part[] = [];
  const frame = (M: Matrix4, isFront: boolean) => {
    for (const s of [-1, 1]) wood.push({ g: new BoxGeometry(0.03, L, 0.022), m: M.clone().multiply(T(s * 0.235, L / 2, 0)), c: C.wood });
    wood.push({ g: new BoxGeometry(0.5, 0.034, 0.022), m: M.clone().multiply(T(0, L - 0.017, 0)), c: C.wood });
    wood.push({ g: new BoxGeometry(0.47, 0.03, 0.022), m: M.clone().multiply(T(0, 0.145, 0)), c: C.wood });
    // Board slab (the visible chalk face on the front is a separate textured plane).
    wood.push({ g: new BoxGeometry(0.44, 0.535, 0.008), m: M.clone().multiply(T(0, 0.43, isFront ? -0.004 : 0.004)), c: C.chalkboard });
    if (isFront) {
      wood.push({ g: new BoxGeometry(0.42, 0.008, 0.03), m: M.clone().multiply(T(0, 0.162, 0.018)), c: C.woodDark }); // chalk ledge
      wood.push({ g: new CylinderGeometry(0.004, 0.004, 0.05, 6), m: M.clone().multiply(T(0.1, 0.17, 0.024, 0, 0, Math.PI / 2 - 0.1)), c: C.cream });
      wood.push({ g: new CylinderGeometry(0.004, 0.004, 0.036, 6), m: M.clone().multiply(T(-0.12, 0.17, 0.026, 0, 0.3, Math.PI / 2)), c: C.eraser });
    }
  };
  frame(frontM, true);
  frame(backM, false);
  // Hinge pins at the apex.
  for (const s of [-1, 1]) wood.push({ g: new CylinderGeometry(0.008, 0.008, 0.036, 8), m: T(s * 0.235, 0.7 + lift - 0.012, 0, 0, 0, Math.PI / 2), c: C.brassDeep });
  root.add(mk('ChalkboardFrame', merge(wood), woodMat()));

  const ct = makeCanvasTexture(384, 448);
  const boardMat = new MeshStandardMaterial({ color: ct ? 0xffffff : C.chalkboard, map: ct?.tex ?? null, roughness: 0.95 });
  const face = mk('ChalkboardFace', new PlaneGeometry(0.43, 0.5), boardMat, false);
  face.applyMatrix4(frontM.clone().multiply(T(0, 0.43, 0.0005)));
  root.add(face);

  const setLines = (lines: string[]): void => {
    root.userData.lines = lines.slice();
    if (!ct) return;
    drawChalkboard(ct.ctx, lines, title);
    ct.tex.needsUpdate = true;
  };
  setLines(['Croque-monsieur', 'Soupe à l\'oignon', 'Tarte Tatin']);
  return { root, setLines };
}

/** Small wind-up gramophone with a brass horn flaring toward +Z (~0.34 m tall), base at y = 0. */
export function buildGramophone(): Group {
  const root = grp('Gramophone');
  const wood: Part[] = [
    { g: new BoxGeometry(0.2, 0.012, 0.2), m: T(0, 0.006, 0), c: C.woodDark },
    { g: new BoxGeometry(0.184, 0.058, 0.184), m: T(0, 0.041, 0), c: C.wood },
    { g: new BoxGeometry(0.194, 0.01, 0.194), m: T(0, 0.075, 0), c: C.woodDark },
    { g: new BoxGeometry(0.15, 0.036, 0.003), m: T(0, 0.041, 0.0925), c: C.woodDark }, // front panel inset
  ];
  root.add(mk('GramophoneCase', merge(wood), woodMat()));

  const deck: Part[] = [
    { g: new CylinderGeometry(0.076, 0.076, 0.006, 32), m: T(0, 0.083, 0.01), c: 0x6e1a22 }, // felt platter
    { g: new CylinderGeometry(0.071, 0.071, 0.002, 32), m: T(0, 0.087, 0.01), c: 0x111111 }, // record
    { g: new CylinderGeometry(0.022, 0.022, 0.0022, 20), m: T(0, 0.0875, 0.01), c: C.red }, // label
    { g: new CylinderGeometry(0.0022, 0.0022, 0.012, 6), m: T(0, 0.092, 0.01), c: C.silver },
  ];
  root.add(mk('Turntable', merge(deck), vcMat('vinyl', { roughness: 0.3 }), false));

  // Horn: narrow neck at the back, flaring up and forward over the record.
  const hornLen = 0.235;
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 10; i++) {
    const y = (i / 10) * hornLen;
    prof.push([0.0075 + 0.105 * (y / hornLen) ** 2.6, y]);
  }
  const th = 0.0022;
  const outerP = prof.map(([r, y]) => [r + th, y] as [number, number]);
  const innerP = prof.slice().reverse();
  const top = prof[prof.length - 1];
  const hornM = T(0, 0.112, -0.072, 0.85, 0, 0);
  const brass: Part[] = [
    { g: lathe(outerP, 24), m: hornM, c: C.brass },
    { g: lathe(innerP, 24), m: hornM, c: C.brassDeep },
    { g: lathe([[top[0] + th, top[1]], [top[0], top[1]]], 24), m: hornM, c: C.brass },
    { g: new TorusGeometry(top[0] + th * 0.5, 0.0028, 6, 32), m: hornM.clone().multiply(T(0, top[1], 0, Math.PI / 2, 0, 0)), c: C.brassDeep },
  ];
  // Support post + elbow joint + tonearm to the sound box on the record.
  const neck = new Vector3(0, 0.112, -0.072);
  brass.push({ g: new CylinderGeometry(0.007, 0.009, 0.034, 10), m: T(0, 0.094, -0.072), c: C.brassDeep });
  brass.push({ g: new SphereGeometry(0.013, 12, 8), m: T(neck.x, neck.y, neck.z), c: C.brass });
  const box = new Vector3(0.032, 0.101, 0.03);
  const { m: armM, len } = spanMatrix(neck, box);
  brass.push({ g: new CylinderGeometry(0.0045, 0.0055, len, 8), m: armM, c: C.brass });
  brass.push({ g: new CylinderGeometry(0.016, 0.016, 0.008, 16), m: T(box.x, box.y, box.z, 0, 0, Math.PI / 2), c: C.silver });
  brass.push({ g: new CylinderGeometry(0.0012, 0.0006, 0.012, 4), m: T(box.x, box.y - 0.009, box.z), c: C.silver });
  // Winding crank on the +X side and four little brass feet.
  brass.push({ g: new CylinderGeometry(0.008, 0.008, 0.02, 8), m: T(0.102, 0.045, 0, 0, 0, Math.PI / 2), c: C.brassDeep });
  brass.push({ g: new BoxGeometry(0.006, 0.05, 0.008), m: T(0.114, 0.062, 0), c: C.brass });
  brass.push({ g: new CylinderGeometry(0.006, 0.006, 0.022, 8), m: T(0.124, 0.084, 0, 0, 0, Math.PI / 2), c: C.woodDark });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    brass.push({ g: new SphereGeometry(0.008, 8, 6), m: T(sx * 0.09, 0.008, sz * 0.09), c: C.brassDeep });
  }
  root.add(mk('Brass', merge(brass), brassMat()));
  return root;
}

// ===========================================================================
// 7. Ghost tutorial hand
// ===========================================================================

export interface GhostHandRig {
  root: Group;
  /** [thumb, index, middle, ring, pinky], each pivoting at its knuckle. */
  fingers: Group[];
  setOpacity(o: number): void;
}

interface FingerSpec { name: string; knuckle: [number, number, number]; dir: [number, number, number]; curl: [number, number, number]; len: number; r: number }

/**
 * Translucent glowing RIGHT hand for gesture tutorials. Wrist at the local origin,
 * palm facing -Y, fingers pointing -Z, thumb on the -X side, ~0.19 m long.
 *
 * Every finger Group (thumb included) sits under a fixed "mount" whose basis is chosen
 * so that local -Z runs along the finger and local +Y points toward the palm. Hence
 * `finger.rotation.x > 0` curls that finger toward the palm (~1.4 rad = fist):
 * index..pinky curl downward (-Y); the THUMB also uses rotation.x > 0, curling down
 * and across under the palm toward +X. rotation.y on a finger gives spread.
 * The material is per rig (shared by all of the rig's meshes); setOpacity drives it.
 */
export function buildGhostHand(): GhostHandRig {
  const root = grp('GhostHand');
  const mat = new MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const sph = unitSphere(14, 10);
  const palm = merge([
    { g: sph, m: T(0, 0, -0.05, 0, 0, 0, 0.043, 0.0145, 0.05) },
    { g: sph, m: T(0, 0, -0.004, 0, 0, 0, 0.025, 0.0155, 0.034) }, // wrist
    { g: sph, m: T(-0.026, -0.003, -0.032, 0, 0.3, 0, 0.018, 0.012, 0.027) }, // thenar pad
  ]);
  root.add(mk('Palm', palm, mat, false));

  const specs: FingerSpec[] = [
    { name: 'Thumb', knuckle: [-0.033, -0.004, -0.03], dir: [-0.55, -0.12, -0.8], curl: [0.75, -0.65, 0], len: 0.058, r: 0.0098 },
    { name: 'Index', knuckle: [-0.026, 0.001, -0.086], dir: [-0.08, 0, -1], curl: [0, -1, 0], len: 0.072, r: 0.0088 },
    { name: 'Middle', knuckle: [-0.0088, 0.002, -0.093], dir: [-0.02, 0, -1], curl: [0, -1, 0], len: 0.08, r: 0.009 },
    { name: 'Ring', knuckle: [0.0085, 0.001, -0.089], dir: [0.04, 0, -1], curl: [0, -1, 0], len: 0.074, r: 0.0086 },
    { name: 'Pinky', knuckle: [0.025, -0.001, -0.08], dir: [0.12, 0, -1], curl: [0, -1, 0], len: 0.058, r: 0.0075 },
  ];
  const fingers: Group[] = [];
  for (const s of specs) {
    const z = new Vector3(...s.dir).normalize().negate(); // finger runs along local -Z
    const curl = new Vector3(...s.curl);
    const y = curl.addScaledVector(z, -curl.dot(z)).normalize(); // local +Y = toward palm
    const x = new Vector3().crossVectors(y, z);
    const mount = grp(`${s.name}Mount`, ...s.knuckle);
    mount.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    const finger = grp(s.name);
    const geo = merge([
      { g: new CapsuleGeometry(s.r, s.len - 2 * s.r, 4, 10), m: T(0, 0, -s.len / 2, -Math.PI / 2, 0, 0) },
    ]);
    finger.add(mk(`${s.name}Mesh`, geo, mat, false));
    mount.add(finger);
    root.add(mount);
    fingers.push(finger);
  }
  sph.dispose();
  const setOpacity = (o: number): void => {
    mat.opacity = Math.min(1, Math.max(0, o));
    mat.visible = mat.opacity > 0.001;
  };
  return { root, fingers, setOpacity };
}

// ===========================================================================
// 8. Confetti burst
// ===========================================================================

const CONFETTI_COLORS = [0x2b59c3, 0xffffff, 0xe63946, 0xf4c542, 0xff8fab, 0x6fd3b0];

/**
 * `count` paper quads in ONE InstancedMesh, every instance at the origin (identity
 * matrix) with a per-instance colour. The gameplay system animates the matrices.
 */
export function buildConfettiBurst(count = 60): { root: Group; mesh: InstancedMesh } {
  const root = grp('ConfettiBurst');
  const geo = sharedGeo('confetti', () => new PlaneGeometry(0.018, 0.012));
  const mat = sharedMat('confetti', () => new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, toneMapped: false }));
  const mesh = new InstancedMesh(geo, mat, count);
  mesh.name = 'Confetti';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  const ident = new Matrix4();
  const col = new Color();
  const rand = makeRandom(7);
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, ident);
    mesh.setColorAt(i, col.set(CONFETTI_COLORS[(i + Math.floor(rand() * 3)) % CONFETTI_COLORS.length]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  root.add(mesh);
  return { root, mesh };
}

// ===========================================================================
// 9. Disposal
// ===========================================================================

/**
 * Dispose GPU resources under `root`: per-instance geometries, materials and their
 * textures. Shared (cached) geometries, materials and textures are left untouched.
 */
export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!(mesh as Mesh).isMesh) return;
    if (mesh.geometry && !SHARED_GEOMETRIES.has(mesh.geometry)) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || SHARED_MATERIALS.has(m)) continue;
      const map = (m as MeshStandardMaterial).map;
      if (map && !SHARED_TEXTURES.has(map)) map.dispose();
      m.dispose();
    }
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
}
