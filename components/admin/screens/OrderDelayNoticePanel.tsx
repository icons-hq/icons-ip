'use client';

import {useRef,useState,useTransition,type FormEvent} from 'react';
import {listOrderDelayNoticesAction,prepareOrderDelayNoticeAction,readOrderDelayNoticeAction,requestOrderDelayNoticeAction,retryOrderDelayNoticeAction} from '@/app/admin/order-delay-actions';
import {ORDER_DELAY_ERROR_LABELS,ORDER_DELAY_STATUS_LABELS,type OrderDelayNoticeActionResult,type OrderDelayNoticeSummary} from '@/lib/admin/order-delay-notices';
import {formatOrderDateTime,orderReferenceLabel} from '@/lib/orders';

export function OrderDelayNoticePanel({shipmentIds,onClose}:{shipmentIds:string[];onClose:()=>void}){
 const [title,setTitle]=useState('발송 지연 안내');const [body,setBody]=useState('');
 const [knownDate,setKnownDate]=useState(false);const [date,setDate]=useState('');
 const [receipt,setReceipt]=useState<OrderDelayNoticeActionResult>({});
 const [attemptId,setAttemptId]=useState<string|null>(null);
 const [history,setHistory]=useState<OrderDelayNoticeSummary[]|null>(null);
 const [pending,startTransition]=useTransition();const requestId=useRef<string|null>(null);
 const notice=receipt.notice;
 const emailReady=Boolean(notice?.emailEnabled&&receipt.emailConfigured);
 function change(){requestId.current=null;setAttemptId(null);setReceipt({});}
 function perform(action:()=>Promise<OrderDelayNoticeActionResult>){
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
 function loadHistory(){
  startTransition(async()=>{
   try {const result=await listOrderDelayNoticesAction();if(result.notices)setHistory(result.notices);else setReceipt(previous=>({...previous,error:result.error}));}
   catch {setReceipt(previous=>({...previous,error:'이전 안내 기록을 불러오지 못했습니다.'}));}
  });
 }
 return <section aria-label="고객 지연 안내" className="wc-admin-kit wc-admin-kit__card" style={{marginTop:16}}>
  <div className="wc-admin-kit__actions"><h3 style={{margin:0}}>고객 지연 안내</h3><button className="wc-admin-kit__button" type="button" onClick={onClose} disabled={pending}>닫기</button></div>
  <p>선택한 배송 건을 주문별로 묶어 실제 구매자에게 앱 알림과 이메일을 각각 1건 보냅니다. 같은 구매자의 여러 주문은 주문별로 안내합니다.</p>
  <p className="muted">내부 지연 메모는 포함하지 않습니다. 고객에게 전달할 내용을 직접 입력하고 발송 예정일은 확정된 경우에만 선택해주세요.</p>
  {!notice&&shipmentIds.length>0?<form onSubmit={prepare} className="col" style={{gap:12}}>
   <span>선택한 배송 건 {shipmentIds.length}건</span>
   <label className="wc-admin-kit__field">고객 안내 제목
    <input name="customerTitle" value={title} maxLength={80} required disabled={pending} onChange={event=>{change();setTitle(event.target.value);}}/>
   </label>
   <label className="wc-admin-kit__field">고객 안내 내용
    <textarea name="customerBody" value={body} maxLength={350} rows={4} required disabled={pending} onChange={event=>{change();setBody(event.target.value);}}/>
    <small>{body.length}/350자 · 앱 알림과 이메일에 동일한 문구를 사용합니다.</small>
   </label>
   <fieldset disabled={pending}><legend>고객에게 안내할 발송 예정일</legend>
    <label><input type="radio" name="expectedDateMode" checked={!knownDate} onChange={()=>{change();setKnownDate(false);}}/> 확인 중</label>{' '}
    <label><input type="radio" name="expectedDateMode" checked={knownDate} onChange={()=>{change();setKnownDate(true);}}/> 확정된 날짜</label>
    {knownDate?<label className="wc-admin-kit__field">확정 발송 예정일<input type="date" name="customerExpectedDate" value={date} required onChange={event=>{change();setDate(event.target.value);}}/></label>:null}
   </fieldset>
   <button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary" disabled={pending||!body.trim()}>대상·고객 문구 미리보기</button>
  </form>:null}
  {notice?<>
   <p><strong>{notice.requestedAt?'발송 요청 결과':'발송 전 미리보기'}</strong> · 주문 {notice.targets.length}건 · {notice.expectedShipDate?`발송 예정일 ${notice.expectedShipDate} 확정`:'발송 예정일 확인 중'}</p>
   <p className="muted">안내번호 {notice.id} · {formatOrderDateTime(notice.createdAt)}</p>
   {!emailReady?<p role="status" className="wc-admin-kit__error">{!notice.emailEnabled?'지연 안내 이메일 발송 설정이 꺼져 있습니다.': '이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.'} 두 채널의 준비가 완료되어야 발송을 요청할 수 있습니다.</p>:null}
   {!notice.requestedAt&&notice.targets.some(target=>target.errorCode==='recipient_missing')?<p>이메일을 확인할 수 없는 주문은 이메일 발송에서 제외되며 앱 알림만 발행됩니다. 아래 수신자와 채널별 제외 사유를 확인해주세요.</p>:null}
   <h4>{notice.title}</h4>
   <div style={{overflowX:'auto'}}>
    <table className="admin-console-grid-table" style={{minWidth:720}}><caption>주문별 수신자·고객 문구·채널 결과</caption><thead><tr><th scope="col">주문·구매자</th><th scope="col">안내 대상·고객 문구</th><th scope="col">앱 알림</th><th scope="col">이메일</th></tr></thead>
     <tbody>{notice.targets.map(target=><tr key={target.id}>
      <td>{orderReferenceLabel(target.orderId)}<br/>{target.buyerName}<br/><small>{target.recipientEmail||'구매자 이메일 없음'}</small></td>
      <td><ul>{target.shipmentLabels.map((label,index)=><li key={target.shipmentIds[index]}>{label}</li>)}</ul><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{target.messageBody}</p></td>
      <td>{ORDER_DELAY_STATUS_LABELS[target.inAppStatus]}</td>
      <td>{target.emailStatus==='sent'&&target.emailProviderState==='accepted'?'공급자 접수':ORDER_DELAY_STATUS_LABELS[target.emailStatus]}
       {target.emailProviderState==='delivered'?<small> · 수신 서버 전달</small>:null}
       {target.errorCode?<p>{ORDER_DELAY_ERROR_LABELS[target.errorCode]||'발송 상태를 확인해주세요.'}</p>:null}
       {target.retryable?<small>실패 건 재시도 가능</small>:null}
      </td>
     </tr>)}</tbody>
    </table>
   </div>
   <p className="muted">이메일의 ‘공급자 접수’는 수신함 도착 확인과 다릅니다. 결과 불명은 같은 요청으로만 복구하며 이미 발송한 앱 알림·이메일은 다시 보내지 않습니다.</p>
   <div className="wc-admin-kit__actions">
    {!notice.requestedAt?<>
     <button className="wc-admin-kit__button wc-admin-kit__button--primary" type="button" disabled={pending||!emailReady} onClick={()=>perform(()=>requestOrderDelayNoticeAction(notice.id))}>확인한 {notice.targets.length}개 주문에 앱 알림·이메일 발송 요청</button>
     {shipmentIds.length?<button className="wc-admin-kit__button" type="button" disabled={pending} onClick={change}>새 미리보기 작성</button>:null}
    </>:notice.targets.some(target=>target.retryable)?<button className="wc-admin-kit__button" type="button" disabled={pending||!emailReady} onClick={()=>perform(()=>retryOrderDelayNoticeAction(notice.id))}>실패한 이메일만 재시도</button>:null}
    <button className="wc-admin-kit__button" type="button" disabled={pending} onClick={()=>perform(()=>readOrderDelayNoticeAction(notice.id))}>안내 결과 새로고침</button>
   </div>
  </>:null}
  <div aria-live="polite">{pending?<p role="status">안내 기록을 확인하고 있습니다…</p>:null}{receipt.error?<p role="alert" className="wc-admin-kit__error">{receipt.error}</p>:null}</div>
  {!notice&&attemptId?<button className="wc-admin-kit__button" type="button" disabled={pending} onClick={()=>perform(()=>readOrderDelayNoticeAction(attemptId))}>같은 미리보기 접수 확인</button>:null}
  <button className="wc-admin-kit__button" type="button" disabled={pending} onClick={loadHistory}>최근 안내·미리보기 이력 불러오기</button>
  {history?<ul>{history.length?history.map(item=><li key={item.id}><button type="button" className="wc-admin-kit__button" disabled={pending} onClick={()=>perform(()=>readOrderDelayNoticeAction(item.id))}>{formatOrderDateTime(item.createdAt)} · {item.title} · {item.requestedAt?'요청 결과':'미요청'}</button></li>):<li>이전 안내 기록이 없습니다.</li>}</ul>:null}
 </section>;
}
