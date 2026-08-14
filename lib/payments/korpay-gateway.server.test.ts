import { describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt } from './gateway';
import { createKorpayPaymentGateway } from './korpay-gateway.server';

const FIXED_NOW = new Date('2025-12-11T15:10:23+09:00');
const ATTEMPT: PaymentAttempt = {
  id: '30000000-0000-4000-8000-000000000205',
  provider: 'korpay',
  purpose: 'order',
  refId: '20000000-0000-4000-8000-000000000205',
  amount: 31_000,
  currency: 'KRW',
  idempotencyKey: 'goods:20000000-0000-4000-8000-000000000205',
  providerOrderId: 'O30000000000040008000000000000205',
  providerProductCode: 'P30000000000040008000000000000205',
  expiresAt: '2025-12-11T06:20:23.000Z',
};

const MERCHANT_ID = 'test12345m';
const MERCHANT_KEY = 'merchant-test-key-205';

function successResponse(
  reserved: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    resultCode: '3001',
    message: 'success',
    tid: 'opaque-tid-205',
    merchantId: MERCHANT_ID,
    orderNumber: ATTEMPT.providerOrderId,
    productName: ATTEMPT.providerProductCode,
    currency: 'KRW',
    amount: ATTEMPT.amount,
    approvedAt: '20251211151101',
    payMethod: 'CARD',
    reserved,
    card: {
      cardNumber: '1234********5678',
      approvalCode: 'issuer-code',
      installment: '00',
      approvalNumber: 'approval-205',
      usePointAmt: 0,
      remainPointAmt: 0,
    },
    ...overrides,
  };
}

function callbackPayload(callbackNonce: string, overrides: Record<string, unknown> = {}) {
  return {
    resultCode: '0000',
    message: 'authenticated',
    paymentKey: 'opaque-payment-key-205',
    merchantId: MERCHANT_ID,
    orderNumber: ATTEMPT.providerOrderId,
    amount: String(ATTEMPT.amount),
    reserved: callbackNonce,
    ...overrides,
  };
}

function gateway(fetchImpl: typeof fetch = vi.fn()) {
  return createKorpayPaymentGateway({
    merchantId: MERCHANT_ID,
    merchantKey: MERCHANT_KEY,
    siteUrl: 'https://icons.example',
    fetch: fetchImpl,
    now: () => FIXED_NOW,
  });
}

async function preparedNonce() {
  return (await gateway().prepare(ATTEMPT)).callbackNonce;
}

describe('Korpay payment gateway', () => {
  it('published hash algorithm을 고정 vector로 검증하고 결정적인 nonce/action을 만든다', async () => {
    let currentTime = FIXED_NOW;
    const subject = createKorpayPaymentGateway({
      merchantId: MERCHANT_ID,
      merchantKey: MERCHANT_KEY,
      siteUrl: 'https://icons.example',
      fetch: vi.fn(),
      now: () => currentTime,
    });

    const first = await subject.prepare(ATTEMPT);
    currentTime = new Date(FIXED_NOW.getTime() + 4 * 60_000);
    const second = await subject.prepare(ATTEMPT);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      attemptId: ATTEMPT.id,
      provider: 'korpay',
      expiresAt: ATTEMPT.expiresAt,
      action: {
        kind: 'client_sdk',
        payload: {
          merchantId: MERCHANT_ID,
          productName: ATTEMPT.providerProductCode,
          orderNumber: ATTEMPT.providerOrderId,
          amount: ATTEMPT.amount,
          payMethod: 'card',
          returnUrl: 'https://icons.example/api/payments/goods/confirm',
          ediDate: '20251211151023',
          hashKey: '044531d13cef45bc3122053d9234ba3ba0aa17631aec62c0fb6c1901aa60fec7',
          language: 'ko',
        },
      },
    });
    expect(first.callbackNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(first)).not.toContain(MERCHANT_KEY);
    expect(JSON.stringify(first)).not.toContain(ATTEMPT.refId);
  });

  it('티켓은 ticket callback을 사용하고 범위를 벗어난 attempt는 provider 호출 전에 거부한다', async () => {
    const ticket = await gateway().prepare({
      ...ATTEMPT,
      purpose: 'ticket',
      providerOrderId: `T${ATTEMPT.providerOrderId.slice(1)}`,
    });
    expect(ticket.action).toMatchObject({
      kind: 'client_sdk',
      payload: { returnUrl: 'https://icons.example/api/payments/tickets/confirm' },
    });

    await expect(gateway().prepare({ ...ATTEMPT, amount: 999 }))
      .rejects.toThrow('invalid_payment_attempt');
    await expect(gateway().prepare({ ...ATTEMPT, provider: 'toss' }))
      .rejects.toThrow('invalid_payment_attempt');
    await expect(gateway().prepare({ ...ATTEMPT, providerOrderId: 'raw-order-id' }))
      .rejects.toThrow('invalid_payment_attempt');
    await expect(gateway().prepare({ ...ATTEMPT, expiresAt: '2099-08-13T10:10:00.000Z' }))
      .rejects.toThrow('invalid_payment_attempt');
  });

  it('authentication 성공은 confirm을 정확히 한 번 호출하고 allowlisted evidence만 반환한다', async () => {
    const nonce = await preparedNonce();
    const fetchImpl = vi.fn(async () => Response.json(successResponse(nonce)));
    const subject = gateway(fetchImpl as typeof fetch);

    const result = await subject.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://payments.korpay.com/v1/payments/confirm?paymentKey=opaque-payment-key-205',
      expect.objectContaining({ method: 'POST', body: undefined }),
    );
    expect(result).toEqual({
      attemptId: ATTEMPT.id,
      provider: 'korpay',
      outcome: 'approved',
      reasonCode: 'provider_approved',
      evidence: {
        providerPaymentKey: 'opaque-payment-key-205',
        providerTransactionId: 'opaque-tid-205',
        providerApprovalReference: 'approval-205',
        resultCode: '3001',
        paymentMethod: 'CARD',
        maskedPaymentMethod: '1234********5678',
      },
    });
  });

  it.each([
    ['merchantId', { merchantId: 'other12345m' }],
    ['orderNumber', { orderNumber: 'O99999999999949999999999999999999' }],
    ['productName', { productName: 'P99999999999949999999999999999999' }],
    ['currency', { currency: 'USD' }],
    ['amount', { amount: ATTEMPT.amount + 1 }],
    ['payMethod', { payMethod: 'BANK' }],
    ['card', { card: null }],
  ])('confirm response %s mismatch는 승인하지 않는다', async (_field, overrides) => {
    const nonce = await preparedNonce();
    const fetchImpl = vi.fn(async () => Response.json(successResponse(nonce, overrides)));
    const subject = gateway(fetchImpl as typeof fetch);

    await expect(subject.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce),
    })).resolves.toMatchObject({
      outcome: 'needs_review',
      reasonCode: 'provider_identity_mismatch',
    });
  });

  it('callback identity mismatch는 confirm network 전에 차단한다', async () => {
    const fetchImpl = vi.fn();
    const subject = gateway(fetchImpl as typeof fetch);
    const nonce = await preparedNonce();

    const result = await subject.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce, { merchantId: 'other12345m' }),
    });

    expect(result).toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_identity_mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('사용자 취소와 인증 실패는 confirm network 없이 명시적으로 종료한다', async () => {
    const fetchImpl = vi.fn();
    const subject = gateway(fetchImpl as typeof fetch);
    const nonce = await preparedNonce();

    await expect(subject.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce, { resultCode: 'E111', paymentKey: undefined }),
    })).resolves.toMatchObject({ outcome: 'canceled', reasonCode: 'provider_user_canceled' });
    await expect(subject.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce, { resultCode: 'E999', paymentKey: undefined }),
    })).resolves.toMatchObject({ outcome: 'declined', reasonCode: 'provider_authentication_failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('duplicate confirm은 needs_review, 명시 decline은 declined로 분류한다', async () => {
    const nonce = await preparedNonce();
    const duplicate = gateway(vi.fn(async () => Response.json({ resultCode: '1651', message: 'duplicate' })) as typeof fetch);
    await expect(duplicate.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce),
    })).resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_duplicate_requires_review' });

    const declined = gateway(vi.fn(async () => Response.json({ resultCode: '3002', message: 'declined' })) as typeof fetch);
    await expect(declined.confirm({
      attempt: ATTEMPT,
      idempotencyKey: `confirm:${ATTEMPT.id}`,
      providerOrderId: ATTEMPT.providerOrderId,
      callbackNonce: nonce,
      providerPayload: callbackPayload(nonce),
    })).resolves.toMatchObject({ outcome: 'declined', reasonCode: 'provider_declined' });
  });

  it('timeout, non-JSON, oversized 응답은 자동 재시도 없이 unknown이다', async () => {
    const nonce = await preparedNonce();
    const cases: Array<typeof fetch> = [
      vi.fn(async () => { throw new DOMException('timeout', 'AbortError'); }) as typeof fetch,
      vi.fn(async () => new Response('<html>bad</html>', { status: 502 })) as typeof fetch,
      vi.fn(async () => new Response(JSON.stringify({ resultCode: '3001', padding: 'x'.repeat(65_537) }))) as typeof fetch,
    ];

    for (const fetchImpl of cases) {
      const subject = gateway(fetchImpl);
      await expect(subject.confirm({
        attempt: ATTEMPT,
        idempotencyKey: `confirm:${ATTEMPT.id}`,
        providerOrderId: ATTEMPT.providerOrderId,
        callbackNonce: nonce,
        providerPayload: callbackPayload(nonce),
      })).resolves.toMatchObject({ outcome: 'unknown' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('공식 자동 조회·취소 API가 없으므로 reconcile/refund를 성공으로 가장하지 않는다', async () => {
    const fetchImpl = vi.fn();
    const subject = gateway(fetchImpl as typeof fetch);

    await expect(subject.reconcile(ATTEMPT)).resolves.toMatchObject({
      outcome: 'needs_review',
      reasonCode: 'provider_reconciliation_unavailable',
    });
    await expect(subject.refund({
      attempt: ATTEMPT,
      idempotencyKey: `refund:${ATTEMPT.id}`,
      amount: ATTEMPT.amount,
      reason: 'user_requested',
    })).resolves.toMatchObject({
      outcome: 'needs_review',
      reasonCode: 'provider_manual_cancellation_required',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
