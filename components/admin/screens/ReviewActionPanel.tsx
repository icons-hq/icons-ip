'use client';

import Link from 'next/link';
import { REVIEW_KIND_LABELS } from '@/lib/review-types';
import { useActionState, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCsReplyDraft } from '@/components/admin/useCsReplyDraft';
import { reviewReplySourceVersion } from '@/lib/admin/cs-reply-sources';
import { replyToReviewAction, setReviewStatusAction, type AdminReviewActionState } from '@/app/admin/review-actions';
import type { AdminReviewRow } from '@/lib/admin/reviews';
import { ADMIN_REVIEW_STATUS_LABELS, formatReviewDateTime, goodReviewsHref, reviewRatingLabel } from '@/lib/reviews';
import { orderReferenceLabel } from '@/lib/orders';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { CustomerServiceDialog } from './CustomerServiceDialog';
import { CsReplyTemplateTools } from './CsReplyTemplateTools';
import { CustomerServiceRecordNavigation, useCustomerServiceRecord } from './CustomerServiceRecordNavigation';
import { ReviewBestPanel } from './ReviewBestPanel';
import { CsEditorDraftNotice } from './CsEditorDraftNotice';
import { ACTION_FEEDBACK_CLASS, DISCLOSURE_SUMMARY_CLASS, RECORD_CHANGED_CLASS, RECORD_META_CLASS, RECORD_META_ITEM_CLASS, RECORD_SECTION_CLASS, REPLY_FORM_CLASS } from './cs-kit-classes';

const EMPTY_STATE: AdminReviewActionState = {};
const RECORD_LINK_CLASS = 'font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground';

function Feedback({ state }: { state: AdminReviewActionState }) {
  return <div aria-live="polite" className={ACTION_FEEDBACK_CLASS}>
    {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
    {state.errors?.reply ? <span role="alert">{state.errors.reply}</span> : null}
    {state.errors?.reason ? <span role="alert">{state.errors.reason}</span> : null}
    {state.message ? <span role="status">{state.message}</span> : null}
  </div>;
}

export function ReviewActionPanel({ review, triggerLabel, accountId = '' }: { review: AdminReviewRow; triggerLabel?: string; accountId?: string }) {
  const [statusState, statusAction, statusPending] = useActionState(setReviewStatusAction, EMPTY_STATE);
  const navigation=useCustomerServiceRecord(review.id);
  const [localOpen, setLocalOpen] = useState(false);
  const open=navigation?.open??localOpen;
  const setOpen=(value:boolean)=>navigation?navigation.setOpen(value):setLocalOpen(value);
  const [localReason, setLocalReason] = useState('');
  const [bestBusy, setBestBusy] = useState(false);
  const draft = useCsReplyDraft({ accountId, enabled: open, saveAction: replyToReviewAction, initialSource: { id: review.id, surface: 'review',
    body: review.body, reply: review.adminReply, replyAt: review.adminReplyAt, status: review.status, sourceVersion: reviewReplySourceVersion(review.adminReplyAt, review.editedAt, review.status) } });
  const replyState = draft.state, replyPending = draft.submitting;
  const reply = draft.body;
  const reason=navigation?.draft?.reason??localReason;
  const setReply = draft.change, changedSource = draft.changedSource;
  const setReason=(value:string)=>navigation?navigation.saveDraft('reason',value):setLocalReason(value);
  const hidden = draft.source.status === 'hidden';
  const busy = replyPending || statusPending || bestBusy || draft.checking;
  const editingLocked = busy || draft.editingLocked;
  const imageUrls = draft.source.imageUrls ?? review.imageUrls;

  return <>
    <Button onClick={() => setOpen(true)} size="xs" type="button" variant="outline">{triggerLabel ?? (review.adminReply ? '상세 · 답글 수정' : '상세 · 답글 등록')}</Button>
    {open ? <CustomerServiceDialog title="리뷰 상세" busy={busy} onClose={() => setOpen(false)}>
      <div className="flex min-w-0 flex-col gap-5 text-sm">
        <dl className={RECORD_META_CLASS}>
          <div className={RECORD_META_ITEM_CLASS}><dt>상품</dt><dd><Link className={RECORD_LINK_CLASS} href={goodReviewsHref(review.goodId)}>{review.goodName}</Link></dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>리뷰 구분</dt><dd>{REVIEW_KIND_LABELS[review.kind ?? 'ordinary']}{review.repeatPurchase === true ? ' · 재구매' : review.repeatPurchase === null ? ' · 재구매 이력 미확인' : ''}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>상품번호</dt><dd className="tabular-nums">{review.goodId}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>작성자</dt><dd>@{review.authorName}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>작성일</dt><dd className="tabular-nums">{formatReviewDateTime(review.createdAt)}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>주문번호</dt><dd><Link className={RECORD_LINK_CLASS} href={`/admin/sales/orders/${review.orderId}`}>{orderReferenceLabel(review.orderId, review.orderNumber)}</Link></dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>리뷰 상태</dt><dd>{ADMIN_REVIEW_STATUS_LABELS[draft.source.status]}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>평점</dt><dd>{reviewRatingLabel(draft.source.rating ?? review.rating)}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>리뷰도움수</dt><dd className="tabular-nums">{review.helpfulCount.toLocaleString('ko-KR')}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>답글 등록일</dt><dd className="tabular-nums">{draft.source.replyAt ? formatReviewDateTime(draft.source.replyAt) : '미등록'}</dd></div>
        </dl>
        <section className={RECORD_SECTION_CLASS}>
          <h3>리뷰 내용</h3>
          <p>{draft.source.body}</p>
          {imageUrls.length ? <div className="mt-1 flex flex-wrap gap-2.5">{imageUrls.map((url, index) => <a className="block overflow-hidden rounded-md border" href={url} key={url} target="_blank" rel="noreferrer">
            {/* Signed customer uploads are authorized by the staff loader. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="max-h-45 max-w-45 object-contain" src={url} alt={`리뷰 첨부 사진 ${index + 1}`} />
          </a>)}</div> : null}
          {(draft.source.imageCount ?? review.imageCount) > imageUrls.length ? <p className="text-xs text-muted-foreground">일부 첨부 사진을 불러오지 못했습니다.</p> : null}
        </section>
        <ReviewBestPanel initial={review.best} disabled={replyPending || statusPending} onBusyChange={setBestBusy} />
        <CsEditorDraftNotice draft={draft} pending={busy} discardDisabled={draft.hasUnresolvedOperation} unresolved={draft.hasUnresolvedOperation} onRestore={draft.restore} onDiscard={draft.discard} />
        {draft.sourceError ? <p className="bg-transparent text-destructive" role="alert">{draft.sourceError}</p> : null}
        {draft.value !== null || draft.sourceError ? <Button className="self-start" disabled={busy || draft.blocked} onClick={draft.refreshSource} size="sm" type="button" variant="outline">최신 저장본 다시 확인</Button> : null}
        {changedSource ? <section className={RECORD_CHANGED_CLASS} aria-label="현재 저장된 답글 비교">
          <p className="bg-transparent font-medium text-[var(--wc-warning)]" role="alert">초안 작성 이후 답글 또는 리뷰 원문·상태가 바뀌었습니다. 현재 저장본과 리뷰 원문을 확인한 뒤 작성 문구를 다시 검토해주세요.</p>
          <h3>현재 저장된 답글</h3><p>{draft.source.reply || '아직 등록된 답글이 없습니다.'}</p>
          <Button className="self-start" disabled={editingLocked} onClick={draft.acknowledge} size="sm" type="button" variant="outline">현재 저장본 확인 · 작성 문구 유지</Button>
        </section> : null}
        <div className="flex justify-end"><CsReplyTemplateTools accountId={accountId} surface="review" body={reply} onInsert={setReply} disabled={editingLocked} /></div>
        <form action={draft.submit} className={REPLY_FORM_CLASS} onSubmit={event => { if (editingLocked || changedSource || reply.trim() === (draft.source.reply ?? '').trim()) event.preventDefault(); }}>
          <input name="reviewId" type="hidden" value={review.id} />
          <Label htmlFor={`review-reply-${review.id}`}>운영자 답글 (공개 표시)</Label>
          <Textarea className="max-h-[50vh] min-h-40 bg-background" disabled={editingLocked} id={`review-reply-${review.id}`} maxLength={2000} minLength={2} name="reply" onChange={(event) => setReply([...event.target.value].slice(0,1000).join(''))} required rows={6} value={reply} />
          <span className="-mt-1.5 self-end text-xs text-muted-foreground tabular-nums">{[...reply].length.toLocaleString('ko-KR')} / 1,000자 · 2자 이상</span>
          <Feedback state={replyState} />
          {draft.hasUnresolvedOperation && draft.recovery === null ? <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2" role="status">
            <p className="mr-auto">앞선 저장 결과를 확인하기 전까지 작성 문구를 유지합니다.</p>
            <Button disabled={busy || draft.blocked} onClick={draft.retry} size="sm" type="button" variant="outline">같은 요청으로 결과 확인</Button>
          </div> : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={editingLocked || changedSource || reply.trim() === (draft.source.reply ?? '').trim()} size="sm" type="submit">{replyPending ? '저장 중' : draft.source.reply ? '답글 수정' : '답글 등록'}</Button>
            <Button disabled={busy} onClick={() => setOpen(false)} size="sm" type="button" variant="outline">닫기</Button>
          </div>
        </form>
        <details className="group/visibility border-t pt-4">
          <summary className={DISCLOSURE_SUMMARY_CLASS}>리뷰 노출 관리{hidden ? ' · 블라인드 상태' : ''}<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/visibility:rotate-180" /></summary>
          <form action={statusAction} className="mt-3 flex flex-col items-start gap-2" onSubmit={(event) => {
            const message = hidden ? '이 리뷰를 다시 공개할까요? 공개 즉시 평점 평균과 목록에 다시 반영됩니다.' : `${review.rating}점 리뷰를 블라인드할까요? 공개 목록과 평점 평균에서 즉시 빠지고 사유가 감사 로그에 남습니다.`;
            if (!window.confirm(message)) event.preventDefault();
          }}>
            <input name="reviewId" type="hidden" value={review.id} />
            <input name="status" type="hidden" value={hidden ? 'visible' : 'hidden'} />
            {hidden ? <p>블라인드 사유: {review.hiddenReason ?? '기록 없음'}</p> : <div className="flex w-full flex-col gap-1.5">
              <Label htmlFor={`review-reason-${review.id}`}>블라인드 사유 (감사 로그에 남습니다)</Label>
              <Input id={`review-reason-${review.id}`} maxLength={500} minLength={2} name="reason" onChange={(event) => setReason(event.target.value)} required type="text" value={reason} />
            </div>}
            <Button disabled={busy} size="sm" type="submit" variant={hidden ? 'outline' : 'destructive'}>{statusPending ? '처리 중' : hidden ? '블라인드 해제' : '블라인드'}</Button>
            <Feedback state={statusState} />
          </form>
        </details>
        <CustomerServiceRecordNavigation id={review.id} busy={busy} noun="리뷰" />
      </div>
    </CustomerServiceDialog> : null}
  </>;
}
