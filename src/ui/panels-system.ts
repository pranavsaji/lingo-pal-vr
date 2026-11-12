/**
 * Home-slot panels: the lesson panel is "home"; Mon Carnet and Reglages swap
 * into the same spot (inside a seated learner's and the glasses' field of view,
 * never overlapping the chat panel). Also applies accessibility settings to
 * every panel (text size = panel scale, high contrast = recolored text) and
 * renders the XP bar.
 */

import { createSystem, type Object3D, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { events } from '../game-state.js';
import { applyFrenchFont } from '../fonts.js';
import { speakFrench } from '../speech.js';
import type { Settings } from '../state/profile.js';
import { mastery } from '../state/srs.js';
import { store } from '../state/store.js';
import { VOCAB } from '../vocab.js';
import { onActivate } from './dwell.js';

type Slot = 'home' | 'carnet' | 'settings';
const SLOT_NODE: Record<Slot, string> = { home: 'lesson-panel', carnet: 'carnet-panel', settings: 'settings-panel' };
const ALL_PANELS = ['lesson-panel', 'chat-panel', 'carnet-panel', 'settings-panel'];
const BASE_SCALE = 0.14;
const TEXT_SCALE: Record<Settings['textSize'], number> = { s: 0.86, m: 1, l: 1.22 };
const HIDDEN_OFFSET = 100; // hidden panels move far away so rays cannot hit them
const XP_TRACK_PX = 400;

const TOGGLES: (keyof Settings)[] = ['highContrast', 'slowSpeech', 'subtitles', 'gazeDwell', 'leftHanded', 'reduceMotion', 'mixedReality'];

/** Text that must stay readable in high contrast: [panel, element id, normal color]. */
const CONTRAST_TEXT: [string, string, string][] = [
  ['lesson-panel', 'word', '#fafaf7'],
  ['lesson-panel', 'english', '#c9ccd3'],
  ['lesson-panel', 'tip', '#9fd3c7'],
  ['lesson-panel', 'eyebrow', '#f5d90a'],
  ['chat-panel', 'npc-line', '#fafaf7'],
  ['chat-panel', 'npc-en', '#c9ccd3'],
  ['chat-panel', 'heard', '#fafaf7'],
  ['chat-panel', 'heard-detail', '#9fd3c7'],
  ['chat-panel', 'opt-0-en', '#b8bcc6'],
  ['chat-panel', 'opt-1-en', '#b8bcc6'],
  ['chat-panel', 'opt-2-en', '#b8bcc6'],
];

export class PanelsSystem extends createSystem({}) {
  private panels = new Map<string, UIKitMLAsset>();
  private objects = new Map<string, Object3D>();
  private homeY = new Map<string, number>();
  private slot: Slot = 'home';

  init(): void {
    for (const id of ALL_PANELS) {
      const panel = this.world.getSceneObject<UIKitMLAsset>(id);
      const obj = this.world.getSceneObject<Object3D>(id);
      if (!panel || !obj) continue;
      this.panels.set(id, panel);
      this.objects.set(id, obj);
      this.homeY.set(id, obj.position.y);
      if (id === 'carnet-panel' || id === 'settings-panel') applyFrenchFont(panel.document.rootElement);
    }

    this.click('lesson-panel', 'carnet-button', () => this.show('carnet'));
    this.click('lesson-panel', 'settings-button', () => this.show('settings'));
    this.click('carnet-panel', 'carnet-back', () => this.show('home'));
    this.click('settings-panel', 'settings-back', () => this.show('home'));
    this.click('carnet-panel', 'review-button', () => this.startReview());
    VOCAB.forEach((v, i) =>
      this.click('carnet-panel', `w-${i}`, () => {
        speakFrench(v.fr, store.profile.settings.slowSpeech ? 0.7 : 0.9);
        store.hearWord(v.id);
        this.renderCarnet();
      }),
    );
    for (const key of TOGGLES) this.click('settings-panel', `set-${key}`, () => store.setSetting(key, !store.profile.settings[key] as never));
    this.click('settings-panel', 'set-textSize', () => {
      const order: Settings['textSize'][] = ['s', 'm', 'l'];
      store.setSetting('textSize', order[(order.indexOf(store.profile.settings.textSize) + 1) % 3]);
    });
    this.click('settings-panel', 'set-tutorial', () => {
      this.show('home');
      events.tutorial.emit();
    });

    this.cleanupFuncs.push(
      events.openPanel.on((s) => this.show(s)),
      events.settings.on((s) => this.applySettings(s)),
      events.profile.on(() => {
        this.renderXp();
        if (this.slot === 'carnet') this.renderCarnet();
      }),
    );

    this.applySettings(store.profile.settings);
    this.renderXp();
    this.show('home');
  }

  private click(panelId: string, elementId: string, fn: () => void): void {
    const el = this.panels.get(panelId)?.getElementById(elementId);
    if (!el) return;
    this.cleanupFuncs.push(onActivate(el, fn));
  }

  private text(panelId: string, elementId: string, text: string): void {
    this.panels.get(panelId)?.getElementById<UIKit.Text>(elementId)?.setProperties({ text });
  }

  private style(panelId: string, elementId: string, props: Record<string, unknown>): void {
    this.panels.get(panelId)?.getElementById(elementId)?.setProperties(props as never);
  }

  show(slot: Slot): void {
    this.slot = slot;
    for (const s of Object.keys(SLOT_NODE) as Slot[]) {
      const obj = this.objects.get(SLOT_NODE[s]);
      if (!obj) continue;
      const visible = s === slot;
      obj.visible = visible;
      obj.position.y = (this.homeY.get(SLOT_NODE[s]) ?? 0) + (visible ? 0 : HIDDEN_OFFSET);
    }
    if (slot === 'carnet') this.renderCarnet();
    if (slot === 'settings') this.renderSettings(store.profile.settings);
  }

  private renderCarnet(): void {
    const p = store.profile;
    this.text('carnet-panel', 'carnet-count', `${p.wordsSeen.length} / ${VOCAB.length} mots`);
    VOCAB.forEach((v, i) => {
      const seen = p.wordsSeen.includes(v.id);
      const m = mastery(p.srs[v.id]);
      this.text('carnet-panel', `w-${i}-fr`, seen ? v.fr : '? ? ?');
      this.text('carnet-panel', `w-${i}-en`, seen ? v.en : 'find it in the cafe');
      for (let d = 0; d < 4; d++) {
        // Shape + color: filled dots are larger, so mastery never relies on color alone.
        const filled = d < m;
        this.style('carnet-panel', `w-${i}-d${d}`, {
          backgroundColor: filled ? '#f5d90a' : '#4a4c55',
          width: filled ? 12 : 8,
          height: filled ? 12 : 8,
        });
      }
    });
    const due = store.dueWords(5).length;
    this.text('carnet-panel', 'review-label', due ? `Révision (${due})` : 'Révision du jour');
  }

  /** Today's due words; if none are due, the weakest words seen so far. */
  private startReview(): void {
    let ids = store.dueWords(5);
    if (ids.length === 0) ids = store.weakWords(3);
    if (ids.length === 0) {
      this.text('carnet-panel', 'carnet-hint', 'Pinch objects in the cafe first to collect words!');
      return;
    }
    this.show('home');
    events.review.emit(ids);
  }

  private renderSettings(s: Settings): void {
    for (const key of TOGGLES) this.text('settings-panel', `set-${key}-val`, s[key] ? 'ON' : 'OFF');
    this.text('settings-panel', 'set-textSize-val', s.textSize.toUpperCase());
    for (const key of TOGGLES) this.style('settings-panel', `set-${key}-val`, { backgroundColor: s[key] ? '#2a9d8f' : '#c9ccd3' });
  }

  private applySettings(s: Settings): void {
    const scale = BASE_SCALE * TEXT_SCALE[s.textSize];
    for (const obj of this.objects.values()) obj.scale.setScalar(scale);
    for (const [panelId, id, normal] of CONTRAST_TEXT) {
      this.style(panelId, id, { color: s.highContrast ? (normal === '#fafaf7' ? '#ffffff' : '#ffe14d') : normal });
    }
    for (let i = 0; i < 3; i++) {
      this.style('chat-panel', `opt-${i}`, s.highContrast ? { backgroundColor: '#000000', borderColor: '#ffffff', borderWidth: 3 } : { backgroundColor: '#2b2d33', borderColor: '#4a4c55', borderWidth: 1 });
    }
    if (this.slot === 'settings') this.renderSettings(s);
  }

  private renderXp(): void {
    const lvl = store.level;
    this.style('lesson-panel', 'xp-fill', { width: Math.max(6, Math.round(XP_TRACK_PX * lvl.progress)) });
    this.text('lesson-panel', 'xp-label', lvl.next ? `${lvl.id} > ${lvl.next}` : `${lvl.id} MAX`);
  }
}
