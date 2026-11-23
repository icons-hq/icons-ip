import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { revokeUserCouponsAction } from './coupon-revoke-actions';

const op = 'bf702800-0000-4000-8000-000000000001', a = 'bf702800-0000-4000-8000-000000000002', b = 'bf702800-0000-4000-8000-000000000003';
const ok = { operationId: op, requestedCount: 1, revokedCount: 1, lines: [{ userCouponId: a, status: 'revoked' }] };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: op } }); mocks.rpc.mockResolvedValue({ data: ok, error: null }); });

describe('쿠폰 개별 회수 서버 액션', () => {
  it('입력이 틀리면 DB를 부르지 않는다', async () => {
    for (const input of [
      { userCouponIds: [], reason: '잘못 발급', operationId: op },
      { userCouponIds: [a, a], reason: '잘못 발급', operationId: op },
      { userCouponIds: ['x'], reason: '잘못 발급', operationId: op },
      { userCouponIds: [a], reason: ' 가 ', operationId: op },
      { userCouponIds: [a], reason: '가'.repeat(501), operationId: op },
      { userCouponIds: [a], reason: '잘못 발급', operationId: 'x' },
      { userCouponIds: Array.from({ length: 501 }, (_, i) => `bf702800-0000-4000-8000-${String(i).padStart(12, '0')}`), reason: '잘못 발급', operationId: op },
    ]) expect((await revokeUserCouponsAction(input)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('마케팅 관리 권한이 없으면 거절한다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await revokeUserCouponsAction({ userCouponIds: [a], reason: '잘못 발급', operationId: op })).toEqual({ ok: false, error: '쿠폰 회수 권한이 필요합니다.' });
    expect(mocks.access).toHaveBeenCalledWith('/admin/sales/coupons', { capability: 'marketing.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('사유를 다듬어 RPC에 넘기고 결과를 읽어 화면 캐시를 비운다', async () => {
    const result = await revokeUserCouponsAction({ userCouponIds: [a], reason: '  다른 고객에게 잘못 발급  ', operationId: op });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_revoke_user_coupons', { p_user_coupon_ids: [a], p_reason: '다른 고객에게 잘못 발급', p_operation_id: op });
    expect(result).toMatchObject({ ok: true, result: { revokedCount: 1, replayed: false } });
    expect(mocks.revalidate).toHaveBeenCalled();
  });

  it('회수된 줄이 없으면 캐시를 비우지 않고, 응답이 깨졌거나 DB가 거절하면 오류로 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { operationId: op, requestedCount: 1, revokedCount: 0, lines: [{ userCouponId: b, status: 'in_use' }] }, error: null });
    expect(await revokeUserCouponsAction({ userCouponIds: [b], reason: '잘못 발급', operationId: op })).toMatchObject({ ok: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect((await revokeUserCouponsAction({ userCouponIds: [a], reason: '잘못 발급', operationId: op })).ok).toBe(false);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'coupon_revoke_operation_conflict' } });
    expect(await revokeUserCouponsAction({ userCouponIds: [a], reason: '잘못 발급', operationId: op })).toMatchObject({ ok: false, error: expect.stringContaining('앞서 보낸 회수 요청') });
  });
});
