import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { loadAdminLoyaltyPolicy, parseAdminLoyaltyPolicy } from './loyalty-policy.server';
const data = { policy: { revision: 1, updatedAt: '2026-10-13T00:00:00Z', tiers: [
  { grade: 'silver', enabled: true, amount: 100000, itemCount: null },
  { grade: 'gold', enabled: true, amount: 300000, itemCount: null },
  { grade: 'platinum', enabled: true, amount: 1000000, itemCount: null },
] }, coupons: [{ code: 'SILVER-1', name: '실버 혜택', grade: 'silver', status: 'active' }] };
beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ data, error: null }); });
it('정책과 연결 쿠폰을 함께 검사해 잘못된 응답을 화면에 전달하지 않는다', () => {
  expect(parseAdminLoyaltyPolicy(data)).toEqual(data);
  expect(parseAdminLoyaltyPolicy({ ...data, policy: { ...data.policy, revision: 0 } })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: [{ ...data.coupons[0], grade: 'welcome' }] })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: [data.coupons[0], data.coupons[0]] })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: null })).toBeNull();
});
it('전용 조회 RPC를 사용하며 조회 실패를 빈 정책으로 대신하지 않는다', async () => {
  await expect(loadAdminLoyaltyPolicy()).resolves.toEqual(data);
  expect(mocks.rpc).toHaveBeenCalledWith('admin_get_loyalty_policy');
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private-database-message' } });
  await expect(loadAdminLoyaltyPolicy()).rejects.toThrow('회원등급 설정을 불러오지 못했습니다');
});
