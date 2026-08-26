#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertLastBellVisualAssetApproval } from './release-approval.mjs';

const [reportArg, destinationArg, evidenceArg] = process.argv.slice(2);
const report = JSON.parse(await readFile(resolve(reportArg), 'utf8'));
const characters = report.assets.filter((asset) => asset.kind === 'character');
const evidencePath = evidenceArg ? resolve(evidenceArg) : undefined;
const visualEvidence = evidencePath ? JSON.parse(await readFile(evidencePath, 'utf8')) : undefined;
const repoRoot = resolve(import.meta.dirname, '../..');
if (visualEvidence) {
  for (const render of visualEvidence.comparison_renders ?? []) {
    const renderPath = /^(?:docs|public|outputs|output)\//.test(render.path)
      ? resolve(repoRoot, render.path)
      : resolve(dirname(evidencePath), render.path);
    let renderBytes;
    try {
      renderBytes = await readFile(renderPath);
    } catch {
      throw new Error(`Visual-review comparison render is missing: ${render.path}`);
    }
    const actualSha256 = createHash('sha256').update(renderBytes).digest('hex');
    if (actualSha256 !== render.sha256) {
      throw new Error(`Visual-review comparison render SHA does not match: ${render.path}`);
    }
  }
  const reviewedAssets = new Set();
  for (const evidence of visualEvidence.comparisons ?? []) {
    const asset = report.assets.find((candidate) => candidate.key === evidence.key);
    if (!asset || asset.sha256 !== evidence.rendered_delivery_sha256 || evidence.delivery_sha256 !== evidence.rendered_delivery_sha256) {
      throw new Error(`Visual-review evidence delivery SHA does not match current ${evidence.key} delivery`);
    }
    if (!evidence.frame || evidence.frame.mean_channel_stdev < 5 || evidence.frame.channel_range < 16) {
      throw new Error(`Visual-review evidence frame is empty or lacks contrast for ${evidence.key}`);
    }
    reviewedAssets.add(evidence.key);
  }
  for (const asset of report.assets) {
    if (!reviewedAssets.has(asset.key)) throw new Error(`Visual-review evidence is missing current ${asset.key}`);
  }
}
const blockedVisualReview = {
  status: 'blocked-human-art-review-required',
  automated_contracts: 'pass',
  reason: 'technical delivery validation does not establish final character or product visual approval',
  external_ip_approval: 'not-asserted',
  evidence: null,
};
const visualReview = visualEvidence ? {
  status: visualEvidence.status,
  automated_contracts: 'pass',
  external_ip_approval: visualEvidence.external_ip_approval,
  evidence: visualEvidence,
} : blockedVisualReview;
if (visualEvidence) assertLastBellVisualAssetApproval(visualReview, 'route and character delivery', report.build_id);
const isApprovedDelivery = Boolean(visualEvidence);
const manifest = {
  schema: 1,
  build_id: report.build_id,
  review_status: 'textured-PBR delivery with UV0/UV1, semantic anchors, colliders, LOD contract, and skinned replacement seams',
  visual_review: visualReview,
  no_clay_primitive_final: isApprovedDelivery,
  authored_delivery_required: true,
  delivery_failure_policy: report.delivery_failure_policy,
  source_provenance: {
    human_base_meshes: {
      source: 'outputs/last-bell-character-sources/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend',
      source_url: 'https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip',
      version: 'v1.4.1',
      license: 'CC0-1.0',
      sha256: '811f43accbb31a88266d932f8f5563b2d13586fca0ba2693aad1f5fe582b3515',
      delivery_use: 'realistic body topology only; actor likeness is not asserted',
    },
    material_maps: {
      source: 'outputs/last-bell-3d/raw/polyhaven-pbr/provenance.json',
      license: 'CC0-1.0',
      delivery_use: 'embedded KTX2 base-color, normal, and ORM maps',
    },
    authored_route_model_geometry: {
      source: 'outputs/last-bell-product-assets/route-character-assets/polyhaven-route-model-provenance.json',
      license: 'CC0-1.0',
      delivery_use: 'official authored geometry is flattened into zone-local GLBs and remapped to shared route PBR atlases',
    },
    lookdev_references: {
      namra_rooftop_turnaround: {
        source: 'outputs/last-bell-character-sources/lookdev/namra-rooftop-turnaround-v1.png',
        sha256: '968dcc210435f64c4db0234960e812ad1ad1d52cf84659035f9712c10e3016ec',
        use: 'internal material direction only; not embedded and not a likeness approval',
      },
      zombie_student_turnaround: {
        source: 'outputs/last-bell-character-sources/lookdev/zombie-student-turnaround-v1.png',
        sha256: '2350702a0b9381857dd894e6c9cbc27a6a1b28bc69fba4948bab965714de7674',
        use: 'internal dirt and infection material direction only; not embedded',
      },
      uniform_a_zombie_turnaround_v2: {
        source: 'outputs/last-bell-character-sources/lookdev/uniform-a-zombie-turnaround-v2.png',
        sha256: 'd7bc8e0270bd4fa7dfd57eb57e244acb68dbb292df0ee4a3a967dd88360f896d',
        use: 'internal original adult-uniform silhouette direction only; not embedded, not a performer likeness claim, and not a shipping texture',
      },
      zombie_athletics_turnaround: {
        source: 'outputs/last-bell-character-sources/lookdev/zombie-athletics-turnaround-v1.png',
        sha256: 'deb9ab5e1df56aa84df727c63db38449ec246dfbe81b52c5d40e927810fab1b7',
        use: 'internal adult-athletics wardrobe direction only; not embedded',
      },
      zombie_staff_turnaround: {
        source: 'outputs/last-bell-character-sources/lookdev/zombie-staff-turnaround-v1.png',
        sha256: '5c35fa322c24db8970ee8b9d330bf4f3500ab9e4768d57654355cc3f26c8e3bb',
        use: 'internal adult-staff wardrobe direction only; not embedded',
      },
    },
  },
  routes: report.assets.filter((asset) => asset.kind === 'route').map((asset) => ({
    zone_id: asset.key,
    model: `public/generated/last-bell/3d/routes/${asset.key}.glb`,
    sha256: asset.sha256,
    bytes: asset.bytes,
    required_contract: ['LOD0_Route', 'semantic Anchor_* nodes', 'Meshopt'],
    world_contract: asset.world_contract,
  })),
  zombie_common_rig: {
    rig_id: 'zombie-common-v1',
    variants: characters.filter((asset) => asset.key.startsWith('zombie-')).map((asset) => ({ key: asset.key, model: `public/generated/last-bell/3d/characters/${asset.key}.glb`, sha256: asset.sha256, clips: asset.animations })),
    material_variant_contract: 'student-uniform | athletics | staff; identical Armature_Common node and Patrol/Investigate/Search/Chase/Capture semantic clips',
    review_status: isApprovedDelivery
      ? 'approved authored skinned zombie delivery for matching build'
      : 'replaceable non-likeness technical art; licensed likeness is not asserted',
  },
  namra_rooftop: {
    key: 'character.namra.rooftop',
    model: 'public/generated/last-bell/3d/characters/namra-rooftop.glb',
    sha256: characters.find((asset) => asset.key === 'namra-rooftop')?.sha256,
    clips: characters.find((asset) => asset.key === 'namra-rooftop')?.animations,
    replace_seam: isApprovedDelivery
      ? 'Character_Root + Armature_Common + semantic clip names; approved delivery remains replaceable by stable seam'
      : 'Character_Root + Armature_Common + semantic clip names; no actor likeness or show-frame texture is embedded',
    review_status: isApprovedDelivery
      ? 'approved authored rooftop character delivery for matching build'
      : 'replaceable non-likeness technical art; rights and performance review required before likeness approval',
  },
  transfer: report.transfer,
  world_contract: report.world_contract,
};
await writeFile(resolve(destinationArg), JSON.stringify(manifest, null, 2) + '\n');
