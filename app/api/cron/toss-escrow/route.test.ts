import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/system-health/cron-run-recorder.server', () => ({ recordCronJobRun: async () => ({ incident: false }) }));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), paymentKey: vi.fn(), escrowKey: vi.fn(), process: vi.fn(), createWorker: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/payments/runtime-gateway', () => ({ tossBoundPaymentSecretKey: mocks.paymentKey, tossEscrowSecretKey: mocks.escrowKey }));
vi.mock('@/lib/payments/toss-escrow.server', async () => ({
  ...await vi.importActual<object>('@/lib/payments/toss-escrow.server'),
  createTossEscrowWorker: mocks.createWorker,
}));
import { GET } from './route';

const request = () => new Request('https://icons.test/api/cron/toss-escrow', { headers: { authorization: 'Bearer synthetic-escrow-cron' } });
const job = {
  orderId: 'a7000000-0000-4002-8000-000000000001', attemptId: 'a7000000-0000-4003-8000-000000000001', state: 'ready',
  deliveryMethod: 'DIRECT', carrier: null, trackingNumber: null, shippedAt: null, receivedAt: '2026-11-24T01:00:00.000Z',
  escrowKey: null, tossDeliveryId: null, revision: 1, paymentKey: 'tviva-key', recipientName: '김토스',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'synthetic-escrow-cron');
  mocks.paymentKey.mockReturnValue('live_gsk_synthetic00000001');
  mocks.escrowKey.mockReturnValue('live_sk_synthetic000000001');
  mocks.createWorker.mockReturnValue({ process: mocks.process });
  mocks.rpc.mockImplementation(async (name: string) => name === 'service_claim_toss_escrow_jobs'
    ? { data: [job], error: null } : name === 'service_count_toss_escrow_jobs_due' ? { data: 0, error: null } : { data: 'recorded', error: null });
});
afterEach(() => vi.unstubAllEnvs());

/* 에스크로 부가서비스 API는 결제 키(gsk)로 부를 수 없다(토스 'API 키' 문서) — 작업자는 두 키를 받는다(ADR-0049 결정 6 보강). */
describe('토스 에스크로 cron 키', () => {
  it('결제 키와 에스크로 키를 함께 작업자에 넘기고 건수만 응답한다', async () => {
    mocks.process.mockResolvedValueOnce({ outcome: 'registered', escrowKey: 'escrow_1', tossDeliveryId: 'delivery_1', escrowStatus: 'IN_PROGRESS' });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.createWorker).toHaveBeenCalledWith({ paymentSecretKey: 'live_gsk_synthetic00000001', escrowSecretKey: 'live_sk_synthetic000000001' });
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, configured: true, escrowKeyConfigured: true, jobs: 1, registered: 1, keyRejected: 0 });
    expect(JSON.stringify(body)).not.toContain('live_');
  });

  it('토스 바인딩이 없는 배포는 아무것도 하지 않는다', async () => {
    mocks.paymentKey.mockReturnValue(null);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configured: false, jobs: 0 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('에스크로 키가 없으면 작업을 고르지 않고, 처리할 작업이 있으면 키 없음으로 실패를 남긴다', async () => {
    mocks.escrowKey.mockReturnValue(null);
    let response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, configured: true, escrowKeyConfigured: false, jobs: 0 });
    mocks.rpc.mockImplementation(async (name: string) => name === 'service_count_toss_escrow_jobs_due' ? { data: 2, error: null } : { data: null, error: null });
    response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: 'toss_escrow_key_missing', configured: true, escrowKeyConfigured: false, waiting: 2 });
    expect(mocks.rpc).not.toHaveBeenCalledWith('service_claim_toss_escrow_jobs', expect.anything());
    expect(mocks.createWorker).not.toHaveBeenCalled();
  });

  it('키가 거절된 작업은 다시 시도로 남기고 이 실행은 키 거절로 실패한다', async () => {
    mocks.process.mockResolvedValueOnce({ outcome: 'retry', errorCode: 'toss_escrow_key_rejected' });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: 'toss_escrow_key_rejected', keyRejected: 1, retry: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('service_finish_toss_escrow_job', expect.objectContaining({ p_outcome: 'retry', p_error_code: 'toss_escrow_key_rejected' }));
  });
});
