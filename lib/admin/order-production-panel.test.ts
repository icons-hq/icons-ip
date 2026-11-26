import { describe, expect, it } from 'vitest';
import { productionActionable, productionConfirmRequest, productionLockReason } from './order-production-panel';

const job = { goodName: '각인 키링', quantity: 2, claimId: null as string | null, state: 'pending' as const, basisAt: '2026-11-26T01:00:00Z' as string | null, canStart: false, canComplete: false };

describe('제작 상품이 지금 기록할 수 없는 이유', () => {
  it('기록할 수 있거나 이미 끝난 상품에는 이유를 달지 않는다', () => {
    expect(productionLockReason({ ...job, canStart: true })).toBeNull();
    expect(productionLockReason({ ...job, state: 'started', canComplete: true })).toBeNull();
    expect(productionLockReason({ ...job, state: 'completed' })).toBeNull();
    expect(productionLockReason({ ...job, state: 'canceled' })).toBeNull();
    expect(productionActionable({ canStart: false, canComplete: true })).toBe(true);
  });
  it('교환 제작은 회수 확인, 결제 확인 전, 그 밖의 주문 상태·취소 요청을 구분한다', () => {
    expect(productionLockReason({ ...job, claimId: 'c3a00000-0000-4002-8000-000000000041' })).toBe('교환 제작은 회수 확인(하자·오배송은 회수 생략 기록)을 마친 뒤에 할 수 있습니다.');
    expect(productionLockReason({ ...job, basisAt: null })).toBe('결제가 확인된 뒤에 시작할 수 있습니다.');
    expect(productionLockReason(job)).toBe('결제 확인 전이거나, 취소 요청이 진행 중이거나, 이미 발송이 시작된 주문이라 지금은 기록할 수 없습니다.');
    expect(productionLockReason({ ...job, state: 'started' })).toBe('결제 확인 전이거나, 취소 요청이 진행 중이거나, 이미 발송이 시작된 주문이라 지금은 기록할 수 없습니다.');
  });
});

describe('제작 시작·완료 확인창', () => {
  it('시작은 대상과 되돌릴 수 없다는 사실을 말한다', () => {
    expect(productionConfirmRequest(job, 'start')).toEqual({ title: '제작 시작으로 기록할까요?', message: '각인 키링 · 2개\n기록한 뒤에는 되돌릴 수 없습니다.', confirmLabel: '제작 시작으로 기록', cancelLabel: '돌아가기' });
  });
  it('완료는 이 상품이 든 배송 건을 출고지시·발송할 수 있게 된다는 결과를 더한다', () => {
    const request = productionConfirmRequest(job, 'complete');
    expect(request).toMatchObject({ title: '제작 완료로 기록할까요?', confirmLabel: '제작 완료로 기록', cancelLabel: '돌아가기' });
    expect(request.message).toBe('각인 키링 · 2개\n제작이 끝나야 이 상품이 든 배송 건을 출고지시·발송할 수 있습니다. 기록한 뒤에는 되돌릴 수 없습니다.');
  });
  it('교환 제작은 출고 흐름이 달라 그 결과는 말하지 않고 교환 제작임을 밝힌다', () => {
    const request = productionConfirmRequest({ ...job, claimId: 'c3a00000-0000-4002-8000-000000000041' }, 'complete');
    expect(request.message).toBe('각인 키링 · 2개 (교환 제작)\n기록한 뒤에는 되돌릴 수 없습니다.');
  });
});
