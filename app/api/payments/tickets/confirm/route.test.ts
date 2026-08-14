import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
} from '@/lib/payments/ticket-checkout';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  confirmationAvailable: true,
  confirm: vi.fn(),
}));

vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketPaymentProviderAvailable: () => mocks.confirmationAvailable,
}));
vi.mock('@/lib/payments/ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: () => ({ confirm: mocks.confirm }),
}));

const fields = {
  resultCode: '0000',
  message: 'authenticated',
  paymentKey: 'opaque-ticket-payment-key-206',
  merchantId: 'test12345m',
  orderNumber: 'T30000000000040008000000000000206',
  amount: '44000',
  reserved: 'opaque-ticket-callback-nonce-206',
};

function request(overrides: Record<string, string | undefined> = {}, headers: HeadersInit = {}) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...fields, ...overrides })) {
    if (value !== undefined) body.set(name, value);
  }
  return new Request('https://icons.local/api/payments/tickets/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString(),
  });
}

describe('POST /api/payments/tickets/confirm', () => {
  beforeEach(() => {
    mocks.confirmationAvailable = true;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue({
      attemptId: '30000000-0000-4000-8000-000000000206',
      provider: 'korpay',
      outcome: 'approved',
    });
  });

  it('session-independent form callback을 allowlist한 뒤 303 승인 이동한다', async () => {
    const response = await POST(request({ ignored: 'provider-extension' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/tickets?payment=approved');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.confirm).toHaveBeenCalledWith({
      providerOrderId: fields.orderNumber,
      callbackNonce: fields.reserved,
      providerPayload: fields,
    });
  });

  it.each([
    ['unknown', '/tickets?payment=checking'],
    ['needs_review', '/tickets?payment=checking'],
    ['declined', '/tickets?payment=failed'],
    ['canceled', '/tickets?payment=failed'],
  ] as const)('%s를 secret 없는 명시적 303으로 처리한다', async (outcome, location) => {
    mocks.confirm.mockResolvedValue({ attemptId: 'attempt-206', provider: 'korpay', outcome });
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(location);
    expect(response.headers.get('location')).not.toContain(fields.paymentKey);
  });

  it('진행 중 claim은 checking, 계약 오류는 failed로 이동한다', async () => {
    mocks.confirm.mockRejectedValueOnce(new TicketPaymentConfirmationInProgressError());
    expect((await POST(request())).headers.get('location')).toBe('/tickets?payment=checking');

    mocks.confirm.mockRejectedValueOnce(new TicketPaymentContractError('invalid_callback'));
    const invalid = await POST(request());
    expect(invalid.status).toBe(303);
    expect(invalid.headers.get('location')).toBe('/tickets?payment=failed');
    expect(await invalid.text()).not.toContain('invalid_callback');
  });

  it('gate, malformed, duplicate, oversize callback을 domain 호출 전에 차단한다', async () => {
    mocks.confirmationAvailable = false;
    expect((await POST(request())).status).toBe(503);
    mocks.confirmationAvailable = true;

    expect((await POST(request({ amount: undefined }))).status).toBe(400);
    const duplicate = new Request('https://icons.local/api/payments/tickets/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `${new URLSearchParams(fields)}&reserved=duplicate`,
    });
    expect((await POST(duplicate)).status).toBe(400);
    expect((await POST(request({}, { 'content-length': '65537' }))).status).toBe(413);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('parsed callback의 내부 오류는 원문 없이 checking 303으로 fail closed한다', async () => {
    mocks.confirm.mockRejectedValue(new Error('secret provider detail'));
    const failure = await POST(request());
    expect(failure.status).toBe(303);
    expect(failure.headers.get('location')).toBe('/tickets?payment=checking');
    expect(failure.headers.get('location')).not.toContain(fields.paymentKey);
    expect(await failure.text()).not.toContain('secret provider detail');
  });
});
