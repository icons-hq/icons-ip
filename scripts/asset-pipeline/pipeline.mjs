import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { clearInterval, setInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import {
  buildSpriteAtlas,
  inspectCandidate,
  normalizeAsset,
  restoreMagentaTransparency,
} from './image-processing.mjs';
import {
  assertContainedPath,
  copyFileAtomically,
  writeFileAtomically,
} from './safe-paths.mjs';
import { deepFreeze, loadAssetSpecDocument } from './spec.mjs';
import { validateVisionQaForAsset } from './vision-qa.mjs';

const GUARD_CONFIDENCE_THRESHOLD = 0.65;
const APPROVAL_BLOCKS = ['M1', 'mass-production', 'phaser-integration'];
const OUTPUT_LOCK_RETRY_MS = 20;
const OUTPUT_LOCK_TIMEOUT_MS = 30_000;
const OUTPUT_LOCK_HEARTBEAT_MS = 30_000;
const PROCESS_STARTED_AT = new Date(Date.now() - (process.uptime() * 1_000)).toISOString();
const LOCK_OWNER_FIELDS = Object.freeze([
  'schemaVersion',
  'purpose',
  'token',
  'hostname',
  'pid',
  'processStartedAt',
  'processStartIdentity',
  'acquiredAt',
]);
const LOCK_OWNER_PURPOSES = new Set([
  'asset-pipeline-output',
  'asset-pipeline-lock-recovery',
]);
const execFileAsync = promisify(execFile);
let currentProcessStartIdentityPromise;

function portableRelative(from, to) {
  return relative(from, to).split(sep).join('/');
}

async function writeJson(path, value) {
  await writeFileAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function ensureContainedDirectory(root, path, field) {
  await assertContainedPath(root, path, field);
  await mkdir(path, { recursive: true });
  await assertContainedPath(root, path, field);
}

export async function readProcessStartIdentity(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LANG: 'C',
        LC_ALL: 'C',
        TZ: 'UTC',
      },
    });
    return stdout.trim().replaceAll(/\s+/g, ' ') || null;
  } catch {
    return null;
  }
}

function currentProcessStartIdentity() {
  currentProcessStartIdentityPromise ??= readProcessStartIdentity(process.pid);
  return currentProcessStartIdentityPromise;
}

async function createLockOwner(purpose) {
  const processStartIdentity = await currentProcessStartIdentity();
  if (!processStartIdentity) {
    throw new Error('Cannot determine the asset pipeline process start identity');
  }
  return deepFreeze({
    schemaVersion: 1,
    purpose,
    token: randomUUID(),
    hostname: hostname(),
    pid: process.pid,
    processStartedAt: PROCESS_STARTED_AT,
    processStartIdentity,
    acquiredAt: new Date().toISOString(),
  });
}

async function tryCreateOwnerFile(path, purpose) {
  const owner = await createLockOwner(purpose);
  const temporaryPath = `${path}.${owner.token}.owner`;
  await writeFile(temporaryPath, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    await link(temporaryPath, path);
    return owner;
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readOwnerFile(path) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error(`Asset pipeline lock must be a regular file: ${path}`);
  }
  const raw = await readFile(path, 'utf8');
  let owner = null;
  try {
    owner = JSON.parse(raw);
  } catch {
    // Malformed and legacy locks remain in place for verified manual recovery.
  }
  return { owner, raw };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function hasValidLockOwner(owner) {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return false;
  const fields = Object.keys(owner);
  return fields.length === LOCK_OWNER_FIELDS.length
    && fields.every((field) => LOCK_OWNER_FIELDS.includes(field))
    && owner.schemaVersion === 1
    && LOCK_OWNER_PURPOSES.has(owner.purpose)
    && typeof owner.token === 'string'
    && owner.token.trim() === owner.token
    && owner.token.length > 0
    && typeof owner.hostname === 'string'
    && owner.hostname.trim() === owner.hostname
    && owner.hostname.length > 0
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && isCanonicalIsoTimestamp(owner.processStartedAt)
    && typeof owner.processStartIdentity === 'string'
    && owner.processStartIdentity.trim() === owner.processStartIdentity
    && owner.processStartIdentity.length > 0
    && isCanonicalIsoTimestamp(owner.acquiredAt);
}

export async function isOwnerStale({ owner }, expectedPurpose) {
  if (!hasValidLockOwner(owner)
    || (expectedPurpose && owner.purpose !== expectedPurpose)
    || owner.hostname !== hostname()) return false;
  if (!isProcessAlive(owner.pid)) return true;
  if (owner.pid === process.pid) {
    if (typeof owner.processStartIdentity === 'string') {
      return owner.processStartIdentity !== await currentProcessStartIdentity();
    }
    return owner.processStartedAt !== PROCESS_STARTED_AT;
  }
  if (typeof owner.processStartIdentity !== 'string' || !owner.processStartIdentity) {
    return false;
  }
  const actualProcessStartIdentity = await readProcessStartIdentity(owner.pid);
  return actualProcessStartIdentity !== null
    && actualProcessStartIdentity !== owner.processStartIdentity;
}

async function removeOwnerFileIfUnchanged(path, observed) {
  const current = await readOwnerFile(path);
  if (!current || current.raw !== observed.raw) return false;
  await rm(path, { force: true });
  return true;
}

async function releaseOwnedFile(path, owner) {
  const current = await readOwnerFile(path);
  if (current?.owner?.token === owner.token) await rm(path, { force: true });
}

async function refreshOwnedFileLease(path, owner) {
  const current = await readOwnerFile(path);
  if (current?.owner?.token !== owner.token) return false;
  const refreshedAt = new Date();
  await utimes(path, refreshedAt, refreshedAt);
  return true;
}

async function tryRecoverOutputLock(lockPath) {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryOwner = await tryCreateOwnerFile(
    recoveryPath,
    'asset-pipeline-lock-recovery',
  );
  if (!recoveryOwner) return false;

  try {
    const lock = await readOwnerFile(lockPath);
    if (!lock) return true;
    if (!await isOwnerStale(lock, 'asset-pipeline-output')) return false;
    return removeOwnerFileIfUnchanged(lockPath, lock);
  } finally {
    await releaseOwnedFile(recoveryPath, recoveryOwner);
  }
}

async function tryAcquireOutputLock(lockPath) {
  const recoveryPath = `${lockPath}.recovery`;
  if (await readOwnerFile(recoveryPath)) return null;
  const owner = await tryCreateOwnerFile(lockPath, 'asset-pipeline-output');
  if (!owner) return null;
  if (await readOwnerFile(recoveryPath)) {
    await releaseOwnedFile(lockPath, owner);
    return null;
  }
  return owner;
}

async function withOutputLock(root, outputDirectory, callback) {
  await ensureContainedDirectory(root, outputDirectory, 'pipeline.outputDirectory');
  const lockPath = join(outputDirectory, '.asset-pipeline.lock');
  const deadline = Date.now() + OUTPUT_LOCK_TIMEOUT_MS;
  let owner;
  while (!owner) {
    owner = await tryAcquireOutputLock(lockPath);
    if (owner) break;
    await tryRecoverOutputLock(lockPath);
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for asset pipeline lock: ${lockPath}`);
    }
    await delay(OUTPUT_LOCK_RETRY_MS);
  }
  let heartbeatFailure = null;
  let heartbeatTask = Promise.resolve();
  const abortController = new AbortController();
  const recordOwnershipFailure = (error) => {
    heartbeatFailure ??= error instanceof Error
      ? error
      : new Error(`Lost asset pipeline lock ownership: ${lockPath}`);
    if (!abortController.signal.aborted) abortController.abort(heartbeatFailure);
  };
  const assertOwned = async () => {
    if (heartbeatFailure) throw heartbeatFailure;
    const current = await readOwnerFile(lockPath);
    if (current?.owner?.token !== owner.token) {
      const error = new Error(`Lost asset pipeline lock ownership: ${lockPath}`);
      recordOwnershipFailure(error);
      throw error;
    }
  };
  const runWhileOwned = async (operation) => {
    await assertOwned();
    let onAbort;
    const { promise: aborted, reject: rejectAborted } = Promise.withResolvers();
    onAbort = () => rejectAborted(abortController.signal.reason);
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    const operationPromise = Promise.resolve().then(operation);
    try {
      const result = await Promise.race([operationPromise, aborted]);
      await assertOwned();
      return result;
    } catch (error) {
      await operationPromise.catch(() => {});
      throw error;
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
    }
  };
  const heartbeat = setInterval(() => {
    heartbeatTask = heartbeatTask.then(async () => {
      const refreshed = await refreshOwnedFileLease(lockPath, owner);
      if (!refreshed) {
        recordOwnershipFailure(
          new Error(`Lost asset pipeline lock ownership: ${lockPath}`),
        );
      }
    }).catch((error) => {
      recordOwnershipFailure(error);
    });
  }, OUTPUT_LOCK_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    const result = await callback({
      assertOwned,
      run: runWhileOwned,
      signal: abortController.signal,
    });
    clearInterval(heartbeat);
    await heartbeatTask;
    await assertOwned();
    return result;
  } finally {
    clearInterval(heartbeat);
    await heartbeatTask;
    await releaseOwnedFile(lockPath, owner);
  }
}

function evaluateVision(review, asset, expectedSha256, stage) {
  validateVisionQaForAsset(review, asset, expectedSha256, stage);
  const dimensions = Object.entries(review.dimensions ?? {});
  const applicable = dimensions.filter(([, dimension]) => dimension.applicable !== false);
  if (applicable.length === 0) throw new Error(`Vision QA returned no applicable dimensions for ${asset.id}`);
  for (const [name, dimension] of applicable) {
    if (!Number.isFinite(dimension.score) || dimension.score < 0 || dimension.score > 1) {
      throw new Error(`Vision QA returned an invalid ${name} score for ${asset.id}`);
    }
  }
  const score = Number((
    applicable.reduce((total, [, dimension]) => total + dimension.score, 0) / applicable.length
  ).toFixed(4));
  const sourceFidelityScore = review.dimensions.sourceFidelity.score;
  const hardFailures = Object.entries(review.guards)
    .filter(([, guard]) => guard.detected === true || guard.confidence >= GUARD_CONFIDENCE_THRESHOLD)
    .map(([guard]) => guard);
  const isCanonicalCharacter = asset.identity.mode === 'canonical';
  const characterIdentity = review.dimensions?.characterIdentity;
  const characterIdentityScore = characterIdentity?.score;
  if (isCanonicalCharacter
    && (characterIdentity?.applicable === false || !Number.isFinite(characterIdentityScore))) {
    throw new Error(`Vision QA returned no applicable characterIdentity score for canonical asset ${asset.id}`);
  }
  const minimumCharacterIdentity = isCanonicalCharacter
    ? asset.qa.minCharacterIdentity
    : null;
  return deepFreeze({
    ...review,
    score,
    minimumScore: asset.qa.minScore,
    sourceFidelityScore,
    minimumSourceFidelity: asset.qa.minSourceFidelity,
    characterIdentityScore: Number.isFinite(characterIdentityScore)
      ? characterIdentityScore
      : null,
    minimumCharacterIdentity,
    hardFailures,
    passed: score >= asset.qa.minScore
      && sourceFidelityScore >= asset.qa.minSourceFidelity
      && (!isCanonicalCharacter || characterIdentityScore >= minimumCharacterIdentity)
      && hardFailures.length === 0,
  });
}

function sanitizeTechnical(report, repositoryRoot) {
  return { ...report, path: portableRelative(repositoryRoot, report.path) };
}

function sanitizeGeneration(generation, repositoryRoot) {
  if (!generation || typeof generation !== 'object') return generation;
  const { savedPath, ...rest } = generation;
  if (!savedPath) return rest;
  const resolvedPath = resolve(savedPath);
  const relativePath = relative(repositoryRoot, resolvedPath);
  const isInsideRepository = !isAbsolute(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && relativePath !== '';
  return {
    ...rest,
    savedFile: isInsideRepository
      ? portableRelative(repositoryRoot, resolvedPath)
      : resolvedPath.split(sep).at(-1),
  };
}

function sanitizeAttempt(attempt, repositoryRoot) {
  return {
    ...attempt,
    candidatePath: portableRelative(repositoryRoot, attempt.candidatePath),
    generation: sanitizeGeneration(attempt.generation, repositoryRoot),
    technicalQa: sanitizeTechnical(attempt.technicalQa, repositoryRoot),
    normalized: attempt.normalized
      ? { ...attempt.normalized, path: portableRelative(repositoryRoot, attempt.normalized.path) }
      : null,
  };
}

function rankCandidateFallbacks(attempts, asset) {
  return attempts
    .filter(({ technicalQa, visionQa }) => (
      technicalQa.passed
      && visionQa?.hardFailures.length === 0
    ))
    .sort((left, right) => (
      right.visionQa.sourceFidelityScore - left.visionQa.sourceFidelityScore
      || (asset.identity.mode === 'canonical'
        ? right.visionQa.characterIdentityScore - left.visionQa.characterIdentityScore
        : 0)
      || right.visionQa.score - left.visionQa.score
      || left.attempt - right.attempt
    ));
}

export async function invalidateAssetManifest({
  repositoryRoot,
  outputDirectory,
  project = 'hyosan-memories',
  milestone = 'M0',
  generatedAt = new Date().toISOString(),
}) {
  const root = resolve(repositoryRoot);
  const output = resolve(outputDirectory);
  await assertContainedPath(root, output, 'pipeline.outputDirectory');
  await mkdir(output, { recursive: true });
  await assertContainedPath(root, output, 'pipeline.outputDirectory');
  const manifest = {
    schemaVersion: 1,
    project,
    milestone,
    status: 'regeneration-in-progress',
    generatedAt,
    approvalGate: {
      status: 'blocked',
      blocks: APPROVAL_BLOCKS,
    },
  };
  await writeJson(join(output, 'asset-manifest.json'), manifest);
  return manifest;
}

export async function runAssetPipeline({
  specPath,
  repositoryRoot,
  runner,
  runnerFactory,
  now = () => new Date(),
}) {
  const root = resolve(repositoryRoot);
  const { source: specSource, spec } = await loadAssetSpecDocument(specPath);
  const specSha256 = createHash('sha256').update(specSource).digest('hex');
  const generatedAt = now().toISOString();
  const runId = generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const workDirectory = resolve(root, spec.pipeline.workDirectory);
  const runsDirectory = join(workDirectory, 'runs');
  const outputDirectory = resolve(root, spec.pipeline.outputDirectory);
  await assertContainedPath(root, workDirectory, 'pipeline.workDirectory');
  await assertContainedPath(root, outputDirectory, 'pipeline.outputDirectory');
  return withOutputLock(root, outputDirectory, async (lockGuard) => {
    const selectedDirectory = join(outputDirectory, 'selected');
    const atlasDirectory = join(outputDirectory, 'atlas');
    await lockGuard.run(() => invalidateAssetManifest({
      repositoryRoot: root,
      outputDirectory,
      project: spec.meta.project,
      milestone: spec.meta.milestone,
      generatedAt,
    }));
    const activeRunner = runnerFactory
      ? await lockGuard.run(() => runnerFactory({ spec, signal: lockGuard.signal }))
      : runner;
    await ensureContainedDirectory(root, runsDirectory, 'pipeline.workDirectory');
    const runDirectory = await mkdtemp(join(runsDirectory, `${runId}-`));
    await assertContainedPath(root, runDirectory, 'pipeline.workDirectory');
    await lockGuard.run(async () => {
      await ensureContainedDirectory(root, selectedDirectory, 'pipeline.outputDirectory');
      await ensureContainedDirectory(root, atlasDirectory, 'pipeline.outputDirectory');
    });
    if (!activeRunner?.plan || !activeRunner?.generate
      || !activeRunner?.review || !activeRunner?.reviewOutput) {
      throw new Error('Asset pipeline runner must provide plan, generate, review, and reviewOutput');
    }

    const plan = deepFreeze(await lockGuard.run(() => activeRunner.plan(spec, {
      signal: lockGuard.signal,
    })));
  const planByAsset = new Map((plan.assets ?? []).map((item) => [item.assetId, item]));
  for (const asset of spec.assets) {
    if (!planByAsset.has(asset.id)) throw new Error(`Planner omitted ${asset.id}`);
  }
  await writeJson(join(runDirectory, 'generation-plan.json'), plan);

  const selections = [];
  for (const asset of spec.assets) {
    const attempts = [];
    let selected;
    for (let attempt = 1; attempt <= spec.pipeline.maxAttempts; attempt += 1) {
      const attemptDirectory = join(
        runDirectory,
        asset.id,
        `attempt-${String(attempt).padStart(2, '0')}`,
      );
      await ensureContainedDirectory(root, attemptDirectory, 'pipeline.workDirectory');
      const candidatePath = join(attemptDirectory, 'candidate.png');
      const previous = attempts.at(-1);
      const generated = await lockGuard.run(() => activeRunner.generate({
        asset,
        attempt,
        candidatePath,
        plan: planByAsset.get(asset.id),
        previousCandidatePath: previous?.candidatePath,
        feedback: previous?.visionQa?.feedback ?? previous?.technicalQa,
        signal: lockGuard.signal,
      }));
      if (generated?.savedPath && resolve(generated.savedPath) !== resolve(candidatePath)) {
        await copyFileAtomically(generated.savedPath, candidatePath);
      }
      let generation = generated;
      if (generated?.technicalTransform === 'magenta-matte-to-alpha') {
        generation = {
          ...generated,
          technicalTransformResult: await restoreMagentaTransparency(candidatePath),
        };
      }
      generation = deepFreeze(generation);
      const technicalQa = deepFreeze(await inspectCandidate(candidatePath, asset));
      const candidateSha256 = technicalQa.sha256;
      await writeJson(join(attemptDirectory, 'technical-qa.json'), technicalQa);
      let visionQa = null;
      let normalized = null;
      let outputVisionQa = null;
      if (technicalQa.passed) {
        visionQa = evaluateVision(await lockGuard.run(() => activeRunner.review({
          asset,
          candidatePath,
          candidateSha256,
          plan: planByAsset.get(asset.id),
          technicalQa,
          signal: lockGuard.signal,
        })), asset, candidateSha256, 'candidate');
        await writeJson(join(attemptDirectory, 'vision-qa.json'), visionQa);
        if (visionQa.passed) {
          const normalizedDirectory = join(attemptDirectory, 'normalized');
          await ensureContainedDirectory(root, normalizedDirectory, 'pipeline.workDirectory');
          normalized = await normalizeAsset(
            candidatePath,
            normalizedDirectory,
            asset,
          );
          const outputSha256 = normalized.sha256;
          outputVisionQa = evaluateVision(await lockGuard.run(() => activeRunner.reviewOutput({
            asset,
            candidatePath,
            outputPath: normalized.path,
            outputSha256,
            plan: planByAsset.get(asset.id),
            technicalQa,
            candidateVisionQa: visionQa,
            signal: lockGuard.signal,
          })), asset, outputSha256, 'normalized output');
          await writeJson(join(attemptDirectory, 'output-vision-qa.json'), outputVisionQa);
        }
      }
      const record = {
        attempt,
        candidatePath,
        generation,
        technicalQa,
        visionQa,
        normalized,
        outputVisionQa,
      };
      attempts.push(record);
      if (technicalQa.passed && visionQa?.passed && outputVisionQa?.passed) {
        selected = record;
        break;
      }
    }

    const warning = selected ? null : `Candidate or normalized-output QA stayed below ${asset.qa.minScore}, source fidelity stayed below ${asset.qa.minSourceFidelity}, or canonical performer identity stayed below its threshold after ${spec.pipeline.maxAttempts} attempts; BEST eligible candidate accepted for M0 review.`;
    if (!selected) {
      for (const fallback of rankCandidateFallbacks(attempts, asset)) {
        if (!fallback.normalized) {
          const attemptDirectory = dirname(fallback.candidatePath);
          const normalizedDirectory = join(attemptDirectory, 'normalized');
          await ensureContainedDirectory(root, normalizedDirectory, 'pipeline.workDirectory');
          fallback.normalized = await normalizeAsset(
            fallback.candidatePath,
            normalizedDirectory,
            asset,
          );
          const outputSha256 = fallback.normalized.sha256;
          fallback.outputVisionQa = evaluateVision(await lockGuard.run(() => activeRunner.reviewOutput({
            asset,
            candidatePath: fallback.candidatePath,
            outputPath: fallback.normalized.path,
            outputSha256,
            plan: planByAsset.get(asset.id),
            technicalQa: fallback.technicalQa,
            candidateVisionQa: fallback.visionQa,
            signal: lockGuard.signal,
          })), asset, outputSha256, 'normalized output');
          await writeJson(
            join(attemptDirectory, 'output-vision-qa.json'),
            fallback.outputVisionQa,
          );
        }
        if (fallback.outputVisionQa.hardFailures.length === 0) {
          selected = fallback;
          break;
        }
      }
    }
    if (!selected) {
      const error = new Error(`No technically valid, policy-safe candidate for ${asset.id}`);
      error.attempts = attempts;
      throw error;
    }
    selections.push({ asset, attempts, selected, warning });
  }

  const normalizedSources = selections.map((selection) => selection.selected.normalized);
  const atlasStagingDirectory = join(runDirectory, 'published-atlas');
  await ensureContainedDirectory(root, atlasStagingDirectory, 'pipeline.workDirectory');
  const stagedAtlas = await lockGuard.run(() => buildSpriteAtlas(
    normalizedSources,
    atlasStagingDirectory,
    spec.pipeline.atlas,
  ));

  const normalizedAssets = [];
  for (const selection of selections) {
    const source = selection.selected.normalized;
    const publishedPath = join(selectedDirectory, source.file);
    await lockGuard.run(async () => {
      await copyFileAtomically(source.path, publishedPath);
      const publishedSha256 = createHash('sha256')
        .update(await readFile(publishedPath))
        .digest('hex');
      if (publishedSha256 !== source.sha256) {
        throw new Error(`Published normalized output SHA-256 changed for ${selection.asset.id}`);
      }
    });
    normalizedAssets.push({ ...source, path: publishedPath });
  }
  const publishedAtlasImagePath = join(atlasDirectory, basename(stagedAtlas.imagePath));
  const publishedAtlasDataPath = join(atlasDirectory, basename(stagedAtlas.dataPath));
  await lockGuard.run(async () => {
    await copyFileAtomically(stagedAtlas.imagePath, publishedAtlasImagePath);
    await copyFileAtomically(stagedAtlas.dataPath, publishedAtlasDataPath);
    const [publishedImageSha256, publishedDataSha256] = await Promise.all([
      readFile(publishedAtlasImagePath).then((bytes) => (
        createHash('sha256').update(bytes).digest('hex')
      )),
      readFile(publishedAtlasDataPath).then((bytes) => (
        createHash('sha256').update(bytes).digest('hex')
      )),
    ]);
    if (publishedImageSha256 !== stagedAtlas.imageSha256
      || publishedDataSha256 !== stagedAtlas.dataSha256) {
      throw new Error('Published sprite atlas SHA-256 changed during publish');
    }
  });
  const atlas = {
    ...stagedAtlas,
    imagePath: publishedAtlasImagePath,
    dataPath: publishedAtlasDataPath,
  };
  const manifestAssets = selections.map((selection, index) => ({
    id: selection.asset.id,
    label: selection.asset.label,
    kind: selection.asset.kind,
    view: selection.asset.view,
    referenceIds: selection.asset.referenceIds,
    selectedAttempt: selection.selected.attempt,
    status: selection.warning ? 'accepted-with-warning' : 'passed',
    warning: selection.warning,
    output: {
      path: portableRelative(outputDirectory, normalizedAssets[index].path),
      width: normalizedAssets[index].width,
      height: normalizedAssets[index].height,
      format: normalizedAssets[index].format,
      sha256: normalizedAssets[index].sha256,
    },
    technicalQa: sanitizeTechnical(selection.selected.technicalQa, root),
    candidateVisionQa: selection.selected.visionQa,
    visionQa: selection.selected.outputVisionQa,
    generation: sanitizeGeneration(selection.selected.generation, root),
  }));
  const manifest = {
    schemaVersion: 1,
    project: spec.meta.project,
    milestone: spec.meta.milestone,
    status: 'pending-user-approval',
    generatedAt,
    spec: {
      path: portableRelative(root, resolve(specPath)),
      sha256: specSha256,
    },
    provenance: {
      rightsScope: spec.meta.rightsScope,
      referenceSources: spec.meta.referenceSources,
    },
    pipeline: {
      planner: spec.pipeline.planner,
      generator: spec.pipeline.generator,
      visionQa: spec.pipeline.visionQa,
      maxAttempts: spec.pipeline.maxAttempts,
    },
    approvalGate: {
      status: 'pending',
      blocks: APPROVAL_BLOCKS,
    },
    atlas: {
      image: portableRelative(outputDirectory, atlas.imagePath),
      data: portableRelative(outputDirectory, atlas.dataPath),
      sha256: atlas.imageSha256,
      dataSha256: atlas.dataSha256,
      frames: Object.keys(atlas.data.frames),
    },
    assets: manifestAssets,
  };
  const qaReport = {
    schemaVersion: 1,
    generatedAt,
    summary: {
      requested: selections.length,
      passed: selections.filter(({ warning }) => !warning).length,
      acceptedWithWarning: selections.filter(({ warning }) => warning).length,
      failed: 0,
    },
    assets: selections.map((selection) => ({
      assetId: selection.asset.id,
      selectedAttempt: selection.selected.attempt,
      warning: selection.warning,
      attempts: selection.attempts.map((attempt) => sanitizeAttempt(attempt, root)),
    })),
  };
  await lockGuard.run(async () => {
    await writeJson(join(outputDirectory, 'generation-plan.json'), plan);
    await writeJson(join(outputDirectory, 'qa-report.json'), qaReport);
  });
  await lockGuard.run(() => writeJson(join(outputDirectory, 'asset-manifest.json'), manifest));

    return { manifest, qaReport, atlas, outputDirectory, runDirectory };
  });
}
