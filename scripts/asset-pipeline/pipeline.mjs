import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  buildSpriteAtlas,
  inspectCandidate,
  normalizeAsset,
  restoreCheckerboardTransparency,
} from './image-processing.mjs';
import { loadAssetSpec } from './spec.mjs';

const GUARD_CONFIDENCE_THRESHOLD = 0.65;

function portableRelative(from, to) {
  return relative(from, to).split(sep).join('/');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function evaluateVision(review, asset) {
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
  const sourceFidelityScore = review.dimensions?.sourceFidelity?.score;
  if (!Number.isFinite(sourceFidelityScore)) {
    throw new Error(`Vision QA returned no sourceFidelity score for ${asset.id}`);
  }
  const hardFailures = Object.entries(review.guards ?? {})
    .filter(([, guard]) => guard.detected === true || guard.confidence >= GUARD_CONFIDENCE_THRESHOLD)
    .map(([guard]) => guard);
  return {
    ...review,
    score,
    minimumScore: asset.qa.minScore,
    sourceFidelityScore,
    minimumSourceFidelity: asset.qa.minSourceFidelity,
    hardFailures,
    passed: score >= asset.qa.minScore
      && sourceFidelityScore >= asset.qa.minSourceFidelity
      && hardFailures.length === 0,
  };
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
  };
}

function chooseBestEligible(attempts) {
  return attempts
    .filter(({ technicalQa, visionQa }) => technicalQa.passed && visionQa?.hardFailures.length === 0)
    .sort((left, right) => (
      right.visionQa.score - left.visionQa.score || left.attempt - right.attempt
    ))[0];
}

export async function runAssetPipeline({ specPath, repositoryRoot, runner, now = () => new Date() }) {
  if (!runner?.plan || !runner?.generate || !runner?.review) {
    throw new Error('Asset pipeline runner must provide plan, generate, and review');
  }
  const root = resolve(repositoryRoot);
  const spec = await loadAssetSpec(specPath);
  const specSource = await readFile(specPath);
  const specSha256 = createHash('sha256').update(specSource).digest('hex');
  const generatedAt = now().toISOString();
  const runId = generatedAt.replaceAll(':', '-').replaceAll('.', '-');
  const workDirectory = resolve(root, spec.pipeline.workDirectory);
  const runDirectory = join(workDirectory, 'runs', runId);
  const outputDirectory = resolve(root, spec.pipeline.outputDirectory);
  const selectedDirectory = join(outputDirectory, 'selected');
  const atlasDirectory = join(outputDirectory, 'atlas');
  await Promise.all([
    mkdir(runDirectory, { recursive: true }),
    mkdir(selectedDirectory, { recursive: true }),
    mkdir(atlasDirectory, { recursive: true }),
  ]);

  const plan = await runner.plan(spec);
  const planByAsset = new Map((plan.assets ?? []).map((item) => [item.assetId, item]));
  for (const asset of spec.assets) {
    if (!planByAsset.has(asset.id)) throw new Error(`Planner omitted ${asset.id}`);
  }
  await Promise.all([
    writeJson(join(runDirectory, 'generation-plan.json'), plan),
    writeJson(join(outputDirectory, 'generation-plan.json'), plan),
  ]);

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
      await mkdir(attemptDirectory, { recursive: true });
      const candidatePath = join(attemptDirectory, 'candidate.png');
      const previous = attempts.at(-1);
      const generation = await runner.generate({
        asset,
        attempt,
        candidatePath,
        plan: planByAsset.get(asset.id),
        previousCandidatePath: previous?.candidatePath,
        feedback: previous?.visionQa?.feedback ?? previous?.technicalQa,
      });
      if (generation?.savedPath && resolve(generation.savedPath) !== resolve(candidatePath)) {
        await copyFile(generation.savedPath, candidatePath);
      }
      if (generation?.technicalTransform === 'checkerboard-matte-to-alpha') {
        generation.technicalTransformResult = await restoreCheckerboardTransparency(candidatePath);
      }
      const technicalQa = await inspectCandidate(candidatePath, asset);
      await writeJson(join(attemptDirectory, 'technical-qa.json'), technicalQa);
      let visionQa = null;
      if (technicalQa.passed) {
        visionQa = evaluateVision(await runner.review({
          asset,
          candidatePath,
          plan: planByAsset.get(asset.id),
          technicalQa,
        }), asset);
        await writeJson(join(attemptDirectory, 'vision-qa.json'), visionQa);
      }
      const record = { attempt, candidatePath, generation, technicalQa, visionQa };
      attempts.push(record);
      if (technicalQa.passed && visionQa?.passed) {
        selected = record;
        break;
      }
    }

    const warning = selected ? null : `QA score stayed below ${asset.qa.minScore} or source fidelity stayed below ${asset.qa.minSourceFidelity} after ${spec.pipeline.maxAttempts} attempts; BEST eligible candidate accepted for M0 review.`;
    selected ??= chooseBestEligible(attempts);
    if (!selected) {
      const error = new Error(`No technically valid, policy-safe candidate for ${asset.id}`);
      error.attempts = attempts;
      throw error;
    }
    selections.push({ asset, attempts, selected, warning });
  }

  const normalizedAssets = [];
  for (const selection of selections) {
    normalizedAssets.push(await normalizeAsset(
      selection.selected.candidatePath,
      selectedDirectory,
      selection.asset,
    ));
  }
  const atlas = await buildSpriteAtlas(
    normalizedAssets,
    atlasDirectory,
    spec.pipeline.atlas,
  );
  const manifestAssets = selections.map((selection, index) => ({
    id: selection.asset.id,
    label: selection.asset.label,
    kind: selection.asset.kind,
    view: selection.asset.view,
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
    visionQa: selection.selected.visionQa,
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
    pipeline: {
      planner: spec.pipeline.planner,
      generator: spec.pipeline.generator,
      visionQa: spec.pipeline.visionQa,
      maxAttempts: spec.pipeline.maxAttempts,
    },
    approvalGate: {
      status: 'pending',
      blocks: ['M1', 'mass-production', 'phaser-integration'],
    },
    atlas: {
      image: portableRelative(outputDirectory, atlas.imagePath),
      data: portableRelative(outputDirectory, atlas.dataPath),
      sha256: atlas.imageSha256,
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
  await Promise.all([
    writeJson(join(outputDirectory, 'asset-manifest.json'), manifest),
    writeJson(join(outputDirectory, 'qa-report.json'), qaReport),
  ]);

  return { manifest, qaReport, atlas, outputDirectory, runDirectory };
}
