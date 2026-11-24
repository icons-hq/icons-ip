import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/system-health/cron-run-recorder.server', () => ({ recordCronJobRun: async () => ({ incident: false }) }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reconcile: vi.fn(), providers: vi.fn(), secretKey: vi.fn(), escrowKey: vi.fn(), inspect: vi.fn(), inspectorOptions: vi.fn(), settle: vi.fn() }));
vi.mock('@/lib/payments/runtime-gateway', () => ({ tossBoundPaymentSecretKey: mocks.secretKey, tossEscrowSecretKey: mocks.escrowKey }));
vi.mock('@/lib/payments/toss-virtual-account-refund-watch.server', () => ({
  createTossVirtualAccountRefundInspector: (options: unknown) => { mocks.inspectorOptions(options); return { inspect: mocks.inspect }; },
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/payments/attempt-reconciliation.server', async () => ({
  ...await vi.importActual<object>('@/lib/payments/attempt-reconciliation.server'),
  reconcilePaymentAttempt: mocks.reconcile,
  reconcilablePaymentProviders: mocks.providers,
}));
vi.mock('@/lib/orders/cancellation-auto.server', () => ({ scheduleApprovedOrderCancellation: vi.fn() }));
vi.mock('@/lib/payments/goods-deposit-reversal.runtime.server', async () => ({
  ...await vi.importActual<object>('@/lib/payments/goods-deposit-reversal.runtime.server'),
  createRuntimeDepositReversal: () => ({ settleDepositReversal: mocks.settle }),
}));
import { GET, maxDuration } from './route';

const goods = { attemptId: 'a7000000-0000-4003-8000-000000000001', purpose: 'order', provider: 'toss', refId: 'a7000000-0000-4002-8000-000000000001' };
const ticket = { attemptId: 'a7000000-0000-4003-8000-000000000002', purpose: 'ticket', provider: 'toss', refId: null };
const request = (authorization = 'Bearer synthetic-reconcile-cron') => new Request('https://icons.test/api/cron/payment-reconciliation', { headers: { authorization } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'synthetic-reconcile-cron');
  mocks.providers.mockReturnValue(['toss']);
  mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_deposit_reversal_checks'
    ? { data: [], error: null } : { data: [goods, ticket], error: null });
  mocks.reconcile.mockResolvedValue({ kind: 'reconciled', outcome: 'approved' });
  mocks.secretKey.mockReturnValue(null);
  mocks.escrowKey.mockReturnValue(null);
});
const noRefunds = { watches: 0, completed: 0, pending: 0, failed: 0, unavailable: 0, escrowSettled: 0, escrowLookupFailed: 0, recordFailed: 0, deferred: 0, errored: false };
const noReversals = { checked: 0, redeposited: 0, waiting: 0, closed: 0, cancellation: 0, review: 0, unavailable: 0, failed: 0, deferred: 0, errored: false };
afterEach(() => vi.unstubAllEnvs());

describe('미종결 결제 자동 재확인', () => {
  it('비밀값이 맞지 않으면 후보를 읽지 않는다', async () => {
    for (const authorization of ['', 'synthetic-reconcile-cron', 'Bearer wrong']) expect((await GET(request(authorization))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(maxDuration).toBe(90);
  });

  it('이 배포에 설정된 결제사만 넘겨 DB가 뽑은 후보(최대 3건)를 재정합 seam으로 확인하고 건수만 응답한다', async () => {
    mocks.reconcile.mockResolvedValueOnce({ kind: 'reconciled', outcome: 'approved' }).mockResolvedValueOnce({ kind: 'reconciled', outcome: 'unknown' });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('service_claim_payment_reconciliation_candidates', { p_limit: 3, p_providers: ['toss'] });
    // 가상계좌 입금 오류 되돌림 단계(ADR-0049 결정 4) — 토스가 설정된 배포만, 고를 것이 없으면 결제사를 부르지 않는다.
    expect(mocks.rpc).toHaveBeenCalledWith('service_claim_deposit_reversal_checks', { p_limit: 3 });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile.mock.calls[0][0]).toEqual(goods);
    expect(mocks.reconcile.mock.calls[0][1]).toMatch(/^auto-\d{12}-a700000000004003800000000000000[1]$/);
    const body = await response.json();
    expect(body).toEqual({ ok: true, providers: 1, candidates: 2, approved: 1, closed: 0, awaitingDeposit: 0, unresolved: 1, inProgress: 0, unavailable: 0, failed: 0, deferred: 0, reversals: noReversals, refunds: noRefunds });
    expect(JSON.stringify(body)).not.toContain(goods.attemptId);
  });

  it('설정된 결제사가 없으면 DB도 결제사도 부르지 않고 성공이다', async () => {
    mocks.providers.mockReturnValue([]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, providers: 0, candidates: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('조회 실패·결제사 설정 없음은 503, 넘기지 않은 결제사·형식 오류·조회 불가도 503이다', async () => {
    mocks.reconcile.mockResolvedValueOnce({ kind: 'failed' });
    expect((await GET(request())).status).toBe(503);
    mocks.reconcile.mockResolvedValue({ kind: 'unavailable' });
    expect((await GET(request())).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: [{ ...goods, provider: 'nicepay' }], error: null });
    expect((await GET(request())).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: [{ ...goods, provider: 'korpay' }], error: null });
    expect((await GET(request())).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301' } });
    expect((await GET(request())).status).toBe(503);
  });

  it('후보가 없으면 결제사를 부르지 않고 성공이다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  describe('가상계좌 입금 오류 되돌림(ADR-0049 결정 4)', () => {
    const claim = {
      attemptId: 'a7000000-0000-4003-8000-000000000004', orderId: 'a7000000-0000-4002-8000-000000000004', paymentKey: 'va-rev-key',
      state: 'awaiting_redeposit', reviewCode: null, dueAt: '2026-11-24T03:00:00.000Z', released: false,
      attempt: { id: 'a7000000-0000-4003-8000-000000000004', provider: 'toss', purpose: 'order', ref_id: 'a7000000-0000-4002-8000-000000000004',
        amount: 31000, currency: 'KRW', idempotency_key: 'goods:va', provider_order_id: 'O-va', provider_product_code: 'P-va',
        expires_at: '2026-11-24T03:00:00.000Z' },
    };
    beforeEach(() => {
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_deposit_reversal_checks'
        ? { data: [claim], error: null } : { data: [], error: null });
    });

    it('DB가 고른 되돌림을 처리하고 결과 건수만 응답한다(결제 키·주문 식별자 없음)', async () => {
      mocks.settle.mockResolvedValueOnce('closed');
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({
        attemptId: claim.attemptId, mode: 'sweep', caseRef: expect.stringMatching(/^auto-\d{12}-a700000000004003800000000000000[4]$/),
        reversal: expect.objectContaining({ attemptId: claim.attemptId, paymentKey: 'va-rev-key', state: 'awaiting_redeposit' }),
        attempt: expect.objectContaining({ id: claim.attemptId, refId: claim.orderId, amount: 31000 }),
      }));
      const body = await response.json();
      expect(body.reversals).toEqual({ ...noReversals, checked: 1, closed: 1 });
      expect(JSON.stringify(body)).not.toContain('va-rev-key');
    });

    it('조회 불가·처리 예외·목록 모양 오류는 503으로 남긴다(앞 단계 건수는 그대로)', async () => {
      mocks.settle.mockResolvedValueOnce('unavailable');
      expect((await GET(request())).status).toBe(503);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.settle.mockRejectedValueOnce(new Error('db'));
      const failed = await GET(request());
      expect(failed.status).toBe(503);
      expect((await failed.json()).reversals).toMatchObject({ checked: 1, failed: 1 });
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_deposit_reversal_checks'
        ? { data: [{ ...claim, attempt: { ...claim.attempt, id: 'other' } }], error: null } : { data: [], error: null });
      const malformed = await GET(request());
      expect(malformed.status).toBe(503);
      expect((await malformed.json()).reversals).toMatchObject({ errored: true });
      error.mockRestore();
    });
  });

  describe('가상계좌 은행 환불 감시(ADR-0049 결정 5 보강)', () => {
    const watch = { attemptId: 'a7000000-0000-4003-8000-000000000003', orderId: 'a7000000-0000-4002-8000-000000000003', paymentKey: 'va-key',
      providerOrderId: 'O-va', amount: 31000 };
    beforeEach(() => {
      mocks.providers.mockReturnValue([]);
      mocks.secretKey.mockReturnValue('synthetic_secret');
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_virtual_account_refund_watches'
        ? { data: [watch], error: null } : { data: 'failed', error: null });
    });

    it('토스 바인딩이 있으면 DB가 고른 감시를 원장 결제 키로 조회해 결과를 남기고 건수만 응답한다', async () => {
      mocks.inspect.mockResolvedValueOnce({ outcome: 'failed', refundStatus: 'FAILED', escrowBuyerCanceled: null, escrowLookupFailed: false });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith('service_claim_virtual_account_refund_watches', { p_limit: 3 });
      expect(mocks.inspect).toHaveBeenCalledWith(watch);
      expect(mocks.rpc).toHaveBeenCalledWith('service_record_virtual_account_refund_watch', {
        p_attempt_id: watch.attemptId, p_outcome: 'failed', p_refund_status: 'FAILED', p_escrow_buyer_canceled: null });
      const body = await response.json();
      expect(body.refunds).toEqual({ ...noRefunds, watches: 1, failed: 1 });
      expect(JSON.stringify(body)).not.toContain(watch.paymentKey);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it('에스크로 키를 조회기에 넘기고, 구매자 취소 확인을 기록에 싣고, DB가 닫으면 escrowSettled로 센다', async () => {
      mocks.escrowKey.mockReturnValue('synthetic_escrow_secret');
      mocks.inspect.mockResolvedValueOnce({ outcome: 'pending', refundStatus: 'NONE', escrowBuyerCanceled: true, escrowLookupFailed: false });
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_virtual_account_refund_watches'
        ? { data: [watch], error: null } : { data: 'completed', error: null });
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(mocks.inspectorOptions).toHaveBeenCalledWith({ secretKey: 'synthetic_secret', escrowSecretKey: 'synthetic_escrow_secret' });
      expect(mocks.rpc).toHaveBeenCalledWith('service_record_virtual_account_refund_watch', {
        p_attempt_id: watch.attemptId, p_outcome: 'pending', p_refund_status: 'NONE', p_escrow_buyer_canceled: true });
      expect((await response.json()).refunds).toEqual({ ...noRefunds, watches: 1, pending: 1, escrowSettled: 1 });
    });

    it('에스크로 거래를 확인하지 못해도 회차는 성공이고 확인 실패 건수만 센다', async () => {
      mocks.inspect.mockResolvedValueOnce({ outcome: 'pending', refundStatus: 'NONE', escrowBuyerCanceled: null, escrowLookupFailed: true });
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_virtual_account_refund_watches'
        ? { data: [watch], error: null } : { data: 'pending', error: null });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith('service_record_virtual_account_refund_watch', {
        p_attempt_id: watch.attemptId, p_outcome: 'pending', p_refund_status: 'NONE', p_escrow_buyer_canceled: null });
      expect((await response.json()).refunds).toEqual({ ...noRefunds, watches: 1, pending: 1, escrowLookupFailed: 1 });
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it('조회 불가·기록 실패는 503이고, 바인딩이 없으면 감시를 고르지 않는다', async () => {
      mocks.inspect.mockResolvedValueOnce({ outcome: 'unavailable', refundStatus: null });
      expect((await GET(request())).status).toBe(503);
      mocks.inspect.mockResolvedValueOnce({ outcome: 'completed', refundStatus: 'COMPLETED' });
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_virtual_account_refund_watches'
        ? { data: [watch], error: null } : { data: null, error: { code: 'XX000' } });
      expect((await GET(request())).status).toBe(503);
      mocks.rpc.mockClear();
      mocks.secretKey.mockReturnValue(null);
      expect((await GET(request())).status).toBe(200);
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('감시 목록 모양이 다르면 결제사를 부르지 않고 503이지만, 앞 단계 건수는 버리지 않는다', async () => {
      mocks.providers.mockReturnValue(['toss']);
      mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_payment_reconciliation_candidates'
        ? { data: [goods], error: null } : { data: [{ ...watch, amount: -1 }], error: null });
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(mocks.inspect).not.toHaveBeenCalled();
      expect(await response.json()).toMatchObject({ ok: false, candidates: 1, approved: 1, refunds: { errored: true } });
    });
  });
});
