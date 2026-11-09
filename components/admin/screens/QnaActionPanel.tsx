'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCsReplyDraft } from '@/components/admin/useCsReplyDraft';
import { questionReplySourceVersion } from '@/lib/admin/cs-reply-sources';
import { answerProductQuestionAction, setProductQuestionVisibilityAction, type AdminQnaActionState } from '@/app/admin/qna-actions';
import { formatAdminProductQuestionDateTime, type AdminProductQuestionRow } from '@/lib/admin/product-questions';
import { goodQuestionsHref } from '@/lib/product-questions';
import { statusTone } from '@/lib/admin/status-tone';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
import { CustomerServiceDialog, CustomerServiceInlinePanel } from './CustomerServiceDialog';
import { CsReplyTemplateTools } from './CsReplyTemplateTools';
import { CustomerServiceRecordNavigation, useCustomerServiceRecord } from './CustomerServiceRecordNavigation';
import { CsEditorDraftNotice } from './CsEditorDraftNotice';
import { ACTION_FEEDBACK_CLASS, DISCLOSURE_SUMMARY_CLASS, RECORD_CHANGED_CLASS, RECORD_META_CLASS, RECORD_META_ITEM_CLASS, RECORD_SECTION_CLASS, REPLY_FORM_CLASS } from './cs-kit-classes';

const EMPTY_STATE: AdminQnaActionState = {};
const ANSWER_MAX_LENGTH = 2000;
const RECORD_LINK_CLASS = 'font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground';

function Feedback({ state }: { state: AdminQnaActionState }) {
  return <div aria-live="polite" className={ACTION_FEEDBACK_CLASS}>
    {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
    {state.errors?.answer ? <span role="alert">{state.errors.answer}</span> : null}
    {state.message ? <span role="status">{state.message}</span> : null}
  </div>;
}

export function QnaActionPanel({ question, triggerLabel, accountId = '', inline = false }: { question: AdminProductQuestionRow; triggerLabel?: string; accountId?: string; inline?: boolean }) {
  const [visibilityState, visibilityAction, visibilityPending] = useActionState(setProductQuestionVisibilityAction, EMPTY_STATE);
  const navigation=useCustomerServiceRecord(question.id);
  const [localOpen, setLocalOpen] = useState(false);
  const open=navigation?.open??localOpen;
  const setOpen=(value:boolean)=>navigation?navigation.setOpen(value):setLocalOpen(value);
  const draft = useCsReplyDraft({ accountId, enabled: open, saveAction: answerProductQuestionAction, initialSource: { id: question.id, surface: 'product_question',
    body: question.body, reply: question.answerBody, replyAt: question.answeredAt, status: question.hidden ? 'hidden' : 'visible',
    sourceVersion: questionReplySourceVersion(question.answeredAt, question.hidden, question.updatedAt) } });
  const answer = draft.body, setAnswer = draft.change, changedSource = draft.changedSource;
  const answerState = draft.state, answerPending = draft.submitting;
  const answered = Boolean(draft.source.reply);
  const hidden = draft.source.status === 'hidden';
  const busy = answerPending || visibilityPending || draft.checking;
  const editingLocked = busy || draft.editingLocked;
  const Panel = inline ? CustomerServiceInlinePanel : CustomerServiceDialog;

  return <>
    <Button aria-expanded={inline ? open : undefined} disabled={inline && busy} onClick={() => setOpen(inline ? !open : true)} size={inline ? 'sm' : 'xs'} type="button" variant={answered ? 'outline' : 'soft'}>{triggerLabel ?? (answered ? '상세 · 답변 수정' : '상세 · 답변 등록')}</Button>
    {open ? <Panel title="상품 문의 상세" busy={busy} onClose={() => setOpen(false)}>
      <div className="flex min-w-0 flex-col gap-5 text-sm">
        <dl className={RECORD_META_CLASS}>
          <div className={RECORD_META_ITEM_CLASS}><dt>상품</dt><dd><Link className={RECORD_LINK_CLASS} href={goodQuestionsHref(question.goodId)}>{question.goodName}</Link></dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>상품번호</dt><dd className="tabular-nums">{question.goodId}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>작성자</dt><dd>@{question.authorName}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>작성일</dt><dd className="tabular-nums">{formatAdminProductQuestionDateTime(question.createdAt)}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>노출 상태</dt><dd className="flex flex-wrap items-center gap-1.5"><AdminStatusBadge tone={statusTone('questionVisibility', hidden ? 'hidden' : 'visible')}>{hidden ? '비노출' : '공개'}</AdminStatusBadge>{question.secret ? <AdminStatusBadge data-secret-badge="" tone="neutral">비밀글</AdminStatusBadge> : null}</dd></div>
          <div className={RECORD_META_ITEM_CLASS}><dt>답변 등록일</dt><dd className="tabular-nums">{draft.source.replyAt ? formatAdminProductQuestionDateTime(draft.source.replyAt) : '미등록'}</dd></div>
        </dl>
        <section className={RECORD_SECTION_CLASS}><h3>문의 내용</h3><p>{draft.source.body}</p></section>
        <CsEditorDraftNotice draft={draft} pending={busy} discardDisabled={draft.hasUnresolvedOperation} unresolved={draft.hasUnresolvedOperation} onRestore={draft.restore} onDiscard={draft.discard} />
        {draft.sourceError ? <p className="bg-transparent text-destructive" role="alert">{draft.sourceError}</p> : null}
        {draft.value !== null || draft.sourceError ? <Button className="self-start" disabled={busy || draft.blocked} onClick={draft.refreshSource} size="sm" type="button" variant="outline">최신 저장본 다시 확인</Button> : null}
        {changedSource ? <section className={RECORD_CHANGED_CLASS} aria-label="현재 저장된 답변 비교">
          <p className="bg-transparent font-medium text-warning" role="alert">초안 작성 이후 답변 또는 문의 상태가 바뀌었습니다. 현재 저장본과 문의 원문을 확인한 뒤 작성 문구를 다시 검토해주세요.</p>
          <h3>현재 저장된 답변</h3><p>{draft.source.reply || '아직 등록된 답변이 없습니다.'}</p>
          <Button className="self-start" disabled={editingLocked} onClick={draft.acknowledge} size="sm" type="button" variant="outline">현재 저장본 확인 · 작성 문구 유지</Button>
        </section> : null}
        <div className="flex justify-end"><CsReplyTemplateTools accountId={accountId} surface="product_question" body={answer} onInsert={setAnswer} disabled={editingLocked} /></div>
        <form action={draft.submit} className={REPLY_FORM_CLASS} onSubmit={event => { if (editingLocked || changedSource || answer.trim() === (draft.source.reply ?? '').trim()) event.preventDefault(); }}>
          <input name="questionId" type="hidden" value={question.id} />
          <Label htmlFor={`qna-answer-${question.id}`}>{question.secret ? '운영자 답변 (비밀글 · 작성자에게만 표시)' : '운영자 답변 (상품 상세에 공개)'}</Label>
          <Textarea className="max-h-[50vh] min-h-40 bg-background" disabled={editingLocked} id={`qna-answer-${question.id}`} maxLength={ANSWER_MAX_LENGTH*2} name="answer" onChange={(event) => setAnswer([...event.target.value].slice(0,ANSWER_MAX_LENGTH).join(''))} required rows={6} value={answer} />
          <span className="-mt-1.5 self-end text-xs text-muted-foreground tabular-nums">{[...answer].length.toLocaleString('ko-KR')} / {ANSWER_MAX_LENGTH.toLocaleString('ko-KR')}자</span>
          <p className="text-xs text-muted-foreground">답변 저장 시 작성자에게 알림이 발송됩니다.</p>
          <Feedback state={answerState} />
          {draft.hasUnresolvedOperation && draft.recovery === null ? <AdminNotice role="status" tone="warning">
            <div className="flex flex-wrap items-center gap-2">
              <p>앞선 저장 결과를 확인하기 전까지 작성 문구를 유지합니다.</p>
              <Button disabled={busy || draft.blocked} onClick={draft.retry} size="sm" type="button" variant="outline">같은 요청으로 결과 확인</Button>
            </div>
          </AdminNotice> : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={editingLocked || changedSource || answer.trim() === (draft.source.reply ?? '').trim()} size="sm" type="submit">{answerPending ? '저장 중' : answered ? '답변 수정 (알림 재발송)' : '답변 등록'}</Button>
            <Button disabled={busy} onClick={() => setOpen(false)} size="sm" type="button" variant="outline">닫기</Button>
          </div>
        </form>
        <details className="group/visibility border-t pt-4">
          <summary className={DISCLOSURE_SUMMARY_CLASS}>문의 노출 관리{hidden ? ' · 비노출 상태' : ''}<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/visibility:rotate-180" /></summary>
          <form action={visibilityAction} className="mt-3 flex flex-col items-start gap-2" onSubmit={(event) => {
            const message = hidden ? '이 질문을 다시 공개할까요? 상품 상세 목록에 즉시 다시 나옵니다.' : '이 질문을 비노출 처리할까요? 상품 상세에서 즉시 빠지고 작성자에게는 계속 보입니다.';
            if (!window.confirm(message)) event.preventDefault();
          }}>
            <input name="questionId" type="hidden" value={question.id} />
            <input name="hidden" type="hidden" value={hidden ? 'false' : 'true'} />
            <Button disabled={busy} size="sm" type="submit" variant={hidden ? 'outline' : 'destructive'}>{visibilityPending ? '처리 중' : hidden ? '비노출 해제' : '비노출'}</Button>
            <Feedback state={visibilityState} />
          </form>
        </details>
        <CustomerServiceRecordNavigation id={question.id} busy={busy} noun="문의" />
      </div>
    </Panel> : null}
  </>;
}
