import { describe, expect, it, vi } from 'vitest';

// The rig only needs Three classes; map @iwsdk/core onto three for Node (see models.test.ts).
vi.mock('@iwsdk/core', async () => await import('three'));

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Bone, Group, Object3D, Vector3 } from 'three';
import { IdleLife, Rng, TalkGestures } from '../src/world/characters/body-language';
import { createPose, type CharacterPose } from '../src/world/characters/character-pose';
import { buildCoffeeCup, HeldCup } from '../src/world/characters/coffee-cup';
import { CustomerBehaviour, relativeGaze } from '../src/world/characters/customer-behaviour';
import { CHAIR_SEAT, CUSTOMERS, customerRootY, SEAT_HIP } from '../src/world/characters/customers';
import { HumanRig } from '../src/world/characters/human-rig';
import { SHOPKEEPERS } from '../src/world/characters/shopkeepers';

const wp = (o: Object3D) => o.getWorldPosition(new Vector3());

/** Minimal Biped (A-pose, metres, facing +Z) with legs, in a root at the origin. */
function biped(): { root: Group; bones: Map<string, Bone> } {
  const spec: Array<[string, string | null, [number, number, number]]> = [
    ['Bip01', null, [0, 0.92, 0]],
    ['Bip01_Pelvis', 'Bip01', [0, 0.92, 0]],
    ['Bip01_Spine', 'Bip01_Pelvis', [0, 1.04, 0]],
    ['Bip01_Spine1', 'Bip01_Spine', [0, 1.17, 0]],
    ['Bip01_Spine2', 'Bip01_Spine1', [0, 1.29, -0.02]],
    ['Bip01_Neck', 'Bip01_Spine2', [0, 1.45, -0.07]],
    ['Bip01_Head', 'Bip01_Neck', [0, 1.52, -0.056]],
    ['Bip01_MNose', 'Bip01_Head', [0, 1.584, 0.068]],
  ];
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const x = (v: number) => side * v;
    spec.push(
      [`Bip01_${S}_Clavicle`, 'Bip01_Neck', [x(0.077), 1.403, -0.056]],
      [`Bip01_${S}_UpperArm`, `Bip01_${S}_Clavicle`, [x(0.172), 1.38, -0.061]],
      [`Bip01_${S}_Forearm`, `Bip01_${S}_UpperArm`, [x(0.359), 1.21, -0.063]],
      [`Bip01_${S}_Hand`, `Bip01_${S}_Forearm`, [x(0.524), 1.063, 0.031]],
      [`Bip01_${S}_Finger1`, `Bip01_${S}_Hand`, [x(0.567), 0.997, 0.084]],
      [`Bip01_${S}_Finger11`, `Bip01_${S}_Finger1`, [x(0.586), 0.967, 0.097]],
      [`Bip01_${S}_Finger2`, `Bip01_${S}_Hand`, [x(0.577), 0.994, 0.066]],
      [`Bip01_${S}_Finger4`, `Bip01_${S}_Hand`, [x(0.572), 0.987, 0.024]],
      [`Bip01_${S}_Thigh`, 'Bip01_Spine', [x(0.088), 0.923, 0]],
      [`Bip01_${S}_Calf`, `Bip01_${S}_Thigh`, [x(0.104), 0.499, -0.032]],
      [`Bip01_${S}_Foot`, `Bip01_${S}_Calf`, [x(0.118), 0.1, -0.063]],
      [`Bip01_${S}_Toe0`, `Bip01_${S}_Foot`, [x(0.152), 0.002, 0.069]],
    );
  }
  const root = new Group();
  const bones = new Map<string, Bone>();
  const worldP = new Map<string, Vector3>();
  for (const [name, parent, pos] of spec) {
    const b = new Bone();
    b.name = name;
    const w = new Vector3(...pos);
    // Odd local frames like 3ds Max Biped: a rotation per bone, positions compensated.
    b.rotation.set(0.3 * name.length, -0.2 * name.length, 0.1);
    if (parent) {
      const p = bones.get(parent)!;
      p.add(b);
      p.updateMatrixWorld(true);
      b.position.copy(p.worldToLocal(w.clone()));
    } else {
      root.add(b);
      b.position.copy(w);
    }
    b.updateMatrixWorld(true);
    bones.set(name, b);
    worldP.set(name, w);
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

describe('human rig: body language and legs', () => {
  it('keeps the legs in the bind pose unless asked to drive them', () => {
    const { root, bones } = biped();
    const foot0 = wp(bones.get('Bip01_L_Foot')!);
    const rig = new HumanRig(root);
    expect(rig.features.legs).toBe(false);
    const pose = createPose();
    pose.lThighX = -1.5;
    pose.lKnee = 1.5;
    rig.apply(pose);
    root.updateMatrixWorld(true);
    expect(wp(bones.get('Bip01_L_Foot')!).distanceTo(foot0)).toBeLessThan(1e-6);
  });

  it('seats a rig: thighs level and forward, shins down, hips over the seat', () => {
    const { root, bones } = biped();
    const rig = new HumanRig(root, { legs: true });
    expect(rig.features.legs).toBe(true);
    expect(rig.hipHeight).toBeCloseTo(0.923, 3);
    root.position.y = customerRootY({ posture: 'seated', seat: CHAIR_SEAT }, rig.hipHeight);
    const pose = createPose();
    for (const s of ['l', 'r'] as const) {
      pose[`${s}ThighX`] = -Math.PI / 2;
      pose[`${s}Knee`] = Math.PI / 2;
    }
    rig.apply(pose);
    root.updateMatrixWorld(true);
    for (const S of ['L', 'R']) {
      const hip = wp(bones.get(`Bip01_${S}_Thigh`)!);
      const knee = wp(bones.get(`Bip01_${S}_Calf`)!);
      const ankle = wp(bones.get(`Bip01_${S}_Foot`)!);
      expect(hip.y).toBeCloseTo(CHAIR_SEAT + SEAT_HIP, 3);
      expect(Math.abs(knee.y - hip.y)).toBeLessThan(0.02); // level thigh
      expect(knee.z - hip.z).toBeGreaterThan(0.38); // knee forward
      expect(Math.abs(ankle.z - knee.z)).toBeLessThan(0.02); // shin plumb
      expect(ankle.y).toBeGreaterThan(0.05);
      expect(ankle.y).toBeLessThan(0.2); // foot near the floor
    }
  });

  it('shifts weight without moving the feet much', () => {
    const { root, bones } = biped();
    const rig = new HumanRig(root, { legs: true });
    const pose = createPose();
    rig.apply(pose);
    root.updateMatrixWorld(true);
    const foot0 = wp(bones.get('Bip01_L_Foot')!);
    const neck0 = wp(bones.get('Bip01_Neck')!);
    pose.hipSway = 1;
    rig.apply(pose);
    root.updateMatrixWorld(true);
    expect(wp(bones.get('Bip01_Pelvis')!).x).toBeGreaterThan(0.01); // hips toward +X
    expect(wp(bones.get('Bip01_L_Foot')!).distanceTo(foot0)).toBeLessThan(0.02);
    expect(Math.abs(wp(bones.get('Bip01_Neck')!).x - neck0.x)).toBeLessThan(0.03);
  });

  it('leans, turns the torso, rotates the upper arm inward and flexes the wrist', () => {
    const { root, bones } = biped();
    const rig = new HumanRig(root);
    const pose = createPose();
    pose.rArmX = -0.3;
    pose.rForearmX = -1.6;
    rig.apply(pose);
    root.updateMatrixWorld(true);
    const nose0 = wp(bones.get('Bip01_MNose')!);
    const hand0 = wp(bones.get('Bip01_R_Hand')!);
    const tip0 = wp(bones.get('Bip01_R_Finger2')!);
    pose.rArmY = 0.6; // inward: her right hand (at -X) swings toward the midline
    pose.rWrist = 0.6;
    pose.torsoPitch = 0.2;
    rig.apply(pose);
    root.updateMatrixWorld(true);
    expect(wp(bones.get('Bip01_MNose')!).z).toBeGreaterThan(nose0.z + 0.03); // leaned forward
    const hand = wp(bones.get('Bip01_R_Hand')!);
    expect(hand.x).toBeGreaterThan(hand0.x + 0.03);
    const dirRest = tip0.clone().sub(hand0).normalize();
    const dir = wp(bones.get('Bip01_R_Finger2')!).sub(hand).normalize();
    expect(dir.angleTo(dirRest)).toBeGreaterThan(0.2); // wrist flexed (plus the arm moved)
    pose.rGrip = 1;
    expect(() => rig.apply(pose)).not.toThrow();
  });
});

describe('talking gestures', { timeout: 60000 }, () => {
  const keys = ['lArmX', 'lArmZ', 'lForearmX', 'rArmX', 'rArmZ', 'rForearmX', 'lTwist', 'rTwist', 'headPitch', 'headRoll'] as const;

  it('adds nothing while silent, and nothing when an emote or pointing owns the body', () => {
    const talk = new TalkGestures(1);
    const base = createPose();
    const out = createPose();
    for (let i = 0; i < 100; i++) talk.step(1 / 60, false);
    talk.apply(out, 1);
    for (const k of keys) expect(out[k]).toBeCloseTo(base[k], 6);
    for (let i = 0; i < 200; i++) talk.step(1 / 60, true);
    const blocked = createPose();
    talk.apply(blocked, 0);
    for (const k of keys) expect(blocked[k]).toBeCloseTo(base[k], 6);
  });

  it('gestures with both hands, varied and bounded, then fades out after speech', () => {
    const talk = new TalkGestures(5);
    let maxL = 0;
    let maxR = 0;
    const lifts: number[] = [];
    for (let i = 0; i < 60 * 12; i++) {
      talk.step(1 / 60, true);
      const out = createPose();
      talk.apply(out, 1);
      for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(out.rArmX - createPose().rArmX)).toBeLessThan(0.45);
      expect(Math.abs(out.rForearmX - createPose().rForearmX)).toBeLessThan(0.75);
      expect(Math.abs(out.headPitch)).toBeLessThan(0.12);
      maxL = Math.max(maxL, talk.left.lift);
      maxR = Math.max(maxR, talk.right.lift);
      if (i % 30 === 0) lifts.push(Math.round(talk.right.lift * 100));
    }
    expect(talk.beats).toBeGreaterThanOrEqual(6);
    expect(maxL).toBeGreaterThan(0.2);
    expect(maxR).toBeGreaterThan(0.2);
    expect(new Set(lifts).size).toBeGreaterThan(6); // not a fixed loop
    for (let i = 0; i < 60 * 3; i++) talk.step(1 / 60, false);
    expect(talk.blend).toBeLessThan(0.01);
    expect(talk.left.lift + talk.right.lift).toBeLessThan(0.02);
  });

  it('eases in instead of snapping when speech starts', () => {
    const talk = new TalkGestures(9);
    talk.step(1 / 60, true);
    expect(talk.blend).toBeLessThan(0.1);
  });

  it('idles with weight shifts and occasional glances, only when quiet', () => {
    const idle = new IdleLife(3);
    for (let i = 0; i < 60 * 30; i++) idle.step(1 / 60, false);
    expect(idle.glances).toBe(0);
    let maxSway = 0;
    for (let i = 0; i < 60 * 40; i++) {
      idle.step(1 / 60, true);
      maxSway = Math.max(maxSway, Math.abs(idle.sway));
      expect(Math.abs(idle.glanceYaw)).toBeLessThan(0.65);
    }
    expect(idle.glances).toBeGreaterThan(1);
    expect(maxSway).toBeGreaterThan(0.3);
    expect(maxSway).toBeLessThanOrEqual(1);
  });

  it('uses a deterministic PRNG', () => {
    const a = new Rng(4);
    const b = new Rng(4);
    for (let i = 0; i < 10; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('customer behaviour', { timeout: 60000 }, () => {
  const gaze = { learnerYaw: 0.9, learnerPitch: -0.1, counterYaw: -0.6, counterPitch: 0.05 };

  function run(b: CustomerBehaviour, secs: number, each?: (p: CharacterPose) => void): CharacterPose {
    const pose = createPose();
    for (let i = 0; i < secs * 30; i++) {
      b.step(1 / 30, gaze, pose);
      each?.(pose);
    }
    return pose;
  }

  it('sits with bent legs and plays its gesture now and then, smoothly', () => {
    const b = new CustomerBehaviour('seated', 'sip', 31);
    let sipped = false;
    let prev = createPose().rForearmX;
    let first = true;
    run(b, 40, (p) => {
      expect(p.lThighX).toBeLessThan(-1.2);
      expect(p.lKnee).toBeGreaterThan(1.2);
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
      if (b.gesture === 'sip' && b.gestureEnv > 0.9) sipped = true;
      if (!first) expect(Math.abs(p.rForearmX - prev)).toBeLessThan(0.12); // no pops at 30 fps
      prev = p.rForearmX;
      first = false;
      expect(Math.abs(p.headYaw)).toBeLessThan(1.2);
    });
    expect(sipped).toBe(true);
  });

  it('stands, shifts weight and keeps the head within a natural range', () => {
    for (const activity of ['browse', 'wait'] as const) {
      const b = new CustomerBehaviour('standing', activity, 5);
      let sway = 0;
      run(b, 30, (p) => {
        sway = Math.max(sway, Math.abs(p.hipSway));
        expect(p.lThighX).toBeGreaterThan(-0.2);
        expect(Math.abs(p.headYaw)).toBeLessThan(1.2);
        expect(p.headPitch).toBeLessThan(0.6);
        expect(p.mouthOpen).toBe(0);
      });
      expect(sway).toBeGreaterThan(0.3);
    }
  });

  it('computes gaze relative to the body', () => {
    const out = { yaw: 0, pitch: 0 };
    // Facing +X (yaw PI/2), a target straight ahead at eye height.
    relativeGaze(0, 1.6, 0, Math.PI / 2, 2, 1.6, 0, out);
    expect(out.yaw).toBeCloseTo(0, 6);
    expect(out.pitch).toBeCloseTo(0, 6);
    // Facing +Z, a target to the +X side and below.
    relativeGaze(0, 1.6, 0, 0, 1, 0.6, 0, out);
    expect(out.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(out.pitch).toBeCloseTo(Math.PI / 4, 6);
  });

  it('keeps a held cup upright, in the hand, and above the table', () => {
    const parent = new Group();
    const cup = buildCoffeeCup();
    parent.add(cup);
    const hand = new Object3D();
    const index = new Object3D();
    const pinky = new Object3D();
    hand.position.set(0, 0.8, 0);
    index.position.set(0, 0.79, 0.09);
    pinky.position.set(-0.01, 0.77, 0.08);
    parent.add(hand, index, pinky);
    parent.updateMatrixWorld(true);
    const held = new HeldCup(cup, hand, index, pinky, -1, 0.777);
    held.update(0);
    expect(cup.position.y).toBeGreaterThanOrEqual(0.777);
    expect(cup.position.distanceTo(hand.position)).toBeLessThan(0.15);
    expect(cup.rotation.x).toBe(0);
    held.update(0.4);
    expect(cup.rotation.x).toBeCloseTo(0.4);
  });
});

describe('customer placement and assets', () => {
  const root = resolve(__dirname, '..');
  const assetsSrc = readFileSync(resolve(root, 'src/assets.ts'), 'utf8');
  const shopkeeperIds = new Set(Object.values(SHOPKEEPERS).map((s) => s.assetId));
  const all = Object.values(CUSTOMERS).flat();

  it('has two different people per shop, none of them a shopkeeper', () => {
    expect(Object.keys(CUSTOMERS).sort()).toEqual(['boulangerie', 'cafe', 'marche']);
    for (const list of Object.values(CUSTOMERS)) expect(list).toHaveLength(2);
    expect(new Set(all.map((c) => c.assetId)).size).toBe(6);
    expect(new Set(all.map((c) => c.source)).size).toBe(6);
    for (const c of all) {
      expect(shopkeeperIds.has(c.assetId)).toBe(false);
      for (const s of Object.values(SHOPKEEPERS)) expect(c.source).not.toBe(s.source);
    }
    expect(all.filter((c) => c.source.startsWith('Female')).length).toBe(3);
  });

  it('keeps everyone out of reach and out of the counter, shopkeeper and panel sight lines', () => {
    for (const c of all) {
      const [x, z] = c.pos;
      expect(Math.hypot(x, z)).toBeGreaterThan(1.8); // beyond arm's reach from the origin
      const azimuth = Math.abs(Math.atan2(x, -z)) * (180 / Math.PI);
      // Panels span roughly 19-48 degrees either side; the counter and shopkeeper sit within 32.
      expect(azimuth).toBeGreaterThan(44);
      if (c.posture === 'seated') expect(c.table).toBeDefined();
    }
  });

  for (const c of all) {
    it(`${c.assetId} (${c.source}) is in the manifest and within budget`, () => {
      const m = assetsSrc.match(new RegExp(`'${c.assetId}': shopkeeper\\('([^']+)', '[^']*', 'lazy'\\)`));
      expect(m, `${c.assetId} missing (or not lazy) in src/assets.ts`).not.toBeNull();
      const file = resolve(root, 'public/models/characters', m![1]);
      expect(statSync(file).size).toBeLessThan(1.2 * 1024 * 1024);
      const glb = readFileSync(file);
      expect(glb.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
        nodes: Array<{ name?: string }>;
        skins: unknown[];
        images: Array<{ mimeType?: string }>;
        meshes: Array<{ primitives: Array<{ indices?: number }> }>;
        accessors: Array<{ count: number }>;
      };
      const names = new Set(json.nodes.map((n) => n.name));
      for (const b of ['Bip01_Head', 'Bip01_Pelvis', 'Bip01_Spine1', 'Bip01_L_Thigh', 'Bip01_R_Calf', 'Bip01_L_Foot', 'Bip01_R_Hand', 'Bip01_R_Finger1']) {
        expect(names.has(b), b).toBe(true);
      }
      expect(json.skins).toHaveLength(1);
      expect(json.images.length).toBeLessThanOrEqual(4);
      for (const img of json.images) expect(img.mimeType).toBe('image/webp');
      let tris = 0;
      for (const mesh of json.meshes) for (const p of mesh.primitives) tris += json.accessors[p.indices!].count / 3;
      expect(tris).toBeLessThanOrEqual(9100);
    });
  }
});
