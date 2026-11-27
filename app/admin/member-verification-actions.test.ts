import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemberVerificationLimitAction } from './member-verification-actions';
import { VERIFICATION_LIMIT_LABELS } from '@/lib/admin/member-verification-limits';

const { guard, rpc, invalidate } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: invalidate }));

const profile = '00000000-0000-4000-8000-000000000271';
const revision = 'a'.repeat(32);
const snapshot = {
  checkedAt: '2026-11-27T02:00:00Z', canReset: true, overseasState: null,
  limits: Object.keys(VERIFICATION_LIMIT_LABELS).map(kind => ({
    kind, hourLimit: kind === 'overseas_adult' ? null : 5, dayLimit: 3, hourUsed: 0, dayUsed: 0, revision: null, retryAt: null,
  })),
};
const reset = (reason = '  테스트 재신청  ') => resetMemberVerificationLimitAction(profile, 'overseas_adult', revision, reason);

describe('회원 인증 시도 초기화', () => {
  beforeEach(() => { vi.resetAllMocks(); guard.mockResolvedValue({ user: { id: 'operator' } }); });
  it('초기화 권한이나 사유가 없으면 저장하지 않는다', async () => {
    guard.mockResolvedValueOnce(null);
    expect((await reset()).ok).toBe(false);
    expect(guard).toHaveBeenCalledWith('/admin/community/members', { capability: 'platform.manage', adminOnly: true });
    expect((await reset(' ')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('선택한 회원·인증 종류·조회한 시도 기록과 사유로만 초기화한다', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'reset', snapshot }, error: null });
    expect(await reset()).toMatchObject({ ok: true, snapshot });
    expect(rpc).toHaveBeenCalledWith('admin_reset_member_verification_limit', {
      p_user_id: profile, p_kind: 'overseas_adult', p_revision: revision, p_reason: '테스트 재신청',
    });
    expect(invalidate).toHaveBeenCalledWith('/admin/community/members');
    expect(invalidate).toHaveBeenCalledWith(`/admin/customers/${profile}`);
  });
  it('오래된 확인은 최신 횟수를 보여 주고 결과가 불명확하면 초기화 성공을 표시하지 않는다', async () => {
    rpc.mockResolvedValueOnce({ data: { outcome: 'changed', snapshot }, error: null })
      .mockResolvedValueOnce({ data: { outcome: 'reset', snapshot: { limits: [] } }, error: null });
    expect(await reset()).toMatchObject({ ok: false, snapshot });
    expect(await reset()).toMatchObject({ ok: false, snapshot: null });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
