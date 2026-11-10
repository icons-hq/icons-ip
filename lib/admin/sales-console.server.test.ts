import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminClaimConsoleData } from './claims.server';
import { normalizeAdminClaimFilters } from './claims';
import { getAdminUnpaidOrders } from './unpaid.server';
import { normalizeAdminUnpaidFilters } from './unpaid';
import { getAdminSettledOrders } from './settled.server';
import { normalizeAdminSettledFilters } from './settled';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({data:[],error:null}); });

describe('sales server search contracts', () => {
  it('shares the non-stage claim conditions with counts and sorts before the requested page', async () => {
    await getAdminClaimConsoleData('return',normalizeAdminClaimFilters({stage:'collected',reasonType:'defect',dateField:'collected',field:'buyer',query:'검색',sort:'oldest',pageSize:'50',page:'2',from:'2026-10-01',to:'2026-10-12'}));
    const common={p_claim_type:'return',p_reason_type:'defect',p_from:'2026-10-01',p_to:'2026-10-12',p_query:'검색',p_field:'buyer',p_date_field:'collected'};
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_order_claims_console',{...common,p_stage:'collected',p_limit:50,p_offset:50,p_sort:'oldest'});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_stage_counts_console',common);
  });
  it('uses explicit unpaid state, expiry sorting and the selected list size', async () => {
    const data=await getAdminUnpaidOrders(normalizeAdminUnpaidFilters({state:'missing',sort:'newest',pageSize:'100',page:'3',q:'대조'}),{includeDeposits:false});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_unpaid_bank_transfer_orders_console',{p_query:'대조',p_state:'missing',p_sort:'newest',p_limit:100,p_offset:200});
    expect(data.pageSize).toBe(100);
  });
  it('uses the requested settled business date without changing the done-only boundary', async () => {
    await getAdminSettledOrders(normalizeAdminSettledFilters({dateField:'settled',sort:'oldest',pageSize:'50',page:'2',from:'2026-10-01'}));
    expect(mocks.rpc).toHaveBeenCalledWith('admin_search_orders_console',{p_from:'2026-10-01',p_to:null,p_query:null,p_field:'all',p_status:'done',p_date_field:'settled',p_sort:'oldest',p_limit:50,p_offset:50});
  });
});
