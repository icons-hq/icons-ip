import { describe, expect, it } from 'vitest';
import {
  fulfillmentHoldBadgeLabel,
  fulfillmentHoldGuidance,
  fulfillmentHoldReleaseError,
  isFulfillmentHoldError,
  parseOrderFulfillmentHoldList,
  parseOrderFulfillmentHolds,
} from './fulfillment-holds';
import { statusTone } from './status-tone';
import { AUTO_ORDER_CONFIRMATION_EXCLUSIONS } from './auto-order-confirmation';

const ORDER_ID = '20000000-0000-4000-8000-000000000651';
const OTHER_ID = '20000000-0000-4000-8000-000000000652';
const testHold = { reason: 'test_payment', placedAt: '2026-11-18T01:00:00Z', providerStatus: null, providerCanceledAmount: null, unexplainedAmount: null, paymentAmount: 31000, outboundBlocked: true };
const canceledHold = { reason: 'provider_canceled', placedAt: '2026-11-18T02:00:00Z', providerStatus: 'CANCELED', providerCanceledAmount: 31000, unexplainedAmount: 31000, paymentAmount: 31000, outboundBlocked: true };

describe('출고 보류 읽기', () => {
  it('주문 id별 보류를 읽고, 요청하지 않은 주문·모르는 사유·빈 목록은 실패로 본다', () => {
    expect(parseOrderFulfillmentHolds({ [ORDER_ID]: [testHold, canceledHold] }, [ORDER_ID, OTHER_ID])?.get(ORDER_ID)).toEqual([testHold, canceledHold]);
    expect(parseOrderFulfillmentHolds({}, [ORDER_ID])?.size).toBe(0);
    expect(parseOrderFulfillmentHolds({ [OTHER_ID]: [testHold] }, [ORDER_ID])).toBeNull();
    expect(parseOrderFulfillmentHolds({ [ORDER_ID]: [{ ...testHold, reason: 'other' }] }, [ORDER_ID])).toBeNull();
    expect(parseOrderFulfillmentHolds({ [ORDER_ID]: [] }, [ORDER_ID])).toBeNull();
    expect(parseOrderFulfillmentHolds(null, [ORDER_ID])).toBeNull();
  });

  it('보류 주문 목록(전체 건수·오래된 순 항목)', () => {
    expect(parseOrderFulfillmentHoldList({ total: 3, items: [{ orderId: ORDER_ID, orderNumber: '2026111800000001', status: 'paid', holds: [testHold] }] }))
      .toEqual({ total: 3, items: [{ orderId: ORDER_ID, orderNumber: '2026111800000001', status: 'paid', holds: [testHold] }] });
    expect(parseOrderFulfillmentHoldList({ total: 0, items: [] })).toEqual({ total: 0, items: [] });
    expect(parseOrderFulfillmentHoldList({ total: -1, items: [] })).toBeNull();
    expect(parseOrderFulfillmentHoldList({ total: 1, items: [{ orderId: 'x', status: 'paid', holds: [testHold] }] })).toBeNull();
  });
});

describe('출고 보류 안내', () => {
  it('사유별로 다음 행동을 말한다 — 테스트 결제는 운영자 전액 취소, 전액 취소는 이미 취소된 결제로 닫힘, 부분 취소는 마저 취소하거나 해제', () => {
    expect(fulfillmentHoldGuidance(testHold as never)).toContain('운영자 전액 취소');
    expect(fulfillmentHoldGuidance(testHold as never)).toContain('실제 돈이 결제되지 않았');
    expect(fulfillmentHoldGuidance(canceledHold as never)).toContain('전액 취소되었습니다(취소 31,000원)');
    expect(fulfillmentHoldGuidance(canceledHold as never)).toContain('이미 취소된 결제로 확인');
    const partial = fulfillmentHoldGuidance({ ...canceledHold, providerStatus: 'PARTIAL_CANCELED', providerCanceledAmount: 5000, unexplainedAmount: 3000 } as never);
    expect(partial).toContain('시스템 모르게 취소되었습니다(취소 3,000원)');
    expect(partial).toContain('사유를 적고 보류를 해제');
  });

  it('테스트 결제 안내는 \'테스트 키\' 같은 개발 말 대신 테스트 결제라고 말한다', () => {
    expect(fulfillmentHoldGuidance(testHold as never)).toContain('토스 테스트 결제로 승인된 주문입니다');
    expect(fulfillmentHoldGuidance({ ...testHold, outboundBlocked: false } as never)).toContain('토스 테스트 결제로 승인된');
    expect(fulfillmentHoldGuidance(testHold as never)).not.toContain('테스트 키');
    expect(fulfillmentHoldGuidance({ ...testHold, outboundBlocked: false } as never)).not.toContain('테스트 키');
  });

  it('이미 발송된 주문의 보류는 경고다 — 운영자 전액 취소 대신 반품 접수 또는 사유 적고 해제를 말하고 배지도 나눈다', () => {
    const shipped = { ...canceledHold, outboundBlocked: false } as never;
    expect(fulfillmentHoldGuidance(shipped)).toContain('배송완료 처리는 막지 않습니다');
    expect(fulfillmentHoldGuidance(shipped)).toContain('반품을 접수');
    expect(fulfillmentHoldGuidance(shipped)).toContain('운영자 전액 취소는 발송 전 주문에서만');
    expect(fulfillmentHoldGuidance({ ...testHold, outboundBlocked: false } as never)).toContain('반품을 접수');
    expect(fulfillmentHoldBadgeLabel(shipped)).toBe('발송 후 결제사 취소 확인');
    expect(fulfillmentHoldBadgeLabel(canceledHold as never)).toBe('출고 보류 · 결제사 취소');
    expect(statusTone('fulfillmentHold', 'shipped')).toBe('warning');
    // 모르는 값은 막는 쪽으로 읽는다.
    expect(parseOrderFulfillmentHolds({ [ORDER_ID]: [{ reason: 'test_payment' }] }, [ORDER_ID])?.get(ORDER_ID)?.[0].outboundBlocked).toBe(true);
  });

  it('해제 오류·출고 거절 문구', () => {
    expect(fulfillmentHoldReleaseError('42501')).toContain('이 작업을 할 권한이 없습니다');
    expect(fulfillmentHoldReleaseError('PT409', 'fulfillment_hold_operation_conflict')).not.toContain('요청');
    expect(fulfillmentHoldReleaseError('23514', 'fulfillment_hold_not_active')).toContain('이미 해제된');
    expect(fulfillmentHoldReleaseError('PT409', 'fulfillment_hold_operation_conflict')).toContain('다른 내용');
    expect(fulfillmentHoldReleaseError('22023', 'invalid_fulfillment_hold_release')).toContain('5자 이상');
    expect(isFulfillmentHoldError('order fulfillment hold')).toBe(true);
    expect(isFulfillmentHoldError('order cancellation in progress')).toBe(false);
  });

  it('상태 색과 자동 발주확인 제외 사유는 표 한 곳에서 온다', () => {
    expect(statusTone('fulfillmentHold', 'test_payment')).toBe('danger');
    expect(statusTone('fulfillmentHold', 'provider_canceled')).toBe('danger');
    expect(AUTO_ORDER_CONFIRMATION_EXCLUSIONS.fulfillment_hold).toContain('출고 보류');
  });
});

/* 토스 가상계좌(ADR-0049): 은행이 되돌린 입금(deposit_reversed)과 구매자의 에스크로 취소 신청(escrow_cancel_requested). */
describe('가상계좌 출고 보류 사유', () => {
  const reversed = { ...testHold, reason: 'deposit_reversed', providerStatus: 'WAITING_FOR_DEPOSIT', paymentAmount: 32000 };
  const escrow = { ...testHold, reason: 'escrow_cancel_requested', paymentAmount: 32000 };

  it('두 사유를 읽고 배지에 운영자 이름을 쓴다', () => {
    expect(parseOrderFulfillmentHolds({ [ORDER_ID]: [reversed, escrow] }, [ORDER_ID])?.get(ORDER_ID)?.map(hold => hold.reason)).toEqual(['deposit_reversed', 'escrow_cancel_requested']);
    expect(fulfillmentHoldBadgeLabel(reversed as never)).toBe('출고 보류 · 입금 오류 되돌림');
    expect(fulfillmentHoldBadgeLabel(escrow as never)).toBe('출고 보류 · 에스크로 취소 요청');
    expect(fulfillmentHoldBadgeLabel({ ...escrow, outboundBlocked: false } as never)).toBe('발송 후 에스크로 취소 요청 확인');
  });

  it('입금 오류 되돌림은 상점관리자 확인 뒤 해제 또는 운영자 전액 취소, 에스크로 취소 요청은 운영자 전액 취소가 수락이라고 말한다', () => {
    const reversedText = fulfillmentHoldGuidance(reversed as never);
    expect(reversedText).toContain('은행이 그 입금을 취소');
    expect(reversedText).toContain('토스페이먼츠 상점관리자');
    expect(reversedText).toContain('운영자 전액 취소');
    expect(fulfillmentHoldGuidance({ ...reversed, outboundBlocked: false } as never)).toContain('반품을 접수');
    const escrowText = fulfillmentHoldGuidance(escrow as never);
    expect(escrowText).toContain('구매안전서비스(에스크로)');
    expect(escrowText).toContain('운영자 전액 취소를 누르면 구매자의 취소 신청을 수락');
    expect(fulfillmentHoldGuidance({ ...escrow, outboundBlocked: false } as never)).toContain('반품을 접수');
  });
});

/* 입금 오류 되돌림 자동 처리(ADR-0049 결정 4, 2026-11-24): 처리 중이면 할 일 없음, 확인 필요면 사유별 다음 일. */
describe('입금 오류 되돌림 처리 상태', () => {
  const base = { ...testHold, reason: 'deposit_reversed', providerStatus: 'WAITING_FOR_DEPOSIT', paymentAmount: 32000 };

  it('처리 상태를 읽는다 — 모르는 확인 코드는 버리고, 되돌림 밖 사유에는 붙이지 않는다', () => {
    const parsed = parseOrderFulfillmentHolds({ [ORDER_ID]: [
      { ...base, depositReversal: { state: 'review', dueAt: '2026-11-25T15:00:00Z', reviewCode: 'order_shipped', released: true } },
      { ...testHold, depositReversal: { state: 'review', reviewCode: 'order_shipped' } },
    ] }, [ORDER_ID])!.get(ORDER_ID)!;
    expect(parsed[0].depositReversal).toEqual({ state: 'review', dueAt: '2026-11-25T15:00:00Z', reviewCode: 'order_shipped', released: true });
    expect(parsed[1]).not.toHaveProperty('depositReversal');
    const unknown = parseOrderFulfillmentHolds({ [ORDER_ID]: [{ ...base, depositReversal: { state: 'review', reviewCode: 'later_code' } }] }, [ORDER_ID])!;
    expect(unknown.get(ORDER_ID)![0].depositReversal).toEqual({ state: 'review', dueAt: null, reviewCode: null, released: false });
    const closed = parseOrderFulfillmentHolds({ [ORDER_ID]: [{ ...base, depositReversal: { state: 'closed' } }] }, [ORDER_ID])!;
    expect(closed.get(ORDER_ID)![0].depositReversal).toBeNull();
  });

  it('시스템이 처리 중이면 출고하지 말고 따로 할 일이 없다고 말한다(입금 기한·자동 해제·자동 취소)', () => {
    const text = fulfillmentHoldGuidance({ ...base, depositReversal: { state: 'awaiting_redeposit', dueAt: '2026-11-25T15:00:00Z', reviewCode: null, released: false } } as never);
    expect(text).toContain('출고하지 마세요');
    expect(text).toContain('자동으로 풀리고');
    expect(text).toContain('자동 취소');
    expect(text).toContain('환불 없음');
    expect(text).toContain('따로 할 일은 없습니다');
    expect(text).not.toContain('상점관리자');
  });

  it('확인 필요는 사유별 다음 일을 말한다 — 발송된 주문은 취소하지 않고, 그 밖은 결제 없이 취소(환불 계좌 불필요)', () => {
    const review = (reviewCode: string, released = false) => fulfillmentHoldGuidance({
      ...base, depositReversal: { state: 'review', dueAt: null, reviewCode, released },
    } as never);
    expect(review('order_shipped', true)).toContain('반품을 접수');
    expect(review('order_shipped', true)).toContain('더 입금되지 않습니다');
    expect(review('order_shipped')).toContain('늦게라도 다시 입금되면');
    expect(review('lookup_failed')).toContain('환불 계좌 필요 없음');
    expect(review('payment_mismatch')).toContain('결제 담당자');
    expect(review('provider_refunded')).toContain('환불 내역');
    expect(review('cancellation_pending')).toContain('취소·반품·교환 관리에서 그 요청을 처리하면');
    expect(review('close_failed')).toContain('운영자 전액 취소');
  });
});

