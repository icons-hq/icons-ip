import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.refresh }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));
import { GOODS_BULK_UNCERTAIN, goodsBulkError } from '@/lib/admin/goods-bulk';
import { previewGoodsBulkAction, commitGoodsBulkAction, readGoodsBulkAction } from './goods-bulk-actions';
const id = 'b9000000-0000-4000-8000-000000000003', identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const request = { kind: 'goods', ids: ['good-a'], command: 'stop', values: {} };
const receipt = { state: 'completed', operationId: id, goodsCount: 1, groupsCount: 0, error: null };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: identity.actorId } }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('현재 권한과 계정 불일치에서는 DB 호출을 막는다', async () => {
  mocks.access.mockResolvedValue(null); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('authChanged', true);
  mocks.access.mockResolvedValue({ user: { id: identity.sessionId } }); expect(await readGoodsBulkAction(id, identity)).toHaveProperty('authChanged', true);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('무효한 입력·비공개 필드는 미리보기 전 거절한다', async () => {
  expect(await previewGoodsBulkAction(id, { ...request, values: { stock: 0 } }, identity)).toHaveProperty('error');
  expect(await commitGoodsBulkAction(id, { ...identity, role: 'admin' })).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('확정은 동결된 요청번호와 현재 identity만 전달한다', async () => {
  expect(await commitGoodsBulkAction(id, identity)).toEqual({ value: receipt });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_commit_goods_bulk', { p_id: id, p_actor: identity.actorId, p_session: identity.sessionId });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('응답 유실 뒤 조회와 종료는 재실행하지 않는다', async () => {
  mocks.rpc.mockRejectedValueOnce(new Error('network')); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('uncertain', true);
  expect(await readGoodsBulkAction(id, identity)).toEqual({ value: receipt }); await readGoodsBulkAction(id, identity, true);
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['admin_commit_goods_bulk', 'admin_read_goods_bulk', 'admin_read_goods_bulk']);
  expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_seal: true });
});
it('다른 요청번호의 성공 응답을 완료로 표시하지 않는다', async () => {
  mocks.rpc.mockResolvedValue({ data: { ...receipt, operationId: identity.actorId }, error: null }); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('uncertain', true); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('권한 변경 오류와 확정 거절을 구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'goods_group_auth_changed' } }); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('authChanged', true);
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, state: 'rejected', goodsCount: 0, error: 'goods_bulk_changed' } });
  expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('value.state', 'rejected'); expect(mocks.refresh).not.toHaveBeenCalled();
});
/* D5② 일괄 변경·목록 바로 수정이 랜덤 판매 상품의 조건을 깨면 RPC 커밋에서 random_option_*로 거절된다. 일반 실패 대신 이유를 알린다. */
it('랜덤 판매 조건 거절은 일괄 변경 일반 실패 대신 이유를 알린다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'random_option_price_mismatch' } });
  expect(await commitGoodsBulkAction(id, identity)).toMatchObject({ authChanged: false, uncertain: false,
    error: '랜덤 판매 상품은 판매 중인 모든 옵션의 판매가와 기간 할인이 같아야 합니다. 기간 할인은 모든 옵션에 한 번에 넣으세요.' });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'random_option_count' } });
  expect(await previewGoodsBulkAction(id, request, identity)).toMatchObject({ error: '판매 중인 옵션이 2개 이상이어야 랜덤 판매를 쓸 수 있습니다.' });
  expect(mocks.refresh).not.toHaveBeenCalled();
});
/* D4(20261126120000): 미리보기가 상품마다 건너뛸 이유를 싣고, 저장 영수증이 건너뛴 상품을 싣는다. 액션은 그대로 넘긴다. */
it('건너뛸 상품이 섞인 미리보기와 영수증을 그대로 넘긴다', async () => {
  const row = { id: 'good-a', name: '상품 A', code: 'A', price: 1000, nextPrice: 1000, priceMin: 1000, priceMax: 1000, nextMin: 1000, nextMax: 1000,
    published: false, archived: true, stopped: false, skip: 'good_archived', discounts: null, stock: 'ok', saleStartsAt: null, saleEndsAt: null };
  mocks.rpc.mockResolvedValueOnce({ data: { state: 'ready', operationId: id, request, groups: [], goods: [row], expiresAt: '2026-11-26T00:15:00+00:00' }, error: null });
  expect(await previewGoodsBulkAction(id, request, identity)).toMatchObject({ value: { goods: [{ id: 'good-a', skip: 'good_archived', stock: 'ok' }] } });
  const skipped = [{ id: 'good-b', name: '상품 B', code: null, reason: 'goods_bulk_already_stopped' }];
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, skipped }, error: null });
  expect(await commitGoodsBulkAction(id, identity)).toEqual({ value: { ...receipt, skipped } });
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, state: 'rejected', goodsCount: 0, error: 'goods_bulk_all_skipped' }, error: null });
  expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('value.error', 'goods_bulk_all_skipped');
});
/* 리뷰 6: 기간 할인 걸기는 DB가 상품마다의 이유 없이 미리보기부터 거절한다. 미리보기는 명령을 알므로 그 명령에서 건너뛰는 이유를 모두 말한다. */
it('기간 할인을 걸 상품이 하나도 없으면 건너뛰는 이유 넷을 모두 말하고, 다른 명령에는 할인 이야기를 하지 않는다', async () => {
  const all = { code: '23514', message: 'goods_bulk_all_skipped' };
  const discount = { kind: 'goods', ids: ['good-a'], command: 'discount', values: { mode: 'amount', value: 500, startsAt: '2026-12-01T01:00:00.000Z', endsAt: '2026-12-07T14:59:00.000Z' } };
  mocks.rpc.mockResolvedValueOnce({ data: null, error: all });
  const result = await previewGoodsBulkAction(id, discount, identity);
  expect(result).toMatchObject({ error: goodsBulkError('goods_bulk_all_skipped', 'discount'), authChanged: false, uncertain: false });
  for (const reason of ['기간이 겹치는 할인', '기간 없는 즉시할인', '사용 중인 옵션이 없는', '할인가가 1원 미만']) expect('error' in result ? result.error : '', reason).toContain(reason);
  mocks.rpc.mockResolvedValueOnce({ data: null, error: all });
  expect(await previewGoodsBulkAction(id, { ...discount, command: 'discount_stop', values: {} }, identity)).toMatchObject({ error: '멈출 기간 할인이 없습니다. 고른 상품은 보관됐거나, 진행 중이거나 예정된 기간 할인이 없습니다.' });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: all });
  expect(await previewGoodsBulkAction(id, request, identity)).toMatchObject({ error: '바꿀 수 있는 상품이 없습니다. 상품의 지금 상태를 확인한 뒤 다시 해주세요.' });
});
/* B-09: 오류는 무엇이 문제인지와 다음에 할 일을 함께 말한다. 결과를 모를 때는 어드민 공통 문장을 쓴다. */
it('오류 문구는 고칠 방법까지 말하고, 결과를 모르면 [저장됐는지 확인]으로 보낸다', async () => {
  expect(await previewGoodsBulkAction(id, { ...request, values: { stock: 0 } }, identity)).toEqual({ error: '바꿀 내용의 형식이 맞지 않습니다. 새로고침한 뒤 상품을 다시 골라주세요.' });
  expect(await commitGoodsBulkAction('not-an-id', identity)).toEqual({ error: '저장할 변경을 찾지 못했습니다. 새로고침한 뒤 처음부터 다시 해주세요.', uncertain: true });
  mocks.access.mockResolvedValueOnce(null);
  expect(await previewGoodsBulkAction(id, request, identity)).toMatchObject({ error: goodsBulkError('operator_capability_required'), authChanged: true });
  mocks.rpc.mockRejectedValueOnce(new Error('network'));
  expect(await commitGoodsBulkAction(id, identity)).toEqual({ error: GOODS_BULK_UNCERTAIN, uncertain: true });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'goods_bulk_busy' } });
  expect(await previewGoodsBulkAction(id, request, identity)).toMatchObject({ error: '같은 상품을 다른 사람이 저장하고 있습니다. 잠시 뒤 다시 해주세요.' });
  expect(mocks.refresh).not.toHaveBeenCalled();
});
