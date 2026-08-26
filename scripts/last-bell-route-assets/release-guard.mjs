#!/usr/bin/env node
/**
 * Reject release-facing Last Bell asset metadata that still points to a
 * low-fidelity substitute or an unapproved character-replacement sentinel.
 *
 * Source authoring scripts are intentionally outside this guard: only shipped
 * GLBs, production asset metadata, and release manifests are examined.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  assertLastBellReleaseMetadataApproval,
  assertLastBellVisualAssetApproval,
  containsLastBellForbiddenDeliveryMarker,
} from './release-approval.mjs';

const [deliveryArg, ...metadataArgs] = process.argv.slice(2);
if (!deliveryArg || metadataArgs.length === 0) {
  throw new Error('usage: release-guard.mjs <delivery-3d-root> <production-asset-metadata...>');
}

const delivery = resolve(deliveryArg);
const repoRoot = resolve(import.meta.dirname, '../..');
const routes = ['corridor', 'infirmary', 'broadcast', 'utility', 'stairwell', 'rooftop'];
const characters = ['zombie-student', 'zombie-athletics', 'zombie-staff', 'namra-rooftop'];

function glbJson(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid delivery GLB');
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
}

for (const [kind, keys] of [['routes', routes], ['characters', characters]]) {
  for (const key of keys) {
    const path = join(delivery, kind, `${key}.glb`);
    const document = glbJson(await readFile(path));
    const releaseMetadata = { nodes: document.nodes, materials: document.materials, asset: document.asset };
    if (containsLastBellForbiddenDeliveryMarker(releaseMetadata)) throw new Error(`${kind}/${key}: prohibited production delivery marker`);
  }
}

// Monolithic campaign GLBs are retained as DCC/source archives only, but they
// remain public files and must not carry an executable production substitute
// marker either.
for (const filename of ['two-chapter-route.glb', 'zombie-shared-rig.glb', 'character-namra-rooftop.glb']) {
  const document = glbJson(await readFile(join(delivery, 'campaign', filename)));
  const releaseMetadata = { nodes: document.nodes, materials: document.materials, asset: document.asset };
  if (containsLastBellForbiddenDeliveryMarker(releaseMetadata)) throw new Error(`campaign/${filename}: prohibited production delivery marker`);
}

for (const source of metadataArgs) {
  const path = resolve(source);
  const content = await readFile(path, 'utf8');
  if (path.endsWith('.json')) {
    const metadata = JSON.parse(content);
    if (containsLastBellForbiddenDeliveryMarker(metadata)) throw new Error(`${path}: prohibited release metadata marker`);
    // Structural checks and a clean marker scan cannot approve an asset that
    // has failed (or has not yet received) a same-camera visual/IP review.
    assertLastBellReleaseMetadataApproval(metadata, path);
    const evidenceSurfaces = [metadata.visual_review?.evidence].filter(Boolean);
    const openingVisualReview = metadata.components?.opening_3d?.visual_review;
    if (openingVisualReview) {
      assertLastBellVisualAssetApproval(
        openingVisualReview,
        `${path}: opening delivery`,
        metadata.components.opening_3d.build_id,
      );
      evidenceSurfaces.push(openingVisualReview.evidence);
    }
    for (const render of evidenceSurfaces.flatMap((evidence) => evidence.comparison_renders ?? [])) {
      const renderPath = /^(?:docs|public|outputs|output)\//.test(render.path)
        ? resolve(repoRoot, render.path)
        : resolve(dirname(path), render.path);
      let bytes;
      try {
        bytes = await readFile(renderPath);
      } catch {
        throw new Error(`${path}: approved comparison render is missing: ${render.path}`);
      }
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== render.sha256) {
        throw new Error(`${path}: approved comparison render SHA does not match: ${render.path}`);
      }
    }
    const browserEvidenceSource = metadata.evidence?.browser_qa;
    if (browserEvidenceSource) {
      const browserEvidencePath = resolve(repoRoot, browserEvidenceSource);
      const browserEvidence = JSON.parse(await readFile(browserEvidencePath, 'utf8'));
      if (browserEvidence.status !== 'pass' || browserEvidence.acceptance?.p0_findings !== 0) {
        throw new Error(`${path}: production browser QA is not an explicit P0-clear pass`);
      }
      if (browserEvidence.release_build_id !== metadata.release_build_id
        || browserEvidence.opening_build_id !== metadata.components?.opening_3d?.build_id
        || browserEvidence.route_character_build_id !== metadata.components?.replaceable_characters?.build_id) {
        throw new Error(`${path}: production browser QA build IDs do not match the coordinated release`);
      }
      const expectedViewports = new Map([
        ['desktop', [1280, 720]],
        ['mobile-landscape', [844, 390]],
        ['mobile-portrait', [390, 844]],
      ]);
      const minimumTouchTarget = browserEvidence.acceptance?.minimum_touch_target_css_px;
      for (const viewport of browserEvidence.viewports ?? []) {
        const expected = expectedViewports.get(viewport.id);
        if (!expected || viewport.width !== expected[0] || viewport.height !== expected[1]) continue;
        if (viewport.canvas_count < 1
          || viewport.scroll_width !== viewport.width
          || viewport.horizontal_overflow !== false
          || viewport.console_errors !== 0
          || viewport.first_door_interaction !== 'pass') {
          throw new Error(`${path}: browser QA failed for ${viewport.id}`);
        }
        if (viewport.touch_hud === 'pass'
          && (!Number.isFinite(minimumTouchTarget)
            || viewport.minimum_measured_touch_target_css_px < minimumTouchTarget)) {
          throw new Error(`${path}: touch target contract failed for ${viewport.id}`);
        }
        expectedViewports.delete(viewport.id);
      }
      if (expectedViewports.size > 0) {
        throw new Error(`${path}: production browser QA is missing required viewports`);
      }
      for (const screenshot of browserEvidence.screenshots ?? []) {
        const screenshotPath = resolve(repoRoot, screenshot.path);
        const actualSha256 = createHash('sha256').update(await readFile(screenshotPath)).digest('hex');
        if (actualSha256 !== screenshot.sha256) {
          throw new Error(`${path}: browser QA screenshot SHA does not match: ${screenshot.path}`);
        }
      }
      if ((browserEvidence.screenshots ?? []).length < 6) {
        throw new Error(`${path}: production browser QA must preserve before and after screenshots for all viewports`);
      }
    }
    continue;
  }
  // Runtime source can legitimately implement an error branch.  Only its
  // literal production asset/status values are release metadata and are
  // therefore subject to this marker guard.
  const literals = [...content.matchAll(/(?:asset|delivery|release|review|quality|status)[A-Za-z_]*\s*[:=]\s*['"`]([^'"`]+)['"`]/g)].map((match) => match[1]);
  if (containsLastBellForbiddenDeliveryMarker(literals)) throw new Error(`${path}: prohibited runtime production metadata marker`);
}

console.log(JSON.stringify({ validation: 'pass', delivery, metadata: metadataArgs.map((source) => resolve(source)) }, null, 2));
