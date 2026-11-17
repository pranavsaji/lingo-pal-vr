/**
 * First Five Minutes: a gesture-gated tutorial with almost no text.
 * Madame Lune talks; the panel shows one pictogram and 2-4 words; a glowing
 * ghost hand demonstrates each move; each step advances when the learner does
 * it (by hand, voice, gaze or a pinched reply), and never blocks: every step
 * auto-advances after a short while (counted only in the headset).
 *
 *   0. Hands, eyes or voice?  -> first launch only; pinch, look, or say it (+ text size)
 *   1. Wave hello             -> she waves back
 *   2. Pinch the croissant    -> hear the word
 *   3. Look + hold 1 finger   -> order it (or say / pinch "Un croissant")
 *   4. Coin on the tray       -> pay (or "je paie", or look at a coin)
 *   5. Payoff: confetti, fanfare, first badge, streak day 1  (about a minute)
 *
 * Skip by saying "passer" or pinching "Passer le tutoriel".
 */

import { createSystem, type Object3D, type UIKit, type UIKitMLAsset, Vector3, VisibilityState } from '@iwsdk/core';
import type { AgentTurn, ReplyOption } from '../agent/protocol.js';
import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { dishPos, TRAY } from '../layout.js';
import { buildGhostHand, type GhostHandRig } from '../models/cafe-models.js';
import { priceToEnglish, priceToFrench } from '../agent/menu.js';
import { orderTotal } from '../agent/tools.js';
import { luneSpeaking } from '../speech.js';
import { store } from '../state/store.js';
import { dwellFocus, onActivate } from '../ui/dwell.js';
import { applyInputMode, modeOf, nextTextSize, tutorialState } from '../ui/input-mode.js';
import { type InputMode, parseVoiceCommand } from '../voice/voice-commands.js';
import { vocabById } from '../vocab.js';

type Step = 'off' | 'choose' | 'wave' | 'pinch' | 'order' | 'pay' | 'done';
type Taught = Exclude<Step, 'off' | 'choose' | 'done'>;
const STEPS: Taught[] = ['wave', 'pinch', 'order', 'pay'];
/** Seconds in the headset before a step moves on by itself (first payoff in ~90 s even if idle). */
const AUTO_ADVANCE: Record<string, number> = { choose: 15, wave: 10, pinch: 15, order: 20, pay: 25 };
/** Let the previous moment finish (the word being spoken, her wave) before she talks. */
const LINE_DELAY_MS: Record<string, number> = { choose: 0, wave: 0, pinch: 700, order: 1300, pay: 60 };
const ICONS: Record<Taught, string> = { wave: 'tut-wave', pinch: 'tut-pinch', order: 'tut-order', pay: 'tut-pay' };
const CHOICE_IDS = ['choose-hands', 'choose-eyes', 'choose-voice', 'choose-text'];

interface Line {
  /** What Madame Lune says, per input mode (the panel only shows the caption). */
  fr: Record<InputMode, string>;
  en: Record<InputMode, string>;
  /** 2-4 words on the panel, under the pictogram. */
  caption: Record<InputMode, string>;
  captionEn: Record<InputMode, string>;
  /** The shortest alternative, e.g. what to say. */
  tip: Record<InputMode, string>;
  replies: ReplyOption[];
}

const same = (s: string): Record<InputMode, string> => ({ hands: s, eyes: s, voice: s });

const CHOOSE = {
  fr: 'Bienvenue au café ! Les mains, les yeux, ou la voix ?',
  en: 'Welcome to the café! Hands, eyes, or voice? Pinch one, look at one, or say it.',
  replies: [
    { fr: 'Les mains', en: 'Hands: pinch' },
    { fr: 'Les yeux', en: 'Eyes: look for 1 second' },
    { fr: 'La voix', en: 'Voice: hands-free' },
  ] as ReplyOption[],
};

const LINES: Record<Taught, Line> = {
  wave: {
    fr: {
      hands: 'Bonjour ! Je suis Madame Lune. Faites-moi coucou !',
      eyes: 'Bonjour ! Je suis Madame Lune. Regardez « Bonjour » à droite.',
      voice: 'Bonjour ! Je suis Madame Lune. Dites-moi bonjour !',
    },
    en: { hands: "Hello! I'm Madame Lune. Wave at me!", eyes: "Hello! I'm Madame Lune. Look at « Bonjour » on the right.", voice: "Hello! I'm Madame Lune. Say hello to me!" },
    caption: { hands: 'Coucou !', eyes: 'Regardez « Bonjour »', voice: 'Dites « Bonjour »' },
    captionEn: { hands: 'Wave hello', eyes: 'Look at a reply', voice: 'Say hello' },
    tip: { hands: 'ou dites « Bonjour »', eyes: '', voice: '' },
    replies: [
      { fr: 'Bonjour, madame !', en: "Hello, ma'am!" },
      { fr: 'Coucou !', en: 'Hi there!' },
      { fr: 'Salut !', en: 'Hi!' },
    ],
  },
  pinch: {
    fr: { hands: 'Bravo ! Pincez le croissant.', eyes: 'Bravo ! Regardez le croissant.', voice: 'Bravo ! Dites : le croissant.' },
    en: { hands: 'Well done! Pinch the croissant.', eyes: 'Well done! Look at the croissant.', voice: 'Well done! Say: the croissant.' },
    caption: { hands: 'Pincez le croissant', eyes: 'Regardez le croissant', voice: 'Dites « croissant »' },
    captionEn: { hands: 'Point, then pinch', eyes: 'Look for 1 second', voice: 'Say it' },
    tip: { hands: 'ou regardez-le 1 s', eyes: '', voice: '' },
    replies: [
      { fr: 'Le croissant !', en: 'The croissant!' },
      { fr: "C'est quoi ?", en: 'What is it?' },
      { fr: "D'accord.", en: 'Okay.' },
    ],
  },
  order: {
    fr: {
      hands: 'Pour commander : regardez le croissant et montrez un doigt.',
      eyes: 'Pour commander, regardez « Un croissant » à droite.',
      voice: "Pour commander, dites : un croissant, s'il vous plaît.",
    },
    en: {
      hands: 'To order: look at the croissant and hold up one finger.',
      eyes: 'To order, look at « Un croissant » on the right.',
      voice: 'To order, say: a croissant, please.',
    },
    caption: { hands: '1 doigt = 1 croissant', eyes: 'Regardez « Un croissant »', voice: '« Un croissant ! »' },
    captionEn: { hands: 'Look at it, show 1 finger', eyes: 'Order with your eyes', voice: 'Order out loud' },
    tip: { hands: "ou dites « Un croissant, s'il vous plaît »", eyes: '', voice: '' },
    replies: [
      { fr: "Un croissant, s'il vous plaît.", en: 'A croissant, please.' },
      { fr: "Deux croissants, s'il vous plaît.", en: 'Two croissants, please.' },
      { fr: "Un café, s'il vous plaît.", en: 'A coffee, please.' },
    ],
  },
  pay: {
    // What she says is built with the real total in go('pay').
    fr: same(''),
    en: same(''),
    caption: { hands: 'Une pièce au plateau', eyes: 'Regardez une pièce', voice: 'Dites « Je paie »' },
    captionEn: { hands: 'Pinch a coin, drop it on the tray', eyes: 'Look at a coin, or « exact »', voice: 'Pay out loud' },
    tip: { hands: 'ou dites « Je paie »', eyes: '', voice: '' },
    replies: [
      { fr: 'Voilà deux euros.', en: 'Here are two euros.' },
      { fr: 'Voilà cinq euros.', en: 'Here are five euros.' },
      { fr: "Voilà, c'est juste.", en: 'Here, exact change.' },
    ],
  },
};

const PAY_ASK: Record<InputMode, [string, string]> = {
  hands: ['Prenez une pièce et posez-la sur le plateau.', 'Take a coin and put it on the tray.'],
  eyes: ["Regardez une pièce, ou « c'est juste ».", 'Look at a coin, or at « exact change ».'],
  voice: ['Dites : je paie.', 'Say: je paie (I pay).'],
};

/** True only when the microphone was already allowed (never trigger a permission prompt in the headset). */
async function micAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}

export class OnboardingSystem extends createSystem({}) {
  private step: Step = 'off';
  private stepStart = 0;
  private t = 0;
  private ghost!: GhostHandRig;
  private el: Record<string, UIKit.Text | undefined> = {};
  private a!: Vector3;
  private b!: Vector3;
  private startedAt = 0;
  private wasImmersive = false;
  private stepInXr = 0;
  private advancing = false;
  private ownTurn: AgentTurn | null = null;
  private choiceTargets = new Set<Object3D>();
  private mode: InputMode = 'hands';

  init(): void {
    this.a = new Vector3();
    this.b = new Vector3();
    this.ghost = buildGhostHand();
    this.ghost.root.name = 'Ghost Hand';
    this.ghost.root.visible = false;
    this.world.createTransformEntity(this.ghost.root);
    this.mode = modeOf(store.profile.settings);

    const panel = this.world.getSceneObject<UIKitMLAsset>('lesson-panel');
    if (panel) {
      for (const id of ['eyebrow', 'word', 'english', 'tip', 'start-label', 'choose-text-label']) this.el[id] = panel.getElementById<UIKit.Text>(id) ?? undefined;
      const start = panel.getElementById('start-button');
      if (start) this.cleanupFuncs.push(onActivate(start, () => {
        if (this.running) this.finish(true);
      }));
      const pick = (mode: InputMode) => () => {
        if (this.step === 'choose') applyInputMode(mode);
      };
      const handlers: Record<string, () => void> = {
        'choose-hands': pick('hands'),
        'choose-eyes': pick('eyes'),
        'choose-voice': pick('voice'),
        'choose-text': () => store.setSetting('textSize', nextTextSize(store.profile.settings.textSize, true, true)),
      };
      for (const id of CHOICE_IDS) {
        const el = panel.getElementById(id);
        if (!el) continue;
        this.choiceTargets.add(el as unknown as Object3D);
        this.cleanupFuncs.push(onActivate(el, handlers[id], 3.2));
      }
    }

    this.cleanupFuncs.push(
      events.gesture.on((g) => {
        if (g === 'wave' && this.step === 'wave') this.advance();
      }),
      events.turn.on((turn) => {
        if (turn === this.ownTurn) return; // her own tutorial line
        // Any reply during "wave" counts as saying hello; during "pinch", as talking about the croissant.
        if ((this.step === 'wave' || this.step === 'pinch') && this.t - this.stepStart > 1) this.advance();
      }),
      events.itemPicked.on(() => {
        // Let the word ("le croissant") show on the panel first, then the next caption.
        if (this.step === 'pinch' && !this.advancing) {
          this.advancing = true;
          setTimeout(() => {
            this.advancing = false;
            if (this.step === 'pinch') this.advance();
          }, 1600);
        }
      }),
      events.order.on((o) => {
        if (this.step === 'order' && o.lines.length > 0) this.advance();
        if (this.step === 'pay' && o.phase === 'paid') this.advance();
      }),
      events.inputMode.on((mode) => {
        this.mode = mode;
        if (this.step === 'choose') this.advance();
      }),
      events.settings.on((s) => {
        this.mode = modeOf(s);
        this.set('choose-text-label', `Texte ${s.textSize.toUpperCase()}`);
      }),
      // The choice can be spoken: listen once she has asked, if the mic is already allowed.
      luneSpeaking.on((speaking) => {
        if (speaking || this.step !== 'choose' || store.profile.settings.voiceFirst) return;
        void micAllowed().then((ok) => {
          if (ok && this.step === 'choose') events.listenNow.emit();
        });
      }),
      events.tutorial.on(() => {
        if (this.running) this.finish(true);
        else if (appState.place !== 'cafe') {
          // The tutorial is Madame Lune's croissant: replaying it from another shop goes to the café first.
          const off = events.place.on((p) => {
            off();
            if (p === 'cafe') this.begin();
          });
          events.travel.emit('cafe');
        } else this.begin();
      }),
      // Entering VR: restart the current step so she says it in the headset, with fresh timers.
      this.world.visibilityState.subscribe((v) => {
        const immersive = v !== VisibilityState.NonImmersive;
        if (immersive && !this.wasImmersive && this.running) this.go(this.step);
        this.wasImmersive = immersive;
      }),
      () => this.endChoice(),
    );

    this.set('choose-text-label', `Texte ${store.profile.settings.textSize.toUpperCase()}`);
    if (!store.profile.onboarded) setTimeout(() => this.begin(), 1200);
  }

  get running(): boolean {
    return this.step !== 'off' && this.step !== 'done';
  }

  private set(id: string, text: string): void {
    this.el[id]?.setProperties({ text });
  }

  private display(id: string, on: boolean): void {
    this.world.getSceneObject<UIKitMLAsset>('lesson-panel')?.getElementById(id)?.setProperties({ display: on ? 'flex' : 'none' } as never);
  }

  begin(): void {
    appState.lessonActive = true; // pinches are tutorial answers, not "show" events
    tutorialState.running = true;
    this.startedAt = this.t;
    this.display('quest', false); // the shopping list waits until after the tutorial
    // The first launch asks how to interact; a replay goes straight to the moves.
    this.go(store.profile.onboarded ? 'wave' : 'choose');
    this.set('start-label', 'Passer le tutoriel');
  }

  /** The "hands, eyes or voice?" choice: big buttons, eyes-only dwell on them, spoken words. */
  private startChoice(): void {
    appState.choosingInput = true;
    dwellFocus.only = store.profile.settings.gazeDwell ? null : this.choiceTargets;
    appState.interceptReply = (fr) => {
      const c = parseVoiceCommand(fr, { choosing: true, paying: false });
      if (c?.kind !== 'mode') return false;
      applyInputMode(c.mode);
      return true;
    };
    this.display('choice-row', true);
    this.display('tut-row', false);
    this.display('menu-row', false); // one decision on screen, nothing else to read
    this.set('eyebrow', 'BIENVENUE !');
    this.set('word', 'Mains, yeux ou voix ?');
    this.set('english', store.profile.settings.subtitles ? 'Pinch, look, or say it' : '');
    this.set('tip', '');
  }

  private endChoice(): void {
    appState.choosingInput = false;
    if (dwellFocus.only === this.choiceTargets) dwellFocus.only = null;
    appState.interceptReply = null;
    this.display('choice-row', false);
    this.display('menu-row', true);
  }

  private go(step: Step): void {
    this.step = step;
    this.stepStart = this.t;
    this.stepInXr = 0;
    if (step === 'off' || step === 'done') return;
    if (step === 'choose') {
      this.startChoice();
      this.ghost.root.visible = false;
      this.luneSays(CHOOSE.fr, CHOOSE.en, CHOOSE.replies);
      return;
    }
    this.endChoice();
    const line = LINES[step];
    const m = this.mode;
    const n = STEPS.indexOf(step) + 1;
    this.set('eyebrow', `${n} / ${STEPS.length}`);
    this.set('word', line.caption[m]);
    this.set('english', store.profile.settings.subtitles ? line.captionEn[m] : '');
    this.set('tip', line.tip[m]);
    this.display('tut-row', true);
    for (const s of STEPS) this.display(ICONS[s], s === step);
    events.missionTarget.emit(step === 'pinch' || step === 'order' ? 'croissant' : '');
    // The ghost hand teaches hand moves; eyes and voice learners get the ring and her words instead.
    this.ghost.root.visible = m === 'hands';
    setTimeout(() => {
      if (this.step !== step) return;
      if (step === 'pay') {
        // Nothing ordered yet (auto-advance): she serves the croissant herself.
        if (store.order.lines.length === 0) director.applyLocal([{ type: 'serve_items', itemId: 'croissant', quantity: 1 }]);
        // Quote the real total with the same validated tool the agent uses (no model call).
        if (store.order.phase !== 'paying') director.applyLocal([{ type: 'quote_total' }]);
        const total = orderTotal(store.order.lines);
        const [askFr, askEn] = PAY_ASK[this.mode];
        this.luneSays(`Ça fait ${priceToFrench(total)}. ${askFr}`, `That is ${priceToEnglish(total)}. ${askEn}`, line.replies);
        return;
      }
      this.luneSays(line.fr[this.mode], line.en[this.mode], line.replies);
      // Already ordered (e.g. said "un croissant" a step early): move on once she has asked.
      if (step === 'order' && store.order.lines.length > 0) {
        setTimeout(() => {
          if (this.step === 'order') this.advance();
        }, 2500);
      }
    }, LINE_DELAY_MS[step]);
  }

  private luneSays(fr: string, en: string, replies: ReplyOption[]): void {
    const turn: AgentTurn = { fr, en, replies, actions: [], points: 0, source: 'script' };
    this.ownTurn = turn;
    events.turn.emit(turn); // the chat panel renders and speaks every turn (with lip sync)
    events.subtitle.emit({ who: 'lune', fr, en });
  }

  private advance(): void {
    if (this.step === 'choose') {
      this.go('wave');
      return;
    }
    const i = STEPS.indexOf(this.step as Taught);
    if (i < 0) return;
    if (this.step === 'wave') events.effects.emit([{ kind: 'emote', emote: 'wave' }]);
    if (i + 1 < STEPS.length) this.go(STEPS[i + 1]);
    else this.finish(false);
  }

  private finish(skipped: boolean): void {
    this.step = 'done';
    tutorialState.running = false;
    this.endChoice();
    appState.lessonActive = false;
    this.ghost.root.visible = false;
    this.display('tut-row', false);
    this.display('quest', true);
    events.missionTarget.emit('');
    store.markOnboarded();
    this.set('start-label', 'Commencer la mission');
    if (!skipped) {
      const secs = Math.round(this.t - this.startedAt);
      store.addXp(30);
      events.celebrate.emit();
      this.set('eyebrow', 'PREMIER CAFÉ !');
      this.set('word', 'Bravo !');
      this.set('english', `First order: ${secs} s · Day ${store.profile.streakDays}`);
      this.set('tip', 'À demain : nouveau plat du jour !');
    } else {
      this.set('eyebrow', 'BIENVENUE !');
      this.set('word', 'Pincez un objet');
      this.set('english', 'Pinch, look at, or name any object.');
      this.set('tip', '');
    }
    // Now the real conversation starts (she asks your name if she does not know it).
    setTimeout(() => void director.handle({ kind: 'arrive' }), skipped ? 300 : 2600);
  }

  update(delta: number): void {
    this.t += delta;
    if (!this.running) return;
    // Auto-advance only counts time spent in the headset: on the 2D page the learner may
    // still be reading or putting the headset on.
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) this.stepInXr += delta;
    const elapsed = this.t - this.stepStart;
    if (this.stepInXr > AUTO_ADVANCE[this.step]) this.advance();
    this.animateGhost(elapsed);
  }

  /** Procedural demonstrations; fingers[i].rotation.x > 0 curls toward the palm. */
  private animateGhost(e: number): void {
    const g = this.ghost;
    const r = g.root;
    const f = g.fingers;
    // Reduce motion: a steady ghost (its demonstration still plays; that is the lesson).
    const pulse = store.profile.settings.reduceMotion ? 0.5 : 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(e * 3));
    g.setOpacity(pulse);
    const side = store.profile.settings.leftHanded ? -1 : 1;
    r.scale.set(side, 1, 1);

    switch (this.step) {
      case 'wave': {
        // Hand up, palm toward Madame Lune, waving side to side. Kept near the
        // center line: further right it hid the chat panel's replies from a seated learner.
        r.position.set(0.12 * side, 1.28, -0.45);
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
        r.position.set(0.12 * side, 1.3 + Math.sin(e * 2) * 0.01, -0.42);
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
