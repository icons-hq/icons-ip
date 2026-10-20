import { beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({allow:true,rpc:vi.fn(),updateTag:vi.fn(),revalidatePath:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:vi.fn(async()=>mocks.allow)}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({updateTag:mocks.updateTag,revalidatePath:mocks.revalidatePath}));
vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
import { saveStoreBrandingAction } from './store-branding-actions';
import { DEFAULT_STORE_BRANDING } from '@/lib/store-branding';
const stamp='2026-10-12T01:00:00.000001Z';
const operation='00000000-0000-4000-8000-000000016001';
beforeEach(()=>{mocks.allow=true;mocks.rpc.mockReset().mockResolvedValue({data:'2026-10-12T02:00:00.000001Z',error:null});mocks.updateTag.mockClear();mocks.revalidatePath.mockClear();});
it('관리자 권한 및 입력 검증을 통과한 요청만 저장한다',async()=>{
  mocks.allow=false;expect((await saveStoreBrandingAction(DEFAULT_STORE_BRANDING,stamp,operation)).error).toContain('admin');
  mocks.allow=true;expect((await saveStoreBrandingAction({...DEFAULT_STORE_BRANDING,showIntroduction:true},stamp,operation)).error).toContain('입력값');
  expect((await saveStoreBrandingAction(DEFAULT_STORE_BRANDING,stamp,'bad')).error).toContain('다시 열어');expect(mocks.rpc).not.toHaveBeenCalled();
});
it('같은 작업 ID·편집 버전을 보내고 성공 후 공개 캐시를 갱신한다',async()=>{
  const result=await saveStoreBrandingAction(DEFAULT_STORE_BRANDING,stamp,operation);
  expect(result.updatedAt).toBe('2026-10-12T02:00:00.000001Z');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_store_branding',{target_operation_id:operation,target_values:DEFAULT_STORE_BRANDING,expected_updated_at:stamp});
  expect(mocks.updateTag).toHaveBeenCalledWith('store-settings');expect(mocks.revalidatePath).toHaveBeenCalledWith('/','layout');
});
it('충돌과 업로드 오류를 설명하고 실패 응답에서 성공 상태를 만들지 않는다',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'store_settings_conflict secret'}});
  const result=await saveStoreBrandingAction(DEFAULT_STORE_BRANDING,stamp,operation);expect(result.error).toContain('다른 관리자');expect(JSON.stringify(result)).not.toContain('secret');
  mocks.rpc.mockResolvedValue({data:null,error:{message:'unverified_artwork'}});expect((await saveStoreBrandingAction(DEFAULT_STORE_BRANDING,stamp,operation)).error).toContain('다시 업로드');
  mocks.rpc.mockResolvedValue({data:null,error:null});expect((await saveStoreBrandingAction(DEFAULT_STORE_BRANDING,stamp,operation)).error).toContain('결과를 확인');
  expect(mocks.updateTag).not.toHaveBeenCalled();
});

it('대표 이미지 검증 오류는 실제 크기 조건과 재업로드 방법을 안내한다',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'invalid_store_profile_image internal'}});
  const result=await saveStoreBrandingAction({...DEFAULT_STORE_BRANDING,profileImagePath:null},stamp,operation);
  expect(result.error).toContain('160×160px 이상의 정사각형');expect(result.error).toContain('새로 업로드');expect(JSON.stringify(result)).not.toContain('internal');
  expect(mocks.updateTag).not.toHaveBeenCalled();
});
