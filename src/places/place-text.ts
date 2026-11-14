/**
 * How each shop is named in a sentence ("bienvenue au marché", "à la pharmacie"),
 * the words that send the learner there by voice, and the shop's everyday reply
 * suggestions. One table so a new shop is added in one place. Pure data.
 */

import type { PlaceId } from '../game-state.js';

export interface Line {
  fr: string;
  en: string;
}

export interface PlaceText {
  /** "Bienvenue ___" / "Welcome ___". */
  to: Line;
  /** "C'est ___ !" / "Try ___!" (and "deux baguettes ___"). */
  at: Line;
  /** Voice-command feedback when travelling there. */
  go: string;
  /** Normalized words (no accents) that name the shop, French and English. */
  words: RegExp;
  /** An order with a number, for finger counting ("Deux croissants, s'il vous plaît."). */
  count: Line;
  /** A one-more-thing reply while ordering ("Et un café aussi."). */
  more: Line;
  /** A reply after paying ("Encore un café, s'il vous plaît."). */
  again: Line;
  /** What to try saying when stuck ("un café, s'il vous plaît"). */
  example: Line;
  /** How to ask for the bill here. */
  bill: Line;
  /** A small-talk reply this shop's keeper answers (the offline script too), if any. */
  talk?: Line;
}

const HOW_MUCH: Line = { fr: "C'est combien ?", en: 'How much is it?' };

export const PLACE_TEXT: Record<PlaceId, PlaceText> = {
  cafe: {
    to: { fr: 'au Café Lune', en: 'to Café Lune' },
    at: { fr: 'au café', en: 'at the café' },
    go: 'Au café',
    words: /\b(cafe|coffee shop)\b/,
    count: { fr: "Deux croissants, s'il vous plaît.", en: 'Two croissants, please.' },
    more: { fr: 'Et un café aussi.', en: 'And a coffee too.' },
    again: { fr: "Encore un café, s'il vous plaît.", en: 'Another coffee, please.' },
    example: { fr: "un café, s'il vous plaît", en: 'a coffee, please' },
    bill: HOW_MUCH,
  },
  boulangerie: {
    to: { fr: 'à la boulangerie', en: 'to the bakery' },
    at: { fr: 'à la boulangerie', en: 'at the bakery' },
    go: 'À la boulangerie',
    words: /\b(boulangerie|bakery|baker)\b/,
    count: { fr: "Deux croissants, s'il vous plaît.", en: 'Two croissants, please.' },
    more: { fr: 'Et une baguette aussi.', en: 'And a baguette too.' },
    again: { fr: "Encore une baguette, s'il vous plaît.", en: 'Another baguette, please.' },
    example: { fr: "une baguette, s'il vous plaît", en: 'a baguette, please' },
    bill: HOW_MUCH,
  },
  marche: {
    to: { fr: 'au marché', en: 'to the market' },
    at: { fr: 'au marché', en: 'at the market' },
    go: 'Au marché',
    words: /\b(marche|market)\b/,
    count: { fr: "Deux pommes, s'il vous plaît.", en: 'Two apples, please.' },
    more: { fr: 'Et un citron aussi.', en: 'And a lemon too.' },
    again: { fr: "Encore une pomme, s'il vous plaît.", en: 'Another apple, please.' },
    example: { fr: "deux pommes, s'il vous plaît", en: 'two apples, please' },
    bill: HOW_MUCH,
  },
  bistrot: {
    to: { fr: 'au Bistrot', en: 'to the bistro' },
    at: { fr: 'au bistrot', en: 'at the bistro' },
    go: 'Au bistrot',
    words: /\b(bistrot|bistro|restaurant)\b/,
    count: { fr: "Deux crêpes, s'il vous plaît.", en: 'Two crêpes, please.' },
    more: { fr: "Et une crêpe, s'il vous plaît.", en: 'And a crêpe, please.' },
    again: { fr: "Une crêpe en dessert, s'il vous plaît.", en: 'A crêpe for dessert, please.' },
    example: { fr: "le plat du jour, s'il vous plaît", en: 'the dish of the day, please' },
    bill: { fr: "L'addition, s'il vous plaît !", en: 'The bill, please!' },
    talk: { fr: "Une carafe d'eau, s'il vous plaît.", en: 'A jug of tap water, please.' },
  },
  metro: {
    to: { fr: 'au métro', en: 'to the metro' },
    at: { fr: 'au métro', en: 'at the metro' },
    go: 'Au métro',
    words: /\b(metro|subway|underground)\b/,
    count: { fr: "Deux tickets, s'il vous plaît.", en: 'Two tickets, please.' },
    more: { fr: 'Et un plan du métro aussi.', en: 'And a metro map too.' },
    again: { fr: 'Pour aller à la tour Eiffel ?', en: 'How do I get to the Eiffel Tower?' },
    example: { fr: "un ticket, s'il vous plaît", en: 'a ticket, please' },
    bill: HOW_MUCH,
    talk: { fr: 'Pour aller à Montmartre ?', en: 'How do I get to Montmartre?' },
  },
  pharmacie: {
    to: { fr: 'à la pharmacie', en: 'to the pharmacy' },
    at: { fr: 'à la pharmacie', en: 'at the pharmacy' },
    go: 'À la pharmacie',
    words: /\b(pharmacie|pharmacy|chemist)\b/,
    count: { fr: "Deux paquets de mouchoirs, s'il vous plaît.", en: 'Two packs of tissues, please.' },
    more: { fr: 'Et des mouchoirs aussi.', en: 'And some tissues too.' },
    again: { fr: "Et de la crème solaire, s'il vous plaît.", en: 'And some sunscreen, please.' },
    example: { fr: "des pansements, s'il vous plaît", en: 'some plasters, please' },
    bill: HOW_MUCH,
    talk: { fr: "J'ai mal à la tête.", en: 'I have a headache.' },
  },
  hotel: {
    to: { fr: "à l'Hôtel", en: 'to the hotel' },
    at: { fr: "à l'hôtel", en: 'at the hotel' },
    go: "À l'hôtel",
    words: /\b(hotel|reception)\b/,
    count: { fr: "Deux nuits, s'il vous plaît.", en: 'Two nights, please.' },
    more: { fr: 'Avec le petit-déjeuner.', en: 'With breakfast.' },
    again: { fr: "Un plan de la ville, s'il vous plaît.", en: 'A city map, please.' },
    example: { fr: "une nuit, s'il vous plaît", en: 'one night, please' },
    bill: HOW_MUCH,
    talk: { fr: "J'ai une réservation.", en: 'I have a booking.' },
  },
};
