import { beforeEach, expect, it, vi } from 'vitest';
import { changeClaimFeeAction, readOrderClaimFeesAction } from './claim-fee-actions';
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: m.auth }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = (n: number) => `ab160000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) };
const doc = { claimId: id(3), orderId: id(4), revision: 1, claimRevision: 0, claimType: 'exchange', policy: null, canIssue: false, invoices: [], history: [] };
const issue = { amount: 6000, payerRole: 'buyer', customerNote: 'TEST fee', evidence: 'TEST agreement', confirmed: true };
const change = () => changeClaimFeeAction(id(3), null, 'issue', issue, 0, 0, id(5), identity);
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset().mockResolvedValue({ user: { id: id(1) } }); m.revalidate.mockReset(); });
it('acknowledges a frozen receipt but presents the latest claim fee state', async () => {
 const latest = { ...doc, revision: 4, claimRevision: 2 };
 m.rpc.mockResolvedValueOnce({ data: doc }).mockResolvedValueOnce({ data: latest });
 expect(await change()).toEqual({ document: latest });
 expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_change_claim_fee', expect.objectContaining({ p_operation: id(5), p_values: issue }));
 expect(m.rpc).toHaveBeenNthCalledWith(2, 'admin_get_claim_fees', { p_claim: id(3), p_actor: id(1), p_session: id(2) });
});
it('keeps the original command recoverable if the current readback fails', async () => {
 m.rpc.mockResolvedValueOnce({ data: doc }).mockRejectedValueOnce(new Error('private detail'));
 const result = await change(); expect(result).toMatchObject({ uncertain: true }); expect(JSON.stringify(result)).not.toContain('private detail');
 expect(m.rpc).toHaveBeenCalledTimes(2); expect(m.revalidate).not.toHaveBeenCalled();
});
it('does not treat a confirmed stale input rejection as uncertain', async () => {
 m.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'claim_fee_changed' } });
 expect(await change()).toMatchObject({ uncertain: false }); expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('rejects another actor before any fee RPC', async () => {
 m.auth.mockResolvedValue({ user: { id: id(9) } }); expect(await change()).toHaveProperty('error'); expect(m.rpc).not.toHaveBeenCalled();
});
it('customer reports use only the constrained report RPC and owner readback', async () => {
 m.rpc.mockResolvedValue({ data: doc });
 expect(await changeClaimFeeAction(id(3), id(8), 'report_payment', { confirmed: true }, 1, 0, id(5), identity)).toEqual({ document: doc });
 expect(m.auth).not.toHaveBeenCalled();
 expect(m.rpc).toHaveBeenNthCalledWith(1, 'report_my_claim_fee_payment', expect.not.objectContaining({ p_values: expect.anything() }));
 expect(m.rpc).toHaveBeenNthCalledWith(2, 'get_my_claim_fees', expect.objectContaining({ p_actor: id(1) }));
});
it('rejects a different order in historical fee readback', async () => {
 m.rpc.mockResolvedValue({ data: [{ ...doc, orderId: id(9) }] }); expect(await readOrderClaimFeesAction(id(4), identity)).toHaveProperty('error');
});
