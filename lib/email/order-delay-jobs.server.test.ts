import {describe,expect,it,vi} from 'vitest';
import {createEmailDispatcher,type EmailDispatcherRepository,type EmailProvider} from './dispatcher';
import {processOrderDelayEmails,type OrderDelayEmailJob,type OrderDelayEmailRepository} from './order-delay-jobs.server';

const job:OrderDelayEmailJob={id:'40000000-0000-4000-8000-000000000001',claimToken:'40000000-0000-4000-8000-000000000002',orderId:'40000000-0000-4000-8000-000000000003',recipient:'buyer@example.test',title:'발송 지연 안내',body:'입고 일정 확인 중입니다.\n발송 예정일: 확인 중',shipmentLabels:['김포 · 00000004']};
function setup(){
 let state='queued';let available=true;
 const finishes:unknown[]=[];
 const jobs:OrderDelayEmailRepository={
  claim:async()=>{if(!available)return [];available=false;return [job];},
  bindIntent:async()=>true,
  finish:async(_id,_claim,result)=>{finishes.push(result);return true;},
 };
 const repo:EmailDispatcherRepository={
  enqueue:vi.fn(async()=>({kind:'existing' as const,intentId:'40000000-0000-4000-8000-000000000005',idempotencyKey:'email/frozen-notice',state:state as 'queued'})),
  enqueueAll:vi.fn(),
  claimDispatch:vi.fn(async()=>state==='accepted'?{kind:'already_dispatched' as const,state:'accepted' as const}:{kind:'claimed' as const,intentId:'40000000-0000-4000-8000-000000000005',claimId:'40000000-0000-4000-8000-000000000006',idempotencyKey:'email/frozen-notice'}),
  recordAccepted:vi.fn(async()=>{state='accepted';return {state:'accepted' as const};}),
  recoverAcceptedPersistence:vi.fn(async()=>({kind:'preserved' as const,state:'accepted' as const})),
  recordDispatchFailure:vi.fn(async()=>{state='unknown';return {state:'unknown' as const,retryable:true};}),
  reduceProviderEvent:vi.fn(),
 };
 const provider:EmailProvider={send:vi.fn(async()=>({kind:'accepted' as const,providerReference:'synthetic-provider-id'}))};
 return {jobs,repo,provider,finishes,dispatcher:createEmailDispatcher({repository:repo,provider}),requeue:()=>{available=true;}};
}
describe('지연 주문 이메일 작업',()=>{
 it('고정된 실제 구매자와 고객 문구를 기존 dispatcher에 보내고 공급자 접수 결과를 보존한다',async()=>{
  const s=setup();const result=await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher});
  expect(result).toEqual({claimed:1,sent:1,queued:0,failed:0,unknown:0,suppressed:0,stale:0});
  expect(s.repo.enqueue).toHaveBeenCalledWith({source:'order_delay_notice',sourceReference:job.id,recipient:'buyer@example.test',messageKind:'order_delay_notice',contentRevision:'order_delay_v1'});
  expect(s.provider.send).toHaveBeenCalledWith(expect.objectContaining({recipient:'buyer@example.test',idempotencyKey:'email/frozen-notice',message:expect.objectContaining({subject:'발송 지연 안내',text:expect.stringContaining('입고 일정 확인 중입니다.')})}));
 expect(s.finishes).toEqual([{status:'sent',errorCode:null,retryable:false}]);
 });
 it('공급자 접수 후 timeout이면 같은 멱등키로만 복구하고 두 worker가 같은 작업을 발송하지 않는다',async()=>{
  const s=setup();const keys=new Set<string>();let calls=0;
  s.provider.send=vi.fn(async input=>{
   keys.add(input.idempotencyKey);calls++;
   return calls===1?{kind:'ambiguous_failure' as const}:{kind:'accepted' as const,providerReference:'accepted-before-timeout'};
  });
  await Promise.all([processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher}),processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher})]);
  expect(calls).toBe(1);expect(s.finishes[0]).toEqual({status:'unknown',errorCode:'delivery_outcome_unknown',retryable:false});
  s.requeue();await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher});
  expect([...keys]).toEqual(['email/frozen-notice']);expect(s.finishes[1]).toEqual({status:'sent',errorCode:null,retryable:false});
  s.requeue();await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher});
  expect(calls).toBe(2); // The accepted third replay never calls the provider.
 });
 it('접수 기록 응답 유실 뒤 저장된 접수 결과를 보존한다',async()=>{
  const s=setup();s.repo.recordAccepted=vi.fn(async()=>{throw new Error('commit response lost');});
  const result=await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher});
  expect(result.sent).toBe(1);expect(s.repo.recoverAcceptedPersistence).toHaveBeenCalledOnce();
 });
 it('수신자·주문 변경이 발송 직전 발견되면 공급자를 호출하지 않는다',async()=>{
  const s=setup();s.jobs.bindIntent=async()=>false;
  expect((await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher})).stale).toBe(1);
  expect(s.provider.send).not.toHaveBeenCalled();
 });
 it('메일 환경 미구성과 닫힌 gate를 발송 완료로 보고하지 않고 재시도 가능한 실패로 남긴다',async()=>{
  const s=setup();await processOrderDelayEmails({repository:s.jobs,dispatcher:null});
  expect(s.finishes).toEqual([{status:'failed',errorCode:'provider_not_configured',retryable:true}]);
  expect(s.provider.send).not.toHaveBeenCalled();
  s.requeue();s.repo.claimDispatch=vi.fn(async()=>({kind:'disabled',state:'queued'} as const));
  await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher});
  expect(s.finishes[1]).toEqual({status:'failed',errorCode:'delivery_disabled',retryable:true});
 });
 it('24시간 안전 창이 끝난 결과 불명은 새 키로 우회하지 않는다',async()=>{
  const s=setup();s.repo.claimDispatch=vi.fn(async()=>({kind:'needs_review',state:'needs_review'} as const));
  expect((await processOrderDelayEmails({repository:s.jobs,dispatcher:s.dispatcher})).unknown).toBe(1);
  expect(s.provider.send).not.toHaveBeenCalled();
  expect(s.finishes).toEqual([{status:'unknown',errorCode:'delivery_needs_review',retryable:false}]);
 });
});
