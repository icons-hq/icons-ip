import { beforeEach,describe,expect,it,vi } from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({getServiceRoleConfig:()=>({isConfigured:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}),createServiceClient:()=>({rpc})}));
import { bankTransferCheckoutEnabled,getBankTransferAccount } from './bank-transfer.server';
beforeEach(()=>{vi.unstubAllEnvs();vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','service-test');rpc.mockReset();});
describe('설정 기반 무통장 계좌',()=>{
  it('DB의 세 표시값을 읽고 공백을 정리한다',async()=>{
    rpc.mockResolvedValue({data:{bank:' 연습은행 ',accountNumber:'123-456',holder:'회사'},error:null});
    await expect(getBankTransferAccount()).resolves.toEqual({bank:'연습은행',accountNumber:'123-456',holder:'회사'});
    expect(rpc).toHaveBeenCalledWith('get_bank_transfer_settings');
  });
  it('DB 미설정이면 남아 있는 env로 결제를 열지 않는다',async()=>{
    vi.stubEnv('BANK_TRANSFER_BANK_NAME','이전은행');vi.stubEnv('BANK_TRANSFER_ACCOUNT_NUMBER','111');vi.stubEnv('BANK_TRANSFER_ACCOUNT_HOLDER','이전회사');
    rpc.mockResolvedValue({data:null,error:null});
    await expect(bankTransferCheckoutEnabled()).resolves.toBe(false);
  });
  it.each([{bank:'은행',accountNumber:'123',holder:''},{}])('불완전한 값은 결제수단을 숨긴다',async data=>{
    rpc.mockResolvedValue({data,error:null});await expect(getBankTransferAccount()).resolves.toBeNull();
  });
  it('서버 신뢰 경계가 없으면 DB를 읽지 않는다',async()=>{
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');await expect(bankTransferCheckoutEnabled()).resolves.toBe(false);expect(rpc).not.toHaveBeenCalled();
  });
  it('DB 실패는 이전 계좌로 fallback하지 않고 결제를 닫는다',async()=>{
    rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});await expect(bankTransferCheckoutEnabled()).resolves.toBe(false);
  });
  it('PG gate와 무관하게 완전한 계좌가 있을 때만 열린다',async()=>{
    rpc.mockResolvedValue({data:{bank:'은행',accountNumber:'123',holder:'회사'},error:null});await expect(bankTransferCheckoutEnabled()).resolves.toBe(true);
  });
});
