import { describe, expect, it, vi } from 'vitest';

// @iwsdk/core re-exports Three.js but also pulls in browser-only runtime code; the model
// builders only need the Three classes, so map the module onto three for Node tests.
vi.mock('@iwsdk/core', async () => await import('three'));

import { Box3, Group, InstancedMesh, Mesh, type Object3D, Vector3 } from 'three';
import {
  buildChalkboard, buildConfettiBurst, buildGhostHand, buildGramophone, buildMadameLune, buildMoney,
  buildMoneyDish, buildPlant, buildRegisterDisplay, buildStreakFlame, buildStringLights, buildTray,
  COIN_VALUES, disposeObject,
} from '../src/models/cafe-models';

function meshCount(o: Object3D): number {
  let n = 0;
  o.traverse((c) => { if ((c as Mesh).isMesh) n++; });
  return n;
}
function bounds(o: Object3D): Box3 {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o);
}

describe('Madame Lune rig', () => {
  const rig = buildMadameLune();
  it('exposes the contract parts', () => {
    for (const g of [rig.root, rig.head, rig.leftArm, rig.rightArm, rig.leftForearm, rig.rightForearm]) expect(g).toBeInstanceOf(Group);
    expect(rig.mouth).toBeInstanceOf(Mesh);
    expect(rig.mouth.scale.toArray()).toEqual([1, 1, 1]);
    expect(rig.eyes).toHaveLength(2);
    expect(rig.leftArm.position.x).toBeGreaterThan(0); // her own left is +X
    expect(rig.rightArm.position.x).toBeLessThan(0);
    expect(rig.leftForearm.parent).toBe(rig.leftArm);
    expect(rig.mouth.parent).toBe(rig.head);
  });
  it('is ~1.62 m tall, base at y=0, within the mesh budget', () => {
    const b = bounds(rig.root);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(b.max.y).toBeGreaterThan(1.58);
    expect(b.max.y).toBeLessThan(1.7);
    expect(meshCount(rig.root)).toBeLessThanOrEqual(35);
  });
  it('swings the arm toward +Z with negative rotation.x', () => {
    const hand = new Vector3();
    rig.leftArm.rotation.x = -Math.PI / 2;
    rig.root.updateMatrixWorld(true);
    rig.leftForearm.getWorldPosition(hand);
    expect(hand.z).toBeGreaterThan(0.2);
    rig.leftArm.rotation.x = 0;
  });
});

describe('money', () => {
  it('builds every denomination flat with base at y=0', () => {
    for (const v of COIN_VALUES) {
      const g = buildMoney(v);
      expect(g.userData.cents).toBe(v);
      const b = bounds(g);
      expect(b.min.y).toBeCloseTo(0, 4);
      expect(b.max.y).toBeLessThan(0.006);
      expect(meshCount(g)).toBe(1);
    }
  });
  it('keeps coin size order and shares geometry per denomination', () => {
    const w = (v: number) => bounds(buildMoney(v)).getSize(new Vector3()).x;
    expect(w(200)).toBeGreaterThan(w(50));
    expect(w(50)).toBeGreaterThan(w(100));
    expect(w(20)).toBeGreaterThan(w(10));
    expect(w(1000)).toBeCloseTo(0.12, 3);
    const a = buildMoney(200).children[0] as Mesh;
    const b = buildMoney(200).children[0] as Mesh;
    expect(a.geometry).toBe(b.geometry);
  });
});

describe('props', () => {
  const props: Array<[string, Object3D, number]> = [
    ['tray', buildTray(), 25], ['dish', buildMoneyDish(), 25], ['register', buildRegisterDisplay().root, 25],
    ['flame', buildStreakFlame().root, 25], ['lights', buildStringLights(), 25], ['plant', buildPlant(), 25],
    ['chalkboard', buildChalkboard().root, 25], ['gramophone', buildGramophone(), 25],
  ];
  it.each(props)('%s sits on y=0 within budget', (_n, root, budget) => {
    const b = bounds(root);
    if (_n !== 'lights') expect(b.min.y).toBeGreaterThanOrEqual(-1e-4);
    expect(meshCount(root)).toBeLessThanOrEqual(budget);
    expect(root.parent).toBeNull();
  });
  it('string lights span x=-2..2 and droop to ~-0.35 with instanced bulbs', () => {
    const root = buildStringLights();
    const b = bounds(root);
    expect(b.min.x).toBeLessThan(-1.98);
    expect(b.max.x).toBeGreaterThan(1.98);
    expect(b.min.y).toBeGreaterThan(-0.4);
    expect(b.min.y).toBeLessThan(-0.3);
    const bulbs = root.children.find((c) => (c as InstancedMesh).isInstancedMesh) as InstancedMesh;
    expect(bulbs.count).toBe(12);
  });
  it('setText / setLines / setLevel work without a DOM', () => {
    const reg = buildRegisterDisplay();
    reg.setText('3,40 €');
    expect(reg.root.userData.text).toBe('3,40 €');
    const cb = buildChalkboard();
    cb.setLines(['a', 'b']);
    expect(cb.root.userData.lines).toEqual(['a', 'b']);
    const f = buildStreakFlame();
    const flame = f.root.getObjectByName('Flame')!;
    f.setLevel(0);
    expect(flame.visible).toBe(false);
    f.setLevel(1);
    const s1 = flame.scale.y;
    f.setLevel(10);
    expect(flame.visible).toBe(true);
    expect(flame.scale.y).toBeGreaterThan(s1);
  });
});

describe('ghost hand', () => {
  it('has 5 fingers that curl toward the palm (-Y) with positive rotation.x', () => {
    const h = buildGhostHand();
    expect(h.fingers).toHaveLength(5);
    const tip = new Vector3();
    for (const f of h.fingers) {
      f.rotation.x = 1.2;
      h.root.updateMatrixWorld(true);
      tip.set(0, 0, -0.05).applyMatrix4(f.matrixWorld);
      expect(tip.y).toBeLessThan(-0.02);
    }
    h.setOpacity(0.2);
    expect(((h.root.getObjectByName('Palm') as Mesh).material as { opacity: number }).opacity).toBeCloseTo(0.2);
    expect(meshCount(h.root)).toBeLessThanOrEqual(25);
  });
});

describe('confetti + disposal', () => {
  it('builds one instanced mesh at the origin with colours', () => {
    const c = buildConfettiBurst(40);
    expect(c.mesh.count).toBe(40);
    expect(c.mesh.instanceColor).not.toBeNull();
    expect(c.root.children).toHaveLength(1);
  });
  it('disposeObject keeps shared resources intact', () => {
    const a = buildMoney(100);
    const b = buildMoney(100);
    const geo = (b.children[0] as Mesh).geometry;
    let disposed = false;
    geo.addEventListener('dispose', () => { disposed = true; });
    disposeObject(a);
    disposeObject(buildMadameLune().root);
    disposeObject(buildRegisterDisplay().root);
    expect(disposed).toBe(false);
  });
});
