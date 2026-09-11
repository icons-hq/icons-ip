'use server';

import {revalidatePath} from 'next/cache';
import {getCurrentAdminAuthState} from '@/lib/auth/admin';
import {createClient} from '@/lib/supabase/server';
import {emailDispatcherFromEnvironment} from '@/lib/email/dispatcher.server';
import {ORDER_DELAY_UUID,orderDelayNoticeError,parseOrderDelayNotice,type OrderDelayNoticeActionResult,type OrderDelayNoticeSummary,type PrepareOrderDelayNotice} from '@/lib/admin/order-delay-notices';

async function authorized(){const auth=await getCurrentAdminAuthState();return Boolean(auth.isConfigured&&auth.user&&auth.isStaff);}
async function run(name:string,args:Record<string,unknown>):Promise<OrderDelayNoticeActionResult> {
  try{
    const client=await createClient();const {data,error}=await client.rpc(name,args);
    if(error)return {error:orderDelayNoticeError(error.message)};
    const notice=parseOrderDelayNotice(data);
    if(!notice)return {error:orderDelayNoticeError('invalid_result')};
    return {notice,emailConfigured:Boolean(emailDispatcherFromEnvironment())};
  }catch{return {error:orderDelayNoticeError('connection_lost')};}
}

export async function prepareOrderDelayNoticeAction(input:PrepareOrderDelayNotice):Promise<OrderDelayNoticeActionResult> {
  if(!await authorized())return {error:'직원 권한이 필요합니다.'};
  if(!input||typeof input.requestId!=='string'||!ORDER_DELAY_UUID.test(input.requestId)||!Array.isArray(input.shipmentIds)
    ||input.shipmentIds.length<1||input.shipmentIds.length>100||input.shipmentIds.some(id=>typeof id!=='string'||!ORDER_DELAY_UUID.test(id))
    ||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>80||/[\r\n]/.test(input.title)
    ||typeof input.body!=='string'||!input.body.trim()||input.body.trim().length>350
    ||input.expectedShipDate!==null&&(typeof input.expectedShipDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedShipDate)
      ||Number.isNaN(Date.parse(input.expectedShipDate))||new Date(input.expectedShipDate).toISOString().slice(0,10)!==input.expectedShipDate))return {error:orderDelayNoticeError('invalid_delay_notice')};
  return run('admin_prepare_order_delay_notice',{target_notice:input.requestId.toLowerCase(),target_shipments:[...new Set(input.shipmentIds.map(id=>id.toLowerCase()))].sort(),
    customer_title:input.title.trim(),customer_body:input.body.trim(),expected_ship_date:input.expectedShipDate});
}

export async function readOrderDelayNoticeAction(id:string):Promise<OrderDelayNoticeActionResult> {
  if(!await authorized())return {error:'직원 권한이 필요합니다.'};
  if(typeof id!=='string'||!ORDER_DELAY_UUID.test(id))return {error:orderDelayNoticeError('delay_notice_not_found')};
  return run('admin_get_order_delay_notice',{target_notice:id});
}

async function mutate(id:string,name:string):Promise<OrderDelayNoticeActionResult> {
  if(!await authorized())return {error:'직원 권한이 필요합니다.'};
  if(typeof id!=='string'||!ORDER_DELAY_UUID.test(id))return {error:orderDelayNoticeError('delay_notice_not_found')};
  // Read first so a committed request can always be recovered even if the provider was subsequently disabled.
  const current=await run('admin_get_order_delay_notice',{target_notice:id});
  if(current.error||!current.notice)return current;
  if(name==='admin_request_order_delay_notice'&&current.notice.requestedAt)return current;
  if(!current.emailConfigured)return {...current,error:'이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.'};
  if(!current.notice.emailEnabled)return {...current,error:orderDelayNoticeError('delay_notice_delivery_disabled')};
  const result=await run(name,{target_notice:id});
  if(result.notice){revalidatePath('/admin/sales/dispatch');revalidatePath('/notifications');}
  return result;
}
export async function requestOrderDelayNoticeAction(id:string){return mutate(id,'admin_request_order_delay_notice');}
export async function retryOrderDelayNoticeAction(id:string){return mutate(id,'admin_retry_order_delay_notice');}

export async function listOrderDelayNoticesAction():Promise<{notices?:OrderDelayNoticeSummary[];error?:string}> {
  if(!await authorized())return {error:'직원 권한이 필요합니다.'};
  try{
    const client=await createClient();const {data,error}=await client.rpc('admin_list_order_delay_notices',{target_order:null});
    if(error||!Array.isArray(data)||data.length>30||!data.every(row=>row&&typeof row.id==='string'&&ORDER_DELAY_UUID.test(row.id)&&typeof row.title==='string'&&typeof row.createdAt==='string'))return {error:'이전 안내 기록을 불러오지 못했습니다.'};
    return {notices:data as OrderDelayNoticeSummary[]};
  }catch{return {error:'이전 안내 기록을 불러오지 못했습니다.'};}
}
