import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
import { GET, HEAD } from './route';
const request = (authorization = 'Bearer synthetic-cron') => new Request('https://icons.test/api/cron/review-rating-history', { headers: { authorization } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'synthetic-cron'); mocks.rpc.mockResolvedValue({ data: { status: 'disabled', version: 1, asOf: null, observedAt: null, fingerprint: null }, error: null }); });
afterEach(() => vi.unstubAllEnvs());
describe('scheduled review rating collection', () => {
  it('requires the exact configured Bearer secret before calling the DB', async () => {
    for (const value of ['', 'synthetic-cron', 'bearer synthetic-cron', 'Bearer wrong', 'Bearer  synthetic-cron']) expect((await GET(request(value))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', ''); expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('runs the no-argument collector once and returns private noncached status', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('service_observe_review_rating_daily');
    expect(await response.json()).toMatchObject({ ok: true, result: { status: 'disabled' } });
  });
  it.each([{ data: null, error: { code: '55000' } }, { data: null, error: null }, { data: { status: 'recorded' }, error: null }])('fails closed on job errors and malformed success', async result => {
    mocks.rpc.mockResolvedValue(result);
    const response = await GET(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false });
  });
  it('never dispatches a collection from a HEAD probe', async () => { expect(HEAD().status).toBe(405); expect(mocks.rpc).not.toHaveBeenCalled(); });
});
