import { beforeEach, expect, it, vi } from 'vitest';
import { loadKakaoUnlinkWithdrawalQueue } from './kakao-unlink-withdrawal.server';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc }) }));

beforeEach(() => rpc.mockReset());

it('검증한 대기 목록만 돌려주고 오류·모양 불일치는 null이다(빈 목록과 구분한다)', async () => {
  const entry = { userId: 'a11c0000-0000-4000-8000-000000000003', nickname: '카카오', maskedEmail: 'k***@example.test',
    reason: 'ACCOUNT_DELETE', eventAt: '2026-11-19T01:00:00+00:00', accountClosed: true, suspended: false };
  rpc.mockResolvedValue({ data: [entry], error: null });
  await expect(loadKakaoUnlinkWithdrawalQueue()).resolves.toEqual([entry]);
  expect(rpc).toHaveBeenCalledWith('admin_kakao_unlink_withdrawal_queue');
  rpc.mockResolvedValue({ data: [], error: null });
  await expect(loadKakaoUnlinkWithdrawalQueue()).resolves.toEqual([]);
  rpc.mockResolvedValue({ data: [{ ...entry, userId: 'x' }], error: null });
  await expect(loadKakaoUnlinkWithdrawalQueue()).resolves.toBeNull();
  rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
  await expect(loadKakaoUnlinkWithdrawalQueue()).resolves.toBeNull();
});
