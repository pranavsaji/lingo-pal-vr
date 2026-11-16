/**
 * The shopkeepers' French voices, with three engines, best first:
 *  1. Cloud voices (Inworld TTS-2 through /api/tts): a natural voice per
 *     character (Madame Lune, Monsieur Paul, Madame Rose) and one for the
 *     learner's own phrases. Played through a 3D panner at the shopkeeper.
 *  2. The browser's speech synthesis, when it has a French voice.
 *  3. An on-device French voice model (see voice/local-voice.ts), the usual
 *     case in Quest Browser when the cloud route is unavailable.
 * Emits speaking start/end for her lip sync (estimated timing when an engine
 * gives no events, so her mouth still moves). Subtitles are always on, so a
 * silent device still works.
 * URL overrides for testing: ?tts=cloud, ?tts=local or ?tts=browser.
 */

import { audioHub, ensureAudioContext } from './audio/audio-hub.js';
import { fontsReady } from './fonts.js';
import { appState, Emitter, type PlaceId } from './game-state.js';
import { store } from './state/store.js';
import { localVoice } from './voice/local-voice.js';
import { ttsChunks } from './voice/voice-text.js';

let frenchVoice: SpeechSynthesisVoice | null = null;

/** true while Madame Lune's line is being spoken. */
export const luneSpeaking = new Emitter<boolean>();

// ---- one voice at a time -----------------------------------------------------
// Pal speaks English (pal/pal-voice.ts), the shop speaks French: they never talk over
// each other. A French line waits for Pal to finish; Pal waits for the shopkeeper; the
// learner's own line cuts Pal short (they have moved on). Each wait gives up after
// FLOOR_WAIT_MS so a lost "ended" event can never silence the game.

const FLOOR_WAIT_MS = 12000;
let shopTalking = false;
luneSpeaking.on((on) => (shopTalking = on));
let palTalking = false;
let palStopper: (() => void) | null = null;
let afterPal: (() => void)[] = [];

/** pal-voice.ts: Pal's audio started (true) or ended / was stopped (false). */
export function setPalTalking(on: boolean): void {
  palTalking = on;
  if (on) return;
  const waiting = afterPal;
  afterPal = [];
  for (const f of waiting) f();
}

/** pal-voice.ts: how to cut Pal short when the learner speaks. */
export function registerPalStopper(stop: () => void): void {
  palStopper = stop;
}

/** Run `f` once Pal is quiet (now if Pal is not talking). */
function whenPalQuiet(f: () => void): void {
  if (!palTalking) return f();
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    f();
  };
  afterPal.push(once);
  setTimeout(once, FLOOR_WAIT_MS);
}

/** Run `f` once the shopkeeper has finished her line (now if she is quiet). */
export function whenShopQuiet(f: () => void): void {
  if (!shopTalking) return f();
  let done = false;
  let off: (() => void) | null = null;
  const once = () => {
    if (done) return;
    done = true;
    off?.();
    f();
  };
  off = luneSpeaking.on((on) => {
    if (!on) once();
  });
  setTimeout(once, FLOOR_WAIT_MS);
}

const hasBrowserTts = typeof window !== 'undefined' && 'speechSynthesis' in window;
const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tts') : null;
/** Which engine speaks: decided once the browser has listed its voices. */
let engine: 'cloud' | 'browser' | 'local' = forced === 'local' ? 'local' : 'browser';
/** The cloud route answered its probe (null = not known yet). */
let cloudOk: boolean | null = null;

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
  if (cloudOk) {
    engine = 'cloud'; // natural voices; the 114 MB on-device model is never downloaded
    return;
  }
  engine = !frenchVoice && localVoice.supported ? 'local' : 'browser';
  if (engine === 'local') localVoice.preload('tts');
}

if (typeof fetch !== 'undefined' && typeof window !== 'undefined' && forced !== 'local' && forced !== 'browser') {
  fetch('./api/tts?probe=1')
    .then((r) => (cloudOk = r.ok))
    .catch(() => (cloudOk = false))
    .finally(() => {
      if (cloudOk) engine = 'cloud';
    });
}

if (typeof window !== 'undefined') {
  if (hasBrowserTts) {
    pickVoice();
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      pickVoice();
      if (frenchVoice && forced !== 'local' && engine !== 'cloud') engine = 'browser';
    });
  }
  // Voices load asynchronously; decide after they have had time to appear, and after the
  // panel fonts are built (the voice model is CPU-heavy and would delay readable text).
  void fontsReady().then(() => setTimeout(chooseEngine, 1500));
  if (forced === 'local') void fontsReady().then(() => localVoice.preload('tts'));
}

/** The engine in use, for the settings panel and diagnostics. */
export function speechEngine(): 'cloud' | 'browser' | 'local' {
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

// ---- cloud voices ----------------------------------------------------------

/** Each shop's shopkeeper voice (server/tts-handler.mjs SPEAKERS). */
const KEEPER: Record<PlaceId, string> = { cafe: 'lune', boulangerie: 'paul', marche: 'rose', bistrot: 'marcel', metro: 'karim', pharmacie: 'ines', hotel: 'claire' };
const cloudCache = new Map<string, Promise<AudioBuffer | null>>();

function fetchCloud(speaker: string, text: string, slow: boolean, ctx: AudioContext): Promise<AudioBuffer | null> {
  const key = `${speaker}|${slow ? 1 : 0}|${text}`;
  let p = cloudCache.get(key);
  if (!p) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    p = fetch(`./api/tts?s=${speaker}&t=${encodeURIComponent(text)}${slow ? '&slow=1' : ''}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    cloudCache.set(key, p);
    if (cloudCache.size > 60) cloudCache.delete(cloudCache.keys().next().value!);
    void p.then((b) => {
      if (!b) cloudCache.delete(key);
    });
  }
  return p;
}

/** Resolves true if the line was spoken with a cloud voice. */
async function speakCloud(text: string, slow: boolean, who: Who): Promise<boolean> {
  const ctx = ensureAudioContext();
  if (!ctx || text.length > 240) return false;
  stopLocal();
  const token = speakToken;
  const speaker = who === 'learner' ? 'learner' : KEEPER[appState.place];
  const buf = await fetchCloud(speaker, text, slow, ctx);
  if (!buf) return false;
  if (token !== speakToken) return true; // a newer line took over
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // The shopkeeper's voice comes from where they stand; the learner's own phrases are not positioned.
  src.connect(who === 'lune' ? (audioHub.voice ?? ctx.destination) : ctx.destination);
  current = src;
  if (who === 'lune') {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    luneSpeaking.emit(true);
    src.onended = () => {
      if (token === speakToken) endLune();
    };
    // Covers a suspended audio context (no ended event).
    fallbackTimer = setTimeout(endLune, buf.duration * 1000 + 600);
  }
  src.start();
  return true;
}

/** Warm the cache for a line that may be spoken soon (e.g. the suggested replies). */
export function prefetchFrench(text: string, who: Who = 'learner'): void {
  if (engine !== 'cloud' || text.length > 240) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const speaker = who === 'learner' ? 'learner' : KEEPER[appState.place];
  void fetchCloud(speaker, text, store.profile.settings.slowSpeech, ctx);
}

// ---- public ----------------------------------------------------------------

/** 'lune' is the current shop's shopkeeper (animates their mouth); 'learner' is the learner's own phrase. */
export type Who = 'lune' | 'learner' | 'other';

/**
 * @param rate speech rate; defaults to the learner's "slow speech" setting.
 * @param who 'lune' = the shopkeeper (animates their mouth), 'learner' = the learner's
 * own phrase, 'other' = a word or prompt (said in the shopkeeper's voice).
 */
export function speakFrench(text: string, rate?: number, who: Who = 'other'): void {
  if (who === 'learner') palStopper?.();
  else if (palTalking) {
    whenPalQuiet(() => speakFrench(text, rate, who));
    return;
  }
  const r = rate ?? (store.profile.settings.slowSpeech ? 0.7 : 0.9);
  if (engine === 'cloud' || (forced === 'cloud' && cloudOk)) {
    if (hasBrowserTts) window.speechSynthesis.cancel();
    void speakCloud(text, r < 0.8, who).then((spoke) => {
      if (!spoke) speakFallback(text, r, who); // offline or route failure: keep talking
    });
    return;
  }
  speakFallback(text, r, who);
}

function speakFallback(text: string, r: number, who: Who): void {
  const w = who === 'lune' ? 'lune' : 'other';
  if (engine === 'local' && !localVoice.failed.tts) {
    if (hasBrowserTts) window.speechSynthesis.cancel();
    if (!localVoice.ready.tts) {
      // Voice still downloading (first visit only): subtitles + lip movement, no late audio.
      localVoice.preload('tts');
      stopLocal();
      speakBrowser(text, r, w, false);
      return;
    }
    void speakLocal(text, r < 0.8, w).then((spoke) => {
      // Model unavailable (offline, out of memory): fall back to the browser voice.
      if (!spoke && localVoice.failed.tts) speakBrowser(text, r, w);
    });
    return;
  }
  stopLocal();
  speakBrowser(text, r, w);
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
