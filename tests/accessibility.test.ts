import { describe, expect, it } from 'vitest';
import { pickCoins } from '../src/interaction/pick-coins.js';
import { DEFAULT_SETTINGS } from '../src/state/profile.js';
import { type BootMark, bootView, LUNE_GRACE_S } from '../src/ui/boot.js';
import { a11ySummary, modeOf, nextTextSize, settingsForMode } from '../src/ui/input-mode.js';
import { parseVoiceCommand } from '../src/voice/voice-commands.js';

const idle = { paying: false, choosing: false };
const paying = { paying: true, choosing: false };
const choosing = { paying: false, choosing: true };

describe('global voice commands (French and English)', () => {
  it('opens every panel by voice', () => {
    expect(parseVoiceCommand('Le plan', idle)).toEqual({ kind: 'open', panel: 'map' });
    expect(parseVoiceCommand('Open the map', idle)).toEqual({ kind: 'open', panel: 'map' });
    expect(parseVoiceCommand('Ma semaine', idle)).toEqual({ kind: 'open', panel: 'report' });
    expect(parseVoiceCommand('my week', idle)).toEqual({ kind: 'open', panel: 'report' });
    expect(parseVoiceCommand('Mon carnet', idle)).toEqual({ kind: 'open', panel: 'carnet' });
    expect(parseVoiceCommand('Réglages', idle)).toEqual({ kind: 'open', panel: 'settings' });
    expect(parseVoiceCommand('settings', idle)).toEqual({ kind: 'open', panel: 'settings' });
    expect(parseVoiceCommand('Fermer', idle)).toEqual({ kind: 'close' });
    expect(parseVoiceCommand('close', idle)).toEqual({ kind: 'close' });
  });

  it('repeat, slower, help, skip', () => {
    expect(parseVoiceCommand('Répète', idle)).toEqual({ kind: 'repeat' });
    expect(parseVoiceCommand('repeat please', idle)).toEqual({ kind: 'repeat' });
    expect(parseVoiceCommand('Plus lentement', idle)).toEqual({ kind: 'slower' });
    expect(parseVoiceCommand('slower', idle)).toEqual({ kind: 'slower' });
    expect(parseVoiceCommand('Aide', idle)).toEqual({ kind: 'help' });
    expect(parseVoiceCommand('Passer', idle)).toEqual({ kind: 'skip' });
  });

  it('travels, in French and English', () => {
    expect(parseVoiceCommand('Allons à la boulangerie', idle)).toEqual({ kind: 'travel', place: 'boulangerie' });
    expect(parseVoiceCommand('go to the market', idle)).toEqual({ kind: 'travel', place: 'marche' });
    expect(parseVoiceCommand('Retour au café', idle)).toEqual({ kind: 'travel', place: 'cafe' });
  });

  it('"je paie" places exact coins only while paying, and leaves amounts to the intent parser', () => {
    expect(parseVoiceCommand('Je paie', paying)).toEqual({ kind: 'pay_exact' });
    expect(parseVoiceCommand("Voilà, c'est juste", paying)).toEqual({ kind: 'pay_exact' });
    expect(parseVoiceCommand('Je paie', idle)).toBeNull();
    expect(parseVoiceCommand('Voilà cinq euros', paying)).toBeNull();
  });

  it('input modes: bare words while choosing, "mode ..." anytime', () => {
    expect(parseVoiceCommand('Les yeux', choosing)).toEqual({ kind: 'mode', mode: 'eyes' });
    expect(parseVoiceCommand('La voix', choosing)).toEqual({ kind: 'mode', mode: 'voice' });
    expect(parseVoiceCommand('hands', choosing)).toEqual({ kind: 'mode', mode: 'hands' });
    expect(parseVoiceCommand('La voix', idle)).toBeNull();
    expect(parseVoiceCommand('Mode regard', idle)).toEqual({ kind: 'mode', mode: 'eyes' });
  });

  it('settings rows', () => {
    expect(parseVoiceCommand('Contraste', idle)).toEqual({ kind: 'toggle', setting: 'highContrast' });
    expect(parseVoiceCommand('Texte plus grand', idle)).toEqual({ kind: 'text', bigger: true });
    expect(parseVoiceCommand('sous-titres', idle)).toEqual({ kind: 'toggle', setting: 'subtitles' });
    expect(parseVoiceCommand('mains libres', idle)).toEqual({ kind: 'toggle', setting: 'voiceFirst' });
    expect(parseVoiceCommand('Révision', idle)).toEqual({ kind: 'review' });
  });

  it('never hijacks conversation', () => {
    for (const s of [
      "Un café, s'il vous plaît.",
      'Bonjour, madame !',
      'Je voudrais deux croissants et un pain au chocolat',
      'Par carte',
      'La carte, s’il vous plaît',
      'À la semaine prochaine',
      "C'est combien ?",
      'Voilà cinq euros',
      'Je voudrais passer commande pour deux cafés et un croissant au beurre',
    ]) {
      expect(parseVoiceCommand(s, idle), s).toBeNull();
    }
  });
});

describe('"je paie" coin choice', () => {
  const purse = [1000, 500, 200, 200, 100, 100, 50, 20, 20, 10];
  const sum = (idx: number[]) => idx.reduce((t, i) => t + purse[i], 0);

  it('pays the exact amount with the fewest pieces', () => {
    const pick = pickCoins(purse, 170);
    expect(sum(pick)).toBe(170);
    expect(pick.length).toBe(3); // 1 € + 50 c + 20 c
  });

  it('overpays as little as possible when exact change is impossible', () => {
    expect(pickCoins([500, 200], 170)).toEqual([1]); // the 2 euro coin, not the note
  });

  it('returns nothing when the purse cannot cover it', () => {
    expect(pickCoins([10, 20], 500)).toEqual([]);
    expect(pickCoins(purse, 0)).toEqual([]);
  });
});

describe('landing progress', () => {
  const view = (marks: BootMark[], since = 0) => bootView(new Set(marks), since);

  it('only moves on real milestones and caps the creep below the next one', () => {
    const a = view([]);
    const b = view(['code']);
    const c = view(['code', 'world']);
    expect(a.progress).toBeLessThan(b.progress);
    expect(b.progress).toBeLessThan(c.progress);
    expect(b.cap).toBeLessThan(c.progress);
    expect(c.ready).toBe(false);
  });

  it('is ready once the shop and Lune are there, or after a grace period', () => {
    expect(view(['code', 'world', 'shop']).ready).toBe(false);
    expect(view(['code', 'world', 'shop', 'lune']).ready).toBe(true);
    expect(view(['code', 'world', 'shop'], LUNE_GRACE_S).ready).toBe(true);
    expect(view(['code', 'world', 'lune']).ready).toBe(false);
    expect(view(['code', 'world', 'shop', 'lune']).progress).toBe(1);
  });
});

describe('input modes and the settings summary', () => {
  it('maps each mode to settings and back', () => {
    for (const mode of ['hands', 'eyes', 'voice'] as const) {
      expect(modeOf({ ...DEFAULT_SETTINGS, ...settingsForMode(mode) })).toBe(mode);
    }
  });

  it('inclusive defaults: subtitles on, hands mode, medium text', () => {
    expect(DEFAULT_SETTINGS.subtitles).toBe(true);
    expect(modeOf(DEFAULT_SETTINGS)).toBe('hands');
    expect(a11ySummary(DEFAULT_SETTINGS)).toBe('Accessibilité : mains · sous-titres · texte M');
  });

  it('summarizes what is on', () => {
    const s = { ...DEFAULT_SETTINGS, voiceFirst: true, highContrast: true, textSize: 'l' as const };
    expect(a11ySummary(s)).toBe('Accessibilité : voix · sous-titres · texte L · contraste');
  });

  it('text size steps and wraps', () => {
    expect(nextTextSize('m', true)).toBe('l');
    expect(nextTextSize('l', true)).toBe('l');
    expect(nextTextSize('l', true, true)).toBe('s');
    expect(nextTextSize('s', false)).toBe('s');
  });
});
