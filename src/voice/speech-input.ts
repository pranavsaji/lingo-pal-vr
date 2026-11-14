/**
 * Push-to-talk French speech recognition with three engines:
 *  1. Server STT (/api/stt): MediaRecorder audio -> provider (OpenAI or Deepgram),
 *     when the deployment has a provider key.
 *  2. Browser Web Speech API (desktop Chrome/Edge).
 *  3. On-device Whisper in a worker (voice/local-voice.ts): no key, works in
 *     Quest Browser, which has no speech recognition of its own.
 * If none exists, `available` is false and the UI hides the mic.
 * URL override for testing: ?stt=local.
 */

import { localVoice } from './local-voice.js';
import { isHallucination, trimSilence } from './voice-text.js';

type Recognizer = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};

const MAX_RECORD_MS = 7000;

export type Engine = 'server' | 'browser' | 'local' | 'none';

/** Recognition language: French for the shopkeepers, English for Pal (whitelisted; anything else is French). */
export type SttLang = 'fr' | 'en';
export function sttLang(lang: unknown): SttLang {
  return lang === 'en' ? 'en' : 'fr';
}
/** Browser recognizer locale for a recognition language. */
export const BROWSER_LOCALE: Record<SttLang, string> = { fr: 'fr-FR', en: 'en-US' };
/** Server route for a recognition language (French keeps the plain route). */
export function sttUrl(lang: SttLang): string {
  return lang === 'en' ? './api/stt?lang=en' : './api/stt';
}

export class SpeechInput {
  engine: Engine = 'none';
  listening = false;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private recognizer: Recognizer | null = null;
  private browserText = '';
  private autoStop: ReturnType<typeof setTimeout> | null = null;
  private resolveStop: ((text: string) => void) | null = null;
  /** The language of the current (or last) recording. */
  lang: SttLang = 'fr';
  /** Called when recording stops on its own (time limit). */
  onAutoStop: (() => void) | null = null;

  /** Probe the server route once; fall back to the browser engine. */
  async detect(): Promise<Engine> {
    const canRecord = typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
    const forceLocal = new URLSearchParams(location.search).get('stt') === 'local';
    if (!forceLocal) {
      try {
        const res = await fetch('./api/stt', { method: 'GET' });
        const info = res.ok ? ((await res.json()) as { provider?: string | null }) : null;
        if (info?.provider && canRecord) {
          this.engine = 'server';
          return this.engine;
        }
      } catch {
        // no route
      }
      const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      // Quest Browser exposes the constructor but has no recognition service behind it.
      const headset = /OculusBrowser|Quest|Pacific/i.test(navigator.userAgent);
      if (Ctor && !headset) {
        this.engine = 'browser';
        return this.engine;
      }
    }
    this.engine = canRecord && localVoice.supported ? 'local' : 'none';
    return this.engine;
  }

  get available(): boolean {
    return this.engine !== 'none';
  }

  async start(lang: SttLang = 'fr'): Promise<boolean> {
    if (this.listening || this.engine === 'none') return false;
    this.listening = true;
    this.lang = sttLang(lang);
    try {
      if (this.engine === 'server' || this.engine === 'local') await this.startRecorder();
      else this.startBrowser();
    } catch {
      this.listening = false;
      return false;
    }
    this.autoStop = setTimeout(() => this.onAutoStop?.(), MAX_RECORD_MS);
    return true;
  }

  /** Stop listening; resolves with the transcript ('' when nothing was heard). */
  stop(): Promise<string> {
    if (this.autoStop) clearTimeout(this.autoStop);
    if (!this.listening) return Promise.resolve('');
    this.listening = false;
    return new Promise((resolve) => {
      this.resolveStop = resolve;
      if (this.engine !== 'browser' && this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
      else if (this.recognizer) this.recognizer.stop();
      else resolve('');
    });
  }

  private async startRecorder(): Promise<void> {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => void this.upload();
    this.recorder.start();
  }

  private async upload(): Promise<void> {
    const done = this.resolveStop;
    this.resolveStop = null;
    const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || 'audio/webm' });
    if (blob.size < 2000) {
      done?.(''); // too short to contain speech
      return;
    }
    if (this.engine === 'local') {
      done?.(await this.transcribeLocal(blob).catch(() => ''));
      return;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(sttUrl(this.lang), { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: ctrl.signal });
      clearTimeout(t);
      const data = (await res.json()) as { text?: string };
      done?.(res.ok && typeof data.text === 'string' ? data.text.trim() : '');
    } catch {
      done?.('');
    }
  }

  /** Decode to 16 kHz mono, cut silence, run Whisper on the device. */
  private async transcribeLocal(blob: Blob): Promise<string> {
    const data = await blob.arrayBuffer();
    // decodeAudioData resamples to the context's rate, which is what Whisper expects.
    const decoded = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(data);
    const speech = trimSilence(decoded.getChannelData(0), 16000);
    if (speech.length < 16000 * 0.3) return '';
    const text = await localVoice.transcribe(speech, this.lang);
    return isHallucination(text) ? '' : text.trim();
  }

  private startBrowser(): void {
    const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
    const r = new Ctor();
    r.lang = BROWSER_LOCALE[this.lang];
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    this.browserText = '';
    r.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0]?.transcript ?? '');
      this.browserText = parts.join(' ').trim();
    };
    r.onerror = () => undefined;
    r.onend = () => {
      const done = this.resolveStop;
      this.resolveStop = null;
      this.recognizer = null;
      if (done) done(this.browserText);
      else if (this.listening) {
        // Engine ended by itself (silence): report as an auto stop.
        this.onAutoStop?.();
      }
    };
    this.recognizer = r;
    r.start();
  }
}
