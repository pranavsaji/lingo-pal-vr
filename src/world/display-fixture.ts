/**
 * The shop's display stand: the goods for sale stand on it, raised off the
 * counter and behind the strip at the learner's edge where the order is served.
 * Each shop dresses it like the real thing: a glass pastry case in the café and
 * the boulangerie, wooden produce crates at the market, a steel ticket rack at
 * the métro, a white product rack at the pharmacie, dark wood at the bistrot and
 * the hotel desk.
 *
 * Two groups, each merged to a few draw calls: the outer ends, and the middle
 * (under the Plan de Paris board), which the diorama hides while the board is open
 * (`userData.displayStand`).
 */

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import type { PlaceId } from '../game-state.js';
import { COUNTER_Y, DISPLAY_FRONT_Z, DISPLAY_LIFT, DISPLAY_SEGMENTS } from '../layout.js';
import { mergeStaticMeshes } from './static-merge.js';

interface DisplayStyle {
  body: number;
  top: number;
  /** Glass case over the stand between these x (food shops). */
  glass?: [number, number];
  /** Slats on the front face (market crates). */
  slats?: number;
  /** A low back panel behind the goods (pharmacie and métro racks). */
  backPanel?: number;
  roughness: number;
  metalness?: number;
}

const STYLES: Record<PlaceId, DisplayStyle> = {
  // The café's bottle of water stands outside the case, on the right end of the stand.
  cafe: { body: 0x4a2f1d, top: 0xeee8dc, glass: [-1.07, 0.66], roughness: 0.4 },
  boulangerie: { body: 0x7a4f2e, top: 0xf3ead8, glass: [-1.07, 0.97], roughness: 0.45 },
  marche: { body: 0x9a6a3d, top: 0xa77a4b, slats: 0x5e3f24, roughness: 0.8 },
  bistrot: { body: 0x2e2320, top: 0xe8e2d8, roughness: 0.3 },
  metro: { body: 0x8d969e, top: 0xb9c0c6, backPanel: 0x8d969e, roughness: 0.35, metalness: 0.6 },
  pharmacie: { body: 0xf2f2ef, top: 0xfbfbf9, backPanel: 0xf2f2ef, roughness: 0.4 },
  hotel: { body: 0x3a2418, top: 0x4b2e1f, roughness: 0.5 },
};

const GLASS_H = 0.17;
const BACK_PANEL_H = 0.16;

function box(w: number, h: number, d: number, m: MeshStandardMaterial, x: number, y: number, z: number, shadows = true): Mesh {
  const out = new Mesh(new BoxGeometry(w, h, d), m);
  out.position.set(x, y, z);
  out.castShadow = shadows;
  out.receiveShadow = true;
  return out;
}

/** The middle segments lie under the Plan de Paris board (|x| <= 0.31 plus margin). */
const underMap = (x0: number, x1: number) => (x0 + x1) / 2 > -0.3 && (x0 + x1) / 2 < 0.3;

export function buildDisplayStand(place: PlaceId, accent: number): Group[] {
  const st = STYLES[place];
  const body = new MeshStandardMaterial({ color: st.body, roughness: st.roughness, metalness: st.metalness ?? 0 });
  const top = new MeshStandardMaterial({ color: st.top, roughness: Math.min(0.9, st.roughness), metalness: st.metalness ?? 0 });
  const trim = new MeshStandardMaterial({ color: accent, metalness: 0.85, roughness: 0.3 });
  const slat = st.slats !== undefined ? new MeshStandardMaterial({ color: st.slats, roughness: 0.85 }) : null;
  const panel = st.backPanel !== undefined ? new MeshStandardMaterial({ color: st.backPanel, roughness: st.roughness, metalness: st.metalness ?? 0 }) : null;
  const glass = st.glass
    ? new MeshStandardMaterial({ color: 0xe8f6ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false })
    : null;
  const brass = new MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.3 });

  const outer = new Group();
  outer.name = 'Display Stand';
  const middle = new Group();
  middle.name = 'Display Stand (map)';
  middle.userData.displayStand = true;
  // The middle group's origin sits under the board so the diorama's position test finds it.
  middle.position.set(0, COUNTER_Y, -0.93);
  outer.position.set(0, COUNTER_Y, -0.93);

  const y0 = 0; // counter top, in group space
  const h = DISPLAY_LIFT;
  const zl = (z: number) => z + 0.93; // world z -> group z
  for (const [x0, x1, back] of DISPLAY_SEGMENTS) {
    const g = underMap(x0, x1) ? middle : outer;
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    const d = DISPLAY_FRONT_Z - back;
    const cz = zl((DISPLAY_FRONT_Z + back) / 2);
    g.add(box(w, h - 0.008, d, body, cx, y0 + (h - 0.008) / 2, cz));
    g.add(box(w, 0.008, d + 0.004, top, cx, y0 + h - 0.004, cz));
    // The shop's colour along the front edge.
    g.add(box(w, 0.012, 0.006, trim, cx, y0 + h - 0.014, zl(DISPLAY_FRONT_Z) + 0.002 + 0.003, false));
    if (slat) for (const sy of [0.012, 0.024]) g.add(box(w, 0.004, 0.004, slat, cx, y0 + sy, zl(DISPLAY_FRONT_Z) + 0.004, false));
    if (panel) g.add(box(w, BACK_PANEL_H, 0.012, panel, cx, y0 + h + BACK_PANEL_H / 2, zl(back) + 0.006, false));
    if (glass && st.glass) {
      const gx0 = Math.max(x0, st.glass[0]);
      const gx1 = Math.min(x1, st.glass[1]);
      if (gx1 > gx0) {
        const gw = gx1 - gx0;
        const gcx = (gx0 + gx1) / 2;
        // Front pane, top pane (open at the back, on the shopkeeper's side, like a real vitrine).
        g.add(box(gw, GLASS_H, 0.004, glass, gcx, y0 + h + GLASS_H / 2, zl(DISPLAY_FRONT_Z) + 0.004, false));
        g.add(box(gw, 0.004, d, glass, gcx, y0 + h + GLASS_H, cz, false));
        g.add(box(gw, 0.008, 0.008, brass, gcx, y0 + h + GLASS_H, zl(DISPLAY_FRONT_Z) + 0.004, false));
        for (const ex of [st.glass[0], st.glass[1]]) {
          if (ex < x0 - 1e-6 || ex > x1 + 1e-6) continue;
          g.add(box(0.004, GLASS_H, d, glass, ex, y0 + h + GLASS_H / 2, cz, false));
          g.add(box(0.008, GLASS_H, 0.008, brass, ex, y0 + h + GLASS_H / 2, zl(DISPLAY_FRONT_Z) + 0.004, false));
        }
      }
    }
  }
  // Transparent glass renders after the goods inside it (three's transparent pass).
  for (const g of [outer, middle]) mergeStaticMeshes(g);
  return [outer, middle];
}
