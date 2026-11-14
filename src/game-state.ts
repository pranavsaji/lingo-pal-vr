/**
 * Event bus shared between systems. No World, no DOM rendering.
 * Persistent learner state lives in src/state/store.ts.
 */

import type { AgentTurn, ReplyOption } from './agent/protocol.js';
import type { Effect, OrderState } from './agent/tools.js';
import type { Profile, Settings } from './state/profile.js';
import type { InputMode, VoiceCommand } from './voice/voice-commands.js';

type Listener<T> = (value: T) => void;

export class Emitter<T> {
  private listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(value: T): void {
    for (const fn of this.listeners) fn(value);
  }
}

export const events = {
  /** A vocabulary object was pinched (VOCAB id). */
  itemPicked: new Emitter<string>(),
  /** Points were awarded by the lesson or the agent (amount). */
  points: new Emitter<number>(),
  /** The current mission target changed (VOCAB id, or '' when none). */
  missionTarget: new Emitter<string>(),
  /** XP gained; levelUp is the new level id when one was reached. */
  xp: new Emitter<{ amount: number; total: number; levelUp: string | null }>(),
  /** Unlock id (decor, scenario) just earned. */
  unlocked: new Emitter<string>(),
  /** Profile saved (any change). */
  profile: new Emitter<Profile>(),
  /** Accessibility settings changed. */
  settings: new Emitter<Settings>(),
  /** Order state changed (items, tray, phase). */
  order: new Emitter<OrderState>(),
  /** Validated agent effects for the scene to play (spawn food, coins, emotes). */
  effects: new Emitter<Effect[]>(),
  /** Stable finger count changed (0 to 10). */
  fingers: new Emitter<number>(),
  /** Discrete hand gestures. */
  gesture: new Emitter<'thumbs_up' | 'thumbs_down' | 'wave' | 'palm_up_start' | 'palm_up_end'>(),
  /** The learner ordered without speaking (fingers + gaze); text is the phrase said for them. */
  voiceOrder: new Emitter<string>(),
  /** Show a panel in the home slot (voice command or button). */
  openPanel: new Emitter<'home' | 'carnet' | 'settings' | 'map' | 'report' | 'passport'>(),
  /** Start a spaced-repetition review of these word ids. */
  review: new Emitter<string[]>(),
  /** Replay the hand tutorial. */
  tutorial: new Emitter<void>(),
  /** Learner speech result: transcript and pronunciation feedback (null when not scored). */
  heard: new Emitter<{ text: string; score: number | null; target: string | null; missed: string[] }>(),
  /** Listening state for the mic UI. */
  listening: new Emitter<boolean>(),
  /** Every agent turn (from any input: pinch, voice, fingers, gestures, payment). */
  turn: new Emitter<AgentTurn>(),
  /** A payoff moment (confetti + fanfare). */
  celebrate: new Emitter<void>(),
  /** A coin or note landed on the payment tray (cents). */
  coinDropped: new Emitter<number>(),
  /** A spoken line for subtitles: who, French, English. */
  subtitle: new Emitter<{ who: 'lune' | 'learner'; fr: string; en: string }>(),
  /** The learner moved to another shop (the scene, menu and shopkeeper switch). */
  place: new Emitter<PlaceId>(),
  /** Shopping list progress: an item was ticked off (completed = the whole list is done). */
  questProgress: new Emitter<{ done: number; total: number; completed: boolean; label: string }>(),
  /** The learner asked to go to a shop (map panel, voice). PlaceSystem decides and travels. */
  travel: new Emitter<PlaceId>(),
  /** A passport stamp was just earned (stamp id, see src/state/passport.ts). */
  stamp: new Emitter<string>(),
  /** Mixed reality: move the cafe in the learner's room (show the reticle, commit "ici", cancel). */
  placeCafe: new Emitter<'start' | 'here' | 'cancel'>(),
  /** The shopkeeper's visible reasoning, one short line ("Lune note : deux ≠ douze"); '' clears it. */
  agentNote: new Emitter<string>(),
  /** A global voice command was recognized (AccessibilitySystem runs it). */
  voiceCommand: new Emitter<VoiceCommand>(),
  /** "Je paie": put exact coins from the dish on the tray (CoinSystem). */
  payExact: new Emitter<void>(),
  /** Start listening now (hands-free voice), if the microphone is available. */
  listenNow: new Emitter<void>(),
  /** The learner chose how to interact (first launch, settings or voice). */
  inputMode: new Emitter<InputMode>(),
  /** Café à deux: open (or show) the invite card (map panel button, voice "inviter"). */
  invite: new Emitter<void>(),
  /** Café à deux: a friend is (true) or is no longer (false) at a counter-end seat. */
  friendPresent: new Emitter<boolean>(),
};

/** Shops on the Paris map. Every shop shares the counter layout: same seat, tray and shopkeeper spot. */
export type PlaceId = 'cafe' | 'boulangerie' | 'marche' | 'bistrot' | 'metro' | 'pharmacie' | 'hotel';

/** Small shared UI state read by several systems (no rendering here). */
export const appState = {
  /** A lesson mission or review is running: pinches are answers, not "show" events. */
  lessonActive: false,
  /** The replies currently suggested on the chat panel (pronunciation targets). */
  replies: [] as ReplyOption[],
  /** Madame Lune's last line, for "repeter". */
  lastLuneLine: '',
  /** The shop the learner is in. */
  place: 'cafe' as PlaceId,
  /** Mixed reality: the "placer le café ici" reticle is showing (a pinch or "ici" commits). */
  placingCafe: false,
  /** The first-launch "hands, eyes or voice?" choice is on screen. */
  choosingInput: false,
  /** When set, a pinched chat reply is offered here first; returning true consumes it (no agent turn). */
  interceptReply: null as ((fr: string) => boolean) | null,
};
