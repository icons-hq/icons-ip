import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDirectSessionRunner } from './direct-session.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function review(assetId, reviewedSha256) {
  const dimension = { applicable: true, score: 0.9, notes: 'direct review' };
  return {
    assetId,
    reviewedSha256,
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
    const candidateSha256 = await sha256(candidatePath);
    await writeFile(sessionPath, JSON.stringify({
      schemaVersion: 1,
      generator: 'codex-app-built-in-imagegen',
      assets: [{
        assetId: 'player',
        prompt: 'direct app prompt',
        attempts: [{
          attempt: 1,
          prompt: 'exact direct app attempt prompt',
          technicalTransform: 'magenta-matte-to-alpha',
          candidate: 'player.png',
          candidateSha256,
          visionQa: review('player', candidateSha256),
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
      technicalTransform: 'magenta-matte-to-alpha',
      candidateSha256,
      sourceFile: 'player.png',
      savedPath: outputPath,
    });
    expect(vision).toEqual(review('player', candidateSha256));
  });

  it('rejects a candidate when its bytes no longer match the direct vision review', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-hash-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const candidatePath = join(inputDirectory, 'player.png');
    const sessionPath = join(directory, 'direct-session.json');
    const outputPath = join(directory, 'candidate.png');
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(candidatePath, Buffer.from('reviewed-image'));
    const candidateSha256 = await sha256(candidatePath);
    await writeFile(sessionPath, JSON.stringify({
      schemaVersion: 1,
      generator: 'codex-app-built-in-imagegen',
      assets: [{
        assetId: 'player',
        prompt: 'direct app prompt',
        attempts: [{
          attempt: 1,
          prompt: 'exact direct app attempt prompt',
          candidate: 'player.png',
          candidateSha256,
          visionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');
    const runner = await createDirectSessionRunner({ inputDirectory, sessionPath });
    const asset = { id: 'player' };

    await runner.generate({ asset, attempt: 1, candidatePath: outputPath });
    await writeFile(outputPath, Buffer.from('unreviewed-replacement'));

    await expect(runner.review({ asset, candidatePath: outputPath }))
      .rejects.toThrow('reviewed SHA-256');
  });
});
