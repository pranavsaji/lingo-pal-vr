/**
 * Home-slot panels: the lesson panel is "home"; Mon Carnet and Reglages swap
 * into the same spot (inside a seated learner's and the glasses' field of view,
 * never overlapping the chat panel). Also applies accessibility settings to
 * every panel (text size = panel scale, high contrast = recolored text) and
 * renders the XP bar.
 */

import { createSystem, type Object3D, Quaternion, type UIKit, type UIKitMLAsset, Vector3, VisibilityState } from '@iwsdk/core';
import { appState, events } from '../game-state.js';
import { PLACE_ORDER, placeUnlocked, unlockHint } from '../places/places.js';
import { applyFrenchFont } from '../fonts.js';
import { speakFrench } from '../speech.js';
import type { Settings } from '../state/profile.js';
import { mastery } from '../state/srs.js';
import { store } from '../state/store.js';
import { VOCAB } from '../vocab.js';
import { onActivate } from './dwell.js';
import { renderGoals, renderPassport, renderPassportStrip } from './passport-view.js';

type Slot = 'home' | 'carnet' | 'settings' | 'map' | 'report' | 'passport';
const SLOT_NODE: Record<Slot, string> = { home: 'lesson-panel', carnet: 'carnet-panel', settings: 'settings-panel', map: 'map-panel', report: 'report-panel', passport: 'passport-panel' };
const ALL_PANELS = ['lesson-panel', 'chat-panel', 'carnet-panel', 'settings-panel', 'map-panel', 'report-panel', 'passport-panel'];
const CARNET_ROWS = 12;
const BASE_SCALE = 0.14;
const TEXT_SCALE: Record<Settings['textSize'], number> = { s: 0.86, m: 1, l: 1.22 };
const HIDDEN_OFFSET = 100;
/**
 * Lowest each panel's bottom edge may sit (world y). Panels are centered on
 * their authored height, so a tall state (reply chips with sounds-like lines and
 * Pal's box; the settings list; large text) used to reach down behind the cash
 * register (top y = 1.29) or the goods on the counter (about 1.07) and, for the
 * left panels, into the counter itself. A panel taller than its authored spot
 * allows rises just enough to keep its bottom here, clear in a seated view.
 */
const MIN_BOTTOM_Y: Record<string, number> = {
  'chat-panel': 1.34,
  'lesson-panel': 1.14,
  'carnet-panel': 1.14,
  'settings-panel': 1.14,
  'map-panel': 1.14,
  'report-panel': 1.14,
  'passport-panel': 1.14,
};
const UIKIT_UNIT = 0.01; // UIKit sizes are centimeters
const LIFT_EVERY_FRAMES = 6; // hidden panels move far away so rays cannot hit them
const XP_TRACK_PX = 400;

/**
 * Narrow-view headsets (Meta VR Glasses: 37 deg to each side) cannot show the side
 * panels while the learner looks at Madame Lune. There, panels swing toward the
 * view center around the learner and shrink slightly. Azimuths are measured
 * from straight ahead (negative = left); see the glasses check in PLAN.md.
 */
const NARROW_TAN = Math.tan((42 * Math.PI) / 180);
const NARROW_SCALE = 0.85;
const NARROW_AZIMUTH_DEG: Record<string, number> = { 'lesson-panel': -21, 'carnet-panel': -21, 'settings-panel': -21, 'map-panel': -21, 'report-panel': -21, 'passport-panel': -21, 'chat-panel': 24 };

const TOGGLES: (keyof Settings)[] = ['highContrast', 'slowSpeech', 'subtitles', 'gazeDwell', 'leftHanded', 'reduceMotion', 'mixedReality', 'voiceFirst', 'realLife', 'pronunciationHelp'];

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
  private visited = new Set<string>(['cafe']);
  private basePos = new Map<string, Vector3>();
  private baseQuat = new Map<string, Quaternion>();
  private fitScale = 1;
  private fitChecked = false;
  private yawQ = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private forcedLayout: string | null = null;
  private liftFrame = 0;

  init(): void {
    this.forcedLayout = new URLSearchParams(location.search).get('layout'); // ?layout=glasses|wide
    for (const id of ALL_PANELS) {
      const panel = this.world.getSceneObject<UIKitMLAsset>(id);
      const obj = this.world.getSceneObject<Object3D>(id);
      if (!panel || !obj) continue;
      this.panels.set(id, panel);
      this.objects.set(id, obj);
      this.homeY.set(id, obj.position.y);
      this.basePos.set(id, obj.position.clone());
      this.baseQuat.set(id, obj.quaternion.clone());
      if (id !== 'lesson-panel' && id !== 'chat-panel') applyFrenchFont(panel.document.rootElement);
    }

    this.click('lesson-panel', 'carnet-button', () => this.show('carnet'));
    this.click('lesson-panel', 'settings-button', () => this.show('settings'));
    this.click('carnet-panel', 'carnet-back', () => this.show('home'));
    this.click('settings-panel', 'settings-back', () => this.show('home'));
    this.click('carnet-panel', 'review-button', () => this.startReview());
    for (let i = 0; i < CARNET_ROWS; i++)
      this.click('carnet-panel', `w-${i}`, () => {
        const v = VOCAB[i]; // the current shop's words (rows are reused per shop)
        if (!v) return;
        speakFrench(v.fr, store.profile.settings.slowSpeech ? 0.7 : 0.9);
        store.hearWord(v.id);
        this.renderCarnet();
      });
    // Weekly report.
    this.click('lesson-panel', 'week-button', () => this.show('report'));
    this.click('report-panel', 'week-back', () => this.show('home'));
    // Passeport de Paris (from the lesson panel, the map and the weekly report).
    this.click('lesson-panel', 'passport-button', () => this.show('passport'));
    this.click('passport-panel', 'passport-back', () => this.show('home'));
    this.click('map-panel', 'map-passport', () => this.show('passport'));
    this.click('report-panel', 'week-passport', () => this.show('passport'));
    // Paris map.
    this.click('lesson-panel', 'map-button', () => this.show('map'));
    this.click('map-panel', 'map-back', () => this.show('home'));
    for (const place of PLACE_ORDER)
      this.click('map-panel', `place-${place}`, () => {
        if (place === appState.place) {
          this.show('home');
          return;
        }
        if (!placeUnlocked(place, store.profile)) {
          const hint = unlockHint(place);
          this.text('map-panel', 'map-hint', `${hint.fr}. ${hint.en}.`);
          return;
        }
        this.visited.add(place);
        this.show('home');
        events.travel.emit(place);
      });
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
      this.world.visibilityState.subscribe((v) => {
        if (v === VisibilityState.NonImmersive) this.fitChecked = false; // re-measure next session
      }),
      events.openPanel.on((s) => this.show(s)),
      events.place.on(() => {
        if (this.slot === 'carnet') this.renderCarnet();
        if (this.slot === 'map') this.renderMap();
        this.renderMapBadge();
      }),
      events.settings.on((s) => this.applySettings(s)),
      events.stamp.on(() => {
        if (this.slot === 'passport') renderPassport(this.panels.get('passport-panel'));
      }),
      events.profile.on(() => {
        this.renderXp();
        if (this.slot === 'carnet') this.renderCarnet();
        this.renderMapBadge();
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
      obj.position.y = this.restY(SLOT_NODE[s]) + (visible ? 0 : HIDDEN_OFFSET);
      // Pointer hit-testing ignores visibility: without this, every hidden panel's
      // whole element tree is ray- and touch-tested by both hands every frame
      // (measured ~2.5 ms/frame in the emulator with five hidden panels).
      (obj as Object3D & { intersectChildren?: boolean }).intersectChildren = visible;
    }
    if (slot === 'carnet') this.renderCarnet();
    if (slot === 'map') this.renderMap();
    if (slot === 'report') this.renderReport();
    if (slot === 'passport') renderPassport(this.panels.get('passport-panel'));
    if (slot === 'settings') this.renderSettings(store.profile.settings);
    events.panelShown.emit(slot); // DioramaSystem: the 3D Plan de Paris on the counter
  }

  private renderCarnet(): void {
    const p = store.profile;
    const seenHere = VOCAB.filter((v) => p.wordsSeen.includes(v.id)).length;
    this.text('carnet-panel', 'carnet-count', `${seenHere} / ${VOCAB.length} mots`);
    for (let i = VOCAB.length; i < CARNET_ROWS; i++) this.style('carnet-panel', `w-${i}`, { display: 'none' });
    for (let i = 0; i < Math.min(VOCAB.length, CARNET_ROWS); i++) this.style('carnet-panel', `w-${i}`, { display: 'flex' });
    VOCAB.forEach((v, i) => {
      const seen = p.wordsSeen.includes(v.id);
      const m = mastery(p.srs[v.id]);
      this.text('carnet-panel', `w-${i}-fr`, seen ? v.fr : '? ? ?');
      this.text('carnet-panel', `w-${i}-en`, seen ? v.en : 'find it in this shop');
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

  /** Ma semaine: XP bars per day, weekly totals, trend vs last week. */
  private renderReport(): void {
    const r = store.weekReport();
    const maxXp = Math.max(30, ...r.days.map((d) => d.xp));
    r.days.forEach((d, i) => {
      const h = d.xp > 0 ? Math.max(8, Math.round((d.xp / maxXp) * 96)) : 4;
      this.style('report-panel', `bar-${i}`, { height: h, backgroundColor: d.isToday ? '#f4a261' : d.xp > 0 ? '#2a9d8f' : '#4a4c55' });
      this.text('report-panel', `bar-${i}-xp`, d.xp > 0 ? String(d.xp) : '');
      this.text('report-panel', `bar-${i}-day`, d.isToday ? "Auj." : d.label);
    });
    const t = r.totals;
    this.text('report-panel', 'stat-xp', String(t.xp));
    this.text('report-panel', 'stat-min', `${t.minutes} min`);
    this.text('report-panel', 'stat-words', String(t.newWords));
    this.text('report-panel', 'stat-orders', String(t.orders));
    this.text('report-panel', 'stat-pron', r.pronunciation === null ? '-' : `${r.pronunciation} %`);
    this.text('report-panel', 'stat-days', `${t.activeDays} / 7 · ${store.profile.streakDays} j`);
    const prev = r.lastWeek.xp;
    const trend =
      prev === 0
        ? t.xp > 0
          ? 'Great start! Every day you come back grows your streak.'
          : 'Order something today to start your week.'
        : t.xp >= prev
          ? `+${Math.round(((t.xp - prev) / prev) * 100)} % XP vs last week. Bravo !`
          : `${Math.round(((t.xp - prev) / prev) * 100)} % XP vs last week. A few minutes a day is enough.`;
    const best = r.bestDay && r.bestDay.xp > 0 ? ` Best day: ${r.bestDay.xp} XP.` : '';
    this.text('report-panel', 'week-note', `${trend}${best}`);
    // "Vraie vie": orders paid with no English and no help this week.
    const rl = t.realLifeOrders;
    const showRl = rl > 0 || store.profile.settings.realLife;
    this.style('report-panel', 'week-reallife', { display: showRl ? 'flex' : 'none' });
    if (showRl) this.text('report-panel', 'week-reallife', `Vraie vie : ${rl} commande${rl === 1 ? '' : 's'} sans aide${rl ? ' · Real-life orders, no help' : ''}`);
    renderGoals(this.panels.get('report-panel'), r.days); // A1 > A2 ladder, rest days, tomorrow's teaser
  }

  /** Shop cards: where you are, what is open, what opens next. */
  private renderMap(): void {
    for (const place of PLACE_ORDER) {
      const here = place === appState.place;
      const open = placeUnlocked(place, store.profile);
      this.text('map-panel', `place-${place}-status`, here ? 'Vous êtes ici' : open ? (this.visited.has(place) ? 'Ouvert' : 'Nouveau !') : 'Bientôt');
      this.style('map-panel', `place-${place}-status`, { backgroundColor: here ? '#9fd3c7' : open ? '#f5d90a' : '#6c757d' });
    }
    this.text('map-panel', 'map-hint', 'Pinch a shop (or look at it) to go there.');
  }

  /** "Paris" button says so while a newly opened shop has not been visited (glyphs: see fonts.ts). */
  private renderMapBadge(): void {
    this.visited.add(appState.place);
    const fresh = PLACE_ORDER.some((pl) => !this.visited.has(pl) && placeUnlocked(pl, store.profile));
    this.text('lesson-panel', 'map-label', fresh ? 'Paris !' : 'Paris');
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
    const scale = BASE_SCALE * TEXT_SCALE[s.textSize] * this.fitScale;
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
    renderPassportStrip(this.panels.get('lesson-panel'));
  }

  /** Authored height, raised when the panel is tall enough to reach below MIN_BOTTOM_Y. */
  private restY(id: string): number {
    const home = this.homeY.get(id) ?? 0;
    const min = MIN_BOTTOM_Y[id];
    const obj = this.objects.get(id);
    const size = min === undefined || !obj ? null : this.panels.get(id)?.document.computedSize;
    if (!size || !obj) return home;
    return Math.max(home, min + (size.height * UIKIT_UNIT * obj.scale.y) / 2);
  }

  /** Keep the shown panels clear of the counter as their content (and text size) changes. */
  private liftPanels(): void {
    for (const [id, obj] of this.objects) {
      if (!obj.visible || MIN_BOTTOM_Y[id] === undefined) continue;
      obj.position.y = this.restY(id);
    }
  }

  update(): void {
    if (++this.liftFrame >= LIFT_EVERY_FRAMES) {
      this.liftFrame = 0;
      this.liftPanels();
    }
    if (this.fitChecked) return;
    const forced = this.forcedLayout;
    let narrow: boolean | null = forced === 'glasses' ? true : forced === 'wide' ? false : null;
    if (narrow === null) {
      const xr = this.world.renderer.xr;
      if (!xr.isPresenting) return;
      const eyes = xr.getCamera().cameras;
      if (!eyes.length) return; // first XR frame not rendered yet
      // Widest horizontal half-angle across both eyes, from each projection matrix.
      let widest = 0;
      for (const eye of eyes) {
        const e = eye.projectionMatrix.elements;
        if (!e[0]) return;
        widest = Math.max(widest, (1 + e[8]) / e[0], (1 - e[8]) / e[0]);
      }
      narrow = widest < NARROW_TAN;
    }
    this.fitChecked = true;
    this.fitView(narrow);
  }

  /** Swing panels toward the view center (narrow) or back to the authored layout. */
  private fitView(narrow: boolean): void {
    this.fitScale = narrow ? NARROW_SCALE : 1;
    for (const [id, obj] of this.objects) {
      const base = this.basePos.get(id)!;
      const q = this.baseQuat.get(id)!;
      const target = NARROW_AZIMUTH_DEG[id];
      if (!narrow || target === undefined) {
        obj.position.x = base.x;
        obj.position.z = base.z;
        obj.quaternion.copy(q);
        continue;
      }
      const r = Math.hypot(base.x, base.z);
      const from = Math.atan2(base.x, -base.z);
      const to = (target * Math.PI) / 180;
      obj.position.x = r * Math.sin(to);
      obj.position.z = -r * Math.cos(to);
      // Keep facing the learner: yaw changes by the opposite of the azimuth change.
      obj.quaternion.copy(q).premultiply(this.yawQ.setFromAxisAngle(this.up, from - to));
    }
    this.applySettings(store.profile.settings);
  }
}
