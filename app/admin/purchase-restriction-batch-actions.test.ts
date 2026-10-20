import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executePurchaseRestrictionBatchAction, previewPurchaseRestrictionBatchAction, readPurchaseRestrictionBatchAction } from './purchase-restriction-batch-actions';
const mocks = vi.hoisted(() => ({ allowed: true, rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: async () => mocks.allowed }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = '00000000-0000-4000-8000-000000063521';
const completed = { id, mode: 'customer', reasonCode: 'other', reasonDetail: '확인된 근거', createdAt: '2026-10-12T00:00:00Z', expiresAt: '2026-10-12T00:15:00Z', completedAt: '2026-10-12T00:01:00Z', status: 'completed', canExecute: false, readyCount: 1, registeredCount: 1, skippedCount: 0, failedCount: 0,
 rows: [{ rowNumber: 1, input: 'c@example.test', userId: id, nickname: '고객', maskedEmail: 'c***@example.test', evidenceOrderId: null, status: 'ready', duplicateOf: null, restrictionId: id, outcome: 'registered', error: null, currentState: 'active', releasedAt: null }] };
beforeEach(() => { mocks.allowed = true; mocks.rpc.mockReset(); mocks.revalidate.mockReset(); });
describe('복수 구매제한 액션', () => {
  it('등록 후 별도 원장 조회 결과를 반환한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ignoredDispatchPayload: true }, error: null }).mockResolvedValueOnce({ data: completed, error: null });
    expect(await executePurchaseRestrictionBatchAction(id, true)).toEqual({ batch: completed });
    expect(mocks.rpc.mock.calls).toEqual([['admin_execute_purchase_restriction_batch', { p_batch_id: id, p_confirmed: true }], ['admin_get_purchase_restriction_batch', { p_batch_id: id }]]);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/purchase-restrictions');
  });
  it('등록 응답이나 후속 조회가 불확실하면 같은 요청 조회를 유지한다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await executePurchaseRestrictionBatchAction(id, true)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: completed, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'read failed' } });
    expect(await executePurchaseRestrictionBatchAction(id, true)).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: completed, error: null });
    expect(await readPurchaseRestrictionBatchAction(id)).toEqual({ batch: completed });
  });
  it('동의·권한·입력 검증은 RPC 전에 끝낸다', async () => {
    expect(await executePurchaseRestrictionBatchAction(id, false)).toHaveProperty('error');
    expect(await previewPurchaseRestrictionBatchAction(new FormData())).toHaveProperty('errors');
    mocks.allowed = false; expect(await readPurchaseRestrictionBatchAction(id)).toMatchObject({ error: expect.stringContaining('권한') });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('만료는 확인된 거부로, 알 수 없는 서버 오류는 결과 불확실로 분리한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'purchase_restriction_batch_expired' } });
    expect(await executePurchaseRestrictionBatchAction(id, true)).toMatchObject({ error: expect.stringContaining('15분'), uncertain: false });
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: 'private internal stack' } });
    const result = await executePurchaseRestrictionBatchAction(id, true); expect(result).toMatchObject({ uncertain: true }); expect(JSON.stringify(result)).not.toContain('private');
  });
});
