import { describe, expect, it } from 'vitest';
import { FORCED_DELIVERY_BLOCKERS, forcedDeliveryBlockerLabel, forcedDeliveryError, normalizeForcedDeliveryOrderNumber, parseForcedDeliveryReceipt } from './forced-delivery';

describe('운영 강제 배송완료 값 (1014-083)', () => {
  it('주문번호는 공백·하이픈을 빼고 주문번호 형식(주문번호 모듈 판정)일 때만 받는다', () => {
    expect(normalizeForcedDeliveryOrderNumber(' 2026-1111-1000-0001 ')).toBe('2026111110000001');
    expect(normalizeForcedDeliveryOrderNumber('2026111130000001')).toBeNull();
    expect(normalizeForcedDeliveryOrderNumber(20261111)).toBeNull();
  });
  it('영수증은 정해진 여섯 값만 받고 처리 건수가 0이면 거절한다', () => {
    const receipt = { orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber: '2026111110000001', status: 'delivered', deliveredShipments: 1, orderCount: 1, deliveredAt: '2026-11-11T02:00:00Z' };
    expect(parseForcedDeliveryReceipt(receipt)).toEqual(receipt);
    expect(parseForcedDeliveryReceipt({ ...receipt, deliveredShipments: 0 })).toBeNull();
    expect(parseForcedDeliveryReceipt({ ...receipt, staging: true })).toBeNull();
  });
  it('막는 사유와 DB 거절은 모두 운영자 문구가 있다', () => {
    for (const blocker of FORCED_DELIVERY_BLOCKERS) expect(forcedDeliveryBlockerLabel(blocker).length).toBeGreaterThan(10);
    expect(forcedDeliveryError('P0002', 'forced_delivery_order_not_found')).toBe('주문번호에 해당하는 주문이 없습니다.');
    expect(forcedDeliveryError('42501')).toContain('배송 처리 권한');
    expect(forcedDeliveryError(undefined, 'order cancellation in progress')).toContain('클레임');
  });
});
