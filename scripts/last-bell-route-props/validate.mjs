#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [stageArg, catalogArg, reportArg] = process.argv.slice(2);
if (!stageArg || !catalogArg || !reportArg) throw new Error('usage: validate.mjs <stage-root> <catalog.json> <report.json>');

const stage = resolve(stageArg);
const catalog = JSON.parse(await readFile(resolve(catalogArg), 'utf8'));
const reportPath = resolve(reportArg);
const sha256 = (input) => createHash('sha256').update(input).digest('hex');

function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB has no JSON chunk');
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

let transferBytes = 0;
const props = [];
for (const prop of catalog.props) {
  const root = join(stage, prop.key);
  const modelPath = join(root, 'model.glb');
  const thumbnailPath = join(root, 'thumbnail.webp');
  const [model, thumbnail] = await Promise.all([readFile(modelPath), readFile(thumbnailPath)]);
  const document = parseGlb(model);
  const nodes = document.nodes ?? [];
  const names = new Set(nodes.map((node) => node.name));
  const expected = ['LOD0_Hero', 'LOD1_Shelf', 'COL_Environment', 'Anchor_Environment'];
  const missing = expected.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`${prop.key}: missing nodes ${missing.join(', ')}`);
  const collider = nodes.find((node) => node.name === 'COL_Environment');
  if (collider?.extras?.collision_proxy !== true) throw new Error(`${prop.key}: collider contract is missing`);
  const anchor = nodes.find((node) => node.name === 'Anchor_Environment');
  if (anchor?.extras?.semantic_id !== prop.anchor || anchor?.extras?.prop_key !== prop.key) throw new Error(`${prop.key}: anchor contract mismatch`);
  const extensions = document.extensionsUsed ?? [];
  if (!extensions.includes('EXT_meshopt_compression')) throw new Error(`${prop.key}: Meshopt delivery is required`);
  if (!extensions.includes('KHR_texture_basisu')) throw new Error(`${prop.key}: KTX2 delivery is required`);
  if ((document.images?.length ?? 0) < 3) throw new Error(`${prop.key}: PBR texture payload is missing`);
  const materials = document.materials ?? [];
  if (materials.length < 3 || materials.some((item) => !item.pbrMetallicRoughness)) throw new Error(`${prop.key}: PBR material diversity is insufficient`);
  if (!materials.some((item) => item.pbrMetallicRoughness?.baseColorTexture && item.pbrMetallicRoughness?.metallicRoughnessTexture && item.normalTexture)) {
    throw new Error(`${prop.key}: PBR base color, ORM, and normal bindings are required`);
  }
  let triangles = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?.POSITION === undefined || primitive.attributes?.NORMAL === undefined || primitive.attributes?.TEXCOORD_0 === undefined || primitive.attributes?.TEXCOORD_1 === undefined) {
        throw new Error(`${prop.key}: every primitive needs positions, normals, UV0, and UV1`);
      }
      triangles += Math.floor((document.accessors?.[primitive.indices]?.count ?? document.accessors?.[primitive.attributes.POSITION]?.count ?? 0) / 3);
    }
  }
  if (triangles > 50000) throw new Error(`${prop.key}: triangle budget exceeded (${triangles})`);
  if (thumbnail.length > 320 * 1024) throw new Error(`${prop.key}: thumbnail budget exceeded (${thumbnail.length})`);
  transferBytes += model.length + thumbnail.length;
  props.push({
    key: prop.key,
    model: { bytes: model.length, sha256: sha256(model), triangles, extensions, texture_encoding: 'KTX2-authored-PBR; UV0+UV1' },
    thumbnail: { bytes: thumbnail.length, sha256: sha256(thumbnail), source: 'delivery-glb-chromium-ktx2-import' },
    required_nodes: expected,
  });
}

const cap = Number(catalog.transfer_hard_cap_mib) * 1024 * 1024;
if (transferBytes > cap) throw new Error(`route prop stage cap exceeded: ${transferBytes} > ${cap}`);
const report = {
  schema: 1,
  build_id: `${catalog.build_id_prefix}-${createHash('sha256').update(JSON.stringify(props.map((prop) => ({ key: prop.key, model: prop.model.sha256, thumbnail: prop.thumbnail.sha256 })))).digest('hex').slice(0, 16)}`,
  validation: 'pass',
  stage_only: true,
  delivery_transfer: { bytes: transferBytes, mib: Number((transferBytes / 1024 / 1024).toFixed(3)), hard_cap_mib: catalog.transfer_hard_cap_mib },
  props,
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
