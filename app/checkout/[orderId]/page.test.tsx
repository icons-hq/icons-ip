import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  loadOrder: vi.fn(),
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
vi.mock('@/components/screens/CheckoutOrder', () => ({
  CheckoutOrder: ({ order }: { order: CheckoutOrderSnapshot }) => (
    <div data-order={order.id} />
  ),
}));

const userId = '10000000-0000-4000-8000-000000000205';
const orderId = '20000000-0000-4000-8000-000000000205';

const order: CheckoutOrderSnapshot = {
  id: orderId,
  status: 'pending',
  total: 31_000,
  shippingFee: 3_000,
  discountTotal: 0,
  address: null,
  expiresAt: '2099-08-13T10:10:00.000Z',
  createdAt: '2026-08-13T10:00:00.000Z',
  paymentStatus: null,
  paymentMethod: 'card' as const,
  items: [],
};

describe('/checkout/[orderId]', () => {
  beforeEach(() => {
    mocks.auth = {
      user: { id: userId, email: 'fan@example.test' },
      profile: { onboarded_at: '2026-08-13T00:00:00.000Z' },
    };
    mocks.onboarded = true;
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(order);
  });

  it('GET/render는 소유자 범위 주문만 읽고 결제 attempt를 만들지 않는다', async () => {
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ orderId: orderId.toUpperCase() }),
    }));

    expect(mocks.loadOrder).toHaveBeenCalledWith(userId, orderId);
    expect(html).toContain(`data-order="${orderId}"`);
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
  });
});
