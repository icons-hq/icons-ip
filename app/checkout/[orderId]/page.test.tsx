import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  available: true,
  loadOrder: vi.fn(),
  prepare: vi.fn(),
  onboarded: true,
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('not-found'); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/checkout.server', () => ({ loadCheckoutOrder: mocks.loadOrder }));
vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsCheckoutPaymentsEnabled: () => mocks.available,
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: () => ({ prepare: mocks.prepare }),
}));
vi.mock('@/components/screens/CheckoutOrder', () => ({
  CheckoutOrder: ({
    order,
    prepared,
  }: {
    order: CheckoutOrderSnapshot;
    prepared: PreparedCheckout | null;
  }) => (
    <div
      data-order={order.id}
      data-attempt={prepared?.attemptId ?? 'unavailable'}
    />
  ),
}));

const userId = '10000000-0000-4000-8000-000000000205';
const orderId = '20000000-0000-4000-8000-000000000205';
const attemptId = '30000000-0000-4000-8000-000000000205';

const order: CheckoutOrderSnapshot = {
  id: orderId,
  status: 'pending',
  total: 31_000,
  shippingFee: 3_000,
  address: null,
  expiresAt: '2099-08-13T10:10:00.000Z',
  createdAt: '2026-08-13T10:00:00.000Z',
  paymentStatus: null,
  items: [],
};

const prepared: PreparedCheckout = {
  attemptId,
  provider: 'korpay',
  action: {
    kind: 'form_post',
    url: 'https://payments.example.test/authenticate',
    fields: { orderNumber: 'O30000000000040008000000000000205' },
  },
  callbackNonce: 'opaque-callback-nonce-205',
  expiresAt: order.expiresAt!,
};

describe('/checkout/[orderId]', () => {
  beforeEach(() => {
    mocks.auth = {
      user: { id: userId, email: 'fan@example.test' },
      profile: { onboarded_at: '2026-08-13T00:00:00.000Z' },
    };
    mocks.available = true;
    mocks.onboarded = true;
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(order);
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue(prepared);
  });

  it('소유자 범위 주문을 서버에서 읽고 provider-neutral checkout을 준비한다', async () => {
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ orderId: orderId.toUpperCase() }),
    }));

    expect(mocks.loadOrder).toHaveBeenCalledWith(userId, orderId);
    expect(mocks.prepare).toHaveBeenCalledWith({ userId, orderId });
    expect(html).toContain(`data-order="${orderId}"`);
    expect(html).toContain(`data-attempt="${attemptId}"`);
  });

  it('provider gate가 닫혔거나 준비가 실패하면 결제 action 없이 fail closed한다', async () => {
    mocks.available = false;
    const disabled = renderToStaticMarkup(await Page({ params: Promise.resolve({ orderId }) }));
    expect(disabled).toContain('data-attempt="unavailable"');
    expect(mocks.prepare).not.toHaveBeenCalled();

    mocks.available = true;
    mocks.prepare.mockRejectedValue(new Error('private provider detail'));
    const failed = renderToStaticMarkup(await Page({ params: Promise.resolve({ orderId }) }));
    expect(failed).toContain('data-attempt="unavailable"');
  });

  it('인증과 owner-scoped 주문 조회를 통과하지 못하면 prepare를 호출하지 않는다', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(Page({ params: Promise.resolve({ orderId }) }))
      .rejects.toThrow(`redirect:/login?next=%2Fcheckout%2F${orderId}`);

    mocks.auth = {
      user: { id: userId, email: 'fan@example.test' },
      profile: { onboarded_at: '2026-08-13T00:00:00.000Z' },
    };
    mocks.loadOrder.mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ orderId }) })).rejects.toThrow('not-found');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
