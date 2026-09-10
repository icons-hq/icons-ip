import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: vi.fn() }));
import { saveGoodsPricePeriodAction } from './goods-price-period-actions';

function form(period: Record<string, unknown>) {
  const data = new FormData();
  data.set('goodId', 'g1'); data.set('variantId', '00000000-0000-4000-8000-000000000001');
  data.set('period', JSON.stringify(period));
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff1' }, isStaff: true });
});
describe('admin price-period action', () => {
  it('keeps unconfigured draft values and maps activation to the staff SQL seam', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'new-id', revision: 1 }, error: null });
    expect(await saveGoodsPricePeriodAction(form({ state: 'draft', discountPrice: '', startsAt: '', endsAt: '' })))
      .toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_price_period', {
      p_good_id: 'g1', p_variant_id: '00000000-0000-4000-8000-000000000001', p_period_id: null,
      p_period: { state: 'draft', discountPrice: null, startsAt: null, endsAt: null }, p_expected_revision: null,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/cart');
  });
  it('rejects missing activation details and users before any mutation', async () => {
    expect(await saveGoodsPricePeriodAction(form({ state: 'active', discountPrice: '', startsAt: '', endsAt: '' })))
      .toMatchObject({ ok: false });
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user1' }, isStaff: false });
    expect(await saveGoodsPricePeriodAction(form({ state: 'draft', discountPrice: '', startsAt: '', endsAt: '' })))
      .toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('surfaces a concurrent-revision conflict and preserves the server price', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'price_period_changed' } });
    const data = form({ state: 'active', discountPrice: 8000, startsAt: '2026-09-10T12:00', endsAt: '2026-09-11T12:00' });
    data.set('periodId', '00000000-0000-4000-8000-000000000002'); data.set('revision', '1');
    expect(await saveGoodsPricePeriodAction(data)).toMatchObject({ ok: false, error: expect.stringContaining('변경') });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
