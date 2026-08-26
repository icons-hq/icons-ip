#!/usr/bin/env node
/** Validate the standalone two-chapter authored pack before runtime mounting. */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'public/generated/last-bell/3d/campaign');
const routeNodes = [
  'Zone_corridor', 'Zone_infirmary', 'Zone_broadcast', 'Zone_utility', 'Zone_stairwell', 'Zone_rooftop',
  'DoorFire_Pivot', 'DoorRooftop_Pivot', 'LOD0_corridor_detail', 'LOD1_corridor_silhouette',
  'COL_Corridor_Lane', 'COL_Infirmary', 'COL_Broadcast', 'COL_Utility', 'COL_Stairwell', 'COL_Rooftop',
];
const animationRequirements = {
  'zombie-shared-rig.glb': ['Idle', 'Patrol', 'Investigate', 'Search', 'Chase', 'Capture'],
  'character-namra-rooftop.glb': ['Neutral', 'Recognition', 'Subdue'],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseGlb(bytes, filename) {
  assert(bytes.readUInt32LE(0) === 0x46546c67, `${filename}: GLB magic is invalid`);
  assert(bytes.readUInt32LE(4) === 2, `${filename}: only glTF 2 is accepted`);
  const jsonLength = bytes.readUInt32LE(12);
  assert(bytes.readUInt32LE(16) === 0x4e4f534a, `${filename}: JSON chunk is missing`);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

async function readGlb(filename) {
  const bytes = await readFile(resolve(directory, filename));
  return { bytes, json: parseGlb(bytes, filename) };
}

function nodeSet(document) {
  return new Set((document.nodes ?? []).map((node) => node.name).filter(Boolean));
}

function assertNodes(filename, document, expected) {
  const names = nodeSet(document);
  const missing = expected.filter((name) => !names.has(name));
  assert(missing.length === 0, `${filename}: missing semantic nodes ${missing.join(', ')}`);
}

function assertPbr(filename, document) {
  const materials = document.materials ?? [];
  assert(materials.length >= 3, `${filename}: authored material diversity is missing`);
  assert(materials.every((material) => material.pbrMetallicRoughness), `${filename}: non-PBR material found`);
}

const manifest = JSON.parse(await readFile(resolve(directory, 'campaign-asset-manifest.json'), 'utf8'));
assert(manifest.status === 'REPLACEABLE_CHARACTER_ART_REVIEW_REQUIRED', 'manifest: replacement status must remain explicit');
assert(manifest.delivery_role === 'dcc-source-archive-not-streamed-runtime', 'manifest: monolithic campaign pack must stay out of runtime streaming');
assert(manifest.rights?.contains_actor_likeness === false, 'manifest: actor likeness must never be claimed');
assert(manifest.rights?.replaceable_character_seam === 'character.namra.rooftop', 'manifest: replaceable character seam changed');
assert(manifest.budget?.max_live_zombies === 2, 'manifest: runtime zombie hard cap changed');

const route = await readGlb('two-chapter-route.glb');
assertNodes('two-chapter-route.glb', route.json, routeNodes);
assertPbr('two-chapter-route.glb', route.json);
assert((route.json.meshes ?? []).length >= 100, 'two-chapter-route.glb: structural detail is unexpectedly sparse');
assert((route.json.nodes ?? []).some((node) => node.name === 'Rooftop_Campfire'), 'two-chapter-route.glb: campfire anchor is missing');

for (const [filename, expectedAnimations] of Object.entries(animationRequirements)) {
  const asset = await readGlb(filename);
  assertPbr(filename, asset.json);
  assert((asset.json.skins ?? []).length === 1, `${filename}: shared rig skin is missing`);
  const clips = new Set((asset.json.animations ?? []).map((animation) => animation.name));
  const missing = expectedAnimations.filter((name) => !clips.has(name));
  assert(missing.length === 0, `${filename}: missing animation clips ${missing.join(', ')}`);
}

const character = await readGlb('character-namra-rooftop.glb');
assertNodes('character-namra-rooftop.glb', character.json, ['character.namra.rooftop', 'NamraArchive_Rig']);
const files = ['two-chapter-route.glb', 'zombie-shared-rig.glb', 'character-namra-rooftop.glb'];
const totalBytes = (await Promise.all(files.map(async (filename) => (await stat(resolve(directory, filename))).size))).reduce((total, bytes) => total + bytes, 0);
assert(totalBytes <= manifest.budget.total_transfer_hard_cap_bytes, `campaign pack ${totalBytes} bytes exceeds ${manifest.budget.total_transfer_hard_cap_bytes} byte hard cap`);

console.log(JSON.stringify({
  status: 'valid',
  buildId: manifest.build_id,
  totalBytes,
  budgetBytes: manifest.budget.total_transfer_hard_cap_bytes,
  routeNodes: routeNodes.length,
  zombieAnimations: animationRequirements['zombie-shared-rig.glb'],
  characterAnimations: animationRequirements['character-namra-rooftop.glb'],
}, null, 2));
