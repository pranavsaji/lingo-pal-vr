/**
 * Lingo Pal VR vocabulary for the cafe scene.
 * Each item is a pinchable object. `fr` includes the article so learners
 * hear gender from the start (le / la / l' / un / une).
 */

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
  | 'flower';

export interface VocabEntry {
  id: string;
  fr: string; // with article, as spoken
  en: string;
  tip: string; // short pronunciation or usage tip (ASCII-safe for the UI font)
  shape: ItemShape;
  color: number;
  position: [number, number, number];
}

// Counter top sits at y = 1.0 m, about 0.9 m in front of the player.
const C = 1.02;

export const VOCAB: VocabEntry[] = [
  { id: 'croissant', fr: 'le croissant', en: 'the croissant', tip: 'kwah-SAHN, silent t', shape: 'croissant', color: 0xd9a441, position: [-0.62, C, -0.95] },
  { id: 'cafe', fr: 'le café', en: 'the coffee', tip: 'ka-FAY, stress the end', shape: 'cup', color: 0xf3efe7, position: [-0.36, C, -0.9] },
  { id: 'baguette', fr: 'la baguette', en: 'the baguette', tip: 'ba-GET, feminine: la', shape: 'baguette', color: 0xc98a3c, position: [-0.08, C, -0.9] },
  { id: 'pomme', fr: 'la pomme', en: 'the apple', tip: 'POM, rhymes with "come"', shape: 'apple', color: 0xc8262c, position: [0.18, C, -0.88] },
  { id: 'orange', fr: "l'orange", en: 'the orange', tip: 'lo-RAHNJ, soft j sound', shape: 'orange', color: 0xf08a1c, position: [0.36, C, -0.96] },
  { id: 'fromage', fr: 'le fromage', en: 'the cheese', tip: 'fro-MAHJ', shape: 'cheese', color: 0xf2c94c, position: [0.58, C, -0.93] },
  { id: 'eau', fr: "la bouteille d'eau", en: 'the bottle of water', tip: "boo-TAY doh", shape: 'bottle', color: 0x5aa9e6, position: [0.82, C, -1.0] },
  { id: 'assiette', fr: "l'assiette", en: 'the plate', tip: 'lah-SYET', shape: 'plate', color: 0xffffff, position: [-0.86, C, -1.02] },
  { id: 'gateau', fr: 'le gâteau', en: 'the cake', tip: 'gah-TOH, final eau = oh', shape: 'cake', color: 0xf4a6c0, position: [1.32, 0.78, -0.62] },
  { id: 'verre', fr: 'le verre', en: 'the glass', tip: 'VAIR, rolled r', shape: 'glass', color: 0xbfe3f2, position: [1.08, 0.78, -0.78] },
  { id: 'menu', fr: 'la carte', en: 'the menu', tip: 'KART. "le menu" is a set meal', shape: 'menu', color: 0x7a2e2e, position: [1.18, 0.78, -0.42] },
  { id: 'fleur', fr: 'la fleur', en: 'the flower', tip: 'FLUR, round your lips', shape: 'flower', color: 0xe8457a, position: [-1.25, 0.78, -0.62] },
];

/** Missions for the first five minutes: find these items in order. */
export const MISSIONS: string[] = ['croissant', 'cafe', 'pomme', 'eau', 'gateau'];

export function vocabById(id: string): VocabEntry | undefined {
  return VOCAB.find((v) => v.id === id);
}
