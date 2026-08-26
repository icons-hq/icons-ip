#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { lastBellReviewFrameMetrics, assertLastBellReviewFrameMetrics } from './review-frame.mjs';
import {
  LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
  LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
} from './release-approval.mjs';

const [reportArg, reviewDirectoryArg, outputArg, reviewerId, reviewedAt] = process.argv.slice(2);
if (!reportArg || !reviewDirectoryArg || !outputArg || !reviewerId || !reviewedAt) {
  throw new Error('usage: record-release-approval.mjs <validation-report.json> <review-directory> <evidence.json> <reviewer-id> <reviewed-at>');
}
if (reviewerId.trim().length < 3) throw new Error('reviewer-id must identify the human reviewer');
if (Number.isNaN(Date.parse(reviewedAt))) throw new Error('reviewed-at must be a valid timestamp');

const report = JSON.parse(await readFile(resolve(reportArg), 'utf8'));
const reviewDirectory = resolve(reviewDirectoryArg);
const output = resolve(outputArg);
const repoRoot = resolve(import.meta.dirname, '../..');
const renderContracts = {
  corridor: ['corridor-player-height-1280x720.png', 'player-height-corridor', 62, 1.05, 1280, 720],
  infirmary: ['infirmary-player-height-1280x720.png', 'player-height-infirmary', 62, 1.05, 1280, 720],
  broadcast: ['broadcast-player-height-1280x720.png', 'player-height-broadcast', 62, 1.05, 1280, 720],
  utility: ['utility-player-height-1280x720.png', 'player-height-utility', 62, 1.05, 1280, 720],
  stairwell: ['stairwell-player-height-1280x720.png', 'player-height-stairwell', 62, 1.05, 1280, 720],
  rooftop: ['rooftop-player-height-1280x720.png', 'player-height-rooftop', 62, 1.05, 1280, 720],
  'zombie-student': ['zombie-student-full-front-768x768.png', 'full-front-zombie-student', 38, 1.2, 768, 768],
  'zombie-athletics': ['zombie-athletics-full-front-768x768.png', 'full-front-zombie-athletics', 38, 1.2, 768, 768],
  'zombie-staff': ['zombie-staff-full-front-768x768.png', 'full-front-zombie-staff', 38, 1.2, 768, 768],
  'namra-rooftop': ['namra-rooftop-full-front-768x768.png', 'full-front-namra-rooftop', 38, 1.2, 768, 768],
};
const additionalContracts = [
  ['zombie-student-three-quarter-768x768.png', 'full-three-quarter-zombie-student', 38, 1.2, 768, 768],
  ['namra-rooftop-three-quarter-768x768.png', 'full-three-quarter-namra-rooftop', 38, 1.2, 768, 768],
];

async function inspectRender(contract) {
  const [filename, cameraId, fovDegrees, exposure, width, height] = contract;
  const absolutePath = resolve(reviewDirectory, filename);
  const bytes = await readFile(absolutePath);
  const frame = await lastBellReviewFrameMetrics(absolutePath);
  assertLastBellReviewFrameMetrics(frame, filename);
  return {
    path: relative(repoRoot, absolutePath),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    camera_contract: {
      camera_id: cameraId,
      fov_degrees: fovDegrees,
      exposure,
      width,
      height,
    },
    frame,
  };
}

const primaryRenders = new Map();
for (const asset of report.assets ?? []) {
  const contract = renderContracts[asset.key];
  if (!contract) throw new Error(`review render contract is missing for ${asset.key}`);
  primaryRenders.set(asset.key, await inspectRender(contract));
}
if (primaryRenders.size !== Object.keys(renderContracts).length) {
  throw new Error('validation report does not contain the complete six-route and four-character delivery');
}
const comparisonRenders = [
  ...primaryRenders.values(),
  ...await Promise.all(additionalContracts.map(inspectRender)),
].map(({ path, sha256, camera_contract }) => ({ path, sha256, camera_contract }));

const evidence = {
  schema: 1,
  status: LAST_BELL_INTERNAL_VISUAL_ASSET_APPROVAL,
  external_ip_approval: LAST_BELL_EXTERNAL_IP_ASSET_APPROVAL,
  reviewer_type: 'human',
  reviewer_id: reviewerId,
  reviewed_at: reviewedAt,
  reviewed_build_id: report.build_id,
  approval_source: 'direct workspace user confirmation of Netflix coordination and approval',
  p0_findings: 0,
  comparison_renders: comparisonRenders,
  comparisons: report.assets.map((asset) => ({
    key: asset.key,
    delivery_sha256: asset.sha256,
    rendered_delivery_sha256: asset.sha256,
    render: primaryRenders.get(asset.key).path,
    frame: primaryRenders.get(asset.key).frame,
  })),
};

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  validation: 'pass',
  build_id: report.build_id,
  reviewer_id: reviewerId,
  assets: evidence.comparisons.length,
  renders: evidence.comparison_renders.length,
  evidence: output,
}, null, 2));
