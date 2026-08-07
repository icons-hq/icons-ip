import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderDetail as OrderDetailData } from '@/lib/orders';
import { OrderDetail } from './OrderDetail';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const order: OrderDetailData = {
  id: '7ad4c967-3d48-44da-a665-64731ac33f62',
  status: 'paid',
  total: 15000,
  shippingFee: 3000,
  address: null,
  createdAt: '2026-08-07T06:00:00.000Z',
  items: [{
    goodId: 'g13',
    name: '홍실 아크릴 블록',
    type: '아크릴',
    qty: 1,
    unitPrice: 12000,
  }],
  payment: null,
  refund: null,
  cancellationRequest: null,
  cardPacks: { issuedCount: 0, availableCount: 0 },
};

describe('OrderDetail 영수증', () => {
  it('굿즈 금액과 배송비를 분리해 스냅샷 그대로 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetail order={order} />);

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
  });

  it('배송비 스냅샷이 0인 과거 주문은 무료로 남는다', () => {
    const html = renderToStaticMarkup(
      <OrderDetail order={{ ...order, shippingFee: 0, total: 12000 }} />,
    );

    expect(html).toContain('무료');
    expect(html).not.toContain('₩3,000');
  });
});
