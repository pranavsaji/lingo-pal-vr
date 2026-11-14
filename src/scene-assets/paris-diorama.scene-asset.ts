/**
 * Plan de Paris diorama prototype for the manifest (editor preview and
 * inspection). At runtime DioramaSystem places a clone of the same memoized
 * build on the counter when the map opens; see src/models/paris-diorama.ts.
 */

import type { Group } from '@iwsdk/core';
import { buildParisDiorama } from '../models/paris-diorama.js';

export function createParisDiorama(): Group {
  return buildParisDiorama();
}
