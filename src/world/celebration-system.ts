/**
 * Confetti bursts for payoffs: an order paid, a level up, a finished tutorial.
 * One InstancedMesh, simulated in preallocated arrays (no per-frame allocation).
 * Respects "reduce motion".
 */

import { createSystem, type InstancedMesh, Object3D } from '@iwsdk/core';
import { events } from '../game-state.js';
import { buildConfettiBurst } from '../models/cafe-models.js';
import { store } from '../state/store.js';

const COUNT = 60;
const LIFE = 2.2;
const ORIGIN: [number, number, number] = [0.05, 1.2, -0.95];

export class CelebrationSystem extends createSystem({}) {
  private mesh!: InstancedMesh;
  private pos = new Float32Array(COUNT * 3);
  private vel = new Float32Array(COUNT * 3);
  private spin = new Float32Array(COUNT * 3);
  private age = LIFE;
  private dummy!: Object3D;
  private lastPhase = '';

  init(): void {
    this.dummy = new Object3D();
    const burst = buildConfettiBurst(COUNT);
    this.mesh = burst.mesh;
    burst.root.name = 'Confetti';
    burst.root.visible = false;
    this.world.createTransformEntity(burst.root);
    this.mesh.frustumCulled = false;

    this.cleanupFuncs.push(
      events.order.on((o) => {
        if (o.phase === 'paid' && this.lastPhase !== 'paid') this.burst();
        this.lastPhase = o.phase;
      }),
      events.xp.on(({ levelUp }) => {
        if (levelUp) this.burst();
      }),
      events.celebrate.on(() => this.burst()),
      events.stamp.on(() => this.burst()), // a new passport stamp
    );
  }

  burst(): void {
    if (store.profile.settings.reduceMotion) return;
    this.age = 0;
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 1.6 + Math.random() * 1.4;
      const out = 0.4 + Math.random() * 0.8;
      this.pos[i * 3] = ORIGIN[0];
      this.pos[i * 3 + 1] = ORIGIN[1];
      this.pos[i * 3 + 2] = ORIGIN[2];
      this.vel[i * 3] = Math.cos(a) * out;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = Math.sin(a) * out + 0.5; // toward the learner
      this.spin[i * 3] = Math.random() * 10;
      this.spin[i * 3 + 1] = Math.random() * 10;
      this.spin[i * 3 + 2] = Math.random() * 10;
    }
    this.mesh.parent!.visible = true;
  }

  update(delta: number): void {
    if (this.age >= LIFE) return;
    this.age += delta;
    if (this.age >= LIFE) {
      this.mesh.parent!.visible = false;
      return;
    }
    const drag = Math.exp(-delta * 1.6);
    const fade = Math.min(1, (LIFE - this.age) * 2);
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - 3.2 * delta; // gentle gravity (paper flutters)
      this.pos[j] += this.vel[j] * delta;
      this.pos[j + 1] += this.vel[j + 1] * delta;
      this.pos[j + 2] += this.vel[j + 2] * delta;
      this.dummy.position.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.dummy.rotation.set(this.spin[j] * this.age, this.spin[j + 1] * this.age, this.spin[j + 2] * this.age);
      this.dummy.scale.setScalar(fade);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
