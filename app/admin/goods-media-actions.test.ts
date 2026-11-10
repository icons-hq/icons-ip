import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), prepare: vi.fn(), verify: vi.fn(), cancel: vi.fn(), cleanup: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => ({ user: null }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('@/lib/admin/goods-media.server', () => ({ prepareGoodsMediaUpload: mock.prepare, verifyAndPromoteGoodsMedia: mock.verify, cancelGoodsMediaUpload: mock.cancel, cleanupGoodsMediaUploads: mock.cleanup }));
import { prepareGoodsMediaAction, saveGoodMediaAction, saveGoodsMediaSettingsAction } from './goods-media-actions';
const operation = '92800000-0000-4000-8002-000000000001', values = { video: null, shortclip: null };
beforeEach(() => { vi.resetAllMocks(); mock.access.mockResolvedValue({ user: { id: operation } }); });
describe('goods video action boundaries', () => {
  it('does not prepare a claim for missing capability or invalid upload declarations', async () => {
    mock.access.mockResolvedValueOnce(null); await prepareGoodsMediaAction({ id: operation, kind: 'video', mimeType: 'video/mp4', size: 4 });
    await prepareGoodsMediaAction({ id: operation, kind: 'video', mimeType: 'image/png', size: 4 }); expect(mock.prepare).not.toHaveBeenCalled();
  });
  it('validates the exact saved target, selection and revision before invalidation', async () => {
    mock.rpc.mockResolvedValue({ data: { goodId: 'good-1', goodName: '상품', revision: 1, ...values }, error: null });
    expect(await saveGoodMediaAction('good-1', values, 0, operation)).toHaveProperty('snapshot'); expect(mock.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
    mock.revalidate.mockClear(); mock.rpc.mockResolvedValue({ data: { goodId: 'good-2', goodName: '다른 상품', revision: 1, ...values }, error: null });
    expect(await saveGoodMediaAction('good-1', values, 0, operation)).toHaveProperty('uncertain', true); expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it('distinguishes confirmed conflict from unknown transport and verifies settings receipts', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } }); expect(await saveGoodMediaAction('good-1', values, 0, operation)).not.toHaveProperty('uncertain');
    mock.rpc.mockRejectedValueOnce(new Error('transport')); expect(await saveGoodMediaAction('good-1', values, 0, operation)).toHaveProperty('uncertain', true);
    mock.rpc.mockResolvedValueOnce({ data: { revision: 1, values: { priority: 'video', shortclips: true } }, error: null });
    expect(await saveGoodsMediaSettingsAction({ priority: 'image', shortclips: false }, 0, operation)).toHaveProperty('uncertain', true);
  });
});
