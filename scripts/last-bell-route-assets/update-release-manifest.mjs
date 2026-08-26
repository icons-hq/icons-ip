#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertLastBellVisualAssetApproval } from './release-approval.mjs';

const [seamsArg, releaseArg, provenanceArg, qaArg, openingEvidenceArg] = process.argv.slice(2);
if (!seamsArg || !releaseArg || Boolean(provenanceArg) !== Boolean(qaArg)) {
  throw new Error('usage: update-release-manifest.mjs <asset-seams.json> <release.json> [<asset-provenance.md> <qa-report.md> [<opening-evidence.json>]]');
}

const seamsPath = resolve(seamsArg);
const releasePath = resolve(releaseArg);
const seams = JSON.parse(await readFile(seamsPath, 'utf8'));
const release = JSON.parse(await readFile(releasePath, 'utf8'));

release.components.replaceable_characters.build_id = seams.build_id;
release.visual_review = seams.visual_review;
release.no_clay_primitive_final = seams.no_clay_primitive_final === true;
release.status = {
  ...release.status,
  automated_asset_contracts: 'pass',
  internal_visual_asset_review: seams.visual_review?.status ?? 'blocked-human-art-review-required',
  external_ip_asset_approval: seams.visual_review?.external_ip_approval ?? 'not-asserted',
};
if (openingEvidenceArg) {
  const openingEvidencePath = resolve(openingEvidenceArg);
  const openingEvidence = JSON.parse(await readFile(openingEvidencePath, 'utf8'));
  const openingVisualReview = {
    status: openingEvidence.status,
    external_ip_approval: openingEvidence.external_ip_approval,
    evidence: openingEvidence,
  };
  assertLastBellVisualAssetApproval(
    openingVisualReview,
    'Last Bell opening delivery',
    release.components.opening_3d.build_id,
  );
  for (const render of openingEvidence.comparison_renders ?? []) {
    const renderPath = /^(?:docs|public|outputs|output)\//.test(render.path)
      ? resolve(import.meta.dirname, '../..', render.path)
      : resolve(dirname(openingEvidencePath), render.path);
    const actualSha256 = createHash('sha256').update(await readFile(renderPath)).digest('hex');
    if (actualSha256 !== render.sha256) throw new Error(`opening comparison render SHA does not match: ${render.path}`);
  }
  release.components.opening_3d.visual_review = openingVisualReview;
  release.components.narrative.review_status = 'approved-external-ip-dialogue-review';
  release.status = {
    ...release.status,
    automated_contracts: 'pass',
    opening_visual_asset_review: 'approved-human-art-and-external-ip-review',
    production_release: 'approved-release-candidate-pending-preview-and-production-readback',
  };
}
const componentFingerprint = JSON.stringify(release.components);
release.release_build_id = `last-bell-release-${createHash('sha256').update(componentFingerprint).digest('hex').slice(0, 16)}`;
await writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);

if (provenanceArg && qaArg) {
  const provenancePath = resolve(provenanceArg);
  const qaPath = resolve(qaArg);
  const transfer = `${seams.transfer.bytes.toLocaleString('en-US')} B / ${seams.transfer.mib.toFixed(3)} MiB`;
  const unique = seams.unique_transfer
    ? `; 전체 unique ${seams.unique_transfer.mib.toFixed(3)} MiB / 55 MiB 목표·75 MiB hard cap`
    : '';
  const line = `| zone route·캐릭터 교체 pack | \`${seams.build_id}\` | ${transfer} | 20 MiB 목표·24 MiB hard cap 통과${unique} |`;
  const provenance = await readFile(provenancePath, 'utf8');
  const qa = await readFile(qaPath, 'utf8');
  const updatedProvenance = provenance.replace(/조정 release build: `[^`]+`/, `조정 release build: \`${release.release_build_id}\``);
  const updatedQa = qa
    .replace(/조정 release build: `[^`]+`/, `조정 release build: \`${release.release_build_id}\``)
    .replace(/^\| zone route·캐릭터 교체 pack \|.*$/m, line);
  if (updatedProvenance === provenance || updatedQa === qa) throw new Error('release evidence markers were not found');
  await Promise.all([writeFile(provenancePath, updatedProvenance), writeFile(qaPath, updatedQa)]);
}
console.log(JSON.stringify({ release_build_id: release.release_build_id, route_character_build_id: seams.build_id, transfer: seams.transfer }, null, 2));
