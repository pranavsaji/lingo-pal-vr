/**
 * Procedural animation for a rigged human (Microsoft Rocketbox avatars, 3ds Max
 * Biped skeleton: "Bip01_Head", "Bip01_L_UpperArm", "Bip01_MJaw", ...).
 *
 * Every driven joint is posed by a rotation E expressed in the character's REST
 * space (root space with the skeleton in its bind pose), pivoting at the joint:
 *   local = P0^-1 * E * P0 * q0
 * where q0 is the bone's rest local rotation and P0 its parent's rest rotation in
 * root space. With that rule a chain composes like forward kinematics: the world
 * rotation of a bone is E_root..E_parent * E_bone * W0, so a child's E is relative
 * to its (already posed) parent, exactly like nested Object3D groups, regardless
 * of the Biped's odd bone-local axes.
 *
 * Arms map the procedural Madame Lune convention (upper arm hanging along -Y,
 * Euler(armX, 0, armZ) swings it; forearm bends about X) onto the A-posed bind
 * pose through a per-arm "straighten" rotation computed once at bind time. Legs
 * (optional, `legs: true`) use the same scheme, so a seated pose is three angles
 * per leg. Body language (torso lean, weight shift, wrist flex, finger grip) rides
 * on the spine, pelvis, hand and finger joints.
 * Zero allocations per frame: every temporary is a class field.
 */

import { Euler, type Matrix4, type Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import type { CharacterDriver, CharacterPose } from './character-pose.js';

const DOWN = new Vector3(0, -1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Normalised bone key: lower-case alphanumerics without the "bip01" prefix ("Bip01_L_UpperArm" -> "lupperarm"). */
export function boneKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^bip\d\d/, '');
}

/** Index every node under `root` by its normalised bone key (first match wins). */
export function indexBones(root: Object3D): Map<string, Object3D> {
  const map = new Map<string, Object3D>();
  root.traverse((o) => {
    if (!(o as { isBone?: boolean }).isBone) return;
    const k = boneKey(o.name);
    if (k && !map.has(k)) map.set(k, o);
  });
  return map;
}

/** One driven bone with its rest frames (all in the character root's space). */
export class Joint {
  readonly q0: Quaternion;
  readonly p0 = new Quaternion();
  readonly p0inv = new Quaternion();
  readonly w0 = new Quaternion();
  readonly pos0: Vector3;
  /** Rest position of the bone in root space. */
  readonly world0 = new Vector3();
  private readonly tmp = new Vector3();

  constructor(readonly bone: Object3D, rootInvQ: Quaternion, rootInvM: { applyTo(v: Vector3): Vector3 }) {
    this.q0 = bone.quaternion.clone();
    this.pos0 = bone.position.clone();
    if (bone.parent) bone.parent.getWorldQuaternion(this.p0);
    this.p0.premultiply(rootInvQ);
    this.p0inv.copy(this.p0).invert();
    bone.getWorldQuaternion(this.w0).premultiply(rootInvQ);
    bone.getWorldPosition(this.world0);
    rootInvM.applyTo(this.world0);
  }

  /** Pose by a rest-space rotation pivoting at this joint. */
  rotate(e: Quaternion): void {
    this.bone.quaternion.copy(this.p0inv).multiply(e).multiply(this.p0).multiply(this.q0);
  }

  /** Shift from the rest position by a rest-space offset (follows the posed parent). */
  offset(x: number, y: number, z: number): void {
    this.tmp.set(x, y, z).applyQuaternion(this.p0inv);
    this.bone.position.copy(this.pos0).add(this.tmp);
  }

  reset(): void {
    this.bone.quaternion.copy(this.q0);
    this.bone.position.copy(this.pos0);
  }
}

interface FingerSeg {
  joint: Joint;
  /** Rest-space curl axis (rotating the segment toward the palm). */
  axis: Vector3;
  /** 0 = thumb, 1 = index, 2..4 = middle, ring, pinky. */
  finger: number;
  seg: number;
}

interface Arm {
  side: 1 | -1;
  clav: Joint | null;
  upper: Joint;
  fore: Joint;
  hand: Joint | null;
  /** Rotates the bind-pose upper arm to hang straight down. */
  fixU: Quaternion;
  fixUinv: Quaternion;
  /** In the straightened frame, removes the bind-pose elbow bend. */
  fixF: Quaternion;
  /** Rest-space rotation that lines the bind-pose hand up with the forearm (straight wrist). */
  wrist: Quaternion;
  /** Rest-space wrist flex axis (+ angle bends the hand toward the palm); null without finger bones. */
  flexAxis: Vector3 | null;
  fingers: FingerSeg[];
}

interface Leg {
  side: 1 | -1;
  thigh: Joint;
  calf: Joint;
  foot: Joint | null;
  /** Rotates the bind-pose thigh to hang straight down. */
  fixT: Quaternion;
  fixTinv: Quaternion;
  /** fixC * fixT: straightens thigh and shin; and its inverse (for the foot). */
  fixTC: Quaternion;
  fixTCinv: Quaternion;
}

/** Tunables that differ slightly per avatar. */
export interface HumanRigOptions {
  /** Added to |armZ| so relaxed arms clear the hips (radians). */
  armClearance?: number;
  /** Forearm pronation so resting palms face down/inward (radians). */
  pronation?: number;
  /** Jaw rotation at mouthOpen = 1 (radians). */
  jawOpen?: number;
  /** Resting smile: mouth-corner lift in metres. */
  smile?: number;
  /** Drive the legs from the pose (seated or standing customers). Off: legs keep the bind pose. */
  legs?: boolean;
}

/** Weight shift at hipSway = 1: hip slide (m) and pelvis tilt (rad). */
const SWAY_SHIFT = 0.018;
const SWAY_ROLL = 0.04;
/** Hip-to-ankle length used to keep the feet planted while the hips slide (m). */
const LEG_LENGTH = 0.85;

const FINGER_REST = [0.12, 0.22, 0.28, 0.32, 0.36]; // thumb..pinky, per segment
const FINGER_FIST = [0.45, 1.25, 1.4, 1.45, 1.5];

export class HumanRig implements CharacterDriver {
  readonly head: Object3D;
  readonly leftShoulder: Object3D;
  readonly rightShoulder: Object3D;
  readonly boneCount: number;
  /** Rest height of the hip joints above the root (m): seat a rig by lowering its root to seat + ~0.1 - hipHeight. */
  readonly hipHeight: number;
  /** Which optional features this skeleton supports (for diagnostics). */
  readonly features: { jaw: boolean; lids: boolean; eyes: boolean; fingers: boolean; legs: boolean };

  private readonly neck: Joint | null;
  private readonly headJ: Joint;
  private readonly spine2: Joint | null;
  private readonly spine1: Joint | null;
  private readonly pelvis: Joint | null;
  private readonly legs: Leg[] = [];
  private readonly jaw: Joint | null;
  private readonly eyes: Joint[] = [];
  private readonly lidTop: Joint[] = [];
  private readonly lidBot: Joint[] = [];
  private readonly corners: Array<{ j: Joint; side: number }> = [];
  private readonly lidTravel: number;
  private readonly arms: Arm[];
  private readonly opts: Required<HumanRigOptions>;
  // Per-frame temporaries.
  private readonly e = new Euler();
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();

  constructor(readonly root: Object3D, options: HumanRigOptions = {}) {
    this.opts = { armClearance: 0.1, pronation: 0.9, jawOpen: 0.14, smile: 0.0028, legs: false, ...options };
    root.updateMatrixWorld(true);
    const rootInvQ = root.getWorldQuaternion(new Quaternion()).invert();
    const rootInv = root.matrixWorld.clone().invert();
    const toRoot = { applyTo: (v: Vector3) => v.applyMatrix4(rootInv) };
    const bones = indexBones(root);
    this.boneCount = bones.size;
    const opt = (k: string): Joint | null => {
      const b = bones.get(k);
      return b ? new Joint(b, rootInvQ, toRoot) : null;
    };
    const req = (k: string): Joint => {
      const j = opt(k);
      if (!j) throw new Error(`HumanRig: missing bone "${k}"`);
      return j;
    };

    this.headJ = req('head');
    this.neck = opt('neck');
    this.spine2 = opt('spine2');
    this.spine1 = opt('spine1');
    this.pelvis = opt('pelvis');
    this.jaw = opt('mjaw');
    for (const s of ['l', 'r']) {
      const eye = opt(`${s}eye`);
      if (eye) this.eyes.push(eye);
      const top = opt(`${s}eyeblinktop`);
      const bot = opt(`${s}eyeblinkbottom`);
      if (top && bot) {
        this.lidTop.push(top);
        this.lidBot.push(bot);
      }
      const corner = opt(`${s}mouthcorner`);
      if (corner) this.corners.push({ j: corner, side: s === 'l' ? 1 : -1 });
    }
    this.lidTravel = this.lidTop.length ? Math.max(0.004, (this.lidTop[0].world0.y - this.lidBot[0].world0.y) * 0.85) : 0;

    this.arms = (['l', 'r'] as const).map((s) => this.bindArm(s, req, opt, bones, rootInv));
    if (this.opts.legs) {
      for (const s of ['l', 'r'] as const) {
        const leg = this.bindLeg(s, opt);
        if (leg) this.legs.push(leg);
      }
    }
    this.hipHeight = this.legs.length ? this.legs[0].thigh.world0.y : (this.pelvis?.world0.y ?? 0);
    this.head = this.headJ.bone;
    this.leftShoulder = this.arms[0].upper.bone;
    this.rightShoulder = this.arms[1].upper.bone;
    this.features = {
      jaw: !!this.jaw,
      lids: this.lidTop.length === 2,
      eyes: this.eyes.length === 2,
      fingers: this.arms[0].fingers.length > 0,
      legs: this.legs.length === 2,
    };
  }

  private bindLeg(s: 'l' | 'r', opt: (k: string) => Joint | null): Leg | null {
    const thigh = opt(`${s}thigh`);
    const calf = opt(`${s}calf`);
    if (!thigh || !calf) return null;
    const foot = opt(`${s}foot`);
    const ankle = foot ? foot.world0 : calf.world0;
    const dT = new Vector3().subVectors(calf.world0, thigh.world0).normalize();
    const dC = new Vector3().subVectors(ankle, calf.world0).normalize();
    const fixT = new Quaternion().setFromUnitVectors(dT, DOWN);
    const fixC = foot ? new Quaternion().setFromUnitVectors(dC.clone().applyQuaternion(fixT), DOWN) : new Quaternion();
    const fixTC = fixC.clone().multiply(fixT);
    return { side: s === 'l' ? 1 : -1, thigh, calf, foot, fixT, fixTinv: fixT.clone().invert(), fixTC, fixTCinv: fixTC.clone().invert() };
  }

  private bindArm(
    s: 'l' | 'r',
    req: (k: string) => Joint,
    opt: (k: string) => Joint | null,
    bones: Map<string, Object3D>,
    rootInv: Matrix4,
  ): Arm {
    const side = s === 'l' ? 1 : -1;
    const upper = req(`${s}upperarm`);
    const fore = req(`${s}forearm`);
    const hand = opt(`${s}hand`);
    const clav = opt(`${s}clavicle`);
    const wristPos = hand ? hand.world0 : fore.world0;
    const dU = new Vector3().subVectors(fore.world0, upper.world0).normalize();
    const dF = new Vector3().subVectors(wristPos, fore.world0).normalize();
    const fixU = new Quaternion().setFromUnitVectors(dU, DOWN);
    const fixF = new Quaternion().setFromUnitVectors(dF.clone().applyQuaternion(fixU), DOWN);

    // Fingers: curl axis = segment direction x palm normal (rest space).
    const fingers: FingerSeg[] = [];
    let flexAxis: Vector3 | null = null;
    if (hand) {
      const idx = opt(`${s}finger1`);
      const pinky = opt(`${s}finger4`) ?? opt(`${s}finger3`);
      if (idx && pinky) {
        const a = new Vector3().subVectors(idx.world0, hand.world0);
        const b = new Vector3().subVectors(pinky.world0, hand.world0);
        const palm = new Vector3().crossVectors(b, a).multiplyScalar(side).normalize();
        const flex = new Vector3().crossVectors(dF, palm);
        if (flex.lengthSq() > 1e-8) flexAxis = flex.normalize();
        for (let f = 0; f <= 4; f++) {
          let prev = hand;
          for (let seg = 0; seg < 3; seg++) {
            const j = opt(seg === 0 ? `${s}finger${f}` : `${s}finger${f}${seg}`);
            if (!j) continue;
            const next = bones.get(`${s}finger${f}${seg + 1}`);
            const dir = next
              ? next.getWorldPosition(new Vector3()).applyMatrix4(rootInv).sub(j.world0)
              : new Vector3().subVectors(j.world0, prev.world0);
            prev = j;
            dir.normalize();
            const axis = new Vector3().crossVectors(dir, palm);
            if (axis.lengthSq() < 1e-8) continue;
            fingers.push({ joint: j, axis: axis.normalize(), finger: f, seg });
          }
        }
      }
    }
    const wrist = new Quaternion();
    const mid = opt(`${s}finger2`);
    if (hand && mid) {
      const dH = new Vector3().subVectors(mid.world0, hand.world0).normalize();
      wrist.setFromUnitVectors(dH, dF);
    }
    return { side, clav, upper, fore, hand, fixU, fixUinv: fixU.clone().invert(), fixF, wrist, flexAxis, fingers };
  }

  apply(p: CharacterPose): void {
    const { e, qa } = this;
    // Weight shift: the hips slide toward the standing leg and tip up on that side;
    // the spine leans the other way so the head stays over the feet.
    const roll = p.hipSway * SWAY_ROLL;
    if (this.pelvis) {
      this.pelvis.offset(p.hipSway * SWAY_SHIFT, 0, 0);
      this.pelvis.rotate(qa.setFromAxisAngle(Z_AXIS, roll));
    }
    const torsoRoll = p.torsoRoll - (this.pelvis ? roll * 1.3 : 0);
    // Torso lean split over the two upper spine joints (the thighs hang off the lower spine).
    if (this.spine1) {
      e.set(p.torsoPitch * 0.5, p.torsoYaw * 0.5, torsoRoll * 0.5);
      this.spine1.rotate(qa.setFromEuler(e));
    }
    // Breathing: chest rises a touch, shoulders follow.
    if (this.spine2) {
      const k = this.spine1 ? 0.5 : 1;
      e.set(p.torsoPitch * k - p.breath * 0.012, p.torsoYaw * k, torsoRoll * k);
      this.spine2.rotate(qa.setFromEuler(e));
    }
    if (this.legs.length) {
      // Keep the legs plumb (and the feet planted) under the shifted, tipped hips.
      const lean = -roll - (this.pelvis ? (p.hipSway * SWAY_SHIFT) / LEG_LENGTH : 0);
      this.poseLeg(this.legs[0], p.lThighX, p.lThighZ + lean, p.lKnee, p.lFoot);
      this.poseLeg(this.legs[1], p.rThighX, p.rThighZ + lean, p.rKnee, p.rFoot);
    }
    // Head: split between neck (40%) and head (60%).
    if (this.neck) {
      e.set(p.headPitch * 0.4, p.headYaw * 0.4, p.headRoll * 0.4);
      this.neck.rotate(qa.setFromEuler(e));
      e.set(p.headPitch * 0.6, p.headYaw * 0.6, p.headRoll * 0.6);
    } else e.set(p.headPitch, p.headYaw, p.headRoll);
    this.headJ.rotate(qa.setFromEuler(e));

    for (const eye of this.eyes) {
      e.set(p.eyePitch, p.eyeYaw, 0);
      eye.rotate(qa.setFromEuler(e));
    }
    if (this.jaw) this.jaw.rotate(qa.setFromAxisAngle(X_AXIS, p.mouthOpen * this.opts.jawOpen));
    for (const c of this.corners) {
      const sm = this.opts.smile * (1 - 0.6 * p.mouthOpen);
      c.j.offset(c.side * sm * 0.5, sm, 0);
    }
    if (this.lidTop.length) {
      const d = p.blink * this.lidTravel;
      for (const j of this.lidTop) j.offset(0, -d, 0);
      for (const j of this.lidBot) j.offset(0, d * 0.18, 0);
    }

    const sh = p.breath * 0.015 + p.shoulderRaise * 0.22;
    this.poseArm(this.arms[0], p.lArmX, p.lArmZ, p.lArmY, p.lForearmX, p.lTwist, p.lPoint, sh, p.lWrist, p.lGrip);
    this.poseArm(this.arms[1], p.rArmX, p.rArmZ, p.rArmY, p.rForearmX, p.rTwist, p.rPoint, sh, p.rWrist, p.rGrip);
  }

  private poseLeg(leg: Leg, tx: number, tz: number, knee: number, foot: number): void {
    const { e, qa, qb } = this;
    e.set(tx, 0, tz);
    leg.thigh.rotate(qa.setFromEuler(e).multiply(leg.fixT));
    // Shin: E_c = fixT^-1 * Rx(knee) * fixC * fixT, relative to the posed thigh.
    qa.copy(leg.fixTinv).multiply(qb.setFromAxisAngle(X_AXIS, knee)).multiply(leg.fixTC);
    leg.calf.rotate(qa);
    // Foot keeps its bind relation to the straightened shin, then flexes (toes up for foot > 0).
    if (leg.foot) {
      qa.copy(leg.fixTCinv).multiply(qb.setFromAxisAngle(X_AXIS, -foot)).multiply(leg.fixTC);
      leg.foot.rotate(qa);
    }
  }

  private poseArm(
    arm: Arm,
    ax: number,
    az: number,
    ay: number,
    fx: number,
    twist: number,
    point: number,
    shoulder: number,
    flex: number,
    grip: number,
  ): void {
    const { e, qa, qb } = this;
    const s = arm.side;
    if (arm.clav) arm.clav.rotate(qa.setFromAxisAngle(Z_AXIS, s * shoulder));
    // Keep relaxed arms clear of the hips; fade the clearance out as the arm lifts.
    const lift = Math.min(1, Math.abs(ax) / 1.2);
    const z = az + s * this.opts.armClearance * (1 - lift);
    e.set(ax, 0, z);
    // Inward rotation about the (straightened, hanging) upper arm's own axis, then the swing.
    qa.setFromEuler(e);
    if (ay !== 0) qa.multiply(qb.setFromAxisAngle(Y_AXIS, -s * ay));
    qa.multiply(arm.fixU);
    arm.upper.rotate(qa);

    // Forearm: E_f = fixU^-1 * Rx(fx) * Ry(pronation) * fixF * fixU (less pronation when pointing).
    const pron = -s * (this.opts.pronation * (1 - 0.7 * point) - twist);
    qa.copy(arm.fixUinv);
    qa.multiply(qb.setFromAxisAngle(X_AXIS, fx));
    qa.multiply(qb.setFromAxisAngle(Y_AXIS, pron));
    qa.multiply(arm.fixF).multiply(arm.fixU);
    arm.fore.rotate(qa);
    // Wrist: partly straightened at rest, fully when pointing; then flexed.
    if (arm.hand) {
      qa.identity().slerp(arm.wrist, 0.3 + 0.7 * point);
      if (arm.flexAxis && flex !== 0) qa.premultiply(qb.setFromAxisAngle(arm.flexAxis, flex * (1 - point)));
      arm.hand.rotate(qa);
    }

    const g = Math.max(-1, Math.min(1, grip));
    for (const f of arm.fingers) {
      const base = FINGER_REST[f.finger];
      const rest = g >= 0 ? base + (FINGER_FIST[f.finger] - base) * g : base * (1 + 0.85 * g);
      // Pointing: index straight, thumb and the others curled into a loose fist.
      const target = f.finger === 1 ? 0 : FINGER_FIST[f.finger];
      const a = rest + (target - rest) * point;
      f.joint.rotate(qa.setFromAxisAngle(f.axis, f.seg === 0 && f.finger !== 0 ? a * 0.8 : a));
    }
  }

  /** Back to the bind pose (A-pose). */
  reset(): void {
    const all: Array<Joint | null> = [
      this.headJ, this.neck, this.spine2, this.spine1, this.pelvis, this.jaw, ...this.eyes, ...this.lidTop, ...this.lidBot,
    ];
    for (const l of this.legs) all.push(l.thigh, l.calf, l.foot);
    for (const c of this.corners) all.push(c.j);
    for (const a of this.arms) {
      all.push(a.clav, a.upper, a.fore, a.hand);
      for (const f of a.fingers) all.push(f.joint);
    }
    for (const j of all) j?.reset();
  }
}

/**
 * Ready a loaded avatar for the shop: it casts shadows (it does not receive them,
 * which would put shadow-map acne on the face), skips frustum culling (bind-pose
 * bounds do not cover raised arms), and keeps cloth/skin fully dielectric.
 */
export function prepareAvatar(root: Object3D, name: string): void {
  root.name = name;
  root.traverse((o) => {
    const mesh = o as Object3D & { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    o.frustumCulled = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats as Array<{ metalness?: number; roughness?: number } | undefined>) {
      if (!m) continue;
      if (m.metalness !== undefined) m.metalness = 0;
      if (m.roughness !== undefined) m.roughness = Math.max(0.5, m.roughness);
    }
  });
}
