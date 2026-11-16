/**
 * The friend at the counter. Shown as a real person (a Rocketbox human, the same
 * rig as the shop's customers: `setPerson`) standing at the counter end: the body
 * turns with the friend's head, the head looks where they look, the mouth moves
 * when they talk. Until that model has loaded (or if it fails) a stylized low-poly
 * stand-in is shown:
 *  - head (with a headset visor) and a simple torso that follows the head's yaw;
 *  - both hands as 25 joint spheres each, in ONE InstancedMesh;
 *  - for a browser (2D) friend, a pointer: a dot where their mouse points on the
 *    counter and a thin beam from their head;
 *  - a name tag that also shows what they just said.
 * About 7 draw calls, no allocation per frame.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  type Object3D,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { createPose, type CharacterPose } from '../world/characters/character-pose.js';
import type { HumanRig } from '../world/characters/human-rig.js';
import { F_LEFT, F_POINTER, F_RIGHT, JOINTS, P_HEAD, P_LEFT, P_POINTER, P_RIGHT, seatPoint, seatQuat, type Seat } from './protocol.js';

const SKIN = 0x2a9d8f;
const TIP = new Set([4, 9, 14, 19, 24]);
const NECK = 0.34;

export class FriendAvatar {
  readonly root = new Group();
  private head = new Group();
  private headMat: MeshStandardMaterial;
  private body: Mesh;
  private joints: InstancedMesh;
  private dot: Mesh;
  private beam: Line;
  private beamPos: Float32Array;
  private tag: Mesh;
  private tagCanvas: HTMLCanvasElement | null = null;
  private tagTex: CanvasTexture | null = null;
  private m = new Matrix4();
  private v = new Vector3();
  private s = new Vector3();
  private q = new Quaternion();
  private fwd = new Vector3();
  private p = new Float32Array(4);
  private shown = { left: false, right: false };
  /** The human body, once loaded: root (feet), rig, pose, current body yaw. */
  private person: { root: Object3D; rig: HumanRig; pose: CharacterPose; yaw: number; placed: boolean } | null = null;
  private talk = 0;
  private blinkIn = 2.5;
  private blinkT = -1;
  private headBone = new Vector3();

  constructor() {
    this.root.name = 'FriendAvatar';
    this.headMat = new MeshStandardMaterial({ color: SKIN, roughness: 0.55, emissive: SKIN, emissiveIntensity: 0.08 });
    const skull = new Mesh(new SphereGeometry(0.1, 20, 14), this.headMat);
    skull.scale.set(0.92, 1.12, 1);
    const visor = new Mesh(new SphereGeometry(0.1, 16, 8, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.36, Math.PI * 0.26) /* front band (-Z) */, new MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.25, metalness: 0.4 }));
    visor.scale.set(0.98, 1.1, 1.06);
    this.head.add(skull, visor);

    // Shoulders and chest: a soft capsule, slightly flattened front to back.
    this.body = new Mesh(new CapsuleGeometry(0.12, 0.2, 6, 14), new MeshStandardMaterial({ color: 0x1d3557, roughness: 0.85 }));
    this.body.scale.set(1.25, 1, 0.7);

    this.joints = new InstancedMesh(new SphereGeometry(1, 8, 6), new MeshStandardMaterial({ color: 0xfafaf7, roughness: 0.5, emissive: SKIN, emissiveIntensity: 0.25 }), JOINTS * 2);
    this.joints.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < JOINTS * 2; i++) this.joints.setMatrixAt(i, this.m);

    this.dot = new Mesh(new SphereGeometry(0.018, 12, 8), new MeshBasicMaterial({ color: 0xf5d90a }));
    this.beamPos = new Float32Array(6);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.beamPos, 3));
    this.beam = new Line(g, new LineBasicMaterial({ color: 0xf5d90a, transparent: true, opacity: 0.6 }));
    this.beam.frustumCulled = false;

    this.tag = new Mesh(new PlaneGeometry(0.4, 0.1), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
    this.tag.renderOrder = 10;

    this.root.add(this.head, this.body, this.joints, this.dot, this.beam, this.tag);
    this.root.visible = false;
    this.setLabel('', '');
  }

  /** Name tag: name, plus the last thing they said (two lines, wrapped). */
  setLabel(name: string, said: string): void {
    if (typeof document === 'undefined') return;
    if (!this.tagCanvas) {
      this.tagCanvas = document.createElement('canvas');
      this.tagCanvas.width = 512;
      this.tagCanvas.height = 128;
      this.tagTex = new CanvasTexture(this.tagCanvas);
      this.tagTex.colorSpace = SRGBColorSpace;
      (this.tag.material as MeshBasicMaterial).map = this.tagTex;
    }
    const c = this.tagCanvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 512, 128);
    const h = said ? 128 : 60;
    c.fillStyle = 'rgba(29, 53, 87, 0.88)';
    c.beginPath();
    c.roundRect(4, 128 - h, 504, h - 4, 22);
    c.fill();
    c.fillStyle = '#f5d90a';
    c.font = 'bold 36px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(name, 256, said ? 30 : 128 - h / 2);
    if (said) {
      c.fillStyle = '#fafaf7';
      c.font = '26px sans-serif';
      const text = said.length > 64 ? `${said.slice(0, 62)}…` : said;
      const mid = text.length > 32 ? text.lastIndexOf(' ', 34) : -1;
      if (mid > 0) {
        c.fillText(`« ${text.slice(0, mid)}`, 256, 72);
        c.fillText(`${text.slice(mid + 1)} »`, 256, 104);
      } else c.fillText(`« ${text} »`, 256, 86);
    }
    this.tagTex!.needsUpdate = true;
  }

  /** Voice activity (0..1) brightens the head. */
  setTalking(level: number): void {
    this.headMat.emissiveIntensity = 0.08 + Math.min(1, level) * 0.6;
    this.talk = Math.min(1, level);
  }

  /** Swap the stand-in for a real person (a prepared Rocketbox avatar and its rig). */
  setPerson(root: Object3D, rig: HumanRig): void {
    if (this.person) this.root.remove(this.person.root);
    this.person = { root, rig, pose: createPose(), yaw: 0, placed: false };
    this.root.add(root);
    this.head.visible = false;
    this.body.visible = false;
    this.joints.visible = false; // their arms are the person's own; floating joint dots would read as a ghost
  }

  /** True once the friend is shown as a person (not the stand-in). */
  get isPerson(): boolean {
    return this.person !== null;
  }

  /**
   * Place the avatar from a pose in the friend's own space, seen from `seat`.
   * `origin` is my player rig position (world = player space + origin).
   */
  apply(flags: number, d: Float32Array, seat: Seat, origin: Vector3, viewer: Vector3, dt = 1 / 72): void {
    this.root.visible = true;
    this.root.position.copy(origin);
    const p = this.p;
    seatPoint(seat, d[P_HEAD], d[P_HEAD + 1], d[P_HEAD + 2], p);
    this.head.position.set(p[0], p[1], p[2]);
    seatQuat(seat, d[P_HEAD + 3], d[P_HEAD + 4], d[P_HEAD + 5], d[P_HEAD + 6], p);
    this.head.quaternion.set(p[0], p[1], p[2], p[3]);

    // Torso: below the head, turned with the head's yaw only.
    this.fwd.set(0, 0, -1).applyQuaternion(this.head.quaternion);
    const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    this.body.position.set(this.head.position.x + Math.sin(yaw) * 0.06, this.head.position.y - NECK, this.head.position.z + Math.cos(yaw) * 0.06);
    this.body.rotation.set(0, yaw, 0);

    if (this.person) this.posePerson(this.person, dt);
    else {
      this.hand(flags & F_LEFT, d, P_LEFT, 0, seat, 'left');
      this.hand(flags & F_RIGHT, d, P_RIGHT, JOINTS, seat, 'right');
    }

    const pointer = (flags & F_POINTER) !== 0;
    this.dot.visible = pointer;
    this.beam.visible = pointer;
    if (pointer) {
      seatPoint(seat, d[P_POINTER], d[P_POINTER + 1], d[P_POINTER + 2], p);
      this.dot.position.set(p[0], p[1], p[2]);
      const b = this.beamPos;
      b[0] = this.head.position.x;
      b[1] = this.head.position.y - 0.08;
      b[2] = this.head.position.z;
      b[3] = p[0];
      b[4] = p[1];
      b[5] = p[2];
      (this.beam.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    }

    if (this.person) {
      // Above the person's own head (a standing body can be taller than a seated friend's eyes).
      this.person.rig.head.getWorldPosition(this.headBone).sub(this.root.position);
      this.tag.position.set(this.headBone.x, this.headBone.y + 0.24, this.headBone.z);
    } else this.tag.position.set(this.head.position.x, this.head.position.y + 0.21, this.head.position.z);
    this.tag.lookAt(viewer);
  }

  /**
   * The person stands at the counter end under the friend's head: the body turns
   * toward where they face (lagging, like a real turn), the head covers the rest
   * (up to ~60 degrees), pitch from the headset. Blinks, breathes, talks.
   */
  private posePerson(p: NonNullable<FriendAvatar['person']>, dt: number): void {
    const f = this.fwd; // head forward, set in apply()
    const face = Math.atan2(f.x, f.z); // 0 faces +Z, the Rocketbox convention
    if (!p.placed) {
      p.yaw = face;
      p.placed = true;
    }
    let rel = Math.atan2(Math.sin(face - p.yaw), Math.cos(face - p.yaw));
    // The body follows once the head is turned well past the shoulders.
    if (Math.abs(rel) > 0.5) p.yaw += (rel - Math.sign(rel) * 0.5) * Math.min(1, dt * 3);
    p.yaw += rel * Math.min(1, dt * 0.6);
    rel = Math.atan2(Math.sin(face - p.yaw), Math.cos(face - p.yaw));
    p.root.rotation.set(0, p.yaw, 0);
    // Feet on the floor, a little behind the eyes (the head sits forward of the spine).
    p.root.position.set(this.head.position.x - Math.sin(p.yaw) * 0.08, 0, this.head.position.z - Math.cos(p.yaw) * 0.08);
    const pose = p.pose;
    pose.headYaw = Math.max(-1.05, Math.min(1.05, rel));
    pose.headPitch = Math.max(-0.6, Math.min(0.7, -Math.asin(Math.max(-1, Math.min(1, f.y)))));
    pose.torsoYaw = pose.headYaw * 0.15;
    pose.mouthOpen += (this.talk * 0.9 - pose.mouthOpen) * Math.min(1, dt * 14);
    pose.breath = Math.sin(performance.now() / 700);
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blinkT = 0;
      this.blinkIn = 2 + Math.random() * 3;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      pose.blink = this.blinkT < 0.08 ? this.blinkT / 0.08 : Math.max(0, 1 - (this.blinkT - 0.08) / 0.1);
      if (this.blinkT > 0.18) this.blinkT = -1;
    }
    p.rig.apply(pose);
  }

  private hand(on: number, d: Float32Array, start: number, base: number, seat: Seat, side: 'left' | 'right'): void {
    if (!on) {
      if (this.shown[side]) {
        this.m.makeScale(0, 0, 0);
        for (let i = 0; i < JOINTS; i++) this.joints.setMatrixAt(base + i, this.m);
        this.joints.instanceMatrix.needsUpdate = true;
        this.shown[side] = false;
      }
      return;
    }
    this.shown[side] = true;
    const p = this.p;
    this.q.identity();
    for (let i = 0; i < JOINTS; i++) {
      const o = start + i * 3;
      seatPoint(seat, d[o], d[o + 1], d[o + 2], p);
      const r = i === 0 ? 0.02 : TIP.has(i) ? 0.0095 : 0.0078;
      this.v.set(p[0], p[1], p[2]);
      this.s.set(r, r, r);
      this.m.compose(this.v, this.q, this.s);
      this.joints.setMatrixAt(base + i, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;
  }

  headWorldPosition(out: Vector3): Vector3 {
    return out.copy(this.head.position).add(this.root.position);
  }

  hide(): void {
    this.root.visible = false;
  }
}
