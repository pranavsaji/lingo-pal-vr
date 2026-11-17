/**
 * In-world ways to open the Plan de Paris (MapPropsSystem):
 *  - a folded paper map of Paris lying on every counter (accordion, three panels);
 *  - at the métro, a "Plan du métro" poster on a tiled pillar left of the ticket window.
 * Base of the folded map at y = 0 (it lies on the counter), +Z toward the learner.
 * Canvas faces; without a DOM (tests, editor realm) they fall back to plain colours.
 */

import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from '@iwsdk/core';
import { makeCanvasTexture, makeRandom } from './model-kit.js';

const FONT = 'Arial, Helvetica, sans-serif';
const NAVY = '#1f4e8c';

/** Folded map footprint (metres): three panels across x, `MAP_D` deep. */
export const MAP_PANEL_W = 0.09;
export const MAP_D = 0.14;
const TILT = 0.3; // rad: the zigzag of the folds

/** The map face: Paris with the Seine, parks, streets, the tower and seven pins. */
function drawParis(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#f7efdb';
  c.fillRect(0, 0, w, h);
  const band = h * 0.22;
  // Streets: a loose grid with two diagonals.
  c.strokeStyle = '#d6b45e';
  c.lineWidth = 7;
  for (let x = 30; x < w; x += 58) {
    c.beginPath();
    c.moveTo(x, band);
    c.lineTo(x + 18, h);
    c.stroke();
  }
  for (let y = band + 30; y < h; y += 52) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y - 14);
    c.stroke();
  }
  c.lineWidth = 11;
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(w * 0.55, band);
  c.moveTo(w * 0.35, band);
  c.lineTo(w, h * 0.9);
  c.stroke();
  // Parks.
  c.fillStyle = '#6fbf5a';
  c.fillRect(w * 0.06, h * 0.6, w * 0.17, h * 0.24);
  c.beginPath();
  c.ellipse(w * 0.78, h * 0.36, w * 0.09, h * 0.1, 0.3, 0, Math.PI * 2);
  c.fill();
  // La Seine.
  c.strokeStyle = '#3f86c6';
  c.lineWidth = 34;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(-10, h * 0.55);
  c.bezierCurveTo(w * 0.25, h * 0.85, w * 0.45, h * 0.35, w * 0.65, h * 0.55);
  c.bezierCurveTo(w * 0.8, h * 0.7, w * 0.9, h * 0.5, w + 10, h * 0.62);
  c.stroke();
  // The tower.
  const tx = w * 0.27;
  const ty = h * 0.58;
  c.strokeStyle = '#3a3b40';
  c.lineWidth = 8;
  c.beginPath();
  c.moveTo(tx - 28, ty + 46);
  c.lineTo(tx, ty - 56);
  c.lineTo(tx + 28, ty + 46);
  c.moveTo(tx - 15, ty + 6);
  c.lineTo(tx + 15, ty + 6);
  c.stroke();
  // Seven pins (the seven places), one per colour.
  const rand = makeRandom(7);
  const pins = ['#c0392b', '#e2b857', '#2a9d48', '#3d6fb6', '#9b5de5', '#f28c28', '#2fbf5a'];
  for (const col of pins) {
    const x = w * (0.1 + rand() * 0.8);
    const y = band + 26 + rand() * (h - band - 52);
    c.fillStyle = col;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(x, y, 20, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  // Title band (the far edge, readable from the learner's seat).
  c.fillStyle = NAVY;
  c.fillRect(0, 0, w, band);
  c.fillStyle = '#e2b857';
  c.fillRect(0, band - 6, w, 6);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(band * 0.62)}px ${FONT}`;
  c.fillText('PLAN DE PARIS', w / 2, band * 0.52);
  // Fold creases.
  c.strokeStyle = 'rgba(80, 60, 30, 0.25)';
  c.lineWidth = 3;
  for (const f of [1 / 3, 2 / 3]) {
    c.beginPath();
    c.moveTo(w * f, 0);
    c.lineTo(w * f, h);
    c.stroke();
  }
}

/**
 * The folded map: three accordion panels (one canvas across all of them). About 0.27 x 0.14 m (a real folded street map), 2.5 cm high at the folds.
 */
export function buildFoldedMap(): Group {
  const g = new Group();
  g.name = 'Folded Paris Map';
  const ct = makeCanvasTexture(1024, 536);
  if (ct) drawParis(ct.ctx, ct.canvas.width, ct.canvas.height);
  const face = new MeshStandardMaterial({ color: ct ? 0xffffff : 0xf4ecd8, map: ct?.tex ?? null, roughness: 0.85, side: DoubleSide });
  const lift = Math.sin(TILT) * MAP_PANEL_W;
  for (let i = 0; i < 3; i++) {
    const geo = new PlaneGeometry(MAP_PANEL_W, MAP_D);
    // This panel's third of the canvas.
    const uv = geo.getAttribute('uv');
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
    uv.needsUpdate = true;
    const m = new Mesh(geo, face);
    m.name = `Map Panel ${i}`;
    // Zigzag: panels 0 and 2 rise to the right, panel 1 falls.
    const up = i % 2 === 0;
    m.rotation.order = 'ZXY';
    m.rotation.set(-Math.PI / 2, 0, up ? TILT : -TILT);
    m.position.set((i - 1) * MAP_PANEL_W * Math.cos(TILT), 0.002 + lift / 2, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** The network poster: a made-up métro map (no real line names). Portrait or landscape. */
function drawNetwork(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#f7f4ea';
  c.fillRect(0, 0, w, h);
  const band = h * 0.11;
  c.strokeStyle = '#9fc6e0';
  c.lineWidth = 14;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(0, h * 0.6);
  c.bezierCurveTo(w * 0.3, h * 0.48, w * 0.55, h * 0.78, w, h * 0.58);
  c.stroke();
  const rand = makeRandom(21);
  const colors = ['#2a9d48', '#f2c230', '#d1495b', '#3d6fb6', '#9b5de5', '#f28c28'];
  c.lineJoin = 'round';
  for (const col of colors) {
    c.strokeStyle = col;
    c.lineWidth = 9;
    c.beginPath();
    let x = rand() * w * 0.2;
    let y = band + 30 + rand() * (h * 0.78 - band);
    c.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += w * (0.18 + rand() * 0.1);
      y = Math.min(h * 0.86, Math.max(band + 24, y + (rand() - 0.5) * h * 0.35));
      c.lineTo(x, y);
    }
    c.stroke();
  }
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#2b2d33';
  c.lineWidth = 4;
  for (let k = 0; k < 16; k++) {
    c.beginPath();
    c.arc(w * (0.08 + rand() * 0.84), band + 24 + rand() * (h * 0.86 - band - 24), 8, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  c.fillStyle = NAVY;
  c.fillRect(0, 0, w, band);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(band * 0.5)}px ${FONT}`;
  c.fillText('PLAN DU MÉTRO', w / 2, band * 0.52);
  // The hint strip: what pinching it does.
  c.fillStyle = NAVY;
  c.fillRect(0, h * 0.9, w, h * 0.1);
  c.fillStyle = '#e2b857';
  c.font = `bold ${Math.round(h * 0.042)}px ${FONT}`;
  c.fillText('Pincez : le Plan de Paris', w / 2, h * 0.95);
}

/** White bevelled métro tiles with grey grout. */
function drawTiles(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.fillStyle = '#c9c7c0';
  c.fillRect(0, 0, w, h);
  const tw = w / 4;
  const th = tw / 2;
  for (let row = 0, y = 0; y < h; row++, y += th) {
    for (let x = row % 2 ? -tw / 2 : 0; x < w; x += tw) {
      const grad = c.createLinearGradient(x, y, x, y + th);
      grad.addColorStop(0, '#fbfaf6');
      grad.addColorStop(1, '#e6e3db');
      c.fillStyle = grad;
      c.fillRect(x + 2, y + 2, tw - 4, th - 4);
    }
  }
}

export const POSTER_W = 0.5;
export const POSTER_H = 0.7;
const WALL_W = 0.7;
const WALL_H = 2.15;

/**
 * A free-standing tiled pillar with its framed poster. Origin at the
 * wall's foot, centred; the poster faces +Z with its centre `posterY` above the floor.
 * Returns the group and the poster mesh (the pick target).
 */
export function buildMetroPosterWall(posterY: number): { root: Group; poster: Mesh } {
  const root = new Group();
  root.name = 'Metro Poster Wall';
  const tiles = makeCanvasTexture(256, 768);
  if (tiles) drawTiles(tiles.ctx, tiles.canvas.width, tiles.canvas.height);
  const wall = new Mesh(new BoxGeometry(WALL_W, WALL_H, 0.04), new MeshStandardMaterial({ color: tiles ? 0xffffff : 0xf3f1ea, map: tiles?.tex ?? null, roughness: 0.35 }));
  wall.name = 'Tiled Wall';
  wall.position.y = WALL_H / 2;
  wall.receiveShadow = true;
  root.add(wall);
  const trim = new MeshStandardMaterial({ color: 0x1f4e8c, metalness: 0.2, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const edge = new Mesh(new BoxGeometry(0.03, WALL_H, 0.05), trim);
    edge.name = 'Pillar Edge';
    edge.position.set((side * WALL_W) / 2, WALL_H / 2, 0);
    root.add(edge);
  }
  const frame = new Mesh(new BoxGeometry(POSTER_W + 0.04, POSTER_H + 0.04, 0.012), trim);
  frame.name = 'Poster Frame';
  frame.position.set(0, posterY, 0.026);
  root.add(frame);
  const ct = makeCanvasTexture(512, 717);
  if (ct) drawNetwork(ct.ctx, ct.canvas.width, ct.canvas.height);
  const poster = new Mesh(new PlaneGeometry(POSTER_W, POSTER_H), new MeshStandardMaterial({ color: ct ? 0xffffff : 0xf7f4ea, map: ct?.tex ?? null, roughness: 0.5 }));
  poster.name = 'Plan du Metro Poster';
  poster.position.set(0, posterY, 0.0335);
  root.add(poster);
  return { root, poster };
}
