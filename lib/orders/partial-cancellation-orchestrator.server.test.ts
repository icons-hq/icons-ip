import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../supabase/service', () => ({ createServiceClient: vi.fn(() => { throw new Error('service client unavailable in tests'); }) }));

import { PARTIAL_CANCEL_UNAVAILABLE_REASON, type PaymentAttempt, type RefundOutcome } from '../payments/gateway';
import { createTossPaymentGateway } from '../payments/toss-gateway.server';
import { cancellationRefundRequest, reconcileOrderCancellation, type CancellationReconciliationDependencies } from './cancellation-orchestrator.server';
import type { OrderPartialCancellationServiceRow } from './partial-cancellation';
import {
  inspectOrderPartialCancellationResolution,
  orderPartialCancellationIdempotencyKey,
  orderPartialCancellationRefundRequest,
  reconcileOrderPartialCancellation,
  type OrderPartialCancellationDependencies,
} from './partial-cancellation-orchestrator.server';

/*
 * 재고 부족 부분 취소(ADR-0032) 오케스트레이터. 실결제·토스 API 호출 없음 — 의존성 가짜와 fetch 가짜 토스만 쓴다.
 */

const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORDER_ID = '99999999-8888-4777-a666-555555555555';
const PAYMENT_ID = '12121212-3434-4565-8787-909090909090';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PAYMENT_KEY = 'tviva20261112000000abcDEF123456789';

function row(overrides: Partial<OrderPartialCancellationServiceRow> = {}): OrderPartialCancellationServiceRow {
  return {
    id: ID, orderId: ORDER_ID, paymentId: PAYMENT_ID, provider: 'toss', state: 'processing',
    paymentAmount: 40_000, balanceBefore: 40_000, refundAmount: 9_500, paymentKey: PAYMENT_KEY, paymentStatus: 'paid', paymentLiveAmount: 40_000,
    ...overrides,
  };
}

function approved(overrides: Partial<RefundOutcome> = {}): RefundOutcome {
  return {
    attemptId: 'attempt', provider: 'toss', outcome: 'approved', reasonCode: 'provider_partial_cancel_confirmed',
    evidence: { providerPaymentKey: PAYMENT_KEY, providerTransactionId: 'CANCEL0001', resultCode: 'PARTIAL_CANCELED' },
    refundedAmount: 9_500, balanceAfter: 30_500,
    ...overrides,
  };
}

function deps(overrides: Partial<OrderPartialCancellationDependencies> = {}, load: OrderPartialCancellationServiceRow | null = row()) {
  return {
    load: vi.fn(async () => load),
    refund: vi.fn(async () => approved()),
    complete: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    markNeedsReview: vi.fn(async () => undefined),
    ...overrides,
  } satisfies OrderPartialCancellationDependencies;
}

describe('재고 부족 부분 취소 오케스트레이터', () => {
  it('결제사 부분 취소를 조회로 확인하면 그 금액·키·거래 키로 적용을 기록한다', async () => {
    const d = deps();
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, d)).resolves.toEqual({ ok: true, status: 'completed' });
    expect(d.refund).toHaveBeenCalledWith({
      partialCancellationId: ID, paymentId: PAYMENT_ID, paymentAmount: 40_000, paymentKey: PAYMENT_KEY, refundAmount: 9_500, expectedBalanceBefore: 40_000,
    });
    expect(d.complete).toHaveBeenCalledWith({ id: ID, actorId: ACTOR, refundedAmount: 9_500, paymentKey: PAYMENT_KEY, transactionKey: 'CANCEL0001' });
    expect(d.markNeedsReview).not.toHaveBeenCalled();
  });

  it('두 번째 부분 취소는 시작 때 정한 잔액 기대값(앞 취소 뒤 잔액)을 그대로 넘긴다', async () => {
    const d = deps({ refund: vi.fn(async () => approved({ refundedAmount: 17_500, balanceAfter: 13_000 })) }, row({ balanceBefore: 30_500, refundAmount: 17_500 }));
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, d)).resolves.toEqual({ ok: true, status: 'completed' });
    expect(d.refund).toHaveBeenCalledWith(expect.objectContaining({ refundAmount: 17_500, expectedBalanceBefore: 30_500 }));
  });

  it('결제사가 부분 취소를 받지 않으면 품목 부분 취소를 진행하지 않고 닫는다(전액 환불로 돌리지 않는다)', async () => {
    const d = deps({ refund: vi.fn(async () => approved({ outcome: 'declined', reasonCode: PARTIAL_CANCEL_UNAVAILABLE_REASON, refundedAmount: undefined })) });
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, d)).resolves.toEqual({ ok: false, code: 'partial_cancel_rejected' });
    expect(d.reject).toHaveBeenCalledWith({ id: ID, actorId: ACTOR });
    expect(d.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['잔액이 기대와 다름', approved({ outcome: 'needs_review', reasonCode: 'provider_balance_mismatch', refundedAmount: undefined }), 'provider_balance_mismatch'],
    ['모호', approved({ outcome: 'unknown', reasonCode: 'provider_cancel_ambiguous', refundedAmount: undefined }), 'provider_cancel_ambiguous'],
    ['사유 없는 거절', approved({ outcome: 'declined', reasonCode: undefined, refundedAmount: undefined }), 'provider_cancel_failed'],
    ['금액이 다른 승인', approved({ refundedAmount: 9_000 }), 'provider_cancel_failed'],
    ['다른 결제 키', approved({ evidence: { providerPaymentKey: 'OTHER', providerTransactionId: 'CANCEL0001' } }), 'provider_mismatch'],
    ['거래 키 없음', approved({ evidence: { providerPaymentKey: PAYMENT_KEY } }), 'provider_mismatch'],
  ])('%s면 확인 필요로 남기고 적용하지 않는다', async (_label, outcome, code) => {
    const d = deps({ refund: vi.fn(async () => outcome) });
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, d)).resolves.toEqual({ ok: false, code });
    expect(d.markNeedsReview).toHaveBeenCalledWith({ id: ID, actorId: ACTOR, code });
    expect(d.complete).not.toHaveBeenCalled();
    expect(d.reject).not.toHaveBeenCalled();
  });

  it('게이트웨이 예외는 provider_unavailable, 적용 실패는 local_finalize_failed(다시 부르면 수렴)', async () => {
    const thrown = deps({ refund: vi.fn(async () => { throw new Error('network'); }) });
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, thrown)).resolves.toEqual({ ok: false, code: 'provider_unavailable' });
    const failed = deps({ complete: vi.fn(async () => { throw new Error('db'); }) });
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, failed)).resolves.toEqual({ ok: false, code: 'local_finalize_failed' });
    expect(failed.markNeedsReview).toHaveBeenCalledWith({ id: ID, actorId: ACTOR, code: 'local_finalize_failed' });
  });

  it.each([
    ['완료', row({ state: 'completed' }), { ok: true, status: 'already_completed' }],
    ['진행하지 않음', row({ state: 'rejected' }), { ok: false, code: 'partial_cancel_rejected' }],
    ['무통장 송금 대기', row({ provider: 'bank_transfer', state: 'awaiting_transfer' }), { ok: false, code: 'not_ready' }],
    ['기록 없음', null, { ok: false, code: 'not_found' }],
  ])('%s 상태는 결제사를 부르지 않는다', async (_label, loaded, expected) => {
    const d = deps({}, loaded);
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, d)).resolves.toEqual(expected);
    expect(d.refund).not.toHaveBeenCalled();
  });

  it.each([
    ['결제 키 없음', row({ paymentKey: null })],
    ['결제가 이미 환불됨', row({ paymentStatus: 'refunded' })],
    ['결제 금액이 바뀜', row({ paymentLiveAmount: 39_000 })],
    ['환불액이 잔액보다 큼', row({ balanceBefore: 9_000, refundAmount: 9_500 })],
  ])('%s이면 결제사를 부르지 않고 확인 필요다', async (_label, loaded) => {
    const d = deps({}, loaded);
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, d)).resolves.toEqual({ ok: false, code: 'payment_evidence_invalid' });
    expect(d.refund).not.toHaveBeenCalled();
  });

  it('멱등키는 부분 취소마다 따로다(전액 취소·반품배송비 차감 키와 섞이지 않는다)', () => {
    expect(orderPartialCancellationIdempotencyKey('attempt-1', ID)).toBe(`refund:attempt-1:partial:${ID}`);
    expect(orderPartialCancellationIdempotencyKey('attempt-1', ID)).not.toBe(orderPartialCancellationIdempotencyKey('attempt-1', ORDER_ID));
  });

  it('남은 잔액 전부(환불액 = 시작 때 잔액)도 결제사 부분 취소로 보낸다. 잔액보다 크면 결제사를 부르지 않는다', async () => {
    const whole = deps({ refund: vi.fn(async () => approved({ refundedAmount: 24_000, balanceAfter: 0 })) }, row({ paymentAmount: 24_000, paymentLiveAmount: 24_000, balanceBefore: 24_000, refundAmount: 24_000 }));
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, whole)).resolves.toEqual({ ok: true, status: 'completed' });
    expect(whole.refund).toHaveBeenCalledWith(expect.objectContaining({ refundAmount: 24_000, expectedBalanceBefore: 24_000 }));
    const over = deps({}, row({ balanceBefore: 9_000, refundAmount: 9_500 }));
    await expect(reconcileOrderPartialCancellation({ partialCancellationId: ID, actorId: ACTOR }, over)).resolves.toEqual({ ok: false, code: 'payment_evidence_invalid' });
    expect(over.refund).not.toHaveBeenCalled();
  });
});

describe('결제확인필요 해소의 결제사 조회(돈을 움직이지 않는다)', () => {
  const needsReview = row({ state: 'needs_review' });
  const inspectWith = (inspection: Awaited<ReturnType<NonNullable<import('../payments/gateway').PaymentGateway['inspectBalance']>>>, load = needsReview) => ({
    load: vi.fn(async () => load), inspect: vi.fn(async () => inspection),
  });
  it('잔액이 시작 때 그대로면 돈이 움직이지 않았다(진행하지 않음)', async () => {
    const d = inspectWith({ kind: 'ok', status: 'DONE', balanceAmount: 40_000, lastCancel: null });
    await expect(inspectOrderPartialCancellationResolution(ID, d)).resolves.toEqual({ ok: true, resolution: 'not_moved', observedBalance: 40_000 });
    expect(d.inspect).toHaveBeenCalledWith({ paymentId: PAYMENT_ID, paymentAmount: 40_000, paymentKey: PAYMENT_KEY });
  });
  it('잔액이 이 취소만큼 줄었고 마지막 취소가 그 금액이면 그 거래 키로 적용한다', async () => {
    const d = inspectWith({ kind: 'ok', status: 'PARTIAL_CANCELED', balanceAmount: 30_500, lastCancel: { cancelAmount: 9_500, transactionKey: 'CANCEL0001' } });
    await expect(inspectOrderPartialCancellationResolution(ID, d)).resolves.toEqual({ ok: true, resolution: 'already_canceled', observedBalance: 30_500, transactionKey: 'CANCEL0001' });
  });
  it.each([
    ['다른 취소가 낀 잔액', { kind: 'ok', status: 'PARTIAL_CANCELED', balanceAmount: 25_000, lastCancel: { cancelAmount: 15_000, transactionKey: 'CANCEL0002' } }, 'balance_unexplained'],
    ['마지막 취소 금액이 다름', { kind: 'ok', status: 'PARTIAL_CANCELED', balanceAmount: 30_500, lastCancel: { cancelAmount: 9_000, transactionKey: 'CANCEL0003' } }, 'balance_unexplained'],
    ['조회 불가', { kind: 'unavailable' }, 'provider_unavailable'],
    ['대조 실패', { kind: 'mismatch' }, 'provider_mismatch'],
    ['지원 안 함', { kind: 'not_supported' }, 'provider_mismatch'],
  ] as const)('%s면 해소하지 않는다', async (_label, inspection, code) => {
    await expect(inspectOrderPartialCancellationResolution(ID, inspectWith(inspection))).resolves.toEqual({ ok: false, code });
  });
  it('결제확인필요가 아니면 결제사를 조회하지 않는다', async () => {
    const d = inspectWith({ kind: 'ok', status: 'DONE', balanceAmount: 40_000, lastCancel: null }, row({ state: 'processing' }));
    await expect(inspectOrderPartialCancellationResolution(ID, d)).resolves.toEqual({ ok: false, code: 'not_needs_review' });
    expect(d.inspect).not.toHaveBeenCalled();
  });
});

/*
 * 가짜 토스(상태 보유): 같은 결제에 부분 취소를 여러 번 하고 남은 잔액을 전액 취소로 돌려주는 흐름을 실제 토스 게이트웨이로 돌린다.
 * 토스처럼 같은 멱등키의 첫 응답을 재생하고, 취소 금액이 잔액을 넘으면 거절한다.
 */
const ATTEMPT: PaymentAttempt = {
  id: '11111111-2222-4333-8444-555555555555', provider: 'toss', purpose: 'order', refId: ORDER_ID, amount: 40_000, currency: 'KRW',
  idempotencyKey: 'attempt-idem-1', providerOrderId: 'O0123456789abcdef0123456789abcdef', providerProductCode: 'P0123456789abcdef0123456789abcdef',
  expiresAt: '2026-11-12T00:10:00.000Z',
};

function statefulToss() {
  let balance = ATTEMPT.amount;
  const cancels: Array<{ cancelAmount: number; transactionKey: string; canceledAt: string }> = [];
  const replay = new Map<string, unknown>();
  const posts: Array<{ idempotencyKey: string | null; cancelAmount: unknown }> = [];
  const snapshot = () => ({
    mId: 'ticonsi0xvd', paymentKey: PAYMENT_KEY, orderId: ATTEMPT.providerOrderId, currency: 'KRW', method: '카드',
    status: balance === ATTEMPT.amount ? 'DONE' : balance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED',
    totalAmount: ATTEMPT.amount, balanceAmount: balance, isPartialCancelable: true, taxExemptionAmount: 0,
    lastTransactionKey: cancels.at(-1)?.transactionKey ?? 'APPROVE0000000000000000000000001',
    cancels: cancels.length ? cancels.map(cancel => ({ ...cancel, cancelStatus: 'DONE' })) : null, virtualAccount: null,
  });
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if ((init?.method ?? 'GET') === 'GET') return reply(200, snapshot());
    const key = ((init?.headers ?? {}) as Record<string, string>)['idempotency-key'] ?? null;
    const body = JSON.parse(String(init?.body)) as { cancelAmount?: number };
    posts.push({ idempotencyKey: key, cancelAmount: body.cancelAmount });
    if (key && replay.has(key)) return reply(200, replay.get(key));
    const amount = body.cancelAmount ?? balance;
    if (amount > balance) return reply(400, { code: 'NOT_CANCELABLE_AMOUNT', message: 'over balance' });
    balance -= amount;
    cancels.push({ cancelAmount: amount, transactionKey: `CANCEL${String(cancels.length + 1).padStart(26, '0')}`, canceledAt: '2026-11-12T09:30:00+09:00' });
    const response = snapshot();
    if (key) replay.set(key, response);
    return reply(200, response);
  });
  const gateway = createTossPaymentGateway({
    clientKey: 'test_gck_iconsdocs00000000000001', secretKey: 'test_gsk_iconsdocs00000000000001', siteUrl: 'https://iconsip.com',
    fetch: fetchImpl as unknown as typeof fetch, merchantBinding: { variantKey: 'ICONS' }, now: () => new Date('2026-11-12T00:00:00Z'),
  });
  return { gateway, posts, balance: () => balance };
}

describe('같은 결제의 다회 부분 취소(가짜 토스, 잔액 누적)', () => {
  it('부분 취소 두 번 뒤 전액 취소는 남은 잔액만 부분 취소로 돌려주고 멱등키가 모두 다르다', async () => {
    const toss = statefulToss();
    const completed: Array<{ id: string; transactionKey: string }> = [];
    const partial = (id: string, refundAmount: number, balanceBefore: number) => reconcileOrderPartialCancellation({ partialCancellationId: id, actorId: ACTOR }, {
      load: async () => row({ id, refundAmount, balanceBefore }),
      // 기본 의존성과 같은 요청 조립(순수 함수)을 쓴다 — 조립이 바뀌면 이 시험이 같이 본다.
      refund: input => toss.gateway.refund(orderPartialCancellationRefundRequest(ATTEMPT, input)),
      complete: async input => { completed.push({ id: input.id, transactionKey: input.transactionKey }); },
      reject: async () => undefined,
      markNeedsReview: async () => undefined,
    });
    const first = 'aaaaaaaa-0000-4000-8000-000000000001';
    const second = 'aaaaaaaa-0000-4000-8000-000000000002';
    await expect(partial(first, 9_500, 40_000)).resolves.toEqual({ ok: true, status: 'completed' });
    // 같은 부분 취소를 다시 불러도(재시도) 결제사 잔액이 이미 기대값이라 다시 취소하지 않는다.
    await expect(partial(first, 9_500, 40_000)).resolves.toEqual({ ok: true, status: 'completed' });
    await expect(partial(second, 17_500, 30_500)).resolves.toEqual({ ok: true, status: 'completed' });
    expect(toss.balance()).toBe(13_000);
    expect(completed.map(entry => entry.transactionKey)).toEqual([
      'CANCEL00000000000000000000000001', 'CANCEL00000000000000000000000001', 'CANCEL00000000000000000000000002',
    ]);

    // 남은 주문 전액 취소: 오케스트레이터가 부분 취소 누계를 읽어 남은 잔액 13,000원을 remainder 키로 부분 취소한다.
    const completeRequest = vi.fn(async () => undefined);
    const dependencies: CancellationReconciliationDependencies = {
      loadContext: async () => ({ requestId: 'req', orderId: ORDER_ID, status: 'processing', payments: [{
        id: PAYMENT_ID, provider: 'toss', status: 'paid', amount: 40_000, paymentKey: PAYMENT_KEY, bankTransferRefundFiled: false,
      }] }),
      preflightReconciliation: async () => 'allowed',
      reconcileExpiredPreparedGoods: async () => 'not_applicable',
      refundProviderPayment: async input => toss.gateway.refund(cancellationRefundRequest(ATTEMPT, input)),
      completeRequest,
      markNeedsReview: async () => undefined,
      partialRefunds: { load: async () => new Map([[PAYMENT_ID, 27_000]]) },
    };
    await expect(reconcileOrderCancellation({ requestId: 'req', actorId: ACTOR }, dependencies)).resolves.toEqual({ ok: true, status: 'completed' });
    expect(completeRequest).toHaveBeenCalledWith({ requestId: 'req', actorId: ACTOR, verifiedPaymentKeys: [PAYMENT_KEY] });
    expect(toss.balance()).toBe(0);
    expect(toss.posts.map(post => post.cancelAmount)).toEqual([9_500, 17_500, 13_000]);
    expect(new Set(toss.posts.map(post => post.idempotencyKey)).size).toBe(3);
    expect(toss.posts.map(post => post.idempotencyKey)).toEqual([
      `refund:${ATTEMPT.id}:partial:${first}`, `refund:${ATTEMPT.id}:partial:${second}`, `refund:${ATTEMPT.id}:remainder:req`,
    ]);
  });

  it('부분 취소가 잔액을 모두 돌려줬으면 결제사를 부르지 않고 확정한다. 누계가 결제 금액보다 크면 확인 필요다', async () => {
    const run = (refunded: number) => {
      const refundProviderPayment = vi.fn();
      const completeRequest = vi.fn(async () => undefined);
      const result = reconcileOrderCancellation({ requestId: 'req', actorId: ACTOR }, {
        loadContext: async () => ({ requestId: 'req', orderId: ORDER_ID, status: 'processing', payments: [{
          id: PAYMENT_ID, provider: 'toss', status: 'paid', amount: 40_000, paymentKey: PAYMENT_KEY, bankTransferRefundFiled: false,
        }] }),
        preflightReconciliation: async () => 'allowed',
        reconcileExpiredPreparedGoods: async () => 'not_applicable',
        refundProviderPayment,
        completeRequest,
        markNeedsReview: vi.fn(async () => undefined),
        partialRefunds: { load: async () => new Map([[PAYMENT_ID, refunded]]) },
      });
      return { result, refundProviderPayment, completeRequest };
    };
    const zero = run(40_000);
    await expect(zero.result).resolves.toEqual({ ok: true, status: 'completed' });
    expect(zero.refundProviderPayment).not.toHaveBeenCalled();
    expect(zero.completeRequest).toHaveBeenCalledWith({ requestId: 'req', actorId: ACTOR, verifiedPaymentKeys: [PAYMENT_KEY] });
    const over = run(41_000);
    await expect(over.result).resolves.toEqual({ ok: false, code: 'payment_evidence_invalid' });
    expect(over.refundProviderPayment).not.toHaveBeenCalled();
  });

  it('가짜 토스 잔액 조회: 해소 증거(잔액·마지막 취소 거래)를 원장 결제 키로만 읽는다', async () => {
    const toss = statefulToss();
    await toss.gateway.refund(orderPartialCancellationRefundRequest(ATTEMPT, { partialCancellationId: ID, paymentKey: PAYMENT_KEY, refundAmount: 9_500, expectedBalanceBefore: 40_000 }));
    await expect(toss.gateway.inspectBalance!(ATTEMPT, PAYMENT_KEY)).resolves.toEqual({
      kind: 'ok', status: 'PARTIAL_CANCELED', balanceAmount: 30_500, lastCancel: { cancelAmount: 9_500, transactionKey: 'CANCEL00000000000000000000000001' },
    });
    const posts = toss.posts.length;
    await expect(toss.gateway.inspectBalance!(ATTEMPT, 'not a key')).resolves.toEqual({ kind: 'mismatch' });
    await expect(inspectOrderPartialCancellationResolution(ID, {
      load: async () => row({ state: 'needs_review' }),
      inspect: async () => toss.gateway.inspectBalance!(ATTEMPT, PAYMENT_KEY),
    })).resolves.toEqual({ ok: true, resolution: 'already_canceled', observedBalance: 30_500, transactionKey: 'CANCEL00000000000000000000000001' });
    expect(toss.posts.length).toBe(posts);
  });

  it('반품배송비 차감 결정의 기준 금액은 부분 취소 뒤 잔액이고 잔액 기대값도 그 잔액이다', async () => {
    const refundProviderPayment = vi.fn(async () => approved({ refundedAmount: 19_500, balanceAfter: 3_000 }));
    await expect(reconcileOrderCancellation({ requestId: 'req', actorId: ACTOR }, {
      loadContext: async () => ({ requestId: 'req', orderId: ORDER_ID, status: 'processing', payments: [{
        id: PAYMENT_ID, provider: 'toss', status: 'paid', amount: 40_000, paymentKey: PAYMENT_KEY, bankTransferRefundFiled: false,
      }] }),
      preflightReconciliation: async () => 'allowed',
      reconcileExpiredPreparedGoods: async () => 'not_applicable',
      refundProviderPayment,
      completeRequest: vi.fn(async () => undefined),
      markNeedsReview: vi.fn(async () => undefined),
      partialRefunds: { load: async () => new Map([[PAYMENT_ID, 17_500]]) },
      refundDeduction: {
        load: async () => ({ paymentId: PAYMENT_ID, state: 'planned', paymentAmount: 22_500, deductionAmount: 3_000, refundAmount: 19_500 }),
        recordPartialRefund: vi.fn(async () => undefined),
        fallbackToFullRefund: vi.fn(async () => undefined),
      },
    })).resolves.toEqual({ ok: true, status: 'completed' });
    expect(refundProviderPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 40_000, partial: { refundAmount: 19_500, requestId: 'req', expectedBalanceBefore: 22_500 },
    }));
  });
});
