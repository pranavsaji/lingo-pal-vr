/**
 * Visible growth between sessions (Reason to Come Back): the streak candle on
 * the counter burns brighter each day in a row, and unlocks physically appear
 * in the cafe (string lights, plants, the chalkboard with today's special,
 * a gramophone). Newly earned decor pops in with a chime the moment it unlocks.
 * Later milestones reach every shop: lanterns over the back counter (5 days in
 * a row), a stamp board showing the Passeport de Paris (4 stamps), flowers in
 * the bakery and string lights at the market (3 orders there). Decor earned
 * since the last visit pops in a moment after arrival ("Bon retour !").
 */

import { createSystem, type Group } from '@iwsdk/core';
import { menuItem, priceToDigits } from '../agent/menu.js';
import { dailySpecial } from '../agent/scenarios.js';
import { definite } from '../agent/script.js';
import { appState, events, type PlaceId } from '../game-state.js';
import { FLAME } from '../layout.js';
import { buildChalkboard, buildGramophone, buildPlant, buildStreakFlame, buildStringLights } from '../models/cafe-models.js';
import { STAMPS } from '../state/passport.js';
import { store } from '../state/store.js';

interface DecorPiece {
  unlock: string;
  root: Group;
  baseScale: number;
  popStart: number; // -1 when settled
  /** The shop it stands in. */
  place: PlaceId;
}

const POP_SECONDS = 0.6;
/** New decor since the last visit pops in this long after arrival. */
const ARRIVAL_POP_AT = 2.5;

export class DecorSystem extends createSystem({}) {
  private pieces: DecorPiece[] = [];
  private flame!: ReturnType<typeof buildStreakFlame>;
  private board!: ReturnType<typeof buildChalkboard>;
  private stampBoard!: ReturnType<typeof buildChalkboard>;
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

    // Longer-arc milestones (see UNLOCKS in src/state/progression.ts).
    const lanterns = buildStringLights();
    lanterns.position.set(0, 2.65, -2.35);
    lanterns.scale.setScalar(0.9);
    this.add('lanternes', lanterns, 'Back Lanterns');

    this.stampBoard = buildChalkboard('Passeport');
    this.stampBoard.root.position.set(1.55, 1.25, -2.5); // mirrors the plat du jour board
    this.stampBoard.root.rotation.y = -0.25;
    this.add('mur-tampons', this.stampBoard.root, 'Stamp Board');
    this.renderStampBoard();

    for (const [x, z] of [[-2.05, -1.95], [2.05, -1.95]] as const) {
      const plant = buildPlant();
      plant.position.set(x, 0, z);
      this.add('fleurs-boulangerie', plant, 'Bakery Plant', 'boulangerie');
    }
    const marketLights = buildStringLights();
    marketLights.position.set(0, 2.42, -1.55);
    this.add('guirlandes-marche', marketLights, 'Market Lights', 'marche');
    const bistroLights = buildStringLights();
    bistroLights.position.set(0, 2.42, -1.55);
    this.add('guirlandes-bistrot', bistroLights, 'Bistro Lights', 'bistrot');
    for (const [id, place, name] of [['plantes-metro', 'metro', 'Metro Plant'], ['fleurs-pharmacie', 'pharmacie', 'Pharmacy Plant']] as const) {
      for (const [x, z] of [[-2.05, -1.95], [2.05, -1.95]] as const) {
        const plant = buildPlant();
        plant.position.set(x, 0, z);
        this.add(id, plant, name, place);
      }
    }

    // Decor earned since the last visit (streak, stamps): pop it in shortly after arrival.
    for (const id of store.arrival?.newUnlocks ?? []) {
      for (const p of this.pieces) {
        if (p.unlock !== id || !p.root.visible || store.profile.settings.reduceMotion) continue;
        p.popStart = ARRIVAL_POP_AT;
        p.root.scale.setScalar(p.baseScale * 0.01);
      }
    }

    this.cleanupFuncs.push(
      events.unlocked.on((id) => this.reveal(id)),
      // Each piece belongs to its shop: hidden in the others (the streak candle travels with you).
      events.place.on((place) => {
        for (const p of this.pieces) p.root.visible = place === p.place && store.profile.unlocks.includes(p.unlock);
      }),
      events.stamp.on(() => this.renderStampBoard()),
      events.profile.on((p) => this.flame.setLevel(p.streakDays)),
    );
  }

  private add(unlock: string, root: Group, name: string, place: PlaceId = 'cafe'): void {
    root.name = name;
    root.traverse((o) => (o.castShadow = false)); // decor sits at the edges: no shadow-pass cost
    root.visible = appState.place === place && store.profile.unlocks.includes(unlock);
    this.world.createTransformEntity(root);
    this.pieces.push({ unlock, root, baseScale: root.scale.x, popStart: -1, place });
  }

  private reveal(id: string): void {
    for (const p of this.pieces) {
      if (p.unlock !== id || p.root.visible || appState.place !== p.place) continue;
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

  /** The stamp board: the learner's passport, chalked up in the cafe. */
  private renderStampBoard(): void {
    const p = store.profile;
    const n = STAMPS.filter((s) => p.passport.stamps[s.id]).length;
    this.stampBoard.setLines([
      `${n} / ${STAMPS.length} tampons`,
      `Série : ${p.streakDays} jour${p.streakDays === 1 ? '' : 's'}`,
      p.name ? `Bravo, ${p.name} !` : 'Bravo !',
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
