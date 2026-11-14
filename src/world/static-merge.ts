/**
 * Draw-call savings for static scenery, with no visible change:
 *  - `stripTransmission` turns refractive glass (KHR_materials_transmission, e.g. the
 *    Poly Haven wine bottles and lamp glass) into plain alpha-blended glass. One
 *    transmissive material makes three.js render every opaque object a second time
 *    into a screen-sized texture, per eye, every frame: in the café that pass was
 *    104 of 263 draw calls.
 *  - `mergeStaticMeshes` merges meshes that share a material (and shadow / mixed
 *    reality flags) into one mesh per material, baked into the root's space.
 *  - `freezeStatic` stops per-frame matrix recomposition for objects that never move.
 */

import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  Matrix3,
  Matrix4,
  Mesh,
  type MeshPhysicalMaterial,
  type Object3D,
  Vector3,
} from '@iwsdk/core';

/** Opacity for converted glass: clear glass stays faint, tinted glass and liquids denser. */
export function glassOpacity(r: number, g: number, b: number): number {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.min(0.85, Math.max(0.25, 0.25 + (1 - lum) * 0.6));
}

/** Replaces transmission with alpha blending on every material under `root`. Returns how many changed. */
export function stripTransmission(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as MeshPhysicalMaterial[]) {
      if (!m || !(m.transmission > 0)) continue;
      m.transmission = 0;
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = Math.min(m.opacity, glassOpacity(m.color.r, m.color.g, m.color.b));
      m.needsUpdate = true;
      n++;
    }
  });
  return n;
}

const MERGEABLE = new Set(['position', 'normal', 'uv']);

function hidden(o: Object3D, root: Object3D): boolean {
  for (let a: Object3D | null = o; a && a !== root; a = a.parent) if (!a.visible) return true;
  return false;
}

function mrHidden(o: Object3D, root: Object3D): boolean {
  for (let a: Object3D | null = o; a && a !== root; a = a.parent) if (a.userData.mrHide) return true;
  return false;
}

function mergeable(mesh: Mesh, root: Object3D): boolean {
  const geo = mesh.geometry as BufferGeometry;
  if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh || (mesh as { isInstancedMesh?: boolean }).isInstancedMesh) return false;
  if (Array.isArray(mesh.material) || mesh.morphTargetInfluences || hidden(mesh, root)) return false;
  if (!geo.attributes.position || !geo.attributes.normal || Object.keys(geo.morphAttributes).length) return false;
  if (geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity) return false;
  return Object.keys(geo.attributes).every((k) => MERGEABLE.has(k));
}

export interface MergeResult {
  /** The merged meshes, children of the root, in the root's space. */
  merged: Mesh[];
  /** Meshes taken out of the tree (now detached). */
  removed: Mesh[];
}

/**
 * Merges meshes under `root` that share one material and the same render flags into a
 * single mesh per group (2+ meshes). Skinned, instanced, morphing, hidden and
 * multi-material meshes are left alone, as is anything `keep` returns true for.
 * Source geometries and materials are not modified or disposed (they may be shared
 * with the asset cache); the merged geometries are new and owned by the caller.
 */
export function mergeStaticMeshes(root: Object3D, keep: (mesh: Mesh) => boolean = () => false): MergeResult {
  root.updateMatrixWorld(true);
  const groups = new Map<string, Mesh[]>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || o === root || keep(mesh) || !mergeable(mesh, root)) return;
    const geo = mesh.geometry as BufferGeometry;
    const key = [
      (mesh.material as Material).uuid,
      Object.keys(geo.attributes).sort().join(','),
      mesh.castShadow,
      mesh.receiveShadow,
      mesh.renderOrder,
      mesh.frustumCulled,
      mesh.layers.mask,
      mrHidden(mesh, root),
    ].join('|');
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(mesh);
  });

  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const m = new Matrix4();
  const nm = new Matrix3();
  const v = new Vector3();
  const merged: Mesh[] = [];
  const removed: Mesh[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const hasUv = !!(first.geometry as BufferGeometry).attributes.uv;
    let verts = 0;
    let idx = 0;
    for (const mesh of list) {
      const g = mesh.geometry as BufferGeometry;
      verts += g.attributes.position.count;
      idx += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(verts * 3);
    const nor = new Float32Array(verts * 3);
    const uv = hasUv ? new Float32Array(verts * 2) : null;
    const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    let vo = 0;
    let io = 0;
    for (const mesh of list) {
      const g = mesh.geometry as BufferGeometry;
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const t = g.attributes.uv;
      m.multiplyMatrices(inv, mesh.matrixWorld);
      nm.getNormalMatrix(m);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos[(vo + i) * 3] = v.x;
        pos[(vo + i) * 3 + 1] = v.y;
        pos[(vo + i) * 3 + 2] = v.z;
        v.fromBufferAttribute(n, i).applyNormalMatrix(nm);
        nor[(vo + i) * 3] = v.x;
        nor[(vo + i) * 3 + 1] = v.y;
        nor[(vo + i) * 3 + 2] = v.z;
        if (uv && t) {
          uv[(vo + i) * 2] = t.getX(i);
          uv[(vo + i) * 2 + 1] = t.getY(i);
        }
      }
      // A mirrored transform flips the winding: swap two corners to keep faces outward.
      const flip = m.determinant() < 0;
      const count = g.index ? g.index.count : p.count;
      for (let i = 0; i < count; i += 3) {
        const a = g.index ? g.index.getX(i) : i;
        const b = g.index ? g.index.getX(i + 1) : i + 1;
        const c = g.index ? g.index.getX(i + 2) : i + 2;
        index[io++] = vo + a;
        index[io++] = vo + (flip ? c : b);
        index[io++] = vo + (flip ? b : c);
      }
      vo += p.count;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    if (uv) geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(new BufferAttribute(index, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    const out = new Mesh(geo, first.material);
    out.name = `Merged ${(first.material as Material).name || first.name || 'static'}`;
    out.castShadow = first.castShadow;
    out.receiveShadow = first.receiveShadow;
    out.renderOrder = first.renderOrder;
    out.frustumCulled = first.frustumCulled;
    out.layers.mask = first.layers.mask;
    if (mrHidden(first, root)) out.userData.mrHide = true;
    for (const mesh of list) {
      mesh.removeFromParent();
      removed.push(mesh);
    }
    root.add(out);
    merged.push(out);
  }
  return { merged, removed };
}

/** Static scenery: compute local matrices once and stop recomposing them every frame. */
export function freezeStatic(root: Object3D): void {
  for (const child of root.children) {
    child.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }
}
