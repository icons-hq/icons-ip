import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:{isConfigured:true,user:{id:'admin'},isStaff:true,role:'admin'},rpc:vi.fn(),updateTag:vi.fn(),revalidatePath:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:async()=>mocks.auth}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({updateTag:mocks.updateTag,revalidatePath:mocks.revalidatePath}));
vi.mock('next/navigation',()=>({redirect:(path:string)=>{throw new Error(`redirect:${path}`);},unstable_rethrow:(e:unknown)=>{if(e instanceof Error&&e.message.startsWith('redirect:'))throw e;}}));
import { saveStoreSettingsAction,saveShippingCarrierAction } from './store-settings-actions';
const stamp='2026-09-08T01:00:00.000001Z';
function form(fields:Record<string,string>={}) { const data=new FormData(); for(const [k,v] of Object.entries({section:'business',updatedAt:stamp,email:'cs@example.test',phone:'02-000-0000',...fields}))data.set(k,v);return data;}
beforeEach(()=>{mocks.auth.role='admin';mocks.auth.isStaff=true;mocks.auth.isConfigured=true;mocks.rpc.mockReset().mockResolvedValue({data:'2026-09-08T02:00:00.000001Z',error:null});mocks.updateTag.mockClear();mocks.revalidatePath.mockClear();});
describe('설정 저장 경계',()=>{
  it('staff는 화면을 읽어도 RPC 쓰기를 요청할 수 없다',async()=>{
    mocks.auth.role='staff';expect((await saveStoreSettingsAction({},form())).errors?.form).toContain('admin');
    expect((await saveShippingCarrierAction({},form())).errors?.form).toContain('admin');expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('저장은 현재 버전을 보내고 새 버전 및 공개 캐시 갱신을 반환한다',async()=>{
    const result=await saveStoreSettingsAction({},form());expect(result.updatedAt).toBe('2026-09-08T02:00:00.000001Z');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_settings',expect.objectContaining({expected_updated_at:stamp,target_section:'business'}));
    expect(mocks.updateTag).toHaveBeenCalledWith('store-settings');expect(result.values).toBeUndefined();
  });
  it('충돌 오류는 입력을 유지하고 내부 상세를 노출하지 않는다',async()=>{
    mocks.rpc.mockResolvedValue({error:{message:'store_settings_conflict secret_detail'}});
    const result=await saveStoreSettingsAction({},form());expect(result.errors?.form).toContain('다른 관리자');expect(result.values?.email).toBe('cs@example.test');expect(JSON.stringify(result)).not.toContain('secret_detail');expect(mocks.updateTag).not.toHaveBeenCalled();
  });
  it('불완전한 은행 계좌와 잘못된 URL은 DB 호출 전에 거부한다',async()=>{
    expect((await saveStoreSettingsAction({},form({section:'bank_transfer',bank:'은행',accountNumber:'',holder:''}))).errors?.form).toContain('모두');
    expect((await saveShippingCarrierAction({},form({code:'demo',label:'택배',trackingUrlTemplate:'javascript:alert(1)',active:'true'}))).errors?.trackingUrlTemplate).toBeDefined();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('로그인 리다이렉트를 저장 실패 안내로 삼키지 않는다',async()=>{
    mocks.auth.isConfigured=false;await expect(saveStoreSettingsAction({},form())).rejects.toThrow('redirect:/login?next=');
  });
});

it('새 택배사 연속 등록에 이전 레코드의 버전을 재사용하지 않는다',async()=>{
  const result=await saveShippingCarrierAction({},form({code:'demo',label:'연습택배',trackingUrlTemplate:'https://carrier.example.test/{trackingNumber}',active:'true',updatedAt:''}));
  expect(result.message).toContain('저장했습니다');expect(result.updatedAt).toBeUndefined();
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shipping_carrier',expect.objectContaining({expected_updated_at:null}));
});
