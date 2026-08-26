#!/usr/bin/env node
/**
 * Render private discovery-distance evidence from the final delivery GLBs.
 *
 * Unlike catalog thumbnails, this puts each exact runtime import on a
 * desk/floor/shelf/locker/board support at a fixed 1.5–3m flashlight distance.
 * The support meshes exist only in the review renderer and never enter a GLB.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const [stageArg, catalogArg, reviewArg] = process.argv.slice(2);
if (!stageArg || !catalogArg || !reviewArg) {
  throw new Error('usage: render-discovery-review.mjs <delivery-stage> <catalog.json> <review-output>');
}

const stage = resolve(stageArg);
const catalog = JSON.parse(await readFile(resolve(catalogArg), 'utf8'));
const review = resolve(reviewArg);
const renderer = resolve(import.meta.dirname, 'render-delivery.mjs');
const reviewLabel = process.env.LAST_BELL_PRODUCT_REVIEW_LABEL ?? 'v5';
const discoveryProfiles = {
  idcard: { support: 'desk', distance_m: 2.5 },
  badge: { support: 'locker', distance_m: 2.2 },
  photo: { support: 'floor', distance_m: 2.6 },
  radio: { support: 'desk', distance_m: 2.0 },
  kit: { support: 'shelf', distance_m: 2.1 },
  zipup: { support: 'locker', distance_m: 2.8 },
  archery: { support: 'board', distance_m: 2.1 },
  postcard: { support: 'board', distance_m: 2.2 },
  candle: { support: 'shelf', distance_m: 1.7 },
  blanket: { support: 'floor', distance_m: 2.0 },
};

function render(model, output, profile) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [renderer, model, output, 'gameplay-discovery', profile.support, String(profile.distance_m)], { stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`discovery-distance render failed with exit ${code}`)));
  });
}

function labelSvg(label) {
  return Buffer.from(`<svg width="360" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="360" height="40" fill="#05090d"/><text x="14" y="25" fill="#b9d6da" font-family="Arial, sans-serif" font-size="14" letter-spacing="1.4">${label.toUpperCase()}</text></svg>`);
}

const tileWidth = 360;
const tileHeight = 252;
const rowHeight = tileHeight + 40;
const columns = 5;
const composites = [];
const frames = [];
for (let index = 0; index < catalog.products.length; index += 1) {
  const product = catalog.products[index];
  const profile = discoveryProfiles[product.key];
  if (!profile) throw new Error(`missing discovery profile for ${product.key}`);
  const output = join(review, 'discovery-distance', `${product.key}.png`);
  await mkdir(resolve(output, '..'), { recursive: true });
  await render(join(stage, product.key, 'model.glb'), output, profile);
  frames.push(output);
  const image = await sharp(output).resize(tileWidth, tileHeight, { fit: 'contain', background: '#020407' }).png().toBuffer();
  const row = Math.floor(index / columns);
  const column = index % columns;
  composites.push({ input: image, left: column * tileWidth, top: row * rowHeight });
  composites.push({ input: labelSvg(`${product.key} | ${profile.support} | ${profile.distance_m.toFixed(1)}m`), left: column * tileWidth, top: row * rowHeight + tileHeight });
}

const contactSheet = join(review, `last-bell-products-${reviewLabel}-discovery-distance-contact-sheet.png`);
await sharp({
  create: { width: columns * tileWidth, height: Math.ceil(catalog.products.length / columns) * rowHeight, channels: 4, background: '#020407' },
}).composite(composites).png({ compressionLevel: 9 }).toFile(contactSheet);

const [contactBytes, ...modelBytes] = await Promise.all([readFile(contactSheet), ...catalog.products.map((product) => readFile(join(stage, product.key, 'model.glb')))]);
const evidence = {
  schema: 1,
  status: 'private-visual-review-required',
  source: 'exact private delivery GLB imports',
  lighting: 'current cold gameplay flashlight profile with low ambient fill',
  distance_rule_m: { minimum: 1.5, maximum: 3.0 },
  products: catalog.products.map((product, index) => ({
    key: product.key,
    catalog_placement: product.placement,
    support: discoveryProfiles[product.key].support,
    discovery_distance_m: discoveryProfiles[product.key].distance_m,
    render: frames[index],
    model_sha256: createHash('sha256').update(modelBytes[index]).digest('hex'),
  })),
  contact_sheet: { path: contactSheet, sha256: createHash('sha256').update(contactBytes).digest('hex') },
  review_status: {
    human_visual_review: 'required-not-asserted',
    ip_and_manufacturing_review: 'required-not-asserted',
    release_promotion: 'blocked',
  },
};
await writeFile(join(review, `last-bell-products-${reviewLabel}-discovery-distance-evidence.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
