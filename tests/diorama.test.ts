import { describe, expect, it, vi } from 'vitest';

// The model builder only needs Three's classes (see models.test.ts).
vi.mock('@iwsdk/core', async () => await import('three'));

import { Box3, type Mesh, Object3D, Vector3 } from 'three';
import {
  BOARD, dioramaPins, distanceToBox, distanceToPolyline, LABEL, LABEL_EYE, labelCentre, LANDMARKS, onBoard, PARIS_MAP, pickBox, type PickBox,
  pinColor, PIN_LOCKED, pinHeight, pinPickBoxes, pinState, pinSubtitle, placeNames, seinePoint, seineSamples, SEINE_WIDTH, segmentHitsBox,
  underBoard, type XYZ,
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
      expect(pinHeight(z)).toBeGreaterThanOrEqual(0.035);
      expect(pinHeight(z)).toBeLessThanOrEqual(0.095);
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

describe('pin pick volumes (poke and ray)', () => {
  const pins = dioramaPins(SEVEN, 'cafe', () => true);
  const boxes = pinPickBoxes(pins);
  const close = pickBox({ x: BOARD.width / 2 - 0.07, y: BOARD.surfaceY + 0.03, z: BOARD.depth / 2 - 0.012 });
  const all: { id: string; b: PickBox }[] = [...pins.map((p, i) => ({ id: p.id, b: boxes[i] })), { id: 'close', b: close }];
  const along = (b: PickBox, axis: XYZ, d: number): XYZ => ({ x: b.c.x + axis.x * d, y: b.c.y + axis.y * d, z: b.c.z + axis.z * d });
  /** Closest approach of the segment a→t to box b (sampled every 2 mm or so). */
  const clearance = (b: PickBox, a: XYZ, t: XYZ) => {
    let d = Infinity;
    for (let k = 0; k <= 600; k++) {
      const u = k / 600;
      d = Math.min(d, distanceToBox(b, a.x + (t.x - a.x) * u, a.y + (t.y - a.y) * u, a.z + (t.z - a.z) * u));
    }
    return d;
  };

  it('faces the card the same way Object3D.lookAt does, and wraps the card and the pin head', () => {
    const o = new Object3D();
    const c = labelCentre(pins[3]);
    o.position.set(c.x, c.y, c.z);
    o.lookAt(new Vector3(LABEL_EYE.x, LABEL_EYE.y, LABEL_EYE.z));
    const b = boxes[3];
    const z = new Vector3(0, 0, 1).applyQuaternion(o.quaternion);
    const x = new Vector3(1, 0, 0).applyQuaternion(o.quaternion);
    expect(z.x).toBeCloseTo(b.az.x, 6);
    expect(z.y).toBeCloseTo(b.az.y, 6);
    expect(z.z).toBeCloseTo(b.az.z, 6);
    expect(x.x).toBeCloseTo(b.ax.x, 6);
    expect(x.z).toBeCloseTo(b.ax.z, 6);
    expect(b.hx * 2).toBeGreaterThanOrEqual(LABEL.w);
    for (const [i, p] of pins.entries()) {
      const card = labelCentre(p);
      expect(distanceToBox(boxes[i], card.x, card.y, card.z), `${p.id} card`).toBe(0);
      // The side of the pin head a learner touches (towards their eyes; the head is ~1 cm in radius).
      const az = boxes[i].az;
      expect(distanceToBox(boxes[i], p.x + az.x * 0.009, BOARD.surfaceY + p.height + az.y * 0.009, p.z + az.z * 0.009), `${p.id} head`).toBe(0);
    }
  });

  it('is a thin slab: a fingertip 1.5 cm in front of a card (where the 2 cm touch radius fired) is not touching it', () => {
    for (const { id, b } of all) {
      const tip = along(b, b.az, b.hz + 0.015);
      expect(distanceToBox(b, tip.x, tip.y, tip.z), id).toBeGreaterThan(0.01);
      expect(b.hz, id).toBeLessThanOrEqual(0.01);
    }
  });

  it('no two pick volumes overlap', () => {
    // Separating-axis test for oriented boxes: the 3 + 3 face normals and their 9 cross products.
    const axes = (b: PickBox) => [b.ax, b.ay, b.az];
    const half = (b: PickBox, n: XYZ) => axes(b).reduce((s, a, k) => s + Math.abs(a.x * n.x + a.y * n.y + a.z * n.z) * [b.hx, b.hy, b.hz][k], 0);
    const separated = (a: PickBox, b: PickBox) => {
      const ns: XYZ[] = [...axes(a), ...axes(b)];
      for (const u of axes(a)) for (const v of axes(b)) ns.push({ x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x });
      return ns.some((n) => {
        if (Math.hypot(n.x, n.y, n.z) < 1e-6) return false;
        const d = Math.abs((b.c.x - a.c.x) * n.x + (b.c.y - a.c.y) * n.y + (b.c.z - a.c.z) * n.z);
        return d > half(a, n) + half(b, n);
      });
    };
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(separated(all[i].b, all[j].b), `${all[i].id} / ${all[j].id}`).toBe(true);
  });

  it("a seated learner's line of sight to each card (and so the finger that follows it) passes clear of every other pin", () => {
    // Seated eyes 1.2-1.42 m, a little left or right; the board's front edge is ~0.72 m away.
    for (const y of [1.2, 1.25, 1.3, 1.42])
      for (const x of [-0.1, 0, 0.1]) {
        const eye = { x, y: y - 1.0, z: 0.93 }; // board coordinates (DIORAMA_WORLD y 1.0, z -0.93)
        for (const [i, p] of pins.entries()) {
          const c = labelCentre(p);
          for (const t of [c, { ...c, y: c.y + LABEL.h / 4 }])
            for (const o of all) {
              if (o.id === p.id) continue;
              expect(clearance(o.b, eye, t), `eye (${x}, ${y}) to ${p.id} vs ${o.id}`).toBeGreaterThan(0.008);
            }
          // Poking straight in along the card's normal touches only this pin.
          const from = along(boxes[i], boxes[i].az, 0.06);
          const to = along(boxes[i], boxes[i].az, -0.005);
          for (const o of all) expect(segmentHitsBox(o.b, from.x, from.y, from.z, to.x, to.y, to.z), `${p.id} poke vs ${o.id}`).toBe(o.id === p.id);
        }
      }
  });

  it('segmentHitsBox: through, ending inside, short of it, beside it, parallel inside a face', () => {
    const b = boxes[0];
    const p = (d: number, side = 0) => {
      const q = along(b, b.az, d);
      return [q.x + b.ax.x * side, q.y + b.ax.y * side, q.z + b.ax.z * side] as const;
    };
    expect(segmentHitsBox(b, ...p(0.05), ...p(-0.05))).toBe(true); // straight through
    expect(segmentHitsBox(b, ...p(0.05), ...p(0.002))).toBe(true); // ends inside
    expect(segmentHitsBox(b, ...p(0.05), ...p(0.015))).toBe(false); // stops short
    expect(segmentHitsBox(b, ...p(0.05, 0.08), ...p(-0.05, 0.08))).toBe(false); // passes beside
    expect(segmentHitsBox(b, ...p(0.005, -0.03), ...p(0.005, 0.03))).toBe(true); // slides along inside
    expect(segmentHitsBox(b, ...p(0.02, -0.03), ...p(0.02, 0.03))).toBe(false); // slides along in front
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
