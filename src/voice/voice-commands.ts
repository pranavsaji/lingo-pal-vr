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

import { normalizeFrench } from './pronunciation.js';

export type PanelId = 'home' | 'carnet' | 'settings' | 'map' | 'report';
export type InputMode = 'hands' | 'eyes' | 'voice';
export type ToggleSetting = 'highContrast' | 'subtitles' | 'gazeDwell' | 'leftHanded' | 'reduceMotion' | 'voiceFirst';

export type VoiceCommand =
  | { kind: 'open'; panel: PanelId }
  | { kind: 'close' }
  | { kind: 'repeat' }
  | { kind: 'slower' }
  | { kind: 'help' }
  | { kind: 'skip' }
  | { kind: 'pay_exact' }
  | { kind: 'travel'; place: 'cafe' | 'boulangerie' | 'marche' }
  | { kind: 'mode'; mode: InputMode }
  | { kind: 'text'; bigger: boolean }
  | { kind: 'toggle'; setting: ToggleSetting }
  | { kind: 'mission' }
  | { kind: 'review' }
  | { kind: 'tutorial' };

export interface CommandContext {
  /** The order is waiting for payment. */
  paying: boolean;
  /** The first-launch "hands, eyes or voice?" choice is on screen: bare mode words count. */
  choosing: boolean;
}

/** Longest utterance (in words) still treated as a command. */
const MAX_WORDS = 6;

const PLACE_WORDS: [RegExp, 'cafe' | 'boulangerie' | 'marche'][] = [
  [/\b(boulangerie|bakery|baker)\b/, 'boulangerie'],
  [/\b(marche|market)\b/, 'marche'],
  [/\b(cafe|coffee shop)\b/, 'cafe'],
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

  // Travel (English; the French forms are also understood by the intent parser).
  if (/\b(go|take me|let s go|allons|aller|allez|vais|retour|retourner|direction)\b/.test(n)) {
    for (const [re, place] of PLACE_WORDS) if (re.test(n)) return { kind: 'travel', place };
  }

  // Payment: "je paie" with no amount places the exact coins on the tray.
  if (ctx.paying && /\b(je paie|je paye|je vais payer|payer|pay|i ll pay|c est juste|exact)\b/.test(n) && !/\d|\beuros?\b|\bcentimes?\b|\bbillet\b/.test(n)) {
    return { kind: 'pay_exact' };
  }

  if (/\b(repete|repeter|repetez|repeat|again|encore une fois|say it again)\b/.test(n)) return { kind: 'repeat' };
  if (/\b(plus lentement|moins vite|lentement|slower|slow down|slowly)\b/.test(n)) return { kind: 'slower' };
  if (/\b(aide|help|au secours|comment faire)\b/.test(n)) return { kind: 'help' };
  if (/\b(passer|skip)\b/.test(n)) return { kind: 'skip' };

  // Panels.
  if (/\b(ma semaine|cette semaine|rapport|my week|weekly report|report|progres|progress)\b/.test(n)) return { kind: 'open', panel: 'report' };
  if (/\b(carnet|mes mots|vocabulaire|notebook|my words|words)\b/.test(n)) return { kind: 'open', panel: 'carnet' };
  if (/\b(reglages|parametres|settings|options|accessibilite|accessibility)\b/.test(n)) return { kind: 'open', panel: 'settings' };
  if (/\b(plan|la carte de paris|carte de paris|map|paris)\b/.test(n)) return { kind: 'open', panel: 'map' };
  if (/\b(fermer|ferme|fermez|close|back|go back|retour|accueil|home)\b/.test(n)) return { kind: 'close' };

  // Panel buttons that are not panels.
  if (/\b(revision|reviser|review)\b/.test(n)) return { kind: 'review' };
  if (/\b(mission|commencer|start mission)\b/.test(n)) return { kind: 'mission' };
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
      return { home: 'Accueil', carnet: 'Mon Carnet', settings: 'Réglages', map: 'Plan de Paris', report: 'Ma semaine' }[cmd.panel];
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
      return { cafe: 'Au café', boulangerie: 'À la boulangerie', marche: 'Au marché' }[cmd.place];
    case 'mode':
      return { hands: 'Mode mains', eyes: 'Mode regard', voice: 'Mode voix' }[cmd.mode];
    case 'text':
      return cmd.bigger ? 'Texte plus grand' : 'Texte plus petit';
    case 'toggle':
      return 'Réglage changé';
    case 'mission':
      return 'Mission';
    case 'review':
      return 'Révision';
    case 'tutorial':
      return 'Tutoriel';
  }
}
