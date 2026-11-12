/**
 * Madame Lune's French voice, with two engines:
 *  1. The browser's speech synthesis, when it has a French voice (desktop
 *     Chrome, Edge, Safari).
 *  2. An on-device French voice model (see voice/local-voice.ts) when it has
 *     none, which is the usual case in Quest Browser. Audio plays through a
 *     3D panner at Madame Lune, chunk by chunk, so speech starts quickly.
 * Emits speaking start/end for her lip sync (estimated timing when an engine
 * gives no events, so her mouth still moves). Subtitles are always on, so a
 * silent device still works.
 * URL overrides for testing: ?tts=local or ?tts=browser.
 */

import { audioHub, ensureAudioContext } from './audio/audio-hub.js';
import { Emitter } from './game-state.js';
import { store } from './state/store.js';
import { localVoice } from './voice/local-voice.js';
import { ttsChunks } from './voice/voice-text.js';

let frenchVoice: SpeechSynthesisVoice | null = null;

/** true while Madame Lune's line is being spoken. */
export const luneSpeaking = new Emitter<boolean>();

const hasBrowserTts = typeof window !== 'undefined' && 'speechSynthesis' in window;
const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tts') : null;
/** Which engine speaks: decided once the browser has listed its voices. */
let engine: 'browser' | 'local' = forced === 'local' ? 'local' : 'browser';

function pickVoice(): void {
  if (!hasBrowserTts) return;
  const voices = window.speechSynthesis.getVoices();
  // Prefer a female French voice for Madame Lune.
  frenchVoice =
    voices.find((v) => v.lang === 'fr-FR' && /amelie|audrey|marie|julie|google fran|denise|celine|female/i.test(v.name)) ??
    voices.find((v) => v.lang === 'fr-FR') ??
    voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('fr')) ??
    null;
}

function chooseEngine(): void {
  pickVoice();
  if (forced === 'browser' || forced === 'local') return;
  engine = !frenchVoice && localVoice.supported ? 'local' : 'browser';
  if (engine === 'local') localVoice.preload('tts');
}

if (typeof window !== 'undefined') {
  if (hasBrowserTts) {
    pickVoice();
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      pickVoice();
      if (frenchVoice && forced !== 'local') engine = 'browser';
    });
  }
  // Voices load asynchronously; decide after they have had time to appear.
  setTimeout(chooseEngine, 2500);
  if (forced === 'local') localVoice.preload('tts');
}

/** The engine in use, for the settings panel and diagnostics. */
export function speechEngine(): 'browser' | 'local' {
  return engine;
}

let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

function endLune(): void {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = null;
  luneSpeaking.emit(false);
}

// ---- on-device voice -------------------------------------------------------

type Clip = { audio: Float32Array; rate: number } | null;
const clipCache = new Map<string, Promise<Clip>>();
let speakToken = 0;
let current: AudioBufferSourceNode | null = null;

function synth(chunk: string): Promise<Clip> {
  let p = clipCache.get(chunk);
  if (!p) {
    p = localVoice.synthesize(chunk).catch(() => null);
    clipCache.set(chunk, p);
    if (clipCache.size > 80) clipCache.delete(clipCache.keys().next().value!);
    void p.then((c) => {
      if (!c) clipCache.delete(chunk); // do not cache failures
    });
  }
  return p;
}

function stopLocal(): void {
  speakToken++;
  try {
    current?.stop();
  } catch {
    // already stopped
  }
  current = null;
}

function playClip(ctx: AudioContext, clip: NonNullable<Clip>, rate: number, pauseMs: number): Promise<void> {
  return new Promise((resolve) => {
    const buf = ctx.createBuffer(1, clip.audio.length, clip.rate);
    buf.copyToChannel(clip.audio as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(audioHub.voice ?? ctx.destination);
    const ms = (buf.duration / rate) * 1000 + pauseMs;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // Wait the pause after the chunk ends; the timer also covers a suspended context.
    src.onended = () => setTimeout(finish, pauseMs);
    setTimeout(finish, ms + 400);
    current = src;
    src.start();
  });
}

async function speakLocal(text: string, slow: boolean, who: 'lune' | 'other'): Promise<boolean> {
  stopLocal();
  const token = speakToken;
  const chunks = ttsChunks(text);
  if (!chunks.length) return true;
  const clips = chunks.map((c) => synth(c.text)); // the worker renders ahead while earlier chunks play
  const ctx = ensureAudioContext();
  let spoke = false;
  for (let i = 0; i < chunks.length; i++) {
    const clip = await clips[i];
    if (token !== speakToken) return true; // a newer line interrupted this one
    if (!clip || !ctx) continue;
    if (!spoke && who === 'lune') luneSpeaking.emit(true);
    spoke = true;
    await playClip(ctx, clip, slow ? 0.86 : 1, chunks[i].pauseMs);
  }
  if (token === speakToken && who === 'lune' && spoke) endLune();
  return spoke;
}

// ---- public ----------------------------------------------------------------

/**
 * @param rate speech rate; defaults to the learner's "slow speech" setting.
 * @param who 'lune' animates Madame Lune's mouth.
 */
export function speakFrench(text: string, rate?: number, who: 'lune' | 'other' = 'other'): void {
  const r = rate ?? (store.profile.settings.slowSpeech ? 0.7 : 0.9);
  if (engine === 'local' && !localVoice.failed.tts) {
    if (hasBrowserTts) window.speechSynthesis.cancel();
    if (!localVoice.ready.tts) {
      // Voice still downloading (first visit only): subtitles + lip movement, no late audio.
      localVoice.preload('tts');
      stopLocal();
      speakBrowser(text, r, who, false);
      return;
    }
    void speakLocal(text, r < 0.8, who).then((spoke) => {
      // Model unavailable (offline, out of memory): fall back to the browser voice.
      if (!spoke && localVoice.failed.tts) speakBrowser(text, r, who);
    });
    return;
  }
  stopLocal();
  speakBrowser(text, r, who);
}

function speakBrowser(text: string, r: number, who: 'lune' | 'other', audible = true): void {
  const estimateMs = Math.min(9000, 400 + (text.length * 65) / r);
  if (who === 'lune') {
    luneSpeaking.emit(true);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(endLune, estimateMs);
  }
  if (!hasBrowserTts || !audible) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = r;
    u.pitch = who === 'lune' ? 1.1 : 1;
    if (frenchVoice) u.voice = frenchVoice;
    if (who === 'lune') {
      u.onend = endLune;
      u.onerror = endLune;
    }
    window.speechSynthesis.speak(u);
  } catch {
    // Speech is an enhancement; the panel still shows the text (subtitles always on).
  }
}
