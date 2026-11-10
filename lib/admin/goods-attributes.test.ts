import { expect, it } from 'vitest';
import { goodsAttributeSubmissionReady } from './goods-attributes';

it('blocks saving while a category change still carries the previous schema snapshot', () => {
  const previous = '94900000-0000-4000-8000-000000000122', next = '94900000-0000-4000-8000-000000000101';
  const submission = (categoryId: string | null) => JSON.stringify({ categoryId, schemaRevision: 0, expectedRevision: 0, values: {}, removeIds: [] });
  expect(goodsAttributeSubmissionReady('', next)).toBe(false);
  expect(goodsAttributeSubmissionReady(submission(previous), next)).toBe(false);
  expect(goodsAttributeSubmissionReady(submission(next), next)).toBe(true);
  expect(goodsAttributeSubmissionReady(submission(null), '')).toBe(true);
  expect(goodsAttributeSubmissionReady('{}', next)).toBe(false);
});
