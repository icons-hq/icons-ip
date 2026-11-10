import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readRestrictionReleaseAction, releaseRestrictionsAction } from './purchase-restriction-release-actions';
const mocks = vi.hoisted(() => ({ allowed: true, rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: async () => mocks.allowed }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = 'abcdef00-0000-7000-8000-000000000001';
const item = 'abcdef00-0000-7000-8000-000000000002';
const receipt = { id, reason: '합의 확인', completedAt: '2026-10-13T00:00:00Z', rows: [{ id: item, userId: id, outcome: 'released', releasedAt: '2026-10-13T00:00:00Z', customerRestricted: false }] };
beforeEach(() => { mocks.allowed = true; mocks.rpc.mockReset(); mocks.revalidate.mockReset(); });
describe('구매제한 선택 해제 액션', () => {
  it('현재 권한·상한·중복·확인 검사는 RPC 전 적용한다', async () => {
    expect(await releaseRestrictionsAction(id, [item], '사유', false)).toHaveProperty('error');
    expect(await releaseRestrictionsAction(id, [item, item], '사유', true)).toHaveProperty('error');
    mocks.allowed = false;
    expect(await releaseRestrictionsAction(id, [item], '사유', true)).toHaveProperty('error');
    expect(await readRestrictionReleaseAction(id)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('쓰기 응답을 믿지 않고 actor 소유의 확정 기록을 다시 읽는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { forged: true }, error: null }).mockResolvedValueOnce({ data: receipt, error: null });
    expect(await releaseRestrictionsAction(id, [item], '합의 확인', true)).toEqual({ receipt });
    expect(mocks.rpc.mock.calls).toEqual([
      ['admin_release_purchase_restrictions', { p_operation_id: id, p_restriction_ids: [item], p_reason: '합의 확인' }],
      ['admin_get_purchase_restriction_release', { p_operation_id: id }],
    ]);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/purchase-restrictions');
  });
  it('통신 실패·서버의 알 수 없는 실패·깨진 결과는 재조회 대상으로 둔다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await releaseRestrictionsAction(id, [item], '합의 확인', true)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: 'private sql content' } });
    const result = await releaseRestrictionsAction(id, [item], '합의 확인', true);
    expect(result).toMatchObject({ uncertain: true }); expect(JSON.stringify(result)).not.toContain('private');
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ data: { ...receipt, id: item }, error: null });
    expect(await releaseRestrictionsAction(id, [item], '합의 확인', true)).toMatchObject({ uncertain: true });
  });
  it('재조회에서 확정된 미저장과 현재의 결과를 분리한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await readRestrictionReleaseAction(id)).toEqual({ receipt: null });
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null });
    expect(await readRestrictionReleaseAction(id)).toEqual({ receipt });
  });
  it('고정 요청 충돌과 권한 거절은 확정 거절로 처리한다', async () => {
    for (const code of ['42501', '23505', 'PT409', '22023']) {
      mocks.rpc.mockResolvedValueOnce({ error: { code, message: 'private details' } });
      expect(await releaseRestrictionsAction(id, [item], '합의 확인', true)).toMatchObject({ uncertain: false });
    }
  });
});
