import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ run: vi.fn(), repository: vi.fn(() => ({ synthetic: true })), adapter: vi.fn() }));
vi.mock('@/lib/fulfillment/tracking/run', () => ({ runDeliveryTrackingTick: mocks.run }));
vi.mock('@/lib/fulfillment/tracking/repository.server', () => ({ deliveryTrackingRepository: mocks.repository }));
vi.mock('@/lib/fulfillment/tracking/adapter.server', () => ({ trackingAdapterFromEnvironment: mocks.adapter }));
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); mocks.run.mockReset(); mocks.adapter.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const request = (secret?: string) => new Request('https://example.test/api/cron/delivery-tracking', { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
const idle = { polled: 0, failed: 0, recorded: 0, duplicates: 0, ignored: 0, invalid: 0, completed: 0, held: 0, skipped: 0 };

describe('택배 추적 cron', () => {
  it.each([undefined, 'wrong'])('인증되지 않은 호출을 작업 전에 거절한다', async (secret) => {
    expect((await GET(request(secret))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('비밀값이 없으면 어떤 호출도 받지 않는다', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(request(''))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('스위치가 꺼져 있으면(기본) 정상으로 끝난다', async () => {
    mocks.run.mockResolvedValue({ enabled: false, ...idle });
    const response = await GET(request('synthetic-cron-secret'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ ok: true, enabled: false, ...idle });
  });
  it('DB 스위치가 고른 서비스 이름으로 이 서버의 어댑터를 고른다', async () => {
    mocks.run.mockImplementation(async (options: { adapterFor: (provider: string) => unknown }) => { options.adapterFor('fake'); return { enabled: true, ...idle }; });
    await GET(request('synthetic-cron-secret'));
    expect(mocks.adapter).toHaveBeenCalledWith('fake');
  });
  it('켜져 있는데 어댑터가 없거나 조회가 실패하면 관측되게 503이고 건수만 싣는다', async () => {
    mocks.run.mockResolvedValue({ enabled: true, unavailable: 'provider_missing', ...idle, completed: 1 });
    const missing = await GET(request('synthetic-cron-secret'));
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ ok: false, enabled: true, unavailable: 'provider_missing', ...idle, completed: 1 });
    mocks.run.mockResolvedValue({ enabled: true, ...idle, polled: 2, failed: 1 });
    expect((await GET(request('synthetic-cron-secret'))).status).toBe(503);
    mocks.run.mockResolvedValue({ enabled: true, ...idle, polled: 2, recorded: 1, invalid: 1 });
    expect((await GET(request('synthetic-cron-secret'))).status).toBe(503);
    mocks.run.mockResolvedValue({ enabled: true, ...idle, polled: 2, recorded: 3, completed: 1, skipped: 1 });
    expect((await GET(request('synthetic-cron-secret'))).status).toBe(200);
  });
  it('실패한 단계는 이름만 싣고 503이며, 기록이 실패해도 판정 결과를 함께 싣는다', async () => {
    mocks.run.mockResolvedValue({ enabled: true, failedStages: ['record'], ...idle, polled: 2, completed: 1 });
    const failed = await GET(request('synthetic-cron-secret'));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, enabled: true, failedStages: ['record'], ...idle, polled: 2, completed: 1 });
    mocks.run.mockResolvedValue({ enabled: false, failedStages: ['targets'], ...idle });
    expect((await GET(request('synthetic-cron-secret'))).status).toBe(503);
    mocks.run.mockResolvedValue({ enabled: null, failedStages: ['targets', 'complete'], ...idle });
    expect(await (await GET(request('synthetic-cron-secret'))).json()).toEqual({ ok: false, enabled: null, failedStages: ['targets', 'complete'], ...idle });
  });
  it('내부 오류의 내용을 응답에 싣지 않는다', async () => {
    mocks.run.mockRejectedValue(new Error('hanjin 123456789012 private'));
    expect(await (await GET(request('synthetic-cron-secret'))).json()).toEqual({ ok: false });
  });
});
