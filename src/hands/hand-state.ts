/**
 * Live hand state shared between systems (read-only for everyone except
 * HandSystem). Plain mutable object so readers never allocate.
 */

import { newGestureFrame } from './gestures.js';

export const handState = {
  tracked: { left: false, right: false },
  frames: { left: newGestureFrame(), right: newGestureFrame() },
  /** Wrist positions in the XR reference space (= player-local space). */
  wrist: { left: new Float32Array(3), right: new Float32Array(3) },
  /** Index fingertip positions in the XR reference space. */
  indexTip: { left: new Float32Array(3), right: new Float32Array(3) },
  /** Stable (debounced) finger count across both hands, 0 to 10. */
  fingers: 0,
  /** Push-to-talk held (palm up). */
  talking: false,
  /** Vocab id the head is pointed at (14 degree cone), null when none or outside XR. */
  gazeItem: null as string | null,
};
