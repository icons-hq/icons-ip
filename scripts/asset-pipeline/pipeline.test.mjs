import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import yaml from 'js-yaml';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { runAssetPipeline } from './pipeline.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function fixtureSpec() {
  const commonQa = {
    minScore: 0.8,
    minSourceFidelity: 0.85,
    minSourceSize: '16x16',
    maxOpaqueEdgeRatio: 0,
    minBboxCoverage: 0.05,
    maxBboxCoverage: 0.8,
  };
  return {
    schemaVersion: 1,
    meta: {
      project: 'hyosan-fixture',
      milestone: 'M0',
      styleRef: 'fixture dramatic school',
      rightsScope: 'fixture',
      fidelityTargets: [
        'season-1-production-design',
        'canonical-actor-likeness',
        'uniform-costume-continuity',
      ],
      forbidden: ['gore', 'webtoon-elements', 'wrong-season-elements'],
    },
    pipeline: {
      maxAttempts: 3,
      planner: 'fixture-planner',
      generator: 'fixture-generator',
      visionQa: 'fixture-vision',
      workDirectory: 'outputs/work',
      outputDirectory: 'docs/output',
      atlas: { name: 'fixture-atlas', padding: 2 },
    },
    assets: [
      {
        id: 'player_halfbie_concept', label: 'player', kind: 'sprite',
        view: 'topdown-3q', size: '16x16', frames: 1, alpha: 'required',
        promptBrief: 'player prompt', qa: commonQa,
      },
      {
        id: 'student_zombie_concept', label: 'zombie', kind: 'sprite',
        view: 'topdown-3q', size: '16x16', frames: 1, alpha: 'required',
        promptBrief: 'zombie prompt', qa: commonQa,
      },
      {
        id: 'cafeteria_background_concept', label: 'cafeteria', kind: 'background',
        view: 'orthogonal-topdown', size: '32x20', frames: 1, alpha: 'forbidden',
        promptBrief: 'background prompt',
        qa: {
          ...commonQa,
          maxOpaqueEdgeRatio: 1,
          minBboxCoverage: 1,
          maxBboxCoverage: 1,
        },
      },
    ],
  };
}

function passingVision(asset, value = 0.9) {
  const score = (applicable = true) => ({ applicable, score: value, notes: 'fixture pass' });
  return {
    assetId: asset.id,
    dimensions: {
      sourceFidelity: score(),
      styleMatch: score(),
      characterIdentity: score(asset.kind === 'sprite'),
      topdownAngle: score(),
      gameplayReadability: score(),
      animationConsistency: score(asset.frames > 1),
    },
    guards: {
      gore: { detected: false, confidence: 0.01, notes: 'bloodless' },
      webtoonElements: { detected: false, confidence: 0.01, notes: 'drama realism' },
      wrongSeasonElements: { detected: false, confidence: 0.01, notes: 'season one only' },
    },
    feedback: [],
  };
}

async function writeCandidate(path, asset) {
  if (asset.kind === 'background') {
    await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 20, g: 30, b: 40 },
      },
    }).png().toFile(path);
    return;
  }
  await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{
    input: {
      create: {
        width: 8,
        height: 12,
        channels: 4,
        background: { r: 80, g: 100, b: 120, alpha: 1 },
      },
    },
    left: 6,
    top: 4,
  }]).png().toFile(path);
}

async function createFixture() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'hyosan-pipeline-'));
  cleanups.push(() => rm(repositoryRoot, { recursive: true, force: true }));
  const specPath = join(repositoryRoot, 'asset-spec.yaml');
  await writeFile(specPath, yaml.dump(fixtureSpec()), 'utf8');
  return { repositoryRoot, specPath };
}

describe('asset pipeline', () => {
  it('takes all three M0 concepts through QA, normalization, atlas, and manifest', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    let planCalls = 0;
    const runner = {
      async plan(spec) {
        planCalls += 1;
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({
            assetId: asset.id,
            prompt: `${spec.meta.styleRef}: ${asset.promptBrief}`,
          })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset }) {
        return passingVision(asset);
      },
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T01:00:00.000Z'),
    });

    expect(planCalls).toBe(1);
    expect(result.manifest.status).toBe('pending-user-approval');
    expect(result.manifest.assets).toHaveLength(3);
    expect(result.manifest.assets.every(({ selectedAttempt }) => selectedAttempt === 1)).toBe(true);
    expect(result.manifest.assets.every(({ technicalQa }) => (
      ['alpha', 'size', 'trim', 'frame', 'bbox', 'edges']
        .every((check) => check in technicalQa.checks)
    ))).toBe(true);
    expect(Object.keys(result.atlas.data.frames)).toEqual([
      'player_halfbie_concept',
      'student_zombie_concept',
    ]);
    expect(existsSync(join(repositoryRoot, 'docs/output/selected/cafeteria_background_concept.png')))
      .toBe(true);
    expect(existsSync(join(repositoryRoot, 'docs/output/asset-manifest.json'))).toBe(true);
    expect(existsSync(join(repositoryRoot, 'docs/output/qa-report.json'))).toBe(true);
    const persisted = JSON.parse(
      await readFile(join(repositoryRoot, 'docs/output/asset-manifest.json'), 'utf8'),
    );
    expect(persisted.approvalGate).toEqual({
      status: 'pending',
      blocks: ['M1', 'mass-production', 'phaser-integration'],
    });
    expect(JSON.stringify(persisted)).not.toContain(repositoryRoot);
  });

  it('never promotes a wrong-season candidate and records BEST fallback after three soft failures', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const attempts = new Map();
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, attempt, candidatePath }) {
        attempts.set(asset.id, attempt);
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset }) {
        if (asset.id !== 'player_halfbie_concept') return passingVision(asset);
        const attempt = attempts.get(asset.id);
        const review = passingVision(asset, [0.99, 0.75, 0.7][attempt - 1]);
        if (attempt === 1) {
          review.guards.wrongSeasonElements = {
            detected: true,
            confidence: 0.95,
            notes: 'contains season two costume elements',
          };
        }
        return review;
      },
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T02:00:00.000Z'),
    });

    const player = result.manifest.assets.find(({ id }) => id === 'player_halfbie_concept');
    expect(player).toMatchObject({
      selectedAttempt: 2,
      status: 'accepted-with-warning',
    });
    expect(player.warning).toContain('BEST eligible candidate');
    expect(result.qaReport.summary).toMatchObject({ passed: 2, acceptedWithWarning: 1 });
    expect(result.qaReport.assets[0].attempts).toHaveLength(3);
    expect(result.qaReport.assets[0].attempts[0].visionQa.hardFailures)
      .toContain('wrongSeasonElements');
  });

  it('requires source fidelity even when the averaged vision score passes', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const attempts = new Map();
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, attempt, candidatePath }) {
        attempts.set(asset.id, attempt);
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset }) {
        const review = passingVision(asset, 0.95);
        if (asset.id === 'player_halfbie_concept' && attempts.get(asset.id) === 1) {
          review.dimensions.sourceFidelity = {
            applicable: true,
            score: 0.4,
            notes: 'uniform colors and insignia do not match the official season-one stills',
          };
        }
        return review;
      },
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T03:00:00.000Z'),
    });

    const player = result.manifest.assets.find(({ id }) => id === 'player_halfbie_concept');
    expect(player.selectedAttempt).toBe(2);
    expect(result.qaReport.assets[0].attempts[0].visionQa).toMatchObject({
      sourceFidelityScore: 0.4,
      minimumSourceFidelity: 0.85,
      passed: false,
    });
  });
});
