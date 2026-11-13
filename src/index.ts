/**
 * Lingo Pal VR: a hands-first French cafe for Meta Quest and Meta VR Glasses.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AudioSystem } from './audio/audio-system.js';
import { ChatSystem } from './chat-system.js';
import { HandSystem } from './hands/hand-system.js';
import { CoinSystem } from './interaction/coin-system.js';
import { ItemSystem } from './item-system.js';
import { LessonSystem } from './lesson-system.js';
import { DwellSystem } from './ui/dwell-system.js';
import { PanelsSystem } from './ui/panels-system.js';
import { PROFILE_KEY } from './state/profile.js';
import { VoiceSystem } from './voice/voice-system.js';
import { DecorSystem } from './world/decor-system.js';
import { CelebrationSystem } from './world/celebration-system.js';
import { MixedRealitySystem } from './world/mixed-reality-system.js';
import { OnboardingSystem } from './world/onboarding-system.js';
import { NpcSystem } from './world/npc-system.js';
import { QualitySystem } from './world/quality-system.js';

import { localVoice } from './voice/local-voice.js';
import { SpeechInput } from './voice/speech-input.js';
import { speakFrench, speechEngine } from './speech.js';
import { appState, events } from './game-state.js';
import { handState } from './hands/hand-state.js';
import { store } from './state/store.js';
import { dwellTargets } from './ui/dwell.js';

// Dev only: Shift+R starts a brand-new learner (first-launch tutorial). Not in production builds.
if (import.meta.env.DEV) {
  // State handle for emulator test scripts (`iwsdk browser run`).
  const log: string[] = [];
  events.turn.on((t) => log.push(`turn[${t.source}]: ${t.fr}`));
  events.voiceOrder.on((t) => log.push(`fingers: ${t}`));
  events.gesture.on((g) => log.push(`gesture: ${g}`));
  events.order.on((o) => log.push(`order: ${o.phase} ${o.lines.map((l) => `${l.qty}x${l.itemId}`).join(',')} tray=${o.trayCents}`));
  events.effects.on((fx) => log.push(`effects: ${fx.map((e) => e.kind).join(',')}`));
  events.coinDropped.on((c) => log.push(`coin: ${c}`));
  (window as unknown as Record<string, unknown>).__lingo = { store, appState, handState, log, dwellTargets };
  window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key === 'R') {
      window.localStorage.removeItem(PROFILE_KEY);
      window.location.reload();
    }
  });
}

// ?debug exposes the voice engines for automated checks (no secrets involved).
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__lingoVoice = { localVoice, speakFrench, speechEngine, SpeechInput };
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  if (import.meta.env.DEV) ((window as unknown as Record<string, Record<string, unknown>>).__lingo ??= {}).world = world;
  world.registerSystem(QualitySystem); // resolution + foveation, before any XR session starts
  world.registerSystem(ItemSystem);
  world.registerSystem(LessonSystem); // starts the session (streak, XP) before the agent greets
  world.registerSystem(PanelsSystem);
  world.registerSystem(ChatSystem);
  world.registerSystem(VoiceSystem);
  world.registerSystem(HandSystem);
  world.registerSystem(AudioSystem);
  world.registerSystem(NpcSystem);
  world.registerSystem(CoinSystem);
  world.registerSystem(DecorSystem);
  world.registerSystem(MixedRealitySystem);
  world.registerSystem(DwellSystem);
  world.registerSystem(CelebrationSystem);
  world.registerSystem(OnboardingSystem);
});
