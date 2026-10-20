import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate, updateTag: mocks.updateTag }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { saveStorePresentationAction, saveGoodsListingColorsAction, loadGoodsListingColorsAction } from './store-presentation-actions';
import { DEFAULT_STORE_PRESENTATION, STORE_PRESENTATION_CACHE_TAG, STORE_PRESENTATION_PATH } from '@/lib/store-presentation';
const op = '87000000-0000-4000-8000-000000000301';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: op } }); });
describe('presentation writes', () => {
  it('requires the explicit capability and validates before touching the database', async () => {
    mocks.access.mockResolvedValue(null); expect(await saveStorePresentationAction('common', DEFAULT_STORE_PRESENTATION.common, 0, op)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({ user: { id: op } }); expect(await saveStorePresentationAction('common', { invalid: true }, 0, op)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenLastCalledWith(STORE_PRESENTATION_PATH, { capability: 'store.manage' });
  });
  it('preserves operation and revision identity and invalidates public settings only after receipt validation', async () => {
    mocks.rpc.mockResolvedValue({ data: { section: 'common', values: DEFAULT_STORE_PRESENTATION.common, revision: 2 }, error: null });
    expect(await saveStorePresentationAction('common', DEFAULT_STORE_PRESENTATION.common, 1, op)).toHaveProperty('revision', 2);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_presentation', { p_section: 'common', p_values: DEFAULT_STORE_PRESENTATION.common, p_expected_revision: 1, p_operation_id: op });
    expect(mocks.updateTag).toHaveBeenCalledWith(STORE_PRESENTATION_CACHE_TAG);
    mocks.updateTag.mockClear(); mocks.rpc.mockResolvedValue({ data: { section: 'common', values: DEFAULT_STORE_PRESENTATION.common, revision: 99 } });
    expect(await saveStorePresentationAction('common', DEFAULT_STORE_PRESENTATION.common, 1, op)).toHaveProperty('uncertain', true); expect(mocks.updateTag).not.toHaveBeenCalled();
  });
  it('distinguishes conflicts from uncertain writes and protects independent color authority', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await saveStorePresentationAction('common', DEFAULT_STORE_PRESENTATION.common, 0, op)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValue(new Error('network')); expect(await saveStorePresentationAction('common', DEFAULT_STORE_PRESENTATION.common, 0, op)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValue({ data: { colors: [], revision: 1 } }); expect(await saveGoodsListingColorsAction('good', [], 0, op)).toEqual({ colors: [], revision: 1 });
    expect(mocks.access).toHaveBeenLastCalledWith('/admin/catalog/goods', { capability: 'catalog.manage' });
    expect(await loadGoodsListingColorsAction('good')).toEqual({ colors: [], revision: 1 });
  });
});
