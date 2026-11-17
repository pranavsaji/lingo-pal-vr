/**
 * In-world ways to open the Plan de Paris, besides the "Paris" button on the home panel:
 *  - a folded paper map on every counter (front edge, on Pal's side): poke it, pinch it
 *    with a hand ray, or look at it in eyes mode;
 *  - at the métro, the "Plan du métro" poster on a tiled pillar left of the ticket window
 *    (out of reach from the seat: hand ray or gaze).
 * Either one opens the map (the tabletop board in XR, the 2D map panel outside XR); the
 * folded map closes it again when it is already open. The poster wall is set dressing:
 * hidden in mixed reality with the rest of the room.
 *
 * Cost: two pick proxies (never drawn), the folded map (3 small planes, one texture) and,
 * at the métro only, the wall (4 meshes). No per-frame work except a hover ease.
 */

import { BoxGeometry, createSystem, type Entity, Group, Hovered, Mesh, MeshBasicMaterial, PokeInteractable, Pressed, RayInteractable } from '@iwsdk/core';
import { appState, events, type PlaceId } from '../game-state.js';
import { MAP_YAW, mapPropPos } from '../layout.js';
import { buildFoldedMap, buildMetroPosterWall, MAP_D, MAP_PANEL_W, POSTER_H, POSTER_W } from '../models/map-props.js';
import { store } from '../state/store.js';
import { addDwellTarget } from '../ui/dwell.js';

/**
 * The pillar, facing the seat about 63 degrees to the left: clear of the home panel (which
 * covers up to ~52 degrees from the seat), the window post and the left side table.
 */
export const POSTER_PILLAR: readonly [number, number] = [-1.69, -0.86];
const POSTER_Y = 1.45;

export class MapPropsSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
  hovered: { required: [RayInteractable, Hovered] },
}) {
  private fold!: Group;
  private foldPick: Entity | null = null;
  private posterWall!: Group;
  private posterPick: Entity | null = null;
  private mapOpen = false;
  private foldHover = 0;
  private foldHoverTarget = 0;

  init(): void {
    // The folded map, a pick box around it (rays, fingers and gaze find it).
    this.fold = buildFoldedMap();
    const foldEntity = this.world.createTransformEntity(this.fold, { persistent: true });
    const box = new Mesh(new BoxGeometry(MAP_PANEL_W * 3 + 0.02, 0.06, MAP_D + 0.02), new MeshBasicMaterial({ visible: false }));
    box.name = 'Folded Map Pick';
    box.position.y = 0.025;
    this.foldPick = this.world.createTransformEntity(box, { parent: foldEntity });
    this.foldPick.addComponent(RayInteractable);
    this.foldPick.addComponent(PokeInteractable);
    this.cleanupFuncs.push(addDwellTarget(box, () => this.toggleMap(), 4, () => this.fold.visible));
    this.placeFold();

    // The métro poster pillar: the outer group carries the mixed-reality tag (MixedRealitySystem
    // shows/hides it with the room), the wall itself follows the current place.
    const outer = new Group();
    outer.name = 'Metro Poster (room)';
    outer.userData.mrHide = true;
    const outerEntity = this.world.createTransformEntity(outer, { persistent: true });
    const { root, poster } = buildMetroPosterWall(POSTER_Y);
    root.position.set(POSTER_PILLAR[0], 0, POSTER_PILLAR[1]);
    root.rotation.y = Math.atan2(-POSTER_PILLAR[0], -POSTER_PILLAR[1]); // faces the seat
    this.posterWall = root;
    const wallEntity = this.world.createTransformEntity(root, { parent: outerEntity });
    const pick = new Mesh(new BoxGeometry(POSTER_W + 0.04, POSTER_H + 0.04, 0.04), new MeshBasicMaterial({ visible: false }));
    pick.name = 'Metro Poster Pick';
    pick.position.copy(poster.position);
    this.posterPick = this.world.createTransformEntity(pick, { parent: wallEntity });
    this.posterPick.addComponent(RayInteractable);
    this.cleanupFuncs.push(addDwellTarget(pick, () => this.openMap(), 4, () => this.posterWall.visible));
    this.showPoster(appState.place);

    this.queries.pressed.subscribe('qualify', (e) => {
      if (e === this.foldPick) this.toggleMap();
      else if (e === this.posterPick) this.openMap();
    });
    this.queries.hovered.subscribe('qualify', (e) => {
      if (e === this.foldPick) this.foldHoverTarget = 1;
    });
    this.queries.hovered.subscribe('disqualify', (e) => {
      if (e === this.foldPick) this.foldHoverTarget = 0;
    });
    this.cleanupFuncs.push(
      // What is actually showing (panel buttons switch slots without an openPanel request).
      events.panelShown.on((slot) => {
        this.mapOpen = slot === 'map';
      }),
      events.place.on((place) => {
        this.mapOpen = false;
        this.showPoster(place);
      }),
      events.settings.on(() => this.placeFold()),
    );
  }

  update(delta: number): void {
    if (this.foldHover === this.foldHoverTarget) return;
    const step = Math.min(1, delta * 10);
    this.foldHover += (this.foldHoverTarget - this.foldHover) * step;
    if (Math.abs(this.foldHover - this.foldHoverTarget) < 0.01) this.foldHover = this.foldHoverTarget;
    const s = 1 + this.foldHover * 0.08;
    this.fold.scale.set(s, s, s);
    this.fold.position.y = mapPropPos(store.profile.settings.leftHanded)[1] + this.foldHover * 0.012;
  }

  /** On Pal's side of the counter's front edge. */
  private placeFold(): void {
    const [x, y, z] = mapPropPos(store.profile.settings.leftHanded);
    this.fold.position.set(x, y, z);
    // +Z toward the seat (the title band on the far side reads upright), turned a little toward it.
    this.fold.rotation.y = x < 0 ? MAP_YAW : -MAP_YAW;
  }

  private showPoster(place: PlaceId): void {
    this.posterWall.visible = place === 'metro';
  }

  private openMap(): void {
    events.openPanel.emit('map');
  }

  private toggleMap(): void {
    events.openPanel.emit(this.mapOpen ? 'home' : 'map');
  }
}
