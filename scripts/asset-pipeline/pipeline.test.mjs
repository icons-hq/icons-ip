import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import yaml from 'js-yaml';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isOwnerStale,
  readProcessStartIdentity,
  runAssetPipeline,
} from './pipeline.mjs';

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
      referenceSources: [{
        id: 'netflix-season-1-stills',
        authority: 'official',
        url: 'https://about.netflix.com/ko/news/help-is-not-coming-all-of-us-are-dead-released-new-teaser-trailer-and-stills',
      }],
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
        identity: { mode: 'original' },
        referenceIds: ['netflix-season-1-stills'],
        promptBrief: 'player prompt', qa: commonQa,
      },
      {
        id: 'student_zombie_concept', label: 'zombie', kind: 'sprite',
        view: 'topdown-3q', size: '16x16', frames: 1, alpha: 'required',
        identity: { mode: 'original' },
        referenceIds: ['netflix-season-1-stills'],
        promptBrief: 'zombie prompt', qa: commonQa,
      },
      {
        id: 'cafeteria_background_concept', label: 'cafeteria', kind: 'background',
        view: 'orthogonal-topdown', size: '32x20', frames: 1, alpha: 'forbidden',
        identity: { mode: 'not-applicable' },
        referenceIds: ['netflix-season-1-stills'],
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

function passingVision(asset, value = 0.9, reviewedSha256 = '0'.repeat(64)) {
  const score = (applicable = true) => ({ applicable, score: value, notes: 'fixture pass' });
  return {
    assetId: asset.id,
    reviewedSha256,
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

async function passingOutputReview({ asset, outputSha256 }) {
  return passingVision(asset, 0.9, outputSha256);
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

async function createFixture(updateSpec) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'hyosan-pipeline-'));
  cleanups.push(() => rm(repositoryRoot, { recursive: true, force: true }));
  const specPath = join(repositoryRoot, 'asset-spec.yaml');
  const spec = fixtureSpec();
  updateSpec?.(spec);
  await writeFile(specPath, yaml.dump(spec), 'utf8');
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
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
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
    expect(result.manifest.provenance).toEqual({
      rightsScope: 'fixture',
      referenceSources: [{
        id: 'netflix-season-1-stills',
        authority: 'official',
        url: 'https://about.netflix.com/ko/news/help-is-not-coming-all-of-us-are-dead-released-new-teaser-trailer-and-stills',
      }],
    });
    expect(result.manifest.assets.every(({ referenceIds }) => (
      referenceIds.includes('netflix-season-1-stills')
    ))).toBe(true);
    expect(result.manifest.assets.every(({ selectedAttempt }) => selectedAttempt === 1)).toBe(true);
    expect(result.manifest.assets.every(({ output, visionQa }) => (
      output.sha256 === visionQa.reviewedSha256
    ))).toBe(true);
    expect(result.manifest.assets.every(({ candidateVisionQa }) => (
      typeof candidateVisionQa.reviewedSha256 === 'string'
    ))).toBe(true);
    expect(result.manifest.assets.every(({ technicalQa }) => (
      ['alpha', 'size', 'trim', 'frame', 'bbox', 'edges']
        .every((check) => check in technicalQa.checks)
    ))).toBe(true);
    expect(Object.keys(result.atlas.data.frames)).toEqual([
      'player_halfbie_concept',
      'student_zombie_concept',
    ]);
    const atlasData = await readFile(join(repositoryRoot, 'docs/output/atlas/fixture-atlas.json'));
    expect(result.manifest.atlas.dataSha256).toBe(
      createHash('sha256').update(atlasData).digest('hex'),
    );
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

  it('does not let a runner mutate validated thresholds or provenance', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const runner = {
      async plan(spec) {
        expect(Object.isFrozen(spec.assets[0].qa)).toBe(true);
        expect(Reflect.set(spec.assets[0].qa, 'minSourceFidelity', 0)).toBe(false);
        expect(Reflect.set(spec.meta, 'rightsScope', 'mutated rights')).toBe(false);
        expect(Reflect.set(
          spec.meta.referenceSources[0],
          'url',
          'https://evil.example/',
        )).toBe(false);
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    const result = await runAssetPipeline({ specPath, repositoryRoot, runner });

    expect(result.manifest.provenance.rightsScope).toBe('fixture');
    expect(result.manifest.provenance.referenceSources[0].url).toBe(
      'https://about.netflix.com/ko/news/help-is-not-coming-all-of-us-are-dead-released-new-teaser-trailer-and-stills',
    );
    expect(result.manifest.assets[0].visionQa.minimumSourceFidelity).toBe(0.85);
  });

  it('does not let a runner mutate pipeline-owned QA or reviewed hashes', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256, technicalQa }) {
        expect(Object.isFrozen(technicalQa)).toBe(true);
        expect(Reflect.set(technicalQa, 'sha256', 'f'.repeat(64))).toBe(false);
        return passingVision(asset, 0.9, candidateSha256);
      },
      async reviewOutput({ asset, outputSha256, candidateVisionQa }) {
        expect(Object.isFrozen(candidateVisionQa.guards.wrongSeasonElements)).toBe(true);
        expect(Reflect.set(
          candidateVisionQa.guards.wrongSeasonElements,
          'detected',
          true,
        )).toBe(false);
        return passingVision(asset, 0.9, outputSha256);
      },
    };

    const result = await runAssetPipeline({ specPath, repositoryRoot, runner });

    for (const asset of result.manifest.assets) {
      expect(asset.technicalQa.sha256).not.toBe('f'.repeat(64));
      expect(asset.candidateVisionQa.reviewedSha256).toBe(asset.technicalQa.sha256);
      expect(asset.candidateVisionQa.guards.wrongSeasonElements.detected).toBe(false);
      expect(asset.candidateVisionQa.passed).toBe(true);
    }
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
      async review({ asset, candidateSha256 }) {
        if (asset.id !== 'player_halfbie_concept') {
          return passingVision(asset, 0.9, candidateSha256);
        }
        const attempt = attempts.get(asset.id);
        const review = passingVision(
          asset,
          [0.99, 0.75, 0.7][attempt - 1],
          candidateSha256,
        );
        if (attempt === 1) {
          review.guards.wrongSeasonElements = {
            detected: true,
            confidence: 0.95,
            notes: 'contains season two costume elements',
          };
        }
        return review;
      },
      reviewOutput: passingOutputReview,
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
      async review({ asset, candidateSha256 }) {
        const review = passingVision(asset, 0.95, candidateSha256);
        if (asset.id === 'player_halfbie_concept' && attempts.get(asset.id) === 1) {
          review.dimensions.sourceFidelity = {
            applicable: true,
            score: 0.4,
            notes: 'uniform colors and insignia do not match the official season-one stills',
          };
        }
        return review;
      },
      reviewOutput: passingOutputReview,
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

  it('reviews normalized output only after a candidate clears the candidate quality gate', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const attemptsByCandidate = new Map();
    const outputReviewAttempts = [];
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, attempt, candidatePath }) {
        attemptsByCandidate.set(candidatePath, attempt);
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidatePath, candidateSha256 }) {
        const review = passingVision(asset, 0.9, candidateSha256);
        if (asset.id === 'cafeteria_background_concept'
          && attemptsByCandidate.get(candidatePath) === 1) {
          review.dimensions.sourceFidelity = {
            applicable: true,
            score: 0.2,
            notes: 'generic cafeteria, not the season-one Hyosan set',
          };
        }
        return review;
      },
      async reviewOutput({ asset, candidatePath, outputSha256 }) {
        if (asset.id === 'cafeteria_background_concept') {
          outputReviewAttempts.push(attemptsByCandidate.get(candidatePath));
        }
        return passingVision(asset, 0.9, outputSha256);
      },
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T03:30:00.000Z'),
    });

    const cafeteria = result.manifest.assets.find(
      ({ id }) => id === 'cafeteria_background_concept',
    );
    expect(cafeteria.selectedAttempt).toBe(2);
    expect(outputReviewAttempts).toEqual([2]);
  });

  it('requires performer identity independently for a canonical character', async () => {
    const { repositoryRoot, specPath } = await createFixture((spec) => {
      spec.assets[0].identity = {
        mode: 'canonical',
        character: '남라',
        performer: '조이현',
      };
      spec.assets[0].qa.minCharacterIdentity = 0.88;
    });
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
      async review({ asset, candidateSha256 }) {
        const result = passingVision(asset, 0.95, candidateSha256);
        if (asset.id === 'player_halfbie_concept' && attempts.get(asset.id) === 1) {
          result.dimensions.characterIdentity = {
            applicable: true,
            score: 0.4,
            notes: 'does not preserve the licensed performer identity',
          };
        }
        return result;
      },
      reviewOutput: passingOutputReview,
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T04:00:00.000Z'),
    });

    const player = result.manifest.assets.find(({ id }) => id === 'player_halfbie_concept');
    expect(player.selectedAttempt).toBe(2);
    expect(result.qaReport.assets[0].attempts[0].visionQa).toMatchObject({
      characterIdentityScore: 0.4,
      minimumCharacterIdentity: 0.88,
      passed: false,
    });
  });

  it('prefers season-one source fidelity over average score for a BEST fallback', async () => {
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
      async review({ asset, candidateSha256 }) {
        if (asset.id !== 'player_halfbie_concept') {
          return passingVision(asset, 0.9, candidateSha256);
        }
        const attempt = attempts.get(asset.id);
        if (attempt === 1) {
          const blocked = passingVision(asset, 0.99, candidateSha256);
          blocked.guards.wrongSeasonElements = {
            detected: true,
            confidence: 0.99,
            notes: 'wrong season',
          };
          return blocked;
        }
        const result = passingVision(
          asset,
          attempt === 2 ? 0.7 : 0.99,
          candidateSha256,
        );
        result.dimensions.sourceFidelity = {
          applicable: true,
          score: attempt === 2 ? 0.84 : 0.2,
          notes: attempt === 2 ? 'near the season-one threshold' : 'generic school design',
        };
        return result;
      },
      reviewOutput: passingOutputReview,
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T05:00:00.000Z'),
    });

    const player = result.manifest.assets.find(({ id }) => id === 'player_halfbie_concept');
    expect(player).toMatchObject({ selectedAttempt: 2, status: 'accepted-with-warning' });
  });

  it('ranks every safe candidate before accepting an earlier soft normalized output', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const attemptsByCandidate = new Map();
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, attempt, candidatePath }) {
        attemptsByCandidate.set(candidatePath, attempt);
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidatePath, candidateSha256 }) {
        if (asset.id !== 'player_halfbie_concept') {
          return passingVision(asset, 0.9, candidateSha256);
        }
        const attempt = attemptsByCandidate.get(candidatePath);
        if (attempt === 1) {
          const review = passingVision(asset, 0.9, candidateSha256);
          review.dimensions.sourceFidelity.score = 0.86;
          return review;
        }
        if (attempt === 2) {
          const review = passingVision(asset, 0.99, candidateSha256);
          review.dimensions.styleMatch.score = 0;
          return review;
        }
        return passingVision(asset, 0.7, candidateSha256);
      },
      async reviewOutput({ asset, candidatePath, outputSha256 }) {
        const review = passingVision(asset, 0.9, outputSha256);
        if (asset.id === 'player_halfbie_concept'
          && attemptsByCandidate.get(candidatePath) === 1) {
          review.dimensions.sourceFidelity.score = 0.4;
        }
        return review;
      },
    };

    const result = await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => new Date('2026-08-27T05:30:00.000Z'),
    });

    const player = result.manifest.assets.find(({ id }) => id === 'player_halfbie_concept');
    expect(player).toMatchObject({ selectedAttempt: 2, status: 'accepted-with-warning' });
  });

  it('invalidates a previous passing manifest before a regeneration can fail', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const passingRunner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };
    await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner: passingRunner,
      now: () => new Date('2026-08-27T06:00:00.000Z'),
    });

    await expect(runAssetPipeline({
      specPath,
      repositoryRoot,
      runner: {
        ...passingRunner,
        async generate() {
          throw new Error('fixture regeneration failed');
        },
      },
      now: () => new Date('2026-08-27T07:00:00.000Z'),
    })).rejects.toThrow('fixture regeneration failed');

    const persisted = JSON.parse(
      await readFile(join(repositoryRoot, 'docs/output/asset-manifest.json'), 'utf8'),
    );
    expect(persisted).toMatchObject({
      status: 'regeneration-in-progress',
      approvalGate: {
        status: 'blocked',
        blocks: ['M1', 'mass-production', 'phaser-integration'],
      },
    });
  });

  it('serializes runs that publish to the same output directory', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    let releaseFirstPlan;
    let announceFirstPlan;
    const firstPlanStarted = new Promise((resolve) => {
      announceFirstPlan = resolve;
    });
    const firstPlanGate = new Promise((resolve) => {
      releaseFirstPlan = resolve;
    });
    const passingRunner = {
      async plan(spec) {
        announceFirstPlan();
        await firstPlanGate;
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };
    const failingRunner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate() {
        throw new Error('newer queued regeneration failed');
      },
      async review() {},
      async reviewOutput() {},
    };

    const firstRun = runAssetPipeline({
      specPath,
      repositoryRoot,
      runner: passingRunner,
      now: () => new Date('2026-08-27T08:00:00.000Z'),
    });
    await firstPlanStarted;
    const secondOutcome = runAssetPipeline({
      specPath,
      repositoryRoot,
      runner: failingRunner,
      now: () => new Date('2026-08-27T08:00:01.000Z'),
    }).then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
    await delay(25);
    releaseFirstPlan();
    await firstRun;
    const { error } = await secondOutcome;

    expect(error).toMatchObject({ message: 'newer queued regeneration failed' });
    const persisted = JSON.parse(
      await readFile(join(repositoryRoot, 'docs/output/asset-manifest.json'), 'utf8'),
    );
    expect(persisted).toMatchObject({
      status: 'regeneration-in-progress',
      approvalGate: { status: 'blocked' },
    });
  });

  it('recovers an output lock whose owning process is no longer alive', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const outputDirectory = join(repositoryRoot, 'docs/output');
    const lockPath = join(outputDirectory, '.asset-pipeline.lock');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      purpose: 'asset-pipeline-output',
      token: 'orphaned-lock',
      hostname: hostname(),
      pid: 999_999_999,
      processStartedAt: '2000-01-01T00:00:00.000Z',
      processStartIdentity: 'Mon Jan 01 00:00:00 2000',
      acquiredAt: '2000-01-01T00:00:00.000Z',
    }), 'utf8');
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    const result = await runAssetPipeline({ specPath, repositoryRoot, runner });

    expect(result.manifest.status).toBe('pending-user-approval');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('recovers a dead-owner lock after its PID is reused by another live process', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const outputDirectory = join(repositoryRoot, 'docs/output');
    const lockPath = join(outputDirectory, '.asset-pipeline.lock');
    const oldTimestamp = new Date('2000-01-01T00:00:00.000Z');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      purpose: 'asset-pipeline-output',
      token: 'reused-live-pid-lock',
      hostname: hostname(),
      pid: process.ppid,
      processStartedAt: oldTimestamp.toISOString(),
      processStartIdentity: 'Mon Jan 01 00:00:00 2000',
      acquiredAt: oldTimestamp.toISOString(),
    }), 'utf8');
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    const result = await runAssetPipeline({ specPath, repositoryRoot, runner });

    expect(result.manifest.status).toBe('pending-user-approval');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('stops before shared publish when output-lock ownership changes mid-run', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const outputDirectory = join(repositoryRoot, 'docs/output');
    const lockPath = join(outputDirectory, '.asset-pipeline.lock');
    let replaced = false;
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        if (!replaced) {
          replaced = true;
          await rm(lockPath, { force: true });
          await writeFile(lockPath, JSON.stringify({
            schemaVersion: 1,
            purpose: 'asset-pipeline-output',
            token: 'replacement-owner',
            hostname: hostname(),
            pid: process.pid,
            processStartedAt: new Date().toISOString(),
            processStartIdentity: await readProcessStartIdentity(process.pid),
            acquiredAt: new Date().toISOString(),
          }), 'utf8');
        }
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    await expect(runAssetPipeline({ specPath, repositoryRoot, runner }))
      .rejects.toThrow('Lost asset pipeline lock ownership');

    const persisted = JSON.parse(
      await readFile(join(outputDirectory, 'asset-manifest.json'), 'utf8'),
    );
    const replacement = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(persisted).toMatchObject({
      status: 'regeneration-in-progress',
      approvalGate: { status: 'blocked' },
    });
    expect(replacement.token).toBe('replacement-owner');
    expect(existsSync(join(outputDirectory, 'selected/player_halfbie_concept.png'))).toBe(false);
  });

  it('uses a locale- and timezone-stable OS process identity', async () => {
    const originalLocale = process.env.LC_ALL;
    const originalTimezone = process.env.TZ;
    try {
      process.env.LC_ALL = 'ko_KR.UTF-8';
      process.env.TZ = 'Asia/Seoul';
      const localized = await readProcessStartIdentity(process.pid);
      process.env.LC_ALL = 'C';
      process.env.TZ = 'UTC';
      const canonical = await readProcessStartIdentity(process.pid);

      expect(localized).toBeTruthy();
      expect(localized).toBe(canonical);
    } finally {
      if (originalLocale === undefined) delete process.env.LC_ALL;
      else process.env.LC_ALL = originalLocale;
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('never auto-recovers malformed or legacy lock owner metadata', async () => {
    await expect(isOwnerStale({
      owner: {
        hostname: hostname(),
        pid: 999_999_999,
      },
    })).resolves.toBe(false);
    await expect(isOwnerStale({
      owner: {
        schemaVersion: 1,
        token: 'legacy-lock',
        hostname: hostname(),
        pid: 999_999_999,
        processStartedAt: '2000-01-01T00:00:00.000Z',
        acquiredAt: '2000-01-01T00:00:00.000Z',
      },
    })).resolves.toBe(false);
    await expect(isOwnerStale({
      owner: {
        schemaVersion: 1,
        purpose: 'asset-pipeline-output',
        token: 'non-canonical-timestamps',
        hostname: hostname(),
        pid: 999_999_999,
        processStartedAt: '0',
        processStartIdentity: 'Mon Jan 01 00:00:00 2000',
        acquiredAt: '2000-01-01',
      },
    })).resolves.toBe(false);
  });

  it('rejects a final normalized output that was not the image reviewed by vision QA', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      async reviewOutput({ asset }) {
        return passingVision(asset, 0.9, 'f'.repeat(64));
      },
    };

    await expect(runAssetPipeline({ specPath, repositoryRoot, runner }))
      .rejects.toThrow('normalized output SHA-256');
  });

  it('rejects missing hard guards and inapplicable required fidelity dimensions', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const baseRunner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      reviewOutput: passingOutputReview,
    };
    const missingGuardRunner = {
      ...baseRunner,
      async review({ asset, candidateSha256 }) {
        const review = passingVision(asset, 0.9, candidateSha256);
        delete review.guards.gore;
        return review;
      },
    };
    await expect(runAssetPipeline({ specPath, repositoryRoot, runner: missingGuardRunner }))
      .rejects.toThrow('guards.gore');

    const inapplicableRunner = {
      ...baseRunner,
      async review({ asset, candidateSha256 }) {
        const review = passingVision(asset, 0.9, candidateSha256);
        review.dimensions.sourceFidelity.applicable = false;
        return review;
      },
    };
    await expect(runAssetPipeline({ specPath, repositoryRoot, runner: inapplicableRunner }))
      .rejects.toThrow('sourceFidelity.applicable must be true');
  });

  it('rejects a repository-relative output path that resolves through an external symlink', async () => {
    const { repositoryRoot, specPath } = await createFixture((spec) => {
      spec.pipeline.outputDirectory = 'docs/output-link';
    });
    const externalDirectory = await mkdtemp(join(tmpdir(), 'hyosan-external-output-'));
    cleanups.push(() => rm(externalDirectory, { recursive: true, force: true }));
    await mkdir(join(repositoryRoot, 'docs'), { recursive: true });
    await symlink(externalDirectory, join(repositoryRoot, 'docs/output-link'));
    const runner = {
      async plan() {
        throw new Error('planner must not run');
      },
      async generate() {},
      async review() {},
      async reviewOutput() {},
    };

    await expect(runAssetPipeline({ specPath, repositoryRoot, runner }))
      .rejects.toThrow('pipeline.outputDirectory resolves outside the repository root');
    expect(existsSync(join(externalDirectory, 'asset-manifest.json'))).toBe(false);
  });

  it('rejects an output symlink that resolves back to the repository root', async () => {
    const { repositoryRoot, specPath } = await createFixture((spec) => {
      spec.pipeline.outputDirectory = 'root-link';
    });
    await symlink('.', join(repositoryRoot, 'root-link'));
    const runner = {
      async plan() {
        throw new Error('planner must not run');
      },
      async generate() {},
      async review() {},
      async reviewOutput() {},
    };

    await expect(runAssetPipeline({ specPath, repositoryRoot, runner }))
      .rejects.toThrow('pipeline.outputDirectory resolves to the repository root');
    expect(existsSync(join(repositoryRoot, 'asset-manifest.json'))).toBe(false);
  });

  it('publishes over an output-file symlink without modifying its external target', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const externalDirectory = await mkdtemp(join(tmpdir(), 'hyosan-external-file-'));
    cleanups.push(() => rm(externalDirectory, { recursive: true, force: true }));
    const externalFile = join(externalDirectory, 'victim.png');
    const selectedDirectory = join(repositoryRoot, 'docs/output/selected');
    const publishedFile = join(selectedDirectory, 'player_halfbie_concept.png');
    await mkdir(selectedDirectory, { recursive: true });
    await writeFile(externalFile, 'external-user-data', 'utf8');
    await symlink(externalFile, publishedFile);
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    await runAssetPipeline({ specPath, repositoryRoot, runner });

    expect(await readFile(externalFile, 'utf8')).toBe('external-user-data');
    expect((await lstat(publishedFile)).isSymbolicLink()).toBe(false);
  });

  it('does not follow a pre-created symlink at the manifest temporary-file path', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const externalDirectory = await mkdtemp(join(tmpdir(), 'hyosan-external-temp-'));
    cleanups.push(() => rm(externalDirectory, { recursive: true, force: true }));
    const outputDirectory = join(repositoryRoot, 'docs/output');
    const manifestPath = join(outputDirectory, 'asset-manifest.json');
    const predictableTemporaryPath = `${manifestPath}.${process.pid}.tmp`;
    const externalFile = join(externalDirectory, 'victim.json');
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(externalFile, 'external-user-data', 'utf8');
    await symlink(externalFile, predictableTemporaryPath);
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    await runAssetPipeline({ specPath, repositoryRoot, runner });

    expect(await readFile(externalFile, 'utf8')).toBe('external-user-data');
  });

  it('does not use a pre-created symlink at a predictable attempt directory', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const externalDirectory = await mkdtemp(join(tmpdir(), 'hyosan-external-attempt-'));
    cleanups.push(() => rm(externalDirectory, { recursive: true, force: true }));
    const generatedAt = new Date('2026-08-27T12:00:00.000Z');
    const oldPredictableRunId = generatedAt.toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const predictableAssetDirectory = join(
      repositoryRoot,
      'outputs/work/runs',
      oldPredictableRunId,
      'player_halfbie_concept',
    );
    await mkdir(predictableAssetDirectory, { recursive: true });
    await symlink(externalDirectory, join(predictableAssetDirectory, 'attempt-01'));
    const runner = {
      async plan(spec) {
        return {
          schemaVersion: 1,
          assets: spec.assets.map((asset) => ({ assetId: asset.id, prompt: asset.promptBrief })),
        };
      },
      async generate({ asset, candidatePath }) {
        await writeCandidate(candidatePath, asset);
        return { provider: 'fixture-generator', savedPath: candidatePath };
      },
      async review({ asset, candidateSha256 }) {
        return passingVision(asset, 0.9, candidateSha256);
      },
      reviewOutput: passingOutputReview,
    };

    await runAssetPipeline({
      specPath,
      repositoryRoot,
      runner,
      now: () => generatedAt,
    });

    expect(existsSync(join(externalDirectory, 'candidate.png'))).toBe(false);
    expect(existsSync(join(externalDirectory, 'technical-qa.json'))).toBe(false);
  });
});
