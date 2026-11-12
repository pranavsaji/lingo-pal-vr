/**
 * Mixed reality: "the cafe on your real table". In a passthrough (immersive-ar)
 * session, IWSDK already makes the background transparent; here we hide the
 * virtual room (walls, shelves, awning, floor, counter cabinet) and lower the
 * counter top to real table height, so Madame Lune serves you in your own room.
 *
 * Switching modes needs a new XR session: toggling the setting while immersed
 * exits and relaunches in the other mode.
 */

import { createSystem, type Object3D, SessionMode, VisibilityState } from '@iwsdk/core';
import { events } from '../game-state.js';
import { store } from '../state/store.js';

/** Counter top is 1.0 m; a typical table is ~0.74 m. Raising the rig lowers the world. */
const TABLE_LIFT = 0.26;

export function preferredSessionMode(): SessionMode {
  return store.profile.settings.mixedReality ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR;
}

export class MixedRealitySystem extends createSystem({}) {
  private roomParts: Object3D[] = [];
  private ar = false;
  private relaunch = false;
  private lastSetting = store.profile.settings.mixedReality;

  init(): void {
    this.cleanupFuncs.push(
      events.settings.on((s) => {
        if (s.mixedReality === this.lastSetting) return;
        this.lastSetting = s.mixedReality;
        if (this.world.xrSession) {
          this.relaunch = true;
          this.world.exitXR();
        }
      }),
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.NonImmersive && this.relaunch) {
          this.relaunch = false;
          // Best effort: some browsers require a fresh click; the panel button covers that case.
          setTimeout(() => {
            try {
              this.world.launchXR({ sessionMode: preferredSessionMode() });
            } catch {
              // fall back to the Enter button
            }
          }, 300);
        }
      }),
    );
  }

  private collect(): void {
    if (this.roomParts.length) return;
    this.world.scene.traverse((o) => {
      if (o.userData.mrHide) this.roomParts.push(o);
    });
    const floor = this.world.getSceneObject<Object3D>('studio-floor');
    if (floor) this.roomParts.push(floor);
  }

  private apply(ar: boolean): void {
    this.ar = ar;
    this.collect();
    for (const o of this.roomParts) o.visible = !ar;
    this.player.position.y = ar ? TABLE_LIFT : 0;
  }

  update(): void {
    const mode = this.world.xrSession?.environmentBlendMode;
    const ar = mode === 'alpha-blend' || mode === 'additive';
    if (ar !== this.ar) this.apply(ar);
  }
}
