import { describe, expect, it } from 'vitest';
import { DISPLAY_FRONT_Z, dishPos, FLAME, MAP_YAW, mapPropPos, palPos } from '../src/layout';
import { MAP_D, MAP_PANEL_W } from '../src/models/map-props';

/** World XZ corners of the folded map's footprint (it is turned MAP_YAW toward the seat). */
function corners(leftHanded: boolean): [number, number][] {
  const [x, , z] = mapPropPos(leftHanded);
  const yaw = x < 0 ? MAP_YAW : -MAP_YAW;
  const hw = (MAP_PANEL_W * 3) / 2;
  const hd = MAP_D / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)]);
}

describe('the folded Plan de Paris on the counter', () => {
  for (const leftHanded of [false, true]) {
    const mode = leftHanded ? 'left-hand mode' : 'right-hand mode';
    const pts = corners(leftHanded);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);

    it(`${mode}: lies on the counter top, in front of the display stand`, () => {
      expect(Math.min(...zs)).toBeGreaterThan(DISPLAY_FRONT_Z); // not under the stand
      expect(Math.max(...zs)).toBeLessThan(-0.66); // not over the front edge
      expect(Math.min(...xs)).toBeGreaterThan(-1.1);
      expect(Math.max(...xs)).toBeLessThan(1.1);
    });

    it(`${mode}: clear of the Plan de Paris board, Pal, the candle and the money dish`, () => {
      const near = Math.min(...xs.map(Math.abs));
      expect(near).toBeGreaterThan(0.31 + 0.05); // the board spans |x| <= 0.31
      const gap = (p: readonly number[], r: number) => xs.every((x) => Math.abs(x - p[0]) > r) || zs.every((z) => Math.abs(z - p[2]) > r);
      expect(gap(palPos(leftHanded), 0.09)).toBe(true);
      expect(gap(FLAME, 0.05)).toBe(true);
      expect(gap(dishPos(leftHanded), 0.105)).toBe(true);
    });
  }
});
