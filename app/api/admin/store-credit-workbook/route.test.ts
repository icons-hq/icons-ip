import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({gate:vi.fn(),rpc:vi.fn(),build:vi.fn()}));
vi.mock('@/lib/admin/guard.server',()=>({requireAdminScreenAccess:mocks.gate}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/admin/store-credit-workbook.server',()=>({buildStoreCreditWorkbook:mocks.build}));
vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
import { GET } from './route';
describe('credit workbook route',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.gate.mockResolvedValue({});mocks.rpc.mockResolvedValue({data:{total:0,rows:[],capturedAt:'2026-10-12T00:00:00Z'},error:null});mocks.build.mockResolvedValue(Buffer.from('xlsx'));});
 it('requires admin and privacy acknowledgement before querying the full ledger',async()=>{
  expect((await GET(new Request('http://local/api/admin/store-credit-workbook'))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.gate).toHaveBeenCalledWith('/admin/sales/store-credits',{adminOnly:true});
 });
 it('exports the same normalized filters without paging the result or caching financial data',async()=>{
  const result=await GET(new Request('http://local/api/admin/store-credit-workbook?privacyConfirmed=yes&mode=ledger&query=fan&from=2026-10-01&kind=grant&page=8'));
  expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_export_store_credit_console',{p_mode:'ledger',p_query:'fan',p_from:'2026-10-01',p_to:null,p_kind:'grant'});
 });
 it('rejects truncated and oversized exports',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'store_credit_export_limit'}});expect((await GET(new Request('http://local/?privacyConfirmed=yes'))).status).toBe(422);
  mocks.rpc.mockResolvedValueOnce({data:{total:1,rows:[],capturedAt:'2026-10-12T00:00:00Z'},error:null});expect((await GET(new Request('http://local/?privacyConfirmed=yes'))).status).toBe(500);expect(mocks.build).not.toHaveBeenCalled();
 });
});
