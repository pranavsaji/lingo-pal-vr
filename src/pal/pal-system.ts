/**
 * Pal, the English-speaking companion on the counter. The rule, made spatial:
 * the shopkeepers only speak French; Pal, the little sparrow on your side of
 * the counter, speaks English and helps.
 *
 * Ask Pal: pinch or poke Pal, look at Pal for a second (eyes mode), the
 * "Ask Pal (EN)" button, or say "Pal" / "help me" / "how do I say ...". Pal
 * listens in English (VoiceSystem owns the mic), answers aloud in English
 * (always subtitled in the chat panel's Pal box) and offers the French line to
 * say as a "Say:" chip with how it sounds. Pinching that chip says it to the
 * shopkeeper, like a reply chip. Three quick-ask chips work without a mic.
 *
 * Also: a one-time introduction after the tutorial, proactive English hints
 * for beginners when the coach hints, and in "vraie vie" Pal sits quietly
 * (dimmed) and every question counts as help.
 *
 * Cost: two draw calls at rest (body, eyes), three while listening or talking
 * (glow ring); a few scalar writes per frame while visible, no allocation.
 */

import { createSystem, Mesh, MeshBasicMaterial, type MeshStandardMaterial, PokeInteractable, Pressed, RayInteractable, SphereGeometry, type Entity, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { director } from '../agent/runtime.js';
import { orderTotal } from '../agent/tools.js';
import type { AgentTurn } from '../agent/protocol.js';
import { appState, events } from '../game-state.js';
import { palPos } from '../layout.js';
import { buildPal, PAL_BLUE, type PalRig } from '../models/pal-model.js';
import { luneSpeaking, speakFrench } from '../speech.js';
import { store } from '../state/store.js';
import { addDwellTarget, onActivate } from '../ui/dwell.js';
import { tutorialState } from '../ui/input-mode.js';
import { voiceInput } from '../voice/voice-system.js';
import { askPal } from './pal-client.js';
import { isBeginner, offlinePal, palHint, palIntro, palIntroDue, shouldPalHint, whatDidSheSay, type PalAnswer, type PalContext } from './pal-brain.js';
import { speakEnglish, stopPal } from './pal-voice.js';

type State = 'idle' | 'listening' | 'thinking' | 'talking';

const POP_S = 0.5;
const BLINK_EVERY_S = 3.7;
const BLINK_S = 0.13;
/** After her line ends, Pal waits this long before a hint or the introduction. */
const AFTER_HER_MS = 700;

const QUICK_ASKS = ['what did she say?', 'what should i say?', 'how much is it?'];

export class PalSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
}) {
  private rig!: PalRig;
  private proxyEntity: Entity | null = null;
  private panel: UIKitMLAsset | null = null;
  private el: Record<string, UIKit.Text | undefined> = {};
  private state: State = 'idle';
  private t = 0;
  private popStart = -1;
  private nextBlink = BLINK_EVERY_S;
  private blinkUntil = 0;
  private lastLine: { fr: string; en: string } | null = null;
  private say: PalAnswer | null = null;
  /** The coach just hinted: add an English hint after her line (beginners). */
  private hintPending = false;
  private introPending = false;
  private afterHer: ReturnType<typeof setTimeout> | null = null;
  private herSpeaking = false;
  private dimmed = false;
  /** Bumped by travel: an answer for the previous shop is dropped. */
  private epoch = 0;

  init(): void {
    this.rig = buildPal();
    this.rig.root.visible = store.profile.palIntroduced;
    this.placePal();
    const rootEntity = this.world.createTransformEntity(this.rig.root);
    // Pick volume: never drawn (material.visible = false costs no draw call), but rays, fingers and gaze find it.
    const proxy = new Mesh(new SphereGeometry(0.065, 8, 6), new MeshBasicMaterial({ visible: false }));
    proxy.name = 'Pal Pick';
    proxy.position.y = 0.055;
    const entity = this.world.createTransformEntity(proxy, { parent: rootEntity });
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    this.proxyEntity = entity;
    this.queries.pressed.subscribe('qualify', (e) => {
      if (e === this.proxyEntity) this.trigger();
    });
    this.cleanupFuncs.push(addDwellTarget(proxy, () => this.trigger(), 4, () => this.rig.root.visible));

    this.panel = this.world.getSceneObject<UIKitMLAsset>('chat-panel') ?? null;
    if (this.panel) {
      for (const id of ['pal-line', 'pal-say-fr', 'pal-say-sd', 'pal-tip', 'pal-button-label']) this.el[id] = this.panel.getElementById<UIKit.Text>(id) ?? undefined;
      const button = this.panel.getElementById('pal-button');
      if (button) this.cleanupFuncs.push(onActivate(button, () => this.trigger()));
      const sayChip = this.panel.getElementById('pal-say');
      if (sayChip) this.cleanupFuncs.push(onActivate(sayChip, () => this.sayIt()));
      QUICK_ASKS.forEach((q, i) => {
        const chip = this.panel?.getElementById(`pal-ask-${i}`);
        if (chip) this.cleanupFuncs.push(onActivate(chip, () => this.quickAsk(i, q)));
      });
    }
    this.show('pal-button', store.profile.palIntroduced);
    this.applySettings();

    this.cleanupFuncs.push(
      events.palAsk.on((q) => void this.ask(q)),
      events.palState.on((s) => this.setState(s)),
      events.turn.on((turn) => this.onTurn(turn)),
      events.coachHint.on(() => {
        if (shouldPalHint({ beginner: this.beginner(), realLife: store.profile.settings.realLife, introduced: store.profile.palIntroduced, palBusy: this.state !== 'idle' })) this.hintPending = true;
      }),
      luneSpeaking.on((on) => {
        this.herSpeaking = on;
        if (!on) this.scheduleAfterHer();
      }),
      events.settings.on(() => this.applySettings()),
      events.place.on(() => {
        this.epoch++;
        stopPal();
        this.lastLine = null;
        this.hintPending = false;
        this.setState('idle');
        this.hideBox();
      }),
      () => {
        if (this.afterHer) clearTimeout(this.afterHer);
        stopPal();
      },
    );
  }

  // ---- placement, look --------------------------------------------------------

  private placePal(): void {
    const [x, y, z] = palPos(store.profile.settings.leftHanded);
    this.rig.root.position.set(x, y, z);
    this.rig.root.rotation.y = Math.atan2(-x, -z); // face the learner's seat
  }

  private applySettings(): void {
    const s = store.profile.settings;
    this.placePal();
    // "Vraie vie": Pal sits quietly, dimmed (only Pal uses this material at runtime).
    this.dimmed = s.realLife;
    const body = (this.rig.body.children[0] as Mesh).material as MeshStandardMaterial;
    body.color.setHex(this.dimmed ? 0x8c8c8c : 0xffffff);
    this.rig.ringMat.color.setHex(s.highContrast ? 0xffffff : PAL_BLUE);
    const hc = s.highContrast;
    this.style('pal-box', hc ? { borderColor: '#ffffff', borderWidth: 3, backgroundColor: '#000000' } : { borderColor: '#6f9be8', borderWidth: 2, backgroundColor: '#1d3566' });
    this.style('pal-line', { color: '#ffffff' });
    this.style('pal-tip', { color: hc ? '#ffffff' : '#cfe0ff' });
    this.style('pal-say', hc ? { borderColor: '#ffffff', borderWidth: 3, backgroundColor: '#ffffff' } : { borderColor: '#2f5fb3', borderWidth: 2, backgroundColor: '#dce8ff' });
    this.style('pal-say-sd', { color: hc ? '#000000' : '#4a4c55' });
    for (let i = 0; i < 3; i++) this.style(`opt-${i}-sd`, { color: hc ? '#ffffff' : '#9aa0aa' });
    this.style('pal-button', hc ? { borderColor: '#ffffff', borderWidth: 3 } : { borderColor: '#000000', borderWidth: 0 });
  }

  private style(id: string, props: Record<string, unknown>): void {
    this.panel?.getElementById(id)?.setProperties(props as never);
  }

  private show(id: string, on: boolean): void {
    this.style(id, { display: on ? 'flex' : 'none' });
  }

  private set(id: string, text: string): void {
    this.el[id]?.setProperties({ text });
  }

  private setState(s: State): void {
    this.state = s;
    this.rig.ring.visible = s !== 'idle' && this.rig.root.visible;
    this.set('pal-button-label', s === 'listening' ? 'Pal listens...' : s === 'thinking' ? 'Pal thinks...' : 'Ask Pal (EN)');
    if (s === 'listening') {
      this.showBox();
      this.set('pal-line', "I'm listening! Ask me in English.");
    }
    if (s === 'thinking') this.set('pal-line', 'Hmm, let me think...');
  }

  private showBox(): void {
    this.show('pal-box', true);
    this.show('pal-asks', true);
  }

  private hideBox(): void {
    this.say = null;
    this.show('pal-box', false);
    this.show('pal-say', false);
    this.show('pal-tip', false);
  }

  // ---- context ----------------------------------------------------------------

  private beginner(): boolean {
    return isBeginner(store.profile, store.level.id);
  }

  private context(): PalContext {
    const o = store.order;
    return {
      place: appState.place,
      phase: o.phase,
      order: o.lines.map((l) => ({ ...l })),
      totalCents: Math.max(0, orderTotal(o.lines) - o.trayCents),
      lastLine: this.lastLine,
      replies: appState.replies.map((r) => ({ fr: r.fr, en: r.en })),
      realLife: store.profile.settings.realLife,
      name: store.profile.name,
    };
  }

  // ---- asking -------------------------------------------------------------------

  /** Pinch, poke, gaze dwell, "Ask Pal (EN)" or the voice command "Pal". */
  trigger(): void {
    if (!store.profile.palIntroduced || tutorialState.running) return;
    if (this.state === 'listening') {
      events.palListen.emit(); // second pinch: done talking
      return;
    }
    if (this.state === 'thinking') return;
    stopPal();
    director.noteHelp(); // "vraie vie": asking Pal is help (no-op otherwise)
    this.showBox();
    if (voiceInput.available) {
      events.palListen.emit();
      return;
    }
    this.set('pal-line', 'Pick a question below, and I will help in English!');
    this.show('pal-say', false);
  }

  private quickAsk(i: number, q: string): void {
    if (!store.profile.palIntroduced) return;
    director.noteHelp();
    const ctx = this.context();
    // Local and instant: no AI call for these three.
    this.answer(i === 0 ? whatDidSheSay(ctx) : offlinePal(q, ctx));
  }

  private async ask(question: string): Promise<void> {
    director.noteHelp(); // "vraie vie": asking Pal is help (no-op otherwise)
    this.showBox();
    if (!question) {
      this.setState('idle');
      this.answer(offlinePal('', this.context()), "I didn't catch that. Try again, or pick a question below!");
      return;
    }
    this.setState('thinking');
    const epoch = this.epoch;
    const a = await askPal(question, this.context());
    if (epoch !== this.epoch) return;
    this.answer(a);
  }

  /** Show and say an answer. `lead` replaces the spoken/subtitled English (keeps the Say chip). */
  private answer(a: PalAnswer, lead?: string): void {
    const en = lead ?? a.en;
    this.showBox();
    this.set('pal-line', en);
    this.say = a.fr ? a : null;
    this.show('pal-say', !!a.fr);
    if (a.fr) {
      this.set('pal-say-fr', a.fr);
      this.set('pal-say-sd', a.sounds);
      this.show('pal-say-sd', !!a.sounds);
      // The suggested line is a pronunciation target too, like the reply chips.
      if (!appState.replies.some((r) => r.fr === a.fr)) appState.replies = [...appState.replies, { fr: a.fr, en: a.en, sounds: a.sounds }];
    }
    this.set('pal-tip', a.tip ? `Tip: ${a.tip}` : '');
    this.show('pal-tip', !!a.tip);
    this.setState('talking');
    speakEnglish(
      en,
      () => this.setState('talking'),
      () => {
        if (this.state === 'talking') this.setState('idle');
      },
    );
  }

  /** Pinch the "Say:" chip: the learner says it to the shopkeeper. */
  private sayIt(): void {
    const s = this.say;
    if (!s || director.busy) return;
    stopPal();
    this.setState('idle');
    this.show('pal-say', false);
    this.say = null;
    speakFrench(s.fr, undefined, 'learner');
    void director.handle({ kind: 'say', text: s.fr, fingers: 0 });
  }

  // ---- the shopkeeper's turns: hints and the introduction --------------------------

  private onTurn(turn: AgentTurn): void {
    if (!turn.fr) return;
    this.lastLine = { fr: turn.fr, en: turn.en };
    if (this.hintPending) {
      this.pendingTurn = turn;
    } else if (this.state === 'idle') {
      // A new line from her: the old answer is stale.
      this.hideBox();
    }
    if (palIntroDue(store.profile, tutorialState.running)) this.introPending = true;
    // Covers an engine that never reports the end of her line.
    if (this.introPending || this.hintPending) this.scheduleAfterHer(6000);
  }

  private pendingTurn: AgentTurn | null = null;

  private scheduleAfterHer(ms = AFTER_HER_MS): void {
    if (!this.introPending && !this.hintPending) return;
    if (this.afterHer) clearTimeout(this.afterHer);
    this.afterHer = setTimeout(() => {
      this.afterHer = null;
      if (this.herSpeaking) return; // she is still talking: her end-of-line event reschedules
      this.afterHerLine();
    }, ms);
  }

  private afterHerLine(): void {
    if (this.introPending) {
      this.introPending = false;
      this.hintPending = false;
      store.markPalIntroduced();
      this.rig.root.visible = true;
      this.show('pal-button', true);
      this.popStart = store.profile.settings.reduceMotion ? -1 : this.t;
      this.answer(palIntro(appState.place));
      return;
    }
    if (this.hintPending && this.pendingTurn && this.state === 'idle') {
      this.answer(palHint(this.pendingTurn, appState.place));
    }
    this.hintPending = false;
    this.pendingTurn = null;
  }

  // ---- idle life ------------------------------------------------------------------

  update(delta: number): void {
    const root = this.rig.root;
    if (!root.visible || !(delta > 0)) return;
    this.t += delta;
    const t = this.t;
    const still = store.profile.settings.reduceMotion;
    const body = this.rig.body;
    // Pop in (introduction): a small overshoot.
    let scale = 1;
    if (this.popStart >= 0) {
      const p = Math.min(1, (t - this.popStart) / POP_S);
      scale = p >= 1 ? 1 : Math.sin(p * Math.PI * 0.5) * (1 + 0.25 * Math.sin(p * Math.PI));
      if (p >= 1) this.popStart = -1;
    }
    const talking = this.state === 'talking';
    const listening = this.state === 'listening';
    const pulse = talking && !still ? 1 + 0.05 * Math.abs(Math.sin(t * 13)) : 1;
    root.scale.setScalar(Math.max(0.01, scale));
    body.scale.set(pulse, pulse * (2 - pulse), pulse);
    body.position.y = still || this.dimmed ? 0 : Math.sin(t * 2.2) * 0.0015 + (listening ? 0.004 : 0);
    body.rotation.z = listening && !still ? 0.18 : 0; // head tilt: "I'm listening"
    // Blink.
    if (t >= this.nextBlink) {
      this.blinkUntil = t + BLINK_S;
      this.nextBlink = t + BLINK_EVERY_S + (Math.sin(t * 7.3) + 1) * 0.6;
    }
    const blinking = t < this.blinkUntil && !this.dimmed;
    this.rig.eyes.scale.y = blinking ? 0.12 : 1;
    if (this.rig.ring.visible) this.rig.ringMat.opacity = listening ? 0.85 : 0.45 + 0.35 * Math.abs(Math.sin(t * (talking ? 9 : 3)));
  }
}
