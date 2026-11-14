/**
 * Who stands behind each shop counter. Every shop shares the counter layout, so
 * the shopkeepers share a spot and behaviours; only the avatar changes.
 * Avatars: Microsoft Rocketbox (MIT), converted to public/models/characters/*.glb.
 */

import type { PlaceId } from '../../game-state.js';
import type { HumanRigOptions } from './human-rig.js';

export interface ShopkeeperSpec {
  /** Manifest id in src/assets.ts. */
  assetId: string;
  /** Display / scene-graph name. */
  name: string;
  /** Rocketbox source avatar (for credits and diagnostics). */
  source: string;
  rig: HumanRigOptions;
}

export const SHOPKEEPERS: Record<PlaceId, ShopkeeperSpec> = {
  cafe: { assetId: 'shopkeeper-lune', name: 'Madame Lune', source: 'Female_Adult_05', rig: {} },
  boulangerie: { assetId: 'shopkeeper-paul', name: 'Monsieur Paul', source: 'Male_Adult_05', rig: { armClearance: 0.12 } },
  marche: { assetId: 'shopkeeper-rose', name: 'Madame Rose', source: 'Female_Adult_02', rig: {} },
  bistrot: { assetId: 'shopkeeper-marcel', name: 'Monsieur Marcel', source: 'Business_Male_04', rig: {} },
  metro: { assetId: 'shopkeeper-karim', name: 'Monsieur Karim', source: 'Male_Adult_07', rig: { armClearance: 0.11 } },
  pharmacie: { assetId: 'shopkeeper-ines', name: 'Madame Inès', source: 'Medical_Female_01', rig: {} },
};

/** Where every shopkeeper stands (behind the counter, facing the learner along +Z). */
export const SHOPKEEPER_POS: readonly [number, number, number] = [0.15, 0, -1.65];
