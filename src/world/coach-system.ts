/**
 * The shopkeeper notices without being asked: hesitation (no speech, gesture
 * or pinch for ~9 s mid-order) or a long look at a counter item (1.5 s of head
 * gaze, or a hand ray resting on it). Then she offers a level-scaled hint from
 * the local script (no API call, no latency). HintCoach rate-limits so she
 * never nags. Ticks 4 times a second, allocation-free.
 */

import { createSystem } from '@iwsdk/core';
import { menuItem } from '../agent/menu.js';
import { DEFAULT_COACH, HintCoach, type CoachContext } from '../agent/proactive.js';
import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { handState } from '../hands/hand-state.js';
import { luneSpeaking } from '../speech.js';
import { mastery } from '../state/srs.js';
import { store } from '../state/store.js';

const TICK_S = 0.25;

export class CoachSystem extends createSystem({}) {
  private coach = new HintCoach(DEFAULT_COACH);
  private nowMs = 0;
  private acc = 0;
  private speaking = false;
  /** She has greeted in this shop (no hints before the first line). */
  private greeted = false;
  private ctx!: CoachContext;

  init(): void {
    const gazeWorthy = (id: string): boolean => {
      if (!menuItem(id) || store.profile.settings.gazeDwell) return false; // gaze-dwell users look to select
      if (store.order.lines.some((l) => l.itemId === id)) return false;
      return mastery(store.profile.srs[id]) < 3;
    };
    this.ctx = { eligible: false, phase: 'browsing', awaitingAnswer: false, lookingAt: null, gazeWorthy };
    const act = () => this.coach.activity(this.nowMs);
    const restart = () => this.coach.restartClock(this.nowMs);
    this.cleanupFuncs.push(
      luneSpeaking.on((on) => {
        this.speaking = on;
        if (!on) restart(); // the pause is measured from the end of her line
      }),
      events.turn.on(() => {
        this.greeted = true;
        restart();
      }),
      events.subtitle.on((s) => {
        if (s.who === 'learner') act();
      }),
      events.heard.on(act),
      events.listening.on((on) => {
        if (on) act();
      }),
      events.itemPicked.on(act),
      events.gesture.on(act),
      events.fingers.on((n) => {
        if (n > 0) act();
      }),
      events.coinDropped.on(act),
      events.voiceOrder.on(act),
      events.place.on(() => {
        this.greeted = false;
        this.coach.newVisit(this.nowMs);
      }),
    );
  }

  update(delta: number): void {
    if (!(delta > 0) || delta > 1) return;
    this.nowMs += delta * 1000;
    this.acc += delta;
    if (this.acc < TICK_S) return;
    this.acc = 0;
    const c = this.ctx;
    c.eligible = this.greeted && store.profile.onboarded && !appState.lessonActive && !director.busy && !this.speaking;
    c.phase = store.order.phase;
    c.awaitingAnswer = director.awaitingAnswer;
    c.lookingAt = handState.gazeItem ?? director.perception.lookingAt;
    const t = this.coach.tick(this.nowMs, c);
    if (!t) return;
    events.coachHint.emit(); // Pal may add an English hint for beginners after her line (src/pal/pal-system.ts)
    void director.handle(t.reason === 'gaze' ? { kind: 'hint', reason: 'gaze', itemId: t.itemId, nth: t.nth } : { kind: 'hint', reason: 'hesitate', nth: t.nth });
  }
}
