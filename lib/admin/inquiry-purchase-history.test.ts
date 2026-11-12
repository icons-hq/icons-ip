import { describe, expect, it } from 'vitest';
import { parseInquiryPurchaseHistory } from './inquiry-purchase-history';

const INQUIRY = 'a1030000-0000-4000-8000-000000000401';
const CUSTOMER = 'a1030000-0000-4000-8000-000000000001';
const order = (n: number) => ({ id: `a1030000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`, orderNumber: `2026090100001000000${n}`,
  status: 'paid', amount: 1000 * n, createdAt: '2026-09-01T01:00:00.123456+00:00', title: '주문 상품', itemCount: 0 });
const valid = () => ({ inquiryId: INQUIRY, customerId: CUSTOMER, page: 1, pageSize: 20, total: 2, items: [order(2), order(1)],
  linkedOrder: { ...order(1), itemCount: undefined, quantity: 3 } });

describe('상담 중 고객 구매이력 응답 계약(1014-103)', () => {
  it('문의·고객·주문 목록·연결 주문 요약을 그대로 읽는다', () => {
    const parsed = parseInquiryPurchaseHistory(valid());
    expect(parsed).toMatchObject({ inquiryId: INQUIRY, customerId: CUSTOMER, total: 2, page: 1, pageSize: 20 });
    expect(parsed?.items.map(item => item.amount)).toEqual([2000, 1000]);
    expect(parsed?.linkedOrder).toMatchObject({ quantity: 3, status: 'paid' });
    expect(parseInquiryPurchaseHistory({ ...valid(), linkedOrder: null })?.linkedOrder).toBeNull();
    /* 새 주문 상태가 생겨도 이력 전체를 실패로 만들지 않는다(표시는 원문). 옛 주문은 표시 번호가 없을 수 있다. */
    expect(parseInquiryPurchaseHistory({ ...valid(), items: [{ ...order(1), status: 'future_status', orderNumber: null }], total: 1 })?.items[0].status).toBe('future_status');
  });

  it('계약과 다른 응답은 빈 이력이 아니라 읽기 실패다', () => {
    expect(parseInquiryPurchaseHistory(null)).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), inquiryId: 'not-a-uuid' })).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), items: [order(1), order(1)] })).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), total: 1 })).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), items: [{ ...order(1), amount: -1 }], total: 1 })).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), items: [{ ...order(1), createdAt: 'yesterday' }], total: 1 })).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), linkedOrder: { id: CUSTOMER } })).toBeNull();
    expect(parseInquiryPurchaseHistory({ ...valid(), page: 0 })).toBeNull();
  });
});
