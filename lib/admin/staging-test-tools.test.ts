import { describe, expect, it } from 'vitest';
import { ORDER_NUMBER_PATTERN, parseStagingTestDeliveryReceipt, stagingTestDeliveryError } from './staging-test-tools';

const receipt = (orderNumber: string) => ({
  orderId: 'a0c20000-0000-4001-8000-000000000001', orderNumber, status: 'delivered', deliveredShipments: 1, orderCount: 1, deliveredAt: '2026-11-12T05:36:00Z',
});

describe('테스트 배송완료 주문번호', () => {
  it('옛 16자리와 주문 시각 20자리 주문번호를 모두 받는다', () => {
    expect(ORDER_NUMBER_PATTERN.test('2026102710000001')).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test('20261112143510000042')).toBe(true);
  });

  it('상품주문·배송건번호와 시각이 틀린 번호는 받지 않는다', () => {
    for (const value of ['2026102720000001', '20261112143520000042', '2026102730000001', '20261112246010000042', '202611121435100000042']) {
      expect(ORDER_NUMBER_PATTERN.test(value), value).toBe(false);
    }
  });

  it('DB 영수증의 주문번호도 두 형식을 모두 읽는다', () => {
    expect(parseStagingTestDeliveryReceipt(receipt('20261112143510000042'))).toEqual(receipt('20261112143510000042'));
    expect(parseStagingTestDeliveryReceipt(receipt('2026102710000001'))).toEqual(receipt('2026102710000001'));
    expect(parseStagingTestDeliveryReceipt(receipt('20261112143520000042'))).toBeNull();
  });

  it('형식이 틀리면 두 길이를 함께 안내한다', () => {
    expect(stagingTestDeliveryError(undefined, 'invalid_staging_test_delivery')).toBe('주문번호 전체(16자리 또는 20자리)를 확인해주세요.');
  });
});
