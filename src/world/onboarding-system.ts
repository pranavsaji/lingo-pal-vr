/**
 * First Five Minutes: a gesture-gated tutorial with no text walls.
 * Madame Lune talks; a glowing ghost hand demonstrates each move; each step
 * advances when the learner does it (by hand, voice, gaze or a pinched reply),
 * and never blocks: every step auto-advances after a while.
 *
 *   1. Wave hello            -> she waves back
 *   2. Pinch the croissant   -> hear the word
 *   3. Look + hold 1 finger  -> order it (or say / pinch "Un croissant")
 *   4. Drag a coin to tray   -> pay (or pinch a payment reply)
 *   5. Payoff: confetti, fanfare, first badge, streak day 1  (< 2 minutes)
 *
 * Skip by saying "passer" or pinching "Passer le tutoriel".
 */

import { createSystem, type UIKit, type UIKitMLAsset, Vector3 } from '@iwsdk/core';
import type { AgentTurn, ReplyOption } from '../agent/protocol.js';
import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { dishPos, TRAY } from '../layout.js';
import { buildGhostHand, type GhostHandRig } from '../models/cafe-models.js';
import { priceToEnglish, priceToFrench } from '../agent/menu.js';
import { orderTotal } from '../agent/tools.js';
import { store } from '../state/store.js';
import { onActivate } from '../ui/dwell.js';
import { vocabById } from '../vocab.js';

type Step = 'off' | 'wave' | 'pinch' | 'order' | 'pay' | 'done';
const STEPS: Step[] = ['wave', 'pinch', 'order', 'pay'];
const AUTO_ADVANCE: Record<string, number> = { wave: 14, pinch: 25, order: 35, pay: 45 };
/** Let the previous moment finish (the word being spoken, her wave) before she talks. */
const LINE_DELAY_MS: Record<string, number> = { wave: 0, pinch: 700, order: 1300, pay: 60 };

interface Line {
  fr: string;
  en: string;
  caption: string; // one short line on the lesson panel
  replies: ReplyOption[];
}

const LINES: Record<Exclude<Step, 'off' | 'done'>, Line> = {
  wave: {
    fr: 'Bonjour ! Je suis Madame Lune. Faites-moi coucou !',
    en: "Hello! I'm Madame Lune. Wave at me!",
    caption: 'Wave your hand',
    replies: [
      { fr: 'Bonjour, madame !', en: "Hello, ma'am!" },
      { fr: 'Coucou !', en: 'Hi there!' },
      { fr: 'Salut !', en: 'Hi!' },
    ],
  },
  pinch: {
    fr: 'Bravo ! Maintenant, pincez le croissant.',
    en: 'Well done! Now pinch the croissant.',
    caption: 'Point at the croissant and pinch',
    replies: [
      { fr: 'Le croissant !', en: 'The croissant!' },
      { fr: "C'est quoi ?", en: 'What is it?' },
      { fr: "D'accord.", en: 'Okay.' },
    ],
  },
  order: {
    fr: 'Pour commander, regardez le croissant et montrez un doigt.',
    en: 'To order, look at the croissant and hold up one finger.',
    caption: 'Look at it + hold up 1 finger',
    replies: [
      { fr: "Un croissant, s'il vous plaît.", en: 'A croissant, please.' },
      { fr: "Deux croissants, s'il vous plaît.", en: 'Two croissants, please.' },
      { fr: "Un café, s'il vous plaît.", en: 'A coffee, please.' },
    ],
  },
  pay: {
    fr: "Ça fait un euro soixante-dix. Prenez une pièce et posez-la sur le plateau.",
    en: 'That is 1.70 euros. Take a coin and put it on the tray.',
    caption: 'Pinch a coin, drag it to the tray',
    replies: [
      { fr: 'Voilà deux euros.', en: 'Here are two euros.' },
      { fr: 'Voilà cinq euros.', en: 'Here are five euros.' },
      { fr: "Voilà, c'est juste.", en: 'Here, exact change.' },
    ],
  },
};

export class OnboardingSystem extends createSystem({}) {
  private step: Step = 'off';
  private stepStart = 0;
  private t = 0;
  private ghost!: GhostHandRig;
  private el: Record<string, UIKit.Text | undefined> = {};
  private a!: Vector3;
  private b!: Vector3;
  private startedAt = 0;

  init(): void {
    this.a = new Vector3();
    this.b = new Vector3();
    this.ghost = buildGhostHand();
    this.ghost.root.name = 'Ghost Hand';
    this.ghost.root.visible = false;
    this.world.createTransformEntity(this.ghost.root);

    const panel = this.world.getSceneObject<UIKitMLAsset>('lesson-panel');
    if (panel) {
      for (const id of ['eyebrow', 'word', 'english', 'tip', 'start-label']) this.el[id] = panel.getElementById<UIKit.Text>(id) ?? undefined;
      const start = panel.getElementById('start-button');
      if (start) this.cleanupFuncs.push(onActivate(start, () => {
        if (this.running) this.finish(true);
      }));
    }

    this.cleanupFuncs.push(
      events.gesture.on((g) => {
        if (g === 'wave' && this.step === 'wave') this.advance();
      }),
      events.turn.on(() => {
        // Any conversational turn during "wave" counts as saying hello.
        if (this.step === 'wave' && this.t - this.stepStart > 1) this.advance();
      }),
      events.itemPicked.on(() => {
        if (this.step === 'pinch') this.advance();
      }),
      events.order.on((o) => {
        if (this.step === 'order' && o.lines.length > 0) this.advance();
        if (this.step === 'pay' && o.phase === 'paid') this.advance();
      }),
      events.tutorial.on(() => (this.running ? this.finish(true) : this.begin())),
    );

    if (!store.profile.onboarded) setTimeout(() => this.begin(), 1200);
  }

  get running(): boolean {
    return this.step !== 'off' && this.step !== 'done';
  }

  private set(id: string, text: string): void {
    this.el[id]?.setProperties({ text });
  }

  begin(): void {
    appState.lessonActive = true; // pinches are tutorial answers, not "show" events
    this.startedAt = this.t;
    this.go('wave');
    this.set('start-label', 'Passer le tutoriel');
  }

  private go(step: Step): void {
    this.step = step;
    this.stepStart = this.t;
    if (step === 'off' || step === 'done') return;
    const line = LINES[step];
    const n = STEPS.indexOf(step) + 1;
    this.set('eyebrow', `TUTORIEL ${n} / ${STEPS.length}`);
    this.set('word', line.caption);
    this.set('english', '');
    this.set('tip', 'Or say it, or pinch a reply on the right.');
    events.missionTarget.emit(step === 'pinch' || step === 'order' ? 'croissant' : '');
    this.ghost.root.visible = true;
    setTimeout(() => {
      if (this.step !== step) return;
      if (step === 'pay') {
        // Nothing ordered yet (auto-advance): she serves the croissant herself.
        if (store.order.lines.length === 0) director.applyLocal([{ type: 'serve_items', itemId: 'croissant', quantity: 1 }]);
        // Quote the real total with the same validated tool the agent uses (no model call).
        if (store.order.phase !== 'paying') director.applyLocal([{ type: 'quote_total' }]);
        const total = orderTotal(store.order.lines);
        this.luneSays(
          `Ça fait ${priceToFrench(total)}. Prenez une pièce et posez-la sur le plateau.`,
          `That is ${priceToEnglish(total)}. Take a coin and put it on the tray.`,
          line.replies,
        );
        return;
      }
      this.luneSays(line.fr, line.en, line.replies);
    }, LINE_DELAY_MS[step]);
  }

  private luneSays(fr: string, en: string, replies: ReplyOption[]): void {
    const turn: AgentTurn = { fr, en, replies, actions: [], points: 0, source: 'script' };
    events.turn.emit(turn); // the chat panel renders and speaks every turn (with lip sync)
    events.subtitle.emit({ who: 'lune', fr, en });
  }

  private advance(): void {
    const i = STEPS.indexOf(this.step);
    if (i < 0) return;
    if (this.step === 'wave') events.effects.emit([{ kind: 'emote', emote: 'wave' }]);
    if (i + 1 < STEPS.length) this.go(STEPS[i + 1]);
    else this.finish(false);
  }

  private finish(skipped: boolean): void {
    this.step = 'done';
    appState.lessonActive = false;
    this.ghost.root.visible = false;
    events.missionTarget.emit('');
    store.markOnboarded();
    this.set('start-label', 'Commencer la mission');
    if (!skipped) {
      const secs = Math.round(this.t - this.startedAt);
      store.addXp(30);
      events.celebrate.emit();
      this.set('eyebrow', 'PREMIER CAFÉ !');
      this.set('word', 'Bravo !');
      this.set('english', `First order in ${secs} s. Streak: day ${store.profile.streakDays}.`);
      this.set('tip', 'Come back tomorrow: a new plat du jour is waiting.');
    } else {
      this.set('eyebrow', 'BIENVENUE !');
      this.set('word', 'Pincez un objet');
      this.set('english', 'Pinch any object to hear its French name.');
    }
    // Now the real conversation starts (she asks your name if she does not know it).
    setTimeout(() => void director.handle({ kind: 'arrive' }), skipped ? 300 : 2600);
  }

  update(delta: number): void {
    this.t += delta;
    if (!this.running) return;
    const elapsed = this.t - this.stepStart;
    if (elapsed > AUTO_ADVANCE[this.step]) this.advance();
    this.animateGhost(elapsed);
  }

  /** Procedural demonstrations; fingers[i].rotation.x > 0 curls toward the palm. */
  private animateGhost(e: number): void {
    const g = this.ghost;
    const r = g.root;
    const f = g.fingers;
    const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(e * 3));
    g.setOpacity(pulse);
    const side = store.profile.settings.leftHanded ? -1 : 1;
    r.scale.set(side, 1, 1);

    switch (this.step) {
      case 'wave': {
        // Hand up, palm toward Madame Lune, waving side to side.
        r.position.set(0.22 * side, 1.28, -0.45);
        r.rotation.set(Math.PI / 2, 0, Math.sin(e * 7) * 0.45);
        for (const finger of f) finger.rotation.x = 0;
        break;
      }
      case 'pinch': {
        // Reach toward the croissant, then pinch (thumb + index meet) in a loop.
        const cr = vocabById('croissant')!.position;
        this.a.set(0.18 * side, 1.12, -0.38);
        this.b.set(cr[0], cr[1] + 0.25, cr[2]).sub(this.a).multiplyScalar(0.25).add(this.a);
        const c = (e % 2) / 2;
        const reach = Math.min(1, c * 3);
        r.position.lerpVectors(this.a, this.b, reach);
        r.lookAt(cr[0], cr[1], cr[2]);
        const pinch = c > 0.45 && c < 0.85 ? 1 : 0;
        f[0].rotation.x = 0.25 + 0.6 * pinch;
        f[1].rotation.x = 0.2 + 0.55 * pinch;
        for (let i = 2; i < 5; i++) f[i].rotation.x = 0.9;
        break;
      }
      case 'order': {
        // Hand raised, one finger up (index), others folded.
        r.position.set(0.2 * side, 1.3 + Math.sin(e * 2) * 0.01, -0.42);
        r.rotation.set(Math.PI / 2, 0, 0);
        f[0].rotation.x = 1.2;
        f[1].rotation.x = 0;
        for (let i = 2; i < 5; i++) f[i].rotation.x = 1.45;
        break;
      }
      case 'pay': {
        // Pinch above the dish, sweep toward the tray, release.
        const d = dishPos(store.profile.settings.leftHanded);
        this.a.set(d[0], d[1] + 0.12, d[2]);
        this.b.set(TRAY[0], TRAY[1] + 0.15, TRAY[2]);
        const c = (e % 2.6) / 2.6;
        const move = Math.min(1, Math.max(0, (c - 0.25) / 0.5));
        const s = move * move * (3 - 2 * move);
        r.position.lerpVectors(this.a, this.b, s);
        r.rotation.set(0.3, 0, 0);
        const held = c > 0.15 && c < 0.8 ? 1 : 0;
        f[0].rotation.x = 0.25 + 0.6 * held;
        f[1].rotation.x = 0.2 + 0.55 * held;
        for (let i = 2; i < 5; i++) f[i].rotation.x = 0.9;
        break;
      }
    }
  }
}
