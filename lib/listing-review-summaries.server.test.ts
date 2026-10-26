import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configured: true,
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('./supabase/server', () => ({ createClient: mocks.createClient }));

import { loadListingReviewSummaries, readListingReviewSummaries } from './listing-review-summaries.server';

beforeEach(() => {
  mocks.configured = true;
  mocks.rpc.mockReset().mockResolvedValue({
    data: [{ goodId: 'g1', reviewCount: 3, ratingAverage: 4.33 }, { goodId: 'g2', reviewCount: 1, ratingAverage: 5 }],
    error: null,
  });
  mocks.createClient.mockReset().mockResolvedValue({ rpc: mocks.rpc });
});

describe('readListingReviewSummaries', () => {
  it('형식 밖 ID 를 뺀 한 번의 묶음으로 L4 RPC 를 부르고 요약을 굿즈별로 돌려준다', async () => {
    const summaries = await readListingReviewSummaries({ rpc: mocks.rpc }, ['g1', 'g2', 'g1', 'bad id', '']);

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_goods_review_summaries', { p_good_ids: ['g1', 'g2'] });
    expect(summaries).toEqual({ g1: { count: 3, average: 4.33 }, g2: { count: 1, average: 5 } });
  });

  it('물을 굿즈가 없으면 부르지 않는다', async () => {
    expect(await readListingReviewSummaries({ rpc: mocks.rpc }, [])).toEqual({});
    expect(await readListingReviewSummaries({ rpc: mocks.rpc }, ['bad id'])).toEqual({});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  /* 별점은 장식이다 — 공개 상세·캠페인·스토리가 별점 때문에 500 이 되면 안 된다. */
  it('RPC 오류·거절·클라이언트 결함은 빈 요약으로 접는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_goods_review_summary_goods' } });
    expect(await readListingReviewSummaries({ rpc: mocks.rpc }, ['g1'])).toEqual({});

    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await readListingReviewSummaries({ rpc: mocks.rpc }, ['g1'])).toEqual({});

    expect(await readListingReviewSummaries({} as never, ['g1'])).toEqual({});
  });
});

describe('loadListingReviewSummaries', () => {
  it('요청 클라이언트를 만들어 같은 규칙으로 읽는다', async () => {
    expect(await loadListingReviewSummaries(['g2'])).toEqual({ g2: { count: 1, average: 5 } });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('get_goods_review_summaries', { p_good_ids: ['g2'] });
  });

  it('Supabase 미설정(mock) 실행과 빈 선반은 클라이언트를 만들지 않는다', async () => {
    expect(await loadListingReviewSummaries([])).toEqual({});
    mocks.configured = false;
    expect(await loadListingReviewSummaries(['g1'])).toEqual({});
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('클라이언트를 만들지 못해도 던지지 않는다', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('cookies unavailable'));
    expect(await loadListingReviewSummaries(['g1'])).toEqual({});
  });
});
