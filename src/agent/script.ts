/**
 * Offline Madame Lune. Same input/output contract as the AI route, so the full
 * greet -> order -> quote -> pay -> change -> goodbye loop works with no key,
 * no network, and during demos on bad Wi-Fi.
 */

import { NUMBER_WORDS } from '../state/mistakes.js';
import { normalizeFrench } from '../voice/pronunciation.js';
import { findElsewhere, substituteFor, upsellFor } from './agency.js';
import { parseIntent } from './intent.js';
import { PLACE_TEXT } from '../places/place-text.js';
import { MENU, menuItem, PLACES, priceToEnglish, priceToFrench, quantityPhrase, quantityPhraseEn, type MenuItem } from './menu.js';
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

/** This shop's everyday lines (the café's when the shop is unknown). */
const textFor = (req: AgentRequest) => PLACE_TEXT[req.scene.place] ?? PLACE_TEXT.cafe;

function replies(req: AgentRequest, phaseOverride?: AgentRequest['scene']['phase']): ReplyOption[] {
  const phase = phaseOverride ?? req.scene.phase;
  const special = menuItem(req.scene.special.itemId);
  const t = textFor(req);
  switch (phase) {
    case 'ordering':
      return [{ fr: "C'est tout, merci.", en: "That's all, thanks." }, t.bill, t.more];
    case 'paying':
      return [
        { fr: 'Voilà.', en: 'Here you go.' },
        { fr: 'Je paie en espèces.', en: 'I am paying cash.' },
        { fr: "Pardon, c'est combien ?", en: 'Sorry, how much is it?' },
      ];
    case 'paid':
      return [{ fr: 'Merci, au revoir !', en: 'Thanks, goodbye!' }, { fr: 'À demain !', en: 'See you tomorrow!' }, t.again];
    default:
      return [
        t.count,
        special
          ? { fr: `${quantityPhrase(special, 1).replace(/^./, (c) => c.toUpperCase())}, s'il vous plaît.`, en: `${quantityPhraseEn(special, 1)}, please.` }
          : { fr: `${cap(t.example.fr)}.`, en: `${cap(t.example.en)}.` },
        t.talk ?? { fr: "Qu'est-ce que vous recommandez ?", en: 'What do you recommend?' },
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
      const place = PLACES[scene.place] ?? PLACES.cafe;
      const keeper = place.shopkeeper;
      const welcome = textFor(req).to;
      const sir = keeper.gender === 'm' ? 'monsieur' : 'madame';
      if (!name) {
        const intro = scene.place === 'cafe' ? '' : ` Je suis ${keeper.name}.`;
        const introEn = scene.place === 'cafe' ? '' : ` I'm ${keeper.name}.`;
        return turn(
          `Bonjour ! Bienvenue ${welcome.fr}.${intro} Comment vous appelez-vous ?`,
          `Hello! Welcome ${welcome.en}.${introEn} What is your name?`,
          [{ type: 'emote', kind: 'wave' }],
          0,
          [
            { fr: "Je m'appelle Alex.", en: 'My name is Alex.' },
            { fr: "Je m'appelle Sam.", en: 'My name is Sam.' },
            { fr: `Bonjour, ${sir} !`, en: `Hello, ${keeper.gender === 'm' ? 'sir' : "ma'am"}!` },
          ],
        );
      }
      const sp = special ? ` Aujourd'hui, je vous conseille ${definite(special)}.` : '';
      const spEn = special ? ` Today I recommend the ${special.en}.` : '';
      const pr = practice(req);
      if (scene.place !== 'cafe') {
        return turn(
          `Bonjour, ${name} ! Bienvenue ${welcome.fr}. Je suis ${keeper.name}.${pr ? pr.fr : sp}`,
          `Hello, ${name}! Welcome ${welcome.en}. I'm ${keeper.name}.${pr ? pr.en : spEn}`,
          [{ type: 'emote', kind: 'wave' }],
          0,
          withPractice(replies(req), pr),
        );
      }
      const fav = profile.memories.favorite_order;
      const recall = fav ? ` Comme hier, ${fav} ?` : '';
      const recallEn = fav ? ` Same as yesterday, ${fav}?` : '';
      const plat = special ? ` Le plat du jour : ${definite(special)}.` : '';
      const platEn = special ? ` Today's special: the ${special.en}.` : '';
      return turn(
        `Re-bonjour, ${name} !${recall}${pr ? pr.fr : plat}`,
        `Hello again, ${name}!${recallEn}${pr ? pr.en : platEn}`,
        [{ type: 'emote', kind: 'wave' }],
        0,
        withPractice(replies(req), pr),
      );
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
        `Besoin d'aide ? Montrez-moi un objet, ou dites : ${textFor(req).example.fr}.`,
        `Need help? Show me an item, or say: ${textFor(req).example.en}.`,
        special ? [{ type: 'point_at', itemId: special.id }] : [],
        0,
        replies(req),
      );

    case 'hint':
      return turn('Prenez votre temps.', 'Take your time.', [], 0, replies(req));

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
      return sayTurn(req, event.text, event.fingers, event.misheard);
  }
}

// ---- Proactive bits: mistakes, stock, offers, tomorrow -----------------------------

/** "quantity:deux≠douze" -> parts. */
function parseMistake(s: string): { kind: string; want: string; got: string } | null {
  const m = s.match(/^(\w+):([^≠]+)(?:≠(.*))?$/);
  return m ? { kind: m[1], want: m[2], got: m[3] ?? '' } : null;
}

/**
 * A returning learner's top mistake, reused on purpose: a short reminder line
 * and a reply that practises the right word.
 */
function practice(req: AgentRequest): { fr: string; en: string; reply: ReplyOption | null } | null {
  for (const raw of req.profile.mistakes ?? []) {
    const m = parseMistake(raw);
    if (!m) continue;
    if (m.kind === 'quantity' && m.got) {
      const n = NUMBER_WORDS[m.want];
      const item = menuItem(req.scene.special.itemId) ?? MENU[0];
      const reply = item && n >= 2 && n <= 5 ? { fr: `${cap(quantityPhrase(item, n))}, s'il vous plaît.`, en: `${cap(quantityPhraseEn(item, n))}, please.` } : null;
      return { fr: ` Petit rappel : ${m.want}, pas ${m.got} !`, en: ` Quick reminder: ${m.want} (${n}), not ${m.got} (${NUMBER_WORDS[m.got] ?? '?'})!`, reply };
    }
    if (m.kind === 'pronunciation') {
      const w = normalizeFrench(m.want);
      const item = MENU.find((x) => x.id === m.want || normalizeFrench(x.noun) === w || normalizeFrench(x.plural) === w);
      if (!item) continue;
      return {
        fr: ` On répète ensemble : « ${item.noun} ».`,
        en: ` Let's practise together: "${item.noun}".`,
        reply: { fr: `${cap(quantityPhrase(item, 1))}, s'il vous plaît.`, en: `${cap(quantityPhraseEn(item, 1))}, please.` },
      };
    }
    if (m.kind === 'payment') {
      return { fr: " Aujourd'hui, on compte bien la monnaie !", en: " Today, let's count the money carefully!", reply: { fr: "C'est combien, s'il vous plaît ?", en: 'How much is it, please?' } };
    }
  }
  return null;
}

function withPractice(reps: ReplyOption[], pr: { reply: ReplyOption | null } | null): ReplyOption[] {
  if (!pr?.reply) return reps;
  return [reps[0], reps[1], pr.reply];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isMan = (req: AgentRequest) => (PLACES[req.scene.place] ?? PLACES.cafe).shopkeeper.gender === 'm';
const sorry = (req: AgentRequest) => (isMan(req) ? 'Désolé' : 'Désolée');
const OFFER_REPLIES: ReplyOption[] = [
  { fr: 'Oui, avec plaisir !', en: 'Yes, with pleasure!' },
  { fr: "Non merci, c'est tout.", en: "No thanks, that's all." },
  { fr: "C'est combien ?", en: 'How much is it?' },
];

/** Pieces of an item still free to serve: stock minus what is already on the order. */
function freeStock(req: AgentRequest, id: string, alsoServed = 0): number {
  const left = req.scene.lowStock?.[id];
  if (left === undefined) return Infinity;
  return left - (req.scene.order.find((o) => o.itemId === id)?.qty ?? 0) - alsoServed;
}

/** The order intent, served within stock; the shortfall becomes a substitute offer. */
function orderTurn(req: AgentRequest, items: OrderLine[], fingers: number, polite: number, misheard?: string): AgentTurn {
  const actions: AgentAction[] = [];
  const served: OrderLine[] = [];
  let short: { item: MenuItem; left: number; missing: number } | null = null;
  // Misheard number ("douze" for "deux"): serve what they meant, correct gently.
  let fix: { want: string; got: string } | null = null;
  if (misheard && items.length === 1) {
    const [want, got] = misheard.split('≠');
    const n = NUMBER_WORDS[want];
    if (n >= 1 && n <= 5 && got) {
      items = [{ itemId: items[0].itemId, qty: n }];
      fix = { want, got };
    }
  }
  for (const l of items) {
    const qty = Math.max(0, Math.min(l.qty, freeStock(req, l.itemId)));
    if (qty > 0) {
      actions.push({ type: 'serve_items', itemId: l.itemId, quantity: qty });
      served.push({ itemId: l.itemId, qty });
    }
    const item = menuItem(l.itemId);
    if (qty < l.qty && item && !short) short = { item, left: qty, missing: l.qty - qty };
  }
  if (fix) actions.push({ type: 'correct', expected: fix.want, heard: fix.got, tip: `${fix.want} = ${NUMBER_WORDS[fix.want]}` });
  const p = orderPhrase(served);
  const head = fix ? `${cap(fix.got)} ? Non, ${fix.want} ! ` : '';
  const headEn = fix ? `${cap(fix.got)}? No, ${fix.want} (${NUMBER_WORDS[fix.want]})! ` : '';
  const points = 10 + polite + (fingers > 0 ? 5 : 0);

  if (short) {
    const outOf = (id: string) => freeStock(req, id, served.find((x) => x.itemId === id)?.qty ?? 0) <= 0;
    const sub = substituteFor(short.item.id, MENU, outOf);
    const missingQty = Math.min(5, short.missing);
    const lead =
      short.left > 0
        ? { fr: `Il ne reste que ${quantityPhrase(short.item, short.left)} !`, en: `There's only ${quantityPhraseEn(short.item, short.left)} left!` }
        : { fr: `${sorry(req)}, plus de ${short.item.plural} aujourd'hui !`, en: `Sorry, no more ${short.item.enPlural} today!` };
    const voila = served.length ? { fr: ` Voilà ${p.fr}.`, en: ` Here are ${p.en}.` } : { fr: '', en: '' };
    if (sub) {
      actions.push({ type: 'offer', itemId: sub.id, quantity: missingQty, reason: 'substitute' }, { type: 'emote', kind: 'shrug' });
      return turn(
        `${head}${lead.fr}${voila.fr} ${cap(quantityPhrase(sub, missingQty))} à la place ?`,
        `${headEn}${lead.en}${voila.en} ${cap(quantityPhraseEn(sub, missingQty))} instead?`,
        actions,
        points,
        OFFER_REPLIES,
      );
    }
    actions.push({ type: 'emote', kind: 'shrug' });
    return turn(`${head}${lead.fr}${voila.fr} Autre chose ?`, `${headEn}${lead.en}${voila.en} Anything else?`, actions, points, replies(req, served.length || req.scene.order.length ? 'ordering' : 'browsing'));
  }

  actions.push({ type: 'emote', kind: 'nod' });
  const up = req.scene.canUpsell
    ? upsellFor([...served, ...req.scene.order].map((l) => l.itemId), MENU, (id) => freeStock(req, id, served.find((x) => x.itemId === id)?.qty ?? 0) <= 0)
    : null;
  if (up) {
    actions.push({ type: 'offer', itemId: up.id, quantity: 1, reason: 'upsell' });
    return turn(
      `${head}Voilà ${p.fr} ! Avec ça, ${quantityPhrase(up, 1)} ?`,
      `${headEn}Here are ${p.en}! With that, ${quantityPhraseEn(up, 1)}?`,
      actions,
      points,
      OFFER_REPLIES,
    );
  }
  return turn(`${head}Voilà ${p.fr} ! Autre chose ?`, `${headEn}Here are ${p.en}! Anything else?`, actions, points, replies(req, 'ordering'));
}

/** The learner asked for something another shop sells: say where, offer what is here. */
function elsewhereTurn(req: AgentRequest, found: { item: MenuItem; place: string }): AgentTurn {
  const at = (PLACE_TEXT[found.place as keyof typeof PLACE_TEXT] ?? PLACE_TEXT.cafe).at;
  const sub = substituteFor(found.item.id, MENU, (id) => freeStock(req, id) <= 0);
  const lead = `${sorry(req)}, pas de ${found.item.plural} ici. C'est ${at.fr} !`;
  const leadEn = `Sorry, no ${found.item.enPlural} here. Try ${at.en}!`;
  if (sub && req.scene.phase !== 'paying' && req.scene.phase !== 'paid') {
    return turn(
      `${lead} ${cap(quantityPhrase(sub, 1))} ?`,
      `${leadEn} ${cap(quantityPhraseEn(sub, 1))}?`,
      [{ type: 'offer', itemId: sub.id, quantity: 1, reason: 'substitute' }, { type: 'emote', kind: 'shrug' }],
      3,
      OFFER_REPLIES,
    );
  }
  return turn(lead, leadEn, [{ type: 'emote', kind: 'shrug' }], 3, replies(req));
}

const THEME_EN: Record<string, string> = {
  'les fruits': 'fruit',
  'les viennoiseries': 'pastries',
  'le pain et le fromage': 'bread and cheese',
  'les boissons': 'drinks',
  'les légumes': 'vegetables',
  'les nombres': 'numbers',
  'les prix': 'prices',
};

/** "Demain, on travaille les fruits !" (when tomorrow is planned). */
function tomorrowLine(req: AgentRequest): { fr: string; en: string } {
  const t = req.scene.tomorrow;
  if (!t) return { fr: '', en: '' };
  return { fr: ` Demain, on travaille ${t} !`, en: ` Tomorrow we'll work on ${THEME_EN[t] ?? t}!` };
}

function sayTurn(req: AgentRequest, text: string, fingers: number, misheard?: string): AgentTurn {
  const { profile, scene } = req;
  let intent = parseIntent(text, fingers);
  // Something only another shop sells ("pain au chocolat" at the café, which would otherwise read as "pain").
  const norm = normalizeFrench(text);
  const elsewhere = findElsewhere(norm, scene.place, PLACES);
  if (elsewhere) {
    const rest = parseIntent(` ${norm} `.replace(` ${elsewhere.alias} `, ' '), fingers);
    if (rest.kind !== 'order') return elsewhereTurn(req, elsewhere);
    intent = rest;
  }
  // "Une carafe d'eau" is free tap water, not the bottle of water on the menu.
  if (scene.place === 'bistrot' && /\bcarafe\b/.test(norm)) {
    const rest = parseIntent(` ${norm} `.replace(/ (?:une |la )?carafes? (?:d )?(?:eau )?/, ' '), fingers);
    intent = rest.kind === 'order' ? rest : { kind: 'unknown' };
  }
  // Shop small talk (directions, aches, free tap water) before the generic answers.
  if (intent.kind === 'unknown' || intent.kind === 'recommend') {
    const talk = smallTalk(req, norm);
    if (talk) return talk;
  }
  const polite = /s.il vous pla[iî]t|merci/i.test(text) ? 5 : 0;
  const special = menuItem(scene.special.itemId);
  const name = profile.name ? `, ${profile.name}` : '';

  switch (intent.kind) {
    case 'name':
      return turn(
        `${isMan(req) ? 'Enchanté' : 'Enchantée'}, ${intent.name} ! Qu'est-ce que je vous sers ?`,
        `Nice to meet you, ${intent.name}! What can I get you?`,
        [{ type: 'remember', key: 'name', value: intent.name }, { type: 'emote', kind: 'nod' }],
        10,
        replies(req, 'browsing'),
      );
    case 'order':
      return orderTurn(req, intent.items, fingers, polite, misheard);
    case 'ask_price':
    case 'done_ordering':
      if (scene.order.length === 0) {
        const ex = textFor(req).example;
        return turn(`Vous n'avez rien commandé ! ${cap(ex.fr.replace(/, s'il vous plaît$/, ''))}, peut-être ?`, `You haven't ordered anything! ${cap(ex.en.replace(/, please$/, ''))}, maybe?`, [{ type: 'emote', kind: 'laugh' }], 2, replies(req, 'browsing'));
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
    case 'bye': {
      const tm = tomorrowLine(req);
      return turn(
        `À demain${name} ! Bonne journée !${tm.fr}`,
        `See you tomorrow${name}! Have a nice day!${tm.en}`,
        [{ type: 'emote', kind: 'wave' }, { type: 'end_visit' }],
        10,
        replies(req),
      );
    }
    case 'yes':
      if (scene.offer) {
        const item = menuItem(scene.offer.itemId);
        if (item) {
          return turn(
            `Parfait, ${quantityPhrase(item, scene.offer.qty)} ! Autre chose ?`,
            `Perfect, ${quantityPhraseEn(item, scene.offer.qty)}! Anything else?`,
            [{ type: 'serve_items', itemId: item.id, quantity: scene.offer.qty }, { type: 'emote', kind: 'nod' }],
            8,
            replies(req, 'ordering'),
          );
        }
      }
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
      if (intent.command === 'slower') {
        return turn("D'accord, je parle plus lentement.", "Okay, I'll speak more slowly.", [{ type: 'emote', kind: 'nod' }], 2, replies(req));
      }
      break;
    case 'unknown':
      break;
  }
  return turn('Pardon ? Vous pouvez répéter, s\'il vous plaît ?', 'Sorry? Can you repeat, please?', [{ type: 'emote', kind: 'think' }], 0, replies(req));
}

// ---- Small talk: each shop's everyday questions, answered offline too ----------------

/** Metro directions (real lines and stops; no brand names). */
const DIRECTIONS: { re: RegExp; fr: string; en: string }[] = [
  { re: /\b(montmartre|sacre coeur|abbesses)\b/, fr: 'Montmartre ? Ligne 12, station Abbesses. Bonne visite !', en: 'Montmartre? Line 12, Abbesses station. Enjoy!' },
  { re: /\b(tour eiffel|eiffel)\b/, fr: 'La tour Eiffel ? Ligne 6, station Bir-Hakeim.', en: 'The Eiffel Tower? Line 6, Bir-Hakeim station.' },
  { re: /\b(louvre|musee)\b/, fr: 'Le Louvre ? Ligne 1, station Palais-Royal.', en: 'The Louvre? Line 1, Palais-Royal station.' },
  { re: /\b(notre dame|cite)\b/, fr: 'Notre-Dame ? Ligne 4, station Cité.', en: 'Notre-Dame? Line 4, Cité station.' },
];

/** Pharmacy: where it hurts -> one everyday item (never more than that). */
const ACHES: { re: RegExp; item: string; fr: string; en: string }[] = [
  { re: /\b(tete|migraine)\b/, item: 'paracetamol', fr: 'Mal à la tête ? Du paracétamol, peut-être.', en: 'A headache? Some paracetamol, maybe.' },
  { re: /\b(gorge|tousse|toux)\b/, item: 'sirop', fr: 'Vous toussez ? Un sirop pour la toux, peut-être.', en: 'A cough? Some cough syrup, maybe.' },
  { re: /\b(coupe|coupure|doigt|genou|ampoule)\b/, item: 'pansements', fr: 'Oh là là ! Des pansements, alors.', en: 'Oh dear! Some plasters, then.' },
  { re: /\b(soleil|coup de soleil|plage)\b/, item: 'creme_solaire', fr: 'Pour le soleil, de la crème solaire !', en: 'For the sun, some sunscreen!' },
  { re: /\b(rhume|nez|eternue|enrhume)\b/, item: 'mouchoirs', fr: 'Un rhume ? Des mouchoirs, alors.', en: 'A cold? Some tissues, then.' },
];

function smallTalk(req: AgentRequest, norm: string): AgentTurn | null {
  const place = req.scene.place;
  const offer = (itemId: string, fr: string, en: string): AgentTurn | null => {
    const item = menuItem(itemId);
    if (!item || freeStock(req, itemId) <= 0) return turn(fr, en, [{ type: 'emote', kind: 'nod' }], 5, replies(req));
    const open = req.scene.phase !== 'paying' && req.scene.phase !== 'paid';
    return turn(
      fr,
      en,
      open ? [{ type: 'offer', itemId, quantity: 1, reason: 'upsell' }, { type: 'point_at', itemId }] : [{ type: 'point_at', itemId }],
      5,
      open ? OFFER_REPLIES : replies(req),
    );
  };
  if (place === 'bistrot') {
    if (/\bcarafe\b/.test(norm)) {
      return turn("Une carafe d'eau ? Bien sûr, c'est gratuit !", "A jug of tap water? Of course, it's free!", [{ type: 'emote', kind: 'nod' }, { type: 'point_at', itemId: 'carafe' }], 8, replies(req));
    }
    if (/\bplat du jour\b/.test(norm)) {
      return offer('plat_du_jour', "Aujourd'hui, c'est steak-frites avec des haricots verts. Ça vous dit ?", "Today it's steak and fries with green beans. Fancy it?");
    }
  }
  if (place === 'metro') {
    const d = DIRECTIONS.find((x) => x.re.test(norm));
    if (d) return turn(d.fr, d.en, [{ type: 'emote', kind: 'nod' }, { type: 'point_at', itemId: 'plan_metro' }], 8, replies(req));
    if (/\b(pour aller|comment aller|ou est|c est ou)\b/.test(norm)) {
      return offer('plan_metro', 'Regardez le plan du métro : tout est dessus !', "Look at the metro map: it's all on there!");
    }
  }
  if (place === 'pharmacie') {
    if (/\b(urgence|tres mal|fievre|saigne|allergie)\b/.test(norm)) {
      return turn('Pour ça, allez voir un médecin, tout de suite.', 'For that, go and see a doctor, right away.', [{ type: 'emote', kind: 'think' }], 3, replies(req));
    }
    const a = ACHES.find((x) => x.re.test(norm));
    if (a) return offer(a.item, a.fr, a.en);
    if (/\b(mal|malade|pas bien)\b/.test(norm)) {
      return turn('Oh, mince. Vous avez mal où ?', 'Oh no. Where does it hurt?', [{ type: 'emote', kind: 'think' }], 3, [
        { fr: "J'ai mal à la tête.", en: 'I have a headache.' },
        { fr: "J'ai mal à la gorge.", en: 'I have a sore throat.' },
        { fr: 'Je me suis coupé le doigt.', en: 'I cut my finger.' },
      ]);
    }
  }
  return null;
}
