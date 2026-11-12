import { describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt, PaymentRefundRequest } from './gateway';
import { createTossPaymentGateway } from './toss-gateway.server';

/*
 * 토스 부분 취소(ADR-0031 반품배송비 차감, T12b 품목·수량 부분 취소의 기반).
 * 전액 취소 경로(partial 없음)는 toss-gateway.server.test.ts가 지금 그대로 고정한다.
 */

const CLIENT_KEY = 'test_gck_iconsdocs00000000000001';
const SECRET_KEY = 'test_gsk_iconsdocs00000000000001';
const NOW = new Date('2026-11-12T00:00:00Z');
const MERCHANT_ID = 'ticonsi0xvd';
const PAYMENT_KEY = 'tviva20261112000000abcDEF123456789';

const ATTEMPT: PaymentAttempt = {
  id: '11111111-2222-4333-8444-555555555555',
  provider: 'toss',
  purpose: 'order',
  refId: '99999999-8888-4777-a666-555555555555',
  amount: 30_000,
  currency: 'KRW',
  idempotencyKey: 'attempt-idem-1',
  providerOrderId: 'O0123456789abcdef0123456789abcdef',
  providerProductCode: 'P0123456789abcdef0123456789abcdef',
  expiresAt: '2026-11-12T00:10:00.000Z',
};

const CANCEL_KEY = `refund:${ATTEMPT.id}:deduction:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;

function payment(overrides: Record<string, unknown> = {}) {
  return {
    mId: MERCHANT_ID,
    paymentKey: PAYMENT_KEY,
    orderId: ATTEMPT.providerOrderId,
    status: 'DONE',
    currency: 'KRW',
    method: '카드',
    totalAmount: ATTEMPT.amount,
    balanceAmount: ATTEMPT.amount,
    isPartialCancelable: true,
    taxExemptionAmount: 0,
    lastTransactionKey: 'APPROVE0000000000000000000000001',
    cancels: null,
    virtualAccount: null,
    ...overrides,
  };
}

function partiallyCanceled(balance: number, overrides: Record<string, unknown> = {}) {
  return payment({
    status: balance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED',
    balanceAmount: balance,
    lastTransactionKey: 'CANCEL00000000000000000000000001',
    cancels: [{
      cancelAmount: ATTEMPT.amount - balance,
      cancelReason: 'ICONS 반품 환불(반품배송비 차감)',
      canceledAt: '2026-11-12T09:30:00+09:00',
      transactionKey: 'CANCEL00000000000000000000000001',
      cancelStatus: 'DONE',
    }],
    ...overrides,
  });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Reply = Response | 'network_error';

function server(replies: Reply[]) {
  const queue = [...replies];
  const calls: Array<{ url: string; method: string; body: unknown; idempotencyKey: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      idempotencyKey: headers['idempotency-key'] ?? null,
    });
    const reply = queue.shift();
    if (!reply) throw new Error(`unexpected Toss call: ${url}`);
    if (reply === 'network_error') throw new TypeError('fetch failed');
    return reply;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function gateway(fetchImpl: typeof fetch, merchantBinding: { variantKey: string } | null = { variantKey: 'ICONS' }) {
  return createTossPaymentGateway({
    clientKey: CLIENT_KEY,
    secretKey: SECRET_KEY,
    siteUrl: 'https://iconsip.com',
    fetch: fetchImpl,
    merchantBinding,
    now: () => NOW,
  });
}

function request(overrides: Partial<PaymentRefundRequest> = {}): PaymentRefundRequest {
  return {
    attempt: ATTEMPT,
    idempotencyKey: CANCEL_KEY,
    amount: 27_000,
    reason: 'ICONS 반품 환불(반품배송비 차감)',
    providerPaymentKey: PAYMENT_KEY,
    partial: { expectedBalanceBefore: ATTEMPT.amount },
    ...overrides,
  };
}

const INQUIRY_URL = `https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}`;
const CANCEL_URL = `https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}/cancel`;

describe('토스 부분 취소', () => {
  it.each([
    ['바인딩 켜짐', { variantKey: 'ICONS' }],
    ['바인딩 꺼짐', null],
  ] as const)('잔액을 확인한 뒤 cancelAmount로 취소하고, 취소 뒤 조회 잔액이 기대값일 때만 approved다(%s)', async (_label, binding) => {
    const toss = server([json(200, payment()), json(200, partiallyCanceled(3000)), json(200, partiallyCanceled(3000))]);

    const outcome = await gateway(toss.fetchImpl, binding).refund(request());

    expect(outcome).toEqual({
      attemptId: ATTEMPT.id,
      provider: 'toss',
      outcome: 'approved',
      reasonCode: 'provider_partial_cancel_confirmed',
      refundedAmount: 27_000,
      balanceAfter: 3000,
      evidence: {
        providerPaymentKey: PAYMENT_KEY,
        providerTransactionId: 'CANCEL00000000000000000000000001',
        resultCode: 'PARTIAL_CANCELED',
        approvedAt: '2026-11-12T00:30:00.000Z',
      },
    });
    expect(toss.calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', INQUIRY_URL],
      ['POST', CANCEL_URL],
      ['GET', INQUIRY_URL],
    ]);
    // 취소마다 다른 멱등키(호출자가 준 값)와 취소 금액을 싣는다. 응답 본문은 판정에 쓰지 않는다.
    expect(toss.calls[1]).toMatchObject({
      idempotencyKey: CANCEL_KEY,
      body: { cancelReason: 'ICONS 반품 환불(반품배송비 차감)', cancelAmount: 27_000 },
    });
  });

  it('취소 응답이 200이어도 사후 조회 잔액이 그대로면 확정하지 않는다', async () => {
    const toss = server([json(200, payment()), json(200, partiallyCanceled(3000)), json(200, payment())]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_cancellation_incomplete',
    });
  });

  it('취소 요청이 끊기고 사후 조회 잔액이 그대로면 모호(unknown)로 남긴다', async () => {
    const toss = server([json(200, payment()), 'network_error', json(200, payment())]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'unknown', reasonCode: 'provider_cancel_ambiguous',
    });
  });

  it('취소 요청이 끊겨도 사후 조회 잔액이 기대값이면 approved다', async () => {
    const toss = server([json(200, payment()), 'network_error', json(200, partiallyCanceled(3000))]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'approved', reasonCode: 'provider_partial_cancel_confirmed', refundedAmount: 27_000, balanceAfter: 3000,
    });
  });

  it('이미 이 취소가 반영된 결제(재시도)는 다시 취소하지 않고 approved로 수렴한다', async () => {
    const toss = server([json(200, partiallyCanceled(3000))]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'approved', reasonCode: 'provider_already_partially_canceled', refundedAmount: 27_000, balanceAfter: 3000,
    });
    expect(toss.calls).toHaveLength(1);
  });

  it.each([
    ['isPartialCancelable=false', payment({ isPartialCancelable: false }), 'partial_cancel_not_allowed'],
    ['isPartialCancelable 누락', payment({ isPartialCancelable: undefined }), 'partial_cancel_not_allowed'],
    ['과세 제외 금액', payment({ taxExemptionAmount: 1000 }), 'tax_exemption_amount'],
    ['가상계좌', payment({ method: '가상계좌', virtualAccount: { accountNumber: 'X0000' } }), 'virtual_account'],
  ])('부분 취소를 받지 않는 결제(%s)는 취소 API를 부르지 않고 declined다', async (_label, body, blocker) => {
    const toss = server([json(200, body)]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toEqual({
      attemptId: ATTEMPT.id,
      provider: 'toss',
      outcome: 'declined',
      reasonCode: 'provider_partial_cancel_unavailable',
      evidence: { providerPaymentKey: PAYMENT_KEY, resultCode: blocker },
    });
    expect(toss.calls).toHaveLength(1);
  });

  it.each([
    ['이미 전액 취소', partiallyCanceled(0)],
    ['다른 금액으로 부분 취소됨', partiallyCanceled(5000)],
    ['잔액은 같지만 상태가 다름', payment({ status: 'PARTIAL_CANCELED' })],
  ])('취소 전 잔액·상태가 기대와 다르면(%s) 취소하지 않고 결제확인필요다', async (_label, body) => {
    const toss = server([json(200, body)]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_balance_mismatch', evidence: { providerPaymentKey: PAYMENT_KEY },
    });
    expect(toss.calls).toHaveLength(1);
  });

  it('취소 뒤 잔액이 기대와 다르면 결제확인필요다', async () => {
    const toss = server([json(200, payment()), json(200, partiallyCanceled(0)), json(200, partiallyCanceled(0))]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_balance_mismatch',
    });
  });

  it('취소 거절 코드는 결제확인필요다', async () => {
    const toss = server([json(200, payment()), json(400, { code: 'NOT_CANCELABLE_AMOUNT', message: 'x' })]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_cancel_rejected', evidence: { resultCode: 'NOT_CANCELABLE_AMOUNT' },
    });
    expect(toss.calls).toHaveLength(2);
  });

  it('부분 환불 불가 거절(NOT_ALLOWED_PARTIAL_REFUND)은 조회로 잔액 그대로를 확인한 뒤에만 부분 취소 불가로 돌려준다', async () => {
    const unchanged = server([json(200, payment()), json(403, { code: 'NOT_ALLOWED_PARTIAL_REFUND', message: 'x' }), json(200, payment())]);
    await expect(gateway(unchanged.fetchImpl).refund(request())).resolves.toEqual({
      attemptId: ATTEMPT.id,
      provider: 'toss',
      outcome: 'declined',
      reasonCode: 'provider_partial_cancel_unavailable',
      evidence: { providerPaymentKey: PAYMENT_KEY, resultCode: 'NOT_ALLOWED_PARTIAL_REFUND' },
    });
    expect(unchanged.calls).toHaveLength(3);
    // 거절 응답과 달리 조회가 이미 반영된 취소를 보이면 그 사실을 따른다.
    const applied = server([json(200, payment()), json(403, { code: 'NOT_ALLOWED_PARTIAL_REFUND', message: 'x' }), json(200, partiallyCanceled(3000))]);
    await expect(gateway(applied.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'approved', reasonCode: 'provider_partial_cancel_confirmed',
    });
  });

  it('다른 상점(MID)의 결제는 이미 부분 취소된 것처럼 보여도 수렴하지 않고 격리한다', async () => {
    const toss = server([json(200, partiallyCanceled(3000, { mId: 'tvivarepublica' }))]);
    await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_merchant_mismatch',
    });
    expect(toss.calls).toHaveLength(1);
  });

  it('다른 주문·다른 총액의 결제면 취소하지 않는다', async () => {
    for (const body of [payment({ orderId: 'Oother' }), payment({ totalAmount: 31_000 })]) {
      const toss = server([json(200, body)]);
      await expect(gateway(toss.fetchImpl).refund(request())).resolves.toMatchObject({
        outcome: 'needs_review', reasonCode: 'provider_identity_mismatch',
      });
      expect(toss.calls).toHaveLength(1);
    }
  });

  it('조회가 끊기면 unknown, 없으면 결제확인필요다', async () => {
    await expect(gateway(server(['network_error']).fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'unknown', reasonCode: 'provider_unavailable',
    });
    await expect(gateway(server([json(404, { code: 'NOT_FOUND_PAYMENT' })]).fetchImpl).refund(request())).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_payment_not_found',
    });
  });

  it.each([
    ['취소 금액 0', { amount: 0 }],
    ['취소 금액이 기대 잔액보다 큼', { amount: 31_000 }],
    ['기대 잔액이 결제 금액보다 큼', { partial: { expectedBalanceBefore: 31_000 } }],
    ['원장 결제 키 없음', { providerPaymentKey: undefined }],
    ['멱등키 형식 밖', { idempotencyKey: 'has space' }],
  ])('요청이 계약 밖이면(%s) 결제사를 부르지 않는다', async (_label, overrides) => {
    const toss = server([]);
    await expect(gateway(toss.fetchImpl).refund(request(overrides as Partial<PaymentRefundRequest>))).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_refund_request_invalid',
    });
    expect(toss.calls).toHaveLength(0);
  });

  it('여러 번 부분 취소(T12b 기반): 두 번째 취소는 앞 취소 뒤 잔액을 기대값으로 받고 남은 잔액 전부면 CANCELED가 성공이다', async () => {
    const toss = server([json(200, partiallyCanceled(3000)), json(200, partiallyCanceled(0)), json(200, partiallyCanceled(0))]);
    await expect(gateway(toss.fetchImpl).refund(request({
      amount: 3000,
      idempotencyKey: `refund:${ATTEMPT.id}:partial:second`,
      partial: { expectedBalanceBefore: 3000 },
    }))).resolves.toMatchObject({
      outcome: 'approved', reasonCode: 'provider_partial_cancel_confirmed', refundedAmount: 3000, balanceAfter: 0,
      evidence: { resultCode: 'CANCELED' },
    });
    expect(toss.calls[1]).toMatchObject({ idempotencyKey: `refund:${ATTEMPT.id}:partial:second`, body: { cancelAmount: 3000 } });
  });

  it('부분 취소 요청이 아니면 결제 금액과 다른 금액을 지금처럼 거절한다(전액 취소 계약 불변)', async () => {
    const toss = server([]);
    await expect(gateway(toss.fetchImpl).refund(request({ partial: undefined }))).resolves.toMatchObject({
      outcome: 'needs_review', reasonCode: 'provider_refund_amount_mismatch',
    });
    expect(toss.calls).toHaveLength(0);
  });
});
