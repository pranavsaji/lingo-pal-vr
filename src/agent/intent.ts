/**
 * Rule-based French intent parser. Used by the offline agent, to give the AI
 * a pre-parsed hint, and for voice commands (accessibility: every hand action
 * has a spoken alternative).
 */

import { normalizeFrench } from '../voice/pronunciation.js';
import { MENU, MAX_QUANTITY, numberToFrench } from './menu.js';

export type Intent =
  | { kind: 'greet' }
  | { kind: 'order'; items: { itemId: string; qty: number }[] }
  | { kind: 'ask_price' }
  | { kind: 'done_ordering' }
  | { kind: 'pay'; cents: number | null }
  | { kind: 'thanks' }
  | { kind: 'bye' }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'recommend' }
  | { kind: 'name'; name: string }
  | { kind: 'command'; command: VoiceCommand }
  | { kind: 'travel'; place: 'cafe' | 'boulangerie' | 'marche' }
  | { kind: 'unknown' };

export type VoiceCommand = 'repeat' | 'help' | 'settings' | 'skip' | 'carnet' | 'slower' | 'map' | 'place';

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
};

/**
 * Menu items named in the sentence, with quantities. Aliases come from the
 * shop data; the longest alias wins and words are used once, so
 * "pain au chocolat" is not also read as "pain" (a baguette or a bread roll).
 */
function findItems(norm: string, fingers: number): { itemId: string; qty: number }[] {
  const toks = norm.split(' ');
  const matches: { itemId: string; at: number; len: number }[] = [];
  for (const item of MENU) {
    for (const alias of item.aliases.length ? item.aliases : [item.id]) {
      const aliasToks = alias.split(' ');
      for (let i = 0; i + aliasToks.length <= toks.length; i++) {
        if (aliasToks.every((t, k) => toks[i + k] === t)) matches.push({ itemId: item.id, at: i, len: aliasToks.length });
      }
    }
  }
  matches.sort((a, b) => b.len - a.len || a.at - b.at);
  const used = new Array<boolean>(toks.length).fill(false);
  const found: { itemId: string; qty: number; at: number }[] = [];
  for (const m of matches) {
    if (found.some((f) => f.itemId === m.itemId)) continue;
    let free = true;
    for (let k = m.at; k < m.at + m.len; k++) if (used[k]) free = false;
    if (!free) continue;
    for (let k = m.at; k < m.at + m.len; k++) used[k] = true;
    // Quantity = number word right before (skipping "de", "des"); else fingers; else 1.
    let qty = 0;
    for (let back = 1; back <= 2 && m.at - back >= 0; back++) {
      const w = toks[m.at - back];
      if (NUMBER_WORDS[w] !== undefined) {
        qty = NUMBER_WORDS[w];
        break;
      }
      if (w !== 'de' && w !== 'des' && w !== 'petit' && w !== 'petits' && w !== 'grand') break;
    }
    if (qty === 0) qty = fingers > 0 ? fingers : 1;
    found.push({ itemId: m.itemId, qty: Math.min(MAX_QUANTITY, qty), at: m.at });
  }
  return found.sort((a, b) => a.at - b.at).map(({ itemId, qty }) => ({ itemId, qty }));
}

const has = (norm: string, re: RegExp) => re.test(norm);

/** Normalized French words for 0 to 99, longest first, for greedy matching. */
const NUMBER_PHRASES: { toks: string[]; value: number }[] = Array.from({ length: 100 }, (_, n) => [
  { toks: normalizeFrench(numberToFrench(n)).split(' '), value: n },
  ...(n === 1 ? [{ toks: ['une'], value: 1 }] : []),
  ...(n === 80 ? [{ toks: ['quatre', 'vingt'], value: 80 }] : []),
])
  .flat()
  .sort((a, b) => b.toks.length - a.toks.length);

function readNumber(toks: string[], i: number): { value: number; len: number } | null {
  if (/^\d+$/.test(toks[i] ?? '')) return { value: Number(toks[i]), len: 1 };
  for (const p of NUMBER_PHRASES) {
    if (p.toks.every((t, k) => toks[i + k] === t)) return { value: p.value, len: p.toks.length };
  }
  return null;
}

/**
 * Money said aloud, in cents: "cinq euros" 500, "trois euros quarante" 340,
 * "cinquante centimes" 50, "un billet de dix" 1000, "3,40 €" 340. Null if none.
 */
export function parseAmountCents(text: string): number | null {
  const digits = text.match(/(\d+)(?:[,.](\d{1,2}))?\s*(?:€|euros?)/i);
  if (digits) return Number(digits[1]) * 100 + (digits[2] ? Number(digits[2].padEnd(2, '0')) : 0);
  const toks = normalizeFrench(text).split(' ');
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'billet' && toks[i + 1] === 'de') {
      const n = readNumber(toks, i + 2);
      if (n) return n.value * 100;
    }
    const n = readNumber(toks, i);
    if (!n) continue;
    const unit = toks[i + n.len];
    if (unit === 'euro' || unit === 'euros') {
      const c = readNumber(toks, i + n.len + 1);
      return n.value * 100 + (c && c.value < 100 ? c.value : 0);
    }
    if (unit === 'centime' || unit === 'centimes') return n.value;
  }
  return null;
}

/**
 * @param fingers how many fingers the learner is holding up (0 if none). It
 * sets the quantity when the sentence has no number word.
 */
export function parseIntent(text: string, fingers = 0): Intent {
  const n = normalizeFrench(text);
  if (!n) return { kind: 'unknown' };

  if (has(n, /\b(repeter|repete|encore une fois|pardon)\b/)) return { kind: 'command', command: 'repeat' };
  if (has(n, /\b(aide|help|au secours)\b/)) return { kind: 'command', command: 'help' };
  if (has(n, /\b(reglages|parametres|settings)\b/)) return { kind: 'command', command: 'settings' };
  if (has(n, /\b(passer|skip)\b/)) return { kind: 'command', command: 'skip' };
  if (has(n, /\b(carnet|mes mots)\b/)) return { kind: 'command', command: 'carnet' };
  if (has(n, /\b(plus lentement|moins vite|lentement)\b/)) return { kind: 'command', command: 'slower' };
  // Mixed reality: "placer le café", "déplacez le comptoir".
  if (has(n, /\b(placer|placez|deplacer|deplacez|bouger|bougez|installer|installez) (le |la |votre )?(cafe|comptoir|boutique|magasin)\b/)) return { kind: 'command', command: 'place' };
  // Travel: "allons à la boulangerie", "je vais au marché", "retour au café".
  const go = n.match(/\b(?:allons|aller|allez|vais|va|retour|retourner|direction)\b.*\b(boulangerie|marche|cafe)\b/);
  if (go) return { kind: 'travel', place: go[1] as 'cafe' | 'boulangerie' | 'marche' };
  if (has(n, /\b(plan de paris|le plan|la carte de paris)\b/)) return { kind: 'command', command: 'map' };

  const nameMatch = n.match(/\b(?:je m appelle|mon nom est|moi c est)\s+([a-z]+)/);
  if (nameMatch) return { kind: 'name', name: nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1) };

  const items = findItems(n, fingers);
  if (items.length > 0 && !has(n, /\bcombien\b/)) return { kind: 'order', items };

  if (has(n, /\b(combien|ca fait combien|l addition|prix)\b/)) return { kind: 'ask_price' };
  const cents = parseAmountCents(text);
  if (cents !== null || has(n, /\b(je paie|je paye|voila|payer|par carte|en especes)\b/)) return { kind: 'pay', cents };
  if (has(n, /\b(c est tout|rien d autre|ca sera tout|ce sera tout)\b/)) return { kind: 'done_ordering' };
  if (has(n, /\b(au revoir|a demain|bonne journee|bonne soiree|a bientot|salut)\b/) && !has(n, /^salut$/)) return { kind: 'bye' };
  if (has(n, /\b(bonjour|bonsoir|salut|coucou)\b/)) return { kind: 'greet' };
  if (has(n, /\b(merci)\b/)) return { kind: 'thanks' };
  if (has(n, /\b(recommand|conseill|specialite|plat du jour)/)) return { kind: 'recommend' };
  if (has(n, /^(oui|ouais|d accord|bien sur|volontiers|parfait)\b/)) return { kind: 'yes' };
  if (has(n, /^(non|pas)\b/)) return { kind: 'no' };
  return { kind: 'unknown' };
}
