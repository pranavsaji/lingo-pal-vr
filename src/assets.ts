/**
 * Asset manifest shared by the runtime and the IWSDK editor.
 * Deterministic and side-effect free (evaluated twice, in two realms).
 */

import { AssetType, defineAssets } from '@iwsdk/core';
import { createStudioFloor } from './scene-assets/studio.scene-asset.js';
import { createParisDiorama } from './scene-assets/paris-diorama.scene-asset.js';
import { createPal } from './scene-assets/pal.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

/** Realistic CC0 props from Poly Haven (scripts/fetch-assets.mjs). Loaded per shop, on demand. */
const PROP_IDS = [
  'croissant', 'food_apple_01', 'strawberry_chocolate_cake', 'wine_bottles_01', 'potted_plant_01',
  'ceramic_vase_01', 'round_wooden_table_01', 'painted_wooden_chair_01', 'standing_chalkboard_01',
  'hanging_industrial_lamp', 'carrot_cake', 'hamburger_buns', 'wooden_cutting_board', 'wicker_basket_01',
  'wooden_crate_01', 'bananas', 'food_pears_asian_01', 'lemon', 'yellow_onion', 'sweet_potato',
  'food_kiwi_01', 'food_avocado_01', 'food_pomegranate_01',
  // Derived from Poly Haven tea_set_01; photo-scanned breads and pastries from ambientCG (CC0).
  'cafe_cup', 'cafe_plate', 'cafe_teapot',
  '3DBread011', '3DBread007', '3DBread004', '3DBread006', '3DBread003', '3DBread010',
  '3DPastry001', '3DPastry002', '3DPastry003',
  // Objaverse / Sketchfab, CC-BY 4.0 (scripts/fetch-objaverse.mjs; credits in CREDITS.md).
  'orange', 'eclair', 'cherry_tart', 'water_bottle', 'wine_glass', 'orchid',
] as const;

const props = Object.fromEntries(
  PROP_IDS.map((id) => [`prop-${id}`, { url: publicAssetUrl(`models/props/${id}.glb`), type: AssetType.GLTF, priority: 'lazy' as const, name: id }]),
);

// --- BEGIN shopkeeper characters (owned by src/world/npc-system.ts) ---
/**
 * Rigged Microsoft Rocketbox avatars (MIT, public/models/characters/LICENSE-Rocketbox.txt),
 * one per shop. Madame Lune streams in at startup without blocking it; the others load
 * when the learner first visits their shop (NpcSystem also prefetches them once Lune is up).
 */
const shopkeeper = (fileName: string, name: string, priority: 'background' | 'lazy') => ({
  url: publicAssetUrl(`models/characters/${fileName}`),
  type: AssetType.GLTF,
  priority,
  name,
});
const shopkeepers = {
  'shopkeeper-lune': shopkeeper('lune.glb', 'Madame Lune', 'background'),
  'shopkeeper-paul': shopkeeper('paul.glb', 'Monsieur Paul', 'lazy'),
  'shopkeeper-rose': shopkeeper('rose.glb', 'Madame Rose', 'lazy'),
  'shopkeeper-marcel': shopkeeper('marcel.glb', 'Monsieur Marcel', 'lazy'),
  'shopkeeper-karim': shopkeeper('karim.glb', 'Monsieur Karim', 'lazy'),
  'shopkeeper-ines': shopkeeper('ines.glb', 'Madame Inès', 'lazy'),
  'shopkeeper-claire': shopkeeper('claire.glb', 'Madame Claire', 'lazy'),
  // Background customers (src/world/customers-system.ts): loaded per shop, after its shopkeeper.
  'customer-m03': shopkeeper('customer-m03.glb', 'Customer (Male_Adult_03)', 'lazy'),
  'customer-f14': shopkeeper('customer-f14.glb', 'Customer (Female_Adult_14)', 'lazy'),
  'customer-m08': shopkeeper('customer-m08.glb', 'Customer (Male_Adult_08)', 'lazy'),
  'customer-f09': shopkeeper('customer-f09.glb', 'Customer (Female_Adult_09)', 'lazy'),
  'customer-m12': shopkeeper('customer-m12.glb', 'Customer (Male_Adult_12)', 'lazy'),
  'customer-f07': shopkeeper('customer-f07.glb', 'Customer (Female_Adult_07)', 'lazy'),
};
// --- END shopkeeper characters ---

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'studio-floor': createStudioFloor(),
  'paris-diorama': createParisDiorama(), // Plan de Paris (DioramaSystem places it on the counter)
  'pal-companion': createPal(), // Pal, the English-speaking companion (PalSystem builds its own animated instance)
  'lesson-panel': uikitml('lesson.uikitml', 'Lesson Panel'),
  'chat-panel': uikitml('chat.uikitml', 'Chat Panel'),
  'carnet-panel': uikitml('carnet.uikitml', 'Carnet Panel'),
  'settings-panel': uikitml('settings.uikitml', 'Settings Panel'),
  'map-panel': uikitml('map.uikitml', 'Map Panel'),
  'report-panel': uikitml('report.uikitml', 'Report Panel'),
  'passport-panel': uikitml('passport.uikitml', 'Passport Panel'),
  ...props,
  ...shopkeepers, // shopkeeper characters (see block above)
});
