import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ current: vi.fn(), rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('./review-insights.server', () => ({ getAdminReviewInsights: mocks.current }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
import { getAdminReviewInsightsWithHistory } from './review-rating-history.server';
import { normalizeReviewInsightFilters } from './review-insights';
import { reviewInsightsFixture, reviewRatingHistoryFixture } from '@/test/fixtures/review-rating-history';
const filters = normalizeReviewInsightFilters({ q: '검색', focus: 'rating', page: '2' });
beforeEach(() => { vi.clearAllMocks(); mocks.createClient.mockResolvedValue({ rpc: mocks.rpc }); mocks.current.mockResolvedValue(reviewInsightsFixture); mocks.rpc.mockResolvedValue({ data: reviewRatingHistoryFixture, error: null }); });
describe('independent live and historical review reads', () => {
  it('uses only the live asOf and preserves the existing filter contract', async () => {
    expect(await getAdminReviewInsightsWithHistory(filters)).toEqual({ data: reviewInsightsFixture, history: { kind: 'ready', data: reviewRatingHistoryFixture } });
    expect(mocks.current).toHaveBeenCalledWith(filters);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_review_rating_comparison', { p_as_of: '2026-10-14' });
  });
  it.each([{ data: null, error: { code: '55000', message: 'review_rating_contract_changed' } }, { data: {}, error: null }])('keeps live data on history errors or DTO incompatibility', async result => {
    mocks.rpc.mockResolvedValue(result);
    expect(await getAdminReviewInsightsWithHistory(filters)).toEqual({ data: reviewInsightsFixture, history: { kind: 'error' } });
    expect(mocks.current).toHaveBeenCalledTimes(1);
  });
  it('retries live and history once only on the explicit midnight mismatch', async () => {
    const fresh = { ...reviewInsightsFixture, asOf: '2026-10-15' };
    const history = { ...reviewRatingHistoryFixture, asOf: '2026-10-15', comparisonAsOf: '2026-07-15', status: 'not_collected', observation: null };
    mocks.current.mockResolvedValueOnce(reviewInsightsFixture).mockResolvedValueOnce(fresh);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'review_rating_date_changed' } }).mockResolvedValueOnce({ data: history, error: null });
    expect(await getAdminReviewInsightsWithHistory(filters)).toEqual({ data: fresh, history: { kind: 'ready', data: history } });
    expect(mocks.rpc.mock.calls).toEqual([['admin_review_rating_comparison', { p_as_of: '2026-10-14' }], ['admin_review_rating_comparison', { p_as_of: '2026-10-15' }]]);
  });
  it('does not loop on a second mismatch or discard live data when retry fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'review_rating_date_changed' } });
    expect((await getAdminReviewInsightsWithHistory(filters)).history).toEqual({ kind: 'error' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    mocks.current.mockRejectedValueOnce(new Error('offline'));
    await expect(getAdminReviewInsightsWithHistory(filters)).rejects.toThrow('offline');
    mocks.current.mockResolvedValueOnce(reviewInsightsFixture).mockRejectedValueOnce(new Error('retry offline'));
    expect(await getAdminReviewInsightsWithHistory(filters)).toEqual({ data: reviewInsightsFixture, history: { kind: 'error' } });
  });
  it('retains current data if history client creation throws', async () => {
    mocks.createClient.mockRejectedValue(new Error('connection unavailable'));
    expect(await getAdminReviewInsightsWithHistory(filters)).toEqual({ data: reviewInsightsFixture, history: { kind: 'error' } });
  });
});
