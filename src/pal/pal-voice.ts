/**
 * Pal's English voice: the cloud voice (Inworld "Hazel" through /api/tts, speaker
 * 'pal') when the shop voices are on the cloud, else the browser's en-US speech
 * synthesis. Silent devices still get the subtitle (Pal's line is always shown).
 * `onEnd` fires when the line ends (estimated when an engine gives no event).
 */

import { ensureAudioContext } from '../audio/audio-hub.js';
import { registerPalStopper, setPalTalking, speechEngine, whenShopQuiet } from '../speech.js';

let token = 0;
let current: AudioBufferSourceNode | null = null;
let endTimer: ReturnType<typeof setTimeout> | null = null;
const cache = new Map<string, Promise<AudioBuffer | null>>();

function fetchPal(text: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  let p = cache.get(text);
  if (!p) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    p = fetch(`./api/tts?s=pal&t=${encodeURIComponent(text)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
    cache.set(text, p);
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
    void p.then((b) => {
      if (!b) cache.delete(text);
    });
  }
  return p;
}

/** Warm the cache for a line Pal will say soon (the introduction). */
export function prefetchPal(text: string): void {
  if (speechEngine() !== 'cloud' || text.length > 240) return;
  const ctx = ensureAudioContext();
  if (ctx) void fetchPal(text, ctx);
}

export function stopPal(): void {
  token++;
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
  try {
    current?.stop();
  } catch {
    // already stopped
  }
  current = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window && speaking) window.speechSynthesis.cancel();
  speaking = false;
  setPalTalking(false);
}
let interrupted: (() => void) | null = null;
/** PalSystem: Pal was cut off from outside (the learner spoke), so its talking state ends too. */
export function onPalInterrupted(fn: () => void): void {
  interrupted = fn;
}
registerPalStopper(() => {
  stopPal();
  interrupted?.();
});

let speaking = false;

function englishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'en-US' && /samantha|google us|aria|jenny|female/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    null
  );
}

function speakBrowser(text: string, mine: number, done: () => void): void {
  const onEnd = () => {
    setPalTalking(false);
    done();
  };
  setPalTalking(true);
  const estimate = Math.min(12000, 600 + text.length * 60);
  endTimer = setTimeout(() => mine === token && onEnd(), estimate);
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.02;
    u.pitch = 1.25; // a small bird
    const v = englishVoice();
    if (v) u.voice = v;
    u.onend = () => {
      if (mine !== token) return;
      if (endTimer) clearTimeout(endTimer);
      onEnd();
    };
    speaking = true;
    window.speechSynthesis.speak(u);
  } catch {
    // speech is an enhancement; the subtitle carries the line
  }
}

/** Say an English line in Pal's voice; onStart when audio begins, onEnd when it is over. */
export function speakEnglish(text: string, onStart: () => void, onEnd: () => void): void {
  stopPal();
  const mine = token;
  const line = text.replace(/[[\]]/g, '').slice(0, 240);
  if (!line.trim()) {
    onEnd();
    return;
  }
  const ctx = speechEngine() === 'cloud' ? ensureAudioContext() : null;
  // Pal never talks over the shopkeeper: the line starts once her French has ended.
  if (!ctx) {
    whenShopQuiet(() => {
      if (mine !== token) return;
      onStart();
      speakBrowser(line, mine, onEnd);
    });
    return;
  }
  void fetchPal(line, ctx).then((buf) =>
    whenShopQuiet(() => {
      if (mine !== token) return;
      onStart();
      if (!buf) {
        speakBrowser(line, mine, onEnd);
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      let ended = false;
      const finish = () => {
        if (ended || mine !== token) return;
        ended = true;
        if (endTimer) clearTimeout(endTimer);
        endTimer = null;
        current = null;
        setPalTalking(false);
        onEnd();
      };
      src.onended = finish;
      endTimer = setTimeout(finish, buf.duration * 1000 + 600); // suspended context
      current = src;
      setPalTalking(true);
      src.start();
    }),
  );
}
