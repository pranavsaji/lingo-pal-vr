/**
 * Visual clarity and frame-rate protection in the headset. three.js defaults to
 * maximum fixed foveation (the edges of each eye render at reduced resolution,
 * which is exactly where the two text panels sit) and a 1.0 framebuffer scale
 * (below the Quest 3's physical panel resolution). This system:
 *  - sets the framebuffer scale per device class before a session starts;
 *  - keeps the session at the device's 72 Hz baseline (never asks for 90/120);
 *  - starts with light foveation for sharp side panels;
 *  - watches frame time in XR and raises foveation step by step if frames drop
 *    (then relaxes it again when there is headroom), so clarity never costs
 *    a stutter;
 *  - when foveation is maxed and frames still drop, raises the power level
 *    (src/world/power.ts): cheap-to-lose extras go one at a time, and come back
 *    only after a long, stable stretch on budget.
 * URL overrides for testing: ?res=1.5 (framebuffer scale), ?fov=0..1 (fixed foveation),
 * ?power=0..5 (fixed power level).
 */

import { createSystem, VisibilityState } from '@iwsdk/core';
import { appState, events } from '../game-state.js';
import { createGovernor, MAX_POWER_LEVEL, POWER, stepGovernor } from './power.js';

/** Fixed foveation steps, sharpest first. */
const FOVEATION_STEPS = [0.15, 0.4, 0.7, 1.0];
const CHECK_EVERY_S = 1.5;
const RELAX_AFTER_S = 12;
/** Level 1: the shadow map is redrawn once every this many frames. */
const SLOW_SHADOW_EVERY = 4;
/** Ignore frame times right after a session starts (shader compiles, room setup). */
const WARMUP_S = 4;

/**
 * Framebuffer scale by device. Meta's render-scale table: 1.0 renders 1680x1760 per
 * eye on Quest 3 and 3S, and "approximately 1.2 corresponds to the physical display
 * resolution"; above that the gain is sub-pixel only. The scale cannot change during
 * a session, so it is chosen once, conservatively:
 *  - Quest 3 (2064x2208 panel): 1.2, native sharpness for the text panels
 *    (1.3 was 17% more pixels than 1.2 for sub-pixel gain);
 *  - Quest 3S (1832x1920 panel, same GPU): 1.1 already matches its panel;
 *  - Quest 2 / Pro / other Quest: 1.0, the platform default (older GPU);
 *  - desktop emulator and unknown devices: 1.0.
 */
export function framebufferScaleFor(ua: string): number {
  if (/Quest 3(?!S)/i.test(ua)) return 1.2;
  if (/Quest 3S/i.test(ua)) return 1.1;
  return 1.0;
}

/** Next foveation step from the measured frame time vs the display's frame budget. */
export function nextFoveationStep(step: number, avgFrameS: number, budgetS: number, calmS: number): number {
  if (avgFrameS > budgetS * 1.15 && step < FOVEATION_STEPS.length - 1) return step + 1;
  if (avgFrameS < budgetS * 1.03 && calmS >= RELAX_AFTER_S && step > 0) return step - 1;
  return step;
}

/**
 * The refresh rate to request, or null to leave the session alone. Quest Browser runs
 * WebXR at 72 Hz by default on Quest 3/3S; if a session ever starts faster (a system
 * setting, a future browser) ask for 72 so the frame budget stays at 13.9 ms.
 */
export function targetFrameRate(current: number | undefined, supported: ArrayLike<number> | undefined): number | null {
  if (!current || !supported || current <= 72.5) return null;
  for (let i = 0; i < supported.length; i++) if (Math.abs(supported[i] - 72) < 0.5) return supported[i];
  return null;
}

/** Live quality state for the tester HUD and perf reports (read-only outside this system). */
export const qualityState = {
  framebufferScale: 1,
  foveation: FOVEATION_STEPS[0],
  foveationStep: 0,
  power: 0,
  frameRate: 72,
};

export class QualitySystem extends createSystem({}) {
  private step = 0;
  private fixed: number | null = null;
  private fixedPower: number | null = null;
  private avg = 0;
  private sinceCheck = 0;
  private calm = 0;
  private warmup = WARMUP_S;
  private governor = createGovernor();
  private frame = 0;

  init(): void {
    const q = new URLSearchParams(location.search);
    const res = Number(q.get('res'));
    const fov = q.get('fov');
    const power = q.get('power');
    this.fixed = fov !== null && fov !== '' && Number.isFinite(Number(fov)) ? Math.min(1, Math.max(0, Number(fov))) : null;
    this.fixedPower =
      power !== null && power !== '' && Number.isFinite(Number(power)) ? Math.min(MAX_POWER_LEVEL, Math.max(0, Math.round(Number(power)))) : null;
    const scale = Number.isFinite(res) && res >= 0.5 && res <= 2 ? res : framebufferScaleFor(navigator.userAgent);
    const xr = this.world.renderer.xr;
    xr.setFramebufferScaleFactor(scale); // takes effect at the next session start
    qualityState.framebufferScale = scale;
    this.applyFoveation();
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive) {
          // New session: start sharp again, then adapt.
          this.step = 0;
          this.avg = 0;
          this.calm = 0;
          this.warmup = WARMUP_S;
          this.applyFoveation();
          this.holdRefreshRate();
        } else if (this.fixedPower === null) {
          // Back to the flat page: everything on again; the next session adapts afresh.
          this.governor = createGovernor();
          this.setPower(0);
        }
      }),
      // A new shop under frozen shadows: draw its shadows once.
      events.place.on(() => {
        this.world.renderer.shadowMap.needsUpdate = true;
      }),
      () => {
        this.world.renderer.shadowMap.autoUpdate = true;
      },
    );
  }

  private holdRefreshRate(): void {
    const session = this.world.renderer.xr.getSession() as (XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?: (r: number) => Promise<void> }) | null;
    const rate = targetFrameRate(session?.frameRate, session?.supportedFrameRates);
    if (rate !== null && session?.updateTargetFrameRate) session.updateTargetFrameRate(rate).catch(() => undefined);
  }

  private applyFoveation(): void {
    const f = this.fixed ?? FOVEATION_STEPS[this.step];
    this.world.renderer.xr.setFoveation(f);
    qualityState.foveation = f;
    qualityState.foveationStep = this.step;
  }

  private setPower(level: number): void {
    if (level === appState.powerLevel) return;
    appState.powerLevel = level;
    qualityState.power = level;
    const shadows = this.world.renderer.shadowMap;
    if (level < POWER.shadowsSlow) shadows.autoUpdate = true;
    else {
      shadows.autoUpdate = false;
      shadows.needsUpdate = true;
    }
    console.info(`[Quality] power level ${level}`);
    events.power.emit(level);
  }

  update(delta: number): void {
    // ?power=N: applied on the first frame, once every system is listening.
    if (this.fixedPower !== null && appState.powerLevel !== this.fixedPower) this.setPower(this.fixedPower);
    // Level 1-4: redraw the shadow map every few frames; level 5: never (frozen).
    const level = appState.powerLevel;
    if (level >= POWER.shadowsSlow && level < POWER.shadowsFrozen && ++this.frame % SLOW_SHADOW_EVERY === 0) {
      this.world.renderer.shadowMap.needsUpdate = true;
    }

    const xr = this.world.renderer.xr;
    if (!xr.isPresenting || delta <= 0 || delta > 0.5) return;
    if (this.warmup > 0) {
      this.warmup -= delta;
      return;
    }
    this.avg = this.avg === 0 ? delta : this.avg * 0.92 + delta * 0.08;
    this.sinceCheck += delta;
    if (this.sinceCheck < CHECK_EVERY_S) return;
    const dt = this.sinceCheck;
    this.sinceCheck = 0;
    const rate = xr.getSession()?.frameRate ?? 72;
    qualityState.frameRate = rate > 0 ? rate : 72;
    const budget = 1 / qualityState.frameRate;
    if (this.fixed === null) {
      this.calm = this.avg < budget * 1.03 ? this.calm + dt : 0;
      const next = nextFoveationStep(this.step, this.avg, budget, this.calm);
      if (next !== this.step) {
        this.step = next;
        this.calm = 0;
        this.applyFoveation();
      }
    }
    if (this.fixedPower === null) {
      const maxed = this.fixed !== null || this.step === FOVEATION_STEPS.length - 1;
      this.setPower(stepGovernor(this.governor, this.avg, budget, dt, maxed));
    }
  }
}
