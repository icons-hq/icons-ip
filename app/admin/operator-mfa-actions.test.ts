import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetOperatorMfaAction, saveOperatorMfaPolicyAction } from './operator-mfa-actions';

const mocks = vi.hoisted(() => ({
  access: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), listFactors: vi.fn(), deleteFactor: vi.fn(), order: [] as string[],
}));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: (...args: unknown[]) => { mocks.order.push('rpc'); return mocks.rpc(...args); } }) }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ auth: { admin: { mfa: {
    listFactors: (...args: unknown[]) => { mocks.order.push('list'); return mocks.listFactors(...args); },
    deleteFactor: (...args: unknown[]) => { mocks.order.push('delete'); return mocks.deleteFactor(...args); },
  } } } }),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

const op = 'c0f00000-0000-4000-9000-0000000000b1';
const target = 'c0f00000-0000-4000-9000-0000000000b2';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.access.mockResolvedValue({ user: { id: 'owner' } });
  mocks.rpc.mockResolvedValue({ data: { required: true, revision: 2, updatedAt: '2026-11-18T01:00:00Z' }, error: null });
  mocks.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f1' }, { id: 'f2' }] }, error: null });
  mocks.deleteFactor.mockResolvedValue({ data: { id: 'f1' }, error: null });
});

describe('2단계 인증 요구 스위치 저장', () => {
  it('매니저 관리(관리자 전용) 권한이 없으면 DB에 접근하지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveOperatorMfaPolicyAction(true, 1, op)).toHaveProperty('error');
    expect(mocks.access).toHaveBeenCalledWith('/admin/settings/mfa', { capability: 'operators.manage', adminOnly: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('정확한 매개변수로 저장하고 응답이 요청과 같을 때만 성공한다', async () => {
    expect(await saveOperatorMfaPolicyAction(true, 1, op)).toEqual({ receipt: { required: true, revision: 2, updatedAt: '2026-11-18T01:00:00Z' } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_operator_mfa_policy', { p_required: true, p_expected_revision: 1, p_operation_id: op });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/mfa');
    expect(await saveOperatorMfaPolicyAction(false, 1, op)).toHaveProperty('uncertain', true);
  });

  it('잘못된 입력은 DB 전에 거절하고, DB 거절은 사유 문구로, 모르는 실패는 같은 요청 재확인으로 돌려준다', async () => {
    for (const args of [['true', 1, op], [true, 0, op], [true, 1.5, op], [true, 1, 'nope']] as const) {
      // 서버 액션은 클라이언트가 보낸 임의 값을 받는다 — 타입 밖 값도 시험한다.
      expect(await saveOperatorMfaPolicyAction(...(args as unknown as Parameters<typeof saveOperatorMfaPolicyAction>))).not.toHaveProperty('uncertain');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'operator_mfa_self_required' } });
    expect(await saveOperatorMfaPolicyAction(true, 1, op)).toEqual({ error: expect.stringContaining('내 보안 설정') });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'operator_mfa_unenrolled' } });
    expect(await saveOperatorMfaPolicyAction(true, 1, op)).toEqual({ error: expect.stringContaining('미등록 운영자') });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'operator_mfa_policy_changed' } });
    expect(await saveOperatorMfaPolicyAction(true, 1, op)).not.toHaveProperty('uncertain');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection lost' } });
    expect(await saveOperatorMfaPolicyAction(true, 1, op)).toHaveProperty('uncertain', true);
  });
});

describe('기기 분실 2단계 인증 초기화', () => {
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: { profileId: target, factorCount: 2, sessionsRevoked: 3 }, error: null });
  });

  it('DB가 권한 판정·세션 끊기·감사 기록을 마친 뒤에만 admin API로 인증 앱 등록을 지운다', async () => {
    expect(await resetOperatorMfaAction(target, op)).toEqual({ receipt: { profileId: target, factorCount: 2, sessionsRevoked: 3, factorsDeleted: 2 } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_reset_operator_mfa', { p_profile_id: target, p_operation_id: op });
    expect(mocks.listFactors).toHaveBeenCalledWith({ userId: target });
    expect(mocks.deleteFactor.mock.calls).toEqual([[{ id: 'f1', userId: target }], [{ id: 'f2', userId: target }]]);
    expect(mocks.order).toEqual(['rpc', 'list', 'delete', 'delete', 'rpc']);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_reset_operator_mfa', { p_profile_id: target, p_operation_id: op });
  });

  it('권한이 없거나 DB가 거절하면 인증 앱 등록을 건드리지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await resetOperatorMfaAction(target, op)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ user: { id: 'primary' } });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'operator_mfa_reset_owner_only' } });
    expect(await resetOperatorMfaAction(target, op)).toEqual({ error: expect.stringContaining('통합 매니저만') });
    mocks.rpc.mockResolvedValue({ data: { profileId: 'someone-else', factorCount: 0, sessionsRevoked: 0 }, error: null });
    expect(await resetOperatorMfaAction(target, op)).toHaveProperty('uncertain', true);
    expect(await resetOperatorMfaAction('nope', op)).not.toHaveProperty('uncertain');
    expect(mocks.listFactors).not.toHaveBeenCalled();
    expect(mocks.deleteFactor).not.toHaveBeenCalled();
  });

  it('삭제 뒤 세션 정리를 확인하지 못하면 같은 요청으로 다시 시도하게 한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { profileId: target, factorCount: 2, sessionsRevoked: 3 }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'connection lost' } });
    expect(await resetOperatorMfaAction(target, op)).toEqual({ error: expect.stringContaining('마지막 세션 정리'), uncertain: true });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('삭제가 실패하면 같은 요청으로 다시 시도하게 한다', async () => {
    mocks.deleteFactor.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect(await resetOperatorMfaAction(target, op)).toEqual({ error: expect.stringContaining('같은 요청으로 다시 시도'), uncertain: true });
    mocks.listFactors.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect(await resetOperatorMfaAction(target, op)).toHaveProperty('uncertain', true);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
