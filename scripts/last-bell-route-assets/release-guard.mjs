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

function pngDimensions(bytes, source) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${source}: browser QA evidence is not a valid PNG`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
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
    const verifiedStoreEvidenceSource = metadata.evidence?.verified_store_browser_qa;
    if (verifiedStoreEvidenceSource) {
      const verifiedStoreEvidencePath = resolve(repoRoot, verifiedStoreEvidenceSource);
      const verifiedStoreEvidence = JSON.parse(await readFile(verifiedStoreEvidencePath, 'utf8'));
      const acceptance = verifiedStoreEvidence.acceptance;
      const generatedGate = acceptance?.generated_reference_environment_gate;
      if (verifiedStoreEvidence.status !== 'pass'
        || verifiedStoreEvidence.release_build_id !== metadata.release_build_id
        || verifiedStoreEvidence.environment?.production_build !== true
        || new URL(verifiedStoreEvidence.route).pathname !== metadata.runtime_contract?.verified_store_route
        || acceptance?.p0_findings !== 0
        || acceptance?.product_cards !== 10
        || acceptance?.loaded_images !== 11
        || acceptance?.broken_images !== 0
        || acceptance?.console_errors !== 0
        || acceptance?.minimum_measured_interactive_target_css_px < 44
        || generatedGate?.status !== 'passed-automated-environment-design-quality'
        || generatedGate?.checks_passed !== generatedGate?.checks_total
        || generatedGate?.checks_total < 6) {
        throw new Error(`${path}: verified store browser/design QA is not an explicit contract-complete pass`);
      }

      const expectedViewports = new Map([
        ['desktop', { width: 1280, height: 720, columns: 4, screenshots: 0 }],
        ['mobile-landscape', { width: 844, height: 390, columns: 2, screenshots: 0 }],
        ['mobile-portrait', { width: 390, height: 844, columns: 2, screenshots: 0 }],
      ]);
      for (const viewport of verifiedStoreEvidence.viewports ?? []) {
        const expected = expectedViewports.get(viewport.id);
        if (!expected) continue;
        if (viewport.width !== expected.width
          || viewport.height !== expected.height
          || viewport.document_client_width > expected.width
          || viewport.document_scroll_width !== viewport.document_client_width
          || viewport.document_scroll_height <= expected.height
          || viewport.product_grid_columns !== expected.columns
          || viewport.product_cards !== 10
          || viewport.loaded_images !== 11
          || viewport.horizontal_overflow !== false
          || viewport.broken_images !== 0
          || viewport.console_errors !== 0
          || viewport.minimum_measured_interactive_target_css_px < 44) {
          throw new Error(`${path}: verified store browser QA failed for ${viewport.id}`);
        }
        expected.validated = true;
      }
      if ([...expectedViewports.values()].some((viewport) => viewport.validated !== true)) {
        throw new Error(`${path}: verified store browser QA is missing required viewports`);
      }

      for (const screenshot of verifiedStoreEvidence.screenshots ?? []) {
        const screenshotPath = resolve(repoRoot, screenshot.path);
        const bytes = await readFile(screenshotPath);
        const actualSha256 = createHash('sha256').update(bytes).digest('hex');
        if (actualSha256 !== screenshot.sha256) {
          throw new Error(`${path}: verified store screenshot SHA does not match: ${screenshot.path}`);
        }
        const [width, height] = pngDimensions(bytes, screenshot.path);
        const viewport = [...expectedViewports.values()].find((candidate) => (
          candidate.width === width && candidate.height === height
        ));
        if (!viewport) {
          throw new Error(`${path}: verified store screenshot has an unexpected viewport: ${screenshot.path}`);
        }
        viewport.screenshots += 1;
      }
      if ([...expectedViewports.values()].some((viewport) => viewport.screenshots < 2)) {
        throw new Error(`${path}: verified store QA must preserve two screenshots for every viewport`);
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
