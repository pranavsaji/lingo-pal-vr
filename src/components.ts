/**
 * Component declarations (system-free, as the IWSDK editor imports this module).
 */

import { createComponent, defineComponents, Types } from '@iwsdk/core';

/** Marks a pinchable vocabulary object; `index` points into VOCAB. */
export const VocabItem = createComponent('VocabItem', {
  index: { type: Types.Int16, default: 0 },
});

/** A euro coin or note the learner can grab and drop on the payment tray. */
export const Coin = createComponent('Coin', {
  cents: { type: Types.Int16, default: 100, min: 10, max: 1000 },
  /** Index into CoinSystem's per-coin animation state. */
  slot: { type: Types.Int16, default: 0 },
});

export default defineComponents([VocabItem, Coin]);
