import { describe, expect, it } from 'vitest';
import { normalizeRestrictionRelease, parseRestrictionReleaseReceipt } from './purchase-restriction-release';
const id = 'abcdef00-0000-7000-8000-000000000001';
const id2 = 'abcdef00-0000-7000-8000-000000000002';
describe('구매제한 선택 해제 계약', () => {
  it('고정 대상은 canonical UUID로 정렬하며 중복과 100건 초과는 거절한다', () => {
    expect(normalizeRestrictionRelease(id, [id2.toUpperCase(), id], ' 근거 확인 ')).toEqual({ value: { id, ids: [id, id2], reason: '근거 확인' } });
    expect(normalizeRestrictionRelease(id, [id, id.toUpperCase()], '사유')).toHaveProperty('error');
    expect(normalizeRestrictionRelease(id, Array.from({ length: 101 }, (_, n) => `abcdef00-0000-7000-8000-${String(n).padStart(12, '0')}`), '사유')).toHaveProperty('error');
    expect(normalizeRestrictionRelease(id, [id], '\n')).toHaveProperty('error');
    expect(normalizeRestrictionRelease(id, [id], '가'.repeat(201))).toHaveProperty('error');
    expect(normalizeRestrictionRelease(id, [id], '한 줄\n두 줄')).toHaveProperty('error');
  });
  it('결과 없는 기록과 실제 해제 기록의 필드를 구분한다', () => {
    const receipt = { id, reason: '사유', completedAt: '2026-10-13T00:00:00Z', rows: [{ id: id2, userId: null, outcome: 'not_found', releasedAt: null, customerRestricted: null }] };
    expect(parseRestrictionReleaseReceipt(receipt)).toEqual(receipt);
    expect(parseRestrictionReleaseReceipt({ ...receipt, rows: [{ ...receipt.rows[0], outcome: 'released' }] })).toBeNull();
    expect(parseRestrictionReleaseReceipt({ ...receipt, rows: [receipt.rows[0], receipt.rows[0]] })).toBeNull();
  });
});
