/**
 * Wire format between the client and /api/agent, shared by the offline script.
 * The client sends a compact snapshot of the world; the agent answers with a
 * line to speak, three suggested replies, and proposed tool actions.
 */

import type { OrderLine, OrderPhase } from './tools.js';

import type { PlaceId } from '../game-state.js';

export interface ReplyOption {
  fr: string;
  en: string;
  /** How fr sounds to an English speaker ("duh ka-FAY"); filled locally when absent (src/pal/sounds-like.ts). */
  sounds?: string;
}

export type AgentEvent =
  | { kind: 'arrive' } // session start: greet, recall last visit
  | { kind: 'say'; text: string; fingers: number; pronunciation?: number; misheard?: string }
  | { kind: 'show'; itemId: string } // learner held up / handed over an item
  | { kind: 'paid'; paidCents: number; totalCents: number; changeCents: number; changeWords?: string }
  | { kind: 'short'; paidCents: number; shortByCents: number; shortWords?: string }
  | { kind: 'gesture'; gesture: 'thumbs_up' | 'thumbs_down' | 'wave' | 'count'; fingers: number }
  | { kind: 'idle' } // learner silent for a while: offer help
  /** Proactive help (local, no model call): hesitation or gaze dwell on an item. nth = hints in a row. */
  | { kind: 'hint'; reason: 'hesitate' | 'gaze'; itemId?: string; nth: number };

export interface AgentProfile {
  name: string;
  level: string;
  sessions: number;
  streakDays: number;
  weakWords: string[];
  memories: Record<string, string>;
  lastVisit: string; // short summary of the previous session ('' if first)
  /** Top recent confusions, e.g. "quantity:deux≠douze" (reuse those words on purpose). */
  mistakes?: string[];
}

export interface AgentScene {
  phase: OrderPhase;
  order: OrderLine[];
  totalCents: number;
  /** totalCents in French words, e.g. "trois euros quarante" (the model must use this). */
  totalWords: string;
  trayCents: number;
  lookingAt: string | null; // vocab id under the learner's gaze/head ray
  holding: string | null; // vocab id in the learner's hand
  scenario: string;
  special: { itemId: string; challenge: string };
  /** The shop (menu, shopkeeper and prices on the server come from shared/places.json). */
  place: PlaceId;
  /** Today's shopping-list item still to buy in this shop, e.g. "2 croissant" ('' if none). */
  shoppingList?: string;
  /** What the shopkeeper just proposed (substitute or upsell); served if the learner accepts. */
  offer?: { itemId: string; qty: number; reason: 'substitute' | 'upsell' } | null;
  /** Items with few pieces left today (id -> pieces); the engine refuses more. */
  lowStock?: Record<string, number>;
  /** She may suggest one related item (once per visit) with the offer tool. */
  canUpsell?: boolean;
  /** Tomorrow's planned theme, said on goodbye ("les fruits"). */
  tomorrow?: string;
  /**
   * "Vraie vie" mode (absent = off): natural-pace French, no English shown, and
   * this visit's one curveball (a line from shared/places.json realLife) and its stage.
   */
  realLife?: RealLifeScene;
}

/** todo: not asked yet; asked: waiting for the answer; again: asked twice; done: answered or dropped. */
export type CurveStage = 'todo' | 'asked' | 'again' | 'done';

export interface RealLifeScene {
  curveball: string;
  stage: CurveStage;
}

export interface AgentRequest {
  profile: AgentProfile;
  scene: AgentScene;
  event: AgentEvent;
  history: { role: 'learner' | 'lune'; text: string }[];
}

export interface AgentTurn {
  fr: string;
  en: string;
  replies: ReplyOption[];
  /** Proposed tool calls; validated client-side by applyActions. */
  actions: unknown[];
  points: number;
  source: 'ai' | 'script';
  /** Real-life mode: the learner asked her to slow down, so this one line is spoken slowly. */
  slow?: boolean;
}
