import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { assetKindSupports, isSupportedAssetKind } from './asset-kinds.mjs';
import { validateModuleGridSpec } from './module-grid.mjs';
import { decodeUtf8Strict } from './strict-utf8.mjs';

const ALPHA_POLICIES = new Set(['required', 'forbidden', 'optional']);
const IDENTITY_MODES = new Set(['canonical', 'original', 'not-applicable']);
const REQUIRED_FORBIDDEN = ['gore', 'webtoon-elements', 'wrong-season-elements'];
const REQUIRED_FIDELITY_TARGETS = [
  'season-1-production-design',
  'canonical-actor-likeness',
  'uniform-costume-continuity',
];
const REFERENCE_SOURCE_FIELDS = ['id', 'authority', 'url'];
const FRAME_LAYOUT_FIELDS = ['columns', 'rows', 'order', 'anchor', 'trim'];
const FRAME_LAYOUT_ORDER = 'row-major';
const FRAME_LAYOUT_ANCHOR = 'bottom-center';
const FRAME_LAYOUT_TRIM = 'shared-scale';
const DEFAULT_APPROVAL_BLOCKS = Object.freeze([
  'M1',
  'mass-production',
  'phaser-integration',
]);
const OFFICIAL_REFERENCE_REGISTRY = Object.freeze({
  'netflix-season-1-stills': 'https://about.netflix.com/ko/news/help-is-not-coming-all-of-us-are-dead-released-new-teaser-trailer-and-stills',
  'netflix-cast-guide': 'https://www.netflix.com/tudum/articles/all-of-us-are-dead-cast-characters',
  'netflix-season-1-featurette': 'https://www.youtube.com/watch?v=38h_mFMYc8Y',
  'netflix-korea-cafeteria-clip': 'https://www.youtube.com/watch?v=mh3a3Bj-IPY',
});

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid asset spec: ${message}`);
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertExactFields(value, expected, field) {
  assert(value && typeof value === 'object' && !Array.isArray(value),
    `${field} must be an object`);
  const actual = Object.keys(value);
  const unsupported = actual.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !Object.hasOwn(value, name));
  assert(unsupported.length === 0, `${field} has unsupported fields: ${unsupported.join(', ')}`);
  assert(missing.length === 0, `${field} is missing fields: ${missing.join(', ')}`);
}

function assertSafeRepositoryRelativePath(value, field) {
  assert(typeof value === 'string' && value.trim() === value && value.length > 0,
    `${field} must be a non-empty repository-relative path`);
  assert(!isAbsolute(value) && !/^[a-zA-Z]:[\\/]/.test(value),
    `${field} must be repository-relative`);
  assert(!value.includes('\\'), `${field} must use forward slashes`);
  assert(value.split('/').every((segment) => segment && segment !== '.' && segment !== '..'),
    `${field} must not contain empty, current-directory, or parent-directory segments`);
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
  assert(typeof input.meta.project === 'string' && input.meta.project.trim(),
    'meta.project is required');
  assert(typeof input.meta.milestone === 'string' && input.meta.milestone.trim(),
    'meta.milestone is required');
  assert(typeof input.meta.styleRef === 'string' && input.meta.styleRef.trim(), 'meta.styleRef is required');
  assert(typeof input.meta.rightsScope === 'string' && input.meta.rightsScope.trim(),
    'meta.rightsScope is required');
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
  assert(Array.isArray(input.meta.referenceSources) && input.meta.referenceSources.length > 0,
    'meta.referenceSources must be a non-empty array');
  const knownReferenceIds = new Set();
  const knownReferenceUrls = new Set();
  input.meta.referenceSources.forEach((source, index) => {
    const field = `meta.referenceSources[${index}]`;
    assertExactFields(source, REFERENCE_SOURCE_FIELDS, field);
    assert(typeof source.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(source.id),
      `${field}.id must be a safe lowercase ASCII identifier`);
    assert(!knownReferenceIds.has(source.id), `${field}.id duplicates ${source.id}`);
    knownReferenceIds.add(source.id);
    assert(source.authority === 'official', `${field}.authority must be official`);
    let referenceUrl;
    try {
      referenceUrl = new URL(source.url);
    } catch {
      assert(false, `${field}.url must be an absolute HTTPS URL`);
    }
    assert(referenceUrl.protocol === 'https:', `${field}.url must be an absolute HTTPS URL`);
    const canonicalUrl = referenceUrl.href;
    assert(!knownReferenceUrls.has(canonicalUrl), `${field}.url duplicates ${canonicalUrl}`);
    knownReferenceUrls.add(canonicalUrl);
    assert(OFFICIAL_REFERENCE_REGISTRY[source.id] === source.url,
      `${field} must match the registered official source id and URL`);
  });
  assert(input.pipeline && typeof input.pipeline === 'object', 'pipeline is required');
  for (const field of ['planner', 'generator', 'visionQa']) {
    assert(typeof input.pipeline[field] === 'string' && input.pipeline[field].trim(),
      `pipeline.${field} is required`);
  }
  assert(Number.isInteger(input.pipeline.maxAttempts), 'pipeline.maxAttempts must be an integer');
  assert(input.pipeline.maxAttempts >= 1 && input.pipeline.maxAttempts <= 3,
    'pipeline.maxAttempts must be between 1 and 3');
  assertSafeRepositoryRelativePath(input.pipeline.workDirectory, 'pipeline.workDirectory');
  assertSafeRepositoryRelativePath(input.pipeline.outputDirectory, 'pipeline.outputDirectory');
  assert(input.pipeline.atlas && typeof input.pipeline.atlas === 'object',
    'pipeline.atlas is required');
  assert(typeof input.pipeline.atlas.name === 'string'
    && /^[a-z0-9][a-z0-9_-]*$/.test(input.pipeline.atlas.name),
  'pipeline.atlas.name must be a safe lowercase ASCII basename');
  assert(Number.isInteger(input.pipeline.atlas.padding) && input.pipeline.atlas.padding >= 0,
    'pipeline.atlas.padding must be a non-negative integer');
  const atlasExtrusion = input.pipeline.atlas.extrusion ?? 0;
  assert(Number.isInteger(atlasExtrusion) && atlasExtrusion >= 0,
    'pipeline.atlas.extrusion must be a non-negative integer');
  assert(atlasExtrusion * 2 <= input.pipeline.atlas.padding,
    'pipeline.atlas.extrusion on both frame edges must not exceed padding');
  const atlasMaxSize = input.pipeline.atlas.maxSize ?? 4096;
  assert(Number.isInteger(atlasMaxSize)
    && atlasMaxSize >= 64
    && atlasMaxSize <= 8192
    && (atlasMaxSize & (atlasMaxSize - 1)) === 0,
  'pipeline.atlas.maxSize must be a power-of-two integer between 64 and 8192');
  const approvalBlocks = input.pipeline.approvalBlocks ?? DEFAULT_APPROVAL_BLOCKS;
  assert(Array.isArray(approvalBlocks) && approvalBlocks.length > 0,
    'pipeline.approvalBlocks must be a non-empty array');
  const uniqueApprovalBlocks = new Set();
  for (const [index, block] of approvalBlocks.entries()) {
    assert(typeof block === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(block),
      `pipeline.approvalBlocks[${index}] must be a safe identifier`);
    assert(!uniqueApprovalBlocks.has(block),
      `pipeline.approvalBlocks[${index}] duplicates ${block}`);
    uniqueApprovalBlocks.add(block);
  }
  assert(Array.isArray(input.assets) && input.assets.length > 0, 'assets must be a non-empty array');

  const ids = new Set();
  const assets = input.assets.map((asset, index) => {
    const prefix = `assets[${index}]`;
    assert(asset && typeof asset === 'object', `${prefix} must be an object`);
    assert(typeof asset.id === 'string' && /^[a-z0-9_]+$/.test(asset.id),
      `${prefix}.id must use snake_case ASCII`);
    assert(!ids.has(asset.id), `${prefix}.id duplicates ${asset.id}`);
    ids.add(asset.id);
    assert(typeof asset.label === 'string' && asset.label.trim(), `${prefix}.label is required`);
    assert(isSupportedAssetKind(asset.kind), `${prefix}.kind is unsupported`);
    assert(typeof asset.view === 'string' && asset.view.trim(), `${prefix}.view is required`);
    const targetSize = parseSize(asset.size, `${prefix}.size`);
    assert(Number.isInteger(asset.frames) && asset.frames > 0, `${prefix}.frames must be positive`);
    const frameLayout = asset.frameLayout ?? {
      columns: asset.frames,
      rows: 1,
      order: FRAME_LAYOUT_ORDER,
      anchor: FRAME_LAYOUT_ANCHOR,
      trim: FRAME_LAYOUT_TRIM,
    };
    assertExactFields(frameLayout, FRAME_LAYOUT_FIELDS, `${prefix}.frameLayout`);
    assert(Number.isInteger(frameLayout.columns) && frameLayout.columns > 0,
      `${prefix}.frameLayout.columns must be a positive integer`);
    assert(Number.isInteger(frameLayout.rows) && frameLayout.rows > 0,
      `${prefix}.frameLayout.rows must be a positive integer`);
    assert(frameLayout.columns * frameLayout.rows === asset.frames,
      `${prefix}.frameLayout must contain exactly ${asset.frames} cells`);
    assert(frameLayout.order === FRAME_LAYOUT_ORDER,
      `${prefix}.frameLayout.order must be ${FRAME_LAYOUT_ORDER}`);
    assert(frameLayout.anchor === FRAME_LAYOUT_ANCHOR,
      `${prefix}.frameLayout.anchor must be ${FRAME_LAYOUT_ANCHOR}`);
    assert(frameLayout.trim === FRAME_LAYOUT_TRIM,
      `${prefix}.frameLayout.trim must be ${FRAME_LAYOUT_TRIM}`);
    assert(ALPHA_POLICIES.has(asset.alpha), `${prefix}.alpha is unsupported`);
    assert(asset.identity && IDENTITY_MODES.has(asset.identity.mode),
      `${prefix}.identity.mode is unsupported`);
    if (assetKindSupports(asset.kind, 'characterIdentity')) {
      assert(asset.identity.mode !== 'not-applicable',
        `${prefix}.identity.mode cannot be not-applicable for ${asset.kind}`);
    }
    if (asset.identity.mode === 'canonical') {
      assert(typeof asset.identity.character === 'string' && asset.identity.character.trim(),
        `${prefix}.identity.character is required for canonical assets`);
      assert(typeof asset.identity.performer === 'string' && asset.identity.performer.trim(),
        `${prefix}.identity.performer is required for canonical assets`);
    }
    assert(Array.isArray(asset.referenceIds) && asset.referenceIds.length > 0,
      `${prefix}.referenceIds must be a non-empty array`);
    const assetReferenceIds = new Set();
    asset.referenceIds.forEach((referenceId, referenceIndex) => {
      assert(typeof referenceId === 'string' && referenceId.trim(),
        `${prefix}.referenceIds[${referenceIndex}] must be a non-empty string`);
      assert(knownReferenceIds.has(referenceId),
        `${prefix}.referenceIds[${referenceIndex}] references unknown official source ${referenceId}`);
      assert(!assetReferenceIds.has(referenceId),
        `${prefix}.referenceIds[${referenceIndex}] duplicates ${referenceId}`);
      assetReferenceIds.add(referenceId);
    });
    assert(typeof asset.promptBrief === 'string' && asset.promptBrief.trim(),
      `${prefix}.promptBrief is required`);
    assert(asset.qa && Number.isFinite(asset.qa.minScore)
      && asset.qa.minScore >= 0 && asset.qa.minScore <= 1,
    `${prefix}.qa.minScore must be between 0 and 1`);
    assert(Number.isFinite(asset.qa.minSourceFidelity)
      && asset.qa.minSourceFidelity >= 0.85 && asset.qa.minSourceFidelity <= 1,
    `${prefix}.qa.minSourceFidelity must be at least 0.85 and at most 1`);
    if (asset.qa.minCharacterIdentity !== undefined) {
      assert(Number.isFinite(asset.qa.minCharacterIdentity)
        && asset.qa.minCharacterIdentity >= 0 && asset.qa.minCharacterIdentity <= 1,
      `${prefix}.qa.minCharacterIdentity must be between 0 and 1`);
    }
    if (asset.identity.mode === 'canonical') {
      assert(Number.isFinite(asset.qa.minCharacterIdentity),
        `${prefix}.qa.minCharacterIdentity is required for canonical assets`);
    }
    const minSourceSize = parseSize(asset.qa.minSourceSize, `${prefix}.qa.minSourceSize`);
    for (const field of ['maxOpaqueEdgeRatio', 'minBboxCoverage', 'maxBboxCoverage']) {
      assert(Number.isFinite(asset.qa[field]) && asset.qa[field] >= 0 && asset.qa[field] <= 1,
        `${prefix}.qa.${field} must be between 0 and 1`);
    }
    assert(asset.qa.minBboxCoverage <= asset.qa.maxBboxCoverage,
      `${prefix}.qa bbox coverage range is inverted`);
    const moduleGrid = asset.kind === 'tileset'
      ? validateModuleGridSpec(asset.moduleGrid, targetSize)
      : undefined;
    assert(asset.kind === 'tileset' || asset.moduleGrid === undefined,
      `${prefix}.moduleGrid is only supported for tileset assets`);
    return {
      ...asset,
      targetSize,
      frameLayout,
      qa: { ...asset.qa, minSourceSize },
      ...(moduleGrid ? { moduleGrid } : {}),
    };
  });

  return {
    ...input,
    pipeline: {
      ...input.pipeline,
      approvalBlocks: [...approvalBlocks],
      atlas: {
        ...input.pipeline.atlas,
        extrusion: atlasExtrusion,
        maxSize: atlasMaxSize,
      },
    },
    assets,
  };
}

export async function loadAssetSpecDocument(path) {
  const filePath = path instanceof URL ? fileURLToPath(path) : path;
  const source = await readFile(filePath);
  const decoded = decodeUtf8Strict(source, 'asset spec');
  return { source, spec: deepFreeze(validateAssetSpec(yaml.load(decoded))) };
}

export async function loadAssetSpec(path) {
  return (await loadAssetSpecDocument(path)).spec;
}
