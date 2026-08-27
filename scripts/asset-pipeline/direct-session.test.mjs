import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDirectSessionRunner } from './direct-session.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function review(assetId) {
  const dimension = { applicable: true, score: 0.9, notes: 'direct review' };
  return {
    assetId,
    dimensions: {
      sourceFidelity: dimension,
      styleMatch: dimension,
      characterIdentity: dimension,
      topdownAngle: dimension,
      gameplayReadability: dimension,
      animationConsistency: { ...dimension, applicable: false },
    },
    guards: {
      gore: { detected: false, confidence: 0, notes: 'bloodless' },
      webtoonElements: { detected: false, confidence: 0, notes: 'not present' },
      wrongSeasonElements: { detected: false, confidence: 0, notes: 'season one' },
    },
    feedback: [],
  };
}

describe('direct Codex app session runner', () => {
  it('ingests only declared app-generated candidates and their direct vision reviews', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const candidatePath = join(inputDirectory, 'player.png');
    const sessionPath = join(directory, 'direct-session.json');
    const outputPath = join(directory, 'candidate.png');
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(candidatePath, Buffer.from('fixture-image'));
    await writeFile(sessionPath, JSON.stringify({
      schemaVersion: 1,
      generator: 'codex-app-built-in-imagegen',
      assets: [{
        assetId: 'player',
        prompt: 'direct app prompt',
        attempts: [{
          attempt: 1,
          prompt: 'exact direct app attempt prompt',
          technicalTransform: 'checkerboard-matte-to-alpha',
          candidate: 'player.png',
          visionQa: review('player'),
        }],
      }],
    }), 'utf8');
    const runner = await createDirectSessionRunner({ inputDirectory, sessionPath });
    const asset = { id: 'player' };

    const plan = await runner.plan({ assets: [asset] });
    const generation = await runner.generate({ asset, attempt: 1, candidatePath: outputPath });
    const vision = await runner.review({ asset, candidatePath: outputPath });

    expect(plan.assets).toEqual([{ assetId: 'player', prompt: 'direct app prompt' }]);
    expect(generation).toMatchObject({
      provider: 'codex-app-built-in-imagegen',
      mode: 'direct-app-session',
      prompt: 'exact direct app attempt prompt',
      technicalTransform: 'checkerboard-matte-to-alpha',
      savedPath: outputPath,
    });
    expect(vision).toEqual(review('player'));
  });
});
