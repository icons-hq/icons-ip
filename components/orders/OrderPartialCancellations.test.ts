import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderPartialCancellations } from './OrderPartialCancellations';
import type { OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';

function record(overrides: Partial<OrderPartialCancellationRecord> = {}): OrderPartialCancellationRecord {
  return {
    id: 'cccccccc-0000-4000-8000-000000000001', sequence: 1, state: 'completed', provider: 'toss', refundAmount: 9_500, goodsRefundAmount: 9_500,
    shippingRefundAmount: 0, storeCreditRestoreAmount: 0, createdAt: '2026-11-12T05:00:00Z', appliedAt: '2026-11-12T05:00:05Z',
    completedAt: '2026-11-12T05:00:05Z', transferredAt: null, closedShipmentCount: 0,
    items: [{ orderItemId: 'aaaaaaaa-0000-4000-8000-00000000000a', goodName: '품절 굿즈 A', variantName: null, qty: 1, goodsRefundAmount: 9_500 }],
    ...overrides,
  };
}

describe('구매자 주문 상세의 일부 취소', () => {
  it('적용된 부분 취소가 없으면(스위치 OFF 포함) 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(createElement(OrderPartialCancellations, { records: [] }))).toBe('');
  });

  it("'A 1개 취소 · 환불 N원'과 환불 경로를 보인다", () => {
    const html = renderToStaticMarkup(createElement(OrderPartialCancellations, { records: [
      record(),
      record({ id: 'cccccccc-0000-4000-8000-000000000002', sequence: 2, provider: 'bank_transfer', state: 'awaiting_transfer', completedAt: null }),
    ] }));
    expect(html).toContain('일부 취소');
    expect(html).toContain('품절 굿즈 A 1개 취소 · 환불 9,500원');
    expect(html).toContain('결제사 부분 취소 완료');
    expect(html).toContain('등록하신 환불계좌로 송금 예정');
    expect(html).not.toContain('상품');
  });
});
