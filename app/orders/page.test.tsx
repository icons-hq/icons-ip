import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderListItem } from '@/lib/orders';
import type { OrdersPaymentResult } from '@/components/screens/Orders';
import type { CheckoutPaymentResultFocus } from '@/lib/checkout';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  loadOrders: vi.fn(),
  loadFocus: vi.fn(),
  onboarded: true,
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/orders.server', () => ({ loadOrders: mocks.loadOrders }));
vi.mock('@/lib/checkout.server', () => ({ loadLatestCardPaymentResultFocus: mocks.loadFocus }));
vi.mock('@/components/screens/Orders', () => ({
  Orders: ({ orders, paymentResult, paymentFocus }: {
    orders: OrderListItem[];
    paymentResult?: OrdersPaymentResult;
    paymentFocus?: CheckoutPaymentResultFocus | null;
  }) => (
    <div
      data-orders={orders.length}
      data-payment-result={paymentResult ?? 'none'}
      data-focus={paymentFocus ? `${paymentFocus.orderId}:${paymentFocus.outcome}` : 'none'}
    />
  ),
}));

const userId = '10000000-0000-4000-8000-000000000206';

function render(payment?: string | string[]) {
  return Page({ searchParams: Promise.resolve({ payment }) });
}

describe('/orders', () => {
  beforeEach(() => {
    mocks.auth = {
      user: { id: userId, email: 'fan@example.test' },
      profile: { onboarded_at: '2026-08-13T00:00:00.000Z' },
    };
    mocks.onboarded = true;
    mocks.loadOrders.mockReset();
    mocks.loadOrders.mockResolvedValue([]);
    mocks.loadFocus.mockReset();
    mocks.loadFocus.mockResolvedValue(null);
  });

  it('payment 쿼리의 결제 결과를 Orders에 전달한다', async () => {
    for (const result of ['approved', 'checking', 'failed'] as const) {
      const html = renderToStaticMarkup(await render(result));
      expect(html).toContain(`data-payment-result="${result}"`);
    }
    expect(mocks.loadOrders).toHaveBeenCalledWith(userId);
  });

  /* 콜백 리다이렉트에는 주문 식별자가 없다 — 확정되지 않은 결과에서는 결제 대기 주문을
     함께 읽고, 배너는 최근 결제 시도의 원장 상태로 고른다(UX-2·UX-3). */
  it('확정되지 않은 결제 결과는 결제 대기 주문과 최근 결제 시도의 실제 결과를 함께 읽는다', async () => {
    const orderId = '20000000-0000-4000-8000-000000000206';
    mocks.loadFocus.mockResolvedValue({ orderId, outcome: 'attempt_expired' });

    const html = renderToStaticMarkup(await render('checking'));

    expect(mocks.loadOrders).toHaveBeenCalledWith(userId, { includePending: true });
    expect(mocks.loadFocus).toHaveBeenCalledWith(userId);
    expect(html).toContain(`data-focus="${orderId}:attempt_expired"`);
  });

  it('결제 결과 쿼리가 없으면 결제 시도 원장을 읽지 않는다', async () => {
    renderToStaticMarkup(await render(undefined));
    expect(mocks.loadFocus).not.toHaveBeenCalled();
  });

  it('복구 링크에서 결제 대기 주문을 포함하고 로그인 복귀에도 선택을 보존한다', async () => {
    await Page({searchParams:Promise.resolve({pending:'1'})});
    expect(mocks.loadOrders).toHaveBeenCalledWith(userId,{includePending:true});
    mocks.auth={user:null,profile:null};
    await expect(Page({searchParams:Promise.resolve({pending:'1'})})).rejects.toThrow(encodeURIComponent('/orders?pending=1'));
  });

  it('payment 쿼리가 없거나 콜백 계약 밖의 값이면 배너 없이 렌더한다', async () => {
    expect(renderToStaticMarkup(await render(undefined))).toContain('data-payment-result="none"');
    expect(renderToStaticMarkup(await render('paid'))).toContain('data-payment-result="none"');
  });

  it('payment 쿼리가 반복되면 첫 값만 읽는다', async () => {
    const html = renderToStaticMarkup(await render(['checking', 'approved']));
    expect(html).toContain('data-payment-result="checking"');
  });

  it('비로그인 리다이렉트의 next에 검증된 payment 쿼리를 보존한다', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(render('approved'))
      .rejects.toThrow(`redirect:/login?next=${encodeURIComponent('/orders?payment=approved')}`);
    await expect(render('paid'))
      .rejects.toThrow(`redirect:/login?next=${encodeURIComponent('/orders')}`);
  });
});
