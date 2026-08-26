#!/usr/bin/env node
/** Encode a Blender-baked static AO PNG as an independent UASTC KTX2 file. */
import { readFile, writeFile } from 'node:fs/promises';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: compress-static-ao.mjs <input.png> <output.ktx2>');
const image = await readFile(input);
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const encoded = await encodeToKTX2(image, {
  isUASTC: true,
  isInputSRGB: false,
  generateMipmap: true,
  imageDecoder,
});
await writeFile(output, encoded);
