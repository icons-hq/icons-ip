import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderDetail as OrderDetailData } from '@/lib/orders';
import { OrderDetail } from './OrderDetail';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function order(overrides: Partial<OrderDetailData> = {}): OrderDetailData {
  return {
    id: ORDER_ID,
    status: 'shipping',
    total: 30000,
    shippingFee: 3000,
    address: {
      recipientName: '김팬',
      phone: '01012345678',
      postalCode: '04799',
      address1: '서울 성동구 성수이로 1',
      address2: '101호',
      deliveryNote: '',
    },
    createdAt: '2026-08-01T06:00:00.000Z',
    items: [{ goodId: 'g13', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 1, unitPrice: 27000 }],
    payment: { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z' },
    refund: null,
    cancellationRequest: null,
    shipment: {
      carrier: 'hanjin',
      carrierLabel: '한진택배',
      trackingNumber: '123456789012',
      trackingUrl: 'https://carrier.example.test/track?no=123456789012',
    },
    cardPacks: { issuedCount: 0, availableCount: 0 },
    ...overrides,
  };
}

describe('OrderDetail', () => {
  it('운송장이 등록되면 택배사·운송장번호와 배송조회 링크를 노출한다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);

    expect(html).toContain('한진택배');
    expect(html).toContain('운송장번호');
    expect(html).toContain('123456789012');
    expect(html).toContain('href="https://carrier.example.test/track?no=123456789012"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('운송장이 없으면 배송조회를 지어내지 않는다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order({ shipment: null })} />);

    expect(html).not.toContain('배송조회');
    expect(html).not.toContain('운송장번호');
  });

  it('굿즈 금액과 배송비를 분리해 스냅샷 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order()} />);

    expect(html).toContain('₩27,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩30,000');
  });

  /* 배송비 스냅샷은 주문 시점 값이다 — 정책이 바뀌어도 과거 영수증은 변하지 않는다. */
  it('배송비 스냅샷이 0인 과거 주문은 무료로 남는다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail order={order({ shippingFee: 0, total: 27000, payment: null })} />,
    );

    expect(html).toContain('무료');
    expect(html).not.toContain('₩3,000');
  });
});
