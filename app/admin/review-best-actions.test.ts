import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setBestReviewAction, saveBestReviewSettingsAction } from './review-best-actions';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
const id='93500000-0000-4000-8000-000000000001';
const request={reviewId:id,selected:true,reason:'사용 경험 확인',expectedRevision:0,reviewFingerprint:'a'.repeat(32),operationId:id};
const result={reviewId:id,selected:true,reason:request.reason,revision:1,reviewFingerprint:request.reviewFingerprint,selectedAt:'2026-10-13T01:00:00Z',problem:null,state:'selected'};
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue(true);mocks.rpc.mockResolvedValue({data:result,error:null});});
describe('BEST 리뷰 저장 액션',()=>{
  it('서버 권한이 없으면 DB에 접근하지 않는다',async()=>{mocks.access.mockResolvedValue(false);expect(await setBestReviewAction(request)).toHaveProperty('error');expect(mocks.rpc).not.toHaveBeenCalled();});
  it('유효한 요청만 정확한 DB 매개변수로 저장하고 응답 대상을 결속한다',async()=>{expect(await setBestReviewAction(request)).toEqual({state:result});expect(mocks.rpc).toHaveBeenCalledWith('admin_set_review_best',{p_review_id:id,p_selected:true,p_reason:request.reason,p_expected_revision:0,p_review_fingerprint:request.reviewFingerprint,p_operation_id:id});expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]','page');});
  it('잘못된 입력은 저장하지 않는다',async()=>{expect(await setBestReviewAction({...request,reason:'a'})).toHaveProperty('error');expect(mocks.rpc).not.toHaveBeenCalled();});
  it('수정 충돌은 확정 실패이며 통신·불일치 응답은 결과 불명이다',async()=>{
    mocks.rpc.mockResolvedValueOnce({error:{code:'PT409',message:'best_review_changed'}});expect(await setBestReviewAction(request)).not.toHaveProperty('uncertain');
    mocks.rpc.mockRejectedValueOnce(new Error('network'));expect(await setBestReviewAction(request)).toHaveProperty('uncertain',true);
    mocks.rpc.mockResolvedValueOnce({data:{...result,reviewId:'93500000-0000-4000-8000-000000000002'},error:null});expect(await setBestReviewAction(request)).toHaveProperty('uncertain',true);
    mocks.rpc.mockResolvedValueOnce({data:{...result,reason:'다른 사유'},error:null});expect(await setBestReviewAction(request)).toHaveProperty('uncertain',true);
  });
  it('구매 부적격은 명확한 운영자 메시지로 표시한다',async()=>{mocks.rpc.mockResolvedValueOnce({error:{code:'23514',message:'purchase_ineligible'}});expect(await setBestReviewAction(request)).toEqual({error:'현재 구매 내역이 선정 조건을 충족하지 않습니다.'});});
  it('표시 설정은 store 권한·버전·응답값을 검증한다',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{enabled:true,revision:1},error:null});expect(await saveBestReviewSettingsAction(true,0,id)).toEqual({settings:{enabled:true,revision:1}});expect(mocks.access).toHaveBeenCalledWith('/admin/display/detail/reviews',{capability:'store.manage'});
    mocks.rpc.mockResolvedValueOnce({data:{enabled:false,revision:1},error:null});expect(await saveBestReviewSettingsAction(true,0,id)).toHaveProperty('uncertain',true);
  });
});
