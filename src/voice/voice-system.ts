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
import { scorePronunciation } from './pronunciation.js';
import { fontsReady } from '../fonts.js';
import { localVoice } from './local-voice.js';
import { SpeechInput } from './speech-input.js';

const MIN_TARGET_SCORE = 45; // below this the learner said something else, not a try at a reply

export class VoiceSystem extends createSystem({}) {
  private mic = new SpeechInput();
  private el: Record<string, UIKit.Text | undefined> = {};
  private micButton: ReturnType<UIKitMLAsset['getElementById']> | undefined;
  private processing = false;

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
      events.voiceOrder.on((text) => this.set('heard', `Vous (doigts) : ${text}`)),
      localVoice.progress.on(({ task, pct }) => {
        if (task === 'stt' && this.processing && pct < 100) this.set('heard-detail', `Loading the on-device French voice model (first time only): ${pct}%`);
      }),
    );

    void this.mic.detect().then((engine) => {
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

  private async begin(): Promise<void> {
    if (this.processing || this.mic.listening || !this.mic.available) return;
    const ok = await this.mic.start();
    if (!ok) {
      this.set('heard', 'Microphone blocked. Allow it in the browser, or pinch a reply.');
      return;
    }
    events.listening.emit(true);
    this.micButton?.setProperties({ backgroundColor: '#2a9d8f' });
    this.set('mic-label', "J'écoute...");
    this.set('heard', 'Parlez maintenant ! Speak now.');
    this.set('heard-detail', 'Pinch again (or lower your palm) when you are done.');
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
    try {
      const text = await this.mic.stop();
      this.handle(text);
    } finally {
      this.processing = false;
      this.set('mic-label', 'Parler');
    }
  }

  /** Public for tests/automation: process a transcript as if spoken. */
  handle(text: string): void {
    if (!text.trim()) {
      this.set('heard', "Je n'ai rien entendu. I didn't hear anything.");
      this.set('heard-detail', 'Try again, a bit louder and closer.');
      return;
    }
    const fingers = handState.fingers;
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
          if (appState.lastLuneLine) speakFrench(appState.lastLuneLine, 0.7, 'lune');
          return;
        case 'slower':
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
          void director.handle({ kind: 'idle' });
          return;
        case 'map':
          events.openPanel.emit('map');
          return;
        case 'passport':
          events.openPanel.emit('passport');
          return;
      }
    }
    if (intent.kind === 'travel') {
      events.travel.emit(intent.place);
      return;
    }
    if (intent.kind === 'pay' && intent.cents && store.order.phase === 'paying') {
      void director.pay(intent.cents);
      return;
    }
    void director.handle({ kind: 'say', text, fingers, pronunciation: scored?.score });
  }
}
