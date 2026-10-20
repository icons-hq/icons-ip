import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'synthetic-reward-cron'); mocks.rpc.mockResolvedValue({ data: { processed: 1, failed: 0 }, error: null }); });
afterEach(() => vi.unstubAllEnvs());
describe('BEST 보상 작업', () => {
  it('정확한 비밀값이 없으면 DB를 호출하지 않는다', async () => {
    for (const authorization of ['', 'synthetic-reward-cron', 'Bearer wrong']) expect((await GET(new Request('https://icons.test/api/cron/customer-rewards', { headers: { authorization } }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('봉인된 서비스 RPC만 실행하고 실패를 성공으로 보고하지 않는다', async () => {
    const request = () => new Request('https://icons.test/api/cron/customer-rewards', { headers: { authorization: 'Bearer synthetic-reward-cron' } });
    expect((await GET(request())).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('process_review_best_rewards');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'unavailable' } }); expect((await GET(request())).status).toBe(503);
  });
});
