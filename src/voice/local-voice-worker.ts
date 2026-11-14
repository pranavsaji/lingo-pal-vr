/// <reference lib="webworker" />
/**
 * On-device French voice, in a Web Worker so model inference never blocks
 * the XR frame loop:
 *  - speech-to-text: Whisper base (onnx-community/whisper-base, int8: ~74 MB once);
 *  - text-to-speech: MMS-TTS French (Xenova/mms-tts-fra, fp32: 114 MB once).
 * Runs on the CPU (WASM). WebGPU is avoided on purpose: on a headset the GPU
 * is busy rendering both eyes, and a big inference burst would drop frames.
 * Models download once from the Hugging Face CDN and stay in the browser cache.
 */

import { env, pipeline } from '@huggingface/transformers';
import type { VoiceRequest, VoiceResponse, VoiceTask } from './local-voice-protocol.js';

env.allowLocalModels = false;

type AsrFn = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
type TtsFn = (text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>;

const post = (msg: VoiceResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

const loading: Record<string, { loaded: number; total: number }> = {};
function progressFor(task: VoiceTask) {
  return (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    loading[`${task}:${p.file}`] = { loaded: p.loaded ?? 0, total: p.total };
    let loaded = 0;
    let total = 0;
    for (const [k, v] of Object.entries(loading)) {
      if (!k.startsWith(`${task}:`)) continue;
      loaded += v.loaded;
      total += v.total;
    }
    post({ kind: 'progress', task, pct: total ? Math.round((loaded / total) * 100) : 0 });
  };
}

let asr: Promise<AsrFn> | null = null;
let tts: Promise<TtsFn> | null = null;
let sttModel = 'onnx-community/whisper-base';
// fp32 measured ~3x faster than int8 for this model under WASM, and clearer.
let ttsDtype: 'q8' | 'fp32' | 'fp16' = 'fp32';

function loadAsr(): Promise<AsrFn> {
  asr ??= (pipeline('automatic-speech-recognition', sttModel, {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: progressFor('stt'),
  }) as unknown as Promise<AsrFn>).then((fn) => {
    post({ kind: 'ready', task: 'stt' });
    return fn;
  });
  asr.catch(() => (asr = null)); // allow a retry after a network failure
  return asr;
}

function loadTts(): Promise<TtsFn> {
  tts ??= (pipeline('text-to-speech', 'Xenova/mms-tts-fra', {
    device: 'wasm',
    dtype: ttsDtype,
    progress_callback: progressFor('tts'),
  }) as unknown as Promise<TtsFn>).then((fn) => {
    post({ kind: 'ready', task: 'tts' });
    return fn;
  });
  tts.catch(() => (tts = null));
  return tts;
}

// Speech-to-text jumps the queue: the learner is waiting for it.
const queue: Extract<VoiceRequest, { id: number }>[] = [];
let busy = false;

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const i = queue.findIndex((r) => r.kind === 'stt');
    const req = queue.splice(i >= 0 ? i : 0, 1)[0];
    try {
      await run(req);
    } catch (err) {
      post({ kind: 'error', id: req.id, message: String(err).slice(0, 200) });
    }
  }
  busy = false;
}

async function run(req: Extract<VoiceRequest, { id: number }>): Promise<void> {
  switch (req.kind) {
    case 'stt': {
      const fn = await loadAsr();
      // Short cafe phrases: cap the output and block loops ("de plus de plus de plus..."),
      // which Whisper falls into on noisy or unclear audio.
      const out = await fn(req.audio, { language: req.lang === 'en' ? 'english' : 'french', task: 'transcribe', max_new_tokens: 64, no_repeat_ngram_size: 4 });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      post({ kind: 'stt', id: req.id, text: text.trim() });
      return;
    }
    case 'tts': {
      const fn = await loadTts();
      const out = await fn(req.text);
      post({ kind: 'tts', id: req.id, audio: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
      return;
    }
  }
}

self.onmessage = (e: MessageEvent<VoiceRequest>) => {
  const req = e.data;
  // Downloads run alongside inference; only inference is serialized.
  if (req.kind === 'config') {
    if (!asr) sttModel = req.sttModel;
    if (!tts && req.ttsDtype) ttsDtype = req.ttsDtype;
  } else if (req.kind === 'preload') {
    void (req.task === 'stt' ? loadAsr() : loadTts()).catch(() => post({ kind: 'failed', task: req.task }));
  } else {
    queue.push(req);
    void pump();
  }
};
