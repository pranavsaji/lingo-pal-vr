/**
 * Reads WebXR hand joints every frame, classifies gestures (finger count,
 * thumbs up/down, wave, palm-up push-to-talk) and turns them into game input:
 *
 * - A badge above the raised hand shows the detected finger count.
 * - Hands-only ordering: look at a menu item and hold up N fingers for 1 s ->
 *   Madame Lune hears "N <item>, s'il vous plait" (spoken aloud for you).
 * - Thumbs up / down -> "oui" / "non"; wave -> "bonjour" / "au revoir".
 *
 * Zero allocations per frame: joint spaces, pose buffers and vectors are cached.
 */

import { CanvasTexture, createSystem, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from '@iwsdk/core';
import { menuItem, quantityPhrase } from '../agent/menu.js';
import { director } from '../agent/runtime.js';
import { appState, events } from '../game-state.js';
import { speakFrench } from '../speech.js';
import { VOCAB } from '../vocab.js';
import { store } from '../state/store.js';
import { classifyHand, GestureStabilizer, JOINT_COUNT, JOINT_NAMES, type GestureFrame, type Handedness } from './gestures.js';
import { handState } from './hand-state.js';

const ORDER_HOLD_MS = 1000; // fingers + gaze must hold this long to order
const GESTURE_HOLD_MS = 450;
const RAISED_BELOW_HEAD = 0.5; // counting hand: wrist at chest height or above (resting, reaching and pointing hands fail UPRIGHT_MIN)
const UPRIGHT_MIN = 0.55; // wrist -> middle knuckle must point mostly up (pointing poses are horizontal)
const GAZE_CONE_DEG = 14; // what the head is looking at, for finger orders

interface HandBuffers {
  hand: XRHand | null;
  spaces: XRJointSpace[];
  matrices: Float32Array;
  joints: Float32Array;
}

const newBuffers = (): HandBuffers => ({ hand: null, spaces: [], matrices: new Float32Array(JOINT_COUNT * 16), joints: new Float32Array(JOINT_COUNT * 3) });

export class HandSystem extends createSystem({}) {
  private buffers: Record<Handedness, HandBuffers> = { left: newBuffers(), right: newBuffers() };
  private countStable = new GestureStabilizer(GESTURE_HOLD_MS);
  private thumbsStable = new GestureStabilizer(GESTURE_HOLD_MS);
  private palmStable = new GestureStabilizer(250);
  private clockMs = 0;
  private headY = 1.2;
  private orderCandidate = '';
  private orderSince = 0;
  private orderFired = '';
  // Wave detection: lateral wrist direction changes while the palm is open.
  private waveLastX = 0;
  private waveDir = 0;
  private waveFlips = 0;
  private waveWindowStart = 0;
  private lastWave = -10_000;

  private badge!: Mesh;
  private badgeCanvas: HTMLCanvasElement | null = null;
  private badgeTexture!: CanvasTexture;
  private badgeShown = -1;
  private headWorld!: Vector3;
  private headRef!: Vector3;
  private headFwd!: Vector3;
  private headQ!: Quaternion;
  private toItem!: Vector3;
  /** Menu/vocab item at the center of the learner's view (head gaze), or null. */
  private gazeItem: string | null = null;

  init(): void {
    this.headWorld = new Vector3();
    this.headRef = new Vector3();
    this.headFwd = new Vector3();
    this.headQ = new Quaternion();
    this.toItem = new Vector3();
    this.badgeCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.badgeCanvas) {
      this.badgeCanvas.width = 128;
      this.badgeCanvas.height = 128;
    }
    this.badgeTexture = new CanvasTexture(this.badgeCanvas ?? undefined);
    this.badge = new Mesh(
      new PlaneGeometry(0.07, 0.07),
      new MeshBasicMaterial({ map: this.badgeTexture, transparent: true, depthTest: false, side: DoubleSide }),
    );
    this.badge.renderOrder = 999;
    this.badge.visible = false;
    this.badge.name = 'Finger Badge';
    // Child of the player rig, so reference-space coordinates place it directly.
    this.player.add(this.badge);
  }

  private drawBadge(n: number): void {
    if (n === this.badgeShown || !this.badgeCanvas) return;
    this.badgeShown = n;
    const ctx = this.badgeCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(22, 35, 59, 0.94)';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#e2b857';
    ctx.stroke();
    ctx.fillStyle = '#fafaf7';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 64, 68);
    this.badgeTexture.needsUpdate = true;
  }

  /** Fill buffers.joints from the frame; false when the hand is not tracked. */
  private readHand(frame: XRFrame, ref: XRReferenceSpace, hand: XRHand, b: HandBuffers): boolean {
    if (b.hand !== hand) {
      b.hand = hand;
      b.spaces.length = 0;
      for (const name of JOINT_NAMES) {
        const s = hand.get(name as XRHandJoint);
        if (!s) return false;
        b.spaces.push(s);
      }
    }
    const batch = frame as XRFrame & { fillPoses?: (spaces: ArrayLike<XRSpace>, base: XRSpace, out: Float32Array) => boolean };
    if (typeof batch.fillPoses === 'function') {
      if (!batch.fillPoses(b.spaces, ref, b.matrices)) return false;
      for (let i = 0; i < JOINT_COUNT; i++) {
        b.joints[i * 3] = b.matrices[i * 16 + 12];
        b.joints[i * 3 + 1] = b.matrices[i * 16 + 13];
        b.joints[i * 3 + 2] = b.matrices[i * 16 + 14];
      }
      return true;
    }
    for (let i = 0; i < JOINT_COUNT; i++) {
      const pose = frame.getJointPose?.(b.spaces[i], ref);
      if (!pose) return false;
      const p = pose.transform.position;
      b.joints[i * 3] = p.x;
      b.joints[i * 3 + 1] = p.y;
      b.joints[i * 3 + 2] = p.z;
    }
    return true;
  }

  update(delta: number): void {
    this.clockMs += delta * 1000;
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    const session = this.world.xrSession;
    handState.tracked.left = false;
    handState.tracked.right = false;
    if (!frame || !ref || !session) {
      this.badge.visible = false;
      return;
    }

    const viewer = frame.getViewerPose(ref);
    if (viewer) {
      const p = viewer.transform.position;
      const o = viewer.transform.orientation;
      this.headY = p.y;
      // Reference space -> world: mixed reality moves and turns the player rig onto the real table.
      this.headRef.set(p.x, p.y, p.z).applyMatrix4(this.player.matrixWorld);
      this.headQ.set(o.x, o.y, o.z, o.w).premultiply(this.player.quaternion);
      this.headFwd.set(0, 0, -1).applyQuaternion(this.headQ);
      this.gazeItem = this.itemInView();
      handState.gazeItem = this.gazeItem;
    }

    for (const source of session.inputSources) {
      const hand = source.hand;
      const side = source.handedness;
      if (!hand || (side !== 'left' && side !== 'right')) continue;
      const b = this.buffers[side];
      if (!this.readHand(frame, ref, hand, b)) continue;
      handState.tracked[side] = true;
      classifyHand(b.joints, side, handState.frames[side]);
      const w = handState.wrist[side];
      w[0] = b.joints[0];
      w[1] = b.joints[1];
      w[2] = b.joints[2];
      const t = handState.indexTip[side];
      t[0] = b.joints[27];
      t[1] = b.joints[28];
      t[2] = b.joints[29];
    }

    this.updateCount();
    this.updateThumbs();
    this.updatePalm();
    this.updateWave(delta);
  }

  /** Nearest vocabulary item to the center of view, within the gaze cone. */
  private itemInView(): string | null {
    let best: string | null = null;
    let bestAngle = GAZE_CONE_DEG;
    for (const v of VOCAB) {
      this.toItem.set(v.position[0], v.position[1] + 0.05, v.position[2]).sub(this.headRef);
      const d = this.toItem.length();
      if (d < 0.05) continue;
      const angle = (Math.acos(Math.min(1, this.toItem.dot(this.headFwd) / d)) * 180) / Math.PI;
      if (angle < bestAngle) {
        bestAngle = angle;
        best = v.id;
      }
    }
    return best;
  }

  /** A deliberate counting pose: hand up near the face, fingers pointing up (not a pointing ray pose). */
  private raised(side: Handedness): boolean {
    if (!handState.tracked[side]) return false;
    const j = this.buffers[side].joints;
    const w = handState.wrist[side];
    if (w[1] < this.headY - RAISED_BELOW_HEAD) return false;
    const dx = j[33] - w[0], dy = j[34] - w[1], dz = j[35] - w[2]; // joint 11: middle proximal
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return len > 1e-6 && dy / len > UPRIGHT_MIN;
  }

  private raisedCount(side: Handedness): number {
    const f = handState.frames[side];
    if (!this.raised(side) || f.pinching || f.palmUp) return 0;
    return f.count;
  }

  private updateCount(): void {
    const l = this.raisedCount('left');
    const r = this.raisedCount('right');
    const total = l + r;
    const stable = this.countStable.update(total, this.clockMs);
    if (stable !== null) {
      handState.fingers = stable;
      events.fingers.emit(stable);
    }

    // Badge above the raised hand with more fingers.
    const side: Handedness = r >= l ? 'right' : 'left';
    if (total > 0 && this.raised(side)) {
      const w = handState.wrist[side];
      this.badge.position.set(w[0], w[1] + 0.25, w[2]); // just above the fingertips (about 19 cm from the wrist), never over them
      this.player.head.getWorldPosition(this.headWorld);
      this.badge.lookAt(this.headWorld); // face the learner (plane front is +Z)
      this.drawBadge(total);
      this.badge.visible = true;
    } else {
      this.badge.visible = false;
    }

    this.checkFingerOrder(handState.fingers);
  }

  /** Look at a menu item (head gaze) + hold up N fingers for 1 s -> order N of it. */
  private checkFingerOrder(n: number): void {
    const target = this.gazeItem;
    const item = target ? menuItem(target) : undefined;
    const phase = store.order.phase;
    if (!item || n < 1 || n > 5 || phase === 'paying') {
      this.orderCandidate = '';
      this.orderFired = '';
      return;
    }
    const key = `${item.id}:${n}`;
    if (key !== this.orderCandidate) {
      this.orderCandidate = key;
      this.orderSince = this.clockMs;
      return;
    }
    if (this.orderFired !== key && this.clockMs - this.orderSince >= ORDER_HOLD_MS) {
      this.orderFired = key;
      const phrase = `${quantityPhrase(item, n)}, s'il vous plaît.`;
      const text = phrase.charAt(0).toUpperCase() + phrase.slice(1);
      speakFrench(text, store.profile.settings.slowSpeech ? 0.7 : 0.9, 'learner');
      events.voiceOrder.emit(text);
      void director.handle({ kind: 'say', text, fingers: n });
    }
  }

  private updateThumbs(): void {
    const f = this.pickRaised();
    const v = f ? (f.thumbsUp ? 1 : f.thumbsDown ? 2 : 0) : 0;
    const stable = this.thumbsStable.update(v, this.clockMs);
    if (stable === 1 || stable === 2) {
      const gesture = stable === 1 ? 'thumbs_up' : 'thumbs_down';
      events.gesture.emit(gesture);
      // Thumbs up while looking at an item is "1" in French counting: the order path handles it.
      // During the tutorial the gesture is an answer to the tutorial, not a conversation turn.
      if (!this.gazeItem && !appState.lessonActive) void director.handle({ kind: 'gesture', gesture, fingers: 1 });
    }
  }

  private updatePalm(): void {
    const up = (handState.tracked.left && handState.frames.left.palmUp) || (handState.tracked.right && handState.frames.right.palmUp);
    const stable = this.palmStable.update(up ? 1 : 0, this.clockMs);
    if (stable === 1 && !handState.talking) {
      handState.talking = true;
      events.gesture.emit('palm_up_start');
    } else if (stable === 0 && handState.talking) {
      handState.talking = false;
      events.gesture.emit('palm_up_end');
    }
  }

  /** Thumbs up/down: a sideways fist, so only the height matters. */
  private pickRaised(): GestureFrame | null {
    const high = (side: Handedness) => handState.tracked[side] && handState.wrist[side][1] > this.headY - 0.45;
    if (high('right')) return handState.frames.right;
    if (high('left')) return handState.frames.left;
    return null;
  }

  private updateWave(delta: number): void {
    const side: Handedness | null = this.raised('right') && handState.frames.right.openPalm && !handState.frames.right.palmUp
      ? 'right'
      : this.raised('left') && handState.frames.left.openPalm && !handState.frames.left.palmUp
        ? 'left'
        : null;
    if (!side || delta <= 0) {
      this.waveFlips = 0;
      this.waveDir = 0;
      return;
    }
    const x = handState.wrist[side][0];
    const vx = (x - this.waveLastX) / delta;
    this.waveLastX = x;
    const dir = vx > 0.25 ? 1 : vx < -0.25 ? -1 : 0;
    if (dir !== 0 && dir !== this.waveDir) {
      if (this.waveFlips === 0) this.waveWindowStart = this.clockMs;
      this.waveFlips++;
      this.waveDir = dir;
    }
    if (this.clockMs - this.waveWindowStart > 1500) this.waveFlips = 0;
    if (this.waveFlips >= 3 && this.clockMs - this.lastWave > 4000) {
      this.lastWave = this.clockMs;
      this.waveFlips = 0;
      events.gesture.emit('wave');
      if (!appState.lessonActive) void director.handle({ kind: 'gesture', gesture: 'wave', fingers: 0 });
    }
  }
}
