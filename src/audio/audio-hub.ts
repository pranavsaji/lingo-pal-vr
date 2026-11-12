/**
 * One shared AudioContext for sound effects and Madame Lune's on-device voice.
 * AudioSystem fills `voice` with a 3D panner at her position, so her speech
 * comes from where she stands.
 */

export const audioHub: { ctx: AudioContext | null; voice: AudioNode | null } = { ctx: null, voice: null };

export function ensureAudioContext(): AudioContext | null {
  if (audioHub.ctx) {
    if (audioHub.ctx.state === 'suspended') void audioHub.ctx.resume().catch(() => undefined);
    return audioHub.ctx;
  }
  if (typeof AudioContext === 'undefined') return null;
  try {
    audioHub.ctx = new AudioContext();
  } catch {
    return null;
  }
  return audioHub.ctx;
}
