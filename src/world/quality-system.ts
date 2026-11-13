/**
 * Visual clarity in the headset. three.js defaults to maximum fixed foveation
 * (the edges of each eye render at reduced resolution, which is exactly where
 * the two text panels sit) and a 1.0 framebuffer scale (below the Quest 3's
 * native panel resolution). This system:
 *  - raises the framebuffer scale per device class before a session starts;
 *  - starts with light foveation for sharp side panels;
 *  - watches frame time in XR and raises foveation step by step if frames drop
 *    (then relaxes it again when there is headroom), so clarity never costs
 *    a stutter.
 * URL overrides for testing: ?res=1.5 (framebuffer scale), ?fov=0..1 (fixed foveation).
 */

import { createSystem, VisibilityState } from '@iwsdk/core';

/** Fixed foveation steps, sharpest first. */
const FOVEATION_STEPS = [0.15, 0.4, 0.7, 1.0];
const CHECK_EVERY_S = 1.5;
const RELAX_AFTER_S = 12;

/** Framebuffer scale by device: Quest 3 has GPU headroom for this scene; others stay closer to 1. */
export function framebufferScaleFor(ua: string): number {
  if (/Quest 3(?!S)/i.test(ua)) return 1.3;
  if (/Quest (3S|Pro)/i.test(ua)) return 1.15;
  if (/Quest 2/i.test(ua)) return 1.1;
  if (/Quest|OculusBrowser/i.test(ua)) return 1.1;
  return 1.0; // desktop emulator and unknown devices
}

/** Next foveation step from the measured frame time vs the display's frame budget. */
export function nextFoveationStep(step: number, avgFrameS: number, budgetS: number, calmS: number): number {
  if (avgFrameS > budgetS * 1.15 && step < FOVEATION_STEPS.length - 1) return step + 1;
  if (avgFrameS < budgetS * 1.03 && calmS >= RELAX_AFTER_S && step > 0) return step - 1;
  return step;
}

export class QualitySystem extends createSystem({}) {
  private step = 0;
  private fixed: number | null = null;
  private avg = 0;
  private sinceCheck = 0;
  private calm = 0;

  init(): void {
    const q = new URLSearchParams(location.search);
    const res = Number(q.get('res'));
    const fov = q.get('fov');
    this.fixed = fov !== null && fov !== '' && Number.isFinite(Number(fov)) ? Math.min(1, Math.max(0, Number(fov))) : null;
    const scale = Number.isFinite(res) && res >= 0.5 && res <= 2 ? res : framebufferScaleFor(navigator.userAgent);
    const xr = this.world.renderer.xr;
    xr.setFramebufferScaleFactor(scale); // takes effect at the next session start
    this.applyFoveation();
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive) {
          // New session: start sharp again, then adapt.
          this.step = 0;
          this.avg = 0;
          this.calm = 0;
          this.applyFoveation();
        }
      }),
    );
  }

  private applyFoveation(): void {
    this.world.renderer.xr.setFoveation(this.fixed ?? FOVEATION_STEPS[this.step]);
  }

  update(delta: number): void {
    const xr = this.world.renderer.xr;
    if (this.fixed !== null || !xr.isPresenting || delta <= 0 || delta > 0.5) return;
    this.avg = this.avg === 0 ? delta : this.avg * 0.92 + delta * 0.08;
    this.sinceCheck += delta;
    if (this.sinceCheck < CHECK_EVERY_S) return;
    this.sinceCheck = 0;
    const rate = xr.getSession()?.frameRate ?? 72;
    const budget = 1 / (rate > 0 ? rate : 72);
    this.calm = this.avg < budget * 1.03 ? this.calm + CHECK_EVERY_S : 0;
    const next = nextFoveationStep(this.step, this.avg, budget, this.calm);
    if (next !== this.step) {
      this.step = next;
      this.calm = 0;
      this.applyFoveation();
    }
  }
}
