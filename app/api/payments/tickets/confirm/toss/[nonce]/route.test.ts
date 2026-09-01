import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome } from '@/lib/payments/gateway';
import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
} from '@/lib/payments/ticket-checkout';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  confirmationAvailable: true,
  confirm: vi.fn(),
  availabilityProvider: undefined as string | undefined,
  checkoutProvider: undefined as string | undefined,
}));

vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketPaymentProviderAvailable: (provider?: string) => {
    mocks.availabilityProvider = provider;
    return mocks.confirmationAvailable;
  },
}));
vi.mock('@/lib/payments/ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: (provider?: string) => {
    mocks.checkoutProvider = provider;
    return { confirm: mocks.confirm };
  },
}));

const NONCE = 'opaque-toss-ticket-nonce-000000000393';
const PROVIDER_ORDER_ID = 'T30000000000040008000000000000393';
const PAYMENT_KEY = 'tviva20260901000000ticketKEY123456';

const query = {
  paymentType: 'NORMAL',
  orderId: PROVIDER_ORDER_ID,
  paymentKey: PAYMENT_KEY,
  amount: '44000',
};

function callGet(overrides: Record<string, string | undefined> = {}, nonce: string = NONCE) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...query, ...overrides })) {
    if (value !== undefined) params.set(name, value);
  }
  const url = `https://icons.example/api/payments/tickets/confirm/toss/${nonce}?${params.toString()}`;
  return GET(new Request(url, { method: 'GET' }), {
    params: Promise.resolve({ nonce }),
  });
}

function outcome(value: ConfirmOutcome['outcome']): ConfirmOutcome {
  return {
    attemptId: '30000000-0000-4000-8000-000000000393',
    provider: 'toss',
    outcome: value,
  };
}

describe('GET /api/payments/tickets/confirm/toss/[nonce]', () => {
  beforeEach(() => {
    mocks.confirmationAvailable = true;
    mocks.availabilityProvider = undefined;
    mocks.checkoutProvider = undefined;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(outcome('approved'));
  });

  it('successUrl 쿼리를 allowlist payload로 줄이고 toss 조립으로 confirm한다', async () => {
    const result = await callGet({ extraProviderField: 'must-not-enter-domain' });

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/tickets?payment=approved');
    expect(mocks.confirm).toHaveBeenCalledWith({
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: NONCE,
      providerPayload: query,
    });
    expect(mocks.availabilityProvider).toBe('toss');
    expect(mocks.checkoutProvider).toBe('toss');
  });

  it.each([
    ['unknown', '/tickets?payment=checking'],
    ['needs_review', '/tickets?payment=checking'],
    ['declined', '/tickets?payment=failed'],
    ['canceled', '/tickets?payment=failed'],
  ] as const)('%s는 secret 없는 명시적 303 위치로 이동한다', async (paymentOutcome, location) => {
    mocks.confirm.mockResolvedValue(outcome(paymentOutcome));
    const result = await callGet();
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe(location);
    expect(result.headers.get('location')).not.toContain(PAYMENT_KEY);
  });

  it('중복 callback claim이 진행 중이면 provider 재시도 없이 checking으로 이동한다', async () => {
    mocks.confirm.mockRejectedValue(new TicketPaymentConfirmationInProgressError());
    const result = await callGet();
    expect(result.headers.get('location')).toBe('/tickets?payment=checking');
  });

  it('known 계약 오류는 실패 위치로, 미지 오류는 checking으로 fail closed한다', async () => {
    mocks.confirm.mockRejectedValue(new TicketPaymentContractError('legacy_payment'));
    expect((await callGet()).headers.get('location')).toBe('/tickets?payment=failed');

    mocks.confirm.mockRejectedValue(new Error('private provider secret'));
    const unknownFailure = await callGet();
    expect(unknownFailure.headers.get('location')).toBe('/tickets?payment=checking');
    expect(await unknownFailure.text()).not.toContain('private provider secret');
  });

  it('형식 밖 콜백·nonce는 domain 호출 전에 실패 위치로 보낸다', async () => {
    expect((await callGet({ orderId: 'raw-order-uuid' })).headers.get('location'))
      .toBe('/tickets?payment=failed');
    expect((await callGet({}, 'short')).headers.get('location'))
      .toBe('/tickets?payment=failed');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('runtime readiness OFF는 checking으로 fail closed하고 domain을 부르지 않는다', async () => {
    mocks.confirmationAvailable = false;
    const result = await callGet();
    expect(result.headers.get('location')).toBe('/tickets?payment=checking');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
