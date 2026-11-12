/** Messages between the app and the on-device voice worker. */

export type VoiceTask = 'stt' | 'tts';

export type VoiceRequest =
  | { kind: 'config'; sttModel: string; ttsDtype?: 'q8' | 'fp32' | 'fp16' }
  | { kind: 'preload'; task: VoiceTask }
  | { kind: 'stt'; id: number; audio: Float32Array }
  | { kind: 'tts'; id: number; text: string };

export type VoiceResponse =
  | { kind: 'progress'; task: VoiceTask; pct: number }
  | { kind: 'ready'; task: VoiceTask }
  | { kind: 'failed'; task: VoiceTask }
  | { kind: 'stt'; id: number; text: string }
  | { kind: 'tts'; id: number; audio: Float32Array; rate: number }
  | { kind: 'error'; id: number; message: string };
