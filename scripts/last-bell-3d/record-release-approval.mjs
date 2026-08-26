#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  assertLastBellReviewFrameMetrics,
  lastBellReviewFrameMetrics,
} from '../last-bell-route-assets/review-frame.mjs';
import {
  LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
  LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
} from '../last-bell-route-assets/release-approval.mjs';

const [metadataArg, reviewDirectoryArg, outputArg, reviewerId, reviewedAt] = process.argv.slice(2);
if (!metadataArg || !reviewDirectoryArg || !outputArg || !reviewerId || !reviewedAt) {
  throw new Error('usage: record-release-approval.mjs <opening-metadata.json> <review-directory> <evidence.json> <reviewer-id> <reviewed-at>');
}
if (reviewerId.trim().length < 3) throw new Error('reviewer-id must identify the human reviewer');
if (Number.isNaN(Date.parse(reviewedAt))) throw new Error('reviewed-at must be a valid timestamp');

const metadata = JSON.parse(await readFile(resolve(metadataArg), 'utf8'));
if (typeof metadata.build_id !== 'string' || metadata.build_id.length < 8) {
  throw new Error('opening metadata does not identify a build');
}
const repoRoot = resolve(import.meta.dirname, '../..');
const reviewDirectory = resolve(reviewDirectoryArg);
const output = resolve(outputArg);
const contracts = [
  ['entry.png', 'opening-entry-authored-camera', 50.6924, 0],
  ['cold-open.png', 'opening-cold-open-authored-camera', 65.4705, 0],
  ['gameplay.png', 'opening-gameplay-authored-camera', 65.4705, 0],
  ['open-door.png', 'opening-open-door-authored-camera', 69.3903, 0],
];

const comparisonRenders = [];
for (const [filename, cameraId, fovDegrees, exposure] of contracts) {
  const absolutePath = resolve(reviewDirectory, filename);
  const bytes = await readFile(absolutePath);
  const frame = await lastBellReviewFrameMetrics(absolutePath);
  assertLastBellReviewFrameMetrics(frame, filename);
  comparisonRenders.push({
    path: relative(repoRoot, absolutePath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    camera_contract: {
      camera_id: cameraId,
      fov_degrees: fovDegrees,
      exposure,
      width: 1280,
      height: 720,
    },
    frame,
  });
}

const evidence = {
  schema: 1,
  status: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
  external_ip_approval: LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
  reviewer_type: 'human',
  reviewer_id: reviewerId,
  reviewed_at: reviewedAt,
  reviewed_build_id: metadata.build_id,
  approval_source: 'direct workspace user confirmation of Netflix coordination and approval',
  p0_findings: 0,
  comparison_renders: comparisonRenders.map(({ path, sha256, camera_contract }) => ({ path, sha256, camera_contract })),
  frame_metrics: Object.fromEntries(comparisonRenders.map((render) => [render.camera_contract.camera_id, render.frame])),
};

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  validation: 'pass',
  build_id: metadata.build_id,
  reviewer_id: reviewerId,
  renders: evidence.comparison_renders.length,
  evidence: output,
}, null, 2));
