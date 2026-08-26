#!/usr/bin/env node
/**
 * Make a private, reproducible review turntable from the exact delivery GLBs.
 *
 * This is intentionally a review artifact: it does not alter the delivery
 * package, manifest, or release state. The four render presets share the same
 * lighting, lens, resolution, and runtime GLTF importer used for thumbnails.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const [stageArg, catalogArg, reviewArg] = process.argv.slice(2);
if (!stageArg || !catalogArg || !reviewArg) {
  throw new Error('usage: render-turntable.mjs <delivery-stage> <catalog.json> <review-output>');
}

const stage = resolve(stageArg);
const catalog = JSON.parse(await readFile(resolve(catalogArg), 'utf8'));
const review = resolve(reviewArg);
const renderer = resolve(import.meta.dirname, 'render-delivery.mjs');
const presets = ['full-front', 'catalog-three-quarter', 'full-three-quarter', 'full-back'];
const reviewLabel = process.env.LAST_BELL_PRODUCT_REVIEW_LABEL ?? 'v4';

function runRenderer(model, output, preset) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [renderer, model, output, preset], { stdio: 'inherit' });
    child.once('error', rejectRun);
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`turntable ${preset} failed with exit ${code}`)));
  });
}

function labelSvg(label) {
  return Buffer.from(`<svg width="360" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="360" height="34" fill="#0b1014"/><text x="16" y="22" fill="#b9d6da" font-family="Arial, sans-serif" font-size="16" letter-spacing="2">${label.toUpperCase()}</text></svg>`);
}

const rendered = [];
for (const product of catalog.products) {
  const productOutput = join(review, 'turntables', product.key);
  await mkdir(productOutput, { recursive: true });
  const model = join(stage, product.key, 'model.glb');
  const frames = [];
  for (const preset of presets) {
    const output = join(productOutput, `${preset}.png`);
    await runRenderer(model, output, preset);
    frames.push(output);
  }
  rendered.push({ key: product.key, frames });
}

const tileWidth = 360;
const tileHeight = 278;
const rowHeight = tileHeight + 34;
const composites = [];
for (let row = 0; row < rendered.length; row += 1) {
  for (let column = 0; column < presets.length; column += 1) {
    const frame = await sharp(rendered[row].frames[column])
      .resize(tileWidth, tileHeight, { fit: 'contain', background: '#10161a' })
      .png()
      .toBuffer();
    composites.push({ input: frame, left: column * tileWidth, top: row * rowHeight });
  }
  composites.push({ input: labelSvg(rendered[row].key), left: 0, top: row * rowHeight + tileHeight });
}

const contactSheet = join(review, `last-bell-products-${reviewLabel}-turntable-contact-sheet.png`);
await sharp({
  create: {
    width: tileWidth * presets.length,
    height: rowHeight * rendered.length,
    channels: 4,
    background: '#10161a',
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(contactSheet);

const contactBytes = await readFile(contactSheet);
const evidence = {
  schema: 1,
  status: 'private-visual-review-required',
  build_inputs: catalog.products.map((product) => product.key),
  camera: {
    lens: 38,
    presets,
    renderer: 'scripts/last-bell-products/render-delivery.mjs',
    source: 'exact private delivery GLB imports',
  },
  contact_sheet: {
    path: contactSheet,
    sha256: createHash('sha256').update(contactBytes).digest('hex'),
  },
  review_status: {
    human_visual_review: 'required-not-asserted',
    ip_and_manufacturing_review: 'required-not-asserted',
    release_promotion: 'blocked',
  },
};
await writeFile(join(review, `last-bell-products-${reviewLabel}-turntable-evidence.json`), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
