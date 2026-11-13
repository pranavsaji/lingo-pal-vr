/**
 * Realistic PBR surfaces (Poly Haven CC0 textures in public/textures/<id>/):
 * color, normal and roughness maps, tiled by real-world size so wood grain,
 * marble and tiles keep a believable scale on every mesh.
 */

import { AssetManager, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from '@iwsdk/core';
import type { Surface } from '../places/places.js';

export interface TextureSet {
  diff: Texture;
  nor: Texture;
  rough: Texture;
}

const sets = new Map<string, Promise<TextureSet | null>>();

const url = (id: string, map: string) => `${import.meta.env.BASE_URL}textures/${id}/${map}.webp`;

/** Load (once) the three maps of a surface. Resolves null if a file is missing (the app keeps a plain color). */
export function loadSurface(id: string): Promise<TextureSet | null> {
  let p = sets.get(id);
  if (!p) {
    p = Promise.all(['diff', 'nor', 'rough'].map((m) => AssetManager.loadTexture(url(id, m), `tex-${id}-${m}`)))
      .then(([diff, nor, rough]) => {
        diff.colorSpace = SRGBColorSpace;
        for (const t of [diff, nor, rough]) {
          t.wrapS = RepeatWrapping;
          t.wrapT = RepeatWrapping;
          t.anisotropy = 4; // floors and counters are seen at grazing angles
        }
        return { diff, nor, rough };
      })
      .catch(() => null);
    sets.set(id, p);
  }
  return p;
}

/**
 * A material for a w x h meter face. Texture clones share the GPU image and
 * only differ in repeat, so many sizes cost one upload per map.
 */
export function surfaceMaterial(set: TextureSet | null, surface: Surface, w: number, h: number, fallback = 0x8a6a4a): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: surface.tint ?? (set ? 0xffffff : fallback), roughness: surface.roughness ?? 1, metalness: 0 });
  if (!set) return m;
  const rx = Math.max(0.25, w * surface.perMeter);
  const ry = Math.max(0.25, h * surface.perMeter);
  const map = (t: Texture) => {
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  m.map = map(set.diff);
  m.normalMap = map(set.nor);
  m.roughnessMap = map(set.rough);
  return m;
}
