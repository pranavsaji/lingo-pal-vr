/**
 * Visible growth between sessions (Reason to Come Back): the streak candle on
 * the counter burns brighter each day in a row, and unlocks physically appear
 * in the cafe (string lights, plants, the chalkboard with today's special,
 * a gramophone). Newly earned decor pops in with a chime the moment it unlocks.
 */

import { createSystem, type Group } from '@iwsdk/core';
import { menuItem, priceToDigits } from '../agent/menu.js';
import { dailySpecial } from '../agent/scenarios.js';
import { definite } from '../agent/script.js';
import { appState, events } from '../game-state.js';
import { FLAME } from '../layout.js';
import { buildChalkboard, buildGramophone, buildPlant, buildStreakFlame, buildStringLights } from '../models/cafe-models.js';
import { store } from '../state/store.js';

interface DecorPiece {
  unlock: string;
  root: Group;
  baseScale: number;
  popStart: number; // -1 when settled
}

const POP_SECONDS = 0.6;

export class DecorSystem extends createSystem({}) {
  private pieces: DecorPiece[] = [];
  private flame!: ReturnType<typeof buildStreakFlame>;
  private board!: ReturnType<typeof buildChalkboard>;
  private t = 0;

  init(): void {
    this.flame = buildStreakFlame();
    this.flame.root.position.set(...FLAME);
    this.flame.root.name = 'Streak Flame';
    this.world.createTransformEntity(this.flame.root);
    this.flame.setLevel(store.profile.streakDays);

    const lights = buildStringLights();
    lights.position.set(0, 2.42, -1.55);
    this.add('string-lights', lights, 'String Lights');

    for (const [x, z, s] of [[-2.05, -1.95, 1], [2.05, -1.95, 1.1]] as const) {
      const plant = buildPlant();
      plant.position.set(x, 0, z);
      plant.scale.setScalar(s);
      this.add('plants', plant, 'Plant');
    }
    for (const [x, z] of [[-2.15, -0.2], [2.15, -0.25]] as const) {
      const plant = buildPlant();
      plant.position.set(x, 0, z);
      plant.scale.setScalar(1.25);
      this.add('terrasse', plant, 'Terrace Plant');
    }

    this.board = buildChalkboard();
    this.board.root.position.set(-1.55, 1.25, -2.5);
    this.board.root.rotation.y = 0.25;
    this.add('chalkboard', this.board.root, 'Chalkboard');
    this.renderBoard();

    const gramophone = buildGramophone();
    gramophone.position.set(-1.0, 1.0, -1.17);
    gramophone.rotation.y = 0.5;
    this.add('gramophone', gramophone, 'Gramophone');

    this.cleanupFuncs.push(
      events.unlocked.on((id) => this.reveal(id)),
      // Cafe decor belongs to the cafe: hidden in the other shops (the streak candle travels with you).
      events.place.on((place) => {
        for (const p of this.pieces) p.root.visible = place === 'cafe' && store.profile.unlocks.includes(p.unlock);
      }),
      events.profile.on((p) => this.flame.setLevel(p.streakDays)),
    );
  }

  private add(unlock: string, root: Group, name: string): void {
    root.name = name;
    root.traverse((o) => (o.castShadow = false)); // decor sits at the edges: no shadow-pass cost
    root.visible = store.profile.unlocks.includes(unlock);
    this.world.createTransformEntity(root);
    this.pieces.push({ unlock, root, baseScale: root.scale.x, popStart: -1 });
  }

  private reveal(id: string): void {
    for (const p of this.pieces) {
      if (p.unlock !== id || p.root.visible || appState.place !== 'cafe') continue;
      p.root.visible = true;
      p.popStart = store.profile.settings.reduceMotion ? -1 : this.t;
      if (p.popStart >= 0) p.root.scale.multiplyScalar(0.01);
    }
  }

  private renderBoard(): void {
    const sp = dailySpecial(store.today, store.profile.unlocks, 'cafe'); // the chalkboard hangs in the cafe
    const item = menuItem(sp.item.id);
    this.board.setLines([
      'Plat du jour',
      item ? `${definite(item)}  ${priceToDigits(item.priceCents)}` : '',
      sp.challenge.fr,
      `Série : ${store.profile.streakDays} jour${store.profile.streakDays === 1 ? '' : 's'}`,
    ]);
  }

  update(delta: number): void {
    this.t += delta;
    for (const p of this.pieces) {
      if (p.popStart < 0) continue;
      const u = (this.t - p.popStart) / POP_SECONDS;
      const target = p.baseScale;
      if (u >= 1) {
        p.root.scale.setScalar(target);
        p.popStart = -1;
      } else {
        const k = 1.70158;
        const v = u - 1;
        p.root.scale.setScalar(target * Math.max(0.01, 1 + (k + 1) * v * v * v + k * v * v));
      }
    }
  }
}
