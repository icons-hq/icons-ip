import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), prepare: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/email/operator-invitations.server', () => ({ prepareOperatorInvitationEntry: mocks.prepare, dispatchOperatorInvitations: mocks.dispatch }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { cancelOperatorInvitationAction, createOperatorInvitationsAction, reissueOperatorInvitationAction } from './operator-invitation-actions';
const id = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { id: id(1), email: ' Member@Example.test ', name: ' 합성 매니저 ', managerRole: 'deputy' as const, duty: 'cs' as const };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: id(9) } }); mocks.prepare.mockImplementation(row => ({ ...row, tokenHash: 'synthetic-hash' })); mocks.dispatch.mockResolvedValue({ accepted: 1, pending: 0, needsReview: 0, unavailable: 0 }); });
describe('invitation server actions', () => {
  it('checks capability and normalized unique recipients before any RPC', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect(await createOperatorInvitationsAction([input], 1, id(2))).toHaveProperty('error');
    expect(await createOperatorInvitationsAction([input, { ...input, id: id(3), email: 'member@example.test' }], 1, id(2))).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('retries exactly the same invitation IDs before dispatching a verified receipt', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'FETCH_ERROR' } }).mockResolvedValueOnce({ data: { count: 1, invitationIds: [id(1)], accessRevision: 2 }, error: null });
    expect(await createOperatorInvitationsAction([input], 1, id(2))).toHaveProperty('uncertain', true);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(await createOperatorInvitationsAction([input], 1, id(2))).toHaveProperty('count', 1);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.prepare.mock.calls[0][0]).toEqual({ ...input, email: 'member@example.test', name: '합성 매니저' });
    expect(mocks.dispatch).toHaveBeenCalledWith([id(1)], id(9));
  });
  it('never dispatches malformed or mismatched mutation receipts', async () => {
    mocks.rpc.mockResolvedValue({ data: { count: 1, invitationIds: [id(4)], accessRevision: 2 }, error: null });
    expect(await createOperatorInvitationsAction([input], 1, id(2))).toHaveProperty('uncertain', true); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('reports an already-created invitation separately from post-commit delivery failure', async () => {
    mocks.rpc.mockResolvedValue({ data: { count: 1, invitationIds: [id(1)], accessRevision: 2 }, error: null }); mocks.dispatch.mockRejectedValue(new Error('provider unavailable'));
    const result = await createOperatorInvitationsAction([input], 1, id(2)); expect(result).toHaveProperty('count', 1); expect(result).toHaveProperty('delivery', expect.stringContaining('초대는 등록'));
  });
  it('reissues with a new identity and treats stale cancellation as definitive', async () => {
    expect(await reissueOperatorInvitationAction(id(1), input, 1, 2, id(2))).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } }); const result = await cancelOperatorInvitationAction(id(1), 1, 2, id(2)); expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('uncertain');
  });
});
