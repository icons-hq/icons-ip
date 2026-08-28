import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runDirectAssetPipeline } from './index.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('direct asset pipeline entrypoint', () => {
  it('invalidates the spec-declared manifest before parsing a direct session', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'hyosan-index-'));
    cleanups.push(() => rm(repositoryRoot, { recursive: true, force: true }));
    const publishedOutputDirectory = join(repositoryRoot, 'docs/custom-output');
    const inputDirectory = join(repositoryRoot, 'outputs/direct-input');
    const sessionPath = join(repositoryRoot, 'outputs/direct-session.json');
    const specPath = join(repositoryRoot, 'asset-spec.yaml');
    await mkdir(publishedOutputDirectory, { recursive: true });
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(specPath, JSON.stringify({
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
        maxAttempts: 1,
        planner: 'fixture-planner',
        generator: 'fixture-generator',
        visionQa: 'fixture-vision',
        workDirectory: 'outputs/work',
        outputDirectory: 'docs/custom-output',
        atlas: { name: 'fixture-atlas', padding: 2 },
      },
      assets: [{
        id: 'player',
        label: 'player',
        kind: 'sprite',
        view: 'topdown-3q',
        size: '16x16',
        frames: 1,
        alpha: 'required',
        identity: { mode: 'original' },
        referenceIds: ['netflix-season-1-stills'],
        promptBrief: 'player prompt',
        qa: {
          minScore: 0.8,
          minSourceFidelity: 0.85,
          minSourceSize: '16x16',
          maxOpaqueEdgeRatio: 0,
          minBboxCoverage: 0.05,
          maxBboxCoverage: 0.8,
        },
      }],
    }), 'utf8');
    await writeFile(join(publishedOutputDirectory, 'asset-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      status: 'pending-user-approval',
      approvalGate: { status: 'pending' },
    }), 'utf8');
    await writeFile(sessionPath, '{ invalid json', 'utf8');

    await expect(runDirectAssetPipeline({
      repositoryRoot,
      specPath,
      inputDirectory,
      sessionPath,
    })).rejects.toThrow();

    const manifest = JSON.parse(
      await readFile(join(publishedOutputDirectory, 'asset-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      status: 'regeneration-in-progress',
      approvalGate: { status: 'blocked' },
    });
  });
});
