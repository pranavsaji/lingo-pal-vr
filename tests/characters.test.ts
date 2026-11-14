import { describe, expect, it, vi } from 'vitest';

// The rig only needs Three classes; map @iwsdk/core onto three for Node (see models.test.ts).
vi.mock('@iwsdk/core', async () => await import('three'));

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, Euler, Group, Quaternion, Vector3 } from 'three';
import { createPose, REST_ARMS } from '../src/world/characters/character-pose';
import { aimArm, EMOTE_SECONDS, emoteEnvelope, lipFlap, poseEmote } from '../src/world/characters/gestures';
import { boneKey, HumanRig } from '../src/world/characters/human-rig';
import { ProceduralLuneDriver } from '../src/world/characters/procedural-driver';
import { SHOPKEEPER_POS, SHOPKEEPERS } from '../src/world/characters/shopkeepers';
import { PLACE_ORDER } from '../src/places/places';
import { buildMadameLune } from '../src/models/cafe-models';

// ---------------------------------------------------------------------------
// A synthetic Biped skeleton in the A-pose, in metres, facing +Z. Every bone gets an
// arbitrary local orientation (like 3ds Max Biped's odd axes) so the tests prove the
// rig works in rest space regardless of bone-local axes.
// ---------------------------------------------------------------------------
type Spec = [name: string, parent: string | null, pos: [number, number, number]];
function skeletonSpec(opts: { jaw?: boolean; fingers?: boolean } = {}): Spec[] {
  const s: Spec[] = [
    ['Bip01', null, [0, 0.92, 0]],
    ['Bip01_Pelvis', 'Bip01', [0, 0.92, 0]],
    ['Bip01_Spine', 'Bip01_Pelvis', [0, 1.04, 0]],
    ['Bip01_Spine1', 'Bip01_Spine', [0, 1.17, 0]],
    ['Bip01_Spine2', 'Bip01_Spine1', [0, 1.29, -0.02]],
    ['Bip01_Neck', 'Bip01_Spine2', [0, 1.45, -0.07]],
    ['Bip01_Head', 'Bip01_Neck', [0, 1.52, -0.056]],
    ['Bip01_MNose', 'Bip01_Head', [0, 1.584, 0.068]],
    ['Bip01_LEye', 'Bip01_Head', [0.03, 1.612, 0.029]],
    ['Bip01_REye', 'Bip01_Head', [-0.03, 1.612, 0.029]],
    ['Bip01_LEyeBlinkTop', 'Bip01_Head', [0.032, 1.619, 0.039]],
    ['Bip01_REyeBlinkTop', 'Bip01_Head', [-0.032, 1.619, 0.039]],
    ['Bip01_LEyeBlinkBottom', 'Bip01_Head', [0.033, 1.605, 0.039]],
    ['Bip01_REyeBlinkBottom', 'Bip01_Head', [-0.033, 1.605, 0.039]],
  ];
  if (opts.jaw !== false) {
    s.push(['Bip01_MJaw', 'Bip01_Head', [0, 1.551, -0.04]], ['Bip01_MBottomLip', 'Bip01_MJaw', [0, 1.539, 0.067]]);
  }
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const x = (v: number) => side * v;
    s.push(
      [`Bip01_${S}_Clavicle`, 'Bip01_Neck', [x(0.077), 1.403, -0.056]],
      [`Bip01_${S}_UpperArm`, `Bip01_${S}_Clavicle`, [x(0.172), 1.38, -0.061]],
      [`Bip01_${S}_Forearm`, `Bip01_${S}_UpperArm`, [x(0.359), 1.21, -0.063]],
      [`Bip01_${S}_Hand`, `Bip01_${S}_Forearm`, [x(0.524), 1.063, 0.031]],
    );
    if (opts.fingers !== false) {
      s.push(
        [`Bip01_${S}_Finger1`, `Bip01_${S}_Hand`, [x(0.567), 0.997, 0.084]],
        [`Bip01_${S}_Finger11`, `Bip01_${S}_Finger1`, [x(0.586), 0.967, 0.097]],
        [`Bip01_${S}_Finger12`, `Bip01_${S}_Finger11`, [x(0.593), 0.947, 0.104]],
        [`Bip01_${S}_Finger2`, `Bip01_${S}_Hand`, [x(0.577), 0.994, 0.066]],
        [`Bip01_${S}_Finger4`, `Bip01_${S}_Hand`, [x(0.572), 0.987, 0.024]],
      );
    }
  }
  return s;
}

function buildSkeleton(opts: { jaw?: boolean; fingers?: boolean; head?: boolean } = {}): { root: Group; bones: Map<string, Bone> } {
  const root = new Group();
  const bones = new Map<string, Bone>();
  const worldQ = new Map<string, Quaternion>();
  const worldP = new Map<string, Vector3>();
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const [name, parent, pos] of skeletonSpec(opts)) {
    if (opts.head === false && name === 'Bip01_Head') continue;
    if (parent && !bones.has(parent)) continue;
    const b = new Bone();
    b.name = name;
    const wq = new Quaternion().setFromEuler(new Euler(rnd() * 3, rnd() * 3, rnd() * 3));
    const wp = new Vector3(...pos);
    if (parent) {
      const pq = worldQ.get(parent)!;
      const pinv = pq.clone().invert();
      b.quaternion.copy(pinv).multiply(wq);
      b.position.copy(wp).sub(worldP.get(parent)!).applyQuaternion(pinv);
      bones.get(parent)!.add(b);
    } else {
      b.quaternion.copy(wq);
      b.position.copy(wp);
      root.add(b);
    }
    bones.set(name, b);
    worldQ.set(name, wq);
    worldP.set(name, wp);
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

const wp = (b: Bone) => {
  b.parent!.updateMatrixWorld(true);
  return b.getWorldPosition(new Vector3());
};

describe('bone keys', () => {
  it('normalises Biped names', () => {
    expect(boneKey('Bip01_L_UpperArm')).toBe('lupperarm');
    expect(boneKey('Bip01 L UpperArm')).toBe('lupperarm');
    expect(boneKey('Bip01_MJaw')).toBe('mjaw');
    expect(boneKey('Bip01_LEyeBlinkTop')).toBe('leyeblinktop');
  });
});

describe('HumanRig', () => {
  it('binds the contract parts and reports features', () => {
    const { root, bones } = buildSkeleton();
    const rig = new HumanRig(root);
    expect(rig.head).toBe(bones.get('Bip01_Head'));
    expect(rig.leftShoulder).toBe(bones.get('Bip01_L_UpperArm'));
    expect(rig.rightShoulder).toBe(bones.get('Bip01_R_UpperArm'));
    expect(rig.features).toEqual({ jaw: true, lids: true, eyes: true, fingers: true, legs: false });
  });

  it('rests the arms down and forward (no T/A-pose), hands near the counter top', () => {
    const { root, bones } = buildSkeleton();
    const rig = new HumanRig(root);
    rig.apply(createPose());
    for (const S of ['L', 'R']) {
      const sh = wp(bones.get(`Bip01_${S}_UpperArm`)!);
      const elbow = wp(bones.get(`Bip01_${S}_Forearm`)!);
      const wrist = wp(bones.get(`Bip01_${S}_Hand`)!);
      expect(elbow.y).toBeLessThan(sh.y - 0.2); // upper arm hangs
      expect(Math.abs(elbow.x)).toBeLessThan(Math.abs(sh.x) + 0.1); // not abducted like the A-pose
      expect(wrist.z).toBeGreaterThan(sh.z + 0.15); // forearm reaches forward
      expect(wrist.y).toBeGreaterThan(0.95);
      expect(wrist.y).toBeLessThan(1.25);
    }
  });

  it('maps Euler(armX, 0, armZ) onto the upper arm exactly like the procedural rig', () => {
    const { root, bones } = buildSkeleton();
    const rig = new HumanRig(root);
    const pose = createPose();
    pose.lArmX = -Math.PI / 2; // straight forward (beyond the hip-clearance fade)
    pose.lArmZ = 0;
    rig.apply(pose);
    const d = wp(bones.get('Bip01_L_Forearm')!).sub(wp(bones.get('Bip01_L_UpperArm')!)).normalize();
    expect(d.z).toBeGreaterThan(0.99);
  });

  it('points the arm at a target via aimArm', () => {
    const { root, bones } = buildSkeleton();
    const rig = new HumanRig(root);
    const pose = createPose();
    const target = new Vector3(0.5, 1.1, 0.6);
    const sh = wp(bones.get('Bip01_L_UpperArm')!);
    const dir = target.clone().sub(sh).normalize();
    aimArm(pose, true, dir.x, dir.y, dir.z, 1);
    expect(pose.lPoint).toBe(1);
    rig.apply(pose);
    const upper = wp(bones.get('Bip01_L_Forearm')!).sub(wp(bones.get('Bip01_L_UpperArm')!)).normalize();
    expect(upper.angleTo(dir)).toBeLessThan(0.05);
    const fore = wp(bones.get('Bip01_L_Hand')!).sub(wp(bones.get('Bip01_L_Forearm')!)).normalize();
    expect(fore.angleTo(dir)).toBeLessThan(0.2);
  });

  it('raises the right hand above the shoulder for a human wave', () => {
    const { root, bones } = buildSkeleton();
    const rig = new HumanRig(root);
    const pose = createPose();
    poseEmote(pose, 'wave', 0, 0.45, emoteEnvelope(0.45), 0, true);
    rig.apply(pose);
    const sh = wp(bones.get('Bip01_R_UpperArm')!);
    const hand = wp(bones.get('Bip01_R_Hand')!);
    expect(hand.y).toBeGreaterThan(sh.y + 0.1);
    expect(hand.x).toBeLessThan(sh.x); // her right side is -X
  });

  it('turns the head toward +X for positive yaw and drops the jaw / lids', () => {
    const { root, bones } = buildSkeleton();
    const rig = new HumanRig(root);
    const nose0 = wp(bones.get('Bip01_MNose')!);
    const lip0 = wp(bones.get('Bip01_MBottomLip')!);
    const lid0 = wp(bones.get('Bip01_LEyeBlinkTop')!);
    const pose = createPose();
    pose.mouthOpen = 1;
    pose.blink = 1;
    rig.apply(pose);
    expect(wp(bones.get('Bip01_MBottomLip')!).y).toBeLessThan(lip0.y - 0.005);
    expect(wp(bones.get('Bip01_LEyeBlinkTop')!).y).toBeLessThan(lid0.y - 0.005);
    pose.mouthOpen = 0;
    pose.blink = 0;
    pose.headYaw = 0.5;
    rig.apply(pose);
    expect(wp(bones.get('Bip01_MNose')!).x).toBeGreaterThan(nose0.x + 0.02);
    rig.reset();
    expect(wp(bones.get('Bip01_MNose')!).distanceTo(nose0)).toBeLessThan(1e-6);
  });

  it('tolerates skeletons without jaw or finger bones, but requires a head', () => {
    const { root } = buildSkeleton({ jaw: false, fingers: false });
    const rig = new HumanRig(root);
    expect(rig.features.jaw).toBe(false);
    expect(rig.features.fingers).toBe(false);
    const pose = createPose();
    pose.mouthOpen = 1;
    pose.lPoint = 1;
    expect(() => rig.apply(pose)).not.toThrow();
    expect(() => new HumanRig(buildSkeleton({ head: false }).root)).toThrow(/head/);
  });
});

describe('gestures', () => {
  it('rests the arms when no emote plays (both styles)', () => {
    for (const human of [false, true]) {
      const pose = createPose();
      pose.lArmX = 1;
      poseEmote(pose, null, 0.1, 0, 0, 0, human);
      expect(pose).toMatchObject({ ...REST_ARMS, headPitch: 0.1, headRoll: 0, lTwist: 0, rTwist: 0 });
    }
  });

  it('keeps the original cartoon emote ranges for the procedural fallback', () => {
    const pose = createPose();
    poseEmote(pose, 'wave', 0, 0.5, 1, 0, false);
    expect(pose.rArmX).toBeCloseTo(-2.75);
    expect(pose.rArmZ).toBeCloseTo(-0.47);
  });

  it('plays every emote inside its duration with a 0..1 envelope', () => {
    for (const e of Object.keys(EMOTE_SECONDS) as Array<keyof typeof EMOTE_SECONDS>) {
      const pose = createPose();
      poseEmote(pose, e, 0, 0.4, emoteEnvelope(0.4), 1.3, true);
      for (const v of Object.values(pose)) expect(Number.isFinite(v)).toBe(true);
    }
    expect(emoteEnvelope(0)).toBe(0);
    expect(emoteEnvelope(1)).toBe(0);
    expect(emoteEnvelope(0.43)).toBeCloseTo(1, 1);
  });

  it('flaps the lips only while speaking', () => {
    expect(lipFlap(false, 3.3)).toBe(0);
    for (let t = 0; t < 3; t += 0.07) {
      const v = lipFlap(true, t);
      expect(v).toBeGreaterThanOrEqual(0.04);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('procedural fallback driver', () => {
  it('drives the cartoon Madame Lune from a pose', () => {
    const rig = buildMadameLune();
    const driver = new ProceduralLuneDriver(rig);
    const pose = createPose();
    pose.headYaw = 0.3;
    pose.mouthOpen = 1;
    pose.blink = 1;
    driver.apply(pose);
    expect(rig.head.rotation.y).toBeCloseTo(0.3);
    expect(rig.leftArm.rotation.x).toBeCloseTo(REST_ARMS.lArmX);
    expect(rig.mouth.scale.y).toBeCloseTo(1.55);
    for (const eye of rig.eyes) expect(eye.scale.y).toBeCloseTo(0.1);
    pose.mouthOpen = 0;
    pose.blink = 0;
    driver.apply(pose);
    expect(rig.mouth.scale.y).toBeCloseTo(0.2);
    for (const eye of rig.eyes) expect(eye.scale.y).toBe(1);
  });
});

describe('shopkeeper avatars', () => {
  const root = resolve(__dirname, '..');
  const assetsSrc = readFileSync(resolve(root, 'src/assets.ts'), 'utf8');

  it('has one shopkeeper per shop on the shared counter spot', () => {
    expect(Object.keys(SHOPKEEPERS).sort()).toEqual([...PLACE_ORDER].sort());
    expect(new Set(Object.values(SHOPKEEPERS).map((s) => s.assetId)).size).toBe(PLACE_ORDER.length);
    expect(new Set(Object.values(SHOPKEEPERS).map((s) => s.source)).size).toBe(PLACE_ORDER.length);
    expect(SHOPKEEPER_POS).toEqual([0.15, 0, -1.65]);
  });

  for (const [place, spec] of Object.entries(SHOPKEEPERS)) {
    it(`${place}: ${spec.name} is in the manifest and ships a rigged GLB`, () => {
      const m = assetsSrc.match(new RegExp(`'${spec.assetId}': shopkeeper\\('([^']+)'`));
      expect(m, `${spec.assetId} missing from src/assets.ts`).not.toBeNull();
      const file = resolve(root, 'public/models/characters', m![1]);
      expect(statSync(file).size).toBeLessThan(5 * 1024 * 1024);
      const glb = readFileSync(file);
      expect(glb.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
        nodes: Array<{ name?: string }>;
        skins: unknown[];
        images: unknown[];
      };
      const names = new Set(json.nodes.map((n) => n.name));
      for (const b of ['Bip01_Head', 'Bip01_Neck', 'Bip01_MJaw', 'Bip01_L_UpperArm', 'Bip01_R_Forearm', 'Bip01_L_Hand', 'Bip01_LEyeBlinkTop']) {
        expect(names.has(b), b).toBe(true);
      }
      expect(json.skins).toHaveLength(1);
      expect(json.images.length).toBeLessThanOrEqual(5);
    });
  }
});
