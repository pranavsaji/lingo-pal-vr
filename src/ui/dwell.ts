/**
 * Eyes-only selection registry. Anything clickable registers here as well as
 * getting its normal click listener, so a learner who cannot use their hands
 * can select it by looking at it for one second (Reglages > Selection du regard).
 */

import type { Object3D } from '@iwsdk/core';

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
