import { describe, expect, it } from 'vitest';
import { menuFor } from '../src/agent/menu';
import type { PlaceId } from '../src/game-state';
import { counterKeepOuts } from '../src/layout';
import { copyCapacity, layoutServed, NARROW_X, rectsOverlap, SERVE_AREA, type Rect, type ServeGroupIn } from '../src/serve-layout';
import { PLACE_VOCAB } from '../src/vocab';
import { MEASURED } from './serve-fixture';

const PLACES = Object.keys(MEASURED) as PlaceId[];
const COUNTER: Rect = { x0: -1.15, x1: 1.15, z0: -1.24, z1: -0.66 };

function keepOuts(place: PlaceId, leftHanded = false): Rect[] {
  const rects = MEASURED[place].rects.map(([x0, x1, z0, z1]) => ({ x0, x1, z0, z1 }));
  // Display goods are measured for the right-handed counter; they do not move with left-hand mode.
  return [...counterKeepOuts(leftHanded), ...rects];
}

function menuGroups(place: PlaceId): ((qty: number) => ServeGroupIn)[] {
  const fp = MEASURED[place].fp;
  return menuFor(place)
    .filter((m) => fp[m.id])
    .map((m) => (qty: number) => ({ id: m.id, qty, w: fp[m.id][0], d: fp[m.id][1], h: fp[m.id][2] }));
}

/** Every copy's footprint, rebuilt from the layout (copy center +- half the scaled footprint). */
function copyRects(groups: ServeGroupIn[], place: PlaceId, leftHanded = false) {
  const { placed, hidden } = layoutServed(groups, keepOuts(place, leftHanded));
  const rects: { id: string; r: Rect }[] = [];
  for (const g of placed) {
    const src = groups.find((x) => x.id === g.id)!;
    const w = (src.w * g.scale) / 2;
    const d = (src.d * g.scale) / 2;
    for (const c of g.copies) rects.push({ id: g.id, r: { x0: c.x - w, x1: c.x + w, z0: c.z - d, z1: c.z + d } });
    // Copies stay inside their group's rectangle.
    for (const c of g.copies) {
      expect(c.x - w).toBeGreaterThanOrEqual(g.rect.x0 - 1e-6);
      expect(c.x + w).toBeLessThanOrEqual(g.rect.x1 + 1e-6);
      expect(c.z - d).toBeGreaterThanOrEqual(g.rect.z0 - 1e-6);
      expect(c.z + d).toBeLessThanOrEqual(g.rect.z1 + 1e-6);
    }
    expect(g.shown).toBeGreaterThanOrEqual(1);
    expect(g.shown).toBeLessThanOrEqual(g.qty);
    expect(g.badge).toBe(g.shown < g.qty);
  }
  return { placed, hidden, rects };
}

function assertClear(groups: ServeGroupIn[], place: PlaceId, leftHanded = false) {
  const out = copyRects(groups, place, leftHanded);
  const ko = keepOuts(place, leftHanded);
  for (const { id, r } of out.rects) {
    // On the counter, at its learner edge.
    expect(r.x0, id).toBeGreaterThanOrEqual(COUNTER.x0);
    expect(r.x1, id).toBeLessThanOrEqual(COUNTER.x1);
    expect(r.z1, id).toBeLessThanOrEqual(COUNTER.z1);
    expect(r.z0, id).toBeGreaterThanOrEqual(SERVE_AREA.backZ);
    for (const k of ko) expect(rectsOverlap(r, k), `${place}: ${id} hits keep-out ${JSON.stringify(k)}`).toBe(false);
  }
  for (let i = 0; i < out.placed.length; i++)
    for (let j = i + 1; j < out.placed.length; j++)
      expect(rectsOverlap(out.placed[i].rect, out.placed[j].rect), `${out.placed[i].id} / ${out.placed[j].id}`).toBe(false);
  return out;
}

function combos<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of combos(xs.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}

describe('served goods on the counter', () => {
  it('measures every menu item of every shop', () => {
    for (const place of PLACES) expect(menuGroups(place).length, place).toBe(menuFor(place).length);
  });

  it('every item in quantities 1 to 5 stays clear of the register, tray, money, Pal, candle and display goods', () => {
    for (const place of PLACES)
      for (const make of menuGroups(place))
        for (let q = 1; q <= 5; q++) {
          const { hidden, placed } = assertClear([make(q)], place);
          expect(hidden).toEqual([]);
          // A single line is drawn at full size, with at least two copies when two were ordered.
          expect(placed[0].scale).toBe(1);
          if (q >= 2) expect(placed[0].shown, `${place} ${placed[0].id} x${q}`).toBeGreaterThanOrEqual(Math.min(2, copyCapacity(make(q))));
        }
  });

  it('mixed orders of 2 to 4 different goods all show, clear of everything and of each other', () => {
    for (const place of PLACES) {
      const makes = menuGroups(place);
      for (const k of [2, 3, 4]) {
        for (const pick of combos(makes, Math.min(k, makes.length))) {
          for (const qtys of [[1, 1, 1, 1], [5, 5, 5, 5], [2, 5, 1, 3], [3, 1, 4, 2]]) {
            const { hidden } = assertClear(pick.map((m, i) => m(qtys[i])), place);
            expect(hidden, `${place} ${pick.map((m) => m(1).id)}`).toEqual([]);
          }
        }
      }
    }
  }, 30_000);

  it('worst case (every menu item x5) never overlaps; at most a line or two cannot be set down', () => {
    for (const place of PLACES) {
      const { hidden } = assertClear(menuGroups(place).map((m) => m(5)), place);
      expect(hidden.length, place).toBeLessThanOrEqual(1);
    }
  });

  it('left-hand mode (dish and Pal mirrored) keeps the same guarantees', () => {
    for (const place of PLACES) {
      const makes = menuGroups(place);
      for (const pick of combos(makes, Math.min(3, makes.length))) assertClear(pick.map((m) => m(5)), place, true);
    }
  });

  it('Meta VR Glasses: a one-item order stays inside the 37-degree view, clear of everything', () => {
    let inside = 0;
    let total = 0;
    for (const place of PLACES)
      for (const make of menuGroups(place))
        for (const q of [1, 3]) {
          const { placed, hidden } = layoutServed([make(q)], keepOuts(place), true);
          expect(hidden).toEqual([]);
          // Plates 20 cm deep (cake, plat du jour, crepe) do not fit between the display goods
          // and the edge in the middle; they go to the side, full size, rather than shrink.
          if (make(q).d >= 0.2) continue;
          total++;
          if (placed[0].rect.x0 >= -NARROW_X && placed[0].rect.x1 <= NARROW_X) inside++;
          for (const k of keepOuts(place)) expect(rectsOverlap(placed[0].rect, k)).toBe(false);
        }
    // Every other single-item order fits in front of the learner (the center gap between Pal and the money).
    expect(inside).toBe(total);
  });

  it('paper-flat goods stack instead of spreading', () => {
    const { placed } = layoutServed([{ id: 'ticket', qty: 4, w: 0.17, d: 0.11, h: 0.01 }], counterKeepOuts(false));
    expect(placed[0].shown).toBe(4);
    expect(new Set(placed[0].copies.map((c) => c.x)).size).toBe(1);
    expect(placed[0].copies[3].y).toBeGreaterThan(placed[0].copies[0].y);
  });

  it('display goods stay off the register and the payment tray', () => {
    const [register, tray] = counterKeepOuts(false);
    for (const place of PLACES)
      for (const v of PLACE_VOCAB[place]) {
        if (v.position[1] < 0.9) continue;
        const r = 0.085; // the widest round goods (tart, cake plate) are 16-21 cm across
        const rect = { x0: v.position[0] - r, x1: v.position[0] + r, z0: v.position[2] - r, z1: v.position[2] + r };
        expect(rectsOverlap(rect, register), `${place} ${v.id}`).toBe(false);
        expect(rectsOverlap(rect, tray), `${place} ${v.id}`).toBe(false);
      }
  });
});
