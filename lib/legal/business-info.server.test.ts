import { beforeEach,describe,expect,it,vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@supabase/ssr',()=>({createServerClient:()=>({rpc})}));
vi.mock('next/cache',()=>({unstable_cache:(fn:unknown)=>fn}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({url:'https://local.example.test',key:'anon-test',isConfigured:true})}));
import { loadBusinessInfo } from './business-info.server';
import { BUSINESS_INFO } from './business-info';
beforeEach(()=>rpc.mockReset());
describe('공개 사업자 설정 조회',()=>{
  it('목적 RPC만 읽고 알 수 없는 계좌값을 버린다',async()=>{
    rpc.mockResolvedValue({data:{phone:'',email:'fresh@example.test',bank_transfer:'private'},error:null});
    const result=await loadBusinessInfo();expect(result.phone).toBe('');expect(result.email).toBe('fresh@example.test');expect(result.companyName).toBe(BUSINESS_INFO.companyName);expect(result).not.toHaveProperty('bank_transfer');expect(rpc).toHaveBeenCalledWith('get_storefront_settings');
  });
  it('미적용 DB·일시 장애에도 기존 사업자 정보로 셸을 유지한다',async()=>{
    rpc.mockResolvedValue({error:{message:'missing'},data:null});await expect(loadBusinessInfo()).resolves.toEqual(BUSINESS_INFO);
  });
});
