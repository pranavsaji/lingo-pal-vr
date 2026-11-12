/**
 * Pure helpers for the on-device voice (no DOM, unit-tested):
 *  - ttsChunks: prepare Madame Lune's line for the French voice model, which
 *    only knows lowercase letters, accents, apostrophes and hyphens;
 *  - trimSilence / hasSpeech: cut silence before speech-to-text (faster, and
 *    Whisper invents text when fed silence);
 *  - isHallucination: drop Whisper's well-known phantom phrases.
 */

import { spellOutNumbers } from '../agent/menu.js';

/** Characters the French voice model (MMS-TTS fra) can pronounce. */
const TTS_ALLOWED = /[^ '\-a-zàâçèéêëîïôùûüœ]/g;

export interface TtsChunk {
  text: string;
  /** Silence after this chunk: longer at the end of a sentence. */
  pauseMs: number;
}

/** Split a line into short spoken chunks at punctuation (each gets a natural pause). */
export function ttsChunks(text: string): TtsChunk[] {
  const prepared = spellOutNumbers(text)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/æ/g, 'ae')
    .replace(/w/g, 'v') // no "w" in the model's alphabet; French "w" is mostly a "v" sound
    .replace(/ÿ/g, 'y');
  const out: TtsChunk[] = [];
  for (const m of prepared.matchAll(/([^.!?…;:,\n()«»"]+)([.!?…;:,\n()«»"]*)/g)) {
    const chunk = m[1].replace(TTS_ALLOWED, ' ').replace(/\s+/g, ' ').trim();
    if (!/[a-zàâçèéêëîïôùûüœ]/.test(chunk)) continue;
    out.push({ text: chunk, pauseMs: /[.!?…\n]/.test(m[2]) ? 260 : m[2] ? 120 : 0 });
  }
  return out;
}

const WINDOW = 320; // 20 ms at 16 kHz

function windowRms(samples: Float32Array, start: number): number {
  let sum = 0;
  const end = Math.min(samples.length, start + WINDOW);
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/** Loudness threshold for "someone is speaking" (after browser noise suppression). */
export const SPEECH_RMS = 0.012;

export function hasSpeech(samples: Float32Array): boolean {
  for (let s = 0; s < samples.length; s += WINDOW) if (windowRms(samples, s) >= SPEECH_RMS) return true;
  return false;
}

/**
 * Keep from 0.25 s before the first loud window to 0.35 s after the last one.
 * Returns an empty array when nothing is loud enough to be speech.
 */
export function trimSilence(samples: Float32Array, rate = 16000): Float32Array {
  let first = -1;
  let last = -1;
  for (let s = 0; s < samples.length; s += WINDOW) {
    if (windowRms(samples, s) >= SPEECH_RMS) {
      if (first < 0) first = s;
      last = s + WINDOW;
    }
  }
  if (first < 0) return new Float32Array(0);
  const from = Math.max(0, first - Math.round(0.25 * rate));
  const to = Math.min(samples.length, last + Math.round(0.35 * rate));
  return samples.slice(from, to);
}

/** Phrases Whisper produces from noise (learned from French subtitle data). */
const PHANTOMS = /amara|sous-?titr|abonnez|merci d'avoir regard|merci de votre attention|radio-canada|♪|\[musique\]|\(musique\)/i;

export function isHallucination(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || PHANTOMS.test(t) || /^[.…,!? ]+$/.test(t);
}
