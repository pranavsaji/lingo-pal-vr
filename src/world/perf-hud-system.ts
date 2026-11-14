/**
 * Tester mode, opt-in with `?perf` on the URL (registered only then; without the flag
 * nothing is shown, measured or sent).
 *  - A small head-locked readout in the lower left of the view: fps (average and 1%
 *    low), frame ms, draw calls, foveation, power level and the device guess. One
 *    canvas texture redrawn twice a second, one draw call.
 *  - Every 30 s, an anonymous summary is POSTed to /api/perf (see server/perf-handler.mjs):
 *    device class, place, fps, frame times, draw calls, triangles, framebuffer scale,
 *    foveation, power level and session seconds. No identifiers, no free text.
 *  - `window.__lingoPerf` for automated flat-view measurements (world, travel, appState).
 */

import { CanvasTexture, createSystem, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, VisibilityState } from '@iwsdk/core';
import { appState, events, type PlaceId } from '../game-state.js';
import { POWER_LEVEL_NAMES } from './power.js';
import { buildReport, deviceClass, emptySummary, FrameStats } from './perf-stats.js';
import { qualityState } from './quality-system.js';

const HUD_EVERY_S = 0.5;
const REPORT_EVERY_S = 30;
/** Frames in the HUD's rolling window (~4 s at 72 Hz). */
const HUD_WINDOW = 300;

export class PerfHudSystem extends createSystem({}) {
  private stats = new FrameStats();
  private hudSummary = emptySummary();
  private reportSummary = emptySummary();
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: CanvasTexture;
  private hudTimer = 0;
  private reportTimer = 0;
  private framesSinceReport = 0;
  private sessionS = 0;
  private calls = 0;
  private triangles = 0;
  private device = deviceClass(navigator.userAgent);

  init(): void {
    (window as unknown as Record<string, unknown>).__lingoPerf = {
      world: this.world,
      appState,
      travel: (p: PlaceId) => events.travel.emit(p),
    };
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 192;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      new PlaneGeometry(0.16, 0.06),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false }),
    );
    mesh.name = 'Perf HUD';
    mesh.renderOrder = 9999;
    mesh.frustumCulled = false;
    mesh.position.set(-0.1, -0.12, -0.5); // lower left, clear of the panels
    // A plain child, not an entity: the XR head space in a session (posed before render, no
    // lag), the flat camera otherwise (the head space only moves in XR).
    const attach = (immersive: boolean) => (immersive ? this.world.playerHeadEntity.object3D : this.world.camera)?.add(mesh);
    this.cleanupFuncs.push(
      () => mesh.removeFromParent(),
      this.world.visibilityState.subscribe((v) => {
        attach(v !== VisibilityState.NonImmersive);
        // Entering or leaving a session: flush what was measured, start a clean window.
        if (this.framesSinceReport > 60) this.report();
        this.stats.reset();
        this.framesSinceReport = 0;
        this.reportTimer = 0;
        if (v !== VisibilityState.NonImmersive) this.sessionS = 0;
      }),
    );
    this.draw();
  }

  private mode(): 'vr' | 'ar' | 'flat' {
    const session = this.world.xrSession;
    if (!session) return 'flat';
    const blend = session.environmentBlendMode;
    return blend === 'alpha-blend' || blend === 'additive' ? 'ar' : 'vr';
  }

  update(delta: number): void {
    if (delta > 0 && delta < 1) {
      this.stats.push(delta * 1000);
      this.framesSinceReport++;
      this.sessionS += delta;
    }
    // renderer.info holds the previous frame (both eyes in XR); smooth over shadow-pass skips.
    const info = this.world.renderer.info.render;
    this.calls = this.calls * 0.9 + info.calls * 0.1;
    this.triangles = this.triangles * 0.9 + info.triangles * 0.1;

    this.hudTimer += delta;
    if (this.hudTimer >= HUD_EVERY_S) {
      this.hudTimer = 0;
      this.draw();
    }
    this.reportTimer += delta;
    if (this.reportTimer >= REPORT_EVERY_S) {
      this.reportTimer = 0;
      this.report();
    }
  }

  private draw(): void {
    const s = this.stats.summary(this.hudSummary, HUD_WINDOW);
    const g = this.ctx;
    g.clearRect(0, 0, 512, 192);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 0, 512, 192);
    const budget = 1000 / qualityState.frameRate;
    g.fillStyle = s.frames === 0 ? '#fff' : s.p95Ms > budget * 1.1 ? '#ff6b6b' : s.avgMs > budget * 1.05 ? '#ffd166' : '#7CFC9a';
    g.font = 'bold 44px sans-serif';
    g.fillText(`${s.avgFps.toFixed(0)} fps  low ${s.low1Fps.toFixed(0)}`, 16, 52);
    g.fillStyle = '#fff';
    g.font = '28px sans-serif';
    g.fillText(`${s.avgMs.toFixed(1)} ms  p95 ${s.p95Ms.toFixed(1)}  ${Math.round(this.calls)} calls`, 16, 98);
    g.fillText(`fov ${qualityState.foveation.toFixed(2)}  res ${qualityState.framebufferScale}  ${this.mode()}`, 16, 138);
    g.fillText(`power ${appState.powerLevel} ${POWER_LEVEL_NAMES[appState.powerLevel] ?? ''}  ${this.device}`, 16, 176);
    this.texture.needsUpdate = true;
  }

  private report(): void {
    const n = this.framesSinceReport;
    this.framesSinceReport = 0;
    if (n < 30) return;
    const s = this.stats.summary(this.reportSummary, n);
    const body = buildReport(s, {
      device: this.device,
      mode: this.mode(),
      place: appState.place,
      drawCalls: this.calls,
      triangles: this.triangles,
      fbScale: qualityState.framebufferScale,
      foveation: qualityState.foveation,
      power: appState.powerLevel,
      sessionS: this.sessionS,
    });
    void fetch('./api/perf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  }
}
