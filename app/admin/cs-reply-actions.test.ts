const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {archiveCsReplyTemplateAction,replyReviewsBatchAction,readReviewReplyBatchAction,saveCsReplyTemplateAction} from './cs-reply-actions';
const mocks=vi.hoisted(()=>({auth:{isConfigured:true,isStaff: true, operatorAccess: legacyOperatorAccessFixture(),user:{id:'staff'}},rpc:vi.fn(),revalidatePath:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:()=>mocks.auth}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidatePath}));
const id='11111111-1111-4111-8111-111111111111';
const request={requestId:id,items:[{id,expectedReplyAt:null,expectedEditedAt:null,expectedStatus:'visible'}],reply:'소중한 리뷰 감사합니다.'};
beforeEach(()=>{mocks.auth.isStaff=true;mocks.rpc.mockReset();mocks.revalidatePath.mockReset();});
describe('CS reply actions',()=>{
 it('비관리자는 템플릿·일괄저장·결과조회 RPC에 닿지 않는다',async()=>{
   mocks.auth.isStaff=false;
   expect((await replyReviewsBatchAction(request)).ok).toBe(false);
   expect((await saveCsReplyTemplateAction({id})).ok).toBe(false);
   expect((await archiveCsReplyTemplateAction({id})).ok).toBe(false);
   expect((await readReviewReplyBatchAction(id)).ok).toBe(false);
   expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('일괄 요청은 하나의 원자적 RPC와 원래 기대시각을 전달한다',async()=>{
   const result={requestId:id,items:[{reviewId:id,status:'failed',code:'review_changed'}]};
   mocks.rpc.mockResolvedValue({data:result,error:null});
   expect(await replyReviewsBatchAction(request)).toEqual({ok:true,result});
   expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_reply_reviews_batch',{p_request_id:id,p_items:request.items,p_reply:request.reply});
 });
 it('다른 payload 재사용과 불확실한 결과를 성공으로 표시하지 않는다',async()=>{
   mocks.rpc.mockResolvedValue({data:null,error:{message:'review_batch_request_changed'}});
   expect(await replyReviewsBatchAction(request)).toMatchObject({ok:false,error:expect.stringContaining('이미 사용한 요청')});
   expect(mocks.revalidatePath).not.toHaveBeenCalled();
   mocks.rpc.mockResolvedValue({data:null,error:null});
   expect(await readReviewReplyBatchAction(id)).toEqual({ok:true,result:null});
 });
 it('템플릿 삭제는 리비전을 검사하는 복구 가능한 보관 RPC다',async()=>{
   mocks.rpc.mockResolvedValue({data:{id,surface:'review',category:'product',title:'감사',body:'소중한 리뷰 감사합니다.',revision:2,archived_at:'2026-10-12T00:00:00Z',updated_at:'2026-10-12T00:00:00Z'},error:null});
   expect((await archiveCsReplyTemplateAction({id,archived:true,revision:1})).ok).toBe(true);
   expect(mocks.rpc).toHaveBeenCalledWith('admin_archive_cs_reply_template',{p_id:id,p_archived:true,p_expected_revision:1});
 });
 it('새 템플릿 제목35자·리뷰1000자를 서버에서 검사한다',async()=>{
   expect((await saveCsReplyTemplateAction({id,surface:'review',category:'other',title:'x'.repeat(36),body:'답변 본문입니다.',revision:0})).ok).toBe(false);
   expect((await saveCsReplyTemplateAction({id,surface:'review',category:'other',title:'제목',body:'x'.repeat(1001),revision:0})).ok).toBe(false);
   expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
