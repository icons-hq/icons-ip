#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertLastBellEnvironmentVisualQuality,
  buildLastBellEnvironmentVisualQualityReport,
} from './visual-quality.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../..');
const outputDirectory = path.resolve(process.argv[2] ?? '');
const reportPath = path.resolve(process.argv[3] ?? path.join(outputDirectory, 'visual-quality-report.json'));

if (!process.argv[2]) {
  throw new Error('Usage: validate-visual-quality.mjs <private-build-output> [report-path]');
}

const report = await buildLastBellEnvironmentVisualQualityReport({
  buildId: path.basename(outputDirectory),
  corridorPath: path.join(outputDirectory, 'review-corridor-delivery-1280x720.png'),
  rooftopPath: path.join(outputDirectory, 'review-rooftop-delivery-1280x720.png'),
  corridorReferencePath: path.join(repositoryRoot, 'outputs/last-bell-3d/lookdev/first-bay-corridor-v2.png'),
  rooftopReferencePath: path.join(repositoryRoot, 'outputs/last-bell-terra-authored-recovery/mattes/rooftop-night-mountain-matte-v1.png'),
});

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
assertLastBellEnvironmentVisualQuality(report);
console.log(JSON.stringify({
  status: report.status,
  scope: report.scope,
  report: reportPath,
  release_approval: report.release_approval,
  human_art_review: report.human_art_review,
}));
