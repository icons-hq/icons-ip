import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodReviewSection } from './reviews.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), sign: vi.fn(), disclosures: vi.fn() }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));
vi.mock('@/lib/review-events.server', () => ({ loadReviewEventDisclosures: mocks.disclosures }));
const options = { sort: 'recent' as const, photoOnly: false, page: 1 };
beforeEach(() => { vi.clearAllMocks(); mocks.disclosures.mockResolvedValue(new Map()); });
describe('그룹 리뷰 서버 조회', () => {
  it('동일 RPC의 전체 집계와 원구매 표시를 사용하고 사진만 별도로 서명한다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: { grouped: true, viewerAuthenticated: true, summary: { count: 1, average: 4, distribution: [0, 0, 0, 1, 0], photoCount: 1 }, total: 1,
      reviews: [{ kind: 'ordinary', repeatPurchase: null, id: 'a6140000-0000-4000-8000-000000000001', goodId: 'original', goodName: '원구매', variantNames: ['파랑'], rating: 4,
        body: '후기', imagePaths: ['synthetic/review.webp'], authorName: '구매자', isMine: false, helpfulCount: 2, helpfulByMe: false, canMarkHelpful: true, createdAt: '2026-10-14T00:00:00Z', editedAt: null, adminReply: null, adminReplyAt: null }] } });
    mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://example.test/signed.webp' }, error: null });
    const result = await loadGoodReviewSection('converted', options);
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_group_reviews_v3', { p_good_id: 'converted', p_kind: 'all', p_repeat: 'all', p_limit: 10, p_offset: 0, p_photo_only: false, p_sort: 'recent' });
    expect(result.reviews[0]).toMatchObject({ purchasedGood: { id: 'original', name: '원구매', variantNames: ['파랑'] }, imageUrls: ['https://example.test/signed.webp'] });
    expect(result.grouped).toBe(true);
  });
  it('조회 실패를 리뷰가 없는 상태로 단정하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'unavailable' }, data: null });
    expect(await loadGoodReviewSection('converted', options)).toMatchObject({ unavailable: true, reviews: [] });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
