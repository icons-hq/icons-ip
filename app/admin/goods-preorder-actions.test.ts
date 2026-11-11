import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { saveGoodsPreorderAction, saveRandomGoodsPreordersAction, switchToStockSupplyAction, allocateGoodsPreordersAction, listGoodsPreorderReservationsAction } from './goods-preorder-actions';
const variant = '00000000-0000-4000-8000-000000000001';
const policy = '00000000-0000-4000-8000-000000000002';
const item = '00000000-0000-4000-8000-000000000003';
function form(state: string, evidence = '합성 공급 승인') {
  const data = new FormData(); data.set('goodId', 'g1'); data.set('variantId', variant); data.set('policyId', policy); data.set('revision', '1');
  data.set('policy', JSON.stringify({ state, capacityQty: 50, startsAt: '2099-09-10T09:00', endsAt: '2099-09-15T18:00', expectedShipDate: '2099-10-01', approvalReference: evidence }));
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
});
describe('preorder authority and actual stock inputs', () => {
  it('lets staff save drafts but blocks opening supply or returning to regular sales', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: policy, revision: 2, changed: true }, error: null });
    expect(await saveGoodsPreorderAction(form('draft', ''))).toMatchObject({ ok: true });
    mocks.rpc.mockClear();
    expect(await saveGoodsPreorderAction(form('active'))).toMatchObject({ ok: false });
    expect(await switchToStockSupplyAction('g1', variant, policy, 1)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('never fills in missing supply proof and sends observed policy revisions when activating', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'admin1' }, isStaff: true, role: 'admin' });
    expect(await saveGoodsPreorderAction(form('active', ''))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { id: policy, revision: 2, changed: true }, error: null });
    expect(await saveGoodsPreorderAction(form('active'))).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_goods_preorder', expect.objectContaining({
      p_good_id: 'g1', p_variant_id: variant, p_policy_id: policy, p_expected_revision: 1,
      p_values: expect.objectContaining({ capacityQty: 50, approvalReference: '합성 공급 승인', startsAt: '2099-09-10T00:00:00.000Z' }),
    }));
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

it('configured influencer can request reservation history but cannot allocate or open supply', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'influencer' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture('influencer') });
  mocks.rpc.mockResolvedValue({ data: { items: [], total: 0, hasMore: false }, error: null });
  await listGoodsPreorderReservationsAction('g1');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_list_goods_preorder_reservations', expect.anything());
  mocks.rpc.mockClear();
  expect(await allocateGoodsPreordersAction('g1', { orderItemIds: [item], expectedStock: { [variant]: 3 } }, '입고')).toMatchObject({ ok: false });
  expect(await saveGoodsPreorderAction(form('active'))).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('configured deputy cannot load reservation orders through the product page', async () => {
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'deputy' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture('deputy') });
  expect(await listGoodsPreorderReservationsAction('g1')).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

describe('랜덤 판매 일괄 예약', () => {
  const second = '00000000-0000-4000-8000-000000000004';
  const values = { startsAt: '2099-11-20T10:00', endsAt: '2099-11-27T23:59', expectedShipDate: '2099-12-20', approvalReference: '홍실 2차 승인' };
  const options = [
    { variantId: variant, policyId: null, expectedRevision: null, capacityQty: '30' },
    { variantId: second, policyId: null, expectedRevision: null, capacityQty: '20' },
  ];
  it('운영자는 초안만 저장하고, 활성화·일반 재고 전환은 관리자에게만 보낸다', async () => {
    mocks.rpc.mockResolvedValue({ data: { goodId: 'g1', state: 'draft', results: [{}, {}] }, error: null });
    expect(await saveRandomGoodsPreordersAction('g1', 'draft', values, options)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_random_goods_preorders', {
      p_good_id: 'g1', p_state: 'draft',
      p_values: { startsAt: '2099-11-20T01:00:00.000Z', endsAt: '2099-11-27T14:59:00.000Z', expectedShipDate: '2099-12-20', approvalReference: '홍실 2차 승인' },
      p_options: [
        { variantId: variant, policyId: null, expectedRevision: null, capacityQty: 30 },
        { variantId: second, policyId: null, expectedRevision: null, capacityQty: 20 },
      ],
    });
    mocks.rpc.mockClear();
    expect(await saveRandomGoodsPreordersAction('g1', 'active', values, options)).toMatchObject({ ok: false });
    expect(await saveRandomGoodsPreordersAction('g1', 'stock', null, [{ variantId: variant, policyId: policy, expectedRevision: 3 }])).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
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
