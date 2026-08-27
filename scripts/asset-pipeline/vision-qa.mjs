export const VISION_DIMENSIONS = Object.freeze([
  'sourceFidelity',
  'styleMatch',
  'characterIdentity',
  'topdownAngle',
  'gameplayReadability',
  'animationConsistency',
]);

export const VISION_GUARDS = Object.freeze([
  'gore',
  'webtoonElements',
  'wrongSeasonElements',
]);

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VISION_ROOT_FIELDS = [
  'assetId',
  'reviewedSha256',
  'dimensions',
  'guards',
  'feedback',
];
const DIMENSION_FIELDS = ['applicable', 'score', 'notes'];
const GUARD_FIELDS = ['detected', 'confidence', 'notes'];

function assert(condition, assetId, message) {
  if (!condition) throw new Error(`Invalid vision QA for ${assetId}: ${message}`);
}

function assertExactFields(value, expected, assetId, field) {
  const actual = Object.keys(value ?? {});
  const unsupported = actual.filter((name) => !expected.includes(name));
  assert(unsupported.length === 0, assetId,
    `${field} has unsupported fields: ${unsupported.join(', ')}`);
  for (const name of expected) {
    assert(Object.hasOwn(value ?? {}, name), assetId, `${field}.${name} is required`);
  }
}

export function validateVisionQaShape(review, assetId) {
  assert(review && typeof review === 'object' && !Array.isArray(review), assetId,
    'root must be an object');
  assertExactFields(review, VISION_ROOT_FIELDS, assetId, 'root');
  assert(review?.assetId === assetId, assetId, 'assetId does not match');
  assert(SHA256_PATTERN.test(review.reviewedSha256), assetId,
    'reviewedSha256 must be a lowercase SHA-256 digest');
  assert(review.dimensions && typeof review.dimensions === 'object', assetId,
    'dimensions is required');
  assertExactFields(review.dimensions, VISION_DIMENSIONS, assetId, 'dimensions');
  for (const name of VISION_DIMENSIONS) {
    const dimension = review.dimensions[name];
    assert(dimension && typeof dimension === 'object' && !Array.isArray(dimension), assetId,
      `dimensions.${name} must be an object`);
    assertExactFields(dimension, DIMENSION_FIELDS, assetId, `dimensions.${name}`);
    assert(dimension && typeof dimension.applicable === 'boolean', assetId,
      `dimensions.${name}.applicable must be boolean`);
    assert(Number.isFinite(dimension.score) && dimension.score >= 0 && dimension.score <= 1,
      assetId, `dimensions.${name}.score must be between 0 and 1`);
    assert(typeof dimension.notes === 'string' && dimension.notes.trim(), assetId,
      `dimensions.${name}.notes is required`);
  }
  assert(review.guards && typeof review.guards === 'object', assetId, 'guards is required');
  assertExactFields(review.guards, VISION_GUARDS, assetId, 'guards');
  for (const name of VISION_GUARDS) {
    const guard = review.guards[name];
    assert(guard && typeof guard === 'object' && !Array.isArray(guard), assetId,
      `guards.${name} must be an object`);
    assertExactFields(guard, GUARD_FIELDS, assetId, `guards.${name}`);
    assert(guard && typeof guard.detected === 'boolean', assetId,
      `guards.${name}.detected must be boolean`);
    assert(Number.isFinite(guard.confidence) && guard.confidence >= 0 && guard.confidence <= 1,
      assetId, `guards.${name}.confidence must be between 0 and 1`);
    assert(typeof guard.notes === 'string' && guard.notes.trim(), assetId,
      `guards.${name}.notes is required`);
  }
  assert(Array.isArray(review.feedback)
    && review.feedback.every((item) => typeof item === 'string' && item.trim()),
  assetId, 'feedback must be an array of non-empty strings');
  return review;
}

export function validateVisionQaForAsset(review, asset, expectedSha256, stage) {
  validateVisionQaShape(review, asset.id);
  assert(review.reviewedSha256 === expectedSha256, asset.id,
    `${stage} SHA-256 does not match the reviewed image`);
  const applicability = {
    sourceFidelity: true,
    styleMatch: true,
    characterIdentity: asset.identity.mode !== 'not-applicable',
    topdownAngle: true,
    gameplayReadability: true,
    animationConsistency: asset.frames > 1,
  };
  for (const [name, expected] of Object.entries(applicability)) {
    assert(review.dimensions[name].applicable === expected, asset.id,
      `${name}.applicable must be ${expected}`);
  }
  return review;
}
