import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome } from '@/lib/payments/gateway';
import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
} from '@/lib/payments/goods-checkout';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  confirmationAvailable: true,
  confirm: vi.fn(),
}));

vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsPaymentConfirmationAvailable: () => mocks.confirmationAvailable,
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: () => ({ confirm: mocks.confirm }),
}));

const fields = {
  resultCode: '0000',
  message: 'authenticated',
  paymentKey: 'opaque-payment-key-205',
  merchantId: 'test12345m',
  orderNumber: 'O30000000000040008000000000000205',
  amount: '31000',
  reserved: 'opaque-callback-nonce-205',
};

function request(
  overrides: Record<string, string | undefined> = {},
  headers: HeadersInit = {},
) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...fields, ...overrides })) {
    if (value !== undefined) body.set(name, value);
  }
  return new Request('https://icons.example/api/payments/goods/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', ...headers },
    body: body.toString(),
  });
}

function outcome(value: ConfirmOutcome['outcome']): ConfirmOutcome {
  return {
    attemptId: '30000000-0000-4000-8000-000000000205',
    provider: 'korpay',
    outcome: value,
  };
}

describe('POST /api/payments/goods/confirm', () => {
  beforeEach(() => {
    mocks.confirmationAvailable = true;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(outcome('approved'));
  });

  it('form callback을 allowlist payload로 변환하고 신규 checkout OFF와 무관하게 303 승인 이동한다', async () => {
    const result = await POST(request({ ignoredProviderField: 'must-not-enter-domain' }));

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=approved');
    expect(result.headers.get('cache-control')).toBe('no-store');
    await expect(result.text()).resolves.toBe('');
    expect(mocks.confirm).toHaveBeenCalledWith({
      providerOrderId: fields.orderNumber,
      callbackNonce: fields.reserved,
      providerPayload: fields,
    });
  });

  it.each([
    ['unknown', '/orders?payment=checking'],
    ['needs_review', '/orders?payment=checking'],
    ['declined', '/orders?payment=failed'],
    ['canceled', '/orders?payment=failed'],
  ] as const)('%s는 secret 없는 명시적 303 위치로 이동한다', async (paymentOutcome, location) => {
    mocks.confirm.mockResolvedValue(outcome(paymentOutcome));
    const result = await POST(request());
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe(location);
    expect(result.headers.get('location')).not.toContain(fields.paymentKey);
  });

  it('중복 callback claim이 진행 중이면 provider 재시도 없이 checking으로 이동한다', async () => {
    mocks.confirm.mockRejectedValue(new GoodsPaymentConfirmationInProgressError());
    const result = await POST(request());
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=checking');
  });

  it('known callback 계약 오류는 provider 값을 노출하지 않고 실패 위치로 이동한다', async () => {
    mocks.confirm.mockRejectedValue(new GoodsPaymentContractError('unknown_order'));
    const result = await POST(request());
    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe('/orders?payment=failed');
    expect(await result.text()).not.toContain('unknown_order');
  });

  it('content type, required fields, duplicate key, oversized callback을 domain 호출 전에 거부한다', async () => {
    const wrongType = new Request('https://icons.example/api/payments/goods/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect((await POST(wrongType)).status).toBe(400);
    expect((await POST(request({ reserved: undefined }))).status).toBe(400);
    expect((await POST(request({ paymentKey: 'p'.repeat(201) }))).status).toBe(400);

    const duplicate = new Request('https://icons.example/api/payments/goods/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `${new URLSearchParams(fields)}&orderNumber=duplicate`,
    });
    expect((await POST(duplicate)).status).toBe(400);
    expect((await POST(request({}, { 'content-length': '65537' }))).status).toBe(413);
    expect((await POST(request({ message: 'x'.repeat(65_537) }))).status).toBe(413);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('runtime readiness OFF는 503, parsed callback의 내부 오류는 checking 303으로 fail closed한다', async () => {
    mocks.confirmationAvailable = false;
    expect((await POST(request())).status).toBe(503);

    mocks.confirmationAvailable = true;
    mocks.confirm.mockRejectedValue(new Error('private provider secret'));
    const failed = await POST(request());
    expect(failed.status).toBe(303);
    expect(failed.headers.get('location')).toBe('/orders?payment=checking');
    expect(failed.headers.get('location')).not.toContain(fields.paymentKey);
    expect(await failed.text()).not.toContain('private provider secret');
  });
});
