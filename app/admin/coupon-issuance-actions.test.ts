import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { executeCouponIssueAction, previewCouponIssueAction } from './coupon-issuance-actions';
const actorId = 'bf701900-0000-4000-8000-000000000001', sessionId = 'bf701900-0000-4000-8000-000000000002', id = 'bf701900-0000-4000-8000-000000000003';
const identity = { actorId, sessionId };
const batch = { id, couponCode: 'TEST-CODE', couponName: '쿠폰', couponRevision: 1, targetKind: 'customers', segmentName: null, status: 'completed',
  targetCount: 1, plannedCount: 1, existingCount: 0, invalidCount: 0, issuedCount: 1, createdAt: '2026-10-16T01:00:00Z', validUntil: '2026-10-16T01:15:00Z', finishedAt: '2026-10-16T01:01:00Z', error: null,
  rows: [{ userId: sessionId, userCouponId: id, nickname: '검증', reason: null }], canExecute: false };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: actorId } }); mocks.rpc.mockResolvedValue({ data: batch, error: null }); });
describe('쿠폰 지정 발급 실행', () => {
  it('확인 없는 실행과 계정 변경을 차단한다', async () => {
    expect((await executeCouponIssueAction(id, identity, false)).error).toContain('확인'); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ user: { id: id } }); expect((await previewCouponIssueAction(id, 'TEST-CODE', { kind: 'customers', userIds: [sessionId] }, identity)).error).toContain('계정'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('실행 후 저장 결과를 다시 읽고 그 결과만 반환한다', async () => {
    expect((await executeCouponIssueAction(id, identity, true)).batch?.issuedCount).toBe(1);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_execute_coupon_issue', { p_id: id, p_expected_actor: actorId, p_expected_session: sessionId });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_get_coupon_issue', { p_id: id });
  });
  it('실행·재조회 응답 유실을 완료로 표시하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: batch, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'timeout' } });
    expect((await executeCouponIssueAction(id, identity, true)).uncertain).toBe(true); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
