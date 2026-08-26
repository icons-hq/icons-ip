#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [directoryArg, reportArg, openingDirectoryArg] = process.argv.slice(2);
if (!directoryArg || !reportArg) throw new Error('usage: validate.mjs <delivery-dir> <report.json> [opening-delivery-dir]');
const directory = resolve(directoryArg);
const openingDirectory = resolve(openingDirectoryArg ?? directoryArg);
const expectedCharacters = ['zombie-student', 'zombie-athletics', 'zombie-staff', 'namra-rooftop'];
const routeCharacterBudget = { targetBytes: 20 * 1024 * 1024, hardCapBytes: 24 * 1024 * 1024 };
const uniqueCampaignBudget = { targetBytes: 55 * 1024 * 1024, hardCapBytes: 75 * 1024 * 1024 };
const repoRoot = resolve(import.meta.dirname, '../..');
const epsilon = .025;
const forbiddenQualityMarkers = /(?:^|[^a-z0-9])(?:placeholder|clay|procedural|fallback|pending[_-]approved[_-]character[_-]replacement|non[_-]likeness[_-]placeholder|technical[_-]mountable[_-]placeholder)(?=$|[^a-z0-9])/i;
const routePropBuildId = 'last-bell-route-props-71a10d1704393e9a';
const blenderKitSourceProvenance = 'outputs/last-bell-environment-recovery-sources/blenderkit-cc0/provenance.json';
const blenderKitSourceVisualGate = 'outputs/last-bell-environment-recovery-sources/review/source-visual-gate.json';
const blenderKitSources = {
  'abandoned-house': { file: 'abandoned-house.glb', assetBaseId: '94e53774-84d7-430e-89bd-12cf7b2ef828', sha256: '618d5f5153470d9039c11d6dc82eb1625416d383d6e1efcc5b23005b71a94660' },
  'painted-concrete-blocks': { file: 'painted-concrete-blocks.glb', assetBaseId: '049c6887-3484-4725-b8ae-8749d7b68e1f', sha256: 'efd2e80aa3f957da81e64d68d0bcd11526f5bb2b215f12d88206a6357793e29e' },
  'scan-old-broken-floor': { file: 'scan-old-broken-floor.glb', assetBaseId: 'c4f28476-3d97-46dc-8969-cbf704059205', sha256: '77e8919e10008374ad67a078be3bf2a697704297129ac61708856403ae46ac34' },
  'scan-rubble-pile-a': { file: 'scan-rubble-pile-a.glb', assetBaseId: '930f3a3b-b6c3-4971-ab86-ce65c93b2a3c', sha256: 'cf9681a80565cfd9845b63b39a205758cf904807917da7f5e216368d5ab9a58e' },
  'scan-rubble-ruins': { file: 'scan-rubble-ruins.glb', assetBaseId: '853f291b-6f22-4900-9979-75826dac8c27', sha256: '6a51c2a3f63f3acc2417494f673bb068d55152e27d64dd758c5e51e167c8ee33' },
};
const polyHavenDuct = {
  asset: 'modular_airduct_circular_01',
  api: 'https://api.polyhaven.com/files/modular_airduct_circular_01',
  sha256: '7087958648acaa201fb3f1900e1ff61c2bfed7372f648346b4dc70d92b618274',
};
const polyHavenDetailModels = {
  mounted_fluorescent_lights: { api: 'https://api.polyhaven.com/files/mounted_fluorescent_lights', sha256: '7a56f167fe7074f4e4d4f314f72c5aa8b01c191394ee5ecb0b3461a240441b4a', pieces: 7 },
  korean_fire_extinguisher_01: { api: 'https://api.polyhaven.com/files/korean_fire_extinguisher_01', sha256: '565f9e41909165c2bead24b722746e29ba55e8eb5e541f61fe0d1ef7e66d2ecf', pieces: 1 },
  utility_box_01: { api: 'https://api.polyhaven.com/files/utility_box_01', sha256: '5b9f8c45f2640c9dd831dc3450529e45b24c987208ddcf73010fe717ce8c454e', pieces: 1 },
  portable_generator: { api: 'https://api.polyhaven.com/files/portable_generator', sha256: 'd5afe27834f824dfe753391713c45be03479e8100831f320796030531f61b848', pieces: 4 },
  modular_industrial_pipes_01: { api: 'https://api.polyhaven.com/files/modular_industrial_pipes_01', sha256: '455d3a0fe95b7900a08cbebb23cfb2c341672fcb67ae7355d776e53cfa3d0688', pieces: 8 },
  exterior_aircon_unit: { api: 'https://api.polyhaven.com/files/exterior_aircon_unit', sha256: 'f19d85c76948903047c2846068aeaa376d5e956a410675268cb6cb6aac5d97c2', pieces: 2 },
  stone_fire_pit: { api: 'https://api.polyhaven.com/files/stone_fire_pit', sha256: '40034b326d28c06f25cf1cdb39a5ab3f3b1d1a9415d490af39621efe6c31cee6', pieces: 1 },
  SchoolDesk_01: { api: 'https://api.polyhaven.com/files/SchoolDesk_01', sha256: '9d840b58a9e66ce9dc3d8d5396fb97cf954b12dc27adaf41b8cc78ae1a6404eb', pieces: 1 },
  SchoolChair_01: { api: 'https://api.polyhaven.com/files/SchoolChair_01', sha256: '1db6aca4bf379c2d568b2068492dcfcda15d764c0c3d98a970055af25b46281e', pieces: 1 },
};

async function productModelBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => (await stat(join(directory, entry.name, 'model.glb'))).size));
  return sizes.reduce((sum, bytes) => sum + bytes, 0);
}

const routeContracts = {
  corridor: {
    floor: 'Corridor_Floor', collider: 'COL_Corridor_Lane', bounds: [-3, 24, 3, 67],
    portals: { Portal_Infirmary: [4.45, .2, 32], Portal_Broadcast: [-4.45, .2, 43], Portal_Utility: [0, .2, 61] },
    clearances: {
      'portal.infirmary': { breach: 'Breach_Corridor_portal_infirmary', bounds: [2.48, .2, 30.1, 4.52, 2.65, 34] },
      'portal.broadcast': { breach: 'Breach_Corridor_portal_broadcast', bounds: [-4.52, .2, 37.9, -2.48, 2.65, 47.4] },
    },
    hiding: {
      'hiding.locker.corridor': { pivot: 'Hide_Locker_Corridor_Pivot', panel: 'Hide_Locker_Corridor_Panel', animation: 'Hide_Locker_Corridor_OpenClose' },
    },
    authoredProps: {
      'broken-fluorescent': 6,
      'classroom-desk-chair': 2,
      'locker-bank': 1,
      'debris-cluster': 4,
    },
    polyhavenDetails: { mounted_fluorescent_lights: 8, korean_fire_extinguisher_01: 1, utility_box_01: 1, SchoolDesk_01: 2, SchoolChair_01: 4 },
    artDirection: {
      boolean_wall_break: { min: 6, extras: { boolean_wall_break: true } },
      hanging_fluorescent_meshes: { min: 21, semantic: 'corridor.polyhaven-hanging-fluorescent.mesh' },
      authored_debris_meshes: { min: 40, sourceKey: 'debris-cluster', mesh: true },
    },
    blenderkitDerivatives: {
      'scan-rubble-pile-a': { min: 1, semanticPrefix: 'corridor.recovery.blenderkit-scan-rubble' },
      'scan-old-broken-floor': { min: 1, semanticPrefix: 'corridor.recovery.blenderkit-broken-floor' },
      'scan-rubble-ruins': { min: 1, semanticPrefix: 'corridor.recovery.blenderkit-rematerialed-ruin-bed' },
    },
  },
  infirmary: {
    floor: 'Infirmary_Floor', collider: 'COL_Infirmary', bounds: [4, 27, 10, 38],
    portals: { Portal_Corridor: [4.45, .2, 32] },
    clearances: {
      'portal.infirmary': { breach: 'Breach_Infirmary_portal_infirmary', bounds: [2.48, .2, 30.1, 4.52, 2.65, 34] },
    },
  },
  broadcast: {
    floor: 'Broadcast_Floor', collider: 'COL_Broadcast', bounds: [-10, 37, -4, 49],
    portals: { Portal_Corridor: [-4.45, .2, 43] },
    clearances: {
      'portal.broadcast': { breach: 'Breach_Broadcast_portal_broadcast', bounds: [-4.52, .2, 37.9, -2.48, 2.65, 47.4] },
    },
  },
  utility: {
    floor: 'Utility_Floor', collider: 'COL_Utility', bounds: [-3, 61, 3, 67],
    portals: { Portal_Stairwell: [0, .2, 67] },
  },
  stairwell: {
    floor: 'Stairwell_Floor', collider: 'COL_Stairwell', bounds: [-3.65, 67, 3.65, 82],
    portals: { Portal_Fire: [0, .2, 67], Portal_Rooftop: [0, .2, 82] },
    doors: {
      'door.fire': { pivot: 'DoorFire_Pivot', leaf: 'DoorFire_Leaf', pivotWorld: [-1.65, 1.5, 67], closedWorld: [0, 1.5, 67] },
      'door.rooftop': { pivot: 'DoorRooftop_Pivot', leaf: 'DoorRooftop_Leaf', pivotWorld: [-1.65, 1.5, 82], closedWorld: [0, 1.5, 82] },
    },
  },
  rooftop: {
    floor: 'RooftopSlab', collider: 'COL_Rooftop', bounds: [-10, 82, 10, 108],
    portals: { Portal_RooftopDoor: [0, .2, 82] },
    authoredProps: {
      'debris-cluster': 5,
    },
    polyhavenDuct: { instance: 'RooftopPolyHavenDuct_Instance', pieces: 4 },
    polyhavenDetails: { exterior_aircon_unit: 1, modular_industrial_pipes_01: 1, portable_generator: 1, SchoolDesk_01: 1, SchoolChair_01: 3 },
    runtimeHearth: {
      anchor: 'Anchor_RooftopFire_RuntimeParticleLight',
      blockPrefix: 'RooftopAuthoredHearthBlock_', blockMin: 6,
      logPrefix: 'RooftopRecoveryRuntimeHearthLog_', logMin: 3,
    },
    artDirection: {
      authored_debris_meshes: { min: 50, sourceKey: 'debris-cluster', mesh: true },
      headhouse_group: { min: 1, semantic: 'rooftop.adjacent-headhouse.group' },
    },
    blenderkitDerivatives: {
      'scan-rubble-pile-a': { min: 2, semanticPrefix: 'rooftop.recovery.blenderkit-foreground-scan-rubble' },
      'scan-rubble-ruins': { min: 1, semanticPrefix: 'rooftop.recovery.blenderkit-rematerialed-ruin-bed' },
      'scan-old-broken-floor': { min: 1, semanticPrefix: 'rooftop.recovery.blenderkit-rematerialed-broken-floor' },
      'painted-concrete-blocks': { min: 1, semanticPrefix: 'rooftop.recovery.blenderkit-hearth-blocks' },
      'abandoned-house': { min: 1, semanticPrefix: 'rooftop.recovery.distant-blenderkit-destroyed-adjacent-building' },
    },
  },
};

function json(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB.');
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
}

function validateTexturedAssetQuality(key, doc, kind) {
  if (forbiddenQualityMarkers.test(JSON.stringify({ nodes: doc.nodes, materials: doc.materials }))) {
    throw new Error(`${key}: delivery retains a forbidden placeholder/clay/procedural/fallback marker`);
  }
  if (!(doc.extensionsUsed ?? []).includes('KHR_texture_basisu')) throw new Error(`${key}: KTX2 PBR delivery is required`);
  if ((doc.images?.length ?? 0) < 3) throw new Error(`${key}: base, normal, and ORM texture payloads are required`);
  const materials = doc.materials ?? [];
  if (materials.length < 3 || materials.some((material) => !material.pbrMetallicRoughness)) {
    throw new Error(`${key}: authored PBR material diversity is missing`);
  }
  if (!materials.some((material) => material.pbrMetallicRoughness?.baseColorTexture && material.pbrMetallicRoughness?.metallicRoughnessTexture && material.normalTexture)) {
    throw new Error(`${key}: material set must include baseColor, normal, and ORM PBR slots`);
  }
  if (kind === 'route') {
    // A corridor cannot pass by tinting one plaster source into every
    // semantic surface. The delivered GLB must retain distinct authored
    // provenance for its architecture, furniture and metal/glass response.
    const sources = new Set(materials
      .map((material) => material.extras?.pbr_source)
      .filter((source) => typeof source === 'string'));
    if (sources.size < 3) {
      throw new Error(`${key}: route PBR provenance lacks material-class diversity (${sources.size} distinct sources)`);
    }
  }
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    if (primitive.attributes?.TEXCOORD_0 === undefined || primitive.attributes?.TEXCOORD_1 === undefined) {
      throw new Error(`${key}: every ${kind} primitive requires UV0 and UV1`);
    }
    if (primitive.attributes?.NORMAL === undefined) throw new Error(`${key}: every ${kind} primitive requires normals`);
  }
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const round = (value) => Number(value.toFixed(3));

function assertNear(actual, expected, label) {
  if (!Number.isFinite(actual)) throw new Error(`${label}: expected a finite number, got ${actual}`);
  if (Math.abs(actual - expected) > epsilon) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function assertVec(actual, expected, label) {
  actual.forEach((value, index) => assertNear(value, expected[index], `${label}[${index}]`));
}

function indexNodes(doc) {
  const nodes = doc.nodes ?? [];
  const byName = new Map();
  const parent = new Map();
  nodes.forEach((node, index) => {
    if (node.name) byName.set(node.name, index);
    for (const child of node.children ?? []) parent.set(child, index);
  });
  return { nodes, byName, parent };
}

const identityMatrix = () => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function multiplyMatrices(parent, local) {
  const result = Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let cursor = 0; cursor < 4; cursor += 1) {
        result[column * 4 + row] += parent[cursor * 4 + row] * local[column * 4 + cursor];
      }
    }
  }
  return result;
}

function localNodeMatrix(node) {
  if (node.matrix) return [...node.matrix];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [scaleX, scaleY, scaleZ] = node.scale ?? [1, 1, 1];
  const [translateX, translateY, translateZ] = node.translation ?? [0, 0, 0];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * scaleX,
    (xy + wz) * scaleX,
    (xz - wy) * scaleX,
    0,
    (xy - wz) * scaleY,
    (1 - (xx + zz)) * scaleY,
    (yz + wx) * scaleY,
    0,
    (xz + wy) * scaleZ,
    (yz - wx) * scaleZ,
    (1 - (xx + yy)) * scaleZ,
    0,
    translateX,
    translateY,
    translateZ,
    1,
  ];
}

function nodeTransform(index, indexed) {
  const chain = [];
  let current = index;
  while (current !== undefined) {
    chain.unshift(current);
    current = indexed.parent.get(current);
  }
  let matrix = identityMatrix();
  for (const nodeIndex of chain) {
    const node = indexed.nodes[nodeIndex];
    matrix = multiplyMatrices(matrix, localNodeMatrix(node));
  }
  return { matrix, translation: [matrix[12], matrix[13], matrix[14]] };
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function accessorWorldBounds(accessor, matrix) {
  const localMin = accessor.min.map((value) => normalizedCoordinate(value, accessor));
  const localMax = accessor.max.map((value) => normalizedCoordinate(value, accessor));
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const x of [localMin[0], localMax[0]]) {
    for (const y of [localMin[1], localMax[1]]) {
      for (const z of [localMin[2], localMax[2]]) {
        const point = transformPoint(matrix, [x, y, z]);
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
        }
      }
    }
  }
  return bounds;
}

function normalizedCoordinate(value, accessor) {
  if (!accessor.normalized) return value;
  const maximum = ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 })[accessor.componentType];
  if (!maximum) throw new Error(`unsupported normalized POSITION component type ${accessor.componentType}`);
  return value / maximum;
}

function floorWorldBounds(doc, indexed, name) {
  const index = indexed.byName.get(name);
  if (index === undefined) throw new Error(`${name}: mesh node missing`);
  const node = indexed.nodes[index];
  const primitive = doc.meshes?.[node.mesh]?.primitives?.[0];
  const accessor = doc.accessors?.[primitive?.attributes?.POSITION];
  if (!accessor?.min || !accessor?.max) throw new Error(`${name}: POSITION bounds missing`);
  const transform = nodeTransform(index, indexed);
  return accessorWorldBounds(accessor, transform.matrix);
}

function namedWorldPosition(indexed, name) {
  const index = indexed.byName.get(name);
  if (index === undefined) throw new Error(`${name}: node missing`);
  return nodeTransform(index, indexed).translation;
}

function meshWorldBounds(doc, indexed, index) {
  const node = indexed.nodes[index];
  if (node.mesh === undefined) return null;
  const transform = nodeTransform(index, indexed);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const primitive of doc.meshes?.[node.mesh]?.primitives ?? []) {
    const accessor = doc.accessors?.[primitive.attributes?.POSITION];
    if (!accessor?.min || !accessor?.max) throw new Error(`${node.name ?? index}: mesh POSITION bounds missing`);
    const primitiveBounds = accessorWorldBounds(accessor, transform.matrix);
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], primitiveBounds.min[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], primitiveBounds.max[axis]);
    }
  }
  return bounds;
}

function overlapsVolume(a, b) {
  return a.min[0] < b.max[0] - epsilon && a.max[0] > b.min[0] + epsilon
    && a.min[1] < b.max[1] - epsilon && a.max[1] > b.min[1] + epsilon
    && a.min[2] < b.max[2] - epsilon && a.max[2] > b.min[2] + epsilon;
}

function validateMeshClearances(key, doc, indexed, clearances) {
  const result = {};
  for (const [portalId, contract] of Object.entries(clearances ?? {})) {
    const breachIndex = indexed.byName.get(contract.breach);
    if (breachIndex === undefined) throw new Error(`${key} ${portalId}: DCC breach semantic missing`);
    const breach = indexed.nodes[breachIndex];
    if (breach.extras?.portal_breach !== true) throw new Error(`${key} ${portalId}: breach must be explicit`);
    assertVec(
      [breach.extras?.clearance_min_x, breach.extras?.clearance_min_z, breach.extras?.clearance_max_x, breach.extras?.clearance_max_z],
      [contract.bounds[0], contract.bounds[2], contract.bounds[3], contract.bounds[5]],
      `${key} ${portalId} clearance extras`,
    );
    const volume = { min: [contract.bounds[0], contract.bounds[1], contract.bounds[2]], max: [contract.bounds[3], contract.bounds[4], contract.bounds[5]] };
    for (let index = 0; index < indexed.nodes.length; index += 1) {
      const meshBounds = meshWorldBounds(doc, indexed, index);
      if (!meshBounds || !overlapsVolume(meshBounds, volume)) continue;
      throw new Error(`${key} ${portalId}: visual mesh ${indexed.nodes[index].name ?? index} blocks the portal clearance`);
    }
    result[portalId] = {
      min: volume.min.map(round),
      max: volume.max.map(round),
      mesh_blockers: 0,
    };
  }
  return result;
}

function validateAuthoredProps(key, indexed, expected) {
  const result = {};
  for (const [sourceKey, expectedCount] of Object.entries(expected ?? {})) {
    const nodes = indexed.nodes.filter((node) => node.extras?.source_key === sourceKey && node.extras?.semantic_id === `route.prop.${sourceKey}`);
    if (nodes.length !== expectedCount) {
      throw new Error(`${key}: expected ${expectedCount} authored ${sourceKey} props, found ${nodes.length}`);
    }
    for (const node of nodes) {
      const extras = node.extras ?? {};
      if (extras.authored_prop_build_id !== routePropBuildId) {
        throw new Error(`${key} ${node.name ?? sourceKey}: prop build provenance is not current`);
      }
      if (extras.authored_prop_source !== `outputs/last-bell-route-props/raw/${sourceKey}.raw.glb`) {
        throw new Error(`${key} ${node.name ?? sourceKey}: prop source provenance is invalid`);
      }
      if (extras.semantic_id !== `route.prop.${sourceKey}`) {
        throw new Error(`${key} ${node.name ?? sourceKey}: prop semantic mapping is invalid`);
      }
    }
    result[sourceKey] = { instances: nodes.length, build_id: routePropBuildId };
  }
  return result;
}

function validateArtDirection(key, indexed, expected) {
  const result = {};
  for (const [label, requirement] of Object.entries(expected ?? {})) {
    const nodes = indexed.nodes.filter((node) => {
      const extras = node.extras ?? {};
      if (requirement.mesh && node.mesh === undefined) return false;
      if (requirement.semantic && extras.semantic_id !== requirement.semantic) return false;
      if (requirement.sourceKey && extras.source_key !== requirement.sourceKey) return false;
      return Object.entries(requirement.extras ?? {}).every(([field, value]) => extras[field] === value);
    });
    if (nodes.length < requirement.min) {
      throw new Error(`${key}: ${label} requires at least ${requirement.min} real delivery nodes, found ${nodes.length}`);
    }
    result[label] = nodes.length;
  }
  return result;
}

function validatePinnedBlenderKitInputs() {
  const provenancePath = join(repoRoot, blenderKitSourceProvenance);
  const visualGatePath = join(repoRoot, blenderKitSourceVisualGate);
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  const policy = provenance.policy ?? {};
  if (provenance.schema_version !== 1 || policy.accepted_license !== 'cc_zero'
    || policy.source_role !== 'private-photogrammetry-input-only'
    || policy.public_runtime_delivery !== false) {
    throw new Error('BlenderKit source provenance no longer enforces private CC0 input-only usage');
  }
  const sources = {};
  for (const [key, expected] of Object.entries(blenderKitSources)) {
    const record = (provenance.assets ?? []).find((candidate) => candidate.key === key);
    if (!record || record.license !== 'cc_zero' || record.asset_base_id !== expected.assetBaseId
      || record.local_file !== expected.file || record.sha256 !== expected.sha256) {
      throw new Error(`${key}: pinned BlenderKit provenance record is invalid`);
    }
    const sourceBytes = readFileSync(join(repoRoot, 'outputs/last-bell-environment-recovery-sources/blenderkit-cc0', expected.file));
    if (hash(sourceBytes) !== expected.sha256) throw new Error(`${key}: private BlenderKit source file no longer matches its pin`);
    sources[key] = { sha256: expected.sha256, asset_base_id: expected.assetBaseId, raw_runtime_delivery: false };
  }
  const gate = JSON.parse(readFileSync(visualGatePath, 'utf8'));
  if (gate.schema !== 1
    || gate.promotion_rule !== 'A conditional source pass never promotes a route. Only an actual player-camera runtime render with P0 visual defects equal to zero can promote a derivative delivery GLB.') {
    throw new Error('BlenderKit source visual gate is missing the P0 runtime-promotion rule');
  }
  for (const key of Object.keys(blenderKitSources)) {
    if (!gate.assets?.[key]?.verdict || !Array.isArray(gate.assets[key].required_work)) {
      throw new Error(`${key}: BlenderKit source visual gate is incomplete`);
    }
  }
  return { provenance: blenderKitSourceProvenance, visual_gate: blenderKitSourceVisualGate, sources };
}

function validateBlenderKitDerivatives(key, indexed, expected) {
  const result = {};
  const routePbrSources = new Set();
  for (const [asset, requirement] of Object.entries(expected ?? {})) {
    const source = blenderKitSources[asset];
    if (!source) throw new Error(`${key}: unknown BlenderKit source ${asset}`);
    const nodes = indexed.nodes.filter((node) => node.mesh !== undefined
      && node.extras?.blenderkit_asset === asset
      && typeof node.extras?.semantic_id === 'string'
      && node.extras.semantic_id.startsWith(requirement.semanticPrefix));
    if (nodes.length < requirement.min) {
      throw new Error(`${key}: ${asset} requires at least ${requirement.min} real authored BlenderKit derivative nodes, found ${nodes.length}`);
    }
    for (const node of nodes) {
      const extras = node.extras ?? {};
      if (extras.license !== 'CC0-1.0' || extras.source_sha256 !== source.sha256
        || extras.source_provenance !== blenderKitSourceProvenance
        || extras.source_visual_gate !== blenderKitSourceVisualGate
        || extras.source_runtime_role !== 'dcc-source-only-authored-derivative'
        || extras.raw_runtime_delivery !== false || extras.private_geometry_only_import !== true || extras.pbr_authored !== true
        || typeof extras.authored_pbr_material_source !== 'string' || !extras.authored_pbr_material_source.startsWith('Poly Haven CC0 ')
        || extras.derivative_steps !== 'geometry-only-import,blender-import,crop,underside-removal,aggressive-decimation,authored-pbr-remap,uv-review') {
        throw new Error(`${key} ${node.name ?? asset}: BlenderKit derivative provenance or cleanup contract is invalid`);
      }
    }
    const sources = [...new Set(nodes.map((node) => node.extras?.authored_pbr_material_source))];
    for (const source of sources) routePbrSources.add(source);
    result[asset] = { nodes: nodes.length, raw_runtime_delivery: false, sha256: source.sha256, authored_pbr_material_sources: sources };
  }
  // This is deliberately narrower than the general route material check:
  // BlenderKit derivatives are allowed only when their individual cleanup
  // remaps preserve a real material-class story.  A corridor may not satisfy
  // the photogrammetry gate by tinting every cleaned scan with one source.
  if (key === 'corridor' && routePbrSources.size < 3) {
    throw new Error(`${key}: BlenderKit recovery provenance lacks three independent PBR material classes (${routePbrSources.size} distinct sources)`);
  }
  return result;
}

function validatePolyhavenDuct(key, indexed, expected) {
  if (!expected) return null;
  const instanceIndex = indexed.byName.get(expected.instance);
  if (instanceIndex === undefined) throw new Error(`${key}: official Poly Haven duct instance missing`);
  const instance = indexed.nodes[instanceIndex];
  const extras = instance.extras ?? {};
  if (extras.polyhaven_asset !== polyHavenDuct.asset || extras.license !== 'CC0-1.0'
    || extras.source_api !== polyHavenDuct.api || extras.source_sha256 !== polyHavenDuct.sha256
    || extras.source_runtime_role !== 'zone-local-art-directed-subset') {
    throw new Error(`${key}: Poly Haven duct provenance/usage contract is invalid`);
  }
  const pieces = indexed.nodes.filter((node) => node.extras?.polyhaven_asset === polyHavenDuct.asset
    && node.extras?.semantic_id === 'rooftop.polyhaven-airduct.mesh');
  if (pieces.length !== expected.pieces) throw new Error(`${key}: expected ${expected.pieces} art-directed duct pieces, found ${pieces.length}`);
  for (const piece of pieces) {
    const pieceExtras = piece.extras ?? {};
    if (pieceExtras.license !== 'CC0-1.0' || pieceExtras.source_api !== polyHavenDuct.api
      || pieceExtras.source_sha256 !== polyHavenDuct.sha256 || pieceExtras.art_directed_for !== 'hyosan-rooftop-service-run') {
      throw new Error(`${key} ${piece.name ?? 'duct'}: duct piece provenance is invalid`);
    }
  }
  return { asset: polyHavenDuct.asset, license: 'CC0-1.0', pieces: pieces.length, api: polyHavenDuct.api };
}

function validatePolyhavenDetails(key, indexed, expected) {
  const result = {};
  for (const [asset, expectedInstances] of Object.entries(expected ?? {})) {
    const source = polyHavenDetailModels[asset];
    if (!source) throw new Error(`${key}: unknown Poly Haven detail model ${asset}`);
    const instances = indexed.nodes.filter((node) => node.extras?.polyhaven_asset === asset
      && node.extras?.source_runtime_role === 'zone-local-art-directed-subset');
    if (instances.length !== expectedInstances) {
      throw new Error(`${key}: expected ${expectedInstances} zone-local ${asset} instances, found ${instances.length}`);
    }
    for (const instance of instances) {
      const extras = instance.extras ?? {};
      if (extras.license !== 'CC0-1.0' || extras.source_api !== source.api || extras.source_sha256 !== source.sha256
        || extras.texture_policy !== 'shared-route-pbr-atlas-not-stock-texture-bundle') {
        throw new Error(`${key} ${instance.name ?? asset}: Poly Haven detail provenance or texture policy is invalid`);
      }
    }
    const pieces = indexed.nodes.filter((node) => node.extras?.polyhaven_asset === asset
      && node.extras?.source_runtime_role !== 'zone-local-art-directed-subset');
    const expectedPieces = expectedInstances * source.pieces;
    if (pieces.length !== expectedPieces) {
      throw new Error(`${key}: expected ${expectedPieces} ${asset} source meshes, found ${pieces.length}`);
    }
    for (const piece of pieces) {
      const extras = piece.extras ?? {};
      if (extras.license !== 'CC0-1.0' || extras.source_api !== source.api || extras.source_sha256 !== source.sha256
        || extras.texture_policy !== 'shared-route-pbr-atlas-not-stock-texture-bundle' || extras.pbr_authored !== true) {
        throw new Error(`${key} ${piece.name ?? asset}: Poly Haven detail mesh provenance is invalid`);
      }
    }
    result[asset] = { instances: instances.length, pieces: pieces.length, license: 'CC0-1.0', api: source.api };
  }
  return result;
}

function validateRuntimeHearth(key, indexed, expected) {
  if (!expected) return null;
  const anchorIndex = indexed.byName.get(expected.anchor);
  if (anchorIndex === undefined) throw new Error(`${key}: runtime fire anchor missing`);
  const anchor = indexed.nodes[anchorIndex];
  const extras = anchor.extras ?? {};
  if (extras.semantic_id !== 'rooftop.fire.runtime-particle-light-seam'
    || extras.runtime_vfx_id !== 'vfx.rooftop.fire.local-warm'
    || extras.runtime_smoke_vfx_id !== 'vfx.rooftop.smoke.local'
    || extras.runtime_light_world_position !== '2.8,1.1,98.7'
    || extras.static_geometry !== 'logs-and-hearth-only'
    || extras.flame_billboard !== false) {
    throw new Error(`${key}: runtime fire seam contract is invalid`);
  }
  const blocks = indexed.nodes.filter((node) => node.mesh !== undefined && String(node.name).startsWith(expected.blockPrefix));
  const logs = indexed.nodes.filter((node) => node.mesh !== undefined && String(node.name).startsWith(expected.logPrefix));
  if (blocks.length < expected.blockMin || logs.length < expected.logMin) {
    throw new Error(`${key}: real runtime hearth geometry is incomplete (${blocks.length} blocks, ${logs.length} logs)`);
  }
  const staticFlames = indexed.nodes.filter((node) => node.mesh !== undefined && /(?:flame|billboard)/i.test(`${node.name ?? ''} ${node.extras?.semantic_id ?? ''}`));
  if (staticFlames.length) throw new Error(`${key}: static fire/flame billboard geometry is forbidden`);
  return { anchor: expected.anchor, blocks: blocks.length, logs: logs.length, static_flame_meshes: 0 };
}

function validateRooftopStructuralMaterialAudit(doc, indexed) {
  const materials = doc.materials ?? [];
  const namesFor = (node) => ((doc.meshes ?? [])[node.mesh]?.primitives ?? [])
    .map((primitive) => materials[primitive.material]?.name ?? '')
    .filter(Boolean);
  const slab = indexed.nodes[indexed.byName.get('RooftopSlab')];
  const slabMaterials = namesFor(slab);
  if (!slabMaterials.includes('PBR_Tarred_Gravel_Roof_Macro')) {
    throw new Error(`rooftop: slab must retain only the tarred-gravel PBR ground finish (${slabMaterials.join(', ')})`);
  }
  const audited = indexed.nodes.filter((node) => node.mesh !== undefined && String(node.name).startsWith('RooftopVisibleHeadHouse'));
  const forbidden = /wood|worn.?laminate|dirty.?tile|tarred.?gravel/i;
  const expectedStructural = new Set([
    'PBR_Rooftop_HeadHouse_CharredPlaster',
    'PBR_Rooftop_HeadHouse_Concrete',
    'PBR_Rooftop_HeadHouse_SmokedAluminiumGrey',
    'PBR_Rooftop_HeadHouse_ExposedBrick',
    'PBR_Rooftop_HeadHouse_DoorRecess',
  ]);
  const report = {};
  for (const node of audited) {
    const assigned = namesFor(node);
    if (!assigned.length || assigned.some((name) => forbidden.test(name)) || assigned.some((name) => !expectedStructural.has(name))) {
      throw new Error(`rooftop ${node.name}: headhouse structure has invalid/wood/ground material (${assigned.join(', ')})`);
    }
    report[node.name] = assigned;
  }
  return { slab: slabMaterials, headhouse_nodes: report };
}

function expectedExtras(node, contract, label) {
  const extras = node.extras ?? {};
  const actual = [extras.bounds_min_x, extras.bounds_min_z, extras.bounds_max_x, extras.bounds_max_z];
  assertVec(actual, contract.bounds, `${label} extras`);
}

function validateRouteWorldContract(key, doc) {
  const contract = routeContracts[key];
  const indexed = indexNodes(doc);
  const rootIndex = indexed.byName.get('LOD0_Route');
  if (rootIndex === undefined) throw new Error(`${key}: LOD0_Route missing`);
  const root = indexed.nodes[rootIndex];
  if (root.extras?.coordinate_space !== 'world-root') throw new Error(`${key}: route root must export in world coordinates`);
  const floor = floorWorldBounds(doc, indexed, contract.floor);
  assertVec([floor.min[0], floor.min[2], floor.max[0], floor.max[2]], contract.bounds, `${key} floor world bounds`);
  const colliderIndex = indexed.byName.get(contract.collider);
  if (colliderIndex === undefined) throw new Error(`${key}: ${contract.collider} missing`);
  expectedExtras(indexed.nodes[colliderIndex], contract, `${key} collider`);
  const colliderWorld = namedWorldPosition(indexed, contract.collider);
  assertVec([colliderWorld[0], colliderWorld[2]], [(contract.bounds[0] + contract.bounds[2]) / 2, (contract.bounds[1] + contract.bounds[3]) / 2], `${key} collider centre`);

  const portals = {};
  for (const [name, expected] of Object.entries(contract.portals)) {
    const actual = namedWorldPosition(indexed, name);
    assertVec(actual, expected, `${key} ${name}`);
    portals[name] = actual.map(round);
  }
  const doors = {};
  for (const [doorId, expected] of Object.entries(contract.doors ?? {})) {
    const pivotIndex = indexed.byName.get(expected.pivot);
    if (pivotIndex === undefined) throw new Error(`${key}: ${expected.pivot} missing`);
    const pivot = indexed.nodes[pivotIndex];
    const leaf = namedWorldPosition(indexed, expected.leaf);
    const pivotWorld = namedWorldPosition(indexed, expected.pivot);
    assertVec(pivotWorld, expected.pivotWorld, `${doorId} pivot`);
    assertVec(leaf, expected.closedWorld, `${doorId} leaf closed pose`);
    if (pivot.extras?.door_id !== doorId || pivot.extras?.door_kind !== 'hinge') throw new Error(`${doorId}: missing hinge semantics`);
    assertVec(
      [pivot.extras?.pivot_x, pivot.extras?.pivot_y, pivot.extras?.pivot_z],
      expected.pivotWorld,
      `${doorId} authored pivot extras`,
    );
    assertVec(
      [pivot.extras?.closed_position_x, pivot.extras?.closed_position_y, pivot.extras?.closed_position_z],
      expected.closedWorld,
      `${doorId} authored closed extras`,
    );
    doors[doorId] = { pivot: pivotWorld.map(round), closed: leaf.map(round) };
  }
  const clearances = validateMeshClearances(key, doc, indexed, contract.clearances);
  const authoredProps = validateAuthoredProps(key, indexed, contract.authoredProps);
  const artDirection = validateArtDirection(key, indexed, contract.artDirection);
  const blenderkitDerivatives = validateBlenderKitDerivatives(key, indexed, contract.blenderkitDerivatives);
  const polyhavenDuct = validatePolyhavenDuct(key, indexed, contract.polyhavenDuct);
  const polyhavenDetails = validatePolyhavenDetails(key, indexed, contract.polyhavenDetails);
  const runtimeHearth = validateRuntimeHearth(key, indexed, contract.runtimeHearth);
  const structuralMaterialAudit = key === 'rooftop' ? validateRooftopStructuralMaterialAudit(doc, indexed) : null;
  const hiding = {};
  for (const [hideId, expected] of Object.entries(contract.hiding ?? {})) {
    const pivotIndex = indexed.byName.get(expected.pivot);
    const panelIndex = indexed.byName.get(expected.panel);
    if (pivotIndex === undefined || panelIndex === undefined) throw new Error(`${key} ${hideId}: stable cover panel nodes are missing`);
    const pivot = indexed.nodes[pivotIndex];
    const panel = indexed.nodes[panelIndex];
    if (pivot.extras?.hide_id !== hideId || panel.extras?.hide_id !== hideId) throw new Error(`${key} ${hideId}: visual/simulation mapping is missing`);
    if (pivot.extras?.visual_state_source !== 'HideSystem.snapshot.phase') throw new Error(`${key} ${hideId}: runtime state source must be explicit`);
    if (panel.extras?.closed_parent !== 'Pivot' || panel.extras?.visible_cover !== true) throw new Error(`${key} ${hideId}: cover closed pose contract is missing`);
    if (!(doc.animations ?? []).some((animation) => animation.name === expected.animation)) throw new Error(`${key} ${hideId}: reversible open/close animation is missing`);
    hiding[hideId] = { pivot: expected.pivot, panel: expected.panel, animation: expected.animation };
  }
  return {
    bounds: { min: [round(floor.min[0]), round(floor.min[2])], max: [round(floor.max[0]), round(floor.max[2])] },
    portals,
    doors,
    clearances,
    authored_props: authoredProps,
    art_direction: artDirection,
    blenderkit_derivatives: blenderkitDerivatives,
    polyhaven_duct: polyhavenDuct,
    polyhaven_details: polyhavenDetails,
    runtime_hearth: runtimeHearth,
    structural_material_audit: structuralMaterialAudit,
    hiding,
  };
}

function validateClassroomOpening(delivery) {
  const startRoom = json(readFileSync(join(delivery, 'start-room.glb')));
  const door = json(readFileSync(join(delivery, 'classroom-door.glb')));
  const start = indexNodes(startRoom);
  const floor = floorWorldBounds(startRoom, start, 'StartRoom_DirtyTileFloor');
  if (floor.min[0] > -6.9 + epsilon || floor.max[0] < 6.9 - epsilon || floor.max[2] < 13 - epsilon) {
    throw new Error(`classroom opening no longer covers its authoritative collider: ${JSON.stringify(floor)}`);
  }
  const names = new Set((door.nodes ?? []).map((node) => node.name));
  for (const name of ['ClassroomDoor_Root', 'Door_Panel_L', 'Door_Panel_R']) if (!names.has(name)) throw new Error(`classroom door semantic missing: ${name}`);
  const hidingAnchor = (startRoom.nodes ?? []).find((node) => node.name === 'Hide_Desk_Classroom_Anchor');
  const hidingCover = (startRoom.nodes ?? []).find((node) => node.name === 'Hide_Desk_Classroom_Cover');
  if (!hidingAnchor || !hidingCover) throw new Error('classroom hiding desk semantic nodes are missing');
  if (hidingAnchor.extras?.hide_id !== 'hiding.desk.classroom' || hidingCover.extras?.hide_id !== 'hiding.desk.classroom') {
    throw new Error('classroom hiding desk visual/simulation mapping is missing');
  }
  const hidingPosition = namedWorldPosition(start, 'Hide_Desk_Classroom_Anchor');
  assertVec(hidingPosition, [-3.35, 0.05, 2.85], 'classroom hiding desk authoritative anchor');
  if (hidingCover.extras?.visual_motion_source !== 'HideSystem.snapshot.phase' || hidingCover.extras?.visible_cover !== true) {
    throw new Error('classroom hiding desk must expose the state-driven visible cover');
  }
  const hideMeshIndex = start.byName.get('Hide_Desk_Classroom_Cover_Mesh');
  if (hideMeshIndex === undefined) throw new Error('classroom hiding desk cover mesh node is missing');
  const hideMesh = meshWorldBounds(startRoom, start, hideMeshIndex);
  if (!hideMesh) throw new Error('classroom hiding desk cover mesh is missing');
  const hideSize = hideMesh.max.map((value, axis) => value - hideMesh.min[axis]);
  if (hideSize[0] > 1.6 || hideSize[1] > 1.35 || hideSize[2] > 1.2 || hideSize.some((value) => value <= .05)) {
    throw new Error(`classroom hiding desk has an implausible camera-blocking extent: ${JSON.stringify(hideSize)}`);
  }
  if (!(startRoom.animations ?? []).some((animation) => animation.name === 'Hide_Desk_Classroom_EnterExit')) {
    throw new Error('classroom hiding desk enter/exit animation is missing');
  }
  return {
    bounds: { min: [round(floor.min[0]), round(floor.min[2])], max: [round(floor.max[0]), round(floor.max[2])] },
    door_root: 'ClassroomDoor_Root',
    hiding: { id: 'hiding.desk.classroom', anchor: hidingPosition.map(round), cover: 'Hide_Desk_Classroom_Cover', animation: 'Hide_Desk_Classroom_EnterExit', extent: hideSize.map(round) },
  };
}

const pinnedBlenderKitInputs = validatePinnedBlenderKitInputs();
const assets = [];
const routeWorldContracts = {};
for (const key of Object.keys(routeContracts)) {
  const bytes = await readFile(join(directory, 'routes', `${key}.glb`));
  const doc = json(bytes);
  const names = new Set((doc.nodes ?? []).map((node) => node.name));
  if (!names.has('LOD0_Route')) throw new Error(`${key}: LOD0_Route missing`);
  if (!(doc.nodes ?? []).some((node) => String(node.name).startsWith('Anchor_'))) throw new Error(`${key}: semantic anchor missing`);
  if (!(doc.extensionsUsed ?? []).includes('EXT_meshopt_compression')) throw new Error(`${key}: Meshopt missing`);
  validateTexturedAssetQuality(key, doc, 'route');
  routeWorldContracts[key] = validateRouteWorldContract(key, doc);
  assets.push({ key, kind: 'route', bytes: bytes.length, sha256: hash(bytes), nodes: doc.nodes?.length ?? 0, animations: doc.animations?.map((animation) => animation.name) ?? [], texture_encoding: 'KTX2-textured-PBR; UV0+UV1', world_contract: routeWorldContracts[key] });
}
for (const key of expectedCharacters) {
  const bytes = await readFile(join(directory, 'characters', `${key}.glb`));
  const doc = json(bytes);
  const nodes = doc.nodes ?? [];
  if (!nodes.some((node) => node.name === 'Character_Root')) throw new Error(`${key}: Character_Root missing`);
  if (!nodes.some((node) => node.name === 'Armature_Common')) throw new Error(`${key}: shared rig node missing`);
  const animations = doc.animations?.map((animation) => animation.name).filter(Boolean) ?? [];
  const minimum = key === 'namra-rooftop' ? ['Idle_Rooftop', 'Detect_Threat', 'Restrain'] : ['Patrol', 'Investigate', 'Search', 'Chase', 'Capture'];
  const missing = minimum.filter((name) => !animations.includes(name));
  if (missing.length) throw new Error(`${key}: missing animation clips ${missing.join(', ')}`);
  if (!(doc.extensionsUsed ?? []).includes('EXT_meshopt_compression')) throw new Error(`${key}: Meshopt missing`);
  if ((doc.skins?.length ?? 0) < 1) throw new Error(`${key}: skinned rig delivery is required`);
  validateTexturedAssetQuality(key, doc, 'character');
  assets.push({ key, kind: 'character', bytes: bytes.length, sha256: hash(bytes), nodes: nodes.length, animations, texture_encoding: 'KTX2-textured-PBR; UV0+UV1; skinned', skin_count: doc.skins?.length ?? 0 });
}
const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
if (total > routeCharacterBudget.hardCapBytes) {
  throw new Error(`Route and character pack exceeds ${routeCharacterBudget.hardCapBytes / 1024 / 1024}MiB: ${total}`);
}
const opening = validateClassroomOpening(openingDirectory);
const openingMetadata = JSON.parse(await readFile(join(openingDirectory, 'metadata.json'), 'utf8'));
const openingCriticalBytes = Number(openingMetadata.critical_transfer?.bytes);
if (!Number.isFinite(openingCriticalBytes) || openingCriticalBytes <= 0) {
  throw new Error('opening metadata lacks a positive critical_transfer.bytes value');
}
const productsBytes = await productModelBytes(join(repoRoot, 'public/generated/last-bell/products'));
const uniqueTotal = openingCriticalBytes + total + productsBytes;
if (uniqueTotal > uniqueCampaignBudget.hardCapBytes) {
  throw new Error(`Last Bell unique runtime asset set exceeds ${uniqueCampaignBudget.hardCapBytes / 1024 / 1024}MiB: ${uniqueTotal}`);
}
const report = {
  schema: 2,
  build_id: `last-bell-route-character-${hash(Buffer.from(JSON.stringify(assets.map(({ key, sha256 }) => ({ key, sha256 }))))).slice(0, 16)}`,
  validation: 'pass',
  transfer: {
    bytes: total,
    mib: Number((total / 1024 / 1024).toFixed(3)),
    target_mib: routeCharacterBudget.targetBytes / 1024 / 1024,
    hard_cap_mib: routeCharacterBudget.hardCapBytes / 1024 / 1024,
    target_met: total <= routeCharacterBudget.targetBytes,
  },
  unique_transfer: {
    bytes: uniqueTotal,
    mib: Number((uniqueTotal / 1024 / 1024).toFixed(3)),
    target_mib: uniqueCampaignBudget.targetBytes / 1024 / 1024,
    hard_cap_mib: uniqueCampaignBudget.hardCapBytes / 1024 / 1024,
    target_met: uniqueTotal <= uniqueCampaignBudget.targetBytes,
    components: { opening_critical_bytes: openingCriticalBytes, route_character_bytes: total, products_model_bytes: productsBytes },
  },
  blenderkit_private_inputs: pinnedBlenderKitInputs,
  world_contract: { classroom: opening, routes: routeWorldContracts },
  delivery_failure_policy: {
    route_visible_primitive_substitute: false,
    namra_visible_primitive_substitute: false,
    required_response: 'keep the authored asset unmounted and surface an actionable load status',
  },
  assets,
};
if (report.delivery_failure_policy.route_visible_primitive_substitute !== false || report.delivery_failure_policy.namra_visible_primitive_substitute !== false) {
  throw new Error('delivery failure policy must prohibit visible primitive substitution');
}
await writeFile(resolve(reportArg), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
