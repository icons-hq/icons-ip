import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ worker: vi.fn(), cleanup: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/subscriptions/worker.server', () => ({ runtimeGoodsSubscriptionWorker: () => ({ run: mocks.worker }) }));
vi.mock('@/lib/subscriptions/credential-revocation.server', () => ({ runBillingCredentialCleanup: mocks.cleanup }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/subscriptions/http.server', () => ({ subscriptionJson: (body: unknown, status = 200) => Response.json(body, { status }) }));
import { GET, maxDuration } from './route';
const actor = 'b1716000-0000-4000-8000-000000000010';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret'); mocks.worker.mockResolvedValue({ state: 'idle' }); mocks.cleanup.mockResolvedValue({ state: 'idle' });
  mocks.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === 'service_list_fenced_goods_transaction_cleanup_candidates' ? [actor] : name === 'service_cleanup_fenced_goods_transactions' ? { state: 'cleaned', quotesRemoved: 2 } : 0 })); });
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request('https://example.test/api/cron/subscriptions', { headers: { authorization: 'Bearer synthetic-cron-secret' } });
it('cron 인증 전에는 결제·정리 RPC를 호출하지 않는다', async () => {
  expect(maxDuration).toBe(90); expect((await GET(new Request('https://example.test'))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
});
it('인증 secret·내려받기 원문 TTL 정리 후 회차 한 건만 처리한다', async () => {
  mocks.worker.mockResolvedValueOnce({ state: 'approved' }); expect((await GET(request())).status).toBe(200);
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_purge_billing_registration_secrets', 'service_purge_goods_subscription_exports']); expect(mocks.worker).toHaveBeenCalledTimes(1); expect(mocks.cleanup).not.toHaveBeenCalled();
});
it('결제와 카드 정리가 idle일 때 탈퇴 후보 한 건만 별도 RPC로 처리한다', async () => {
  expect((await GET(request())).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith('service_list_fenced_goods_transaction_cleanup_candidates', { p_limit: 1 });
  expect(mocks.rpc).toHaveBeenCalledWith('service_cleanup_fenced_goods_transactions', { p_actor: actor });
});
it('카드 폐기가 진행 중이면 계정 PII 정리를 같은 tick에 시작하지 않는다', async () => {
  mocks.cleanup.mockResolvedValueOnce({ state: 'revoked' }); await GET(request()); expect(mocks.rpc.mock.calls.map(call => call[0])).not.toContain('service_cleanup_fenced_goods_transactions');
});
it('TTL 정리 실패는 실패 상태로 반환하고 새 결제를 시작하지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { message: 'unavailable' }, data: null }); expect((await GET(request())).status).toBe(502); expect(mocks.worker).not.toHaveBeenCalled();
});
