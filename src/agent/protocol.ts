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
}

export type AgentEvent =
  | { kind: 'arrive' } // session start: greet, recall last visit
  | { kind: 'say'; text: string; fingers: number; pronunciation?: number }
  | { kind: 'show'; itemId: string } // learner held up / handed over an item
  | { kind: 'paid'; paidCents: number; totalCents: number; changeCents: number; changeWords?: string }
  | { kind: 'short'; paidCents: number; shortByCents: number; shortWords?: string }
  | { kind: 'gesture'; gesture: 'thumbs_up' | 'thumbs_down' | 'wave' | 'count'; fingers: number }
  | { kind: 'idle' }; // learner silent for a while: offer help

export interface AgentProfile {
  name: string;
  level: string;
  sessions: number;
  streakDays: number;
  weakWords: string[];
  memories: Record<string, string>;
  lastVisit: string; // short summary of the previous session ('' if first)
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
}
