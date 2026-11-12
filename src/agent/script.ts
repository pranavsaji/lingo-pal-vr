/**
 * Offline Madame Lune. Same input/output contract as the AI route, so the full
 * greet -> order -> quote -> pay -> change -> goodbye loop works with no key,
 * no network, and during demos on bad Wi-Fi.
 */

import { parseIntent } from './intent.js';
import { menuItem, priceToEnglish, priceToFrench, quantityPhrase, quantityPhraseEn, type MenuItem } from './menu.js';
import type { AgentRequest, AgentTurn, ReplyOption } from './protocol.js';
import type { AgentAction, OrderLine } from './tools.js';

const startsWithVowel = (s: string) => /^[aeiouhéèêàâîôû]/i.test(s);

/** "le croissant", "la baguette", "l'orange". */
export function definite(item: MenuItem): string {
  if (startsWithVowel(item.noun)) return `l'${item.noun}`;
  return `${item.gender === 'f' ? 'la' : 'le'} ${item.noun}`;
}

export function orderPhrase(lines: OrderLine[]): { fr: string; en: string } {
  const fr: string[] = [];
  const en: string[] = [];
  for (const l of lines) {
    const item = menuItem(l.itemId);
    if (!item) continue;
    fr.push(quantityPhrase(item, l.qty));
    en.push(quantityPhraseEn(item, l.qty));
  }
  const join = (xs: string[], and: string) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);
  return { fr: join(fr, 'et'), en: join(en, 'and') };
}

function replies(req: AgentRequest, phaseOverride?: AgentRequest['scene']['phase']): ReplyOption[] {
  const phase = phaseOverride ?? req.scene.phase;
  const special = menuItem(req.scene.special.itemId);
  switch (phase) {
    case 'ordering':
      return [
        { fr: "C'est tout, merci.", en: "That's all, thanks." },
        { fr: "C'est combien ?", en: 'How much is it?' },
        { fr: 'Et un café aussi.', en: 'And a coffee too.' },
      ];
    case 'paying':
      return [
        { fr: 'Voilà.', en: 'Here you go.' },
        { fr: 'Je paie en espèces.', en: 'I am paying cash.' },
        { fr: "Pardon, c'est combien ?", en: 'Sorry, how much is it?' },
      ];
    case 'paid':
      return [
        { fr: 'Merci, au revoir !', en: 'Thanks, goodbye!' },
        { fr: 'À demain !', en: 'See you tomorrow!' },
        { fr: 'Encore un café, s\'il vous plaît.', en: 'Another coffee, please.' },
      ];
    default:
      return [
        { fr: 'Deux croissants, s\'il vous plaît.', en: 'Two croissants, please.' },
        special
          ? { fr: `${quantityPhrase(special, 1).replace(/^./, (c) => c.toUpperCase())}, s'il vous plaît.`, en: `${quantityPhraseEn(special, 1)}, please.` }
          : { fr: "Un café, s'il vous plaît.", en: 'A coffee, please.' },
        { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' },
      ];
  }
}

const turn = (fr: string, en: string, actions: AgentAction[], points: number, reps: ReplyOption[]): AgentTurn => ({
  fr,
  en,
  actions,
  points,
  replies: reps,
  source: 'script',
});

export function scriptedTurn(req: AgentRequest): AgentTurn {
  const { profile, scene, event } = req;
  const name = profile.name;
  const special = menuItem(scene.special.itemId);

  switch (event.kind) {
    case 'arrive': {
      if (!name) {
        return turn(
          'Bonjour ! Bienvenue au Café Lune. Comment vous appelez-vous ?',
          'Hello! Welcome to Cafe Lune. What is your name?',
          [{ type: 'emote', kind: 'wave' }],
          0,
          [
            { fr: "Je m'appelle Alex.", en: 'My name is Alex.' },
            { fr: "Je m'appelle Sam.", en: 'My name is Sam.' },
            { fr: 'Bonjour, madame !', en: "Hello, ma'am!" },
          ],
        );
      }
      const fav = profile.memories.favorite_order;
      const recall = fav ? ` Comme hier, ${fav} ?` : '';
      const recallEn = fav ? ` Same as yesterday, ${fav}?` : '';
      const sp = special ? ` Le plat du jour : ${definite(special)}.` : '';
      const spEn = special ? ` Today's special: the ${special.en}.` : '';
      return turn(`Re-bonjour, ${name} !${recall}${sp}`, `Hello again, ${name}!${recallEn}${spEn}`, [{ type: 'emote', kind: 'wave' }], 0, replies(req));
    }

    case 'show': {
      const item = menuItem(event.itemId);
      if (!item) {
        return turn('Ah, ça ne se vend pas ici !', "Ah, that's not for sale here!", [{ type: 'emote', kind: 'laugh' }], 2, replies(req));
      }
      return turn(
        `Ah, ${definite(item)} ! ${priceToFrench(item.priceCents)}. Vous en voulez combien ?`,
        `Ah, the ${item.en}! ${priceToEnglish(item.priceCents)}. How many would you like?`,
        [{ type: 'point_at', itemId: item.id }],
        5,
        [
          { fr: `${quantityPhrase(item, 1).replace(/^./, (c) => c.toUpperCase())}, s'il vous plaît.`, en: `One ${item.en}, please.` },
          { fr: `Deux ${item.plural}, s'il vous plaît.`, en: `Two ${item.enPlural}, please.` },
          { fr: 'Non, merci.', en: 'No, thank you.' },
        ],
      );
    }

    case 'paid': {
      const fav = orderPhrase(scene.order).fr;
      const remember: AgentAction[] = fav ? [{ type: 'remember', key: 'favorite_order', value: fav.slice(0, 40) }] : [];
      if (event.changeCents === 0) {
        return turn("C'est juste. Merci beaucoup !", "That's exact. Thank you very much!", [{ type: 'emote', kind: 'clap' }, ...remember], 20, replies(req, 'paid'));
      }
      return turn(
        `Merci ! Je vous rends ${priceToFrench(event.changeCents)}.`,
        `Thank you! Here is ${priceToEnglish(event.changeCents)} change.`,
        [{ type: 'give_change', cents: event.changeCents }, { type: 'emote', kind: 'nod' }, ...remember],
        20,
        replies(req, 'paid'),
      );
    }

    case 'short':
      return turn(
        `Il manque ${priceToFrench(event.shortByCents)}, s'il vous plaît.`,
        `You are ${priceToEnglish(event.shortByCents)} short, please.`,
        [{ type: 'emote', kind: 'think' }],
        0,
        replies(req, 'paying'),
      );

    case 'idle':
      return turn(
        "Besoin d'aide ? Montrez-moi un objet, ou dites : un café, s'il vous plaît.",
        'Need help? Show me an item, or say: a coffee, please.',
        special ? [{ type: 'point_at', itemId: special.id }] : [],
        0,
        replies(req),
      );

    case 'gesture': {
      if (event.gesture === 'wave') return sayTurn(req, scene.phase === 'paid' ? 'au revoir' : 'bonjour', 0);
      if (event.gesture === 'thumbs_up') return sayTurn(req, 'oui', 0);
      if (event.gesture === 'thumbs_down') return sayTurn(req, 'non', 0);
      return turn(
        `${event.fingers} ? ${event.fingers} quoi ? Dites-moi le nom.`,
        `${event.fingers}? ${event.fingers} of what? Tell me the name.`,
        [{ type: 'emote', kind: 'think' }],
        2,
        replies(req),
      );
    }

    case 'say':
      return sayTurn(req, event.text, event.fingers);
  }
}

function sayTurn(req: AgentRequest, text: string, fingers: number): AgentTurn {
  const { profile, scene } = req;
  const intent = parseIntent(text, fingers);
  const polite = /s.il vous pla[iî]t|merci/i.test(text) ? 5 : 0;
  const special = menuItem(scene.special.itemId);
  const name = profile.name ? `, ${profile.name}` : '';

  switch (intent.kind) {
    case 'name':
      return turn(
        `Enchantée, ${intent.name} ! Qu'est-ce que je vous sers ?`,
        `Nice to meet you, ${intent.name}! What can I get you?`,
        [{ type: 'remember', key: 'name', value: intent.name }, { type: 'emote', kind: 'nod' }],
        10,
        replies(req, 'browsing'),
      );
    case 'order': {
      const actions: AgentAction[] = intent.items.map((i) => ({ type: 'serve_items', itemId: i.itemId, quantity: i.qty }));
      actions.push({ type: 'emote', kind: 'nod' });
      const p = orderPhrase(intent.items);
      const usedFingers = fingers > 0 ? 5 : 0;
      return turn(`Voilà ${p.fr} ! Autre chose ?`, `Here are ${p.en}! Anything else?`, actions, 10 + polite + usedFingers, replies(req, 'ordering'));
    }
    case 'ask_price':
    case 'done_ordering':
      if (scene.order.length === 0) {
        return turn("Vous n'avez rien commandé ! Un café, peut-être ?", "You haven't ordered anything! A coffee, maybe?", [{ type: 'emote', kind: 'laugh' }], 2, replies(req, 'browsing'));
      }
      return turn(
        `Ça fait ${priceToFrench(scene.totalCents)}, s'il vous plaît. Posez les pièces sur le plateau.`,
        `That comes to ${priceToEnglish(scene.totalCents)}, please. Put the coins on the tray.`,
        [{ type: 'quote_total', totalCents: scene.totalCents }],
        10 + polite,
        replies(req, 'paying'),
      );
    case 'pay':
      if (scene.order.length === 0) return sayTurn(req, 'combien', 0);
      return turn(
        `Merci. Posez ${priceToFrench(scene.totalCents)} sur le plateau.`,
        `Thanks. Put ${priceToEnglish(scene.totalCents)} on the tray.`,
        scene.phase === 'paying' ? [{ type: 'emote', kind: 'nod' }] : [{ type: 'quote_total', totalCents: scene.totalCents }],
        5,
        replies(req, 'paying'),
      );
    case 'greet':
      return turn(`Bonjour${name} ! Qu'est-ce que je vous sers ?`, `Hello${name}! What can I get you?`, [{ type: 'emote', kind: 'wave' }], 5, replies(req));
    case 'thanks':
      return turn('Avec plaisir !', 'My pleasure!', [{ type: 'emote', kind: 'nod' }], 5, replies(req));
    case 'bye':
      return turn(
        `À demain${name} ! Bonne journée !`,
        `See you tomorrow${name}! Have a nice day!`,
        [{ type: 'emote', kind: 'wave' }, { type: 'end_visit' }],
        10,
        replies(req),
      );
    case 'yes':
      if (scene.phase === 'browsing' && special) {
        return turn(
          `Parfait, ${quantityPhrase(special, 1)} ! Autre chose ?`,
          `Perfect, ${quantityPhraseEn(special, 1)}! Anything else?`,
          [{ type: 'serve_items', itemId: special.id, quantity: 1 }, { type: 'emote', kind: 'nod' }],
          8,
          replies(req, 'ordering'),
        );
      }
      return turn('Très bien !', 'Very good!', [{ type: 'emote', kind: 'nod' }], 3, replies(req));
    case 'no':
      return turn("D'accord. Autre chose ?", 'Okay. Anything else?', [{ type: 'emote', kind: 'nod' }], 3, replies(req));
    case 'recommend':
      if (special) {
        return turn(
          `Je recommande ${definite(special)}, c'est le plat du jour !`,
          `I recommend the ${special.en}, it's today's special!`,
          [{ type: 'point_at', itemId: special.id }],
          8,
          replies(req),
        );
      }
      break;
    case 'command':
    case 'unknown':
      break;
  }
  return turn('Pardon ? Vous pouvez répéter, s\'il vous plaît ?', 'Sorry? Can you repeat, please?', [{ type: 'emote', kind: 'think' }], 0, replies(req));
}
