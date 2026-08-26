#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [deliveryArg, catalogArg, reportArg] = process.argv.slice(2);
if (!deliveryArg || !catalogArg || !reportArg) throw new Error('usage: validate.mjs <delivery-root> <catalog.json> <report.json>');
const deliveryRoot = resolve(deliveryArg);
const catalog = JSON.parse(await readFile(resolve(catalogArg), 'utf8'));
const output = resolve(reportArg);

function glbJson(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB.');
  const length = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB has no JSON chunk.');
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8').trim());
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reportProducts = [];
let transferBytes = 0;
const graphicNodeNames = { idcard: 'GraphicLayer_ID' };
const forbiddenDeliveryMarkers = /(?:^|[^a-z0-9])(?:placeholder|clay|procedural|fallback|pending[_-]approved[_-]character[_-]replacement|non[_-]likeness[_-]placeholder|technical[_-]mountable[_-]placeholder)(?=$|[^a-z0-9])/i;

for (const product of catalog.products) {
  const key = product.key;
  const directory = join(deliveryRoot, key);
  const modelPath = join(directory, 'model.glb');
  const thumbPath = join(directory, 'thumbnail.webp');
  const graphicPath = join(directory, 'graphic-layer.svg');
  const [model, thumbnail, graphic] = await Promise.all([readFile(modelPath), readFile(thumbPath), readFile(graphicPath, 'utf8')]);
  const doc = glbJson(model);
  const nodes = doc.nodes ?? [];
  const names = new Set(nodes.map((node) => node.name));
  const graphicNodeName = graphicNodeNames[key] ?? `GraphicLayer_${key[0].toUpperCase()}${key.slice(1)}`;
  const expected = ['LOD0_Hero', 'LOD1_Shelf', 'COL_Collectible', 'Anchor_Collectible', graphicNodeName];
  const missing = expected.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`${key}: missing semantic nodes ${missing.join(', ')}`);
  const anchor = nodes.find((node) => node.name === 'Anchor_Collectible');
  if (anchor?.extras?.semantic_id !== product.anchor || anchor?.extras?.collectible_key !== key) {
    throw new Error(`${key}: stable collectible anchor mismatch`);
  }
  const collider = nodes.find((node) => node.name === 'COL_Collectible');
  if (collider?.extras?.collision_proxy !== true) throw new Error(`${key}: collision proxy missing`);
  const graphicNode = nodes.find((node) => node.name === graphicNodeName);
  if (graphicNode?.extras?.text_baked !== false) throw new Error(`${key}: graphic layer must remain text-free and replaceable`);
  if (!graphic.includes('<svg') || graphic.includes('<text') || /[가-힣A-Za-z0-9]/.test(graphic.replace(/<(?:svg|rect|path)[^>]*>|<\/(?:svg)>|[#a-fA-F.;:=\s"'/-]/g, ''))) {
    throw new Error(`${key}: graphic-layer.svg contains prohibited copy`);
  }
  const extensions = doc.extensionsUsed ?? [];
  if (!extensions.includes('EXT_meshopt_compression')) throw new Error(`${key}: delivery GLB is not Meshopt compressed`);
  if (!extensions.includes('KHR_texture_basisu')) throw new Error(`${key}: KTX2 texture delivery is required`);
  if ((doc.images?.length ?? 0) < 3) throw new Error(`${key}: base, normal, and ORM texture payloads are required`);
  if (forbiddenDeliveryMarkers.test(JSON.stringify({ nodes, materials: doc.materials }))) {
    throw new Error(`${key}: delivery retains forbidden low-fidelity acceptance markers`);
  }
  const materials = doc.materials ?? [];
  if (materials.length < 3 || materials.some((material) => !material.pbrMetallicRoughness)) {
    throw new Error(`${key}: authored PBR material diversity is missing`);
  }
  if (!materials.some((material) => material.pbrMetallicRoughness?.baseColorTexture && material.pbrMetallicRoughness?.metallicRoughnessTexture && material.normalTexture)) {
    throw new Error(`${key}: PBR base-color, ORM, and normal slots are required`);
  }
  let triangles = 0;
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const accessor = doc.accessors?.[primitive.indices];
    const positions = doc.accessors?.[primitive.attributes?.POSITION];
    if (primitive.attributes?.TEXCOORD_0 === undefined || primitive.attributes?.TEXCOORD_1 === undefined || primitive.attributes?.NORMAL === undefined) {
      throw new Error(`${key}: every delivery primitive requires UV0, UV1, and normals`);
    }
    triangles += Math.floor((accessor?.count ?? positions?.count ?? 0) / 3);
  }
  if (triangles > 40000) throw new Error(`${key}: product triangle budget exceeded (${triangles})`);
  if (thumbnail.length > 320 * 1024) throw new Error(`${key}: thumbnail budget exceeded (${thumbnail.length} bytes)`);
  transferBytes += model.length + thumbnail.length + Buffer.byteLength(graphic);
  reportProducts.push({
    key,
    model: { bytes: model.length, sha256: sha256(model), triangles, extensions, texture_encoding: 'KTX2-authored-PBR; UV0+UV1' },
    thumbnail: { bytes: thumbnail.length, sha256: sha256(thumbnail), source: 'delivery-glb-chromium-ktx2-import' },
    graphic_layer: { bytes: Buffer.byteLength(graphic), sha256: sha256(Buffer.from(graphic)), text_baked: false },
    required_nodes: expected,
  });
}

if (transferBytes > 4 * 1024 * 1024) throw new Error(`Last Bell product shelf pack hard cap exceeded: ${transferBytes}`);
const report = {
  schema: 1,
  build_id: `last-bell-products-${createHash('sha256').update(JSON.stringify(reportProducts.map((item) => ({ key: item.key, model: item.model.sha256, thumbnail: item.thumbnail.sha256 })))).digest('hex').slice(0, 16)}`,
  validation: 'pass',
  delivery_transfer: { bytes: transferBytes, mib: Number((transferBytes / 1024 / 1024).toFixed(3)), target_mib: 4, hard_cap_mib: 4 },
  products: reportProducts,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
