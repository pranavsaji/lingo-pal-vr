/**
 * Procedural stand-ins for items without a realistic model (and while models
 * load). Every builder returns an object whose base sits at local y = 0.
 * The shop sets themselves are built in src/world/shop-set.ts.
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
import { buildPlaceItem, isPlaceItemShape } from './models/place-items.js';
import type { ItemShape } from './vocab.js';

/** Materials shared within the item being built, so its meshes can merge (one draw per material). */
let itemMats: Map<string, MeshStandardMaterial> | null = null;

function mat(color: number, opts: { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number } = {}): MeshStandardMaterial {
  const key = `${color}|${opts.roughness}|${opts.metalness}|${opts.transparent}|${opts.opacity}`;
  const shared = itemMats?.get(key);
  if (shared) return shared;
  const m = newMat(color, opts);
  itemMats?.set(key, m);
  return m;
}

function newMat(color: number, opts: { roughness?: number; metalness?: number; transparent?: boolean; opacity?: number }): MeshStandardMaterial {
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
  if (isPlaceItemShape(shape)) return buildPlaceItem(shape); // bistrot, metro, pharmacie
  itemMats = new Map();
  try {
    return buildItemShape(shape, color);
  } finally {
    itemMats = null;
  }
}

function buildItemShape(shape: ItemShape, color: number): Group {
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
    case 'pain_chocolat': {
      // Laminated rectangle with two chocolate batons peeking out of the ends.
      const dough = mat(color, { roughness: 0.55 });
      const body = mesh(new CapsuleGeometry(0.03, 0.06, 6, 14), dough, 0, 0.026, 0);
      body.rotation.z = Math.PI / 2;
      body.scale.set(0.8, 1, 1.25);
      g.add(body);
      for (const z of [-0.012, 0.012]) {
        const choc = mesh(new CylinderGeometry(0.006, 0.006, 0.13, 8), mat(0x3b2416, { roughness: 0.4 }), 0, 0.03, z);
        choc.rotation.z = Math.PI / 2;
        g.add(choc);
      }
      break;
    }
    case 'eclair': {
      const shell = mesh(new CapsuleGeometry(0.02, 0.1, 6, 14), mat(color, { roughness: 0.6 }), 0, 0.02, 0);
      shell.rotation.z = Math.PI / 2;
      g.add(shell);
      const icing = mesh(new CapsuleGeometry(0.0205, 0.1, 6, 14), mat(0x3b2416, { roughness: 0.25 }), 0, 0.027, 0);
      icing.rotation.z = Math.PI / 2;
      icing.scale.set(1, 0.55, 0.9);
      g.add(icing);
      break;
    }
    case 'macaron': {
      // A little stack: pink, pistachio, chocolate.
      const colors = [color, 0xa8c97f, 0x6b3e26];
      colors.forEach((c, i) => {
        const y = 0.012 + i * 0.03;
        for (const dy of [-0.006, 0.006]) {
          const shell = mesh(new SphereGeometry(0.022, 16, 10), mat(c, { roughness: 0.7 }), 0, y + dy, 0);
          shell.scale.y = 0.4;
          g.add(shell);
        }
        g.add(mesh(new CylinderGeometry(0.018, 0.018, 0.006, 16), mat(0xfaf3e0, { roughness: 0.5 }), 0, y, 0));
      });
      break;
    }
    case 'tart': {
      g.add(mesh(new CylinderGeometry(0.075, 0.07, 0.022, 32), mat(color, { roughness: 0.6 }), 0, 0.011, 0)); // crust
      g.add(mesh(new CylinderGeometry(0.066, 0.066, 0.006, 32), mat(0xf6e7b0, { roughness: 0.5 }), 0, 0.022, 0)); // cream
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = i === 0 ? 0 : 0.042;
        const berry = mesh(new SphereGeometry(0.012, 10, 8), mat(0xc8102e, { roughness: 0.3 }), Math.cos(a) * r, 0.03, Math.sin(a) * r);
        berry.scale.y = 1.25;
        g.add(berry);
      }
      break;
    }
    case 'model': {
      // Stand-in while the realistic model loads.
      g.add(mesh(new SphereGeometry(0.04, 16, 12), mat(color, { roughness: 0.6 }), 0, 0.04, 0));
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
