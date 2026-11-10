import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({gate:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:mocks.gate}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
import { executeStoreCreditBatchAction, findStoreCreditCustomersAction, importStoreCreditTargetsAction, previewStoreCreditBatchAction, readStoreCreditBatchAction } from './store-credit-console-actions';
const id='11111111-1111-4111-8111-111111111111';
const batch={id,status:'completed',purpose:'promotion',reason:'합성 지급',amount:1000,expiresAt:'2026-12-01T00:00:00Z',count:1,invalidCount:0,gross:1000,offset:0,net:1000,rows:[{target:'fan@example.test',userId:id,nickname:'합성 고객',error:null,balance:{available:0,reserved:0,debt:0},offset:0}],createdAt:'2026-10-12T00:00:00Z',error:null,completedCount:1,failedCount:0,finishedAt:'2026-10-12T00:01:00Z'};
function form(values:Record<string,string>={}){const result=new FormData();Object.entries({id,confirmed:'yes',targets:'fan@example.test',amount:'1000',expiresAt:'2026-12-01T09:00',reason:'합성 지급',purpose:'promotion',...values}).forEach(([key,value])=>result.set(key,value));return result;}
describe('global credit actions',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.gate.mockResolvedValue({});mocks.rpc.mockResolvedValue({data:batch,error:null});});
 it('checks admin-only access before every endpoint including imports and reads',async()=>{
  mocks.gate.mockResolvedValue(null);
  for(const result of [await executeStoreCreditBatchAction(form()),await previewStoreCreditBatchAction(form()),await findStoreCreditCustomersAction('fan'),await readStoreCreditBatchAction(id),await importStoreCreditTargetsAction(form())])expect(result.error).toContain('관리자');
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.gate).toHaveBeenCalledWith('/admin/sales/store-credits',{adminOnly:true});
 });
 it('requires explicit total confirmation and passes no client supplied money to execution',async()=>{
  expect((await executeStoreCreditBatchAction(form({confirmed:''}))).error).toBeTruthy();expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await executeStoreCreditBatchAction(form({amount:'999999'}))).batch?.status).toBe('completed');
  expect(mocks.rpc).toHaveBeenNthCalledWith(1,'admin_execute_store_credit_batch',{p_id:id});expect(mocks.rpc).toHaveBeenNthCalledWith(2,'admin_get_store_credit_batch',{p_id:id});
 });
 it('does not claim success when execution or readback is uncertain',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:batch,error:null}).mockResolvedValueOnce({data:null,error:{message:'offline'}});
  expect((await executeStoreCreditBatchAction(form())).error).toContain('다시 읽지 못했습니다');expect(mocks.revalidate).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({data:{...batch,id:'22222222-2222-4222-8222-222222222222'},error:null});expect((await readStoreCreditBatchAction(id)).error).toBeTruthy();
 });
 it('validates amount and calendar time and resolves only exact target identifiers',async()=>{
  expect((await previewStoreCreditBatchAction(form({amount:'0'}))).error).toBeTruthy();
  expect((await previewStoreCreditBatchAction(form({expiresAt:'2026-02-30T09:00'}))).error).toBeTruthy();
  expect((await previewStoreCreditBatchAction(form({targets:'고객이름'}))).error).toBeTruthy();expect(mocks.rpc).not.toHaveBeenCalled();
  await previewStoreCreditBatchAction(form({targets:'FAN@example.test\nfan@example.test'}));
  expect(mocks.rpc).toHaveBeenCalledWith('admin_preview_store_credit_batch',expect.objectContaining({p_targets:['fan@example.test'],p_expires_at:'2026-12-01T00:00:00.000Z',p_amount:1000}));
 });
});
