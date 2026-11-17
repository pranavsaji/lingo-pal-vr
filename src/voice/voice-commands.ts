/**
 * Global voice commands (Accessibility Forward: a spoken alternative to every
 * hand action and every panel button). French and English synonyms, checked
 * before the conversation intent parser so "le plan", "my week" or "je paie"
 * never reach the shopkeeper as small talk.
 *
 * Pure parsing only; AccessibilitySystem runs the command. Commands must be
 * short utterances (a sentence that merely contains "aide" or "passer" is
 * conversation, not a command), except the explicit "mode ..." switches.
 */

import { namesMenuItem, travelPlace } from '../agent/intent.js';
import type { PlaceId } from '../game-state.js';
import { PLACE_ORDER } from '../places/places.js';
import { PLACE_TEXT } from '../places/place-text.js';
import { normalizeFrench } from './pronunciation.js';

export type PanelId = 'home' | 'carnet' | 'settings' | 'map' | 'report' | 'ready';
export type InputMode = 'hands' | 'eyes' | 'voice';
export type ToggleSetting = 'highContrast' | 'subtitles' | 'gazeDwell' | 'leftHanded' | 'reduceMotion' | 'voiceFirst' | 'realLife';

export type VoiceCommand =
  | { kind: 'open'; panel: PanelId }
  | { kind: 'close' }
  | { kind: 'repeat' }
  | { kind: 'slower' }
  | { kind: 'help' }
  | { kind: 'skip' }
  | { kind: 'pay_exact' }
  | { kind: 'travel'; place: PlaceId }
  | { kind: 'mode'; mode: InputMode }
  | { kind: 'text'; bigger: boolean }
  | { kind: 'toggle'; setting: ToggleSetting }
  | { kind: 'mission' }
  | { kind: 'review' }
  | { kind: 'tutorial' }
  /** "Traduire": show the English of her last line (help, in "vraie vie" mode). */
  | { kind: 'translate' };

export interface CommandContext {
  /** The order is waiting for payment. */
  paying: boolean;
  /** The first-launch "hands, eyes or voice?" choice is on screen: bare mode words count. */
  choosing: boolean;
}

/** Longest utterance (in words) still treated as a command. */
const MAX_WORDS = 6;

/** Shop names, French and English (the café last: "coffee" also appears in orders). */
const PLACE_WORDS: [RegExp, PlaceId][] = [
  ...PLACE_ORDER.filter((p) => p !== 'cafe').map((p) => [PLACE_TEXT[p].words, p] as [RegExp, PlaceId]),
  [PLACE_TEXT.cafe.words, 'cafe'],
];

const MODE_WORDS: [RegExp, InputMode][] = [
  [/\b(mains?|hands?)\b/, 'hands'],
  [/\b(yeux|oeil|regard|eyes?|gaze)\b/, 'eyes'],
  [/\b(voix|voice|parole)\b/, 'voice'],
];

function findMode(n: string): InputMode | null {
  for (const [re, mode] of MODE_WORDS) if (re.test(n)) return mode;
  return null;
}

/** Parse a transcript into a global command, or null to let the conversation handle it. */
export function parseVoiceCommand(text: string, ctx: CommandContext): VoiceCommand | null {
  const n = normalizeFrench(text);
  if (!n) return null;
  const words = n.split(' ').length;

  // "Vraie vie" (real-life mode): "vraie vie", "real life", "mode réel".
  if (words <= MAX_WORDS && /\b(vraie vie|vrai vie|real life|mode reel|reel mode)\b/.test(n)) return { kind: 'toggle', setting: 'realLife' };
  // Explicit mode switches work at any time: "mode yeux", "eyes mode", "mode voix".
  if (/\bmode\b/.test(n)) {
    const mode = findMode(n);
    if (mode) return { kind: 'mode', mode };
  }
  if (words > MAX_WORDS) return null;

  // First launch choice: the bare word is enough ("les yeux", "voice", "avec les mains").
  if (ctx.choosing) {
    const mode = findMode(n);
    if (mode) return { kind: 'mode', mode };
  }

  // A shop item that sounds like a command ("un carnet de tickets", "un plan du métro",
  // "je vais prendre un café") is an order, not a command.
  const item = namesMenuItem(text);

  // Travel: French with the shop right after the verb ("allons au métro", not "je vais prendre
  // un café"), English with "go" / "take me" anywhere before it.
  const fr = travelPlace(n);
  if (fr) return { kind: 'travel', place: fr };
  if (/\b(go|take me|let s go)\b/.test(n)) {
    for (const [re, place] of PLACE_WORDS) if (re.test(n)) return { kind: 'travel', place };
  }

  // Payment: "je paie" with no amount places the exact coins on the tray.
  if (ctx.paying && /\b(je paie|je paye|je vais payer|payer|pay|i ll pay|c est juste|exact|par carte|by card)\b/.test(n) && !/\d|\beuros?\b|\bcentimes?\b|\bbillet\b/.test(n)) {
    return { kind: 'pay_exact' };
  }

  // "Répéter plus lentement" asks to slow down (checked before a plain repeat).
  if (/\b(plus lentement|moins vite|lentement|slower|slow down|slowly)\b/.test(n)) return { kind: 'slower' };
  if (/\b(repete|repeter|repetez|repeat|again|encore une fois|say it again)\b/.test(n)) return { kind: 'repeat' };
  if (/\b(traduire|traduis|traduisez|translate|en anglais|in english)\b/.test(n)) return { kind: 'translate' };
  if (/\b(aide|help|au secours|comment faire)\b/.test(n)) return { kind: 'help' };
  // Not "je voudrais passer une commande": skipping is the bare word or "passer l'étape".
  if (/^(passer|passe|passez|on passe|skip|skip it)$/.test(n) || /\b(skip this|skip step|passer l etape|passer le tutoriel|sauter l etape)\b/.test(n)) return { kind: 'skip' };

  // Panels.
  if (/\b(pret pour paris|prete pour paris|ready for paris|mon voyage|my trip)\b/.test(n)) return { kind: 'open', panel: 'ready' };
  if (/\b(ma semaine|cette semaine|rapport|my week|weekly report|report|progres|progress)\b/.test(n)) return { kind: 'open', panel: 'report' };
  if (/\b(carnet|mes mots|vocabulaire|notebook|my words|words)\b/.test(n) && (!item || /\bmon carnet\b/.test(n))) return { kind: 'open', panel: 'carnet' };
  if (/\b(reglages|parametres|settings|options|accessibilite|accessibility)\b/.test(n)) return { kind: 'open', panel: 'settings' };
  // "Paris" alone opens the map; "j'adore Paris" is small talk.
  if ((/\b(plan|la carte de paris|carte de paris|map)\b/.test(n) || n === 'paris') && !item) return { kind: 'open', panel: 'map' };
  // Not "c'est fermé ?": "fermer", "ferme la carte", "close", "retour".
  if (/\b(fermer|fermez|close|back|go back|retour|accueil|home)\b/.test(n) || /^ferme( la carte| le plan| le panneau)?$/.test(n)) return { kind: 'close' };

  // Panel buttons that are not panels.
  if (/\b(revision|reviser|review)\b/.test(n)) return { kind: 'review' };
  // Not "on peut commencer ?" (to the shopkeeper): "mission", "commencer la mission", or the bare word.
  if (/\b(mission|start mission)\b/.test(n) || /^(commencer|commencez|on commence)$/.test(n)) return { kind: 'mission' };
  if (/\b(tutoriel|tutorial)\b/.test(n)) return { kind: 'tutorial' };

  // Settings rows.
  if (/\b(texte plus grand|plus grand texte|plus gros|bigger text|larger text|text bigger|zoom)\b/.test(n)) return { kind: 'text', bigger: true };
  if (/\b(texte plus petit|plus petit texte|smaller text|text smaller)\b/.test(n)) return { kind: 'text', bigger: false };
  if (/\b(contraste|contrast)\b/.test(n)) return { kind: 'toggle', setting: 'highContrast' };
  if (/\b(sous titres?|subtitles?|traduction|translation)\b/.test(n)) return { kind: 'toggle', setting: 'subtitles' };
  if (/\b(gaucher|gauchere|left handed|left hand)\b/.test(n)) return { kind: 'toggle', setting: 'leftHanded' };
  if (/\b(moins d animations?|animations?|reduce motion|less motion)\b/.test(n)) return { kind: 'toggle', setting: 'reduceMotion' };
  if (/\b(mains libres|hands free)\b/.test(n)) return { kind: 'toggle', setting: 'voiceFirst' };
  return null;
}

/** One short line per command, shown under "Vous : ..." so the learner sees it worked. */
export function commandFeedback(cmd: VoiceCommand): string {
  switch (cmd.kind) {
    case 'open':
      return { home: 'Accueil', carnet: 'Mon Carnet', settings: 'Réglages', map: 'Plan de Paris', report: 'Ma semaine', ready: 'Prêt pour Paris' }[cmd.panel];
    case 'close':
      return 'Fermé';
    case 'repeat':
      return 'Je répète';
    case 'slower':
      return 'Plus lentement';
    case 'help':
      return 'Dites : plan, carnet, réglages, ma semaine, répète, je paie';
    case 'skip':
      return 'Passer';
    case 'pay_exact':
      return 'Je paie le compte juste';
    case 'travel':
      return PLACE_TEXT[cmd.place].go;
    case 'mode':
      return { hands: 'Mode mains', eyes: 'Mode regard', voice: 'Mode voix' }[cmd.mode];
    case 'text':
      return cmd.bigger ? 'Texte plus grand' : 'Texte plus petit';
    case 'toggle':
      return cmd.setting === 'realLife' ? 'Vraie vie' : 'Réglage changé';
    case 'translate':
      return 'Traduire';
    case 'mission':
      return 'Mission';
    case 'review':
      return 'Révision';
    case 'tutorial':
      return 'Tutoriel';
  }
}
