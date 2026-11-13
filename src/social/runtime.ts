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
import { makeRoomCode } from './protocol.js';
import { hasRoomParam, makeSecret, parseInvite } from './secret.js';
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

export const social = new SocialSession(bridge, (invite, on) => new PeerLink(invite, on));

let friendShown = false;
social.changed.on(() => {
  const here = social.state === 'connected';
  if (here !== friendShown) {
    friendShown = here;
    events.friendPresent.emit(here);
  }
  if (social.active && !watching) {
    watching = true;
    luneSpeaking.on((v) => (speaking = v));
  }
});

// ?debug exposes the session for automated checks (like __lingoVoice in index.ts).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  (window as unknown as Record<string, unknown>).__lingoSocial = social;
}

/** The link had ?room= but no valid key (#k=...): it cannot be joined (the UI says so). */
export const brokenInvite = typeof location !== 'undefined' && hasRoomParam(location.search) && !parseInvite(location.search, location.hash);

const invite = typeof location !== 'undefined' ? parseInvite(location.search, location.hash) : null;
if (invite) {
  // A friend's link: ask before joining (nothing is sent until then). No first-run tutorial
  // (it would play with the shared order); the host's shopkeeper greets us once we join.
  if (!store.profile.onboarded) store.markOnboarded();
  social.invited(invite);
}

/** Open a new room with a fresh code and key. */
export function hostRoom(): void {
  social.host({ code: makeRoomCode(), secret: makeSecret() });
}
