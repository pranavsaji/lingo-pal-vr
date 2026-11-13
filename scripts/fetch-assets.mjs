#!/usr/bin/env node
/**
 * Downloads and optimizes the realistic CC0 assets from Poly Haven
 * (https://polyhaven.com, CC0: no attribution required, credited in CREDITS.md):
 *   - props/food models  -> public/models/props/<id>.glb (simplified, WebP textures)
 *   - surface textures   -> public/textures/<id>/{diff,nor,rough}.webp
 *   - environments       -> public/hdri/<id>_1k.hdr (lighting) + <id>_bg.jpg (backdrop)
 *
 * Re-run any time: `node scripts/fetch-assets.mjs [--only id,id]`. Downloads are
 * cached in .tmp/polyhaven. Budgets keep the headset at frame rate: every model
 * has a triangle target and textures are capped (512 px props, 1024 px surfaces).
 */

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.tmp/polyhaven');
const API = 'https://api.polyhaven.com/files/';

/** Model id -> max triangles and texture size. */
export const MODELS = {
  // cafe
  croissant: { tris: 3000, tex: 512 },
  food_apple_01: { tris: 2000, tex: 512 },
  strawberry_chocolate_cake: { tris: 5000, tex: 512, error: 0.02 },
  wine_bottles_01: { tris: 6000, tex: 512 },
  potted_plant_01: { tris: 6000, tex: 512, error: 0.05 },
  ceramic_vase_01: { tris: 2500, tex: 512 },
  round_wooden_table_01: { tris: 4000, tex: 512 },
  painted_wooden_chair_01: { tris: 4000, tex: 512 },
  standing_chalkboard_01: { tris: 2500, tex: 512 },
  hanging_industrial_lamp: { tris: 2500, tex: 512 },
  // boulangerie
  carrot_cake: { tris: 5000, tex: 512 },
  hamburger_buns: { tris: 4000, tex: 512 },
  wooden_cutting_board: { tris: 1500, tex: 512 },
  wicker_basket_01: { tris: 5000, tex: 512, error: 0.03 },
  // marche
  wooden_crate_01: { tris: 2000, tex: 512 },
  bananas: { tris: 3000, tex: 512 },
  food_pears_asian_01: { tris: 2000, tex: 512 },
  lemon: { tris: 1500, tex: 512 },
  yellow_onion: { tris: 1500, tex: 512 },
  sweet_potato: { tris: 1500, tex: 512 },
  food_kiwi_01: { tris: 1500, tex: 512 },
  food_avocado_01: { tris: 1500, tex: 512 },
  food_pomegranate_01: { tris: 1500, tex: 512 },
};

export const TEXTURES = [
  'checkered_pavement_tiles', // cafe floor
  'marble_01', // counter tops
  'dark_wood', // counter fronts
  'oak_veneer_01', // shelves
  'red_brick_plaster_patch_02', // back walls
  'terracotta_floor_tiles', // boulangerie floor
  'cobblestone_floor_04', // market floor
  'wood_table_worn', // market stall
];

export const HDRIS = ['comfy_cafe', 'decor_shop', 'leadenhall_market'];

/**
 * Regions to blur in a backdrop (fractions of width/height): real shop names and
 * brand lettering in the photos, so the app shows no real-world trademarks.
 */
const REDACT = {
  leadenhall_market: [
    [0, 0.285, 1, 0.352], // fascia boards with shop names, all around
    [0.45, 0.25, 0.55, 0.278], // red LED sign over the arcade
    [0.335, 0.375, 0.405, 0.5], // lettering in shop windows
    [0.2, 0.43, 0.235, 0.49],
  ],
};

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i > 0 ? new Set(process.argv[i + 1].split(',')) : null;
})();

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  return Math.round(n);
}

async function model(id, { tris, tex, error = 0.004 }) {
  const files = await json(API + id);
  const g = files.gltf['1k'].gltf;
  const dir = path.join(CACHE, 'models', id);
  const main = await download(g.url, path.join(dir, path.basename(g.url)));
  for (const [rel, info] of Object.entries(g.include ?? {})) await download(info.url, path.join(dir, rel));

  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(main);
  const before = triangles(doc);
  const ratio = Math.min(1, tris / Math.max(1, before));
  await doc.transform(
    dedup(),
    weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false })] : []),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }),
    prune(),
  );
  const out = path.join(ROOT, 'public/models/props', `${id}.glb`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const box = doc.getRoot().listScenes()[0];
  console.log(`model ${id}: ${before} -> ${triangles(doc)} tris, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`, box ? '' : '(no scene)');
}

async function texture(id) {
  const files = await json(API + id);
  const outDir = path.join(ROOT, 'public/textures', id);
  fs.mkdirSync(outDir, { recursive: true });
  const maps = { diff: files.Diffuse, nor: files.nor_gl, rough: files.Rough };
  for (const [name, entry] of Object.entries(maps)) {
    const url = entry?.['1k']?.jpg?.url;
    if (!url) continue;
    const src = await download(url, path.join(CACHE, 'textures', id, path.basename(url)));
    let img = sharp(src).resize(1024, 1024, { fit: 'fill' });
    if (name === 'rough') img = img.grayscale();
    await img.webp({ quality: name === 'nor' ? 90 : 80 }).toFile(path.join(outDir, `${name}.webp`));
  }
  console.log(`texture ${id}: ${fs.readdirSync(outDir).join(', ')}`);
}

async function hdri(id) {
  const files = await json(API + id);
  const outDir = path.join(ROOT, 'public/hdri');
  fs.mkdirSync(outDir, { recursive: true });
  const hdr = files.hdri['1k'].hdr.url;
  fs.copyFileSync(await download(hdr, path.join(CACHE, 'hdri', path.basename(hdr))), path.join(outDir, `${id}_1k.hdr`));
  // Backdrop: the tonemapped photo, 4096 x 2048 (about 11 px per degree), JPEG.
  const bg = await download(files.tonemapped.url, path.join(CACHE, 'hdri', `${id}_tonemapped.jpg`));
  const W = 4096;
  const H = 2048;
  const base = await sharp(bg, { limitInputPixels: false }).resize(W, H, { fit: 'fill' }).toBuffer();
  const patches = [];
  for (const [x0, y0, x1, y1] of REDACT[id] ?? []) {
    const left = Math.round(x0 * W);
    const top = Math.round(y0 * H);
    const width = Math.round((x1 - x0) * W);
    const height = Math.round((y1 - y0) * H);
    patches.push({ input: await sharp(base).extract({ left, top, width, height }).blur(7).toBuffer(), left, top });
  }
  await sharp(base).composite(patches).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(outDir, `${id}_bg.jpg`));
  console.log(`hdri ${id}: ${(fs.statSync(path.join(outDir, `${id}_bg.jpg`)).size / 1024).toFixed(0)} KB backdrop`);
}

const want = (id) => !only || only.has(id);
for (const [id, opts] of Object.entries(MODELS)) if (want(id)) await model(id, opts).catch((e) => console.error(`model ${id} FAILED: ${e.message}`));
for (const id of TEXTURES) if (want(id)) await texture(id).catch((e) => console.error(`texture ${id} FAILED: ${e.message}`));
for (const id of HDRIS) if (want(id)) await hdri(id).catch((e) => console.error(`hdri ${id} FAILED: ${e.message}`));
