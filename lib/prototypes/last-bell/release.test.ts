import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAST_BELL_RELEASE_BUILD_ID } from './release';
import { LAST_BELL_NARRATIVE_BUILD_ID, LAST_BELL_ROOFTOP_ENDING_KO } from './narrative';

type ReleaseManifest = {
  release_build_id: string;
  runtime_contract: { chapters: string[]; collectibles: string[] };
  evidence: { browser_qa: string };
  status: { local_production_build_browser_qa: string };
  components: {
    opening_3d: { build_id: string; manifest: string };
    products: { build_id: string; manifest: string; manifest_sha256: string };
    replaceable_characters: { build_id: string; manifest: string };
    narrative: { build_id: string; review_status: string };
    [key: string]: { build_id: string; [key: string]: unknown };
  };
};

const manifest = JSON.parse(readFileSync(
  new URL('../../../docs/ip/all-of-us-are-dead-2/last-bell-release-manifest.json', import.meta.url),
  'utf8',
)) as ReleaseManifest;
const repoRoot = new URL('../../../', import.meta.url);
const openingMetadata = JSON.parse(readFileSync(new URL(manifest.components.opening_3d.manifest, repoRoot), 'utf8')) as { build_id: string };
const productManifestBuffer = readFileSync(new URL(manifest.components.products.manifest, repoRoot));
const productManifest = JSON.parse(productManifestBuffer.toString('utf8')) as { build_id: string };
const characterManifest = JSON.parse(readFileSync(new URL(manifest.components.replaceable_characters.manifest, repoRoot), 'utf8')) as { build_id: string };
const browserQa = JSON.parse(readFileSync(new URL(manifest.evidence.browser_qa, repoRoot), 'utf8')) as {
  status: string;
  release_build_id: string;
  opening_build_id: string;
  route_character_build_id: string;
  acceptance: { p0_findings: number; minimum_touch_target_css_px: number };
  viewports: Array<{
    id: string;
    width: number;
    height: number;
    horizontal_overflow: boolean;
    console_errors: number;
    first_door_interaction: string;
    minimum_measured_touch_target_css_px?: number;
  }>;
};
const qaReport = readFileSync(new URL('docs/ip/all-of-us-are-dead-2/qa-report.md', repoRoot), 'utf8');

describe('Last Bell coordinated release', () => {
  it('uses one release build id across manifest and replaceable dialogue data', () => {
    expect(manifest.release_build_id).toBe(LAST_BELL_RELEASE_BUILD_ID);
    expect(LAST_BELL_ROOFTOP_ENDING_KO.releaseBuildId).toBe(LAST_BELL_RELEASE_BUILD_ID);
    expect(manifest.components.narrative.build_id).toBe(LAST_BELL_NARRATIVE_BUILD_ID);
    expect(manifest.components.narrative.review_status).toBe('approved-external-ip-dialogue-review');
  });

  it('locks exactly two chapters and ten stable collectible keys', () => {
    expect(manifest.runtime_contract.chapters).toEqual(['chapter-01', 'chapter-02']);
    expect(manifest.runtime_contract.collectibles).toHaveLength(10);
    expect(new Set(manifest.runtime_contract.collectibles).size).toBe(10);
  });

  it('binds release components and QA evidence to the files actually shipped in this build', () => {
    expect(manifest.components.opening_3d.build_id).toBe(openingMetadata.build_id);
    expect(manifest.components.products.build_id).toBe(productManifest.build_id);
    expect(manifest.components.products.manifest_sha256).toBe(createHash('sha256').update(productManifestBuffer).digest('hex'));
    expect(manifest.components.replaceable_characters.build_id).toBe(characterManifest.build_id);

    expect(qaReport).toContain(manifest.release_build_id);
    expect(qaReport).toContain(openingMetadata.build_id);
    expect(qaReport).toContain(productManifest.build_id);
    expect(qaReport).toContain(characterManifest.build_id);
  });

  it('binds a P0-clear three-viewport production browser pass to this release', () => {
    expect(browserQa.status).toBe('pass');
    expect(browserQa.release_build_id).toBe(manifest.release_build_id);
    expect(browserQa.opening_build_id).toBe(manifest.components.opening_3d.build_id);
    expect(browserQa.route_character_build_id).toBe(manifest.components.replaceable_characters.build_id);
    expect(browserQa.acceptance.p0_findings).toBe(0);
    expect(browserQa.viewports.map(({ id, width, height }) => [id, width, height])).toEqual([
      ['desktop', 1280, 720],
      ['mobile-landscape', 844, 390],
      ['mobile-portrait', 390, 844],
    ]);
    for (const viewport of browserQa.viewports) {
      expect(viewport.horizontal_overflow).toBe(false);
      expect(viewport.console_errors).toBe(0);
      expect(viewport.first_door_interaction).toBe('pass');
      if (viewport.minimum_measured_touch_target_css_px !== undefined) {
        expect(viewport.minimum_measured_touch_target_css_px).toBeGreaterThanOrEqual(browserQa.acceptance.minimum_touch_target_css_px);
      }
    }
    expect(manifest.status.local_production_build_browser_qa).toContain('pass-three-viewports');
  });
});
