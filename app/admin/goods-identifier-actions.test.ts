import { beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestGoodsIdentifiersAction } from './goods-identifier-actions';

const mocks=vi.hoisted(()=>({ auth:{isConfigured:true,user:{id:'staff'},isStaff:true},rpc:vi.fn(),createClient:vi.fn() }));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:async()=>mocks.auth}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.createClient}));
beforeEach(()=>{
  mocks.auth.isStaff=true;
  mocks.rpc.mockReset().mockResolvedValue({data:[{code:'GC-0001',slug:'hangeul-kiring',default_variant_code:'GC-0001-01'}],error:null});
  mocks.createClient.mockReset().mockResolvedValue({rpc:mocks.rpc});
});
describe('상품 식별자 자동 제안',()=>{
  it('DB가 제안한 상품코드·옵션코드·URL을 그대로 돌려준다',async()=>{
    expect(await suggestGoodsIdentifiersAction('goods-code','한글 키링')).toEqual({code:'GC-0001',slug:'hangeul-kiring',defaultVariantCode:'GC-0001-01'});
  });
  it('일반 회원은 제안 RPC를 호출하지 못한다',async()=>{
    mocks.auth.isStaff=false;
    expect(await suggestGoodsIdentifiersAction('goods-code','한글 키링')).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
