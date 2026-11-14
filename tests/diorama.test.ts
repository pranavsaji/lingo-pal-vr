import { describe, expect, it, vi } from 'vitest';

// The model builder only needs Three's classes (see models.test.ts).
vi.mock('@iwsdk/core', async () => await import('three'));

import { Box3, type Mesh } from 'three';
import {
  BOARD, dioramaPins, distanceToPolyline, LANDMARKS, onBoard, PARIS_MAP, pinColor, PIN_LOCKED, pinHeight, pinState,
  pinSubtitle, placeNames, seinePoint, seineSamples, SEINE_WIDTH, underBoard,
} from '../src/places/paris-map';
import { buildParisDiorama } from '../src/models/paris-diorama';
import { TRAY, dishPos } from '../src/layout';

const SEVEN = ['cafe', 'boulangerie', 'marche', 'bistrot', 'metro', 'pharmacie', 'hotel'];

describe('Plan de Paris layout', () => {
  it('has a spot for all seven places, on the board, clear of the river and landmarks', () => {
    const river = seineSamples(96);
    for (const id of SEVEN) {
      const p = PARIS_MAP[id];
      expect(p, id).toBeDefined();
      expect(onBoard(p, 0.03), id).toBe(true);
      expect(distanceToPolyline(p, river), id).toBeGreaterThan(SEINE_WIDTH / 2 + 0.015);
      for (const l of Object.values(LANDMARKS)) expect(Math.hypot(p.x - l.x, p.z - l.z), `${id} vs landmark`).toBeGreaterThan(0.04);
    }
  });

  it('keeps pins far enough apart to be separate targets (labels are 11 cm wide)', () => {
    for (let i = 0; i < SEVEN.length; i++)
      for (let j = i + 1; j < SEVEN.length; j++) {
        const a = PARIS_MAP[SEVEN[i]];
        const b = PARIS_MAP[SEVEN[j]];
        const dx = Math.abs(a.x - b.x);
        const dz = Math.abs(a.z - b.z);
        // Side by side needs a label width; one behind the other needs a clear depth step.
        expect(dx > 0.115 || dz > 0.06, `${SEVEN[i]} / ${SEVEN[j]}`).toBe(true);
      }
  });

  it('stands back pins taller than front pins, within reach', () => {
    expect(pinHeight(-BOARD.depth / 2)).toBeGreaterThan(pinHeight(BOARD.depth / 2));
    for (const z of [-0.3, -0.1, 0, 0.1, 0.3]) {
      expect(pinHeight(z)).toBeGreaterThanOrEqual(0.045);
      expect(pinHeight(z)).toBeLessThanOrEqual(0.08);
    }
  });

  it('samples the Seine from east to west without allocating', () => {
    const out = { x: 0, z: 0 };
    expect(seinePoint(0, out)).toBe(out);
    expect(out.x).toBeGreaterThan(BOARD.width / 2);
    seinePoint(1, out);
    expect(out.x).toBeLessThan(-BOARD.width / 2);
    seinePoint(0.5, out);
    expect(Math.abs(out.z)).toBeLessThan(0.08); // it crosses the middle of town
  });

  it('clears only what is under the board: the tray yes, the coin dish no', () => {
    expect(underBoard(TRAY[0], TRAY[2])).toBe(true);
    for (const left of [false, true]) {
      const d = dishPos(left);
      expect(underBoard(d[0], d[2])).toBe(false);
    }
  });
});

describe('pin state', () => {
  it('marks here, open and locked', () => {
    expect(pinState('cafe', 'cafe', true)).toBe('here');
    expect(pinState('marche', 'cafe', true)).toBe('open');
    expect(pinState('marche', 'cafe', false)).toBe('locked');
    expect(pinColor('marche', 'locked')).toBe(PIN_LOCKED);
    expect(pinColor('marche', 'open')).not.toBe(PIN_LOCKED);
  });

  it('shows only places in the order that have a spot, in order, with names and stamps', () => {
    const pins = dioramaPins(['cafe', 'atlantis', 'marche', 'boulangerie'], 'marche', (id) => id !== 'boulangerie', { cafe: '2026-11-10' });
    expect(pins.map((p) => p.id)).toEqual(['cafe', 'marche', 'boulangerie']);
    expect(pins.map((p) => p.state)).toEqual(['open', 'here', 'locked']);
    expect(pins[0].stamped).toBe(true);
    expect(pins[1].stamped).toBe(false);
    expect(pins[0].fr).toBe(placeNames('cafe').fr);
    expect(pins[0].height).toBeCloseTo(pinHeight(PARIS_MAP.cafe.z));
  });

  it('works for places shared/places.json does not know yet', () => {
    expect(placeNames('hotel').fr.length).toBeGreaterThan(0);
    const pins = dioramaPins(SEVEN, 'cafe', () => true);
    expect(pins).toHaveLength(7);
  });

  it('captions follow the subtitles setting; locked pins say how to open them', () => {
    const hint = { fr: 'Après le tutoriel', en: 'Opens after the tutorial' };
    expect(pinSubtitle({ state: 'open', en: 'The Market' }, hint, true)).toBe('The Market');
    expect(pinSubtitle({ state: 'open', en: 'The Market' }, hint, false)).toBe('');
    expect(pinSubtitle({ state: 'locked', en: 'The Market' }, hint, true)).toBe(hint.en);
    expect(pinSubtitle({ state: 'locked', en: 'The Market' }, hint, false)).toBe(hint.fr);
    expect(pinSubtitle({ state: 'here', en: 'x' }, hint, false)).toBe('Vous êtes ici');
  });
});

describe('Paris diorama model', () => {
  const root = buildParisDiorama();
  it('is two meshes (two draw calls) within the triangle budget', () => {
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes.map((m) => m.name).sort()).toEqual(['Land', 'Seine']);
    const tris = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0);
    expect(tris).toBeLessThan(40000);
    expect(tris).toBeGreaterThan(3000);
    for (const m of meshes) expect(m.castShadow).toBe(false);
  });

  it('fits the board footprint, rests on y = 0, stays low enough to see over', () => {
    root.updateMatrixWorld(true);
    const b = new Box3().setFromObject(root);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(b.max.y).toBeLessThan(0.18);
    expect(b.min.x).toBeGreaterThan(-BOARD.width / 2 - 0.01);
    expect(b.max.x).toBeLessThan(BOARD.width / 2 + 0.01);
    expect(b.min.z).toBeGreaterThan(-BOARD.depth / 2 - 0.01);
    expect(b.max.z).toBeLessThan(BOARD.depth / 2 + 0.01);
  });

  it('is built once (the manifest prototype and the system share it)', () => {
    expect(buildParisDiorama()).toBe(root);
    expect(root.parent).toBeNull();
  });
});
