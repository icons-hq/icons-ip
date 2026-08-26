#!/usr/bin/env node
/**
 * Basis compression fallback for environments without the KTX-Software CLI.
 * Uses ktx2-encoder's Basis Universal WASM implementation with glTF Transform
 * core, and deliberately applies ETC1S and UASTC by material texture slot.
 */
import { NodeIO } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: compress-ktx2.mjs <input.glb> <output.glb>');

const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
const document = await io.read(input);
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
await document.transform(
  ktx2({
    isUASTC: false,
    isInputSRGB: true,
    generateMipmap: true,
    imageDecoder,
    slots: /baseColorTexture|emissiveTexture/,
  }),
);
await document.transform(
  ktx2({
    isUASTC: true,
    isInputSRGB: false,
    generateMipmap: true,
    imageDecoder,
    slots: /normalTexture|metallicRoughnessTexture|occlusionTexture/,
  }),
);
await io.write(output, document);
