import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/email/operator-invitations.server', () => ({ operatorInvitationTokenHash: (token: string) => createHash('sha256').update(token).digest('hex') }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { acceptOperatorInvitationAction, readMyOperatorInvitationAction } from './actions';
const token = 'a'.repeat(43); const op = '89000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: op } }, error: null }); });
describe('recipient invitation actions', () => {
  it('requires authentication and only sends the token hash to the database', async () => {
    expect(await readMyOperatorInvitationAction('bad')).toEqual({ data: { status: 'unavailable' } }); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { status: 'pending', managerRole: 'deputy', duty: 'cs', expiresAt: '2026-10-20T00:00:00Z' }, error: null });
    expect(await readMyOperatorInvitationAction(token)).toHaveProperty('data.status', 'pending'); expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
    mocks.user.mockResolvedValue({ data: { user: null }, error: null }); expect(await readMyOperatorInvitationAction(token)).toHaveProperty('error'); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it('preserves the operation ID after unknown acceptance and refreshes access only after a valid receipt', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'FETCH_ERROR' } }).mockResolvedValueOnce({ data: { status: 'accepted', managerRole: 'deputy', accessActive: true }, error: null });
    expect(await acceptOperatorInvitationAction(token, op)).toHaveProperty('uncertain', true); expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(await acceptOperatorInvitationAction(token, op)).toHaveProperty('data.accessActive', true); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]); expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin', 'layout');
  });
  it('keeps email verification and revoked invitation results separate', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'operator_invitation_email_unverified' } }).mockResolvedValueOnce({ data: { status: 'accepted', managerRole: null, accessActive: false }, error: null });
    expect(await acceptOperatorInvitationAction(token, op)).toEqual({ data: { status: 'email_confirmation_required' } });
    expect(await acceptOperatorInvitationAction(token, op)).toEqual({ data: { status: 'accepted', managerRole: null, accessActive: false } });
  });
});
