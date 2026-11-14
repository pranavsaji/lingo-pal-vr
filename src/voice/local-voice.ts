/**
 * App-side client for the on-device voice worker (see local-voice-worker.ts).
 * Gives French speech-to-text and text-to-speech with no extra API key, so
 * voice works in Quest Browser, which has no built-in speech recognition.
 * The worker starts lazily: nothing downloads until voice is needed.
 */

import { Emitter } from '../game-state.js';
import type { VoiceRequest, VoiceResponse, VoiceTask } from './local-voice-protocol.js';

type Pending = { resolve: (v: VoiceResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class LocalVoice {
  /** Model download progress, 0 to 100. */
  readonly progress = new Emitter<{ task: VoiceTask; pct: number }>();
  readonly ready: Record<VoiceTask, boolean> = { stt: false, tts: false };
  readonly failed: Record<VoiceTask, boolean> = { stt: false, tts: false };
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private preloaded = new Set<VoiceTask>();

  get supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
  }

  private ensure(): Worker | null {
    if (this.worker || !this.supported) return this.worker;
    try {
      this.worker = new Worker(new URL('./local-voice-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return null;
    }
    // whisper-base: heard "deux croissants" correctly where -tiny wrote "2-300" (tested with
    // a French voice); ~1.5 s per phrase in desktop WASM. ?stt=tiny trades accuracy for speed.
    const tiny = new URLSearchParams(location.search).get('stt') === 'tiny';
    this.send({ kind: 'config', sttModel: tiny ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-base' });
    this.worker.onmessage = (e: MessageEvent<VoiceResponse>) => this.receive(e.data);
    this.worker.onerror = () => {
      for (const p of this.pending.values()) p.reject(new Error('voice worker crashed'));
      this.pending.clear();
    };
    return this.worker;
  }

  private send(msg: VoiceRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private receive(msg: VoiceResponse): void {
    if (msg.kind === 'progress') {
      this.progress.emit({ task: msg.task, pct: msg.pct });
      return;
    }
    if (msg.kind === 'ready' || msg.kind === 'failed') {
      this.ready[msg.task] = msg.kind === 'ready';
      this.failed[msg.task] = msg.kind === 'failed';
      if (msg.kind === 'ready') this.progress.emit({ task: msg.task, pct: 100 });
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.kind === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  private request(msg: Extract<VoiceRequest, { id: number }>, timeoutMs: number, transfer: Transferable[] = []): Promise<VoiceResponse> {
    if (!this.ensure()) return Promise.reject(new Error('no worker'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.id);
        reject(new Error('voice timeout'));
      }, timeoutMs);
      this.pending.set(msg.id, { resolve, reject, timer });
      this.send(msg, transfer);
    });
  }

  /** Start downloading a model in the background (once). */
  preload(task: VoiceTask): void {
    if (this.preloaded.has(task) || !this.ensure()) return;
    this.preloaded.add(task);
    this.send({ kind: 'preload', task });
  }

  /** 16 kHz mono samples -> transcript (French; English for Pal: Whisper base is multilingual). The first call may wait for the download. */
  async transcribe(samples: Float32Array, lang: 'fr' | 'en' = 'fr'): Promise<string> {
    const audio = samples.slice(); // own buffer, transferred to the worker
    const res = await this.request({ kind: 'stt', id: ++this.seq, audio, ...(lang === 'en' ? { lang } : {}) }, this.ready.stt ? 20000 : 90000, [audio.buffer]);
    return res.kind === 'stt' ? res.text : '';
  }

  async synthesize(text: string): Promise<{ audio: Float32Array; rate: number } | null> {
    const res = await this.request({ kind: 'tts', id: ++this.seq, text }, this.ready.tts ? 20000 : 90000);
    return res.kind === 'tts' ? { audio: res.audio, rate: res.rate } : null;
  }
}

export const localVoice = new LocalVoice();
