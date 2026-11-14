/**
 * Pal companion prototype for the manifest (editor preview and inspection).
 * At runtime PalSystem builds its own instance (src/models/pal-model.ts) so it
 * can animate the eyes, bob and glow ring.
 */

import type { Group } from '@iwsdk/core';
import { buildPal } from '../models/pal-model.js';

export function createPal(): Group {
  const { root, ring } = buildPal();
  ring.visible = true; // show the glow in previews
  return root;
}
