import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import { CheckoutOrder } from './CheckoutOrder';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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

const prepared: PreparedCheckout = {
  attemptId: '30000000-0000-4000-8000-000000000205',
  provider: 'korpay',
  action: {
    kind: 'form_post',
    url: 'https://payments.example.test/authenticate',
    fields: { orderNumber: 'O30000000000040008000000000000205' },
  },
  callbackNonce: 'opaque-callback-nonce-205',
  expiresAt: '2099-08-07T06:15:00.000Z',
};

describe('CheckoutOrder 영수증', () => {
  it('서버가 확정한 배송비를 굿즈 금액과 분리해 보여준다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        order={order}
        prepared={prepared}
      />,
    );

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
  });
});
