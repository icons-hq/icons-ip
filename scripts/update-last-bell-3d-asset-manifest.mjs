#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(repoRoot, 'docs/ip/all-of-us-are-dead-2/asset-manifest.json');

const generated = [
  ['entry-glb', 'entry.glb', 'post-strike Hyosan entrance cold-open geometry', true],
  ['start-room-glb', 'start-room.glb', 'destroyed classroom authored geometry and PBR materials', true],
  ['first-bay-glb', 'first-bay.glb', 'first corridor bay authored geometry and PBR materials', true],
  ['classroom-door-glb', 'classroom-door.glb', 'smooth simulation-driven classroom sliding door', true],
  ['metadata', 'metadata.json', 'runtime node, UV1, lightmap, provenance, and transfer-budget contract', false],
  ['entry-lightmap', 'lightmaps/entry-medium.ktx2', 'entrance static ground-contact AO lightmap', true],
  ['start-room-lightmap', 'lightmaps/start-room-medium.ktx2', 'classroom static ground-contact AO lightmap', true],
  ['first-bay-lightmap', 'lightmaps/first-bay-medium.ktx2', 'corridor static ground-contact AO lightmap', true],
];

const thirdParty = [
  ['basis-transcoder-js', 'basis/basis_transcoder.js', 'KTX2 Basis Universal browser transcoder'],
  ['basis-transcoder-wasm', 'basis/basis_transcoder.wasm', 'KTX2 Basis Universal WebAssembly transcoder'],
];

async function integrity(path) {
  const bytes = await readFile(path);
  return {
    byte_size: (await stat(path)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.assets = manifest.assets.filter((asset) => !asset.id.startsWith('last-bell-3d-'));

for (const [slug, relativePath, usage, includesCc0Pbr] of generated) {
  const path = `/generated/last-bell/3d/${relativePath}`;
  manifest.assets.push({
    id: `last-bell-3d-${slug}`,
    path,
    usage,
    source_type: includesCc0Pbr
      ? 'project-authored-3d-with-cc0-pbr'
      : 'project-original-generated-3d-metadata',
    source_url: 'repo://scripts/last-bell-3d/build.py',
    reference: [
      'docs/ip/all-of-us-are-dead-2/hyosan-visual-reference.md',
      'docs/ip/all-of-us-are-dead-2/asset-provenance.md#poly-haven-cc0-pbr',
    ],
    provenance: includesCc0Pbr
      ? 'Project-authored Blender geometry with pinned Poly Haven CC0 PBR inputs and a project-authored keyed damage atlas for local glass and floor-contact detail. Reference frames set spatial, damage, and palette targets only; drama or Netflix source pixels are not projected or baked into materials. Exact upstream URLs and hashes are recorded by the build pipeline.'
      : 'Generated from the validated delivery pack; records runtime nodes, bounds, lightmap bindings, PBR provenance pointer, and transfer budgets.',
    editing: 'blender-5.2-gltf-transform-4.4.2-meshopt-ktx2',
    license: includesCc0Pbr
      ? 'Mixed: project-authored geometry under the approved campaign production scope; embedded or baked Poly Haven inputs under CC0-1.0'
      : 'Project-original metadata under the approved campaign production scope',
    license_status: includesCc0Pbr
      ? 'LOCKED-mixed-project-and-cc0-provenance-2026-08-24'
      : 'LOCKED-project-original-2026-08-24',
    ...await integrity(resolve(repoRoot, `public${path}`)),
  });
}

for (const [slug, relativePath, usage] of thirdParty) {
  const path = `/generated/last-bell/3d/${relativePath}`;
  manifest.assets.push({
    id: `last-bell-3d-${slug}`,
    path,
    usage,
    source_type: 'third-party-runtime-transcoder',
    source_url: 'https://github.com/mrdoob/three.js/tree/r182/examples/jsm/libs/basis',
    provenance: 'Copied byte-for-byte from the installed three@0.182.0 Basis Universal runtime bundle.',
    editing: 'copied-without-byte-edit',
    license: 'Apache-2.0 Basis Universal runtime distributed with three@0.182.0',
    license_status: 'LOCKED-third-party-license-recorded-2026-08-24',
    ...await integrity(resolve(repoRoot, `public${path}`)),
  });
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${manifestPath} with ${generated.length + thirdParty.length} Last Bell 3D delivery files.`);
