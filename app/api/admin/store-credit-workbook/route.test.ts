import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({gate:vi.fn(),rpc:vi.fn(),build:vi.fn(),access:vi.fn()}));
vi.mock('@/lib/admin/guard.server',()=>({requireAdminScreenAccess:mocks.gate}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/admin/store-credit-workbook.server',()=>({buildStoreCreditWorkbook:mocks.build}));
vi.mock('@/lib/admin/pii-access-log.server',()=>({recordPiiAccess:mocks.access}));
vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
import { GET } from './route';
describe('credit workbook route',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.gate.mockResolvedValue({user:{id:'admin-1'}});mocks.rpc.mockResolvedValue({data:{total:0,rows:[],capturedAt:'2026-10-12T00:00:00Z'},error:null});mocks.build.mockResolvedValue(Buffer.from('xlsx'));mocks.access.mockResolvedValue('5');});
 it('requires admin and privacy acknowledgement before querying the full ledger',async()=>{
  expect((await GET(new Request('http://local/api/admin/store-credit-workbook'))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.gate).toHaveBeenCalledWith('/admin/sales/store-credits',{adminOnly:true});
 });
 it('exports the same normalized filters without paging the result or caching financial data',async()=>{
  const result=await GET(new Request('http://local/api/admin/store-credit-workbook?privacyConfirmed=yes&mode=ledger&query=fan&from=2026-10-01&kind=grant&page=8'));
  expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('private, no-store');expect(decodeURIComponent(result.headers.get('content-disposition')!)).toContain('xsquare-적립금원장-20261012-0900.xlsx');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_export_store_credit_console',{p_mode:'ledger',p_query:'fan',p_from:'2026-10-01',p_to:null,p_kind:'grant'});
  expect(mocks.access).toHaveBeenCalledExactlyOnceWith({actorId:'admin-1',action:'export',surface:'export.store_credits',path:'/api/admin/store-credit-workbook',
   subjectKind:'member',subjectIds:[],subjectCount:0,detail:{mode:'ledger',records:0}});
  expect(JSON.stringify(mocks.access.mock.calls)).not.toContain('fan');
 });
 it('개인정보 접속기록을 남기지 못하면 파일을 내보내지 않는다',async()=>{
  mocks.access.mockRejectedValueOnce(new Error('pii log down'));
  const result=await GET(new Request('http://local/api/admin/store-credit-workbook?privacyConfirmed=yes&mode=batches'));
  expect(result.status).toBe(500);expect(result.headers.get('content-type')).toContain('json');
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({subjectKind:'none',subjectIds:[],subjectCount:0,detail:{mode:'batches',records:0}}));
 });
 it('rejects truncated and oversized exports',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'store_credit_export_limit'}});expect((await GET(new Request('http://local/?privacyConfirmed=yes'))).status).toBe(422);
  mocks.rpc.mockResolvedValueOnce({data:{total:1,rows:[],capturedAt:'2026-10-12T00:00:00Z'},error:null});expect((await GET(new Request('http://local/?privacyConfirmed=yes'))).status).toBe(500);expect(mocks.build).not.toHaveBeenCalled();
  expect(mocks.access).not.toHaveBeenCalled();
 });
});
