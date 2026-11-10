import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { setAdminOperationAlertBadgeAction, updateAdminOperationAlertsAction } from './operations-dock-actions';
const input = { action: 'hide' as const, ids: null, through: '2026-10-12T12:00:00.123456Z', category: 'orders', state: 'unread' };
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: 1, error: null }); });
describe('운영자 알림 쓰기 경계', () => {
  it('인증 거절 후 RPC를 호출하지 않는다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('denied'));
    await expect(updateAdminOperationAlertsAction(input)).rejects.toThrow('denied');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('필터와 조회시각을 그대로 전달한다', async () => {
    expect(await updateAdminOperationAlertsAction(input)).toEqual({});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_operation_alerts', { p_action: 'hide', p_ids: null, p_through: input.through, p_category: 'orders', p_state: 'unread' });
  });
  it('잘못된 필터를 전체 변경으로 넓히지 않는다', async () => {
    expect(await updateAdminOperationAlertsAction({ ...input, category: 'unknown' })).toHaveProperty('error');
    expect(await updateAdminOperationAlertsAction({ ...input, state: 'unknown' })).toHaveProperty('error');
    expect(await updateAdminOperationAlertsAction({ ...input, ids: [] })).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('설정 실패는 성공으로 보고하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'conflict' } });
    expect(await setAdminOperationAlertBadgeAction(false)).toHaveProperty('error');
  });
});
