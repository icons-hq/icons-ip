import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), goodRow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
/* 예약 조건 조회는 상품의 저장된 판매기간도 함께 읽는다(goods.sale_starts_at). */
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc,
  from: (table: string) => ({ select: (columns: string) => ({ eq: (column: string, value: string) => ({ maybeSingle: () => mocks.goodRow(table, columns, column, value) }) }) }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import {
  saveGoodsPreorderAction, saveGoodsPreordersBulkAction, saveRandomGoodsPreordersAction, switchToStockSupplyAction, allocateGoodsPreordersAction, listGoodsPreorderReservationsAction,
  listGoodsPreordersAction,
} from './goods-preorder-actions';
const variant = '00000000-0000-4000-8000-000000000001';
const policy = '00000000-0000-4000-8000-000000000002';
const item = '00000000-0000-4000-8000-000000000003';
/* 2026-11-19: 예약판매는 저장하면 적용된다(새 정책, policyId 없음). 중지는 선택된 정책과 revision을 보낸다. */
function form(state: string, extra: Record<string, unknown> = {}) {
  const data = new FormData(); data.set('goodId', 'g1'); data.set('variantId', variant);
  data.set('policyId', state === 'stopped' ? policy : ''); data.set('revision', state === 'stopped' ? '1' : '');
  data.set('policy', JSON.stringify(state === 'stopped' ? { state } : { state, capacityQty: 50, startsAt: '2099-09-10T09:00', endsAt: '2099-09-15T18:00', expectedShipDate: '2099-10-01', ...extra }));
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
});
describe('preorder authority and actual stock inputs', () => {
  it('lets any catalog manager (staff included) save a preorder — saving applies it — and switch to regular stock', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture('staff'), isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
    mocks.rpc.mockResolvedValue({ data: { id: policy, revision: 1, changed: true }, error: null });
    expect(await saveGoodsPreorderAction(form('active'))).toMatchObject({ ok: true, message: expect.stringContaining('예약판매를 저장했습니다') });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_goods_preorder', expect.objectContaining({
      p_good_id: 'g1', p_variant_id: variant, p_policy_id: null, p_expected_revision: null,
      p_values: expect.objectContaining({ state: 'active', capacityQty: 50, approvalReference: null, startsAt: '2099-09-10T00:00:00.000Z' }),
    }));
    mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await switchToStockSupplyAction('g1', variant, policy, 1)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_use_stock_supply', { p_good_id: 'g1', p_variant_id: variant, p_expected_policy_id: policy, p_expected_revision: 1 });
  });
  it('rejects drafts and missing quantity or dates before calling the database', async () => {
    expect(await saveGoodsPreorderAction(form('draft'))).toMatchObject({ ok: false });
    expect(await saveGoodsPreorderAction(form('active', { capacityQty: '' }))).toMatchObject({ ok: false });
    expect(await saveGoodsPreorderAction(form('active', { endsAt: '' }))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { id: policy, revision: 2, changed: true }, error: null });
    expect(await saveGoodsPreorderAction(form('stopped'))).toMatchObject({ ok: true, message: expect.stringContaining('중지') });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_goods_preorder', expect.objectContaining({ p_policy_id: policy, p_expected_revision: 1 }));
  });
  it('binds allocation to exact order items, observed real stock and the receipt reference', async () => {
    mocks.rpc.mockResolvedValue({ data: { allocatedItems: 1, alreadyAllocatedItems: 0 }, error: null });
    expect(await allocateGoodsPreordersAction('g1', { orderItemIds: [item], expectedStock: { [variant]: 3 } }, '입고 증빙 1')).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_allocate_goods_preorders', {
      p_good_id: 'g1', p_order_item_ids: [item], p_expected_stock: { [variant]: 3 }, p_receipt_reference: '입고 증빙 1',
    });
    mocks.rpc.mockClear();
    expect(await allocateGoodsPreordersAction('g1', { orderItemIds: [item], expectedStock: { [variant]: 3 } }, '')).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

it('configured influencer can request reservation history and (with catalog.manage) save preorders, but cannot allocate stock', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'influencer' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture('influencer') });
  mocks.rpc.mockResolvedValue({ data: { items: [], total: 0, hasMore: false }, error: null });
  await listGoodsPreorderReservationsAction('g1');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_list_goods_preorder_reservations', expect.anything());
  mocks.rpc.mockClear();
  expect(await allocateGoodsPreordersAction('g1', { orderItemIds: [item], expectedStock: { [variant]: 3 } }, '입고')).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: { id: policy, revision: 1, changed: true }, error: null });
  expect(await saveGoodsPreorderAction(form('active'))).toMatchObject({ ok: true });
});
it('logistics operator without catalog.manage cannot save preorders or switch supply', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'logistics' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture('logistics') });
  expect(await saveGoodsPreorderAction(form('active'))).toMatchObject({ ok: false });
  expect(await switchToStockSupplyAction('g1', variant, policy, 1)).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('configured deputy cannot load reservation orders through the product page', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'deputy' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture('deputy') });
  expect(await listGoodsPreorderReservationsAction('g1')).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

describe('랜덤 판매 일괄 예약', () => {
  const second = '00000000-0000-4000-8000-000000000004';
  const values = { startsAt: '2099-11-20T10:00', endsAt: '2099-11-27T23:59', expectedShipDate: '2099-12-20' };
  const options = [
    { variantId: variant, policyId: null, expectedRevision: null, capacityQty: '30' },
    { variantId: second, policyId: null, expectedRevision: null, capacityQty: '20' },
  ];
  it('상품 관리 운영자는 모든 옵션 예약을 바로 적용하고 일반 재고로 돌린다(초안은 보내지 않는다)', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture('staff'), isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
    expect(await saveRandomGoodsPreordersAction('g1', 'draft', values, options)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { goodId: 'g1', state: 'active', results: [{}, {}] }, error: null });
    expect(await saveRandomGoodsPreordersAction('g1', 'active', values, options)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_random_goods_preorders', {
      p_good_id: 'g1', p_state: 'active',
      p_values: { startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20', approvalReference: null },
      p_options: [
        { variantId: variant, policyId: null, expectedRevision: null, capacityQty: 30 },
        { variantId: second, policyId: null, expectedRevision: null, capacityQty: 20 },
      ],
    });
    mocks.rpc.mockResolvedValue({ data: { goodId: 'g1', state: 'stock', results: [{}] }, error: null });
    expect(await saveRandomGoodsPreordersAction('g1', 'stock', null, [{ variantId: variant, policyId: policy, expectedRevision: 3 }])).toMatchObject({ ok: true });
  });
  it('관리자 활성화는 결과 수가 옵션 수와 같아야 성공으로 본다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'admin1' }, isStaff: true, role: 'admin' });
    mocks.rpc.mockResolvedValue({ data: { goodId: 'g1', state: 'active', results: [{}] }, error: null });
    expect(await saveRandomGoodsPreordersAction('g1', 'active', values, options)).toMatchObject({ ok: false });
    mocks.rpc.mockResolvedValue({ data: { goodId: 'g1', state: 'active', results: [{}, {}] }, error: null });
    expect(await saveRandomGoodsPreordersAction('g1', 'active', values, options)).toMatchObject({ ok: true });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'random_option_preorder_mismatch' } });
    const rejected = await saveRandomGoodsPreordersAction('g1', 'active', values, options);
    expect(rejected).toMatchObject({ ok: false });
    expect(!rejected.ok && rejected.error).toContain('발송 예정일');
  });
  it('물량이 빠진 활성화는 보내지 않는다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'admin1' }, isStaff: true, role: 'admin' });
    expect(await saveRandomGoodsPreordersAction('g1', 'active', values, [options[0], { ...options[1], capacityQty: '' }])).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/* 규칙 5: 판매기간과 예약판매는 함께 저장할 수 없다. 패널이 저장된 판매기간을 알아야 예약 저장 버튼을 먼저 막는다. */
describe('예약 조건 조회', () => {
  it('예약 조건과 함께 지금 저장된 판매기간이 있는지 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.goodRow.mockResolvedValue({ data: { sale_starts_at: '2026-12-01T00:00:00Z' }, error: null });
    expect(await listGoodsPreordersAction('g1')).toEqual({ ok: true, policies: [], salePeriodSaved: true });
    expect(mocks.goodRow).toHaveBeenCalledWith('goods', 'sale_starts_at', 'id', 'g1');
    mocks.goodRow.mockResolvedValue({ data: { sale_starts_at: null }, error: null });
    expect(await listGoodsPreordersAction('g1')).toEqual({ ok: true, policies: [], salePeriodSaved: false });
  });
  it('판매기간을 읽지 못하면 모르는 채로 열지 않고 불러오기 실패로 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.goodRow.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const failed = await listGoodsPreordersAction('g1');
    expect(failed).toMatchObject({ ok: false });
    expect(!failed.ok && failed.error).toContain('[저장된 예약 조건 새로고침]');
    mocks.goodRow.mockResolvedValue({ data: null, error: null });
    expect(await listGoodsPreordersAction('g1')).toMatchObject({ ok: false });
  });
});

/* 규칙 6: 옵션 선택 판매 상품도 여러 옵션의 예약을 한 번에 저장한다. 이미 예약판매 중인 옵션은 DB가 건너뛰고 알려 준다. */
describe('옵션 선택 판매 일괄 예약', () => {
  const second = '00000000-0000-4000-8000-000000000004';
  const row = { capacityQty: '30', startsAt: '2099-11-20T10:00', endsAt: '2099-11-27T23:59', expectedShipDate: '2099-12-20' };
  const options = [{ variantId: variant, ...row }, { variantId: second, ...row, capacityQty: '20' }];
  it('옵션마다 물량·일정을 실어 한 번에 저장하고, 저장한 옵션과 건너뛴 옵션을 돌려준다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture('staff'), isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
    mocks.rpc.mockResolvedValue({ data: { goodId: 'g1', saved: [{ variantId: second, id: policy, revision: 1, changed: true }],
      skipped: [{ variantId: variant, policyId: policy, reason: 'preorder_policy_already_active' }] }, error: null });
    expect(await saveGoodsPreordersBulkAction('g1', options)).toEqual({ ok: true, savedVariantIds: [second], skippedVariantIds: [variant] });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_goods_preorders_bulk', { p_good_id: 'g1', p_options: [
      { variantId: variant, values: { capacityQty: 30, startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20' } },
      { variantId: second, values: { capacityQty: 20, startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20' } },
    ] });
    expect(mocks.revalidate).toHaveBeenCalled();
  });
  it('빈 물량·같은 옵션 두 번은 DB를 부르지 않고, 결과가 요청한 옵션과 맞지 않으면 성공으로 보지 않는다', async () => {
    expect(await saveGoodsPreordersBulkAction('g1', [options[0], { ...options[1], capacityQty: '' }])).toMatchObject({ ok: false });
    expect(await saveGoodsPreordersBulkAction('g1', [options[0], options[0]])).toMatchObject({ ok: false });
    expect(await saveGoodsPreordersBulkAction('', options)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const data of [{ goodId: 'g1', saved: [{ variantId: variant }], skipped: [] }, { goodId: 'g1', saved: [{ variantId: variant }, { variantId: variant }], skipped: [] },
      { goodId: 'other', saved: [{ variantId: variant }, { variantId: second }], skipped: [] }, { goodId: 'g1', saved: [{ variantId: variant }], skipped: [{ variantId: policy }] }, null]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const unknown = await saveGoodsPreordersBulkAction('g1', options);
      expect(unknown).toMatchObject({ ok: false });
      expect(!unknown.ok && unknown.error).toContain('[저장된 예약 조건 새로고침]');
    }
  });
  it('판매기간이 저장된 상품의 거절은 먼저 할 일을 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'goods_sale_period_preorder_conflict' } });
    const rejected = await saveGoodsPreordersBulkAction('g1', options);
    expect(!rejected.ok && rejected.error).toContain('상품을 먼저 저장');
  });
  it('상품 관리 권한이 없는 운영자는 저장하지 못한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'logistics' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture('logistics') });
    expect(await saveGoodsPreordersBulkAction('g1', options)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
