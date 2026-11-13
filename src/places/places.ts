/**
 * The Paris map: which shops exist, when they open, and how each one looks.
 * Menus, prices and shopkeepers live in shared/places.json (shared with the
 * AI server); the words on display live in src/vocab.ts (PLACE_VOCAB).
 *
 * Every shop shares the counter layout (seat, tray, coin dish, shopkeeper
 * spot), so payment, hands, voice and the agent work the same everywhere.
 */

import type { PlaceId } from '../game-state.js';
import type { Profile } from '../state/profile.js';

export const PLACE_ORDER: PlaceId[] = ['cafe', 'boulangerie', 'marche'];

/**
 * Shops open fast enough that a first-time visitor (or a judge) sees all three
 * within minutes: the bakery after the first-run tutorial, the market after
 * the first paid order.
 */
export function placeUnlocked(place: PlaceId, p: Pick<Profile, 'onboarded' | 'stats'>): boolean {
  if (place === 'cafe') return true;
  if (place === 'boulangerie') return p.onboarded;
  return p.onboarded && p.stats.orders >= 1;
}

export function unlockHint(place: PlaceId): { fr: string; en: string } {
  return place === 'boulangerie'
    ? { fr: 'Après le tutoriel', en: 'Opens after the tutorial' }
    : { fr: 'Après votre première commande', en: 'Opens after your first paid order' };
}

/** A PBR surface from public/textures/<id>/ with a tiling density (repeats per meter). */
export interface Surface {
  tex: string;
  perMeter: number;
  roughness?: number;
  tint?: number;
}

export interface PropPlacement {
  model: string; // manifest id (prop-*)
  pos: [number, number, number];
  rotY?: number;
  scale?: number;
  /** Stays visible in mixed reality (on the counter), otherwise hidden with the room. */
  keepInMr?: boolean;
}

export interface PlaceLook {
  /** Poly Haven environment: <id>_bg.jpg is the 360 backdrop, <id>_1k.hdr lights the scene. */
  hdri: string;
  /** Yaw of the backdrop in degrees (turns the photo so the shop interior is behind the counter). */
  hdriYawDeg: number;
  backdropIntensity: number;
  iblIntensity: number;
  floor: Surface;
  counterTop: Surface;
  counterFront: Surface;
  wall: Surface | null;
  shelf: Surface;
  /** Accent color of the counter trim and awning. */
  accent: number;
  props: PropPlacement[];
}

const p = (id: string) => `prop-${id}`;

export const PLACE_LOOKS: Record<PlaceId, PlaceLook> = {
  cafe: {
    hdri: 'comfy_cafe',
    hdriYawDeg: 0,
    backdropIntensity: 1,
    iblIntensity: 0.9,
    floor: { tex: 'checkered_pavement_tiles', perMeter: 0.6, roughness: 0.45 },
    counterTop: { tex: 'marble_01', perMeter: 0.7, roughness: 0.25 },
    counterFront: { tex: 'dark_wood', perMeter: 0.9 },
    wall: { tex: 'red_brick_plaster_patch_02', perMeter: 0.45 },
    shelf: { tex: 'oak_veneer_01', perMeter: 1 },
    accent: 0xc9a227,
    props: [
      { model: p('wine_bottles_01'), pos: [-0.95, 1.315, -2.45] },
      { model: p('wine_bottles_01'), pos: [0.35, 1.765, -2.45], rotY: Math.PI },
      { model: p('hanging_industrial_lamp'), pos: [-0.75, 3.45, -1.25], scale: 0.55 },
      { model: p('hanging_industrial_lamp'), pos: [0.85, 3.45, -1.25], scale: 0.55 },
      { model: p('painted_wooden_chair_01'), pos: [1.78, 0, -0.42], rotY: -1.9 },
      { model: p('painted_wooden_chair_01'), pos: [-1.82, 0, -0.42], rotY: 1.9 },
      { model: p('ceramic_vase_01'), pos: [1.55, 1.315, -2.42], scale: 0.6 },
    ],
  },
  boulangerie: {
    hdri: 'decor_shop',
    hdriYawDeg: 0,
    backdropIntensity: 1,
    iblIntensity: 1,
    floor: { tex: 'terracotta_floor_tiles', perMeter: 0.8, roughness: 0.7 },
    counterTop: { tex: 'oak_veneer_01', perMeter: 1.2, roughness: 0.45 },
    counterFront: { tex: 'dark_wood', perMeter: 0.9 },
    wall: { tex: 'red_brick_plaster_patch_02', perMeter: 0.45 },
    shelf: { tex: 'oak_veneer_01', perMeter: 1 },
    accent: 0xe8d8b0,
    props: [
      { model: p('wicker_basket_01'), pos: [-0.9, 1.315, -2.42], scale: 1.1 },
      { model: p('hamburger_buns'), pos: [-0.9, 1.34, -2.42], scale: 0.9 },
      { model: p('wicker_basket_01'), pos: [0.2, 1.315, -2.42], scale: 1.1, rotY: 0.3 },
      { model: p('carrot_cake'), pos: [0.95, 1.315, -2.42] },
      { model: p('wicker_basket_01'), pos: [-0.4, 1.765, -2.42], scale: 1.1 },
      { model: p('croissant'), pos: [-0.45, 1.79, -2.42], rotY: 0.6 },
      { model: p('croissant'), pos: [-0.35, 1.79, -2.38], rotY: 2.2 },
      { model: p('strawberry_chocolate_cake'), pos: [0.75, 1.765, -2.42], scale: 0.9 },
      { model: p('hanging_industrial_lamp'), pos: [-0.75, 3.45, -1.25], scale: 0.55 },
      { model: p('hanging_industrial_lamp'), pos: [0.85, 3.45, -1.25], scale: 0.55 },
      { model: p('potted_plant_01'), pos: [2.0, 0, -1.7], rotY: 1.4, scale: 0.85 },
    ],
  },
  marche: {
    hdri: 'leadenhall_market',
    hdriYawDeg: 0,
    backdropIntensity: 1,
    iblIntensity: 1,
    floor: { tex: 'cobblestone_floor_04', perMeter: 0.7, roughness: 0.85 },
    counterTop: { tex: 'wood_table_worn', perMeter: 0.8, roughness: 0.75 },
    counterFront: { tex: 'wood_table_worn', perMeter: 0.8, roughness: 0.75 },
    wall: null,
    shelf: { tex: 'wood_table_worn', perMeter: 1 },
    accent: 0x2a7d4f,
    props: [
      { model: p('wooden_crate_01'), pos: [-1.0, 0, -1.55], scale: 0.9 },
      { model: p('wooden_crate_01'), pos: [-1.0, 0.31, -1.55], scale: 0.9, rotY: 0.08 },
      { model: p('bananas'), pos: [-1.05, 0.63, -1.55], scale: 0.9 },
      { model: p('wooden_crate_01'), pos: [1.05, 0, -1.55], scale: 0.9, rotY: -0.05 },
      { model: p('food_pears_asian_01'), pos: [0.95, 0.32, -1.55], scale: 1.2 },
      { model: p('food_pears_asian_01'), pos: [1.2, 0.32, -1.5], scale: 1.2, rotY: 2 },
      { model: p('wicker_basket_01'), pos: [-0.5, 1.315, -2.42], scale: 1.2 },
      { model: p('yellow_onion'), pos: [-0.55, 1.34, -2.42] },
      { model: p('yellow_onion'), pos: [-0.45, 1.34, -2.4] },
      { model: p('wicker_basket_01'), pos: [0.5, 1.315, -2.42], scale: 1.2 },
      { model: p('lemon'), pos: [0.45, 1.39, -2.42] },
      { model: p('lemon'), pos: [0.55, 1.39, -2.4] },
      { model: p('food_pomegranate_01'), pos: [-0.6, 1.765, -2.42] },
      { model: p('food_avocado_01'), pos: [0.6, 1.765, -2.42] },
    ],
  },
};

/** All manifest ids a shop needs (props + the realistic items on display). */
export function placeModelIds(place: PlaceId, vocabModels: (string | undefined)[]): string[] {
  const ids = new Set<string>();
  for (const prop of PLACE_LOOKS[place].props) ids.add(prop.model);
  for (const m of vocabModels) if (m) ids.add(m);
  return [...ids];
}
