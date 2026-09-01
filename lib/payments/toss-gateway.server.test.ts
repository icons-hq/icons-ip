import { describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt } from './gateway';
import { createTossPaymentGateway } from './toss-gateway.server';

const CLIENT_KEY = 'test_gck_iconsdocs00000000000001';
const SECRET_KEY = 'test_gsk_iconsdocs00000000000001';
const SITE_URL = 'https://iconsip.com';
const NOW = new Date('2026-09-01T00:00:00Z');

const ATTEMPT: PaymentAttempt = {
  id: '11111111-2222-4333-8444-555555555555',
  provider: 'toss',
  purpose: 'order',
  refId: '99999999-8888-4777-a666-555555555555',
  amount: 42_000,
  currency: 'KRW',
  idempotencyKey: 'attempt-idem-1',
  providerOrderId: 'O0123456789abcdef0123456789abcdef',
  providerProductCode: 'P0123456789abcdef0123456789abcdef',
  expiresAt: '2026-09-01T00:10:00.000Z',
};

const TICKET_ATTEMPT: PaymentAttempt = {
  ...ATTEMPT,
  purpose: 'ticket',
  providerOrderId: 'T0123456789abcdef0123456789abcdef',
};

const PAYMENT_KEY = 'tviva20260901000000abcDEF123456789';

function donePayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentKey: PAYMENT_KEY,
    orderId: ATTEMPT.providerOrderId,
    orderName: 'ICONS 굿즈 주문',
    status: 'DONE',
    currency: 'KRW',
    totalAmount: ATTEMPT.amount,
    balanceAmount: ATTEMPT.amount,
    lastTransactionKey: 'B7103F204998813B889C77C043D09502',
    method: '카드',
    card: { number: '48902300****406*', approveNo: '00000000' },
    easyPay: null,
    approvedAt: '2026-09-01T09:00:21+09:00',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gateway(overrides: {
  fetch?: typeof fetch;
  now?: () => Date;
  clientKey?: string;
  secretKey?: string;
} = {}) {
  const fetchImpl = overrides.fetch ?? (vi.fn() as unknown as typeof fetch);
  return {
    gateway: createTossPaymentGateway({
      clientKey: overrides.clientKey ?? CLIENT_KEY,
      secretKey: overrides.secretKey ?? SECRET_KEY,
      siteUrl: SITE_URL,
      fetch: fetchImpl,
      now: overrides.now ?? (() => NOW),
    }),
    fetchImpl: fetchImpl as ReturnType<typeof vi.fn>,
  };
}

async function confirmInput(payloadOverrides: Record<string, unknown> = {}, attempt = ATTEMPT) {
  const { gateway: prepareGateway } = gateway();
  const prepared = await prepareGateway.prepare(attempt);
  return {
    attempt,
    idempotencyKey: `confirm:${attempt.id}`,
    providerOrderId: attempt.providerOrderId,
    callbackNonce: prepared.callbackNonce,
    providerPayload: {
      paymentKey: PAYMENT_KEY,
      orderId: attempt.providerOrderId,
      amount: String(attempt.amount),
      paymentType: 'NORMAL',
      ...payloadOverrides,
    },
  };
}

describe('TossPayments v2 gateway', () => {
  it('클라이언트·시크릿 키 형식이나 모드가 어긋나면 게이트웨이를 만들지 않는다', () => {
    expect(() => gateway({ clientKey: 'test_ck_wrongfamily000000000001' }))
      .toThrow('invalid_toss_configuration');
    expect(() => gateway({ secretKey: 'live_gsk_iconsdocs00000000000001' }))
      .toThrow('invalid_toss_configuration');
    expect(() => gateway({ secretKey: 'test_sk_legacyapikey000000000001' }))
      .toThrow('invalid_toss_configuration');
  });

  describe('prepare', () => {
    it('주문서형 위젯 payload를 만들고 nonce를 successUrl 경로에 싣는다', async () => {
      const { gateway: tossGateway, fetchImpl } = gateway();
      const prepared = await tossGateway.prepare(ATTEMPT);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(prepared.provider).toBe('toss');
      expect(prepared.attemptId).toBe(ATTEMPT.id);
      expect(prepared.expiresAt).toBe(ATTEMPT.expiresAt);
      expect(prepared.callbackNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(prepared.action.kind).toBe('client_sdk');
      if (prepared.action.kind !== 'client_sdk') throw new Error('unreachable');
      expect(prepared.action.payload).toEqual({
        provider: 'toss',
        clientKey: CLIENT_KEY,
        customerKey: 'ANONYMOUS',
        orderId: ATTEMPT.providerOrderId,
        orderName: 'ICONS 굿즈 주문',
        amount: ATTEMPT.amount,
        currency: 'KRW',
        successUrl: `${SITE_URL}/api/payments/goods/confirm/toss/${prepared.callbackNonce}`,
        failUrl: `${SITE_URL}/checkout`,
      });
    });

    it('티켓 attempt는 티켓 confirm 경로와 티켓 주문명을 쓴다', async () => {
      const { gateway: tossGateway } = gateway();
      const prepared = await tossGateway.prepare(TICKET_ATTEMPT);
      if (prepared.action.kind !== 'client_sdk') throw new Error('unreachable');
      expect(prepared.action.payload.orderName).toBe('ICONS 티켓 주문');
      expect(prepared.action.payload.successUrl).toBe(
        `${SITE_URL}/api/payments/tickets/confirm/toss/${prepared.callbackNonce}`,
      );
      expect(prepared.action.payload.failUrl).toBe(`${SITE_URL}/tickets`);
    });

    it('재-prepare는 바이트 안정적이다', async () => {
      const { gateway: tossGateway } = gateway();
      const first = await tossGateway.prepare(ATTEMPT);
      const second = await tossGateway.prepare(ATTEMPT);
      expect(second).toEqual(first);
    });

    it('시크릿 키와 내부 주문 식별자를 payload에 싣지 않는다', async () => {
      const { gateway: tossGateway } = gateway();
      const prepared = await tossGateway.prepare(ATTEMPT);
      expect(JSON.stringify(prepared)).not.toContain(SECRET_KEY);
      // provider로 나가는 payload에는 내부 식별자가 없어야 한다 — attemptId는
      // PreparedCheckout 최상위 계약 필드라 검사 대상이 아니다.
      const providerFacing = JSON.stringify(prepared.action);
      expect(providerFacing).not.toContain(ATTEMPT.refId);
      expect(providerFacing).not.toContain(ATTEMPT.id);
    });

    it.each([
      ['korpay provider', { ...ATTEMPT, provider: 'korpay' as const }],
      ['100원 미만 금액', { ...ATTEMPT, amount: 99 }],
      ['원시 주문번호', { ...ATTEMPT, providerOrderId: ATTEMPT.refId }],
      ['purpose와 접두사 불일치', { ...ATTEMPT, providerOrderId: TICKET_ATTEMPT.providerOrderId }],
      ['깨진 만료 시각', { ...ATTEMPT, expiresAt: 'not-a-date' }],
    ])('범위 밖 attempt를 거부한다: %s', async (_label, attempt) => {
      const { gateway: tossGateway } = gateway();
      await expect(tossGateway.prepare(attempt as PaymentAttempt))
        .rejects.toThrow('invalid_payment_attempt');
    });

    it('이미 만료된 attempt는 prepare를 거부한다', async () => {
      const { gateway: tossGateway } = gateway({
        now: () => new Date('2026-09-01T00:20:00Z'),
      });
      await expect(tossGateway.prepare(ATTEMPT)).rejects.toThrow('invalid_payment_attempt');
    });
  });

  describe('confirm', () => {
    it('승인 API를 서버 저장 금액·멱등키·Basic 인증으로 호출하고 approved를 돌려준다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });
      const input = await confirmInput();

      const outcome = await tossGateway.confirm(input);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe('https://api.tosspayments.com/v1/payments/confirm');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe(
        `Basic ${Buffer.from(`${SECRET_KEY}:`, 'utf8').toString('base64')}`,
      );
      expect(init.headers['idempotency-key']).toBe(`confirm:${ATTEMPT.id}`);
      expect(init.headers['content-type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        paymentKey: PAYMENT_KEY,
        orderId: ATTEMPT.providerOrderId,
        amount: ATTEMPT.amount,
      });

      expect(outcome.outcome).toBe('approved');
      expect(outcome.reasonCode).toBe('provider_approved');
      expect(outcome.evidence).toEqual({
        providerPaymentKey: PAYMENT_KEY,
        providerTransactionId: 'B7103F204998813B889C77C043D09502',
        providerApprovalReference: '00000000',
        resultCode: 'DONE',
        paymentMethod: '카드',
        maskedPaymentMethod: '48902300****406*',
        approvedAt: new Date('2026-09-01T09:00:21+09:00').toISOString(),
      });
    });

    it('간편결제 승인은 간편결제사 표시를 증거로 남긴다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment({
        method: '간편결제',
        card: null,
        easyPay: { provider: '토스페이', amount: ATTEMPT.amount, discountAmount: 0 },
      })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('approved');
      expect(outcome.evidence?.paymentMethod).toBe('간편결제');
      expect(outcome.evidence?.maskedPaymentMethod).toBe('토스페이');
    });

    it('successUrl 금액이 서버 저장 금액과 다르면 승인 API를 호출하지 않는다', async () => {
      const fetchImpl = vi.fn();
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });
      const input = await confirmInput({ amount: String(ATTEMPT.amount + 1) });

      const outcome = await tossGateway.confirm(input);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_amount_mismatch');
    });

    it.each([
      ['nonce 불일치', { callbackNonce: 'A'.repeat(43) }],
      ['providerOrderId 불일치', { providerOrderId: TICKET_ATTEMPT.providerOrderId }],
    ])('콜백 identity가 어긋나면 네트워크에 닿지 않는다: %s', async (_label, override) => {
      const fetchImpl = vi.fn();
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });
      const input = { ...(await confirmInput()), ...override };

      const outcome = await tossGateway.confirm(input);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_identity_mismatch');
    });

    it('payload orderId가 attempt와 다르면 네트워크에 닿지 않는다', async () => {
      const fetchImpl = vi.fn();
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });
      const input = await confirmInput({ orderId: TICKET_ATTEMPT.providerOrderId });

      const outcome = await tossGateway.confirm(input);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(outcome.reasonCode).toBe('provider_identity_mismatch');
    });

    it('paymentKey가 계약 형식을 벗어나면 네트워크에 닿지 않는다', async () => {
      const fetchImpl = vi.fn();
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });
      const input = await confirmInput({ paymentKey: 'p'.repeat(201) });

      const outcome = await tossGateway.confirm(input);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_invalid_callback');
    });

    it('승인 응답의 결제 identity가 다르면 needs_review로 격리한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment({
        totalAmount: ATTEMPT.amount + 1,
      })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_identity_mismatch');
    });

    it('카드사 거절은 조회 없이 declined로 종결한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, {
        code: 'REJECT_CARD_COMPANY',
        message: '결제 승인이 거절되었습니다.',
      }));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_declined');
      expect(outcome.evidence?.resultCode).toBe('REJECT_CARD_COMPANY');
    });

    it('구매자 결제창 이탈 코드는 canceled로 종결한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, {
        code: 'PAY_PROCESS_CANCELED',
        message: '결제가 사용자에 의해 취소되었습니다.',
      }));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('canceled');
      expect(outcome.reasonCode).toBe('provider_user_canceled');
    });

    it('키 설정 오류는 needs_review로 격리한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {
        code: 'UNAUTHORIZED_KEY',
        message: '인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다.',
      }));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_configuration_error');
    });

    it('승인 시한 초과는 조회로 확인하고, 결제가 없으면 실패로 확정한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(404, {
          code: 'NOT_FOUND_PAYMENT_SESSION',
          message: '결제 시간이 만료되어 결제 진행 데이터가 존재하지 않습니다.',
        }))
        .mockResolvedValueOnce(jsonResponse(404, {
          code: 'NOT_FOUND_PAYMENT',
          message: '존재하지 않는 결제 입니다.',
        }));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const [inquiryUrl, inquiryInit] = fetchImpl.mock.calls[1]!;
      expect(inquiryUrl).toBe(
        `https://api.tosspayments.com/v1/payments/orders/${ATTEMPT.providerOrderId}`,
      );
      expect(inquiryInit.method).toBe('GET');
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_session_expired');
    });

    it('멱등 처리 중(409)·이미 처리됨 신호는 조회로 실상태에 수렴한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(400, {
          code: 'ALREADY_PROCESSED_PAYMENT',
          message: '이미 처리된 결제 입니다.',
        }))
        .mockResolvedValueOnce(jsonResponse(200, donePayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('approved');
      expect(outcome.reasonCode).toBe('provider_approved_after_recheck');
      expect(outcome.evidence?.providerPaymentKey).toBe(PAYMENT_KEY);
    });

    it('서버 오류 후 조회가 진행 중 상태를 돌려주면 unknown으로 보존한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(500, {
          code: 'FAILED_INTERNAL_SYSTEM_PROCESSING',
          message: '내부 시스템 처리 작업이 실패했습니다.',
        }))
        .mockResolvedValueOnce(jsonResponse(200, donePayment({ status: 'IN_PROGRESS' })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_payment_in_progress');
    });

    it('조회가 만료를 돌려주면 canceled로 종결한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(500, { code: 'COMMON_ERROR', message: '일시적인 오류' }))
        .mockResolvedValueOnce(jsonResponse(200, donePayment({ status: 'EXPIRED' })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(outcome.outcome).toBe('canceled');
      expect(outcome.reasonCode).toBe('provider_payment_expired');
    });

    it('네트워크 실패 후 조회까지 실패하면 unknown으로 보존한다', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_unavailable');
    });

    it('결과 어디에도 시크릿 키가 새지 않는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.confirm(await confirmInput());

      expect(JSON.stringify(outcome)).not.toContain(SECRET_KEY);
    });
  });

  describe('reconcile', () => {
    it('조회가 DONE이고 identity가 일치하면 approved로 종결한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe(
        `https://api.tosspayments.com/v1/payments/orders/${ATTEMPT.providerOrderId}`,
      );
      expect(init.method).toBe('GET');
      expect(outcome.outcome).toBe('approved');
      expect(outcome.reasonCode).toBe('provider_reconciled_approved');
      expect(outcome.evidence?.providerPaymentKey).toBe(PAYMENT_KEY);
    });

    it('전액 취소가 검증된 결제만 canceled를 돌려준다(환불 재정합 계약)', async () => {
      const fullyCanceled = donePayment({
        status: 'CANCELED',
        balanceAmount: 0,
        cancels: [{
          cancelAmount: ATTEMPT.amount,
          canceledAt: '2026-09-01T10:00:00+09:00',
          transactionKey: 'CANCELTX',
          cancelStatus: 'DONE',
        }],
      });
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, fullyCanceled));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('canceled');
      expect(outcome.reasonCode).toBe('provider_payment_canceled');
      expect(outcome.evidence?.resultCode).toBe('CANCELED');
    });

    it('부분취소·잔액 있는 취소 상태는 canceled로 종결하지 않는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment({
        status: 'PARTIAL_CANCELED',
        balanceAmount: 1_000,
      })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_cancellation_mismatch');
    });

    it.each([
      ['ABORTED', 'provider_declined'],
      ['EXPIRED', 'provider_payment_expired'],
    ])('%s는 declined로 확정한다(환불 재정합이 취소 성공으로 오인하지 않도록)', async (status, reason) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment({ status })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe(reason);
    });

    it('진행 중 상태는 unknown으로 보존한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment({ status: 'IN_PROGRESS' })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_payment_in_progress');
    });

    it('승인 가능 시한이 지난 404는 승인 불성립 확정으로 닫는다(콜백 유실 자동 종결)', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {
        code: 'NOT_FOUND_PAYMENT',
        message: '존재하지 않는 결제 정보 입니다.',
      }));
      const { gateway: tossGateway } = gateway({
        fetch: fetchImpl as unknown as typeof fetch,
        // expiresAt(00:10) + 45분 이후.
        now: () => new Date('2026-09-01T01:00:00Z'),
      });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_payment_absent');
    });

    it('승인 가능 시한 전의 404는 unknown으로 남겨 다음 재정합에 맡긴다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {
        code: 'NOT_FOUND_PAYMENT',
        message: '존재하지 않는 결제 정보 입니다.',
      }));
      const { gateway: tossGateway } = gateway({
        fetch: fetchImpl as unknown as typeof fetch,
        now: () => new Date('2026-09-01T00:20:00Z'),
      });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_inquiry_not_found');
    });

    it('조회 실패는 unknown으로 보존한다', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.reconcile(ATTEMPT);

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_unavailable');
    });
  });

  describe('refund', () => {
    const CANCEL_TX = 'ND38Q0IGWUG7UC02G6G1GL1XJRG2BO5N';

    function canceledPayment(overrides: Record<string, unknown> = {}) {
      return donePayment({
        status: 'CANCELED',
        balanceAmount: 0,
        cancels: [{
          cancelAmount: ATTEMPT.amount,
          cancelReason: 'ICONS 주문 취소',
          canceledAt: '2026-09-01T10:00:00+09:00',
          transactionKey: CANCEL_TX,
          cancelStatus: 'DONE',
        }],
        ...overrides,
      });
    }

    function refundRequest() {
      return {
        attempt: ATTEMPT,
        idempotencyKey: `refund:${ATTEMPT.id}`,
        amount: ATTEMPT.amount,
        reason: 'ICONS 주문 취소',
      };
    }

    it('전액 취소를 발행하고 fresh 조회로 검증한 뒤에만 approved를 돌려준다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, donePayment()))
        .mockResolvedValueOnce(jsonResponse(200, canceledPayment()))
        .mockResolvedValueOnce(jsonResponse(200, canceledPayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      const [cancelUrl, cancelInit] = fetchImpl.mock.calls[1]!;
      expect(cancelUrl).toBe(
        `https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}/cancel`,
      );
      expect(cancelInit.method).toBe('POST');
      expect(cancelInit.headers.authorization).toBe(
        `Basic ${Buffer.from(`${SECRET_KEY}:`, 'utf8').toString('base64')}`,
      );
      expect(cancelInit.headers['idempotency-key']).toBe(`refund:${ATTEMPT.id}`);
      const cancelBody = JSON.parse(cancelInit.body);
      expect(cancelBody).toEqual({ cancelReason: 'ICONS 주문 취소' });
      // 부분취소 미발행 계약 — cancelAmount가 body에 없어야 전액 취소다.
      expect(cancelBody).not.toHaveProperty('cancelAmount');

      expect(outcome.outcome).toBe('approved');
      expect(outcome.reasonCode).toBe('provider_cancel_confirmed');
      expect(outcome.refundedAmount).toBe(ATTEMPT.amount);
      expect(outcome.evidence).toMatchObject({
        providerPaymentKey: PAYMENT_KEY,
        providerTransactionId: CANCEL_TX,
        resultCode: 'CANCELED',
      });
    });

    it('이미 전액 취소된 건은 취소 API 없이 성공으로 수렴한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, canceledPayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('approved');
      expect(outcome.reasonCode).toBe('provider_already_fully_canceled');
      expect(outcome.refundedAmount).toBe(ATTEMPT.amount);
    });

    it('전액이 아닌 환불 요청은 네트워크에 닿지 않고 격리된다', async () => {
      const { gateway: tossGateway, fetchImpl } = gateway();

      const outcome = await tossGateway.refund({
        ...refundRequest(),
        amount: ATTEMPT.amount - 1_000,
      });

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_refund_amount_mismatch');
    });

    it('이미 취소됨 에러(멱등 재시도)는 fresh 조회로 성공에 수렴한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, donePayment()))
        .mockResolvedValueOnce(jsonResponse(400, {
          code: 'ALREADY_CANCELED_PAYMENT',
          message: '이미 취소된 결제 입니다.',
        }))
        .mockResolvedValueOnce(jsonResponse(200, canceledPayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(outcome.outcome).toBe('approved');
      expect(outcome.reasonCode).toBe('provider_cancel_confirmed');
    });

    it('취소 불가 판정 코드는 재조회 없이 needs_review로 격리한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, donePayment()))
        .mockResolvedValueOnce(jsonResponse(403, {
          code: 'NOT_CANCELABLE_PAYMENT',
          message: '취소 할 수 없는 결제 입니다.',
        }));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_cancel_rejected');
      expect(outcome.evidence?.resultCode).toBe('NOT_CANCELABLE_PAYMENT');
    });

    it('취소 200 후 조회가 여전히 DONE이면 자동 종결하지 않는다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, donePayment()))
        .mockResolvedValueOnce(jsonResponse(200, canceledPayment()))
        .mockResolvedValueOnce(jsonResponse(200, donePayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_cancellation_incomplete');
    });

    it('취소 5xx 후 조회가 DONE이면 unknown으로 보존한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, donePayment()))
        .mockResolvedValueOnce(jsonResponse(500, { code: 'FAILED_REFUND_PROCESS', message: '환불요청 실패' }))
        .mockResolvedValueOnce(jsonResponse(200, donePayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_cancel_ambiguous');
    });

    it('결제가 provider에 없으면 취소를 발행하지 않고 격리한다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {
        code: 'NOT_FOUND_PAYMENT',
        message: '존재하지 않는 결제 정보 입니다.',
      }));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_payment_not_found');
    });

    it('부분취소가 이미 있는 결제는 자동 취소 대상이 아니다', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, donePayment({
        status: 'PARTIAL_CANCELED',
        balanceAmount: 1_000,
      })));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_payment_not_refundable');
    });

    it('네트워크가 전부 실패하면 unknown으로 보존한다', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_unavailable');
    });

    it('환불 결과 어디에도 시크릿 키가 새지 않는다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, donePayment()))
        .mockResolvedValueOnce(jsonResponse(200, canceledPayment()))
        .mockResolvedValueOnce(jsonResponse(200, canceledPayment()));
      const { gateway: tossGateway } = gateway({ fetch: fetchImpl as unknown as typeof fetch });

      const outcome = await tossGateway.refund(refundRequest());

      expect(JSON.stringify(outcome)).not.toContain(SECRET_KEY);
    });
  });
});
