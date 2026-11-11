import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAutoOrderConfirmationAction } from './auto-order-confirmation-actions';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
const id = 'a0c00000-0000-4000-8000-0000000000a1';
const state = { revision: 2, enabled: true, runTime: '18:00', enabledAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T01:00:00Z',
  nextRunAt: '2026-10-27T09:00:00Z', lastRun: null, lastExclusions: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: state, error: null }); });
describe('자동 발주확인 설정 저장', () => {
  it('발주 화면의 sales.manage 권한이 없으면 DB에 접근하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveAutoOrderConfirmationAction(true, '18:00', 1, id)).toHaveProperty('error');
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/dispatch', { capability: 'sales.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('정확한 매개변수로 저장하고 응답 값이 요청과 같을 때만 성공이다', async () => {
    expect(await saveAutoOrderConfirmationAction(true, '18:00', 1, id)).toEqual({ state });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_auto_order_confirmation', { p_enabled: true, p_run_time: '18:00', p_expected_revision: 1, p_operation_id: id });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/dispatch');
    expect(await saveAutoOrderConfirmationAction(true, '19:00', 1, id)).toHaveProperty('uncertain', true);
  });
  it('잘못된 입력은 저장하지 않는다', async () => {
    const cases: [unknown, unknown, unknown, unknown][] = [['yes', '18:00', 1, id], [true, '24:00', 1, id], [true, '18:00', 0, id], [true, '18:00', 1, 'not-uuid']];
    for (const [enabled, runTime, revision, operation] of cases) {
      expect(await saveAutoOrderConfirmationAction(enabled, runTime, revision, operation)).toHaveProperty('error');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('충돌·권한 거절은 확정 실패, 통신 실패·알 수 없는 오류는 결과 불명이다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'auto_order_confirmation_changed' } });
    expect(await saveAutoOrderConfirmationAction(true, '18:00', 1, id)).not.toHaveProperty('uncertain');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_capability_required' } });
    expect(await saveAutoOrderConfirmationAction(true, '18:00', 1, id)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await saveAutoOrderConfirmationAction(true, '18:00', 1, id)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'operation_conflict' } });
    expect(await saveAutoOrderConfirmationAction(true, '18:00', 1, id)).toHaveProperty('uncertain', true);
  });
});
