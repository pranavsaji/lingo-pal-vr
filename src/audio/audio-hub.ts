/**
 * One shared AudioContext for sound effects and Madame Lune's on-device voice.
 * AudioSystem fills `voice` with a 3D panner at her position, so her speech
 * comes from where she stands.
 */

export const audioHub: { ctx: AudioContext | null; voice: AudioNode | null; tap: MediaStreamAudioDestinationNode | null } = {
  ctx: null,
  voice: null,
  tap: null,
};

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
  if (recording()) installTap(audioHub.ctx);
  return audioHub.ctx;
}

/** `?record` (demo-video capture only): mirror everything the app plays into a recordable stream. */
function recording(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('record');
  } catch {
    return false;
  }
}

function installTap(ctx: AudioContext): void {
  const tap = ctx.createMediaStreamDestination();
  audioHub.tap = tap;
  const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const out = connect.apply(this, args);
    if (args[0] === ctx.destination) connect.call(this, tap);
    return out;
  } as typeof AudioNode.prototype.connect;
  (window as unknown as Record<string, unknown>).__lingoTap = tap;
}
