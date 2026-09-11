import { describe, expect, it } from 'vitest';
import { goodCloneMatrixRows, goodCloneResult, normalizeGoodCloneForm } from './good-clone';

describe('good clone contract', () => {
  it('normalizes optional new identity fields without inventing values', () => {
    expect(normalizeGoodCloneForm({ sourceGoodId: ' Original-Good ', newId: '', newCode: 'new-01', newName: ' 복사본 ' })).toEqual({
      ok: true,
      value: { sourceGoodId: 'original-good', newId: '', newCode: 'NEW-01', newName: '복사본' },
    });
  });

  it('rejects unsafe identities and long names before the RPC', () => {
    expect(normalizeGoodCloneForm({ sourceGoodId: '../source', newId: '한글', newCode: 'lower space', newName: 'x'.repeat(201) })).toMatchObject({
      ok: false,
      errors: { sourceGoodId: expect.any(String), newId: expect.any(String), newCode: expect.any(String), newName: expect.any(String) },
    });
  });

  it('keeps the approved copy matrix explicit and parses only safe RPC results', () => {
    expect(goodCloneMatrixRows().map((row) => row.label)).toEqual(['복사', '새로 생성', '초기화', '복사하지 않음']);
    expect(goodCloneResult({ id: 'copy-good', code: 'COPY-0001', sourceGoodId: 'source-good', operationId: 'op' })).toEqual({
      id: 'copy-good', code: 'COPY-0001', sourceGoodId: 'source-good', operationId: 'op',
    });
    expect(goodCloneResult({ id: 'bad id', code: 'COPY-0001', sourceGoodId: 'source-good' })).toBeNull();
  });
});
