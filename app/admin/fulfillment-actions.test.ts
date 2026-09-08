import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:mocks.auth}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
import { saveFulfillmentOriginAction } from './fulfillment-actions';
const form=()=>{const data=new FormData();Object.entries({id:'00000000-0000-4000-8000-000000042201',updatedAt:'2026-09-01T00:00:00Z',code:'gimpo',name:'변경 창고',defaultCarrier:'hanjin',baseFee:'4200',freeThreshold:'65000',returnAddress:'창고 주소',cutoff:'17:30',exportTemplate:'wms_csv',active:'true'}).forEach(([key,value])=>data.set(key,value));return data;};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({isConfigured:true,user:{id:'admin'},role:'admin',isStaff:true});mocks.rpc.mockResolvedValue({data:{id:'origin',updatedAt:'2026-09-02'},error:null});});
describe('origin settings action',()=>{
  it('preserves submitted values on conflicts and blocks staff writes',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:'fulfillment_origin_conflict'}});
    const failed=await saveFulfillmentOriginAction({},form());
    expect(failed).toMatchObject({attempt:1,values:{baseFee:'4200',name:'변경 창고'},errors:{form:expect.stringContaining('다른 관리자')}});
    mocks.auth.mockResolvedValue({isConfigured:true,user:{id:'staff'},role:'staff',isStaff:true});mocks.rpc.mockClear();
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({errors:{form:expect.stringContaining('admin')}});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('normalizes money and returns the saved version while invalidating settings and shopping',async()=>{
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({message:expect.any(String),updatedAt:'2026-09-02'});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_fulfillment_origin',expect.objectContaining({target_values:expect.objectContaining({base_fee:4200,free_threshold:65000})}));
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/settings/origins');
    expect(mocks.revalidate).toHaveBeenCalledWith('/cart');
  });
});
