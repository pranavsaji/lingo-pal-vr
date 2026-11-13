/**
 * How the learner wants to interact: hands (pinch), eyes (look for one second)
 * or voice (hands-free: Lune listens after she speaks). Chosen on first launch
 * by any of the three, changeable by voice ("mode yeux") or in Reglages.
 * No World, no DOM.
 */

import { events } from '../game-state.js';
import type { Settings } from '../state/profile.js';
import { store } from '../state/store.js';
import type { InputMode } from '../voice/voice-commands.js';

/** Whether the first-launch tutorial is running (read by voice commands: "passer", "aide"). */
export const tutorialState = { running: false };

/** Apply an input mode to the settings and announce it. */
export function applyInputMode(mode: InputMode): void {
  const s = settingsForMode(mode);
  store.setSetting('gazeDwell', s.gazeDwell);
  store.setSetting('voiceFirst', s.voiceFirst);
  events.inputMode.emit(mode);
}

/** Settings each mode turns on or off. Other settings (text size, contrast) are left alone. */
export function settingsForMode(mode: InputMode): Pick<Settings, 'gazeDwell' | 'voiceFirst'> {
  return { gazeDwell: mode === 'eyes', voiceFirst: mode === 'voice' };
}

export function modeOf(s: Settings): InputMode {
  if (s.voiceFirst) return 'voice';
  if (s.gazeDwell) return 'eyes';
  return 'hands';
}

export const TEXT_SIZES: Settings['textSize'][] = ['s', 'm', 'l'];

export function nextTextSize(size: Settings['textSize'], bigger: boolean, wrap = false): Settings['textSize'] {
  const i = TEXT_SIZES.indexOf(size);
  const j = bigger ? i + 1 : i - 1;
  if (wrap) return TEXT_SIZES[(j + TEXT_SIZES.length) % TEXT_SIZES.length];
  return TEXT_SIZES[Math.max(0, Math.min(TEXT_SIZES.length - 1, j))];
}

/** One short line for Reglages: "Accessibilité : voix · sous-titres · texte L · contraste". */
export function a11ySummary(s: Settings): string {
  const parts: string[] = [{ hands: 'mains', eyes: 'regard', voice: 'voix' }[modeOf(s)]];
  if (s.subtitles) parts.push('sous-titres');
  parts.push(`texte ${s.textSize.toUpperCase()}`);
  if (s.highContrast) parts.push('contraste');
  if (s.slowSpeech) parts.push('lent');
  if (s.reduceMotion) parts.push('calme');
  if (s.leftHanded) parts.push('gaucher');
  return `Accessibilité : ${parts.join(' · ')}`;
}
