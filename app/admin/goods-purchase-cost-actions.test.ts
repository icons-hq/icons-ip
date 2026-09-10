import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { listGoodsPurchaseCostsAction, saveGoodsPurchaseCostAction, listGoodsPurchaseCostHistoryAction } from './goods-purchase-cost-actions';
const variantId = '00000000-0000-4000-8000-000000000001';
function form(amount: string, basis: string, revision = '') {
  const data = new FormData();
  data.set('goodId', 'g1'); data.set('variantId', variantId); data.set('unitCostKrw', amount);
  data.set('taxBasis', basis); data.set('expectedRevision', revision);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'admin1' }, isStaff: true, role: 'admin' });
});
describe('purchase cost admin boundary', () => {
  it('blocks staff for read, history and write before making a database request', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
    expect(await listGoodsPurchaseCostsAction('g1')).toMatchObject({ ok: false });
    expect(await listGoodsPurchaseCostHistoryAction('g1', variantId)).toMatchObject({ ok: false });
    expect(await saveGoodsPurchaseCostAction(form('0', 'included'))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('writes an explicit zero and tax choice without changing selling prices or public caches', async () => {
    mocks.rpc.mockResolvedValue({ data: { revision: 1, changed: true }, error: null });
    expect(await saveGoodsPurchaseCostAction(form('0', 'excluded'))).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_variant_purchase_cost', {
      p_good_id: 'g1', p_variant_id: variantId, p_unit_cost_krw: 0, p_tax_basis: 'excluded', p_expected_revision: null,
    });
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith('/admin/catalog/goods');
  });
  it('requires a complete pair and sends the observed revision when clearing', async () => {
    expect(await saveGoodsPurchaseCostAction(form('900', ''))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { revision: 3, changed: true }, error: null });
    expect(await saveGoodsPurchaseCostAction(form('', '', '2'))).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_goods_variant_purchase_cost', {
      p_good_id: 'g1', p_variant_id: variantId, p_unit_cost_krw: null, p_tax_basis: null, p_expected_revision: 2,
    });
  });
  it('shows a PT409 conflict without claiming a completed save', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'goods_purchase_cost_changed' } });
    expect(await saveGoodsPurchaseCostAction(form('900', 'included', '1'))).toMatchObject({ ok: false, error: expect.stringContaining('변경') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
