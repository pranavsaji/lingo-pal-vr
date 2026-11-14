/**
 * "Sounds like": French respelled for an English speaker ("Deux cafés, s'il vous
 * plaît." -> "duh ka-FAY, seel voo PLAY"). Shown in small grey italics under a
 * reply chip and under Pal's "Say:" chip.
 *
 * Three layers, best first:
 *  1. hand-written whole phrases (every fixed line of the offline script);
 *  2. a word and word-group lexicon (every menu word of every shop, numbers,
 *     prices, politeness), matched longest first;
 *  3. rough spelling rules for anything else.
 * French stresses the end of a word group, so the last syllable of each
 * comma-separated group is written in capitals.
 *
 * Pure: no DOM, no World. The AI route may send its own `sounds`; this fills
 * the gaps (offline script, payment chips, older replies).
 */

import { spellOutNumbers } from '../agent/menu.js';

/** Lowercase, no accents, apostrophes and hyphens as spaces, no punctuation. */
export function plainFrench(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe')
    .replace(/[’'`-]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whole fixed lines (keys are plainFrench), written by hand. */
const PHRASES: Record<string, string> = {
  'c est tout merci': 'say TOO, mair-SEE',
  'non merci c est tout': 'nohn mair-SEE, say TOO',
  'merci au revoir': 'mair-SEE, oh ruh-VWAHR',
  'a demain': 'ah duh-MAN',
  voila: 'vwah-LAH',
  'je paie en especes': 'zhuh PAY ahn ess-PESS',
  'pardon c est combien': 'par-DOHN, say kohm-BYAN',
  'c est combien': 'say kohm-BYAN',
  'c est combien s il vous plait': 'say kohm-BYAN, seel voo PLAY',
  'ca fait combien': 'sa fay kohm-BYAN',
  'qu est ce que vous recommandez': 'kess kuh voo ruh-ko-mahn-DAY',
  'je m appelle alex': 'zhuh ma-pel a-LEKS',
  'je m appelle sam': 'zhuh ma-pel SAM',
  'bonjour madame': 'bohn-ZHOOR, ma-DAM',
  'bonjour monsieur': 'bohn-ZHOOR, muh-SYUH',
  bonjour: 'bohn-ZHOOR',
  'non merci': 'nohn, mair-SEE',
  'oui avec plaisir': 'wee, a-vek play-ZEER',
  'plus lentement s il vous plait': 'plew lahnt-MAHN, seel voo PLAY',
  'non ca va merci': 'nohn, sa VA, mair-SEE',
  'voila c est juste': 'vwah-LAH, say ZHEWST',
  'je paie par carte': 'zhuh pay par KART',
  'voila deux euros': 'vwah-LAH duh-zuh-ROH',
  'pardon vous pouvez repeter plus lentement': 'par-DOHN, voo poo-vay ray-pay-tay plew lahnt-MAHN',
  'vous pouvez repeter s il vous plait': 'voo poo-vay ray-pay-TAY, seel voo PLAY',
  'oui c est parti': 'wee, say par-TEE',
  'pas encore merci': 'pa-zahn-KOR, mair-SEE',
  'c est quoi la vraie vie': 'say KWAH, la vray VEE',
  'j ai une reservation': 'zhay ewn ray-zair-va-SYOHN',
  'une chambre s il vous plait': 'ewn SHAHM-bruh, seel voo PLAY',
  'je voudrais autre chose': 'zhuh voo-dray oh-truh SHOHZ',
  'j ai mal a la tete': 'zhay mal a la TET',
  'j ai mal a la gorge': 'zhay mal a la GORZH',
  'je me suis coupe le doigt': 'zhuh muh swee koo-pay luh DWAH',
  'merci beaucoup': 'mair-SEE boh-KOO',
  'au revoir bonne journee': 'oh ruh-VWAHR, bun zhoor-NAY',
  'l addition s il vous plait': 'la-dee-SYOHN, seel voo PLAY',
  'merci': 'mair-SEE',
  'oui': 'WEE',
  'non': 'NOHN',
  pardon: 'par-DOHN',
  'avec le petit dejeuner': 'a-vek luh puh-tee day-zhuh-NAY',
};

/** Words and word groups (keys are plainFrench, 1 to 4 words), lowercase syllables. */
const WORDS: Record<string, string> = {
  // Politeness and glue.
  's il vous plait': 'seel voo play',
  'qu est ce que': 'kess kuh',
  'c est': 'say',
  'j ai': 'zhay',
  'je voudrais': 'zhuh voo-dray',
  'je prends': 'zhuh prahn',
  'au revoir': 'oh ruh-vwahr',
  'd accord': 'da-kor',
  'a demain': 'a duh-man',
  'l addition': 'la-dee-syohn',
  "d eau": 'doh',
  "d orange": 'do-rahnzh',
  "d une": 'dewn',
  "l oignon": 'lo-nyohn',
  bonjour: 'bohn-zhoor', bonsoir: 'bohn-swahr', merci: 'mair-see', oui: 'wee', non: 'nohn', voila: 'vwah-la',
  pardon: 'par-dohn', madame: 'ma-dam', monsieur: 'muh-syuh', combien: 'kohm-byan', tout: 'too', encore: 'ahn-kor',
  aussi: 'oh-see', avec: 'a-vek', pour: 'poor', sans: 'sahn', et: 'ay', ou: 'oo', en: 'ahn', a: 'a', au: 'oh', aux: 'oh',
  le: 'luh', la: 'la', les: 'lay', l: 'l', un: 'uhn', une: 'ewn', des: 'day', du: 'dew', de: 'duh', d: 'd',
  je: 'zhuh', vous: 'voo', il: 'eel', elle: 'el', ca: 'sa', est: 'ay', ce: 'suh', moi: 'mwah', pas: 'pa', plus: 'plew',
  beaucoup: 'boh-koo', bien: 'byan', tres: 'tray', bon: 'bohn', bonne: 'bun', journee: 'zhoor-nay', demain: 'duh-man',
  plaisir: 'play-zeer', volontiers: 'vo-lohn-tyay', parfait: 'par-fay', fait: 'fay', paie: 'pay', payer: 'pay-ay',
  carte: 'kart', especes: 'ess-pess', juste: 'zhewst', voudrais: 'voo-dray', prendre: 'prahn-druh', veux: 'vuh',
  sur: 'sewr', place: 'plas', emporter: 'ahn-por-tay', ici: 'ee-see', sac: 'sak', terrasse: 'tair-ras',
  interieur: 'an-tay-ryuhr', comptoir: 'kohn-twahr', salle: 'sal', mal: 'mal', tete: 'tet', gorge: 'gorzh',
  lentement: 'lahnt-mahn', repeter: 'ray-pay-tay', pouvez: 'poo-vay', recommandez: 'ruh-ko-mahn-day',
  chambre: 'shahm-bruh', reservation: 'ray-zair-va-syohn', nom: 'nohm', appelle: 'a-pel', m: 'm', j: 'zh', n: 'n', s: 's', t: 't', qu: 'k', me: 'muh', te: 'tuh', se: 'suh', ne: 'nuh', alex: 'a-leks', ai: 'ay', avez: 'a-vay', avons: 'a-vohn', suis: 'swee', sont: 'sohn', sam: 'sam', autre: 'oh-truh',
  chose: 'shohz', dessert: 'day-sair', aller: 'a-lay', tour: 'toor', eiffel: 'ay-fel', montmartre: 'mohn-mar-truh',
  // Numbers and money.
  zero: 'zay-roh', deux: 'duh', trois: 'trwah', quatre: 'katr', cinq: 'sank', six: 'sees', sept: 'set', huit: 'weet',
  neuf: 'nuhf', dix: 'dees', onze: 'ohnz', douze: 'dooz', treize: 'trez', quatorze: 'ka-torz', quinze: 'kanz',
  seize: 'sez', vingt: 'van', trente: 'trahnt', quarante: 'ka-rahnt', cinquante: 'san-kahnt', soixante: 'swa-sahnt',
  cent: 'sahn', euro: 'uh-roh', euros: 'uh-roh', centimes: 'sahn-teem', centime: 'sahn-teem', billet: 'bee-yay',
  // Every menu word (all shops).
  croissant: 'krwah-sahn', croissants: 'krwah-sahn', cafe: 'ka-fay', cafes: 'ka-fay', baguette: 'ba-get',
  baguettes: 'ba-get', pomme: 'pom', pommes: 'pom', orange: 'o-rahnzh', oranges: 'o-rahnzh', fromage: 'fro-mahzh',
  fromages: 'fro-mahzh', bouteille: 'boo-tay', bouteilles: 'boo-tay', eau: 'oh', gateau: 'ga-toh', gateaux: 'ga-toh',
  pain: 'pan', pains: 'pan', chocolat: 'sho-ko-la', petit: 'puh-tee', petits: 'puh-tee', eclair: 'ay-klair',
  eclairs: 'ay-klair', macaron: 'ma-ka-rohn', macarons: 'ma-ka-rohn', tarte: 'tart', tartes: 'tart', cerises: 'suh-reez',
  poire: 'pwahr', poires: 'pwahr', banane: 'ba-nan', bananes: 'ba-nan', citron: 'see-trohn', citrons: 'see-trohn',
  kiwi: 'kee-wee', kiwis: 'kee-wee', avocat: 'a-vo-ka', avocats: 'a-vo-ka', oignon: 'o-nyohn', oignons: 'o-nyohn',
  patate: 'pa-tat', patates: 'pa-tat', douce: 'doos', douces: 'doos', grenade: 'gruh-nad', grenades: 'gruh-nad',
  plat: 'pla', plats: 'pla', jour: 'zhoor', soupe: 'soop', soupes: 'soop', salade: 'sa-lad', salades: 'sa-lad',
  crepe: 'krep', crepes: 'krep', jus: 'zhew', carafe: 'ka-raf', ticket: 'tee-kay', tickets: 'tee-kay',
  carnet: 'kar-nay', carnets: 'kar-nay', forfait: 'for-fay', forfaits: 'for-fay', plan: 'plahn', plans: 'plahn',
  metro: 'may-troh', boite: 'bwat', boites: 'bwat', pansements: 'pahns-mahn', creme: 'krem', cremes: 'krem',
  solaire: 'so-lair', solaires: 'so-lair', paquet: 'pa-kay', paquets: 'pa-kay', mouchoirs: 'moo-shwahr',
  sirop: 'see-roh', sirops: 'see-roh', toux: 'too', paracetamol: 'pa-ra-say-ta-mol', nuit: 'nwee', nuits: 'nwee',
  dejeuner: 'day-zhuh-nay', dejeuners: 'day-zhuh-nay', ville: 'veel', postale: 'pos-tal', postales: 'pos-tal',
  parapluie: 'pa-ra-plwee', parapluies: 'pa-ra-plwee', sonnette: 'so-net', verre: 'vair', assiette: 'a-syet',
  menu: 'muh-new', fleur: 'fluhr', panier: 'pa-nyay', cageot: 'ka-zhoh', lait: 'lay', sucre: 'sew-kruh',
};

/**
 * Rough French spelling -> English-ish sounds, for words the lexicon does not know.
 * Sounds are written as UPPERCASE placeholders while the rules run (so a later
 * rule never re-reads an earlier result), then lowercased.
 */
const V = 'aeiouyéèêëàâîïôûù';
const RULES: [RegExp, string][] = [
  [/tion$/, 'SYOHN'],
  [/(er|ez|et)$/, 'AY'],
  [/(eaux|aux)$/, 'OH'],
  [/(es|s|x|z|t|d|p)$/, ''],
  [/(?<=..)e$/, ''],
  [/eau|au/g, 'OH'],
  [/eill/g, 'AY'],
  [/aill/g, 'AHY'],
  [/ill/g, 'EEY'],
  [/ou|où|oû/g, 'OO'],
  [/oi/g, 'WAH'],
  [/ai|ei|aî/g, 'AY'],
  [/[èêë]/g, 'EH'],
  [/é/g, 'AY'],
  [/ch/g, 'SH'],
  [/ph/g, 'F'],
  [/gn/g, 'NY'],
  [/qu/g, 'K'],
  [/th/g, 'T'],
  [/ç/g, 'S'],
  [/c(?=[eiyéèê])/g, 'S'],
  [/c/g, 'K'],
  [/g(?=[eiyéèê])/g, 'ZH'],
  [/j/g, 'ZH'],
  [new RegExp(`(an|am|en|em)(?![${V}nm])`, 'g'), 'AHN'],
  [new RegExp(`(on|om)(?![${V}nm])`, 'g'), 'OHN'],
  [new RegExp(`(ain|ein|in|im|un|um)(?![${V}nm])`, 'g'), 'AN'],
  [/eu|œu/g, 'UH'],
  [/[uûù]/g, 'EW'],
  [/[àâ]/g, 'A'],
  [/[iîïy]/g, 'EE'],
  [/ô/g, 'O'],
  [/e/g, 'UH'],
  [/^h/, ''],
  [/ss/g, 'S'],
];

export function ruleSounds(word: string): string {
  const w0 = word.toLowerCase();
  if (w0.length <= 2) return w0;
  let w = w0;
  for (const [re, s] of RULES) w = w.replace(re, s);
  return w.toLowerCase() || w0;
}

/** Accent-keeping word split (for the rules) aligned with plainFrench words (for the lexicon). */
function words(clause: string): { raw: string; plain: string }[] {
  const raw = clause
    .toLowerCase()
    .replace(/[’'`-]/g, ' ')
    .replace(/[^a-zà-ÿœ0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return raw.map((r) => ({ raw: r, plain: plainFrench(r) })).filter((w) => w.plain);
}

/** Elided l' d' m' j' n' s' t' qu' attach to the next word. */
const ELIDED = new Set(['l', 'd', 'm', 'zh', 'n', 's', 't', 'k']);

/** Capitalise the last syllable of a group ("duh krwah-sahn" -> "duh krwah-SAHN"). */
function stressLast(s: string): string {
  const i = Math.max(s.lastIndexOf(' '), s.lastIndexOf('-'));
  const last = s.slice(i + 1);
  // A long rule-made word: split off its last syllable ("rahnsaynyuhmahn" -> "rahnsaynyuh-MAHN").
  const syl = last.length > 5 ? /[^aeiou]*[aeiou]+[^aeiou]*$/.exec(last)?.[0] : undefined;
  if (syl && syl.length < last.length) return `${s.slice(0, i + 1)}${last.slice(0, -syl.length)}-${syl.toUpperCase()}`;
  return s.slice(0, i + 1) + last.toUpperCase();
}

function clauseSounds(clause: string): string {
  const ws = words(clause);
  const out: string[] = [];
  for (let i = 0; i < ws.length; ) {
    let hit = '';
    let n = 0;
    for (let len = Math.min(4, ws.length - i); len >= 1 && !hit; len--) {
      const key = ws.slice(i, i + len).map((w) => w.plain).join(' ');
      if (WORDS[key] !== undefined) {
        hit = WORDS[key];
        n = len;
      }
    }
    if (!hit) {
      hit = ruleSounds(ws[i].raw);
      n = 1;
    }
    // Elided l' / d' / m' attach to the next word ("l addition" handled above; "d" + "eau").
    if (ELIDED.has(hit) && i + n < ws.length) {
      const next = WORDS[ws[i + n].plain] ?? ruleSounds(ws[i + n].raw);
      out.push(hit + next);
      i += n + 1;
      continue;
    }
    out.push(hit);
    i += n;
  }
  return out.length ? stressLast(out.join(' ')) : '';
}

/** "Deux cafés, s'il vous plaît." -> "duh ka-FAY, seel voo PLAY" ('' for empty text). */
export function soundsLike(fr: string): string {
  const text = spellOutNumbers(fr).replace(/«|»|"/g, ' ').trim();
  if (!text) return '';
  const whole = PHRASES[plainFrench(text)];
  if (whole) return whole;
  return text
    .split(/[,;:.!?]+/)
    .map((c) => {
      const p = PHRASES[plainFrench(c)];
      return p ?? clauseSounds(c);
    })
    .filter(Boolean)
    .join(', ');
}
