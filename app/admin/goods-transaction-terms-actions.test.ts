import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readGoodsTransactionTermsAction, saveGoodsTransactionTermsAction } from './goods-transaction-terms-actions';
import type { GoodsTermsRequest } from '@/lib/admin/goods-transaction-terms';
const actor = '91000000-0000-4000-8000-000000000001', operation = '91000000-0000-4000-8000-000000000002', policy = '91000000-0000-4000-8000-000000000003';
const request: GoodsTermsRequest = { goodId: 'term-good', expectedActorId: actor, expectedRevision: 0, expectedGoodUpdatedAt: '2026-10-14T01:00:00.123456Z', operationId: operation,
  volume: { status: 'draft', terms: null, draftValues: { threshold: '3' } }, delivery: null };
const terms = { goodId: request.goodId, goodUpdatedAt: '2026-10-14T01:00:01.123456Z', revision: 1,
  volume: { ...request.volume, id: policy, goodId: request.goodId, revision: 1 }, delivery: null };
const receipt = { ...terms, operationId: operation, changed: true };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: actor } }); mocks.rpc.mockImplementation(async name => ({ data: name === 'admin_save_good_transaction_terms' ? receipt : terms, error: null })); });
describe('할인·배송 정책 저장 경계', () => {
  it('현재 actor·catalog.manage를 확인하고 원자 저장 후 다시 읽어 대조한다', async () => {
    expect(await saveGoodsTransactionTermsAction(request)).toEqual({ ok: true, value: terms });
    expect(mocks.access).toHaveBeenCalledTimes(2); expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/goods', { capability: 'catalog.manage' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_good_transaction_terms', { p_good_id: request.goodId, p_expected_actor_id: actor, p_expected_revision: 0,
      p_expected_good_updated_at: request.expectedGoodUpdatedAt, p_volume: request.volume, p_delivery: null, p_operation_id: operation });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_get_good_transaction_terms', { p_good_id: request.goodId }); expect(mocks.revalidate).toHaveBeenCalledOnce();
  });
  it.each([null, { user: { id: operation } }])('현재 actor가 다르면 RPC를 부르지 않는다: %j', async access => {
    mocks.access.mockResolvedValue(access); expect((await saveGoodsTransactionTermsAction(request)).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['PGRST000', '57014', 'XX000', ''])('원격 write 오류 %s는 불명확이며 원요청을 보존한다', async code => {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'fetch failed' } }); expect(await saveGoodsTransactionTermsAction(request)).toMatchObject({ ok: false, uncertain: true });
  });
  it.each(['22023', '42501', '23514', 'PT409', '23505'])('확정 DB 거절 %s는 새로 비교할 수 있다', async code => {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'goods_transaction_terms_changed' } }); expect(await saveGoodsTransactionTermsAction(request)).toMatchObject({ ok: false, uncertain: false }); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('동일 저장의 재생은 changed=false일 때 같은 revision을 허용한다', async () => {
    const repeated = { ...request, expectedRevision: 1, expectedGoodUpdatedAt: terms.goodUpdatedAt };
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, changed: false }, error: null }); expect((await saveGoodsTransactionTermsAction(repeated)).ok).toBe(true);
  });
  it('잘못된 receipt ID·내용·revision을 성공으로 표시하지 않는다', async () => {
    for (const changed of [{ operationId: actor }, { revision: 9 }, { goodId: 'other' }, { volume: null }]) {
      mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, ...changed }, error: null }); expect(await saveGoodsTransactionTermsAction(request)).toMatchObject({ ok: false, uncertain: true });
    }
  });
  it('저장 이후 다른 관리자의 변경은 committed와 최신 내용을 함께 반환한다', async () => {
    const latest = { ...terms, revision: 2 }; mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockResolvedValueOnce({ data: latest, error: null });
    expect(await saveGoodsTransactionTermsAction(request)).toMatchObject({ ok: false, committed: receipt, latest, conflict: true });
  });
  it('readback 실패·권한 전환은 저장 실패로 오인하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockRejectedValueOnce(new Error('lost'));
    expect(await saveGoodsTransactionTermsAction(request)).toMatchObject({ ok: false, committed: receipt });
    mocks.access.mockResolvedValueOnce({ user: { id: actor } }).mockResolvedValueOnce(null);
    expect(await saveGoodsTransactionTermsAction(request)).toMatchObject({ ok: false, committed: receipt });
  });
  it('다른 상품 읽기와 잘못된 입력을 거절한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...terms, goodId: 'other' }, error: null }); expect((await readGoodsTransactionTermsAction(request)).ok).toBe(false);
    mocks.rpc.mockClear(); expect((await saveGoodsTransactionTermsAction({ ...request, expectedRevision: -1 })).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('키 순서·동일 시각 offset 차이는 readback 불일치가 아니다', async () => {
    const reordered = Object.fromEntries(Object.entries(terms).reverse()); reordered.goodUpdatedAt = '2026-10-14T10:00:01.123456+09:00';
    mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null }).mockResolvedValueOnce({ data: reordered, error: null }); expect((await saveGoodsTransactionTermsAction(request)).ok).toBe(true);
  });
});
