/**
 * Drives the procedural (cartoon) Madame Lune from a CharacterPose. This is the
 * fallback shopkeeper when a rigged avatar cannot be loaded, so the app never
 * shows an empty counter.
 */

import type { Object3D } from '@iwsdk/core';
import type { LuneRig } from '../../models/cafe-models.js';
import type { CharacterDriver, CharacterPose } from './character-pose.js';

export class ProceduralLuneDriver implements CharacterDriver {
  readonly root: Object3D;
  readonly head: Object3D;
  readonly leftShoulder: Object3D;
  readonly rightShoulder: Object3D;

  constructor(private readonly rig: LuneRig) {
    this.root = rig.root;
    this.head = rig.head;
    this.leftShoulder = rig.leftArm;
    this.rightShoulder = rig.rightArm;
  }

  apply(p: CharacterPose): void {
    const r = this.rig;
    r.head.rotation.set(p.headPitch, p.headYaw, p.headRoll);
    r.leftArm.rotation.x = p.lArmX;
    r.leftArm.rotation.z = p.lArmZ;
    r.rightArm.rotation.x = p.rArmX;
    r.rightArm.rotation.z = p.rArmZ;
    r.leftForearm.rotation.x = p.lForearmX;
    r.rightForearm.rotation.x = p.rForearmX;
    r.mouth.scale.y = 0.2 + p.mouthOpen * 1.35;
    const eyeY = Math.max(0.1, 1 - p.blink);
    for (const eye of r.eyes) eye.scale.y = eyeY;
    r.root.scale.y = 1 + p.breath * 0.006;
  }
}
