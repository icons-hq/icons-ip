import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const script = new URL('./update-manifest.mjs', import.meta.url).pathname;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'last-bell-route-manifest-'));
  temporaryDirectories.push(directory);
  const reportPath = join(directory, 'report.json');
  const destinationPath = join(directory, 'manifest.json');
  const evidencePath = join(directory, 'evidence.json');
  const reviewDirectory = join(directory, 'review');
  const gameplayRenderPath = join(reviewDirectory, 'gameplay-camera.png');
  const playerDistanceRenderPath = join(reviewDirectory, 'player-distance.png');
  mkdirSync(reviewDirectory);
  writeFileSync(gameplayRenderPath, 'same-camera-gameplay-render');
  writeFileSync(playerDistanceRenderPath, 'same-camera-player-distance-render');
  const gameplayRenderSha256 = createHash('sha256').update(readFileSync(gameplayRenderPath)).digest('hex');
  const playerDistanceRenderSha256 = createHash('sha256').update(readFileSync(playerDistanceRenderPath)).digest('hex');
  const assets = [
    { kind: 'route', key: 'corridor', sha256: 'a'.repeat(64), bytes: 1, world_contract: {} },
    {
      kind: 'character',
      key: 'zombie-student',
      sha256: 'b'.repeat(64),
      bytes: 1,
      animations: ['Patrol', 'Investigate', 'Search', 'Chase', 'Capture'],
    },
    {
      kind: 'character',
      key: 'namra-rooftop',
      sha256: 'c'.repeat(64),
      bytes: 1,
      animations: ['Idle_Rooftop', 'Detect_Threat', 'Dash_Forward', 'Restrain'],
    },
  ];
  writeFileSync(reportPath, JSON.stringify({
    build_id: 'last-bell-route-test',
    assets,
    delivery_failure_policy: 'fail-closed',
    transfer: { bytes: 3, mib: 0.001 },
    world_contract: {},
  }));
  writeFileSync(evidencePath, JSON.stringify({
    status: 'approved-human-art-review',
    external_ip_approval: 'approved-external-ip-review',
    reviewer_type: 'human',
    reviewer_id: 'human-art-reviewer',
    reviewed_at: '2026-08-26T12:00:00+09:00',
    reviewed_build_id: 'last-bell-route-test',
    p0_findings: 0,
    comparison_renders: [
      { path: 'review/gameplay-camera.png', sha256: gameplayRenderSha256, camera_contract: { camera_id: 'gameplay-camera', fov_degrees: 62, exposure: 1, width: 1280, height: 720 } },
      { path: 'review/player-distance.png', sha256: playerDistanceRenderSha256, camera_contract: { camera_id: 'player-distance', fov_degrees: 62, exposure: 1, width: 1280, height: 720 } },
    ],
    comparisons: assets.map((asset) => ({
      key: asset.key,
      delivery_sha256: asset.sha256,
      rendered_delivery_sha256: asset.sha256,
      frame: { mean_channel_stdev: 12, channel_range: 96 },
    })),
  }));
  return { reportPath, destinationPath, evidencePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Last Bell route and character manifest promotion', () => {
  it('keeps an automated-only build blocked', () => {
    const { reportPath, destinationPath } = fixture();
    execFileSync(process.execPath, [script, reportPath, destinationPath]);
    const manifest = JSON.parse(readFileSync(destinationPath, 'utf8'));
    expect(manifest.no_clay_primitive_final).toBe(false);
    expect(manifest.visual_review.status).toBe('blocked-human-art-review-required');
    expect(manifest.zombie_common_rig.review_status).toContain('non-likeness');
  });

  it('emits final status only for build-matched human and external approval evidence', () => {
    const { reportPath, destinationPath, evidencePath } = fixture();
    execFileSync(process.execPath, [script, reportPath, destinationPath, evidencePath]);
    const manifest = JSON.parse(readFileSync(destinationPath, 'utf8'));
    expect(manifest.no_clay_primitive_final).toBe(true);
    expect(manifest.visual_review.status).toBe('approved-human-art-review');
    expect(manifest.visual_review.evidence.p0_findings).toBe(0);
    expect(manifest.zombie_common_rig.review_status).toContain('approved authored');
    expect(manifest.namra_rooftop.review_status).toContain('approved authored');
    expect(JSON.stringify(manifest)).not.toMatch(/non[-_]likeness|placeholder|pending[_-]approved/i);
  });

  it('rejects evidence rendered from a different delivery hash', () => {
    const { reportPath, destinationPath, evidencePath } = fixture();
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.comparisons[0].rendered_delivery_sha256 = 'f'.repeat(64);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    expect(() => execFileSync(process.execPath, [script, reportPath, destinationPath, evidencePath], { stdio: 'pipe' }))
      .toThrow('Visual-review evidence delivery SHA does not match');
  });

  it('rejects human approval recorded for a different build id', () => {
    const { reportPath, destinationPath, evidencePath } = fixture();
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.reviewed_build_id = 'last-bell-route-stale';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    expect(() => execFileSync(process.execPath, [script, reportPath, destinationPath, evidencePath], { stdio: 'pipe' }))
      .toThrow('visual asset approval was recorded for a different build');
  });

  it('rejects missing or stale comparison render files', () => {
    const { reportPath, destinationPath, evidencePath } = fixture();
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.comparison_renders[0].sha256 = 'f'.repeat(64);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    expect(() => execFileSync(process.execPath, [script, reportPath, destinationPath, evidencePath], { stdio: 'pipe' }))
      .toThrow('comparison render SHA does not match');

    evidence.comparison_renders[0].path = 'review/missing.png';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    expect(() => execFileSync(process.execPath, [script, reportPath, destinationPath, evidencePath], { stdio: 'pipe' }))
      .toThrow('comparison render is missing');
  });
});
