/**
 * The static set of one shop: textured counter, back wall with shelves,
 * floor that fades into the 360 photo backdrop, bistro tables, and realistic
 * props (Poly Haven models). Layout is shared by every shop (see layout.ts),
 * only materials and props change.
 *
 * Parts tagged `userData.mrHide` disappear in mixed reality, leaving the
 * counter top, items, tables and the shopkeeper in the learner's room.
 */

import {
  type BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from '@iwsdk/core';
import type { PlaceLook, Surface } from '../places/places.js';
import { freezeStatic, mergeStaticMeshes, stripTransmission } from './static-merge.js';
import { surfaceMaterial, type TextureSet } from './surfaces.js';

export interface ShopSet {
  root: Group;
  /** Shared, cached model instances: detach these before disposing the set. */
  props: Object3D[];
  /** Geometry of merged prop meshes (in `props`, shared materials): dispose these after detaching. */
  geometries: BufferGeometry[];
}

type Sets = Map<string, TextureSet | null>;

function box(w: number, h: number, d: number, m: MeshStandardMaterial, x: number, y: number, z: number): Mesh {
  const out = new Mesh(new BoxGeometry(w, h, d), m);
  out.position.set(x, y, z);
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

const room = <T extends Object3D>(o: T): T => {
  o.userData.mrHide = true;
  return o;
};

/** Soft round edge so the virtual floor blends into the photo's floor. */
function radialFade(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

function mat(sets: Sets, s: Surface, w: number, h: number, fallback: number): MeshStandardMaterial {
  return surfaceMaterial(sets.get(s.tex) ?? null, s, w, h, fallback);
}

function bistroTable(top: MeshStandardMaterial, metal: MeshStandardMaterial): Group {
  const g = new Group();
  const t = new Mesh(new CylinderGeometry(0.36, 0.36, 0.03, 40), top);
  t.position.y = 0.75;
  const stem = new Mesh(new CylinderGeometry(0.025, 0.025, 0.74, 12), metal);
  stem.position.y = 0.37;
  const foot = new Mesh(new CylinderGeometry(0.2, 0.22, 0.03, 24), metal);
  foot.position.y = 0.015;
  for (const m of [t, stem, foot]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

export function buildShopSet(look: PlaceLook, sets: Sets, getProp: (id: string) => Object3D | null): ShopSet {
  const root = new Group();
  root.name = 'Shop Set';
  const props: Object3D[] = [];

  // Floor: textured disc (matching the photo's floor), fading at the edge into the backdrop.
  const floorMat = mat(sets, look.floor, 8, 8, 0xd9d2c5);
  const fade = radialFade();
  if (fade) {
    floorMat.alphaMap = fade;
    floorMat.transparent = true;
    floorMat.depthWrite = false;
  }
  const floor = new Mesh(new CircleGeometry(4, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.002, -1);
  floor.receiveShadow = true;
  floor.renderOrder = -1;
  root.add(room(floor));

  // Counter: cabinet front (textured), stone/wood top, brass trim. Top at y = 1.0, front at z = -0.7.
  root.add(room(box(2.2, 0.96, 0.5, mat(sets, look.counterFront, 2.2, 0.96, 0x6b4226), 0, 0.48, -0.95)));
  root.add(box(2.3, 0.04, 0.58, mat(sets, look.counterTop, 2.3, 0.58, 0xe8e4dc), 0, 0.98, -0.95));
  const trim = new MeshStandardMaterial({ color: look.accent, metalness: 0.85, roughness: 0.3 });
  root.add(room(box(2.2, 0.03, 0.012, trim, 0, 0.9, -0.694)));
  root.add(room(box(2.2, 0.02, 0.012, trim, 0, 0.06, -0.694)));

  // Back counter behind the shopkeeper. No wall: the 360 photo is the rest of the shop,
  // so what you see behind the counter is a real room, not a CG backdrop.
  const back = box(2.7, 0.89, 0.5, mat(sets, look.backFront, 2.7, 0.89, 0x6b4226), 0, 0.445, -2.2);
  back.castShadow = false;
  root.add(room(back));
  const backTop = box(2.8, 0.04, 0.56, mat(sets, look.backTop, 2.8, 0.56, 0xe8e4dc), 0, 0.91, -2.2);
  backTop.castShadow = false;
  root.add(room(backTop));

  // Side tables (marble-like top from the counter surface, dark metal base).
  const topMat = mat(sets, look.counterTop, 0.72, 0.72, 0xf3efe7);
  const metal = new MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.7, roughness: 0.35 });
  for (const [x, z] of [[1.2, -0.6], [-1.25, -0.62]] as const) {
    const t = bistroTable(topMat, metal);
    t.position.set(x, 0, z);
    root.add(t);
  }

  // Realistic props.
  for (const p of look.props) {
    const obj = getProp(p.model);
    if (!obj) continue;
    obj.position.set(...p.pos);
    obj.rotation.y = p.rotY ?? 0;
    obj.scale.setScalar(p.scale ?? 1);
    // Background props receive light but cast no shadow: each caster costs an extra draw
    // call in the shadow pass, and these sit far behind the counter.
    obj.traverse((o) => {
      if ((o as Mesh).isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    if (!p.keepInMr) room(obj);
    root.add(obj);
    props.push(obj);
  }

  // Cost without visible change (see static-merge.ts): no refraction pass, one draw per
  // material for everything static, matrices computed once.
  stripTransmission(root);
  const propMaterials = new Set<unknown>();
  for (const prop of props) prop.traverse((o) => propMaterials.add((o as Mesh).material));
  const { merged } = mergeStaticMeshes(root);
  const geometries: BufferGeometry[] = [];
  for (const mesh of merged) {
    // Merged from props: the material belongs to the asset cache, so detach before disposal.
    if (!propMaterials.has(mesh.material)) continue;
    props.push(mesh);
    geometries.push(mesh.geometry);
  }
  freezeStatic(root);

  return { root, props, geometries };
}
