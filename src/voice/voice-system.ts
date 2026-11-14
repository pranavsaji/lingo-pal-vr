/**
 * Voice-first conversation and voice accessibility.
 *
 * Push-to-talk: pinch "Parler" (pinch again to send) or turn a palm up (lower
 * it to send). The transcript is scored against the suggested reply it is
 * closest to (pronunciation feedback), then:
 *  - voice commands run locally: repeter, plus lentement, reglages, carnet, aide;
 *  - "voila cinq euros" pays when the order is waiting for payment;
 *  - everything else goes to Madame Lune with the current finger count.
 */

import { createSystem, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { parseIntent } from '../agent/intent.js';
import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { handState } from '../hands/hand-state.js';
import { speakFrench } from '../speech.js';
import { store } from '../state/store.js';
import { onActivate } from '../ui/dwell.js';
import { normalizeFrench, scorePronunciation } from './pronunciation.js';
import { fontsReady } from '../fonts.js';
import { localVoice } from './local-voice.js';
import { SpeechInput } from './speech-input.js';
import { commandFeedback, parseVoiceCommand } from './voice-commands.js';
import { palRoute } from '../pal/pal-brain.js';

/** Read by Pal: whether a microphone engine exists (Pal then listens in English; else quick-ask chips only). */
export const voiceInput = { available: false };

const MIN_TARGET_SCORE = 45; // below this the learner said something else, not a try at a reply

export class VoiceSystem extends createSystem({}) {
  private mic = new SpeechInput();
  private el: Record<string, UIKit.Text | undefined> = {};
  private micButton: ReturnType<UIKitMLAsset['getElementById']> | undefined;
  private processing = false;
  /** This recording was started hands-free: stay quiet if nothing was said. */
  private autoListen = false;
  /** This recording is a question for Pal, in English. */
  private palMode = false;

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>('chat-panel');
    if (panel) {
      for (const id of ['mic-label', 'heard', 'heard-detail']) this.el[id] = panel.getElementById<UIKit.Text>(id) ?? undefined;
      this.micButton = panel.getElementById('mic-button') ?? undefined;
      if (this.micButton) this.cleanupFuncs.push(onActivate(this.micButton, () => void this.toggle()));
    }

    this.mic.onAutoStop = () => void this.finish();
    this.cleanupFuncs.push(
      events.gesture.on((g) => {
        if (g === 'palm_up_start') void this.begin();
        if (g === 'palm_up_end') void this.finish();
      }),
      // Hands-free voice (and the first-launch choice): listen without a pinch.
      events.listenNow.on(() => {
        if (this.processing || this.mic.listening || !this.mic.available) return;
        void this.begin(true);
      }),
      events.voiceOrder.on((text) => this.set('heard', `Vous (doigts) : ${text}`)),
      // Pal (the English-speaking companion) listens in English; a second call while listening sends it.
      events.palListen.on(() => {
        if (this.mic.listening && this.palMode) void this.finish();
        else if (!this.processing && !this.mic.listening) void this.begin(false, 'en');
      }),
      localVoice.progress.on(({ task, pct }) => {
        if (task === 'stt' && this.processing && pct < 100) this.set('heard-detail', `Loading the on-device French voice model (first time only): ${pct}%`);
      }),
    );

    void this.mic.detect().then((engine) => {
      voiceInput.available = engine !== 'none';
      // On-device recognition: fetch the model in the background once the scene has loaded.
      if (engine === 'local') {
        let t: ReturnType<typeof setTimeout> | null = null;
        void fontsReady().then(() => (t = setTimeout(() => localVoice.preload('stt'), 6000)));
        this.cleanupFuncs.push(() => {
          if (t) clearTimeout(t);
        });
      }
      if (engine === 'none') {
        this.set('mic-label', 'Voix : n/a');
        this.set('heard', 'Voice is not available in this browser.');
        this.set('heard-detail', 'Pinch a reply, or hold up fingers while looking at an item.');
        this.micButton?.setProperties({ backgroundColor: '#6c757d' });
      }
    });
  }

  private set(id: string, text: string): void {
    this.el[id]?.setProperties({ text });
  }

  private async toggle(): Promise<void> {
    if (this.mic.listening) await this.finish();
    else await this.begin();
  }

  private async begin(auto = false, lang: 'fr' | 'en' = 'fr'): Promise<void> {
    if (this.processing || this.mic.listening || !this.mic.available) return;
    this.autoListen = auto;
    this.palMode = lang === 'en';
    const ok = await this.mic.start(lang);
    if (!ok) {
      this.set('heard', 'Microphone blocked. Allow it in the browser, or pinch a reply.');
      if (this.palMode) events.palState.emit('idle');
      this.palMode = false;
      return;
    }
    events.listening.emit(true);
    if (this.palMode) {
      events.palState.emit('listening');
      this.micButton?.setProperties({ backgroundColor: '#2f5fb3' });
      this.set('mic-label', 'Pal...');
      this.set('heard', 'Ask Pal in English now!');
      this.set('heard-detail', 'Pinch Pal (or "Parler") again when you are done.');
      return;
    }
    this.micButton?.setProperties({ backgroundColor: '#2a9d8f' });
    this.set('mic-label', "J'écoute...");
    this.set('heard', 'Parlez maintenant ! Speak now.');
    this.set('heard-detail', auto ? 'Hands-free: just speak.' : 'Pinch again (or lower your palm) when you are done.');
  }

  private async finish(): Promise<void> {
    if (!this.mic.listening) return;
    this.processing = true;
    events.listening.emit(false);
    this.micButton?.setProperties({ backgroundColor: '#e63946' });
    this.set('mic-label', '...');
    const loading = this.mic.engine === 'local' && !localVoice.ready.stt;
    this.set('heard', loading ? 'Un instant... Loading speech recognition.' : 'Un instant... Listening back.');
    this.set('heard-detail', loading ? 'First time only. It runs on your headset, nothing to install.' : '');
    const pal = this.palMode;
    this.palMode = false;
    if (pal) events.palState.emit('thinking');
    try {
      const text = await this.mic.stop();
      if (pal) {
        this.set('heard', text.trim() ? `You (to Pal): ${text}` : "Pal didn't hear anything.");
        this.set('heard-detail', '');
        events.palAsk.emit(text.trim());
      } else this.handle(text);
    } finally {
      this.processing = false;
      this.set('mic-label', 'Parler');
    }
  }

  /** Public for tests/automation: process a transcript as if spoken. */
  handle(text: string): void {
    const auto = this.autoListen;
    this.autoListen = false;
    if (!text.trim() && auto) {
      this.set('heard', 'Dites quelque chose quand vous voulez. Speak anytime.');
      this.set('heard-detail', '');
      return;
    }
    if (!text.trim()) {
      this.set('heard', "Je n'ai rien entendu. I didn't hear anything.");
      this.set('heard-detail', 'Try again, a bit louder and closer.');
      return;
    }
    const fingers = handState.fingers;
    // Mixed reality: while the placement reticle shows, "ici" puts the cafe where the learner points.
    if (appState.placingCafe && /\bici\b/.test(normalizeFrench(text))) {
      events.placeCafe.emit('here');
      return;
    }
    // English for Pal ("Pal", "help me", "how do I say ..."): the shopkeepers only speak French.
    const pal = appState.choosingInput ? null : palRoute(text);
    if (pal) {
      this.set('heard', `You (to Pal): ${text}`);
      this.set('heard-detail', pal === 'listen' ? 'Pal is listening, in English.' : 'Pal answers in English.');
      if (pal === 'listen') setTimeout(() => events.palListen.emit(), 0);
      else events.palAsk.emit(pal.ask);
      return;
    }
    // Global commands first (map, carnet, ma semaine, je paie, répète...): never sent to the agent.
    const command = parseVoiceCommand(text, { paying: store.order.phase === 'paying', choosing: appState.choosingInput });
    if (command) {
      this.set('heard', `Vous : ${text}`);
      this.set('heard-detail', commandFeedback(command));
      events.voiceCommand.emit(command);
      return;
    }
    const intent = parseIntent(text, fingers);

    // Pronunciation: score against the closest suggested reply.
    let best: { score: number; target: string; missed: string[] } | null = null;
    for (const r of appState.replies) {
      const res = scorePronunciation(r.fr, text);
      if (!best || res.score > best.score) best = { score: res.score, target: r.fr, missed: res.words.filter((w) => w.status !== 'ok').map((w) => w.word) };
    }
    const scored = best && best.score >= MIN_TARGET_SCORE ? best : null;
    if (scored) store.recordPronunciation(scored.score);
    events.heard.emit({ text, score: scored?.score ?? null, target: scored?.target ?? null, missed: scored?.missed ?? [] });
    this.set('heard', `Vous : ${text}${scored ? `  ·  ${scored.score}%` : ''}`);
    this.set(
      'heard-detail',
      scored ? (scored.missed.length ? `Presque ! Practice: ${scored.missed.slice(0, 4).join(', ')}` : 'Parfait ! Perfect pronunciation.') : fingers ? `With ${fingers} finger${fingers > 1 ? 's' : ''} up.` : '',
    );

    if (intent.kind === 'command') {
      switch (intent.command) {
        case 'repeat':
          // "Vraie vie": a plain "pardon ?" goes to the shopkeeper, who repeats it her way.
          if (store.profile.settings.realLife) break;
          if (appState.lastLuneLine) speakFrench(appState.lastLuneLine, 0.7, 'lune');
          return;
        case 'slower':
          if (store.profile.settings.realLife) break; // she repeats once, slowly (AgentDirector)
          store.setSetting('slowSpeech', true);
          if (appState.lastLuneLine) speakFrench(appState.lastLuneLine, 0.7, 'lune');
          return;
        case 'settings':
          events.openPanel.emit('settings');
          return;
        case 'carnet':
          events.openPanel.emit('carnet');
          return;
        case 'skip':
          events.tutorial.emit(); // onboarding treats a replay request while running as skip
          return;
        case 'help':
          if (store.profile.settings.realLife) events.realLifeHelp.emit('aide');
          else void director.handle({ kind: 'idle' });
          return;
        case 'map':
          events.openPanel.emit('map');
          return;
        case 'passport':
          events.openPanel.emit('passport');
          return;
        case 'place':
          events.placeCafe.emit('start');
          return;
        case 'invite':
          events.invite.emit();
          return;
      }
    }
    if (intent.kind === 'travel') {
      events.travel.emit(intent.place);
      return;
    }
    if (intent.kind === 'pay' && intent.cents && store.order.phase === 'paying') {
      void director.pay(intent.cents, true);
      return;
    }
    // Mistake memory: number confusions ("douze" for "deux") and low-scored words.
    const misheard = director.observeSpeech({ text, target: scored?.target ?? null, score: scored?.score ?? null, missed: scored?.missed ?? [] });
    void director.handle({ kind: 'say', text, fingers, pronunciation: scored?.score, ...(misheard ? { misheard } : {}) });
  }
}
