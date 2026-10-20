import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { loadGoodsTransactionOffers } from './goods-transaction-offers.server';
const offer = { goodId: 'good-a', volume: null, delivery: null, collectReady: false, collector: null };
beforeEach(() => { mocks.rpc.mockReset(); });
describe('공개 거래 조건 loader', () => {
  it('상품 ID를 중복 제거해 읽고 정확한 반환 집합을 확인한다', async () => {
    mocks.rpc.mockResolvedValue({ data: [offer], error: null });
    expect(await loadGoodsTransactionOffers(['good-a', 'good-a'])).toEqual([offer]);
    expect(mocks.rpc).toHaveBeenCalledWith('get_goods_transaction_offers_v3', { p_good_ids: ['good-a'] });
  });
  it('오류·누락·잘못된 응답을 빈 정책으로 바꾸지 않는다', async () => {
    for (const response of [{ data: [], error: null }, { data: [offer], error: { message: 'unavailable' } },
      { data: [{ ...offer, goodId: 'other' }], error: null }, { data: [{ ...offer, internalEvidence: 'private' }], error: null }]) {
      mocks.rpc.mockResolvedValue(response);expect(await loadGoodsTransactionOffers(['good-a'])).toBeNull();
    }
    mocks.rpc.mockRejectedValue(new Error('offline'));expect(await loadGoodsTransactionOffers(['good-a'])).toBeNull();
    expect(await loadGoodsTransactionOffers([])).toEqual([]);
  });
  it('1001개 상품은 RPC 허용 크기로 나누고 중복 응답은 거절한다', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => `good-${index}`);
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_good_ids.map((goodId: string) => ({ ...offer, goodId })), error: null }));
    expect(await loadGoodsTransactionOffers(ids)).toHaveLength(1001);
    expect(mocks.rpc.mock.calls.map(call => call[1].p_good_ids.length)).toEqual([1000, 1]);
    mocks.rpc.mockResolvedValue({ data: [offer, offer], error: null });
    expect(await loadGoodsTransactionOffers(['good-a', 'good-b'])).toBeNull();
  });
});
