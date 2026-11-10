import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
import { getStoreCreditConsole } from './store-credit-console.server';
import { normalizeStoreCreditConsoleFilters } from './store-credit-console';
describe('store credit console loader',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:{total:0,rows:[]},error:null});});
 it('forwards date, kind, customer and pagination filters to the guarded RPC',async()=>{
  await getStoreCreditConsole(normalizeStoreCreditConsoleFilters({mode:'ledger',query:'fan@example.test',from:'2026-10-01',to:'2026-10-12',kind:'adjustment_credit',page:'2',pageSize:'100'}));
  expect(mocks.rpc).toHaveBeenCalledWith('admin_search_store_credit_console',{p_mode:'ledger',p_query:'fan@example.test',p_from:'2026-10-01',p_to:'2026-10-12',p_kind:'adjustment_credit',p_page:2,p_page_size:100});
 });
 it('does not turn query or schema errors into empty successful results',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'denied'}});await expect(getStoreCreditConsole(normalizeStoreCreditConsoleFilters({}))).rejects.toThrow('불러오지');
 });
});
