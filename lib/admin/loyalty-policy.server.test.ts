import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { loadAdminLoyaltyPolicy, parseAdminLoyaltyPolicy } from './loyalty-policy.server';
const data = { policy: { revision: 1, updatedAt: '2026-10-13T00:00:00Z', tiers: [
  { grade: 'silver', enabled: true, amount: 100000, itemCount: null },
  { grade: 'gold', enabled: true, amount: 300000, itemCount: null },
  { grade: 'platinum', enabled: true, amount: 1000000, itemCount: null },
] }, coupons: [{ code: 'SILVER-1', name: '실버 혜택', grade: 'silver', status: 'active', cadence: 'upgrade' }] };
const run = { grantMonth: '2026-12', startedAt: '2026-11-30T15:00:05Z', finishedAt: '2026-11-30T15:02:00Z', finishReason: 'completed',
  members: 120, recipients: 118, granted: 236, skipped: 1, coupons: [{ code: 'GOLD-MONTHLY', name: '골드 매월', granted: 118 }] };
beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ data: { ...data, monthlyRuns: [run] }, error: null }); });
it('정책과 연결 쿠폰을 함께 검사해 잘못된 응답을 화면에 전달하지 않는다', () => {
  expect(parseAdminLoyaltyPolicy(data)).toEqual({ ...data, monthlyRuns: [] });
  expect(parseAdminLoyaltyPolicy({ ...data, policy: { ...data.policy, revision: 0 } })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: [{ ...data.coupons[0], grade: 'welcome' }] })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: [data.coupons[0], data.coupons[0]] })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: null })).toBeNull();
});
it('연결 쿠폰의 지급 방식과 매월 지급 기록을 검사한다(지급 방식이 없던 응답은 승급 시 1회)', () => {
  const legacy = { ...data, coupons: [{ code: 'SILVER-1', name: '실버 혜택', grade: 'silver', status: 'active' }] };
  expect(parseAdminLoyaltyPolicy(legacy)?.coupons[0].cadence).toBe('upgrade');
  expect(parseAdminLoyaltyPolicy({ ...data, coupons: [{ ...data.coupons[0], cadence: 'weekly' }] })).toBeNull();
  expect(parseAdminLoyaltyPolicy({ ...data, monthlyRuns: [run] })?.monthlyRuns).toEqual([run]);
  const running = { ...run, finishedAt: null, finishReason: null };
  expect(parseAdminLoyaltyPolicy({ ...data, monthlyRuns: [running] })?.monthlyRuns).toEqual([running]);
  /* 재산정 실패 제외 수가 없던 응답은 0명이다. */
  const withoutSkipped: Record<string, unknown> = { ...run };
  delete withoutSkipped.skipped;
  expect(parseAdminLoyaltyPolicy({ ...data, monthlyRuns: [withoutSkipped] })?.monthlyRuns?.[0]?.skipped).toBe(0);
  for (const broken of [{ ...run, grantMonth: '2026-13' }, { ...run, finishReason: 'done' }, { ...run, finishedAt: null },
    { ...run, granted: -1 }, { ...run, skipped: -1 }, { ...run, coupons: [{ code: 'X', name: '', granted: 1 }] }]) {
    expect(parseAdminLoyaltyPolicy({ ...data, monthlyRuns: [broken] })).toBeNull();
  }
  expect(parseAdminLoyaltyPolicy({ ...data, monthlyRuns: null })).toBeNull();
});
it('전용 조회 RPC를 사용하며 조회 실패를 빈 정책으로 대신하지 않는다', async () => {
  await expect(loadAdminLoyaltyPolicy()).resolves.toEqual({ ...data, monthlyRuns: [run] });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_get_loyalty_policy');
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'private-database-message' } });
  await expect(loadAdminLoyaltyPolicy()).rejects.toThrow('회원등급 설정을 불러오지 못했습니다');
});
