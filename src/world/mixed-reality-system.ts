/**
 * Mixed reality: "Le café sur votre table".
 *
 * In a passthrough (immersive-ar) session the virtual room disappears and the
 * counter (goods, coin dish, tray, Madame Lune behind it) stands on the
 * learner's real table:
 *  1. a persistent anchor saved yesterday is restored (Quest Browser:
 *     restorePersistentAnchor), so the cafe is back on the same spot of the room;
 *  2. otherwise WebXR plane detection (the Quest room setup) finds the nearest
 *     table or desk (semanticLabel), else the nearest horizontal surface at table
 *     height, and the counter snaps to its near edge, square to it;
 *  3. otherwise the old fixed lift (a 0.74 m table) and the placement reticle.
 * "Placer le café" (map panel, or say "placer le café") shows a reticle where the
 * learner points (hand ray, or gaze with no hands): a pinch or "ici" puts the
 * counter there. Every placement gets an XRAnchor (persisted when possible).
 * Where Quest 3 depth sensing is available, real hands and furniture occlude
 * the counter items (hard occlusion: one depth sample per pixel), switched off
 * again if frames drop.
 *
 * The virtual world never moves: the player rig is moved and turned instead
 * (see mr-placement.ts), so every system keeps its fixed world coordinates.
 * Room features are requested as optional, and only for passthrough sessions:
 * VR sessions and the Meta VR Glasses get exactly what they got before.
 */

import {
  CanvasTexture,
  createSystem,
  DepthOccludable,
  DoubleSide,
  type Entity,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OcclusionShadersMode,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SessionMode,
  Shape,
  ShapeGeometry,
  type UIKit,
  type UIKitMLAsset,
  Vector3,
  VisibilityState,
  type World,
  XRPlane as XRPlaneComponent,
  type XROptions,
} from '@iwsdk/core';
import { Coin, VocabItem } from '../components.js';
import { appState, events } from '../game-state.js';
import { POWER } from './power.js';
import { COUNTER_Y } from '../layout.js';
import { store } from '../state/store.js';
import { onActivate } from '../ui/dwell.js';
import {
  COUNTER_SIZE,
  DEFAULT_TABLE_Y,
  fallbackRig,
  type P3,
  type Placement,
  placeAtPoint,
  placeOnTable,
  type PlaneInfo,
  quaternionOfYaw,
  rayToSurface,
  type Rig,
  rigFor,
  selectTable,
  type SurfaceHit,
  yawOfQuaternion,
} from './mr-placement.js';

export const ANCHOR_KEY = 'lingo.mr.anchor.v1';
/** How long to wait for the room setup (planes) before inviting the learner to place the cafe. */
const SEARCH_SECONDS = 5;
const PLANE_REFRESH_S = 0.5;
const ANCHOR_RESTORE_TIMEOUT_MS = 4000;
const TOAST_SECONDS = 5;
/** Hit-test surfaces accepted for the counter (reference-space metres): tables and desks, not the floor. */
const SURFACE_MIN_Y = 0.3;
const SURFACE_MAX_Y = 1.4;

/** Ignore the pinch that opened the reticle (from the map button). */
const PLACING_GRACE_S = 0.6;
const PERF_CHECK_S = 1.5;
const PERF_SLOW_CHECKS = 4;
const PERF_WARMUP_S = 8;

type Source = 'fixed' | 'table' | 'anchor' | 'manual';

export function preferredSessionMode(): SessionMode {
  return store.profile.settings.mixedReality ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR;
}

/**
 * Session options for a mode. Room features (planes, anchors, hit test, depth)
 * are optional and requested for passthrough only, so a device without them
 * still starts the session, and VR sessions are unchanged.
 */
export function xrOptionsFor(ar: boolean): Partial<XROptions> {
  if (!ar) return { sessionMode: SessionMode.ImmersiveVR };
  return {
    sessionMode: SessionMode.ImmersiveAR,
    features: {
      anchors: true,
      hitTest: true,
      planeDetection: true,
      depthSensing: { required: false, usage: 'gpu-optimized', format: 'float32' },
    },
  };
}

/** Enter XR in the chosen mode ("Paris (VR)" / "Ma pièce (MR)") and remember the choice. */
export function launchMode(world: World, ar: boolean): void {
  if (store.profile.settings.mixedReality !== ar) store.setSetting('mixedReality', ar);
  world.launchXR(xrOptionsFor(ar));
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(ANCHOR_KEY);
  } catch {
    return null;
  }
}

function writeStorage(uuid: string | null): void {
  try {
    if (uuid) window.localStorage.setItem(ANCHOR_KEY, uuid);
    else window.localStorage.removeItem(ANCHOR_KEY);
  } catch {
    // storage blocked: the cafe is simply placed again next time
  }
}

/** A two-line (French + English) canvas label on a plane facing +Z. */
class Label {
  readonly mesh: Mesh;
  private canvas: HTMLCanvasElement | null = null;
  private texture: CanvasTexture | null = null;
  private shown = '';

  constructor(width: number, height: number) {
    const mat = new MeshBasicMaterial({ transparent: true, depthTest: false, side: DoubleSide });
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 1024;
      this.canvas.height = Math.round((1024 * height) / width);
      this.texture = new CanvasTexture(this.canvas);
      mat.map = this.texture;
    }
    this.mesh = new Mesh(new PlaneGeometry(width, height), mat);
    this.mesh.renderOrder = 999;
  }

  draw(fr: string, en: string): void {
    const key = `${fr}|${en}`;
    if (key === this.shown || !this.canvas || !this.texture) return;
    this.shown = key;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(16, 24, 32, 0.82)';
    g.beginPath();
    g.roundRect(4, 4, w - 8, h - 8, 36);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#fafaf7';
    g.font = `bold ${Math.round(h * 0.3)}px sans-serif`;
    g.fillText(fr, w / 2, h * 0.47, w - 60);
    g.fillStyle = '#9fd3c7';
    g.font = `${Math.round(h * 0.2)}px sans-serif`;
    g.fillText(en, w / 2, h * 0.8, w - 60);
    this.texture.needsUpdate = true;
  }
}

export class MixedRealitySystem extends createSystem({
  planes: { required: [XRPlaneComponent] },
  items: { required: [VocabItem] },
  coins: { required: [Coin] },
}) {
  private roomParts: Object3D[] = [];
  private ar = false;
  private relaunch = false;
  private lastSetting = store.profile.settings.mixedReality;
  private arSupported = false;

  // Placement state (reference space = the real room).
  private source: Source = 'fixed';
  private placement: Placement | null = null;
  private rig: Rig = fallbackRig();
  private head = { x: 0, z: 0 };
  private headFwd = { x: 0, z: -1 };
  private searchLeft = 0;
  private planeTimer = 0;
  private planeInfos: PlaneInfo[] = [];
  private invited = false;
  private sessionGen = 0;
  private now = 0;

  // Anchors.
  private anchor: XRAnchor | null = null;
  private anchorRestoring = false;
  private pendingAnchor: { p: Placement; persist: boolean } | null = null;
  private lastAnchorX = NaN;
  private lastAnchorZ = NaN;
  private lastAnchorY = NaN;
  private lastAnchorYaw = NaN;

  // Placement reticle.
  private placing = false;
  private placingSince = 0;
  private commitNext = false;
  /** Where the reticle was last drawn (committed on pinch / "ici"). */
  private shown: P3 = { x: 0, y: 0, z: 0 };
  private reticle!: Group;
  private reticleLabel!: Label;
  private hit: SurfaceHit = { x: 0, y: 0, z: 0, kind: 'height' };
  private hitValid = false;
  private rayOrigin: P3 = { x: 0, y: 0, z: 0 };
  private rayDir: P3 = { x: 0, y: 0, z: 0 };
  private hitSource: XRHitTestSource | null = null;
  private hitSourceFor: XRInputSource | null = null;
  private hitSourceRequested = false;
  private onSelect: ((e: XRInputSourceEvent) => void) | null = null;
  private selectSession: XRSession | null = null;

  // Toast above the counter.
  private toast!: Label;
  private toastLeft = 0;

  // Depth occlusion.
  private occlusionOn = false;
  private occlusionDegraded = false;
  private occluded = new Set<Entity>();
  private transparentBackup = new Map<Material, boolean>();
  private perfAvg = 0;
  private perfTimer = 0;
  private perfWarmup = 0;
  private slowChecks = 0;

  private up = new Vector3(0, 1, 0);
  private tmp = new Vector3();
  private q = new Quaternion();

  init(): void {
    this.buildReticle();
    this.toast = new Label(0.56, 0.13);
    this.toast.mesh.position.set(0, COUNTER_Y + 0.36, -0.8);
    this.toast.mesh.visible = false;
    this.toast.mesh.name = 'MR Toast';
    this.world.createTransformEntity(this.toast.mesh);

    const xr = typeof navigator !== 'undefined' ? navigator.xr : undefined;
    void xr
      ?.isSessionSupported('immersive-ar')
      .then((ok) => {
        this.arSupported = ok;
        this.renderButtons();
      })
      .catch(() => undefined);

    // Frame-rate guard (src/world/power.ts): occlusion is the first MR luxury to go.
    this.cleanupFuncs.push(
      events.power.on((level) => {
        if (level < POWER.occlusion || !this.occlusionOn) return;
        this.disableOcclusion();
        this.occlusionDegraded = true;
      }),
    );

    this.cleanupFuncs.push(
      events.settings.on((s) => {
        if (s.mixedReality === this.lastSetting) return;
        this.lastSetting = s.mixedReality;
        this.renderButtons();
        if (this.world.xrSession) {
          this.relaunch = true;
          this.world.exitXR();
        }
      }),
      events.place.on(() => {
        // A new shop set: forget the old parts and re-apply the current mode to the new ones.
        this.roomParts = [];
        this.showRoom(!this.ar);
      }),
      events.placeCafe.on((what) => {
        if (what === 'start') this.startPlacing();
        else if (what === 'here') this.commitNext = this.placing;
        else this.stopPlacing();
      }),
      this.world.visibilityState.subscribe((state) => {
        this.renderButtons();
        if (state === VisibilityState.NonImmersive && this.relaunch) {
          this.relaunch = false;
          // Best effort: some browsers require a fresh click; the panel buttons cover that case.
          setTimeout(() => {
            try {
              this.world.launchXR(xrOptionsFor(store.profile.settings.mixedReality));
            } catch {
              // fall back to the Enter buttons
            }
          }, 300);
        }
      }),
    );
    // Items are rebuilt per shop and coins per payment: new ones join the occlusion, old ones leave.
    for (const q of [this.queries.items, this.queries.coins]) {
      this.cleanupFuncs.push(
        q.subscribe('qualify', (e) => {
          if (this.occlusionOn) this.occlude(e);
        }),
        q.subscribe('disqualify', (e) => {
          this.occluded.delete(e);
        }),
      );
    }
    this.wireButtons();
  }

  // ---------------------------------------------------------------- UI

  private wireButtons(): void {
    const lesson = this.world.getSceneObject<UIKitMLAsset>('lesson-panel');
    const ar = lesson?.getElementById('ar-button');
    if (ar) {
      if (!this.world.xrEnabled) ar.setProperties({ display: 'none' });
      else this.cleanupFuncs.push(onActivate(ar, () => launchMode(this.world, true)));
    }
    const map = this.world.getSceneObject<UIKitMLAsset>('map-panel');
    const mode = map?.getElementById('map-mode');
    if (mode)
      this.cleanupFuncs.push(
        onActivate(mode, () => {
          if (this.world.xrSession) store.setSetting('mixedReality', !this.ar);
          else if (this.world.xrEnabled) launchMode(this.world, true);
        }),
      );
    const place = map?.getElementById('map-place');
    if (place)
      this.cleanupFuncs.push(
        onActivate(place, () => {
          events.openPanel.emit('home');
          this.startPlacing();
        }),
      );
    this.renderButtons();
  }

  private renderButtons(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const lesson = this.world.getSceneObject<UIKitMLAsset>('lesson-panel');
    lesson?.getElementById('ar-button')?.setProperties({ display: this.world.xrEnabled && this.arSupported && !immersive ? 'flex' : 'none' });
    const map = this.world.getSceneObject<UIKitMLAsset>('map-panel');
    const canSwitch = this.world.xrEnabled && (this.arSupported || this.ar);
    map?.getElementById('map-mode')?.setProperties({ display: canSwitch ? 'flex' : 'none' });
    map?.getElementById<UIKit.Text>('map-mode-label')?.setProperties({ text: this.ar ? 'Paris (VR)' : 'Ma pièce (MR)' });
    map?.getElementById('map-place')?.setProperties({ display: this.ar ? 'flex' : 'none' });
  }

  private buildReticle(): void {
    const { width, depth } = COUNTER_SIZE;
    const mat = new MeshBasicMaterial({ color: 0x9fd3c7, transparent: true, opacity: 0.95, depthTest: false, side: DoubleSide });
    const fillMat = new MeshBasicMaterial({ color: 0x2a9d8f, transparent: true, opacity: 0.18, depthTest: false, side: DoubleSide });
    // Counter footprint: front edge on the spot (local z = 0), extending away from the learner (-z).
    const outer = new Shape();
    const hw = width / 2;
    const b = 0.018;
    outer.moveTo(-hw, 0);
    outer.lineTo(hw, 0);
    outer.lineTo(hw, depth);
    outer.lineTo(-hw, depth);
    outer.closePath();
    const hole = new Shape();
    hole.moveTo(-hw + b, b);
    hole.lineTo(-hw + b, depth - b);
    hole.lineTo(hw - b, depth - b);
    hole.lineTo(hw - b, b);
    hole.closePath();
    outer.holes.push(hole);
    const frame = new Mesh(new ShapeGeometry(outer), mat);
    frame.rotation.x = -Math.PI / 2; // shape y -> -z
    const fill = new Mesh(new PlaneGeometry(width, depth), fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.z = -depth / 2;
    const dot = new Mesh(new RingGeometry(0.035, 0.06, 32), mat);
    dot.rotation.x = -Math.PI / 2;
    this.reticleLabel = new Label(0.62, 0.15);
    this.reticleLabel.mesh.position.set(0, 0.16, -0.05);
    this.reticleLabel.draw('Pincez ici pour placer le café', 'Pinch, or say « ici », to put the café here');
    this.reticle = new Group();
    this.reticle.name = 'MR Placement Reticle';
    for (const m of [frame, fill, dot]) m.renderOrder = 998;
    this.reticle.add(frame, fill, dot, this.reticleLabel.mesh);
    this.reticle.visible = false;
    // Child of the player rig: local coordinates are the real room's (reference space).
    this.world.createTransformEntity(this.reticle, { parent: this.world.playerEntity });
  }

  private showToast(fr: string, en: string): void {
    this.toast.draw(fr, en);
    this.toast.mesh.visible = true;
    this.toastLeft = TOAST_SECONDS;
  }

  // ---------------------------------------------------------------- room visibility + rig

  private collect(): void {
    if (this.roomParts.length) return;
    this.world.scene.traverse((o) => {
      if (o.userData.mrHide) this.roomParts.push(o);
    });
    const floor = this.world.getSceneObject<Object3D>('studio-floor');
    if (floor) this.roomParts.push(floor);
  }

  private showRoom(show: boolean): void {
    this.collect();
    for (const o of this.roomParts) o.visible = show;
  }

  private applyRig(r: Rig): void {
    this.rig = r;
    this.player.position.set(r.x, r.y, r.z);
    this.player.quaternion.setFromAxisAngle(this.up, r.yaw);
  }

  private setPlacement(p: Placement, source: Source): void {
    this.placement = p;
    this.source = source;
    this.applyRig(rigFor(p));
  }

  // ---------------------------------------------------------------- session lifecycle

  private startAr(session: XRSession): void {
    this.ar = true;
    this.sessionGen++;
    this.source = 'fixed';
    this.placement = null;
    this.invited = false;
    this.searchLeft = SEARCH_SECONDS;
    this.planeTimer = 0;
    this.slowChecks = 0;
    this.perfAvg = 0;
    this.perfWarmup = PERF_WARMUP_S;
    this.occlusionDegraded = false;
    this.showRoom(false);
    this.applyRig(fallbackRig());

    this.onSelect = () => {
      if (this.placing && this.now - this.placingSince > PLACING_GRACE_S) this.commitNext = true;
    };
    session.addEventListener('select', this.onSelect);
    this.selectSession = session;

    if (session.enabledFeatures?.includes('anchors')) void this.restoreAnchor(session, this.sessionGen);
    if (session.enabledFeatures?.includes('depth-sensing')) this.enableOcclusion();
    this.renderButtons();
  }

  private endAr(): void {
    this.ar = false;
    this.sessionGen++;
    this.stopPlacing();
    if (this.selectSession && this.onSelect) this.selectSession.removeEventListener('select', this.onSelect);
    this.selectSession = null;
    this.onSelect = null;
    this.forgetAnchor();
    this.pendingAnchor = null;
    this.anchorRestoring = false;
    this.disableOcclusion();
    this.planeInfos = [];
    this.toast.mesh.visible = false;
    this.showRoom(true);
    this.applyRig({ x: 0, y: 0, z: 0, yaw: 0 });
    this.renderButtons();
  }

  private forgetAnchor(): void {
    try {
      this.anchor?.delete();
    } catch {
      // session already over
    }
    this.anchor = null;
    this.lastAnchorX = this.lastAnchorY = this.lastAnchorZ = this.lastAnchorYaw = NaN;
  }

  // ---------------------------------------------------------------- anchors

  private async restoreAnchor(session: XRSession, gen: number): Promise<void> {
    const uuid = readStorage();
    if (!uuid || !session.restorePersistentAnchor) return;
    this.anchorRestoring = true;
    try {
      const anchor = await Promise.race([
        session.restorePersistentAnchor(uuid),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ANCHOR_RESTORE_TIMEOUT_MS)),
      ]);
      if (gen !== this.sessionGen) {
        anchor?.delete();
        return;
      }
      if (!anchor) return;
      this.forgetAnchor();
      this.anchor = anchor;
      this.source = 'anchor';
      this.stopPlacing();
      this.showToast('Votre café vous attendait ici !', 'Your café was waiting right here, like yesterday.');
    } catch {
      // Another room, or the anchor was cleared: find the table instead.
      if (gen === this.sessionGen) writeStorage(null);
    } finally {
      if (gen === this.sessionGen) this.anchorRestoring = false;
    }
  }

  /** Called from update() with the live frame (anchors are created against a frame). */
  private createAnchor(frame: XRFrame, ref: XRReferenceSpace): void {
    const pending = this.pendingAnchor;
    this.pendingAnchor = null;
    if (!pending || !frame.createAnchor) return;
    const session = frame.session;
    const gen = this.sessionGen;
    const q = quaternionOfYaw(pending.p.yaw);
    const pose = new XRRigidTransform({ x: pending.p.x, y: pending.p.y, z: pending.p.z }, q);
    void frame
      .createAnchor(pose, ref)
      .then(async (anchor) => {
        if (gen !== this.sessionGen || !anchor) {
          anchor?.delete();
          return;
        }
        this.forgetAnchor();
        this.anchor = anchor;
        if (!pending.persist || !anchor.requestPersistentHandle) return;
        const old = readStorage();
        const uuid = await anchor.requestPersistentHandle();
        writeStorage(uuid);
        if (old && old !== uuid) await session.deletePersistentAnchor?.(old).catch(() => undefined);
      })
      .catch(() => undefined); // anchors are optional: the rig placement already stands
  }

  /** Follow the anchor (relocalization, recentering) without allocating when it is still. */
  private trackAnchor(frame: XRFrame, ref: XRReferenceSpace): void {
    if (!this.anchor) return;
    let pose: XRPose | undefined;
    try {
      pose = frame.getPose(this.anchor.anchorSpace, ref);
    } catch {
      return;
    }
    if (!pose) return;
    const { position: p, orientation: o } = pose.transform;
    if (p.y < SURFACE_MIN_Y || p.y > SURFACE_MAX_Y) {
      // A saved spot that is not at table height (e.g. the room was re-scanned): drop it
      // and let table detection place the cafe again.
      this.forgetAnchor();
      writeStorage(null);
      if (this.source === 'anchor') this.source = 'fixed';
      return;
    }
    const yaw = yawOfQuaternion(o.x, o.y, o.z, o.w);
    if (
      Math.abs(p.x - this.lastAnchorX) < 0.002 &&
      Math.abs(p.y - this.lastAnchorY) < 0.002 &&
      Math.abs(p.z - this.lastAnchorZ) < 0.002 &&
      Math.abs(yaw - this.lastAnchorYaw) < 0.003
    )
      return;
    this.lastAnchorX = p.x;
    this.lastAnchorY = p.y;
    this.lastAnchorZ = p.z;
    this.lastAnchorYaw = yaw;
    this.setPlacement({ x: p.x, y: p.y, z: p.z, yaw }, this.source === 'fixed' ? 'anchor' : this.source);
  }

  // ---------------------------------------------------------------- planes

  private refreshPlanes(frame: XRFrame, ref: XRReferenceSpace): void {
    const out: PlaneInfo[] = [];
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlaneComponent, '_plane') as XRPlane | undefined;
      if (!plane) continue;
      let pose: XRPose | undefined;
      try {
        pose = frame.getPose(plane.planeSpace, ref);
      } catch {
        continue;
      }
      if (!pose) continue;
      const m = pose.transform.matrix;
      // Plane space: +Y is the normal; the polygon lies in its XZ plane.
      const normalY = m[5];
      const polygon = plane.polygon.map((v) => ({
        x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
        z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
      }));
      out.push({ label: (plane.semanticLabel ?? '').toLowerCase(), normalY, y: m[13], polygon });
    }
    this.planeInfos = out;
  }

  private tryAutoPlace(): boolean {
    const found = selectTable(this.planeInfos, this.head, this.headFwd);
    if (!found) return false;
    this.setPlacement(placeOnTable(found.plane, this.head), 'table');
    this.pendingAnchor = { p: this.placement as Placement, persist: true };
    this.stopPlacing();
    this.showToast(
      found.reason === 'label' ? 'Le café est servi sur votre table !' : 'Le café est servi sur votre surface !',
      'The café is set on your real table. Map > « Placer le café » to move it.',
    );
    return true;
  }

  // ---------------------------------------------------------------- placing

  private startPlacing(): void {
    if (!this.ar) {
      this.showToast('Le café chez vous : « Ma pièce (MR) »', 'Placing the café works in mixed reality (passthrough).');
      return;
    }
    this.placing = true;
    appState.placingCafe = true;
    this.placingSince = this.now;
    this.commitNext = false;
    this.hitValid = false;
  }

  private stopPlacing(): void {
    this.placing = false;
    appState.placingCafe = false;
    this.commitNext = false;
    this.reticle.visible = false;
    try {
      this.hitSource?.cancel();
    } catch {
      // already gone with the session
    }
    this.hitSource = null;
    this.hitSourceFor = null;
    this.hitSourceRequested = false;
  }

  /** The dominant hand's pointing ray (or the head's gaze with no hands) into rayOrigin/rayDir. */
  private pointer(frame: XRFrame, ref: XRReferenceSpace, viewer: XRViewerPose): XRInputSource | null {
    const want = store.profile.settings.leftHanded ? 'left' : 'right';
    let chosen: XRInputSource | null = null;
    for (const s of frame.session.inputSources) {
      if (s.targetRayMode !== 'tracked-pointer') continue;
      if (!chosen || s.handedness === want) chosen = s;
    }
    const pose = chosen ? frame.getPose(chosen.targetRaySpace, ref) : null;
    const t = pose ? pose.transform : viewer.transform;
    const o = t.orientation;
    this.tmp.set(0, 0, -1).applyQuaternion(this.q.set(o.x, o.y, o.z, o.w));
    this.rayOrigin.x = t.position.x;
    this.rayOrigin.y = t.position.y;
    this.rayOrigin.z = t.position.z;
    this.rayDir.x = this.tmp.x;
    this.rayDir.y = this.tmp.y;
    this.rayDir.z = this.tmp.z;
    return pose ? chosen : null;
  }

  private updatePlacing(frame: XRFrame, ref: XRReferenceSpace, viewer: XRViewerPose): void {
    const source = this.pointer(frame, ref, viewer);
    const fallbackY = this.placement?.y ?? DEFAULT_TABLE_Y;
    let hit = rayToSurface(this.rayOrigin, this.rayDir, this.planeInfos, fallbackY, this.hit);

    // Hit test (room mesh / planes) refines the spot where no detected plane matched.
    if (source && frame.session.enabledFeatures?.includes('hit-test')) {
      if (source !== this.hitSourceFor && !this.hitSourceRequested) {
        this.hitSourceRequested = true;
        try {
          this.hitSource?.cancel();
        } catch {
          // ignore
        }
        this.hitSource = null;
        const gen = this.sessionGen;
        void frame.session
          .requestHitTestSource?.({ space: source.targetRaySpace })
          ?.then((hs) => {
            if (gen !== this.sessionGen || !this.placing) hs.cancel();
            else {
              this.hitSource = hs;
              this.hitSourceFor = source;
            }
          })
          .catch(() => undefined)
          .finally(() => (this.hitSourceRequested = false));
      }
      if (this.hitSource && (!hit || hit.kind !== 'plane')) {
        const results = frame.getHitTestResults(this.hitSource);
        const pose = results.length ? results[0].getPose(ref) : undefined;
        const m = pose?.transform.matrix;
        // Up-facing surface (the pose's +Y is the surface normal) at table height: never the floor.
        if (m && m[5] > 0.85 && m[13] >= SURFACE_MIN_Y && m[13] <= SURFACE_MAX_Y) {
          this.hit.x = m[12];
          this.hit.y = m[13];
          this.hit.z = m[14];
          this.hit.kind = 'hit';
          hit = this.hit;
        }
      }
    }

    if (this.commitNext) {
      // Commit where the learner saw the reticle: the pinch itself moves the hand ray.
      this.commitNext = false;
      if (this.hitValid) this.commit(this.shown);
      else if (hit) this.commit(hit);
      return;
    }
    this.hitValid = hit !== null;
    this.reticle.visible = this.hitValid;
    if (hit) {
      this.shown.x = hit.x;
      this.shown.y = hit.y;
      this.shown.z = hit.z;
      this.reticle.position.set(hit.x, hit.y + 0.003, hit.z);
      this.reticle.rotation.set(0, Math.atan2(this.head.x - hit.x, this.head.z - hit.z), 0);
    }
  }

  private commit(hit: P3): void {
    const p = placeAtPoint(hit, this.head, this.placement?.yaw ?? 0);
    this.setPlacement(p, 'manual');
    this.pendingAnchor = { p, persist: true };
    this.stopPlacing();
    this.showToast('Voilà ! Le café est chez vous.', 'There! The café now lives on your table, even tomorrow.');
  }

  // ---------------------------------------------------------------- depth occlusion

  private enableOcclusion(): void {
    if (this.occlusionOn || this.occlusionDegraded || appState.powerLevel >= POWER.occlusion) return;
    this.occlusionOn = true;
    for (const e of this.queries.items.entities) this.occlude(e);
    for (const e of this.queries.coins.entities) this.occlude(e);
  }

  private occlude(e: Entity): void {
    if (this.occluded.has(e) || e.hasComponent(DepthOccludable)) return;
    // DepthSensingSystem marks materials transparent; remember them to restore after the session.
    e.object3D?.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m && !this.transparentBackup.has(m)) this.transparentBackup.set(m, m.transparent);
      }
    });
    e.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
    this.occluded.add(e);
  }

  private disableOcclusion(): void {
    this.occlusionOn = false;
    for (const e of this.occluded) if (e.active && e.hasComponent(DepthOccludable)) e.removeComponent(DepthOccludable);
    this.occluded.clear();
    for (const [m, transparent] of this.transparentBackup) m.transparent = transparent;
    this.transparentBackup.clear();
  }

  /** Occlusion is a luxury: if frames keep missing the budget, switch it off for this session. */
  private watchPerf(delta: number): void {
    if (!this.occlusionOn || delta <= 0 || delta > 0.5) return;
    if (this.perfWarmup > 0) {
      // Session start compiles the occlusion shaders and loads the room: not representative.
      this.perfWarmup -= delta;
      return;
    }
    this.perfAvg = this.perfAvg === 0 ? delta : this.perfAvg * 0.92 + delta * 0.08;
    this.perfTimer += delta;
    if (this.perfTimer < PERF_CHECK_S) return;
    this.perfTimer = 0;
    const rate = this.world.xrSession?.frameRate ?? 72;
    const budget = 1 / (rate > 0 ? rate : 72);
    this.slowChecks = this.perfAvg > budget * 1.25 ? this.slowChecks + 1 : 0;
    if (this.slowChecks >= PERF_SLOW_CHECKS) {
      this.disableOcclusion();
      this.occlusionDegraded = true;
      console.info('[MixedReality] depth occlusion off: frame time over budget');
    }
  }

  // ---------------------------------------------------------------- frame

  update(delta: number, time: number): void {
    this.now = time;
    const session = this.world.xrSession;
    const mode = session?.environmentBlendMode;
    const ar = mode === 'alpha-blend' || mode === 'additive';
    if (ar !== this.ar) {
      if (ar && session) this.startAr(session);
      else this.endAr();
    }
    if (this.toastLeft > 0) {
      this.toastLeft -= delta;
      if (this.toastLeft <= 0) this.toast.mesh.visible = false;
    }
    if (!this.ar) return;

    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    if (!frame || !ref) return;
    const viewer = frame.getViewerPose(ref);
    if (!viewer) return;
    this.head.x = viewer.transform.position.x;
    this.head.z = viewer.transform.position.z;
    // Horizontal look direction: the learner faces the table they sit at.
    const o = viewer.transform.orientation;
    this.headFwd.x = -2 * (o.x * o.z + o.w * o.y);
    this.headFwd.z = -(1 - 2 * (o.x * o.x + o.y * o.y));

    if (this.pendingAnchor) this.createAnchor(frame, ref);
    this.trackAnchor(frame, ref);

    this.planeTimer -= delta;
    if (this.planeTimer <= 0) {
      this.planeTimer = PLANE_REFRESH_S;
      this.refreshPlanes(frame, ref);
      if (this.source === 'fixed' && !this.anchorRestoring && !this.placing) this.tryAutoPlace();
    }
    if (this.source === 'fixed' && !this.anchorRestoring && !this.invited) {
      this.searchLeft -= delta;
      if (this.searchLeft <= 0) {
        // No room setup and no saved spot: let the learner show us the table.
        this.invited = true;
        this.startPlacing();
        this.showToast('Où est votre table ?', 'Point at your table and pinch (or say « ici »).');
      }
    }
    if (this.placing) this.updatePlacing(frame, ref, viewer);
    this.watchPerf(delta);
  }
}
