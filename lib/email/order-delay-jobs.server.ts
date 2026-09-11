import 'server-only';

import {createServiceClient} from '@/lib/supabase/service';
import {orderReferenceLabel} from '@/lib/orders';
import {emailDispatcherFromEnvironment} from './dispatcher.server';
import type {DispatchOutcome,EmailDispatcher} from './dispatcher';
import {escapeHtml} from './templates';

export interface OrderDelayEmailJob {
  id:string;claimToken:string;orderId:string;recipient:string;title:string;body:string;shipmentLabels:string[];
}
export interface OrderDelayEmailOutcome {
  status:'sent'|'queued'|'failed'|'unknown'|'suppressed';errorCode:string|null;retryable:boolean;
}
export interface OrderDelayEmailRepository {
  claim():Promise<OrderDelayEmailJob[]>;
  /** Revalidates the frozen target immediately before dispatch and binds the durable intent. */
  bindIntent(id:string,claimToken:string,intentId:string):Promise<boolean>;
  finish(id:string,claimToken:string,outcome:OrderDelayEmailOutcome):Promise<boolean>;
}

function outcome(result:DispatchOutcome):OrderDelayEmailOutcome {
  if(result.state==='suppressed')return {status:'suppressed',errorCode:'provider_suppressed',retryable:false};
  if(['bounced','complained','failed'].includes(result.state))return {status:'failed',errorCode:'provider_rejected',retryable:false};
  if(['accepted','sent','delivered','delayed'].includes(result.state))return {status:'sent',errorCode:null,retryable:false};
  if(result.kind==='skipped'&&result.reason==='disabled')return {status:'failed',errorCode:'delivery_disabled',retryable:true};
  if(result.kind==='skipped'&&result.reason==='in_progress')return {status:'queued',errorCode:'delivery_in_progress',retryable:false};
  if(result.state==='needs_review')return {status:'unknown',errorCode:'delivery_needs_review',retryable:false};
  if(result.state==='unknown')return {status:'unknown',errorCode:'delivery_outcome_unknown',retryable:false};
  return {status:'failed',errorCode:'provider_retryable',retryable:true};
}

function repositoryFromEnvironment():OrderDelayEmailRepository {
  const service=createServiceClient();
  return {
    async claim(){
      const {data,error}=await service.rpc('claim_order_delay_email_jobs',{batch_limit:25});
      if(error||!Array.isArray(data)||data.length>25)throw new Error('delay_email_claim_failed');
      return data as OrderDelayEmailJob[];
    },
    async bindIntent(id,claimToken,intentId){
      const {data,error}=await service.rpc('bind_order_delay_email_intent',{target_id:id,target_claim:claimToken,target_intent:intentId});
      if(error||typeof data!=='boolean')throw new Error('delay_email_bind_failed');
      return data;
    },
    async finish(id,claimToken,result){
      const {data,error}=await service.rpc('finish_order_delay_email_job',{target_id:id,target_claim:claimToken,target_status:result.status,target_error:result.errorCode,target_retryable:result.retryable});
      if(error||typeof data!=='boolean')throw new Error('delay_email_finish_failed');
      return data;
    },
  };
}

/** Durable notice content and recipient never change during provider idempotency replays. */
export async function processOrderDelayEmails(dependencies:{repository:OrderDelayEmailRepository;dispatcher:EmailDispatcher|null}={repository:repositoryFromEnvironment(),dispatcher:emailDispatcherFromEnvironment()}) {
  const jobs=await dependencies.repository.claim();
  const result={claimed:jobs.length,sent:0,queued:0,failed:0,unknown:0,suppressed:0,stale:0};
  for(let offset=0;offset<jobs.length;offset+=5){
    await Promise.all(jobs.slice(offset,offset+5).map(async job=>{
      let delivery:OrderDelayEmailOutcome;
      try{
        if(!dependencies.dispatcher)delivery={status:'failed',errorCode:'provider_not_configured',retryable:true};
        else {
          const intent=await dependencies.dispatcher.enqueue({source:'order_delay_notice',sourceReference:job.id,recipient:job.recipient,messageKind:'order_delay_notice',contentRevision:'order_delay_v1'});
          if(!await dependencies.repository.bindIntent(job.id,job.claimToken,intent.intentId)){result.stale++;return;}
          const orderUrl=`https://iconsip.com/orders/${job.orderId}`;
          const text=`주문 ${orderReferenceLabel(job.orderId)}\n안내 대상 배송 건: ${job.shipmentLabels.join(', ')}\n\n${job.body}\n\n주문 확인: ${orderUrl}`;
          delivery=outcome(await dependencies.dispatcher.dispatch({intentId:intent.intentId,recipient:job.recipient,message:{subject:job.title,text,
            html:`<h1>${escapeHtml(job.title)}</h1><p style="white-space:pre-wrap">${escapeHtml(text)}</p><p><a href="${orderUrl}">주문 확인</a></p>`}}));
        }
      }catch {delivery={status:'unknown',errorCode:'delivery_outcome_unknown',retryable:false};}
      try{
        if(await dependencies.repository.finish(job.id,job.claimToken,delivery))result[delivery.status]++;
        else result.stale++;
      }catch {result.stale++;}
    }));
  }
  return result;
}
