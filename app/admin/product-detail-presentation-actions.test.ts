import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { saveDetailPresentationAction } from './product-detail-presentation-actions';
import { DEFAULT_DETAIL_PRESENTATION } from '@/lib/product-detail-presentation';
const operation = '91000000-0000-4000-8000-000000001001';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'actor' } }); });
describe('save detail presentation action', () => {
  it('checks authority and inputs before invoking the database', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveDetailPresentationAction('modules', DEFAULT_DETAIL_PRESENTATION.modules, 0, operation)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.access.mockResolvedValue({});
    await saveDetailPresentationAction('banner', { ...DEFAULT_DETAIL_PRESENTATION.banner, enabled: true }, 0, operation);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('invalidates only after a matching saved receipt', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { section: 'modules', values: DEFAULT_DETAIL_PRESENTATION.modules, revision: 1 } });
    expect(await saveDetailPresentationAction('modules', DEFAULT_DETAIL_PRESENTATION.modules, 0, operation)).toHaveProperty('revision', 1);
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
    mocks.revalidate.mockClear(); mocks.rpc.mockResolvedValue({ error: null, data: { section: 'modules', values: DEFAULT_DETAIL_PRESENTATION.modules, revision: 9 } });
    expect(await saveDetailPresentationAction('modules', DEFAULT_DETAIL_PRESENTATION.modules, 0, operation)).toHaveProperty('uncertain', true);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('distinguishes conflicts from unknown results', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409' }, data: null });
    expect(await saveDetailPresentationAction('modules', DEFAULT_DETAIL_PRESENTATION.modules, 0, operation)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValue(new Error('network'));
    expect(await saveDetailPresentationAction('modules', DEFAULT_DETAIL_PRESENTATION.modules, 0, operation)).toHaveProperty('uncertain', true);
  });
  it('saves other composition with its own revision and the existing store-management gate', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { section: 'otherComposition', values: { enabled: true }, revision: 3 } });
    expect(await saveDetailPresentationAction('otherComposition', { enabled: true }, 2, operation)).toEqual({ section: 'otherComposition', values: { enabled: true }, revision: 3 });
    expect(mocks.access).toHaveBeenCalledWith('/admin/display/detail', { capability: 'store.manage' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_product_detail_presentation', { p_section: 'otherComposition', p_values: { enabled: true }, p_expected_revision: 2, p_operation_id: operation });
  });
});
