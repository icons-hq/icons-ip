'use client';

import { useActionState, useRef } from 'react';
import { useInquiryDraft } from '@/components/admin/useInquiryDraft';
import { InquiryDraftNotice } from './InquiryDraftNotice';
import {
  answerInquiryAction,
  closeInquiryAction,
  type AdminInquiryActionState,
} from '@/app/admin/inquiry-actions';
import { InquiryReplyTemplateTools } from './InquiryReplyTemplateTools';
import {
  INQUIRY_IMAGE_ACCEPT,
  MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES,
  type InquiryCategory,
} from '@/lib/inquiries';

/* 답변 작성 패널(#253).
 *
 * 템플릿은 작성 중인 답변을 "대체"한다(10/27 회의 후속 R3, MD-0011). 뒤에 덧붙이면 운영자가
 * 매번 기존 문장을 지워야 했다. 작성 중인 내용이 있으면 템플릿 도구가 "작성 중인 내용을
 * 템플릿으로 바꿀까요?" 확인을 거친 뒤에만 바꾸므로, 실수로 쓰던 답변을 잃지 않는다.
 * 고객문의·상담하기·상품문의·리뷰 답변이 같은 도구(InquiryReplyTemplateTools·CsReplyTemplateTools)로
 * 같은 동작과 안내 문구를 쓴다.
 *
 * [답변 발송]과 [종결]은 다른 폼이다. 하나의 폼에 두 버튼을 두면 브라우저 기본 제출
 * (엔터)이 어느 쪽으로 갈지 마크업 순서에 좌우된다. 고객문의 답변은 실수 발송을 막기 위해
 * Enter 전송을 쓰지 않는다(상담하기만 Enter 전송, R5). */

const EMPTY_STATE: AdminInquiryActionState = {};

function Feedback({ state }: { state: AdminInquiryActionState }) {
  return (
    <>
      {state.errors?.form ? (
        <span role="alert" style={{ fontSize: 12.5 }}>{state.errors.form}</span>
      ) : null}
      {state.errors?.body ? (
        <span role="alert" style={{ fontSize: 12.5 }}>{state.errors.body}</span>
      ) : null}
      {state.errors?.images ? (
        <span role="alert" style={{ fontSize: 12.5 }}>{state.errors.images}</span>
      ) : null}
      {state.message ? (
        <span className="muted" role="status" style={{ fontSize: 12.5 }}>{state.message}</span>
      ) : null}
    </>
  );
}

export function InquiryReplyPanel({
  category,
  closed,
  inquiryId,
  accountId = '',
}: {
  category: InquiryCategory;
  closed: boolean;
  inquiryId: string;
  accountId?: string;
}) {
  const [answerState, answerAction, answerPending] = useActionState(answerInquiryAction, EMPTY_STATE);
  const [closeState, closeAction, closePending] = useActionState(closeInquiryAction, EMPTY_STATE);
  const draft = useInquiryDraft(accountId, inquiryId, 'reply', answerState.resultKey);
  const { body, change: setBody } = draft;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const busy = answerPending || closePending || !draft.ready || draft.blocked;

  function insertTemplate(nextBody: string) {
    setBody(nextBody);
    bodyRef.current?.focus();
  }

  if (closed) {
    return (
      <section className="card col" style={{ gap: 8, padding: 18 }}>
        <strong>종결된 문의입니다.</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          종결 후에도 기록은 남습니다. 구매자가 이어서 물으려면 새 문의를 접수해야 합니다.
        </span>
      </section>
    );
  }

  return (
    <section className="card col" style={{ gap: 14, padding: 18 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <strong>답변 작성</strong>
        <InquiryReplyTemplateTools accountId={accountId} body={body} onInsert={insertTemplate} disabled={busy} />
      </div>
      <InquiryDraftNotice draft={draft} pending={busy} />

      <form action={answerAction} className="col" style={{ gap: 10 }}>
        <input name="category" type="hidden" value={category} />
        <input name="inquiryId" type="hidden" value={inquiryId} />
        <label className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>답변 내용</span>
          <textarea
            disabled={busy}
            maxLength={MAX_INQUIRY_BODY_LENGTH}
            name="body"
            onChange={(event) => setBody(event.target.value)}
            placeholder="구매자가 메일에서 그대로 읽습니다. 결론을 먼저 적어주세요."
            ref={bodyRef}
            rows={8}
            value={body}
          />
        </label>
        <label className="col" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            이미지 첨부 · 최대 {MAX_INQUIRY_IMAGES}장
          </span>
          <input key={answerState.resultKey ?? 'initial'} disabled={busy} accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
        </label>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" disabled={busy} type="submit">
            {answerPending ? '발송 중' : '답변 발송'}
          </button>
        </div>
        <Feedback state={answerState} />
      </form>

      <form action={closeAction} className="col" style={{ gap: 6 }}>
        <input name="inquiryId" type="hidden" value={inquiryId} />
        <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            답변 후 7일 동안 추가 질문이 없으면 자동으로 종결됩니다.
          </span>
          <button className="btn btn-sm btn-ghost" disabled={busy} type="submit">
            {closePending ? '종결 중' : '지금 종결'}
          </button>
        </div>
        <Feedback state={closeState} />
      </form>
    </section>
  );
}
