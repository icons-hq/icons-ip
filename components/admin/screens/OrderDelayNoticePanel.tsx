'use client';

import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import {useRef,useState,useTransition,type FormEvent} from 'react';
import {listOrderDelayNoticesAction,prepareOrderDelayNoticeAction,readOrderDelayNoticeAction,requestOrderDelayNoticeAction,retryOrderDelayNoticeAction} from '@/app/admin/order-delay-actions';
import {ORDER_DELAY_ERROR_LABELS,ORDER_DELAY_STATUS_LABELS,type OrderDelayNoticeActionResult,type OrderDelayNoticeSummary} from '@/lib/admin/order-delay-notices';
import {formatOrderDateTime,orderReferenceLabel} from '@/lib/orders';
import {Button} from '@/components/admin/kit/ui/button';
import {Input} from '@/components/admin/kit/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/admin/kit/ui/table';
import {Textarea} from '@/components/admin/kit/ui/textarea';
import {readPreorderScheduleChangeAction} from '@/app/admin/preorder-schedule-actions';
import {PreorderScheduleResultView} from '@/components/admin/GoodsPreorderSchedulePanel';
import type {OrderDelayNoticeSummary as HistoryItem} from '@/lib/admin/order-delay-notices';
import type {PreorderScheduleChange} from '@/lib/admin/preorder-schedule-change';
/* 고객 지연 안내 카드(템플릿 룩, ADR-0028). 주문별 수신자·채널 결과는 kit 표다. */
const FIELD='flex w-full min-w-0 flex-col gap-1.5 [&>span]:font-medium';

export function OrderDelayNoticePanel({shipmentIds,onClose}:{shipmentIds:string[];onClose:()=>void}){
 const [title,setTitle]=useState('발송 지연 안내');const [body,setBody]=useState('');
 const [knownDate,setKnownDate]=useState(false);const [date,setDate]=useState('');
 const [receipt,setReceipt]=useState<OrderDelayNoticeActionResult>({});
 const [attemptId,setAttemptId]=useState<string|null>(null);
 const [history,setHistory]=useState<OrderDelayNoticeSummary[]|null>(null);
 /* 예약 일정 일괄 변경 안내(QNA-040)는 대상 전원의 이메일을 싣지 않는 일괄 결과 문서(20건씩)로 연다. */
 const [scheduleResult,setScheduleResult]=useState<PreorderScheduleChange|null>(null);
 const [pending,startTransition]=useTransition();const requestId=useRef<string|null>(null);
 const notice=receipt.notice;
 const emailReady=Boolean(notice?.emailEnabled&&receipt.emailConfigured);
 function change(){requestId.current=null;setAttemptId(null);setReceipt({});}
 function perform(action:()=>Promise<OrderDelayNoticeActionResult>){
  setScheduleResult(null);
  startTransition(async()=>{
   try {const result=await action();setReceipt(previous=>result.notice?result:{...previous,...result});}
   catch {setReceipt(previous=>({...previous,error:'연결이 끊겼습니다. 같은 안내의 결과 새로고침으로 접수 여부를 먼저 확인해주세요.'}));}
  });
 }
 function prepare(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(pending)return;
  requestId.current??=crypto.randomUUID();const id=requestId.current;setAttemptId(id);
  perform(()=>prepareOrderDelayNoticeAction({requestId:id,shipmentIds,title,body,expectedShipDate:knownDate?date:null}));
 }
 function openHistory(item:HistoryItem){
  if(item.kind!=='preorder_schedule'){perform(()=>readOrderDelayNoticeAction(item.id));return;}
  const changeId=item.scheduleChangeId;
  if(!changeId){setReceipt(previous=>({...previous,error:'예약 일정 일괄 변경 기록을 찾지 못했습니다.'}));return;}
  startTransition(async()=>{
   try {const result=await readPreorderScheduleChangeAction(changeId);if(result.ok){setReceipt({});setScheduleResult(result.change);}else setReceipt(previous=>({...previous,error:result.error}));}
   catch {setReceipt(previous=>({...previous,error:'예약 일정 일괄 변경 결과를 불러오지 못했습니다.'}));}
  });
 }
 function loadHistory(){
  startTransition(async()=>{
   try {const result=await listOrderDelayNoticesAction();if(result.notices)setHistory(result.notices);else setReceipt(previous=>({...previous,error:result.error}));}
   catch {setReceipt(previous=>({...previous,error:'이전 안내 기록을 불러오지 못했습니다.'}));}
  });
 }
 return <section aria-label="고객 지연 안내" className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed text-card-foreground sm:p-5">
  <div className="flex w-full flex-wrap items-center justify-between gap-3"><h3 className="text-base font-medium text-foreground">고객 지연 안내</h3><Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>닫기</Button></div>
  <p>선택한 배송 건을 주문별로 묶어 실제 구매자에게 앱 알림과 이메일을 각각 1건 보냅니다. 같은 구매자의 여러 주문은 주문별로 안내합니다.</p>
  <p className="text-muted-foreground">내부 지연 메모는 포함하지 않습니다. 고객에게 전달할 내용을 직접 입력하고 발송 예정일은 확정된 경우에만 선택해주세요.</p>
  {!notice&&shipmentIds.length>0?<form onSubmit={prepare} className="flex w-full flex-col items-start gap-3">
   <span className="text-muted-foreground tabular-nums">선택한 배송 건 {shipmentIds.length}건</span>
   <label className={FIELD}><span>고객 안내 제목</span>
    <Input name="customerTitle" value={title} maxLength={80} required disabled={pending} onChange={event=>{change();setTitle(event.target.value);}}/>
   </label>
   <label className={FIELD}><span>고객 안내 내용</span>
    <Textarea name="customerBody" value={body} maxLength={350} rows={4} required disabled={pending} onChange={event=>{change();setBody(event.target.value);}}/>
    <small className="text-xs font-normal text-muted-foreground">{body.length}/350자 · 앱 알림과 이메일에 동일한 문구를 사용합니다.</small>
   </label>
   <fieldset className="m-0 flex w-full min-w-0 flex-col gap-2 border-0 p-0" disabled={pending}><legend className="mb-2 font-medium">고객에게 안내할 발송 예정일</legend>
    <div className="flex flex-wrap items-center gap-4">
     <label className="flex items-center gap-2"><input type="radio" name="expectedDateMode" checked={!knownDate} onChange={()=>{change();setKnownDate(false);}}/> 확인 중</label>
     <label className="flex items-center gap-2"><input type="radio" name="expectedDateMode" checked={knownDate} onChange={()=>{change();setKnownDate(true);}}/> 확정된 날짜</label>
    </div>
    {knownDate?<label className={FIELD}><span>확정 발송 예정일</span><Input className="w-44" type="date" name="customerExpectedDate" value={date} required onChange={event=>{change();setDate(event.target.value);}}/></label>:null}
   </fieldset>
   <Button type="submit" disabled={pending||!body.trim()}>대상·고객 문구 미리보기</Button>
  </form>:null}
  {notice?<>
   <p><strong className="font-medium">{notice.requestedAt?'발송 요청 결과':'발송 전 미리보기'}</strong> · 주문 {new Set(notice.targets.map(target=>target.orderId)).size}건 · 수신자 {notice.targets.length}명 · {notice.expectedShipDate?`발송 예정일 ${notice.expectedShipDate} 확정`:'발송 예정일 확인 중'}</p>
   <p className="text-xs text-muted-foreground tabular-nums">안내번호 {notice.id} · {formatOrderDateTime(notice.createdAt)}</p>
   {!emailReady?<AdminNotice role="status" tone="danger">{!notice.emailEnabled?'지연 안내 이메일 발송 설정이 꺼져 있습니다.': '이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.'} 두 채널의 준비가 완료되어야 발송을 요청할 수 있습니다.</AdminNotice>:null}
   {!notice.requestedAt&&notice.targets.some(target=>target.errorCode==='recipient_missing')?<AdminNotice tone="warning">이메일을 확인할 수 없는 주문은 이메일 발송에서 제외되며 앱 알림만 발행됩니다. 아래 수신자와 채널별 제외 사유를 확인해주세요.</AdminNotice>:null}
   <h4 className="text-sm font-medium text-foreground">{notice.title}</h4>
   <div className="w-full rounded-lg border">
    <Table className="min-w-[45rem]"><caption className="caption-top border-b px-2 py-2 text-left text-sm font-medium text-foreground">주문별 수신자·고객 문구·채널 결과</caption><TableHeader><TableRow className="bg-muted/50"><TableHead scope="col">주문·구매자</TableHead><TableHead scope="col">안내 대상·고객 문구</TableHead><TableHead scope="col">앱 알림</TableHead><TableHead scope="col">이메일</TableHead></TableRow></TableHeader>
     <TableBody>{notice.targets.map(target=><TableRow key={target.id}>
      <TableCell className="align-top whitespace-normal">{orderReferenceLabel(target.orderId, target.orderNumber)}<br/>{target.buyerName} · {target.audience==='recipient'?'선물 받는 분':'구매자'}<br/><small className="text-xs text-muted-foreground">{target.recipientEmail||'수신자 이메일 없음'}</small></TableCell>
      <TableCell className="align-top whitespace-normal"><ul className="flex flex-col gap-0.5">{target.shipmentLabels.map((label,index)=><li key={target.shipmentIds[index]}>{label}</li>)}</ul><p className="mt-1 whitespace-pre-wrap wrap-anywhere">{target.messageBody}</p></TableCell>
      <TableCell className="align-top whitespace-normal"><AdminStatusBadge tone={statusTone('delayNoticeChannel',target.inAppStatus)}>{ORDER_DELAY_STATUS_LABELS[target.inAppStatus]}</AdminStatusBadge></TableCell>
      <TableCell className="align-top whitespace-normal"><AdminStatusBadge tone={statusTone('delayNoticeChannel',target.emailStatus)}>{target.emailStatus==='sent'&&target.emailProviderState==='accepted'?'공급자 접수':ORDER_DELAY_STATUS_LABELS[target.emailStatus]}</AdminStatusBadge>
       {target.emailProviderState==='delivered'?<small className="text-xs text-muted-foreground"> · 수신 서버 전달</small>:null}
       {target.errorCode?<p className="mt-1 text-destructive">{ORDER_DELAY_ERROR_LABELS[target.errorCode]||'발송 상태를 확인해주세요.'}</p>:null}
       {target.retryable?<small className="text-xs text-muted-foreground">실패 건 재시도 가능</small>:null}
      </TableCell>
     </TableRow>)}</TableBody>
    </Table>
   </div>
   <p className="text-muted-foreground">이메일의 ‘공급자 접수’는 수신함 도착 확인과 다릅니다. 결과 불명은 같은 요청으로만 복구하며 이미 발송한 앱 알림·이메일은 다시 보내지 않습니다.</p>
   <div className="flex flex-wrap items-center gap-2">
    {!notice.requestedAt?<>
     <Button className="h-auto min-h-8 whitespace-normal text-left" type="button" disabled={pending||!emailReady} onClick={()=>perform(()=>requestOrderDelayNoticeAction(notice.id))}>확인한 {notice.targets.length}명의 수신자에게 앱 알림·이메일 발송 요청</Button>
     {shipmentIds.length?<Button type="button" variant="outline" disabled={pending} onClick={change}>새 미리보기 작성</Button>:null}
    </>:notice.targets.some(target=>target.retryable)?<Button type="button" variant="outline" disabled={pending||!emailReady} onClick={()=>perform(()=>retryOrderDelayNoticeAction(notice.id))}>실패한 이메일만 재시도</Button>:null}
    <Button type="button" variant="outline" disabled={pending} onClick={()=>perform(()=>readOrderDelayNoticeAction(notice.id))}>안내 결과 새로고침</Button>
   </div>
  </>:null}
  <div aria-live="polite">{pending?<p className="text-muted-foreground" role="status">안내 기록을 확인하고 있습니다…</p>:null}{receipt.error?<p role="alert" className="text-destructive">{receipt.error}</p>:null}</div>
  {!notice&&attemptId?<Button type="button" variant="outline" disabled={pending} onClick={()=>perform(()=>readOrderDelayNoticeAction(attemptId))}>같은 미리보기 접수 확인</Button>:null}
  <Button type="button" variant="outline" disabled={pending} onClick={loadHistory}>최근 안내·미리보기 이력 불러오기</Button>
  {scheduleResult?<PreorderScheduleResultView key={scheduleResult.id} change={scheduleResult}/>:null}
  {history?<ul className="flex w-full flex-col gap-1.5">{history.length?history.map(item=><li key={item.id}><Button className="h-auto min-h-7 whitespace-normal text-left" type="button" size="sm" variant="ghost" disabled={pending} onClick={()=>openHistory(item)}>{formatOrderDateTime(item.createdAt)} · {item.title} · {item.kind==='preorder_schedule'?'예약 일정 일괄 변경':item.requestedAt?'요청 결과':'미요청'}</Button></li>):<li className="text-muted-foreground">이전 안내 기록이 없습니다.</li>}</ul>:null}
 </section>;
}
