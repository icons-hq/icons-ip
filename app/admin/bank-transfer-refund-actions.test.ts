import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bankRefundMetadata, type BankRefundContext, type BankRefundRequest, type BankRefundReceipt } from '@/lib/admin/bank-transfer-refund';
const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), gateway: vi.fn(), reconcile: vi.fn(), recover: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) throw error; } }));
vi.mock('@/lib/payments/runtime-gateway', () => ({ getPaymentGateway: mocks.gateway }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({ reconcileOrderCancellation: mocks.reconcile }));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({ recoverGoodsPaymentManually: mocks.recover }));
import { viewBankRefundAccount as viewBankRefundAccountAction } from '@/lib/admin/bank-transfer-refund-account.server';
import { loadBankRefundContextAction, readBankRefundAction, recordBankRefundAction } from './bank-transfer-refund-actions';

const identity = { actorId: 'b1910000-0000-4000-8000-000000000001', sessionId: 'b1910000-0000-4000-8000-000000000002',
  orderId: 'b1910000-0000-4000-8000-000000000003', claimId: 'b1910000-0000-4000-8000-000000000004' };
const other = 'b1910000-0000-4000-8000-000000000099';
const request: BankRefundRequest = { ...identity, version: 1, operationId: 'b1910000-0000-4000-8000-000000000005',
  revision: 7, amount: 12000, kind: 'complete_transfer', occurredAt: '2026-10-14T06:00:00.000Z', evidence: '합성 송금 증빙', note: '합성 운영 메모', confirmed: true };
const receipt: BankRefundReceipt = { operationId: request.operationId, actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId,
  kind: request.kind, revision: 7, resultRevision: 8, amount: 12000, state: 'recorded', createdAt: request.occurredAt };
const context: BankRefundContext = { actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId, claimType: 'return', revision: 7,
  amount: 12000, stage: 'processing', phase: 'awaiting_transfer', gift: true, filedAt: request.occurredAt, confirmedAt: request.occurredAt, transferredAt: null,
  confirmationNotBefore: request.occurredAt, transferNotBefore: request.occurredAt, maskedAccount: '123-****-789', maskedHolder: '김*성',
  confirmBlocker: 'bank_refund_already_confirmed', fileBlocker: 'bank_refund_already_filed', completeBlocker: null, viewBlocker: null };
const viewInput = { ...identity, viewId: other, revision: 7 };
const account = { viewId: other, actorId: identity.actorId, orderId: identity.orderId, claimId: identity.claimId, revision: 7,
  bankName: '합성은행', accountNumber: '123-4567-890', accountHolder: '합성예금주', viewedAt: request.occurredAt };
const identityArgs = { p_order_id: identity.orderId, p_claim_id: identity.claimId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ user: { id: identity.actorId } });
  mocks.create.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
afterEach(() => {
  expect(mocks.gateway).not.toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.recover).not.toHaveBeenCalled();
});

describe('bank refund action authorization and RPC contract', () => {
  const actions = [
    () => loadBankRefundContextAction(identity), () => recordBankRefundAction(request),
    () => readBankRefundAction(bankRefundMetadata(request)), () => viewBankRefundAccountAction(viewInput),
  ];
  it.each([null, { user: { id: other } }])('denies an absent or changed current actor before any RPC: %j', auth => {
    return (async () => {
      mocks.access.mockResolvedValue(auth);
      for (const action of actions) expect(await action()).toMatchObject({ authChanged: true });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.access).toHaveBeenCalledWith('/admin/sales/claims/cancels', { capability: 'sales.manage', adminOnly: true });
    })();
  });
  it('preserves login redirects without performing finance reads or writes', async () => {
    mocks.access.mockRejectedValue(new Error('NEXT_REDIRECT:/login'));
    await expect(recordBankRefundAction(request)).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed inputs before loading an account session', async () => {
    expect(await recordBankRefundAction({ ...request, confirmed: false })).toHaveProperty('error');
    expect(await readBankRefundAction({ ...bankRefundMetadata(request), evidence: 'must not persist' })).toMatchObject({ uncertain: true });
    expect(await viewBankRefundAccountAction({ ...viewInput, accountNumber: account.accountNumber })).toHaveProperty('error');
    expect(await loadBankRefundContextAction({ ...identity, sessionId: 'invalid' })).toHaveProperty('error');
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['confirm_cancellation', 'file_transfer', 'complete_transfer'] as const)('records %s only through the audited database operation', async kind => {
    mocks.rpc.mockResolvedValue({ data: { ...receipt, kind }, error: null });
    expect(await recordBankRefundAction({ ...request, kind })).toEqual({ receipt: { ...receipt, kind } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_bank_transfer_refund', { ...identityArgs, p_operation_id: request.operationId,
      p_kind: kind, p_expected_revision: 7, p_expected_amount: 12000, p_occurred_at: request.occurredAt,
      p_evidence: request.evidence, p_note: request.note, p_confirmed: true });
    for (const path of ['/admin/sales/claims/refund-transfers', `/orders/${identity.orderId}`, `/admin/sales/claims/returns/${identity.claimId}`, `/admin/sales/claims/cancels/${identity.claimId}`]) {
      expect(mocks.revalidate).toHaveBeenCalledWith(path);
    }
    expect(mocks.revalidate).toHaveBeenCalledWith('/gifts', 'layout');
  });
  it('passes the current session identity to the RPC and treats a revoked session as authority change', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'raw account secret' } });
    expect(await recordBankRefundAction(request)).toMatchObject({ authChanged: true });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject(identityArgs);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe('bank refund response binding and ambiguous outcomes', () => {
  it.each(['operationId', 'actorId', 'orderId', 'claimId', 'kind', 'revision', 'amount'] as const)('rejects a receipt for another %s without marking completion', async key => {
    const value = key === 'amount' || key === 'revision' ? 99 : key === 'kind' ? 'file_transfer' : other;
    mocks.rpc.mockResolvedValue({ data: { ...receipt, [key]: value }, error: null });
    expect(await recordBankRefundAction(request)).toMatchObject({ uncertain: true });
    expect(await readBankRefundAction(bankRefundMetadata(request))).toMatchObject({ uncertain: true });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...receipt, state: 'sealed', resultRevision: 7 }, { ...receipt, accountNumber: account.accountNumber }])('does not call an unconfirmed response successful: %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const result = await recordBankRefundAction(request);
    expect(result).toMatchObject({ uncertain: true });
    expect(JSON.stringify(result)).not.toContain(account.accountNumber);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('returns conflict for changed source and preserves unknown outcomes without leaking proof', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'claim_changed' } });
    expect(await recordBankRefundAction(request)).toMatchObject({ conflict: true });
    mocks.rpc.mockRejectedValue(new Error(`${account.accountNumber} ${request.evidence}`));
    const result = await recordBankRefundAction(request);
    expect(result).toMatchObject({ uncertain: true });
    expect(JSON.stringify(result)).not.toContain(account.accountNumber);
    expect(JSON.stringify(result)).not.toContain(request.evidence);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('keeps an already dispatched write uncertain if cache refresh fails', async () => {
    mocks.revalidate.mockImplementation(() => { throw new Error('refresh failed'); });
    expect(await recordBankRefundAction(request)).toMatchObject({ uncertain: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('reads only metadata and distinguishes missing, sealed and recorded receipts', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await readBankRefundAction(bankRefundMetadata(request))).toEqual({ receipt: null });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_read_bank_transfer_refund', { ...identityArgs,
      p_operation_id: request.operationId, p_kind: request.kind, p_expected_revision: 7, p_expected_amount: 12000, p_seal: false });
    expect(await readBankRefundAction(bankRefundMetadata(request), true)).toMatchObject({ uncertain: true });
    const sealed = { ...receipt, state: 'sealed', resultRevision: 7 };
    mocks.rpc.mockResolvedValue({ data: sealed, error: null });
    expect(await readBankRefundAction(bankRefundMetadata(request), true)).toEqual({ receipt: sealed });
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_evidence');
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_note');
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await readBankRefundAction(bankRefundMetadata(request))).toEqual({ receipt });
  });
});

describe('bank refund context and audited account view', () => {
  it('loads only the exact masked context for this actor and claim', async () => {
    mocks.rpc.mockResolvedValue({ data: context, error: null });
    expect(await loadBankRefundContextAction(identity)).toEqual({ context });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_bank_transfer_refund_context', identityArgs);
    for (const patch of [{ actorId: other }, { orderId: other }, { claimId: other }, { accountNumber: account.accountNumber }]) {
      mocks.rpc.mockResolvedValue({ data: { ...context, ...patch }, error: null });
      const result = await loadBankRefundContextAction(identity);
      expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('context');
      expect(JSON.stringify(result)).not.toContain(account.accountNumber);
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('returns raw account only from its audited view RPC with matching identity, view id and revision', async () => {
    mocks.rpc.mockResolvedValue({ data: account, error: null });
    expect(await viewBankRefundAccountAction(viewInput)).toEqual({ account });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_view_bank_transfer_refund_account', { ...identityArgs, p_view_id: other, p_expected_revision: 7 });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(['viewId', 'actorId', 'orderId', 'claimId', 'revision'] as const)('discards an account view with mismatched %s', async key => {
    mocks.rpc.mockResolvedValue({ data: { ...account, [key]: key === 'revision' ? 8 : request.operationId }, error: null });
    const result = await viewBankRefundAccountAction(viewInput);
    expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('account');
    expect(JSON.stringify(result)).not.toContain(account.accountNumber);
  });
  it('rejects a reused audited view id as a conflict without replaying raw data', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate view id' } });
    expect(await viewBankRefundAccountAction(viewInput)).toMatchObject({ conflict: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('never returns raw values from failed or malformed view responses', async () => {
    for (const response of [{ data: account, error: { code: 'XX000', message: account.accountNumber } }, { data: { ...account, evidence: request.evidence }, error: null }]) {
      mocks.rpc.mockResolvedValue(response);
      const result = await viewBankRefundAccountAction(viewInput);
      expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('account');
      expect(JSON.stringify(result)).not.toContain(account.accountNumber);
    }
    mocks.rpc.mockRejectedValue(new Error(account.accountHolder));
    expect(JSON.stringify(await viewBankRefundAccountAction(viewInput))).not.toContain(account.accountHolder);
  });
});
