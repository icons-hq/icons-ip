import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const KINDS = new Set(['sprite', 'tileset', 'background', 'boss', 'cutin', 'ui']);
const ALPHA_POLICIES = new Set(['required', 'forbidden', 'optional']);
const REQUIRED_FORBIDDEN = ['gore', 'webtoon-elements', 'wrong-season-elements'];
const REQUIRED_FIDELITY_TARGETS = [
  'season-1-production-design',
  'canonical-actor-likeness',
  'uniform-costume-continuity',
];

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid asset spec: ${message}`);
}

export function parseSize(value, field) {
  assert(typeof value === 'string' && /^\d+x\d+$/.test(value), `${field} must be WIDTHxHEIGHT`);
  const [width, height] = value.split('x').map(Number);
  assert(width > 0 && height > 0, `${field} dimensions must be positive`);
  return { width, height };
}

export function validateAssetSpec(input) {
  assert(input && typeof input === 'object', 'root must be an object');
  assert(input.schemaVersion === 1, 'schemaVersion must be 1');
  assert(input.meta && typeof input.meta === 'object', 'meta is required');
  assert(typeof input.meta.styleRef === 'string' && input.meta.styleRef.trim(), 'meta.styleRef is required');
  assert(Array.isArray(input.meta.fidelityTargets), 'meta.fidelityTargets must be an array');
  for (const target of REQUIRED_FIDELITY_TARGETS) {
    assert(input.meta.fidelityTargets.includes(target), `meta.fidelityTargets must include ${target}`);
  }
  assert(Array.isArray(input.meta.forbidden), 'meta.forbidden must be an array');
  assert(!input.meta.forbidden.includes('actor-likeness'),
    'meta.forbidden must not reject licensed canonical actor likeness');
  for (const guard of REQUIRED_FORBIDDEN) {
    assert(input.meta.forbidden.includes(guard), `meta.forbidden must include ${guard}`);
  }
  assert(input.pipeline && typeof input.pipeline === 'object', 'pipeline is required');
  assert(Number.isInteger(input.pipeline.maxAttempts), 'pipeline.maxAttempts must be an integer');
  assert(input.pipeline.maxAttempts >= 1 && input.pipeline.maxAttempts <= 3,
    'pipeline.maxAttempts must be between 1 and 3');
  assert(input.pipeline.atlas && typeof input.pipeline.atlas.name === 'string',
    'pipeline.atlas.name is required');
  assert(Array.isArray(input.assets) && input.assets.length > 0, 'assets must be a non-empty array');

  const ids = new Set();
  const assets = input.assets.map((asset, index) => {
    const prefix = `assets[${index}]`;
    assert(asset && typeof asset === 'object', `${prefix} must be an object`);
    assert(typeof asset.id === 'string' && /^[a-z0-9_]+$/.test(asset.id),
      `${prefix}.id must use snake_case ASCII`);
    assert(!ids.has(asset.id), `${prefix}.id duplicates ${asset.id}`);
    ids.add(asset.id);
    assert(KINDS.has(asset.kind), `${prefix}.kind is unsupported`);
    assert(typeof asset.view === 'string' && asset.view.trim(), `${prefix}.view is required`);
    const targetSize = parseSize(asset.size, `${prefix}.size`);
    assert(Number.isInteger(asset.frames) && asset.frames > 0, `${prefix}.frames must be positive`);
    assert(ALPHA_POLICIES.has(asset.alpha), `${prefix}.alpha is unsupported`);
    assert(typeof asset.promptBrief === 'string' && asset.promptBrief.trim(),
      `${prefix}.promptBrief is required`);
    assert(asset.qa && Number.isFinite(asset.qa.minScore)
      && asset.qa.minScore >= 0 && asset.qa.minScore <= 1,
    `${prefix}.qa.minScore must be between 0 and 1`);
    assert(Number.isFinite(asset.qa.minSourceFidelity)
      && asset.qa.minSourceFidelity >= 0 && asset.qa.minSourceFidelity <= 1,
    `${prefix}.qa.minSourceFidelity must be between 0 and 1`);
    const minSourceSize = parseSize(asset.qa.minSourceSize, `${prefix}.qa.minSourceSize`);
    for (const field of ['maxOpaqueEdgeRatio', 'minBboxCoverage', 'maxBboxCoverage']) {
      assert(Number.isFinite(asset.qa[field]) && asset.qa[field] >= 0 && asset.qa[field] <= 1,
        `${prefix}.qa.${field} must be between 0 and 1`);
    }
    assert(asset.qa.minBboxCoverage <= asset.qa.maxBboxCoverage,
      `${prefix}.qa bbox coverage range is inverted`);
    return { ...asset, targetSize, qa: { ...asset.qa, minSourceSize } };
  });

  return { ...input, assets };
}

export async function loadAssetSpec(path) {
  const filePath = path instanceof URL ? fileURLToPath(path) : path;
  const source = await readFile(filePath, 'utf8');
  return validateAssetSpec(yaml.load(source));
}
