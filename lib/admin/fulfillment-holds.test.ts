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
    expect(fulfillmentHoldReleaseError('42501')).toContain('권한');
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
