/**
 * Madame Lune, the AI shopkeeper.
 *
 * Talks to /api/chat (a server route that holds the API key; see
 * server/chat-handler.mjs). If the route is missing or fails, a scripted
 * conversation keeps the experience fully playable offline.
 */

export interface ReplyOption {
  fr: string;
  en: string;
}

export interface ShopkeeperTurn {
  fr: string;
  en: string;
  options: ReplyOption[]; // exactly 3
  points: number; // reward for the learner's last message
  source: 'ai' | 'script';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const OPENING: ShopkeeperTurn = {
  fr: 'Bonjour ! Bienvenue au café. Qu\'est-ce que je vous sers ?',
  en: 'Hello! Welcome to the cafe. What can I get you?',
  options: [
    { fr: 'Bonjour, madame !', en: 'Hello, ma\'am!' },
    { fr: 'Un café, s\'il vous plaît.', en: 'A coffee, please.' },
    { fr: 'Je voudrais un croissant.', en: 'I would like a croissant.' },
  ],
  points: 0,
  source: 'script',
};

export function openingTurn(): ShopkeeperTurn {
  return OPENING;
}

// ---- Scripted fallback ------------------------------------------------------

const SCRIPT: Array<{ match: RegExp; turn: Omit<ShopkeeperTurn, 'source'> }> = [
  {
    match: /^\[montre: (.+)\]$/,
    turn: {
      fr: 'Ah, vous me montrez $1 ! Vous le voulez ?',
      en: 'Ah, you are showing me $1! Do you want it?',
      options: [
        { fr: 'Oui, s\'il vous plaît.', en: 'Yes, please.' },
        { fr: 'Non, merci.', en: 'No, thank you.' },
        { fr: 'C\'est combien ?', en: 'How much is it?' },
      ],
      points: 5,
    },
  },
  {
    match: /bonjour/i,
    turn: {
      fr: 'Bonjour ! Vous désirez ?',
      en: 'Hello! What would you like?',
      options: [
        { fr: 'Un café, s\'il vous plaît.', en: 'A coffee, please.' },
        { fr: 'Je voudrais un croissant.', en: 'I would like a croissant.' },
        { fr: 'Qu\'est-ce que vous recommandez ?', en: 'What do you recommend?' },
      ],
      points: 5,
    },
  },
  {
    match: /café|coffee/i,
    turn: {
      fr: 'Très bien, un café. Avec du lait ?',
      en: 'Very good, a coffee. With milk?',
      options: [
        { fr: 'Oui, avec du lait.', en: 'Yes, with milk.' },
        { fr: 'Non, noir, merci.', en: 'No, black, thanks.' },
        { fr: 'Et un croissant aussi.', en: 'And a croissant too.' },
      ],
      points: 10,
    },
  },
  {
    match: /croissant/i,
    turn: {
      fr: 'Un croissant, tout de suite ! Autre chose ?',
      en: 'A croissant, right away! Anything else?',
      options: [
        { fr: 'Un café aussi, s\'il vous plaît.', en: 'A coffee too, please.' },
        { fr: 'Non, c\'est tout.', en: 'No, that\'s all.' },
        { fr: 'C\'est combien ?', en: 'How much is it?' },
      ],
      points: 10,
    },
  },
  {
    match: /recommand/i,
    turn: {
      fr: 'Je recommande le gâteau au chocolat. Il est délicieux !',
      en: 'I recommend the chocolate cake. It is delicious!',
      options: [
        { fr: 'D\'accord, le gâteau !', en: 'Okay, the cake!' },
        { fr: 'Un café, s\'il vous plaît.', en: 'A coffee, please.' },
        { fr: 'Non, merci.', en: 'No, thank you.' },
      ],
      points: 10,
    },
  },
  {
    match: /combien|how much/i,
    turn: {
      fr: 'Ça fait quatre euros cinquante, s\'il vous plaît.',
      en: 'That comes to four euros fifty, please.',
      options: [
        { fr: 'Voilà. Merci beaucoup !', en: 'Here you go. Thank you very much!' },
        { fr: 'Je peux payer par carte ?', en: 'Can I pay by card?' },
        { fr: 'C\'est cher !', en: 'That\'s expensive!' },
      ],
      points: 10,
    },
  },
  {
    match: /carte|merci|voilà|c'est tout|cher|non/i,
    turn: {
      fr: 'Merci à vous ! Bonne journée et à bientôt !',
      en: 'Thank you! Have a nice day and see you soon!',
      options: [
        { fr: 'Au revoir, madame !', en: 'Goodbye, ma\'am!' },
        { fr: 'Bonne journée !', en: 'Have a nice day!' },
        { fr: 'Encore un café, s\'il vous plaît.', en: 'Another coffee, please.' },
      ],
      points: 10,
    },
  },
];

const SCRIPT_DEFAULT: Omit<ShopkeeperTurn, 'source'> = {
  fr: 'Parfait ! Et avec ceci ?',
  en: 'Perfect! Anything else with that?',
  options: [
    { fr: 'Un café, s\'il vous plaît.', en: 'A coffee, please.' },
    { fr: 'C\'est combien ?', en: 'How much is it?' },
    { fr: 'Non, c\'est tout. Merci !', en: 'No, that\'s all. Thanks!' },
  ],
  points: 5,
};

function scripted(userText: string): ShopkeeperTurn {
  for (const { match, turn } of SCRIPT) {
    const m = userText.match(match);
    if (m) {
      const fill = (s: string) => (m[1] ? s.replace('$1', m[1]) : s);
      return { ...turn, fr: fill(turn.fr), en: fill(turn.en), source: 'script' };
    }
  }
  return { ...SCRIPT_DEFAULT, source: 'script' };
}

// ---- AI path -----------------------------------------------------------------

function isTurn(x: unknown): x is Omit<ShopkeeperTurn, 'source'> {
  if (typeof x !== 'object' || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.fr === 'string' &&
    typeof t.en === 'string' &&
    Array.isArray(t.options) &&
    t.options.length === 3 &&
    t.options.every(
      (o) => typeof o === 'object' && o !== null && typeof (o as ReplyOption).fr === 'string',
    )
  );
}

let aiAvailable: boolean | null = null; // unknown until the first call

export async function shopkeeperReply(history: ChatMessage[]): Promise<ShopkeeperTurn> {
  const last = history[history.length - 1]?.content ?? '';
  if (aiAvailable === false) return scripted(last);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch('./api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 404 || res.status === 503) {
      // No server route or no API key configured: use the script for this session.
      aiAvailable = false;
      return scripted(last);
    }
    if (!res.ok) throw new Error(`chat ${res.status}`);
    const data: unknown = await res.json();
    if (!isTurn(data)) throw new Error('bad shape');
    aiAvailable = true;
    return {
      fr: data.fr,
      en: data.en,
      options: data.options.map((o) => ({ fr: o.fr, en: o.en ?? '' })),
      points: typeof data.points === 'number' ? Math.max(0, Math.min(20, data.points)) : 10,
      source: 'ai',
    };
  } catch {
    // Network hiccup, timeout or malformed reply: answer from the script this turn.
    return scripted(last);
  }
}
