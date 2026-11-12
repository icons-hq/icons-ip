import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodReviewSection, loadMyReviewTargets } from './reviews.server';
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

/* 리뷰 등록 = 구매확정(1014-079). 작성 대상과 함께 확정 필요 여부·막힌 이유를 한 RPC로 받는다. */
describe('내 리뷰 대상 조회', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    order_id: 'a6140000-0000-4000-8000-000000000101', order_number: '2026111210000001', good_id: 'g13', good_name: '아크릴 블록', good_bg: null,
    good_image_path: null, ordered_at: '2026-11-01T00:00:00Z', delivered_at: '2026-11-10T00:00:00Z', deadline_at: '2027-02-08T00:00:00Z',
    writable: true, review_id: null, review_rating: null, review_body: null, review_image_paths: null, review_status: null, review_created_at: null,
    review_edited_at: null, admin_reply: null, admin_reply_at: null, review_kind: 'ordinary', opens_at: '2026-11-10T00:00:00Z', editable: false,
    month_reward_eligible: false, repeat_purchase: false, purchase_confirmation_required: true, purchase_confirmation_block: null,
    purchase_confirmation_hold_reason: null, ...overrides,
  });

  it('확정 필요 여부와 막힌 이유를 함께 읽는다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [row(), row({ good_id: 'g14', writable: false, purchase_confirmation_block: 'held', purchase_confirmation_hold_reason: '사진 확인 중' })] });
    const targets = await loadMyReviewTargets({ orderId: 'a6140000-0000-4000-8000-000000000101' });

    expect(mocks.rpc).toHaveBeenCalledWith('my_review_targets_v3', { target_good_id: null, target_order_id: 'a6140000-0000-4000-8000-000000000101' });
    expect(targets[0]).toMatchObject({ writable: true, purchaseConfirmation: { required: true, block: null, holdReason: null } });
    expect(targets[1]).toMatchObject({ writable: false, purchaseConfirmation: { required: true, block: 'held', holdReason: '사진 확인 중' } });
  });

  it('새로 생긴 막힌 이유는 일반 사유로 접고 목록은 유지한다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [row({ writable: false, purchase_confirmation_block: 'future_reason' })] });
    expect((await loadMyReviewTargets())[0].purchaseConfirmation?.block).toBe('unavailable');
  });

  it('확정 열의 형식이 어긋나면 작성 가능으로 단정하지 않고 비운다', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [row({ purchase_confirmation_required: null })] });
    expect(await loadMyReviewTargets()).toEqual([]);
  });
});
