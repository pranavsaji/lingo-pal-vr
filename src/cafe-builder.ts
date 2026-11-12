/**
 * Procedural cafe geometry built from simple primitives (no downloads needed).
 * Every builder returns an object whose base sits at local y = 0.
 */

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
  TorusGeometry,
} from '@iwsdk/core';
import type { ItemShape } from './vocab.js';

function mat(color: number, opts: { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number } = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

function mesh(geo: ConstructorParameters<typeof Mesh>[0], m: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const out = new Mesh(geo, m);
  out.position.set(x, y, z);
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

/** Build one pinchable vocabulary object. */
export function buildItem(shape: ItemShape, color: number): Group {
  const g = new Group();
  switch (shape) {
    case 'croissant': {
      const t = mesh(new TorusGeometry(0.06, 0.028, 12, 24, Math.PI * 1.25), mat(color, { roughness: 0.5 }));
      t.rotation.x = -Math.PI / 2;
      t.rotation.z = Math.PI * 0.375;
      t.position.y = 0.028;
      g.add(t);
      break;
    }
    case 'cup': {
      g.add(mesh(new CylinderGeometry(0.07, 0.07, 0.008, 24), mat(0xffffff), 0, 0.004, 0)); // saucer
      g.add(mesh(new CylinderGeometry(0.04, 0.032, 0.07, 20), mat(color, { roughness: 0.3 }), 0, 0.043, 0));
      g.add(mesh(new CylinderGeometry(0.036, 0.036, 0.004, 20), mat(0x4b2e1e), 0, 0.075, 0)); // coffee
      const handle = mesh(new TorusGeometry(0.018, 0.005, 8, 16), mat(color, { roughness: 0.3 }), 0.045, 0.045, 0);
      handle.rotation.y = Math.PI / 2;
      g.add(handle);
      break;
    }
    case 'baguette': {
      const b = mesh(new CapsuleGeometry(0.026, 0.34, 6, 14), mat(color, { roughness: 0.7 }));
      b.rotation.z = Math.PI / 2;
      b.rotation.y = 0.35;
      b.position.y = 0.026;
      g.add(b);
      break;
    }
    case 'apple': {
      g.add(mesh(new SphereGeometry(0.042, 20, 16), mat(color, { roughness: 0.35 }), 0, 0.042, 0));
      g.add(mesh(new CylinderGeometry(0.003, 0.003, 0.022, 6), mat(0x5a3a1a), 0, 0.09, 0));
      break;
    }
    case 'orange': {
      g.add(mesh(new SphereGeometry(0.043, 20, 16), mat(color, { roughness: 0.8 }), 0, 0.043, 0));
      break;
    }
    case 'cheese': {
      const c = mesh(new CylinderGeometry(0.075, 0.075, 0.05, 3, 1), mat(color, { roughness: 0.55 }));
      c.position.y = 0.025;
      g.add(c);
      break;
    }
    case 'bottle': {
      const glass = mat(color, { roughness: 0.1, transparent: true, opacity: 0.75 });
      g.add(mesh(new CylinderGeometry(0.032, 0.032, 0.17, 20), glass, 0, 0.085, 0));
      g.add(mesh(new ConeGeometry(0.032, 0.05, 20), glass, 0, 0.195, 0));
      g.add(mesh(new CylinderGeometry(0.012, 0.012, 0.03, 12), mat(0x1d3557), 0, 0.225, 0));
      break;
    }
    case 'plate': {
      g.add(mesh(new CylinderGeometry(0.11, 0.09, 0.016, 32), mat(color, { roughness: 0.25 }), 0, 0.008, 0));
      break;
    }
    case 'cake': {
      g.add(mesh(new CylinderGeometry(0.1, 0.1, 0.012, 28), mat(0xffffff, { roughness: 0.25 }), 0, 0.006, 0));
      g.add(mesh(new CylinderGeometry(0.075, 0.075, 0.08, 28), mat(0x5b3a29), 0, 0.052, 0));
      g.add(mesh(new CylinderGeometry(0.077, 0.077, 0.012, 28), mat(color, { roughness: 0.4 }), 0, 0.098, 0));
      g.add(mesh(new SphereGeometry(0.014, 12, 10), mat(0xc8262c, { roughness: 0.3 }), 0, 0.112, 0));
      break;
    }
    case 'glass': {
      const glass = mat(color, { roughness: 0.05, transparent: true, opacity: 0.45 });
      g.add(mesh(new CylinderGeometry(0.03, 0.028, 0.004, 16), glass, 0, 0.002, 0));
      g.add(mesh(new CylinderGeometry(0.004, 0.004, 0.07, 8), glass, 0, 0.037, 0));
      const bowl = mesh(new ConeGeometry(0.04, 0.07, 20, 1, true), glass, 0, 0.11, 0);
      bowl.rotation.x = Math.PI; // wide end up
      g.add(bowl);
      break;
    }
    case 'menu': {
      const m = mesh(new BoxGeometry(0.16, 0.22, 0.012), mat(color, { roughness: 0.7 }));
      m.position.y = 0.11;
      m.rotation.x = -0.25;
      g.add(m);
      g.add(mesh(new BoxGeometry(0.12, 0.03, 0.002), mat(0xf5d90a), 0, 0.17, 0.004));
      break;
    }
    case 'flower': {
      g.add(mesh(new CylinderGeometry(0.035, 0.028, 0.12, 16), mat(0x2a9d8f, { roughness: 0.2 }), 0, 0.06, 0));
      g.add(mesh(new CylinderGeometry(0.003, 0.003, 0.14, 6), mat(0x3a7d2c), 0, 0.17, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new SphereGeometry(0.022, 10, 8), mat(color, { roughness: 0.5 }), Math.cos(a) * 0.024, 0.245, Math.sin(a) * 0.024));
      }
      g.add(mesh(new SphereGeometry(0.016, 10, 8), mat(0xf5d90a), 0, 0.25, 0));
      break;
    }
  }
  return g;
}

/** Hit area: a slightly larger invisible sphere makes small objects easy to pinch from a distance. */
export function buildHitArea(radius: number, y: number): Mesh {
  const m = new Mesh(new SphereGeometry(radius, 12, 10), new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  m.position.y = y;
  return m;
}

function bistroTable(): Group {
  const g = new Group();
  g.add(mesh(new CylinderGeometry(0.36, 0.36, 0.03, 36), mat(0xf3efe7, { roughness: 0.3 }), 0, 0.75, 0));
  g.add(mesh(new CylinderGeometry(0.025, 0.025, 0.74, 12), mat(0x2b2d33, { metalness: 0.6, roughness: 0.4 }), 0, 0.37, 0));
  g.add(mesh(new CylinderGeometry(0.2, 0.22, 0.03, 24), mat(0x2b2d33, { metalness: 0.6, roughness: 0.4 }), 0, 0.015, 0));
  return g;
}

function chair(): Group {
  const g = new Group();
  const wood = mat(0x8a5a35, { roughness: 0.6 });
  g.add(mesh(new CylinderGeometry(0.2, 0.2, 0.03, 24), wood, 0, 0.46, 0));
  for (const [x, z] of [[0.13, 0.13], [-0.13, 0.13], [0.13, -0.13], [-0.13, -0.13]] as const) {
    g.add(mesh(new CylinderGeometry(0.012, 0.012, 0.46, 8), wood, x, 0.23, z));
  }
  const back = mesh(new TorusGeometry(0.18, 0.012, 8, 24, Math.PI), wood, 0, 0.62, -0.17);
  g.add(back);
  return g;
}

/** Static cafe set: counter, back wall, awning, tables, chairs, shopkeeper. */
export function buildCafeSet(): Object3D {
  const g = new Group();
  g.name = 'Cafe Set';

  // Parts tagged mrHide disappear in mixed reality, so only the counter top,
  // Madame Lune and the furniture appear in the learner's real room.
  const room = (o: Object3D): Object3D => {
    o.userData.mrHide = true;
    return o;
  };

  // Counter (top at y = 1.0, front face at z = -0.7).
  g.add(room(mesh(new BoxGeometry(2.2, 0.96, 0.5), mat(0x7a4b2a, { roughness: 0.5 }), 0, 0.48, -0.95)));
  g.add(mesh(new BoxGeometry(2.3, 0.04, 0.58), mat(0x2b2d33, { roughness: 0.25, metalness: 0.2 }), 0, 0.98, -0.95));
  g.add(room(mesh(new BoxGeometry(2.2, 0.08, 0.01), mat(0xf5d90a, { roughness: 0.4 }), 0, 0.8, -0.695)));

  // Back wall with shelves and bottles (bottles: one instanced draw call).
  g.add(room(mesh(new BoxGeometry(5, 3, 0.1), mat(0xe8dcc8, { roughness: 0.9 }), 0, 1.5, -2.6)));
  const bottleColors = [0x2a9d8f, 0xe63946, 0xf4a261, 0x457b9d];
  const bottles = new InstancedMesh(new CylinderGeometry(0.035, 0.035, 0.24, 12), mat(0xffffff, { roughness: 0.15 }), 16);
  const tint = new Color();
  const m4b = new Matrix4();
  let b = 0;
  for (const y of [1.3, 1.75]) {
    g.add(room(mesh(new BoxGeometry(2.4, 0.03, 0.25), mat(0x7a4b2a), 0, y, -2.45)));
    for (let i = 0; i < 8; i++) {
      m4b.makeTranslation(-1.05 + i * 0.3, y + 0.135, -2.45);
      bottles.setMatrixAt(b, m4b);
      bottles.setColorAt(b, tint.setHex(bottleColors[i % 4]));
      b++;
    }
  }
  bottles.castShadow = true;
  g.add(room(bottles));

  // Striped awning above the counter (two instanced draw calls: red and white).
  const stripeGeo = new BoxGeometry(0.26, 0.02, 0.9);
  const stripes = [new InstancedMesh(stripeGeo, mat(0xc8262c, { roughness: 0.8 }), 5), new InstancedMesh(stripeGeo, mat(0xfafaf7, { roughness: 0.8 }), 5)];
  const m4s = new Matrix4();
  const rot = new Matrix4().makeRotationX(0.35);
  for (let i = 0; i < 10; i++) {
    m4s.makeTranslation(-1.17 + i * 0.26, 2.45, -2.1).multiply(rot);
    stripes[i % 2].setMatrixAt(Math.floor(i / 2), m4s);
  }
  for (const st of stripes) {
    st.castShadow = true;
    g.add(room(st));
  }

  // Madame Lune is built and animated by NpcSystem (src/world/npc-system.ts).

  // Side tables with chairs.
  const right = bistroTable();
  right.position.set(1.2, 0, -0.6);
  g.add(right);
  const left = bistroTable();
  left.position.set(-1.25, 0, -0.62);
  g.add(left);
  for (const [x, z, ry] of [[1.75, -0.45, -1.9], [-1.8, -0.45, 1.9]] as const) {
    const c = chair();
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    g.add(c);
  }

  // Checkerboard floor: two instanced meshes keep it to two draw calls on Quest.
  const tileGeo = new BoxGeometry(0.4, 0.01, 0.4);
  const tiles = [
    new InstancedMesh(tileGeo, mat(0xf3efe7, { roughness: 0.5 }), 60),
    new InstancedMesh(tileGeo, mat(0x2b2d33, { roughness: 0.5 }), 60),
  ];
  const counts = [0, 0];
  const m4 = new Matrix4();
  for (let ix = -6; ix < 6; ix++) {
    for (let iz = -7; iz < 3; iz++) {
      const k = Math.abs(ix + iz) % 2;
      m4.makeTranslation(ix * 0.4 + 0.2, 0.005, iz * 0.4 + 0.2);
      tiles[k].setMatrixAt(counts[k]++, m4);
    }
  }
  for (const t of tiles) {
    t.receiveShadow = true;
    t.instanceMatrix.needsUpdate = true;
    g.add(room(t));
  }
  return g;
}
