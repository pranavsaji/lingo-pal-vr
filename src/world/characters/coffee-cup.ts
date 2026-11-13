/**
 * A cafe customer's coffee: a small procedural cup and saucer (a few hundred
 * triangles, one shared material), and HeldCup, which keeps the cup in a rigged
 * hand every frame (palm centre, upright, tipped toward the lips while sipping)
 * and never lets it sink below the table top. Allocation-free per frame.
 */

import {
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  TorusGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';

/** Cup height and radius (m). */
export const CUP_HEIGHT = 0.07;
export const CUP_RADIUS = 0.04;

let porcelain: MeshStandardMaterial | null = null;
function material(): MeshStandardMaterial {
  porcelain ??= new MeshStandardMaterial({ name: 'customer_porcelain', color: 0xf4f1ea, roughness: 0.25, metalness: 0 });
  return porcelain;
}

/** Cup with its origin at the centre of its base; the handle points along local +X. */
export function buildCoffeeCup(): Group {
  const g = new Group();
  g.name = 'Coffee Cup';
  const pts: Vector2[] = [];
  // Outer wall (base to rim), then the inner wall back down: a thin-walled cup.
  const prof: Array<[number, number]> = [
    [0, 0], [0.026, 0], [0.03, 0.006], [0.036, 0.03], [CUP_RADIUS, CUP_HEIGHT],
    [CUP_RADIUS - 0.004, CUP_HEIGHT], [0.032, 0.03], [0.026, 0.01], [0, 0.01],
  ];
  for (const [x, y] of prof) pts.push(new Vector2(x, y));
  const body = new Mesh(new LatheGeometry(pts, 20), material());
  const handle = new Mesh(new TorusGeometry(0.015, 0.0045, 6, 12, Math.PI * 1.2), material());
  handle.position.set(CUP_RADIUS - 0.002, CUP_HEIGHT * 0.55, 0);
  handle.rotation.z = -Math.PI * 0.6;
  // Coffee surface.
  const coffee = new Mesh(new CylinderGeometry(CUP_RADIUS - 0.006, CUP_RADIUS - 0.006, 0.002, 18), new MeshStandardMaterial({ color: 0x3b2314, roughness: 0.2 }));
  coffee.position.y = CUP_HEIGHT - 0.014;
  g.add(body, handle, coffee);
  return g;
}

/** Saucer with its origin at the centre of its base. */
export function buildSaucer(): Mesh {
  const s = new Mesh(new CylinderGeometry(0.068, 0.045, 0.012, 24), material());
  s.geometry.translate(0, 0.006, 0);
  s.name = 'Saucer';
  return s;
}

/** Keeps a cup in a rigged hand (Rocketbox Biped bones). */
export class HeldCup {
  private readonly h = new Vector3();
  private readonly i = new Vector3();
  private readonly p = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly n = new Vector3();

  /**
   * `side`: 1 for the left hand, -1 for the right. `minY`: lowest allowed cup base
   * (the table top, in the cup parent's space).
   */
  constructor(
    readonly cup: Object3D,
    private readonly hand: Object3D,
    private readonly index: Object3D,
    private readonly pinky: Object3D,
    private readonly side: 1 | -1,
    private readonly minY: number,
  ) {
    cup.rotation.order = 'YXZ';
  }

  /** Place the cup in the palm; `tilt` (rad) tips the rim toward the lips. */
  update(tilt: number): void {
    const { h, i, p, a, b, n } = this;
    this.hand.getWorldPosition(h);
    this.index.getWorldPosition(i);
    this.pinky.getWorldPosition(p);
    a.subVectors(i, h);
    b.subVectors(p, h);
    n.crossVectors(b, a).multiplyScalar(this.side).normalize(); // out of the palm
    // Palm centre: between the wrist and the knuckles, then out to the cup's axis.
    h.multiplyScalar(0.4).addScaledVector(i, 0.3).addScaledVector(p, 0.3);
    h.addScaledVector(n, CUP_RADIUS + 0.008);
    const parent = this.cup.parent;
    if (parent) parent.worldToLocal(h);
    h.y = Math.max(this.minY, h.y - CUP_HEIGHT * 0.5);
    this.cup.position.copy(h);
    // Handle (+X) toward the palm; the rim tips about the handle axis.
    this.cup.rotation.set(tilt, Math.atan2(n.z, -n.x), 0);
  }
}
