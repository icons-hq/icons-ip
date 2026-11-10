import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.auth }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.admin }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
import { changePurchaseConfirmationAction, readPurchaseConfirmationAction } from './purchase-confirmation-actions';
const id = 'ac160000-0000-4000-8000-000000000001', actorId = 'ac160000-0000-4000-8000-000000000002', sessionId = 'ac160000-0000-4000-8000-000000000003', identity = { actorId, sessionId };
const value = { orderId: id, revision: 1, status: 'done', confirmedAt: '2026-10-16T05:00:00Z', confirmationKind: 'buyer', autoDueAt: null, automaticActive: false, held: false, holdReason: null,
  extensionUsed: false, extensionDays: null, requestedAt: null, canConfirm: false, canExtend: false, history: [] };
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: actorId } }); mocks.admin.mockResolvedValue({ user: { id: actorId } }); mocks.rpc.mockResolvedValue({ data: value, error: null }); });
describe('구매확정 서버 경계', () => {
  it('고객 확인 없는 요청·계정 변경·관리자 동작 위장을 차단한다', async () => {
    expect(await changePurchaseConfirmationAction(id, 'confirm', '', 0, id, identity, false, false)).toHaveProperty('error');
    expect(await changePurchaseConfirmationAction(id, 'hold', '보류', 0, id, identity, false, true)).toHaveProperty('error');
    mocks.auth.mockResolvedValue({ user: { id } }); expect(await changePurchaseConfirmationAction(id, 'confirm', '', 0, id, identity, false, true)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('현재 actor/session과 기대 revision을 보내고 확인된 응답만 성공 처리한다', async () => {
    expect(await changePurchaseConfirmationAction(id, 'confirm', '', 0, id, identity, false, true)).toEqual({ value });
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_my_purchase', expect.objectContaining({ p_actor: actorId, p_session: sessionId, p_revision: 0, p_acknowledged: true }));
    expect(mocks.refresh).toHaveBeenCalledWith(`/orders/${id}`);
    mocks.rpc.mockResolvedValue({ data: { ...value, orderId: actorId }, error: null }); expect(await readPurchaseConfirmationAction(id)).toHaveProperty('error');
  });
  it('관리자 권한과 고객 요청을 별도 RPC로 검사하며 응답 유실은 재실행하지 않는다', async () => {
    mocks.rpc.mockRejectedValue(new Error('timeout')); expect(await changePurchaseConfirmationAction(id, 'request', '', 0, id, identity, true)).toHaveProperty('error');
    expect(mocks.admin).toHaveBeenCalled(); expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
