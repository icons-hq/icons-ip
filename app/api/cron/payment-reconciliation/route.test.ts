import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/system-health/cron-run-recorder.server', () => ({ recordCronJobRun: async () => ({ incident: false }) }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), reconcile: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/payments/attempt-reconciliation.server', async () => ({
  ...await vi.importActual<object>('@/lib/payments/attempt-reconciliation.server'),
  reconcilePaymentAttempt: mocks.reconcile,
}));
vi.mock('@/lib/orders/cancellation-auto.server', () => ({ scheduleApprovedOrderCancellation: vi.fn() }));
import { GET, maxDuration } from './route';

const goods = { attemptId: 'a7000000-0000-4003-8000-000000000001', purpose: 'order', provider: 'toss', refId: 'a7000000-0000-4002-8000-000000000001' };
const ticket = { attemptId: 'a7000000-0000-4003-8000-000000000002', purpose: 'ticket', provider: 'toss', refId: null };
const request = (authorization = 'Bearer synthetic-reconcile-cron') => new Request('https://icons.test/api/cron/payment-reconciliation', { headers: { authorization } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'synthetic-reconcile-cron');
  mocks.rpc.mockResolvedValue({ data: [goods, ticket], error: null });
  mocks.reconcile.mockResolvedValue({ kind: 'reconciled', outcome: 'approved' });
});
afterEach(() => vi.unstubAllEnvs());

describe('미종결 결제 자동 재확인', () => {
  it('비밀값이 맞지 않으면 후보를 읽지 않는다', async () => {
    for (const authorization of ['', 'synthetic-reconcile-cron', 'Bearer wrong']) expect((await GET(request(authorization))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(maxDuration).toBe(90);
  });

  it('DB가 고른 후보(최대 3건)만 재정합 seam으로 확인하고 건수만 응답한다', async () => {
    mocks.reconcile.mockResolvedValueOnce({ kind: 'reconciled', outcome: 'approved' }).mockResolvedValueOnce({ kind: 'reconciled', outcome: 'unknown' });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('service_list_payment_reconciliation_candidates', { p_limit: 3 });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.reconcile.mock.calls[0][0]).toEqual(goods);
    expect(mocks.reconcile.mock.calls[0][1]).toMatch(/^auto-\d{12}-a700000000004003800000000000000[1]$/);
    const body = await response.json();
    expect(body).toEqual({ ok: true, candidates: 2, approved: 1, closed: 0, unresolved: 1, inProgress: 0, unavailable: 0, failed: 0, deferred: 0 });
    expect(JSON.stringify(body)).not.toContain(goods.attemptId);
  });

  it('조회 실패·결제사 설정 없음은 503, 후보 형식 오류·조회 불가도 503이다', async () => {
    mocks.reconcile.mockResolvedValueOnce({ kind: 'failed' });
    expect((await GET(request())).status).toBe(503);
    mocks.reconcile.mockResolvedValue({ kind: 'unavailable' });
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
});
