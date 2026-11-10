import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), cards: vi.fn(), sign: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));
vi.mock('@/lib/catalog', () => ({ getCatalogGoodsByIds: mocks.cards }));
import { loadPublicDetailPresentation } from './product-detail-presentation.server';
const reference = () => ({ banner: null, reviews: null, recommendations: { similar: ['g1', 'g2', 'g3', 'g4', 'g5'], together: ['g1', 'g2', 'g3', 'g4', 'g5'], categoryPopular: [], storePopular: ['g1'] }, nextChangeAt: null });
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: reference(), error: null }); mocks.cards.mockResolvedValue(['g1', 'g2', 'g3', 'g4', 'g5'].map(id => ({ id }))); });
describe('public detail projection loader', () => {
  it('rechecks a five-card minimum after product visibility changes between reads', async () => {
    mocks.cards.mockResolvedValue(['g1', 'g2', 'g3', 'g4'].map(id => ({ id })));
    const data = await loadPublicDetailPresentation('current');
    expect(data?.recommendations.similar).toEqual([]); expect(data?.recommendations.together).toEqual([]);
    expect(data?.recommendations.storePopular.map(good => good.id)).toEqual(['g1']);
  });
  it('keeps the full review denominator and text when a photo cannot be signed', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { ...reference(), reviews: { count: 15, positiveCount: 12, cards: [{ id: '91000000-0000-4000-8005-000000000004', rating: 4, body: '실제 구매 리뷰 본문', authorName: '구매자', createdAt: '2026-10-13T00:00:00Z', imagePaths: ['review/path.png'] }] } } });
    mocks.sign.mockResolvedValue({ data: null, error: { message: 'storage unavailable' } });
    const data = await loadPublicDetailPresentation('current');
    expect(data?.reviews).toMatchObject({ count: 15, positiveCount: 12, cards: [{ body: '실제 구매 리뷰 본문', imageUrls: [] }] });
  });
  it('distinguishes unavailable data from a hidden or missing product', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await loadPublicDetailPresentation('hidden')).toBeNull();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } }); expect(await loadPublicDetailPresentation('current')).toMatchObject({ unavailable: true, banner: null });
    expect(mocks.cards).not.toHaveBeenCalled();
  });
  it('preserves a valid banner when the independent recommendation card read fails', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { ...reference(), banner: { style: 'light', title: '혜택 안내', text: '정상 안내문입니다' } } });
    mocks.cards.mockRejectedValue(new Error('catalog unavailable'));
    expect(await loadPublicDetailPresentation('current')).toMatchObject({ banner: { title: '혜택 안내' }, recommendationsUnavailable: true });
  });
});
