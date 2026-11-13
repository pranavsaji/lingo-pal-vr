/**
 * The app's one social session, wired to the real game (director, store, event bus).
 *
 * Imported by src/index.ts before the World starts, so that a guest link
 * (?room=ABCD) forwards the very first shopkeeper events to the host. Without
 * ?room= nothing happens here: no network, no listeners on the game.
 */

import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { luneSpeaking } from '../speech.js';
import { store } from '../state/store.js';
import { roomFromSearch } from './protocol.js';
import { SocialSession, type GameBridge } from './session.js';
import { PeerLink } from './transport.js';

/** Set by SocialSystem (the session itself never touches the World). */
export const socialEnv = { immersive: false };

let speaking = false;
let watching = false;

const bridge: GameBridge = {
  events,
  director,
  store,
  appState,
  speaking: () => speaking,
  inXr: () => socialEnv.immersive,
};

export const social = new SocialSession(bridge, (code, on) => new PeerLink(code, on));

social.changed.on(() => {
  if (social.active && !watching) {
    watching = true;
    luneSpeaking.on((v) => (speaking = v));
  }
});

// ?debug exposes the session for automated checks (like __lingoVoice in index.ts).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  (window as unknown as Record<string, unknown>).__lingoSocial = social;
}

const invited = typeof location !== 'undefined' ? roomFromSearch(location.search) : null;
if (invited) {
  // A friend's link: no first-run tutorial (it would play with the shared order); the host's shopkeeper greets us.
  if (!store.profile.onboarded) store.markOnboarded();
  social.join(invited);
}
