import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { getAdminClaimConsoleData } from './claims.server';
import { normalizeAdminClaimFilters } from './claims';
import { getAdminSettledOrders } from './settled.server';
import { normalizeAdminSettledFilters } from './settled';

beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: [], error: null }); });

describe('판매 목록 조회 계약 연결', () => {
  it.each(['recipient', 'item', 'product'] as const)('클레임 %s 검색을 목록과 단계별 건수에 같은 값으로 보낸다', async (field) => {
    const filters = normalizeAdminClaimFilters({ field, query: '  CODE_%  ', dateField: 'paid', page: '2', stage: 'collected', reasonType: 'defect' });
    await getAdminClaimConsoleData('exchange', filters);
    const shared = { p_claim_type: 'exchange', p_field: field, p_query: 'CODE_%', p_date_field: 'paid', p_reason_type: 'defect' };
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining({ ...shared, p_stage: 'collected', p_offset: 20 }));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console', expect.objectContaining(shared));
  });

  it('결제일 기준과 범위를 클레임 조회와 단계 집계에 동일하게 보낸다', async () => {
    const filters = normalizeAdminClaimFilters({ dateField: 'paid', from: '2026-10-02', to: '2026-10-02', sort: 'oldest', page: '2' });
    await getAdminClaimConsoleData('return', filters);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console', expect.objectContaining({
      p_date_field: 'paid', p_from: '2026-10-02', p_to: '2026-10-02', p_sort: 'oldest', p_limit: 20, p_offset: 20,
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
