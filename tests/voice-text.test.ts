import { describe, expect, it } from 'vitest';
import { spellOutNumbers } from '../src/agent/menu.js';
import { parseIntent } from '../src/agent/intent.js';
import { scorePronunciation } from '../src/voice/pronunciation.js';
import { hasSpeech, isHallucination, trimSilence, ttsChunks } from '../src/voice/voice-text.js';

describe('spellOutNumbers', () => {
  it('spells prices and counts the way Whisper writes them', () => {
    expect(spellOutNumbers('Ça fait 3,40 €.')).toBe('Ça fait trois euros quarante.');
    expect(spellOutNumbers('Voilà 5 euros')).toBe('Voilà cinq euros');
    expect(spellOutNumbers('5€')).toBe('cinq euros');
    expect(spellOutNumbers('2 croissants')).toBe('deux croissants');
    expect(spellOutNumbers('Ça fait 3,40.')).toBe('Ça fait trois euros quarante.');
  });
});

describe('digits from speech-to-text', () => {
  it('score like the words they stand for', () => {
    expect(scorePronunciation('Deux croissants, s’il vous plaît.', '2 croissants, s’il vous plaît.').score).toBe(100);
  });
  it('still parse as orders and payments', () => {
    const order = parseIntent('Je voudrais 2 croissants');
    expect(order.kind).toBe('order');
    if (order.kind === 'order') expect(order.items[0]).toEqual({ itemId: 'croissant', qty: 2 });
    expect(parseIntent('Voilà 5 euros')).toEqual({ kind: 'pay', cents: 500 });
  });
});

describe('ttsChunks', () => {
  it('splits at punctuation, spells numbers, keeps only voice-model characters', () => {
    const chunks = ttsChunks('Bonjour, Alex ! Ça fait 3,40 €. Merci.');
    expect(chunks.map((c) => c.text)).toEqual(['bonjour', 'alex', 'ça fait trois euros quarante', 'merci']);
    expect(chunks[0].pauseMs).toBe(120);
    expect(chunks[1].pauseMs).toBe(260);
    expect(chunks[3].pauseMs).toBe(260);
  });
  it('keeps elisions and drops emoji or symbols', () => {
    expect(ttsChunks("S'il vous plaît 🙂 — d'accord")[0].text).toBe("s'il vous plaît d'accord");
    expect(ttsChunks('…!?')).toEqual([]);
  });
});

describe('silence handling', () => {
  const rate = 16000;
  const tone = (secs: number, amp: number) => Float32Array.from({ length: secs * rate }, (_, i) => amp * Math.sin(i / 5));
  it('detects silence and trims around speech', () => {
    expect(hasSpeech(new Float32Array(rate))).toBe(false);
    const clip = new Float32Array(3 * rate);
    clip.set(tone(1, 0.2), rate); // speech from 1 s to 2 s
    expect(hasSpeech(clip)).toBe(true);
    const trimmed = trimSilence(clip, rate);
    expect(trimmed.length).toBeGreaterThan(rate);
    expect(trimmed.length).toBeLessThan(1.7 * rate);
    expect(trimSilence(new Float32Array(rate), rate).length).toBe(0);
  });
  it('drops Whisper phantom phrases', () => {
    expect(isHallucination("Sous-titres réalisés par la communauté d'Amara.org")).toBe(true);
    expect(isHallucination('...')).toBe(true);
    expect(isHallucination('Deux croissants')).toBe(false);
  });
});
