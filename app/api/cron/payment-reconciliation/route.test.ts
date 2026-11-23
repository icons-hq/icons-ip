import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/system-health/cron-run-recorder.server', () => ({ recordCronJobRun: async () => ({ incident: false }) }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reconcile: vi.fn(), providers: vi.fn(), secretKey: vi.fn(), inspect: vi.fn() }));
vi.mock('@/lib/payments/runtime-gateway', () => ({ tossEscrowSecretKey: mocks.secretKey }));
vi.mock('@/lib/payments/toss-virtual-account-refund-watch.server', () => ({
  createTossVirtualAccountRefundInspector: () => ({ inspect: mocks.inspect }),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/payments/attempt-reconciliation.server', async () => ({
  ...await vi.importActual<object>('@/lib/payments/attempt-reconciliation.server'),
  reconcilePaymentAttempt: mocks.reconcile,
  reconcilablePaymentProviders: mocks.providers,
}));
vi.mock('@/lib/orders/cancellation-auto.server', () => ({ scheduleApprovedOrderCancellation: vi.fn() }));
import { GET, maxDuration } from './route';

const goods = { attemptId: 'a7000000-0000-4003-8000-000000000001', purpose: 'order', provider: 'toss', refId: 'a7000000-0000-4002-8000-000000000001' };
const ticket = { attemptId: 'a7000000-0000-4003-8000-000000000002', purpose: 'ticket', provider: 'toss', refId: null };
const request = (authorization = 'Bearer synthetic-reconcile-cron') => new Request('https://icons.test/api/cron/payment-reconciliation', { headers: { authorization } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'synthetic-reconcile-cron');
  mocks.providers.mockReturnValue(['toss']);
  mocks.rpc.mockResolvedValue({ data: [goods, ticket], error: null });
  mocks.reconcile.mockResolvedValue({ kind: 'reconciled', outcome: 'approved' });
  mocks.secretKey.mockReturnValue(null);
});
const noRefunds = { watches: 0, completed: 0, pending: 0, failed: 0, unavailable: 0, recordFailed: 0, deferred: 0 };
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
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('service_claim_payment_reconciliation_candidates', { p_limit: 3, p_providers: ['toss'] });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile.mock.calls[0][0]).toEqual(goods);
    expect(mocks.reconcile.mock.calls[0][1]).toMatch(/^auto-\d{12}-a700000000004003800000000000000[1]$/);
    const body = await response.json();
    expect(body).toEqual({ ok: true, providers: 1, candidates: 2, approved: 1, closed: 0, awaitingDeposit: 0, unresolved: 1, inProgress: 0, unavailable: 0, failed: 0, deferred: 0, refunds: noRefunds });
    expect(JSON.stringify(body)).not.toContain(goods.attemptId);
  });

  it('설정된 결제사가 없으면 DB도 결제사도 부르지 않고 성공이다', async () => {
    mocks.providers.mockReturnValue([]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, providers: 0, candidates: 0, refunds: noRefunds });
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
      mocks.inspect.mockResolvedValueOnce({ outcome: 'failed', refundStatus: 'FAILED' });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledWith('service_claim_virtual_account_refund_watches', { p_limit: 3 });
      expect(mocks.inspect).toHaveBeenCalledWith(watch);
      expect(mocks.rpc).toHaveBeenCalledWith('service_record_virtual_account_refund_watch', {
        p_attempt_id: watch.attemptId, p_outcome: 'failed', p_refund_status: 'FAILED' });
      const body = await response.json();
      expect(body.refunds).toEqual({ ...noRefunds, watches: 1, failed: 1 });
      expect(JSON.stringify(body)).not.toContain(watch.paymentKey);
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

    it('감시 목록 모양이 다르면 결제사를 부르지 않고 503이다', async () => {
      mocks.rpc.mockResolvedValue({ data: [{ ...watch, amount: -1 }], error: null });
      expect((await GET(request())).status).toBe(503);
      expect(mocks.inspect).not.toHaveBeenCalled();
    });
  });
});
