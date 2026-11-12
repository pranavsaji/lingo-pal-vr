/**
 * Sound design, synthesized with WebAudio (no downloaded assets, nothing to
 * license): coin clinks counted out one by one, register ding, pops when food
 * lands, chimes for unlocks, a level-up fanfare, mic blips, plus a soft cafe
 * ambience (filtered room murmur + a slow music-box motif).
 * Sounds are positioned in 3D (PannerNode) and the listener follows the head.
 */

import { createSystem, VisibilityState, Vector3 } from '@iwsdk/core';
import { events } from '../game-state.js';
import { store } from '../state/store.js';
import { audioHub, ensureAudioContext } from './audio-hub.js';

type V3 = [number, number, number];
const LUNE: V3 = [0.15, 1.4, -1.65];
const COUNTER: V3 = [0, 1.05, -0.75];
const TRAY: V3 = [0.05, 1.02, -0.92];

export class AudioSystem extends createSystem({}) {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambience: GainNode | null = null;
  private headPos!: Vector3;
  private fwd!: Vector3;
  private up!: Vector3;
  private musicTimer: ReturnType<typeof setInterval> | null = null;

  init(): void {
    this.headPos = new Vector3();
    this.fwd = new Vector3();
    this.up = new Vector3();
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;

    // Browsers only allow audio after a user gesture: start on first input or XR entry.
    const unlock = () => this.start();
    window.addEventListener('pointerdown', unlock, { once: true });
    this.cleanupFuncs.push(
      () => window.removeEventListener('pointerdown', unlock),
      this.world.visibilityState.subscribe((s) => {
        if (s !== VisibilityState.NonImmersive) this.start();
      }),
      events.effects.on((fx) => {
        let spawned = 0;
        for (const e of fx) {
          if (e.kind === 'spawn') for (let i = 0; i < e.quantity; i++) this.pop(COUNTER, 0.12 * spawned++);
          if (e.kind === 'return_change') e.coins.forEach((_, i) => this.coin(TRAY, 0.35 + i * 0.32));
          if (e.kind === 'show_total') this.ding(TRAY);
          if (e.kind === 'emote' && e.emote === 'clap') this.ding(LUNE, 0, 1.5);
        }
      }),
      events.order.on((o) => {
        if (o.phase === 'paid') this.ding(TRAY, 0.1);
      }),
      events.xp.on(({ levelUp }) => {
        if (levelUp) this.fanfare();
      }),
      events.unlocked.on(() => this.chime(0.4)),
      events.celebrate.on(() => this.fanfare()),
      events.listening.on((on) => this.blip(on)),
      events.heard.on(({ score }) => {
        if (score !== null && score >= 85) this.chime(0);
      }),
      events.itemPicked.on(() => this.tick()),
      events.coinDropped.on((cents) => this.coin(TRAY, 0, cents >= 500)),
    );
  }

  private start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = ensureAudioContext(); // shared with Madame Lune's on-device voice
    if (!ctx) return;
    this.ctx = ctx;
    void ctx.resume().catch(() => undefined);
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    // Her voice: positioned at her mouth, no distance fade at counter range.
    const voice = this.at([LUNE[0], LUNE[1] + 0.15, LUNE[2]]) as PannerNode;
    voice.refDistance = 2.2;
    voice.disconnect();
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 1.5;
    voice.connect(voiceGain).connect(ctx.destination);
    audioHub.voice = voice;
    this.startAmbience();
  }

  /** A panner at a world position (meters). */
  private at(pos: V3): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.6;
    p.positionX.value = pos[0];
    p.positionY.value = pos[1];
    p.positionZ.value = pos[2];
    p.connect(this.master);
    return p;
  }

  private tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; to?: AudioNode; glide?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(freq * opts.glide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.to ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Metallic coin clink: inharmonic partials, short decay. */
  private coin(pos: V3, delay = 0, note = false): void {
    if (!this.ctx) return;
    const to = this.at(pos);
    if (note) {
      this.tone(900, delay, 0.12, { type: 'triangle', gain: 0.08, to, glide: 0.6 }); // paper swish
      return;
    }
    for (const [f, g] of [[2093, 0.12], [3520, 0.07], [5274, 0.05], [7040, 0.03]] as const) this.tone(f * (0.97 + Math.random() * 0.06), delay, 0.35, { gain: g, to });
  }

  private ding(pos: V3, delay = 0, pitch = 1): void {
    const to = this.ctx ? this.at(pos) : undefined;
    this.tone(1318 * pitch, delay, 0.9, { type: 'sine', gain: 0.16, to });
    this.tone(2637 * pitch, delay, 0.5, { type: 'sine', gain: 0.05, to });
  }

  private pop(pos: V3, delay = 0): void {
    const to = this.ctx ? this.at(pos) : undefined;
    this.tone(320, delay, 0.12, { type: 'sine', gain: 0.18, to, glide: 2.2 });
  }

  private tick(): void {
    this.tone(1760, 0, 0.05, { type: 'triangle', gain: 0.05 });
  }

  private chime(delay: number): void {
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, delay + i * 0.09, 0.7, { type: 'sine', gain: 0.09 }));
  }

  private fanfare(): void {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, i * 0.13, 0.35, { type: 'triangle', gain: 0.12 }));
  }

  private blip(on: boolean): void {
    this.tone(on ? 880 : 660, 0, 0.09, { type: 'sine', gain: 0.1, glide: on ? 1.5 : 0.66 });
  }

  /** Room murmur (filtered noise) + a gentle music-box motif every few seconds. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.05;
    this.ambience.connect(this.master);
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; // brown-ish noise
      data[i] = last * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    src.connect(lp).connect(this.ambience);
    src.start();

    const motif = [659, 784, 880, 784, 659, 587, 523, 587];
    let step = 0;
    const musicBus = this.at([-1.6, 1.6, -2.3]); // a radio on the back shelf
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const f = motif[step % motif.length];
      step++;
      this.tone(f, 0, 1.4, { type: 'sine', gain: 0.03, to: musicBus });
      this.tone(f / 2, 0, 1.6, { type: 'triangle', gain: 0.015, to: musicBus });
    }, 650);
    this.cleanupFuncs.push(() => {
      if (this.musicTimer) clearInterval(this.musicTimer);
      void this.ctx?.close();
      audioHub.ctx = null;
      audioHub.voice = null;
    });
    this.applyMotion();
    this.cleanupFuncs.push(events.settings.on(() => this.applyMotion()));
  }

  private applyMotion(): void {
    // "Reduce motion" also calms the soundscape.
    if (this.ambience) this.ambience.gain.value = store.profile.settings.reduceMotion ? 0.02 : 0.05;
  }

  update(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    this.fwd.set(0, 0, -1).transformDirection(head.matrixWorld);
    this.up.set(0, 1, 0).transformDirection(head.matrixWorld);
    const l = ctx.listener;
    if (l.positionX) {
      // Direct .value writes: no automation events pile up at 72-90 Hz.
      l.positionX.value = this.headPos.x;
      l.positionY.value = this.headPos.y;
      l.positionZ.value = this.headPos.z;
      l.forwardX.value = this.fwd.x;
      l.forwardY.value = this.fwd.y;
      l.forwardZ.value = this.fwd.z;
      l.upX.value = this.up.x;
      l.upY.value = this.up.y;
      l.upZ.value = this.up.z;
    }
  }
}
