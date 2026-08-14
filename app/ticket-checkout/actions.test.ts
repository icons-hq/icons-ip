import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import type { PreparedCheckout } from '@/lib/payments/gateway';
import type { TicketOrderSnapshot } from '@/lib/ticketing.server';
import { prepareTicketPaymentAction } from './actions';

const userId = '10000000-0000-4000-8000-000000000206';
const orderId = '20000000-0000-4000-8000-000000000206';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  available: true,
  availabilityUserIds: [] as Array<string | undefined>,
  loadOrder: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/ticketing.server', () => ({ loadTicketOrder: mocks.loadOrder }));
vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketCheckoutPaymentsEnabled: (candidateUserId?: string) => {
    mocks.availabilityUserIds.push(candidateUserId);
    return mocks.available;
  },
}));
vi.mock('@/lib/payments/ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: () => ({ prepare: mocks.prepare }),
}));

const order: TicketOrderSnapshot = {
  id: orderId,
  eventId: 'event-206',
  eventTitle: '티켓 이벤트',
  ticketTypeId: '30000000-0000-4000-8000-000000000206',
  ticketTypeName: '1회차',
  qty: 2,
  total: 44_000,
  status: 'pending',
  paymentStatus: null,
  expiresAt: '2099-08-13T10:10:00.000Z',
};

const prepared: PreparedCheckout = {
  attemptId: '40000000-0000-4000-8000-000000000206',
  provider: 'korpay',
  action: {
    kind: 'form_post',
    url: 'https://payments.example.test/authenticate',
    fields: { orderNumber: 'T40000000000040008000000000000206' },
  },
  callbackNonce: 'opaque-ticket-callback-nonce-206',
  expiresAt: order.expiresAt!,
};

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: userId, email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

function formData(value: unknown = orderId) {
  const data = new FormData();
  if (typeof value === 'string') data.set('ticketOrderId', value);
  return data;
}

describe('prepareTicketPaymentAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.available = true;
    mocks.availabilityUserIds = [];
    mocks.loadOrder.mockReset();
    mocks.loadOrder.mockResolvedValue(order);
    mocks.prepare.mockReset();
    mocks.prepare.mockResolvedValue(prepared);
  });

  it('명시적 사용자 action에서 auth와 owner-scoped 예매를 재검사한 뒤 prepare한다', async () => {
    await expect(prepareTicketPaymentAction({}, formData())).resolves.toEqual({ prepared });
    expect(mocks.loadOrder).toHaveBeenCalledWith(userId, orderId);
    expect(mocks.prepare).toHaveBeenCalledWith({ userId, ticketOrderId: orderId });
    expect(mocks.availabilityUserIds).toContain(userId);
  });

  it('비로그인·foreign 예매·provider OFF는 attempt를 만들지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(prepareTicketPaymentAction({}, formData())).resolves.toEqual({ error: 'auth_required' });

    mocks.auth = onboardedAuth();
    mocks.loadOrder.mockResolvedValue(null);
    await expect(prepareTicketPaymentAction({}, formData())).resolves.toEqual({ error: 'not_found' });

    mocks.loadOrder.mockResolvedValue(order);
    mocks.available = false;
    await expect(prepareTicketPaymentAction({}, formData())).resolves.toEqual({ error: 'payment_unavailable' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('모호·만료·결제된 예매는 provider 호출 전에 거부한다', async () => {
    for (const notPayable of [
      { ...order, paymentStatus: 'pending' },
      { ...order, status: 'paid' as const, paymentStatus: 'paid', expiresAt: null },
      { ...order, expiresAt: '2000-01-01T00:00:00.000Z' },
    ]) {
      mocks.loadOrder.mockResolvedValue(notPayable);
      await expect(prepareTicketPaymentAction({}, formData())).resolves.toEqual({ error: 'not_payable' });
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
