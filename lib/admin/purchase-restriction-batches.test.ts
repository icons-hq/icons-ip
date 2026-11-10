import { describe, expect, it } from 'vitest';
import { parsePurchaseRestrictionBatch, parsePurchaseRestrictionBatchForm, purchaseRestrictionBatchHref, splitPurchaseRestrictionTargets } from './purchase-restriction-batches';
const id = '00000000-0000-4000-8000-000000063521';
const row = { rowNumber: 1, input: 'customer@example.test', userId: '00000000-0000-4000-8000-000000063501', nickname: '합성 고객', maskedEmail: 'c***@example.test', evidenceOrderId: null, status: 'ready', duplicateOf: null, restrictionId: null, outcome: null, error: null, currentState: null, releasedAt: null };
const batch = { id, mode: 'customer', reasonCode: 'other', reasonDetail: '확인된 운영 근거', createdAt: '2026-10-12T00:00:00Z', expiresAt: '2026-10-12T00:15:00Z', completedAt: null, status: 'prepared', canExecute: true, readyCount: 1, registeredCount: 0, skippedCount: 0, failedCount: 0, rows: [row] };
describe('판매방해 고객 복수등록 계약', () => {
  it('줄바꿈·쉼표를 지원하고 중복 행을 보존하여 서버가 같은 고객을 판별한다', () => {
    expect(splitPurchaseRestrictionTargets(' Customer@Example.test,\r\ncustomer@example.test\n '+id)).toEqual({ ok: true, targets: ['customer@example.test', 'customer@example.test', id] });
    expect(splitPurchaseRestrictionTargets('형식확인대상')).toEqual({ ok: true, targets: ['형식확인대상'] });
  });
  it('101건·긴 식별자는 입력 단계에서 막고 제한 사유를 검증한다', () => {
    expect(splitPurchaseRestrictionTargets(Array.from({ length: 101 }, (_, i) => `c${i}@example.test`).join('\n'))).toMatchObject({ ok: false });
    expect(splitPurchaseRestrictionTargets('a'.repeat(255))).toMatchObject({ ok: false });
    const form = new FormData(); Object.entries({ batchId: id, mode: 'customer', targets: 'c@example.test', reasonCode: 'other', reasonDetail: '' }).forEach(([k, v]) => form.set(k, v));
    expect(parsePurchaseRestrictionBatchForm(form)).toMatchObject({ ok: false, errors: { reasonDetail: expect.any(String) } });
    form.set('reasonDetail', '확인된 근거\n추가 설명'); expect(parsePurchaseRestrictionBatchForm(form)).toMatchObject({ ok: true });
  });
  it('미리보기와 최종 등록 결과·현재 해제를 별개로 읽으며 거짓 합계를 거부한다', () => {
    expect(parsePurchaseRestrictionBatch(batch)).toEqual(batch);
    const completed = { ...batch, status: 'completed', canExecute: false, completedAt: '2026-10-12T00:01:00Z', registeredCount: 1,
      rows: [{ ...row, outcome: 'registered', restrictionId: id, currentState: 'released', releasedAt: '2026-10-12T00:02:00Z' }] };
    expect(parsePurchaseRestrictionBatch(completed)).toEqual(completed);
    expect(parsePurchaseRestrictionBatch({ ...completed, registeredCount: 2 })).toBeNull();
    expect(parsePurchaseRestrictionBatch({ ...completed, rows: [{ ...completed.rows[0], restrictionId: null }] })).toBeNull();
    expect(parsePurchaseRestrictionBatch({ ...batch, rows: [{ ...row, status: 'duplicate', duplicateOf: 1 }] })).toBeNull();
  });
  it('결과 재열기 링크에 기존 목록 조건을 보존한다', () => {
    expect(purchaseRestrictionBatchHref('/admin/sales/purchase-restrictions?state=released&page=2', id)).toBe(`/admin/sales/purchase-restrictions?state=released&page=2&batch=${id}`);
  });
});
