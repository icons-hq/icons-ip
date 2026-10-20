import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { activateOperatorAccessAction, changeOperatorRoleAction, saveOperatorDutyAction, transferOperatorOwnerAction } from './operator-directory-actions';
const user = '78000000-0000-4000-8000-000000000001'; const op = '78000000-0000-4000-8000-000000000002';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: user } }); });
describe('operator duty writes', () => {
  it('checks admin access before calling the mutation', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveOperatorDutyAction(user, 'cs', 0, op)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('retains the operation id and base revision for an exact retry', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'FETCH_ERROR' } }).mockResolvedValueOnce({ data: { duty: 'cs', revision: 1 }, error: null });
    expect(await saveOperatorDutyAction(user, 'cs', 0, op)).toHaveProperty('uncertain', true);
    expect(await saveOperatorDutyAction(user, 'cs', 0, op)).toEqual({ revision: 1 });
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
  it('distinguishes a stale revision from an uncertain transport error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } });
    const result = await saveOperatorDutyAction(user, 'cs', 1, op);
    expect(result).toHaveProperty('error', expect.stringContaining('다른 관리자'));
    expect(result).not.toHaveProperty('uncertain');
  });
});

describe('manager lifecycle actions', () => {
  it('rejects owner through the ordinary role endpoint and incomplete setup before any RPC', async () => {
    expect(await changeOperatorRoleAction(user, 'owner', 1, 1, op)).toHaveProperty('error');
    expect(await activateOperatorAccessAction([{ profileId: user, managerRole: 'primary' }], 1, op)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('retains exact role mutation payload for retry and invalidates the admin shell', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'FETCH_ERROR' } }).mockResolvedValueOnce({ data: { revision: 2, accessRevision: 5 }, error: null });
    expect(await changeOperatorRoleAction(user, 'deputy', 1, 4, op)).toHaveProperty('uncertain', true);
    expect(await changeOperatorRoleAction(user, 'deputy', 1, 4, op)).toEqual({ revision: 2, accessRevision: 5 });
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin', 'layout');
  });
  it('allows former-owner receipt replay through manage while the DB owns new transfer checks', async () => {
    mocks.rpc.mockResolvedValue({ data: { revision: 2, accessRevision: 3 }, error: null });
    expect(await transferOperatorOwnerAction(user, 1, 1, 2, op)).toEqual({ revision: 2, accessRevision: 3 });
    expect(mocks.access).toHaveBeenCalledWith('/admin/community/roles', { adminOnly: true, capability: 'operators.manage' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_transfer_operator_owner', { p_profile_id: user, p_expected_owner_revision: 1, p_expected_target_revision: 1, p_expected_access_revision: 2, p_operation_id: op });
  });
  it('treats permission and conflict denials as definitive rather than offering blind retries', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'operator_primary_revoke_denied' } });
    const result = await changeOperatorRoleAction(user, null, 1, 2, op);
    expect(result).toHaveProperty('error', expect.stringContaining('직접 회수'));
    expect(result).not.toHaveProperty('uncertain');
  });
});
