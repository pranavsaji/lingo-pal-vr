import { Matrix4, Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { dwellShown, dwellWorldPosition } from '../src/ui/dwell.js';

/** Mimics a UIKit element: hidden, non-auto-updating objects under a document root. */
function uikitTree() {
  const doc = new Object3D(); // document root: auto-updates, scaled and placed in the world
  doc.position.set(1, 1.5, -1.3);
  doc.scale.setScalar(0.14);
  const panel = new Object3D();
  panel.matrixAutoUpdate = false;
  panel.visible = false;
  const el = new Object3D() as Object3D & { globalMatrix: { value: Matrix4 }; isVisible: { value: boolean } };
  el.matrixAutoUpdate = false;
  el.visible = false;
  el.globalMatrix = { value: new Matrix4().makeTranslation(0, 0.5, 0) }; // 0.5 units above the root center
  el.isVisible = { value: true };
  doc.add(panel);
  panel.add(el);
  doc.updateMatrixWorld(true);
  return { doc, el };
}

describe('eyes-only targets on UIKit elements', () => {
  it('uses globalMatrix relative to the document root', () => {
    const { el } = uikitTree();
    const p = dwellWorldPosition(el, new Vector3());
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1.5 + 0.5 * 0.14);
    expect(p.z).toBeCloseTo(-1.3);
  });
  it('counts UIKit elements as shown even though their own Object3D is hidden', () => {
    const { doc, el } = uikitTree();
    expect(dwellShown(el)).toBe(true);
    el.isVisible.value = false;
    expect(dwellShown(el)).toBe(false);
    el.isVisible.value = true;
    doc.visible = false;
    expect(dwellShown(el)).toBe(false);
  });
  it('plain 3D objects use their world position and visibility', () => {
    const o = new Object3D();
    o.position.set(0.2, 1, -0.9);
    o.updateMatrixWorld(true);
    expect(dwellWorldPosition(o, new Vector3()).toArray()).toEqual([0.2, 1, -0.9]);
    expect(dwellShown(o)).toBe(true);
    o.visible = false;
    expect(dwellShown(o)).toBe(false);
  });
});
