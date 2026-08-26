import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

function writeManifest(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'last-bell-product-release-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'manifest.json');
  const manifest = {
    build_id: 'last-bell-products-test',
    review_status: {
      automated_asset_contract: 'pass',
      visual_lookdev: 'human-review-asserted-for-release',
      ip_and_manufacturing: 'approved-for-matching-build',
      sales_activation: 'eligible-after-approved-release',
    },
    release_status: {
      status: 'approved-release-candidate',
      approval_evidence: {
        sha256: 'a'.repeat(64),
        delivery_build_id: 'last-bell-products-test',
        visual_review: 'approved',
        ip_and_manufacturing_review: 'approved',
      },
    },
    products: [{ delivery: { status: 'public-release-candidate' } }],
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(manifest));
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Last Bell product release guard', () => {
  it('passes only a build-matched visual and IP/manufacturing approval record', () => {
    const path = writeManifest();
    expect(() => execFileSync(process.execPath, [new URL('./release-guard.mjs', import.meta.url).pathname, path])).not.toThrow();
  });

  it('rejects a stage manifest even when its automated asset contract passed', () => {
    const path = writeManifest({
      review_status: {
        automated_asset_contract: 'pass',
        visual_lookdev: 'blocked-human-art-review-required',
        ip_and_manufacturing: 'pending-required-before-sales-activation',
        sales_activation: 'disabled-pending-ip-and-manufacturing-review',
      },
      release_status: { status: 'blocked' },
      products: [{ delivery: { status: 'private-stage-not-for-runtime-release' } }],
    });
    expect(() => execFileSync(process.execPath, [new URL('./release-guard.mjs', import.meta.url).pathname, path], { stdio: 'pipe' })).toThrow();
  });

  it('rejects underscore-separated placeholder markers in otherwise approved metadata', () => {
    const path = writeManifest({ quality_marker: 'non_likeness_placeholder' });
    expect(() => execFileSync(process.execPath, [new URL('./release-guard.mjs', import.meta.url).pathname, path], { stdio: 'pipe' })).toThrow('release manifest retains a prohibited delivery-quality marker');
  });

  it('permits a root-reviewed in-game delivery while retaining P1 and disabled sales', () => {
    const path = writeManifest({
      review_status: {
        automated_asset_contract: 'pass',
        visual_lookdev: 'root-review-approved-for-in-game-delivery',
        ip_and_manufacturing: 'p1-final-graphics-and-manufacturing-pending',
        sales_activation: 'disabled-pending-ip-and-manufacturing-review',
      },
      release_status: {
        status: 'public-in-game-delivery-approved-p1',
        scope: 'in-game-collectibles-only; not a sales or manufacturing release',
        sales_activation: 'disabled',
        review_evidence: {
          sha256: 'b'.repeat(64),
          delivery_build_id: 'last-bell-products-test',
          visual_review: 'approved-for-in-game-delivery',
          ip_and_manufacturing_review: 'p1-pending',
          sales_activation: 'disabled',
        },
      },
      products: [{ delivery: { status: 'public-in-game-delivery-p1-sales-disabled' } }],
    });
    expect(() => execFileSync(process.execPath, [new URL('./release-guard.mjs', import.meta.url).pathname, path])).not.toThrow();
  });

  it('rejects a public in-game manifest that would enable sales', () => {
    const path = writeManifest({
      review_status: {
        automated_asset_contract: 'pass',
        visual_lookdev: 'root-review-approved-for-in-game-delivery',
        ip_and_manufacturing: 'p1-final-graphics-and-manufacturing-pending',
        sales_activation: 'eligible-after-approved-release',
      },
      release_status: {
        status: 'public-in-game-delivery-approved-p1',
        scope: 'in-game-collectibles-only; not a sales or manufacturing release',
        sales_activation: 'enabled',
        review_evidence: {
          sha256: 'b'.repeat(64),
          delivery_build_id: 'last-bell-products-test',
          visual_review: 'approved-for-in-game-delivery',
          ip_and_manufacturing_review: 'p1-pending',
          sales_activation: 'disabled',
        },
      },
      products: [{ delivery: { status: 'public-in-game-delivery-p1-sales-disabled' } }],
    });
    expect(() => execFileSync(process.execPath, [new URL('./release-guard.mjs', import.meta.url).pathname, path], { stdio: 'pipe' })).toThrow();
  });
});
