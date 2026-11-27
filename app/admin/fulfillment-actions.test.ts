import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),revalidate:vi.fn(),latest:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:mocks.auth}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/admin/fulfillment-origins.server',()=>({loadAdminFulfillmentOrigin:mocks.latest}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
import { saveFulfillmentOriginAction } from './fulfillment-actions';
const form=()=>{const data=new FormData();Object.entries({id:'00000000-0000-4000-8000-000000042201',updatedAt:'2026-09-01T00:00:00Z',code:'gimpo',name:'변경 창고',defaultCarrier:'hanjin',baseFee:'4200',freeThreshold:'65000',returnAddress:'창고 주소',cutoff:'17:30',exportTemplate:'wms_csv',active:'true'}).forEach(([key,value])=>data.set(key,value));return data;};
const latestOrigin={id:'00000000-0000-4000-8000-000000042201',code:'gimpo',name:'김포',defaultCarrier:'cj',baseFee:5000,freeThreshold:null,returnAddress:'새 창고 주소',cutoff:'18:00',exportTemplate:'standard' as const,active:false,updatedAt:'2026-09-03T00:00:00Z'};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(),isConfigured:true,user:{id:'admin'},role:'admin',isStaff:true});mocks.rpc.mockResolvedValue({data:{id:'origin',updatedAt:'2026-09-02'},error:null});mocks.latest.mockResolvedValue(latestOrigin);});
describe('origin settings action',()=>{
  it('새 출고지를 저장하면 그 출고지 탭으로 이동한다 (R22)',async()=>{
    const data=form();data.delete('id');data.delete('updatedAt');data.set('code','busan');
    await expect(saveFulfillmentOriginAction({},data)).rejects.toMatchObject({digest:expect.stringContaining(';/admin/settings/origins?origin=busan;')});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_fulfillment_origin',expect.objectContaining({target_id:null}));
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/settings/origins');
  });
  it('blocks staff writes',async()=>{
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(),isConfigured:true,user:{id:'staff'},role:'staff',isStaff:true});
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({errors:{form:expect.stringContaining('최고 관리자')}});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('다른 사람이 먼저 바꿨으면 입력을 그대로 두고 그 사람이 저장한 지금 내용을 함께 돌려준다 (O-11)',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:'fulfillment_origin_conflict'}});
    const failed=await saveFulfillmentOriginAction({},form());
    expect(failed).toMatchObject({attempt:1,values:{baseFee:'4200',name:'변경 창고'},errors:{form:'다른 사람이 먼저 바꿨습니다.'}});
    expect(failed.conflict).toEqual({updatedAt:'2026-09-03T00:00:00Z',values:{code:'gimpo',name:'김포',defaultCarrier:'cj',baseFee:'5000',freeThreshold:'',returnAddress:'새 창고 주소',cutoff:'18:00',exportTemplate:'standard',active:'false'}});
    expect(mocks.latest).toHaveBeenCalledWith('00000000-0000-4000-8000-000000042201');
  });
  it('지금 저장된 내용을 읽지 못해도 입력은 남기고 새로고침해 확인하라고 말한다',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:'fulfillment_origin_conflict'}});
    mocks.latest.mockRejectedValue(new Error('down'));
    const failed=await saveFulfillmentOriginAction({},form());
    expect(failed).toMatchObject({values:{baseFee:'4200'},errors:{form:expect.stringContaining('다른 사람이 먼저 바꿨습니다.')}});
    expect(failed.errors?.form).toContain('새로고침');
    expect(failed.conflict).toBeUndefined();
    mocks.latest.mockResolvedValue(null);
    expect((await saveFulfillmentOriginAction({},form())).conflict).toBeUndefined();
  });
  it('normalizes money and returns the saved version while invalidating settings and shopping',async()=>{
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({message:'출고지 설정을 저장했습니다.',updatedAt:'2026-09-02'});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_fulfillment_origin',expect.objectContaining({target_values:expect.objectContaining({base_fee:4200,free_threshold:65000})}));
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/settings/origins');
    expect(mocks.revalidate).toHaveBeenCalledWith('/cart');
  });
  it('사용 안 함으로 저장하면 상품에서 고르려면 어떻게 해야 하는지 말한다 (O-8)',async()=>{
    const data=form();data.set('active','false');
    expect(await saveFulfillmentOriginAction({},data)).toMatchObject({message:"사용 안 함으로 저장했습니다. 상품에서 고르려면 '사용'으로 바꿔 주세요."});
  });
  it('택배사·코드 오류는 그 칸에서 고칠 방법을 말한다',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{message:'shipping_carrier_inactive'}});
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({errors:{defaultCarrier:'사용 안 함인 택배사는 고를 수 없습니다. 다른 택배사를 골라 주세요.'}});
    mocks.rpc.mockResolvedValue({data:null,error:{message:'shipping_carrier_required'}});
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({errors:{defaultCarrier:'사용으로 저장하려면 기본 택배사를 골라 주세요.'}});
    mocks.rpc.mockResolvedValue({data:null,error:{message:'duplicate key value violates unique constraint "fulfillment_origins_code_key"'}});
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({errors:{code:'이미 있는 출고지 코드입니다. 다른 코드를 적어 주세요.'}});
    mocks.rpc.mockResolvedValue({data:null,error:{message:'boom'}});
    expect(await saveFulfillmentOriginAction({},form())).toMatchObject({errors:{form:expect.stringContaining('저장하지 못했습니다')}});
  });
});
