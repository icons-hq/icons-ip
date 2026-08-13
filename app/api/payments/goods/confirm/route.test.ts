import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome } from '@/lib/payments/gateway';
import { GoodsPaymentConfirmationInProgressError } from '@/lib/payments/goods-checkout';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  enabled: true,
  confirm: vi.fn(),
}));

vi.mock('@/lib/payments/goods-checkout-availability', () => ({
  goodsCheckoutPaymentsEnabled: () => mocks.enabled,
}));
vi.mock('@/lib/payments/goods-checkout.runtime.server', () => ({
  createRuntimeGoodsPaymentCheckout: () => ({ confirm: mocks.confirm }),
}));

const callback = {
  providerOrderId: 'O30000000000040008000000000000205',
  callbackNonce: 'opaque-callback-nonce-205',
  providerPayload: { resultCode: '0000', rawOnlyAtProviderBoundary: true },
};

function request(body: unknown, headers?: HeadersInit) {
  return new Request('https://icons.example/api/payments/goods/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
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
    mocks.enabled = true;
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(outcome('approved'));
  });

  it('session 없이 opaque callback을 공통 confirm seam으로 전달한다', async () => {
    const result = await POST(request(callback));

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      attemptId: '30000000-0000-4000-8000-000000000205',
      outcome: 'approved',
    });
    expect(mocks.confirm).toHaveBeenCalledWith(callback);
  });

  it.each(['unknown', 'needs_review'] as const)(
    '%s는 fulfillment 성공으로 응답하지 않는다',
    async (paymentOutcome) => {
      mocks.confirm.mockResolvedValue(outcome(paymentOutcome));
      const result = await POST(request(callback));
      expect(result.status).toBe(202);
      await expect(result.json()).resolves.toMatchObject({ outcome: paymentOutcome });
    },
  );

  it('중복 callback claim이 진행 중이면 provider를 재시도하지 않는 202를 반환한다', async () => {
    mocks.confirm.mockRejectedValue(new GoodsPaymentConfirmationInProgressError());
    const result = await POST(request(callback));
    expect(result.status).toBe(202);
    await expect(result.json()).resolves.toEqual({ outcome: 'unknown' });
  });

  it('malformed/oversized callback을 provider 호출 전에 거부한다', async () => {
    const malformed = await POST(request(null));
    expect(malformed.status).toBe(400);

    const oversized = await POST(request(callback, { 'content-length': '65537' }));
    expect(oversized.status).toBe(413);

    const streamedOversized = await POST(request({
      ...callback,
      providerPayload: { oversized: 'x'.repeat(65_537) },
    }));
    expect(streamedOversized.status).toBe(413);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('runtime gate는 default OFF이고 내부 오류 원문을 응답하지 않는다', async () => {
    mocks.enabled = false;
    const unavailable = await POST(request(callback));
    expect(unavailable.status).toBe(503);

    mocks.enabled = true;
    mocks.confirm.mockRejectedValue(new Error('private provider secret'));
    const failed = await POST(request(callback));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('private provider secret');
  });
});
