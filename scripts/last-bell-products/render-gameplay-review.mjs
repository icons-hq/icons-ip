#!/usr/bin/env node
/** Render private gameplay-flashlight evidence from the exact delivery GLBs. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const [stageArg, catalogArg, reviewArg] = process.argv.slice(2);
if (!stageArg || !catalogArg || !reviewArg) {
  throw new Error('usage: render-gameplay-review.mjs <delivery-stage> <catalog.json> <review-output>');
}

const stage = resolve(stageArg);
const catalog = JSON.parse(await readFile(resolve(catalogArg), 'utf8'));
const review = resolve(reviewArg);
const renderer = resolve(import.meta.dirname, 'render-delivery.mjs');
const reviewLabel = process.env.LAST_BELL_PRODUCT_REVIEW_LABEL ?? 'v4';

function render(model, output) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [renderer, model, output, 'gameplay-flashlight'], { stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`gameplay flashlight render failed with exit ${code}`)));
  });
}

function labelSvg(label) {
  return Buffer.from(`<svg width="280" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="280" height="34" fill="#05090d"/><text x="14" y="22" fill="#b9d6da" font-family="Arial, sans-serif" font-size="15" letter-spacing="2">${label.toUpperCase()}</text></svg>`);
}

const tileWidth = 280;
const tileHeight = 240;
const rowHeight = tileHeight + 34;
const columns = 5;
const composites = [];
const frames = [];
for (let index = 0; index < catalog.products.length; index += 1) {
  const product = catalog.products[index];
  const output = join(review, 'gameplay-flashlight', `${product.key}.png`);
  await mkdir(resolve(output, '..'), { recursive: true });
  await render(join(stage, product.key, 'model.glb'), output);
  frames.push(output);
  const image = await sharp(output).resize(tileWidth, tileHeight, { fit: 'contain', background: '#020407' }).png().toBuffer();
  const row = Math.floor(index / columns);
  const column = index % columns;
  composites.push({ input: image, left: column * tileWidth, top: row * rowHeight });
  composites.push({ input: labelSvg(product.key), left: column * tileWidth, top: row * rowHeight + tileHeight });
}

const contactSheet = join(review, `last-bell-products-${reviewLabel}-gameplay-flashlight-contact-sheet.png`);
await sharp({
  create: { width: columns * tileWidth, height: Math.ceil(catalog.products.length / columns) * rowHeight, channels: 4, background: '#020407' },
}).composite(composites).png({ compressionLevel: 9 }).toFile(contactSheet);

const [contactBytes, ...modelBytes] = await Promise.all([readFile(contactSheet), ...catalog.products.map((product) => readFile(join(stage, product.key, 'model.glb')))]);
const evidence = {
  schema: 1,
  status: 'private-visual-review-required',
  lighting: 'single cold gameplay flashlight plus near-black ambient',
  source: 'exact private delivery GLB imports',
  products: catalog.products.map((product, index) => ({
    key: product.key,
    render: frames[index],
    model_sha256: createHash('sha256').update(modelBytes[index]).digest('hex'),
  })),
  contact_sheet: { path: contactSheet, sha256: createHash('sha256').update(contactBytes).digest('hex') },
  review_status: { human_visual_review: 'required-not-asserted', ip_and_manufacturing_review: 'required-not-asserted', release_promotion: 'blocked' },
};
await writeFile(join(review, `last-bell-products-${reviewLabel}-gameplay-flashlight-evidence.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
