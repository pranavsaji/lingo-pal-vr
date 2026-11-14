import { describe, expect, it, vi } from 'vitest';

// @iwsdk/core re-exports Three.js but pulls in browser-only runtime code: map it onto three.
vi.mock('@iwsdk/core', async () => await import('three'));

import { Box3, BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D, SkinnedMesh, Vector3 } from 'three';
import { freezeStatic, glassOpacity, mergeStaticMeshes, stripTransmission } from '../src/world/static-merge';

function meshes(o: Object3D): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((c) => {
    if ((c as Mesh).isMesh) out.push(c as Mesh);
  });
  return out;
}

function worldBox(o: Object3D): Box3 {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o);
}

describe('static merge', () => {
  it('merges meshes sharing a material into one draw, keeping the shape', () => {
    const root = new Group();
    root.position.set(0.5, 0, -1);
    const wood = new MeshStandardMaterial();
    const brass = new MeshStandardMaterial();
    const prop = new Group();
    prop.position.set(1, 0.9, -2);
    prop.rotation.y = 0.7;
    prop.scale.setScalar(0.5);
    root.add(prop);
    for (let i = 0; i < 3; i++) {
      const m = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), wood);
      m.position.set(i * 0.3, 0, 0);
      prop.add(m);
    }
    const mirrored = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), wood);
    mirrored.scale.set(-1, 1, 1);
    root.add(mirrored);
    root.add(new Mesh(new BoxGeometry(1, 1, 1), brass)); // alone: untouched
    const before = worldBox(root);

    const { merged, removed } = mergeStaticMeshes(root);
    expect(merged).toHaveLength(1);
    expect(removed).toHaveLength(4);
    expect(meshes(root)).toHaveLength(2);
    expect(merged[0].material).toBe(wood);
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
    const n = merged[0].geometry.attributes.normal;
    for (let i = 0; i < n.count; i += 7) expect(new Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 4);
  });

  it('keeps shadow, mixed-reality and render flags apart, and skips skinned or hidden meshes', () => {
    const root = new Group();
    const mat = new MeshStandardMaterial();
    const a = new Mesh(new BoxGeometry(), mat);
    const b = new Mesh(new BoxGeometry(), mat);
    b.castShadow = true;
    const room = new Group();
    room.userData.mrHide = true;
    room.add(new Mesh(new BoxGeometry(), mat), new Mesh(new BoxGeometry(), mat));
    const hidden = new Mesh(new BoxGeometry(), mat);
    hidden.visible = false;
    const skinned = new SkinnedMesh(new BoxGeometry(), mat);
    root.add(a, b, room, hidden, skinned, new Mesh(new BoxGeometry(), mat));
    const { merged } = mergeStaticMeshes(root);
    expect(merged).toHaveLength(2); // [a + last] and the two room boxes
    expect(merged.filter((m) => m.userData.mrHide)).toHaveLength(1);
    expect(hidden.parent).toBe(root);
    expect(skinned.parent).toBe(root);
    expect(b.parent).toBe(root);
  });

  it('never touches the source geometry (shared with the asset cache)', () => {
    const geo = new BoxGeometry();
    const mat = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(geo, mat), new Mesh(geo, mat));
    const before = Array.from(geo.attributes.position.array);
    mergeStaticMeshes(root);
    expect(Array.from(geo.attributes.position.array)).toEqual(before);
  });

  it('turns refractive glass into cheap alpha-blended glass', () => {
    const glass = new MeshPhysicalMaterial({ transmission: 1, color: 0xffffff });
    const wine = new MeshPhysicalMaterial({ transmission: 1, color: 0x550000 });
    const plain = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), glass), new Mesh(new BoxGeometry(), wine), new Mesh(new BoxGeometry(), plain));
    expect(stripTransmission(root)).toBe(2);
    expect(glass.transmission).toBe(0);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.25, 2);
    expect(wine.opacity).toBeGreaterThan(glass.opacity);
    expect(plain.transparent).toBe(false);
    expect(stripTransmission(root)).toBe(0); // idempotent
    expect(glassOpacity(0, 0, 0)).toBe(0.85);
  });

  it('freezes static matrices once', () => {
    const root = new Group();
    const child = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    child.position.set(1, 2, 3);
    root.add(child);
    freezeStatic(root);
    expect(child.matrixAutoUpdate).toBe(false);
    expect(child.matrix.elements[12]).toBe(1);
    expect(root.matrixAutoUpdate).toBe(true); // the entity root keeps its transform
  });
});
