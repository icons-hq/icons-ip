import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSnapshot } from '@/lib/checkout.server';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  loadOrder: vi.fn(),
  account: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('not-found'); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => true,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/checkout.server', () => ({ loadCheckoutOrder: mocks.loadOrder }));
vi.mock('@/lib/payments/bank-transfer.server', () => ({ getBankTransferAccount: mocks.account }));
vi.mock('@/components/shell/ListingReturn', () => ({ ListingReturnLink: () => <a data-listing-return="" /> }));

const userId = '10000000-0000-4000-8000-000000000271';
const orderId = '20000000-0000-4000-8000-000000000271';
const order: CheckoutOrderSnapshot = {
  id: orderId, status: 'paid', total: 15_000, shippingFee: 3_000, discountTotal: 0, storeCreditTotal: 0, address: null,
  expiresAt: null, createdAt: '2026-10-27T05:00:00.000Z', paymentStatus: 'paid', paidAt: '2026-10-27T05:03:00.000Z',
  shipments: [], paymentMethod: 'card', paymentAttempt: null, hasActiveCancellationRequest: false, items: [],
};
const params = (value = orderId) => ({ params: Promise.resolve({ orderId: value }) }) as Parameters<typeof Page>[0];

describe('/orders/[orderId]/complete', () => {
  beforeEach(() => {
    mocks.auth = { user: { id: userId, email: 'fan@example.test' }, profile: {} };
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(order);
    mocks.account.mockReset();
    mocks.account.mockResolvedValue({ bank: '국민은행', accountNumber: '1', holder: '아이콘즈' });
  });

  it('로그인하지 않았으면 완료 화면으로 돌아오는 로그인으로 보낸다', async () => {
    mocks.auth = { user: null };
    await expect(Page(params())).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(`/orders/${orderId}/complete`)}`);
  });

  it('본인 주문이 아니면 찾을 수 없다', async () => {
    mocks.loadOrder.mockResolvedValue(null);
    await expect(Page(params())).rejects.toThrow('not-found');
    expect(mocks.loadOrder).toHaveBeenCalledWith(userId, orderId);
  });

  it('결제 전 카드 주문은 주문 상세로 보낸다', async () => {
    mocks.loadOrder.mockResolvedValue({ ...order, status: 'pending', paymentStatus: null });
    await expect(Page(params())).rejects.toThrow(`redirect:/orders/${orderId}`);
  });

  it('결제 완료 주문은 완료 화면을 그리고 계좌는 읽지 않는다', async () => {
    const html = renderToStaticMarkup(await Page(params()));
    expect(html).toContain('주문이 완료됐어요');
    expect(mocks.account).not.toHaveBeenCalled();
  });

  it('무통장 입금 대기 주문은 계좌 안내와 함께 그린다', async () => {
    mocks.loadOrder.mockResolvedValue({ ...order, status: 'pending', paymentMethod: 'bank_transfer', paymentStatus: null, paidAt: null, expiresAt: '2026-10-28T05:00:00.000Z' });
    const html = renderToStaticMarkup(await Page(params()));
    expect(html).toContain('주문이 접수됐어요');
    expect(html).toContain('국민은행');
  });
});
