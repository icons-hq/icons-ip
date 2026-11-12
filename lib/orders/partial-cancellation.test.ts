import { describe, expect, it } from 'vitest';
import {
  normalizeOrderPartialCancellationSelection,
  orderPartialCancellationSummary,
  parseOrderPartialCancellationContext,
  parseOrderPartialCancellationPlan,
  parseOrderPartialCancellationRecords,
  parseOrderPartialCancellationServiceRow,
} from './partial-cancellation';

const ITEM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const SHIPMENT = 'bbbbbbbb-0000-4000-8000-000000000001';

const record = {
  id: 'cccccccc-0000-4000-8000-000000000001', sequence: 1, state: 'completed', provider: 'toss', refundAmount: 12_500, goodsRefundAmount: 9_500,
  shippingRefundAmount: 3_000, storeCreditRestoreAmount: 0, createdAt: '2026-11-12T05:00:00Z', appliedAt: '2026-11-12T05:00:05Z',
  completedAt: '2026-11-12T05:00:05Z', transferredAt: null, closedShipmentCount: 1,
  items: [{ orderItemId: ITEM, goodName: '품절 굿즈 A', variantName: '블루', qty: 1, goodsRefundAmount: 9_500 }],
};

describe('부분 취소 응답 좁히기', () => {
  it('스위치 OFF 문맥은 빈 기록과 함께 읽힌다', () => {
    expect(parseOrderPartialCancellationContext({ enabled: false, blockers: ['partial_cancel_disabled'], history: [] })).toEqual({
      enabled: false, blockers: ['partial_cancel_disabled'], provider: null, paymentAmount: null, balance: null, items: [], history: [],
    });
  });

  it('구매자 기록에는 운영 필드가 없고, 운영자 기록에는 고객 결정·닫힌 배송 건이 있다', () => {
    const [customer] = parseOrderPartialCancellationRecords([record]);
    expect(customer.staff).toBeUndefined();
    const [staff] = parseOrderPartialCancellationRecords([{ ...record, customerDecision: '통화 결정', note: null, warehouseStopConfirmed: true, lastErrorCode: null,
      balanceBefore: 40_000, paymentAmount: 40_000, createdBy: '운영자', transferEvidence: null, transferNote: null,
      closedShipments: [{ shipmentId: SHIPMENT, shipmentNumber: '2026111230000002', originName: '김포', shippingFeeRefund: 3_000 }], refundAccount: null }]);
    expect(staff.staff).toMatchObject({ customerDecision: '통화 결정', warehouseStopConfirmed: true, closedShipments: [{ shippingFeeRefund: 3_000 }] });
  });

  it('금액 합이 맞지 않거나 상태가 모르는 값이면 거절한다', () => {
    expect(() => parseOrderPartialCancellationRecords([{ ...record, refundAmount: 9_500 }])).toThrow();
    expect(() => parseOrderPartialCancellationRecords([{ ...record, state: 'done' }])).toThrow();
    expect(() => parseOrderPartialCancellationPlan({ provider: 'toss', paymentAmount: 40_000, balanceBefore: 40_000, goodsRefundAmount: 9_500,
      shippingRefundAmount: 0, refundAmount: 9_500, balanceAfter: 31_000, storeCreditRestoreAmount: 0, warehouseStopRequired: false,
      remainingQty: 3, lines: [], closedShipments: [] })).toThrow();
  });

  it('service 행은 결제사 호출에 필요한 값을 그대로 싣는다', () => {
    expect(parseOrderPartialCancellationServiceRow(null)).toBeNull();
    expect(parseOrderPartialCancellationServiceRow({ id: record.id, orderId: ITEM, paymentId: SHIPMENT, provider: 'toss', state: 'processing',
      paymentAmount: 40_000, balanceBefore: 30_500, refundAmount: 17_500, paymentKey: 'KEY', paymentStatus: 'paid', paymentLiveAmount: 40_000 }))
      .toMatchObject({ balanceBefore: 30_500, refundAmount: 17_500 });
  });
});

describe('품목·수량 선택', () => {
  it('같은 품목 두 번·0개·정수 아님·형식 밖 id는 거절한다', () => {
    expect(normalizeOrderPartialCancellationSelection([{ orderItemId: ITEM.toUpperCase(), qty: 1 }])).toEqual([{ orderItemId: ITEM, qty: 1 }]);
    expect(normalizeOrderPartialCancellationSelection([])).toBeNull();
    expect(normalizeOrderPartialCancellationSelection([{ orderItemId: ITEM, qty: 1 }, { orderItemId: ITEM, qty: 1 }])).toBeNull();
    expect(normalizeOrderPartialCancellationSelection([{ orderItemId: ITEM, qty: 0 }])).toBeNull();
    expect(normalizeOrderPartialCancellationSelection([{ orderItemId: ITEM, qty: 1.5 }])).toBeNull();
    expect(normalizeOrderPartialCancellationSelection([{ orderItemId: 'item', qty: 1 }])).toBeNull();
  });
});

describe('구매자 주문 상세 한 줄', () => {
  it("'A 1개 취소 · 환불 N원'에 함께 환불한 배송비를 덧붙인다", () => {
    expect(orderPartialCancellationSummary({ items: record.items, refundAmount: 12_500, shippingRefundAmount: 3_000 }))
      .toBe('품절 굿즈 A (블루) 1개 취소 · 환불 12,500원 (배송비 3,000원 포함)');
    expect(orderPartialCancellationSummary({ items: [{ ...record.items[0], variantName: null }], refundAmount: 9_500, shippingRefundAmount: 0 }))
      .toBe('품절 굿즈 A 1개 취소 · 환불 9,500원');
  });
});
