import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
import { getAdminReviewConsoleData } from './reviews.server';
import { normalizeAdminReviewFilters } from './reviews';

const first = '93600000-0000-4000-8002-000000000002';
const second = '93600000-0000-4000-8002-000000000001';
function row(id: string) {
  return { id, review_kind: 'ordinary', repeat_purchase: null, good_id: 'review-sort-test', good_name: '정렬 검증', order_id: id, user_id: id,
    author_name: '합성 구매자', author_email: null, rating: 3, body: '합성 리뷰 내용', image_paths: null,
    status: 'visible', hidden_reason: null, hidden_at: null, admin_reply: null, admin_reply_at: null,
    reply_author_name: null, helpful_count: 2, report_count: 0, open_report_count: 0, created_at: '2026-10-01T00:00:00Z', edited_at: null, total_count: 26,
    best_selection: { reviewId: id, selected: false, revision: 0, reviewFingerprint: 'a'.repeat(32), selectedAt: null, reason: null, problem: null, state: 'not_selected' } };
}

describe('admin review query ordering', () => {
  beforeEach(() => mocks.rpc.mockReset());

  it.each(['good_name_asc', 'photo_count_desc', 'helpful_desc'])('passes %s with the complete filter/page contract and preserves server order', async (sort) => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'admin_search_reviews_typed'
      ? { data: [row(first), row(second)], error: null }
      : { data: [{ total_reviews: 26, low_rating_reviews: 0, awaiting_reply_reviews: 26, hidden_reviews: 0, reported_reviews: 0 }], error: null });
    const filters = normalizeAdminReviewFilters({ sort, best: 'not_selected', field: 'good', query: '정렬 검증', photo: 'without', from: '2026-10-01', to: '2026-10-02', page: '2', pageSize: '20' });
    const result = await getAdminReviewConsoleData(filters);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_reviews_typed', {
      p_kind: 'all', p_repeat: 'all', p_best: 'not_selected', p_field: 'good', p_from: '2026-10-01', p_has_photo: false, p_has_reply: null,
      p_limit: 20, p_low_rating: false, p_offset: 20, p_query: '정렬 검증', p_rating: null,
      p_review_id: null, p_sort: sort, p_status: null, p_to: '2026-10-02',
    });
    expect(result.rows.map(value => value.id)).toEqual([first, second]);
    expect(result.rows.map(value => value.imageCount)).toEqual([0, 0]);
    expect(result.rows.map(value => value.helpfulCount)).toEqual([2, 2]);
    expect(result.rows.map(value => value.best?.reviewId)).toEqual([first, second]);
    expect(result.total).toBe(26);
    expect(result.filters).toEqual(filters);
  });

  it('does not attach another review’s BEST snapshot when reading a sorted page', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'admin_search_reviews_typed'
      ? [{ ...row(first), best_selection: row(second).best_selection }] : [], error: null }));
    const result = await getAdminReviewConsoleData(normalizeAdminReviewFilters({ sort: 'photo_count_desc' }));
    expect(result.rows[0].best).toBeNull();
  });

  it.each([undefined, -1, 'unknown', '2.5', Number.MAX_SAFE_INTEGER + 1])('rejects an unreadable helpful count instead of displaying zero', async (helpful_count) => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'admin_search_reviews_typed'
      ? [{ ...row(first), helpful_count }] : [], error: null }));
    await expect(getAdminReviewConsoleData(normalizeAdminReviewFilters({ sort: 'helpful_desc' }))).rejects.toThrow('helpful count');
  });
});
