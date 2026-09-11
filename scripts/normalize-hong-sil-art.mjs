#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const [inputPath, outputPath, widthText, heightText, position = 'attention'] =
  process.argv.slice(2);
const width = Number(widthText);
const height = Number(heightText);

if (
  !inputPath ||
  !outputPath ||
  !Number.isInteger(width) ||
  !Number.isInteger(height) ||
  !['attention', 'centre'].includes(position)
) {
  console.error(
    'Usage: node scripts/normalize-hong-sil-art.mjs <input> <output> <width> <height> [attention|centre]',
  );
  process.exitCode = 1;
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(inputPath)
    .resize(width, height, { fit: 'cover', position })
    .webp({ quality: 88, effort: 5 })
    .toFile(outputPath);
}
