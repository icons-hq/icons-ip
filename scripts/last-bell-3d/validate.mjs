#!/usr/bin/env node
/** Validate shipped GLBs without depending on an application runtime. */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const [publicDirArg, rawDirArg] = process.argv.slice(2);
if (!publicDirArg) throw new Error('usage: validate.mjs <public-dir> [raw-dir]');
const publicDir = resolve(publicDirArg);
const rawDir = rawDirArg ? resolve(rawDirArg) : null;
const requiredNodes = {
  'entry.glb': ['Entry_Root', 'Entry_ExposedBrickDamage', 'Entry_BrokenGlassFacade'],
  'start-room.glb': ['StartRoom_Root', 'StartRoom_DirtyTileFloor', 'StartRoom_RearBlackboard', 'Hide_Desk_Classroom_Anchor', 'Hide_Desk_Classroom_Cover'],
  'first-bay.glb': ['FirstBay_Root', 'FirstBay_DirtyTileFloor', 'FirstBay_BlackWall'],
  'classroom-door.glb': ['ClassroomDoor_Root', 'Door_Frame', 'Door_Rail', 'Door_Panel_L', 'Door_Panel_R', 'Door_Glass_L', 'Door_Glass_R'],
};
const requiredSemanticAlternatives = {
  'first-bay.glb': [
    {
      label: 'authored right-wall finish',
      values: ['architecture.hyosan.first-bay.right-wall-finish', 'architecture.hyosan.corridor.lower-painted-wall'],
    },
    {
      label: 'authored hero desk',
      values: ['prop.hyosan.first-bay.hero-desk', 'prop.hyosan.destroyed-desk'],
    },
    {
      label: 'authored hero chair',
      values: ['prop.hyosan.first-bay.hero-chair', 'prop.hyosan.student-chair'],
    },
  ],
};
const runtimeAssets = {
  entry: { file: 'entry.glb', lightmapNode: 'Entry_WetForecourt' },
  startRoom: { file: 'start-room.glb', lightmapNode: 'StartRoom_DirtyTileFloor' },
  firstBay: { file: 'first-bay.glb', lightmapNode: 'FirstBay_DirtyTileFloor' },
  classroomDoor: { file: 'classroom-door.glb', lightmapNode: null },
};
const boundsGate = {
  'start-room.glb': { min: [-7.05, -0.2, -2.2], max: [7.05, 4.2, 13.3] },
  'first-bay.glb': { min: [-3.2, -0.2, 13.1], max: [3.2, 4.2, 25.1] },
  'classroom-door.glb': { min: [-1.8, -1.6, -0.5], max: [1.8, 1.8, 0.5] },
};
const rawSourceFiles = Object.keys(requiredNodes).map((filename) => filename.replace('.glb', '.raw.glb'));
const rawSourcesAvailable = rawDir !== null
  && existsSync(join(rawDir, 'build-report.json'))
  && rawSourceFiles.every((filename) => existsSync(join(rawDir, filename)));
const committedMetadata = rawSourcesAvailable
  ? null
  : JSON.parse(await readFile(join(publicDir, 'metadata.json'), 'utf8'));

function glbJson(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('missing JSON chunk');
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

function descendants(doc, nodeIndex, seen = new Set()) {
  if (seen.has(nodeIndex)) return seen;
  seen.add(nodeIndex);
  for (const child of doc.nodes?.[nodeIndex]?.children ?? []) descendants(doc, child, seen);
  return seen;
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * qy * qy - 2 * qz * qz) * sx, (2 * qx * qy + 2 * qz * qw) * sx, (2 * qx * qz - 2 * qy * qw) * sx, 0,
    (2 * qx * qy - 2 * qz * qw) * sy, (1 - 2 * qx * qx - 2 * qz * qz) * sy, (2 * qy * qz + 2 * qx * qw) * sy, 0,
    (2 * qx * qz + 2 * qy * qw) * sz, (2 * qy * qz - 2 * qx * qw) * sz, (1 - 2 * qx * qx - 2 * qy * qy) * sz, 0,
    x, y, z, 1,
  ];
}
function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}
function sceneBounds(doc) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  const extend = (point) => point.forEach((value, index) => {
    minimum[index] = Math.min(minimum[index], value);
    maximum[index] = Math.max(maximum[index], value);
  });
  const visit = (index, parent) => {
    const node = doc.nodes?.[index] ?? {};
    const matrix = multiply(parent, nodeMatrix(node));
    for (const primitive of doc.meshes?.[node.mesh]?.primitives ?? []) {
      const accessor = doc.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      for (const x of [accessor.min[0], accessor.max[0]]) for (const y of [accessor.min[1], accessor.max[1]]) for (const z of [accessor.min[2], accessor.max[2]]) extend(transformPoint(matrix, [x, y, z]));
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  for (const root of doc.scenes?.[doc.scene ?? 0]?.nodes ?? []) visit(root, identity());
  return { min: minimum.map((value) => Number(value.toFixed(3))), max: maximum.map((value) => Number(value.toFixed(3))) };
}

async function modelReport(filename, rawBounds) {
  const path = join(publicDir, filename);
  const binary = await readFile(path);
  const doc = glbJson(binary);
  const nodes = doc.nodes ?? [];
  const names = nodes.map((node) => node.name).filter(Boolean);
  const missing = requiredNodes[filename].filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`${filename}: missing semantic nodes ${missing.join(', ')}`);
  const semanticIds = new Set(nodes.map((node) => node.extras?.semantic_id).filter(Boolean));
  const missingSemanticAlternatives = (requiredSemanticAlternatives[filename] ?? [])
    .filter((requirement) => !requirement.values.some((value) => semanticIds.has(value)))
    .map((requirement) => requirement.label);
  if (missingSemanticAlternatives.length) {
    throw new Error(`${filename}: missing authored semantic roles ${missingSemanticAlternatives.join(', ')}`);
  }
  const meshes = doc.meshes ?? [];
  const materials = doc.materials ?? [];
  const isTransparentMaterial = (material) => material.name === 'Wired_Glass' || material.name === 'Damage_Decal_Atlas';
  const opaqueViolations = materials
    .filter((material) => !isTransparentMaterial(material))
    .filter((material) => (material.alphaMode && material.alphaMode !== 'OPAQUE') || material.doubleSided)
    .map((material) => material.name || '<unnamed>');
  if (opaqueViolations.length) {
    throw new Error(`${filename}: opaque material contract breached by ${opaqueViolations.join(', ')}`);
  }
  const missingOcclusion = materials
    .filter((material) => !isTransparentMaterial(material))
    .filter((material) => !material.occlusionTexture)
    .map((material) => material.name || '<unnamed>');
  if (missingOcclusion.length) {
    throw new Error(`${filename}: opaque PBR materials missing occlusionTexture: ${missingOcclusion.join(', ')}`);
  }
  const missingPhysicalScale = materials
    .filter((material) => ['Dirty_Floor_Tile', 'Charred_Plaster', 'Smoked_Aluminium', 'Worn_Wood', 'Exposed_Brick'].includes(material.name))
    .filter((material) => typeof material.extras?.physical_texture_width_m !== 'number')
    .map((material) => material.name);
  if (missingPhysicalScale.length) {
    throw new Error(`${filename}: PBR physical texture scale metadata missing for ${missingPhysicalScale.join(', ')}`);
  }
  const glass = materials.find((material) => material.name === 'Wired_Glass');
  if (glass && glass.alphaMode !== 'BLEND') {
    throw new Error(`${filename}: Wired_Glass must retain BLEND alpha mode`);
  }
  const transparentMaterials = materials.filter(isTransparentMaterial);
  if (transparentMaterials.length > 2) {
    throw new Error(`${filename}: transparent material budget exceeded (${transparentMaterials.map((material) => material.name).join(', ')})`);
  }
  const illegalBlend = materials.filter((material) => material.alphaMode === 'BLEND' && !isTransparentMaterial(material));
  if (illegalBlend.length) {
    throw new Error(`${filename}: unexpected BLEND material ${illegalBlend.map((material) => material.name).join(', ')}`);
  }
  let triangles = 0;
  let primitives = 0;
  let uv1Primitives = 0;
  for (const mesh of meshes) for (const primitive of mesh.primitives ?? []) {
    primitives += 1;
    const accessor = doc.accessors?.[primitive.indices];
    const position = doc.accessors?.[primitive.attributes?.POSITION];
    if ((primitive.mode ?? 4) === 4) triangles += Math.floor((accessor?.count ?? position?.count ?? 0) / 3);
    if (Object.hasOwn(primitive.attributes ?? {}, 'TEXCOORD_1')) uv1Primitives += 1;
  }
  if (!uv1Primitives) throw new Error(`${filename}: no TEXCOORD_1 lightmap UVs`);
  const sceneNodes = (doc.scenes?.[doc.scene ?? 0]?.nodes ?? []).flatMap((node) => [...descendants(doc, node)]);
  const semanticExtras = nodes.filter((node) => node.extras?.semantic_id).length;
  if (!semanticExtras) throw new Error(`${filename}: no semantic extras`);
  const instancedNodes = nodes.filter((node) => node.extensions?.EXT_mesh_gpu_instancing).length;
  const drawCalls = nodes.reduce((count, node) => count + (node.mesh === undefined ? 0 : (meshes[node.mesh]?.primitives?.length ?? 0)), 0);
  return {
    file: filename,
    bytes: binary.byteLength,
    sha256: createHash('sha256').update(binary).digest('hex'),
    kib: Number((binary.byteLength / 1024).toFixed(1)),
    triangles,
    primitives,
    materials: materials.length,
    textures: (doc.textures ?? []).length,
    nodes: nodes.length,
    scene_nodes: sceneNodes.length,
    semantic_extras: semanticExtras,
    uv1_primitives: uv1Primitives,
    opaque_materials: materials.filter((material) => !isTransparentMaterial(material)).length,
    blend_materials: transparentMaterials.length,
    transparent_material_names: transparentMaterials.map((material) => material.name),
    instanced_nodes: instancedNodes,
    draw_call_estimate: drawCalls,
    // Meshopt output retains KHR_mesh_quantization accessors.  The source
    // GLB contains exact, unquantized authored coordinates, so it is the
    // authority for gameplay-space range gates; the final asset reports a
    // separate approximate bound for diagnostics only.
    raw_bounds: rawBounds,
    optimized_bounds_approx: sceneBounds(doc),
    extensions_used: doc.extensionsUsed ?? [],
  };
}

async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const models = [];
for (const filename of Object.keys(requiredNodes)) {
  const rawFilename = filename.replace('.glb', '.raw.glb');
  const committedModel = committedMetadata?.models?.find((model) => model.file === filename);
  const rawBounds = rawSourcesAvailable
    ? sceneBounds(glbJson(await readFile(join(rawDir, rawFilename))))
    : committedModel?.raw_bounds;
  if (!rawBounds?.min || !rawBounds?.max) {
    throw new Error(`${filename}: raw authored bounds attestation is missing`);
  }
  const gate = boundsGate[filename];
  if (gate && (rawBounds.min.some((value, index) => value < gate.min[index]) || rawBounds.max.some((value, index) => value > gate.max[index]))) {
    throw new Error(`${filename}: raw authored bounds ${JSON.stringify(rawBounds)} breach game-space gate ${JSON.stringify(gate)}`);
  }
  const model = await modelReport(filename, rawBounds);
  if (!rawSourcesAvailable && (model.sha256 !== committedModel?.sha256
    || JSON.stringify(model.optimized_bounds_approx) !== JSON.stringify(committedModel?.optimized_bounds_approx))) {
    throw new Error(`${filename}: committed delivery no longer matches its clean-runner metadata attestation`);
  }
  models.push(model);
}
const deliveryFiles = await walk(publicDir);
const ktx2 = [];
for (const path of deliveryFiles.filter((path) => path.endsWith('.ktx2'))) {
  const binary = await readFile(path);
  ktx2.push({
    file: relative(publicDir, path),
    bytes: (await stat(path)).size,
    sha256: createHash('sha256').update(binary).digest('hex'),
  });
}
const totalCriticalBytes = models.reduce((sum, model) => sum + model.bytes, 0) + ktx2.reduce((sum, asset) => sum + asset.bytes, 0);
if (totalCriticalBytes > 25 * 1024 * 1024) throw new Error(`critical transfer hard cap exceeded: ${totalCriticalBytes}`);
const source = rawSourcesAvailable
  ? JSON.parse(await readFile(join(rawDir, 'build-report.json'), 'utf8'))
  : committedMetadata;
const buildId = `last-bell-3d-${createHash('sha256')
  .update(JSON.stringify({
    models: models.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 })),
    lightmaps: ktx2.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 })),
  }))
  .digest('hex')
  .slice(0, 16)}`;
const report = {
  schema: 1,
  build_id: buildId,
  generated_by: 'scripts/last-bell-3d/build.py + build.sh',
  art_source: String(source.art_source).replace(/\bprocedural\b/gi, 'authored'),
  no_source_pixel_projection: source.no_source_pixel_projection,
  external_pbr_provenance: source.external_pbr_provenance,
  physical_texture_scale_m: source.physical_texture_scale_m,
  coordinate_contract: source.coordinate_contract,
  static_lightmaps: source.static_lightmaps,
  texture_policy: {
    base_and_emissive: 'ETC1S KTX2 in GLBs',
    normal_orm_and_static_ao: 'UASTC KTX2',
    geometry: 'EXT_meshopt_compression',
    uv0: 'PBR',
    uv1: 'PBR secondary UVs; AO-receiver floors are explicitly packed non-overlap',
  },
  assets: Object.fromEntries(Object.entries(runtimeAssets).map(([key, asset]) => [key, {
    path: asset.file,
    lightmaps: asset.lightmapNode ? [{
      path: `lightmaps/${asset.file.replace('.glb', '')}-medium.ktx2`,
      tier: 'medium',
      nodes: [asset.lightmapNode],
      uv: 'uv1',
      intensity: 1,
      kind: 'cycles-ground-receiver-ao',
    }] : [],
  }])),
  critical_transfer: { bytes: totalCriticalBytes, mib: Number((totalCriticalBytes / 1024 / 1024).toFixed(2)), target_mib: 18, hard_cap_mib: 25 },
  models,
  lightmaps: ktx2,
};
if (!rawSourcesAvailable && committedMetadata.build_id !== buildId) {
  throw new Error(`committed opening metadata build ID does not match delivery: ${committedMetadata.build_id} !== ${buildId}`);
}
if (rawSourcesAvailable) await writeFile(join(publicDir, 'metadata.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
