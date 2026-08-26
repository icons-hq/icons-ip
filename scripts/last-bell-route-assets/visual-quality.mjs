import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

const ANALYSIS_WIDTH = 320;
const ANALYSIS_HEIGHT = 180;
const EDGE_THRESHOLD = 12;

export const LAST_BELL_VISUAL_QUALITY_SCOPE = 'private-route-environment-only';
export const LAST_BELL_AUTOMATED_VISUAL_PASS = 'passed-automated-environment-design-quality';

export const LAST_BELL_GENERATED_REFERENCE_HASHES = Object.freeze({
  corridor: '054bf3cdbd3f7545b9fd94e19db276586828a75c517f16a7b7aac70ccaae463d',
  rooftop: '04a8532c64b54a359b808aed09eba6c4becce96835817ca8b38bc38d8546394e',
});

const REGIONS = Object.freeze({
  floor: { x0: 32, x1: 288, y0: 86, y1: 179 },
  rooftop_sky: { x0: 16, x1: 304, y0: 4, y1: 34 },
  rooftop_headhouse: { x0: 128, x1: 288, y0: 30, y1: 115 },
});

function round(value, precision = 4) {
  return Number(value.toFixed(precision));
}

function percentile(values, quantile) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * quantile)];
}

function regionMetrics(data, region) {
  const { x0, x1, y0, y1 } = region;
  const rowMeans = [];
  const columnMeans = [];
  let sum = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  let absoluteHorizontalGradient = 0;
  let absoluteVerticalGradient = 0;
  let edgeCount = 0;

  for (let y = y0; y < y1; y += 1) {
    let rowSum = 0;
    for (let x = x0; x < x1; x += 1) {
      const value = data[y * ANALYSIS_WIDTH + x];
      sum += value;
      sumSquares += value * value;
      rowSum += value;
      sampleCount += 1;

      if (x > x0) {
        const gradient = Math.abs(value - data[y * ANALYSIS_WIDTH + x - 1]);
        absoluteHorizontalGradient += gradient;
        if (gradient > EDGE_THRESHOLD) edgeCount += 1;
      }
      if (y > y0) {
        const gradient = Math.abs(value - data[(y - 1) * ANALYSIS_WIDTH + x]);
        absoluteVerticalGradient += gradient;
        if (gradient > EDGE_THRESHOLD) edgeCount += 1;
      }
    }
    rowMeans.push(rowSum / (x1 - x0));
  }

  for (let x = x0; x < x1; x += 1) {
    let columnSum = 0;
    for (let y = y0; y < y1; y += 1) {
      columnSum += data[y * ANALYSIS_WIDTH + x];
    }
    columnMeans.push(columnSum / (y1 - y0));
  }

  const average = sum / sampleCount;
  const rowJumps = rowMeans.slice(1).map((value, index) => Math.abs(value - rowMeans[index]));
  const columnJumps = columnMeans.slice(1).map((value, index) => Math.abs(value - columnMeans[index]));

  return {
    mean_luma: round(average),
    luma_stdev: round(Math.sqrt(sumSquares / sampleCount - average * average)),
    mean_horizontal_gradient: round(absoluteHorizontalGradient / sampleCount),
    mean_vertical_gradient: round(absoluteVerticalGradient / sampleCount),
    edge_density: round(edgeCount / (sampleCount * 2)),
    row_mean_jump_p95: round(percentile(rowJumps, 0.95)),
    row_mean_jump_max: round(Math.max(...rowJumps)),
    column_mean_jump_max: round(Math.max(...columnJumps)),
  };
}

function stripMean(data, x0, x1) {
  let sum = 0;
  let count = 0;
  for (let y = REGIONS.rooftop_sky.y0; y < REGIONS.rooftop_sky.y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      sum += data[y * ANALYSIS_WIDTH + x];
      count += 1;
    }
  }
  return sum / count;
}

function rooftopEdgeMismatch(data) {
  const left = Math.abs(stripMean(data, 0, 16) - stripMean(data, 16, 32));
  const right = Math.abs(stripMean(data, 304, 320) - stripMean(data, 288, 304));
  return {
    left: round(left),
    right: round(right),
    max: round(Math.max(left, right)),
  };
}

export async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function analyzeLastBellVisualFrame(path) {
  const image = sharp(path);
  const metadata = await image.metadata();
  const data = await image
    .resize(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();

  return {
    source_width: metadata.width,
    source_height: metadata.height,
    sha256: await sha256(path),
    floor: regionMetrics(data, REGIONS.floor),
    rooftop_sky: regionMetrics(data, REGIONS.rooftop_sky),
    rooftop_headhouse: regionMetrics(data, REGIONS.rooftop_headhouse),
    rooftop_edge_mismatch: rooftopEdgeMismatch(data),
  };
}

function check(id, actual, operator, threshold, evidence) {
  const passed = operator === '<=' ? actual <= threshold : actual >= threshold;
  return {
    id,
    status: passed ? 'pass' : 'fail',
    actual: round(actual),
    operator,
    threshold: round(threshold),
    evidence,
  };
}

export function evaluateLastBellEnvironmentVisualQuality({ corridor, rooftop, references }) {
  const corridorReference = references.corridor;
  const rooftopReference = references.rooftop;
  const matteEdgeMismatch = rooftopReference.rooftop_edge_mismatch.max;
  const checks = [
    check(
      'corridor-floor-horizontal-band-limit',
      corridor.floor.row_mean_jump_max,
      '<=',
      corridorReference.floor.row_mean_jump_max * 1.15,
      'generated corridor lookdev floor row-step maximum plus 15% delivery tolerance',
    ),
    check(
      'corridor-floor-surface-detail',
      corridor.floor.edge_density,
      '>=',
      corridorReference.floor.edge_density * 0.9,
      'generated corridor lookdev floor edge density minus 10% compression tolerance',
    ),
    check(
      'rooftop-matte-tonal-variation',
      rooftop.rooftop_sky.luma_stdev,
      '>=',
      rooftopReference.rooftop_sky.luma_stdev * 0.5,
      'generated rooftop matte upper-sky variation retained at 50% after grading and fog',
    ),
    check(
      'rooftop-matte-lateral-detail',
      rooftop.rooftop_sky.mean_horizontal_gradient,
      '>=',
      rooftopReference.rooftop_sky.mean_horizontal_gradient * 0.4,
      'generated rooftop matte upper-sky lateral detail retained at 40% after grading and fog',
    ),
    check(
      'rooftop-matte-edge-seam',
      rooftop.rooftop_edge_mismatch.max,
      '<=',
      matteEdgeMismatch * 1.75,
      'outer delivery-frame strip mismatch limited to 1.75x the generated matte natural edge variation',
    ),
    check(
      'rooftop-headhouse-authored-detail',
      rooftop.rooftop_headhouse.edge_density,
      '>=',
      0.075,
      'fixed regression floor separating the damaged material stack from the prior clean-box render',
    ),
  ];

  return {
    status: checks.every((entry) => entry.status === 'pass') ? LAST_BELL_AUTOMATED_VISUAL_PASS : 'failed-automated-environment-design-quality',
    checks,
  };
}

export function assertLastBellEnvironmentVisualQuality(evaluation) {
  const failures = evaluation.checks.filter((entry) => entry.status !== 'pass');
  if (failures.length > 0) {
    throw new Error(`Last Bell automated environment design quality failed: ${failures.map((entry) => entry.id).join(', ')}`);
  }
}

export async function buildLastBellEnvironmentVisualQualityReport({
  buildId,
  corridorPath,
  rooftopPath,
  corridorReferencePath,
  rooftopReferencePath,
}) {
  const [corridor, rooftop, corridorReference, rooftopReference] = await Promise.all([
    analyzeLastBellVisualFrame(corridorPath),
    analyzeLastBellVisualFrame(rooftopPath),
    analyzeLastBellVisualFrame(corridorReferencePath),
    analyzeLastBellVisualFrame(rooftopReferencePath),
  ]);

  if (corridorReference.sha256 !== LAST_BELL_GENERATED_REFERENCE_HASHES.corridor) {
    throw new Error(`Generated corridor lookdev hash mismatch: ${corridorReference.sha256}`);
  }
  if (rooftopReference.sha256 !== LAST_BELL_GENERATED_REFERENCE_HASHES.rooftop) {
    throw new Error(`Generated rooftop matte hash mismatch: ${rooftopReference.sha256}`);
  }
  if (corridor.source_width !== 1280 || corridor.source_height !== 720 || rooftop.source_width !== 1280 || rooftop.source_height !== 720) {
    throw new Error('Last Bell visual-quality candidates must use the locked 1280x720 delivery camera');
  }

  const references = { corridor: corridorReference, rooftop: rooftopReference };
  const evaluation = evaluateLastBellEnvironmentVisualQuality({ corridor, rooftop, references });
  return {
    schema_version: 1,
    build_id: buildId,
    scope: LAST_BELL_VISUAL_QUALITY_SCOPE,
    status: evaluation.status,
    release_approval: false,
    human_art_review: 'required',
    external_ip_approval: 'not-asserted',
    generated_reference_evidence: {
      corridor: { path: corridorReferencePath, ...corridorReference },
      rooftop: { path: rooftopReferencePath, ...rooftopReference },
    },
    candidate_evidence: {
      corridor: { path: corridorPath, ...corridor },
      rooftop: { path: rooftopPath, ...rooftop },
    },
    checks: evaluation.checks,
    blocked_surfaces: [
      'character visual approval',
      'external/IP approval',
      'public asset promotion',
      'release approval',
    ],
  };
}
