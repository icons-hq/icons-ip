'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useCsReplyDraft } from '@/components/admin/useCsReplyDraft';
import { questionReplySourceVersion } from '@/lib/admin/cs-reply-sources';
import { answerProductQuestionAction, setProductQuestionVisibilityAction, type AdminQnaActionState } from '@/app/admin/qna-actions';
import { formatAdminProductQuestionDateTime, type AdminProductQuestionRow } from '@/lib/admin/product-questions';
import { goodQuestionsHref } from '@/lib/product-questions';
import { CustomerServiceDialog, CustomerServiceInlinePanel } from './CustomerServiceDialog';
import { CsReplyTemplateTools } from './CsReplyTemplateTools';
import { CustomerServiceRecordNavigation, useCustomerServiceRecord } from './CustomerServiceRecordNavigation';
import { CsEditorDraftNotice } from './CsEditorDraftNotice';

const EMPTY_STATE: AdminQnaActionState = {};
const ANSWER_MAX_LENGTH = 2000;

function Feedback({ state }: { state: AdminQnaActionState }) {
  return <div aria-live="polite" className="admin-order-action-feedback">
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
    <button aria-expanded={inline ? open : undefined} className="admin-cs-open" disabled={inline && busy} onClick={() => setOpen(inline ? !open : true)} type="button">{triggerLabel ?? (answered ? '상세 · 답변 수정' : '상세 · 답변 등록')}</button>
    {open ? <Panel title="상품 문의 상세" busy={busy} onClose={() => setOpen(false)}>
      <div className="admin-cs-record">
        <dl className="admin-cs-record__meta">
          <div><dt>상품</dt><dd><Link href={goodQuestionsHref(question.goodId)}>{question.goodName}</Link></dd></div>
          <div><dt>상품번호</dt><dd>{question.goodId}</dd></div>
          <div><dt>작성자</dt><dd>@{question.authorName}</dd></div>
          <div><dt>작성일</dt><dd>{formatAdminProductQuestionDateTime(question.createdAt)}</dd></div>
          <div><dt>노출 상태</dt><dd>{hidden ? '비노출' : '공개'}</dd></div>
          <div><dt>답변 등록일</dt><dd>{draft.source.replyAt ? formatAdminProductQuestionDateTime(draft.source.replyAt) : '미등록'}</dd></div>
        </dl>
        <section className="admin-cs-record__content"><h3>문의 내용</h3><p>{draft.source.body}</p></section>
        <CsEditorDraftNotice draft={draft} pending={busy} discardDisabled={draft.hasUnresolvedOperation} unresolved={draft.hasUnresolvedOperation} onRestore={draft.restore} onDiscard={draft.discard} />
        {draft.sourceError ? <p role="alert">{draft.sourceError}</p> : null}
        {draft.value !== null || draft.sourceError ? <button type="button" className="btn btn-sm btn-ghost" disabled={busy || draft.blocked} onClick={draft.refreshSource}>최신 저장본 다시 확인</button> : null}
        {changedSource ? <section className="admin-cs-record__content" aria-label="현재 저장된 답변 비교">
          <p role="alert">초안 작성 이후 답변 또는 문의 상태가 바뀌었습니다. 현재 저장본과 문의 원문을 확인한 뒤 작성 문구를 다시 검토해주세요.</p>
          <h3>현재 저장된 답변</h3><p>{draft.source.reply || '아직 등록된 답변이 없습니다.'}</p>
          <button type="button" className="btn btn-sm btn-ghost" disabled={editingLocked} onClick={draft.acknowledge}>현재 저장본 확인 · 작성 문구 유지</button>
        </section> : null}
        <CsReplyTemplateTools accountId={accountId} surface="product_question" body={answer} onInsert={setAnswer} disabled={editingLocked} />
        <form action={draft.submit} className="admin-cs-reply" onSubmit={event => { if (editingLocked || changedSource || answer.trim() === (draft.source.reply ?? '').trim()) event.preventDefault(); }}>
          <input name="questionId" type="hidden" value={question.id} />
          <label htmlFor={`qna-answer-${question.id}`}>운영자 답변 (상품 상세에 공개)</label>
          <textarea disabled={editingLocked} id={`qna-answer-${question.id}`} maxLength={ANSWER_MAX_LENGTH*2} name="answer" onChange={(event) => setAnswer([...event.target.value].slice(0,ANSWER_MAX_LENGTH).join(''))} required rows={6} value={answer} />
          <span className="admin-cs-reply__counter">{[...answer].length.toLocaleString('ko-KR')} / {ANSWER_MAX_LENGTH.toLocaleString('ko-KR')}자</span>
          <p className="muted">답변 저장 시 작성자에게 알림이 발송됩니다.</p>
          <Feedback state={answerState} />
          {draft.hasUnresolvedOperation && draft.recovery === null ? <div role="status">
            <p>앞선 저장 결과를 확인하기 전까지 작성 문구를 유지합니다.</p>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy || draft.blocked} onClick={draft.retry}>같은 요청으로 결과 확인</button>
          </div> : null}
          <div className="admin-cs-reply__actions">
            <button className="btn btn-sm" disabled={editingLocked || changedSource || answer.trim() === (draft.source.reply ?? '').trim()} type="submit">{answerPending ? '저장 중' : answered ? '답변 수정 (알림 재발송)' : '답변 등록'}</button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setOpen(false)} type="button">닫기</button>
          </div>
        </form>
        <details className="admin-cs-visibility">
          <summary>문의 노출 관리{hidden ? ' · 비노출 상태' : ''}</summary>
          <form action={visibilityAction} onSubmit={(event) => {
            const message = hidden ? '이 질문을 다시 공개할까요? 상품 상세 목록에 즉시 다시 나옵니다.' : '이 질문을 비노출 처리할까요? 상품 상세에서 즉시 빠지고 작성자에게는 계속 보입니다.';
            if (!window.confirm(message)) event.preventDefault();
          }}>
            <input name="questionId" type="hidden" value={question.id} />
            <input name="hidden" type="hidden" value={hidden ? 'false' : 'true'} />
            <button className="btn btn-sm btn-ghost" disabled={busy} type="submit">{visibilityPending ? '처리 중' : hidden ? '비노출 해제' : '비노출'}</button>
            <Feedback state={visibilityState} />
          </form>
        </details>
        <CustomerServiceRecordNavigation id={question.id} busy={busy} noun="문의" />
      </div>
    </Panel> : null}
  </>;
}
