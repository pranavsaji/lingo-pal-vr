#!/usr/bin/env node
/**
 * Realistic models for the remaining counter items, from Objaverse (Sketchfab
 * models mirrored by the Allen Institute on Hugging Face). Every model here is
 * CC-BY 4.0: credited in CREDITS.md with title, author and Sketchfab link.
 *
 * Each model is normalized for the app: real-world size, centered, base at
 * y = 0, at most `tris` triangles, 512 px WebP textures, and glass made with
 * plain alpha blending (transmission needs an extra render pass per frame).
 *
 * Usage: node scripts/fetch-objaverse.mjs
 */

import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, metalRough, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.tmp/objaverse/glbs');
const HF = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';

/** id -> source and the real size of its largest dimension (or height) in meters. */
export const OBJAVERSE = {
  orange: { path: 'glbs/000-004/e5015b222a6949478d68bd6b38fc6ee0.glb', size: 0.075, axis: 'max', tris: 3500, title: 'Tangerine', author: 'maestronoov', uid: 'e5015b222a6949478d68bd6b38fc6ee0' },
  eclair: { path: 'glbs/000-145/7be5302628084c94a964cd703cbce9dd.glb', size: 0.14, axis: 'max', rotateXDeg: 90, tris: 6000, title: 'Caramel Macchiato Donut', author: 'tsd1', uid: '7be5302628084c94a964cd703cbce9dd' },
  cherry_tart: { path: 'glbs/000-130/37e00109d5b04b859f7116742a9c3955.glb', size: 0.2, axis: 'max', tris: 4000, title: 'Cherry Pie - #3December2020 Day8', author: 'LordDiego', uid: '37e00109d5b04b859f7116742a9c3955' },
  water_bottle: { path: 'glbs/000-036/efa1c4c1f2a947659ded2e61e20eff31.glb', size: 0.24, axis: 'height', tris: 5000, title: 'Plastic Water Bottle', author: 'JeremyGrayson', uid: 'efa1c4c1f2a947659ded2e61e20eff31', glass: 0.35 },
  wine_glass: { path: 'glbs/000-091/be365d4a32184764abc4634c1280e6da.glb', size: 0.2, axis: 'height', tris: 4000, title: 'Wine Glass', author: 'RubberMan', uid: 'be365d4a32184764abc4634c1280e6da', glass: 0.3 },
  orchid: { path: 'glbs/000-058/d2c1afc47ba54d4491ee7b55469d11c8.glb', size: 0.38, axis: 'height', tris: 5000, title: 'Orchid from Poly by Google', author: 'ie-niels', uid: 'd2c1afc47ba54d4491ee7b55469d11c8' },
};

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  return Math.round(n);
}

async function fetchModel(id, spec) {
  fs.mkdirSync(CACHE, { recursive: true });
  const src = path.join(CACHE, path.basename(spec.path));
  if (!fs.existsSync(src) || fs.statSync(src).size === 0) {
    const r = await fetch(HF + spec.path);
    if (!r.ok) throw new Error(`${r.status} ${spec.path}`);
    fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(src);
  const before = triangles(doc);

  // Older Sketchfab exports keep their color texture in the spec/gloss workflow: convert it
  // to metal/rough first (disposing the extension would drop the texture).
  await doc.transform(metalRough());
  // Glass: drop transmission/volume (an extra full render pass in three.js) for alpha blending.
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (/transmission|volume|clearcoat|sheen|iridescence/i.test(ext.extensionName)) ext.dispose();
  }
  if (spec.glass) {
    for (const m of doc.getRoot().listMaterials()) {
      const c = m.getBaseColorFactor();
      if (c[3] < 0.99 || /glass|bottle|plastic|water/i.test(m.getName())) {
        m.setAlphaMode('BLEND').setBaseColorFactor([0.93, 0.97, 1.0, Math.min(c[3], spec.glass)]).setRoughnessFactor(0.05).setMetallicFactor(0); // clear glass, faint blue
      }
    }
  }

  const ratio = Math.min(1, spec.tris / Math.max(1, before));
  await doc.transform(
    dedup(),
    weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 })] : []),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }),
    prune(),
  );

  // Normalize: wrap the scene's roots in one node scaled to real size, centered, base at y = 0.
  const scene = doc.getRoot().listScenes()[0];
  if (spec.rotateXDeg) {
    // Lay the model down first (some scans stand on end), then measure.
    const a = (spec.rotateXDeg * Math.PI) / 360;
    const turn = doc.createNode(`${id}-turn`).setRotation([Math.sin(a), 0, 0, Math.cos(a)]);
    for (const child of scene.listChildren()) {
      scene.removeChild(child);
      turn.addChild(child);
    }
    scene.addChild(turn);
  }
  const b = getBounds(scene);
  const dims = b.max.map((v, i) => v - b.min[i]);
  const ref = spec.axis === 'height' ? dims[1] : Math.max(...dims);
  const s = spec.size / ref;
  const wrapper = doc.createNode(id).setScale([s, s, s]).setTranslation([-((b.min[0] + b.max[0]) / 2) * s, -b.min[1] * s, -((b.min[2] + b.max[2]) / 2) * s]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);

  const out = path.join(ROOT, 'public/models/props', `${id}.glb`);
  await io.write(out, doc);
  const after = getBounds(doc.getRoot().listScenes()[0]);
  console.log(`${id}: ${before} -> ${triangles(doc)} tris, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, size ${after.max.map((v, i) => (v - after.min[i]).toFixed(3)).join(' x ')} m`);
}

for (const [id, spec] of Object.entries(OBJAVERSE)) await fetchModel(id, spec).catch((e) => console.error(`${id} FAILED: ${e.message}`));
