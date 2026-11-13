/**
 * Eyes-only navigation (Accessibility Forward): when "Selection du regard" is
 * on, the target nearest the center of the learner's view (within its cone)
 * fills a ring for 1 second and is then activated. Works without eye tracking
 * (head gaze) and without hands or controllers. Zero per-frame allocations.
 */

import { createSystem, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, CircleGeometry, Vector3 } from '@iwsdk/core';
import { events } from '../game-state.js';
import { store } from '../state/store.js';
import { dwellFocus, dwellShown, dwellTargets, dwellWorldPosition, type DwellTarget } from './dwell.js';

const DWELL_SECONDS = 1.0;
const SCOPED_DWELL_SECONDS = 1.6;
const COOLDOWN_SECONDS = 0.8;
/**
 * After an activation the view must move this far before the next dwell can
 * start, so a panel swapping under a resting gaze does not chain-select the
 * button that appears there (or re-open what was just closed).
 */
const REARM_DEG = 6;

export class DwellSystem extends createSystem({}) {
  private enabled = false;
  private candidate: DwellTarget | null = null;
  private since = 0;
  private cooldownUntil = 0;
  private t = 0;
  private ring!: Mesh;
  private fill!: Mesh;
  private head!: Vector3;
  private fwd!: Vector3;
  private to!: Vector3;
  private armFwd!: Vector3;
  private armed = true;

  init(): void {
    this.head = new Vector3();
    this.fwd = new Vector3();
    this.to = new Vector3();
    this.armFwd = new Vector3();
    const mat = new MeshBasicMaterial({ color: 0xf5d90a, transparent: true, opacity: 0.95, depthTest: false, side: DoubleSide });
    this.ring = new Mesh(new RingGeometry(0.016, 0.021, 32), mat);
    this.fill = new Mesh(new CircleGeometry(0.016, 32), new MeshBasicMaterial({ color: 0xf5d90a, transparent: true, opacity: 0.45, depthTest: false, side: DoubleSide }));
    this.ring.renderOrder = 1000;
    this.fill.renderOrder = 1000;
    this.ring.add(this.fill);
    this.ring.visible = false;
    this.ring.name = 'Dwell Reticle';
    this.world.createTransformEntity(this.ring);
    this.enabled = store.profile.settings.gazeDwell;
    this.applyContrast(store.profile.settings.highContrast);
    this.cleanupFuncs.push(
      events.settings.on((s) => {
        this.enabled = s.gazeDwell;
        if (!s.gazeDwell) this.ring.visible = false;
        this.applyContrast(s.highContrast);
      }),
    );
  }

  /** High contrast: a solid white reticle (readable over any surface, no colour needed). */
  private applyContrast(on: boolean): void {
    const ring = this.ring.material as MeshBasicMaterial;
    const fill = this.fill.material as MeshBasicMaterial;
    ring.color.setHex(on ? 0xffffff : 0xf5d90a);
    fill.color.setHex(on ? 0xffffff : 0xf5d90a);
    ring.opacity = on ? 1 : 0.95;
    fill.opacity = on ? 0.75 : 0.45;
  }

  update(delta: number): void {
    this.t += delta;
    const scope = dwellFocus.only;
    if (!this.enabled && !scope) {
      this.ring.visible = false;
      return;
    }
    const headObj = this.player.head;
    headObj.getWorldPosition(this.head);
    this.fwd.set(0, 0, -1).transformDirection(headObj.matrixWorld);
    if (!this.armed) {
      const moved = (Math.acos(Math.min(1, this.fwd.dot(this.armFwd))) * 180) / Math.PI;
      if (moved < REARM_DEG) {
        this.ring.visible = false;
        return;
      }
      this.armed = true;
      this.candidate = null;
    }

    // Nearest target to the view center, inside its cone, and visible.
    let best: DwellTarget | null = null;
    let bestAngle = Infinity;
    for (const target of dwellTargets) {
      if (scope && !scope.has(target.obj)) continue;
      if (target.when && !target.when()) continue;
      if (!dwellShown(target.obj)) continue;
      dwellWorldPosition(target.obj, this.to);
      this.to.sub(this.head);
      const dist = this.to.length();
      if (dist < 0.1 || dist > 6) continue;
      const angle = (Math.acos(Math.min(1, this.to.dot(this.fwd) / dist)) * 180) / Math.PI;
      if (angle < target.coneDeg && angle < bestAngle) {
        best = target;
        bestAngle = angle;
      }
    }

    if (best !== this.candidate) {
      this.candidate = best;
      this.since = this.t;
    }
    if (!best || this.t < this.cooldownUntil) {
      this.ring.visible = false;
      return;
    }

    // A scoped dwell (the first-launch choice, dwell setting off) takes a little longer, so reading is not choosing.
    const p = Math.min(1, (this.t - this.since) / (this.enabled ? DWELL_SECONDS : SCOPED_DWELL_SECONDS));
    dwellWorldPosition(best.obj, this.to);
    // Reticle slightly in front of the target, facing the learner.
    this.ring.position.copy(this.to).lerp(this.head, 0.04);
    this.ring.lookAt(this.head);
    this.fill.scale.setScalar(Math.max(0.01, p));
    this.ring.visible = true;
    if (p >= 1) {
      this.cooldownUntil = this.t + COOLDOWN_SECONDS;
      this.candidate = null;
      this.armed = false;
      this.armFwd.copy(this.fwd);
      this.ring.visible = false;
      best.fn();
    }
  }
}
