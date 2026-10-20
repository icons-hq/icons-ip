import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHomeProductRankings } from './home-ranking.server';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), configured: true }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
const statistic = (goodId: string) => ({ goodId, ratingAverage: 4.8, reviewCount: 2, recentReviewAt: '2026-10-11T00:00:00Z',
  representative: { id: 'review-1', rating: 5, body: '공개 후기입니다.', authorName: '닉네임', createdAt: '2026-09-10T00:00:00Z' } });

beforeEach(() => { mocks.rpc.mockReset(); mocks.configured = true; });
describe('home ranking public loader', () => {
  it('caps review queries below the API row limit and strips IDs outside the public catalog', async () => {
    mocks.rpc.mockImplementation(async (name: string, args?: { p_good_ids: string[] }) => name === 'get_home_sales_rankings'
      ? { data: { realtime: ['g0', 'secret'], daily: [], weekly: [], monthly: [] }, error: null }
      : { data: [...args!.p_good_ids.map(statistic), statistic('secret')], error: null });
    const goods = Array.from({ length: 401 }, (_, index) => ({ id: `g${index}` }));
    const result = await loadHomeProductRankings(goods);
    expect(result.sales.realtime).toEqual(['g0']);
    expect(result.reviewStatistics).toHaveLength(401);
    expect(result.reviewStatistics.every((row) => row.goodId !== 'secret')).toBe(true);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'get_home_review_candidates').map(([, args]) => args.p_good_ids.length)).toEqual([200, 200, 1]);
  });

  it('keeps unavailable review data separate from a successfully loaded sales ranking', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_home_sales_rankings'
      ? { data: { realtime: ['g1'], daily: [], weekly: [], monthly: [] }, error: null }
      : { data: null, error: { message: 'unavailable' } });
    expect(await loadHomeProductRankings([{ id: 'g1' }])).toMatchObject({ salesAvailable: true, reviewsAvailable: false, reviewStatistics: [] });
  });
});
