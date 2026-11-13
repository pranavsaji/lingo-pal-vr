/**
 * Reason to Come Back moments, all local (no AI call):
 * - "Bon retour !": on the first visit of a new day the lesson panel sums up
 *   what changed since last time (streak or a rest day that saved it, a new
 *   stamp, words due today) and Madame Lune says it once her greeting ends.
 * - A new passport stamp: stamp sound + confetti (AudioSystem, CelebrationSystem),
 *   the passport strip on the lesson panel flashes, and Lune comments.
 * - Leaving (the XR session ends): the lesson panel shows tomorrow's teaser.
 */

import { createSystem, type UIKit, type UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { audioHub } from '../audio/audio-hub.js';
import { appState, events } from '../game-state.js';
import type { Line } from '../state/goals.js';
import { stampById } from '../state/passport.js';
import { store } from '../state/store.js';
import { luneSpeaking, speakFrench } from '../speech.js';

/** Wait this long after Lune stops talking before she adds a line. */
const AFTER_LINE_MS = 700;
/** If her greeting never plays (muted, no voice), say the line anyway after this. */
const FALLBACK_MS = 9000;
const STRIP = '#6d2e46';
const GOLD = '#f5d90a';

export class PassportSystem extends createSystem({}) {
  private lesson: UIKitMLAsset | null = null;
  private speaking = false;
  /** Lines waiting for Lune to be free (oldest first). */
  private queue: Line[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private batch: string[] = [];
  private returnVoice: Line | null = null;
  private returnHeard = false;
  private wasImmersive = false;

  init(): void {
    this.lesson = this.world.getSceneObject<UIKitMLAsset>('lesson-panel') ?? null;
    this.cleanupFuncs.push(
      luneSpeaking.on((on) => {
        this.speaking = on;
        if (!on) this.schedule(AFTER_LINE_MS);
      }),
      events.stamp.on((id) => this.onStamp(id)),
      this.world.visibilityState.subscribe((v) => this.onVisibility(v)),
      () => {
        if (this.timer) clearTimeout(this.timer);
      },
    );
    this.showReturn();
  }

  private set(id: string, text: string): void {
    this.lesson?.getElementById<UIKit.Text>(id)?.setProperties({ text });
  }

  /** "Bon retour !" on the lesson panel; Lune's line is queued after her greeting. */
  private showReturn(): void {
    const moment = store.arrival?.moment;
    if (!moment) return;
    this.set('eyebrow', 'BON RETOUR !');
    this.set('word', moment.title);
    this.set('english', moment.line.en);
    const demo = store.profile.demo ? '  (DEMO: simulated week, ?demo=week)' : '';
    this.set('tip', `${moment.line.fr}${demo}`);
    this.flashStrip(4);
    this.returnVoice = moment.voice;
    this.queue.push(moment.voice);
    // Her greeting comes first (ChatSystem); if it never starts, speak anyway.
    this.schedule(FALLBACK_MS);
  }

  /** Stamps from one save arrive together: one moment for all of them. */
  private onStamp(id: string): void {
    this.batch.push(id);
    if (this.batch.length > 1) return;
    setTimeout(() => {
      const ids = this.batch.splice(0);
      const first = stampById(ids[0]);
      if (!first) return;
      const many = ids.length > 1;
      const names = ids.map((i) => stampById(i)?.en ?? i).join(', ');
      if (store.profile.sessions <= 1) {
        // First visit: the tutorial's own payoff text stays; the stamp gets the tip line.
        if (!appState.lessonActive) this.set('tip', `Nouveau tampon : ${first.fr}. New passport stamp: ${names}.`);
      } else if (!appState.lessonActive) {
        this.set('eyebrow', many ? `${ids.length} NOUVEAUX TAMPONS !` : 'NOUVEAU TAMPON !');
        this.set('word', first.fr);
        this.set('english', `Passport stamp: ${names}. Pinch the passport to see it.`);
      }
      this.flashStrip(6);
      this.queue.push(
        many
          ? { fr: `${ids.length} nouveaux tampons dans votre passeport ! Bravo !`, en: `${ids.length} new stamps in your passport! Well done!` }
          : { fr: `Un nouveau tampon dans votre passeport : ${first.fr} !`, en: `A new stamp in your passport: ${first.en}!` },
      );
      // Usually earned while the shopkeeper answers a payment: let that line start first.
      this.schedule(1600);
    }, 0);
  }

  private schedule(ms: number): void {
    if (!this.queue.length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sayNext();
    }, ms);
  }

  private sayNext(): void {
    if (this.speaking || !this.queue.length) return; // retried when she stops talking
    const line = this.queue.shift()!;
    if (line === this.returnVoice) this.returnHeard = audioHub.ctx?.state === 'running';
    speakFrench(line.fr, undefined, 'lune');
    events.subtitle.emit({ who: 'lune', fr: line.fr, en: line.en });
    if (this.queue.length) this.schedule(4000);
  }

  private onVisibility(v: VisibilityState): void {
    if (v !== VisibilityState.NonImmersive) {
      // On Quest the 2D page has no audio before the first gesture: say "Bon retour" again in the headset.
      if (!this.wasImmersive && this.returnVoice && !this.returnHeard && !this.queue.includes(this.returnVoice)) {
        this.queue.push(this.returnVoice);
        this.returnHeard = true;
        this.schedule(1800);
      }
      this.wasImmersive = true;
      return;
    }
    if (!this.wasImmersive) return;
    // Leaving the headset: a reason to come back tomorrow.
    const hook = store.tomorrowHook();
    this.set('eyebrow', 'À DEMAIN !');
    this.set('english', hook.en);
    this.set('tip', hook.fr);
  }

  /** The passport strip on the lesson panel blinks gold a few times. */
  private flashStrip(times: number): void {
    const el = this.lesson?.getElementById('passport-button');
    if (!el || store.profile.settings.reduceMotion) return;
    for (let i = 0; i < times; i++) {
      setTimeout(() => el.setProperties({ backgroundColor: i % 2 === 0 ? GOLD : STRIP } as never), i * 220);
    }
    setTimeout(() => el.setProperties({ backgroundColor: STRIP } as never), times * 220);
  }
}
