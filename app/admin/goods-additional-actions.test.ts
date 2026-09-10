import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readGoodsAdditionalAction, searchGoodsAdditionalAction, saveGoodsAdditionalAction } from './goods-additional-actions';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff1' }, isStaff: true, role: 'staff' });
});
describe('additional goods staff actions', () => {
  it('requires current staff permission on every read and write', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'user1' }, isStaff: false, role: 'user' });
    expect(await readGoodsAdditionalAction('g1')).toMatchObject({ ok: false });
    expect(await searchGoodsAdditionalAction('g1', '상품')).toMatchObject({ ok: false });
    expect(await saveGoodsAdditionalAction('g1', ['g2'], null)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('sends the observed revision and ordered identities without introducing price overrides', async () => {
    mocks.rpc.mockResolvedValue({ data: { revision: 4, changed: true }, error: null });
    expect(await saveGoodsAdditionalAction('g1', ['g3', 'g2'], 3)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_additional', {
      p_good_id: 'g1', p_target_good_ids: ['g3', 'g2'], p_expected_revision: 3,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop/g1');
  });
  it('rejects self references before a request and reports conflicts without successful invalidation', async () => {
    expect(await saveGoodsAdditionalAction('g1', ['g1'], null)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'additional_goods_changed' } });
    expect(await saveGoodsAdditionalAction('g1', [], 1)).toMatchObject({ ok: false, error: expect.stringContaining('변경') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
