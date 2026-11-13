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
  /** Renderer exposure for this shop (neutral tone mapping). */
  exposure?: number;
  floor: Surface;
  counterTop: Surface;
  counterFront: Surface;
  /** Back counter behind the shopkeeper (the photo backdrop is the rest of the room). */
  backTop: Surface;
  backFront: Surface;
  /** Accent color of the counter trim and awning. */
  accent: number;
  props: PropPlacement[];
}

const p = (id: string) => `prop-${id}`;

/** Top of the back counter behind the shopkeeper. */
const B = 0.93;
/** Depth of the back counter's top (props sit here, in front of the photo backdrop). */
const BZ = -2.2;

export const PLACE_LOOKS: Record<PlaceId, PlaceLook> = {
  cafe: {
    hdri: 'comfy_cafe',
    hdriYawDeg: 0,
    backdropIntensity: 1,
    iblIntensity: 0.9,
    floor: { tex: 'wood_floor', perMeter: 0.5, roughness: 0.55 },
    counterTop: { tex: 'marble_01', perMeter: 0.7, roughness: 0.25 },
    counterFront: { tex: 'dark_wood', perMeter: 0.9 },
    backTop: { tex: 'marble_01', perMeter: 0.7, roughness: 0.25 },
    backFront: { tex: 'dark_wood', perMeter: 0.9 },
    accent: 0xc9a227,
    props: [
      { model: p('wine_bottles_01'), pos: [-1.0, B, BZ] },
      { model: p('cafe_teapot'), pos: [0.55, B, BZ], scale: 1.3, rotY: -0.4 },
      { model: p('cafe_cup'), pos: [0.85, B, BZ + 0.05], rotY: 0.6 },
      { model: p('ceramic_vase_01'), pos: [1.15, B, BZ], scale: 0.6 },
      { model: p('3DPastry003'), pos: [-0.35, B, BZ], rotY: 0.3 },
      { model: p('hanging_industrial_lamp'), pos: [-0.75, 3.45, -1.25], scale: 0.55 },
      { model: p('hanging_industrial_lamp'), pos: [0.85, 3.45, -1.25], scale: 0.55 },
      { model: p('painted_wooden_chair_01'), pos: [1.78, 0, -0.42], rotY: -1.9 },
      { model: p('painted_wooden_chair_01'), pos: [-1.82, 0, -0.42], rotY: 1.9 },
    ],
  },
  boulangerie: {
    hdri: 'decor_shop',
    hdriYawDeg: 0,
    backdropIntensity: 0.85, // the photo's windows are bright: keep the room from looking washed out
    iblIntensity: 1,
    floor: { tex: 'old_wood_floor', perMeter: 0.6, roughness: 0.65 },
    counterTop: { tex: 'oak_veneer_01', perMeter: 1.2, roughness: 0.45 },
    counterFront: { tex: 'dark_wood', perMeter: 0.9 },
    backTop: { tex: 'oak_veneer_01', perMeter: 1.2, roughness: 0.45 },
    backFront: { tex: 'dark_wood', perMeter: 0.9 },
    accent: 0xe8d8b0,
    props: [
      { model: p('wicker_basket_01'), pos: [-0.95, B, BZ], scale: 1.1 },
      { model: p('3DBread006'), pos: [-1.02, B + 0.02, BZ], rotY: 0.4 },
      { model: p('3DBread003'), pos: [-0.86, B + 0.02, BZ + 0.03], rotY: 2.1 },
      { model: p('wicker_basket_01'), pos: [-0.3, B, BZ], scale: 1.1, rotY: 0.3 },
      { model: p('3DBread010'), pos: [-0.36, B + 0.02, BZ], rotY: 1.2 },
      { model: p('3DBread004'), pos: [-0.22, B + 0.02, BZ + 0.02] },
      { model: p('3DBread011'), pos: [0.35, B, BZ + 0.04], scale: 2.2, rotY: 0.1 },
      { model: p('3DBread011'), pos: [0.38, B, BZ - 0.05], scale: 2.2, rotY: -0.08 },
      { model: p('3DPastry003'), pos: [0.85, B, BZ] },
      { model: p('carrot_cake'), pos: [1.2, B, BZ] },
      { model: p('hanging_industrial_lamp'), pos: [-0.75, 3.45, -1.25], scale: 0.55 },
      { model: p('hanging_industrial_lamp'), pos: [0.85, 3.45, -1.25], scale: 0.55 },
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
    backTop: { tex: 'wood_table_worn', perMeter: 0.8, roughness: 0.75 },
    backFront: { tex: 'wood_table_worn', perMeter: 0.8, roughness: 0.75 },
    accent: 0x2a7d4f,
    props: [
      { model: p('wooden_crate_01'), pos: [-1.0, 0, -1.55], scale: 0.9 },
      { model: p('wooden_crate_01'), pos: [-1.0, 0.31, -1.55], scale: 0.9, rotY: 0.08 },
      { model: p('bananas'), pos: [-1.05, 0.63, -1.55], scale: 0.9 },
      { model: p('wooden_crate_01'), pos: [1.05, 0, -1.55], scale: 0.9, rotY: -0.05 },
      { model: p('food_pears_asian_01'), pos: [0.95, 0.32, -1.55], scale: 1.2 },
      { model: p('food_pears_asian_01'), pos: [1.2, 0.32, -1.5], scale: 1.2, rotY: 2 },
      { model: p('wicker_basket_01'), pos: [-0.5, B, BZ], scale: 1.2 },
      { model: p('yellow_onion'), pos: [-0.55, B + 0.025, BZ] },
      { model: p('yellow_onion'), pos: [-0.45, B + 0.025, BZ + 0.02] },
      { model: p('wicker_basket_01'), pos: [0.5, B, BZ], scale: 1.2 },
      { model: p('lemon'), pos: [0.45, B + 0.075, BZ] },
      { model: p('lemon'), pos: [0.55, B + 0.075, BZ + 0.02] },
      { model: p('food_pomegranate_01'), pos: [-1.0, B, BZ] },
      { model: p('food_avocado_01'), pos: [1.0, B, BZ] },
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
