/**
 * Lingo Pal VR vocabulary for the cafe scene.
 * Each item is a pinchable object. `fr` includes the article so learners
 * hear gender from the start (le / la / l' / un / une).
 */

import type { PlaceId } from './game-state.js';
import type { PlaceItemShape } from './models/place-items.js';

export type ItemShape =
  | 'croissant'
  | 'cup'
  | 'baguette'
  | 'apple'
  | 'orange'
  | 'cheese'
  | 'bottle'
  | 'plate'
  | 'cake'
  | 'glass'
  | 'menu'
  | 'flower'
  | 'pain_chocolat'
  | 'eclair'
  | 'macaron'
  | 'tart'
  | 'model'
  | PlaceItemShape;

export interface VocabEntry {
  id: string;
  fr: string; // with article, as spoken
  en: string;
  tip: string; // short pronunciation or usage tip (ASCII-safe for the UI font)
  shape: ItemShape;
  color: number;
  position: [number, number, number];
  /** Realistic model (asset manifest id). Falls back to `shape` until it has loaded. */
  model?: string;
  /** Uniform scale and vertical offset applied to the model. */
  modelScale?: number;
  modelY?: number;
  /** Yaw in radians. */
  rotY?: number;
}

// Counter top sits at y = 1.0 m, about 0.9 m in front of the player.
const C = 1.0; // models are grounded (lowest point on the counter top) in item-system
const T = 0.765; // side tables: top of the bistro table (0.75 + half its 0.03 thickness)

/** Display spots shared by every shop: eight along the counter, four on the side tables. */
export const SLOTS: [number, number, number][] = [
  [-0.62, C, -0.95], [-0.36, C, -0.9], [-0.08, C, -0.9], [0.18, C, -0.88],
  [0.36, C, -0.96], [0.58, C, -0.93], [0.98, C, -0.94], [-0.86, C, -1.02],
  [1.32, T, -0.62], [1.08, T, -0.78], [1.18, T, -0.42], [-1.25, T, -0.62],
];

const prop = (id: string) => `prop-${id}`;

export const PLACE_VOCAB: Record<PlaceId, VocabEntry[]> = {
  cafe: [
    { id: 'croissant', fr: 'le croissant', en: 'the croissant', tip: 'kwah-SAHN, silent t', shape: 'croissant', color: 0xd9a441, position: SLOTS[0], model: prop('croissant'), rotY: 0.4 },
    { id: 'cafe', fr: 'le café', en: 'the coffee', tip: 'ka-FAY, stress the end', shape: 'cup', color: 0xf3efe7, position: SLOTS[1], model: prop('cafe_cup'), rotY: 0.5 },
    { id: 'baguette', fr: 'la baguette', en: 'the baguette', tip: 'ba-GET, feminine: la', shape: 'baguette', color: 0xc98a3c, position: SLOTS[2], model: prop('3DBread011'), modelScale: 1.9, rotY: 0.35 },
    { id: 'pomme', fr: 'la pomme', en: 'the apple', tip: 'POM, rhymes with "come"', shape: 'apple', color: 0xc8262c, position: SLOTS[3], model: prop('food_apple_01') },
    { id: 'orange', fr: "l'orange", en: 'the orange', tip: 'lo-RAHNJ, soft j sound', shape: 'orange', color: 0xf08a1c, position: SLOTS[4], model: prop('orange') },
    { id: 'fromage', fr: 'le fromage', en: 'the cheese', tip: 'fro-MAHJ', shape: 'cheese', color: 0xf2c94c, position: SLOTS[5] },
    { id: 'eau', fr: "la bouteille d'eau", en: 'the bottle of water', tip: 'boo-TAY doh', shape: 'bottle', color: 0x5aa9e6, position: SLOTS[6], model: prop('water_bottle') },
    { id: 'assiette', fr: "l'assiette", en: 'the plate', tip: 'lah-SYET', shape: 'plate', color: 0xffffff, position: SLOTS[7], model: prop('cafe_plate') },
    { id: 'gateau', fr: 'le gâteau', en: 'the cake', tip: 'gah-TOH, final eau = oh', shape: 'cake', color: 0xf4a6c0, position: SLOTS[8], model: prop('strawberry_chocolate_cake'), modelScale: 0.85 },
    { id: 'verre', fr: 'le verre', en: 'the glass', tip: 'VAIR, rolled r', shape: 'glass', color: 0xbfe3f2, position: SLOTS[9], model: prop('wine_glass') },
    { id: 'menu', fr: 'la carte', en: 'the menu', tip: 'KART. "le menu" is a set meal', shape: 'menu', color: 0x7a2e2e, position: SLOTS[10] },
    { id: 'fleur', fr: 'la fleur', en: 'the flower', tip: 'FLUR, round your lips', shape: 'flower', color: 0xe8457a, position: SLOTS[11], model: prop('orchid') },
  ],
  boulangerie: [
    { id: 'baguette', fr: 'la baguette', en: 'the baguette', tip: 'ba-GET, feminine: la', shape: 'baguette', color: 0xc98a3c, position: SLOTS[2], model: prop('3DBread011'), modelScale: 1.9, rotY: 0.35 },
    { id: 'croissant', fr: 'le croissant', en: 'the croissant', tip: 'kwah-SAHN, silent t', shape: 'croissant', color: 0xd9a441, position: SLOTS[0], model: prop('3DPastry001'), modelScale: 1.2, rotY: 0.4 },
    { id: 'pain_chocolat', fr: 'le pain au chocolat', en: 'the chocolate croissant', tip: 'pan oh sho-ko-LAH', shape: 'pain_chocolat', color: 0xcf8f3e, position: SLOTS[1], model: prop('3DPastry002'), modelScale: 0.8, rotY: 1.57 },
    { id: 'petit_pain', fr: 'le petit pain', en: 'the bread roll', tip: 'puh-tee PAN, nasal an', shape: 'model', color: 0xd9a441, position: SLOTS[3], model: prop('3DBread007'), rotY: 0.3 },
    { id: 'eclair', fr: "l'éclair", en: 'the eclair', tip: 'ay-KLAIR', shape: 'eclair', color: 0xd9a86c, position: SLOTS[4], model: prop('eclair'), rotY: 0.6 },
    { id: 'macaron', fr: 'le macaron', en: 'the macaron', tip: 'ma-ka-ROHN, not macaroon', shape: 'macaron', color: 0xf4a6c0, position: SLOTS[5] },
    { id: 'tarte', fr: 'la tarte aux cerises', en: 'the cherry tart', tip: 'tart oh suh-REEZ', shape: 'tart', color: 0xd9a441, position: SLOTS[6], model: prop('cherry_tart'), modelScale: 0.8 },
    { id: 'planche', fr: 'la planche', en: 'the board', tip: 'PLAHNSH, nasal an', shape: 'model', color: 0x8a5a35, position: SLOTS[7], model: prop('wooden_cutting_board'), modelScale: 0.6 },
    { id: 'gateau', fr: 'le gâteau', en: 'the cake', tip: 'gah-TOH, final eau = oh', shape: 'cake', color: 0xf4a6c0, position: SLOTS[8], model: prop('strawberry_chocolate_cake'), modelScale: 0.85 },
    { id: 'panier', fr: 'le panier', en: 'the basket', tip: 'pan-YAY', shape: 'model', color: 0xb08850, position: SLOTS[11], model: prop('wicker_basket_01'), modelScale: 0.8 },
  ],
  marche: [
    { id: 'pomme', fr: 'la pomme', en: 'the apple', tip: 'POM, rhymes with "come"', shape: 'apple', color: 0xc8262c, position: SLOTS[0], model: prop('food_apple_01') },
    { id: 'poire', fr: 'la poire', en: 'the pear', tip: 'PWAHR', shape: 'model', color: 0xc9b458, position: SLOTS[1], model: prop('food_pears_asian_01') },
    { id: 'banane', fr: 'la banane', en: 'the banana', tip: 'ba-NAN', shape: 'model', color: 0xf2d04c, position: SLOTS[2], model: prop('bananas'), modelScale: 0.5, rotY: 0.2 },
    { id: 'citron', fr: 'le citron', en: 'the lemon', tip: 'see-TROHN, nasal on', shape: 'model', color: 0xf2e04c, position: SLOTS[3], model: prop('lemon'), modelY: 0.052 },
    { id: 'kiwi', fr: 'le kiwi', en: 'the kiwi', tip: 'kee-WEE', shape: 'model', color: 0x8a6a3a, position: SLOTS[4], model: prop('food_kiwi_01') },
    { id: 'avocat', fr: "l'avocat", en: 'the avocado', tip: 'la-vo-KAH (also "lawyer")', shape: 'model', color: 0x2f4a24, position: SLOTS[5], model: prop('food_avocado_01') },
    { id: 'oignon', fr: "l'oignon", en: 'the onion', tip: 'lo-NYOHN, the i is silent', shape: 'model', color: 0xc9883a, position: SLOTS[6], model: prop('yellow_onion') },
    { id: 'patate_douce', fr: 'la patate douce', en: 'the sweet potato', tip: 'pa-TAT DOOS', shape: 'model', color: 0x9a4a3a, position: SLOTS[7], model: prop('sweet_potato'), modelY: 0.052, rotY: 1.2 },
    { id: 'grenade', fr: 'la grenade', en: 'the pomegranate', tip: 'gruh-NAD', shape: 'model', color: 0x9a1a2a, position: SLOTS[9], model: prop('food_pomegranate_01') },
    { id: 'cageot', fr: 'le cageot', en: 'the crate', tip: 'ka-ZHOH', shape: 'model', color: 0x8a6a45, position: SLOTS[8], model: prop('wooden_crate_01'), modelScale: 0.45 },
    { id: 'panier', fr: 'le panier', en: 'the basket', tip: 'pan-YAY', shape: 'model', color: 0xb08850, position: SLOTS[11], model: prop('wicker_basket_01'), modelScale: 0.8 },
  ],
  bistrot: [
    { id: 'plat_du_jour', fr: 'le plat du jour', en: 'the dish of the day', tip: 'pla du ZHOOR, silent t', shape: 'plat', color: 0x6b3a22, position: SLOTS[0] },
    { id: 'soupe', fr: "la soupe à l'oignon", en: 'the onion soup', tip: "SOOP a lo-NYOHN", shape: 'soupe', color: 0xb8743a, position: SLOTS[1] },
    { id: 'salade', fr: 'la salade', en: 'the salad', tip: 'sa-LAD', shape: 'salade', color: 0x5fae3b, position: SLOTS[2] },
    { id: 'crepe', fr: 'la crêpe', en: 'the crepe', tip: 'KREP, short e', shape: 'crepe', color: 0xe0a95b, position: SLOTS[3] },
    { id: 'jus_orange', fr: "le jus d'orange", en: 'the orange juice', tip: 'zhoo do-RAHNJ, silent s', shape: 'jus', color: 0xf39a1d, position: SLOTS[4] },
    { id: 'eau', fr: "la bouteille d'eau", en: 'the bottle of water', tip: 'boo-TAY doh', shape: 'bottle', color: 0x5aa9e6, position: SLOTS[5], model: prop('water_bottle') },
    { id: 'carafe', fr: "la carafe d'eau", en: 'the jug of tap water', tip: 'ka-RAF doh. Free in every restaurant!', shape: 'carafe', color: 0xcfe8f2, position: SLOTS[6] },
    { id: 'addition', fr: "l'addition", en: 'the bill', tip: 'la-dee-SYOHN. "L\'addition, s\'il vous plait !"', shape: 'addition', color: 0xfbfaf6, position: SLOTS[9] },
  ],
  metro: [
    { id: 'ticket', fr: 'le ticket', en: 'the ticket', tip: 'tee-KAY, silent t', shape: 'ticket', color: 0xf2efe6, position: SLOTS[1] },
    { id: 'carnet', fr: 'le carnet de tickets', en: 'the book of 10 tickets', tip: 'kar-NAY, silent t', shape: 'carnet', color: 0xf2efe6, position: SLOTS[2] },
    { id: 'forfait_jour', fr: "le forfait d'une journée", en: 'the day pass', tip: 'for-FAY dune zhoor-NAY', shape: 'forfait', color: 0x2f6db5, position: SLOTS[3] },
    { id: 'plan_metro', fr: 'le plan du métro', en: 'the metro map', tip: 'plahn du may-TRO', shape: 'plan_metro', color: 0xece6d6, position: SLOTS[4] },
  ],
  pharmacie: [
    { id: 'pansements', fr: 'la boîte de pansements', en: 'the box of plasters', tip: 'pahns-MAHN, nasal an', shape: 'pansements', color: 0xf7f7f4, position: SLOTS[0] },
    { id: 'creme_solaire', fr: 'la crème solaire', en: 'the sunscreen', tip: 'krem so-LAIR', shape: 'creme', color: 0xf6a623, position: SLOTS[1] },
    { id: 'mouchoirs', fr: 'le paquet de mouchoirs', en: 'the pack of tissues', tip: 'moo-SHWAR', shape: 'mouchoirs', color: 0xdfeef8, position: SLOTS[2] },
    { id: 'sirop', fr: 'le sirop pour la toux', en: 'the cough syrup', tip: 'see-RO poor la TOO, silent p and x', shape: 'sirop', color: 0x7a3d12, position: SLOTS[4] },
    { id: 'paracetamol', fr: 'la boîte de paracétamol', en: 'the box of paracetamol', tip: 'pa-ra-say-ta-MOL', shape: 'paracetamol', color: 0xf7f7f4, position: SLOTS[5] },
  ],
  hotel: [
    { id: 'nuit', fr: 'la nuit', en: 'the night (the room key)', tip: 'NWEE. "Deux nuits": hold up two fingers', shape: 'nuit', color: 0xc9a227, position: SLOTS[1] },
    { id: 'petit_dejeuner', fr: 'le petit-déjeuner', en: 'the breakfast', tip: 'puh-tee day-zhuh-NAY', shape: 'petit_dej', color: 0xe0a95b, position: SLOTS[2] },
    { id: 'plan_ville', fr: 'le plan de la ville', en: 'the city map', tip: 'plahn duh la VEEL', shape: 'plan_ville', color: 0xf6f1e4, position: SLOTS[3] },
    { id: 'carte_postale', fr: 'la carte postale', en: 'the postcard', tip: 'kart pos-TAL', shape: 'carte_postale', color: 0xf2a65a, position: SLOTS[4] },
    { id: 'parapluie', fr: 'le parapluie', en: 'the umbrella', tip: 'pa-ra-PLWEE', shape: 'parapluie', color: 0x1f3b63, position: SLOTS[5] },
    { id: 'sonnette', fr: 'la sonnette', en: 'the desk bell', tip: 'so-NET. Ding!', shape: 'sonnette', color: 0xd9b54a, position: SLOTS[6] },
  ],
};

/** The words of the shop the learner is in (mutated in place by setVocabPlace). */
export const VOCAB: VocabEntry[] = [...PLACE_VOCAB.cafe];

/** Missions per shop: find these items in order. */
const PLACE_MISSIONS: Record<PlaceId, string[]> = {
  cafe: ['croissant', 'cafe', 'pomme', 'eau', 'gateau'],
  boulangerie: ['baguette', 'croissant', 'pain_chocolat', 'macaron', 'tarte'],
  marche: ['pomme', 'banane', 'citron', 'avocat', 'grenade'],
  bistrot: ['plat_du_jour', 'soupe', 'crepe', 'carafe', 'addition'],
  metro: ['ticket', 'carnet', 'forfait_jour', 'plan_metro'],
  pharmacie: ['pansements', 'mouchoirs', 'sirop', 'creme_solaire', 'paracetamol'],
  hotel: ['sonnette', 'nuit', 'petit_dejeuner', 'plan_ville', 'parapluie'],
};
export const MISSIONS: string[] = [...PLACE_MISSIONS.cafe];

export function setVocabPlace(place: PlaceId): void {
  VOCAB.splice(0, VOCAB.length, ...PLACE_VOCAB[place]);
  MISSIONS.splice(0, MISSIONS.length, ...PLACE_MISSIONS[place]);
}

/** Any word from any shop (the Carnet and spaced repetition span all shops). */
export function vocabById(id: string): VocabEntry | undefined {
  return VOCAB.find((v) => v.id === id) ?? Object.values(PLACE_VOCAB).flat().find((v) => v.id === id);
}
