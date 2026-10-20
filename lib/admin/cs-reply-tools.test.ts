import {describe,expect,it} from 'vitest';
import {insertCsReplyTemplate,parseReviewBatchRequest,parseReviewBatchResult,reviewBatchFailureLabel} from './cs-reply-tools';
const id='11111111-1111-4111-8111-111111111111';
const item={id,expectedReplyAt:null,expectedEditedAt:null,expectedStatus:'visible'};
const request={requestId:id,items:[item],reply:' 소중한 리뷰 감사합니다. '};
describe('CS reply tools',()=>{
 it('대상을 중복·상한·잘못된 시각으로 보내지 않는다',()=>{
   expect(parseReviewBatchRequest(request)).toMatchObject({reply:'소중한 리뷰 감사합니다.'});
   expect(parseReviewBatchRequest({...request,items:[item,item]})).toBeNull();
   expect(parseReviewBatchRequest({...request,items:Array.from({length:51},()=>item)})).toBeNull();
   expect(parseReviewBatchRequest({...request,items:[{...item,expectedReplyAt:'not a date'}]})).toBeNull();
   expect(parseReviewBatchRequest({...request,reply:'1234'})).toBeNull();
 });
 it('이모지 길이를 DB의 문자 수와 맞추고 기존 초안은 덮어쓰지 않는다',()=>{
   expect(parseReviewBatchRequest({...request,reply:'😀'.repeat(1000)})).not.toBeNull();
   expect(parseReviewBatchRequest({...request,reply:'😀'.repeat(1001)})).toBeNull();
   expect(insertCsReplyTemplate('작성 중','답변',10)).toEqual({ok:true,body:'작성 중\n\n답변'});
   expect(insertCsReplyTemplate('작성 중','아주 긴 답변 본문',10).ok).toBe(false);
 });
 it('행별 결과와 충돌 이유를 보존한다',()=>{
   expect(parseReviewBatchResult({requestId:id,items:[{reviewId:id,status:'failed',code:'review_changed'}]})).toMatchObject({items:[{status:'failed',code:'review_changed'}]});
   expect(reviewBatchFailureLabel('review_changed')).toContain('최신 내용');
   expect(parseReviewBatchResult({requestId:id,items:[{reviewId:id,status:'unknown',code:null}]})).toBeNull();
 });
});
