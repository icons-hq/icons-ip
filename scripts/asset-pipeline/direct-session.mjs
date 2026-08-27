import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  assertContainedPath,
  assertExistingPathContained,
  copyFileAtomically,
} from './safe-paths.mjs';
import { decodeUtf8Strict } from './strict-utf8.mjs';
import { SHA256_PATTERN, validateVisionQaShape } from './vision-qa.mjs';

const TECHNICAL_TRANSFORMS = new Set(['magenta-matte-to-alpha']);

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid direct imagegen session: ${message}`);
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

function isSafeInputRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !isAbsolute(value)
    && !/^[a-zA-Z]:[\\/]/.test(value)
    && !value.includes('\\')
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function createDirectSessionRunner({ repositoryRoot, inputDirectory, sessionPath }) {
  assert(typeof repositoryRoot === 'string' && repositoryRoot,
    'repositoryRoot is required');
  await assertContainedPath(repositoryRoot, inputDirectory, 'pipeline.inputDirectory');
  await assertContainedPath(repositoryRoot, sessionPath, 'pipeline.sessionPath');
  const sessionBytes = await readFile(sessionPath);
  const source = JSON.parse(decodeUtf8Strict(sessionBytes, 'direct imagegen session'));
  assert(source.schemaVersion === 1, 'schemaVersion must be 1');
  assert(source.generator === 'codex-app-built-in-imagegen',
    'generator must be codex-app-built-in-imagegen');
  assert(Array.isArray(source.assets) && source.assets.length > 0, 'assets must be non-empty');
  const inputRoot = resolve(inputDirectory);
  const assets = new Map();
  for (const asset of source.assets) {
    assert(typeof asset.assetId === 'string' && asset.assetId, 'assetId is required');
    assert(!assets.has(asset.assetId), `duplicate asset ${asset.assetId}`);
    assert(typeof asset.prompt === 'string' && asset.prompt.trim(),
      `${asset.assetId} prompt is required`);
    assert(Array.isArray(asset.attempts) && asset.attempts.length > 0,
      `${asset.assetId} attempts must be non-empty`);
    const attempts = new Map();
    for (const attempt of asset.attempts) {
      assert(Number.isInteger(attempt.attempt) && attempt.attempt > 0,
        `${asset.assetId} attempt number must be positive`);
      assert(!attempts.has(attempt.attempt),
        `${asset.assetId} duplicates attempt ${attempt.attempt}`);
      assert(isSafeInputRelativePath(attempt.candidate),
        `${asset.assetId} attempt candidate must be a safe input-relative path`);
      assert(typeof attempt.prompt === 'string' && attempt.prompt.trim(),
        `${asset.assetId} attempt prompt is required`);
      assert(SHA256_PATTERN.test(attempt.candidateSha256),
        `${asset.assetId} attempt candidateSha256 must be a lowercase SHA-256 digest`);
      if (attempt.technicalTransform !== undefined) {
        assert(TECHNICAL_TRANSFORMS.has(attempt.technicalTransform),
          `${asset.assetId} attempt technicalTransform is unsupported`);
      }
      const requestedSourcePath = resolve(inputRoot, attempt.candidate);
      assert(isInside(inputRoot, requestedSourcePath),
        `${asset.assetId} attempt candidate escapes the input directory`);
      const sourcePath = await assertExistingPathContained(
        inputRoot,
        requestedSourcePath,
        `${asset.assetId} attempt candidate`,
      );
      validateVisionQaShape(attempt.visionQa, asset.assetId);
      if (attempt.outputVisionQa !== undefined) {
        validateVisionQaShape(attempt.outputVisionQa, asset.assetId);
      }
      attempts.set(attempt.attempt, { ...attempt, sourcePath });
    }
    assets.set(asset.assetId, { ...asset, attempts });
  }

  const activeAttempts = new Map();
  return {
    async plan(spec) {
      const plans = spec.assets.map((asset) => {
        const sessionAsset = assets.get(asset.id);
        assert(sessionAsset, `session omitted ${asset.id}`);
        return { assetId: asset.id, prompt: sessionAsset.prompt };
      });
      return {
        schemaVersion: 1,
        mode: 'direct-app-session',
        generator: source.generator,
        assets: plans,
      };
    },
    async generate({ asset, attempt, candidatePath }) {
      const sessionAsset = assets.get(asset.id);
      assert(sessionAsset, `session omitted ${asset.id}`);
      const record = sessionAsset.attempts.get(attempt);
      assert(record,
        `${asset.id} attempt ${attempt} is missing; generate it directly in the Codex app and add it to the session file`);
      const file = await stat(record.sourcePath);
      assert(file.isFile(), `${asset.id} attempt ${attempt} candidate is not a regular file`);
      const sourceSha256 = await sha256File(record.sourcePath);
      assert(sourceSha256 === record.candidateSha256,
        `${asset.id} attempt ${attempt} candidate SHA-256 does not match the direct session`);
      await copyFileAtomically(record.sourcePath, candidatePath);
      const copiedSha256 = await sha256File(candidatePath);
      assert(copiedSha256 === record.candidateSha256,
        `${asset.id} attempt ${attempt} copied candidate SHA-256 does not match the direct session`);
      activeAttempts.set(resolve(candidatePath), record);
      return {
        provider: source.generator,
        mode: 'direct-app-session',
        prompt: record.prompt,
        technicalTransform: record.technicalTransform,
        sourceFile: record.candidate,
        candidateSha256: record.candidateSha256,
        savedPath: candidatePath,
      };
    },
    async review({ asset, candidatePath }) {
      const record = activeAttempts.get(resolve(candidatePath));
      assert(record, `${asset.id} candidate was not generated by this direct session`);
      const reviewedSha256 = await sha256File(candidatePath);
      assert(reviewedSha256 === record.visionQa.reviewedSha256,
        `${asset.id} candidate does not match the reviewed SHA-256`);
      return structuredClone(record.visionQa);
    },
    async reviewOutput({ asset, candidatePath, outputPath }) {
      const record = activeAttempts.get(resolve(candidatePath));
      assert(record, `${asset.id} candidate was not generated by this direct session`);
      assert(record.outputVisionQa,
        `${asset.id} selected attempt has no normalized output vision review`);
      const reviewedSha256 = await sha256File(outputPath);
      assert(reviewedSha256 === record.outputVisionQa.reviewedSha256,
        `${asset.id} normalized output does not match the reviewed SHA-256`);
      return structuredClone(record.outputVisionQa);
    },
  };
}
