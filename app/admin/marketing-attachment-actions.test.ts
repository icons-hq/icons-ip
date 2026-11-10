import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { sendMarketingTestAction, searchMarketingCouponsAction } from './marketing-attachment-actions';
const actor = 'bf701900-0000-4000-8000-000000000001', sessionId = 'bf701900-0000-4000-8000-000000000002', operation = 'bf701900-0000-4000-8000-000000000003';
const identity = { actorId: actor, sessionId };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: actor } }); });
describe('마케팅 본인 수신 경계', () => {
  it('권한·계정 변경 시 쓰기를 하지 않는다', async () => {
    mocks.access.mockResolvedValue(null); expect((await searchMarketingCouponsAction('')).error).toContain('권한');
    expect((await sendMarketingTestAction(operation, 1, operation, identity)).error).toContain('계정'); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ user: { id: sessionId } }); expect((await sendMarketingTestAction(operation, 1, operation, identity)).error).toContain('계정'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('저장본과 요청·세션을 결속하며 서버가 반환한 본인 테스트 경로만 사용한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { receiptId: operation, notificationId: sessionId, registeredAt: '2026-10-16T01:00:00Z', linkPath: `/notifications/marketing-test/${operation}` }, error: null });
    expect((await sendMarketingTestAction(operation, 2, operation, identity)).receipt?.id).toBe(operation);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_send_marketing_test', expect.objectContaining({ p_expected_actor: actor, p_expected_session: sessionId, p_expected_revision: 2, p_operation_id: operation }));
    mocks.rpc.mockResolvedValue({ data: { receiptId: operation, notificationId: sessionId, registeredAt: '2026-10-16T01:00:00Z', linkPath: '//elsewhere.test' }, error: null });
    expect((await sendMarketingTestAction(operation, 2, operation, identity)).uncertain).toBe(true);
  });
  it('응답 유실과 확정 충돌을 구분한다', async () => {
    mocks.rpc.mockRejectedValue(new Error('timeout')); expect((await sendMarketingTestAction(operation, 2, operation, identity)).uncertain).toBe(true);
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'marketing_campaign_changed' } }); expect((await sendMarketingTestAction(operation, 2, operation, identity)).uncertain).toBe(false);
  });
});
