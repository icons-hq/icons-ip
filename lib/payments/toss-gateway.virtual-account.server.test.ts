import { describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt, PaymentRefundRequest } from './gateway';
import { createTossPaymentGateway } from './toss-gateway.server';

// 가상계좌 입금 대기·입금 승인·반납·입금 뒤 환불(ADR-0049). 공통 규율(MID·identity·조회 진실원)은
// toss-gateway.server.test.ts가 고정하고, 이 파일은 결제 UI 바인딩(ICONS) 위 가상계좌 계약만 본다.
const CLIENT_KEY = 'test_gck_iconsdocs00000000000001';
const SECRET_KEY = 'test_gsk_iconsdocs00000000000001';
/* 에스크로 부가서비스 API 키(API 개별 연동 sk) — gsk는 부가서비스 API를 부를 수 없다(토스 'API 키' 문서). */
const ESCROW_SECRET_KEY = 'test_sk_iconsescrow0000000001';
const basicAuth = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
const NOW = new Date('2026-11-23T03:00:00Z'); // 12:00 KST
const MERCHANT_ID = 'ticonsi0xvd';
const PAYMENT_KEY = 'tviva20261123000000vaKEY123456789';
const ESCROW_KEY = 'escrow_a01kradqm4cyvaw4ym4p4svjgqd';
const API = 'https://api.tosspayments.com';

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
  expiresAt: '2026-11-23T03:15:00.000Z',
};

const TICKET_ATTEMPT: PaymentAttempt = { ...ATTEMPT, purpose: 'ticket', providerOrderId: 'T0123456789abcdef0123456789abcdef' };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function vaPayment(overrides: Record<string, unknown> = {}, account: Record<string, unknown> = {}) {
  return {
    mId: MERCHANT_ID,
    paymentKey: PAYMENT_KEY,
    orderId: ATTEMPT.providerOrderId,
    status: 'WAITING_FOR_DEPOSIT',
    currency: 'KRW',
    totalAmount: ATTEMPT.amount,
    balanceAmount: ATTEMPT.amount,
    lastTransactionKey: 'VATX0000000000000000000000000001',
    method: '가상계좌',
    card: null,
    approvedAt: null,
    useEscrow: false,
    escrowKey: null,
    virtualAccount: {
      accountNumber: 'X6505636518308',
      accountType: '일반',
      bankCode: '20',
      customerName: '김토스',
      dueDate: '2026-11-24T12:00:00+09:00', // 지금 뒤 24시간
      expired: false,
      settlementStatus: 'INCOMPLETED',
      refundStatus: 'NONE',
      refundReceiveAccount: null,
      ...account,
    },
    ...overrides,
  };
}

function gateway(fetchImpl: ReturnType<typeof vi.fn>, options: { virtualAccountEnabled?: boolean; now?: Date; escrowSecretKey?: string | null } = {}) {
  return createTossPaymentGateway({
    clientKey: CLIENT_KEY,
    secretKey: SECRET_KEY,
    ...(options.escrowSecretKey === null ? {} : { escrowSecretKey: options.escrowSecretKey ?? ESCROW_SECRET_KEY }),
    siteUrl: 'https://iconsip.com',
    fetch: fetchImpl as unknown as typeof fetch,
    merchantBinding: { variantKey: 'ICONS' },
    virtualAccountEnabled: options.virtualAccountEnabled ?? true,
    now: () => options.now ?? NOW,
  });
}

async function confirmInput(tossGateway: ReturnType<typeof gateway>, attempt = ATTEMPT) {
  const prepared = await tossGateway.prepare(attempt);
  return {
    attempt,
    idempotencyKey: `confirm:${attempt.id}`,
    providerOrderId: attempt.providerOrderId,
    callbackNonce: prepared.callbackNonce,
    providerPayload: { paymentKey: PAYMENT_KEY, orderId: attempt.providerOrderId, amount: String(attempt.amount), paymentType: 'NORMAL' },
  };
}

describe('토스 가상계좌(ADR-0049)', () => {
  describe('입금 대기 진입', () => {
    it('승인 200이 WAITING_FOR_DEPOSIT이면 반납하지 않고 계좌·기한·에스크로 선택을 증거로 awaiting_deposit을 돌려준다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment({ useEscrow: true })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('awaiting_deposit');
      expect(outcome.reasonCode).toBe('provider_awaiting_deposit');
      expect(outcome.evidence).toEqual({
        providerPaymentKey: PAYMENT_KEY,
        resultCode: 'WAITING_FOR_DEPOSIT',
        paymentMethod: '가상계좌',
        virtualAccount: {
          bankCode: '20',
          accountNumber: 'X6505636518308',
          dueAt: '2026-11-24T03:00:00.000Z',
          useEscrow: true,
          refundReceiveAccount: null,
        },
      });
    });

    it('결제 UI가 받은 구매자 환불 계좌를 함께 싣는다(30분만 조회되므로 이 응답에서 남긴다)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment({}, {
        refundReceiveAccount: { bankCode: '88', accountNumber: '110123456789', holderName: '김토스' },
      })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      expect(outcome.evidence?.virtualAccount?.refundReceiveAccount).toEqual({
        bankCode: '88', accountNumber: '110123456789', holderName: '김토스',
      });
    });

    it('운영 스위치가 꺼져 있으면 새 발급은 받지 않는다 — 지금 가드대로 즉시 반납하고 declined', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment()))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl, { virtualAccountEnabled: false });

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      expect(fetchImpl.mock.calls[1]![1].headers['idempotency-key']).toBe(`cancel-unsupported:${ATTEMPT.id}`);
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_method_not_allowed');
    });

    it('입금 기한이 72시간 넘게 남으면(결제 어드민 기한 설정 오류) 반납하고 declined', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({}, { dueDate: '2026-11-30T12:00:00+09:00' })))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      const [url, init] = fetchImpl.mock.calls[1]!;
      expect(url).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(init.headers['idempotency-key']).toBe(`release-va:${ATTEMPT.id}`);
      expect(JSON.parse(init.body)).toEqual({ cancelReason: '입금 전 주문 종료(가상계좌 반납)' });
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_deposit_window_out_of_range');
    });

    it('계좌 형식이 틀리면(은행 코드 없음) 안내할 수 없어 반납한다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({}, { bankCode: null })))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_virtual_account_invalid');
    });

    it('티켓 시도는 스위치와 무관하게 지금 가드(발급 즉시 반납)다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ orderId: TICKET_ATTEMPT.providerOrderId })))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ orderId: TICKET_ATTEMPT.providerOrderId, status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway, TICKET_ATTEMPT));

      expect(fetchImpl.mock.calls[1]![1].headers['idempotency-key']).toBe(`cancel-unsupported:${TICKET_ATTEMPT.id}`);
      expect(outcome.outcome).toBe('declined');
    });
  });

  describe('재정합(입금·만료·반납)', () => {
    it('입금되면(DONE) 카드와 같이 approved다 — 결제수단은 가상계좌로 남는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'DONE', approvedAt: '2026-11-23T15:00:00+09:00' })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('approved');
      expect(outcome.evidence).toMatchObject({ providerPaymentKey: PAYMENT_KEY, resultCode: 'DONE', paymentMethod: '가상계좌' });
    });

    it('스위치를 꺼도 이미 입금 대기인 주문은 계속 닫힌다(drain) — 입금 대기 재확인은 awaiting_deposit', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment()));
      const tossGateway = gateway(fetchImpl, { virtualAccountEnabled: false });

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('awaiting_deposit');
    });

    it('토스가 계좌를 만료(expired)시켰으면 반납 호출 없이 declined로 닫는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment({}, { expired: true, dueDate: '2026-11-22T12:00:00+09:00' })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_deposit_expired');
    });

    it('기한이 지났어도 30분 유예 안이면 늦은 입금 통보를 기다린다(awaiting_deposit)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment({}, { dueDate: '2026-11-23T11:50:00+09:00' })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('awaiting_deposit');
    });

    it('유예가 지나면 반납하고 declined(provider_deposit_expired)', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({}, { dueDate: '2026-11-23T11:00:00+09:00' })))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY });

      expect(fetchImpl.mock.calls[1]![1].headers['idempotency-key']).toBe(`release-va:${ATTEMPT.id}`);
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_deposit_expired');
    });

    it('구매자 입금 전 취소(반납 요청)는 기한과 무관하게 반납하고 declined — 환불 계좌를 싣지 않는다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment()))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY, releaseVirtualAccount: true });

      const body = JSON.parse(fetchImpl.mock.calls[1]![1].body);
      expect(body).not.toHaveProperty('refundReceiveAccount');
      expect(body).not.toHaveProperty('cancelAmount');
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_virtual_account_released');
    });

    it('반납이 거절됐는데 다시 조회해 보니 입금됐으면(DONE) 입금이 이긴다 — approved', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment()))
        .mockResolvedValueOnce(jsonResponse(403, { code: 'NOT_CANCELABLE_PAYMENT', message: '취소 불가' }))
        .mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'DONE', approvedAt: '2026-11-23T12:01:00+09:00' })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY, releaseVirtualAccount: true });

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(outcome.outcome).toBe('approved');
    });

    it('반납도 조회도 확정하지 못하면 unknown으로 남겨 자동 재확인이 다시 본다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, vaPayment()))
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(jsonResponse(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' }));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY, releaseVirtualAccount: true });

      expect(outcome.outcome).toBe('unknown');
      expect(outcome.reasonCode).toBe('provider_virtual_account_release_pending');
    });

    it('승인되지 않은 시도의 가상계좌가 CANCELED면(입금 전 반납) 돈이 없으므로 declined로 닫는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment({ status: 'CANCELED', balanceAmount: null })));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.reconcile(ATTEMPT, { providerPaymentKey: PAYMENT_KEY });

      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_virtual_account_canceled');
    });

    it('releaseVirtualAccount는 반납 멱등키로 취소를 한 번 보내고 결과를 판정하지 않는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(400, { code: 'NOT_CANCELABLE_PAYMENT' }));
      const tossGateway = gateway(fetchImpl);

      await expect(tossGateway.releaseVirtualAccount!(ATTEMPT, PAYMENT_KEY)).resolves.toBeUndefined();

      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(init.headers['idempotency-key']).toBe(`release-va:${ATTEMPT.id}`);
    });
  });

  describe('입금 뒤 환불', () => {
    const ACCOUNT = { bankCode: '88', accountNumber: '110123456789', holderName: '김토스' };
    function refundRequest(overrides: Partial<PaymentRefundRequest> = {}): PaymentRefundRequest {
      return {
        attempt: ATTEMPT,
        idempotencyKey: `refund:${ATTEMPT.id}`,
        amount: ATTEMPT.amount,
        reason: '엑스스퀘어 주문 취소',
        providerPaymentKey: PAYMENT_KEY,
        ...overrides,
      };
    }
    const deposited = (overrides: Record<string, unknown> = {}, account: Record<string, unknown> = {}) =>
      vaPayment({ status: 'DONE', approvedAt: '2026-11-23T12:01:00+09:00', ...overrides }, account);
    const refunded = (refundStatus = 'PENDING') => vaPayment({
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [{ cancelAmount: ATTEMPT.amount, canceledAt: '2026-11-23T13:00:00+09:00', transactionKey: 'CANCELTX', cancelStatus: 'DONE' }],
    }, { refundStatus });


    it('원장 승인 뒤 결제사가 입금 전(되돌림)이면 환불하지 않고 provider_deposit_reversed로 멈춘다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment()));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_deposit_reversed');
    });
    it('환불 계좌를 실어 전액 취소하고 fresh 조회로 확인한다 — 멱등키는 계좌별로 갈린다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, deposited()))
        .mockResolvedValueOnce(jsonResponse(200, refunded()))
        .mockResolvedValueOnce(jsonResponse(200, refunded()));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      const [url, init] = fetchImpl.mock.calls[1]!;
      expect(url).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(JSON.parse(init.body)).toEqual({
        cancelReason: '엑스스퀘어 주문 취소',
        refundReceiveAccount: { bank: '88', accountNumber: '110123456789', holderName: '김토스' },
      });
      expect(init.headers['idempotency-key']).toMatch(new RegExp(`^refund:${ATTEMPT.id}:va-[0-9a-f]{16}$`));
      expect(outcome.outcome).toBe('approved');
      expect(outcome.refundedAmount).toBe(ATTEMPT.amount);
    });

    it('다른 계좌면 다른 멱등키다(틀린 계좌로 거절된 첫 응답이 재생되지 않게)', async () => {
      const keys: string[] = [];
      for (const account of [ACCOUNT, { ...ACCOUNT, accountNumber: '110987654321' }]) {
        const fetchImpl = vi.fn()
          .mockResolvedValueOnce(jsonResponse(200, deposited()))
          .mockResolvedValueOnce(jsonResponse(200, refunded()))
          .mockResolvedValueOnce(jsonResponse(200, refunded()));
        await gateway(fetchImpl).refund(refundRequest({ refundReceiveAccount: account }));
        keys.push(fetchImpl.mock.calls[1]![1].headers['idempotency-key']);
      }
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('결제사가 환불 계좌를 거절하면(예금주 불일치 등) needs_review(provider_refund_account_invalid)', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, deposited()))
        .mockResolvedValueOnce(jsonResponse(400, { code: 'INVALID_REFUND_ACCOUNT_INFO', message: '환불 계좌번호와 예금주명이 일치하지 않습니다.' }));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_refund_account_invalid');
      expect(outcome.evidence?.resultCode).toBe('INVALID_REFUND_ACCOUNT_INFO');
    });

    it('에스크로 결제에 구매자 취소 신청이 있으면 취소 수락 API로 환불한다(환불 계좌 불필요)', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, deposited({ useEscrow: true, escrowKey: ESCROW_KEY })))
        .mockResolvedValueOnce(jsonResponse(200, { version: '2022-11-16', entityType: 'escrow', entityBody: { id: ESCROW_KEY, status: 'CANCEL_REQUESTED' } }))
        .mockResolvedValueOnce(jsonResponse(200, { version: '2022-11-16', entityType: 'escrow', entityBody: { id: ESCROW_KEY, status: 'CANCELED' } }))
        .mockResolvedValueOnce(jsonResponse(200, refunded()));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest());

      expect(fetchImpl.mock.calls[1]![0]).toBe(`${API}/v2/escrows/${ESCROW_KEY}`);
      const [url, init] = fetchImpl.mock.calls[2]!;
      expect(url).toBe(`${API}/v2/escrows/${ESCROW_KEY}/cancel`);
      expect(init.headers['idempotency-key']).toBe(`refund:${ATTEMPT.id}:escrow`);
      expect(JSON.parse(init.body)).toEqual({ reason: '엑스스퀘어 주문 취소' });
      expect(outcome.outcome).toBe('approved');
      // 결제 조회·전후 조회는 결제 키(gsk), 거래 조회·취소 수락은 에스크로 키(sk)다.
      expect(fetchImpl.mock.calls.map(([, call]) => call.headers.authorization)).toEqual([
        basicAuth(SECRET_KEY), basicAuth(ESCROW_SECRET_KEY), basicAuth(ESCROW_SECRET_KEY), basicAuth(SECRET_KEY),
      ]);
    });

    it('에스크로 키가 없으면 거래 조회를 하지 않고 일반 취소(환불 계좌)로 간다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, deposited({ useEscrow: true, escrowKey: ESCROW_KEY })))
        .mockResolvedValueOnce(jsonResponse(200, refunded()))
        .mockResolvedValueOnce(jsonResponse(200, refunded()));
      const tossGateway = gateway(fetchImpl, { escrowSecretKey: null });

      const outcome = await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/v2/escrows'))).toBe(false);
      expect(fetchImpl.mock.calls[1]![0]).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(outcome.outcome).toBe('approved');
    });

    it('결제 키와 모드가 다른 에스크로 키는 쓰지 않는다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, deposited({ useEscrow: true, escrowKey: ESCROW_KEY })))
        .mockResolvedValueOnce(jsonResponse(200, refunded()))
        .mockResolvedValueOnce(jsonResponse(200, refunded()));
      const tossGateway = gateway(fetchImpl, { escrowSecretKey: 'live_sk_iconsescrow0000000001' });

      await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/v2/escrows'))).toBe(false);
    });

    it('에스크로 거래 조회가 권한·없음(4xx)으로 거부되면 일반 취소(환불 계좌)로 간다', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, deposited({ useEscrow: true, escrowKey: ESCROW_KEY })))
        .mockResolvedValueOnce(jsonResponse(404, { error: { code: 'NOT_FOUND' } }))
        .mockResolvedValueOnce(jsonResponse(200, refunded()))
        .mockResolvedValueOnce(jsonResponse(200, refunded()));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      expect(fetchImpl.mock.calls[2]![0]).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(outcome.outcome).toBe('approved');
    });

    it('은행 환불이 실패했으면(refundStatus FAILED) 환불 완료로 닫지 않는다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, refunded('FAILED')));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest({ refundReceiveAccount: ACCOUNT }));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('needs_review');
      expect(outcome.reasonCode).toBe('provider_refund_failed');
    });

    it('부분 취소는 가상계좌에 열지 않는다(돈을 움직이지 않고 전액 환불로 돌릴 사유를 돌려준다)', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, deposited()));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund(refundRequest({
        amount: 3_000,
        idempotencyKey: `refund:${ATTEMPT.id}:deduction:r1`,
        partial: { expectedBalanceBefore: ATTEMPT.amount },
        refundReceiveAccount: ACCOUNT,
      }));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_partial_cancel_unavailable');
    });
  });

  describe('잔액 조회(입금 오류 되돌림 판정 재료)', () => {
    it('가상계좌 여부와 마지막 거래 키를 함께 돌려준다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, vaPayment()));
      const tossGateway = gateway(fetchImpl);

      await expect(tossGateway.inspectBalance!(ATTEMPT, PAYMENT_KEY)).resolves.toEqual({
        kind: 'ok',
        status: 'WAITING_FOR_DEPOSIT',
        balanceAmount: ATTEMPT.amount,
        lastCancel: null,
        virtualAccount: true,
        lastTransactionKey: 'VATX0000000000000000000000000001',
        // 입금 오류 되돌림 처리의 진실원(ADR-0049 결정 4) — 지금 입금 기한·만료·환불 송금 상태.
        virtualAccountDueAt: '2026-11-24T03:00:00.000Z',
        virtualAccountExpired: false,
        virtualAccountRefundStatus: 'NONE',
      });
    });

  });

  describe('계좌이체(같은 운영 스위치, 2026-11-23 보강)', () => {
    const transferPayment = (overrides: Record<string, unknown> = {}) => ({
      mId: MERCHANT_ID,
      paymentKey: PAYMENT_KEY,
      orderId: ATTEMPT.providerOrderId,
      status: 'DONE',
      currency: 'KRW',
      totalAmount: ATTEMPT.amount,
      balanceAmount: ATTEMPT.amount,
      lastTransactionKey: 'TRTX0000000000000000000000000001',
      method: '계좌이체',
      card: null,
      approvedAt: '2026-11-23T12:00:10+09:00',
      useEscrow: true,
      escrowKey: ESCROW_KEY,
      transfer: { bankCode: '88', settlementStatus: 'INCOMPLETED' },
      ...overrides,
    });

    it('굿즈 주문의 계좌이체 DONE은 취소하지 않고 결제수단을 증거로 approved다', async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(200, transferPayment()));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('approved');
      expect(outcome.evidence?.paymentMethod).toBe('계좌이체');
    });

    it('운영 스위치가 꺼져 있으면 지금 가드대로 승인 직후 전액 취소한다', async () => {
      const canceled = transferPayment({ status: 'CANCELED', balanceAmount: 0 });
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, transferPayment()))
        .mockResolvedValueOnce(jsonResponse(200, canceled))
        .mockResolvedValueOnce(jsonResponse(200, canceled));
      const tossGateway = gateway(fetchImpl, { virtualAccountEnabled: false });

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway));

      expect(fetchImpl.mock.calls[1]![0]).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(outcome.outcome).toBe('declined');
      expect(outcome.reasonCode).toBe('provider_method_not_allowed');
    });

    it('티켓 결제의 계좌이체는 스위치가 켜져 있어도 받지 않는다(승인 직후 전액 취소)', async () => {
      const payment = transferPayment({ orderId: TICKET_ATTEMPT.providerOrderId, useEscrow: false, escrowKey: null });
      const canceled = { ...payment, status: 'CANCELED', balanceAmount: 0 };
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, payment))
        .mockResolvedValueOnce(jsonResponse(200, canceled))
        .mockResolvedValueOnce(jsonResponse(200, canceled));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.confirm(await confirmInput(tossGateway, TICKET_ATTEMPT));

      expect(fetchImpl.mock.calls[1]![0]).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(outcome.outcome).toBe('declined');
    });

    /* 결정 6: 에스크로를 고른 계좌이체도 구매자 취소 신청이면 취소 수락 API로 환불한다(가상계좌만이 아니다). */
    it('에스크로 계좌이체에 구매자 취소 신청이 있으면 취소 수락 API로 환불한다', async () => {
      const canceled = transferPayment({ status: 'CANCELED', balanceAmount: 0 });
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, transferPayment()))
        .mockResolvedValueOnce(jsonResponse(200, { version: '2022-11-16', entityType: 'escrow', entityBody: { id: ESCROW_KEY, status: 'CANCEL_REQUESTED' } }))
        .mockResolvedValueOnce(jsonResponse(200, { version: '2022-11-16', entityType: 'escrow', entityBody: { id: ESCROW_KEY, status: 'CANCELED' } }))
        .mockResolvedValueOnce(jsonResponse(200, canceled));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund({
        attempt: ATTEMPT,
        idempotencyKey: `refund:${ATTEMPT.id}`,
        amount: ATTEMPT.amount,
        reason: '엑스스퀘어 주문 취소',
        providerPaymentKey: PAYMENT_KEY,
      });

      const [url, init] = fetchImpl.mock.calls[2]!;
      expect(url).toBe(`${API}/v2/escrows/${ESCROW_KEY}/cancel`);
      expect(init.headers.authorization).toBe(basicAuth(ESCROW_SECRET_KEY));
      expect(init.headers['idempotency-key']).toBe(`refund:${ATTEMPT.id}:escrow`);
      expect(outcome.outcome).toBe('approved');
    });

    it('에스크로 계좌이체라도 취소 신청이 없으면 일반 취소 API다', async () => {
      const canceled = transferPayment({ status: 'CANCELED', balanceAmount: 0 });
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, transferPayment()))
        .mockResolvedValueOnce(jsonResponse(200, { version: '2022-11-16', entityType: 'escrow', entityBody: { id: ESCROW_KEY, status: 'IN_PROGRESS' } }))
        .mockResolvedValueOnce(jsonResponse(200, canceled))
        .mockResolvedValueOnce(jsonResponse(200, canceled));
      const tossGateway = gateway(fetchImpl);

      const outcome = await tossGateway.refund({
        attempt: ATTEMPT,
        idempotencyKey: `refund:${ATTEMPT.id}`,
        amount: ATTEMPT.amount,
        reason: '엑스스퀘어 주문 취소',
        providerPaymentKey: PAYMENT_KEY,
      });

      expect(fetchImpl.mock.calls[2]![0]).toBe(`${API}/v1/payments/${PAYMENT_KEY}/cancel`);
      expect(fetchImpl.mock.calls[2]![1].headers.authorization).toBe(basicAuth(SECRET_KEY));
      expect(outcome.outcome).toBe('approved');
    });

    it('계좌이체 환불은 환불 계좌 없이 취소 API를 부른다(출금 계좌로 환불)', async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse(200, transferPayment({ useEscrow: false, escrowKey: null })))
        .mockResolvedValueOnce(jsonResponse(200, transferPayment({ useEscrow: false, escrowKey: null, status: 'CANCELED', balanceAmount: 0 })))
        .mockResolvedValue(jsonResponse(200, transferPayment({ useEscrow: false, escrowKey: null, status: 'CANCELED', balanceAmount: 0 })));
      const tossGateway = gateway(fetchImpl);

      await tossGateway.refund({
        attempt: ATTEMPT,
        idempotencyKey: `refund:${ATTEMPT.id}`,
        amount: ATTEMPT.amount,
        reason: '엑스스퀘어 주문 취소',
        providerPaymentKey: PAYMENT_KEY,
      });

      const cancelCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/cancel'));
      expect(cancelCall).toBeDefined();
      const body = JSON.parse(cancelCall![1].body);
      expect(body.refundReceiveAccount).toBeUndefined();
    });
  });
});
