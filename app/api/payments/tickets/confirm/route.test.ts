import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
} from '@/lib/payments/ticket-checkout';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  available: true,
  confirm: vi.fn(),
}));

vi.mock('@/lib/payments/ticket-checkout-availability', () => ({
  ticketCheckoutPaymentsEnabled: () => mocks.available,
}));
vi.mock('@/lib/payments/ticket-checkout.runtime.server', () => ({
  createRuntimeTicketPaymentCheckout: () => ({ confirm: mocks.confirm }),
}));

const callback = {
  providerOrderId: 'T30000000000040008000000000000206',
  callbackNonce: 'opaque-ticket-callback-nonce-206',
  providerPayload: { resultCode: '0000' },
};

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request('https://icons.local/api/payments/tickets/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/payments/tickets/confirm', () => {
  beforeEach(() => {
    mocks.available = true;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue({
      attemptId: '30000000-0000-4000-8000-000000000206',
      provider: 'korpay',
      outcome: 'approved',
    });
  });

  it('세션 없이 opaque order와 nonce만 deep module에 전달한다', async () => {
    const response = await POST(request(callback));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ outcome: 'approved' });
    expect(mocks.confirm).toHaveBeenCalledWith(callback);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['unknown', 'needs_review'])('%s는 fulfillment 성공으로 가장하지 않고 202다', async (outcome) => {
    mocks.confirm.mockResolvedValue({ attemptId: 'attempt-206', provider: 'korpay', outcome });
    const response = await POST(request(callback));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ attemptId: 'attempt-206', outcome });
  });

  it('중복 callback claim 처리 중에는 provider를 재호출하지 않고 202다', async () => {
    mocks.confirm.mockRejectedValue(new TicketPaymentConfirmationInProgressError());
    const response = await POST(request(callback));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ outcome: 'unknown' });
  });

  it('gate·malformed·oversize callback을 provider 호출 전에 차단한다', async () => {
    mocks.available = false;
    expect((await POST(request(callback))).status).toBe(503);
    mocks.available = true;

    expect((await POST(request([]))).status).toBe(400);
    expect((await POST(request(callback, { 'content-length': '65537' }))).status).toBe(413);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('계약 오류와 내부 오류를 provider 원문 없이 구분한다', async () => {
    mocks.confirm.mockRejectedValueOnce(new TicketPaymentContractError('invalid_callback'));
    const invalid = await POST(request(callback));
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(await invalid.json())).not.toContain('invalid_callback)');

    mocks.confirm.mockRejectedValueOnce(new Error('secret provider detail'));
    const failure = await POST(request(callback));
    expect(failure.status).toBe(502);
    expect(JSON.stringify(await failure.json())).not.toContain('secret provider detail');
  });
});
