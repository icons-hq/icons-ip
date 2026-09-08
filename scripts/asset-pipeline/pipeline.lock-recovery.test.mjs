import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import yaml from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readProcessStartIdentity, runAssetPipeline } from './pipeline.mjs';

// 다른 실행이 lock을 해제하는 순간과 recovery 읽기가 겹치는 경합을 결정적으로 재현한다.
// lock 파일의 존재 확인(lstat)은 통과했지만 내용 읽기(readFile) 직전에 파일이 사라진 상황이다.
const lockRace = vi.hoisted(() => ({ vanishOnNextLockRead: false, vanished: 0 }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    async readFile(path, ...rest) {
      if (lockRace.vanishOnNextLockRead && String(path).endsWith('.asset-pipeline.lock')) {
        lockRace.vanishOnNextLockRead = false;
        lockRace.vanished += 1;
        await actual.rm(path, { force: true });
      }
      return actual.readFile(path, ...rest);
    },
  };
});

const cleanups = [];

afterEach(async () => {
  lockRace.vanishOnNextLockRead = false;
  lockRace.vanished = 0;
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function fixtureSpec() {
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
    assets: [{
      id: 'player_halfbie_concept', label: 'player', kind: 'sprite',
      view: 'topdown-3q', size: '16x16', frames: 1, alpha: 'required',
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
  };
}

async function createFixture() {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'hyosan-pipeline-lock-'));
  cleanups.push(() => rm(repositoryRoot, { recursive: true, force: true }));
  const specPath = join(repositoryRoot, 'asset-spec.yaml');
  await writeFile(specPath, yaml.dump(fixtureSpec()), 'utf8');
  return { repositoryRoot, specPath };
}

describe('asset pipeline output lock recovery', () => {
  it('retries instead of surfacing ENOENT when a lock vanishes between its existence check and read', async () => {
    const { repositoryRoot, specPath } = await createFixture();
    const outputDirectory = join(repositoryRoot, 'docs/output');
    const lockPath = join(outputDirectory, '.asset-pipeline.lock');
    await mkdir(outputDirectory, { recursive: true });
    // 살아 있는 소유자의 lock은 첫 acquire를 EEXIST로 막아 recovery 읽기 경로로 보낸다.
    // 그 소유자가 정상 종료로 lock을 해제하는 순간을 위 readFile 가로채기가 재현한다.
    const acquiredAt = new Date().toISOString();
    await writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      purpose: 'asset-pipeline-output',
      token: 'live-owner-about-to-release',
      hostname: hostname(),
      pid: process.pid,
      processStartedAt: acquiredAt,
      processStartIdentity: await readProcessStartIdentity(process.pid),
      acquiredAt,
    }), 'utf8');
    const runner = {
      async plan() {
        throw new Error('fixture plan reached under the lock');
      },
      async generate() {},
      async review() {},
      async reviewOutput() {},
    };

    lockRace.vanishOnNextLockRead = true;
    await expect(runAssetPipeline({ specPath, repositoryRoot, runner }))
      .rejects.toThrow('fixture plan reached under the lock');

    expect(lockRace.vanished).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(`${lockPath}.recovery`)).toBe(false);
    const persisted = JSON.parse(
      await readFile(join(outputDirectory, 'asset-manifest.json'), 'utf8'),
    );
    expect(persisted).toMatchObject({
      status: 'regeneration-in-progress',
      approvalGate: { status: 'blocked' },
    });
  });
});
