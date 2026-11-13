import { describe, expect, it } from 'vitest';
import { FORCED_DELIVERY_BLOCKERS, forcedDeliveryBlockerLabel, forcedDeliveryError, forcedDeliveryExportedPending, forcedDeliveryHref, forcedDeliveryTargets, normalizeForcedDeliveryOrderNumber, parseForcedDeliveryPreview, parseForcedDeliveryReceipt } from './forced-delivery';

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
  it('미리보기는 출고지시 전달 여부를 받고, 디지털 파일은 이번 대상에서 빼며 전달된 발송 전 건을 따로 센다', () => {
    const base = { orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber: '2026111110000001', status: 'confirmed', createdAt: '2026-11-11T00:00:00Z', buyerName: '구매자',
      itemCount: 2, firstItemName: '굿즈', orderCount: 1, blockers: [] };
    const shipment = { id: 'f0dd0000-0000-4002-8000-000000000001', shipmentNumber: null, orderNumber: '2026111110000001', originName: '김포', status: 'ready', method: 'parcel', carrier: null, trackingNumber: null, exportedAt: '2026-11-11T01:00:00Z' };
    const preview = parseForcedDeliveryPreview({ ...base, shipments: [shipment, { ...shipment, id: 'f0dd0000-0000-4002-8000-000000000002', method: 'digital', exportedAt: null }, { ...shipment, id: 'f0dd0000-0000-4002-8000-000000000003', method: 'quick', exportedAt: null }] })!;
    expect(forcedDeliveryTargets(preview).map(row => row.method)).toEqual(['parcel', 'quick']);
    expect(forcedDeliveryExportedPending(preview).map(row => row.id)).toEqual([shipment.id]);
    expect(parseForcedDeliveryPreview({ ...base, shipments: [{ ...shipment, exportedAt: 'yesterday' }] })).toBeNull();
    expect(parseForcedDeliveryPreview({ ...base, shipments: [], blockers: ['parcel_only'] })).toBeNull();
  });
  it('막는 사유와 DB 거절은 모두 운영자 문구가 있다', () => {
    for (const blocker of FORCED_DELIVERY_BLOCKERS) expect(forcedDeliveryBlockerLabel(blocker).length).toBeGreaterThan(10);
    expect(forcedDeliveryError('P0002', 'forced_delivery_order_not_found')).toBe('주문번호에 해당하는 주문이 없습니다.');
    expect(forcedDeliveryError('42501')).toContain('배송 처리 권한');
    expect(forcedDeliveryError(undefined, 'order cancellation in progress')).toContain('클레임');
    /* QA1 S-T04-05: 이미 배송완료·취소된 주문은 '먼저 발주확인'이 아니라 처리할 배송 건이 없다고 알린다. */
    expect(forcedDeliveryError('23514', 'forced_delivery_nothing_to_deliver')).toContain('이미 배송완료됐거나 취소된 주문');
    expect(forcedDeliveryBlockerLabel('nothing_to_deliver')).not.toContain('발주확인');
  });
  it('주문 상세에서 강제 배송완료 카드를 그 주문번호로 여는 주소', () => {
    expect(forcedDeliveryHref('20261112140010000034')).toBe('/admin/sales/dispatch?forceDelivery=20261112140010000034#forced-delivery');
  });
});
