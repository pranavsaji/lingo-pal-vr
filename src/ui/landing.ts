/**
 * Landing page wiring (markup, styles and the progress animation are inline in
 * index.html so they paint before the app bundle arrives). This module feeds it
 * real readiness milestones (./boot.ts) and turns "Entrer au café" on once the
 * shop and Madame Lune are ready, then hides the page in the headset and brings
 * it back (as "Revenir au café") when the learner leaves the session.
 *
 * Hidden inside the IWSDK editor/emulator frame (automation clicks the canvas)
 * unless the URL has ?landing; ?nolanding hides it everywhere.
 */

import { type World, VisibilityState } from '@iwsdk/core';
import { appState, events, type PlaceId } from '../game-state.js';
import { store } from '../state/store.js';
import { tutorialState } from './input-mode.js';
import { launchMode } from '../world/mixed-reality-system.js';
import { type BootMark, bootView } from './boot.js';

interface LandingHook {
  set(progress: number, cap: number, label: string): void;
}

const marks = new Set<BootMark>();
let shopAt = 0;
let lastReady = false;

function hook(): LandingHook | undefined {
  return (window as unknown as { __lingoBoot?: LandingHook }).__lingoBoot;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function suppressed(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('nolanding')) return true;
  if (q.has('landing')) return false;
  try {
    return window.self !== window.top; // framed editor / emulator preview
  } catch {
    return true;
  }
}

function setVisible(on: boolean): void {
  const root = el('landing');
  if (!root) return;
  root.hidden = !on;
  document.body.classList.toggle('landing-open', on);
}

function render(): void {
  const v = bootView(marks, shopAt ? (performance.now() - shopAt) / 1000 : 0);
  hook()?.set(v.progress, v.cap, v.label);
  const enter = el<HTMLButtonElement>('enter-cafe');
  if (enter && v.ready !== lastReady) {
    enter.disabled = !v.ready;
    const mr = el<HTMLButtonElement>('enter-mr');
    if (mr) mr.disabled = !v.ready;
    for (const b of placeButtons()) b.disabled = !v.ready;
    if (v.ready) enter.focus({ preventScroll: true });
  }
  if (v.ready && !lastReady) document.body.classList.add('landing-ready');
  lastReady = v.ready;
}

/** The seven place buttons under the promise (index.html). */
function placeButtons(): HTMLButtonElement[] {
  return typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLButtonElement>('.places button[data-place]')];
}

/** Gold on the shop the learner is in. */
function markHere(place: string): void {
  for (const b of placeButtons()) b.classList.toggle('here', b.dataset.place === place);
}

/** Record a milestone and refresh the page. */
export function markBoot(mark: BootMark): void {
  if (marks.has(mark)) return;
  marks.add(mark);
  if (mark === 'shop') shopAt = performance.now();
  render();
}

/** Call once World.create resolves (before systems register, so the first place event is caught). */
export function attachLanding(world: World): void {
  if (suppressed()) setVisible(false);
  markBoot('world');
  const offPlace = events.place.on(() => {
    markBoot('shop');
    offPlace();
  });

  // Lune is ready when the shopkeeper anchor holds a character (avatar or procedural stand-in).
  const poll = setInterval(() => {
    const anchor = world.scene.getObjectByName('Shopkeeper');
    if (anchor && anchor.children.length > 0) markBoot('lune');
    render();
    if (lastReady) clearInterval(poll);
  }, 250);

  const enter = el<HTMLButtonElement>('enter-cafe');
  const twoD = el<HTMLButtonElement>('enter-2d');
  // A desktop or phone browser without a headset opens the cafe on the page instead.
  let xr = world.xrEnabled && !!navigator.xr;
  if (enter && !xr) enter.textContent = 'Ouvrir le café';
  void navigator.xr
    ?.isSessionSupported('immersive-vr')
    .then((ok) => {
      xr = xr && ok;
      if (enter && !xr) enter.textContent = 'Ouvrir le café';
    })
    .catch(() => undefined);
  // "Dans ma pièce": mixed reality on the learner's real table, offered only where passthrough exists.
  const mr = el<HTMLButtonElement>('enter-mr');
  void navigator.xr
    ?.isSessionSupported('immersive-ar')
    .then((ok) => {
      if (mr && ok && world.xrEnabled) mr.hidden = false;
    })
    .catch(() => undefined);
  // launchXR must run inside the click (user activation), so no awaits before it.
  const go = (button: HTMLButtonElement | null, ar: boolean) => {
    if (!button || button.disabled) return;
    if (!xr) {
      setVisible(false);
      return;
    }
    try {
      launchMode(world, ar);
    } catch (err) {
      console.warn('[landing] could not start the XR session', err);
      setVisible(false); // the in-world "Enter VR" button stays available
    }
  };
  enter?.addEventListener('click', () => go(enter, false));
  // A place button goes straight there, then enters like the main button (same click, so XR can start).
  for (const b of placeButtons()) {
    b.addEventListener('click', () => {
      const place = b.dataset.place as PlaceId | undefined;
      if (!place || b.disabled) return;
      if (place !== appState.place) {
        // Picking another shop first is a clear choice: skip the café's first-run tutorial (Réglages can replay it).
        if (tutorialState.running) events.tutorial.emit();
        else if (!store.profile.onboarded) store.markOnboarded();
        appState.travelAnyway = place;
        events.travel.emit(place);
      }
      markHere(place);
      go(enter, false);
    });
  }
  events.place.on((place) => markHere(place));
  mr?.addEventListener('click', () => go(mr, true));
  twoD?.addEventListener('click', () => setVisible(false));

  let wasImmersive = false;
  world.visibilityState.subscribe((v) => {
    const immersive = v !== VisibilityState.NonImmersive;
    if (immersive) setVisible(false);
    else if (wasImmersive && !suppressed()) {
      if (enter) enter.textContent = 'Revenir au café';
      setVisible(true);
    }
    wasImmersive = immersive;
  });
}
