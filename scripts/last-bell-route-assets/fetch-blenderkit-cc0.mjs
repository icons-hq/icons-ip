#!/usr/bin/env node

/**
 * Fetches the pinned CC0 photogrammetry sources used only as inputs to the
 * Last Bell authored-environment recovery pipeline.
 *
 * Raw BlenderKit files are never shipped. Blender imports, cleans, decimates,
 * re-materials and exports them before the existing KTX2 + Meshopt delivery
 * pipeline is allowed to promote an environment GLB.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const targetDir = resolve(
  process.argv[2] ?? 'outputs/last-bell-environment-recovery-sources/blenderkit-cc0',
);

const sources = [
  {
    key: 'abandoned-house',
    assetBaseId: '94e53774-84d7-430e-89bd-12cf7b2ef828',
    fileId: 1041556,
    expectedName: 'Abandoned House',
    expectedSha256: '618d5f5153470d9039c11d6dc82eb1625416d383d6e1efcc5b23005b71a94660',
  },
  {
    key: 'painted-concrete-blocks',
    assetBaseId: '049c6887-3484-4725-b8ae-8749d7b68e1f',
    fileId: 501417,
    expectedName: 'Painted Concrete Blocks (Photoscanned)',
    expectedSha256: 'efd2e80aa3f957da81e64d68d0bcd11526f5bb2b215f12d88206a6357793e29e',
  },
  {
    key: 'scan-old-broken-floor',
    assetBaseId: 'c4f28476-3d97-46dc-8969-cbf704059205',
    fileId: 963779,
    expectedName: 'Scan Old broken floor',
    expectedSha256: '77e8919e10008374ad67a078be3bf2a697704297129ac61708856403ae46ac34',
  },
  {
    key: 'scan-rubble-pile-a',
    assetBaseId: '930f3a3b-b6c3-4971-ab86-ce65c93b2a3c',
    fileId: 777119,
    expectedName: 'Scan Pile of rubble',
    expectedSha256: 'cf9681a80565cfd9845b63b39a205758cf904807917da7f5e216368d5ab9a58e',
  },
  {
    key: 'scan-rubble-ruins',
    assetBaseId: '853f291b-6f22-4900-9979-75826dac8c27',
    fileId: 983311,
    expectedName: 'Scan Rubble ruins',
    expectedSha256: '6a51c2a3f63f3acc2417494f673bb068d55152e27d64dd758c5e51e167c8ee33',
  },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'icons-ip-last-bell-authored-asset-pipeline/1.0' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'icons-ip-last-bell-authored-asset-pipeline/1.0' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function existingBytes(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

await mkdir(targetDir, { recursive: true });

const provenance = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  upstream: 'https://www.blenderkit.com/',
  policy: {
    accepted_license: 'cc_zero',
    source_role: 'private-photogrammetry-input-only',
    public_runtime_delivery: false,
    required_derivative_steps: [
      'blender-import',
      'topology-cleanup-and-decimation',
      'project-authored-material-and-uv-review',
      'collision-and-semantic-anchors',
      'ktx2-textures',
      'meshopt-geometry',
      'human-runtime-visual-gate',
    ],
  },
  assets: [],
};

for (const source of sources) {
  const searchUrl = new URL('https://www.blenderkit.com/api/v1/search/');
  searchUrl.searchParams.set(
    'query',
    `asset_type:model asset_base_id:${source.assetBaseId}`,
  );
  searchUrl.searchParams.set('dict_parameters', '1');
  searchUrl.searchParams.set('page_size', '10');

  const search = await fetchJson(searchUrl);
  const asset = search.results?.find((candidate) => candidate.assetBaseId === source.assetBaseId);
  if (!asset) throw new Error(`${source.key}: pinned BlenderKit asset was not found`);
  if (asset.license !== 'cc_zero') {
    throw new Error(`${source.key}: expected cc_zero, received ${asset.license ?? 'unknown'}`);
  }
  if (asset.name !== source.expectedName) {
    throw new Error(`${source.key}: expected name ${source.expectedName}, received ${asset.name}`);
  }

  const file = asset.files?.find((candidate) => candidate.id === source.fileId);
  if (!file || file.fileType !== 'gltf') {
    throw new Error(`${source.key}: pinned glTF file ${source.fileId} is unavailable`);
  }

  const downloadEndpoint = new URL(file.downloadUrl);
  downloadEndpoint.searchParams.set('scene_uuid', randomUUID());
  const download = await fetchJson(downloadEndpoint);
  const signedUrl = download.filePath;
  if (typeof signedUrl !== 'string' || !signedUrl.startsWith('https://')) {
    throw new Error(`${source.key}: BlenderKit did not return a signed download URL`);
  }

  const outputPath = join(targetDir, `${source.key}.glb`);
  let bytes = await existingBytes(outputPath);
  let digest = bytes ? sha256(bytes) : null;
  if (!bytes || digest !== source.expectedSha256) {
    bytes = await fetchBytes(signedUrl);
    digest = sha256(bytes);
    if (digest !== source.expectedSha256) {
      throw new Error(`${source.key}: sha256 mismatch ${digest}`);
    }
    const tempPath = `${outputPath}.${process.pid}.tmp`;
    await writeFile(tempPath, bytes);
    await rename(tempPath, outputPath);
  }

  provenance.assets.push({
    key: source.key,
    name: asset.name,
    asset_base_id: source.assetBaseId,
    revision_id: asset.id,
    license: asset.license,
    source_page: `https://www.blenderkit.com/asset-gallery-detail/${source.assetBaseId}/`,
    metadata_endpoint: searchUrl.toString(),
    download_endpoint: file.downloadUrl,
    file_id: file.id,
    file_type: file.fileType,
    local_file: basename(outputPath),
    bytes: bytes.length,
    sha256: digest,
  });
}

const provenancePath = join(targetDir, 'provenance.json');
const temporaryProvenancePath = `${provenancePath}.${process.pid}.tmp`;
await writeFile(temporaryProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
await rename(temporaryProvenancePath, provenancePath);

// Remove stale partial writes from interrupted runs without touching sources.
await Promise.all(
  sources.map((source) => rm(join(targetDir, `${source.key}.glb.${process.pid}.tmp`), { force: true })),
);

console.log(JSON.stringify(provenance, null, 2));
