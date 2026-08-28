import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDirectSessionRunner } from './direct-session.mjs';
import { validateVisionQaShape } from './vision-qa.mjs';

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
  it('fails closed when the session contains invalid UTF-8 bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-utf8-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const sessionPath = join(directory, 'direct-session.json');
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(sessionPath, Buffer.concat([
      Buffer.from('{"schemaVersion":1,"generator":"codex-app-built-in-imagegen","assets":[{"assetId":"player","prompt":"'),
      Buffer.from([0xff]),
      Buffer.from('","attempts":[]}]}'),
    ]));

    await expect(createDirectSessionRunner({
      repositoryRoot: directory,
      inputDirectory,
      sessionPath,
    })).rejects.toThrow('direct imagegen session must be valid UTF-8');
  });

  it('ingests only declared app-generated candidates and their direct vision reviews', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const candidatePath = join(inputDirectory, 'player.png');
    const sessionPath = join(directory, 'direct-session.json');
    const outputPath = join(directory, 'candidate.png');
    const normalizedPath = join(directory, 'normalized.png');
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
          technicalTransform: 'magenta-matte-to-alpha-and-regrid',
          candidate: 'player.png',
          candidateSha256,
          visionQa: review('player', candidateSha256),
          outputVisionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');
    const runner = await createDirectSessionRunner({
      repositoryRoot: directory,
      inputDirectory,
      sessionPath,
    });
    const asset = { id: 'player' };

    const plan = await runner.plan({ assets: [asset] });
    const generation = await runner.generate({ asset, attempt: 1, candidatePath: outputPath });
    const vision = await runner.review({ asset, candidatePath: outputPath });
    await writeFile(normalizedPath, await readFile(outputPath));
    const outputVision = await runner.reviewOutput({
      asset,
      candidatePath: outputPath,
      outputPath: normalizedPath,
    });

    expect(plan.assets).toEqual([{ assetId: 'player', prompt: 'direct app prompt' }]);
    expect(generation).toMatchObject({
      provider: 'codex-app-built-in-imagegen',
      mode: 'direct-app-session',
      prompt: 'exact direct app attempt prompt',
      technicalTransform: 'magenta-matte-to-alpha-and-regrid',
      candidateSha256,
      sourceFile: 'player.png',
      savedPath: outputPath,
    });
    expect(vision).toEqual(review('player', candidateSha256));
    expect(outputVision).toEqual(review('player', candidateSha256));
  });

  it('rejects absolute candidate paths even when they point inside direct-input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-absolute-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const candidatePath = join(inputDirectory, 'player.png');
    const sessionPath = join(directory, 'direct-session.json');
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
          candidate: candidatePath,
          candidateSha256,
          visionQa: review('player', candidateSha256),
          outputVisionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');

    await expect(createDirectSessionRunner({
      repositoryRoot: directory,
      inputDirectory,
      sessionPath,
    })).rejects.toThrow('candidate must be a safe input-relative path');
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
          outputVisionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');
    const runner = await createDirectSessionRunner({
      repositoryRoot: directory,
      inputDirectory,
      sessionPath,
    });
    const asset = { id: 'player' };

    await runner.generate({ asset, attempt: 1, candidatePath: outputPath });
    await writeFile(outputPath, Buffer.from('unreviewed-replacement'));

    await expect(runner.review({ asset, candidatePath: outputPath }))
      .rejects.toThrow('reviewed SHA-256');
  });

  it('rejects a candidate symlink that escapes the declared direct-input directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-link-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const externalDirectory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-external-'));
    cleanups.push(() => rm(externalDirectory, { recursive: true, force: true }));
    const externalCandidate = join(externalDirectory, 'outside.png');
    const linkedCandidate = join(inputDirectory, 'linked.png');
    const sessionPath = join(directory, 'direct-session.json');
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(externalCandidate, Buffer.from('external-image'));
    await symlink(externalCandidate, linkedCandidate);
    const candidateSha256 = await sha256(externalCandidate);
    await writeFile(sessionPath, JSON.stringify({
      schemaVersion: 1,
      generator: 'codex-app-built-in-imagegen',
      assets: [{
        assetId: 'player',
        prompt: 'direct app prompt',
        attempts: [{
          attempt: 1,
          prompt: 'exact direct app attempt prompt',
          candidate: 'linked.png',
          candidateSha256,
          visionQa: review('player', candidateSha256),
          outputVisionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');

    await expect(createDirectSessionRunner({
      repositoryRoot: directory,
      inputDirectory,
      sessionPath,
    }))
      .rejects.toThrow('escapes the real input directory');
  });

  it('rejects incomplete or extended vision QA schemas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-schema-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const inputDirectory = join(directory, 'input');
    const candidatePath = join(inputDirectory, 'player.png');
    const sessionPath = join(directory, 'direct-session.json');
    await mkdir(inputDirectory, { recursive: true });
    await writeFile(candidatePath, Buffer.from('fixture-image'));
    const candidateSha256 = await sha256(candidatePath);
    const invalidReview = review('player', candidateSha256);
    delete invalidReview.guards.gore;
    invalidReview.dimensions.uncontractedBonus = {
      applicable: true,
      score: 1,
      notes: 'must not affect the average',
    };
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
          visionQa: invalidReview,
          outputVisionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');

    await expect(createDirectSessionRunner({
      repositoryRoot: directory,
      inputDirectory,
      sessionPath,
    }))
      .rejects.toThrow(/dimensions has unsupported fields|guards\.gore/);
  });

  it('rejects an input-directory root outside the repository', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-root-'));
    cleanups.push(() => rm(repositoryRoot, { recursive: true, force: true }));
    const inputDirectory = await mkdtemp(join(tmpdir(), 'hyosan-direct-session-outside-'));
    cleanups.push(() => rm(inputDirectory, { recursive: true, force: true }));
    const candidatePath = join(inputDirectory, 'player.png');
    const sessionPath = join(repositoryRoot, 'direct-session.json');
    await writeFile(candidatePath, Buffer.from('external-image'));
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
          outputVisionQa: review('player', candidateSha256),
        }],
      }],
    }), 'utf8');

    await expect(createDirectSessionRunner({ repositoryRoot, inputDirectory, sessionPath }))
      .rejects.toThrow('pipeline.inputDirectory must resolve inside the repository root');
  });

  it('rejects extra fields at the vision QA root and leaf levels', () => {
    const reviewedSha256 = 'a'.repeat(64);
    const root = review('player', reviewedSha256);
    root.unexpectedRoot = true;
    expect(() => validateVisionQaShape(root, 'player'))
      .toThrow('root has unsupported fields');

    const dimension = review('player', reviewedSha256);
    dimension.dimensions.sourceFidelity.unexpectedLeaf = true;
    expect(() => validateVisionQaShape(dimension, 'player'))
      .toThrow('dimensions.sourceFidelity has unsupported fields');

    const guard = review('player', reviewedSha256);
    guard.guards.gore.unexpectedLeaf = true;
    expect(() => validateVisionQaShape(guard, 'player'))
      .toThrow('guards.gore has unsupported fields');
  });
});
