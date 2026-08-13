import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import type { TicketOrderSnapshot } from '@/lib/ticketing.server';
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
vi.mock('@/lib/ticketing.server', () => ({ loadTicketOrder: mocks.loadOrder }));
vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketCheckoutPaymentsEnabled: () => mocks.available,
}));
vi.mock('@/lib/payments/ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: () => ({ prepare: mocks.prepare }),
}));
vi.mock('@/components/screens/TicketCheckout', () => ({
  TicketCheckout: ({
    order,
    prepared,
  }: {
    order: TicketOrderSnapshot;
    prepared: PreparedCheckout | null;
  }) => (
    <div data-order={order.id} data-attempt={prepared?.attemptId ?? 'unavailable'} />
  ),
}));

const userId = '10000000-0000-4000-8000-000000000206';
const orderId = '20000000-0000-4000-8000-000000000206';
const attemptId = '30000000-0000-4000-8000-000000000206';

const order: TicketOrderSnapshot = {
  id: orderId,
  eventId: 'ticket-event-206',
  eventTitle: '티켓 이벤트',
  ticketTypeId: '40000000-0000-4000-8000-000000000206',
  ticketTypeName: '1회차',
  qty: 2,
  total: 44_000,
  status: 'pending',
  paymentStatus: null,
  expiresAt: '2099-08-13T10:10:00.000Z',
};

const prepared: PreparedCheckout = {
  attemptId,
  provider: 'korpay',
  action: {
    kind: 'form_post',
    url: 'https://payments.example.test/authenticate',
    fields: { orderNumber: 'T30000000000040008000000000000206' },
  },
  callbackNonce: 'opaque-callback-nonce-206',
  expiresAt: order.expiresAt!,
};

describe('/ticket-checkout/[ticketOrderId]', () => {
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

  it('소유자 예매를 읽고 provider-neutral ticket checkout을 준비한다', async () => {
    const html = renderToStaticMarkup(await Page({
      params: Promise.resolve({ ticketOrderId: orderId.toUpperCase() }),
    }));

    expect(mocks.loadOrder).toHaveBeenCalledWith(userId, orderId);
    expect(mocks.prepare).toHaveBeenCalledWith({ userId, ticketOrderId: orderId });
    expect(html).toContain(`data-order="${orderId}"`);
    expect(html).toContain(`data-attempt="${attemptId}"`);
  });

  it('provider gate·모호 attempt·준비 실패 시 결제 action을 닫는다', async () => {
    mocks.available = false;
    const disabled = renderToStaticMarkup(await Page({ params: Promise.resolve({ ticketOrderId: orderId }) }));
    expect(disabled).toContain('data-attempt="unavailable"');
    expect(mocks.prepare).not.toHaveBeenCalled();

    mocks.available = true;
    mocks.loadOrder.mockResolvedValue({ ...order, paymentStatus: 'pending' });
    const ambiguous = renderToStaticMarkup(await Page({ params: Promise.resolve({ ticketOrderId: orderId }) }));
    expect(ambiguous).toContain('data-attempt="unavailable"');
    expect(mocks.prepare).not.toHaveBeenCalled();

    mocks.loadOrder.mockResolvedValue(order);
    mocks.prepare.mockRejectedValue(new Error('private provider detail'));
    const failed = renderToStaticMarkup(await Page({ params: Promise.resolve({ ticketOrderId: orderId }) }));
    expect(failed).toContain('data-attempt="unavailable"');
  });

  it('인증과 owner-scoped 예매 조회를 통과하지 못하면 prepare를 호출하지 않는다', async () => {
    mocks.auth = { user: null, profile: null };
    await expect(Page({ params: Promise.resolve({ ticketOrderId: orderId }) }))
      .rejects.toThrow(`redirect:/login?next=%2Fticket-checkout%2F${orderId}`);

    mocks.auth = { user: { id: userId, email: 'fan@example.test' }, profile: {} };
    mocks.loadOrder.mockResolvedValue(null);
    await expect(Page({ params: Promise.resolve({ ticketOrderId: orderId }) }))
      .rejects.toThrow('not-found');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
