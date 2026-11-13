import { describe, expect, it } from 'vitest';
import { parseIntent } from '../src/agent/intent.js';
import {
  closestEdgePoint,
  COUNTER_FRONT,
  DEFAULT_TABLE_Y,
  fallbackRig,
  placeAtPoint,
  placeOnTable,
  type PlaneInfo,
  pointInPolygon,
  polygonArea,
  quaternionOfYaw,
  rayToSurface,
  rigApply,
  rigFor,
  selectTable,
  yawOfQuaternion,
} from '../src/world/mr-placement.js';

/** Axis-aligned rectangle outline (x0..x1, z0..z1), counter-clockwise or clockwise. */
function rect(x0: number, z0: number, x1: number, z1: number, cw = false) {
  const pts = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ];
  return cw ? pts.reverse() : pts;
}

function plane(label: string, y: number, poly = rect(-0.6, -1.2, 0.6, -0.5), normalY = 1): PlaneInfo {
  return { label, y, normalY, polygon: poly };
}

const head = { x: 0, z: 0 };

describe('polygon helpers', () => {
  it('measures area and containment', () => {
    const r = rect(0, 0, 2, 1);
    expect(polygonArea(r)).toBeCloseTo(2);
    expect(pointInPolygon(1, 0.5, r)).toBe(true);
    expect(pointInPolygon(3, 0.5, r)).toBe(false);
  });

  it('finds the closest edge and its outward normal for either winding', () => {
    for (const cw of [false, true]) {
      const e = closestEdgePoint(0, 0, rect(-0.6, -1.2, 0.6, -0.5, cw));
      expect(e).not.toBeNull();
      expect(e!.x).toBeCloseTo(0);
      expect(e!.z).toBeCloseTo(-0.5);
      expect(e!.dist).toBeCloseTo(0.5);
      // Outward normal of the near edge points at the learner (+z).
      expect(e!.nx).toBeCloseTo(0);
      expect(e!.nz).toBeCloseTo(1);
    }
  });

  it('reports distance 0 inside the outline', () => {
    expect(closestEdgePoint(0, -0.8, rect(-0.6, -1.2, 0.6, -0.5))!.dist).toBe(0);
  });
});

describe('selectTable', () => {
  it('prefers a plane labelled table or desk, nearest first', () => {
    const far = plane('table', 0.75, rect(-0.5, -3, 0.5, -2.2));
    const near = plane('desk', 0.72);
    const shelf = plane('other', 0.8, rect(-0.3, -0.4, 0.3, -0.3));
    const found = selectTable([far, shelf, near], head);
    expect(found?.plane).toBe(near);
    expect(found?.reason).toBe('label');
  });

  it('falls back to the nearest horizontal surface at table height', () => {
    const floor = plane('floor', 0, rect(-3, -3, 3, 3));
    const couch = plane('couch', 0.45);
    const low = plane('', 0.3);
    const counter = plane('other', 0.9, rect(-0.5, -1.5, 0.5, -0.9));
    const found = selectTable([floor, couch, low, counter], head);
    expect(found?.plane).toBe(counter);
    expect(found?.reason).toBe('height');
  });

  it('ignores walls, tilted planes, slivers and far surfaces', () => {
    const wall = plane('wall_face', 0.8, rect(-1, -2, 1, -1.9), 0);
    const tilted = plane('', 0.8, undefined, 0.5);
    const sliver = plane('', 0.8, rect(-0.1, -0.6, 0.1, -0.55));
    const far = plane('table', 0.75, rect(-0.5, -6, 0.5, -5));
    expect(selectTable([wall, tilted, sliver, far], head)).toBeNull();
  });

  it('prefers the table in front of the learner over a nearer one behind', () => {
    const coffee = plane('table', 0.5, rect(0.8, 0.8, 1.6, 1.6)); // behind-right, ~1.1 m
    const desk = plane('desk', 0.73, rect(-0.8, -2.4, 0.8, -1.7)); // ahead, 1.7 m
    expect(selectTable([coffee, desk], head)?.plane).toBe(coffee); // no facing known: nearest
    expect(selectTable([coffee, desk], head, { x: 0, z: -1 })?.plane).toBe(desk);
  });

  it('returns null with no room data (emulator, no room setup)', () => {
    expect(selectTable([], head)).toBeNull();
  });
});

describe('placeOnTable', () => {
  it('puts the counter front on the near edge, square to it, at table height', () => {
    const p = placeOnTable(plane('table', 0.73), head);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(-0.5);
    expect(p.y).toBeCloseTo(0.73);
    expect(p.yaw).toBeCloseTo(0); // facing +z: the learner
  });

  it('squares to a table edge the learner sits at an angle to', () => {
    // Learner slightly to the side of the table's near edge: still square to the edge.
    const p = placeOnTable(plane('table', 0.73), { x: 0.3, z: 0 });
    expect(p.yaw).toBeCloseTo(0);
  });

  it('squares to the side the learner sits at, or faces them off a corner', () => {
    // Closest point is the corner (0.6, -0.5) of the right-hand edge.
    const side = placeOnTable(plane('table', 0.73), { x: 2, z: 0 });
    expect(side.x).toBeCloseTo(0.6);
    expect(side.z).toBeCloseTo(-0.5);
    expect(side.yaw).toBeCloseTo(Math.PI / 2); // within 45 degrees: square to the right edge
    const corner = placeOnTable(plane('table', 0.73), { x: 2, z: 0 }, 0.2);
    expect(corner.yaw).toBeCloseTo(Math.atan2(2 - 0.6, 0.5)); // facing the learner
  });

  it('handles a table to the learner\'s right (turned 90 degrees)', () => {
    const p = placeOnTable(plane('desk', 0.75, rect(0.5, -0.6, 1.3, 0.6)), head);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.z).toBeCloseTo(0);
    expect(p.yaw).toBeCloseTo(-Math.PI / 2); // facing -x, back at the learner
  });
});

describe('rigFor', () => {
  it('maps the real placement onto the virtual counter front', () => {
    const cases = [
      { x: 0, y: 0.74, z: -0.66, yaw: 0 },
      { x: 0.5, y: 0.75, z: 0, yaw: -Math.PI / 2 },
      { x: -1.2, y: 0.9, z: 2.3, yaw: 2.1 },
    ];
    for (const p of cases) {
      const rig = rigFor(p);
      const front = rigApply(rig, p);
      expect(front.x).toBeCloseTo(COUNTER_FRONT.x);
      expect(front.y).toBeCloseTo(COUNTER_FRONT.y);
      expect(front.z).toBeCloseTo(COUNTER_FRONT.z);
      // A point 1 m toward the learner from the placement lands 1 m toward +z in the cafe.
      const toward = rigApply(rig, { x: p.x + Math.sin(p.yaw), y: p.y, z: p.z + Math.cos(p.yaw) });
      expect(toward.x).toBeCloseTo(COUNTER_FRONT.x);
      expect(toward.z).toBeCloseTo(COUNTER_FRONT.z + 1);
    }
  });

  it('a table straight ahead needs no turn, only the old lift', () => {
    const rig = rigFor({ x: 0, y: DEFAULT_TABLE_Y, z: COUNTER_FRONT.z, yaw: 0 });
    expect(rig).toEqual(expect.objectContaining({ x: 0, z: 0, yaw: -0 }));
    expect(rig.y).toBeCloseTo(fallbackRig().y);
    expect(fallbackRig().y).toBeCloseTo(0.26);
  });
});

describe('anchors: yaw <-> quaternion', () => {
  it('round-trips', () => {
    for (const yaw of [0, 0.7, -2.5, Math.PI / 2]) {
      const q = quaternionOfYaw(yaw);
      expect(yawOfQuaternion(q.x, q.y, q.z, q.w)).toBeCloseTo(yaw);
    }
  });
});

describe('rayToSurface (placement reticle)', () => {
  const origin = { x: 0, y: 1.2, z: 0 };
  const down = (z: number) => {
    const d = { x: 0, y: -1.2 + 0.73, z };
    const len = Math.hypot(d.x, d.y, d.z);
    return { x: d.x / len, y: d.y / len, z: d.z / len };
  };

  it('hits a detected table inside its outline', () => {
    const hit = rayToSurface(origin, down(-0.8), [plane('table', 0.73)], 0.74);
    expect(hit?.kind).toBe('plane');
    expect(hit?.y).toBeCloseTo(0.73);
    expect(hit?.z).toBeCloseTo(-0.8);
  });

  it('falls back to the assumed table height off the outline or with no planes', () => {
    const hit = rayToSurface(origin, down(-2), [plane('table', 0.73)], 0.74);
    expect(hit?.kind).toBe('height');
    expect(hit?.y).toBeCloseTo(0.74);
  });

  it('rejects rays pointing up or too far', () => {
    expect(rayToSurface(origin, { x: 0, y: 0.2, z: -1 }, [], 0.74)).toBeNull();
    expect(rayToSurface(origin, { x: 0, y: -0.01, z: -1 }, [], 0.74)).toBeNull();
  });

  it('writes into a reused hit object', () => {
    const out = { x: 0, y: 0, z: 0, kind: 'height' as const };
    const hit = rayToSurface(origin, down(-0.8), [], 0.74, { ...out });
    const again = rayToSurface(origin, down(-0.9), [], 0.74, hit!);
    expect(again).toBe(hit);
  });

  it('a pointed spot faces the learner', () => {
    const p = placeAtPoint({ x: 1, y: 0.74, z: -1 }, head);
    expect(p.yaw).toBeCloseTo(Math.atan2(-1, 1));
  });
});

describe('voice', () => {
  it('"placer le café" opens the placement reticle', () => {
    expect(parseIntent('Placer le café')).toEqual({ kind: 'command', command: 'place' });
    expect(parseIntent('déplacez le comptoir')).toEqual({ kind: 'command', command: 'place' });
  });

  it('ordering a café is not a placement', () => {
    expect(parseIntent('un café s\'il vous plaît').kind).not.toBe('command');
  });
});
