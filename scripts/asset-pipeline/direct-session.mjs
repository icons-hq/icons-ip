import { createHash } from 'node:crypto';
import { copyFile, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const DIMENSIONS = [
  'sourceFidelity',
  'styleMatch',
  'characterIdentity',
  'topdownAngle',
  'gameplayReadability',
  'animationConsistency',
];
const GUARDS = ['gore', 'webtoonElements', 'wrongSeasonElements'];
const TECHNICAL_TRANSFORMS = new Set(['magenta-matte-to-alpha']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid direct imagegen session: ${message}`);
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function validateReview(review, assetId) {
  assert(review?.assetId === assetId, `${assetId} visionQa.assetId does not match`);
  assert(SHA256_PATTERN.test(review.reviewedSha256),
    `${assetId} visionQa.reviewedSha256 must be a lowercase SHA-256 digest`);
  assert(review.dimensions && typeof review.dimensions === 'object',
    `${assetId} visionQa.dimensions is required`);
  for (const name of DIMENSIONS) {
    const dimension = review.dimensions[name];
    assert(dimension && typeof dimension.applicable === 'boolean',
      `${assetId} visionQa.dimensions.${name}.applicable must be boolean`);
    assert(Number.isFinite(dimension.score) && dimension.score >= 0 && dimension.score <= 1,
      `${assetId} visionQa.dimensions.${name}.score must be between 0 and 1`);
    assert(typeof dimension.notes === 'string' && dimension.notes.trim(),
      `${assetId} visionQa.dimensions.${name}.notes is required`);
  }
  assert(review.guards && typeof review.guards === 'object',
    `${assetId} visionQa.guards is required`);
  for (const name of GUARDS) {
    const guard = review.guards[name];
    assert(guard && typeof guard.detected === 'boolean',
      `${assetId} visionQa.guards.${name}.detected must be boolean`);
    assert(Number.isFinite(guard.confidence) && guard.confidence >= 0 && guard.confidence <= 1,
      `${assetId} visionQa.guards.${name}.confidence must be between 0 and 1`);
    assert(typeof guard.notes === 'string' && guard.notes.trim(),
      `${assetId} visionQa.guards.${name}.notes is required`);
  }
  assert(Array.isArray(review.feedback), `${assetId} visionQa.feedback must be an array`);
}

export async function createDirectSessionRunner({ inputDirectory, sessionPath }) {
  const source = JSON.parse(await readFile(sessionPath, 'utf8'));
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
      assert(typeof attempt.candidate === 'string' && attempt.candidate,
        `${asset.assetId} attempt candidate is required`);
      assert(typeof attempt.prompt === 'string' && attempt.prompt.trim(),
        `${asset.assetId} attempt prompt is required`);
      assert(SHA256_PATTERN.test(attempt.candidateSha256),
        `${asset.assetId} attempt candidateSha256 must be a lowercase SHA-256 digest`);
      if (attempt.technicalTransform !== undefined) {
        assert(TECHNICAL_TRANSFORMS.has(attempt.technicalTransform),
          `${asset.assetId} attempt technicalTransform is unsupported`);
      }
      const sourcePath = resolve(inputRoot, attempt.candidate);
      assert(isInside(inputRoot, sourcePath),
        `${asset.assetId} attempt candidate escapes the input directory`);
      validateReview(attempt.visionQa, asset.assetId);
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
      await copyFile(record.sourcePath, candidatePath);
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
  };
}
