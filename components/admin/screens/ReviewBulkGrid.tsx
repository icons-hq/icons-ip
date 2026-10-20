'use client';

import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { ConsoleGrid, type ConsoleGridColumn, type ConsoleGridRow } from '@/components/admin/console';
import { readReviewReplyBatchAction, replyReviewsBatchAction } from '@/app/admin/cs-reply-actions';
import type { AdminReviewRow } from '@/lib/admin/reviews';
import { parseReviewBatchRequest, reviewBatchFailureLabel, REVIEW_BATCH_MAX, type ReviewBatchRequest, type ReviewBatchResult } from '@/lib/admin/cs-reply-tools';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { CustomerServiceRecordProvider, type CustomerServiceRecordNavigationProps } from './CustomerServiceRecordNavigation';
import { CsReplyTemplateTools } from './CsReplyTemplateTools';

const PENDING_EVENT='icons-review-batch-pending-change';
function usePendingBatch(accountId:string) {
  const key=`icons-admin-review-batch:v1:${encodeURIComponent(accountId)}`;
  const read=useCallback(()=>{try{return accountId?window.sessionStorage.getItem(key)??'':'';}catch{return '';}},[accountId,key]);
  const subscribe=useCallback((notify:()=>void)=>{window.addEventListener(PENDING_EVENT,notify);return()=>window.removeEventListener(PENDING_EVENT,notify);},[]);
  const raw=useSyncExternalStore(subscribe,read,()=> '');
  const request=useMemo(()=>{try{return parseReviewBatchRequest(JSON.parse(raw));}catch{return null;}},[raw]);
  function save(value:ReviewBatchRequest|null) {try{if(accountId){if(value)window.sessionStorage.setItem(key,JSON.stringify(value));else window.sessionStorage.removeItem(key);window.dispatchEvent(new Event(PENDING_EVENT));}}catch{/* The open dialog keeps the exact request when storage is unavailable. */}}
  return {request,save};
}
export function ReviewBulkGrid({columns,rows,reviews,accountId='',navigation}:{columns:ConsoleGridColumn[];rows:ConsoleGridRow[];reviews:AdminReviewRow[];accountId?:string;navigation:CustomerServiceRecordNavigationProps}) {
  const pageKey=reviews.map(review=>review.id).join(',');
  const [selection,setSelection]=useState<{page:string;ids:string[]}>({page:pageKey,ids:[]});
  const selected=selection.page===pageKey?selection.ids:[];
  const [open,setOpen]=useState(false),[reply,setReply]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [pending,startTransition]=useTransition();
  const [frozen,setFrozen]=useState<ReviewBatchRequest|null>(null),[result,setResult]=useState<ReviewBatchResult|null>(null);
  const [error,setError]=useState(''),[notSubmitted,setNotSubmitted]=useState(false);
  const recovery=usePendingBatch(accountId),request=frozen??recovery.request;
  const selectedReviews=reviews.filter(review=>selected.includes(review.id));
  const changeReply=(value:string)=>{setReply(value);setConfirmed(false);};
  function acceptResult(value:ReviewBatchResult){setResult(value);setError('');setNotSubmitted(false);recovery.save(null);}
  function run(work:()=>Promise<void>){startTransition(async()=>{setError('');try{await work();}catch{setError('처리 결과를 확인하지 못했습니다. 같은 요청의 결과를 다시 확인해주세요.');}});}
  async function submit(value:ReviewBatchRequest) {
    setFrozen(value);recovery.save(value);setNotSubmitted(false);
    const response=await replyReviewsBatchAction(value);if(response.ok)acceptResult(response.result);else setError(response.error);
  }
  function launch(){
    if(result){setResult(null);setFrozen(null);setReply('');setConfirmed(false);}
    setError('');setNotSubmitted(false);setOpen(true);
  }
  const failures=result?.items.filter(item=>item.status==='failed')??[];
  return <CustomerServiceRecordProvider {...navigation}>
    <ConsoleGrid caption="리뷰 목록" preferencesKey="cs-reviews" columns={columns} rows={rows} emptyLabel="조건에 맞는 리뷰가 없습니다."
      selectable selectedIds={selected} onSelectionChange={ids=>setSelection({page:pageKey,ids})}>
      <div className="admin-cs-results__toolbar"><span>선택 {selected.length}건 · 최대 {REVIEW_BATCH_MAX}건</span>
        <button className="btn btn-sm btn-ghost" type="button" disabled={!request&&(selected.length<1||selected.length>REVIEW_BATCH_MAX)} onClick={launch}>{request&&!result?'이전 일괄답글 결과 확인':'일괄 답글 작성'}</button>
        {selected.length>REVIEW_BATCH_MAX&&<span role="alert">리뷰는 최대 {REVIEW_BATCH_MAX}개까지 선택해주세요.</span>}
      </div>
    </ConsoleGrid>
    {open&&<CustomerServiceDialog title="판매자 일괄 답글 작성" busy={pending} onClose={()=>setOpen(false)} wide>
      {result?<>
        <p role="status">등록 {result.items.filter(item=>item.status==='saved').length}건 · 같은 내용 {result.items.filter(item=>item.status==='unchanged').length}건 · 실패 {failures.length}건</p>
        <ul className="admin-cs-batch__results">{result.items.map(item=><li key={item.reviewId}><code>{item.reviewId}</code> — {item.status==='saved'?'등록 완료':item.status==='unchanged'?'이미 같은 답글이 있습니다.':reviewBatchFailureLabel(item.code)}</li>)}</ul>
        <p className="muted">완료된 항목에는 답글을 다시 등록하지 않습니다. 실패 항목은 최신 원문과 답글을 확인한 뒤 새로 선택해주세요.</p>
        <button className="btn btn-sm" type="button" onClick={()=>{setSelection({page:pageKey,ids:failures.map(item=>item.reviewId).filter(id=>reviews.some(review=>review.id===id))});setFrozen(null);setResult(null);setReply('');setOpen(false);}}>결과 확인</button>
      </>:<>
        <p>선택한 {(request?.items.length??selected.length).toLocaleString('ko-KR')}개 리뷰에 같은 답글을 등록합니다.</p>
        <p className="muted">상품 품질·배송·A/S 문의는 원문을 읽고 개별 답글을 작성해주세요. 리뷰 답글은 상품 상세에 공개됩니다.</p>
        <details open className="admin-cs-batch__targets"><summary>대상 리뷰 확인</summary><ul>{request?request.items.map(item=><li key={item.id}><code>{item.id}</code>{item.expectedReplyAt?' · 기존 답글 수정':''}</li>):selectedReviews.map(review=><li key={review.id}><strong>{review.goodName}</strong> · @{review.authorName} · {review.rating}점<br />{review.body}<br /><code>{review.id}</code>{review.adminReply?' · 기존 답글 수정':''}</li>)}</ul></details>
        {!request&&<CsReplyTemplateTools accountId={accountId} surface="review" body={reply} onInsert={changeReply} disabled={pending} />}
        <form className="admin-cs-reply" onSubmit={event=>{event.preventDefault();if(!confirmed||request)return;const value=parseReviewBatchRequest({requestId:crypto.randomUUID(),reply,items:selectedReviews.map(review=>({id:review.id,expectedReplyAt:review.adminReplyAt,expectedEditedAt:review.editedAt,expectedStatus:review.status}))});if(!value){setError('리뷰는 1~50건, 답글은 5~1000자로 입력해주세요.');return;}run(()=>submit(value));}}>
          <label htmlFor="review-batch-reply">답글 내용</label><textarea id="review-batch-reply" required minLength={5} maxLength={2000} rows={6} value={request?.reply??reply} disabled={pending||!!request} onChange={event=>changeReply([...event.target.value].slice(0,1000).join(''))} />
          <span className="admin-cs-reply__counter">{[...(request?.reply??reply)].length} / 1,000자 · 5자 이상</span>
          {!request&&<label className="admin-cs-batch__confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={pending} /> 대상과 답글을 확인했습니다. 기존 답글 {selectedReviews.filter(review=>review.adminReply).length}건은 새 내용으로 바뀝니다.</label>}
          {error&&<p className="admin-form-error" role="alert">{error}</p>}
          <div className="admin-cs-reply__actions">{request?<>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={()=>run(async()=>{const response=await readReviewReplyBatchAction(request.requestId);if(!response.ok){setError(response.error);return;}if(response.result){acceptResult(response.result);return;}setNotSubmitted(true);setError('완료된 처리 기록이 없습니다. 아래 버튼으로 같은 요청을 다시 등록할 수 있습니다.');})}>처리 결과 다시 확인</button>
            {notSubmitted&&<button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={()=>run(()=>submit(request))}>같은 요청으로 다시 등록</button>}
          </>:<button type="submit" className="btn btn-sm" disabled={pending||!confirmed||[...reply.trim()].length<5||selected.length<1||selected.length>REVIEW_BATCH_MAX}>일괄 답글 등록</button>}
          <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={()=>setOpen(false)}>닫기</button></div>
        </form>
      </>}
    </CustomerServiceDialog>}
  </CustomerServiceRecordProvider>;
}
