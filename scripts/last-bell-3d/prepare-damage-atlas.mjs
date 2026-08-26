#!/usr/bin/env node
/**
 * Turn the project-authored white-background damage atlas into a compact RGBA
 * decal input.  The source is not a show still and is never projected onto
 * architecture: selected cells are used only as local grime/crack layers on
 * top of already modelled damage and debris.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const source = resolve(process.argv[2] ?? 'scripts/last-bell-3d/assets/last-bell-damage-atlas-v1.png');
const destination = resolve(process.argv[3] ?? 'outputs/last-bell-3d/raw/textures/damage-atlas-v1-keyed.png');
const provenancePath = resolve(process.argv[4] ?? 'outputs/last-bell-3d/raw/damage-atlas-provenance.json');
const cwd = resolve(process.cwd());
const repoRelative = (path) => {
  const relative = path.slice(cwd.length + 1);
  return relative && !relative.startsWith('..') ? relative : path;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const input = await readFile(source);
const { data, info } = await sharp(input).resize(512, 512, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (let offset = 0; offset < data.length; offset += 4) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  // White-distance key with a soft 1--2 pixel edge.  Unpremultiplying against
  // white removes the pale fringe rather than retaining a grey outline.
  const distance = Math.hypot(255 - red, 255 - green, 255 - blue);
  // Lanczos resampling softens an otherwise pure white background by a few
  // RGB levels. Reject that near-white halo aggressively; meaningful cracks,
  // soot and plaster remain far outside this threshold.
  const alpha = Math.max(0, Math.min(1, (distance - 34) / 72));
  if (alpha <= 0.001) {
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
    continue;
  }
  data[offset] = Math.max(0, Math.min(255, Math.round((red - 255 * (1 - alpha)) / alpha)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round((green - 255 * (1 - alpha)) / alpha)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round((blue - 255 * (1 - alpha)) / alpha)));
  data[offset + 3] = Math.round(alpha * 255);
}

const output = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, output);
await writeFile(provenancePath, JSON.stringify({
  schema: 1,
  kind: 'AI-generated damage atlas',
  license_scope: 'project-authored input',
  source_path: repoRelative(source),
  source_sha256: sha256(input),
  source_bytes: input.byteLength,
  output_path: repoRelative(destination),
  output_sha256: sha256(output),
  output_bytes: output.byteLength,
  transform: '512px white-distance soft alpha key plus white edge decontamination',
  no_source_projection: true,
  no_drama_or_netflix_source_pixels: true,
}, null, 2) + '\n');
console.log(`${destination} ${sha256(output)}`);
