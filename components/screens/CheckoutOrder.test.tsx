import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import { CheckoutOrder } from './CheckoutOrder';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/components/payments/TossPaymentWidget', () => ({
  TossPaymentWidget: (props: Record<string, unknown>) => (
    <div data-payment-widget={JSON.stringify(props)} />
  ),
}));

const order: CheckoutOrderSnapshot = {
  id: '7ad4c967-3d48-44da-a665-64731ac33f62',
  status: 'pending',
  total: 15000,
  shippingFee: 3000,
  address: null,
  expiresAt: '2099-08-07T06:15:00.000Z',
  createdAt: '2026-08-07T06:00:00.000Z',
  paymentStatus: null,
  items: [{
    goodId: 'g13',
    name: '홍실 아크릴 블록',
    type: '아크릴',
    qty: 1,
    unitPrice: 12000,
  }],
};

describe('CheckoutOrder 영수증', () => {
  it('서버가 확정한 배송비를 굿즈 금액과 분리해 보여준다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        clientKey="test-client-key"
        customer={{ id: 'user-1', email: 'fan@example.test', name: 'ICONS 팬' }}
        order={order}
      />,
    );

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
  });
});
