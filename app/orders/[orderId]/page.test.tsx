import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '10000000-0000-4000-8000-000000000206';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  onboarded: true,
  loadOrderDetail: vi.fn(),
  loadOrdererInfo: vi.fn(),
  loadPaymentDisplay: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error('not_found'); },
}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/auth/onboarding', () => ({
  isOnboarded: () => mocks.onboarded,
  onboardingPath: (next: string) => `/onboarding?next=${encodeURIComponent(next)}`,
}));
vi.mock('@/lib/orders.server', () => ({ loadOrderDetail: mocks.loadOrderDetail }));
vi.mock('@/lib/orders/orderer.server', () => ({ loadOrdererInfo: mocks.loadOrdererInfo }));
vi.mock('@/lib/orders/payment-display.server', () => ({ loadMyOrderPaymentDisplay: mocks.loadPaymentDisplay }));
vi.mock('@/lib/checkout.server', () => ({
  loadOrderRetrySources: vi.fn(async () => new Map()),
  loadPendingCardPaymentReading: vi.fn(async () => null),
}));
vi.mock('@/lib/reviews.server', () => ({ loadOrderReviewTargets: vi.fn(async () => []) }));
vi.mock('@/lib/order-downloads.server', () => ({ loadMyOrderDownloads: vi.fn(async () => null) }));
vi.mock('@/lib/order-production.server', () => ({ loadMyOrderProduction: vi.fn(async () => null) }));
vi.mock('@/lib/orders/claim-type-conversion.server', () => ({ loadMyOrderClaimTypeHistory: vi.fn(async () => []) }));
vi.mock('@/lib/orders/claim-reason-change.server', () => ({ loadMyOrderClaimReasonHistory: vi.fn(async () => []) }));
vi.mock('@/lib/claims/return-fee-deduction.server', () => ({
  loadMyOrderRefundDeduction: vi.fn(async () => null),
  loadReturnFeeDeductionPolicy: vi.fn(async () => null),
}));
vi.mock('@/lib/orders/return-pickup.server', () => ({ loadMyOrderReturnPickup: vi.fn(async () => ({ pickupGroups: 0, directGroups: 0 })) }));
vi.mock('@/lib/orders/partial-cancellation.server', () => ({ loadMyOrderPartialCancellations: vi.fn(async () => []) }));
vi.mock('@/components/screens/OrderDetail', () => ({
  OrderDetail: ({ orderer, paymentDisplay, receiptNotice }: { orderer?: { name: string } | null; paymentDisplay?: { method: string | null } | null; receiptNotice?: boolean }) => (
    <div data-orderer={orderer?.name ?? 'none'} data-payment-method={paymentDisplay?.method ?? 'none'} data-receipt-notice={String(receiptNotice)} />
  ),
}));

function render(query: Record<string, string | string[] | undefined> = {}) {
  return Page({ params: Promise.resolve({ orderId: ORDER_ID }), searchParams: Promise.resolve(query) } as Parameters<typeof Page>[0]);
}

describe('/orders/[orderId]', () => {
  beforeEach(() => {
    mocks.auth = { user: { id: USER_ID, email: 'fan@example.test' }, profile: { nickname: '김팬', email: 'fan@example.test', onboarded_at: '2026-08-13T00:00:00.000Z' } };
    mocks.onboarded = true;
    mocks.loadOrderDetail.mockReset();
    mocks.loadOrderDetail.mockResolvedValue({ id: ORDER_ID, status: 'paid', paymentMethod: 'card', payment: null, cancellationRequest: null, expiresAt: null, giftId: undefined });
    mocks.loadOrdererInfo.mockReset();
    mocks.loadOrdererInfo.mockResolvedValue({ name: '김팬', email: 'fan@example.test', maskedPhone: null });
    mocks.loadPaymentDisplay.mockReset();
    mocks.loadPaymentDisplay.mockResolvedValue({ provider: 'toss', method: '카드', detail: null, approvedAt: null });
  });

  it('주문자 정보와 결제수단 표시를 읽어 주문 상세에 넘긴다(현재 로그인 상태 그대로)', async () => {
    const html = renderToStaticMarkup(await render());

    expect(mocks.loadOrdererInfo).toHaveBeenCalledWith(mocks.auth);
    expect(mocks.loadPaymentDisplay).toHaveBeenCalledWith(ORDER_ID);
    expect(html).toContain('data-orderer="김팬"'); expect(html).toContain('data-payment-method="카드"');
  });

  it('결제수단 표시를 읽지 못해도(null) 주문 상세는 열린다', async () => {
    mocks.loadPaymentDisplay.mockResolvedValue(null);
    expect(renderToStaticMarkup(await render())).toContain('data-payment-method="none"');
  });

  it('?receipt=unavailable일 때만 영수증 안내를 켠다', async () => {
    expect(renderToStaticMarkup(await render({ receipt: 'unavailable' }))).toContain('data-receipt-notice="true"');
    for (const query of [{}, { receipt: 'ok' }, { receipt: ['unavailable', 'x'] }, { other: 'unavailable' }]) {
      expect(renderToStaticMarkup(await render(query))).toContain('data-receipt-notice="false"');
    }
  });

  it('비로그인은 로그인으로, 없는 주문은 404로 보낸다', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(render()).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(`/orders/${ORDER_ID}`)}`);
    mocks.auth = { user: { id: USER_ID, email: 'fan@example.test' }, profile: { onboarded_at: '2026-08-13T00:00:00.000Z' } };
    mocks.loadOrderDetail.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('not_found');
  });
});
