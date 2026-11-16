import { describe, expect, it } from 'vitest';
import { menuFor } from '../src/agent/menu';
import type { PlaceId } from '../src/game-state';
import { counterKeepOuts, displayStandRects } from '../src/layout';
import { layoutOrder, rectsOverlap, SERVE_AREA, type Rect, type ServeGroupIn } from '../src/serve-layout';
import { MEASURED } from './serve-fixture';

const PLACES = Object.keys(MEASURED) as PlaceId[];
const COUNTER: Rect = { x0: -1.15, x1: 1.15, z0: -1.24, z1: -0.66 };
const keepOuts = (left = false) => [...counterKeepOuts(left), ...displayStandRects()];

function line(place: PlaceId, id: string, qty: number): ServeGroupIn {
  const f = MEASURED[place].fp[id];
  return { id, qty, w: f[0], d: f[1], h: f[2] };
}

function check(groups: ServeGroupIn[], left = false) {
  const out = layoutOrder(groups, keepOuts(left));
  const trays = out.trays ?? [];
  expect(trays.length).toBeGreaterThan(0);
  for (const t of trays) {
    expect(t.x0).toBeGreaterThanOrEqual(COUNTER.x0);
    expect(t.x1).toBeLessThanOrEqual(COUNTER.x1);
    expect(t.z1).toBeLessThanOrEqual(COUNTER.z1);
    for (const k of keepOuts(left)) expect(rectsOverlap(t, k), `tray ${JSON.stringify(t)} hits ${JSON.stringify(k)}`).toBe(false);
  }
  for (let i = 0; i < trays.length; i++) for (let j = i + 1; j < trays.length; j++) expect(rectsOverlap(trays[i], trays[j])).toBe(false);
  // Every group sits on a tray (or its mat), and every copy stands above the counter on it.
  for (const g of out.placed) {
    expect(trays.some((t) => g.rect.x0 >= t.x0 - 1e-6 && g.rect.x1 <= t.x1 + 1e-6 && g.rect.z0 >= t.z0 - 1e-6 && g.rect.z1 <= t.z1 + 1e-6), g.id).toBe(true);
    for (const c of g.copies) expect(c.y).toBeGreaterThan(0);
  }
  return out;
}

describe('the order on a tray', () => {
  it('every item in quantities 1 to 5 lands on a tray or mat, clear of the stand, money, Pal and register', () => {
    for (const place of PLACES)
      for (const m of menuFor(place)) {
        if (!MEASURED[place].fp[m.id]) continue;
        for (let q = 1; q <= 5; q++) {
          const out = check([line(place, m.id, q)]);
          expect(out.hidden, `${place} ${m.id} x${q}`).toEqual([]);
        }
      }
  });

  it('a typical order (one or two goods, one or two of each) comes on ONE tray in every shop', () => {
    const typical: Record<PlaceId, [string, number][][]> = {
      cafe: [[['croissant', 2]], [['croissant', 2], ['cafe', 1]], [['pomme', 1], ['orange', 2]]],
      boulangerie: [[['baguette', 1]], [['croissant', 2], ['pain_chocolat', 1]], [['macaron', 3]]],
      marche: [[['pomme', 3], ['kiwi', 2]], [['citron', 2]], [['poire', 1], ['oignon', 2]]],
      bistrot: [[['plat_du_jour', 1]], [['salade', 1], ['jus_orange', 1]]],
      metro: [[['carnet', 1]], [['ticket', 2], ['plan_metro', 1]]],
      pharmacie: [[['paracetamol', 1]], [['mouchoirs', 2], ['sirop', 1]]],
      hotel: [[['nuit', 2]], [['nuit', 2], ['petit_dejeuner', 1]]],
    };
    for (const place of PLACES)
      for (const order of typical[place]) {
        const out = check(order.map(([id, q]) => line(place, id, q)));
        expect(out.oneTray, `${place} ${JSON.stringify(order)}`).toBe(true);
        expect(out.trays?.length, `${place} ${JSON.stringify(order)}`).toBe(1);
        expect(out.placed.every((p) => !p.badge), `${place} ${JSON.stringify(order)}: every copy shown`).toBe(true);
      }
  });

  it('a big order spreads over two trays rather than across the counter', () => {
    const out = check([line('boulangerie', 'baguette', 1), line('boulangerie', 'croissant', 2), line('boulangerie', 'macaron', 3)]);
    expect(out.oneTray).toBe(true);
    expect(out.trays?.length).toBe(2);
  });

  it('left-hand mode keeps the same guarantees', () => {
    for (const place of PLACES) check([line(place, Object.keys(MEASURED[place].fp)[0], 2)], true);
  });

  it('trays sit at the learner edge, in front of the display stand', () => {
    const out = check([line('cafe', 'croissant', 2)]);
    for (const t of out.trays ?? []) {
      expect(t.z1).toBeCloseTo(SERVE_AREA.frontZ, 5);
      for (const s of displayStandRects()) expect(t.z0).toBeGreaterThan(s.z1);
    }
  });
});
