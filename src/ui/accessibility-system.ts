/**
 * Accessibility Forward, in one place:
 *  - runs global voice commands (./../voice/voice-commands.ts): every panel button
 *    and hand action has a spoken alternative;
 *  - applies the chosen input mode (hands / eyes / voice) to the settings;
 *  - hands-free voice: when "Mains libres" is on, the microphone opens by itself
 *    after each line the shopkeeper speaks;
 *  - high contrast beyond text colour: white outlines on every button;
 *  - the one-line "Accessibilité : ..." summary in Reglages.
 * Event-driven only; no per-frame work.
 */

import { createSystem, type Object3D, type UIKitMLAsset } from '@iwsdk/core';
import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { PLACE_ORDER } from '../places/places.js';
import { luneSpeaking, speakFrench } from '../speech.js';
import type { Settings } from '../state/profile.js';
import { store } from '../state/store.js';
import type { VoiceCommand } from '../voice/voice-commands.js';
import { activateTarget } from './dwell.js';
import { a11ySummary, applyInputMode, nextTextSize, tutorialState as onboardingState } from './input-mode.js';

/** Buttons that get a white outline in high contrast: [panel node, element id, normal border]. */
const OUTLINED: [string, string, { color: string; width: number }][] = [
  ...['start-button', 'repeat-button', 'carnet-button', 'settings-button', 'map-button', 'xr-button', 'exit-button', 'week-button'].map(
    (id) => ['lesson-panel', id, { color: '#000000', width: 0 }] as [string, string, { color: string; width: number }],
  ),
  ...['choose-hands', 'choose-eyes', 'choose-voice', 'choose-text'].map(
    (id) => ['lesson-panel', id, { color: '#4a4c55', width: 2 }] as [string, string, { color: string; width: number }],
  ),
  ...['highContrast', 'textSize', 'slowSpeech', 'subtitles', 'gazeDwell', 'leftHanded', 'reduceMotion', 'mixedReality', 'voiceFirst', 'realLife', 'pronunciationHelp', 'tutorial'].map(
    (k) => ['settings-panel', `set-${k}`, { color: '#000000', width: 0 }] as [string, string, { color: string; width: number }],
  ),
  ['settings-panel', 'settings-back', { color: '#000000', width: 0 }],
  ['carnet-panel', 'carnet-back', { color: '#000000', width: 0 }],
  ['carnet-panel', 'review-button', { color: '#000000', width: 0 }],
  ['map-panel', 'map-back', { color: '#000000', width: 0 }],
  ...PLACE_ORDER.map((p) => ['map-panel', `place-${p}`, { color: '#000000', width: 0 }] as [string, string, { color: string; width: number }]),
  ['report-panel', 'week-back', { color: '#000000', width: 0 }],
  ['chat-panel', 'mic-button', { color: '#000000', width: 0 }],
  ['chat-panel', 'rl-translate', { color: '#4a4c55', width: 1 }],
  ['chat-panel', 'rl-aide', { color: '#4a4c55', width: 1 }],
];

export class AccessibilitySystem extends createSystem({}) {
  private panels = new Map<string, UIKitMLAsset>();
  private listenTimer: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    for (const id of ['lesson-panel', 'settings-panel', 'carnet-panel', 'map-panel', 'report-panel', 'chat-panel']) {
      const p = this.world.getSceneObject<UIKitMLAsset>(id);
      if (p) this.panels.set(id, p);
    }
    this.cleanupFuncs.push(
      events.voiceCommand.on((c) => this.run(c)),
      events.settings.on((s) => this.apply(s)),
      // Hands-free voice: open the mic shortly after the shopkeeper stops talking.
      luneSpeaking.on((speaking) => {
        if (this.listenTimer) clearTimeout(this.listenTimer);
        this.listenTimer = null;
        if (speaking || !store.profile.settings.voiceFirst) return;
        this.listenTimer = setTimeout(() => events.listenNow.emit(), 450);
      }),
      () => {
        if (this.listenTimer) clearTimeout(this.listenTimer);
      },
    );
    this.apply(store.profile.settings);
  }

  private el(panel: string, id: string): Object3D | undefined {
    return (this.panels.get(panel)?.getElementById(id) as Object3D | null) ?? undefined;
  }

  private apply(s: Settings): void {
    for (const [panel, id, normal] of OUTLINED) {
      const el = this.panels.get(panel)?.getElementById(id);
      el?.setProperties((s.highContrast ? { borderColor: '#ffffff', borderWidth: 3 } : { borderColor: normal.color, borderWidth: normal.width }) as never);
    }
    this.panels.get('settings-panel')?.getElementById('a11y-summary')?.setProperties({ text: a11ySummary(s), color: s.highContrast ? '#ffffff' : '#f5d90a' } as never);
  }

  private press(panel: string, id: string): void {
    const el = this.el(panel, id);
    if (el) activateTarget(el);
  }

  private run(c: VoiceCommand): void {
    const s = store.profile.settings;
    switch (c.kind) {
      case 'open':
        events.openPanel.emit(c.panel);
        return;
      case 'close':
        events.openPanel.emit('home');
        return;
      case 'repeat':
        // "Vraie vie": she repeats at her normal pace; only "plus lentement" slows down.
        if (appState.lastLuneLine) speakFrench(appState.lastLuneLine, s.realLife ? 0.9 : 0.7, 'lune');
        return;
      case 'slower':
        if (s.realLife && !onboardingState.running) {
          // She repeats her last line once, slowly and more simply (no lasting slow-speech setting).
          void director.handle({ kind: 'say', text: 'Pardon, vous pouvez répéter plus lentement ?', fingers: 0 });
          return;
        }
        store.setSetting('slowSpeech', true);
        if (appState.lastLuneLine) speakFrench(appState.lastLuneLine, 0.7, 'lune');
        return;
      case 'help':
        // In the tutorial, help = hear the current instruction again (slowly); otherwise Lune offers help.
        if (onboardingState.running) {
          if (appState.lastLuneLine) speakFrench(appState.lastLuneLine, 0.7, 'lune');
        } else if (s.realLife) events.realLifeHelp.emit('aide'); // "Vraie vie": show the reply chips (counted as help)
        else void director.handle({ kind: 'idle' });
        return;
      case 'translate':
        events.realLifeHelp.emit('translate');
        return;
      case 'skip':
        if (onboardingState.running) events.tutorial.emit(); // onboarding treats this as "skip"
        return;
      case 'tutorial':
        events.openPanel.emit('home');
        if (!onboardingState.running) events.tutorial.emit();
        return;
      case 'pay_exact':
        events.payExact.emit();
        return;
      case 'travel':
        events.travel.emit(c.place);
        return;
      case 'mode':
        applyInputMode(c.mode);
        return;
      case 'text':
        store.setSetting('textSize', nextTextSize(s.textSize, c.bigger));
        return;
      case 'toggle':
        store.setSetting(c.setting, !s[c.setting]);
        return;
      case 'mission':
        events.openPanel.emit('home');
        this.press('lesson-panel', 'start-button');
        return;
      case 'review':
        this.press('carnet-panel', 'review-button');
        return;
    }
  }
}
