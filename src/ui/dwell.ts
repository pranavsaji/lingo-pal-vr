/**
 * Eyes-only selection registry. Anything clickable registers here as well as
 * getting its normal click listener, so a learner who cannot use their hands
 * can select it by looking at it for one second (Reglages > Selection du regard).
 */

import type { Matrix4, Object3D, Vector3 } from '@iwsdk/core';

export interface DwellTarget {
  obj: Object3D;
  fn: () => void;
  /** Half-angle of the selection cone, degrees. */
  coneDeg: number;
}

export const dwellTargets = new Set<DwellTarget>();

type Clickable = {
  addEventListener(type: 'click', fn: () => void): void;
  removeEventListener(type: 'click', fn: () => void): void;
};

/**
 * Click (pinch, poke, mouse) or dwell. Returns a cleanup function.
 * UIKit elements are Object3Ds, so their world position is the dwell target.
 */
export function onActivate(el: Clickable & Object3D, fn: () => void, coneDeg = 2.2): () => void {
  el.addEventListener('click', fn);
  const t: DwellTarget = { obj: el, fn, coneDeg };
  dwellTargets.add(t);
  return () => {
    el.removeEventListener('click', fn);
    dwellTargets.delete(t);
  };
}

/** Register a 3D object (not a UI element) as a dwell target. */
export function addDwellTarget(obj: Object3D, fn: () => void, coneDeg = 3.5): () => void {
  const t: DwellTarget = { obj, fn, coneDeg };
  dwellTargets.add(t);
  return () => dwellTargets.delete(t);
}

type UIKitLike = Object3D & { globalMatrix?: { value?: Matrix4 }; isVisible?: { value?: boolean } };

/**
 * World-space center of a dwell target. UIKit elements render through shared
 * instanced meshes: their own Object3D stays hidden with a stale matrixWorld,
 * and `globalMatrix` places them relative to the document root (the first
 * ancestor that still auto-updates its matrix). Zero allocations.
 */
export function dwellWorldPosition(obj: Object3D, out: Vector3): Vector3 {
  const gm = (obj as UIKitLike).globalMatrix?.value;
  if (!gm) return obj.getWorldPosition(out);
  let a = obj.parent;
  while (a && !a.matrixAutoUpdate) a = a.parent;
  if (!a) return obj.getWorldPosition(out);
  return out.set(0, 0, 0).applyMatrix4(gm).applyMatrix4(a.matrixWorld);
}

/** False when the target, or a scene-graph ancestor, is hidden (UIKit visibility included). */
export function dwellShown(obj: Object3D): boolean {
  const ui = (obj as UIKitLike).isVisible;
  if (ui && ui.value === false) return false;
  let cur: Object3D | null = obj;
  // UIKit's own objects are always hidden meshes; judge from the document root up.
  if (ui) while (cur && !cur.matrixAutoUpdate) cur = cur.parent;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}
