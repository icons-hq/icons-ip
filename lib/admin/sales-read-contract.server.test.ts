import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getAdminClaimConsoleData } from './claims.server';
import { normalizeAdminClaimFilters } from './claims';
import { getAdminSettledOrders } from './settled.server';
import { normalizeAdminSettledFilters } from './settled';

beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: [], error: null }); });

describe('판매 목록 조회 계약 연결', () => {
  it.each(['recipient', 'item'] as const)('클레임 %s 검색을 목록과 단계별 건수에 같은 값으로 보낸다', async (field) => {
    const filters = normalizeAdminClaimFilters({ field, query: '  CODE_%  ', dateField: 'paid', page: '2', stage: 'collected', reasonType: 'defect' });
    await getAdminClaimConsoleData('exchange', filters);
    const shared = { p_claim_type: 'exchange', p_field: field, p_query: 'CODE_%', p_date_field: 'paid', p_reason_type: 'defect' };
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining({ ...shared, p_stage: 'collected', p_offset: 50 }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining(shared));
  });

  /* 검색 항목에서 '상품 URL'을 뺐다 — 옛 주소의 field=product는 '전체' 검색으로 읽히고, '전체'가 상품 값도 함께 찾는다(DB admin_sales_claim_matches). */
  it("옛 주소의 클레임 product 검색은 '전체' 검색으로 보낸다", async () => {
    const filters = normalizeAdminClaimFilters({ field: 'product', query: 'CODE', stage: 'collected' });
    expect(filters.field).toBeUndefined();
    await getAdminClaimConsoleData('exchange', filters);
    const shared = { p_claim_type: 'exchange', p_field: 'all', p_query: 'CODE' };
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining(shared));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining(shared));
  });

  /* F-10: 목록에 보이는 요청번호(C00021) 그대로 찾아지게, 요청번호 모양이면 DB가 받는 숫자(21)로 바꿔 보낸다. 목록과 단계별 건수가 같은 값을 쓴다. */
  it.each([[undefined, 'all'], ['order', 'order']] as const)('클레임 요청번호 모양 검색어(%s)는 DB가 받는 숫자로 바꿔 목록과 단계별 건수에 같은 값으로 보낸다', async (field, sent) => {
    const filters = normalizeAdminClaimFilters({ ...(field ? { field } : {}), query: ' C00021 ' });
    expect(filters.query).toBe('C00021');
    await getAdminClaimConsoleData('return', filters);
    const shared = { p_claim_type: 'return', p_field: sent, p_query: '21' };
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining(shared));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining(shared));
  });

  it('요청번호 모양이라도 구매자·수령인 검색에는 적은 그대로 보낸다', async () => {
    await getAdminClaimConsoleData('return', normalizeAdminClaimFilters({ field: 'buyer', query: 'C00021' }));
    const shared = { p_field: 'buyer', p_query: 'C00021' };
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining(shared));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining(shared));
  });

  it('검색어가 비면 DB에는 null을 보낸다', async () => {
    await getAdminClaimConsoleData('return', normalizeAdminClaimFilters({}));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining({ p_query: null }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining({ p_query: null }));
  });

  it('결제일 기준과 범위를 클레임 조회와 단계 집계에 동일하게 보낸다', async () => {
    const filters = normalizeAdminClaimFilters({ dateField: 'paid', from: '2026-10-02', to: '2026-10-02', sort: 'oldest', page: '2' });
    await getAdminClaimConsoleData('return', filters);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining({
      p_date_field: 'paid', p_from: '2026-10-02', p_to: '2026-10-02', p_sort: 'oldest', p_limit: 50, p_offset: 50,
    }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining({
      p_date_field: 'paid', p_from: '2026-10-02', p_to: '2026-10-02', p_claim_type: 'return',
    }));
  });
  it('거래확정 검색 대상은 페이지 조회의 서버 조건이다', async () => {
    await getAdminSettledOrders(normalizeAdminSettledFilters({ field: 'tracking', query: 'GAP1530', page: '3', pageSize: '50' }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_orders_console', expect.objectContaining({
      p_status: 'done', p_field: 'tracking', p_query: 'GAP1530', p_limit: 50, p_offset: 100,
    }));
  });
});
