import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminHomeSummary } from './home-summary.server';
import { adminInsightPeriod } from './home-summary';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
beforeEach(() => vi.clearAllMocks());

describe('판매자 홈 요약', () => {
  it('처리 요청과 공개·품절 상품 집계를 실제 목록 조건으로 분리한다', async () => {
    mocks.rpc.mockImplementation(async (name: string, params?: Record<string, unknown>) => {
      if (name === 'admin_order_claim_stage_counts') return { data: [{ stage: 'requested', total: params?.p_claim_type === 'cancel' ? 2 : 0 }, { stage: 'completed', total: 500 }] };
      if (name === 'admin_search_goods_workspace') return { data: { total: params?.p_status === 'published' ? 10 : 3, rows: [] } };
      return { data: [{ total_reviews: 20, low_rating_reviews: '2', awaiting_reply_reviews: 4 }] };
    });
    expect(await loadAdminHomeSummary()).toEqual({ claims: { cancel: 2, return: 0, exchange: 0 }, goods: { published: 10, soldout: 3 }, reviews: { total: 20, lowRating: 2, awaitingReply: 4 } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_workspace', expect.objectContaining({ p_stock: 'soldout', p_status: 'active', p_limit: 0 }));
  });
  it('실패하거나 손상된 집계를 0으로 바꾸지 않는다', async () => {
    mocks.rpc.mockImplementation(async (name: string, params?: Record<string, unknown>) => {
      if (name === 'admin_order_claim_stage_counts') {
        if (params?.p_claim_type === 'cancel') throw new Error('offline');
        if (params?.p_claim_type === 'return') return { data: [{ stage: 'requested', total: -1 }] };
        return { data: [] };
      }
      return { data: null, error: { message: 'unavailable' } };
    });
    expect(await loadAdminHomeSummary()).toEqual({ claims: { cancel: null, return: null, exchange: 0 }, goods: { published: null, soldout: null }, reviews: { total: null, lowRating: null, awaitingReply: null } });
  });
  it('성과 기간 입력을 세 가지 범위로 제한한다', () => {
    expect(adminInsightPeriod('1')).toBe(1);
    expect(adminInsightPeriod('7')).toBe(7);
    expect(adminInsightPeriod('30')).toBe(30);
    expect(adminInsightPeriod('90000')).toBe(30);
    expect(adminInsightPeriod(['7', '30'])).toBe(30);
  });
});
