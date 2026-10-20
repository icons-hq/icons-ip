import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
import { GET } from './route';
const ids = ['93942000-0000-4000-8000-000000000001', '93942000-0000-4000-8000-000000000002'];
const request = (token = 'TEST-cron') => new Request('https://example.test/api/cron/gifts', { headers: { authorization: `Bearer ${token}` } });
beforeEach(() => { vi.stubEnv('CRON_SECRET', 'TEST-cron'); mocks.rpc.mockReset().mockImplementation(async (name, args) => ({ error: null, data: name === 'service_expire_gifts' ? { expired: 3 } : name === 'service_purge_gift_exports' ? 2 : name === 'service_list_fenced_gift_cleanup_candidates' ? ids : { giftId: args.p_id, state: 'cleaned' } })); });
afterEach(() => vi.unstubAllEnvs());
it('rejects unauthorized calls without reading or writing gift data', async () => { expect((await GET(request('wrong'))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
it('expires bounded gifts and cleans each fenced gift in its own RPC transaction', async () => { const result = await GET(request()); expect(await result.json()).toEqual({ ok: true, expired: 3, exportReceiptsPurged: 2, cleaned: 2, failed: 0 }); expect(mocks.rpc.mock.calls.slice(3)).toEqual(ids.map(id => ['service_cleanup_fenced_gift', { p_id: id }])); });
it('retains successful cleanup and signals partial failure without IDs or secrets', async () => { mocks.rpc.mockImplementation(async (name, args) => ({ error: name === 'service_cleanup_fenced_gift' && args.p_id === ids[0] ? { message: 'private' } : null, data: name === 'service_expire_gifts' ? { expired: 0 } : name === 'service_purge_gift_exports' ? 2 : name === 'service_list_fenced_gift_cleanup_candidates' ? ids : { giftId: args.p_id, state: 'cleaned' } })); const result = await GET(request()); expect(result.status).toBe(503); expect(await result.json()).toEqual({ ok: false, expired: 0, exportReceiptsPurged: 2, cleaned: 1, failed: 1 }); expect(mocks.rpc).toHaveBeenCalledTimes(5); });

it('거래 내역을 지우지 않고 임시 내보내기 receipt만 최대1000건 정리한다', async () => { const result = await GET(request()); expect(result.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith('service_purge_gift_exports', { p_limit: 1000 }); });
