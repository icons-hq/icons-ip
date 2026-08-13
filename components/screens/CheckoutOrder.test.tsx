import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import {
  CheckoutOrder,
  effectiveGoodsCheckoutExpiry,
  preparedGoodsCheckoutUsable,
} from './CheckoutOrder';

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

describe('CheckoutOrder 영수증', () => {
  it('서버가 확정한 배송비를 굿즈 금액과 분리해 보여준다', () => {
    const html = renderToStaticMarkup(
      <CheckoutOrder
        order={order}
      />,
    );

    expect(html).toContain('₩12,000');
    expect(html).toContain('₩3,000');
    expect(html).toContain('₩15,000');
  });

  it('주문과 provider 준비 만료 중 더 이른 시각을 deadline으로 사용한다', () => {
    expect(effectiveGoodsCheckoutExpiry(
      '2099-08-07T06:15:00.000Z',
      '2099-08-07T06:10:00.000Z',
    )).toBe(Date.parse('2099-08-07T06:10:00.000Z'));
    expect(effectiveGoodsCheckoutExpiry(
      '2099-08-07T06:05:00.000Z',
      '2099-08-07T06:10:00.000Z',
    )).toBe(Date.parse('2099-08-07T06:05:00.000Z'));
  });

  it('provider 준비 deadline이 지나면 기존 결제 action을 제거한다', () => {
    const prepared: PreparedCheckout = {
      attemptId: '30000000-0000-4000-8000-000000000205',
      provider: 'korpay',
      action: { kind: 'redirect', url: 'https://payments.example.test/authenticate' },
      callbackNonce: 'opaque-callback-nonce-205',
      expiresAt: '2026-08-13T10:05:00.000Z',
    };

    expect(preparedGoodsCheckoutUsable(
      prepared,
      '2026-08-13T10:10:00.000Z',
      Date.parse('2026-08-13T10:05:00.001Z'),
    )).toBe(false);
  });
});
